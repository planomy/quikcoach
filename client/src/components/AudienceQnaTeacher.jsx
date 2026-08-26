import { useEffect, useMemo, useState } from 'react';

function sortQuestions(items) {
  return [...items].sort((a, b) => Number(b.votes) - Number(a.votes) || Number(a.id) - Number(b.id));
}

export default function AudienceQnaTeacher({ socket, hasLiveActivity = false, liveActivityId = '' }) {
  const [questions, setQuestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [clearStep, setClearStep] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onState = (payload) => setQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    socket.on('qna:teacher', onState);
    socket.emit('teacher:qna-sync', {});
    return () => socket.off('qna:teacher', onState);
  }, [socket]);

  useEffect(() => {
    if (hasLiveActivity) setOpen(false);
  }, [hasLiveActivity, liveActivityId]);

  const pending = useMemo(() => questions.filter((question) => question.status === 'pending').sort((a, b) => Number(a.id) - Number(b.id)), [questions]);
  const published = useMemo(() => sortQuestions(questions.filter((question) => question.status === 'published')), [questions]);
  const answered = useMemo(() => sortQuestions(questions.filter((question) => question.status === 'answered')), [questions]);
  const dismissed = useMemo(() => questions.filter((question) => question.status === 'dismissed'), [questions]);
  const presentable = useMemo(() => sortQuestions([...published, ...answered]), [published, answered]);

  function update(question, action, anonymous) {
    setMessage('');
    socket.emit('teacher:qna-status', { questionId: question.id, action, anonymous }, (ack) => {
      if (!ack?.ok) setMessage(ack?.error || 'Could not update the question.');
    });
  }

  function askRoom(question) {
    setMessage('');
    const anonymous = question.status === 'published' || question.status === 'answered'
      ? question.publishedAnonymous
      : question.anonymousRequested;
    socket.emit('teacher:qna-ask-room', { questionId: question.id, anonymous }, (ack) => {
      setMessage(ack?.ok
        ? 'Sent to every participant as a Pulse feedback prompt.'
        : ack?.error || 'Could not ask the room.');
      if (ack?.ok) setOpen(false);
    });
  }

  function clearAll() {
    if (!clearStep) {
      setClearStep(true);
      return;
    }
    socket.emit('teacher:qna-clear', {}, (ack) => {
      setClearStep(false);
      setMessage(ack?.ok ? 'Q&A cleared.' : ack?.error || 'Could not clear Q&A.');
    });
  }

  function IdentityControls({ question }) {
    const isAnonymous = question.status === 'pending' ? question.anonymousRequested : question.publishedAnonymous;
    return (
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => update(question, 'publish', false)} className={`rounded-md px-2 py-1 text-[10px] font-black ${!isAnonymous && question.status !== 'pending' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'}`}>Publish named</button>
        <button type="button" onClick={() => update(question, 'publish', true)} className={`rounded-md px-2 py-1 text-[10px] font-black ${isAnonymous && question.status !== 'pending' ? 'bg-fuchsia-600 text-white' : 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-200'}`}>Publish anonymous</button>
      </div>
    );
  }

  function QuestionCard({ question, mode }) {
    return (
      <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
              <span>{question.studentName}</span>
              {question.anonymousRequested && <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-200">asked for anonymity</span>}
              {mode !== 'pending' && <span>· {question.votes} vote{Number(question.votes) === 1 ? '' : 's'}</span>}
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{question.text}</p>
          </div>
          {mode === 'published' && <span className={`rounded-full px-2 py-1 text-[10px] font-black ${question.publishedAnonymous ? 'bg-fuchsia-100 text-fuchsia-800' : 'bg-indigo-100 text-indigo-800'}`}>{question.publishedAnonymous ? 'Anonymous live' : 'Named live'}</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(mode === 'pending' || mode === 'published') && <IdentityControls question={question} />}
          {mode !== 'dismissed' && (
            <button type="button" onClick={() => askRoom(question)} title={hasLiveActivity ? 'This replaces the current Pulse prompt' : 'Launch as an optional short-response prompt'} className="rounded-md bg-emerald-500 px-2.5 py-1 text-[10px] font-black text-emerald-950">
              Ask the room{hasLiveActivity ? ' · replaces live prompt' : ''}
            </button>
          )}
          {mode === 'published' && <button type="button" onClick={() => update(question, 'answer')} className="rounded-md bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">Mark answered</button>}
          {mode === 'answered' && <button type="button" onClick={() => update(question, 'reopen')} className="rounded-md bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-800">Reopen</button>}
          {mode === 'dismissed' ? <button type="button" onClick={() => update(question, 'pending')} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200">Return to queue</button> : <button type="button" onClick={() => update(question, 'dismiss')} className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-black text-red-600 dark:bg-red-950/40 dark:text-red-300">Dismiss</button>}
        </div>
      </article>
    );
  }

  return (
    <>
      <section id="audience-qna-teacher" className="scroll-mt-4 border-b border-fuchsia-200 bg-fuchsia-50/70 dark:border-fuchsia-900 dark:bg-fuchsia-950/20">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-fuchsia-700 dark:text-fuchsia-300">Audience Q&amp;A</span>
            <span className="truncate text-xs font-bold text-slate-600 dark:text-slate-300">{pending.length ? `${pending.length} waiting for review` : questions.length ? `${questions.length} question${questions.length === 1 ? '' : 's'}` : 'No questions waiting'}</span>
          </span>
          <span className="flex items-center gap-2">
            {pending.length > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800">{pending.length} waiting</span>}
            {published.length > 0 && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-800">{published.length} live</span>}
            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-fuchsia-800 shadow-sm dark:bg-slate-900 dark:text-fuchsia-200">{open ? 'Close' : 'Review'}</span>
          </span>
        </button>

        {open && (
          <div className="space-y-4 border-t border-fuchsia-200 p-4 dark:border-fuchsia-900">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto max-w-2xl text-xs text-slate-600 dark:text-slate-300">Questions arrive privately. Publish the best ones, collect votes, or send one straight to every participant as a Pulse feedback prompt.</p>
              <button type="button" disabled={!presentable.length} onClick={() => setPresenting(true)} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">Present Q&amp;A</button>
              {!!questions.length && <button type="button" onClick={clearAll} onBlur={() => setClearStep(false)} className={`rounded-lg px-3 py-2 text-xs font-black ${clearStep ? 'bg-red-600 text-white' : 'bg-white text-red-600 shadow-sm dark:bg-slate-900'}`}>{clearStep ? 'Confirm clear all' : 'Clear Q&A'}</button>}
            </div>
            {message && <p className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-fuchsia-800 shadow-sm dark:bg-slate-900 dark:text-fuchsia-200">{message}</p>}

            {pending.length > 0 && <div><h3 className="mb-2 text-[10px] font-black uppercase tracking-wide text-amber-700">Waiting · private</h3><div className="grid gap-2 lg:grid-cols-2">{pending.map((question) => <QuestionCard key={question.id} question={question} mode="pending" />)}</div></div>}
            {published.length > 0 && <div><h3 className="mb-2 text-[10px] font-black uppercase tracking-wide text-emerald-700">Live with participants</h3><div className="grid gap-2 lg:grid-cols-2">{published.map((question) => <QuestionCard key={question.id} question={question} mode="published" />)}</div></div>}
            {answered.length > 0 && <details><summary className="cursor-pointer text-[10px] font-black uppercase tracking-wide text-slate-500">Answered · {answered.length}</summary><div className="mt-2 grid gap-2 lg:grid-cols-2">{answered.map((question) => <QuestionCard key={question.id} question={question} mode="answered" />)}</div></details>}
            {dismissed.length > 0 && <details><summary className="cursor-pointer text-[10px] font-black uppercase tracking-wide text-slate-500">Dismissed · {dismissed.length}</summary><div className="mt-2 grid gap-2 lg:grid-cols-2">{dismissed.map((question) => <QuestionCard key={question.id} question={question} mode="dismissed" />)}</div></details>}
            {!questions.length && <p className="rounded-xl border border-dashed border-fuchsia-200 bg-white/60 px-4 py-5 text-center text-xs text-slate-500 dark:border-fuchsia-900 dark:bg-slate-900/50">Participant questions will collect here—even when no Pulse poll is running.</p>}
          </div>
        )}
      </section>

      {presenting && (
        <div className="fixed inset-0 z-[90] overflow-auto bg-gradient-to-br from-fuchsia-950 via-violet-950 to-slate-950 p-6 text-white sm:p-10">
          <button type="button" onClick={() => setPresenting(false)} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-violet-950 shadow-xl">Back to facilitator</button>
          <div className="mx-auto max-w-6xl py-14">
            <p className="text-sm font-black uppercase tracking-[0.28em] text-fuchsia-300">Audience Q&amp;A</p>
            <h2 className="mt-2 font-display text-4xl font-black sm:text-6xl">What the room wants to discuss</h2>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {presentable.map((question) => (
                <article key={question.id} className="rounded-3xl bg-white/10 p-6 ring-1 ring-white/20">
                  <div className="flex items-start gap-4">
                    <span className="grid min-w-14 place-items-center rounded-2xl bg-fuchsia-400 px-3 py-2 font-black text-fuchsia-950">▲ {question.votes}</span>
                    <div><p className="text-2xl font-bold leading-snug">{question.text}</p><p className="mt-3 text-sm font-black uppercase tracking-wide text-fuchsia-300">{question.publishedAnonymous ? 'Anonymous' : question.studentName}{question.status === 'answered' ? ' · answered' : ''}</p></div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
