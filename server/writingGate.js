/** Student writing follows the teacher screen. A refresh keeps the room open briefly. */

const GRACE_MS = 20_000;
const leaveTimers = new Map();

function roomCode(code) {
  return String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

export function roomHasTeacher(io, code) {
  const c = roomCode(code);
  if (c.length !== 4) return false;
  const ids = io.sockets.adapter.rooms.get(`teacher:${c}`);
  if (!ids?.size) return false;
  for (const id of ids) {
    const sock = io.sockets.sockets.get(id);
    if (sock?.data?.role === 'teacher' && roomCode(sock.data.roomCode) === c) return true;
  }
  return false;
}

/** True while a teacher is in the room, and for a few seconds after the last one drops. */
export function writingOpen(io, code) {
  const c = roomCode(code);
  if (c.length !== 4) return false;
  if (leaveTimers.has(c)) return true;
  return roomHasTeacher(io, c);
}

export function noteTeacherArrived(code) {
  const c = roomCode(code);
  const timer = leaveTimers.get(c);
  if (!timer) return;
  clearTimeout(timer);
  leaveTimers.delete(c);
}

/**
 * Last teacher left this room.
 * Switching to another room locks immediately. A dropped connection waits out the grace.
 */
export function noteTeacherLeft(io, code, { immediate = false, onLock }) {
  const c = roomCode(code);
  if (c.length !== 4) return;
  if (roomHasTeacher(io, c)) {
    noteTeacherArrived(c);
    return;
  }
  const existing = leaveTimers.get(c);
  if (existing) {
    clearTimeout(existing);
    leaveTimers.delete(c);
  }
  if (immediate) {
    onLock?.(c);
    return;
  }
  const timer = setTimeout(() => {
    leaveTimers.delete(c);
    if (!roomHasTeacher(io, c)) onLock?.(c);
  }, GRACE_MS);
  leaveTimers.set(c, timer);
}
