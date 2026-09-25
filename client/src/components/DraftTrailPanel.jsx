import { CloseButton } from './PanelActions.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';

const labels = { baseline: 'Recording baseline', resume: 'Recording resumed · unrecorded interval before this', gap: 'Unrecorded / reconnect interval', stop: 'Recording stopped', feedback: 'Teacher feedback sent', paste: 'Paste reported by student browser', change: 'Writing changed' };
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800';

export default function DraftTrailPanel({ socket, onClose, initialStudentId = null, embedded = false }) {
  const dialogRef = useRef(null);
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(() => (initialStudentId != null ? String(initialStudentId) : ''));
  const [trail, setTrail] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (embedded) return undefined;
    const prior = document.activeElement;
    dialogRef.current?.showModal();
    return () => prior?.focus?.();
  }, [embedded]);
  useEffect(() => {
    if (initialStudentId != null) setSelected(String(initialStudentId));
  }, [initialStudentId]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError('');
    setTrail(null);
    if (!socket.connected) { setError('Reconnect to view drafting evidence.'); setBusy(false); return; }
    socket.timeout(10000).emit('teacher:draft-trail-view', { studentId: selected === '' ? undefined : Number(selected) }, (err, ack) => {
      if (cancelled) return;
      setBusy(false);
      if (err || !ack?.ok) { setError(ack?.error || 'Could not load drafting evidence. Try Refresh.'); return; }
      setStudents(ack.students || []);
      setLabel(String(ack.status?.label || '').trim());
      if (selected === '' && ack.students?.length) { setSelected(String(ack.students[0].id)); return; }
      setTrail(ack.trail);
      setIndex(Math.max(0, (ack.trail?.events.length || 1) - 1));
    });
    return () => { cancelled = true; };
  }, [socket, selected, refresh]);
  const view = useMemo(() => {
    let text = '', before = '', feedback = null;
    const events = trail?.events || [];
    for (let n = 0; n <= index && n < events.length; n++) {
      const event = events[n];
      before = text;
      if (['baseline', 'resume', 'gap'].includes(event.type)) { text = event.text; feedback = null; }
      if (['change', 'paste'].includes(event.type)) text = text.slice(0, event.start) + event.inserted + text.slice(event.start + event.removed);
      if (event.type === 'feedback') feedback = event;
    }
    return { text, before, feedback, event: events[index] };
  }, [trail, index]);
  const event = view.event;
  const changed = event && ['change', 'paste'].includes(event.type);
  const isPaste = event?.type === 'paste';
  const empty = !busy && !error && !event;
  const removedMarkClass = 'bg-blue-100 text-blue-950 line-through decoration-blue-700 dark:bg-blue-950/70 dark:text-blue-100 dark:decoration-blue-300';
  const insertedMarkClass = isPaste
    ? 'bg-red-200 text-red-950 no-underline dark:bg-red-950/70 dark:text-red-100'
    : 'bg-emerald-100 text-emerald-950 no-underline dark:bg-emerald-950/60 dark:text-emerald-100';

  const body = (
    <>
      {!embedded ? (
        <div className="flex items-center justify-between gap-4">
          <h2 id="draft-trail-title" className={`text-lg font-bold ${empty ? 'sr-only' : ''}`}>
            Drafting evidence{label ? ` · ${label}` : ''}
          </h2>
          <CloseButton onClick={onClose} label="Close" className={empty ? 'ml-auto' : undefined} />
        </div>
      ) : label ? (
        <p className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      ) : null}

      {empty ? (
        <p className={`text-center text-sm font-semibold text-slate-700 dark:text-slate-200 ${embedded ? 'py-6' : 'py-10'}`}>
          No drafting evidence captured yet. Hit the recording button to begin.
        </p>
      ) : (
        <>
          <div className={`${embedded ? 'mb-4' : 'my-4'} flex flex-wrap items-center gap-3`}>
            <label className="text-sm font-semibold">
              Student{' '}
              <select
                aria-label="Student drafting evidence"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="ml-2 max-w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800"
              >
                {!students.length && <option value="">No recorded students</option>}
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.attention ? '● ' : ''}
                    {s.name} · {s.checkpoints} checkpoints · {s.pasteEvents} pastes
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
              Refresh
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          {busy ? (
            <p role="status">Loading…</p>
          ) : (
            <>
              <p className="text-sm font-semibold">
                {trail.name} · {labels[event.type]}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {new Date(event.at).toLocaleString()} · Event {index + 1} of {trail.events.length}
              </p>
              <div className="my-4 flex items-center gap-3">
                <button type="button" className={buttonClass} disabled={index === 0} onClick={() => setIndex((n) => n - 1)}>
                  Previous
                </button>
                <input
                  aria-label="Draft checkpoint"
                  type="range"
                  min="0"
                  max={trail.events.length - 1}
                  value={index}
                  onChange={(e) => setIndex(Number(e.target.value))}
                  className="min-w-0 flex-1 accent-red-600"
                />
                <button
                  type="button"
                  className={buttonClass}
                  disabled={index === trail.events.length - 1}
                  onClick={() => setIndex((n) => n + 1)}
                >
                  Next
                </button>
              </div>
              {isPaste && (
                <p className="mb-3 text-sm font-semibold text-red-600 dark:text-red-400">
                  A paste is not evidence of cheating. Quotations, earlier drafts and assistive tools can all explain inserted text.
                </p>
              )}
              {view.feedback && (
                <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm dark:bg-blue-950">
                  <p className="font-semibold">
                    {event.type === 'feedback'
                      ? 'Teacher feedback'
                      : 'Earlier feedback — later changes do not establish that it was addressed'}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{view.feedback.text}</p>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <section>
                  <h3 className="mb-2 text-sm font-bold">{changed ? 'Before · removed text' : 'Previous recorded draft'}</h3>
                  <div className="min-h-40 whitespace-pre-wrap break-words rounded-lg border border-slate-200 p-4 text-base dark:border-slate-700">
                    {changed ? (
                      <>
                        {view.before.slice(0, event.start)}
                        <del className={removedMarkClass}>{view.before.slice(event.start, event.start + event.removed)}</del>
                        {view.before.slice(event.start + event.removed)}
                      </>
                    ) : (
                      view.before || '—'
                    )}
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-bold">{changed ? 'After · added text' : 'Recorded draft'}</h3>
                  <div className="min-h-40 whitespace-pre-wrap break-words rounded-lg border border-slate-200 p-4 text-base dark:border-slate-700">
                    {changed ? (
                      <>
                        {view.text.slice(0, event.start)}
                        <ins className={insertedMarkClass}>{event.inserted}</ins>
                        {view.text.slice(event.start + event.inserted.length)}
                      </>
                    ) : (
                      view.text || '—'
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="text-slate-800 dark:text-slate-100">{body}</div>;
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-auto max-h-[90dvh] w-[min(64rem,94vw)] overflow-y-auto rounded-xl border border-slate-300 bg-white p-5 text-slate-800 shadow-2xl backdrop:bg-black/50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      aria-labelledby="draft-trail-title"
    >
      {body}
    </dialog>
  );
}
