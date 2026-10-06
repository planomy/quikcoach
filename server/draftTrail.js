import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Teacher-owned evidence. No new database or third-party service.
// Limits stop capture visibly; never silently drop the beginning of a trail.
// Live trails are mirrored to disk so a server crash mid-lesson cannot erase them.
const MAX_ROOM_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const QUIET_MS = 3 * 60 * 1000;
const LARGE_PASTE = 120;
const LARGE_JUMP = 250;
const PERSIST_EVERY_MS = 5000;
const rooms = new Map();
let totalBytes = 0;
let persistDir = '';
const dirtyRooms = new Set();
const lastPersistAt = new Map();

function markDirty(code) {
  if (persistDir) dirtyRooms.add(code);
}

function roomFile(code) {
  return path.join(persistDir, `${code}.json`);
}

function writeRoomFile(code) {
  const room = rooms.get(code);
  if (!room) return;
  const data = {
    version: 1,
    active: room.active,
    token: room.token,
    reason: room.reason,
    label: room.label,
    independent: room.independent,
    changed: room.changed,
    students: [...room.students.values()].map((s) => ({
      id: s.id,
      name: s.name,
      text: s.text,
      pending: s.pending,
      lastCheckpoint: s.lastCheckpoint || 0,
      events: s.events,
    })),
  };
  const file = roomFile(code);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** Write changed rooms to disk (throttled per room unless forced). */
export function persistTrails(at = Date.now(), { force = false } = {}) {
  if (!persistDir) return;
  for (const code of [...dirtyRooms]) {
    if (!force && at - (lastPersistAt.get(code) || 0) < PERSIST_EVERY_MS) continue;
    try {
      writeRoomFile(code);
      dirtyRooms.delete(code);
      lastPersistAt.set(code, at);
    } catch (error) {
      console.error(`Could not persist drafting evidence for room ${code}`, error);
    }
  }
}

/** Point persistence at a folder and restore any trails left by a previous run. */
export function configureTrailPersistence(dir) {
  persistDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.tmp')) {
      fs.rmSync(path.join(dir, name), { force: true });
      continue;
    }
    if (!/^\d{4}\.json$/.test(name)) continue;
    const code = name.slice(0, 4);
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (data?.version !== 1 || !Array.isArray(data.students)) continue;
      restoreRoom(code, data);
    } catch (error) {
      console.error(`Could not restore drafting evidence for room ${code}`, error);
    }
  }
}

function restoreRoom(code, data) {
  if (rooms.has(code)) clearTrail(code);
  const room = get(code);
  room.active = !!data.active;
  room.token = String(data.token || '');
  room.reason = String(data.reason || '');
  room.label = String(data.label || '');
  room.independent = cleanWindows(data.independent);
  room.changed = Number(data.changed) || Date.now();
  for (const item of data.students) {
    const events = Array.isArray(item.events) ? item.events : [];
    const student = {
      id: Number(item.id),
      name: String(item.name || ''),
      text: String(item.text || ''),
      pending: item.pending || null,
      lastCheckpoint: Number(item.lastCheckpoint) || 0,
      events,
      // The server went down mid-lesson: the next save records a visible gap.
      gap: room.active,
    };
    const bytes = events.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)), 0);
    room.bytes += bytes;
    totalBytes += bytes;
    room.students.set(student.id, student);
  }
}

/** Test hook: forget in-memory trails without touching disk (simulates a restart). */
export function dropTrailsFromMemory() {
  rooms.clear();
  totalBytes = 0;
  dirtyRooms.clear();
  lastPersistAt.clear();
}
export function textDelta(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { start, removed: before.length - start - end, inserted: after.slice(start, after.length - end) };
}
function get(code) {
  if (!rooms.has(code)) rooms.set(code, { code, active: false, token: '', reason: '', label: '', independent: [], students: new Map(), bytes: 0, changed: Date.now() });
  return rooms.get(code);
}

function cleanWindows(raw) {
  return (Array.isArray(raw) ? raw : [])
    .slice(-50)
    .map((w) => ({ start: Number(w?.start) || 0, end: w?.end == null ? null : Number(w.end) || 0 }))
    .filter((w) => w.start > 0 && (w.end === null || w.end >= w.start));
}

/** Teacher-declared independent writing: a room-wide window stamped on the trail. */
export function setIndependentWriting(code, on, at = Date.now()) {
  const room = get(code);
  const open = room.independent.at(-1);
  if (on && !(open && open.end === null)) room.independent.push({ start: at, end: null });
  if (!on && open && open.end === null) open.end = at;
  room.changed = at;
  markDirty(code);
  persistTrails(at, { force: true });
  return trailStatus(code);
}

