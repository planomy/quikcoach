const SRC = {
  away: '/brand/gauge/away.png',
  'not-started': '/brand/gauge/not-started.png',
  'no-typing': '/brand/gauge/no-typing.png',
  pasted: '/brand/gauge/pasted.png',
  inbox: '/brand/gauge/inbox.png',
  modelling: '/brand/gauge/modelling.png',
  freeze: '/brand/gauge/freeze.png',
  text: '/brand/gauge/text.png',
  save: '/brand/gauge/save.png',
  collaboration: '/brand/gauge/collaboration.png',
};

// Width divided by height, so a wide mark can share the others' height.
const ASPECT = {
  away: 0.9648,
  'not-started': 0.8359,
  'no-typing': 1.4805,
  pasted: 0.8984,
  inbox: 1.3594,
  modelling: 1.0156,
  freeze: 0.875,
  text: 0.9141,
  save: 0.9727,
  collaboration: 1.2109,
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
