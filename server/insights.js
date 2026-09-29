import { openDatabase } from './db.js';

// Class insights: a long-lived, append-only record of how the feedback loop is used.
// Nothing here is cleared by "Start new class" or clearing comments, and nothing here feeds
// back into the lesson — it is only read by the teacher's Class insights panel.

const LESSON_IDLE_SPLIT_MS = 6 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const SAMPLE_EVERY_MS = 5 * 60 * 1000;
const LIVE_WINDOW_MS = 10 * 60 * 1000;
const MAX_LESSONS = 40;

const db = openDatabase();
db.exec(`
  CREATE TABLE IF NOT EXISTS insight_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    ended_at INTEGER
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS insight_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    student_key TEXT,
    annotation_id INTEGER,
    value REAL,
    value2 REAL,
    at INTEGER NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS insight_students (
    lesson_id INTEGER NOT NULL,
    student_key TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (lesson_id, student_key)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_insight_lessons_room ON insight_lessons(room_code, started_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_insight_events_lesson ON insight_events(lesson_id)`);

const openLessonStmt = db.prepare(
  `SELECT * FROM insight_lessons WHERE room_code = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`
);
const insertLessonStmt = db.prepare(
  `INSERT INTO insight_lessons (room_code, started_at, last_at) VALUES (?, ?, ?)`
);
const touchLessonStmt = db.prepare(`UPDATE insight_lessons SET last_at = ? WHERE id = ?`);
const endLessonStmt = db.prepare(`UPDATE insight_lessons SET ended_at = ? WHERE id = ?`);
const insertEventStmt = db.prepare(
  `INSERT INTO insight_events (lesson_id, type, student_key, annotation_id, value, value2, at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const upsertStudentStmt = db.prepare(
  `INSERT INTO insight_students (lesson_id, student_key, name) VALUES (?, ?, ?)
   ON CONFLICT(lesson_id, student_key) DO UPDATE SET name = excluded.name`
);
const roomStudentsStmt = db.prepare(`SELECT id, name, text FROM students WHERE room_code = ?`);
const studentStmt = db.prepare(`SELECT id, name, room_code FROM students WHERE id = ?`);
// teacher_annotations is created by richTextPatch.js, which evaluates after this module.
let annotationStudentStmt = null;
function annotationStudentId(annotationId) {
  annotationStudentStmt ??= db.prepare(`SELECT student_id FROM teacher_annotations WHERE id = ?`);
  return annotationStudentStmt.get(Number(annotationId))?.student_id;
}

function normaliseRoomCode(code) {
  return String(code ?? '').replace(/\D/g, '').slice(0, 4).padStart(4, '0');
}

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Stable across lessons within a room so a returning student lines up with their earlier self. */
export function studentKey(roomCode, name) {
  const clean = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return clean ? `${normaliseRoomCode(roomCode)}:${clean}` : '';
}

/** Characters inserted by one edit, from the common prefix/suffix of before and after. */
export function insertedLength(before, after) {
  const a = String(before || '');
  const b = String(after || '');
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return Math.max(0, endB - start);
}

function recordWordsForLesson(lesson, roomCode, at) {
  for (const row of roomStudentsStmt.all(roomCode)) {
    const key = studentKey(roomCode, row.name);
    if (!key) continue;
    upsertStudentStmt.run(lesson.id, key, String(row.name).trim());
    insertEventStmt.run(lesson.id, 'words', key, null, countWords(row.text), null, at);
  }
}

function closeLesson(lesson, roomCode, at) {
  recordWordsForLesson(lesson, roomCode, at);
  endLessonStmt.run(at, lesson.id);
}

/** Lessons open lazily on the first event and split after a long idle gap. */
export function ensureLesson(roomCode, at = Date.now()) {
  const code = normaliseRoomCode(roomCode);
  let lesson = openLessonStmt.get(code);
  if (lesson && at - Number(lesson.last_at) > LESSON_IDLE_SPLIT_MS) {
    closeLesson(lesson, code, Number(lesson.last_at));
    lesson = null;
  }
  if (!lesson) {
    const result = insertLessonStmt.run(code, at, at);
    lesson = { id: Number(result.lastInsertRowid), room_code: code, started_at: at, last_at: at };
  }
  return lesson;
}

export function endLesson(roomCode, at = Date.now()) {
  const code = normaliseRoomCode(roomCode);
  const lesson = openLessonStmt.get(code);
  if (!lesson) return false;
  closeLesson(lesson, code, at);
  activity.delete(code);
  return true;
}

function keyForStudentId(roomCode, studentId) {
  const row = studentStmt.get(Number(studentId));
  if (!row || normaliseRoomCode(row.room_code) !== normaliseRoomCode(roomCode)) return null;
  const key = studentKey(roomCode, row.name);
  return key ? { key, name: String(row.name).trim() } : null;
}

function record(roomCode, type, { studentId, annotationId, value = null, value2 = null, at = Date.now() } = {}) {
  const code = normaliseRoomCode(roomCode);
  let sid = studentId;
  if (!sid && annotationId) sid = annotationStudentId(annotationId);
  const student = sid ? keyForStudentId(code, sid) : null;
  const lesson = ensureLesson(code, at);
  if (student) upsertStudentStmt.run(lesson.id, student.key, student.name);
  insertEventStmt.run(
    lesson.id,
    type,
    student?.key ?? null,
    annotationId ? Number(annotationId) : null,
    value,
    value2,
    at
  );
  touchLessonStmt.run(at, lesson.id);
}

/** Never let insights recording interfere with the lesson itself. */
function safely(fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (error) {
      console.error('Class insights could not record an event', error);
    }
  };
}

export const insightCommentAdded = safely((roomCode, studentId, annotationId, at) =>
  record(roomCode, 'comment_added', { studentId, annotationId, at })
);
export const insightCommentFixed = safely((roomCode, studentId, annotationId, at) =>
  record(roomCode, 'comment_fixed', { studentId, annotationId, at })
);
export const insightCommentReopened = safely((roomCode, studentId, annotationId, at) =>
  record(roomCode, 'comment_reopened', { studentId, annotationId, at })
);
export const insightCommentConfirmed = safely((roomCode, studentId, annotationId, at) =>
  record(roomCode, 'comment_confirmed', { studentId, annotationId, at })
);
export const insightCommentDeleted = safely((roomCode, studentId, annotationId, at) =>
  record(roomCode, 'comment_deleted', { studentId, annotationId, at })
);
export const insightPaste = safely((roomCode, studentId, inserted, at) =>
  record(roomCode, 'paste', { studentId, value: Math.max(0, Number(inserted) || 0), at })
);
export const insightLessonEnd = safely((roomCode, at) => endLesson(roomCode, at));

/** The teacher has dealt with this student's pastes; only later pastes flag them again. */
export const insightPasteAck = safely((roomCode, studentId, at) =>
  record(roomCode, 'paste_ack', { studentId, at })
);

/** Unacknowledged pastes per current student id in the running lesson, for the live header pill. */
export function livePasteCounts(roomCode, at = Date.now()) {
  const code = normaliseRoomCode(roomCode);
  const lesson = openLessonStmt.get(code);
  if (!lesson || at - Number(lesson.last_at) > LESSON_IDLE_SPLIT_MS) return {};
  const byKey = new Map();
  const rows = db
    .prepare(
      `SELECT student_key, type FROM insight_events
       WHERE lesson_id = ? AND type IN ('paste', 'paste_ack') AND student_key IS NOT NULL
       ORDER BY at ASC, id ASC`
    )
    .all(lesson.id);
  for (const row of rows) {
    byKey.set(row.student_key, row.type === 'paste_ack' ? 0 : (byKey.get(row.student_key) || 0) + 1);
  }
  const counts = {};
  if (!byKey.size) return counts;
  for (const row of roomStudentsStmt.all(code)) {
    const n = byKey.get(studentKey(code, row.name));
    if (n) counts[row.id] = n;
  }
  return counts;
}

// Writing activity: who changed their draft recently. Sampled into the lesson every few minutes
// while the class is writing, so "% actively writing" is based on the whole class, not just typists.
const activity = new Map();
const baselined = new Set();
const baselineExistsStmt = db.prepare(
  `SELECT 1 FROM insight_events WHERE lesson_id = ? AND type = 'words_start' AND student_key = ? LIMIT 1`
);

/**
 * Draft length when the student first writes in a lesson, so "words written" measures this
 * lesson's work even when a draft carries over from an earlier one.
 */
function recordWordBaseline(code, studentId, beforeText, at) {
  const student = keyForStudentId(code, studentId);
  if (!student) return;
  const lesson = ensureLesson(code, at);
  const marker = `${lesson.id}:${student.key}`;
  if (baselined.has(marker)) return;
  baselined.add(marker);
  if (baselineExistsStmt.get(lesson.id, student.key)) return;
  record(code, 'words_start', { studentId, value: countWords(beforeText), at });
}

export const insightTextChanged = safely((roomCode, studentId, at = Date.now(), beforeText = null) => {
  const code = normaliseRoomCode(roomCode);
  let room = activity.get(code);
  if (!room) {
    room = { lastSampleAt: at, students: new Map() };
    activity.set(code, room);
    ensureLesson(code, at);
  }
  room.students.set(Number(studentId), at);
  if (beforeText != null) recordWordBaseline(code, studentId, beforeText, at);
});

let isStudentConnected = () => true;

export function setPresenceCheck(fn) {
  isStudentConnected = typeof fn === 'function' ? fn : () => true;
}

export function sampleActivity(at = Date.now()) {
  for (const [code, room] of activity) {
    try {
      let latest = 0;
      for (const changedAt of room.students.values()) latest = Math.max(latest, changedAt);
      if (at - latest > LIVE_WINDOW_MS) {
        activity.delete(code);
        continue;
      }
      if (at - room.lastSampleAt < SAMPLE_EVERY_MS) continue;
      room.lastSampleAt = at;
      // Only students in the room right now count, so absent students and ghost cards
      // don't read as "not writing".
      const present = roomStudentsStmt.all(code).filter((row) => isStudentConnected(row.id));
      if (!present.length) continue;
      const active = present.filter((row) => at - (room.students.get(Number(row.id)) || 0) <= ACTIVE_WINDOW_MS).length;
      record(code, 'active_sample', { value: active, value2: present.length, at });
    } catch (error) {
      console.error('Class insights could not sample activity', error);
    }
  }
}

export function startInsightsSampler({ isConnected } = {}) {
  if (isConnected) setPresenceCheck(isConnected);
  const timer = setInterval(() => sampleActivity(Date.now()), 60 * 1000);
  timer.unref?.();
  return timer;
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function eventsForLessons(lessonIds) {
  if (!lessonIds.length) return [];
  const placeholders = lessonIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM insight_events WHERE lesson_id IN (${placeholders}) ORDER BY at ASC, id ASC`)
    .all(...lessonIds);
}

