export default function QuikCoachWordmark({ className = '', quikClassName = '' }) {
  return (
    <div className={`font-display font-bold tracking-tight text-ink-900 ${className}`.trim()}>
      <span className={quikClassName}>Quik</span> <span>Coach</span>
    </div>
  );
}
