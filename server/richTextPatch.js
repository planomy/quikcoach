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
  // Formatting is always available to students.
  richDb.exec(`ALTER TABLE rooms ADD COLUMN student_formatting INTEGER NOT NULL DEFAULT 1`);
} catch {
  /* column already exists */
}
// Retire the old per-room switch without leaving previously disabled rooms stuck off.
richDb.exec(`UPDATE rooms SET student_formatting = 1 WHERE student_formatting != 1`);

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
    status TEXT NOT NULL DEFAULT 'open',
    student_fixed_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  )
`);
richDb.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_annotations_student ON teacher_annotations(student_id)`);
richDb.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_annotations_room ON teacher_annotations(room_code)`);
for (const sql of [
  `ALTER TABLE teacher_annotations ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`,
  `ALTER TABLE teacher_annotations ADD COLUMN student_fixed_at TEXT`,
  `ALTER TABLE teacher_annotations ADD COLUMN resolved_at TEXT`,
]) {
  try { richDb.exec(sql); } catch { /* column already exists */ }
}

// Keep the legacy field in room payloads for backwards compatibility, but formatting
// is now permanently available rather than a teacher-controlled room capability.
const baseRowToRoom = queries.rowToRoom;
queries.rowToRoom = (row) => {
  const room = baseRowToRoom(row);
  if (!room) return room;
  return {
    ...room,
    student_formatting: true,
  };
};

// Older open clients may still send this retired setting. Keep the database pinned on
// so a stale teacher tab cannot disable formatting for students.
const baseUpdateRoomSettings = queries.updateRoomSettings;
queries.updateRoomSettings = (db, code, settings) => {
  const hasFormattingSetting =
    settings &&
    typeof settings === 'object' &&
    Object.prototype.hasOwnProperty.call(settings, 'student_formatting');

  const row = baseUpdateRoomSettings(db, code, settings);
  if (!hasFormattingSetting) return row;

  db.prepare(`UPDATE rooms SET student_formatting = 1 WHERE code = ?`).run(code);
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
    status: ['open', 'fixed', 'resolved'].includes(String(row.status)) ? String(row.status) : 'open',
    student_fixed_at: row.student_fixed_at || '',
    resolved_at: row.resolved_at || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

const selectStudent = richDb.prepare('SELECT * FROM students WHERE id = ?');
const saveRichText = richDb.prepare('UPDATE students SET rich_text_html = ? WHERE id = ?');
const listAnnotationsForStudentStmt = richDb.prepare(
  `SELECT * FROM teacher_annotations
   WHERE student_id = ? AND status != 'resolved'
   ORDER BY id ASC`
);
const listAnnotationsForRoomStmt = richDb.prepare(
  `SELECT * FROM teacher_annotations
   WHERE room_code = ? AND status != 'resolved'
   ORDER BY student_id ASC, id ASC`
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
const markAnnotationFixedStmt = richDb.prepare(
  `UPDATE teacher_annotations
   SET status = 'fixed', student_fixed_at = datetime('now'), resolved_at = NULL,
       updated_at = datetime('now')
   WHERE id = ?`
);
const resolveAnnotationStmt = richDb.prepare(
  `UPDATE teacher_annotations
   SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
   WHERE id = ?`
);
const reopenAnnotationStmt = richDb.prepare(
  `UPDATE teacher_annotations
   SET status = 'open', resolved_at = NULL, updated_at = datetime('now')
   WHERE id = ?`
);
const deleteAnnotationStmt = richDb.prepare(`DELETE FROM teacher_annotations WHERE id = ?`);
const bulkResolveFixedForRoomStmt = richDb.prepare(
  `UPDATE teacher_annotations
   SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
   WHERE room_code = ? AND status = 'fixed'`
);
const bulkResolveFixedForStudentStmt = richDb.prepare(
  `UPDATE teacher_annotations
   SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
   WHERE room_code = ? AND student_id = ? AND status = 'fixed'`
);

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

          // If the existing server hard-limit shortened the plain draft, formatting no
          // longer lines up exactly. Drop formatting rather than display the wrong marks.
          const safeRich = String(current.text || '') === plainText ? richTextHtml : '';
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

    socket.on('student:annotation-fixed', (payload = {}, cb) => {
      try {
        const studentId = Number(socket.data.studentId);
        const annotationId = Number(payload.annotationId);
        const row = annotationId ? selectAnnotationStmt.get(annotationId) : null;
        if (
          socket.data.role !== 'student' ||
          !studentId ||
          !row ||
          Number(row.student_id) !== studentId ||
          row.status === 'resolved'
        ) {
          cb?.({ ok: false, error: 'Comment not found' });
          return;
        }
        markAnnotationFixedStmt.run(annotationId);
        emitAnnotationUpdate(io, row.student_room_code, studentId);
        cb?.({ ok: true });
      } catch (error) {
        console.error('Could not mark annotation fixed', error);
        cb?.({ ok: false, error: 'Could not mark this comment as fixed' });
      }
    });

    socket.on('teacher:annotation-status', (payload = {}, cb) => {
      try {
        const roomCode = normaliseRoomCode(socket.data.roomCode);
        const annotationId = Number(payload.annotationId);
        const action = String(payload.action || '');
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
        if (action === 'confirm') resolveAnnotationStmt.run(annotationId);
        else if (action === 'reopen') reopenAnnotationStmt.run(annotationId);
        else {
          cb?.({ ok: false, error: 'Choose confirm or reopen' });
          return;
        }
        emitAnnotationUpdate(io, roomCode, row.student_id);
        cb?.({ ok: true });
      } catch (error) {
        console.error('Could not update annotation status', error);
        cb?.({ ok: false, error: 'Could not update the comment status' });
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

    socket.on('teacher:annotation-bulk-confirm', (payload = {}, cb) => {
      try {
        const roomCode = normaliseRoomCode(socket.data.roomCode);
        if (socket.data.role !== 'teacher' || roomCode.length !== 4) {
          cb?.({ ok: false, error: 'Open the room as teacher first' });
          return;
        }
        const studentId = Number(payload.studentId);
        let result;
        if (studentId > 0) {
          const student = selectStudent.get(studentId);
          if (!student || normaliseRoomCode(student.room_code) !== roomCode) {
            cb?.({ ok: false, error: 'Student not found' });
            return;
          }
          result = bulkResolveFixedForStudentStmt.run(roomCode, studentId);
          emitAnnotationUpdate(io, roomCode, studentId);
        } else {
          const studentRows = richDb
            .prepare(
              `SELECT DISTINCT student_id FROM teacher_annotations WHERE room_code = ? AND status = 'fixed'`
            )
            .all(roomCode);
          result = bulkResolveFixedForRoomStmt.run(roomCode);
          for (const row of studentRows) emitAnnotationUpdate(io, roomCode, row.student_id);
        }
        cb?.({ ok: true, count: Number(result?.changes) || 0 });
      } catch (error) {
        console.error('Could not bulk confirm teacher annotations', error);
        cb?.({ ok: false, error: 'Could not clear fixed comments' });
      }
    });

    return listener(socket);
  });
};