export function independentWindows(code) {
  return (rooms.get(code)?.independent || []).map((w) => ({ ...w }));
}

/** Quiet red-dot signal: look at this trail first — not a cheating verdict. */
export function studentTrailAttention(student) {
  if (!student?.events?.length) return false;
  let pastes = 0;
  let lastAt = Number(student.events[0].at) || 0;
  for (const event of student.events) {
    const at = Number(event.at) || lastAt;
    if (event.type === 'paste') {
      pastes += 1;
      const inserted = String(event.inserted || '').length;
      if (pastes >= 2 || inserted >= LARGE_PASTE) return true;
      if (at - lastAt >= QUIET_MS && inserted >= 80) return true;
    } else if (event.type === 'change') {
      const inserted = String(event.inserted || '').length;
      if (inserted >= LARGE_JUMP) return true;
      if (at - lastAt >= QUIET_MS && inserted >= 150) return true;
    }
    if (['baseline', 'resume', 'gap', 'change', 'paste'].includes(event.type)) lastAt = at;
  }
  return false;
}

function attentionIdsForRoom(room) {
  if (!room) return [];
  return [...room.students.values()]
    .filter((student) => studentTrailAttention(student))
    .map((student) => Number(student.id))
    .filter(Boolean);
}

export function trailStatus(code) {
  const room = rooms.get(code);
  return {
    active: !!room?.active,
    token: room?.token || '',
    reason: room?.reason || '',
    label: room?.label || '',
    attentionIds: attentionIdsForRoom(room),
    independentSince: room?.independent?.at(-1)?.end === null ? room.independent.at(-1).start : 0,
  };
}
function append(room, student, event) {
  const bytes = Buffer.byteLength(JSON.stringify(event));
  markDirty(room.code);
  if (room.bytes + bytes > MAX_ROOM_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES || student.events.length >= 3000) {
    room.active = false;
    room.reason = 'Learning trail storage limit reached. Save this session before resetting the class board.';
    room.changed = Date.now();
    return false;
  }
  student.events.push(event);
  room.bytes += bytes;
  totalBytes += bytes;
  room.changed = Date.now();
  return true;
}
function ensureStudent(room, row, type = 'baseline', at = Date.now()) {
  const key = Number(row.id);
  let student = room.students.get(key);
  if (!student) {
    if (room.students.size >= 500) {
      room.active = false;
      room.reason = 'Learning trail student limit reached. Save this session before resetting the class board.';
      return null;
    }
    student = { id: key, name: String(row.name || '').slice(0, 160), text: String(row.text || '').slice(0, 50000), pending: null, events: [] };
    room.students.set(key, student);
    if (!append(room, student, { type, at, text: student.text })) student.text = '';
  }
  return student;
}
function flush(room, student, at = Date.now()) {
  if (!student.pending) return;
  const { text, receivedAt } = student.pending;
  const delta = textDelta(student.text, text);
  if (!delta.removed && !delta.inserted) { student.pending = null; return; }
  if (append(room, student, { type: 'change', at: receivedAt, ...delta })) {
    student.text = text;
    student.pending = null;
    student.lastCheckpoint = at;
  } else student.pending = null;
}
export function setTrailRecording(code, active, rows, at = Date.now(), options = {}) {
  const room = get(code);
  if (room.active === active) return trailStatus(code);
  if (active && room.reason) throw new Error(room.reason);
  for (const student of room.students.values()) flush(room, student, at);
  if (active && room.reason) throw new Error(room.reason);
  room.active = active;
  room.token = randomUUID();
  if (active) {
    const label = String(options?.label ?? room.label ?? '').trim().slice(0, 80);
    room.label = label;
  }
  for (const row of rows) {
    if (room.reason) break;
    const existed = room.students.has(Number(row.id));
    const student = ensureStudent(room, row, 'baseline', at);
    if (!student) break;
    if (active && existed) {
      const text = String(row.text || '').slice(0, 50000);
      if (append(room, student, { type: 'resume', at, text })) student.text = text;
    } else if (!active) append(room, student, { type: 'stop', at });
  }
  room.changed = at;
  markDirty(code);
  persistTrails(at, { force: true });
  return trailStatus(code);
}
export function recordTrailText(code, beforeRow, text, metadata = {}, at = Date.now()) {
  const room = rooms.get(code);
  if (!room?.active) return;
  const student = ensureStudent(room, beforeRow, 'baseline', at);
  if (!room.active || !student) return;
  const accepted = String(text).slice(0, 50000);
  if (metadata.paste === true) {
    flush(room, student, at);
    const delta = textDelta(student.text, accepted);
    if (append(room, student, { type: 'paste', at, ...delta })) student.text = accepted;
    student.gap = false;
    return;
  }
  if (metadata.token !== room.token || student.gap) {
    flush(room, student, at);
    if (append(room, student, { type: 'gap', at, text: accepted })) student.text = accepted;
    student.gap = false;
    return;
  }
  if (accepted === (student.pending?.text ?? student.text)) return;
  student.pending = { text: accepted, receivedAt: at };
  markDirty(code);
  if (at - (student.lastCheckpoint || student.events[0].at) >= 30000) flush(room, student, at);
}
export function disconnectTrail(code, id) {
  const room = rooms.get(code);
  const student = room?.students.get(Number(id));
  if (!student || !room.active) return;
  flush(room, student);
  student.gap = true;
}
const FEEDBACK_VIA = new Set(['note', 'chat', 'set', 'thinking', 'ai', 'comment', 'resource', 'shared']);

