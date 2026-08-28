import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import AppFooter from '../components/AppFooter.jsx';
import IBoardWordmark from '../components/IBoardWordmark.jsx';
import LiveResponseStudent from '../components/LiveResponseStudent.jsx';
import AudienceQnaStudent from '../components/AudienceQnaStudent.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { createSocket } from '../lib/socket.js';
import {
  clearStudentSession,
  readSavedStudentSession,
  saveStudentSession,
} from '../lib/studentSession.js';

const HANDOFF_PREFIX = 'iboard-pulse-handoff:';
const HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;
const FLOAT_COLLAPSED_KEY = 'iboard-pulse-collapsed';
const FLOAT_EXPANDED_SIZE = { width: 300, height: 420 };
const FLOAT_COLLAPSED_SIZE = { width: 300, height: 116 };

function cleanCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function prepareFloatingDocument(targetWindow) {
  const targetDocument = targetWindow.document;
  targetDocument.head.innerHTML = '';
  targetDocument.body.innerHTML = '';
  const meta = targetDocument.createElement('meta');
  meta.name = 'viewport';
  meta.content = 'width=device-width, initial-scale=1';
  targetDocument.head.appendChild(meta);
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    targetDocument.head.appendChild(node.cloneNode(true));
  });
  targetDocument.title = 'iBOARD Pulse';
  targetDocument.documentElement.className = document.documentElement.className;
  targetDocument.documentElement.style.colorScheme = document.documentElement.style.colorScheme;
  targetDocument.documentElement.style.height = '100%';
  targetDocument.body.className = document.body.className;
  targetDocument.body.style.cssText = 'margin:0;min-height:100%;overflow:auto;';
  const root = targetDocument.createElement('div');
  root.className = 'min-h-full bg-gradient-to-b from-indigo-50 to-white p-2 dark:from-slate-950 dark:to-indigo-950';
  targetDocument.body.appendChild(root);
  return root;
}

