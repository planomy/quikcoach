import { useEffect, useMemo, useState } from 'react';
import { activityStatus, isDraftEmpty, wordCount } from '../lib/text.js';

const STATE_LABELS = {
  writing: 'Writing now',
  paused: 'Paused',
  empty: 'Not started',
  away: 'Away',
  offline: 'Offline',
};

const QNA_STATUS = {
  pending: 'Waiting',
  published: 'On the board',
  answered: 'You responded',
};

function nameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function Tile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <div className="font-display text-xl font-bold tabular-nums text-ink-900 dark:text-slate-100">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function lookRank(row) {
  if (row.pastes) return 0;
  if (row.askMiss) return 1;
  if (row.state === 'away' || row.aways) return 2;
  if (row.state === 'empty') return 3;
  if (row.state === 'paused') return 4;
  return 5;
}

export default function TodayReportPanel({
  socket,
  roomCode,
  students = [],
  connectedIdSet,
  awayByStudentId,
  activityNow,
  frozen,
  onOpenTrail,
  onOpenDrafts,
  onOpenPdf,
}) {
  const [pulse, setPulse] = useState(null);
  const [trailById, setTrailById] = useState(new Map());
  const [insightByName, setInsightByName] = useState(new Map());
  const [insightLive, setInsightLive] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!socket || !roomCode) return undefined;
    let cancelled = false;

    const load = () => {
      const jobs = [];
      jobs.push(
        fetch(`/api/rooms/${encodeURIComponent(roomCode)}/lesson-report`)
          .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
          .then(({ ok, data }) => {
            if (cancelled) return;
            setPulse(ok ? data : null);
          })
          .catch(() => {
            if (!cancelled) setPulse(null);
          })
      );

      if (socket.connected) {
        jobs.push(
          new Promise((resolve) => {
            socket.timeout(8000).emit('teacher:draft-trail-view', {}, (err, ack) => {
              if (!cancelled && !err && ack?.ok) {
                setTrailById(new Map((ack.students || []).filter((s) => Number(s.id) > 0).map((s) => [Number(s.id), s])));
              }
              resolve();
            });
          })
        );
        jobs.push(
          new Promise((resolve) => {
            socket.timeout(8000).emit('teacher:insights', { scope: 'room' }, (err, ack) => {
              if (!cancelled && !err && ack?.ok) {
                const live = (ack.lessons || []).find((lesson) => lesson.endedAt == null);
                setInsightLive(live || null);
                const focusId = live?.id;
                const apply = (studentsRows) => {
                  setInsightByName(new Map((studentsRows || []).map((row) => [nameKey(row.name), row])));
                };
                if (focusId) {
                  socket.timeout(8000).emit('teacher:insights', { scope: 'room', lessonId: focusId }, (innerErr, inner) => {
                    if (!cancelled && !innerErr && inner?.ok) apply(inner.students);
                    else if (!cancelled) apply(ack.students);
                    resolve();
                  });
                  return;
                }
                apply(ack.students);
              }
              resolve();
            });
          })
        );
      }

      Promise.all(jobs).finally(() => {
        if (!cancelled) {
          setLoading(false);
          setError('');
        }
      });
    };

    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [socket, roomCode]);

  const rows = useMemo(() => {
    return (students || []).map((student) => {
      const id = Number(student.id);
      let state = 'offline';
      if (connectedIdSet?.has?.(id)) {
        if (awayByStudentId?.get?.(id)) state = 'away';
        else if (isDraftEmpty(student)) state = 'empty';
        else state = activityStatus(student.updated_at, activityNow) !== 'idle' ? 'writing' : 'paused';
      }
      const trail = trailById.get(id);
      const insight = insightByName.get(nameKey(student.name));
      const pulseRow = (pulse?.students || []).find((row) => Number(row.id) === id);
      const askNeed = Number(pulseRow?.pulseOpportunities) || 0;
      const askGot = Number(pulseRow?.pulseAnswered) || 0;
      return {
        id,
        name: student.name || 'Unnamed',
        words: wordCount(student.text),
        state,
        pastes: Number(trail?.pasteEvents) || Number(insight?.pastes) || 0,
        aways: Number(trail?.awayEvents) || 0,
        comments: Number(insight?.commentsGiven) || 0,
        actedOn: Number(insight?.actedOn) || 0,
        askNeed,
        askGot,
        askMiss: askNeed > 0 && askGot < askNeed,
        asked: Number(pulseRow?.questionsAsked) || 0,
        qna: pulseRow?.qna || [],
      };
    }).sort((a, b) => lookRank(a) - lookRank(b) || a.name.localeCompare(b.name));
  }, [students, connectedIdSet, awayByStudentId, activityNow, trailById, insightByName, pulse]);

  const questions = (pulse?.questions || []).filter((q) => !q.optional);
  const qna = pulse?.qna || [];
  const writingNow = rows.filter((row) => row.state === 'writing').length;
  const awayNow = rows.filter((row) => row.state === 'away').length;
  const pastes = rows.reduce((n, row) => n + row.pastes, 0);
  const aways = rows.reduce((n, row) => n + row.aways, 0);
  const comments = insightLive?.commentsGiven ?? rows.reduce((n, row) => n + row.comments, 0);
  const actedOnPct = insightLive?.actedOnPct;
  const askAnswered = questions.reduce((n, q) => n + (q.responded || 0), 0);
  const askPossible = questions.reduce((n, q) => n + (q.roster || 0), 0);

  return (
    <section className="space-y-4">
      <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">
        This lesson: writing, questions both ways, comments, and signs of authenticity. Not every keystroke.
      </p>

      {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
      {loading && !pulse && !trailById.size ? (
        <p className="text-sm text-slate-500">Loading this lesson…</p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="This lesson">
        <Tile label="Writing now" value={writingNow} />
        {questions.length ? (
          <Tile label="Ask answered" value={askPossible ? `${askAnswered}/${askPossible}` : '—'} />
        ) : (
          <Tile label="Student questions" value={qna.length} />
        )}
        <Tile label="Comments acted on" value={comments ? (actedOnPct == null ? `${comments}` : `${actedOnPct}%`) : '—'} />
        <Tile label="Pastes" value={pastes} />
        <Tile label="Left the tab" value={aways} />
        <Tile label="Away now" value={awayNow} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenPdf}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#2f5fee] hover:bg-[#e8eefc] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          Evidence PDF
        </button>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Students</h3>
        {rows.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-[#d8dbe1] bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {rows.map((row) => {
              const bits = [
                STATE_LABELS[row.state],
                `${row.words} words`,
                row.pastes ? `${row.pastes} paste${row.pastes === 1 ? '' : 's'}` : '',
                row.aways ? `left tab ${row.aways}×` : '',
                row.comments ? `comments ${row.actedOn}/${row.comments} fixed` : '',
                row.askNeed ? `Ask ${row.askGot}/${row.askNeed}` : '',
                row.asked ? `${row.asked} question${row.asked === 1 ? '' : 's'} asked` : '',
              ].filter(Boolean);
              return (
                <li key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenTrail?.(row.id)}
                      className="min-w-0 text-left"
                    >
                      <span className="block text-sm font-semibold text-ink-900 dark:text-slate-100">{row.name}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {bits.join(' · ')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenDrafts?.(row.id)}
                      className="shrink-0 text-[11px] font-bold text-[#2f5fee] hover:text-[#2450d6] dark:text-indigo-300"
                    >
                      Drafts
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No one has joined this lesson yet.</p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Tap a name for the learning trail story. Drafts steps through changes if you need them.
          Pastes and time away help you gauge authenticity — they are not proof.
          {frozen ? ' The board is frozen, so quiet time now is expected.' : ''}
        </p>
      </div>

      {questions.length ? (
        <div>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">You asked</h3>
          <ul className="space-y-2">
            {questions.map((question) => (
              <li key={question.activityId || question.questionNumber} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                <p className="text-sm font-semibold text-ink-900 dark:text-slate-100">
                  Q{question.questionNumber} · {question.prompt === 'Verbal question' ? 'Verbal check' : question.prompt || 'Question'}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {question.responded}/{question.roster} answered · {question.responseRate}%
                  {question.confident || question.unsure || question.guessed
                    ? ` · ${question.confident || 0} confident · ${question.unsure || 0} not sure · ${question.guessed || 0} guessed`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {qna.length ? (
        <div>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">They asked</h3>
          <ul className="space-y-2">
            {qna.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {item.anonymous ? 'Anonymous' : item.studentName || 'Student'} · {QNA_STATUS[item.status] || item.status}
                </p>
                <p className="mt-0.5 text-sm text-ink-900 dark:text-slate-100">{item.text}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