export function recordTrailFeedback(code, row, text, at = Date.now(), via = '') {
  const room = rooms.get(code);
  if (!room?.active) return;
  const student = ensureStudent(room, row, 'baseline', at);
  if (!student || !room.active) return;
  flush(room, student, at);
  const tag = FEEDBACK_VIA.has(via) ? { via } : {};
  append(room, student, { type: 'feedback', at, text: String(text).slice(0, 5000), ...tag });
}

/** Tab hidden / visible again, as reported by the student's browser. */
export function recordTrailPresence(code, row, away, at = Date.now()) {
  const room = rooms.get(code);
  if (!room?.active) return;
  const student = ensureStudent(room, row, 'baseline', at);
  if (!student || !room.active) return;
  flush(room, student, at);
  append(room, student, { type: away ? 'away' : 'back', at });
}
export function trailTick(at = Date.now()) {
  for (const [code, room] of rooms) {
    for (const student of room.students.values()) {
      if (student.pending && at - student.pending.receivedAt >= 10000) flush(room, student, at);
    }
    // Unsaved trails expire after 24 hours without changes, including abandoned rooms.
    if (at - room.changed > 86400000) clearTrail(code);
  }
  persistTrails(at);
}
export function trailStudents(code) {
  const room = rooms.get(code);
  if (!room) return [];
  return [...room.students.values()].map((s) => ({
    id: s.id,
    name: s.name,
    checkpoints: s.events.filter(e => !['feedback', 'stop', 'away', 'back'].includes(e.type)).length,
    pasteEvents: s.events.filter(e => e.type === 'paste').length,
    attention: studentTrailAttention(s),
  }));
}
export function readTrail(code, id) {
  const room = rooms.get(code);
  const student = room?.students.get(Number(id));
  if (!student) return null;
  flush(room, student);
  return { id: student.id, name: student.name, events: student.events };
}

