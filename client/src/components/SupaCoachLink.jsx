export const SUPACOACH_URL = 'https://planomy.github.io/supacoach/';

/** Small red circle with white S → SupaCoach expression feedback. */
export default function SupaCoachLink({ className = '', size = 'sm' }) {
  const dim = size === 'md' ? 'h-6 w-6 text-[11px]' : 'h-5 w-5 text-[10px]';
  return (
    <a
      href={SUPACOACH_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="SupaCoach — feedback on expression"
      aria-label="Open SupaCoach for expression feedback"
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-red-600 font-bold leading-none text-white shadow-sm hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 ${className}`}
    >
      S
    </a>
  );
}
