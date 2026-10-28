import HintWrap from './HintWrap.jsx';

const ARC_R = 43;
const ARC_STROKE = 7;
const ARC_C = 2 * Math.PI * ARC_R;

function gaugeArcs(segments, total) {
  const drawn = (segments || []).filter(
    (segment) => segment.count > 0 && segment.color !== 'var(--class-gauge-rest)'
  );
  const active = drawn.reduce((sum, segment) => sum + segment.count, 0);
  if (!total || active <= 0) return [];
  let start = 0;
  return drawn.map((segment) => {
    const len = (segment.count / total) * ARC_C;
    const arc = { key: segment.key, color: segment.color, start, len };
    start += len;
    return arc;
  });
}

export default function ClassGauge({ title, caption, done, total, online, segments, onClick, expanded = false, opens = '', notice = '' }) {
  const hint = (
    <span className="block min-w-[11rem]">
      <span className="block whitespace-nowrap bg-[#12109a] px-2.5 py-1 text-[9px] font-semibold text-white dark:bg-[#1a18d4]">
        {title}
      </span>
      <span className="block px-2.5 py-1.5 text-[#1a18d4] dark:text-indigo-200">
        {segments.map((segment) => (
          <span key={segment.key} className="iboard-class-gauge__row">
            <span className="iboard-class-gauge__dot" style={{ background: segment.color }} />
            <span className="flex-1">{segment.label}</span>
            <b className="tabular-nums">{segment.count}</b>
          </span>
        ))}
        {opens ? <span className="mt-1 block text-[9px] font-semibold text-[#8b8b96] dark:text-slate-400">Click to open {opens}</span> : null}
      </span>
    </span>
  );
  const summary = segments.map((segment) => `${segment.count} ${segment.label.toLowerCase()}`).join(', ');
  const arcs = gaugeArcs(segments, total);
  return (
    <HintWrap hint={hint} prefer="below" tone="card" suppressed={expanded}>
      <button
        type="button"
        className="iboard-class-gauge"
        onClick={onClick}
        aria-expanded={expanded}
        data-active={expanded ? 'true' : 'false'}
        aria-label={`${title}: ${summary}. ${online} online.${opens ? ` Open ${opens}` : ''}`}
        title=""
      >
        <span className="iboard-class-gauge__ring">
          <svg className="iboard-class-gauge__arc" viewBox="0 0 100 100" aria-hidden="true">
            <circle
              className="iboard-class-gauge__track"
              cx="50"
              cy="50"
              r={ARC_R}
              fill="none"
              strokeWidth={ARC_STROKE}
            />
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx="50"
                cy="50"
                r={ARC_R}
                fill="none"
                stroke={arc.color}
                strokeWidth={ARC_STROKE}
                strokeLinecap="round"
                strokeDasharray={`${arc.len} ${ARC_C}`}
                strokeDashoffset={-arc.start}
                transform="rotate(-90 50 50)"
              />
            ))}
          </svg>
          <span className="iboard-class-gauge__face">
            <span className="iboard-class-gauge__count tabular-nums">{total ? `${done}/${total}` : '0'}</span>
            <span className="iboard-class-gauge__caption">{caption}</span>
            <span className="iboard-class-gauge__online">
              <span className={`iboard-class-gauge__live${Number(online) > 0 ? '' : ' is-idle'}`} aria-hidden="true" />
              <b className="tabular-nums">{online}</b> online
            </span>
            {notice ? (
              <span className="iboard-class-gauge__notice" role="status">
                {notice}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </HintWrap>
  );
}
