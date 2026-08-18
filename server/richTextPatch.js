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

// Inline teacher annotations are stored separately from student text. This prevents feedback
// markup from ever changing word counts, AI prompts, evidence exports or what the student typed.
richDb.exec(`
  CREATE TABLE IF NOT EXISTS teacher_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    student_id INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    quote TEXT NOT NULL,
    note TEXT NOT NULL,
    prefix_context TEXT NOT NULL DEFAULT '',
    suffix_context TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  )
`);
richDb.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_annotations_student ON teacher_annotations(student_id)`);
richDb.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_annotations_room ON teacher_annotations(room_code)`);

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
// Teacher annotations deliberately do NOT ride this payload because room:state is broadcast to
// the whole room; annotations are sent only to the teacher and the relevant student socket.
const baseRowToStudent = queries.rowToStudent;
queries.rowToStudent = (row) => {
  const student = baseRowToStudent(row);
  if (!student) return student;
  return {
    ...student,
    rich_text_html: row?.rich_text_html != null ? String(row.rich_text_html) : '',
  };
};

// The legacy clear-drafts path only knows about the plain-text column. Clear companion
// formatting and annotations too so feedback from an old piece cannot reappear on new writing.
const baseClearStudentContents = queries.clearStudentContents;
queries.clearStudentContents = (db, roomCode) => {
  const result = baseClearStudentContents(db, roomCode);
  db.prepare(`UPDATE students SET rich_text_html = '' WHERE room_code = ?`).run(roomCode);
  db.prepare(`DELETE FROM teacher_annotations WHERE room_code = ?`).run(roomCode);
  return result;
};

function normaliseRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

