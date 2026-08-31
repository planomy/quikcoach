import { useEffect, useMemo, useRef, useState } from 'react';

function confidenceNameClass(confidence) {
  if (confidence === 'confident') return 'text-emerald-600 dark:text-emerald-400';
  if (confidence === 'unsure') return 'text-amber-500 dark:text-amber-300';
  if (confidence === 'guessed') return 'text-red-600 dark:text-red-400';
  return 'text-indigo-700 dark:text-indigo-300';
}

function confidenceLabel(confidence) {
  if (confidence === 'confident') return 'Confident';
  if (confidence === 'unsure') return 'Not sure';
  if (confidence === 'guessed') return 'Guessed';
  return 'Answered';
}

function ChoiceBars({ activity, responses, display = false }) {
  const counts = useMemo(() => {
    const result = Object.fromEntries((activity?.options || []).map((option) => [option, 0]));
    for (const response of responses || []) {
      result[response.value] = (result[response.value] || 0) + 1;
    }
    return result;
  }, [activity, responses]);
  const max = Math.max(1, ...Object.values(counts));
  if (!activity?.options?.length) return null;
  return (
    <div className={display ? 'space-y-4' : 'space-y-2.5'}>
      {activity.options.map((option, index) => {
        const count = counts[option] || 0;
        return (
          <div key={option} className={`grid items-center gap-3 ${display ? 'grid-cols-[minmax(5rem,10rem)_1fr_2.5rem]' : 'grid-cols-[minmax(3rem,5.5rem)_1fr_1.5rem]'}`}>
            <p className={`truncate font-bold ${display ? 'text-xl text-white' : 'text-xs text-slate-700 dark:text-slate-200'}`}>
              <span className="mr-1 opacity-40">{String.fromCharCode(65 + index)}</span>
              {option}
            </p>
            <div className={`${display ? 'h-10 bg-white/15' : 'h-5 bg-slate-100 dark:bg-slate-800'} overflow-hidden rounded-full`}>
              <div
                className="h-full min-w-1 rounded-full bg-indigo-500 transition-all duration-500"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className={`text-right font-black ${display ? 'text-2xl text-white' : 'text-xs text-slate-700 dark:text-slate-200'}`}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Right-edge answer rail: the teacher's live monitoring and control surface. */
export default function TeacherAnswerRail({
  open,
  onOpen,
  onClose,
  activity,
  responses = [],
  highlightStudentId = null,
  onClearHighlight,
  onOpenAsk,
}) {
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const [presenting, setPresenting] = useState(false);
  const isShort = activity?.type === 'short';
  const responded = (responses || []).length;
  const sorted = useMemo(() => {
    return [...(responses || [])].sort((a, b) => Number(b.submittedAt || 0) - Number(a.submittedAt || 0));
  }, [responses]);

  useEffect(() => {
    if (!open || highlightStudentId == null) return undefined;
    const node = listRef.current?.querySelector(`[data-rail-student="${highlightStudentId}"]`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const timer = window.setTimeout(() => onClearHighlight?.(), 2200);
    return () => window.clearTimeout(timer);
  }, [open, highlightStudentId, onClearHighlight, sorted.length]);

  useEffect(() => {
    if (!open || presenting) return undefined;
    function closeOnOutsidePointer(event) {
      if (panelRef.current?.contains(event.target)) return;
      onClose?.();
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open, presenting, onClose]);

  function teacherSocket() {
    return window.__iboardTeacherSocket;
  }

  function finishQuestion() {
    const socket = teacherSocket();
    if (!socket?.connected) return;
    socket.emit('teacher:live-control', { action: 'clear' });
  }

  function repeatQuestion() {
    const socket = teacherSocket();
    if (!socket?.connected || !activity) return;
    socket.emit('teacher:live-launch', {
      type: activity.type,
      prompt: activity.prompt,
      options: Array.isArray(activity.options) ? activity.options : [],
      correctAnswer: activity.correctAnswer || '',
      anonymous: !!activity.anonymous,
      optional: !!activity.optional,
      imageUrl: activity.imageUrl || '',
      timerSeconds: Number(activity.timerSeconds) || 0,
    });
  }

  function liveControl(action) {
    const socket = teacherSocket();
    if (!socket?.connected) return;
    socket.emit('teacher:live-control', { action });
  }

  function remindUnanswered() {
    const socket = teacherSocket();
    if (!socket?.connected) return;
    socket.emit('teacher:live-realert', {});
  }

  if (!activity) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={onOpen}
          className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-indigo-200 bg-indigo-600 px-2 py-4 text-white shadow-lg hover:bg-indigo-700 dark:border-indigo-800"
          title="Show answers"
          aria-label={`Show answers · ${responded} so far`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20V10" />
            <path d="M12 20V4" />
            <path d="M20 20v-7" />
          </svg>
          <span className="text-[10px] font-black uppercase tracking-wide" style={{ writingMode: 'vertical-rl' }}>
            Answers · {responded}
          </span>
        </button>
      )}

      <aside
        ref={panelRef}
        className={`fixed bottom-0 right-0 top-0 z-40 flex w-[min(24rem,92vw)] flex-col border-l border-indigo-200 bg-white shadow-2xl transition-transform duration-300 ease-out dark:border-indigo-900 dark:bg-slate-900 ${
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full'
        }`}
        aria-hidden={!open}
        aria-label="Live answers"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Live answers</p>
            <p className="mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-white">{activity.prompt}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">{responded} response{responded === 1 ? '' : 's'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={repeatQuestion}
              className="grid h-8 w-8 place-items-center rounded-lg text-base font-black text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950"
              title="Repeat this question"
              aria-label="Repeat this question"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={() => setPresenting(true)}
              className="rounded-lg px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950"
            >
              Present
            </button>
            {typeof onOpenAsk === 'function' && (
              <button
                type="button"
                onClick={onOpenAsk}
                className="rounded-lg px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950"
              >
                Ask another
              </button>
            )}
            <button
              type="button"
              onClick={finishQuestion}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="End this question and clear live answers"
            >
              Done
            </button>
            <details className="relative">
              <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-lg font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="More live question controls">⋯</summary>
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); remindUnanswered(); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Remind unanswered</button>
                <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); liveControl(activity.locked ? 'unlock' : 'lock'); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">{activity.locked ? 'Reopen answers' : 'Pause answers'}</button>
                {activity.correctAnswer && !activity.revealed && (
                  <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); liveControl('reveal'); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Reveal answer</button>
                )}
              </div>
            </details>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Hide answers"
            >
              ×
            </button>
          </div>
        </div>

        {isShort && (
          <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2 text-[10px] font-bold dark:border-slate-800">
            <span className="text-emerald-600">● Confident</span>
            <span className="text-amber-500">● Not sure</span>
            <span className="text-red-600">● Guessed</span>
          </div>
        )}

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
          {isShort ? (
            <div className="space-y-2.5">
              {sorted.map((response) => {
                const highlighted = Number(highlightStudentId) === Number(response.studentId);
                return (
                  <article
                    key={`${response.studentId}-${response.submittedAt || response.value}`}
                    data-rail-student={response.studentId}
                    className={`rounded-xl border px-3 py-2.5 transition ${
                      highlighted
                        ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300 dark:border-indigo-500 dark:bg-indigo-950/50'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate text-sm font-black ${confidenceNameClass(response.confidence)}`}>
                        {response.name || 'Student'}
                      </p>
                      <span className="shrink-0 text-[10px] font-semibold text-slate-400">
                        {confidenceLabel(response.confidence)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                      {response.value}
                    </p>
                  </article>
                );
              })}
              {!sorted.length && (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
                  Waiting for answers…
                </p>
              )}
            </div>
          ) : (
            <div>
              <ChoiceBars activity={activity} responses={responses} />
              {sorted.length > 0 && (
                <div className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Who answered</p>
                  {sorted.map((response) => (
                    <div
                      key={`${response.studentId}-${response.value}`}
                      data-rail-student={response.studentId}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm ${
                        Number(highlightStudentId) === Number(response.studentId)
                          ? 'bg-indigo-50 dark:bg-indigo-950/40'
                          : ''
                      }`}
                    >
                      <span className={`font-bold ${confidenceNameClass(response.confidence)}`}>
                        {response.name || 'Student'}
                      </span>
                      <span className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {response.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!sorted.length && (
                <p className="mt-6 text-center text-sm text-slate-500">Waiting for answers…</p>
              )}
            </div>
          )}
        </div>
      </aside>

      {presenting && (
        <div className="fixed inset-0 z-[95] overflow-auto bg-gradient-to-br from-indigo-950 via-violet-950 to-slate-950 p-6 text-white sm:p-10">
          <button type="button" onClick={() => setPresenting(false)} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-indigo-950 shadow-xl">Back</button>
          <div className="mx-auto max-w-5xl py-14">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-300">Live answers</p>
            <h2 className="mt-2 font-display text-3xl font-black sm:text-5xl">{activity.prompt}</h2>
            <p className="mt-3 text-sm font-bold text-indigo-200">{responded} response{responded === 1 ? '' : 's'}</p>
            <div className="mt-10">
              {isShort ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {sorted.map((response) => (
                    <article key={`${response.studentId}-${response.submittedAt || response.value}`} className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/15">
                      <p className="text-xl leading-relaxed">“{response.value}”</p>
                      {!activity.anonymous && <p className="mt-3 text-sm font-black text-indigo-300">{response.name || 'Student'}</p>}
                    </article>
                  ))}
                  {!sorted.length && <p className="text-lg text-indigo-200">Waiting for answers…</p>}
                </div>
              ) : (
                <ChoiceBars activity={activity} responses={responses} display />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
