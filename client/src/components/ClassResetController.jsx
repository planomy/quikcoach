import { useEffect, useState } from 'react';
import { clearStudentSession, forgetRecentStudentSession } from '../lib/studentSession.js';

function teacherSocket() {
  return typeof window !== 'undefined' ? window.__iboardTeacherSocket || null : null;
}

function studentSocket() {
  return typeof window !== 'undefined' ? window.__iboardStudentSocket || null : null;
}

function findStartButton() {
  return [...document.querySelectorAll('button')].find((button) => {
    const text = button.textContent?.trim();
    return text === 'Clear board & start' || text === 'Start new class' || text === 'Starting…';
  }) || null;
}

function closeConfirmationDialog() {
  const keepButton = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Keep current class'
  );
  keepButton?.click();
}

export default function ClassResetController({ role }) {
  const [message, setMessage] = useState('');

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
        clearStudentSession();
        if (code.length === 4) forgetRecentStudentSession(code);
        window.__iboardStudentId = 0;
        window.__iboardStudentRoomCode = '';
        // A reload gives StudentView a genuinely clean state while preserving a room
        // code already present in the URL, so the student lands back at Join.
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

  useEffect(() => {
    if (role !== 'teacher') return undefined;

    let frame = 0;
    const polish = () => {
      const button = findStartButton();
      if (!button || button.dataset.iboardClassResetBusy === 'true') return;
      if (button.textContent?.trim() === 'Clear board & start') button.textContent = 'Start new class';
      button.dataset.iboardClassReset = 'true';
    };
    const schedulePolish = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        polish();
      });
    };

    const onClick = (event) => {
      const button = event.target?.closest?.('button[data-iboard-class-reset="true"]');
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const socket = teacherSocket();
      if (!socket || button.dataset.iboardClassResetBusy === 'true') return;

      button.dataset.iboardClassResetBusy = 'true';
      button.disabled = true;
      button.textContent = 'Starting…';
      setMessage('');

      socket.emit('teacher:start-new-class', {}, (ack) => {
        button.dataset.iboardClassResetBusy = 'false';
        button.disabled = false;
        button.textContent = 'Start new class';

        if (!ack?.ok) {
          setMessage(ack?.error || 'Could not start a new class');
          return;
        }

        closeConfirmationDialog();
        setMessage('New class ready');
        setTimeout(() => setMessage(''), 1800);
      });
    };

    polish();
    const observer = new MutationObserver(schedulePolish);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('click', onClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', onClick, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [role]);

  if (!message) return null;

  return (
    <div
      role="status"
      className={`fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-black shadow-lg ${
        message === 'New class ready'
          ? 'bg-emerald-600 text-white'
          : 'bg-red-600 text-white'
      }`}
    >
      {message}
    </div>
  );
}
