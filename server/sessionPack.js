/**
 * Teacher-owned session packs (.iboard).
 * Live classroom state is ephemeral on the server; teachers download/reopen deliberately.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { queries } from './db.js';

const FORMAT = 'iboard';
const VERSION = 1;
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

function normalizeRoomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

function mimeFromFilename(filename) {
  const ext = String(filename || '')
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

function extFromMime(mime, fallback = 'bin') {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  return fallback;
}

function readMediaFile(dir, filename) {
  const base = path.basename(String(filename || ''));
  if (!base || !/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  const fp = path.join(dir, base);
  if (!fp.startsWith(dir + path.sep) && fp !== dir) return null;
  if (!fs.existsSync(fp)) return null;
  try {
    const buf = fs.readFileSync(fp);
    if (!buf.length || buf.length > MAX_MEDIA_BYTES) return null;
    return {
      filename: base,
      mime: mimeFromFilename(base),
      base64: buf.toString('base64'),
    };
  } catch {
    return null;
  }
}

function writeMediaFile(dir, media, preferredName) {
  if (!media?.base64) return '';
  let buf;
  try {
    buf = Buffer.from(String(media.base64).replace(/\s/g, ''), 'base64');
  } catch {
    return '';
  }
  if (!buf.length || buf.length > MAX_MEDIA_BYTES) return '';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext =
    extFromMime(media.mime, path.extname(String(media.filename || preferredName || '')).slice(1) || 'bin') ||
    'bin';
  const filename = `${preferredName || randomUUID()}.${ext}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.writeFileSync(path.join(dir, filename), buf);
  return filename;
}

function tableExists(db, name) {
  try {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
    return !!row;
  } catch {
    return false;
  }
}

function listAnnotations(db, roomCode) {
  if (!tableExists(db, 'teacher_annotations')) return [];
  return db
    .prepare(
      `SELECT student_id, start_offset, end_offset, quote, note, prefix_context, suffix_context,
              status, student_fixed_at, resolved_at, created_at, updated_at
       FROM teacher_annotations WHERE room_code = ? ORDER BY id ASC`
    )
    .all(roomCode);
}

function listTeacherNotes(db, roomCode) {
  if (!tableExists(db, 'teacher_feedback_messages')) return [];
  return db
    .prepare(
      `SELECT student_id, text, created_at
       FROM teacher_feedback_messages WHERE room_code = ? ORDER BY id ASC`
    )
    .all(roomCode);
}

function clearAnnotations(db, roomCode) {
  if (!tableExists(db, 'teacher_annotations')) return;
  db.prepare(`DELETE FROM teacher_annotations WHERE room_code = ?`).run(roomCode);
}

function clearTeacherNotes(db, roomCode) {
  if (!tableExists(db, 'teacher_feedback_messages')) return;
  db.prepare(`DELETE FROM teacher_feedback_messages WHERE room_code = ?`).run(roomCode);
}

function clearSnapshots(db, roomCode) {
  db.prepare(`DELETE FROM room_snapshots WHERE room_code = ?`).run(roomCode);
}

function clearReportAliases(db, roomCode) {
  if (!tableExists(db, 'student_report_aliases')) return;
  db.prepare(`DELETE FROM student_report_aliases WHERE room_code = ?`).run(roomCode);
}

function listPulseLog(db, roomCode) {
  return {
    questions: db
      .prepare(`SELECT * FROM lesson_pulse_questions WHERE room_code = ? ORDER BY question_number ASC, launched_at ASC`)
      .all(roomCode),
    cells: db.prepare(`SELECT * FROM lesson_pulse_cells WHERE room_code = ?`).all(roomCode),
    opportunities: db.prepare(`SELECT * FROM lesson_pulse_opportunities WHERE room_code = ?`).all(roomCode),
  };
}

function listFeaturedRaw(db, roomCode) {
  return db.prepare(`SELECT * FROM featured_wall WHERE room_code = ? ORDER BY id ASC`).all(roomCode);
}

function listLiveResponsesRaw(db, roomCode) {
  return db.prepare(`SELECT * FROM live_responses WHERE room_code = ?`).all(roomCode);
}

function listLiveActivityRaw(db, roomCode) {
  return db.prepare(`SELECT * FROM live_activities WHERE room_code = ?`).get(roomCode) || null;
}

function listVotes(db, roomCode) {
  return queries.listAudienceQuestionVotes(db, roomCode);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} roomCode
 * @param {{ boardMediaDir: (code: string) => string }} media
 */
