import '../styles/panelActions.css';
import HintWrap from './HintWrap.jsx';

function IconAction({ kind, label, className = '', title, 'aria-label': ariaLabel, ...props }) {
  const name = ariaLabel || label || (kind === 'close' ? 'Close' : 'Remove');
  // Empty string suppresses the hint when a parent HintWrap already owns it.
  const tip = title === undefined ? name : title;
  const button = (
    <button
      {...props}
      type="button"
      aria-label={name}
      title=""
      className={`iboard-icon-action iboard-icon-action--${kind} ${className}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {kind === 'close' ? <path d="m6 6 12 12M18 6 6 18" /> : <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>}
      </svg>
    </button>
  );
  if (!tip) return button;
  return <HintWrap hint={tip}>{button}</HintWrap>;
}

export function CloseButton(props) { return <IconAction {...props} kind="close" />; }
export function RemoveButton(props) { return <IconAction {...props} kind="remove" />; }
