import { useCallback, useEffect, useRef, useState } from 'react';
import useEndsAtCountdown from '../hooks/useEndsAtCountdown.js';

const STATUS_OPTIONS = [
  ['ready', 'Yep, ready'],
  ['unsure', 'I’m unsure'],
  ['tech', 'Tech problem'],
];
const CONFIDENCE_OPTIONS = [
  ['confident', 'Confident', '🟢'],
  ['unsure', 'Not sure', '🟡'],
  ['guessed', 'Guessed', '🔴'],
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

export default function LiveResponseStudent({ socket, standalone = false, compact = false, collapsed = false, onCollapse, onExpand }) {
  const [activity, setActivity] = useState(null);
  const [response, setResponse] = useState(null);
  const [featured, setFeatured] = useState([]);
  const [draft, setDraft] = useState('');
  const [confidenceChoice, setConfidenceChoice] = useState('');
  const [nudge, setNudge] = useState(false);
  const [message, setMessage] = useState('');
  const [arrival, setArrival] = useState(null);
  const [pulse, setPulse] = useState(false);
  const [themeIndex, setThemeIndex] = useState(0);
  const [featuredNotice, setFeaturedNotice] = useState(false);
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
  const clockOffsetRef = useRef(0);

  const secondsLeft = useEndsAtCountdown(activity?.endsAt, {
    enabled: !!activity?.timerSeconds && !activity?.locked,
    clockOffsetRef,
  });

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
    const syncClock = (payload) => {
      const serverNow = Number(payload?.serverNow);
      if (Number.isFinite(serverNow) && serverNow > 0) {
        clockOffsetRef.current = serverNow - Date.now();
      }
    };
    const onActivity = (payload) => {
      syncClock(payload);
      const nextActivity = payload?.activity || null;
      const isNew = nextActivity?.id && nextActivity.id !== activityIdRef.current;
      setActivity(nextActivity);
      setFeatured(Array.isArray(payload?.featured) ? payload.featured : []);
      if (isNew) {
        setResponse(null);
        setDraft('');
        setConfidenceChoice('');
        drawAttention(nextActivity);
      }
      if (!nextActivity) {
        activityIdRef.current = '';
        setResponse(null);
        setDraft('');
        setConfidenceChoice('');
      }
    };
    const onMine = (payload) => {
      syncClock(payload);
      const nextActivity = payload?.activity || null;
      setActivity(nextActivity);
      if (nextActivity?.id && nextActivity.id !== activityIdRef.current) drawAttention(nextActivity);
      setResponse(payload?.response || null);
      setDraft(payload?.response?.value || '');
      setConfidenceChoice(payload?.response?.confidence || '');
    };
    const onNudge = () => setNudge(true);
    const onRealert = (payload) => {
      if (payload?.activity) {
        setActivity(payload.activity);
        drawAttention(payload.activity, true);
      }
    };
    const onFeatured = () => { setFeaturedNotice(true); setTimeout(() => setFeaturedNotice(false), 5000); };
    socket.on('live:activity', onActivity);
    socket.on('live:student', onMine);
    socket.on('live:nudge', onNudge);
    socket.on('live:realert', onRealert);
    socket.on('live:featured', onFeatured);
    socket.emit('student:live-sync', {});
    return () => {
      socket.off('live:activity', onActivity);
      socket.off('live:student', onMine);
      socket.off('live:nudge', onNudge);
      socket.off('live:realert', onRealert);
      socket.off('live:featured', onFeatured);
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      document.title = originalTitleRef.current;
    };
  }, [drawAttention, socket]);

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
    const selectedConfidence = confidenceChoice;
    setMessage('Sending…');
    socket.emit('student:live-response', { activityId: activity.id, value }, (ack) => {
      setMessage(ack?.ok ? 'Answer sent ✓' : ack?.error || 'Could not send');
      if (ack?.ok) {
        setResponse({ value, confidence: selectedConfidence });
        setDraft(value);
        if (selectedConfidence) {
          socket.emit('student:live-confidence', { activityId: activity.id, confidence: selectedConfidence }, (confidenceAck) => {
            if (confidenceAck?.ok) {
              setResponse((current) => ({ ...(current || { value }), confidence: selectedConfidence }));
            }
          });
        }
      }
    });
  }

  function answerNudge(status) {
    socket.emit('student:live-status', { status }, () => {});
    setNudge(false);
  }

  function setConfidence(confidence) {
    if (!activity) return;
    setConfidenceChoice(confidence);
    if (!response) return;
    socket.emit('student:live-confidence', { activityId: activity.id, confidence }, (ack) => {
      if (ack?.ok) setResponse((current) => ({ ...current, confidence }));
    });
  }

  function renderConfidenceControls(withDivider = false) {
    return (
      <div className={`${withDivider ? 'border-t border-slate-200 dark:border-slate-700' : ''} ${compact ? 'mt-2 pt-2' : 'mt-3 pt-2'}`}>
        <p className={`text-center font-black uppercase tracking-wide text-slate-500 ${compact ? 'text-[10px]' : 'text-xs'}`}>How sure?</p>
        <div className={`grid grid-cols-3 ${compact ? 'mt-1 gap-1' : 'mt-2 gap-2'}`}>
          {CONFIDENCE_OPTIONS.map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              disabled={answersClosed}
              onClick={() => setConfidence(value)}
              className={`font-black disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'rounded-lg px-1 py-1.5 text-[10px] leading-tight' : 'rounded-xl px-2 py-2 text-xs'} ${confidenceChoice === value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
            >
              {compact ? `${icon} ${label}` : `${icon} ${label === 'Guessed' ? 'I guessed' : label}`}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (collapsed) {
    const needsAnswer = !!activity && !response && !activity.locked && secondsLeft !== 0;
    let label = 'Pulse ready';
    let detail = 'Waiting for a question';
    let colour = 'from-indigo-600 to-violet-700 text-white ring-indigo-300';

    if (nudge) {
      label = 'Teacher check-in';
      detail = 'Tap to reply';
      colour = 'from-rose-600 to-red-600 text-white ring-rose-300';
    } else if (featuredNotice) {
      label = 'Answer featured!';
      detail = 'Tap to see it';
      colour = 'from-amber-400 to-yellow-300 text-amber-950 ring-amber-200';
    } else if (needsAnswer) {
      label = `New question · Q${activity.questionNumber || 1}`;
      detail = 'Tap to answer now';
      colour = 'from-fuchsia-600 to-violet-700 text-white ring-fuchsia-300';
    } else if (activity && response) {
      label = `Answer sent · Q${activity.questionNumber || 1}`;
      detail = 'Tap to review';
      colour = 'from-emerald-500 to-teal-600 text-white ring-emerald-300';
    } else if (activity) {
      label = `Question closed · Q${activity.questionNumber || 1}`;
      detail = 'Tap to review';
      colour = 'from-slate-600 to-slate-700 text-white ring-slate-300';
    }

    return (
      <button
        type="button"
        onClick={onExpand}
        className={`flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r px-4 py-3 text-left transition hover:brightness-110 ${colour} ${(pulse || nudge) ? 'iboard-question-pulse' : ''}`}
        aria-label={`${label}. ${detail}. Open Pulse panel.`}
        aria-live={(needsAnswer || nudge) ? 'assertive' : 'polite'}
      >
        <span className="min-w-0 truncate text-sm font-black leading-none">{label}</span>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-black leading-none text-indigo-800 shadow-sm">Open</span>
      </button>
    );
  }

  const collapseButton = compact && onCollapse ? (
    <button
      type="button"
      onClick={onCollapse}
      className="mb-2 flex w-full items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-[11px] font-black text-indigo-700 shadow-sm hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-slate-800"
      aria-label="Collapse Pulse to a small pill"
    >
      <span aria-hidden="true">—</span> Collapse Pulse
    </button>
  ) : null;

  if (!activity && !nudge) {
    // The embedded dock can be opened while idle; show its compact waiting state
    // instead of rendering nothing and making the Pulse control disappear.
    if (!standalone && !compact) return null;
    return (
      <>
        {collapseButton}
        <section className={`grid place-items-center rounded-2xl border-2 border-dashed border-indigo-300 bg-white text-center shadow-xl dark:border-indigo-800 dark:bg-slate-900 ${compact ? 'min-h-[140px] p-3' : 'min-h-[240px] p-6'}`}>
          <div>
            <div className={`mx-auto grid place-items-center rounded-full bg-indigo-100 dark:bg-indigo-950 ${compact ? 'h-10 w-10 text-xl' : 'h-16 w-16 text-3xl'}`}>⚡</div>
            <p className={`font-black uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300 ${compact ? 'mt-2 text-[10px]' : 'mt-4 text-xs'}`}>You’re connected</p>
            <h2 className={`font-display font-black text-slate-950 dark:text-white ${compact ? 'mt-1 text-base' : 'mt-2 text-2xl'}`}>Waiting for a question</h2>
            {!compact && <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">No need to refresh. When your teacher launches one, tap an answer here.</p>}
          </div>
        </section>
      </>
    );
  }

  const theme = QUESTION_THEMES[themeIndex];
  const answersClosed = activity?.locked || secondsLeft === 0;

  return (
    <>
      {featuredNotice && <div className="fixed inset-x-3 top-3 z-[75] mx-auto max-w-md rounded-3xl bg-gradient-to-r from-amber-400 to-yellow-300 p-5 text-center text-amber-950 shadow-2xl"><p className="text-3xl">⭐</p><p className="font-display text-xl font-black">Your answer was featured!</p></div>}
      {collapseButton}
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
        <section ref={panelRef} className={`scroll-mt-4 border-2 bg-white shadow-xl ring-4 dark:bg-slate-900 ${compact ? 'mt-2 rounded-2xl p-2.5 ring-2' : 'rounded-3xl p-4 sm:p-6'} ${theme.panel} ${pulse ? 'iboard-question-pulse' : ''}`} aria-live="polite">
          <div className={`flex flex-wrap items-center justify-between ${compact ? 'gap-1' : 'gap-2'}`}>
            <p className={`font-black uppercase tracking-[0.18em] ${theme.label} ${compact ? 'text-[10px]' : 'text-xs tracking-[0.22em]'}`}>Q{activity.questionNumber || 1} · Live</p>
            <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'gap-2'}`}>
              {secondsLeft !== null && (
                <span
                  className={`rounded-full font-mono font-black tabular-nums ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'} ${
                    secondsLeft === 0
                      ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      : secondsLeft <= 5
                        ? 'iboard-timer-urgent bg-red-600 text-white'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                  aria-live="polite"
                >
                  {secondsLeft > 0 ? `${secondsLeft}s` : '0s'}
                </span>
              )}
              <button type="button" onClick={toggleSound} className={`rounded-full bg-slate-100 font-bold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}`} title="Turn new-question sound on or off">
                {soundOn ? '🔔' : '🔕'}
              </button>
              {!compact && (
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${answersClosed ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                  {answersClosed ? 'Answers locked' : response ? 'You can change your answer' : 'Answer now'}
                </span>
              )}
            </div>
          </div>
          <h2 className={`font-display font-black leading-snug text-slate-950 dark:text-white ${compact ? 'mt-1.5 text-base' : 'mt-3 text-xl sm:text-2xl'}`}>{activity.prompt}</h2>
          {activity.imageUrl && <img src={activity.imageUrl} alt="Question" className={`w-full rounded-2xl bg-white object-contain ${compact ? 'mt-2 max-h-28' : 'mt-4 max-h-72'}`} />}

          {activity.type === 'short' ? (
            <div className={compact ? 'mt-2' : 'mt-5'}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} disabled={answersClosed} placeholder="Type a short answer…" className={`w-full rounded-2xl border-2 border-slate-200 bg-slate-50 text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white ${compact ? 'min-h-16 p-2 text-sm' : 'min-h-28 p-4 text-base'}`} />
              {renderConfidenceControls(false)}
              <button type="button" disabled={answersClosed || !draft.trim()} onClick={() => submit(draft)} className={`w-full rounded-2xl bg-indigo-600 font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 ${compact ? 'mt-2 px-3 py-2 text-sm' : 'mt-3 px-5 py-3 text-base'}`}>Send answer</button>
            </div>
          ) : (
            <div className={`grid ${compact ? 'mt-2 gap-1.5' : `mt-5 gap-3 ${activity.options.length > 3 ? 'sm:grid-cols-2' : ''}`}`}>
              {activity.options.map((option, index) => {
                const selected = response?.value === option;
                const correct = activity.correctAnswer && option === activity.correctAnswer;
                const optionsAreLetters = activity.type === 'choice'
                  && activity.options.every((item, itemIndex) => item === String.fromCharCode(65 + itemIndex));
                return (
                  <button key={option} type="button" disabled={answersClosed} onClick={() => submit(option)} className={`rounded-2xl border-2 text-left font-black transition ${compact ? 'min-h-10 px-3 py-2 text-sm' : 'min-h-14 px-4 py-3 text-base'} ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : correct ? 'border-emerald-500 bg-emerald-100 text-emerald-950' : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white'}`}>
                    <span className="mr-2 opacity-60">{activity.type === 'choice' && !optionsAreLetters ? String.fromCharCode(65 + index) : ''}</span>{option}
                  </button>
                );
              })}
            </div>
          )}
          {message && <p className={`text-center font-bold text-indigo-700 dark:text-indigo-300 ${compact ? 'mt-1.5 text-xs' : 'mt-3 text-sm'}`}>{message}</p>}
          {response && activity.type !== 'short' && renderConfidenceControls(true)}
          {activity.type === 'short' && featured.length > 0 && (
            <div className={`border-t border-slate-200 dark:border-slate-700 ${compact ? 'mt-2 pt-2' : 'mt-5 pt-4'}`}>
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Shared by your teacher</p>
              {featured.map((item, index) => (
                <blockquote key={index} className="mt-2 rounded-xl bg-violet-50 p-3 text-sm text-violet-950 dark:bg-violet-950 dark:text-violet-100">
                  {item.label && (
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">
                      Why it was featured: {item.label}
                    </span>
                  )}
                  “{item.value}” <span className="font-bold">— {item.name}</span>
                </blockquote>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
