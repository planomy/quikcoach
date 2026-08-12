import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createSocket } from '../lib/socket.js';
import { wordCount, recommendedWordRange, truncateToWordLimit } from '../lib/text.js';
import { fileToCompressedJpegDataUrl } from '../lib/image.js';
import AppFooter from '../components/AppFooter.jsx';
import IBoardWordmark from '../components/IBoardWordmark.jsx';
import StudentGradeSelect from '../components/StudentGradeSelect.jsx';
import SupaCoachLink from '../components/SupaCoachLink.jsx';
import PulseLink from '../components/PulseLink.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import LiveResponseStudent from '../components/LiveResponseStudent.jsx';

const SESSION_KEY = 'quik-coach-student';

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `fb-${Date.now()}`;
}

export default function StudentView() {
  const [searchParams] = useSearchParams();
  const codeFromLink = String(searchParams.get('code') || '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const [codeInput, setCodeInput] = useState(codeFromLink);
  const [nameInput, setNameInput] = useState('');
  const [student, setStudent] = useState(null);
  const [room, setRoom] = useState(null);
  const [draft, setDraft] = useState('');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [feedbackInbox, setFeedbackInbox] = useState([]);
  const [broadcastExemplars, setBroadcastExemplars] = useState([]);
  const [exemplarFlash, setExemplarFlash] = useState(false);
  const [timesUp, setTimesUp] = useState(false);
  const [connBanner, setConnBanner] = useState(null); // 'lost' | 'online' | null
  const [imageBusy, setImageBusy] = useState(false);
  const [imageHint, setImageHint] = useState('');
  const [yearInput, setYearInput] = useState('');

  const socket = useMemo(() => createSocket(), []);
  const pendingRef = useRef('');
  const studentRef = useRef(null);
  /** Until React commits `student`, `room:state` may arrive first; match payload by this id. */
  const hydrateStudentIdRef = useRef(null);
  const wasDisconnectedRef = useRef(false);
  const exemplarFlashTimerRef = useRef(null);
  const onlineBannerTimerRef = useRef(null);

  useEffect(() => {
    studentRef.current = student;
  }, [student]);

  useEffect(() => {
    socket.connect();
    return () => socket.disconnect();
  }, [socket]);

  // Connection status banner (lost / brief back-online)
  useEffect(() => {
    const onConnect = () => {
      if (!wasDisconnectedRef.current) return;
      wasDisconnectedRef.current = false;
      setConnBanner('online');
      if (onlineBannerTimerRef.current) clearTimeout(onlineBannerTimerRef.current);
      onlineBannerTimerRef.current = setTimeout(() => setConnBanner(null), 2500);
    };
    const onDisconnect = () => {
      wasDisconnectedRef.current = true;
      if (onlineBannerTimerRef.current) clearTimeout(onlineBannerTimerRef.current);
      setConnBanner('lost');
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      if (onlineBannerTimerRef.current) clearTimeout(onlineBannerTimerRef.current);
    };
  }, [socket]);

  // After Wi‑Fi blips, rejoin the room so broadcasts / live sync still work
  useEffect(() => {
    const onConnect = () => {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const { code, studentId } = JSON.parse(raw);
        if (!code || !studentId) return;
        const sidNum = Number(studentId);
        if (!sidNum) return;
        hydrateStudentIdRef.current = sidNum;
        socket.emit('student:rejoin', { code, studentId: sidNum }, (ack) => {
          if (!ack?.ok) return;
          if (ack.student) setStudent(ack.student);
          if (ack.room) setRoom(ack.room);
          setJoined(true);
        });
      } catch {
        /* ignore */
      }
    };
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
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
    const onLive = ({ student: s }) => {
      const sid = studentRef.current?.id ?? hydrateStudentIdRef.current;
      if (!sid || !s?.id || Number(s.id) !== Number(sid)) return;
      setStudent((prev) => ({ ...(prev || {}), ...s }));
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
      setExemplarFlash(true);
      if (exemplarFlashTimerRef.current) clearTimeout(exemplarFlashTimerRef.current);
      exemplarFlashTimerRef.current = setTimeout(() => setExemplarFlash(false), 4000);
    };
    const onTimesUp = () => setTimesUp(true);
    socket.on('room:state', onState);
    socket.on('student:live', onLive);
    socket.on('feedback:batch', onBatch);
    socket.on('broadcast:exemplars', onBroadcast);
    socket.on('timer:times-up', onTimesUp);
    return () => {
      socket.off('room:state', onState);
      socket.off('student:live', onLive);
      socket.off('feedback:batch', onBatch);
      socket.off('broadcast:exemplars', onBroadcast);
      socket.off('timer:times-up', onTimesUp);
      if (exemplarFlashTimerRef.current) clearTimeout(exemplarFlashTimerRef.current);
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
        const yl = String(ack.student?.year_level || '').trim().toLowerCase();
        if (yl) setYearInput(yl);
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
      const fromServer = String(ack.student?.year_level || '').trim().toLowerCase();
      const chosen = String(yearInput || '').trim().toLowerCase();
      if (chosen) {
        setYearInput(chosen);
        socket.emit('student:year', { year_level: chosen }, (yAck) => {
          if (yAck?.ok && yAck.student) setStudent(yAck.student);
        });
      } else if (fromServer) {
        setYearInput(fromServer);
      }
    });
  }

  async function onDraftPaste(e) {
    if (frozen) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      setImageBusy(true);
      setImageHint('');
      try {
        const dataUrl = await fileToCompressedJpegDataUrl(file);
        socket.emit(
          'student:image',
          { imageBase64: dataUrl, mimeType: 'image/jpeg' },
          (ack) => {
            setImageBusy(false);
            if (!ack?.ok) {
              setError(ack?.error || 'Could not save image');
              return;
            }
            if (ack.student) setStudent(ack.student);
            setImageHint('Image added to your card');
            setTimeout(() => setImageHint(''), 2500);
          }
        );
      } catch {
        setImageBusy(false);
        setError('Could not read that image');
      }
      return;
    }
  }

  function setMyYearLevel(year_level) {
    const y = String(year_level || '').trim().toLowerCase();
    setYearInput(y);
    setStudent((s) => (s ? { ...s, year_level: y } : s));
    if (!joined) return;
    socket.emit('student:year', { year_level: y }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not save year level');
        return;
      }
      if (ack.student) setStudent(ack.student);
    });
  }

  function clearMyImage() {
    if (frozen) return;
    socket.emit('student:image-clear', {}, (ack) => {
      if (!ack?.ok) {
        setError('Could not remove image');
        return;
      }
      if (ack.student) setStudent(ack.student);
      else setStudent((s) => (s ? { ...s, image_url: null } : s));
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
      <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-1 flex-col px-4 py-10">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <IBoardWordmark className="text-2xl" iClassName="italic text-indigo-600" />
              <ThemeToggle />
            </div>
            <h1 className="font-display mt-6 text-xl font-bold text-ink-900 dark:text-slate-100">Join your class</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Enter the room code from your teacher.</p>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Room code</label>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 font-mono text-lg outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                placeholder="0000"
                inputMode="numeric"
              />
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Your name</label>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                placeholder="Name as shown to teacher"
              />
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Your year</label>
              <StudentGradeSelect
                value={yearInput}
                onChange={setYearInput}
                className="w-full !rounded-xl !px-3 !py-2.5 !text-sm"
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
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-indigo-50/40 dark:from-slate-950 dark:to-indigo-950/40">
      {timesUp && (
        <button
          type="button"
          onClick={() => setTimesUp(false)}
          className="fixed inset-0 z-[60] flex cursor-pointer items-center justify-center bg-red-950/50 px-6 backdrop-blur-[1px]"
          aria-live="assertive"
        >
          <div className="animate-pulse rounded-3xl border-4 border-red-400 bg-red-600 px-10 py-8 text-center shadow-2xl sm:px-14 sm:py-10">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-100">Timer</p>
            <p className="mt-2 font-display text-4xl font-black uppercase tracking-wide text-white sm:text-6xl">
              Time&apos;s up!
            </p>
            <p className="mt-3 text-sm font-semibold text-red-100">Tap to dismiss</p>
          </div>
        </button>
      )}
      {connBanner === 'lost' && (
        <div
          role="status"
          className="sticky top-0 z-40 border-b border-amber-300 bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-amber-950 shadow-sm"
        >
          Connection lost — reconnecting…
        </div>
      )}
      {connBanner === 'online' && (
        <div
          role="status"
          className="sticky top-0 z-40 border-b border-emerald-300 bg-emerald-500 px-4 py-2.5 text-center text-sm font-semibold text-emerald-950 shadow-sm"
        >
          Back online
        </div>
      )}
      {exemplarFlash && (
        <div
          role="status"
          className="sticky top-0 z-40 border-b border-violet-400 bg-violet-600 px-4 py-3 text-center text-base font-bold text-white shadow-md"
        >
          Your teacher shared exemplars
        </div>
      )}
      <header className="border-b border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/90 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Writing</p>
            <h1 className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">{student?.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StudentGradeSelect
              value={student?.year_level || yearInput}
              onChange={setMyYearLevel}
            />
            <PulseLink size="md" code={codeInput} />
            <SupaCoachLink size="md" />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
        <LiveResponseStudent socket={socket} />
        {wt > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
              <span>Progress</span>
              <span>
                {wc} / {wt} words
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            {wordBand && !enforce && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Suggested range for this task: about <span className="font-medium text-slate-600 dark:text-slate-400">{wordBand.low}–</span>
                <span className="font-medium text-slate-600 dark:text-slate-400">{wordBand.high} words</span> (guide only — you won&apos;t be
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
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {enforce
              ? 'Your teacher must set a word target above 0 for the class limit to apply.'
              : 'Tip: keep your draft focused; very long pieces are slower for whole-class AI feedback.'}
          </p>
        )}
        {broadcastExemplars.length > 0 && (
          <section className="rounded-2xl border border-violet-200 bg-violet-50/90 p-4 shadow-sm">
            <h2 className="font-display text-sm font-semibold text-violet-900">Broadcast</h2>
            <p className="mt-1 text-xs leading-relaxed text-violet-800 dark:text-violet-300">
              Your teacher shared anonymised exemplar drafts for the class. Names are not shown.
            </p>
            <div className="mt-3 space-y-3">
              {broadcastExemplars.map((ex, i) => (
                <div
                  key={`${ex.label}-${i}`}
                  className="rounded-xl border border-violet-100 bg-white dark:bg-slate-900 p-3 text-sm shadow-sm"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-violet-700">{ex.label}</p>
                  {ex.image_url && (
                    <img
                      src={ex.image_url}
                      alt=""
                      className="mt-2 max-h-48 w-full object-contain"
                    />
                  )}
                  {ex.text?.trim() ? (
                    <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300 scrollbar-thin">
                      {ex.text}
                    </p>
                  ) : !ex.image_url ? (
                    <p className="mt-2 text-slate-500">—</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Tip: paste a screenshot into the box (Ctrl+V / Cmd+V) to add an image to your board card.
        </p>
        {student?.image_url && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-900">
            <img
              src={student.image_url}
              alt="Your uploaded image"
              className="mx-auto max-h-56 w-full object-contain"
            />
            <button
              type="button"
              disabled={frozen || imageBusy}
              onClick={clearMyImage}
              className="mt-2 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              Remove image
            </button>
          </div>
        )}
        {(imageBusy || imageHint) && (
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
            {imageBusy ? 'Uploading image…' : imageHint}
          </p>
        )}
        {error && joined && <p className="text-sm text-red-600">{error}</p>}
        <textarea
          value={draft}
          onChange={(e) => {
            let v = e.target.value;
            if (enforce && wt > 0) v = truncateToWordLimit(v, wt);
            setDraft(v);
          }}
          onPaste={onDraftPaste}
          readOnly={frozen}
          placeholder={
            frozen
              ? 'Class is frozen by your teacher.'
              : 'Write here… or paste an image (Ctrl+V / Cmd+V)'
          }
          className="min-h-[280px] flex-1 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-card outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 read-only:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:read-only:bg-slate-800"
        />
        {feedbackInbox.length > 0 && (
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 dark:border-indigo-800 dark:bg-indigo-950/50">
            <h2 className="font-display text-sm font-semibold text-indigo-900 dark:text-indigo-200">Feedback</h2>
            <ul className="mt-2 space-y-2">
              {feedbackInbox.map((f) => (
                <li key={f.id} className="rounded-lg bg-white p-3 text-sm text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-300">
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
