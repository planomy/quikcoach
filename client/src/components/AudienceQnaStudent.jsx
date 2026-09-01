import { useEffect, useMemo, useState } from 'react';

const STATUS_LABELS = {
  pending: 'Waiting for facilitator',
  published: 'Shown',
  answered: 'Answered',
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

  const publicQuestions = useMemo(
    () => questions
      .filter((question) => question.status === 'published' || question.status === 'answered')
      .sort((a, b) => Number(b.votes) - Number(a.votes) || Number(b.id) - Number(a.id)),
    [questions]
  );
  const liveQuestions = useMemo(
    () => publicQuestions.filter((question) => question.status === 'published'),
    [publicQuestions]
  );
  const myPrivateQuestions = useMemo(
    () => questions
      .filter((question) => question.mine && question.status !== 'published' && question.status !== 'answered' && question.status !== 'dismissed')
      .sort((a, b) => Number(b.id) - Number(a.id)),
    [questions]
  );

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

  function vote(question) {
    if (question.mine) return;
    socket.emit('student:qna-vote', { questionId: question.id }, (ack) => {
      if (!ack?.ok) setMessage(ack?.error || 'Could not update your vote.');
    });
  }

  const statusLabel = liveQuestions.length ? `${liveQuestions.length} live` : open ? 'Close' : 'Open';
  const showBody = embedded || open;
  const latestPendingQuestion = myPrivateQuestions[0] || null;
  const showEmbeddedComposer = embedded && composerExpanded;
  const showEmbeddedSummary = embedded && !composerExpanded;

  if (collapsed) {
    return (
      <button type="button" onClick={showPanel} className="flex w-full items-center justify-between rounded-2xl bg-indigo-600 px-4 py-3 text-left text-white">
        <span className="font-display text-sm font-black">Ask a question</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-indigo-800">{liveQuestions.length ? `${liveQuestions.length} live` : 'Open'}</span>
      </button>
    );
  }

  return (
    <section className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-slate-900 ${embedded ? 'border-slate-200 dark:border-slate-700' : 'border-slate-200 shadow-card dark:border-slate-700'} ${compact ? 'text-xs' : ''}`}>
      {embedded ? <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-1 bg-indigo-500" /> : null}
      {!embedded && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 bg-indigo-600 px-4 py-3 text-left text-white">
          <span className="font-display text-sm font-black">Ask a question</span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-indigo-800">{statusLabel}</span>
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
            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 pl-5 text-left"
            aria-expanded={false}
          >
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {latestPendingQuestion ? 'Question sent' : 'Ask a question'}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {latestPendingQuestion
                  ? `${latestPendingQuestion.text.replace(/\s+/g, ' ').trim()} · ${STATUS_LABELS[latestPendingQuestion.status] || 'Waiting for facilitator'}`
                  : 'Tap to write another question'}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              Open
            </span>
          </button>
          {latestPendingQuestion ? (
            <button
              type="button"
              disabled={deletingId === latestPendingQuestion.id}
              onClick={() => withdraw(latestPendingQuestion)}
              className={`shrink-0 self-center px-3 ${REMOVE_BTN}`}
              aria-label="Remove this question"
            >
              Remove
            </button>
          ) : null}
        </div>
      )}

      {showEmbeddedSummary && publicQuestions.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 px-4 pb-4 pl-5 pt-3 dark:border-slate-800">
          {publicQuestions.map((question) => (
            <article key={question.id} className="relative flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60">
              <button
                type="button"
                disabled={question.mine || question.status === 'answered'}
                onClick={() => vote(question)}
                title={question.status === 'answered' ? 'This question is finished' : question.mine ? 'You cannot vote for your own question' : question.voted ? 'Remove your vote' : 'Vote for this question'}
                className={`flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-[11px] font-black ${question.voted ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300'} disabled:opacity-50`}
              >
                <span>▲</span><span>{question.votes}</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-950 dark:text-white">{question.text}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{question.author} · {STATUS_LABELS[question.status] || question.status}</p>
                {question.mine ? (
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
              </div>
            </article>
          ))}
        </div>
      )}

      {showBody && (showEmbeddedComposer || !embedded) && (
        <div className={`space-y-4 p-4 ${embedded ? 'pl-5' : ''}`}>
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
            <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Your question</label>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 500))}
              rows={compact ? 2 : 3}
              placeholder="What would you like the facilitator to explain or ask the room?"
              className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} className="h-4 w-4 accent-indigo-600" />
                Anonymous if shown
              </label>
              <button type="submit" disabled={!draft.trim() || sending} className="ml-auto rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
            <div className="mt-1 text-right text-[10px] font-semibold text-slate-400">{draft.length}/500</div>
          </form>

          {message && (
            <p
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                /could not/i.test(message)
                  ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                  : 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'
              }`}
            >
              {message}
            </p>
          )}

          {!embedded && myPrivateQuestions.length > 0 && (
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-wide text-slate-500">My questions</h3>
              <div className="mt-2 space-y-2">
                {myPrivateQuestions.map((question) => (
                  <article key={question.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{question.text}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{STATUS_LABELS[question.status] || question.status}{question.anonymous ? ' · anonymous if shown' : ''}</p>
                    <button
                      type="button"
                      disabled={deletingId === question.id}
                      onClick={() => withdraw(question)}
                      className={`mt-2 ${REMOVE_BTN}`}
                      aria-label="Remove this question"
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {(showEmbeddedComposer || !embedded) && publicQuestions.length > 0 && (
            <div className="space-y-2">
              {publicQuestions.map((question) => (
                <article key={question.id} className="relative flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60">
                  <button
                    type="button"
                    disabled={question.mine || question.status === 'answered'}
                    onClick={() => vote(question)}
                    title={question.status === 'answered' ? 'This question is finished' : question.mine ? 'You cannot vote for your own question' : question.voted ? 'Remove your vote' : 'Vote for this question'}
                    className={`flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-[11px] font-black ${question.voted ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300'} disabled:opacity-50`}
                  >
                    <span>▲</span><span>{question.votes}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">{question.text}</p>
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{question.author} · {STATUS_LABELS[question.status] || question.status}</p>
                    {question.mine ? (
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
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
