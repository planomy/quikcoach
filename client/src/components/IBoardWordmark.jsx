/** App wordmark: iBOARD */
export default function IBoardWordmark({ className = '', iClassName = 'italic text-indigo-600' }) {
  return (
    <div
      className={`font-display font-bold tracking-tight text-ink-900 dark:text-slate-100 ${className}`.trim()}
    >
      <span className={iClassName}>i</span>BOARD
    </div>
  );
}
