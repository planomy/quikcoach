import { useState } from 'react';
import { ensureTeacherRoom } from '../lib/teacherRoom.js';

export default function QuestionInboxReply({
  socket,
  studentId,
  studentName,
  questionText = '',
  onSent,
  className = '',
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

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
        onSent?.();
        setTimeout(() => setSent(false), 2800);
      });
    });
  }

  const label = String(studentName || 'Student').trim() || 'Student';

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60 ${className}`}>
      <label className="block text-[10px] font-black uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300">
        Reply to {label}
      </label>
      <textarea
        rows={3}
        maxLength={5000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            sendReply();
          }
        }}
        placeholder={`Write a private answer for ${label}…`}
        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Appears in their Inbox tab</p>
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={sendReply}
          className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy ? 'Sending…' : 'Send note'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{error}</p>}
      {sent && (
        <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          Sent to {label}&apos;s inbox
        </p>
      )}
    </div>
  );
}
