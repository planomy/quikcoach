import { useEffect, useMemo, useRef, useState } from 'react';
import EngagementRing from './EngagementRing.jsx';
import AudienceQnaTeacher from './AudienceQnaTeacher.jsx';
import QuikPulsePanel, { isQuikPulseActivity } from './QuikPulsePanel.jsx';
import TeacherAnswerRail from './TeacherAnswerRail.jsx';
import useEndsAtCountdown from '../hooks/useEndsAtCountdown.js';
import { fileToCompressedJpegDataUrl } from '../lib/image.js';
import { studentTileMeta, LIVE_STATUS_LABELS as STATUS_LABELS } from '../lib/liveResponseMeta.js';
import { downloadTextFile } from '../lib/exportRoom.js';

const FEATURE_LABELS = ['', 'Strong evidence', 'Clear explanation', 'Excellent vocabulary', 'Interesting idea', 'Common misconception', 'Nearly there'];
const escapeHtml = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const QUEUE_KEY = 'iboard-pulse-question-queue';
const TEMPLATE_KEY = 'iboard-pulse-question-templates';

const TYPES = [
  ['choice', 'Multiple choice'],
  ['truefalse', 'True / False'],
  ['rating', '1–5 scale'],
  ['short', 'Short answer'],
];

function firstName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Student';
  return trimmed.split(/\s+/)[0];
}

const PANEL_TAB_LABELS = {
  ask: { title: 'Ask', hint: 'Send a question to your class' },
  respond: { title: 'Respond', hint: 'Questions waiting from students' },
  responses: { title: 'Responses', hint: 'Answers coming back from your live question' },
};

