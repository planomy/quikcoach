import { io } from 'socket.io-client';

/** Socket.io client; connects to current origin (or `VITE_SOCKET_URL` if set). */
export function createSocket() {
  const url = import.meta.env.VITE_SOCKET_URL || undefined;
  return io(url, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    // Match server — Pulse question images must not silently drop on receive
    maxHttpBufferSize: 3e6,
  });
}
