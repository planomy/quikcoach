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

  // The NOTE button is visually tied to the server acknowledgement. The reliable
  // feedback patch now means ack.ok=true only after the note has been persisted.
  const baseEmit = socket.emit.bind(socket);
  socket.emit = (eventName, ...args) => {
    if (typeof window !== 'undefined' && eventName === 'teacher:distribute') {
      const pendingStudentId = Number(window.__iboardPendingNoteStudentId) || 0;
      const items = Array.isArray(args[0]?.items) ? args[0].items : [];
      const isPendingNote =
        pendingStudentId > 0 &&
        items.length === 1 &&
        Number(items[0]?.studentId) === pendingStudentId;

      if (isPendingNote) {
        window.__iboardPendingNoteStudentId = 0;
        dispatchWindowEvent('iboard:note-send-status', {
          studentId: pendingStudentId,
          status: 'sending',
        });

        const callbackIndex = args.length - 1;
        const originalCallback =
          callbackIndex >= 0 && typeof args[callbackIndex] === 'function' ? args[callbackIndex] : null;

        if (originalCallback) {
          let settled = false;
          let timer = null;
          const finish = (ack) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            dispatchWindowEvent('iboard:note-send-status', {
              studentId: pendingStudentId,
              status: ack?.ok ? 'sent' : 'failed',
            });
            originalCallback(ack);
          };
          args[callbackIndex] = finish;
          timer = setTimeout(
            () => finish({ ok: false, error: 'No response from the server' }),
            6000
          );
        }
      }
    }
    return baseEmit(eventName, ...args);
  };

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
