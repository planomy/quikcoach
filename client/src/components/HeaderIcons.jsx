import GaugeIcon from './GaugeIcon.jsx';

const glyph = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/** Download arrow. The draft is already kept; this button hands over a copy. */
export function SaveIcon({ saved = false }) {
  return <GaugeIcon id="save" className={`iboard-header-glyph iboard-save-icon${saved ? ' is-saved' : ''}`} />;
}

/** Four corners. Arrows point out to enter fullscreen, and in to leave it. */
export function FullscreenIcon({ active = false }) {
  return (
    <svg className="iboard-header-glyph" {...glyph}>
      {active ? (
        <>
          <path d="M9 4.5v4.5H4.5" />
          <path d="M9 9 4.5 4.5" />
          <path d="M15 4.5v4.5h4.5" />
          <path d="M15 9l4.5-4.5" />
          <path d="M9 19.5V15H4.5" />
          <path d="M9 15l-4.5 4.5" />
          <path d="M15 19.5V15h4.5" />
          <path d="M15 15l4.5 4.5" />
        </>
      ) : (
        <>
          <path d="M9 4.5H4.5V9" />
          <path d="M4.5 4.5 9 9" />
          <path d="M15 4.5h4.5V9" />
          <path d="M19.5 4.5 15 9" />
          <path d="M9 19.5H4.5V15" />
          <path d="M4.5 19.5 9 15" />
          <path d="M15 19.5h4.5V15" />
          <path d="M19.5 19.5 15 15" />
        </>
      )}
    </svg>
  );
}
