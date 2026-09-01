import { Server } from 'socket.io';
import { openDatabase } from './db.js';

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

function normaliseRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

function parseSqliteUtcMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? ms : 0;
}

function feedbackForClient(row) {
  if (!row) return null;
  const createdAt = row.created_at || '';
  const at = parseSqliteUtcMs(createdAt);
  return {
    feedbackId: Number(row.id),
    studentId: Number(row.student_id),
    text: String(row.text || ''),
    createdAt,
    at: at || Date.now(),
  };
}

const selectStudent = feedbackDb.prepare(`SELECT id, room_code FROM students WHERE id = ?`);
const insertFeedback = feedbackDb.prepare(
  `INSERT INTO teacher_feedback_messages (room_code, student_id, text) VALUES (?, ?, ?)`
);
const selectFeedback = feedbackDb.prepare(`SELECT * FROM teacher_feedback_messages WHERE id = ?`);
const listStudentFeedback = feedbackDb.prepare(
  `SELECT * FROM teacher_feedback_messages WHERE student_id = ? ORDER BY id DESC LIMIT 200`
);

function feedbackHistory(studentId) {
  return listStudentFeedback
    .all(Number(studentId))
    .map(feedbackForClient)
    .reverse();
}

function emitHistoryAfterJoin(socket) {
  setImmediate(() => {
    const sid = Number(socket.data.studentId);
    if (socket.data.role !== 'student' || !sid) return;
    const items = feedbackHistory(sid);
    if (items.length) socket.emit('feedback:batch', { items, replay: true });
  });
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

      const student = selectStudent.get(studentId);
      if (!student || normaliseRoomCode(student.room_code) !== roomCode) continue;

      const result = insertFeedback.run(roomCode, studentId, text);
      const row = selectFeedback.get(Number(result.lastInsertRowid));
      const item = feedbackForClient(row);
      if (!item) continue;

      saved.push(item);
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
      cb?.({ ok: true, items: feedbackHistory(sid) });
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
