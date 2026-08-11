const HEAT = [
  { min: 80, colour: '#16a34a', label: 'strong engagement' },
  { min: 60, colour: '#84cc16', label: 'good engagement' },
  { min: 40, colour: '#eab308', label: 'mixed engagement' },
  { min: 20, colour: '#f97316', label: 'low engagement' },
  { min: 0, colour: '#ef4444', label: 'very low engagement' },
];

export default function EngagementRing({ engagement, connected = true, size = 48 }) {
  const score = Number(engagement?.score ?? 100);
  const band = HEAT.find((item) => score >= item.min) || HEAT[HEAT.length - 1];
  const opportunities = Number(engagement?.opportunities || 0);
  const responded = Number(engagement?.responded || 0);
  const label = connected
    ? opportunities
      ? `${band.label}: ${responded} of ${opportunities} recent opportunities answered`
      : 'online; no engagement opportunities yet'
    : 'offline';

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={`grid shrink-0 place-items-center rounded-full ${connected ? '' : 'border-2 border-dashed border-slate-300 dark:border-slate-600'}`}
      style={{
        width: size,
        height: size,
        background: connected && opportunities
          ? `conic-gradient(${band.colour} ${score * 3.6}deg, #e2e8f0 0deg)`
          : '#f1f5f9',
      }}
    >
      <div
        className="grid place-items-center rounded-full bg-white text-[11px] font-black text-slate-700 dark:bg-slate-900 dark:text-slate-200"
        style={{ width: size - 9, height: size - 9 }}
      >
        {opportunities ? `${responded}/${opportunities}` : '—'}
      </div>
    </div>
  );
}
