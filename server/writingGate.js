/**
 * Student writing opens when a teacher joins the room and stays open until the
 * teacher moves their board to another room. Freeze and modelling lock it separately.
 * A dropped or sleeping teacher tab never locks the class out.
 * The open flag is stored on the room so a server restart keeps it.
 */

let readOpen = null;
let writeOpen = null;

export function configureWritingGate(db) {
  readOpen = db.prepare('SELECT writing_open FROM rooms WHERE code = ?');
  writeOpen = db.prepare('UPDATE rooms SET writing_open = ? WHERE code = ?');
}

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

/** True once a teacher has opened the room, until they move their board to another room. */
export function writingOpen(io, code) {
  const c = roomCode(code);
  if (c.length !== 4) return false;
  if (roomHasTeacher(io, c)) return true;
  return Number(readOpen?.get(c)?.writing_open) === 1;
}

export function noteTeacherArrived(code) {
  const c = roomCode(code);
  if (c.length !== 4) return;
  writeOpen?.run(1, c);
}

/**
 * The last teacher left this room. Moving the board to another room locks it.
 * A dropped connection leaves writing open.
 */
export function noteTeacherLeft(io, code, { immediate = false, onLock }) {
  const c = roomCode(code);
  if (c.length !== 4) return;
  if (roomHasTeacher(io, c)) return;
  if (!immediate) return;
  writeOpen?.run(0, c);
  onLock?.(c);
}
