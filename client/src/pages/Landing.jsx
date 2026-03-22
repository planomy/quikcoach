import { Link } from 'react-router-dom';
import AppFooter from '../components/AppFooter.jsx';
import QuikCoachWordmark from '../components/QuikCoachWordmark.jsx';

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-indigo-50/50">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <QuikCoachWordmark className="text-4xl sm:text-5xl" quikClassName="italic text-indigo-600" />
        <p className="mt-4 max-w-md text-slate-600">
          Live classroom writing — teacher dashboard and student focus mode.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/teacher"
            className="rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white shadow-lift hover:bg-indigo-700"
          >
            Teacher
          </Link>
          <Link
            to="/student"
            className="rounded-xl border border-slate-200 bg-white px-8 py-3 text-sm font-semibold text-slate-800 shadow-card hover:bg-slate-50"
          >
            Student
          </Link>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
