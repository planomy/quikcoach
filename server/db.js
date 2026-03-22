import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'classroom.db');

export function openDatabase() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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

  updateStudentGroup(db, studentId, classGroup) {
    const raw = String(classGroup ?? '').trim().toUpperCase();
    const allowed = ['A', 'B', 'C', 'D', 'E'];
    const g = !raw ? '' : allowed.includes(raw.charAt(0)) ? raw.charAt(0) : '';
    run(db, `UPDATE students SET class_group = ? WHERE id = ?`, [g, studentId]);
    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
  },

  listStudents(db, roomCode) {
    return all(
      db,
      `SELECT id, room_code, name, text, updated_at, class_group FROM students WHERE room_code = ? ORDER BY id ASC`,
      [roomCode]
    );
  },

  getStudent(db, studentId) {
    return get(db, 'SELECT * FROM students WHERE id = ?', [studentId]);
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
    return {
      id: row.id,
      room_code: row.room_code,
      name: row.name,
      text: row.text || '',
      updated_at: row.updated_at,
      class_group: row.class_group != null ? String(row.class_group) : '',
    };
  },
};
