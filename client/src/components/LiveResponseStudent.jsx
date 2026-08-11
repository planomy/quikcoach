import { useCallback, useEffect, useRef, useState } from 'react';

const STATUS_OPTIONS = [
  ['ready', 'Yep, ready'],
  ['unsure', 'I’m unsure'],
  ['tech', 'Tech problem'],
];

const QUESTION_THEMES = [
  {
    panel: 'border-indigo-400 ring-indigo-100 dark:border-indigo-600 dark:ring-indigo-950',
    label: 'text-indigo-700 dark:text-indigo-300',
    splash: 'from-indigo-600 to-violet-700',
  },
  {
    panel: 'border-teal-400 ring-teal-100 dark:border-teal-600 dark:ring-teal-950',
    label: 'text-teal-700 dark:text-teal-300',
    splash: 'from-teal-500 to-cyan-700',
  },
  {
    panel: 'border-fuchsia-400 ring-fuchsia-100 dark:border-fuchsia-600 dark:ring-fuchsia-950',
    label: 'text-fuchsia-700 dark:text-fuchsia-300',
    splash: 'from-fuchsia-600 to-pink-700',
  },
  {
    panel: 'border-orange-400 ring-orange-100 dark:border-orange-600 dark:ring-orange-950',
    label: 'text-orange-700 dark:text-orange-300',
    splash: 'from-orange-500 to-rose-600',
  },
  {
    panel: 'border-sky-400 ring-sky-100 dark:border-sky-600 dark:ring-sky-950',
    label: 'text-sky-700 dark:text-sky-300',
    splash: 'from-sky-500 to-blue-700',
  },
];

function playQuestionChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.34);
    oscillator.addEventListener('ended', () => context.close());
  } catch {
    /* Browsers may block audio until the student has interacted with the page. */
  }
}