function annotationForClient(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    student_id: Number(row.student_id),
    start_offset: Number(row.start_offset) || 0,
    end_offset: Number(row.end_offset) || 0,
    quote: String(row.quote || ''),
    note: String(row.note || ''),
    prefix_context: String(row.prefix_context || ''),
    suffix_context: String(row.suffix_context || ''),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

const selectStudent = richDb.prepare('SELECT * FROM students WHERE id = ?');
const selectRoomFormatting = richDb.prepare('SELECT student_formatting FROM rooms WHERE code = ?');
const saveRichText = richDb.prepare('UPDATE students SET rich_text_html = ? WHERE id = ?');
const listAnnotationsForStudentStmt = richDb.prepare(
  `SELECT * FROM teacher_annotations WHERE student_id = ? ORDER BY id ASC`
);
const listAnnotationsForRoomStmt = richDb.prepare(
  `SELECT * FROM teacher_annotations WHERE room_code = ? ORDER BY student_id ASC, id ASC`
);
const selectAnnotationStmt = richDb.prepare(
  `SELECT a.*, s.room_code AS student_room_code
   FROM teacher_annotations a
   JOIN students s ON s.id = a.student_id
   WHERE a.id = ?`
);
const insertAnnotationStmt = richDb.prepare(
  `INSERT INTO teacher_annotations
   (room_code, student_id, start_offset, end_offset, quote, note, prefix_context, suffix_context)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const updateAnnotationStmt = richDb.prepare(
  `UPDATE teacher_annotations SET note = ?, updated_at = datetime('now') WHERE id = ?`
);
const deleteAnnotationStmt = richDb.prepare(`DELETE FROM teacher_annotations WHERE id = ?`);

function listAnnotationsForStudent(studentId) {
  return listAnnotationsForStudentStmt.all(Number(studentId)).map(annotationForClient);
}

function annotationsByStudent(roomCode) {
  const grouped = {};
  for (const row of listAnnotationsForRoomStmt.all(normaliseRoomCode(roomCode))) {
    const id = Number(row.student_id);
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(annotationForClient(row));
  }
  return grouped;
}

function emitAnnotationUpdate(io, roomCode, studentId) {
  const code = normaliseRoomCode(roomCode);
  const sid = Number(studentId);
  const payload = { studentId: sid, annotations: listAnnotationsForStudent(sid) };
  io.to(`teacher:${code}`).emit('teacher-annotations:update', payload);
  io.to(`student:${sid}`).emit('teacher-annotations:update', payload);
  return payload;
}

function nearestQuoteStart(text, quote, expectedStart) {
  if (!quote) return -1;
  if (text.slice(expectedStart, expectedStart + quote.length) === quote) return expectedStart;
  const matches = [];
  let cursor = 0;
  while (cursor <= text.length - quote.length) {
    const index = text.indexOf(quote, cursor);
    if (index === -1) break;
    matches.push(index);
    cursor = index + Math.max(1, quote.length);
  }
  if (!matches.length) return -1;
  matches.sort((a, b) => Math.abs(a - expectedStart) - Math.abs(b - expectedStart));
  return matches[0];
}

// Register companion listeners while leaving the proven core server/index.js paths intact.
const baseServerOn = Server.prototype.on;
Server.prototype.on = function patchedServerOn(eventName, listener) {
  if (eventName !== 'connection') return baseServerOn.call(this, eventName, listener);

  const io = this;
  return baseServerOn.call(this, eventName, (socket) => {
    // The normal iBoard listener still saves/truncates plain text exactly as before. We run
    // just after it, verify the saved text, then persist only the companion rich HTML.
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

    // Join/rejoin companions run after the core join handler has assigned socket.data.
    socket.on('teacher:join', () => {
      setImmediate(() => {
        const code = normaliseRoomCode(socket.data.roomCode);
        if (socket.data.role !== 'teacher' || code.length !== 4) return;
        socket.emit('teacher-annotations:room', { byStudent: annotationsByStudent(code) });
      });
    });

    const emitMineAfterJoin = () => {
      setImmediate(() => {
        const sid = Number(socket.data.studentId);
        if (socket.data.role !== 'student' || !sid) return;
        socket.emit('teacher-annotations:mine', {
          studentId: sid,
          annotations: listAnnotationsForStudent(sid),
        });
      });
    };
    socket.on('student:join', emitMineAfterJoin);
    socket.on('student:rejoin', emitMineAfterJoin);

    socket.on('teacher:annotations-sync', (_payload, cb) => {
      const code = normaliseRoomCode(socket.data.roomCode);
      if (socket.data.role !== 'teacher' || code.length !== 4) {
        cb?.({ ok: false });
        return;
      }
      cb?.({ ok: true, byStudent: annotationsByStudent(code) });
    });

    socket.on('student:annotations-sync', (_payload, cb) => {
      const sid = Number(socket.data.studentId);
      if (socket.data.role !== 'student' || !sid) {
        cb?.({ ok: false });
        return;
      }
      cb?.({ ok: true, studentId: sid, annotations: listAnnotationsForStudent(sid) });
    });

    socket.on('teacher:annotation-add', (payload = {}, cb) => {
      try {
        const roomCode = normaliseRoomCode(socket.data.roomCode);
        const studentId = Number(payload.studentId);
        if (socket.data.role !== 'teacher' || roomCode.length !== 4 || !studentId) {
          cb?.({ ok: false, error: 'Open the room as teacher first' });
          return;
        }
        const student = selectStudent.get(studentId);
        if (!student || normaliseRoomCode(student.room_code) !== roomCode) {
          cb?.({ ok: false, error: 'Student is no longer in this room' });
          return;
        }

        const text = String(student.text || '').replace(/\r\n?/g, '\n');
        const quote = String(payload.quote || '').replace(/\r\n?/g, '\n').trim().slice(0, 1200);
        const note = String(payload.note || '').trim().slice(0, 500);
        if (!quote || !note) {
          cb?.({ ok: false, error: 'Select some writing and add a comment' });
          return;
        }
        const requestedStart = Math.max(0, Math.min(text.length, Number(payload.start) || 0));
        const start = nearestQuoteStart(text, quote, requestedStart);
        if (start < 0) {
          cb?.({ ok: false, error: 'That passage changed before the comment was saved. Select it again.' });
          return;
        }
        const end = start + quote.length;
        const prefix = text.slice(Math.max(0, start - 48), start);
        const suffix = text.slice(end, end + 48);
        const result = insertAnnotationStmt.run(
          roomCode,
          studentId,
          start,
          end,
          quote,
          note,
          prefix,
          suffix
        );
        const update = emitAnnotationUpdate(io, roomCode, studentId);
        const annotation = update.annotations.find((item) => item.id === Number(result.lastInsertRowid)) || null;
        cb?.({ ok: true, annotation });
      } catch (error) {
        console.error('Could not add teacher annotation', error);
        cb?.({ ok: false, error: 'Could not save the inline comment' });
      }
    });

    socket.on('teacher:annotation-update', (payload = {}, cb) => {
      try {
        const roomCode = normaliseRoomCode(socket.data.roomCode);
        const annotationId = Number(payload.annotationId);
        const note = String(payload.note || '').trim().slice(0, 500);
        const row = annotationId ? selectAnnotationStmt.get(annotationId) : null;
        if (
          socket.data.role !== 'teacher' ||
          roomCode.length !== 4 ||
          !row ||
          normaliseRoomCode(row.student_room_code) !== roomCode
        ) {
          cb?.({ ok: false, error: 'Comment not found' });
          return;
        }
        if (!note) {
          cb?.({ ok: false, error: 'Comment cannot be empty' });
          return;
        }
        updateAnnotationStmt.run(note, annotationId);
        emitAnnotationUpdate(io, roomCode, row.student_id);
        cb?.({ ok: true });
      } catch (error) {
        console.error('Could not update teacher annotation', error);
        cb?.({ ok: false, error: 'Could not update the inline comment' });
      }
    });

    socket.on('teacher:annotation-delete', (payload = {}, cb) => {
      try {
        const roomCode = normaliseRoomCode(socket.data.roomCode);
        const annotationId = Number(payload.annotationId);
        const row = annotationId ? selectAnnotationStmt.get(annotationId) : null;
        if (
          socket.data.role !== 'teacher' ||
          roomCode.length !== 4 ||
          !row ||
          normaliseRoomCode(row.student_room_code) !== roomCode
        ) {
          cb?.({ ok: false, error: 'Comment not found' });
          return;
        }
        deleteAnnotationStmt.run(annotationId);
        emitAnnotationUpdate(io, roomCode, row.student_id);
        cb?.({ ok: true });
      } catch (error) {
        console.error('Could not delete teacher annotation', error);
        cb?.({ ok: false, error: 'Could not delete the inline comment' });
      }
    });

    return listener(socket);
  });
};
