import { randomUUID } from 'node:crypto';

// Ephemeral, teacher-owned evidence. No new database or third-party service.
// Limits stop capture visibly; never silently drop the beginning of a trail.
const MAX_ROOM_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const QUIET_MS = 3 * 60 * 1000;
const LARGE_PASTE = 120;
const LARGE_JUMP = 250;
const rooms = new Map();
let totalBytes = 0;
export function textDelta(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { start, removed: before.length - start - end, inserted: after.slice(start, after.length - end) };
}
function get(code) {
  if (!rooms.has(code)) rooms.set(code, { active: false, token: '', reason: '', label: '', students: new Map(), bytes: 0, changed: Date.now() });
  return rooms.get(code);
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
  };
}
function append(room, student, event) {
  const bytes = Buffer.byteLength(JSON.stringify(event));
  if (room.bytes + bytes > MAX_ROOM_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES || student.events.length >= 3000) {
    room.active = false;
    room.reason = 'Draft Trail storage limit reached. Save this session before starting a new class.';
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
      room.reason = 'Draft Trail student limit reached. Save this session before starting a new class.';
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
  return trailStatus(code);
}
export function recordTrailText(code, beforeRow, text, metadata = {}, at = Date.now()) {
  const room = rooms.get(code);
  if (!room?.active) return;
  const student = ensureStudent(room, beforeRow, 'baseline', at);
  if (!room.active || !student) return;
  const accepted = String(text).slice(0, 50000);
  if (metadata.token !== room.token || student.gap) {
    flush(room, student, at);
    if (append(room, student, { type: 'gap', at, text: accepted })) student.text = accepted;
    student.gap = false;
    return;
  }
  if (metadata.paste === true) {
    flush(room, student, at);
    const delta = textDelta(student.text, accepted);
    if (append(room, student, { type: 'paste', at, ...delta })) student.text = accepted;
    return;
  }
  if (accepted === (student.pending?.text ?? student.text)) return;
  student.pending = { text: accepted, receivedAt: at };
  if (at - (student.lastCheckpoint || student.events[0].at) >= 30000) flush(room, student, at);
}
export function disconnectTrail(code, id) {
  const room = rooms.get(code);
  const student = room?.students.get(Number(id));
  if (!student || !room.active) return;
  flush(room, student);
  student.gap = true;
}
export function recordTrailFeedback(code, row, text, at = Date.now()) {
  const room = rooms.get(code);
  if (!room?.active) return;
  const student = ensureStudent(room, row, 'baseline', at);
  if (!student || !room.active) return;
  flush(room, student, at);
  append(room, student, { type: 'feedback', at, text: String(text).slice(0, 5000) });
}
export function trailTick(at = Date.now()) {
  for (const [code, room] of rooms) {
    for (const student of room.students.values()) {
      if (student.pending && at - student.pending.receivedAt >= 10000) flush(room, student, at);
    }
    // Unsaved trails expire after 24 hours without changes, including abandoned rooms.
    if (at - room.changed > 86400000) clearTrail(code);
  }
}
export function trailStudents(code) {
  const room = rooms.get(code);
  if (!room) return [];
  return [...room.students.values()].map((s) => ({
    id: s.id,
    name: s.name,
    checkpoints: s.events.filter(e => e.type !== 'feedback' && e.type !== 'stop').length,
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
export function clearTrail(code) {
  const room = rooms.get(code);
  if (room) totalBytes -= room.bytes;
  rooms.delete(code);
}
export function exportTrails(code, idToExport) {
  const room = rooms.get(code);
  if (!room) return undefined;
  return {
    version: 1,
    reason: room.reason,
    label: room.label || '',
    students: [...room.students.values()].map(s => {
      flush(room, s);
      return { exportId: idToExport.get(s.id) || null, name: s.name, events: s.events.map(e => ({ ...e })) };
    }),
  };
}
export function validateTrails(raw) {
  if (raw == null) return;
  if (raw.version !== 1 || !Array.isArray(raw.students) || raw.students.length > 500 || Buffer.byteLength(JSON.stringify(raw)) > MAX_ROOM_BYTES + 256000) throw new Error('Invalid or oversized Draft Trail');
  const identities = new Set();
  let eventBytes = 0;
  for (const student of raw.students) {
    if (student.exportId != null) {
      if (typeof student.exportId !== 'string' || identities.has(student.exportId)) throw new Error('Duplicate or invalid Draft Trail identity');
      identities.add(student.exportId);
    }
    if (!Array.isArray(student.events) || student.events.length > 3000) throw new Error('Invalid Draft Trail events');
    let text = '', lastAt = 0;
    if (student.events.length && student.events[0].type !== 'baseline') throw new Error('Draft Trail must begin with a baseline');
    for (const e of student.events) {
      eventBytes += Buffer.byteLength(JSON.stringify(e));
      if (eventBytes > MAX_ROOM_BYTES) throw new Error('Oversized Draft Trail events');
      if (!Number.isFinite(e.at) || e.at < lastAt) throw new Error('Invalid Draft Trail timestamp');
      lastAt = e.at;
      if (['baseline', 'resume', 'gap'].includes(e.type)) {
        if (typeof e.text !== 'string' || e.text.length > 50000) throw new Error('Invalid Draft Trail baseline');
        text = e.text;
      } else if (['change', 'paste'].includes(e.type)) {
        if (!Number.isInteger(e.start) || !Number.isInteger(e.removed) || e.start < 0 || e.removed < 0 || e.start + e.removed > text.length || typeof e.inserted !== 'string') throw new Error('Invalid Draft Trail change');
        text = text.slice(0, e.start) + e.inserted + text.slice(e.start + e.removed);
        if (text.length > 50000) throw new Error('Oversized Draft Trail text');
      } else if (e.type === 'feedback') {
        if (typeof e.text !== 'string' || e.text.length > 5000) throw new Error('Invalid Draft Trail feedback');
      } else if (e.type !== 'stop') throw new Error('Unknown Draft Trail event');
    }
  }
  if (totalBytes + Buffer.byteLength(JSON.stringify(raw)) > MAX_TOTAL_BYTES) throw new Error('Draft Trail memory limit reached');
}
export function importTrails(code, raw, exportToId) {
  clearTrail(code);
  if (!raw) return;
  const room = get(code);
  room.reason = String(raw.reason || '').slice(0, 200);
  room.label = String(raw.label || '').trim().slice(0, 80);
  let archivedId = -1;
  for (const item of raw.students) {
    const id = exportToId.get(item.exportId) || archivedId--;
    const student = { id, name: String(item.name || '').slice(0, 160), text: '', pending: null, events: [] };
    room.students.set(id, student);
    for (const rawEvent of item.events) {
      const { type, at, text, start, removed, inserted } = rawEvent;
      const e = { type, at, ...(text !== undefined ? { text } : {}), ...(start !== undefined ? { start, removed, inserted } : {}) };
      append(room, student, e);
      if (['baseline', 'resume', 'gap'].includes(type)) student.text = text;
      if (['change', 'paste'].includes(type)) student.text = student.text.slice(0, start) + inserted + student.text.slice(start + removed);
    }
  }
  // Reopening a saved lesson must never silently restart recording.
  room.active = false;
}
