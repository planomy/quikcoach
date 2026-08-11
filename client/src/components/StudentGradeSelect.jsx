/** Compact per-student year/grade options (stored as yr2…yr12). */
export const STUDENT_GRADE_OPTIONS = [
  { id: '', label: 'Year' },
  { id: 'yr2', label: 'Y2' },
  { id: 'yr3', label: 'Y3' },
  { id: 'yr4', label: 'Y4' },
  { id: 'yr5', label: 'Y5' },
  { id: 'yr6', label: 'Y6' },
  { id: 'yr7', label: 'Y7' },
  { id: 'yr8', label: 'Y8' },
  { id: 'yr9', label: 'Y9' },
  { id: 'yr10', label: 'Y10' },
  { id: 'yr11', label: 'Y11' },
  { id: 'yr12', label: 'Y12' },
];

export function gradeShortLabel(yearLevel) {
  const id = String(yearLevel || '').trim().toLowerCase();
  const hit = STUDENT_GRADE_OPTIONS.find((o) => o.id === id);
  return hit && hit.id ? hit.label : '';
}

/**
 * Small grade/year selector for student cards.
 * @param {{ value: string, onChange: (id: string) => void, compact?: boolean, className?: string }} props
 */
export default function StudentGradeSelect({ value, onChange, compact = false, className = '' }) {
  const v = String(value || '').trim().toLowerCase();
  return (
    <select
      value={STUDENT_GRADE_OPTIONS.some((o) => o.id === v) ? v : ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onChange?.(e.target.value);
      }}
      title="Student year level"
      aria-label="Student year level"
      className={
        compact
          ? `max-w-[3.25rem] cursor-pointer rounded border-0 bg-white/10 py-0.5 pl-1 pr-0 text-[9px] font-bold uppercase tracking-wide text-indigo-100 outline-none hover:bg-white/15 focus:ring-1 focus:ring-indigo-300 ${className}`
          : `cursor-pointer rounded-lg border border-slate-200 bg-white py-1 pl-2 pr-1 text-[11px] font-semibold text-slate-700 outline-none hover:border-indigo-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 ${className}`
      }
    >
      {STUDENT_GRADE_OPTIONS.map((o) => (
        <option key={o.id || 'none'} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
