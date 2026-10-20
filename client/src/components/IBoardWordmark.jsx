/** App wordmark: TUIT
 *  variant="mark" (default) = icon + TUIT (consoles)
 *  variant="full" = icon + TUIT + tagline (login / join screens)
 */
export default function IBoardWordmark({
  className = '',
  iClassName: _iClassName = '',
  size = '',
  variant = 'mark',
}) {
  const login = size === 'login';
  const hero = !login && (size === 'hero' || /\b(text-3xl|iboard-brand--hero)\b/.test(className));
  const tall = !login && !hero && (size === 'lg' || /\btext-2xl\b/.test(className));
  const src = variant === 'full' ? '/brand/tuit-logo-full.png?v=7' : '/brand/tuit-logo.png?v=7';
  const alt = variant === 'full' ? 'TUIT — Focused Teaching & Learning' : 'TUIT';
  return (
    <div className={`iboard-brand shrink-0 ${login ? 'iboard-brand--login' : ''} ${className}`.trim()} aria-label="TUIT">
      <img
        src={src}
        alt={alt}
        className={`iboard-brand-logo ${login ? 'iboard-brand-logo--login' : hero ? 'iboard-brand-logo--hero' : tall ? 'iboard-brand-logo--lg' : ''} ${variant === 'full' ? 'iboard-brand-logo--full' : ''}`.trim()}
      />
    </div>
  );
}
