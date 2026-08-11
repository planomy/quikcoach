import { useState } from 'react';
import IBoardWordmark from './IBoardWordmark.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { isTeacherUnlocked, unlockTeacher } from '../lib/teacherAuth.js';

/** Simple PIN gate for teacher surfaces (PIN 1011). Session-scoped unlock. */
export default function TeacherPinGate({ children, title = 'Teacher access' }) {
  const [ok, setOk] = useState(() => isTeacherUnlocked());
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  if (ok) return children;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-card dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <IBoardWordmark className="text-2xl" iClassName="italic text-indigo-600" />
          <ThemeToggle />
        </div>
        <h1 className="font-display mt-6 text-xl font-bold text-ink-900 dark:text-slate-100">{title}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Enter the teacher PIN to continue.</p>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (unlockTeacher(pin)) setOk(true);
              else setError('Wrong PIN');
            }
          }}
          className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-lg tracking-widest outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          placeholder="····"
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={() => {
            if (unlockTeacher(pin)) setOk(true);
            else setError('Wrong PIN');
          }}
          className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
