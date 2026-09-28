import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloseButton } from './PanelActions.jsx';
import { downloadInsightsCsv, formatLessonDate, formatMinutes, headlineTotals } from '../lib/insightsExport.js';

const TREND_LESSONS = 12;

function Tile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <div className="font-display text-xl font-bold tabular-nums text-ink-900 dark:text-slate-100">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function Trend({ label, points, suffix = '', max }) {
  const values = points.map((p) => p.value).filter((v) => v != null);
  const top = max ?? Math.max(1, ...values);
  const w = 240;
  const h = 56;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const coords = points
    .map((p, i) => (p.value == null ? null : [points.length > 1 ? i * step : w / 2, h - (p.value / top) * (h - 6) - 3, p]))
    .filter(Boolean);
  const latest = values.length ? values[values.length - 1] : null;
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-xs font-bold tabular-nums text-ink-900 dark:text-slate-100">
          {latest == null ? '—' : `${latest}${suffix}`}
        </span>
      </div>
      {coords.length ? (
        <svg viewBox={`-4 0 ${w + 8} ${h}`} className="mt-1.5 h-14 w-full text-indigo-500" role="img" aria-label={`${label} trend`}>
          <line x1="0" y1={h - 3} x2={w} y2={h - 3} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
          {coords.length > 1 ? (
            <polyline
              points={coords.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {coords.map(([x, y, p]) => (
            <circle key={p.id} cx={x} cy={y} r="2.6" fill="currentColor">
              <title>{`${formatLessonDate(p.startedAt)}: ${p.value}${suffix}`}</title>
            </circle>
          ))}
        </svg>
      ) : (
        <p className="mt-3 text-xs text-slate-400">Not enough data yet</p>
      )}
    </div>
  );
}

function pctText(value) {
  return value == null ? '—' : `${value}%`;
}

export default function ClassInsightsPanel({ socket, onClose }) {
  const [scope, setScope] = useState('room');
  const [lessonId, setLessonId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showStudents, setShowStudents] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(() => {
    if (!socket) return;
    setLoading(true);
    socket.emit('teacher:insights', { scope, lessonId }, (ack) => {
      setLoading(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not load class insights');
        return;
      }
      setError('');
      setData(ack);
    });
  }, [socket, scope, lessonId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lessons = data?.lessons || [];
  const totals = useMemo(() => headlineTotals(lessons), [lessons]);
  const trendPoints = useMemo(() => [...lessons].reverse().slice(-TREND_LESSONS), [lessons]);
  const focusLesson = lessonId ? lessons.find((lesson) => lesson.id === lessonId) : null;

  async function exportPdf() {
    setPdfBusy(true);
    try {
      const { downloadInsightsPdf } = await import('../lib/insightsPdf.js');
      downloadInsightsPdf(lessons);
    } catch (e) {
      setError(e?.message || 'Could not build the PDF');
    } finally {
      setPdfBusy(false);
    }
  }

  const segBtn = (active) =>
    `rounded-md px-2.5 py-1 text-xs font-bold ${
      active
        ? 'bg-white text-ink-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
    }`;
  const chipBtn =
    'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-insights-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
          <h2 id="class-insights-title" className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">
            Class insights
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Which classes">
              <button type="button" className={segBtn(scope === 'room')} aria-pressed={scope === 'room'} onClick={() => { setScope('room'); setLessonId(null); }}>
                This class
              </button>
              <button type="button" className={segBtn(scope === 'all')} aria-pressed={scope === 'all'} onClick={() => { setScope('all'); setLessonId(null); }}>
                All classes
              </button>
            </div>
            <CloseButton onClick={onClose} aria-label="Close Class insights" />
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 scrollbar-thin">
          {error ? <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p> : null}
          {!data && loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
          {data && !lessons.length ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nothing recorded yet — insights build up as you comment and students write.
            </p>
          ) : null}

          {lessons.length ? (
            <>
              <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Across recorded lessons">
                <Tile label="Comments given" value={totals.commentsGiven} />
                <Tile label="Acted on" value={pctText(totals.actedOnPct)} />
                <Tile label="Check again" value={pctText(totals.checkAgainPct)} />
                <Tile label="Time to confirm" value={formatMinutes(totals.avgConfirmMinutes)} />
                <Tile label="Paste alerts / lesson" value={totals.pasteAlertsPerLesson ?? '—'} />
                <Tile label="Words / student" value={totals.avgWords ?? '—'} />
                <Tile label="Actively writing" value={pctText(totals.writingPct)} />
              </section>

              <section className="grid gap-2 sm:grid-cols-2">
                <Trend
                  label="Comments acted on"
                  suffix="%"
                  max={100}
                  points={trendPoints.map((l) => ({ id: l.id, startedAt: l.startedAt, value: l.actedOnPct }))}
                />
                <Trend
                  label="Paste alerts per lesson"
                  points={trendPoints.map((l) => ({ id: l.id, startedAt: l.startedAt, value: l.pasteAlerts }))}
                />
              </section>

              <section>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Lessons</h3>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        {scope === 'all' ? <th className="px-3 py-2">Room</th> : null}
                        <th className="px-3 py-2">Students</th>
                        <th className="px-3 py-2">Comments</th>
                        <th className="px-3 py-2">Acted on</th>
                        <th className="px-3 py-2">Check again</th>
                        <th className="px-3 py-2">Confirm</th>
                        <th className="px-3 py-2">Paste alerts</th>
                        <th className="px-3 py-2">Words</th>
                        <th className="px-3 py-2">Writing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lessons.map((lesson) => {
                        const selected = lesson.id === lessonId;
                        return (
                          <tr
                            key={lesson.id}
                            onClick={() => setLessonId(selected ? null : lesson.id)}
                            className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${
                              selected ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                            aria-selected={selected}
                          >
                            <td className="px-3 py-2 font-semibold text-ink-900 dark:text-slate-100">
                              {formatLessonDate(lesson.startedAt)}
                              {lesson.endedAt == null ? <span className="ml-1.5 text-[10px] font-bold text-emerald-600">LIVE</span> : null}
                            </td>
                            {scope === 'all' ? <td className="px-3 py-2">{lesson.roomCode}</td> : null}
                            <td className="px-3 py-2">{lesson.students}</td>
                            <td className="px-3 py-2">{lesson.commentsGiven}</td>
                            <td className="px-3 py-2">{pctText(lesson.actedOnPct)}</td>
                            <td className="px-3 py-2">{pctText(lesson.checkAgainPct)}</td>
                            <td className="px-3 py-2">{formatMinutes(lesson.avgConfirmMinutes)}</td>
                            <td className="px-3 py-2">{lesson.pasteAlerts}</td>
                            <td className="px-3 py-2">{lesson.avgWords ?? '—'}</td>
                            <td className="px-3 py-2">{pctText(lesson.writingPct)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Students{focusLesson ? ` · ${formatLessonDate(focusLesson.startedAt)}` : ' · all lessons'}
                  </h3>
                  <button type="button" className={chipBtn} onClick={() => setShowStudents((v) => !v)} aria-expanded={showStudents}>
                    {showStudents ? 'Hide names' : 'Show names'}
                  </button>
                </div>
                {showStudents ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left text-xs tabular-nums">
                      <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Student</th>
                          <th className="px-3 py-2">Lessons</th>
                          <th className="px-3 py-2">Comments</th>
                          <th className="px-3 py-2">Acted on</th>
                          <th className="px-3 py-2">Check again</th>
                          <th className="px-3 py-2">Paste alerts</th>
                          <th className="px-3 py-2">Words</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.students || []).map((row) => (
                          <tr key={row.key} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-2 font-semibold text-ink-900 dark:text-slate-100">{row.name}</td>
                            <td className="px-3 py-2">{row.lessons}</td>
                            <td className="px-3 py-2">{row.commentsGiven}</td>
                            <td className="px-3 py-2">
                              {row.commentsGiven ? `${row.actedOn} (${pctText(row.actedOnPct)})` : '—'}
                            </td>
                            <td className="px-3 py-2">{row.checkAgain}</td>
                            <td className="px-3 py-2">{row.pasteAlerts}</td>
                            <td className="px-3 py-2">{row.avgWords ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className="text-[11px] text-slate-400">
                  Acted on = the student revised the passage. Paste alert = a paste of {data?.pasteAlertChars || 120}+ characters.
                </p>
                <div className="flex gap-2">
                  <button type="button" className={chipBtn} onClick={() => downloadInsightsCsv(lessons)}>
                    Anonymised CSV
                  </button>
                  <button type="button" className={chipBtn} onClick={exportPdf} disabled={pdfBusy}>
                    {pdfBusy ? 'Building…' : 'Anonymised PDF'}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
