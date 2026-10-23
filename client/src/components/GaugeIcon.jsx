const SRC = {
  away: '/brand/gauge/away.png?v=9',
  'not-started': '/brand/gauge/not-started.png?v=11',
  'no-typing': '/brand/gauge/no-typing.png?v=10',
  pasted: '/brand/gauge/pasted.png',
  inbox: '/brand/gauge/inbox.png?v=9',
  modelling: '/brand/gauge/modelling.png',
  freeze: '/brand/gauge/freeze.png?v=9',
  text: '/brand/gauge/text.png?v=9',
  save: '/brand/gauge/save.png?v=10',
  collaboration: '/brand/gauge/collaboration.png?v=9',
};

// Width divided by height, so a wide mark can share the others' height.
const ASPECT = {
  away: 0.9883,
  'not-started': 0.8594,
  'no-typing': 1.9805,
  pasted: 0.8984,
  inbox: 1.4062,
  modelling: 1.0352,
  freeze: 0.8984,
  text: 1.0664,
  save: 1.0234,
  collaboration: 1.3047,
};

export default function GaugeIcon({ id, className = '' }) {
  const src = SRC[id];
  if (!src) return null;
  return (
    <span
      className={`iboard-gauge-icon${className ? ` ${className}` : ''}`}
      style={{ '--gauge-icon': `url("${src}")`, '--gauge-aspect': ASPECT[id] ?? 1 }}
      aria-hidden="true"
    />
  );
}