export function buildSessionPack(db, roomCode, media) {
  const code = normalizeRoomCode(roomCode);
  if (code.length !== 4) throw new Error('Invalid room');
  queries.ensureRoom(db, code);
  const dir = media.boardMediaDir(code);
  const roomRow = db.prepare(`SELECT * FROM rooms WHERE code = ?`).get(code);
  const students = queries.listStudents(db, code);
  const idToExport = new Map();
  const packedStudents = students.map((row, index) => {
    const exportId = `s${index + 1}`;
    idToExport.set(Number(row.id), exportId);
    const image = row.image_filename ? readMediaFile(dir, row.image_filename) : null;
    const markup = row.teacher_markup_filename
      ? readMediaFile(dir, row.teacher_markup_filename)
      : null;
    return {
      exportId,
      name: String(row.name || ''),
      text: String(row.text || ''),
      rich_text_html: row.rich_text_html != null ? String(row.rich_text_html) : '',
      class_group: row.class_group != null ? String(row.class_group) : '',
      year_level: row.year_level != null ? String(row.year_level) : '',
      updated_at: row.updated_at || '',
      engagement_status: row.engagement_status != null ? String(row.engagement_status) : '',
      engagement_recent: row.engagement_recent != null ? String(row.engagement_recent) : '[]',
      last_engaged_at: row.last_engaged_at || null,
      image,
      teacher_markup: markup,
    };
  });

  const posts = queries.listBoardPosts(db, code).map((row) => {
    const mediaFile = row.image_filename ? readMediaFile(dir, row.image_filename) : null;
    return {
      kind: row.kind === 'image' ? 'image' : row.kind === 'file' ? 'file' : 'text',
      title: row.title || 'Teacher',
      text: row.text || '',
      size: Math.max(1, Math.min(4, Number(row.size) || 1)),
      created_at: row.created_at || '',
      media: mediaFile,
    };
  });

  const annotationsByExportId = {};
  for (const row of listAnnotations(db, code)) {
    const exportId = idToExport.get(Number(row.student_id));
    if (!exportId) continue;
    if (!annotationsByExportId[exportId]) annotationsByExportId[exportId] = [];
    annotationsByExportId[exportId].push({
      start_offset: Number(row.start_offset) || 0,
      end_offset: Number(row.end_offset) || 0,
      quote: String(row.quote || ''),
      note: String(row.note || ''),
      prefix_context: String(row.prefix_context || ''),
      suffix_context: String(row.suffix_context || ''),
      status: String(row.status || 'open'),
      student_fixed_at: row.student_fixed_at || null,
      resolved_at: row.resolved_at || null,
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
    });
  }

  const teacherNotesByExportId = {};
  for (const row of listTeacherNotes(db, code)) {
    const exportId = idToExport.get(Number(row.student_id));
    if (!exportId) continue;
    if (!teacherNotesByExportId[exportId]) teacherNotesByExportId[exportId] = [];
    teacherNotesByExportId[exportId].push({
      text: String(row.text || ''),
      createdAt: row.created_at || '',
    });
  }

  const liveActivity = listLiveActivityRaw(db, code);
  const liveResponses = listLiveResponsesRaw(db, code).map((row) => ({
    exportStudentId: idToExport.get(Number(row.student_id)) || null,
    activity_id: row.activity_id,
    value: row.value || '',
    confidence: row.confidence || '',
    published: !!row.published,
    submitted_at: row.submitted_at || '',
  }));

  const featuredWall = listFeaturedRaw(db, code).map((row) => ({
    activity_id: row.activity_id,
    question_number: Number(row.question_number) || 1,
    prompt: row.prompt || '',
    exportStudentId: idToExport.get(Number(row.student_id)) || null,
    student_name: row.student_name || '',
    value: row.value || '',
    anonymous: !!row.anonymous,
    label: row.label || '',
    created_at: row.created_at || '',
  }));

  const pulse = listPulseLog(db, code);
  const pulsePacked = {
    questions: pulse.questions,
    cells: pulse.cells.map((row) => ({
      ...row,
      exportStudentId: idToExport.get(Number(row.student_id)) || null,
    })),
    opportunities: pulse.opportunities.map((row) => ({
      ...row,
      exportStudentId: idToExport.get(Number(row.student_id)) || null,
    })),
  };

  const qnaQuestions = queries.listAudienceQuestions(db, code).map((row) => ({
    exportStudentId: idToExport.get(Number(row.student_id)) || null,
    student_name: row.student_name || '',
    text: row.text || '',
    anonymous_requested: !!row.anonymous_requested,
    published_anonymous: !!row.published_anonymous,
    status: row.status || 'pending',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    exportId: `q${row.id}`,
    votes: listVotes(db, code)
      .filter((v) => Number(v.question_id) === Number(row.id))
      .map((v) => idToExport.get(Number(v.student_id)))
      .filter(Boolean),
  }));

  const snapshots = queries.listSnapshots(db, code).map((snap) => ({
    label: snap.label || '',
    createdAt: snap.created_at || '',
    payload: snap.payload,
  }));

  const aliases = tableExists(db, 'student_report_aliases')
    ? db.prepare(`SELECT alias_key, canonical_key, canonical_name FROM student_report_aliases WHERE room_code = ?`).all(code)
    : [];

  const room = queries.rowToRoom(roomRow);

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    sourceRoomCode: code,
    room: {
      word_target: room.word_target,
      enforce_word_count: room.enforce_word_count,
      freeze_class: room.freeze_class,
      genre: room.genre,
      feedback_toggles: room.feedback_toggles,
      live_question_number: Number(roomRow?.live_question_number) || 0,
    },
    students: packedStudents,
    posts,
    annotationsByExportId,
    teacherNotesByExportId,
    live: {
      activity: liveActivity,
      responses: liveResponses,
      featuredWall,
      lessonPulse: pulsePacked,
    },
    qna: { questions: qnaQuestions },
    snapshots,
    reportAliases: aliases,
  };
}

