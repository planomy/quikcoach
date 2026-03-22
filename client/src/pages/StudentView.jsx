import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createSocket } from '../lib/socket.js';
import { wordCount, recommendedWordRange, truncateToWordLimit } from '../lib/text.js';
import AppFooter from '../components/AppFooter.jsx';
import QuikCoachWordmark from '../components/QuikCoachWordmark.jsx';

const SESSION_KEY = 'quik-coach-student';

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `fb-${Date.now()}`;
}

export default function StudentView() {
  const [codeInput, setCodeInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [student, setStudent] = useState(null);
  const [room, setRoom] = useState(null);
  const [draft, setDraft] = useState('');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [feedbackInbox, setFeedbackInbox] = useState([]);
  const [broadcastExemplars, setBroadcastExemplars] = useState([]);

  const socket = useMemo(() => createSocket(), []);
  const pendingRef = useRef('');
  const studentRef = useRef(null);
  /** Until React commits `student`, `room:state` may arrive first; match payload by this id. */
  const hydrateStudentIdRef = useRef(null);

  useEffect(() => {
    studentRef.current = student;
  }, [student]);

  useEffect(() => {
    socket.connect();
    return () => socket.disconnect();
  }, [socket]);

  useEffect(() => {
    const onState = (payload) => {
      setRoom(payload.room || null);
      const sid = studentRef.current?.id ?? hydrateStudentIdRef.current;
      if (!sid || !payload.students) return;
      const me = payload.students.find((s) => s.id === sid);
      if (!me) return;
      hydrateStudentIdRef.current = null;
      setStudent(me);
      const typing = document.activeElement?.tagName === 'TEXTAREA';
      const r = payload.room;
      const lim =
        r?.enforce_word_count && (r?.word_target ?? 0) > 0 ? Number(r.word_target) : 0;
      const raw = me.text || '';
      if (!typing) setDraft(lim > 0 ? truncateToWordLimit(raw, lim) : raw);
    };
    const onBatch = ({ items }) => {
      const sid = studentRef.current?.id;
      if (!sid || !Array.isArray(items)) return;
      const mine = items.filter((i) => i.studentId === sid);
      if (!mine.length) return;
      setFeedbackInbox((prev) => [
        ...mine.map((i) => ({ id: newId(), text: i.text, at: Date.now() })),
        ...prev,
      ]);
    };
    const onBroadcast = ({ items }) => {
      setBroadcastExemplars(Array.isArray(items) ? items : []);
    };
    socket.on('room:state', onState);
    socket.on('feedback:batch', onBatch);
    socket.on('broadcast:exemplars', onBroadcast);
    return () => {
      socket.off('room:state', onState);
      socket.off('feedback:batch', onBatch);
      socket.off('broadcast:exemplars', onBroadcast);
    };
  }, [socket]);

  useEffect(() => {
    pendingRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!joined || !student) return;
    const t = setInterval(() => {
      socket.emit('student:text', { text: pendingRef.current }, () => {});
    }, 2000);
    return () => clearInterval(t);
  }, [joined, student, socket]);

  useEffect(() => {
    if (!joined || !room) return;
    const wt = room.word_target ?? 0;
    if (!room.enforce_word_count || wt <= 0) return;
    setDraft((d) => truncateToWordLimit(d, wt));
  }, [joined, room?.enforce_word_count, room?.word_target]);

  useEffect(() => {
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const { code, studentId } = JSON.parse(raw);
      if (!code || !studentId) return;
      const sidNum = Number(studentId);
      if (!sidNum) return;
      hydrateStudentIdRef.current = sidNum;
      socket.emit('student:rejoin', { code, studentId }, (ack) => {
        if (cancelled) return;
        if (!ack?.ok) {
          hydrateStudentIdRef.current = null;
          try {
            sessionStorage.removeItem(SESSION_KEY);
          } catch {
            /* ignore */
          }
          setError(ack?.error || 'Could not restore session — join again.');
          return;
        }
        hydrateStudentIdRef.current = ack.student?.id ?? sidNum;
        setCodeInput(code);
        setStudent(ack.student);
        if (ack.room) setRoom(ack.room);
        const lim =
          ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
            ? Number(ack.room.word_target)
            : 0;
        const raw = ack.student.text || '';
        setDraft(lim > 0 ? truncateToWordLimit(raw, lim) : raw);
        setJoined(true);
      });
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, [socket]);

  function join() {
    setError('');
    const c = codeInput.replace(/\D/g, '').slice(0, 4).padStart(4, '0');
    const n = nameInput.trim();
    if (c.length !== 4 || !n) {
      setError('Enter 4-digit code and your name.');
      return;
    }
    socket.emit('student:join', { code: c, name: n }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not join');
        return;
      }
      hydrateStudentIdRef.current = ack.student?.id ?? null;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: c, studentId: ack.student.id }));
      setStudent(ack.student);
      if (ack.room) setRoom(ack.room);
      const lim =
        ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
          ? Number(ack.room.word_target)
          : 0;
      const raw = ack.student.text || '';
      setDraft(lim > 0 ? truncateToWordLimit(raw, lim) : raw);
      setJoined(true);
    });
  }

  const wt = room?.word_target ?? 0;
  const enforce = !!room?.enforce_word_count;
  const wc = wordCount(draft);
  const frozen = !!room?.freeze_class;
  const progress = wt > 0 ? Math.min(100, Math.round((wc / wt) * 100)) : 0;
  const wordBand = useMemo(() => recommendedWordRange(wt), [wt]);

  if (!joined) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <div className="flex flex-1 flex-col px-4 py-10">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-card">
            <QuikCoachWordmark className="text-2xl" quikClassName="italic text-indigo-600" />
            <Link to="/" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">
              ← Home
            </Link>
            <h1 className="font-display mt-3 text-xl font-bold text-ink-900">Student</h1>
            <p className="mt-2 text-sm text-slate-600">Join your class with the room code from your teacher.</p>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Room code</label>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-lg outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
                placeholder="0000"
                inputMode="numeric"
              />
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Your name</label>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
                placeholder="Name as shown to teacher"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={join}
                className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lift hover:bg-indigo-700"
              >
                Join room
              </button>
            </div>
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-indigo-50/40">
      <header className="border-b border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Writing</p>
            <h1 className="font-display text-lg font-bold text-ink-900">{student?.name}</h1>
          </div>
          <Link to="/" className="text-sm font-medium text-slate-500 hover:text-indigo-600">
            Home
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
        {wt > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600">
              <span>Progress</span>
              <span>
                {wc} / {wt} words
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            {wordBand && !enforce && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Suggested range for this task: about <span className="font-medium text-slate-600">{wordBand.low}–</span>
                <span className="font-medium text-slate-600">{wordBand.high} words</span> (guide only — you won&apos;t be
                cut off).
              </p>
            )}
            {enforce && (
              <p className="mt-2 text-xs font-medium leading-relaxed text-amber-800">
                Hard limit: only the first {wt} words are saved. Extra words are dropped when you type or when your draft
                syncs.
              </p>
            )}
          </div>
        )}
        {wt <= 0 && (
          <p className="text-xs leading-relaxed text-slate-500">
            {enforce
              ? 'Your teacher must set a word target above 0 for the class limit to apply.'
              : 'Tip: keep your draft focused; very long pieces are slower for whole-class AI feedback.'}
          </p>
        )}
        {broadcastExemplars.length > 0 && (
          <section className="rounded-2xl border border-violet-200 bg-violet-50/90 p-4 shadow-sm">
            <h2 className="font-display text-sm font-semibold text-violet-900">Broadcast</h2>
            <p className="mt-1 text-xs leading-relaxed text-violet-800">
              Your teacher shared anonymised exemplar drafts for the class. Names are not shown.
            </p>
            <div className="mt-3 space-y-3">
              {broadcastExemplars.map((ex, i) => (
                <div
                  key={`${ex.label}-${i}`}
                  className="rounded-xl border border-violet-100 bg-white p-3 text-sm shadow-sm"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-violet-700">{ex.label}</p>
                  <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-slate-700 scrollbar-thin">
                    {ex.text || '—'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        <textarea
          value={draft}
          onChange={(e) => {
            let v = e.target.value;
            if (enforce && wt > 0) v = truncateToWordLimit(v, wt);
            setDraft(v);
          }}
          readOnly={frozen}
          placeholder={frozen ? 'Class is frozen by your teacher.' : 'Write here…'}
          className="min-h-[280px] flex-1 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-card outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 read-only:bg-slate-100"
        />
        {feedbackInbox.length > 0 && (
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4">
            <h2 className="font-display text-sm font-semibold text-indigo-900">Feedback</h2>
            <ul className="mt-2 space-y-2">
              {feedbackInbox.map((f) => (
                <li key={f.id} className="rounded-lg bg-white p-3 text-sm text-slate-700 shadow-sm">
                  {f.text}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
