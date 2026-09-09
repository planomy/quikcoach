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

function feedbackForClient(row) {
  if (!row) return null;
  const createdAt = row.created_at || '';
  const at = parseSqliteUtcMs(createdAt);
  const kind = String(row.kind || 'note') === 'set-prompt' ? 'set-prompt' : 'note';
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
  if (kind === 'note' && meta.urgent) item.urgent = true;
  if (row.seen_at) {
    item.seenAt = row.seen_at;
    item.seenAtMs = parseSqliteUtcMs(row.seen_at) || undefined;
  }
  return item;
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

      const kind = String(raw?.kind || '') === 'set-prompt' ? 'set-prompt' : 'note';
      const setMeta = kind === 'set-prompt' ? sanitizeSetPromptMeta(raw) : null;
      const urgent = kind === 'note' && !!raw?.urgent;
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
