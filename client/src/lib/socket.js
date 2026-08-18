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

  if (typeof window !== 'undefined') {
    socket.on('room:state', (payload) => {
      if (payload?.room) dispatchWindowEvent('iboard:room-state', payload.room);
    });

    socket.onAnyOutgoing((eventName, payload) => {
      if (eventName !== 'teacher:join') return;
      const code = String(payload?.code || '');
      window.__iboardTeacherSocket = socket;
      window.__iboardTeacherRoomCode = code;
      dispatchWindowEvent('iboard:teacher-socket', { socket, code });
    });
  }

  return socket;
}
