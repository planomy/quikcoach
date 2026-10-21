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

export default function GaugeIcon({ id, className = '' }) {
  const src = SRC[id];
  if (!src) return null;
  return (
    <span
      className={`iboard-gauge-icon${className ? ` ${className}` : ''}`}
      style={{ '--gauge-icon': `url("${src}")` }}
      aria-hidden="true"
    />
  );
}
