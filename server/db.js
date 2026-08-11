import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'classroom.db');

export function openDatabase() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  configureWal(db);
  migrate(db);
  return db;
}

/** @param {DatabaseSync} db */
export function configureWal(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
}

/** @param {DatabaseSync} db */
export function migrate(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      word_target INTEGER NOT NULL DEFAULT 100,
      vandalism_filter INTEGER NOT NULL DEFAULT 0,
      freeze_class INTEGER NOT NULL DEFAULT 0,
      genre TEXT NOT NULL DEFAULT 'writing',
      feedback_toggles TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      name TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (room_code) REFERENCES rooms(code)
    )`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_students_room ON students(room_code)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_students_room_id ON students(room_code, id)`);
  try {
    db.exec(`ALTER TABLE rooms ADD COLUMN year_level TEXT NOT NULL DEFAULT 'general'`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE rooms ADD COLUMN enforce_word_count INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE students ADD COLUMN class_group TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE students ADD COLUMN image_filename TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE students ADD COLUMN year_level TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE students ADD COLUMN engagement_recent TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE students ADD COLUMN engagement_status TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE students ADD COLUMN last_engaged_at TEXT`);
  } catch {
    /* column already exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      payload_json TEXT NOT NULL,
      FOREIGN KEY (room_code) REFERENCES rooms(code)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_room ON room_snapshots(room_code)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      title TEXT NOT NULL DEFAULT 'Teacher',
      text TEXT NOT NULL DEFAULT '',
      image_filename TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (room_code) REFERENCES rooms(code)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_board_posts_room ON board_posts(room_code)`);
  try {
    db.exec(`ALTER TABLE board_posts ADD COLUMN size INTEGER NOT NULL DEFAULT 1`);
  } catch {
    /* column already exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_activities (
      room_code TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      options_json TEXT NOT NULL DEFAULT '[]',
      correct_answer TEXT NOT NULL DEFAULT '',
      anonymous INTEGER NOT NULL DEFAULT 0,
      optional INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      revealed INTEGER NOT NULL DEFAULT 0,
      launched_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (room_code) REFERENCES rooms(code)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_responses (
      activity_id TEXT NOT NULL,
      room_code TEXT NOT NULL,
      student_id INTEGER NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      published INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (activity_id, student_id),
      FOREIGN KEY (room_code) REFERENCES rooms(code),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_live_responses_room ON live_responses(room_code)`);
}

/** @param {DatabaseSync} db */
function run(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

/** @param {DatabaseSync} db */
function get(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

/** @param {DatabaseSync} db */
function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

const FEEDBACK_MODES = ['writing', 'explanation', 'argument', 'problem_solving', 'custom'];
const LEGACY_GENRE_TO_MODE = {
  narrative: 'writing',
  analytical: 'explanation',
  persuasive: 'argument',
  discussional: 'writing',
};

function normalizeFeedbackMode(g) {
  if (g && FEEDBACK_MODES.includes(g)) return g;
  if (g && LEGACY_GENRE_TO_MODE[g]) return LEGACY_GENRE_TO_MODE[g];
  return 'writing';
}

function emptyModesObject() {
  return {
    writing: {},
    explanation: {},
    argument: {},
    problem_solving: {},
    custom: {},
  };
}

function emptyExtraFocusObject() {
  return {
    writing: [],
    explanation: [],
    argument: [],
    problem_solving: [],
    custom: [],
  };
}

function sanitizeExtraFocusItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x === 'object')
    .map((x, i) => ({
      id: String(x.id || `xf-${i}-${Date.now()}`),
      text: String(x.text || '').slice(0, 200),
      enabled: x.enabled !== false,
    }))
    .filter((x) => x.text.trim());
}

function normalizeExtraFocuses(raw) {
  const base = emptyExtraFocusObject();
  if (!raw || typeof raw !== 'object') return base;
  for (const k of FEEDBACK_MODES) {
    if (Array.isArray(raw[k])) base[k] = sanitizeExtraFocusItems(raw[k]);
  }
  return base;
}

function parseFeedbackTogglesPayload(parsed, rowGenre) {
  const subjectAssist = parsed.subjectAssist ?? 'general';
  const rawYear =
    parsed.yearLevel != null ? parsed.yearLevel : parsed.year_level != null ? parsed.year_level : null;
  const yearLevel = rawYear != null ? String(rawYear) : 'general';
  const customFocusText = parsed.customFocusText ?? '';
  const extraFocuses = normalizeExtraFocuses(parsed.extraFocuses);
  const version = Number(parsed.version) || 0;
  const modes = parsed.modes;
  if (modes && typeof modes === 'object' && !Array.isArray(modes)) {
    return {
      subjectAssist,
      yearLevel,
      customFocusText,
      extraFocuses,
      modes: { ...emptyModesObject(), ...modes },
      version,
    };
  }
  const stripped = { ...parsed };
  delete stripped.subjectAssist;
  delete stripped.yearLevel;
  delete stripped.year_level;
  delete stripped.customFocusText;
  delete stripped.modes;
  delete stripped.extraFocuses;
  delete stripped.version;
  const mode = normalizeFeedbackMode(rowGenre);
  const base = emptyModesObject();
  if (Object.keys(stripped).length) {
    base[mode] = { ...base[mode], ...stripped };
  }
  return { subjectAssist, yearLevel, customFocusText, extraFocuses, modes: base, version };
}

export const queries = {
  ensureRoom(db, code) {
    let row = get(db, 'SELECT * FROM rooms WHERE code = ?', [code]);
    if (row) return row;
    run(db, 'INSERT INTO rooms (code, genre) VALUES (?, ?)', [code, 'writing']);
    row = get(db, 'SELECT * FROM rooms WHERE code = ?', [code]);
    return row;
  },

  updateRoomSettings(db, code, settings) {
    const fields = [];
    const values = [];
    if (settings.word_target !== undefined) {
      fields.push('word_target = ?');
      values.push(Math.max(0, Math.min(500, Number(settings.word_target) || 0)));
    }
    if (settings.enforce_word_count !== undefined) {
      fields.push('enforce_word_count = ?');
      values.push(settings.enforce_word_count ? 1 : 0);
    }
    if (settings.freeze_class !== undefined) {
      fields.push('freeze_class = ?');
      values.push(settings.freeze_class ? 1 : 0);
    }
    if (settings.genre !== undefined) {
      fields.push('genre = ?');
      values.push(String(settings.genre));
    }
    if (settings.feedback_toggles !== undefined) {
      let prev = {};
      try {
        const existing = get(db, 'SELECT feedback_toggles FROM rooms WHERE code = ?', [code]);
        const raw = existing?.feedback_toggles;
        const txt = raw == null ? '{}' : typeof raw === 'string' ? raw : String(raw);
        prev = JSON.parse(txt || '{}');
      } catch {
        prev = {};
      }
      const incoming = { ...settings.feedback_toggles };
      for (const k of Object.keys(incoming)) {
        if (incoming[k] === undefined) delete incoming[k];
      }
      const merged = { ...prev, ...incoming };
      const rawYear = merged.yearLevel ?? merged.year_level;
      const yl =
        rawYear != null && String(rawYear).trim() !== ''
          ? String(rawYear).trim().slice(0, 48)
          : 'general';
      merged.yearLevel = yl;
      delete merged.year_level;
      fields.push('feedback_toggles = ?');
      values.push(JSON.stringify(merged));
      fields.push('year_level = ?');
      values.push(yl);
    }
    if (!fields.length) return queries.ensureRoom(db, code);
    values.push(code);
    run(db, `UPDATE rooms SET ${fields.join(', ')} WHERE code = ?`, values);
    return get(db, 'SELECT * FROM rooms WHERE code = ?', [code]);
  },

  addStudent(db, roomCode, name) {
    const r = run(db, 'INSERT INTO students (room_code, name) VALUES (?, ?)', [
      roomCode,
      name.trim().slice(0, 80),
    ]);
    return get(db, 'SELECT * FROM students WHERE id = ?', [r.lastInsertRowid]);
  },

  updateStudentText(db, studentId, text) {
    run(db, `UPDATE students SET text = ?, updated_at = datetime('now') WHERE id = ?`, [
      text,
      studentId,
    ]);
    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
  },

  updateStudentImage(db, studentId, imageFilename) {
    run(db, `UPDATE students SET image_filename = ?, updated_at = datetime('now') WHERE id = ?`, [
      String(imageFilename || '').slice(0, 120),
      studentId,
    ]);
    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
  },

  clearStudentContents(db, roomCode) {
    const rows = all(
      db,
      `SELECT id, image_filename FROM students WHERE room_code = ?`,
      [roomCode]
    );
    run(
      db,
      `UPDATE students SET text = '', image_filename = '', updated_at = datetime('now') WHERE room_code = ?`,
      [roomCode]
    );
    return rows;
  },

  /** Wipe every student row in the room (used for a fresh class on a reused code). */
  deleteAllStudents(db, roomCode) {
    const rows = all(
      db,
      `SELECT id, image_filename FROM students WHERE room_code = ?`,
      [roomCode]
    );
    run(db, `DELETE FROM students WHERE room_code = ?`, [roomCode]);
    return rows;
  },

  deleteAllBoardPosts(db, roomCode) {
    const rows = all(
      db,
      `SELECT id, image_filename FROM board_posts WHERE room_code = ?`,
      [roomCode]
    );
    run(db, `DELETE FROM board_posts WHERE room_code = ?`, [roomCode]);
    return rows;
  },

  updateStudentGroup(db, studentId, classGroup) {
    const raw = String(classGroup ?? '').trim().toUpperCase();
    const allowed = ['A', 'B', 'C', 'D', 'E'];
    const g = !raw ? '' : allowed.includes(raw.charAt(0)) ? raw.charAt(0) : '';
    run(db, `UPDATE students SET class_group = ? WHERE id = ?`, [g, studentId]);
    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
  },

  updateStudentYearLevel(db, studentId, yearLevel) {
    const allowed = new Set([
      '',
      'yr2',
      'yr3',
      'yr4',
      'yr5',
      'yr6',
      'yr7',
      'yr8',
      'yr9',
      'yr10',
      'yr11',
      'yr12',
    ]);
    const y = String(yearLevel ?? '')
      .trim()
      .toLowerCase();
    const value = allowed.has(y) ? y : '';
    run(db, `UPDATE students SET year_level = ? WHERE id = ?`, [value, studentId]);
    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
  },

  addLiveOpportunity(db, studentIds) {
    const ids = Array.from(new Set((studentIds || []).map(Number).filter(Boolean)));
    const update = db.prepare(`UPDATE students SET engagement_recent = ? WHERE id = ?`);
    const select = db.prepare(`SELECT engagement_recent FROM students WHERE id = ?`);
    for (const id of ids) {
      const row = select.get(id);
      if (!row) continue;
      const recent = parseRecent(row.engagement_recent);
      update.run(JSON.stringify([...recent, 0].slice(-5)), id);
    }
  },

  markLiveResponse(db, studentId) {
    const row = get(db, `SELECT engagement_recent FROM students WHERE id = ?`, [studentId]);
    if (!row) return null;
    const recent = parseRecent(row.engagement_recent);
    if (recent.length) recent[recent.length - 1] = 1;
    else recent.push(1);
    run(
      db,
      `UPDATE students
       SET engagement_recent = ?, engagement_status = '', last_engaged_at = datetime('now')
       WHERE id = ?`,
      [JSON.stringify(recent.slice(-5)), studentId]
    );
    return get(db, `SELECT * FROM students WHERE id = ?`, [studentId]);
  },

  setStudentEngagementStatus(db, studentId, status) {
    const allowed = new Set(['', 'ready', 'unsure', 'tech']);
    const value = allowed.has(String(status || '')) ? String(status || '') : '';
    run(db, `UPDATE students SET engagement_status = ? WHERE id = ?`, [value, studentId]);
    return get(db, `SELECT * FROM students WHERE id = ?`, [studentId]);
  },

  launchLiveActivity(db, roomCode, activity) {
    run(db, `DELETE FROM live_responses WHERE room_code = ?`, [roomCode]);
    run(
      db,
      `INSERT INTO live_activities
       (room_code, activity_id, type, prompt, options_json, correct_answer, anonymous, optional, locked, revealed, launched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, datetime('now'))
       ON CONFLICT(room_code) DO UPDATE SET
         activity_id = excluded.activity_id,
         type = excluded.type,
         prompt = excluded.prompt,
         options_json = excluded.options_json,
         correct_answer = excluded.correct_answer,
         anonymous = excluded.anonymous,
         optional = excluded.optional,
         locked = 0,
         revealed = 0,
         launched_at = datetime('now')`,
      [
        roomCode,
        activity.id,
        activity.type,
        activity.prompt,
        JSON.stringify(activity.options || []),
        activity.correctAnswer || '',
        activity.anonymous ? 1 : 0,
        activity.optional ? 1 : 0,
      ]
    );
    return queries.getLiveActivity(db, roomCode);
  },

  getLiveActivity(db, roomCode) {
    return rowToLiveActivity(get(db, `SELECT * FROM live_activities WHERE room_code = ?`, [roomCode]));
  },

  updateLiveActivity(db, roomCode, patch) {
    const fields = [];
    const values = [];
    if (patch.locked !== undefined) {
      fields.push('locked = ?');
      values.push(patch.locked ? 1 : 0);
    }
    if (patch.revealed !== undefined) {
      fields.push('revealed = ?');
      values.push(patch.revealed ? 1 : 0);
    }
    if (fields.length) {
      values.push(roomCode);
      run(db, `UPDATE live_activities SET ${fields.join(', ')} WHERE room_code = ?`, values);
    }
    return queries.getLiveActivity(db, roomCode);
  },

  clearLiveActivity(db, roomCode) {
    run(db, `DELETE FROM live_responses WHERE room_code = ?`, [roomCode]);
    run(db, `DELETE FROM live_activities WHERE room_code = ?`, [roomCode]);
  },

  upsertLiveResponse(db, { activityId, roomCode, studentId, value }) {
    run(
      db,
      `INSERT INTO live_responses (activity_id, room_code, student_id, value, published, submitted_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))
       ON CONFLICT(activity_id, student_id) DO UPDATE SET
         value = excluded.value,
         submitted_at = datetime('now')`,
      [activityId, roomCode, studentId, value]
    );
    return get(
      db,
      `SELECT * FROM live_responses WHERE activity_id = ? AND student_id = ?`,
      [activityId, studentId]
    );
  },

  listLiveResponses(db, roomCode) {
    return all(
      db,
      `SELECT r.*, s.name
       FROM live_responses r JOIN students s ON s.id = r.student_id
       WHERE r.room_code = ? ORDER BY r.submitted_at ASC`,
      [roomCode]
    ).map((row) => ({
      activityId: row.activity_id,
      studentId: Number(row.student_id),
      name: row.name,
      value: row.value,
      published: !!row.published,
      submittedAt: row.submitted_at,
    }));
  },

  setLiveResponsePublished(db, roomCode, activityId, studentId, published) {
    run(
      db,
      `UPDATE live_responses SET published = ?
       WHERE room_code = ? AND activity_id = ? AND student_id = ?`,
      [published ? 1 : 0, roomCode, activityId, studentId]
    );
  },

  listStudents(db, roomCode) {
    return all(
      db,
      `SELECT * FROM students WHERE room_code = ? ORDER BY id ASC`,
      [roomCode]
    );
  },

  getStudent(db, studentId) {
    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
  },

  deleteStudent(db, studentId) {
    const row = get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
    if (!row) return null;
    run(db, 'DELETE FROM students WHERE id = ?', [studentId]);
    return row;
  },

  addSnapshot(db, roomCode, label, payloadObj) {
    const json = JSON.stringify(payloadObj);
    const r = run(db, `INSERT INTO room_snapshots (room_code, label, payload_json) VALUES (?, ?, ?)`, [
      roomCode,
      label.slice(0, 200),
      json,
    ]);
    return Number(r.lastInsertRowid);
  },

  listSnapshotMeta(db, roomCode) {
    return all(
      db,
      `SELECT id, label, created_at FROM room_snapshots WHERE room_code = ? ORDER BY id DESC`,
      [roomCode]
    );
  },

  getSnapshot(db, snapshotId) {
    const row = get(db, `SELECT * FROM room_snapshots WHERE id = ?`, [snapshotId]);
    if (!row) return null;
    let payload;
    try {
      payload = JSON.parse(row.payload_json || '{}');
    } catch {
      payload = null;
    }
    return {
      id: row.id,
      room_code: row.room_code,
      label: row.label,
      created_at: row.created_at,
      payload,
    };
  },

  addBoardPost(db, roomCode, { kind, title, text, image_filename, size }) {
    const k = kind === 'image' ? 'image' : 'text';
    const sz = Math.max(1, Math.min(4, Number(size) || 1));
    const r = run(
      db,
      `INSERT INTO board_posts (room_code, kind, title, text, image_filename, size) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        roomCode,
        k,
        String(title || 'Teacher').trim().slice(0, 80) || 'Teacher',
        String(text || '').slice(0, 20_000),
        String(image_filename || '').slice(0, 120),
        sz,
      ]
    );
    return get(db, 'SELECT * FROM board_posts WHERE id = ?', [r.lastInsertRowid]);
  },

  listBoardPosts(db, roomCode) {
    return all(
      db,
      `SELECT id, room_code, kind, title, text, image_filename, size, created_at
       FROM board_posts WHERE room_code = ? ORDER BY id ASC`,
      [roomCode]
    );
  },

  getBoardPost(db, postId) {
    return get(db, 'SELECT * FROM board_posts WHERE id = ?', [postId]);
  },

  updateBoardPostSize(db, postId, size) {
    const sz = Math.max(1, Math.min(4, Number(size) || 1));
    run(db, `UPDATE board_posts SET size = ? WHERE id = ?`, [sz, postId]);
    return get(db, 'SELECT * FROM board_posts WHERE id = ?', [postId]);
  },

  deleteBoardPost(db, postId) {
    const row = get(db, 'SELECT * FROM board_posts WHERE id = ?', [postId]);
    if (!row) return null;
    run(db, 'DELETE FROM board_posts WHERE id = ?', [postId]);
    return row;
  },

  rowToBoardPost(row) {
    if (!row) return null;
    const kind = row.kind === 'image' ? 'image' : 'text';
    const filename = String(row.image_filename || '');
    const size = Math.max(1, Math.min(4, Number(row.size) || 1));
    return {
      id: Number(row.id),
      room_code: row.room_code,
      kind,
      title: row.title || 'Teacher',
      text: row.text || '',
      size,
      image_url:
        kind === 'image' && filename
          ? `/api/board-media/${encodeURIComponent(row.room_code)}/${encodeURIComponent(filename)}`
          : null,
      created_at: row.created_at,
    };
  },

  rowToRoom(row) {
    if (!row) return null;
    let parsed = {};
    try {
      const raw = row.feedback_toggles;
      const txt = raw == null ? '{}' : typeof raw === 'string' ? raw : String(raw);
      parsed = JSON.parse(txt || '{}');
    } catch {
      parsed = {};
    }
    const jsonHasYearKey =
      Object.prototype.hasOwnProperty.call(parsed, 'yearLevel') ||
      Object.prototype.hasOwnProperty.call(parsed, 'year_level');
    if (
      !jsonHasYearKey &&
      row.year_level != null &&
      String(row.year_level).trim() !== ''
    ) {
      parsed = { ...parsed, yearLevel: String(row.year_level).trim().slice(0, 48) };
    }
    const feedback_toggles = parseFeedbackTogglesPayload(parsed, row.genre);
    return {
      code: row.code,
      word_target: row.word_target,
      enforce_word_count: !!row.enforce_word_count,
      freeze_class: !!row.freeze_class,
      genre: normalizeFeedbackMode(row.genre),
      feedback_toggles,
    };
  },

  rowToStudent(row) {
    if (!row) return null;
    const filename = String(row.image_filename || '');
    const recent = parseRecent(row.engagement_recent);
    const responded = recent.filter(Boolean).length;
    return {
      id: row.id,
      room_code: row.room_code,
      name: row.name,
      text: row.text || '',
      updated_at: row.updated_at,
      class_group: row.class_group != null ? String(row.class_group) : '',
      year_level: row.year_level != null ? String(row.year_level) : '',
      engagement_status: row.engagement_status != null ? String(row.engagement_status) : '',
      last_engaged_at: row.last_engaged_at || null,
      engagement: {
        recent,
        responded,
        opportunities: recent.length,
        score: recent.length ? Math.round((responded / recent.length) * 100) : 100,
      },
      image_url:
        filename
          ? `/api/board-media/${encodeURIComponent(row.room_code)}/${encodeURIComponent(filename)}`
          : null,
    };
  },
};

function parseRecent(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.slice(-5).map((x) => (x ? 1 : 0)) : [];
  } catch {
    return [];
  }
}

function rowToLiveActivity(row) {
  if (!row) return null;
  let options = [];
  try {
    const parsed = JSON.parse(row.options_json || '[]');
    if (Array.isArray(parsed)) options = parsed.map(String);
  } catch {
    options = [];
  }
  return {
    id: row.activity_id,
    type: row.type,
    prompt: row.prompt,
    options,
    correctAnswer: row.correct_answer || '',
    anonymous: !!row.anonymous,
    optional: !!row.optional,
    locked: !!row.locked,
    revealed: !!row.revealed,
    launchedAt: row.launched_at,
  };
}
