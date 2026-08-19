import { useEffect, useState } from 'react';

function currentTeacherSocket() {
  if (typeof window === 'undefined') return null;
  return window.__iboardTeacherSocket || null;
}

function currentTeacherCode() {
  if (typeof window === 'undefined') return '';
  return String(window.__iboardTeacherRoomCode || '');
}

function currentFormattingEnabled() {
  if (typeof window === 'undefined') return true;
  return window.__iboardStudentFormattingEnabled !== false;
}

export default function StudentFormattingControl({ compact = false }) {
  const [socket, setSocket] = useState(currentTeacherSocket);
  const [roomCode, setRoomCode] = useState(currentTeacherCode);
  const [enabled, setEnabled] = useState(currentFormattingEnabled);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onTeacherSocket = (event) => {
      const nextSocket = event.detail?.socket || currentTeacherSocket();
      const nextCode = String(event.detail?.code || currentTeacherCode());
      if (nextSocket) setSocket(nextSocket);
      if (nextCode) setRoomCode(nextCode);
      setEnabled(currentFormattingEnabled());
    };
    const onRoomState = (event) => {
      const room = event.detail;
      if (!room?.code) return;
      const activeCode = String(currentTeacherCode() || roomCode || '');
      if (activeCode && String(room.code) !== activeCode) return;
      setRoomCode(String(room.code));
      setEnabled(room.student_formatting !== false);
    };

    window.addEventListener('iboard:teacher-socket', onTeacherSocket);
    window.addEventListener('iboard:room-state', onRoomState);
    return () => {
      window.removeEventListener('iboard:teacher-socket', onTeacherSocket);
      window.removeEventListener('iboard:room-state', onRoomState);
    };
  }, [roomCode]);

  if (!socket || !roomCode) return null;

  function toggleFormatting() {
    if (busy) return;
    const next = !enabled;
    setEnabled(next);
    window.__iboardStudentFormattingEnabled = next;
    setBusy(true);
    socket.emit('teacher:settings', { student_formatting: next }, (ack) => {
      setBusy(false);
      if (!ack?.ok) {
        setEnabled(!next);
        window.__iboardStudentFormattingEnabled = !next;
      }
    });
  }

  return (
    <div
      className={
        compact
          ? 'flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900'
          : 'fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95'
      }
    >
      <div className="min-w-0">
        <p className={`${compact ? 'px-2 text-[10px]' : 'text-[10px]'} font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400`}>
          Student formatting
        </p>
        {!compact && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Bold · underline · highlight</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={busy}
        onClick={toggleFormatting}
        className={`${compact ? 'min-w-[3.1rem] rounded-lg px-2.5 py-1.5' : 'min-w-[3.75rem] rounded-xl px-3 py-2'} text-xs font-black uppercase tracking-wide text-white shadow-sm transition disabled:opacity-60 ${
          enabled ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-500 hover:bg-slate-600'
        }`}
        title={enabled ? 'Turn student formatting off' : 'Turn student formatting on'}
      >
        {busy ? '…' : enabled ? 'On' : 'Off'}
      </button>
    </div>
  );
}
