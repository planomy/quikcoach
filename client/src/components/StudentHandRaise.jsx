import { useEffect, useMemo, useState } from 'react';

function HandIcon({ className = 'h-5 w-5' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11.5V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V14" />
      <path d="M17 13.5V12a1.5 1.5 0 0 1 3 0v3.5a6.5 6.5 0 0 1-6.5 6.5h-1.2A6.3 6.3 0 0 1 6 15.7V13a2 2 0 0 1 2-2h0" />
      <path d="M5 12v1.5a1.5 1.5 0 0 0 3 0V12" />
    </svg>
  );
}

/**
 * Header hand control — quick private question to the teacher while writing.
 */
export default function StudentHandRaise({ socket }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [questions, setQuestions] = useState([]);

  useEffect(() => {
    if (!socket) return undefined;
    const onState = (payload) => setQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    socket.on('qna:student', onState);
    socket.emit('student:qna-sync', {});
    return () => socket.off('qna:student', onState);
  }, [socket]);

  const handUp = useMemo(
    () => questions.some((question) => question.mine && question.status === 'pending'),
    [questions]
  );

  function close() {
    if (sending) return;
    setOpen(false);
    setError('');
  }

  function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || !socket) return;
    setSending(true);
    setError('');
    socket.emit('student:qna-submit', { text, anonymous: false }, (ack) => {
      setSending(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not send.');
        return;
      }
      setDraft('');
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
        className={`iboard-header-icon-button grid h-10 w-10 shrink-0 place-items-center rounded-xl border shadow-sm transition ${
          handUp
            ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-500'
        }`}
        aria-label={handUp ? 'Hand up — ask another question' : 'Raise hand to ask the teacher'}
        aria-pressed={handUp}
      >
        <HandIcon />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-4 backdrop-blur-[1px] sm:items-center">
          <form
            onSubmit={submit}
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hand-raise-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
          >
            <div className="px-5 py-5">
              <h2 id="hand-raise-title" className="font-display text-lg font-black text-slate-950 dark:text-white">
                Ask your teacher
              </h2>
              <textarea
                autoFocus
                value={draft}
                maxLength={500}
                rows={4}
                onChange={(event) => setDraft(event.target.value.slice(0, 500))}
                placeholder="What do you need help with?"
                className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-rose-400 focus:border-rose-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              {error ? <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-950 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={sending}
                onClick={close}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
