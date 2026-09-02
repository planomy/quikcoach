import { useEffect, useState } from 'react';
import { LIVE_STATUS_LABELS } from '../lib/liveResponseMeta.js';
import { downloadLessonReportCsv, downloadLessonReportHtml } from '../lib/lessonReport.js';

function truncate(text, max = 56) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function confidenceBadge(confidence) {
  if (confidence === 'confident') return 'text-emerald-700 dark:text-emerald-300';
  if (confidence === 'unsure') return 'text-amber-700 dark:text-amber-300';
  if (confidence === 'guessed') return 'text-red-700 dark:text-red-300';
  return 'text-slate-500';
}

export default function LessonReportPanel({ roomCode, onClose }) {
  const [tab, setTab] = useState('students');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/rooms/${encodeURIComponent(roomCode)}/lesson-report`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(data?.error || 'Could not load the class engagement report.');
          setReport(null);
          return;
        }
        setReport(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the class engagement report.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  const questions = (report?.questions || []).filter((q) => !q.optional);
  const students = report?.students || [];

  function cellFor(studentId, questionNumber) {
    const student = students.find((row) => row.id === studentId);
    return student?.cells?.find((row) => row.questionNumber === questionNumber) || null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-[2px] sm:items-center">
      <div
        className="flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-report-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Class engagement report</p>
            <h2 id="lesson-report-title" className="font-display text-xl font-black text-slate-950 dark:text-white">
              Room {roomCode}
            </h2>
            {report ? (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {students.length} participant{students.length === 1 ? '' : 's'} · {questions.length} pulse question{questions.length === 1 ? '' : 's'}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {report ? (
              <>
                <button type="button" onClick={() => downloadLessonReportHtml(report)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                  Download HTML
                </button>
                <button type="button" onClick={() => downloadLessonReportCsv(report)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700">
                  Download CSV
                </button>
              </>
            ) : null}
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <nav aria-label="Report views" className="flex shrink-0 gap-1 border-b border-slate-200 bg-slate-50 px-4 pt-2 dark:border-slate-700 dark:bg-slate-950/50">
          {[
            ['students', 'By student'],
            ['questions', 'By question'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-t-lg px-3.5 py-2 text-[11px] font-bold sm:text-xs ${
                tab === id
                  ? 'relative z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white dark:border-b-slate-900'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          {loading ? <p className="text-sm text-slate-500">Loading report…</p> : null}
          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
          {!loading && !error && report && tab === 'questions' ? (
            questions.length ? (
              <div className="space-y-3">
                {questions.map((question) => (
                  <article key={question.activityId} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-wide text-indigo-600">Q{question.questionNumber}</p>
                        <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{question.prompt}</p>
                      </div>
                      <p className="shrink-0 text-sm font-black text-slate-700 dark:text-slate-200">
                        {question.responded}/{question.roster} · {question.responseRate}%
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-500">
                      <span className="text-emerald-700 dark:text-emerald-300">{question.confident} confident</span>
                      <span className="text-amber-700 dark:text-amber-300">{question.unsure} not confident</span>
                      <span className="text-red-700 dark:text-red-300">{question.guessed} guessed</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
                No pulse questions yet. Launch a question from Ask to start building this report.
              </p>
            )
          ) : null}

          {!loading && !error && report && tab === 'students' ? (
            students.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:border-slate-700">
                      <th className="px-2 py-2">Student</th>
                      <th className="px-2 py-2">Pulse</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Asked</th>
                      {questions.map((q) => (
                        <th key={q.activityId} className="px-2 py-2">Q{q.questionNumber}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => (
                      <tr key={student.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2 font-bold text-slate-900 dark:text-white">{student.name}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                          {student.pulseAnswered}/{student.pulseOpportunities || '—'}
                          <span className="ml-1 text-slate-400">({student.pulseParticipation}%)</span>
                        </td>
                        <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                          {student.engagementStatus ? (LIVE_STATUS_LABELS[student.engagementStatus] || student.engagementStatus) : '—'}
                        </td>
                        <td className="px-2 py-2 tabular-nums text-slate-600 dark:text-slate-300">{student.questionsAsked || '—'}</td>
                        {questions.map((q) => {
                          const cell = cellFor(student.id, q.questionNumber);
                          return (
                            <td key={q.activityId} className="max-w-[8rem] px-2 py-2 text-slate-700 dark:text-slate-200">
                              {cell ? (
                                <>
                                  <span className="block truncate">{truncate(cell.value, 28)}</span>
                                  {cell.confidence ? (
                                    <span className={`text-[10px] font-semibold ${confidenceBadge(cell.confidence)}`}>
                                      {cell.confidence === 'confident' ? 'Confident' : cell.confidence === 'unsure' ? 'Not confident' : 'Guessed'}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-slate-300 dark:text-slate-600">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
                No participants in this room yet.
              </p>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
