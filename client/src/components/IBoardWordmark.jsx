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
  const hero = size === 'hero' || /\b(text-3xl|iboard-brand--hero)\b/.test(className);
  const tall = !hero && (size === 'lg' || /\btext-2xl\b/.test(className));
  const src = variant === 'full' ? '/brand/tuit-logo-full.png' : '/brand/tuit-logo.png';
  const alt = variant === 'full' ? 'TUIT — Focused teaching & Learning' : 'TUIT';
  return (
    <div className={`iboard-brand shrink-0 ${className}`.trim()} aria-label="TUIT">
      <img
        src={src}
        alt={alt}
        className={`iboard-brand-logo ${hero ? 'iboard-brand-logo--hero' : tall ? 'iboard-brand-logo--lg' : ''} ${variant === 'full' ? 'iboard-brand-logo--full' : ''}`.trim()}
      />
    </div>
  );
}
