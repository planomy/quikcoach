/** Fast hover/focus hint chip — short labels, no browser tooltip delay. */
export default function HintWrap({ hint, children, className = '' }) {
  if (!hint) return children;
  return (
    <span className={`group/hint relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-[120] -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-black leading-none text-white opacity-0 shadow-lg transition-opacity duration-75 group-hover/hint:opacity-100 group-focus-within/hint:opacity-100 dark:bg-slate-100 dark:text-slate-900"
      >
        {hint}
      </span>
    </span>
  );
}
