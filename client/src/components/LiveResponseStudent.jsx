import { useEffect, useState } from 'react';

const STATUS_OPTIONS = [
  ['ready', 'Yep, ready'],
  ['unsure', 'I’m unsure'],
  ['tech', 'Tech problem'],
];

export default function LiveResponseStudent({ socket }) {
  const [activity, setActivity] = useState(null);
  const [response, setResponse] = useState(null);
  const [featured, setFeatured] = useState([]);
  const [draft, setDraft] = useState('');
  const [nudge, setNudge] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onActivity = (payload) => {
      setActivity(payload?.activity || null);
      setFeatured(Array.isArray(payload?.featured) ? payload.featured : []);
      if (!payload?.activity) {
        setResponse(null);
        setDraft('');
      }
    };
    const onMine = (payload) => {
      setActivity(payload?.activity || null);
      setResponse(payload?.response || null);
      setDraft(payload?.response?.value || '');
    };
    const onNudge = () => setNudge(true);
    socket.on('live:activity', onActivity);
    socket.on('live:student', onMine);
    socket.on('live:nudge', onNudge);
    socket.emit('student:live-sync', {});
    return () => {
      socket.off('live:activity', onActivity);
      socket.off('live:student', onMine);
      socket.off('live:nudge', onNudge);
    };
  }, [socket]);

  function submit(value) {
    if (!activity || activity.locked) return;
    setMessage('Sending…');
    socket.emit('student:live-response', { activityId: activity.id, value }, (ack) => {
      setMessage(ack?.ok ? 'Answer sent ✓' : ack?.error || 'Could not send');
      if (ack?.ok) {
        setResponse({ value });
        setDraft(value);
      }
    });
  }

  function answerNudge(status) {
    socket.emit('student:live-status', { status }, () => {});
    setNudge(false);
  }

  if (!activity && !nudge) return null;

  return (
    <>
      {nudge && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">Private check-in</p>
            <h2 className="mt-2 font-display text-2xl font-black text-slate-900 dark:text-white">Are you still with us?</h2>
            <div className="mt-5 grid gap-3">
              {STATUS_OPTIONS.map(([value, label]) => (
                <button key={value} type="button" onClick={() => answerNudge(value)} className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3 text-base font-bold text-indigo-900 hover:border-indigo-500 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {activity && (
        <section className="rounded-3xl border-2 border-indigo-300 bg-white p-4 shadow-xl ring-4 ring-indigo-100 dark:border-indigo-700 dark:bg-slate-900 dark:ring-indigo-950 sm:p-6" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-600">Live question</p>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${activity.locked ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {activity.locked ? 'Answers locked' : response ? 'You can change your answer' : 'Answer now'}
            </span>
          </div>
          <h2 className="mt-3 font-display text-xl font-black leading-snug text-slate-950 dark:text-white sm:text-2xl">{activity.prompt}</h2>

          {activity.type === 'short' ? (
            <div className="mt-5">
              <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} disabled={activity.locked} placeholder="Type a short answer…" className="min-h-28 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 text-base text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              <button type="button" disabled={activity.locked || !draft.trim()} onClick={() => submit(draft)} className="mt-3 w-full rounded-2xl bg-indigo-600 px-5 py-3 text-base font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">Send answer</button>
            </div>
          ) : (
            <div className={`mt-5 grid gap-3 ${activity.options.length > 3 ? 'sm:grid-cols-2' : ''}`}>
              {activity.options.map((option, index) => {
                const selected = response?.value === option;
                const correct = activity.correctAnswer && option === activity.correctAnswer;
                return (
                  <button key={option} type="button" disabled={activity.locked} onClick={() => submit(option)} className={`min-h-14 rounded-2xl border-2 px-4 py-3 text-left text-base font-black transition ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : correct ? 'border-emerald-500 bg-emerald-100 text-emerald-950' : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white'}`}>
                    <span className="mr-2 opacity-60">{activity.type === 'choice' ? String.fromCharCode(65 + index) : ''}</span>{option}
                  </button>
                );
              })}
            </div>
          )}
          {message && <p className="mt-3 text-center text-sm font-bold text-indigo-700 dark:text-indigo-300">{message}</p>}
          {activity.type === 'short' && featured.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Shared by your teacher</p>
              {featured.map((item, index) => <blockquote key={index} className="mt-2 rounded-xl bg-violet-50 p-3 text-sm text-violet-950 dark:bg-violet-950 dark:text-violet-100">“{item.value}” <span className="font-bold">— {item.name}</span></blockquote>)}
            </div>
          )}
        </section>
      )}
    </>
  );
}