function studentsForLessons(lessonIds) {
  if (!lessonIds.length) return [];
  const placeholders = lessonIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM insight_students WHERE lesson_id IN (${placeholders})`)
    .all(...lessonIds);
}

/** Comment loop tallies for a set of events (one lesson, or one student). */
function commentStats(events) {
  const added = new Map();
  const fixed = new Set();
  const reopened = new Set();
  const deleted = new Set();
  const confirmMinutes = [];
  const reviseMinutes = [];
  for (const event of events) {
    const id = Number(event.annotation_id);
    if (!id) continue;
    if (event.type === 'comment_added') added.set(id, Number(event.at));
    else if (!added.has(id)) continue;
    else if (event.type === 'comment_fixed') {
      if (!fixed.has(id)) reviseMinutes.push((Number(event.at) - added.get(id)) / 60000);
      fixed.add(id);
    } else if (event.type === 'comment_reopened') reopened.add(id);
    else if (event.type === 'comment_deleted') deleted.add(id);
    else if (event.type === 'comment_confirmed') {
      confirmMinutes.push((Number(event.at) - added.get(id)) / 60000);
    }
  }
  // A comment deleted before the student acted on it was withdrawn, not ignored.
  const given = [...added.keys()].filter((id) => !(deleted.has(id) && !fixed.has(id)));
  const actedOn = given.filter((id) => fixed.has(id)).length;
  const checkAgain = given.filter((id) => reopened.has(id)).length;
  const avgConfirm = average(confirmMinutes);
  const avgRevise = average(reviseMinutes);
  return {
    commentsGiven: given.length,
    actedOn,
    actedOnPct: pct(actedOn, given.length),
    checkAgain,
    checkAgainPct: pct(checkAgain, given.length),
    revised: reviseMinutes.length,
    avgReviseMinutes: avgRevise == null ? null : Math.round(avgRevise * 10) / 10,
    confirmed: confirmMinutes.length,
    avgConfirmMinutes: avgConfirm == null ? null : Math.round(avgConfirm * 10) / 10,
  };
}

function pasteStats(events) {
  const pastes = events.filter((event) => event.type === 'paste');
  return {
    pastes: pastes.length,
    studentsPasted: new Set(pastes.map((event) => event.student_key).filter(Boolean)).size,
  };
}

/**
 * Words written this lesson per student: draft length at the end (or now, for a running lesson)
 * minus the length when they first wrote. Lessons recorded before baselines existed use end length.
 */
function wordsByStudent(lesson, events) {
  const end = new Map();
  const start = new Map();
  for (const event of events) {
    if (!event.student_key) continue;
    if (event.type === 'words') end.set(event.student_key, Number(event.value) || 0);
    else if (event.type === 'words_start' && !start.has(event.student_key)) {
      start.set(event.student_key, Number(event.value) || 0);
    }
  }
  if (!lesson.ended_at) {
    for (const row of roomStudentsStmt.all(lesson.room_code)) {
      const key = studentKey(lesson.room_code, row.name);
      if (key) end.set(key, countWords(row.text));
    }
  }
  const written = new Map();
  for (const [key, count] of end) {
    const before = start.get(key);
    if (before != null) written.set(key, Math.max(0, count - before));
    else written.set(key, start.size ? 0 : count);
  }
  return written;
}

function lessonSummary(lesson, events, studentRows) {
  const words = wordsByStudent(lesson, events);
  const keys = new Set(studentRows.map((row) => row.student_key));
  for (const key of words.keys()) keys.add(key);
  const samples = events.filter((event) => event.type === 'active_sample' && Number(event.value2) > 0);
  const writing = average(samples.map((event) => Number(event.value) / Number(event.value2)));
  const avgWords = average([...words.values()]);
  return {
    id: Number(lesson.id),
    roomCode: lesson.room_code,
    startedAt: Number(lesson.started_at),
    endedAt: lesson.ended_at == null ? null : Number(lesson.ended_at),
    students: keys.size,
    ...commentStats(events),
    ...pasteStats(events),
    avgWords: avgWords == null ? null : Math.round(avgWords),
    writingPct: writing == null ? null : Math.round(writing * 100),
    writingSamples: samples.length,
  };
}

function listLessons({ roomCode, scope }) {
  if (scope === 'all') {
    return db.prepare(`SELECT * FROM insight_lessons ORDER BY started_at DESC LIMIT ?`).all(MAX_LESSONS);
  }
  return db
    .prepare(`SELECT * FROM insight_lessons WHERE room_code = ? ORDER BY started_at DESC LIMIT ?`)
    .all(normaliseRoomCode(roomCode), MAX_LESSONS);
}

/** Per-student rows (teacher only — contains names). */
function studentBreakdown(lessons, events, studentRows) {
  const byKey = new Map();
  const ensure = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, name: '', lessons: new Set(), events: [], words: [] });
    return byKey.get(key);
  };
  for (const row of studentRows) {
    const entry = ensure(row.student_key);
    entry.name = row.name;
    entry.lessons.add(Number(row.lesson_id));
  }
  const addedBy = new Map();
  for (const event of events) {
    if (event.type === 'comment_added' && event.student_key) addedBy.set(Number(event.annotation_id), event.student_key);
  }
  for (const event of events) {
    const key = event.student_key || addedBy.get(Number(event.annotation_id));
    if (!key || ['words', 'words_start', 'active_sample', 'paste_ack'].includes(event.type)) continue;
    ensure(key).events.push(event);
  }
  for (const lesson of lessons) {
    if (!lesson.ended_at) {
      for (const row of roomStudentsStmt.all(lesson.room_code)) {
        const key = studentKey(lesson.room_code, row.name);
        if (key && !byKey.get(key)?.name) ensure(key).name = String(row.name).trim();
      }
    }
    const lessonEvents = events.filter((event) => Number(event.lesson_id) === Number(lesson.id));
    for (const [key, count] of wordsByStudent(lesson, lessonEvents)) {
      const entry = ensure(key);
      entry.words.push(count);
      entry.lessons.add(Number(lesson.id));
    }
  }
  return [...byKey.values()]
    .map((entry) => {
      const comments = commentStats(entry.events);
      const avgWords = average(entry.words);
      return {
        key: entry.key,
        name: entry.name || entry.key.split(':').slice(1).join(':'),
        lessons: entry.lessons.size,
        commentsGiven: comments.commentsGiven,
        actedOn: comments.actedOn,
        actedOnPct: comments.actedOnPct,
        checkAgain: comments.checkAgain,
        pastes: pasteStats(entry.events).pastes,
        avgWords: avgWords == null ? null : Math.round(avgWords),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Class insights for the teacher. `lessonId` narrows the per-student rows to one lesson;
 * lesson summaries always cover the recent history so trends stay visible.
 */
export function getInsights({ roomCode, scope = 'room', lessonId = null } = {}) {
  const lessons = listLessons({ roomCode, scope });
  const ids = lessons.map((lesson) => Number(lesson.id));
  const events = eventsForLessons(ids);
  const studentRows = studentsForLessons(ids);
  const summaries = lessons.map((lesson) =>
    lessonSummary(
      lesson,
      events.filter((event) => Number(event.lesson_id) === Number(lesson.id)),
      studentRows.filter((row) => Number(row.lesson_id) === Number(lesson.id))
    )
  );
  const focus = lessonId ? lessons.filter((lesson) => Number(lesson.id) === Number(lessonId)) : lessons;
  const focusIds = new Set(focus.map((lesson) => Number(lesson.id)));
  const students = studentBreakdown(
    focus,
    events.filter((event) => focusIds.has(Number(event.lesson_id))),
    studentRows.filter((row) => focusIds.has(Number(row.lesson_id)))
  );
  return { lessons: summaries, students };
}

export function registerInsightsSocket(socket) {
  socket.on('teacher:paste-alerts-sync', (_payload, cb) => {
    try {
      const roomCode = normaliseRoomCode(socket.data.roomCode);
      if (socket.data.role !== 'teacher' || roomCode.length !== 4) {
        cb?.({ ok: false });
        return;
      }
      cb?.({ ok: true, counts: livePasteCounts(roomCode) });
    } catch (error) {
      console.error('Could not read live paste alerts', error);
      cb?.({ ok: false });
    }
  });

  socket.on('teacher:insights', (payload = {}, cb) => {
    try {
      const roomCode = normaliseRoomCode(socket.data.roomCode);
      if (socket.data.role !== 'teacher' || roomCode.length !== 4) {
        cb?.({ ok: false, error: 'Open the room as teacher first' });
        return;
      }
      const scope = payload?.scope === 'all' ? 'all' : 'room';
      const lessonId = Number(payload?.lessonId) || null;
      cb?.({ ok: true, roomCode, scope, ...getInsights({ roomCode, scope, lessonId }) });
    } catch (error) {
      console.error('Could not build class insights', error);
      cb?.({ ok: false, error: 'Could not load class insights' });
    }
  });
}
