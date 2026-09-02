const LAST_TEACHER_ROOM_KEY = 'iboard-last-teacher-room';

/** Last room this browser successfully opened as a teacher. */
export function lastTeacherRoomCode() {
  if (typeof window === 'undefined') return '';
  try {
    const code = String(window.localStorage.getItem(LAST_TEACHER_ROOM_KEY) || '')
      .replace(/\D/g, '')
      .slice(0, 4);
    return code.length === 4 ? code : '';
  } catch {
    return '';
  }
}

/** Remember only confirmed teacher rooms, never half-entered codes. */
export function rememberTeacherRoomCode(value) {
  if (typeof window === 'undefined') return;
  const code = String(value || '').replace(/\D/g, '').slice(0, 4);
  if (code.length !== 4) return;
  try {
    window.localStorage.setItem(LAST_TEACHER_ROOM_KEY, code);
  } catch {
    /* Private browsing or blocked storage should not prevent room entry. */
  }
}

/** Room code the active teacher console last joined. */
export function activeTeacherRoomCode() {
  return String(typeof window !== 'undefined' ? window.__iboardTeacherRoomCode || '' : '')
    .replace(/\D/g, '')
    .slice(0, 4)
    .padStart(4, '0');
}

/** Re-assert teacher role on the socket before a teacher-only action. */
export function ensureTeacherRoom(socket, cb) {
  if (!socket?.connected) {
    cb?.({ ok: false, error: 'Not connected to the room' });
    return;
  }
  const code = activeTeacherRoomCode();
  if (code.length !== 4) {
    cb?.({ ok: false, error: 'Open the room as teacher first' });
    return;
  }
  socket.emit('teacher:join', { code }, cb);
}
