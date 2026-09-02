import { useEffect, useMemo, useState } from 'react';

const STATUS_LABELS = {
  pending: 'Waiting',
  published: 'Shared with class',
  answered: 'Done',
  dismissed: 'Handled',
};

const REMOVE_BTN =
  'text-[11px] font-semibold text-slate-500 transition hover:text-red-600 disabled:opacity-40 dark:text-slate-400 dark:hover:text-red-300';

export default function AudienceQnaStudent({ socket, compact = false, collapsed = false, onRequestExpand, embedded = false }) {
  const [questions, setQuestions] = useState([]);
  const [open, setOpen] = useState(!!embedded);
  const [composerExpanded, setComposerExpanded] = useState(true);
  const [draft, setDraft] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onState = (payload) => setQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    socket.on('qna:student', onState);
    socket.emit('student:qna-sync', {});
    return () => socket.off('qna:student', onState);
  }, [socket]);

  const myQuestions = useMemo(
    () => questions
      .filter((question) => question.mine && question.status !== 'dismissed')
      .sort((a, b) => Number(b.id) - Number(a.id)),
    [questions]
  );
  const latestQuestion = myQuestions[0] || null;

  function showPanel() {
    if (collapsed) onRequestExpand?.();
    setOpen(true);
    if (embedded) setComposerExpanded(true);
    setMessage('');
  }

  function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setMessage('');
    socket.emit('student:qna-submit', { text, anonymous }, (ack) => {
      setSending(false);
      if (!ack?.ok) {
        setMessage(ack?.error || 'Could not send your question.');
        return;
      }
      setDraft('');
      setAnonymous(false);
      if (embedded) {
        setComposerExpanded(false);
        setMessage('');
      } else {
        setMessage('Sent.');
      }
    });
  }

  function withdraw(question) {
    if (!question?.mine || deletingId != null) return;
    setDeletingId(question.id);
    setMessage('');
    socket.emit('student:qna-delete', { questionId: question.id }, (ack) => {
      setDeletingId(null);
      if (!ack?.ok) {
        setMessage(ack?.error || 'Could not remove your question.');
        return;
      }
      setQuestions((current) => current.filter((item) => Number(item.id) !== Number(question.id)));
    });
  }

  const showBody = embedded || open;
  const showEmbeddedComposer = embedded && composerExpanded;
  const showEmbeddedSummary = embedded && !composerExpanded;

  if (collapsed) {
    return (
      <button type="button" onClick={showPanel} className="flex w-full items-center justify-between rounded-2xl bg-indigo-600 px-4 py-3 text-left text-white">
        <span className="font-display text-sm font-black">Ask a question</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-indigo-800">Open</span>
      </button>
    );
  }

  return (
    <section className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-slate-900 ${embedded ? 'border-slate-200 dark:border-slate-700' : 'border-slate-200 shadow-card dark:border-slate-700'} ${compact ? 'text-xs' : ''}`}>
      {!embedded && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 bg-indigo-600 px-4 py-3 text-left text-white">
          <span className="font-display text-sm font-black">Ask a question</span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-indigo-800">{open ? 'Close' : 'Open'}</span>
        </button>
      )}

      {showEmbeddedSummary && (
        <div className="flex w-full items-stretch">
          <button
            type="button"
            onClick={() => {
              setComposerExpanded(true);
              setMessage('');
            }}
            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
            aria-expanded={false}
          >
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {latestQuestion ? 'Question sent' : 'Ask a question'}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {latestQuestion
                  ? `${latestQuestion.text.replace(/\s+/g, ' ').trim()} · ${STATUS_LABELS[latestQuestion.status] || 'Waiting'}`
                  : 'Tap to write another question'}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              Open
            </span>
          </button>
          {latestQuestion && latestQuestion.status === 'pending' ? (
            <button
              type="button"
              disabled={deletingId === latestQuestion.id}
              onClick={() => withdraw(latestQuestion)}
              className={`shrink-0 self-center px-3 ${REMOVE_BTN}`}
              aria-label="Remove this question"
            >
              Remove
            </button>
          ) : null}
        </div>
      )}

      {showBody && (showEmbeddedComposer || !embedded) && (
        <div className="space-y-4 p-4">
          {showEmbeddedComposer ? (
            <div className="-mt-1 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setComposerExpanded(false);
                  setMessage('');
                }}
                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
              >
                Close
              </button>
            </div>
          ) : null}
          <form onSubmit={submit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 500))}
              rows={compact ? 2 : 3}
              placeholder="What would you like to ask?"
              className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} className="h-4 w-4 accent-indigo-600" />
                Stay anonymous if shared
              </label>
              <button type="submit" disabled={!draft.trim() || sending} className="ml-auto rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>

          {message ? (
            <p className={`rounded-lg px-3 py-2 text-xs font-bold ${/could not/i.test(message) ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200' : 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'}`}>
              {message}
            </p>
          ) : null}

          {!embedded && myQuestions.length > 0 && (
            <div className="space-y-2">
              {myQuestions.map((question) => (
                <article key={question.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{question.text}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {STATUS_LABELS[question.status] || question.status}
                    {question.anonymous ? ' · anonymous if shared' : ''}
                  </p>
                  {question.status === 'pending' ? (
                    <button
                      type="button"
                      disabled={deletingId === question.id}
                      onClick={() => withdraw(question)}
                      className={`mt-2 ${REMOVE_BTN}`}
                      aria-label="Remove this question"
                    >
                      Remove
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
