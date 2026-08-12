/** Small green circle with white P → iBOARD Pulse (floatable live questions). */
export default function PulseLink({ className = '', size = 'sm', code = '' }) {
  const dim = size === 'md' ? 'h-6 w-6 text-[11px]' : 'h-5 w-5 text-[10px]';
  const clean = String(code || '').replace(/\D/g, '').slice(0, 4);
  const href = clean.length === 4 ? `/pulse?code=${encodeURIComponent(clean)}` : '/pulse';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Pulse — live class questions (float over OneNote)"
      aria-label="Open iBOARD Pulse for live class questions"
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold leading-none text-white shadow-sm hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${className}`}
    >
      P
    </a>
  );
}
