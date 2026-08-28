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
import AudienceQnaStudent from '../components/AudienceQnaStudent.jsx';
import RichTextEditor from '../components/RichTextEditor.jsx';
import RichTextDisplay from '../components/RichTextDisplay.jsx';
import StudentAnnotationController from '../components/StudentAnnotationController.jsx';
import AnnotatedStudentImage from '../components/AnnotatedStudentImage.jsx';
import { plainTextToRichHtml } from '../lib/richText.js';
import {
  clearStudentSession,
  forgetRecentStudentSession,
  readSavedStudentSession,
  recentStudentSessionForRoom,
  saveStudentSession,
} from '../lib/studentSession.js';

function feedbackInboxItem(item) {
  const feedbackId = Number(item?.feedbackId) || 0;
  const text = String(item?.text || '');
  const createdAt = String(item?.createdAt || '');
  return {
    id: feedbackId
      ? `feedback-${feedbackId}`
      : `feedback-${Number(item?.studentId) || 0}-${createdAt}-${text}`,
    text,
  };
}

function mergeFeedbackInbox(previous, incoming) {
  const existingIds = new Set(previous.map((item) => item.id));
  const fresh = [...incoming]
    .reverse()
    .map(feedbackInboxItem)
    .filter((item) => item.text && !existingIds.has(item.id));
  return fresh.length ? [...fresh, ...previous] : previous;
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
  const [draftHtml, setDraftHtml] = useState('');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [feedbackInbox, setFeedbackInbox] = useState([]);
  const [feedbackOpen, setFeedbackOpen] = useState(true);
  const [broadcastHistory, setBroadcastHistory] = useState([]);
  const [broadcastOpen, setBroadcastOpen] = useState(true);
  // null always means "show the latest" so a new teacher broadcast jumps forward automatically.
  const [broadcastCursor, setBroadcastCursor] = useState(null);
  const [exemplarFlash, setExemplarFlash] = useState(false);
  const [timesUp, setTimesUp] = useState(false);
  const [connBanner, setConnBanner] = useState(null); // 'lost' | 'online' | null
  const [imageBusy, setImageBusy] = useState(false);
  const [imageHint, setImageHint] = useState('');
  const [yearInput, setYearInput] = useState('');
  const [recentDismissedCode, setRecentDismissedCode] = useState('');

  const socket = useMemo(() => createSocket(), []);
  const pendingRef = useRef({ text: '', richTextHtml: '' });
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
        const saved = readSavedStudentSession();
        if (!saved) return;
        const { code, studentId } = saved;
        if (!code || !studentId) return;
        const savedCode = String(code).replace(/\D/g, '').slice(0, 4);
        if (codeFromLink && savedCode !== codeFromLink) {
          clearStudentSession();
          return;
        }
        const sidNum = Number(studentId);
        if (!sidNum) return;
        hydrateStudentIdRef.current = sidNum;
        socket.emit('student:rejoin', { code, studentId: sidNum }, (ack) => {
          if (!ack?.ok) return;
          saveStudentSession({
            code,
            studentId: ack.student?.id ?? sidNum,
            name: ack.student?.name || saved.name,
          });
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
  }, [codeFromLink, socket]);

  useEffect(() => {
    const onState = (payload) => {
      setRoom(payload.room || null);
      const sid = studentRef.current?.id ?? hydrateStudentIdRef.current;
      if (!sid || !payload.students) return;
      const me = payload.students.find((s) => s.id === sid);
      if (!me) return;
      hydrateStudentIdRef.current = null;
      setStudent(me);
      const typing = !!document.activeElement?.isContentEditable;
      const r = payload.room;
      const lim =
        r?.enforce_word_count && (r?.word_target ?? 0) > 0 ? Number(r.word_target) : 0;
      const raw = me.text || '';
      if (!typing) {
        const next = lim > 0 ? truncateToWordLimit(raw, lim) : raw;
        setDraft(next);
        setDraftHtml(
          next === raw && me.rich_text_html ? me.rich_text_html : plainTextToRichHtml(next)
        );
      }
    };
    const onLive = ({ student: s }) => {
      const sid = studentRef.current?.id ?? hydrateStudentIdRef.current;
      if (!sid || !s?.id || Number(s.id) !== Number(sid)) return;
      setStudent((prev) => ({ ...(prev || {}), ...s }));
    };
    const onBatch = ({ items }) => {
      const sid =
        studentRef.current?.id ??
        hydrateStudentIdRef.current ??
        Number(readSavedStudentSession()?.studentId);
      if (!sid || !Array.isArray(items)) return;
      const mine = items.filter((i) => Number(i?.studentId) === Number(sid));
      if (!mine.length) return;
      setFeedbackInbox((prev) => mergeFeedbackInbox(prev, mine));
      setFeedbackOpen(true);
    };
    const onBroadcast = (payload = {}) => {
      const serverHistory = Array.isArray(payload.history)
        ? payload.history.filter((entry) => Array.isArray(entry?.items)).slice(-10)
        : null;
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (serverHistory) {
        setBroadcastHistory(serverHistory);
      } else if (items.length) {
        // Compatibility with a server that only sends the newest broadcast.
        const entry = { items, at: Number(payload.at) || Date.now() };
        setBroadcastHistory((previous) => {
          const deduped = previous.filter((old) => Number(old?.at) !== Number(entry.at));
          return [...deduped, entry].slice(-10);
        });
      } else {
        setBroadcastHistory([]);
      }
      setBroadcastCursor(null);

      if (items.length || serverHistory?.length) {
        setBroadcastOpen(true);
        setExemplarFlash(true);
        if (exemplarFlashTimerRef.current) clearTimeout(exemplarFlashTimerRef.current);
        exemplarFlashTimerRef.current = setTimeout(() => setExemplarFlash(false), 4000);
      } else {
        setExemplarFlash(false);
      }
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

  // Recover the durable mailbox only after React has committed the student identity.
  // This closes the join/rejoin race even if the server replay arrived during startup.
  useEffect(() => {
    const sid = Number(student?.id);
    if (!joined || !sid) return;
    socket.emit('student:feedback-sync', {}, (ack) => {
      if (!ack?.ok || !Array.isArray(ack.items)) return;
      const mine = ack.items.filter((item) => Number(item?.studentId) === sid);
      if (mine.length) setFeedbackInbox((prev) => mergeFeedbackInbox(prev, mine));
    });
  }, [joined, student?.id, socket]);

  useEffect(() => {
    pendingRef.current = { text: draft, richTextHtml: draftHtml };
  }, [draft, draftHtml]);

  useEffect(() => {
    if (!joined || !student) return;
    const t = setInterval(() => {
      socket.emit('student:text', pendingRef.current, () => {});
    }, 2000);
    return () => clearInterval(t);
  }, [joined, student, socket]);

  useEffect(() => {
    if (!joined || !room) return;
    const wt = room.word_target ?? 0;
    if (!room.enforce_word_count || wt <= 0) return;
    setDraft((d) => {
      const next = truncateToWordLimit(d, wt);
      if (next !== d) setDraftHtml(plainTextToRichHtml(next));
      return next;
    });
  }, [joined, room?.enforce_word_count, room?.word_target]);

  useEffect(() => {
    let cancelled = false;
    try {
      const saved = readSavedStudentSession();
      if (!saved) return;
      const { code, studentId } = saved;
      if (!code || !studentId) return;
      const savedCode = String(code).replace(/\D/g, '').slice(0, 4);
      if (codeFromLink && savedCode !== codeFromLink) {
        hydrateStudentIdRef.current = null;
        clearStudentSession();
        return;
      }
      const sidNum = Number(studentId);
      if (!sidNum) return;
      hydrateStudentIdRef.current = sidNum;
      socket.emit('student:rejoin', { code, studentId }, (ack) => {
        if (cancelled) return;
        if (!ack?.ok) {
          hydrateStudentIdRef.current = null;
          try {
            clearStudentSession();
          } catch {
            /* ignore */
          }
          setError(ack?.error || 'Could not restore session — join again.');
          return;
        }
        hydrateStudentIdRef.current = ack.student?.id ?? sidNum;
        saveStudentSession({
          code,
          studentId: ack.student?.id ?? sidNum,
          name: ack.student?.name || saved.name,
        });
        setCodeInput(code);
        setStudent(ack.student);
        if (ack.room) setRoom(ack.room);
        const lim =
          ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
            ? Number(ack.room.word_target)
            : 0;
        const raw = ack.student.text || '';
        const next = lim > 0 ? truncateToWordLimit(raw, lim) : raw;
        setDraft(next);
        setDraftHtml(
          next === raw && ack.student?.rich_text_html
            ? ack.student.rich_text_html
            : plainTextToRichHtml(next)
        );
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
  }, [codeFromLink, socket]);

  const recentRoomSession = useMemo(() => {
    const code = String(codeInput || '').replace(/\D/g, '').slice(0, 4);
    if (code.length !== 4 || recentDismissedCode === code) return null;
    return recentStudentSessionForRoom(code);
  }, [codeInput, recentDismissedCode]);

  function continueRecentRoom() {
    const saved = recentRoomSession;
    if (!saved) return;
    setError('');
    hydrateStudentIdRef.current = saved.studentId;
    socket.emit('student:rejoin', { code: saved.code, studentId: saved.studentId }, (ack) => {
      if (!ack?.ok || !ack.student) {
        hydrateStudentIdRef.current = null;
        forgetRecentStudentSession(saved.code);
        setRecentDismissedCode(saved.code);
        setError('That previous student card is no longer available. Enter your name to join.');
        return;
      }

      hydrateStudentIdRef.current = ack.student.id;
      saveStudentSession({
        code: saved.code,
        studentId: ack.student.id,
        name: ack.student.name || saved.name,
      });
      setCodeInput(saved.code);
      setStudent(ack.student);
      if (ack.room) setRoom(ack.room);

      const limit =
        ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
          ? Number(ack.room.word_target)
          : 0;
      const raw = ack.student.text || '';
      const next = limit > 0 ? truncateToWordLimit(raw, limit) : raw;
      setDraft(next);
      setDraftHtml(
        next === raw && ack.student.rich_text_html
          ? ack.student.rich_text_html
          : plainTextToRichHtml(next)
      );
      const savedYear = String(ack.student.year_level || '').trim().toLowerCase();
      if (savedYear) setYearInput(savedYear);
      setJoined(true);
    });
  }

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
      saveStudentSession({ code: c, studentId: ack.student.id, name: ack.student?.name || n });
      setStudent(ack.student);
      if (ack.room) setRoom(ack.room);
      const lim =
        ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
          ? Number(ack.room.word_target)
          : 0;
      const raw = ack.student.text || '';
      const next = lim > 0 ? truncateToWordLimit(raw, lim) : raw;
      setDraft(next);
      setDraftHtml(
        next === raw && ack.student?.rich_text_html
          ? ack.student.rich_text_html
          : plainTextToRichHtml(next)
      );
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

  function changeRoom() {
    clearStudentSession();
    hydrateStudentIdRef.current = null;
    studentRef.current = null;
    try {
      socket.disconnect();
    } catch {
      /* Page navigation will still close the old room connection. */
    }
    window.location.assign('/student');
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

  const activeRoomDigits = String(room?.code || codeInput || '').replace(/\D/g, '').slice(0, 4);
  const activeRoomCode = activeRoomDigits ? activeRoomDigits.padStart(4, '0') : '';
  const wt = room?.word_target ?? 0;
  const enforce = !!room?.enforce_word_count;
  const wc = wordCount(draft);
  const frozen = !!room?.freeze_class;
  const progress = wt > 0 ? Math.min(100, Math.round((wc / wt) * 100)) : 0;
  const wordBand = useMemo(() => recommendedWordRange(wt), [wt]);
  const broadcastIndex = broadcastHistory.length
    ? Math.min(
        Math.max(broadcastCursor ?? broadcastHistory.length - 1, 0),
        broadcastHistory.length - 1
      )
    : -1;
  const currentBroadcast = broadcastIndex >= 0 ? broadcastHistory[broadcastIndex] : null;
  const broadcastExemplars = Array.isArray(currentBroadcast?.items) ? currentBroadcast.items : [];

  function renderProgressPanel() {
    if (wt > 0) {
      return (
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
      );
    }

    return (
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {enforce
          ? 'Your teacher must set a word target above 0 for the class limit to apply.'
          : 'Tip: keep your draft focused; very long pieces are slower for whole-class AI feedback.'}
      </p>
    );
  }

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
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Your writing appears on your teacher’s screen as you type. Live questions can also show up here.
            </p>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Room code from your teacher</label>
              <input
                value={codeInput}
                onChange={(e) => {
                  setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setRecentDismissedCode('');
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 font-mono text-lg outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                placeholder="0000"
                inputMode="numeric"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              {recentRoomSession ? (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/50">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
                    Returning student
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    You previously joined this room as
                  </p>
                  <p className="mt-1 font-display text-lg font-black text-slate-950 dark:text-white">
                    {recentRoomSession.name || 'your previous student card'}
                  </p>
                  <button
                    type="button"
                    onClick={continueRecentRoom}
                    className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-lift hover:bg-indigo-700"
                  >
                    Continue and restore my work
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRecentDismissedCode(recentRoomSession.code);
                      setNameInput('');
                    }}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    This isn&apos;t me
                  </button>
                </div>
              ) : (
                <>
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
                  <button
                    type="button"
                    onClick={join}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lift hover:bg-indigo-700"
                  >
                    Join and start writing
                  </button>
                </>
              )}
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
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 xl:max-w-7xl">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">{student?.name}</h1>
              {activeRoomCode && (
                <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-black text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                  Room {activeRoomCode}
                </span>
              )}
            </div>
          </div>
          <details className="group relative shrink-0">
            <summary
              className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-500 [&::-webkit-details-marker]:hidden"
              aria-label="Student tools"
              title="Student tools"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h10" />
                <path d="M18 7h2" />
                <circle cx="16" cy="7" r="2" />
                <path d="M4 17h2" />
                <path d="M10 17h10" />
                <circle cx="8" cy="17" r="2" />
              </svg>
            </summary>
            <div className="absolute right-0 top-full z-50 mt-2 w-64 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Year level</p>
                <StudentGradeSelect
                  value={student?.year_level || yearInput}
                  onChange={setMyYearLevel}
                  className="w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  <span>Pulse</span>
                  <PulseLink size="md" code={codeInput} studentId={student?.id} />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  <span>SupaCoach</span>
                  <SupaCoachLink size="md" />
                </div>
              </div>
              <ThemeToggle className="w-full justify-center" />
              <button
                type="button"
                onClick={changeRoom}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Change room
              </button>
            </div>
          </details>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 xl:grid xl:max-w-none xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)] xl:items-start xl:gap-6">
          <aside className="order-1 flex min-w-0 flex-col gap-4 xl:col-start-2 xl:row-start-1">
            <AudienceQnaStudent socket={socket} />
            <LiveResponseStudent socket={socket} />
            <div className="xl:hidden">{renderProgressPanel()}</div>
            {broadcastExemplars.length > 0 && (
              <section className={`rounded-2xl border border-violet-200 bg-violet-50/90 shadow-sm ${broadcastOpen ? 'p-4' : 'px-4 py-3'}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-sm font-semibold text-violet-900">Broadcast</h2>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {broadcastHistory.length > 1 && (
                      <div className="flex items-center gap-1 rounded-full border border-violet-200 bg-white/80 p-0.5 text-violet-800 shadow-sm dark:border-violet-800 dark:bg-slate-900 dark:text-violet-200">
                        <button
                          type="button"
                          onClick={() => setBroadcastCursor(Math.max(0, broadcastIndex - 1))}
                          disabled={broadcastIndex <= 0}
                          className="grid h-7 w-7 place-items-center rounded-full text-lg font-bold leading-none hover:bg-violet-100 disabled:cursor-default disabled:opacity-30 dark:hover:bg-violet-950"
                          aria-label="Previous broadcast"
                          title="Previous broadcast"
                        >
                          ‹
                        </button>
                        <span className="min-w-[3.8rem] text-center text-[11px] font-bold tabular-nums">
                          {broadcastIndex + 1} of {broadcastHistory.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = Math.min(broadcastHistory.length - 1, broadcastIndex + 1);
                            setBroadcastCursor(next === broadcastHistory.length - 1 ? null : next);
                          }}
                          disabled={broadcastIndex >= broadcastHistory.length - 1}
                          className="grid h-7 w-7 place-items-center rounded-full text-lg font-bold leading-none hover:bg-violet-100 disabled:cursor-default disabled:opacity-30 dark:hover:bg-violet-950"
                          aria-label="Next broadcast"
                          title="Next broadcast"
                        >
                          ›
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setBroadcastOpen((open) => !open)}
                      className="grid h-7 w-7 place-items-center rounded-full text-base font-black text-violet-700 hover:bg-violet-100 dark:text-violet-200 dark:hover:bg-violet-950"
                      aria-expanded={broadcastOpen}
                      aria-label={broadcastOpen ? 'Collapse Broadcast' : 'Expand Broadcast'}
                      title={broadcastOpen ? 'Collapse Broadcast' : 'Expand Broadcast'}
                    >
                      {broadcastOpen ? '▴' : '▾'}
                    </button>
                  </div>
                </div>
                {broadcastOpen && (
                  <>
                    <p className="mt-1 text-xs leading-relaxed text-violet-800 dark:text-violet-300">
                      Your teacher shared anonymised exemplar drafts for the class. Names are not shown.
                    </p>
                    {Number.isFinite(Number(currentBroadcast?.at)) && (
                      <p className="mt-1 text-[11px] font-medium text-violet-600/80 dark:text-violet-300/80">
                        {new Date(Number(currentBroadcast.at)).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
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
                            <RichTextDisplay
                              html={ex.rich_text_html}
                              text={ex.text}
                              className="mt-2 max-h-48 overflow-auto text-slate-700 dark:text-slate-300 scrollbar-thin"
                            />
                          ) : !ex.image_url ? (
                            <p className="mt-2 text-slate-500">—</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
            {feedbackInbox.length > 0 && (
              <section
                role="status"
                aria-live="polite"
                className={`rounded-2xl border-2 border-indigo-300 bg-indigo-50/90 shadow-sm dark:border-indigo-700 dark:bg-indigo-950/60 ${feedbackOpen ? 'p-4' : 'px-4 py-3'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                    Teacher feedback
                  </h2>
                  <button
                    type="button"
                    onClick={() => setFeedbackOpen((open) => !open)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-base font-black text-indigo-700 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-950"
                    aria-expanded={feedbackOpen}
                    aria-label={feedbackOpen ? 'Collapse teacher feedback' : 'Expand teacher feedback'}
                    title={feedbackOpen ? 'Collapse teacher feedback' : 'Expand teacher feedback'}
                  >
                    {feedbackOpen ? '▴' : '▾'}
                  </button>
                </div>
                {feedbackOpen && (
                  <ul className="mt-2 space-y-2">
                    {feedbackInbox.map((f) => (
                      <li
                        key={f.id}
                        className="rounded-lg bg-white p-3 text-sm text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-300"
                      >
                        {f.text}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </aside>

          <section className="order-2 flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-1">
            <div className="hidden xl:block">{renderProgressPanel()}</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tip: paste a screenshot into the box (Ctrl+V / Cmd+V) to add an image to your board card.
            </p>
            {student?.image_url && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-900">
                {student.teacher_markup_url && (
                  <p className="mb-2 inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-black text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                    Teacher correction
                  </p>
                )}
                <AnnotatedStudentImage
                  imageUrl={student.image_url}
                  markupUrl={student.teacher_markup_url}
                  alt="Your uploaded image"
                  imageClassName="max-h-56 w-full object-contain"
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
            <StudentAnnotationController socket={socket} studentId={student?.id} />
            <RichTextEditor
              text={draft}
              html={draftHtml}
              onChange={({ text, html }) => {
                setDraft(text);
                setDraftHtml(html);
              }}
              onPaste={onDraftPaste}
              disabled={frozen}
              maxWords={enforce && wt > 0 ? wt : 0}
              placeholder="Write here… or paste an image (Ctrl+V / Cmd+V)"
            />
          </section>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
