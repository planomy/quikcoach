import { Server } from 'socket.io';
import { openDatabase, queries } from './db.js';

const ownershipDb = openDatabase();

function normalizeRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

function roomSocketName(code) {
  return `room:${normalizeRoomCode(code)}`;
}

function teacherSocketName(code) {
  return `teacher:${normalizeRoomCode(code)}`;
}

function studentSocketName(studentId) {
  return `student:${Number(studentId)}`;
}

function audienceQuestionBase(row) {
  return {
    id: Number(row.id),
    text: String(row.text || ''),
    status: String(row.status || 'pending'),
    votes: Number(row.vote_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildTeacherQnaPayload(code) {
  const c = normalizeRoomCode(code);
  return {
    questions: queries.listAudienceQuestions(ownershipDb, c).map((row) => ({
      ...audienceQuestionBase(row),
      studentId: Number(row.student_id),
      studentName: String(row.student_name || ''),
      anonymousRequested: !!row.anonymous_requested,
      publishedAnonymous: !!row.published_anonymous,
    })),
  };
}

function buildStudentQnaPayload(code, studentId) {
  const c = normalizeRoomCode(code);
  const sid = Number(studentId);
  const questions = queries.listAudienceQuestions(ownershipDb, c).flatMap((row) => {
    const mine = Number(row.student_id) === sid;
    if (!mine) return [];
    const anonymous = !!row.anonymous_requested;
    return [{
      ...audienceQuestionBase(row),
      mine: true,
      anonymous,
      author: 'You',
      voted: false,
    }];
  });
  return { questions };
}

function emitAudienceQnaState(io, code) {
  const c = normalizeRoomCode(code);
  io.to(teacherSocketName(c)).emit('qna:teacher', buildTeacherQnaPayload(c));
  for (const row of queries.listStudents(ownershipDb, c)) {
    io.to(studentSocketName(row.id)).emit('qna:student', buildStudentQnaPayload(c, row.id));
  }
}

function buildRoomPayload(code) {
  const c = normalizeRoomCode(code);
  const room = queries.ensureRoom(ownershipDb, c);
  return {
    room: queries.rowToRoom(room),
    students: queries.listStudents(ownershipDb, c).map(queries.rowToStudent),
    posts: queries.listBoardPosts(ownershipDb, c).map(queries.rowToBoardPost),
  };
}

function deleteOwnQuestion(io, socket, payload = {}, cb) {
  try {
    const code = normalizeRoomCode(socket.data.roomCode);
    const studentId = Number(socket.data.studentId);
    const questionId = Number(payload?.questionId);
    if (socket.data.role !== 'student' || code.length !== 4 || !studentId || !questionId) {
      cb?.({ ok: false, error: 'That question is not available' });
      return;
    }

    const question = queries.getAudienceQuestion(ownershipDb, questionId);
    if (
      !question ||
      normalizeRoomCode(question.room_code) !== code ||
      Number(question.student_id) !== studentId
    ) {
      cb?.({ ok: false, error: 'That question is not yours to remove' });
      return;
    }

    ownershipDb.prepare('DELETE FROM audience_questions WHERE id = ? AND room_code = ? AND student_id = ?')
      .run(questionId, code, studentId);
    emitAudienceQnaState(io, code);
    cb?.({ ok: true });
  } catch (error) {
    console.error('Could not remove student question', error);
    cb?.({ ok: false, error: 'Could not remove your question' });
  }
}

function updateTeacherCard(io, socket, payload = {}, cb) {
  try {
    const code = normalizeRoomCode(socket.data.roomCode);
    const postId = Number(payload?.postId);
    if (socket.data.role !== 'teacher' || code.length !== 4 || !postId) {
      cb?.({ ok: false, error: 'Open the room as teacher first' });
      return;
    }

    const post = queries.getBoardPost(ownershipDb, postId);
    if (!post || normalizeRoomCode(post.room_code) !== code) {
      cb?.({ ok: false, error: 'Teacher card not found' });
      return;
    }

    const title = String(payload?.title || 'Teacher').trim().slice(0, 80) || 'Teacher';
    const nextText = String(payload?.text ?? '').trim().slice(0, 20_000);
    if (post.kind !== 'image' && !nextText) {
      cb?.({ ok: false, error: 'Teacher card cannot be empty' });
      return;
    }

    if (post.kind === 'image') {
      ownershipDb.prepare('UPDATE board_posts SET title = ? WHERE id = ? AND room_code = ?')
        .run(title, postId, code);
    } else {
      ownershipDb.prepare('UPDATE board_posts SET title = ?, text = ? WHERE id = ? AND room_code = ?')
        .run(title, nextText, postId, code);
    }

    io.to(roomSocketName(code)).emit('room:state', buildRoomPayload(code));
    cb?.({ ok: true, post: queries.rowToBoardPost(queries.getBoardPost(ownershipDb, postId)) });
  } catch (error) {
    console.error('Could not update teacher card', error);
    cb?.({ ok: false, error: 'Could not update teacher card' });
  }
}

function startNewClass(io, socket, cb) {
  try {
    const code = normalizeRoomCode(socket.data.roomCode);
    if (socket.data.role !== 'teacher' || code.length !== 4) {
      cb?.({ ok: false, error: 'Open the room as teacher first' });
      return;
    }

    const clearHandler = socket.listeners('teacher:clear-cards')[0];
    if (typeof clearHandler !== 'function') {
      cb?.({ ok: false, error: 'Class reset is not available' });
      return;
    }

    clearHandler({}, (ack) => {
      if (!ack?.ok) {
        cb?.(ack || { ok: false, error: 'Could not start a new class' });
        return;
      }

      io.to(roomSocketName(code)).emit('class:reset', {
        code,
        at: Date.now(),
      });

      // Give browsers a moment to clear their saved student session, then sever the
      // old student sockets so no deleted student id can keep writing into the room.
      setTimeout(() => {
        for (const client of io.sockets.sockets.values()) {
          if (
            client.data?.role === 'student' &&
            normalizeRoomCode(client.data?.roomCode) === code
          ) {
            client.disconnect(true);
          }
        }
      }, 150);

      cb?.({ ok: true });
    });
  } catch (error) {
    console.error('Could not start new class', error);
    cb?.({ ok: false, error: 'Could not start a new class' });
  }
}

// Add ownership/session-oriented socket actions without disturbing the core server.
// This follows the same preload pattern as feedbackPatch.js and richTextPatch.js.
const baseServerOn = Server.prototype.on;
Server.prototype.on = function patchedOwnershipServerOn(eventName, listener) {
  if (eventName !== 'connection') return baseServerOn.call(this, eventName, listener);

  const io = this;
  return baseServerOn.call(this, eventName, (socket) => {
    socket.on('student:qna-delete', (payload, cb) => deleteOwnQuestion(io, socket, payload, cb));
    socket.on('teacher:board-post-update', (payload, cb) => updateTeacherCard(io, socket, payload, cb));
    socket.on('teacher:start-new-class', (_payload, cb) => startNewClass(io, socket, cb));
    return listener(socket);
  });
};
