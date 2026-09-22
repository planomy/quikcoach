import { Server } from 'socket.io';
import { openDatabase } from './db.js';
import { recordTrailFeedback } from './draftTrail.js';

const feedbackDb = openDatabase();

feedbackDb.exec(`
  CREATE TABLE IF NOT EXISTS teacher_feedback_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    student_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  )
`);
feedbackDb.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_feedback_student ON teacher_feedback_messages(student_id)`);
feedbackDb.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_feedback_room ON teacher_feedback_messages(room_code)`);
for (const sql of [
  `ALTER TABLE teacher_feedback_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'note'`,
  `ALTER TABLE teacher_feedback_messages ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE teacher_feedback_messages ADD COLUMN seen_at TEXT`,
]) {
  try {
    feedbackDb.exec(sql);
  } catch {
    /* column already exists */
  }
}

feedbackDb.exec(`
  CREATE TABLE IF NOT EXISTS student_note_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    student_id INTEGER NOT NULL,
    feedback_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    teacher_seen_at TEXT,
    FOREIGN KEY (feedback_id) REFERENCES teacher_feedback_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  )
`);
feedbackDb.exec(
  `CREATE INDEX IF NOT EXISTS idx_student_note_replies_room_unseen
   ON student_note_replies(room_code, teacher_seen_at)`
);
feedbackDb.exec(
  `CREATE INDEX IF NOT EXISTS idx_student_note_replies_feedback
   ON student_note_replies(feedback_id)`
);

feedbackDb.exec(`
  CREATE TABLE IF NOT EXISTS student_chat_outbound (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    student_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    teacher_seen_at TEXT,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  )
`);
feedbackDb.exec(
  `CREATE INDEX IF NOT EXISTS idx_student_chat_outbound_student
   ON student_chat_outbound(student_id, room_code)`
);

function normaliseRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

function teacherSocketName(code) {
  return `teacher:${normaliseRoomCode(code)}`;
}

function parseSqliteUtcMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? ms : 0;
}

