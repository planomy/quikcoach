import { CloseButton } from './PanelActions.jsx';
import { useEffect, useRef, useState } from 'react';
import { ensureTeacherRoom } from '../lib/teacherRoom.js';

const TOGGLE_CLASS = 'text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300';

export default function QuestionInboxReply({
  socket,
  studentId,
  studentName,
  questionText = '',
  onSent,
  className = '',
  open: openProp,
  onOpenChange,
  showToggle = true,
  defaultOpen = false,
}) {
  const [openInternal, setOpenInternal] = useState(defaultOpen);
  const open = openProp ?? openInternal;
  const setOpen = onOpenChange ?? setOpenInternal;

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (!field) return;
      if (document.activeElement === field) return;
      field.focus({ preventScroll: true });
      const len = field.value.length;
      try {
        field.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, studentId]);

  function sendReply() {
    const answer = draft.trim();
    const sid = Number(studentId);
    if (!answer || !socket || !sid || busy) return;

    setBusy(true);
    setError('');
    setSent(false);

    const quote = String(questionText || '').trim().slice(0, 200);
    const text = quote ? `Re: “${quote}”\n\n${answer}` : answer;

    ensureTeacherRoom(socket, (joinAck) => {
      if (!joinAck?.ok) {
        setBusy(false);
        setError(joinAck?.error || 'Open the room as teacher first');
        return;
      }
      socket.emit('teacher:distribute', { items: [{ studentId: sid, text }] }, (ack) => {
        setBusy(false);
        if (!ack?.ok) {
          setError(ack?.error || 'Could not send this reply');
          return;
        }
        setDraft('');
        setSent(true);
        setOpen(false);
        onSent?.();
        setTimeout(() => setSent(false), 2800);
      });
    });
  }

  if (showToggle && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${TOGGLE_CLASS} ${className}`}>
        Reply
      </button>
    );
  }

  return (
    <div className={className}>
      {showToggle ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-slate-400">Return sends · Shift+Return new line</p>
          <CloseButton onClick={() => setOpen(false)} label="Close" />
        </div>
      ) : (
        <p className="mb-2 text-[11px] font-medium text-slate-400">Return sends · Shift+Return new line</p>
      )}
      <textarea
        ref={textareaRef}
        rows={3}
        maxLength={5000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendReply();
          }
        }}
        placeholder={`Private reply${studentName ? ` to ${studentName}` : ''}…`}
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {sent ? (
          <p className="mr-auto text-xs font-semibold text-emerald-700 dark:text-emerald-300">Sent</p>
        ) : null}
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={sendReply}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
