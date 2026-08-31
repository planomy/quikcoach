import { useEffect, useMemo, useState } from 'react';

const STATUS_LABELS = {
  pending: 'Waiting for facilitator',
  published: 'Shown',
  answered: 'Answered',
  dismissed: 'Done',
};

export default function AudienceQnaStudent({ socket, compact = false, collapsed = false, onRequestExpand, embedded = false }) {
  const [questions, setQuestions] = useState([]);
  const [open, setOpen] = useState(!!embedded);
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
      setMessage('Sent.');
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

  if (collapsed) {
    return (
      <button type="button" onClick={showPanel} className="flex w-full items-center justify-between rounded-2xl bg-indigo-600 px-4 py-3 text-left text-white">
        <span className="font-display text-sm font-black">Ask a question</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-indigo-800">{liveQuestions.length ? `${liveQuestions.length} live` : 'Open'}</span>
      </button>
    );
  }

  return (
    <section className={`overflow-hidden rounded-2xl border border-fuchsia-200 bg-white shadow-card dark:border-fuchsia-900 dark:bg-slate-900 ${compact ? 'text-xs' : ''}`}>
      {!embedded && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 bg-indigo-600 px-4 py-3 text-left text-white">
          <span className="font-display text-sm font-black">Ask a question</span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-indigo-800">{statusLabel}</span>
        </button>
      )}

      {showBody && (
        <div className="space-y-4 p-4">
          <form onSubmit={submit}>
            <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Your question</label>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 500))}
              rows={compact ? 2 : 3}
              placeholder="What would you like the facilitator to explain or ask the room?"
              className="mt-1 w-full resize-y rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-fuchsia-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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

          {message && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">{message}</p>}

          {myPrivateQuestions.length > 0 && (
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-wide text-slate-500">My questions</h3>
              <div className="mt-2 space-y-2">
                {myPrivateQuestions.map((question) => (
                  <article key={question.id} className="relative rounded-xl border border-slate-200 bg-slate-50 p-3 pr-10 dark:border-slate-700 dark:bg-slate-950/60">
                    <button
                      type="button"
                      disabled={deletingId === question.id}
                      onClick={() => withdraw(question)}
                      className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-base font-bold text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                      title="Remove this question"
                      aria-label="Remove this question"
                    >
                      ×
                    </button>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{question.text}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{STATUS_LABELS[question.status] || question.status}{question.anonymous ? ' · anonymous if shown' : ''}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {publicQuestions.length > 0 && (
            <div className="space-y-2">
              {publicQuestions.map((question) => (
                <article key={question.id} className="relative flex gap-3 rounded-xl border border-fuchsia-100 bg-fuchsia-50/60 p-3 dark:border-fuchsia-900 dark:bg-fuchsia-950/20">
                  <button
                    type="button"
                    disabled={question.mine || question.status === 'answered'}
                    onClick={() => vote(question)}
                    title={question.status === 'answered' ? 'This question is finished' : question.mine ? 'You cannot vote for your own question' : question.voted ? 'Remove your vote' : 'Vote for this question'}
                    className={`flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-[11px] font-black ${question.voted ? 'bg-fuchsia-600 text-white' : 'bg-white text-fuchsia-700 shadow-sm dark:bg-slate-900 dark:text-fuchsia-300'} disabled:opacity-50`}
                  >
                    <span>▲</span><span>{question.votes}</span>
                  </button>
                  <div className={`min-w-0 flex-1 ${question.mine ? 'pr-8' : ''}`}>
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">{question.text}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-300">{question.author} · {STATUS_LABELS[question.status] || question.status}</p>
                  </div>
                  {question.mine && (
                    <button
                      type="button"
                      disabled={deletingId === question.id}
                      onClick={() => withdraw(question)}
                      className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-base font-bold text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                      title="Remove this question"
                      aria-label="Remove this question"
                    >
                      ×
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