/** Paste snippets for the teacher popup: typed paste events, plus gap snapshots that were actually pastes. */
export function pastesFromTrail(trail) {
  const out = [];
  let text = '';
  for (const event of trail?.events || []) {
    if (event.type === 'baseline' || event.type === 'resume' || event.type === 'stop') {
      if (event.text != null) text = String(event.text);
      continue;
    }
    if (event.type === 'paste') {
      const inserted = String(event.inserted || '').trim();
      if (inserted) out.push({ at: Number(event.at) || 0, text: inserted.slice(0, 5000) });
      if (Number.isInteger(event.start) && event.inserted != null) {
        text = text.slice(0, event.start) + event.inserted + text.slice(event.start + (Number(event.removed) || 0));
      }
      continue;
    }
    if (event.type === 'change' && Number.isInteger(event.start) && event.inserted != null) {
      text = text.slice(0, event.start) + event.inserted + text.slice(event.start + (Number(event.removed) || 0));
      continue;
    }
    if (event.type === 'gap' && event.text != null) {
      const next = String(event.text);
      const inserted = String(textDelta(text, next).inserted || '').trim();
      if (inserted) out.push({ at: Number(event.at) || 0, text: inserted.slice(0, 5000) });
      text = next;
    }
  }
  return out;
}
export function clearTrail(code) {
  const room = rooms.get(code);
  if (room) totalBytes -= room.bytes;
  rooms.delete(code);
  dirtyRooms.delete(code);
  lastPersistAt.delete(code);
  if (persistDir) {
    try {
      fs.rmSync(roomFile(code), { force: true });
    } catch (error) {
      console.error(`Could not remove drafting evidence file for room ${code}`, error);
    }
  }
}
export function exportTrails(code, idToExport) {
  const room = rooms.get(code);
  if (!room) return undefined;
  return {
    version: 1,
    reason: room.reason,
    label: room.label || '',
    independent: room.independent.map((w) => ({ ...w })),
    students: [...room.students.values()].map(s => {
      flush(room, s);
      return { exportId: idToExport.get(s.id) || null, name: s.name, events: s.events.map(e => ({ ...e })) };
    }),
  };
}
export function validateTrails(raw) {
  if (raw == null) return;
  if (raw.version !== 1 || !Array.isArray(raw.students) || raw.students.length > 500 || Buffer.byteLength(JSON.stringify(raw)) > MAX_ROOM_BYTES + 256000) throw new Error('Invalid or oversized Learning trail');
  if (raw.independent !== undefined && (!Array.isArray(raw.independent) || raw.independent.length > 50)) throw new Error('Invalid Learning trail independent writing');
  const identities = new Set();
  let eventBytes = 0;
  for (const student of raw.students) {
    if (student.exportId != null) {
      if (typeof student.exportId !== 'string' || identities.has(student.exportId)) throw new Error('Duplicate or invalid Learning trail identity');
      identities.add(student.exportId);
    }
    if (!Array.isArray(student.events) || student.events.length > 3000) throw new Error('Invalid Learning trail events');
    let text = '', lastAt = 0;
    if (student.events.length && student.events[0].type !== 'baseline') throw new Error('Learning trail must begin with a baseline');
    for (const e of student.events) {
      eventBytes += Buffer.byteLength(JSON.stringify(e));
      if (eventBytes > MAX_ROOM_BYTES) throw new Error('Oversized Learning trail events');
      if (!Number.isFinite(e.at) || e.at < lastAt) throw new Error('Invalid Learning trail timestamp');
      lastAt = e.at;
      if (['baseline', 'resume', 'gap'].includes(e.type)) {
        if (typeof e.text !== 'string' || e.text.length > 50000) throw new Error('Invalid Learning trail baseline');
        text = e.text;
      } else if (['change', 'paste'].includes(e.type)) {
        if (!Number.isInteger(e.start) || !Number.isInteger(e.removed) || e.start < 0 || e.removed < 0 || e.start + e.removed > text.length || typeof e.inserted !== 'string') throw new Error('Invalid Learning trail change');
        text = text.slice(0, e.start) + e.inserted + text.slice(e.start + e.removed);
        if (text.length > 50000) throw new Error('Oversized Learning trail text');
      } else if (e.type === 'feedback') {
        if (typeof e.text !== 'string' || e.text.length > 5000) throw new Error('Invalid Learning trail feedback');
        if (e.via !== undefined && !FEEDBACK_VIA.has(e.via)) throw new Error('Invalid Learning trail feedback');
      } else if (!['stop', 'away', 'back'].includes(e.type)) throw new Error('Unknown Learning trail event');
    }
  }
  if (totalBytes + Buffer.byteLength(JSON.stringify(raw)) > MAX_TOTAL_BYTES) throw new Error('Learning trail memory limit reached');
}
export function importTrails(code, raw, exportToId) {
  clearTrail(code);
  if (!raw) return;
  const room = get(code);
  room.reason = String(raw.reason || '').slice(0, 200);
  room.label = String(raw.label || '').trim().slice(0, 80);
  const lastAt = raw.students.reduce((max, s) => Math.max(max, Number(s.events.at(-1)?.at) || 0), 0);
  room.independent = cleanWindows(raw.independent).map((w) => (w.end === null ? { start: w.start, end: Math.max(w.start, lastAt) } : w));
  let archivedId = -1;
  for (const item of raw.students) {
    const id = exportToId.get(item.exportId) || archivedId--;
    const student = { id, name: String(item.name || '').slice(0, 160), text: '', pending: null, events: [] };
    room.students.set(id, student);
    for (const rawEvent of item.events) {
      const { type, at, text, start, removed, inserted, via } = rawEvent;
      const e = { type, at, ...(text !== undefined ? { text } : {}), ...(start !== undefined ? { start, removed, inserted } : {}), ...(via !== undefined ? { via } : {}) };
      append(room, student, e);
      if (['baseline', 'resume', 'gap'].includes(type)) student.text = text;
      if (['change', 'paste'].includes(type)) student.text = student.text.slice(0, start) + inserted + student.text.slice(start + removed);
    }
  }
  // Reopening a saved lesson must never silently restart recording.
  room.active = false;
  markDirty(code);
  persistTrails(Date.now(), { force: true });
}
