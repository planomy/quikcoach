import { useTheme } from '../lib/theme.jsx';

export default function ThemeToggle({ className = '' }) {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-400 dark:hover:text-indigo-200 ${className}`}
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {isDark ? '☀️' : '🌙'}
      </span>
      {isDark ? 'Light' : 'Dark'}
    </button>
  );
}
