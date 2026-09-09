import { useState } from 'react';

/**
 * Compact private reply under a teacher note (Inbox or urgent toast).
 * Replies are quiet by default — teacher decides if a follow-up should interrupt.
 */
export default function StudentNoteReply({
  socket,
  feedbackId,
  onSent,
  compact = false,
  autoFocus = false,
  className = '',
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const fid = Number(feedbackId);

  function sendReply() {
    const text = draft.trim();
    if (!text || !socket || !fid || busy) return;
    setBusy(true);
    setError('');
    socket.emit('student:note-reply', { feedbackId: fid, text }, (ack) => {
      setBusy(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not send reply');
        return;
      }
      setDraft('');
      setSent(true);
      onSent?.(ack.item);
      window.setTimeout(() => setSent(false), 2400);
    });
  }

  if (!fid) return null;

  return (
    <div className={className}>
      <label className="block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
        Reply to teacher
      </label>
      <textarea
        value={draft}
        autoFocus={autoFocus}
        rows={compact ? 2 : 3}
        maxLength={2000}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendReply();
          }
        }}
        placeholder="Private reply…"
        className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-400">
          {sent ? <span className="text-emerald-600 dark:text-emerald-300">Sent</span> : 'Enter sends · Shift+Enter new line'}
        </p>
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={sendReply}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy ? 'Sending…' : 'Send reply'}
        </button>
      </div>
      {error ? <p className="mt-1 text-[11px] font-semibold text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