function validatePack(pack) {
  if (!pack || typeof pack !== 'object') return 'Not a valid session file';
  if (pack.format !== FORMAT) return 'Not an iBoard session file';
  if (Number(pack.version) !== 1) return 'Unsupported session file version';
  if (!Array.isArray(pack.students)) return 'Session file is missing students';
  return null;
}

/**
 * Replace live class data in `roomCode` with the pack contents.
 * Evidence snapshots in the pack replace snapshots for this room.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} roomCode
 * @param {object} pack
 * @param {{
 *   boardMediaDir: (code: string) => string,
 *   unlinkRoomMedia: (code: string, filename: string) => void,
 * }} media
 */
export function importSessionPack(db, roomCode, pack, media) {
  const code = normalizeRoomCode(roomCode);
  if (code.length !== 4) throw new Error('Invalid room');
  const err = validatePack(pack);
  if (err) throw new Error(err);

  queries.ensureRoom(db, code);
  const dir = media.boardMediaDir(code);

  // Clear live class (same spirit as teacher:clear-cards) plus notes/annotations/snapshots.
  queries.clearAudienceQuestions(db, code);
  const studentRows = queries.deleteAllStudents(db, code);
  for (const s of studentRows) {
    if (s.image_filename) media.unlinkRoomMedia(code, s.image_filename);
    if (s.teacher_markup_filename) media.unlinkRoomMedia(code, s.teacher_markup_filename);
  }
  const postRows = queries.deleteAllBoardPosts(db, code);
  for (const p of postRows) {
    if (p.image_filename) media.unlinkRoomMedia(code, p.image_filename);
  }
  queries.clearLiveActivity(db, code);
  queries.clearFeaturedWall(db, code);
  queries.clearLessonPulseLog(db, code);
  clearAnnotations(db, code);
  clearTeacherNotes(db, code);
  clearSnapshots(db, code);
  clearReportAliases(db, code);

  const settings = pack.room || {};
  queries.updateRoomSettings(db, code, {
    word_target: settings.word_target,
    enforce_word_count: settings.enforce_word_count,
    freeze_class: settings.freeze_class,
    genre: settings.genre,
    feedback_toggles: settings.feedback_toggles,
  });
  db.prepare(`UPDATE rooms SET live_question_number = ? WHERE code = ?`).run(
    Math.max(0, Number(settings.live_question_number) || 0),
    code
  );

  const exportToId = new Map();
  for (const raw of pack.students) {
    const name = String(raw?.name || '').trim().slice(0, 80) || 'Student';
    const exportId = String(raw?.exportId || '').trim() || `s${exportToId.size + 1}`;
    const row = queries.addStudent(db, code, name);
    const sid = Number(row.id);
    exportToId.set(exportId, sid);

    const imageFilename = writeMediaFile(dir, raw.image, `student-${sid}-img`);
    const markupFilename = writeMediaFile(dir, raw.teacher_markup, `student-${sid}-markup`);
    db.prepare(
      `UPDATE students SET
         text = ?,
         rich_text_html = ?,
         class_group = ?,
         year_level = ?,
         updated_at = ?,
         engagement_status = ?,
         engagement_recent = ?,
         last_engaged_at = ?,
         image_filename = ?,
         teacher_markup_filename = ?,
         teacher_markup_base_filename = ?
       WHERE id = ?`
    ).run(
      String(raw.text || '').slice(0, 200_000),
      String(raw.rich_text_html || '').slice(0, 100_000),
      String(raw.class_group || '').slice(0, 8),
      String(raw.year_level || '').slice(0, 48),
      String(raw.updated_at || new Date().toISOString()),
      String(raw.engagement_status || '').slice(0, 40),
      String(raw.engagement_recent || '[]').slice(0, 2000),
      raw.last_engaged_at || null,
      imageFilename,
      markupFilename,
      imageFilename && markupFilename ? imageFilename : '',
      sid
    );
  }

  for (const raw of pack.posts || []) {
    const kind = raw.kind === 'image' ? 'image' : raw.kind === 'file' ? 'file' : 'text';
    const filename = kind === 'text' ? '' : writeMediaFile(dir, raw.media, `post-${randomUUID().slice(0, 8)}`);
    queries.addBoardPost(db, code, {
      kind,
      title: raw.title,
      text: raw.text,
      image_filename: filename,
      size: raw.size,
    });
  }

  if (tableExists(db, 'teacher_annotations')) {
    const insertAnn = db.prepare(
      `INSERT INTO teacher_annotations
         (room_code, student_id, start_offset, end_offset, quote, note, prefix_context, suffix_context,
          status, student_fixed_at, resolved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`
    );
    for (const [exportId, items] of Object.entries(pack.annotationsByExportId || {})) {
      const sid = exportToId.get(exportId);
      if (!sid) continue;
      for (const a of items || []) {
        insertAnn.run(
          code,
          sid,
          Number(a.start_offset) || 0,
          Number(a.end_offset) || 0,
          String(a.quote || '').slice(0, 5000),
          String(a.note || '').slice(0, 5000),
          String(a.prefix_context || '').slice(0, 500),
          String(a.suffix_context || '').slice(0, 500),
          String(a.status || 'open').slice(0, 20),
          a.student_fixed_at || null,
          a.resolved_at || null,
          a.created_at || null,
          a.updated_at || null
        );
      }
    }
  }

  if (tableExists(db, 'teacher_feedback_messages')) {
    const insertNote = db.prepare(
      `INSERT INTO teacher_feedback_messages (room_code, student_id, text, created_at)
       VALUES (?, ?, ?, COALESCE(?, datetime('now')))`
    );
    for (const [exportId, items] of Object.entries(pack.teacherNotesByExportId || {})) {
      const sid = exportToId.get(exportId);
      if (!sid) continue;
      for (const note of items || []) {
        const text = String(note.text || '').trim().slice(0, 5000);
        if (!text) continue;
        insertNote.run(code, sid, text, note.createdAt || null);
      }
    }
  }

  const live = pack.live || {};
  const activity = live.activity;
  if (activity?.activity_id) {
    db.prepare(
      `INSERT INTO live_activities
         (room_code, activity_id, question_number, type, prompt, options_json, questions_json,
          correct_answer, anonymous, optional, image_url, timer_seconds, source_question_id,
          locked, revealed, launched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      code,
      String(activity.activity_id),
      Math.max(1, Number(activity.question_number) || 1),
      String(activity.type || 'short'),
      String(activity.prompt || ''),
      String(activity.options_json || '[]'),
      String(activity.questions_json || '[]'),
      String(activity.correct_answer || ''),
      activity.anonymous ? 1 : 0,
      activity.optional ? 1 : 0,
      String(activity.image_url || ''),
      Math.max(0, Number(activity.timer_seconds) || 0),
      Math.max(0, Number(activity.source_question_id) || 0),
      activity.locked ? 1 : 0,
      activity.revealed ? 1 : 0,
      String(activity.launched_at || new Date().toISOString())
    );

    const insertResp = db.prepare(
      `INSERT INTO live_responses
         (activity_id, room_code, student_id, value, confidence, published, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    );
    for (const r of live.responses || []) {
      const sid = exportToId.get(r.exportStudentId);
      if (!sid) continue;
      insertResp.run(
        String(r.activity_id || activity.activity_id),
        code,
        sid,
        String(r.value || '').slice(0, 20_000),
        String(r.confidence || '').slice(0, 40),
        r.published ? 1 : 0,
        r.submitted_at || null
      );
    }
  }

  const insertFeatured = db.prepare(
    `INSERT INTO featured_wall
       (room_code, activity_id, question_number, prompt, student_id, student_name, value, anonymous, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  );
  for (const item of live.featuredWall || []) {
    const sid = exportToId.get(item.exportStudentId);
    if (!sid) continue;
    insertFeatured.run(
      code,
      String(item.activity_id || ''),
      Math.max(1, Number(item.question_number) || 1),
      String(item.prompt || ''),
      sid,
      String(item.student_name || ''),
      String(item.value || ''),
      item.anonymous ? 1 : 0,
      String(item.label || ''),
      item.created_at || null
    );
  }

  const pulse = live.lessonPulse || {};
  const insertQ = db.prepare(
    `INSERT INTO lesson_pulse_questions
       (room_code, activity_id, question_number, type, prompt, options_json, anonymous, optional, launched_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const q of pulse.questions || []) {
    insertQ.run(
      code,
      String(q.activity_id || randomUUID()),
      Math.max(1, Number(q.question_number) || 1),
      String(q.type || 'short'),
      String(q.prompt || ''),
      String(q.options_json || '[]'),
      q.anonymous ? 1 : 0,
      q.optional ? 1 : 0,
      String(q.launched_at || new Date().toISOString()),
      q.ended_at || null
    );
  }
  const insertCell = db.prepare(
    `INSERT INTO lesson_pulse_cells
       (room_code, activity_id, question_number, student_id, student_name, value, confidence, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
     ON CONFLICT(activity_id, student_id) DO NOTHING`
  );
  for (const cell of pulse.cells || []) {
    const sid = exportToId.get(cell.exportStudentId);
    if (!sid) continue;
    insertCell.run(
      code,
      String(cell.activity_id || ''),
      Math.max(1, Number(cell.question_number) || 1),
      sid,
      String(cell.student_name || ''),
      String(cell.value || ''),
      String(cell.confidence || ''),
      cell.submitted_at || null
    );
  }
  const insertOpp = db.prepare(
    `INSERT INTO lesson_pulse_opportunities
       (room_code, activity_id, question_number, student_id, created_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))
     ON CONFLICT(activity_id, student_id) DO NOTHING`
  );
  for (const opp of pulse.opportunities || []) {
    const sid = exportToId.get(opp.exportStudentId);
    if (!sid) continue;
    insertOpp.run(
      code,
      String(opp.activity_id || ''),
      Math.max(1, Number(opp.question_number) || 1),
      sid,
      opp.created_at || null
    );
  }

  const qnaIdMap = new Map();
  for (const q of pack.qna?.questions || []) {
    const sid = exportToId.get(q.exportStudentId);
    if (!sid) continue;
    const result = db
      .prepare(
        `INSERT INTO audience_questions
           (room_code, student_id, student_name, text, anonymous_requested, published_anonymous, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`
      )
      .run(
        code,
        sid,
        String(q.student_name || '').slice(0, 120),
        String(q.text || '').slice(0, 2000),
        q.anonymous_requested ? 1 : 0,
        q.published_anonymous ? 1 : 0,
        String(q.status || 'pending').slice(0, 20),
        q.created_at || null,
        q.updated_at || null
      );
    const qid = Number(result.lastInsertRowid);
    if (q.exportId) qnaIdMap.set(q.exportId, qid);
    for (const voteExportId of q.votes || []) {
      const voterId = exportToId.get(voteExportId);
      if (!voterId) continue;
      try {
        db.prepare(`INSERT INTO audience_question_votes (question_id, student_id) VALUES (?, ?)`).run(qid, voterId);
      } catch {
        /* ignore dupes */
      }
    }
  }

  for (const snap of pack.snapshots || []) {
    const label = String(snap.label || 'Restored evidence').slice(0, 200);
    const payload = snap.payload && typeof snap.payload === 'object' ? snap.payload : { students: [] };
    queries.addSnapshot(db, code, label, payload);
    if (snap.createdAt) {
      const id = db.prepare(`SELECT id FROM room_snapshots WHERE room_code = ? ORDER BY id DESC LIMIT 1`).get(code)?.id;
      if (id) {
        db.prepare(`UPDATE room_snapshots SET created_at = ? WHERE id = ?`).run(String(snap.createdAt), id);
      }
    }
  }

  if (tableExists(db, 'student_report_aliases')) {
    const insertAlias = db.prepare(
      `INSERT OR REPLACE INTO student_report_aliases (room_code, alias_key, canonical_key, canonical_name)
       VALUES (?, ?, ?, ?)`
    );
    for (const alias of pack.reportAliases || []) {
      insertAlias.run(
        code,
        String(alias.alias_key || '').slice(0, 160),
        String(alias.canonical_key || '').slice(0, 160),
        String(alias.canonical_name || '').slice(0, 160)
      );
    }
  }

  return {
    ok: true,
    studentCount: exportToId.size,
    postCount: (pack.posts || []).length,
    snapshotCount: (pack.snapshots || []).length,
  };
}

export function isSessionPack(pack) {
  return !validatePack(pack);
}

export { FORMAT as SESSION_FORMAT, VERSION as SESSION_VERSION, validatePack };