function PanelTabButton({ active, label, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 overflow-visible rounded-t-lg px-3 py-2 text-[11px] font-bold transition sm:px-3.5 sm:text-xs ${
        active
          ? 'z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
          : 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
      }`}
    >
      {label}
      {badge ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums leading-none ${
            active ? 'bg-white/25' : 'bg-amber-500 text-amber-950'
          }`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function Results({ activity, responses, display = false, onPublish }) {
  const counts = useMemo(() => {
    const result = Object.fromEntries((activity?.options || []).map((option) => [option, 0]));
    for (const response of responses || []) result[response.value] = (result[response.value] || 0) + 1;
    return result;
  }, [activity, responses]);
  const max = Math.max(1, ...Object.values(counts));
  const optionsAreLetters = activity?.type === 'choice'
    && activity.options.every((option, index) => option === String.fromCharCode(65 + index));

  if (!activity) return null;
  if (activity.type === 'short') {
    const visible = display ? responses.filter((response) => response.published) : responses;
    return (
      <div className="space-y-3">
        {activity.correctAnswer && (!display || activity.revealed) && (
          <p className={`rounded-xl px-3 py-2 text-sm font-bold ${display ? 'bg-emerald-400/20 text-emerald-100' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'}`}>
            Expected: {activity.correctAnswer}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((response) => (
            <article key={response.studentId} className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950 shadow-sm dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100">
              <p className={`${display ? 'text-xl' : 'text-sm'} leading-relaxed`}>“{response.value}”</p>
              {!display && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-bold">{activity.anonymous ? 'Anonymous to class' : response.name}</span>
                  <button type="button" onClick={() => onPublish?.(response)} className={`rounded-lg px-2.5 py-1 text-xs font-black ${response.published ? 'bg-indigo-700 text-white' : 'bg-white text-indigo-800 dark:bg-slate-900 dark:text-indigo-200'}`}>
                    {response.published ? 'Featured ✓' : 'Feature'}
                  </button>
                </div>
              )}
              {display && !activity.anonymous && <p className="mt-2 text-sm font-bold">— {response.name}</p>}
            </article>
          ))}
          {!visible.length && <p className="text-sm font-medium text-slate-500">{display ? 'No answers have been featured yet.' : 'Waiting for answers…'}</p>}
        </div>
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
            <p className={`truncate font-bold ${display ? 'text-lg text-white' : 'text-sm text-slate-800 dark:text-slate-100'}`}><span className="mr-1 opacity-50">{activity.type === 'choice' && !optionsAreLetters ? String.fromCharCode(65 + index) : ''}</span>{option}</p>
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

export default function LiveResponseTeacher({
  socket,
  onCopyStudentLink,
  embedded = false,
  overlay = false,
  collapsed = false,
  onExpand,
  onClose,
  onLiveSummary,
  panelTab = null,
  panelTabs = false,
  onPanelTabChange,
  onQuestionLaunched,
  highlightStudentId = null,
  onClearHighlight,
}) {
  const [internalPanelTab, setInternalPanelTab] = useState('ask');
  const effectivePanelTab = panelTab ?? (panelTabs ? internalPanelTab : null);
  const usingPanelTabs = effectivePanelTab != null;
  const [live, setLive] = useState({ activity: null, responses: [], students: [] });
  const [type, setType] = useState('choice');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [optional, setOptional] = useState(false);
  const [displayMode, setDisplayMode] = useState(false);
  const [activeView, setActiveView] = useState('quik');
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [qnaQuestions, setQnaQuestions] = useState([]);
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
  const moreMenuRef = useRef(null);
  const liveMoreMenuRef = useRef(null);

  useEffect(() => {
    function closeIfOutside(event) {
      const target = event.target;
      const more = moreMenuRef.current;
      const liveMore = liveMoreMenuRef.current;
      if (more?.open && !more.contains(target)) more.open = false;
      if (liveMore?.open && !liveMore.contains(target)) liveMore.open = false;
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      if (moreMenuRef.current) moreMenuRef.current.open = false;
      if (liveMoreMenuRef.current) liveMoreMenuRef.current.open = false;
    }
    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

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
    const onQna = (payload) => setQnaQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    socket.on('qna:teacher', onQna);
    socket.emit('teacher:qna-sync', {});
    return () => socket.off('qna:teacher', onQna);
  }, [socket]);

  useEffect(() => {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, 30))); } catch { /* storage may be unavailable */ }
  }, [queue]);

  useEffect(() => {
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates.slice(0, 20))); } catch { /* storage may be unavailable */ }
  }, [templates]);

  const activity = live.activity;
  const currentActivityIsQuikPulse = isQuikPulseActivity(activity);

  useEffect(() => {
    if (!activity && activeView === 'live') setActiveView('quik');
  }, [activity, activeView]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

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
  const connectedCount = students.filter((student) => student.connected).length;
  const participantCount = Math.max(students.length, responses.length);
  const responseSummary = participantCount
    ? `${responses.length} of ${participantCount} responded`
    : `${responses.length} responded`;
  const attention = students.filter(
    (student) => student.engagement_status && student.engagement_status !== 'ready'
  );
  const pendingQuestions = qnaQuestions
    .filter((question) => question.status === 'pending')
    .sort((a, b) => Number(a.id) - Number(b.id));

  function switchPanelTab(nextTab) {
    if (panelTab && typeof onPanelTabChange === 'function') onPanelTabChange(nextTab);
    else if (panelTabs) setInternalPanelTab(nextTab);
    if (nextTab === 'respond') setActiveView('qna');
    else if (nextTab === 'ask' && (activeView === 'qna' || activeView === 'student')) setActiveView('quik');
  }

  const prevPendingCountRef = useRef(0);
  useEffect(() => {
    const count = pendingQuestions.length;
    if (count > prevPendingCountRef.current && count > 0) {
      switchPanelTab('respond');
      setActiveView('qna');
    }
    prevPendingCountRef.current = count;
  }, [pendingQuestions.length]);

  useEffect(() => {
    onLiveSummary?.({
      hasActivity: !!activity,
      activityPrompt: activity?.prompt || '',
      responseCount: responses.length,
      participantCount,
      pendingQuestions: pendingQuestions.length,
    });
  }, [
    activity,
    responses.length,
    participantCount,
    pendingQuestions.length,
    onLiveSummary,
  ]);
  const pendingByStudent = pendingQuestions.reduce((counts, question) => {
    const studentId = Number(question.studentId);
    counts[studentId] = (counts[studentId] || 0) + 1;
    return counts;
  }, {});
  const firstPendingPositionByStudent = pendingQuestions.reduce((positions, question, index) => {
    const studentId = Number(question.studentId);
    if (!positions[studentId]) positions[studentId] = index + 1;
    return positions;
  }, {});
  const selectedStudent = students.find((student) => Number(student.id) === Number(selectedStudentId)) || null;

  function currentDraft() {
    return { type, prompt: prompt.trim(), options: options.map((value) => value.trim()).filter(Boolean), correctAnswer, anonymous, optional, imageUrl, timerSeconds };
  }

  function launch(question = currentDraft(), queueId = '', successMessage = 'Question is live.') {
    socket.emit('teacher:live-launch', question, (ack) => {
      setMessage(ack?.ok ? successMessage : ack?.error || 'Could not launch');
      if (ack?.ok) {
        if (usingPanelTabs) {
          onQuestionLaunched?.();
          switchPanelTab('responses');
        } else {
          setActiveView('live');
        }
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
    setActiveView('build');
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
      if (action === 'clear' && ack?.ok) {
        setActiveView('quik');
        if (usingPanelTabs) onClose?.();
        else setMessage('Question ended. Ready for the next one.');
      }
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
    const html = `<!doctype html><meta charset="utf-8"><title>iBOARD Featured Wall</title><style>body{font-family:Arial;max-width:900px;margin:40px auto}article{padding:20px;margin:16px 0;border:2px solid #ddd;border-radius:18px}p{font-size:20px}</style><h1>iBOARD Featured Wall</h1>${body}`;
    void downloadTextFile('iboard-featured-wall.html', html, 'text/html;charset=utf-8');
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

  function returnToPrimaryView() {
    setActiveView(activity ? 'live' : 'quik');
    setSelectedStudentId(null);
  }

  function openStudent(student) {
    setSelectedStudentId(student.id);
    if (usingPanelTabs) {
      switchPanelTab('respond');
      setActiveView('student');
      return;
    }
    setActiveView(pendingByStudent[Number(student.id)] ? 'qna' : 'student');
  }

  function launchQuikPulse(question) {
    launch(question, '', 'Question is live.');
  }

  function repeatQuikPulse() {
    if (!activity || !currentActivityIsQuikPulse) return;
    launch({
      type: activity.type,
      prompt: activity.prompt,
      options: Array.isArray(activity.options) ? activity.options : [],
      correctAnswer: '',
      anonymous: !!activity.anonymous,
      optional: !!activity.optional,
      imageUrl: '',
      timerSeconds: 0,
    }, '', 'Fresh question is live.');
  }

  if (!overlay && collapsed && !activity && pendingQuestions.length === 0) {
    return null;
  }

  if (!overlay && collapsed && (activity || pendingQuestions.length > 0)) {
    return (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200/80 bg-indigo-50/60 px-3 py-2 dark:border-indigo-900 dark:bg-indigo-950/40">
        <div className="min-w-0 flex-1">
          {activity ? (
            <>
              <p className="text-[10px] font-black uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Question live</p>
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{activity.prompt}</p>
              <p className="text-[11px] text-slate-500">{responseSummary}</p>
            </>
          ) : (
            <>
              <p className="text-[10px] font-black uppercase tracking-wide text-indigo-600">Student questions</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{pendingQuestions.length} waiting for you</p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => onExpand?.(pendingQuestions.length && !activity ? 'respond' : 'ask')}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700"
        >
          {pendingQuestions.length && !activity ? 'Open Respond' : 'Open Ask'}
        </button>
      </div>
    );
  }

  const sectionClass = overlay
    ? 'flex w-full flex-col overflow-hidden bg-white dark:bg-slate-900'
    : embedded
      ? 'mb-3 overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900'
      : 'mb-4 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-card dark:border-indigo-800 dark:bg-slate-900';

  const panelMeta = effectivePanelTab ? PANEL_TAB_LABELS[effectivePanelTab] : null;

  const awarenessStrip = (
    <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/50">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900 dark:text-white">Class awareness</h3>
          <p className="text-[10px] text-slate-500">
            {connectedCount} online
            {attention.length ? ` · ${attention.length} need attention` : ''}
            {pendingQuestions.length ? ` · ${pendingQuestions.length} question${pendingQuestions.length === 1 ? '' : 's'} waiting` : ''}
          </p>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {students.map((student) => {
          const tile = studentTileMeta(student);
          const questionCount = pendingByStudent[Number(student.id)] || 0;
          const queuePosition = firstPendingPositionByStudent[Number(student.id)] || 0;
          const needsAttention = student.engagement_status && student.engagement_status !== 'ready';
          return (
            <div key={student.id} className="relative w-[70px] shrink-0">
              <button type="button" onClick={() => openStudent(student)} title={`${student.name} · ${tile.title}`} className={`flex w-full flex-col items-center gap-1 rounded-[1.1rem] bg-white px-1 pb-1.5 pt-2 dark:bg-slate-900 ${tile.className}`}>
                <EngagementRing engagement={student.engagement} connected={student.connected} size={34} />
                <span className="w-full truncate px-0.5 text-center text-[10px] font-black leading-tight text-slate-900 dark:text-white">{firstName(student.name)}</span>
              </button>
              {needsAttention && <span title={STATUS_LABELS[student.engagement_status] || student.engagement_status} className="absolute -left-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-white shadow-sm">!</span>}
              {questionCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectedStudentId(student.id); switchPanelTab('respond'); setActiveView('qna'); }}
                  aria-label={`Question ${queuePosition} from ${student.name}`}
                  className="absolute right-0 top-0 grid h-6 min-w-6 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] font-black text-white shadow-sm ring-2 ring-white dark:ring-slate-900"
                >
                  {queuePosition}
                </button>
              )}
            </div>
          );
        })}
        {!students.length && <p className="py-3 text-xs text-slate-500">Students will appear here when they join.</p>}
      </div>
    </div>
  );

  const askSubNav = (
    <nav aria-label="Ask options" className="flex shrink-0 items-end gap-1 border-b border-slate-200 bg-slate-100/80 px-3 pt-2 dark:border-slate-700 dark:bg-slate-950/50">
      {[
        ['quik', 'Quick Question'],
        ['build', 'Send Question'],
        ['prepared', `Saved · ${queue.length + templates.length}`],
      ].map(([view, label]) => (
        <button
          key={view}
          type="button"
          onClick={() => setActiveView(view)}
          className={`rounded-t-lg px-3.5 py-2 text-[11px] font-bold transition sm:px-4 sm:text-xs ${
            activeView === view
              ? 'relative z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
              : 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
      {featuredWall.length > 0 && (
        <button
          type="button"
          onClick={() => setActiveView('featured')}
          className={`rounded-t-lg px-3.5 py-2 text-[11px] font-bold transition sm:px-4 sm:text-xs ${
            activeView === 'featured'
              ? 'relative z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
              : 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          Featured · {featuredWall.length}
        </button>
      )}
    </nav>
  );

  const panelTabNav = usingPanelTabs && panelTabs && !panelTab ? (
    <nav aria-label="Teacher tools" className="flex shrink-0 items-end gap-1 border-b border-slate-200 bg-slate-100/80 px-3 pt-2 dark:border-slate-700 dark:bg-slate-950/50">
      <PanelTabButton active={effectivePanelTab === 'ask'} label="Ask" onClick={() => switchPanelTab('ask')} />
      <PanelTabButton
        active={effectivePanelTab === 'respond'}
        label="Respond"
        badge={pendingQuestions.length || 0}
        onClick={() => switchPanelTab('respond')}
      />
      <PanelTabButton
        active={effectivePanelTab === 'responses'}
        label="Responses"
        badge={activity ? responses.length : 0}
        onClick={() => switchPanelTab('responses')}
      />
    </nav>
  ) : null;

  return (
    <section className={sectionClass}>
      {overlay && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50/80 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/35">
          <div>
            <p className="text-xs font-black text-indigo-950 dark:text-indigo-100">{panelMeta?.title || 'Ask the room'}</p>
            <p className="text-[11px] text-slate-500">
              {effectivePanelTab === 'responses' && activity ? responseSummary : panelMeta?.hint || (activity ? responseSummary : 'Send questions and review student answers')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {message && <span aria-live="polite" className="max-w-[12rem] truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{message}</span>}
            {typeof onClose === 'function' && (
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-lg leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {!embedded && !overlay && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-indigo-700 to-indigo-700 px-4 py-3 text-white">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200">iBOARD Pulse</p>
            <h2 className="font-display text-lg font-black">Class response</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {message && <span aria-live="polite" className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold ring-1 ring-white/25">{message}</span>}
            {activity && <span className="rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-black text-emerald-950">Live · {responseSummary}</span>}
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <p className="text-xs font-black text-slate-700 dark:text-slate-200">Ask the room</p>
            {message && <span aria-live="polite" className="truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{message}</span>}
            {activity && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Live · {responseSummary}</span>}
          </div>
          {typeof onExpand === 'function' && (
            <button type="button" onClick={() => onExpand(false)} className="text-[11px] font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              Hide
            </button>
          )}
        </div>
      )}

      {!embedded && !overlay && !activity && (
        <div className="border-b border-indigo-100 bg-indigo-50/80 px-4 py-2.5 dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="text-sm font-semibold text-indigo-950 dark:text-indigo-100">
            Pick Quick Question or Custom Question — then watch answers come in.
            {typeof onCopyStudentLink === 'function' && (
              <button type="button" onClick={onCopyStudentLink} className="ml-2 rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white hover:bg-indigo-700">
                Copy student link
              </button>
            )}
            {connectedCount > 0 && <span className="ml-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{connectedCount} online</span>}
          </p>
        </div>
      )}

      {!overlay && !usingPanelTabs && (
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/50">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-sm font-black text-slate-900 dark:text-white">Class awareness</h3><p className="text-[10px] text-slate-500">{connectedCount} online{attention.length ? ` · ${attention.length} need attention` : ''}{pendingQuestions.length ? ` · ${pendingQuestions.length} question${pendingQuestions.length === 1 ? '' : 's'} waiting` : ''}</p></div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {students.map((student) => {
            const tile = studentTileMeta(student);
            const questionCount = pendingByStudent[Number(student.id)] || 0;
            const queuePosition = firstPendingPositionByStudent[Number(student.id)] || 0;
            const needsAttention = student.engagement_status && student.engagement_status !== 'ready';
            return (
              <div key={student.id} className="relative w-[70px] shrink-0">
                <button type="button" onClick={() => openStudent(student)} title={`${student.name} · ${tile.title}`} className={`flex w-full flex-col items-center gap-1 rounded-[1.1rem] bg-white px-1 pb-1.5 pt-2 dark:bg-slate-900 ${tile.className}`}>
                  <EngagementRing engagement={student.engagement} connected={student.connected} size={34} />
                  <span className="w-full truncate px-0.5 text-center text-[10px] font-black leading-tight text-slate-900 dark:text-white">{firstName(student.name)}</span>
                </button>
                {needsAttention && <span title={STATUS_LABELS[student.engagement_status] || student.engagement_status} className="absolute -left-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-white shadow-sm">!</span>}
                {questionCount > 0 && <button type="button" onClick={() => { setSelectedStudentId(student.id); setActiveView('qna'); }} aria-label={`Question ${queuePosition} in the queue from ${student.name}${questionCount > 1 ? ` · ${questionCount} questions waiting` : ''}`} title={`Question ${queuePosition} in the queue`} className="absolute right-0 top-0 grid h-6 min-w-6 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] font-black text-white shadow-sm ring-2 ring-white dark:ring-slate-900">{queuePosition}</button>}
              </div>
            );
          })}
          {!students.length && <p className="py-3 text-xs text-slate-500">Students will appear here when they join.</p>}
        </div>
      </div>
      )}

      {panelTabNav}
      {usingPanelTabs && effectivePanelTab === 'responses' && awarenessStrip}
      {usingPanelTabs && effectivePanelTab === 'ask' && askSubNav}

      {!usingPanelTabs && (
      <nav aria-label="Ask pages" className="flex shrink-0 items-end gap-1 border-b border-slate-200 bg-slate-100/80 px-3 pt-2 dark:border-slate-700 dark:bg-slate-950/50">
        <button
          type="button"
          onClick={() => setActiveView('quik')}
          className={`rounded-t-lg px-3.5 py-2 text-[11px] font-bold transition sm:px-4 sm:text-xs ${
            activeView === 'quik'
              ? 'relative z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
              : 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
          }`}
        >
          Quick Question
        </button>
        <button
          type="button"
          onClick={() => setActiveView('build')}
          className={`rounded-t-lg px-3.5 py-2 text-[11px] font-bold transition sm:px-4 sm:text-xs ${
            activeView === 'build'
              ? 'relative z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
              : 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
          }`}
        >
          Custom Question
        </button>
        <button
          type="button"
          onClick={() => activity && setActiveView('live')}
          disabled={!activity}
          className={`rounded-t-lg px-3.5 py-2 text-[11px] font-bold transition sm:px-4 sm:text-xs ${
            activeView === 'live'
              ? 'relative z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
              : activity
                ? 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                : 'cursor-not-allowed border border-transparent bg-slate-100 text-slate-300 dark:bg-slate-900 dark:text-slate-600'
          }`}
        >
          Live Questions{activity ? ` · ${responses.length}/{participantCount}` : ''}
        </button>
        {pendingQuestions.length > 0 && (
          <button
            type="button"
            onClick={() => { setSelectedStudentId(null); setActiveView('qna'); }}
            className={`rounded-t-lg px-3.5 py-2 text-[11px] font-bold transition sm:px-4 sm:text-xs ${
              activeView === 'qna'
                ? 'relative z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
                : 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            From students · {pendingQuestions.length}
          </button>
        )}
        <details
          ref={moreMenuRef}
          className="relative ml-auto self-center pb-1.5"
          onToggle={(event) => {
            if (event.currentTarget.open && liveMoreMenuRef.current) liveMoreMenuRef.current.open = false;
          }}
        >
          <summary className="cursor-pointer list-none rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-white/80 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200">More</summary>
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={() => { if (moreMenuRef.current) moreMenuRef.current.open = false; setActiveView('prepared'); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
              Saved · {queue.length + templates.length}
            </button>
            {featuredWall.length > 0 && (
              <button type="button" onClick={() => { if (moreMenuRef.current) moreMenuRef.current.open = false; setActiveView('featured'); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                Featured · {featuredWall.length}
              </button>
            )}
            {!overlay && pendingQuestions.length === 0 && (
              <button type="button" onClick={() => { if (moreMenuRef.current) moreMenuRef.current.open = false; setSelectedStudentId(null); setActiveView('qna'); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                From students
              </button>
            )}
          </div>
        </details>
      </nav>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto ${overlay ? '' : 'min-h-[260px]'}`}>

        {(!usingPanelTabs || effectivePanelTab === 'ask') && activeView === 'quik' && <QuikPulsePanel onLaunch={launchQuikPulse} />}

        {(!usingPanelTabs || effectivePanelTab === 'respond') && activeView === 'student' && selectedStudent && <div className="p-4"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">Student check-in</p><h3 className="font-display text-lg font-black text-slate-950 dark:text-white">{selectedStudent.name}</h3><p className="mt-1 text-xs text-slate-500">{studentTileMeta(selectedStudent).title}</p></div><button type="button" onClick={returnToPrimaryView} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200">Close</button></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={!selectedStudent.connected} onClick={() => nudge(selectedStudent.id)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">Send private check-in</button>{selectedStudent.engagement_status && selectedStudent.engagement_status !== 'ready' && <button type="button" onClick={() => acknowledge(selectedStudent.id)} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-amber-950">Mark request seen</button>}{pendingByStudent[Number(selectedStudent.id)] > 0 && <button type="button" onClick={() => setActiveView('qna')} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white">Review questions</button>}</div></div>}

        {((!usingPanelTabs && activeView === 'qna') || (usingPanelTabs && effectivePanelTab === 'respond' && activeView !== 'student')) && (
          <AudienceQnaTeacher
            socket={socket}
            questions={qnaQuestions}
            focusedStudentId={selectedStudentId}
            liveActivity={activity}
            liveResponses={responses}
            onClose={usingPanelTabs ? undefined : returnToPrimaryView}
          />
        )}

        {usingPanelTabs && effectivePanelTab === 'responses' && (
          <TeacherAnswerRail
            embedded
            open
            activity={activity}
            responses={responses}
            highlightStudentId={highlightStudentId}
            onClearHighlight={onClearHighlight}
            onOpenAsk={() => switchPanelTab('ask')}
            onClose={onClose}
          />
        )}

        {(!usingPanelTabs || effectivePanelTab === 'ask') && activeView === 'live' && activity && (
          <div className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">Live</span>
                  <span className="text-xs font-bold text-slate-500">{responseSummary}</span>
                  {secondsLeft !== null && (
                    <span className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-black tabular-nums ${secondsLeft === 0 ? 'bg-slate-100 text-slate-600' : secondsLeft <= 5 ? 'iboard-timer-urgent bg-red-600 text-white' : 'bg-indigo-100 text-indigo-900'}`}>
                      {secondsLeft > 0 ? `${secondsLeft}s` : '0s'}
                    </span>
                  )}
                </div>
                <h3 className="mt-2 font-display text-xl font-black text-slate-950 dark:text-white">{activity.prompt}</h3>
                {activity.imageUrl && <img src={activity.imageUrl} alt="Question" className="mt-2 max-h-48 rounded-lg bg-white object-contain" />}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setDisplayMode(true)} className="rounded-lg bg-indigo-100 px-3 py-2 text-xs font-black text-indigo-900">Present</button>
                {currentActivityIsQuikPulse && (
                  <>
                    <button type="button" onClick={repeatQuikPulse} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-800 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200">Repeat</button>
                    <button type="button" onClick={() => setActiveView('quik')} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700">Ask another</button>
                  </>
                )}
                <button type="button" onClick={() => control('clear')} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white dark:bg-white dark:text-slate-900">Done</button>
                <details
                  ref={liveMoreMenuRef}
                  className="relative"
                  onToggle={(event) => {
                    if (event.currentTarget.open && moreMenuRef.current) moreMenuRef.current.open = false;
                  }}
                >
                  <summary className="cursor-pointer list-none rounded-lg px-2.5 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">⋯</summary>
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <button type="button" disabled={!unansweredCount || activity.locked} onClick={() => { if (liveMoreMenuRef.current) liveMoreMenuRef.current.open = false; realertUnanswered(); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800">Remind unanswered</button>
                    <button type="button" onClick={() => { if (liveMoreMenuRef.current) liveMoreMenuRef.current.open = false; control(activity.locked ? 'unlock' : 'lock'); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">{activity.locked ? 'Reopen answers' : 'Pause answers'}</button>
                    {activity.correctAnswer && !activity.revealed && (
                      <button type="button" onClick={() => { if (liveMoreMenuRef.current) liveMoreMenuRef.current.open = false; control('reveal'); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Reveal answer</button>
                    )}
                  </div>
                </details>
              </div>
            </div>
            <div className="mt-4"><Results activity={activity} responses={responses} onPublish={publish} /></div>
          </div>
        )}

        {(!usingPanelTabs || effectivePanelTab === 'ask') && activeView === 'build' && (
          <div
            className="p-4"
            onPaste={(event) => {
              const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
              if (file) { event.preventDefault(); loadImage(file); }
            }}
          >
            <label className="block text-[10px] font-black uppercase tracking-wide text-slate-500">Question</label>
            <input value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 500))} placeholder="What do you think?" className="mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TYPES.map(([value, label]) => (
                <button key={value} type="button" onClick={() => { setType(value); setCorrectAnswer(''); }} className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${type === value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{label}</button>
              ))}
            </div>
            {type === 'choice' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {options.map((option, index) => (
                  <input
                    key={index}
                    value={option}
                    onChange={(event) => {
                      const next = event.target.value.slice(0, 120);
                      setOptions((current) => current.map((value, i) => (i === index ? next : value)));
                      setCorrectAnswer((current) => (current && current === option.trim() ? next.trim() : current));
                    }}
                    placeholder={`Choice ${String.fromCharCode(65 + index)}`}
                    className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                ))}
              </div>
            )}
            <details className="mt-4 rounded-xl border border-slate-200 open:bg-slate-50 dark:border-slate-700 dark:open:bg-slate-950/50">
              <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300">More options</summary>
              <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-lg bg-sky-100 px-2.5 py-1.5 text-xs font-black text-sky-900 hover:bg-sky-200">
                    {imageBusy ? 'Preparing…' : imageUrl ? 'Replace image' : 'Add image'}
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => loadImage(event.target.files?.[0])} />
                  </label>
                  {imageUrl && (
                    <>
                      <img src={imageUrl} alt="Question preview" className="h-12 w-20 rounded-lg bg-white object-contain" />
                      <button type="button" onClick={() => setImageUrl('')} className="text-xs font-black text-red-600">Remove</button>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <input type="checkbox" checked={optional} onChange={(event) => setOptional(event.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" /> Optional
                  </label>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    Timer{' '}
                    <select value={timerSeconds} onChange={(event) => setTimerSeconds(Number(event.target.value))} className="ml-1 rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
                      <option value="0">None</option>
                      <option value="15">15 sec</option>
                      <option value="30">30 sec</option>
                      <option value="60">1 min</option>
                      <option value="120">2 min</option>
                    </select>
                  </label>
                  {type === 'short' && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" /> Anonymous when featured
                    </label>
                  )}
                </div>
                {type === 'short' ? (
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                    Expected answer (optional)
                    <input
                      value={correctAnswer}
                      onChange={(event) => setCorrectAnswer(event.target.value.slice(0, 120))}
                      placeholder="Shown when you reveal the answer"
                      className="mt-1 block w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                ) : type === 'rating' ? null : (
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                    Correct answer (optional)
                    <select value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                      <option value="">No correct answer / opinion poll</option>
                      {type === 'choice'
                        ? options.map((option, index) => {
                            const text = option.trim();
                            if (!text) return null;
                            const letter = String.fromCharCode(65 + index);
                            return <option key={`${letter}-${text}`} value={text}>{letter}: {text}</option>;
                          })
                        : (type === 'truefalse' ? ['True', 'False'] : []).map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                    </select>
                    {type === 'choice' && !options.some((option) => option.trim()) && (
                      <span className="mt-1 block text-[11px] font-semibold text-slate-400">Fill in choices above to pick a correct answer.</span>
                    )}
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={saveTemplate} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-800 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200">Save for later</button>
                  <button type="button" onClick={addToQueue} className="rounded-lg bg-indigo-100 px-3 py-2 text-xs font-black text-indigo-900">Add to queue</button>
                </div>
              </div>
            </details>
            <div className="mt-4 flex justify-end border-t border-slate-200 pt-3 dark:border-slate-700">
              <button type="button" onClick={() => launch()} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white shadow-md hover:bg-indigo-700">Launch</button>
            </div>
          </div>
        )}

        {(!usingPanelTabs || effectivePanelTab === 'ask') && activeView === 'prepared' && <div className="grid gap-5 p-4 lg:grid-cols-2"><section><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">Prepared</p><h3 className="font-display text-lg font-black text-slate-950 dark:text-white">Question queue · {queue.length}</h3></div>{queue.length > 0 && <button type="button" onClick={() => setQueue([])} className="text-xs font-black text-red-600">Clear</button>}</div><div className="mt-3 space-y-2">{queue.map((item, index) => <div key={item.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-[10px] font-black text-white">{index + 1}</span><div className="flex flex-col"><button type="button" disabled={index === 0} onClick={() => moveQueued(index, -1)} className="text-[10px] font-black disabled:opacity-20">▲</button><button type="button" disabled={index === queue.length - 1} onClick={() => moveQueued(index, 1)} className="text-[10px] font-black disabled:opacity-20">▼</button></div><p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-white">{item.prompt}</p><button type="button" onClick={() => launch(item, item.id)} className="rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-900">Launch</button><button type="button" onClick={() => setQueue((items) => items.filter((question) => question.id !== item.id))} className="text-sm font-black text-red-500">×</button></div>)}{!queue.length && <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-500 dark:border-slate-700">No questions queued.</p>}</div></section><section><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">Reusable</p><h3 className="font-display text-lg font-black text-slate-950 dark:text-white">Templates · {templates.length}</h3></div><div className="mt-3 space-y-2">{templates.map((template) => <div key={template.id} className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700"><button type="button" onClick={() => loadTemplate(template)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-xs font-bold text-slate-900 hover:bg-slate-50 dark:text-white dark:hover:bg-slate-800">{template.prompt}</button><button type="button" onClick={() => setTemplates((items) => items.filter((item) => item.id !== template.id))} aria-label={`Delete template: ${template.prompt}`} className="border-l border-slate-200 px-3 py-2 text-sm font-black text-red-500 dark:border-slate-700">×</button></div>)}{!templates.length && <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-500 dark:border-slate-700">No templates saved on this browser.</p>}</div></section></div>}

        {(!usingPanelTabs || effectivePanelTab === 'ask') && activeView === 'featured' && <section className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Featured Wall</p><h3 className="font-display text-lg font-black text-slate-950 dark:text-white">Highlights · {featuredWall.length}</h3></div><div className="flex gap-1.5"><button type="button" onClick={compareFeatured} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-black text-white">Compare</button><button type="button" onClick={() => { setSlideIndex(0); setWallMode('slides'); }} className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-black text-amber-950">Present</button><button type="button" onClick={downloadWall} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-black text-slate-800">Save</button><button type="button" onClick={clearFeaturedWall} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-black text-red-700">Clear wall</button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{featuredWall.map((item) => <article key={item.id} className={`rounded-xl border-2 bg-white p-3 dark:bg-slate-900 ${wallSelected.includes(item.id) ? 'border-indigo-500' : 'border-amber-200 dark:border-amber-800'}`}><div className="flex items-start gap-2"><input type="checkbox" checked={wallSelected.includes(item.id)} onChange={(event) => setWallSelected((ids) => event.target.checked ? [...ids.filter((id) => id !== item.id), item.id].slice(-2) : ids.filter((id) => id !== item.id))} className="mt-0.5 h-4 w-4 accent-indigo-600" /><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase text-amber-700">Q{item.questionNumber} · {item.name}</p><p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">“{item.value}”</p><select value={item.label} onChange={(event) => labelFeatured(item.id, event.target.value)} className="mt-2 w-full rounded-md border border-amber-200 px-2 py-1 text-[11px] font-bold dark:border-amber-800 dark:bg-slate-950">{FEATURE_LABELS.map((label) => <option key={label} value={label}>{label || 'Why is this featured?'}</option>)}</select><div className="mt-2 flex gap-1.5"><button type="button" onClick={() => improveFeatured(item)} className="rounded-md bg-indigo-100 px-2 py-1 text-[10px] font-black text-indigo-800">Improve</button><button type="button" onClick={() => removeFeatured(item.id)} className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-black text-red-600">Remove</button></div></div></div></article>)}</div></section>}
      </div>

      {displayMode && activity && (
        <div className="fixed inset-0 z-[80] overflow-auto bg-gradient-to-br from-indigo-950 via-indigo-950 to-slate-950 p-6 text-white sm:p-10">
          <button type="button" onClick={() => setDisplayMode(false)} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-indigo-950 shadow-xl">Back to teacher</button>
          <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center py-12">
            <p className="text-lg font-black uppercase tracking-[0.25em] text-indigo-300">Question {activity.questionNumber || 1} · Live response · {responses.length} answers</p>
            <h2 className="mt-4 max-w-5xl font-display text-4xl font-black leading-tight sm:text-6xl">{activity.prompt}</h2>
            <div className="mt-10"><Results activity={activity} responses={responses} display /></div>
          </div>
        </div>
      )}
      {wallMode === 'compare' && (() => { const chosen = featuredWall.filter((item) => wallSelected.includes(item.id)).slice(0, 2); return <div className="fixed inset-0 z-[85] overflow-auto bg-gradient-to-br from-indigo-950 to-slate-950 p-6 text-white"><button type="button" onClick={() => setWallMode('')} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 font-black text-indigo-950">Close</button><div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center"><h2 className="mb-8 text-center font-display text-4xl font-black">Which response is stronger—and why?</h2><div className="grid gap-6 md:grid-cols-2">{chosen.map((item, index) => <article key={item.id} className="rounded-3xl bg-white/10 p-8 ring-2 ring-white/20"><p className="text-sm font-black uppercase tracking-widest text-indigo-300">Answer {index ? 'B' : 'A'} · {item.label}</p><p className="mt-5 text-3xl font-bold leading-relaxed">“{item.value}”</p></article>)}</div><button type="button" onClick={askComparison} className="mx-auto mt-8 rounded-2xl bg-indigo-400 px-6 py-3 font-black text-indigo-950">Ask the class</button></div></div>; })()}
      {wallMode === 'slides' && featuredWall[slideIndex] && <div className="fixed inset-0 z-[85] grid place-items-center bg-gradient-to-br from-amber-950 via-indigo-950 to-slate-950 p-8 text-white"><button type="button" onClick={() => setWallMode('')} className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 font-black text-slate-950">Close</button><article className="max-w-5xl text-center"><p className="text-lg font-black uppercase tracking-widest text-amber-300">{featuredWall[slideIndex].label || `Question ${featuredWall[slideIndex].questionNumber}`}</p><p className="mt-6 font-display text-4xl font-black leading-relaxed sm:text-6xl">“{featuredWall[slideIndex].value}”</p><p className="mt-5 text-xl text-white/70">{featuredWall[slideIndex].name}</p><div className="mt-10 flex justify-center gap-3"><button type="button" disabled={slideIndex === 0} onClick={() => setSlideIndex((value) => value - 1)} className="rounded-xl bg-white/20 px-5 py-3 font-black disabled:opacity-30">Previous</button><span className="px-3 py-3 font-black">{slideIndex + 1} / {featuredWall.length}</span><button type="button" disabled={slideIndex === featuredWall.length - 1} onClick={() => setSlideIndex((value) => value + 1)} className="rounded-xl bg-white/20 px-5 py-3 font-black disabled:opacity-30">Next</button></div></article></div>}
    </section>
  );
}
