import { io } from 'socket.io-client';

function dispatchWindowEvent(name, detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function savedStudentId() {
  if (typeof window === 'undefined') return 0;
  try {
    const raw =
      sessionStorage.getItem('quik-coach-student') ||
      localStorage.getItem('quik-coach-student') ||
      '';
    const parsed = raw ? JSON.parse(raw) : null;
    return Number(parsed?.studentId) || 0;
  } catch {
    return 0;
  }
}

/** Socket.io client; connects to current origin (or `VITE_SOCKET_URL` if set). */
export function createSocket() {
  const url = import.meta.env.VITE_SOCKET_URL || undefined;
  const socket = io(url, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    // Match server — Pulse question images must not silently drop on receive
    maxHttpBufferSize: 10e6,
  });

  const baseEmit = socket.emit.bind(socket);
  const baseOn = socket.on.bind(socket);
  const baseOff = socket.off.bind(socket);

  // Feedback can arrive during the tiny window between a successful join/rejoin and
  // React committing the student identity. Keep it here until the student UI is ready,
  // then hand it to StudentView. Only mark server ids as seen when delivery actually occurs.
  const feedbackListeners = new Set();
  const seenFeedbackIds = new Set();
  const pendingFeedbackBatches = [];
  let feedbackFlushTimer = null;
  let feedbackFlushAttempts = 0;
  let currentStudentId = 0;

  function resolvedStudentId() {
    if (currentStudentId) return currentStudentId;
    if (typeof window !== 'undefined') {
      const globalId = Number(window.__iboardStudentId) || 0;
      if (globalId) return globalId;
    }
    return savedStudentId();
  }

  function studentUiReady() {
    if (typeof document === 'undefined') return true;
    return !!document.querySelector('[role="textbox"][contenteditable]');
  }

  function deliverFeedbackBatch(payload) {
    const sid = resolvedStudentId();
    if (!sid || !studentUiReady() || feedbackListeners.size === 0) return false;

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const fresh = [];
    for (const item of items) {
      if (Number(item?.studentId) !== Number(sid)) continue;
      const feedbackId = Number(item?.feedbackId) || 0;
      if (feedbackId && seenFeedbackIds.has(feedbackId)) continue;
      if (feedbackId) seenFeedbackIds.add(feedbackId);
      fresh.push(item);
    }

    if (fresh.length) {
      const safePayload = { ...(payload || {}), items: fresh };
      for (const listener of [...feedbackListeners]) listener(safePayload);
    }
    return true;
  }

  function scheduleFeedbackFlush(delay = 0) {
    if (feedbackFlushTimer) return;
    feedbackFlushTimer = setTimeout(() => {
      feedbackFlushTimer = null;
      const ready = resolvedStudentId() && studentUiReady() && feedbackListeners.size > 0;
      if (!ready) {
        feedbackFlushAttempts += 1;
        if (feedbackFlushAttempts <= 40) scheduleFeedbackFlush(50);
        return;
      }

      feedbackFlushAttempts = 0;
      const batches = pendingFeedbackBatches.splice(0, pendingFeedbackBatches.length);
      for (const batch of batches) deliverFeedbackBatch(batch);
    }, delay);
  }

  function queueFeedback(payload) {
    if (!Array.isArray(payload?.items) || payload.items.length === 0) return;
    pendingFeedbackBatches.push({ ...(payload || {}), items: [...payload.items] });
    scheduleFeedbackFlush();
  }

  // Register one real Socket.IO listener. StudentView's listener is virtualised below so
  // an early replay cannot be consumed before StudentView knows which student it belongs to.
  baseOn('feedback:batch', queueFeedback);

  socket.on = (eventName, listener) => {
    if (eventName === 'feedback:batch' && typeof listener === 'function') {
      feedbackListeners.add(listener);
      scheduleFeedbackFlush();
      return socket;
    }
    return baseOn(eventName, listener);
  };

  socket.off = (eventName, listener) => {
    if (eventName === 'feedback:batch') {
      if (typeof listener === 'function') feedbackListeners.delete(listener);
      else feedbackListeners.clear();
      return socket;
    }
    return baseOff(eventName, listener);
  };

  // The NOTE button is visually tied to the server acknowledgement. The reliable
  // feedback patch means ack.ok=true only after the note has been persisted.
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

    // Capture the student id synchronously from a successful join/rejoin acknowledgement.
    // Then explicitly ask the durable mailbox for its current state. This gives feedback a
    // second recovery route even if the server's automatic replay landed during React startup.
    if (eventName === 'student:join' || eventName === 'student:rejoin') {
      const callbackIndex = args.length - 1;
      const originalCallback =
        callbackIndex >= 0 && typeof args[callbackIndex] === 'function' ? args[callbackIndex] : null;

      if (originalCallback) {
        const requestPayload = args[0] || {};
        args[callbackIndex] = (ack) => {
          if (ack?.ok) {
            const sid = Number(ack?.student?.id ?? requestPayload?.studentId) || 0;
            if (sid) {
              currentStudentId = sid;
              if (typeof window !== 'undefined') window.__iboardStudentId = sid;
            }
          }

          originalCallback(ack);

          if (ack?.ok && currentStudentId) {
            // Let React render the editor/student identity first, then recover the mailbox.
            setTimeout(() => {
              scheduleFeedbackFlush();
              baseEmit('student:feedback-sync', {}, (syncAck) => {
                if (!syncAck?.ok || !Array.isArray(syncAck.items)) return;
                queueFeedback({ items: syncAck.items, replay: true, source: 'sync' });
              });
            }, 100);
          }
        };
      }
    }

    return baseEmit(eventName, ...args);
  };

  if (typeof window !== 'undefined') {
    baseOn('room:state', (payload) => {
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
