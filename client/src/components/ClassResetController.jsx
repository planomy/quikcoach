import { useEffect } from 'react';
import {
  clearStudentSession,
  forgetRecentStudentSession,
  readSavedStudentSession,
  saveStudentSession,
} from '../lib/studentSession.js';
import { clearDismissedInboxIds } from '../lib/inboxDismiss.js';

function studentSocket() {
  return typeof window !== 'undefined' ? window.__iboardStudentSocket || null : null;
}

function cleanYear(value) {
  const year = String(value || '').trim().toLowerCase();
  return /^yr(?:[2-9]|1[0-2])$/.test(year) ? year : '';
}

export default function ClassResetController({ role }) {
  useEffect(() => {
    if (role !== 'student') return undefined;

    let socket = studentSocket();
    let detach = () => {};

    const bind = (nextSocket) => {
      detach();
      socket = nextSocket;
      if (!socket) return;
      const onReset = (payload = {}) => {
        const code = String(payload.code || window.__iboardStudentRoomCode || '')
          .replace(/\D/g, '')
          .slice(0, 4);
        const studentId = window.__iboardStudentId;
        const saved = readSavedStudentSession();
        const name = String(payload.name || saved?.name || '').trim().slice(0, 120);
        const yearLevel = cleanYear(payload.yearLevel || saved?.year);

        if (code.length === 4 && studentId) clearDismissedInboxIds(code, studentId);
        clearStudentSession();
        if (code.length === 4) forgetRecentStudentSession(code);
        window.__iboardStudentId = 0;
        window.__iboardStudentRoomCode = '';

        // If this browser already belonged to a student in the room, create their
        // fresh card immediately. StudentView will restore that new id after reload.
        // Browsers with blocked storage or no remembered identity simply land at Join.
        if (code.length === 4 && name && socket?.connected) {
          let finished = false;
          const reload = () => {
            if (finished) return;
            finished = true;
            window.location.reload();
          };
          const fallback = setTimeout(reload, 900);

          socket.emit('student:join', { code, name }, (ack) => {
            if (finished) return;
            if (!ack?.ok || !ack.student?.id) {
              clearTimeout(fallback);
              reload();
              return;
            }

            const newStudentId = Number(ack.student.id);
            const finishJoin = () => {
              if (finished) return;
              clearTimeout(fallback);
              saveStudentSession({
                code,
                studentId: newStudentId,
                name: ack.student?.name || name,
                year: yearLevel,
              });
              window.__iboardStudentId = newStudentId;
              window.__iboardStudentRoomCode = code;
              reload();
            };

            if (!yearLevel) {
              finishJoin();
              return;
            }

            let yearFinished = false;
            const finishYear = () => {
              if (yearFinished) return;
              yearFinished = true;
              finishJoin();
            };
            const yearFallback = setTimeout(finishYear, 250);
            socket.emit('student:year', { year_level: yearLevel }, () => {
              clearTimeout(yearFallback);
              finishYear();
            });
          });
          return;
        }

        window.location.reload();
      };
      socket.on('class:reset', onReset);
      detach = () => socket?.off('class:reset', onReset);
    };

    bind(socket);
    const onStudentSocket = (event) => bind(event.detail?.socket || studentSocket());
    window.addEventListener('iboard:student-socket', onStudentSocket);
    return () => {
      detach();
      window.removeEventListener('iboard:student-socket', onStudentSocket);
    };
  }, [role]);

  return null;
}