export default function LiveResponseStudent({ socket, standalone = false, compact = false }) {
  const [activity, setActivity] = useState(null);
  const [response, setResponse] = useState(null);
  const [featured, setFeatured] = useState([]);
  const [draft, setDraft] = useState('');
  const [nudge, setNudge] = useState(false);
  const [message, setMessage] = useState('');
  const [arrival, setArrival] = useState(null);
  const [pulse, setPulse] = useState(false);
  const [themeIndex, setThemeIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem('iboard-question-sound') !== 'off';
    } catch {
      return true;
    }
  });
  const panelRef = useRef(null);
  const activityIdRef = useRef('');
  const arrivalTimerRef = useRef(null);
  const pulseTimerRef = useRef(null);
  const titleTimerRef = useRef(null);
  const originalTitleRef = useRef('iBOARD');

  const drawAttention = useCallback((nextActivity, force = false) => {
    if (!nextActivity?.id) return false;
    const isNew = activityIdRef.current !== nextActivity.id;
    if (!isNew && !force) return false;
    activityIdRef.current = nextActivity.id;
    const number = Math.max(1, Number(nextActivity.questionNumber) || 1);
    setThemeIndex((number - 1) % QUESTION_THEMES.length);
    setArrival(nextActivity);
    setPulse(true);
    setMessage(force ? 'Your teacher has re-alerted this question.' : 'New question — answer now');
    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    arrivalTimerRef.current = setTimeout(() => setArrival(null), 2600);
    pulseTimerRef.current = setTimeout(() => setPulse(false), 2600);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    if (!document.title.startsWith('🔔')) originalTitleRef.current = document.title || 'iBOARD';
    document.title = `🔔 Question ${number} — iBOARD`;
    titleTimerRef.current = setTimeout(() => {
      document.title = originalTitleRef.current;
    }, 7000);
    if (soundOn) playQuestionChime();
    return isNew;
  }, [soundOn]);

  useEffect(() => {
    const onActivity = (payload) => {
      const nextActivity = payload?.activity || null;
      const isNew = nextActivity?.id && nextActivity.id !== activityIdRef.current;
      setActivity(nextActivity);
      setFeatured(Array.isArray(payload?.featured) ? payload.featured : []);
      if (isNew) {
        setResponse(null);
        setDraft('');
        drawAttention(nextActivity);
      }
      if (!nextActivity) {
        activityIdRef.current = '';
        setResponse(null);
        setDraft('');
      }
    };
    const onMine = (payload) => {
      const nextActivity = payload?.activity || null;
      setActivity(nextActivity);
      if (nextActivity?.id && nextActivity.id !== activityIdRef.current) drawAttention(nextActivity);
      setResponse(payload?.response || null);
      setDraft(payload?.response?.value || '');
    };
    const onNudge = () => setNudge(true);
    const onRealert = (payload) => {
      if (payload?.activity) {
        setActivity(payload.activity);
        drawAttention(payload.activity, true);
      }
    };
    socket.on('live:activity', onActivity);
    socket.on('live:student', onMine);
    socket.on('live:nudge', onNudge);
    socket.on('live:realert', onRealert);
    socket.emit('student:live-sync', {});
    return () => {
      socket.off('live:activity', onActivity);
      socket.off('live:student', onMine);
      socket.off('live:nudge', onNudge);
      socket.off('live:realert', onRealert);
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      document.title = originalTitleRef.current;
    };
  }, [drawAttention, socket]);

  useEffect(() => {
    if (!activity?.timerSeconds || activity.locked) {
      setSecondsLeft(null);
      return undefined;
    }
    const tick = () => {
      const end = Date.parse(`${activity.launchedAt}Z`) + activity.timerSeconds * 1000;
      setSecondsLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [activity?.id, activity?.launchedAt, activity?.locked, activity?.timerSeconds]);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem('iboard-question-sound', next ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (next) playQuestionChime();
  }

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

  if (!activity && !nudge) {
    if (!standalone) return null;
    return (
      <section className="grid min-h-[240px] place-items-center rounded-3xl border-2 border-dashed border-indigo-300 bg-white p-6 text-center shadow-xl dark:border-indigo-800 dark:bg-slate-900">
        <div>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-indigo-100 text-3xl dark:bg-indigo-950">⚡</div>
          <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">Pulse is ready</p>
          <h2 className="mt-2 font-display text-2xl font-black text-slate-950 dark:text-white">Waiting for your teacher</h2>
          <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">Your next question will appear here automatically.</p>
        </div>
      </section>
    );
  }

  const theme = QUESTION_THEMES[themeIndex];
  const answersClosed = activity?.locked || secondsLeft === 0;

  return (
    <>
      {arrival && (
        <button
          type="button"
          onClick={() => {
            setArrival(null);
            panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className={`iboard-question-arrival fixed inset-x-3 top-3 z-[65] mx-auto w-[calc(100%-1.5rem)] max-w-2xl rounded-3xl bg-gradient-to-br ${theme.splash} p-5 text-left text-white shadow-2xl ring-4 ring-white/60 sm:top-6 sm:p-7`}
          aria-live="assertive"
        >
          <span className="text-xs font-black uppercase tracking-[0.28em] text-white/80">New question</span>
          <span className="mt-1 block font-display text-3xl font-black">Question {arrival.questionNumber || 1}</span>
          <span className="mt-2 block text-lg font-bold leading-snug">{arrival.prompt}</span>
          <span className="mt-3 block text-xs font-bold uppercase tracking-wide text-white/80">Tap to answer now</span>
        </button>
      )}
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
        <section ref={panelRef} className={`scroll-mt-4 rounded-3xl border-2 bg-white p-4 shadow-xl ring-4 dark:bg-slate-900 ${compact ? '' : 'sm:p-6'} ${theme.panel} ${pulse ? 'iboard-question-pulse' : ''}`} aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs font-black uppercase tracking-[0.22em] ${theme.label}`}>Question {activity.questionNumber || 1} · Live now</p>
            <button type="button" onClick={toggleSound} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300" title="Turn new-question sound on or off">
              {soundOn ? '🔔 Sound on' : '🔕 Sound off'}
            </button>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${answersClosed ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {answersClosed ? 'Answers locked' : response ? 'You can change your answer' : 'Answer now'}
            </span>
          </div>
          <h2 className={`mt-3 font-display font-black leading-snug text-slate-950 dark:text-white ${compact ? 'text-lg' : 'text-xl sm:text-2xl'}`}>{activity.prompt}</h2>
          {secondsLeft !== null && <div className={`mt-3 rounded-xl px-3 py-2 text-center font-mono text-lg font-black ${secondsLeft <= 5 ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900'}`}>{secondsLeft > 0 ? `${secondsLeft}s remaining` : 'Time is up'}</div>}
          {activity.imageUrl && <img src={activity.imageUrl} alt="Question" className="mt-4 max-h-72 w-full rounded-2xl bg-white object-contain" />}

          {activity.type === 'short' ? (
            <div className="mt-5">
              <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} disabled={answersClosed} placeholder="Type a short answer…" className="min-h-28 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 text-base text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              <button type="button" disabled={answersClosed || !draft.trim()} onClick={() => submit(draft)} className="mt-3 w-full rounded-2xl bg-indigo-600 px-5 py-3 text-base font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">Send answer</button>
            </div>
          ) : (
            <div className={`mt-5 grid gap-3 ${!compact && activity.options.length > 3 ? 'sm:grid-cols-2' : ''}`}>
              {activity.options.map((option, index) => {
                const selected = response?.value === option;
                const correct = activity.correctAnswer && option === activity.correctAnswer;
                return (
                  <button key={option} type="button" disabled={answersClosed} onClick={() => submit(option)} className={`min-h-14 rounded-2xl border-2 px-4 py-3 text-left text-base font-black transition ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : correct ? 'border-emerald-500 bg-emerald-100 text-emerald-950' : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white'}`}>
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