function parseMetaJson(raw) {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeSetPromptMeta(raw) {
  const title = String(raw?.title || '').trim().slice(0, 120);
  const questions = Array.isArray(raw?.questions)
    ? raw.questions
        .map((question, index) => {
          const prompt = String(question?.prompt || '').trim().slice(0, 500);
          if (!prompt) return null;
          const helper = String(question?.helper || '').trim().slice(0, 240);
          return {
            id: String(question?.id || `q${index + 1}`).slice(0, 40),
            prompt,
            ...(helper ? { helper } : {}),
          };
        })
        .filter(Boolean)
        .slice(0, 60)
    : [];
  if (!title && !questions.length) return null;
  return {
    title: title || 'Prompt set',
    questions,
  };
}

function feedbackKind(raw) {
  const value = String(raw?.kind || raw?.channel || '').toLowerCase();
  if (value === 'set-prompt') return 'set-prompt';
  if (value === 'chat') return 'chat';
  return 'note';
}

function isChatKind(kind) {
  return String(kind || '') === 'chat';
}

function feedbackForClient(row) {
  if (!row) return null;
  const createdAt = row.created_at || '';
  const at = parseSqliteUtcMs(createdAt);
  const kind = feedbackKind(row);
  const meta = parseMetaJson(row.meta_json);
  const item = {
    feedbackId: Number(row.id),
    studentId: Number(row.student_id),
    text: String(row.text || ''),
    kind,
    createdAt,
    at: at || Date.now(),
  };
  if (kind === 'set-prompt') {
    item.title = String(meta.title || '').trim().slice(0, 120) || 'Prompt set';
    item.questions = Array.isArray(meta.questions) ? meta.questions : [];
  }
  if ((kind === 'note' || kind === 'chat') && meta.urgent) item.urgent = true;
  if (row.seen_at) {
    item.seenAt = row.seen_at;
    item.seenAtMs = parseSqliteUtcMs(row.seen_at) || undefined;
  }
  return item;
}

function noteReplyForClient(row) {
  if (!row) return null;
  const createdAt = row.created_at || '';
  const at = parseSqliteUtcMs(createdAt);
  return {
    replyId: Number(row.id),
    feedbackId: Number(row.feedback_id),
    studentId: Number(row.student_id),
    studentName: String(row.student_name || '').trim().slice(0, 80),
    text: String(row.text || ''),
    parentText: String(row.parent_text || '').trim().slice(0, 160),
    createdAt,
    at: at || Date.now(),
    teacherSeenAt: row.teacher_seen_at || null,
  };
}

function listUnreadNoteReplies(roomCode) {
  const code = normaliseRoomCode(roomCode);
  const replies = feedbackDb
    .prepare(
      `SELECT r.*, s.name AS student_name, f.text AS parent_text
       FROM student_note_replies r
       JOIN students s ON s.id = r.student_id
       JOIN teacher_feedback_messages f ON f.id = r.feedback_id
       WHERE r.room_code = ? AND r.teacher_seen_at IS NULL
       ORDER BY r.id ASC
       LIMIT 200`
    )
    .all(code)
    .map(noteReplyForClient)
    .filter(Boolean);
  const outbound = feedbackDb
    .prepare(
      `SELECT o.*, s.name AS student_name
       FROM student_chat_outbound o
       JOIN students s ON s.id = o.student_id
       WHERE o.room_code = ? AND o.teacher_seen_at IS NULL
       ORDER BY o.id ASC
       LIMIT 200`
    )
    .all(code)
    .map((row) => ({
      replyId: 0,
      outboundId: Number(row.id),
      feedbackId: 0,
      studentId: Number(row.student_id),
      studentName: String(row.student_name || '').trim().slice(0, 80),
      text: String(row.text || ''),
      parentText: '',
      createdAt: row.created_at || '',
      at: parseSqliteUtcMs(row.created_at) || Date.now(),
      teacherSeenAt: row.teacher_seen_at || null,
    }));
  return [...replies, ...outbound];
}

function chatMessageFromTeacherNote(item) {
  if (!item) return null;
  return {
    id: `teacher-${item.feedbackId}`,
    from: 'teacher',
    text: item.text,
    at: item.at,
    createdAt: item.createdAt,
    urgent: !!item.urgent,
    studentId: item.studentId,
    feedbackId: item.feedbackId,
  };
}

function chatMessageFromStudentReply(item) {
  if (!item) return null;
  return {
    id: item.replyId ? `student-reply-${item.replyId}` : `student-out-${item.outboundId || item.at}`,
    from: 'student',
    text: item.text,
    at: item.at,
    createdAt: item.createdAt,
    studentId: item.studentId,
    replyId: item.replyId || undefined,
    outboundId: item.outboundId || undefined,
  };
}

function conversationForStudent(roomCode, studentId) {
  const code = normaliseRoomCode(roomCode);
  const sid = Number(studentId);
  if (code.length !== 4 || !sid) return [];

  const notes = feedbackDb
    .prepare(
      `SELECT * FROM teacher_feedback_messages
       WHERE room_code = ? AND student_id = ? AND kind = 'chat'
       ORDER BY id ASC`
    )
    .all(code, sid)
    .map(feedbackForClient)
    .map(chatMessageFromTeacherNote)
    .filter(Boolean);

  const replies = feedbackDb
    .prepare(
      `SELECT r.*, s.name AS student_name, f.text AS parent_text
       FROM student_note_replies r
       JOIN students s ON s.id = r.student_id
       JOIN teacher_feedback_messages f ON f.id = r.feedback_id
       WHERE r.room_code = ? AND r.student_id = ? AND f.kind = 'chat'
       ORDER BY r.id ASC`
    )
    .all(code, sid)
    .map(noteReplyForClient)
    .map(chatMessageFromStudentReply)
    .filter(Boolean);

  const outbound = feedbackDb
    .prepare(
      `SELECT * FROM student_chat_outbound
       WHERE room_code = ? AND student_id = ?
       ORDER BY id ASC`
    )
    .all(code, sid)
    .map((row) => ({
      id: `student-out-${row.id}`,
      from: 'student',
      text: String(row.text || ''),
      at: parseSqliteUtcMs(row.created_at) || Date.now(),
      createdAt: row.created_at,
      studentId: Number(row.student_id),
      outboundId: Number(row.id),
    }));

  return [...notes, ...replies, ...outbound].sort(
    (a, b) => Number(a.at || 0) - Number(b.at || 0) || String(a.id).localeCompare(String(b.id))
  );
}

function emitChat(io, roomCode, studentId, message) {
  if (!message) return;
  const payload = { studentId: Number(studentId) || Number(message.studentId) || 0, message };
  io.to(teacherSocketName(roomCode)).emit('feedback:chat', payload);
  if (payload.studentId) io.to(`student:${payload.studentId}`).emit('feedback:chat', payload);
}

function emitUnreadNoteReplies(io, socket) {
  setImmediate(() => {
    const roomCode = normaliseRoomCode(socket.data.roomCode);
    if (socket.data.role !== 'teacher' || roomCode.length !== 4) return;
    try {
      const items = listUnreadNoteReplies(roomCode);
      if (items.length) socket.emit('feedback:note-reply-batch', { items, replay: true });
    } catch (error) {
      console.error('Could not sync note replies', error);
    }
  });
}

// Prepare statements at the moment they are used rather than keeping long-lived
// StatementSync objects across the other preload modules' database migrations.
// Node's built-in sqlite can invalidate those older prepared statements after schema
// work on another connection, which previously crashed joins with ERR_INVALID_STATE.
function feedbackHistory(studentId) {
  return feedbackDb
    .prepare(`SELECT * FROM teacher_feedback_messages WHERE student_id = ? ORDER BY id DESC LIMIT 200`)
    .all(Number(studentId))
    .map(feedbackForClient)
    .reverse();
}

function emitHistoryAfterJoin(socket) {
  setImmediate(() => {
    const sid = Number(socket.data.studentId);
    if (socket.data.role !== 'student' || !sid) return;
    try {
      const items = feedbackHistory(sid);
      if (items.length) socket.emit('feedback:batch', { items, replay: true });
    } catch (error) {
      // Feedback replay should never be able to take down an otherwise valid join.
      console.error('Could not replay teacher feedback', error);
    }
  });
}

function markFeedbackSeen(io, socket, payload = {}, cb) {
  try {
    const sid = Number(socket.data.studentId);
    const roomCode = normaliseRoomCode(socket.data.roomCode);
    const feedbackId = Number(payload?.feedbackId);
    if (socket.data.role !== 'student' || !sid || roomCode.length !== 4 || !feedbackId) {
      cb?.({ ok: false });
      return;
    }

    const row = feedbackDb
      .prepare(
        `SELECT * FROM teacher_feedback_messages WHERE id = ? AND student_id = ? AND room_code = ?`
      )
      .get(feedbackId, sid, roomCode);
    if (!row) {
      cb?.({ ok: false, error: 'Note not found' });
      return;
    }

    if (!row.seen_at) {
      feedbackDb
        .prepare(`UPDATE teacher_feedback_messages SET seen_at = datetime('now') WHERE id = ?`)
        .run(feedbackId);
    }
    const updated = feedbackDb
      .prepare(`SELECT * FROM teacher_feedback_messages WHERE id = ?`)
      .get(feedbackId);
    const item = feedbackForClient(updated);
    io.to(teacherSocketName(roomCode)).emit('feedback:seen', {
      feedbackId: item.feedbackId,
      studentId: item.studentId,
      seenAt: item.seenAt,
      seenAtMs: item.seenAtMs,
    });
    cb?.({ ok: true, item });
  } catch (error) {
    console.error('Could not mark teacher feedback seen', error);
    cb?.({ ok: false, error: 'Could not acknowledge note' });
  }
}

function saveStudentNoteReply(io, socket, payload = {}, cb) {
  try {
    const roomCode = normaliseRoomCode(socket.data.roomCode);
    const studentId = Number(socket.data.studentId);
    const feedbackId = Number(payload?.feedbackId);
    const text = String(payload?.text || '').trim().slice(0, 2000);
    if (socket.data.role !== 'student' || roomCode.length !== 4 || !studentId) {
      cb?.({ ok: false, error: 'Join the room as a student first' });
      return;
    }
    if (!feedbackId || !text) {
      cb?.({ ok: false, error: 'Write a short reply first' });
      return;
    }

    const parent = feedbackDb
      .prepare(
        `SELECT * FROM teacher_feedback_messages
         WHERE id = ? AND student_id = ? AND room_code = ?`
      )
      .get(feedbackId, studentId, roomCode);
    if (!parent || String(parent.kind || 'note') === 'set-prompt') {
      cb?.({ ok: false, error: 'That note is no longer available' });
      return;
    }

    const result = feedbackDb
      .prepare(
        `INSERT INTO student_note_replies (room_code, student_id, feedback_id, text)
         VALUES (?, ?, ?, ?)`
      )
      .run(roomCode, studentId, feedbackId, text);

    // Replying implies the student has opened the note.
    if (!parent.seen_at) {
      feedbackDb
        .prepare(
          `UPDATE teacher_feedback_messages
           SET seen_at = datetime('now')
           WHERE id = ? AND seen_at IS NULL`
        )
        .run(feedbackId);
      const updated = feedbackDb
        .prepare(`SELECT * FROM teacher_feedback_messages WHERE id = ?`)
        .get(feedbackId);
      const seenItem = feedbackForClient(updated);
      if (seenItem) {
        io.to(teacherSocketName(roomCode)).emit('feedback:seen', {
          feedbackId: seenItem.feedbackId,
          studentId: seenItem.studentId,
          seenAt: seenItem.seenAt,
          seenAtMs: seenItem.seenAtMs,
        });
      }
    }

    const row = feedbackDb
      .prepare(
        `SELECT r.*, s.name AS student_name, f.text AS parent_text
         FROM student_note_replies r
         JOIN students s ON s.id = r.student_id
         JOIN teacher_feedback_messages f ON f.id = r.feedback_id
         WHERE r.id = ?`
      )
      .get(Number(result.lastInsertRowid));
    const item = noteReplyForClient(row);
    if (!item) {
      cb?.({ ok: false, error: 'Could not save reply' });
      return;
    }

    io.to(teacherSocketName(roomCode)).emit('feedback:note-reply', { item });
    const message = isChatKind(parent.kind) ? chatMessageFromStudentReply(item) : null;
    if (message) emitChat(io, roomCode, studentId, message);
    cb?.({ ok: true, item, message });
  } catch (error) {
    console.error('Could not save student note reply', error);
    cb?.({ ok: false, error: 'Could not send reply' });
  }
}

function markNoteReplySeen(io, socket, payload = {}, cb) {
  try {
    const roomCode = normaliseRoomCode(socket.data.roomCode);
    if (socket.data.role !== 'teacher' || roomCode.length !== 4) {
      cb?.({ ok: false, error: 'Open the room as teacher first' });
      return;
    }
    const replyId = Number(payload?.replyId);
    const studentId = Number(payload?.studentId);
    if (replyId) {
      feedbackDb
        .prepare(
          `UPDATE student_note_replies
           SET teacher_seen_at = datetime('now')
           WHERE id = ? AND room_code = ? AND teacher_seen_at IS NULL`
        )
        .run(replyId, roomCode);
    } else if (studentId) {
      feedbackDb
        .prepare(
          `UPDATE student_note_replies
           SET teacher_seen_at = datetime('now')
           WHERE student_id = ? AND room_code = ? AND teacher_seen_at IS NULL`
        )
        .run(studentId, roomCode);
      feedbackDb
        .prepare(
          `UPDATE student_chat_outbound
           SET teacher_seen_at = datetime('now')
           WHERE student_id = ? AND room_code = ? AND teacher_seen_at IS NULL`
        )
        .run(studentId, roomCode);
    } else {
      cb?.({ ok: false, error: 'Missing reply' });
      return;
    }
    cb?.({ ok: true });
  } catch (error) {
    console.error('Could not mark note reply seen', error);
    cb?.({ ok: false, error: 'Could not acknowledge reply' });
  }
}

function deliverFeedback(io, socket, payload = {}, cb) {
  try {
    const roomCode = normaliseRoomCode(socket.data.roomCode);
    if (socket.data.role !== 'teacher' || roomCode.length !== 4) {
      cb?.({ ok: false, error: 'Open the room as teacher first' });
      return;
    }

    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const saved = [];
    const reachedStudents = new Set();

    for (const raw of rawItems.slice(0, 100)) {
      const studentId = Number(raw?.studentId);
      const text = String(raw?.text || '').trim().slice(0, 5000);
      if (!studentId || !text) continue;

      const student = feedbackDb
        .prepare(`SELECT id, room_code, name, text FROM students WHERE id = ?`)
        .get(studentId);
      if (!student || normaliseRoomCode(student.room_code) !== roomCode) continue;

      const kind = feedbackKind(raw);
      const setMeta = kind === 'set-prompt' ? sanitizeSetPromptMeta(raw) : null;
      const urgent = (kind === 'note' || kind === 'chat') && !!raw?.urgent;
      const metaJson = setMeta
        ? JSON.stringify(setMeta)
        : JSON.stringify(urgent ? { urgent: true } : {});

      const result = feedbackDb
        .prepare(
          `INSERT INTO teacher_feedback_messages (room_code, student_id, text, kind, meta_json) VALUES (?, ?, ?, ?, ?)`
        )
        .run(roomCode, studentId, text, kind, metaJson);
      const row = feedbackDb
        .prepare(`SELECT * FROM teacher_feedback_messages WHERE id = ?`)
        .get(Number(result.lastInsertRowid));
      const item = feedbackForClient(row);
      if (!item) continue;

      saved.push(item);
      recordTrailFeedback(roomCode, student, text);
      const targetRoom = `student:${studentId}`;
      const targetCount = io.sockets.adapter.rooms.get(targetRoom)?.size || 0;
      if (targetCount > 0) reachedStudents.add(studentId);
      io.to(targetRoom).emit('feedback:batch', { items: [item] });
      if (isChatKind(kind)) emitChat(io, roomCode, studentId, chatMessageFromTeacherNote(item));
    }

    if (rawItems.length > 0 && saved.length === 0) {
      cb?.({ ok: false, error: 'No matching students were available for that feedback' });
      return;
    }

    cb?.({
      ok: true,
      count: saved.length,
      requested: rawItems.length,
      reached: reachedStudents.size,
      persisted: saved.length,
      items: saved.map((item) => ({
        feedbackId: item.feedbackId,
        studentId: item.studentId,
        urgent: !!item.urgent,
      })),
    });
  } catch (error) {
    console.error('Could not deliver teacher feedback', error);
    cb?.({ ok: false, error: 'Could not send feedback' });
  }
}

// This preload runs after richTextPatch.js. It wraps only the core teacher:distribute
// registration so notes/feedback are durable and sent to the intended student socket only.
const baseServerOn = Server.prototype.on;
Server.prototype.on = function patchedFeedbackServerOn(eventName, listener) {
  if (eventName !== 'connection') return baseServerOn.call(this, eventName, listener);

  const io = this;
  return baseServerOn.call(this, eventName, (socket) => {
    socket.on('student:join', () => emitHistoryAfterJoin(socket));
    socket.on('student:rejoin', () => emitHistoryAfterJoin(socket));
    socket.on('teacher:join', () => emitUnreadNoteReplies(io, socket));
    socket.on('teacher:rejoin', () => emitUnreadNoteReplies(io, socket));

    socket.on('student:feedback-sync', (_payload, cb) => {
      const sid = Number(socket.data.studentId);
      if (socket.data.role !== 'student' || !sid) {
        cb?.({ ok: false });
        return;
      }
      try {
        cb?.({ ok: true, items: feedbackHistory(sid) });
      } catch (error) {
        console.error('Could not sync teacher feedback', error);
        cb?.({ ok: false, error: 'Could not load feedback' });
      }
    });

    socket.on('student:feedback-seen', (payload, cb) => markFeedbackSeen(io, socket, payload, cb));
    socket.on('student:note-reply', (payload, cb) => saveStudentNoteReply(io, socket, payload, cb));
    socket.on('teacher:note-replies-sync', (_payload, cb) => {
      const roomCode = normaliseRoomCode(socket.data.roomCode);
      if (socket.data.role !== 'teacher' || roomCode.length !== 4) {
        cb?.({ ok: false });
        return;
      }
      try {
        const items = listUnreadNoteReplies(roomCode);
        cb?.({ ok: true, items });
        if (items.length) socket.emit('feedback:note-reply-batch', { items, replay: true });
      } catch (error) {
        console.error('Could not sync note replies', error);
        cb?.({ ok: false, error: 'Could not load replies' });
      }
    });
    socket.on('teacher:note-reply-seen', (payload, cb) => markNoteReplySeen(io, socket, payload, cb));
    socket.on('teacher:chat-sync', (payload, cb) => {
      const roomCode = normaliseRoomCode(socket.data.roomCode);
      const studentId = Number(payload?.studentId);
      if (socket.data.role !== 'teacher' || roomCode.length !== 4 || !studentId) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      try {
        markNoteReplySeen(io, socket, { studentId });
        cb?.({ ok: true, items: conversationForStudent(roomCode, studentId) });
      } catch (error) {
        console.error('Could not load teacher chat', error);
        cb?.({ ok: false, error: 'Could not load conversation' });
      }
    });
    socket.on('student:chat-sync', (_payload, cb) => {
      const roomCode = normaliseRoomCode(socket.data.roomCode);
      const studentId = Number(socket.data.studentId);
      if (socket.data.role !== 'student' || roomCode.length !== 4 || !studentId) {
        cb?.({ ok: false, error: 'Join the room as a student first' });
        return;
      }
      try {
        const unseen = feedbackDb
          .prepare(
            `SELECT id FROM teacher_feedback_messages
             WHERE student_id = ? AND room_code = ? AND kind = 'chat' AND seen_at IS NULL`
          )
          .all(studentId, roomCode);
        if (unseen.length) {
          feedbackDb
            .prepare(
              `UPDATE teacher_feedback_messages
               SET seen_at = datetime('now')
               WHERE student_id = ? AND room_code = ? AND kind = 'chat' AND seen_at IS NULL`
            )
            .run(studentId, roomCode);
          const seenAt = new Date().toISOString();
          for (const row of unseen.slice(0, 80)) {
            io.to(teacherSocketName(roomCode)).emit('feedback:seen', {
              feedbackId: Number(row.id),
              studentId,
              seenAt,
            });
          }
        }
        cb?.({ ok: true, items: conversationForStudent(roomCode, studentId) });
      } catch (error) {
        console.error('Could not load student chat', error);
        cb?.({ ok: false, error: 'Could not load conversation' });
      }
    });
    socket.on('student:chat-send', (payload, cb) => {
      const roomCode = normaliseRoomCode(socket.data.roomCode);
      const studentId = Number(socket.data.studentId);
      const text = String(payload?.text || '').trim().slice(0, 2000);
      if (socket.data.role !== 'student' || roomCode.length !== 4 || !studentId) {
        cb?.({ ok: false, error: 'Join the room as a student first' });
        return;
      }
      if (!text) {
        cb?.({ ok: false, error: 'Write a message first' });
        return;
      }
      try {
        const latestNote = feedbackDb
          .prepare(
            `SELECT id FROM teacher_feedback_messages
             WHERE student_id = ? AND room_code = ? AND kind = 'chat'
             ORDER BY id DESC LIMIT 1`
          )
          .get(studentId, roomCode);
        if (latestNote?.id) {
          saveStudentNoteReply(io, socket, { feedbackId: latestNote.id, text }, cb);
          return;
        }
        const result = feedbackDb
          .prepare(
            `INSERT INTO student_chat_outbound (room_code, student_id, text) VALUES (?, ?, ?)`
          )
          .run(roomCode, studentId, text);
        const row = feedbackDb
          .prepare(
            `SELECT o.*, s.name AS student_name
             FROM student_chat_outbound o
             JOIN students s ON s.id = o.student_id
             WHERE o.id = ?`
          )
          .get(Number(result.lastInsertRowid));
        const item = {
          replyId: 0,
          outboundId: Number(row.id),
          feedbackId: 0,
          studentId,
          studentName: String(row.student_name || '').trim().slice(0, 80),
          text: String(row.text || ''),
          parentText: '',
          createdAt: row.created_at || '',
          at: parseSqliteUtcMs(row.created_at) || Date.now(),
          teacherSeenAt: null,
        };
        const message = chatMessageFromStudentReply(item);
        io.to(teacherSocketName(roomCode)).emit('feedback:note-reply', { item });
        emitChat(io, roomCode, studentId, message);
        cb?.({ ok: true, item, message });
      } catch (error) {
        console.error('Could not send student chat', error);
        cb?.({ ok: false, error: 'Could not send' });
      }
    });

    const originalSocketOn = socket.on;
    socket.on = function interceptCoreHandler(name, handler) {
      if (name === 'teacher:distribute') {
        return originalSocketOn.call(this, name, (payload, cb) => deliverFeedback(io, this, payload, cb));
      }
      return originalSocketOn.call(this, name, handler);
    };

    try {
      return listener(socket);
    } finally {
      socket.on = originalSocketOn;
    }
  });
};
