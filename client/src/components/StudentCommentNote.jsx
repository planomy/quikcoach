import HintWrap from './HintWrap.jsx';

const CHECK_LABEL = {
  open: 'Mark this comment as checked',
  reopen: 'Mark this comment as checked again',
  fixed: 'Waiting for your teacher',
  resolved: 'Teacher confirmed this',
};

const PIP_HINT = {
  open: 'New comment',
  fixed: 'Waiting for teacher',
  reopen: 'Check again',
  resolved: 'Confirmed',
};

function NoteIcon({ tone }) {
  if (tone === 'open' || tone === 'reopen') {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M3.2 4.2h9.6M3.2 8h6.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.4 8.2 3.1 3.1 6.1-6.6" />
    </svg>
  );
}

export default function StudentCommentNote({
  tone = 'open',
  note = '',
  lit = false,
  detached = false,
  busy = false,
  onCheck,
  className = '',
  ...props
}) {
  const label = String(note || '').trim() || 'Teacher comment';
  const canCheck = (tone === 'open' || tone === 'reopen') && typeof onCheck === 'function';
  return (
    <div
      data-teacher-annotation-ui
      className={`iboard-student-note iboard-student-note--${tone}${detached ? ' is-detached' : ''}${lit ? ' is-lit' : ''} ${className}`.trim()}
      {...props}
    >
      <span className="iboard-student-note__stem" aria-hidden="true" />
      <span className="iboard-student-note__text">{label}</span>
      <HintWrap hint={PIP_HINT[tone] || PIP_HINT.open} prefer="above" className="pointer-events-auto">
        <button
          type="button"
          className="iboard-student-note__check"
          disabled={!canCheck || busy}
          onClick={canCheck ? onCheck : undefined}
          aria-label={CHECK_LABEL[tone] || CHECK_LABEL.open}
        >
          <NoteIcon tone={tone} />
        </button>
      </HintWrap>
    </div>
  );
}
