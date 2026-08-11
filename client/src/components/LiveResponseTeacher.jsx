import { useEffect, useMemo, useState } from 'react';
import EngagementRing from './EngagementRing.jsx';

const TYPES = [
  ['choice', 'Multiple choice'],
  ['truefalse', 'True / False'],
  ['rating', '1–5 scale'],
  ['short', 'Short answer'],
];

const STATUS_LABELS = {
  ready: 'Ready',
  unsure: 'Unsure',
  tech: 'Tech issue',
};

function Results({ activity, responses, display = false, onPublish }) {
  const counts = useMemo(() => {
    const result = Object.fromEntries((activity?.options || []).map((option) => [option, 0]));
    for (const response of responses || []) result[response.value] = (result[response.value] || 0) + 1;
    return result;
  }, [activity, responses]);
  const max = Math.max(1, ...Object.values(counts));

  if (!activity) return null;
  if (activity.type === 'short') {
    const visible = display ? responses.filter((response) => response.published) : responses;
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((response) => (
          <article key={response.studentId} className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950 shadow-sm dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100">
            <p className={`${display ? 'text-xl' : 'text-sm'} leading-relaxed`}>“{response.value}”</p>
            {!display && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="truncate text-xs font-bold">{activity.anonymous ? 'Anonymous to class' : response.name}</span>
                <button type="button" onClick={() => onPublish?.(response)} className={`rounded-lg px-2.5 py-1 text-xs font-black ${response.published ? 'bg-violet-700 text-white' : 'bg-white text-violet-800 dark:bg-slate-900 dark:text-violet-200'}`}>
                  {response.published ? 'Featured ✓' : 'Feature'}
                </button>
              </div>
            )}
            {display && !activity.anonymous && <p className="mt-2 text-sm font-bold">— {response.name}</p>}
          </article>
        ))}
        {!visible.length && <p className="text-sm font-medium text-slate-500">{display ? 'No answers have been featured yet.' : 'Waiting for answers…'}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activity.options.map((option, index) => {
        const count = counts[option] || 0;
        const correct = activity.revealed && activity.correctAnswer === option;
        return (
          <div key={option} className="grid grid-cols-[minmax(80px,180px)_1fr_38px] items-center gap-3">
            <p className={`truncate font-bold ${display ? 'text-lg text-white' : 'text-sm text-slate-800 dark:text-slate-100'}`}><span className="mr-2 opacity-50">{activity.type === 'choice' ? String.fromCharCode(65 + index) : ''}</span>{option}</p>
            <div className={`h-8 overflow-hidden rounded-full ${display ? 'bg-white/15' : 'bg-slate-100 dark:bg-slate-800'}`}>
              <div className={`grid h-full min-w-1 place-items-end rounded-full px-3 transition-all duration-500 ${correct ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className={`text-right font-black ${display ? 'text-xl text-white' : 'text-slate-700 dark:text-slate-200'}`}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function LiveResponseTeacher({ socket }) {
  const [live, setLive] = useState({ activity: null, responses: [], students: [] });
  const [type, setType] = useState('choice');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [optional, setOptional] = useState(false);
  const [displayMode, setDisplayMode] = useState(false);
  const [composerOpen, setComposerOpen] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onLive = (payload) => setLive(payload || { activity: null, responses: [], students: [] });
    socket.on('live:teacher', onLive);
    socket.emit('teacher:live-sync', {});
    return () => socket.off('live:teacher', onLive);
  }, [socket]);

  const activity = live.activity;
  const responses = live.responses || [];
  const students = [...(live.students || [])].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return (a.engagement?.score ?? 100) - (b.engagement?.score ?? 100);
  });
  const unansweredCount = students.filter(
    (student) => student.connected && !student.hasResponded
  ).length;

  function launch() {
    const cleanOptions = options.map((value) => value.trim()).filter(Boolean);
    socket.emit('teacher:live-launch', { type, prompt, options: cleanOptions, correctAnswer, anonymous, optional }, (ack) => {
      setMessage(ack?.ok ? 'Question is live.' : ack?.error || 'Could not launch');
      if (ack?.ok) setComposerOpen(false);
    });
  }

  function control(action) {
    socket.emit('teacher:live-control', { action }, (ack) => {
      if (!ack?.ok) setMessage(ack?.error || 'Could not update question');
      if (action === 'clear' && ack?.ok) setComposerOpen(true);
    });
  }

  function publish(response) {
    socket.emit('teacher:live-publish', { activityId: activity.id, studentId: response.studentId, published: !response.published });
  }

  function nudge(studentId) {
    socket.emit('teacher:live-nudge', { studentId }, (ack) => {
      setMessage(ack?.ok ? 'Private check-in sent.' : 'Student is not available.');
    });
  }

  function realertUnanswered() {
    socket.emit('teacher:live-realert', {}, (ack) => {
      setMessage(
        ack?.ok
          ? ack.count
            ? `Re-alert sent to ${ack.count} unanswered student${ack.count === 1 ? '' : 's'}.`
            : 'Everyone online has answered.'
          : ack?.error || 'Could not send the re-alert.'
      );
    });
  }

  return (
    <section className="mb-6 overflow-hidden rounded-3xl border border-indigo-200 bg-white shadow-card dark:border-indigo-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-700 to-violet-700 px-5 py-4 text-white">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-200">iBOARD Pulse</p>
          <h2 className="font-display text-xl font-black">Live class response</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {activity && <button type="button" onClick={() => setDisplayMode(true)} className="rounded-xl bg-white px-3 py-2 text-sm font-black text-indigo-800 shadow-sm">Display results</button>}
          <button type="button" onClick={() => setComposerOpen((open) => !open)} className="rounded-xl bg-indigo-950/40 px-3 py-2 text-sm font-black ring-1 ring-white/30">{composerOpen ? 'Hide setup' : 'New question'}</button>
        </div>
      </div>

      {composerOpen && (
        <div className="border-b border-slate-200 p-5 dark:border-slate-700">
          <div className="flex flex-wrap gap-2">
            {TYPES.map(([value, label]) => <button key={value} type="button" onClick={() => { setType(value); setCorrectAnswer(''); }} className={`rounded-xl px-3 py-2 text-sm font-bold ${type === value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{label}</button>)}
          </div>
          <label className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-500">Question or prompt</label>
          <input value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 500))} placeholder="What do you think?" className="mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          {type === 'choice' && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {options.map((option, index) => <input key={index} value={option} onChange={(event) => setOptions((current) => current.map((value, i) => i === index ? event.target.value.slice(0, 120) : value))} placeholder={`Choice ${String.fromCharCode(65 + index)}`} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />)}
            </div>
          )}
          {type !== 'short' && (
            <label className="mt-3 block text-xs font-bold text-slate-600 dark:text-slate-300">Correct answer (optional)
              <select value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="">No correct answer / opinion poll</option>
                {(type === 'choice' ? options.filter(Boolean) : type === 'truefalse' ? ['True', 'False'] : ['1', '2', '3', '4', '5']).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {type === 'short' && <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} className="h-4 w-4 accent-indigo-600" /> Anonymous when featured</label>}
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={optional} onChange={(event) => setOptional(event.target.checked)} className="h-4 w-4 accent-indigo-600" /> Optional — don’t count for engagement</label>
            <button type="button" onClick={launch} className="ml-auto rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white shadow-md hover:bg-indigo-700">Launch to class</button>
          </div>
        </div>
      )}

      {activity && (
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-indigo-600">Question {activity.questionNumber || 1} · Live now · {responses.length} answered</p>
              <h3 className="mt-1 font-display text-xl font-black text-slate-950 dark:text-white">{activity.prompt}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!unansweredCount || activity.locked} onClick={realertUnanswered} className="rounded-lg bg-violet-100 px-3 py-2 text-xs font-black text-violet-900 disabled:cursor-not-allowed disabled:opacity-40">
                🔔 Re-alert {unansweredCount} unanswered
              </button>
              <button type="button" onClick={() => control(activity.locked ? 'unlock' : 'lock')} className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-black text-amber-900">{activity.locked ? 'Unlock' : 'Lock answers'}</button>
              {activity.correctAnswer && !activity.revealed && <button type="button" onClick={() => control('reveal')} className="rounded-lg bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-900">Reveal answer</button>}
              <button type="button" onClick={() => control('clear')} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200">End</button>
            </div>
          </div>
          <div className="mt-5"><Results activity={activity} responses={responses} onPublish={publish} /></div>
        </div>
      )}

      <div className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/50">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="font-display text-base font-black text-slate-900 dark:text-white">Engagement pulse</h3><p className="text-xs text-slate-500">Recent participation only — never correctness. Visible to teachers only.</p></div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">{students.filter((student) => student.connected).length} online</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {students.map((student) => (
            <div key={student.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <EngagementRing engagement={student.engagement} connected={student.connected} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-slate-900 dark:text-white">{student.name}</p><p className="text-xs font-semibold text-slate-500">{student.engagement_status ? STATUS_LABELS[student.engagement_status] : student.hasResponded ? 'Answered' : student.connected ? 'Waiting' : 'Offline'}</p></div>
              <button type="button" disabled={!student.connected} onClick={() => nudge(student.id)} title="Send a private check-in" className="rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100 disabled:opacity-30 dark:bg-indigo-950 dark:text-indigo-200">Nudge</button>
            </div>
          ))}
          {!students.length && <p className="text-sm text-slate-500">Students will appear here when they join.</p>}
        </div>
      </div>
      {message && <p className="border-t border-slate-200 px-5 py-2 text-xs font-bold text-indigo-700 dark:border-slate-700 dark:text-indigo-300">{message}</p>}

      {displayMode && activity && (
        <div className="fixed inset-0 z-[80] overflow-auto bg-gradient-to-br from-indigo-950 via-violet-950 to-slate-950 p-6 text-white sm:p-10">
          <button type="button" onClick={() => setDisplayMode(false)} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-indigo-950 shadow-xl">Back to teacher</button>
          <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center py-12">
            <p className="text-lg font-black uppercase tracking-[0.25em] text-indigo-300">Question {activity.questionNumber || 1} · Live response · {responses.length} answers</p>
            <h2 className="mt-4 max-w-5xl font-display text-4xl font-black leading-tight sm:text-6xl">{activity.prompt}</h2>
            <div className="mt-10"><Results activity={activity} responses={responses} display /></div>
          </div>
        </div>
      )}
    </section>
  );
}
