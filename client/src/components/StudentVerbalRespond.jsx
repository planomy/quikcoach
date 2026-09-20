import { CloseButton } from './PanelActions.jsx';
import { useState } from 'react';

const CONFIDENCE_OPTIONS = [
  ['confident', 'Confident'],
  ['unsure', 'Not confident'],
  ['guessed', 'I guessed'],
];

/**
 * Always-on Respond control — answer a verbal whiteboard question without a teacher-typed prompt.
 * variant="chip" = compact header control that expands full-width under the Inbox title.
 */
export default function StudentVerbalRespond({ socket, compact = false, className = '', variant = 'card' }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [confidence, setConfidence] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const chip = variant === 'chip';

  function submit(event) {
    event?.preventDefault?.();
    const text = draft.trim();
    if (!text || sending || !socket) return;
    setSending(true);
    setMessage('');
    socket.emit('student:verbal-response', { value: text, confidence }, (ack) => {
      setSending(false);
      if (!ack?.ok) {
        setMessage(ack?.error || 'Could not send.');
        return;
      }
      setDraft('');
      setConfidence('');
      setOpen(false);
      setMessage('Sent');
      window.setTimeout(() => setMessage(''), 2000);
    });
  }

  if (!open) {
    if (chip) {
      return (
        <button
          type="button"
          onClick={() => {
            setMessage('');
            setOpen(true);
          }}
          className={`iboard-inbox-answer-chip inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-black tracking-wide transition ${className}`}
          aria-label="Quick answer"
        >
          <span className="grid h-5 w-5 place-items-center rounded-lg bg-[#5a5fc3] text-[14px] leading-none text-white" aria-hidden="true">
            +
          </span>
          <span>{message === 'Sent' ? 'Sent' : 'Answer'}</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setMessage('');
          setOpen(true);
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 text-left transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/50 ${compact ? 'p-3' : 'p-3.5'} ${className}`}
        aria-label="Quick answer"
      >
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {message === 'Sent' ? 'Answer sent' : 'Quick answer'}
        </span>
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-indigo-200 bg-white text-lg font-black text-indigo-700 shadow-sm dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200"
          aria-hidden="true"
        >
          +
        </span>
      </button>
    );
  }

  return (
    <section
      className={`${chip ? 'w-full basis-full' : ''} rounded-2xl border border-[#d5d4e4] bg-white shadow-sm dark:border-indigo-800 dark:bg-slate-900 ${compact || chip ? 'p-3' : 'p-4'} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#5a5fc3] dark:text-indigo-300">Quick answer</p>
        <CloseButton onClick={() => setOpen(false)} label="Close" />
      </div>
      <form onSubmit={submit} className="mt-2 space-y-2">
        <textarea
          autoFocus
          value={draft}
          maxLength={500}
          rows={compact || chip ? 3 : 4}
          onChange={(event) => setDraft(event.target.value.slice(0, 500))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
          placeholder="Type your answer…"
          className="w-full resize-none rounded-xl border border-[#d5d4e4] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#5a5fc3] dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
          Enter sends · Shift+Enter new line
        </p>        <div className="flex flex-wrap gap-1.5">
          {CONFIDENCE_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setConfidence((current) => (current === value ? '' : value))}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                confidence === value
                  ? 'bg-[#5a5fc3] text-white'
                  : 'bg-[#ebeaf8] text-[#52525c] hover:bg-[#e0dff5] dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {message && message !== 'Sent' ? (
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">{message}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-[#ebeaf8] dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-lg bg-[#5a5fc3] px-3 py-1.5 text-xs font-black text-white hover:bg-[#4f54b0] disabled:opacity-40"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function isVerbalLiveActivity(activity) {
  return activity?.type === 'short' && activity?.prompt === 'Verbal question';
}
