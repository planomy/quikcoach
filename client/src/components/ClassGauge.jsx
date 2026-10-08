import HintWrap from './HintWrap.jsx';

function ringGradient(segments, total) {
  if (!total) return 'var(--class-gauge-track)';
  let at = 0;
  const stops = [];
  for (const segment of segments) {
    if (!segment.count) continue;
    const end = at + (segment.count / total) * 360;
    stops.push(`${segment.color} ${at}deg ${end}deg`);
    at = end;
  }
  if (at < 360) stops.push(`var(--class-gauge-track) ${at}deg 360deg`);
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}

export default function ClassGauge({ title, caption, done, total, online, segments }) {
  const hint = (
    <span className="block min-w-[11rem]">
      <span className="block whitespace-nowrap bg-[#3c3f8f] px-2.5 py-1 text-[9px] font-semibold text-white dark:bg-[#5a5fc3]">
        {title}
      </span>
      <span className="block px-2.5 py-1.5 text-[#5a5fc3] dark:text-indigo-200">
        {segments.map((segment) => (
          <span key={segment.key} className="iboard-class-gauge__row">
            <span className="iboard-class-gauge__dot" style={{ background: segment.color }} />
            <span className="flex-1">{segment.label}</span>
            <b className="tabular-nums">{segment.count}</b>
          </span>
        ))}
      </span>
    </span>
  );
  const summary = segments.map((segment) => `${segment.count} ${segment.label.toLowerCase()}`).join(', ');
  return (
    <HintWrap hint={hint} prefer="below" tone="card">
      <div className="iboard-class-gauge" role="img" aria-label={`${title}: ${summary}. ${online} online`} title="">
        <div className="iboard-class-gauge__ring" style={{ background: ringGradient(segments, total) }}>
          <div className="iboard-class-gauge__face">
            <span className="iboard-class-gauge__count tabular-nums">{total ? `${done}/${total}` : '—'}</span>
            <span className="iboard-class-gauge__caption">{caption}</span>
            <span className="iboard-class-gauge__online">
              <span className="iboard-class-gauge__live" aria-hidden="true" />
              <b className="tabular-nums">{online}</b> online
            </span>
          </div>
        </div>
      </div>
    </HintWrap>
  );
}
