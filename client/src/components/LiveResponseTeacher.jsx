import { useEffect, useMemo, useRef, useState } from 'react';
import EngagementRing from './EngagementRing.jsx';
import AudienceQnaTeacher from './AudienceQnaTeacher.jsx';
import useEndsAtCountdown from '../hooks/useEndsAtCountdown.js';
import { fileToCompressedJpegDataUrl } from '../lib/image.js';

const QUEUE_KEY = 'iboard-pulse-question-queue';
const TEMPLATE_KEY = 'iboard-pulse-question-templates';

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
  stuck: 'I’m stuck', slow: 'Please slow down', explain: 'Explain again', private: 'Needs private help',
};
const QUICK_CHECKS = [
  ['Ready to continue?', ['Ready', 'Not yet']],
  ['How is the pace?', ['Too fast', 'Just right', 'Too slow']],
  ['How well do you understand?', ['I understand', 'Almost', 'Not yet']],
  ['What do you think?', ['Agree', 'Unsure', 'Disagree']],
];
const FEATURE_LABELS = ['', 'Strong evidence', 'Clear explanation', 'Excellent vocabulary', 'Interesting idea', 'Common misconception', 'Nearly there'];
const escapeHtml = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Border colour encodes answer state; tooltip keeps the full label for hover. */
function studentTileMeta(student) {
  if (student.engagement_status) {
    return {
      title: student.connected
        ? (STATUS_LABELS[student.engagement_status] || student.engagement_status)
        : `Offline · ${STATUS_LABELS[student.engagement_status] || student.engagement_status}`,
      className: 'border-2 border-amber-400',
    };
  }
  if (student.hasResponded) {
    const confidence = student.response?.confidence || '';
    if (confidence === 'confident') {
      return { title: student.connected ? 'Answered · confident' : 'Offline · answered · confident', className: 'border-2 border-emerald-500' };
    }
    if (confidence === 'unsure') {
      return { title: student.connected ? 'Answered · not sure' : 'Offline · answered · not sure', className: 'border-2 border-[#f5e000]' };
    }
    if (confidence === 'guessed') {
      return { title: student.connected ? 'Answered · guessed' : 'Offline · answered · guessed', className: 'border-2 border-red-500' };
    }
    return { title: student.connected ? 'Answered' : 'Offline · answered', className: 'border-2 border-indigo-400' };
  }
  return {
    title: student.connected ? 'Waiting' : 'Offline',
    className: 'border-2 border-slate-200 dark:border-slate-700',
  };
}

