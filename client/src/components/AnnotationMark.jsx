export default function AnnotationMark({
  tone = 'open',
  className = '',
  children: _children,
  ...props
}) {
  const icon = tone === 'open' || tone === 'reopen' ? 'comment' : 'check';
  return (
    <button
      type="button"
      data-teacher-annotation-ui
      className={`iboard-ann-mark iboard-ann-mark--${tone} ${className}`.trim()}
      {...props}
    >
      <span className="iboard-ann-mark__pip" aria-hidden="true">
        {icon === 'comment' ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3.2 4.2h9.6M3.2 8h6.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3.4 8.2 3.1 3.1 6.1-6.6" />
          </svg>
        )}
      </span>
      <span className="iboard-ann-mark__stem" aria-hidden="true" />
    </button>
  );
}