export default function PulseStudent() {
  const [searchParams] = useSearchParams();
  const codeFromLink = cleanCode(searchParams.get('code'));
  const handoffFromLink = String(searchParams.get('handoff') || '');
  const [codeInput, setCodeInput] = useState(codeFromLink);
  const [nameInput, setNameInput] = useState('');
  const [joined, setJoined] = useState(false);
  const [student, setStudent] = useState(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [floatTarget, setFloatTarget] = useState(null);
  const [floatKind, setFloatKind] = useState('');
  const [floatCollapsed, setFloatCollapsed] = useState(() => {
    try {
      return localStorage.getItem(FLOAT_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const socket = useMemo(() => createSocket(), []);
  const sessionRef = useRef(null);
  const floatingWindowRef = useRef(null);

  useEffect(() => {
    const rejoin = () => {
      setConnected(true);
      const saved = sessionRef.current;
      if (!saved?.code || !saved?.studentId) return;
      socket.emit('student:rejoin', saved, (ack) => {
        if (!ack?.ok) return;
        setStudent(ack.student || null);
        setJoined(true);
      });
    };
    const disconnect = () => setConnected(false);
    socket.on('connect', rejoin);
    socket.on('disconnect', disconnect);
    socket.connect();
    return () => {
      socket.off('connect', rejoin);
      socket.off('disconnect', disconnect);
      socket.disconnect();
      try {
        floatingWindowRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [socket]);

  useEffect(() => {
    try {
      let parsed = null;
      if (handoffFromLink) {
        const handoffKey = `${HANDOFF_PREFIX}${handoffFromLink}`;
        const rawHandoff = localStorage.getItem(handoffKey);
        localStorage.removeItem(handoffKey);
        const handoff = JSON.parse(rawHandoff || 'null');
        const age = Date.now() - Number(handoff?.createdAt || 0);
        if (age >= 0 && age <= HANDOFF_MAX_AGE_MS) parsed = handoff;
      }
      if (!parsed) parsed = readSavedStudentSession();
      if (!parsed?.code || !parsed?.studentId) return;
      const saved = { code: cleanCode(parsed.code), studentId: Number(parsed.studentId) };
      if (codeFromLink && saved.code !== codeFromLink) return;
      sessionRef.current = saved;
      setCodeInput(saved.code);
      socket.emit('student:rejoin', saved, (ack) => {
        if (!ack?.ok) {
          sessionRef.current = null;
          clearStudentSession();
          setError('Your iBOARD session could not be reopened. Please join Pulse below.');
          return;
        }
        saveStudentSession({ ...saved, name: ack.student?.name || saved.name });
        setStudent(ack.student || null);
        setJoined(true);
      });
    } catch {
      /* ignore */
    }
  }, [codeFromLink, handoffFromLink, socket]);

  function join() {
    setError('');
    const code = cleanCode(codeInput);
    const name = nameInput.trim();
    if (code.length !== 4 || !name) {
      setError('Enter the four-digit room code and your name.');
      return;
    }
    socket.emit('student:join', { code, name }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not join Pulse.');
        return;
      }
      const saved = { code, studentId: Number(ack.student.id), name: ack.student?.name || name };
      sessionRef.current = saved;
      saveStudentSession(saved);
      setStudent(ack.student);
      setJoined(true);
    });
  }

  async function openFloatingPanel() {
    setError('');
    let targetWindow = null;
    let kind = '';
    const initialSize = floatCollapsed ? FLOAT_COLLAPSED_SIZE : FLOAT_EXPANDED_SIZE;
    try {
      if ('documentPictureInPicture' in window) {
        targetWindow = await window.documentPictureInPicture.requestWindow(initialSize);
        kind = 'always-on-top';
      } else {
        targetWindow = window.open('', 'iboard-pulse-student', `popup=yes,width=${initialSize.width},height=${initialSize.height},resizable=yes,scrollbars=yes`);
        kind = 'mini-window';
      }
      if (!targetWindow) {
        setError('The floating panel was blocked. Allow pop-ups, then try again.');
        return;
      }
      const root = prepareFloatingDocument(targetWindow);
      floatingWindowRef.current = targetWindow;
      setFloatTarget(root);
      setFloatKind(kind);
      targetWindow.addEventListener('pagehide', () => {
        floatingWindowRef.current = null;
        setFloatTarget(null);
        setFloatKind('');
      }, { once: true });
    } catch {
      setError('This browser could not open the floating panel. Keep this page beside OneNote instead.');
    }
  }

  function resizeFloatingPanel(collapsed) {
    const targetWindow = floatingWindowRef.current;
    if (!targetWindow) return;
    const size = collapsed ? FLOAT_COLLAPSED_SIZE : FLOAT_EXPANDED_SIZE;
    try {
      targetWindow.resizeTo(size.width, size.height);
    } catch {
      /* Some popup managers keep their own minimum size. The compact view still applies. */
    }
    setFloatCollapsed(collapsed);
    try {
      localStorage.setItem(FLOAT_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const pulsePanel = (
    <div className="space-y-2">
      <AudienceQnaStudent
        socket={socket}
        compact={!!floatTarget}
        collapsed={!!floatTarget && floatCollapsed}
        onRequestExpand={() => resizeFloatingPanel(false)}
      />
      <LiveResponseStudent
        socket={socket}
        standalone
        compact={!!floatTarget}
        collapsed={!!floatTarget && floatCollapsed}
        onCollapse={() => resizeFloatingPanel(true)}
        onExpand={() => resizeFloatingPanel(false)}
      />
    </div>
  );

  if (!joined) {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-indigo-50 to-white dark:from-slate-950 dark:to-indigo-950">
        <main className="grid flex-1 place-items-center px-4 py-10">
          <section className="w-full max-w-md rounded-3xl border border-indigo-200 bg-white p-7 shadow-card dark:border-indigo-900 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div><IBoardWordmark className="text-2xl" iClassName="italic text-indigo-600" /><p className="mt-1 text-xs font-black uppercase tracking-[0.22em] text-violet-600">Pulse</p></div>
              <ThemeToggle />
            </div>
            <h1 className="mt-7 font-display text-2xl font-black text-slate-950 dark:text-white">Join live questions</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your teacher will send questions here. You can keep OneNote or Teams open at the same time.</p>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm font-medium text-slate-600 dark:text-slate-400">
              <li>Enter the 4-digit code they gave you</li>
              <li>Type your name exactly as they know it</li>
              <li>Wait — the next question appears automatically</li>
            </ol>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Room code from your teacher</label>
              <input value={codeInput} onChange={(event) => setCodeInput(cleanCode(event.target.value))} inputMode="numeric" maxLength={4} placeholder="0000" className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 font-mono text-xl tracking-widest outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Your name</label>
              <input value={nameInput} onChange={(event) => setNameInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') join(); }} placeholder="Name as shown to your teacher" className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
              <button type="button" onClick={join} className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-black text-white shadow-lift hover:bg-indigo-700">Join and wait for a question</button>
            </div>
          </section>
        </main>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-indigo-50 to-white dark:from-slate-950 dark:to-indigo-950">
      <header className="border-b border-indigo-100 bg-white/90 px-4 py-3 dark:border-indigo-900 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">iBOARD Pulse</p><p className="font-display font-black text-slate-950 dark:text-white">{student?.name} · Room {sessionRef.current?.code}</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6">
        <section className="rounded-3xl bg-gradient-to-br from-indigo-700 to-violet-700 p-5 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-200">You’re in · optional next step</p>
          <h1 className="mt-2 font-display text-2xl font-black">Need OneNote open too?</h1>
          <p className="mt-2 text-sm font-medium text-indigo-100">Float a small answer panel, then go back to your work. Questions still appear here if you skip this. Collapse it to a pill when you need more space.</p>
          <button type="button" onClick={openFloatingPanel} disabled={!!floatTarget} className="mt-4 w-full rounded-2xl bg-white px-5 py-3 font-black text-indigo-800 shadow-md hover:bg-indigo-50 disabled:opacity-60">{floatTarget ? 'Floating panel is open ✓' : 'Float answer panel (optional)'}</button>
          {floatKind === 'mini-window' && <p className="mt-2 text-xs font-bold text-amber-200">Mini-window open — use Collapse when you need more room for your work.</p>}
          {floatKind === 'always-on-top' && <p className="mt-2 text-xs font-bold text-emerald-200">Always-on-top panel active. Use Collapse to turn it into a small alert pill.</p>}
          {error && <p className="mt-2 text-sm font-bold text-amber-200">{error}</p>}
        </section>
        {!floatTarget && pulsePanel}
        {floatTarget && <section className="rounded-3xl border-2 border-dashed border-indigo-300 bg-white p-8 text-center dark:border-indigo-800 dark:bg-slate-900"><p className="text-4xl">↗</p><h2 className="mt-3 font-display text-xl font-black text-slate-950 dark:text-white">Pulse is floating</h2><p className="mt-2 text-sm text-slate-500">Leave this page open, then return to your classwork.</p></section>}
      </main>
      {floatTarget && createPortal(pulsePanel, floatTarget)}
    </div>
  );
}
