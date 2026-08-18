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
try {
  // Default ON preserves the behaviour introduced by the rich-text upgrade.
  // Teachers can switch it off per room from the teacher console.
  richDb.exec(`ALTER TABLE rooms ADD COLUMN student_formatting INTEGER NOT NULL DEFAULT 1`);
} catch {
  /* column already exists */
}

// All existing room payloads use queries.rowToRoom(). Extend that conversion point so
// every teacher/student room:state message carries the capability flag.
const baseRowToRoom = queries.rowToRoom;
queries.rowToRoom = (row) => {
  const room = baseRowToRoom(row);
  if (!room) return room;
  return {
    ...room,
    student_formatting: row?.student_formatting == null ? true : !!row.student_formatting,
  };
};

// Keep the setting in the rooms table without disturbing the existing settings pipeline.
const baseUpdateRoomSettings = queries.updateRoomSettings;
queries.updateRoomSettings = (db, code, settings) => {
  const hasFormattingSetting =
    settings &&
    typeof settings === 'object' &&
    Object.prototype.hasOwnProperty.call(settings, 'student_formatting');

  const row = baseUpdateRoomSettings(db, code, settings);
  if (!hasFormattingSetting) return row;

  const enabled = settings.student_formatting !== false;
  db.prepare(`UPDATE rooms SET student_formatting = ? WHERE code = ?`).run(enabled ? 1 : 0, code);
  if (!enabled) {
    // Switching the capability off also removes existing styling so it cannot reappear
    // if the teacher later turns formatting back on.
    db.prepare(`UPDATE students SET rich_text_html = '' WHERE room_code = ?`).run(code);
  }
  return db.prepare(`SELECT * FROM rooms WHERE code = ?`).get(code);
};

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

// The legacy clear-drafts path only knows about the plain-text column. Clear the companion
// formatting column at the same time so an old formatted draft can never reappear client-side.
const baseClearStudentContents = queries.clearStudentContents;
queries.clearStudentContents = (db, roomCode) => {
  const result = baseClearStudentContents(db, roomCode);
  db.prepare(`UPDATE students SET rich_text_html = '' WHERE room_code = ?`).run(roomCode);
  return result;
};

function normaliseRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

const selectStudent = richDb.prepare('SELECT * FROM students WHERE id = ?');
const selectRoomFormatting = richDb.prepare('SELECT student_formatting FROM rooms WHERE code = ?');
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

          const roomFormatting = selectRoomFormatting.get(roomCode);
          const formattingAllowed = roomFormatting?.student_formatting !== 0;

          // If the existing server hard-limit shortened the plain draft, formatting no
          // longer lines up exactly. Drop formatting rather than display the wrong marks.
          // Formatting is also rejected server-side whenever the teacher has disabled it.
          const safeRich =
            formattingAllowed && String(current.text || '') === plainText ? richTextHtml : '';
          if (String(current.rich_text_html || '') === safeRich) return;

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
