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
