/** Breakout room assignment + payload scoping (session-scoped; not class_group). */

export const BREAKOUT_SIZE = 4;
/** Max students per breakout room (viewer + up to 4 peers). */
export const BREAKOUT_ROOM_CAPACITY = 5;

export function normalizeBreakoutRoomId(raw) {
  const id = String(raw ?? '').trim();
  if (!id) return '';
  if (!/^\d{1,3}$/.test(id)) return '';
  const n = Number(id);
  if (!Number.isFinite(n) || n < 1 || n > 40) return '';
  return String(n);
}

export function isBreakoutsActive(roomRow) {
  return Number(roomRow?.breakouts_active) === 1;
}

export function clampBreakoutCount(raw, { min = 1, max = 40 } = {}) {
  const n = Math.floor(Number(raw) || 0);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Chunk students into rooms of ~size (last room may be smaller).
 *  Shuffle first so Start and Reshuffle actually change groups. */
export function autoAssignBreakouts(studentRows, size = BREAKOUT_SIZE) {
  const shuffled = [...(studentRows || [])];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const assignments = [];
  let roomCount = 0;
  for (let i = 0; i < shuffled.length; i += size) {
    roomCount += 1;
    const roomId = String(roomCount);
    for (const row of shuffled.slice(i, i + size)) {
      assignments.push({ studentId: Number(row.id), breakout_room_id: roomId });
    }
  }
  return { roomCount, assignments };
}

/** Always expose rooms 1..roomCount so empty rooms stay assignable. */
export function buildBreakoutsMeta(studentRows, active, roomCount = 0) {
  const byRoom = new Map();
  for (const row of studentRows || []) {
    const id = normalizeBreakoutRoomId(row.breakout_room_id);
    if (!id) continue;
    if (!byRoom.has(id)) byRoom.set(id, []);
    byRoom.get(id).push(Number(row.id));
  }
  const declared = active ? clampBreakoutCount(roomCount, { min: 0, max: 40 }) : 0;
  const maxFromMembers = [...byRoom.keys()].reduce((m, id) => Math.max(m, Number(id) || 0), 0);
  const total = active ? Math.max(declared, maxFromMembers) : 0;
  const rooms = [];
  for (let i = 1; i <= total; i += 1) {
    const id = String(i);
    rooms.push({
      id,
      label: `Room ${id}`,
      memberIds: byRoom.get(id) || [],
    });
  }
  return {
    active: !!active,
    roomCount: total,
    rooms,
  };
}

/** Students only ever see themselves (+ breakout peers when active). */
export function scopeStudentsForViewer(allStudents, viewerStudentId, breakoutsOn) {
  const viewerId = Number(viewerStudentId);
  const list = Array.isArray(allStudents) ? allStudents : [];
  const me = list.find((s) => Number(s.id) === viewerId);
  if (!me) return [];
  if (!breakoutsOn) return [me];
  const roomId = normalizeBreakoutRoomId(me.breakout_room_id);
  if (!roomId) return [me];
  return list.filter(
    (s) => Number(s.id) === viewerId || normalizeBreakoutRoomId(s.breakout_room_id) === roomId
  );
}

export function peerStudentIds(allStudents, authorStudent, breakoutsOn) {
  const authorId = Number(authorStudent?.id);
  if (!authorId) return [];
  if (!breakoutsOn) return null; // null = broadcast to whole room channel
  const roomId = normalizeBreakoutRoomId(authorStudent.breakout_room_id);
  const list = Array.isArray(allStudents) ? allStudents : [];
  if (!roomId) return [authorId];
  return list
    .filter((s) => normalizeBreakoutRoomId(s.breakout_room_id) === roomId)
    .map((s) => Number(s.id));
}
