import { useMemo, useState } from 'react';
import QuestionInboxReply from './QuestionInboxReply.jsx';

function sortQuestions(items) {
  return [...items].sort((a, b) => Number(b.votes) - Number(a.votes) || Number(a.id) - Number(b.id));
}

const ACTION_CLASS = 'h-9 rounded-lg px-3 text-xs font-black';

export default function AudienceQnaTeacher({
  socket,
  questions = [],
  focusedStudentId = null,
  hasLiveActivity = false,
  onClose,
  onQuestionLaunched,
}) {
  const [presenting, setPresenting] = useState(false);
  const [message, setMessage] = useState('');

  const scopedQuestions = useMemo(
    () => focusedStudentId
      ? questions.filter((question) => Number(question.studentId) === Number(focusedStudentId))
      : questions,
    [focusedStudentId, questions]
  );
  const globalPending = useMemo(
    () => questions.filter((question) => question.status === 'pending').sort((a, b) => Number(a.id) - Number(b.id)),
    [questions]
  );
  const queuePositions = useMemo(
    () => Object.fromEntries(globalPending.map((question, index) => [Number(question.id), index + 1])),
    [globalPending]
  );
  const pending = useMemo(
    () => scopedQuestions.filter((question) => question.status === 'pending').sort((a, b) => Number(a.id) - Number(b.id)),
    [scopedQuestions]
  );
  const published = useMemo(
    () => sortQuestions(scopedQuestions.filter((question) => question.status === 'published')),
    [scopedQuestions]
  );
  const answered = useMemo(
    () => sortQuestions(scopedQuestions.filter((question) => question.status === 'answered')),
    [scopedQuestions]
  );
  const dismissed = useMemo(
    () => scopedQuestions.filter((question) => question.status === 'dismissed'),
    [scopedQuestions]
  );
  const presentable = useMemo(
    () => sortQuestions(questions.filter((question) => question.status === 'published' || question.status === 'answered')),
    [questions]
  );

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
      if (!ack?.ok) {
        setMessage(ack?.error || 'Could not ask the class.');
        return;
      }
      onQuestionLaunched?.();
    });
  }

  function DisplayMenu({ question }) {
    const isAnonymous = question.status === 'pending'
      ? question.anonymousRequested
      : question.publishedAnonymous;
    const chooseDisplay = (event, anonymous) => {
      event.currentTarget.closest('details')?.removeAttribute('open');
      update(question, 'publish', anonymous);
    };
    return (
      <details className="relative z-20">
        <summary className={`flex h-9 list-none cursor-pointer items-center rounded-lg px-3 text-xs font-black ${isAnonymous ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'}`}>
          Show ▾
        </summary>
        <div className="absolute left-0 top-full z-50 mt-1 min-w-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <button type="button" onClick={(event) => chooseDisplay(event, false)} className="block w-full rounded-md px-3 py-2 text-left text-xs font-black text-indigo-700 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-950">Named</button>
          <button type="button" onClick={(event) => chooseDisplay(event, true)} className="block w-full rounded-md px-3 py-2 text-left text-xs font-black text-indigo-700 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-950">Anonymous</button>
        </div>
      </details>
    );
  }

  function QuestionCard({ question, mode }) {
    const queuePosition = queuePositions[Number(question.id)];
    const isLive = mode === 'published';
    return (
      <article className="relative overflow-visible rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{question.studentName}</span>
            {mode === 'pending' && queuePosition && (
              <span className="text-[10px] font-black uppercase tracking-wide text-indigo-600 dark:text-indigo-300" title={`Question ${queuePosition} in the waiting queue`}>
                Q{queuePosition}
              </span>
            )}
            {isLive && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-800">{question.publishedAnonymous ? 'Anon live' : 'Live'}</span>}
            {mode !== 'pending' && Number(question.votes) > 0 && <span className="text-[10px] font-bold text-slate-400">▲ {question.votes}</span>}
          </div>
          <p className="mt-1 text-base font-bold leading-snug text-slate-950 dark:text-white">{question.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(mode === 'pending' || mode === 'published') && <DisplayMenu question={question} />}
            {mode !== 'dismissed' && mode !== 'answered' && (
              <button type="button" onClick={() => askRoom(question)} title={hasLiveActivity ? 'Replaces the current response prompt' : 'Ask every participant'} className={`${ACTION_CLASS} bg-emerald-500 text-emerald-950`}>
                Ask class
              </button>
            )}
            {mode === 'pending' && <button type="button" onClick={() => update(question, 'dismiss')} className={`${ACTION_CLASS} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200`}>Mark handled</button>}
            {mode === 'published' && <button type="button" onClick={() => update(question, 'answer')} className={`${ACTION_CLASS} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200`}>Mark answered</button>}
            {mode === 'answered' && <button type="button" onClick={() => update(question, 'reopen')} className={`${ACTION_CLASS} bg-indigo-100 text-indigo-800`}>Reopen</button>}
            {mode === 'dismissed' && <button type="button" onClick={() => update(question, 'pending')} className={`${ACTION_CLASS} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200`}>Return to queue</button>}
          </div>
          <QuestionInboxReply
            socket={socket}
            studentId={question.studentId}
            studentName={question.studentName}
            questionText={question.text}
            className="mt-3"
          />
        </div>
      </article>
    );
  }

  return (
    <>
      <section id="audience-qna-teacher" className="scroll-mt-4 p-4">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-700">
          <h3 className="min-w-0 flex-1 font-display text-lg font-black text-slate-950 dark:text-white">
            From students{pending.length ? ` · ${pending.length} waiting` : ''}
          </h3>
          {!focusedStudentId && presentable.length > 0 && (
            <button type="button" onClick={() => setPresenting(true)} className={`${ACTION_CLASS} bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200`}>Present</button>
          )}
          <button type="button" onClick={onClose} title={hasLiveActivity ? 'Back to live response' : 'Close questions panel'} aria-label={hasLiveActivity ? 'Back to live response' : 'Close questions panel'} className={`${ACTION_CLASS} bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200`}>
            Close
          </button>
        </div>

        {message && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{message}</p>}

        <div className="mt-3 space-y-3">
          {pending.map((question) => <QuestionCard key={question.id} question={question} mode="pending" />)}
          {published.map((question) => <QuestionCard key={question.id} question={question} mode="published" />)}

          {answered.length > 0 && (
            <details>
              <summary className="cursor-pointer py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Answered · {answered.length}</summary>
              <div className="mt-2 space-y-2">{answered.map((question) => <QuestionCard key={question.id} question={question} mode="answered" />)}</div>
            </details>
          )}
          {dismissed.length > 0 && (
            <details>
              <summary className="cursor-pointer py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Handled privately · {dismissed.length}</summary>
              <div className="mt-2 space-y-2">{dismissed.map((question) => <QuestionCard key={question.id} question={question} mode="dismissed" />)}</div>
            </details>
          )}
          {!scopedQuestions.length && <div className="h-4" aria-hidden="true" />}
        </div>
      </section>

      {presenting && (
        <div className="fixed inset-0 z-[90] overflow-auto bg-gradient-to-br from-indigo-950 via-indigo-950 to-slate-950 p-6 text-white sm:p-10">
          <button type="button" onClick={() => setPresenting(false)} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-indigo-950 shadow-xl">Back</button>
          <div className="mx-auto max-w-6xl py-14">
            <h2 className="font-display text-4xl font-black sm:text-6xl">Questions</h2>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {presentable.map((question) => (
                <article key={question.id} className="rounded-3xl bg-white/10 p-6 ring-1 ring-white/20">
                  <div className="flex items-start gap-4">
                    <span className="grid min-w-14 place-items-center rounded-2xl bg-indigo-400 px-3 py-2 font-black text-indigo-950">▲ {question.votes}</span>
                    <div>
                      <p className="text-2xl font-bold leading-snug">{question.text}</p>
                      <p className="mt-3 text-sm font-black uppercase tracking-wide text-indigo-300">{question.publishedAnonymous ? 'Anonymous' : question.studentName}{question.status === 'answered' ? ' · answered' : ''}</p>
                    </div>
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