function firstName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Student';
  return trimmed.split(/\s+/)[0];
}

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
    <div className={`${display ? 'max-w-3xl space-y-3' : 'max-w-md space-y-2'}`}>
      {activity.options.map((option, index) => {
        const count = counts[option] || 0;
        const correct = activity.revealed && activity.correctAnswer === option;
        return (
          <div key={option} className={`grid items-center gap-2 ${display ? 'grid-cols-[minmax(80px,160px)_1fr_36px]' : 'grid-cols-[minmax(64px,110px)_1fr_28px]'}`}>
            <p className={`truncate font-bold ${display ? 'text-lg text-white' : 'text-sm text-slate-800 dark:text-slate-100'}`}><span className="mr-1 opacity-50">{activity.type === 'choice' ? String.fromCharCode(65 + index) : ''}</span>{option}</p>
            <div className={`overflow-hidden rounded-full ${display ? 'h-8 bg-white/15' : 'h-6 bg-slate-100 dark:bg-slate-800'}`}>
              <div className={`grid h-full min-w-1 place-items-end rounded-full px-2 transition-all duration-500 ${correct ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className={`text-right font-black ${display ? 'text-xl text-white' : 'text-sm text-slate-700 dark:text-slate-200'}`}>{count}</span>
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
  const [imageUrl, setImageUrl] = useState('');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [queue, setQueue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  });
  const [templates, setTemplates] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
      return Array.isArray(saved) ? saved.slice(0, 20) : [];
    } catch {
      return [];
    }
  });
  const [wallSelected, setWallSelected] = useState([]);
  const [wallMode, setWallMode] = useState('');
  const [slideIndex, setSlideIndex] = useState(0);
  const clockOffsetRef = useRef(0);

  useEffect(() => {
    const onLive = (payload) => {
      const serverNow = Number(payload?.serverNow);
      if (Number.isFinite(serverNow) && serverNow > 0) {
        clockOffsetRef.current = serverNow - Date.now();
      }
      setLive(payload || { activity: null, responses: [], students: [] });
    };
    socket.on('live:teacher', onLive);
    socket.emit('teacher:live-sync', {});
    return () => socket.off('live:teacher', onLive);
  }, [socket]);

  useEffect(() => {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, 30))); } catch { /* storage may be unavailable */ }
  }, [queue]);

  useEffect(() => {
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates.slice(0, 20))); } catch { /* storage may be unavailable */ }
  }, [templates]);

  const activity = live.activity;
  const secondsLeft = useEndsAtCountdown(activity?.endsAt, {
    enabled: !!activity?.timerSeconds && !activity?.locked,
    clockOffsetRef,
  });
  const responses = live.responses || [];
  const featuredWall = live.featuredWall || [];
  const students = [...(live.students || [])].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return (a.engagement?.score ?? 100) - (b.engagement?.score ?? 100);
  });
  const unansweredCount = students.filter(
    (student) => student.connected && !student.hasResponded
  ).length;
  const attention = students.filter(
    (student) => student.engagement_status && student.engagement_status !== 'ready'
  );

  function currentDraft() {
    return { type, prompt: prompt.trim(), options: options.map((value) => value.trim()).filter(Boolean), correctAnswer, anonymous, optional, imageUrl, timerSeconds };
  }

  function launch(question = currentDraft(), queueId = '') {
    socket.emit('teacher:live-launch', question, (ack) => {
      setMessage(ack?.ok ? 'Question is live.' : ack?.error || 'Could not launch');
      if (ack?.ok) {
        setComposerOpen(false);
        if (queueId) setQueue((items) => items.filter((item) => item.id !== queueId));
      }
    });
  }

  function addToQueue() {
    const question = currentDraft();
    if (!question.prompt) { setMessage('Add a question first.'); return; }
    if (question.type === 'choice' && question.options.length < 2) { setMessage('Add at least two choices.'); return; }
    setQueue((items) => [...items, { ...question, id: crypto.randomUUID?.() || `q-${Date.now()}` }]);
    setMessage('Question added to your queue.');
    setPrompt(''); setOptions(['', '', '', '']); setCorrectAnswer(''); setImageUrl('');
  }

  function saveTemplate() {
    const question = currentDraft();
    if (!question.prompt) { setMessage('Add a question first.'); return; }
    if (question.type === 'choice' && question.options.length < 2) { setMessage('Add at least two choices.'); return; }
    const id = globalThis.crypto?.randomUUID?.() || `template-${Date.now()}`;
    setTemplates((items) => [{ ...question, imageUrl: '', id }, ...items].slice(0, 20));
    setMessage(question.imageUrl ? 'Template saved on this browser without the image.' : 'Template saved on this browser.');
  }

  function loadTemplate(template) {
    setType(template.type || 'choice');
    setPrompt(String(template.prompt || '').slice(0, 500));
    const savedOptions = Array.isArray(template.options) ? template.options.map(String).slice(0, 6) : [];
    setOptions([...savedOptions, '', '', '', ''].slice(0, 4));
    setCorrectAnswer(String(template.correctAnswer || ''));
    setAnonymous(!!template.anonymous);
    setOptional(!!template.optional);
    setTimerSeconds(Number(template.timerSeconds) || 0);
    setImageUrl('');
    setComposerOpen(true);
    setMessage('Template loaded — edit it or launch when ready.');
  }

  function moveQueued(index, direction) {
    setQueue((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function loadImage(file) {
    if (!file) return;
    setImageBusy(true);
    try { setImageUrl(await fileToCompressedJpegDataUrl(file, 900, 0.7)); }
    catch { setMessage('Could not read that image.'); }
    finally { setImageBusy(false); }
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

  function acknowledge(studentId) {
    socket.emit('teacher:live-acknowledge', { studentId }, (ack) => setMessage(ack?.ok ? 'Student knows you have seen their request.' : 'Could not acknowledge.'));
  }

  function labelFeatured(id, label) { socket.emit('teacher:featured-label', { id, label }); }
  function removeFeatured(id) { socket.emit('teacher:featured-remove', { id }); setWallSelected((ids) => ids.filter((value) => value !== id)); }
  function clearFeaturedWall() {
    socket.emit('teacher:featured-clear', {}, (ack) => {
      if (!ack?.ok) {
        setMessage('Could not clear the Featured Wall.');
        return;
      }
      setWallSelected([]);
      setWallMode('');
      setMessage('Featured Wall cleared.');
    });
  }
  function improveFeatured(item) { launch({ type: 'short', prompt: `Improve this answer: “${item.value}”`, options: [], correctAnswer: '', anonymous: false, optional: false, imageUrl: '', timerSeconds: 0 }); }
  function compareFeatured() {
    const chosen = featuredWall.filter((item) => wallSelected.includes(item.id)).slice(0, 2);
    if (chosen.length !== 2) { setMessage('Select exactly two featured answers to compare.'); return; }
    setWallMode('compare');
  }
  function askComparison() {
    const chosen = featuredWall.filter((item) => wallSelected.includes(item.id)).slice(0, 2);
    if (chosen.length !== 2) return;
    launch({ type: 'choice', prompt: `Which response is stronger? A: “${chosen[0].value}” B: “${chosen[1].value}”`, options: ['Answer A', 'Answer B', 'Both are effective'], correctAnswer: '', anonymous: false, optional: false, imageUrl: '', timerSeconds: 0 });
    setWallMode('');
  }
  function downloadWall() {
    const body = featuredWall.map((item) => `<article><h2>Question ${item.questionNumber}: ${escapeHtml(item.prompt)}</h2><p>“${escapeHtml(item.value)}”</p><strong>${escapeHtml(item.label)}${item.name !== 'Anonymous' ? ` — ${escapeHtml(item.name)}` : ''}</strong></article>`).join('');
    const blob = new Blob([`<!doctype html><meta charset="utf-8"><title>iBOARD Featured Wall</title><style>body{font-family:Arial;max-width:900px;margin:40px auto}article{padding:20px;margin:16px 0;border:2px solid #ddd;border-radius:18px}p{font-size:20px}</style><h1>iBOARD Featured Wall</h1>${body}`], { type: 'text/html' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'iboard-featured-wall.html'; link.click(); URL.revokeObjectURL(url);
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
    <section className="mb-4 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-card dark:border-indigo-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-indigo-700 to-violet-700 px-4 py-3 text-white">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200">iBOARD Pulse</p>
          <h2 className="font-display text-lg font-black">Live class response</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {queue.length > 0 && <button type="button" onClick={() => launch(queue[0], queue[0].id)} className="rounded-lg bg-emerald-400 px-2.5 py-1.5 text-xs font-black text-emerald-950 shadow-sm">Launch next ({queue.length})</button>}
          {activity && <button type="button" onClick={() => setDisplayMode(true)} className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-black text-indigo-800 shadow-sm">Display results</button>}
          <button type="button" onClick={() => setComposerOpen((open) => !open)} className="rounded-lg bg-indigo-950/40 px-2.5 py-1.5 text-xs font-black ring-1 ring-white/30">{composerOpen ? 'Hide setup' : 'New question'}</button>
        </div>
      </div>

      <AudienceQnaTeacher socket={socket} hasLiveActivity={!!activity} />

      {composerOpen && (
        <div className="border-b border-slate-200 p-4 dark:border-slate-700" onPaste={(event) => { const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/')); if (file) { event.preventDefault(); loadImage(file); } }}>
          <p className="text-[10px] font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Instant checks</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{QUICK_CHECKS.map(([question, choices]) => <button key={question} type="button" onClick={() => launch({ type: 'choice', prompt: question, options: choices, correctAnswer: '', anonymous: false, optional: false, imageUrl: '', timerSeconds: 0 })} className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-black text-indigo-800 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200">{question}</button>)}</div>

          {templates.length > 0 && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-800 dark:bg-violet-950/30">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">My templates</p>
                <span className="text-[10px] font-semibold text-slate-500">Saved on this browser</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {templates.map((template) => (
                  <div key={template.id} className="flex max-w-full items-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-violet-200 dark:bg-slate-900 dark:ring-violet-800">
                    <button type="button" onClick={() => loadTemplate(template)} title={template.prompt} className="max-w-xs truncate px-2.5 py-1.5 text-left text-xs font-bold text-violet-900 hover:bg-violet-100 dark:text-violet-100 dark:hover:bg-violet-950">
                      {template.prompt}
                    </button>
                    <button type="button" onClick={() => setTemplates((items) => items.filter((item) => item.id !== template.id))} aria-label={`Delete template: ${template.prompt}`} className="border-l border-violet-200 px-2 py-1.5 text-xs font-black text-red-500 hover:bg-red-50 dark:border-violet-800 dark:hover:bg-red-950/40">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {TYPES.map(([value, label]) => <button key={value} type="button" onClick={() => { setType(value); setCorrectAnswer(''); }} className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${type === value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{label}</button>)}
          </div>
          <label className="mt-3 block text-[10px] font-black uppercase tracking-wide text-slate-500">Question or prompt</label>
          <input value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 500))} placeholder="What do you think?" className="mt-1 w-full max-w-2xl rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg bg-sky-100 px-2.5 py-1.5 text-xs font-black text-sky-900 hover:bg-sky-200">{imageBusy ? 'Preparing image…' : imageUrl ? 'Replace image' : 'Add image / screenshot'}<input type="file" accept="image/*" className="hidden" onChange={(event) => loadImage(event.target.files?.[0])} /></label>
            {imageUrl && <><img src={imageUrl} alt="Question preview" className="h-12 w-20 rounded-lg bg-white object-contain" /><button type="button" onClick={() => setImageUrl('')} className="text-xs font-black text-red-600">Remove</button></>}
            <span className="text-[11px] text-slate-500">Paste screenshot OK</span>
          </div>
          {type === 'choice' && (
            <div className="mt-2 grid max-w-2xl grid-cols-2 gap-1.5">
              {options.map((option, index) => <input key={index} value={option} onChange={(event) => setOptions((current) => current.map((value, i) => i === index ? event.target.value.slice(0, 120) : value))} placeholder={`Choice ${String.fromCharCode(65 + index)}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />)}
            </div>
          )}
          {type !== 'short' && (
            <label className="mt-2 block max-w-xs text-xs font-bold text-slate-600 dark:text-slate-300">Correct answer (optional)
              <select value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="">No correct answer / opinion poll</option>
                {(type === 'choice' ? options.filter(Boolean) : type === 'truefalse' ? ['True', 'False'] : ['1', '2', '3', '4', '5']).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {type === 'short' && <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" /> Anonymous when featured</label>}
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={optional} onChange={(event) => setOptional(event.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" /> Optional</label>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">Timer <select value={timerSeconds} onChange={(event) => setTimerSeconds(Number(event.target.value))} className="ml-1 rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"><option value="0">None</option><option value="15">15 sec</option><option value="30">30 sec</option><option value="60">1 min</option><option value="120">2 min</option></select></label>
            <div className="ml-auto flex flex-wrap gap-2"><button type="button" onClick={saveTemplate} className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-800 hover:bg-violet-50 dark:border-violet-800 dark:bg-slate-900 dark:text-violet-200">Save template</button><button type="button" onClick={addToQueue} className="rounded-lg bg-violet-100 px-3 py-2 text-xs font-black text-violet-900 hover:bg-violet-200">Add to queue</button><button type="button" onClick={() => launch()} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-md hover:bg-indigo-700">Launch now</button></div>
          </div>
        </div>
      )}

      {queue.length > 0 && <div className="border-b border-slate-200 bg-violet-50 p-3 dark:border-slate-700 dark:bg-violet-950/30"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-violet-950 dark:text-violet-100">Queue · {queue.length}</h3><button type="button" onClick={() => setQueue([])} className="text-xs font-black text-red-600">Clear</button></div><div className="mt-2 space-y-1.5">{queue.map((item, index) => <div key={item.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 shadow-sm dark:bg-slate-900"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-600 text-[10px] font-black text-white">{index + 1}</span><div className="flex flex-col"><button type="button" disabled={index === 0} onClick={() => moveQueued(index, -1)} className="text-[10px] font-black disabled:opacity-20">▲</button><button type="button" disabled={index === queue.length - 1} onClick={() => moveQueued(index, 1)} className="text-[10px] font-black disabled:opacity-20">▼</button></div>{item.imageUrl && <span title="Includes image">🖼️</span>}<p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-white">{item.prompt}</p><span className="text-[10px] font-bold text-slate-500">{item.timerSeconds ? `${item.timerSeconds}s` : '—'}</span><button type="button" onClick={() => launch(item, item.id)} className="rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-900">Launch</button><button type="button" onClick={() => setQueue((items) => items.filter((question) => question.id !== item.id))} className="px-1 text-sm font-black text-red-500">×</button></div>)}</div></div>}

      {activity && (
        <div className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 max-w-2xl">
              <p className="text-[10px] font-black uppercase tracking-wide text-indigo-600">
                Q{activity.questionNumber || 1} · Live · {responses.length} answered
                {secondsLeft !== null ? ` · ${secondsLeft}s` : ''}
              </p>
              <h3 className="mt-0.5 font-display text-lg font-black text-slate-950 dark:text-white">{activity.prompt}</h3>
              {activity.imageUrl && <img src={activity.imageUrl} alt="Question" className="mt-2 max-h-48 rounded-lg bg-white object-contain" />}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {secondsLeft !== null && (
                <span
                  className={`rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-black tabular-nums ${
                    secondsLeft === 0
                      ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      : secondsLeft <= 5
                        ? 'iboard-timer-urgent bg-red-600 text-white'
                        : 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200'
                  }`}
                >
                  {secondsLeft > 0 ? `${secondsLeft}s` : '0s'}
                </span>
              )}
              <button type="button" disabled={!unansweredCount || activity.locked} onClick={realertUnanswered} className="rounded-lg bg-violet-100 px-2.5 py-1.5 text-[11px] font-black text-violet-900 disabled:cursor-not-allowed disabled:opacity-40">
                Re-alert {unansweredCount}
              </button>
              <button type="button" onClick={() => control(activity.locked ? 'unlock' : 'lock')} className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-black text-amber-900">{activity.locked ? 'Unlock' : 'Lock'}</button>
              {activity.correctAnswer && !activity.revealed && <button type="button" onClick={() => control('reveal')} className="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-[11px] font-black text-emerald-900">Reveal</button>}
              <button type="button" onClick={() => control('clear')} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200">End</button>
            </div>
          </div>
          <div className="mt-3"><Results activity={activity} responses={responses} onPublish={publish} /></div>
        </div>
      )}

      {featuredWall.length > 0 && <section className="border-t border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Featured Wall</p><h3 className="text-sm font-black text-amber-950 dark:text-amber-100">Highlights · {featuredWall.length}</h3></div><div className="flex gap-1.5"><button type="button" onClick={compareFeatured} className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-black text-white">Compare</button><button type="button" onClick={() => { setSlideIndex(0); setWallMode('slides'); }} className="rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-black text-white">Present</button><button type="button" onClick={downloadWall} className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-black text-amber-900 shadow-sm">Save</button><button type="button" onClick={clearFeaturedWall} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-black text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300">Clear wall</button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{featuredWall.map((item) => <article key={item.id} className={`rounded-xl border-2 bg-white p-3 dark:bg-slate-900 ${wallSelected.includes(item.id) ? 'border-violet-500' : 'border-amber-200 dark:border-amber-800'}`}><div className="flex items-start gap-2"><input type="checkbox" checked={wallSelected.includes(item.id)} onChange={(event) => setWallSelected((ids) => event.target.checked ? [...ids.filter((id) => id !== item.id), item.id].slice(-2) : ids.filter((id) => id !== item.id))} className="mt-0.5 h-4 w-4 accent-violet-600" /><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase text-amber-700">Q{item.questionNumber} · {item.name}</p><p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">“{item.value}”</p><select value={item.label} onChange={(event) => labelFeatured(item.id, event.target.value)} className="mt-2 w-full rounded-md border border-amber-200 px-2 py-1 text-[11px] font-bold dark:border-amber-800 dark:bg-slate-950">{FEATURE_LABELS.map((label) => <option key={label} value={label}>{label || 'Why is this featured?'}</option>)}</select><div className="mt-2 flex gap-1.5"><button type="button" onClick={() => improveFeatured(item)} className="rounded-md bg-indigo-100 px-2 py-1 text-[10px] font-black text-indigo-800">Improve</button><button type="button" onClick={() => removeFeatured(item.id)} className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-black text-red-600">Remove</button></div></div></div></article>)}</div></section>}

      <div className="border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/50">
        {attention.length > 0 && (
          <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <h3 className="text-sm font-black text-amber-950 dark:text-amber-100">Check now · {attention.length}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {attention.map((student) => {
                const reason = STATUS_LABELS[student.engagement_status] || student.engagement_status;
                return (
                  <div key={student.id} className="flex w-[min(100%,220px)] items-center gap-2 rounded-lg bg-white px-2.5 py-2 dark:bg-slate-900">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black text-slate-900 dark:text-white">{student.name}</p>
                      <p className="truncate text-[10px] font-bold text-amber-800 dark:text-amber-300">{reason}</p>
                    </div>
                    <button type="button" onClick={() => acknowledge(student.id)} className="shrink-0 rounded-md bg-amber-600 px-2 py-1 text-[10px] font-black text-white">Seen</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Engagement pulse</h3>
            <p className="text-[10px] text-slate-500">Participation only — teachers only</p>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">{students.filter((student) => student.connected).length} online</span>
        </div>
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-2">
          {students.map((student) => {
            const tile = studentTileMeta(student);
            return (
              <div
                key={student.id}
                title={`${student.name} · ${tile.title}`}
                className={`relative flex flex-col items-center gap-1 rounded-[1.1rem] bg-white px-1 pb-1.5 pt-2 dark:bg-slate-900 ${tile.className}`}
              >
                <button
                  type="button"
                  disabled={!student.connected}
                  onClick={() => nudge(student.id)}
                  title="Send a private check-in"
                  className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-md bg-indigo-50 text-[9px] font-black text-indigo-700 hover:bg-indigo-100 disabled:opacity-30 dark:bg-indigo-950 dark:text-indigo-200"
                >
                  N
                </button>
                <EngagementRing engagement={student.engagement} connected={student.connected} size={36} />
                <p className="w-full truncate px-0.5 text-center text-[10px] font-black leading-tight text-slate-900 dark:text-white">{firstName(student.name)}</p>
              </div>
            );
          })}
          {!students.length && <p className="col-span-full text-xs text-slate-500">Students will appear here when they join.</p>}
        </div>
      </div>
      {message && <p className="border-t border-slate-200 px-4 py-1.5 text-[11px] font-bold text-indigo-700 dark:border-slate-700 dark:text-indigo-300">{message}</p>}

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
      {wallMode === 'compare' && (() => { const chosen = featuredWall.filter((item) => wallSelected.includes(item.id)).slice(0, 2); return <div className="fixed inset-0 z-[85] overflow-auto bg-gradient-to-br from-violet-950 to-slate-950 p-6 text-white"><button type="button" onClick={() => setWallMode('')} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 font-black text-violet-950">Close</button><div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center"><h2 className="mb-8 text-center font-display text-4xl font-black">Which response is stronger—and why?</h2><div className="grid gap-6 md:grid-cols-2">{chosen.map((item, index) => <article key={item.id} className="rounded-3xl bg-white/10 p-8 ring-2 ring-white/20"><p className="text-sm font-black uppercase tracking-widest text-violet-300">Answer {index ? 'B' : 'A'} · {item.label}</p><p className="mt-5 text-3xl font-bold leading-relaxed">“{item.value}”</p></article>)}</div><button type="button" onClick={askComparison} className="mx-auto mt-8 rounded-2xl bg-violet-400 px-6 py-3 font-black text-violet-950">Ask the class</button></div></div>; })()}
      {wallMode === 'slides' && featuredWall[slideIndex] && <div className="fixed inset-0 z-[85] grid place-items-center bg-gradient-to-br from-amber-950 via-violet-950 to-slate-950 p-8 text-white"><button type="button" onClick={() => setWallMode('')} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 font-black text-slate-950">Close</button><article className="max-w-5xl text-center"><p className="text-lg font-black uppercase tracking-widest text-amber-300">{featuredWall[slideIndex].label || `Question ${featuredWall[slideIndex].questionNumber}`}</p><p className="mt-6 font-display text-4xl font-black leading-relaxed sm:text-6xl">“{featuredWall[slideIndex].value}”</p><p className="mt-5 text-xl text-white/70">{featuredWall[slideIndex].name}</p><div className="mt-10 flex justify-center gap-3"><button type="button" disabled={slideIndex === 0} onClick={() => setSlideIndex((value) => value - 1)} className="rounded-xl bg-white/20 px-5 py-3 font-black disabled:opacity-30">Previous</button><span className="px-3 py-3 font-black">{slideIndex + 1} / {featuredWall.length}</span><button type="button" disabled={slideIndex === featuredWall.length - 1} onClick={() => setSlideIndex((value) => value + 1)} className="rounded-xl bg-white/20 px-5 py-3 font-black disabled:opacity-30">Next</button></div></article></div>}
    </section>
  );
}
