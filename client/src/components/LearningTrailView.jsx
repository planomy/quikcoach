import { useEffect, useMemo, useRef, useState } from 'react';
import { CloseButton } from './PanelActions.jsx';
import { THINKING_CATEGORIES } from '../lib/thinkingPrompts.js';

const SUPPORT_LABELS = {
  comment: 'Inline comments',
  note: 'Notes',
  chat: 'Chat messages',
  set: 'Question sets',
  thinking: 'Thinking prompts',
  ai: 'AI-assisted feedback',
  resource: 'Resources',
  shared: 'Writing shared',
};
const FEEDBACK_LABELS = {
  comment: 'Inline comment',
  note: 'Note sent',
  chat: 'Chat message',
  set: 'Question set sent',
  thinking: 'Thinking prompt sent',
  ai: 'AI-assisted feedback sent',
  resource: 'Resource sent',
  shared: 'Writing shared (name hidden)',
};
const OPENED_LABELS = {
  note: 'Opened a note',
  set: 'Opened a question set',
  thinking: 'Opened a Thinking prompt',
  ai: 'Opened AI-assisted feedback',
};
const CATEGORY_LABELS = Object.fromEntries([...THINKING_CATEGORIES.map((c) => [c.id, c.label]), ['custom', 'Own prompt']]);
const MAX_BUCKETS = 60;

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function clock(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function snippet(text, max = 140) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Replays the trail so each text change knows the draft it changed. */
function replay(events) {
  let text = '';
  return events.map((event) => {
    const before = text;
    if (['baseline', 'resume', 'gap'].includes(event.type)) text = String(event.text || '');
    if (['change', 'paste'].includes(event.type)) {
      text = text.slice(0, event.start) + String(event.inserted || '') + text.slice(event.start + event.removed);
    }
    // Revising = touching text that was already there, not just adding at the end.
    const revising = event.type === 'change' && (event.removed > 0 || event.start < before.trimEnd().length);
    return { ...event, before, after: text, revising };
  });
}

function buildActivity(events, now) {
  if (!events.length) return null;
  const start = Number(events[0].at) || now;
  const end = Math.max(now, Number(events.at(-1).at) || now);
  const span = Math.max(60000, end - start);
  const count = Math.min(MAX_BUCKETS, Math.max(1, Math.ceil(span / 60000)));
  const size = span / count;
  const buckets = Array.from({ length: count }, () => ({ writing: false, revising: false, away: false }));
  const index = (at) => Math.min(count - 1, Math.max(0, Math.floor((at - start) / size)));
  const markers = [];
  let awaySince = null;
  for (const event of events) {
    const at = Number(event.at) || start;
    if (event.type === 'change') buckets[index(at)][event.revising ? 'revising' : 'writing'] = true;
    if (event.type === 'paste') {
      buckets[index(at)].writing = true;
      markers.push({ at, kind: 'paste' });
    }
    if (event.type === 'feedback') markers.push({ at, kind: 'support' });
    if (event.type === 'away') awaySince = at;
    if ((event.type === 'back' || event.type === 'gap') && awaySince != null) {
      for (let n = index(awaySince); n <= index(at); n++) buckets[n].away = true;
      awaySince = null;
    }
  }
  if (awaySince != null) for (let n = index(awaySince); n < count; n++) buckets[n].away = true;
  const activeMinutes = new Set(events.filter((e) => e.type === 'change' || e.type === 'paste').map((e) => Math.floor(e.at / 60000))).size;
  return {
    start,
    end,
    buckets,
    markers: markers.map((m) => ({ ...m, left: ((m.at - start) / span) * 100 })),
    activeMinutes,
    spanMinutes: Math.max(1, Math.round(span / 60000)),
  };
}

function buildTimeline(events, data) {
  const rows = [];
  let group = null;
  const closeGroup = () => {
    if (!group) return;
    const added = words(group.after) - words(group.before);
    const parts = [];
    if (added > 0) parts.push(`+${added} word${added === 1 ? '' : 's'}`);
    else if (added < 0) parts.push(`${added} words`);
    if (group.revisions) parts.push(`${group.revisions} edit${group.revisions === 1 ? '' : 's'} to earlier text`);
    rows.push({
      at: group.lastAt,
      kind: group.revisions ? 'revising' : 'writing',
      title: group.revisions && added <= 0 ? 'Revising' : 'Writing',
      detail: `${clock(group.firstAt)}–${clock(group.lastAt)} · ${parts.join(' · ') || 'small changes'}`,
    });
    group = null;
  };
  for (const event of events) {
    if (event.type === 'change') {
      if (!group) group = { firstAt: event.at, before: event.before, revisions: 0 };
      group.lastAt = event.at;
      group.after = event.after;
      if (event.revising) group.revisions += 1;
      continue;
    }
    closeGroup();
    if (event.type === 'paste') rows.push({ at: event.at, kind: 'paste', title: 'Pasted text', detail: snippet(event.inserted) });
    else if (event.type === 'feedback') {
      const text = event.via === 'comment' ? String(event.text || '').split('\nTeacher comment: ').pop() : event.text;
      rows.push({ at: event.at, kind: 'support', title: FEEDBACK_LABELS[event.via] || 'Teacher feedback', detail: snippet(text) });
    } else if (event.type === 'away') rows.push({ at: event.at, kind: 'away', title: 'Left the TUIT tab' });
    else if (event.type === 'back') rows.push({ at: event.at, kind: 'away', title: 'Back on the TUIT tab' });
    else if (event.type === 'gap') rows.push({ at: event.at, kind: 'away', title: 'Reconnected', detail: 'Not recorded while disconnected' });
    else if (event.type === 'baseline') rows.push({ at: event.at, kind: 'start', title: 'Trail started', detail: `${words(event.text)} words at the start` });
  }
  closeGroup();
  for (const comment of data.comments) {
    if (comment.fixedAt) rows.push({ at: comment.fixedAt, kind: 'response', title: 'Marked a comment as fixed', detail: snippet(comment.note) });
    if (comment.resolvedAt) rows.push({ at: comment.resolvedAt, kind: 'confirmed', title: 'You confirmed a comment', detail: snippet(comment.note) });
  }
  for (const message of data.messages) {
    if (message.seenAt && message.type !== 'chat') rows.push({ at: message.seenAt, kind: 'response', title: OPENED_LABELS[message.type] || 'Opened a note' });
  }
  for (const question of data.asked) {
    rows.push({
      at: question.answeredAt || question.at,
      kind: question.answered ? 'response' : 'missing',
      title: `Ask class Q${question.number}: ${question.answered ? 'answered' : 'no answer'}`,
      detail: snippet(question.prompt),
    });
  }
  return rows.filter((row) => row.at).sort((a, b) => b.at - a.at).slice(0, 200);
}

function buildSupport(events, data) {
  const counts = {};
  const bump = (type) => { counts[type] = (counts[type] || 0) + 1; };
  for (const message of data.messages) bump(message.type);
  data.comments.forEach(() => bump('comment'));
  for (const event of events) if (event.type === 'feedback' && ['resource', 'shared'].includes(event.via)) bump(event.via);
  const categories = {};
  for (const message of data.messages) for (const id of message.categories || []) categories[id] = (categories[id] || 0) + 1;
  const confirmed = data.comments.filter((c) => c.status === 'resolved').length;
  return {
    items: Object.keys(SUPPORT_LABELS).filter((type) => counts[type]).map((type) => ({
      type,
      label: SUPPORT_LABELS[type],
      count: counts[type],
      note: type === 'comment' && confirmed ? `${confirmed} confirmed` : '',
    })),
    categories: Object.entries(categories).map(([id, count]) => ({ id, label: CATEGORY_LABELS[id] || id, count })),
  };
}

function buildNotYet(data) {
  const out = [];
  if (!String(data.student.text || '').trim()) out.push('No writing yet');
  for (const question of data.asked) if (!question.answered) out.push(`Ask class Q${question.number} not answered: “${snippet(question.prompt, 80)}”`);
  const unopened = data.messages.filter((m) => !m.seenAt && m.type !== 'chat');
  if (unopened.length) out.push(`${unopened.length} message${unopened.length === 1 ? '' : 's'} not opened yet`);
  const open = data.comments.filter((c) => c.status === 'open' || c.status === 'reopen').length;
  if (open) out.push(`${open} comment${open === 1 ? '' : 's'} not marked fixed yet`);
  const waiting = data.comments.filter((c) => c.status === 'fixed').length;
  if (waiting) out.push(`${waiting} comment${waiting === 1 ? '' : 's'} waiting for you to confirm`);
  return out;
}

const DOT = {
  writing: 'bg-emerald-400',
  revising: 'bg-sky-400',
  paste: 'bg-red-500',
  support: 'bg-[#5a5fc3]',
  response: 'bg-[#5a5fc3]/50',
  confirmed: 'bg-[#10b981]',
  away: 'bg-slate-300 dark:bg-slate-600',
  missing: 'bg-amber-400',
  start: 'bg-slate-400',
};

export default function LearningTrailView({ socket, studentId, onClose, onOpenDrafts }) {
  const dialogRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const prior = document.activeElement;
    dialogRef.current?.showModal();
    return () => prior?.focus?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    if (!socket?.connected) {
      setError('Reconnect to view the learning trail.');
      return undefined;
    }
    socket.timeout(10000).emit('teacher:learning-trail', { studentId }, (err, ack) => {
      if (cancelled) return;
      if (err || !ack?.ok) {
        setError(ack?.error || 'Could not load the learning trail. Close and try again.');
        return;
      }
      setNow(Date.now());
      setData({
        student: ack.student || {},
        events: Array.isArray(ack.events) ? ack.events : [],
        comments: Array.isArray(ack.comments) ? ack.comments : [],
        messages: Array.isArray(ack.messages) ? ack.messages : [],
        asked: Array.isArray(ack.asked) ? ack.asked : [],
      });
    });
    return () => { cancelled = true; };
  }, [socket, studentId]);

  const view = useMemo(() => {
    if (!data) return null;
    const events = replay(data.events);
    const pastes = events.filter((e) => e.type === 'paste').length;
    const startWords = events.length ? words(events[0].text) : null;
    const nowWords = words(data.student.text);
    return {
      events,
      pastes,
      nowWords,
      gained: startWords == null ? null : nowWords - startWords,
      activity: buildActivity(events, now),
      timeline: buildTimeline(events, data),
      support: buildSupport(events, data),
      notYet: buildNotYet(data),
    };
  }, [data, now]);

  const summary = view
    ? [
        `${view.nowWords} word${view.nowWords === 1 ? '' : 's'}${view.gained ? ` (${view.gained > 0 ? '+' : ''}${view.gained} this lesson)` : ''}`,
        view.activity ? `writing in ${view.activity.activeMinutes} of ${view.activity.spanMinutes} min` : '',
        view.pastes ? `${view.pastes} paste${view.pastes === 1 ? '' : 's'}` : '',
        data.student.away ? 'away now' : '',
      ].filter(Boolean).join(' · ')
    : '';

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); onClose?.(); }}
      onClick={(event) => { if (event.target === dialogRef.current) onClose?.(); }}
      className="iboard-learning-trail m-auto max-h-[88dvh] w-[min(40rem,94vw)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-black/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      aria-labelledby="learning-trail-title"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#5a5fc3] dark:text-indigo-300">Learning trail</p>
          <h2 id="learning-trail-title" className="truncate font-display text-xl font-bold">{data?.student?.name || ' '}</h2>
          {summary ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{summary}</p> : null}
        </div>
        <CloseButton onClick={onClose} label="Close" />
      </div>

      <div className="space-y-5 px-5 py-4">
        {error ? <p role="alert" className="text-sm font-semibold text-red-600 dark:text-red-300">{error}</p> : null}
        {!data && !error ? <p role="status" className="py-6 text-center text-sm text-slate-500">Loading…</p> : null}

        {view ? (
          <>
            {view.activity ? (
              <section aria-label="Lesson activity">
                <div className="relative h-2.5">
                  {view.activity.markers.map((marker, n) => (
                    <span
                      key={`${marker.kind}-${n}`}
                      className={`absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${marker.kind === 'paste' ? 'bg-red-500' : 'bg-[#5a5fc3]'}`}
                      style={{ left: `${Math.min(100, Math.max(0, marker.left))}%` }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  {view.activity.buckets.map((bucket, n) => (
                    <span
                      key={n}
                      className={`h-full flex-1 ${
                        bucket.revising ? 'bg-sky-400' : bucket.writing ? 'bg-emerald-400' : bucket.away ? 'iboard-learning-trail__away' : ''
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] font-semibold text-slate-400">
                  <span>{clock(view.activity.start)}</span>
                  <span>{clock(view.activity.end)}</span>
                </div>
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-400" />Adding writing</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-sky-400" />Revising earlier text</span>
                  <span className="inline-flex items-center gap-1"><span className="iboard-learning-trail__away h-2 w-3 rounded-sm" />Away</span>
                  <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#5a5fc3]" />Support</span>
                  <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />Paste</span>
                </p>
              </section>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No writing recorded yet. The trail builds automatically as they write.</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <section>
                <h3 className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Support given</h3>
                {view.support.items.length ? (
                  <ul className="space-y-1 text-sm">
                    {view.support.items.map((item) => (
                      <li key={item.type} className="flex items-baseline justify-between gap-2">
                        <span>{item.label}</span>
                        <span className="font-bold text-[#3c3f8f] dark:text-indigo-200">{item.count}{item.note ? <span className="ml-1 text-xs font-semibold text-[#047857] dark:text-[#6ee7b7]">({item.note})</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">None yet.</p>
                )}
                {view.support.categories.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {view.support.categories.map((category) => (
                      <span key={category.id} className="rounded-full bg-[#ebeaf8] px-2 py-0.5 text-[11px] font-bold text-[#3c3f8f] dark:bg-[rgba(90,95,195,0.22)] dark:text-indigo-200">
                        {category.label}{category.count > 1 ? ` ×${category.count}` : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
              <section>
                <h3 className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Not seen yet</h3>
                {view.notYet.length ? (
                  <ul className="space-y-1 text-sm">
                    {view.notYet.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nothing outstanding.</p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">No record isn’t the same as no learning. Talk and paper work don’t show here.</p>
              </section>
            </div>

            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timeline</h3>
                {view.events.length ? (
                  <button
                    type="button"
                    onClick={() => onOpenDrafts?.(studentId)}
                    className="rounded-lg border border-[#5a5fc3] px-2.5 py-1 text-xs font-bold text-[#5a5fc3] hover:bg-[#ebeaf8] hover:text-[#3c3f8f] dark:border-[#818cf8] dark:text-indigo-200 dark:hover:bg-[rgba(90,95,195,0.22)]"
                  >
                    Step through drafts
                  </button>
                ) : null}
              </div>
              {view.timeline.length ? (
                <ol className="space-y-2">
                  {view.timeline.map((row, n) => (
                    <li key={`${row.at}-${n}`} className="flex gap-2.5 text-sm">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[row.kind] || 'bg-slate-400'}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-semibold">
                          <span className="mr-1.5 text-xs font-semibold text-slate-400">{clock(row.at)}</span>
                          {row.title}
                        </p>
                        {row.detail ? <p className="break-words text-xs text-slate-500 dark:text-slate-400">{row.detail}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nothing recorded yet.</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </dialog>
  );
}
