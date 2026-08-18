import { Server } from 'socket.io';
import { openDatabase, queries } from './db.js';

// Rich formatting is deliberately stored beside the existing plain-text draft.
// The existing text column remains the source of truth for word limits, AI, evidence and exports.
const richDb = openDatabase();
try {
  richDb.exec(`ALTER TABLE students ADD COLUMN rich_text_html TEXT NOT NULL DEFAULT ''`);
} catch {
  /* column already exists */
}

// All existing room payloads / join acknowledgements use queries.rowToStudent().
// Extend that one conversion point so old server code automatically carries the formatting too.
const baseRowToStudent = queries.rowToStudent;
queries.rowToStudent = (row) => {
  const student = baseRowToStudent(row);
  if (!student) return student;
  return {
    ...student,
    rich_text_html: row?.rich_text_html != null ? String(row.rich_text_html) : '',
  };
};

function normaliseRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

const selectStudent = richDb.prepare('SELECT * FROM students WHERE id = ?');
const saveRichText = richDb.prepare('UPDATE students SET rich_text_html = ? WHERE id = ?');

// Register a companion listener on each student:text event. The normal iBoard listener
// still saves/truncates the plain text exactly as before. We run just after it, verify that
// the saved plain text matches the formatting payload, then persist formatting and emit a
// second lightweight live patch so teacher/iBoard views update immediately.
const baseServerOn = Server.prototype.on;
Server.prototype.on = function patchedServerOn(eventName, listener) {
  if (eventName !== 'connection') return baseServerOn.call(this, eventName, listener);

  const io = this;
  return baseServerOn.call(this, eventName, (socket) => {
    socket.on('student:text', (payload = {}) => {
      const plainText = String(payload?.text ?? '');
      let richTextHtml = String(payload?.richTextHtml ?? '');
      if (richTextHtml.length > 100_000) richTextHtml = richTextHtml.slice(0, 100_000);

      setImmediate(() => {
        try {
          const studentId = Number(socket.data.studentId);
          const roomCode = normaliseRoomCode(socket.data.roomCode);
          if (socket.data.role !== 'student' || !studentId || roomCode.length !== 4) return;

          const current = selectStudent.get(studentId);
          if (!current || normaliseRoomCode(current.room_code) !== roomCode) return;

          // If the existing server hard-limit shortened the plain draft, formatting no
          // longer lines up exactly. Drop formatting rather than display the wrong marks.
          const safeRich = String(current.text || '') === plainText ? richTextHtml : '';
          saveRichText.run(safeRich, studentId);

          const updated = selectStudent.get(studentId);
          const student = queries.rowToStudent(updated);
          io.to(`room:${roomCode}`).emit('student:live', { student });
        } catch (error) {
          console.error('Could not persist student rich text', error);
        }
      });
    });

    return listener(socket);
  });
};
