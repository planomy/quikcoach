import { useEffect, useMemo, useState } from 'react';
import { CloseButton } from './PanelActions.jsx';
import AlertIcon from './AlertIcon.jsx';
import HintWrap from './HintWrap.jsx';

const STATE_LABELS = {
  writing: 'Writing now',
  paused: 'Paused',
  empty: 'Not started',
  away: 'Away from TUIT',
  offline: 'Offline',
};
// Needs a look first: away, not started and paused come before students who are writing.
const STATE_RANK = { away: 0, empty: 1, paused: 2, writing: 3, offline: 4 };
const SORT_KEY = 'iboard-writing-sort';

function firstName(name) {
  return String(name || 'Unnamed').trim().split(/\s+/)[0] || 'Unnamed';
}

function clock(ms) {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

const CELL_LABEL = { w: 'Adding', r: 'Revising', a: 'Away' };
const MARK_LABEL = { paste: 'Pasted', support: 'Support' };

function stripRuns(cells) {
  const runs = [];
  const source = String(cells || '');
  for (let i = 0; i < source.length; ) {
    const kind = source[i];
    let j = i + 1;
    while (j < source.length && source[j] === kind) j += 1;
    runs.push({ kind, len: j - i, i, j });
    i = j;
  }
  return runs;
}

function runHint(run, start, end, count) {
  const label = CELL_LABEL[run.kind];
  if (!label || !start || !end || !count) return '';
  const span = Math.max(1, end - start);
  const from = clock(start + (run.i / count) * span);
  const to = clock(start + (run.j / count) * span);
  if (!from) return label;
  return from === to ? `${label} · ${from}` : `${label} · ${from}–${to}`;
}

function markHint(mark) {
  const label = MARK_LABEL[mark?.k];
  if (!label) return '';
  const when = clock(mark.at);
  return when ? `${label} · ${when}` : label;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export default function WritingPulsePanel({ socket, students, trailActive, onOpenTrail, onClose }) {
  const [strips, setStrips] = useState(null);
  const [sort, setSort] = useState(() => {
    try { return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'look'; } catch { return 'look'; }
  });

  useEffect(() => {
    if (!socket) return undefined;
    let cancelled = false;
    const load = () => {
      if (!socket.connected) return;
      socket.timeout(8000).emit('teacher:trail-strips', {}, (err, ack) => {
        if (cancelled || err || !ack?.ok) return;
        setStrips({
          start: Number(ack.start) || 0,
          end: Number(ack.end) || 0,
          byId: new Map((ack.students || []).map((s) => [Number(s.id), s])),
        });
      });
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [socket]);

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* storage may be unavailable */ }
  }, [sort]);

  const counts = useMemo(() => {
    const out = { writing: 0, paused: 0, empty: 0, away: 0, online: 0 };
    for (const s of students) {
      if (s.state === 'offline') continue;
      out.online += 1;
      out[s.state] += 1;
    }
    return out;
  }, [students]);

  const medianWords = useMemo(
    () => median(students.filter((s) => s.state !== 'offline' && s.words > 0).map((s) => s.words)),
    [students]
  );

  const ordered = useMemo(() => {
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    return [...students].sort((a, b) => (sort === 'look' ? (STATE_RANK[a.state] - STATE_RANK[b.state]) || byName(a, b) : byName(a, b)));
  }, [students, sort]);

  const summary = [
    `${counts.writing} writing`,
    counts.paused ? `${counts.paused} paused` : '',
    counts.empty ? `${counts.empty} not started` : '',
    counts.away ? `${counts.away} away` : '',
    `${counts.online} online`,
  ].filter(Boolean).join(' · ');

  return (
    <section className="iboard-writing-pulse" aria-label="Class writing">
      <div className="iboard-writing-pulse__head">
        <div className="min-w-0">
          <h2>Class writing</h2>
          <p>{summary}{medianWords ? ` · median ${medianWords} words` : ''}</p>
        </div>
        <div className="iboard-writing-pulse__sort" role="group" aria-label="Sort students">
          <button type="button" aria-pressed={sort === 'look'} onClick={() => setSort('look')}>Needs a look</button>
          <button type="button" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>A–Z</button>
        </div>
        <CloseButton onClick={onClose} label="Close" />
      </div>

      <div className="iboard-writing-pulse__body scrollbar-thin">
        {ordered.length ? (
          <div className="iboard-writing-pulse__grid">
            {ordered.map((student) => {
              const strip = strips?.byId.get(Number(student.id));
              const cells = strip?.cells || '';
              const runs = stripRuns(cells);
              const started = clock(strip?.started);
              const stateLabel = STATE_LABELS[student.state];
              return (
                <button
                  key={student.id}
                  type="button"
                  className="iboard-writing-chit"
                  data-state={student.state}
                  onClick={() => onOpenTrail(student.id)}
                  title=""
                  aria-label={`${student.name}: ${stateLabel}, ${student.words} words${started ? `, started ${started}` : ''}. Open learning trail`}
                >
                  <span className="iboard-writing-chit__top">
                    <span className="iboard-writing-chit__dot" aria-hidden="true" />
                    <span className="iboard-writing-chit__who">
                      <span className="iboard-writing-chit__name">{firstName(student.name)}</span>
                      {started ? <span className="iboard-writing-chit__started">started {started}</span> : null}
                    </span>
                    <span className="iboard-writing-chit__words tabular-nums">{student.words}w</span>
                  </span>
                  <span className="iboard-writing-chit__strip">
                    <span className="iboard-writing-chit__marks">
                      {(strip?.marks || []).map((mark, n) => (
                        <span
                          key={n}
                          className="iboard-writing-chit__mark-slot"
                          style={{ left: `${Math.min(100, Math.max(0, mark.p))}%` }}
                        >
                          <HintWrap hint={markHint(mark)} className={`iboard-writing-chit__mark is-${mark.k}`}>
                            <span />
                          </HintWrap>
                        </span>
                      ))}
                    </span>
                    <span className="iboard-writing-chit__cells">
                      {runs.map((run, n) => (
                        <span
                          key={n}
                          className={`iboard-writing-chit__cell${run.kind === '-' ? ' is-none' : ''}`}
                          style={{ flexGrow: run.len }}
                        >
                          {run.kind === '-' ? null : (
                            <HintWrap hint={runHint(run, strips?.start, strips?.end, cells.length)} className="iboard-writing-chit__run">
                              <span className={`is-${run.kind}`} />
                            </HintWrap>
                          )}
                        </span>
                      ))}
                    </span>
                  </span>
                  {student.pasted || student.inbox ? (
                    <span className="iboard-writing-chit__badges" aria-hidden="true">
                      {student.pasted ? <span className="is-paste"><AlertIcon id="pasted" /></span> : null}
                      {student.inbox ? <span className="is-inbox"><AlertIcon id="messages" /></span> : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="iboard-writing-pulse__empty">Students will appear here when they join.</p>
        )}
      </div>

      <div className="iboard-writing-pulse__foot">
        <span className="iboard-writing-pulse__legend">
          <span><i className="is-w" />Adding</span>
          <span><i className="is-r" />Revising</span>
          <span><i className="is-a" />Away</span>
          <span><i className="is-support" />Support</span>
          <span><i className="is-paste" />Paste</span>
        </span>
        <span className="iboard-writing-pulse__span">
          {trailActive
            ? strips?.start ? `${clock(strips.start)} – now` : ''
            : 'Learning trail is off, so strips stay empty'}
        </span>
      </div>
    </section>
  );
}
