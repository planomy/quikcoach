import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppFooter from '../components/AppFooter.jsx';
import IBoardWordmark from '../components/IBoardWordmark.jsx';
import LiveResponseTeacher from '../components/LiveResponseTeacher.jsx';
import TeacherPinGate from '../components/TeacherPinGate.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { createSocket } from '../lib/socket.js';

function cleanCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function randomRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function PulseTeacherInner() {
  const [searchParams] = useSearchParams();
  const codeFromLink = cleanCode(searchParams.get('code'));
  const [codeInput, setCodeInput] = useState(codeFromLink);
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const socket = useMemo(() => createSocket(), []);
  const roomCodeRef = useRef('');

  function openRoom(value = codeInput) {
    const code = cleanCode(value);
    setError('');
    if (code.length !== 4) {
      setError('Enter a four-digit room code.');
      return;
    }
    socket.emit('teacher:join', { code }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not open the room.');
        return;
      }
      roomCodeRef.current = code;
      setCodeInput(code);
      setJoined(true);
    });
  }

  useEffect(() => {
    const connect = () => {
      setConnected(true);
      if (roomCodeRef.current) openRoom(roomCodeRef.current);
    };
    const disconnect = () => setConnected(false);
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    socket.connect();
    if (codeFromLink.length === 4) openRoom(codeFromLink);
    return () => {
      socket.off('connect', connect);
      socket.off('disconnect', disconnect);
      socket.disconnect();
    };
  }, [socket]);

  async function copyStudentLink() {
    const url = `${window.location.origin}/pulse?code=${encodeURIComponent(codeInput)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyMessage('Student Pulse link copied ✓');
      setTimeout(() => setCopyMessage(''), 2500);
    } catch {
      setError(`Copy this link: ${url}`);
    }
  }

  if (!joined) {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-indigo-50 to-white dark:from-slate-950 dark:to-indigo-950">
        <main className="grid flex-1 place-items-center px-4 py-10">
          <section className="w-full max-w-md rounded-3xl border border-indigo-200 bg-white p-7 shadow-card dark:border-indigo-900 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3"><div><IBoardWordmark className="text-2xl" iClassName="italic text-indigo-600" /><p className="mt-1 text-xs font-black uppercase tracking-[0.22em] text-violet-600">Pulse teacher</p></div><ThemeToggle /></div>
            <h1 className="mt-7 font-display text-2xl font-black text-slate-950 dark:text-white">Ask the room — live</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Share a link, launch a question, see who answers. Ideal while people keep working in another app.
            </p>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm font-medium text-slate-600 dark:text-slate-400">
              <li>Pick or randomise a 4-digit room code</li>
              <li>Copy the student link and send it</li>
              <li>Launch an Instant check when they’re in</li>
            </ol>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Room code</label>
              <div className="flex gap-2"><input value={codeInput} onChange={(event) => setCodeInput(cleanCode(event.target.value))} inputMode="numeric" maxLength={4} placeholder="0000" className="min-w-0 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 font-mono text-xl tracking-widest outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /><button type="button" onClick={() => setCodeInput(randomRoomCode())} className="rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">Random</button></div>
              {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
              <button type="button" onClick={() => openRoom()} className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-black text-white shadow-lift hover:bg-indigo-700">Open room</button>
              <Link to="/teacher" className="block text-center text-sm font-bold text-indigo-600 hover:text-indigo-800">Need live writing too? Open full iBOARD</Link>
            </div>
          </section>
        </main>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white dark:from-slate-950 dark:to-indigo-950">
      <header className="border-b border-indigo-100 bg-white/90 px-4 py-4 backdrop-blur dark:border-indigo-900 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">iBOARD Pulse · Teacher</p><h1 className="font-display text-xl font-black text-slate-950 dark:text-white">Room <span className="font-mono text-indigo-600">{codeInput}</span></h1></div>
          <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1.5 text-[11px] font-black ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{connected ? 'Connected' : 'Reconnecting…'}</span><button type="button" onClick={copyStudentLink} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700">Copy student Pulse link</button><ThemeToggle /><Link to={`/teacher?code=${encodeURIComponent(codeInput)}`} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white dark:bg-white dark:text-slate-900">Full iBOARD</Link></div>
        </div>
        {copyMessage && <p className="mx-auto mt-2 max-w-5xl text-right text-xs font-bold text-emerald-700 dark:text-emerald-300">{copyMessage}</p>}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4"><LiveResponseTeacher socket={socket} onCopyStudentLink={copyStudentLink} /></main>
    </div>
  );
}

export default function PulseTeacher() {
  return <TeacherPinGate title="Pulse teacher access"><PulseTeacherInner /></TeacherPinGate>;
}
