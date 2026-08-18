import { io } from 'socket.io-client';

function dispatchWindowEvent(name, detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Socket.io client; connects to current origin (or `VITE_SOCKET_URL` if set). */
export function createSocket() {
  const url = import.meta.env.VITE_SOCKET_URL || undefined;
  const socket = io(url, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    // Match server — Pulse question images must not silently drop on receive
    maxHttpBufferSize: 3e6,
  });

  // A reconnect can replay persisted feedback that this still-open tab already displayed.
  // Filter duplicate server ids before StudentView's existing feedback listener sees them.
  const seenFeedbackIds = new Set();
  socket.on('feedback:batch', (payload) => {
    if (!Array.isArray(payload?.items)) return;
    payload.items = payload.items.filter((item) => {
      const id = Number(item?.feedbackId);
      if (!id) return true;
      if (seenFeedbackIds.has(id)) return false;
      seenFeedbackIds.add(id);
      return true;
    });
  });

  if (typeof window !== 'undefined') {
    socket.on('room:state', (payload) => {
      if (!payload?.room) return;
      window.__iboardStudentFormattingEnabled = payload.room.student_formatting !== false;
      dispatchWindowEvent('iboard:room-state', payload.room);
    });

    socket.onAnyOutgoing((eventName, payload) => {
      if (eventName === 'teacher:join') {
        const code = String(payload?.code || '');
        window.__iboardTeacherSocket = socket;
        window.__iboardTeacherRoomCode = code;
        dispatchWindowEvent('iboard:teacher-socket', { socket, code });
        return;
      }
      if (eventName === 'student:join' || eventName === 'student:rejoin') {
        const code = String(payload?.code || '');
        window.__iboardStudentSocket = socket;
        window.__iboardStudentRoomCode = code;
        dispatchWindowEvent('iboard:student-socket', { socket, code });
      }
    });
  }

  return socket;
}
