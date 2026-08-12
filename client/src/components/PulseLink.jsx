const HANDOFF_PREFIX = 'iboard-pulse-handoff:';

/** Small green circle with white P → iBOARD Pulse (floatable live questions). */
export default function PulseLink({ className = '', size = 'sm', code = '', studentId = null }) {
  const dim = size === 'md' ? 'h-6 w-6 text-[11px]' : 'h-5 w-5 text-[10px]';
  const clean = String(code || '').replace(/\D/g, '').slice(0, 4);
  const href = clean.length === 4 ? `/pulse?code=${encodeURIComponent(clean)}` : '/pulse';

  function prepareHandoff(event) {
    event.stopPropagation();
    const sid = Number(studentId);
    if (clean.length !== 4 || !sid) return;
    try {
      const token = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(
        `${HANDOFF_PREFIX}${token}`,
        JSON.stringify({ code: clean, studentId: sid, createdAt: Date.now() })
      );
      event.currentTarget.href = `/pulse?code=${encodeURIComponent(clean)}&handoff=${encodeURIComponent(token)}`;
    } catch {
      /* The normal Pulse join screen remains available when storage is blocked. */
    }
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={prepareHandoff}
      title="Pulse — live class questions (float over OneNote)"
      aria-label="Open iBOARD Pulse for live class questions"
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold leading-none text-white shadow-sm hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${className}`}
    >
      P
    </a>
  );
}
