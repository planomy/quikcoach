import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const BASE_QUESTION = {
  correctAnswer: '',
  anonymous: false,
  optional: false,
  imageUrl: '',
  timerSeconds: 0,
};

const PRESETS = [
  {
    id: 'yes-no',
    label: 'Y / N / ?',
    title: 'Yes / No / Unsure',
    question: {
      ...BASE_QUESTION,
      type: 'choice',
      prompt: 'Respond to the question you just heard.',
      options: ['Yes', 'No', 'Unsure'],
    },
  },
  {
    id: 'rating',
    label: '1–5',
    title: '1–5 Rating',
    question: {
      ...BASE_QUESTION,
      type: 'rating',
      prompt: 'Rate your response to the question you just heard from 1 to 5.',
      options: ['1', '2', '3', '4', '5'],
    },
  },
  {
    id: 'agreement',
    label: 'Agree',
    title: 'Agreement scale',
    question: {
      ...BASE_QUESTION,
      type: 'choice',
      prompt: 'How much do you agree with the statement you just heard?',
      options: ['Strongly disagree', 'Disagree', 'Unsure', 'Agree', 'Strongly agree'],
    },
  },
  {
    id: 'ab',
    label: 'A / B',
    title: 'Two choices',
    question: {
      ...BASE_QUESTION,
      type: 'choice',
      prompt: 'Choose the option that best answers the question you just heard.',
      options: ['A', 'B'],
    },
  },
  {
    id: 'abc',
    label: 'A–C',
    title: 'Three choices',
    question: {
      ...BASE_QUESTION,
      type: 'choice',
      prompt: 'Choose the option that best answers the question you just heard.',
      options: ['A', 'B', 'C'],
    },
  },
  {
    id: 'abcd',
    label: 'A–D',
    title: 'Four choices',
    question: {
      ...BASE_QUESTION,
      type: 'choice',
      prompt: 'Choose the option that best answers the question you just heard.',
      options: ['A', 'B', 'C', 'D'],
    },
  },
  {
    id: 'one-word',
    label: '1 word',
    title: 'One-word response',
    question: {
      ...BASE_QUESTION,
      type: 'short',
      prompt: 'Respond in one word to the question you just heard.',
      options: [],
    },
  },
  {
    id: 'short',
    label: 'Short',
    title: 'Short response',
    question: {
      ...BASE_QUESTION,
      type: 'short',
      prompt: 'Respond briefly to the question you just heard.',
      options: [],
    },
  },
];

const DOCK_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-width: 100%; min-height: 100%; background: #eef2ff; }
  button { font: inherit; }
  .iboard-presenter-shell {
    min-height: 100vh;
    padding: 10px;
    background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
    color: #0f172a;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .iboard-presenter-card {
    overflow: hidden;
    border: 1px solid #c7d2fe;
    border-radius: 18px;
    background: #ffffff;
    box-shadow: 0 18px 45px rgba(15, 23, 42, .16);
  }
  .iboard-presenter-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    background: linear-gradient(90deg, #3730a3, #6d28d9);
    color: #ffffff;
  }
  .iboard-presenter-brand {
    min-width: 0;
    flex: 1;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: .02em;
  }
  .iboard-presenter-room {
    margin-left: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #ddd6fe;
  }
  .iboard-presenter-chip,
  .iboard-presenter-head-button {
    border: 1px solid rgba(255,255,255,.24);
    border-radius: 999px;
    background: rgba(255,255,255,.12);
    color: #ffffff;
    font-size: 11px;
    font-weight: 850;
    line-height: 1;
    white-space: nowrap;
  }
  .iboard-presenter-chip { padding: 7px 9px; }
  .iboard-presenter-head-button {
    cursor: pointer;
    padding: 7px 9px;
  }
  .iboard-presenter-head-button:hover { background: rgba(255,255,255,.22); }
  .iboard-presenter-head-button.is-question {
    border-color: #f0abfc;
    background: #c026d3;
  }
  .iboard-presenter-body { padding: 10px; }
  .iboard-presenter-status-row {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 9px;
  }
  .iboard-presenter-live-dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 999px;
    background: #10b981;
  }
  .iboard-presenter-live-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 900;
  }
  .iboard-presenter-response-count {
    font-size: 11px;
    font-weight: 900;
    color: #4338ca;
  }
  .iboard-presenter-results {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 9px;
  }
  .iboard-presenter-result {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 5px 7px;
    font-size: 10px;
    font-weight: 750;
    color: #475569;
  }
  .iboard-presenter-result span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 110px;
  }
  .iboard-presenter-result strong { color: #312e81; }
  .iboard-presenter-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 9px;
  }
  .iboard-presenter-action {
    cursor: pointer;
    border: 0;
    border-radius: 9px;
    background: #eef2ff;
    color: #3730a3;
    padding: 7px 9px;
    font-size: 11px;
    font-weight: 900;
  }
  .iboard-presenter-action:hover { background: #e0e7ff; }
  .iboard-presenter-action.primary { background: #4f46e5; color: #ffffff; }
  .iboard-presenter-action.primary:hover { background: #4338ca; }
  .iboard-presenter-action.finish { background: #f1f5f9; color: #475569; }
  .iboard-presenter-action:disabled { cursor: default; opacity: .45; }
  .iboard-presenter-section-label {
    margin: 0 0 7px;
    font-size: 9px;
    font-weight: 950;
    letter-spacing: .15em;
    text-transform: uppercase;
    color: #64748b;
  }
  .iboard-presenter-presets {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .iboard-presenter-preset {
    cursor: pointer;
    min-width: 0;
    border: 1px solid #c7d2fe;
    border-radius: 10px;
    background: #eef2ff;
    color: #3730a3;
    padding: 9px 4px;
    font-size: 11px;
    font-weight: 950;
  }
  .iboard-presenter-preset:hover { border-color: #818cf8; background: #e0e7ff; }
  .iboard-presenter-questions {
    max-height: 145px;
    overflow: auto;
    margin-bottom: 10px;
    padding-right: 2px;
  }
  .iboard-presenter-question {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr);
    gap: 7px;
    padding: 7px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .iboard-presenter-qnum {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 999px;
    background: #c026d3;
    color: #ffffff;
    font-size: 10px;
    font-weight: 950;
  }
  .iboard-presenter-qname {
    margin: 0 0 2px;
    font-size: 9px;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #a21caf;
  }
  .iboard-presenter-qtext {
    margin: 0;
    font-size: 11px;
    line-height: 1.35;
    font-weight: 700;
    color: #1e293b;
  }
  .iboard-presenter-message {
    margin: 8px 0 0;
    border-radius: 8px;
    background: #ecfdf5;
    padding: 6px 8px;
    font-size: 10px;
    font-weight: 800;
    color: #047857;
  }
  .iboard-presenter-offline { background: #fff7ed; color: #c2410c; }
  .iboard-presenter-fallback {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 90;
    width: min(460px, calc(100vw - 32px));
  }
  .iboard-presenter-fallback .iboard-presenter-shell {
    min-height: 0;
    padding: 0;
    background: transparent;
  }
  @media (max-width: 390px) {
    .iboard-presenter-presets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .iboard-presenter-brand { font-size: 12px; }
  }
`;

function currentTeacherSocket() {
  if (typeof window === 'undefined') return null;
  return window.__iboardTeacherSocket || null;
}

function currentRoomCode() {
  if (typeof window === 'undefined') return '';
  return String(window.__iboardTeacherRoomCode || '').replace(/\D/g, '').slice(0, 4);
}

function activityLabel(activity) {
  if (!activity) return 'Ready';
  const options = Array.isArray(activity.options) ? activity.options : [];
  if (activity.type === 'rating') return '1–5 Pulse';
  if (activity.type === 'short') {
    return String(activity.prompt || '').toLowerCase().includes('one word') ? 'One Word Pulse' : 'Short Response';
  }
  if (options.join('|') === 'Yes|No|Unsure') return 'Yes / No / Unsure';
  if (options.length >= 2 && options.every((option, index) => option === String.fromCharCode(65 + index))) {
    return `A–${options.at(-1)} Choice`;
  }
  if (options.includes('Strongly agree')) return 'Agreement Pulse';
  return 'Pulse live';
}

function responseCounts(activity, responses) {
  if (!activity || !Array.isArray(activity.options)) return [];
  const counts = Object.fromEntries(activity.options.map((option) => [option, 0]));
  for (const response of responses || []) {
    counts[response.value] = (counts[response.value] || 0) + 1;
  }
  return activity.options.map((option) => ({ option, count: counts[option] || 0 }));
}

export default function TeacherPresenterDock() {
  const [socket, setSocket] = useState(currentTeacherSocket);
  const [roomCode, setRoomCode] = useState(currentRoomCode);
  const [live, setLive] = useState({ activity: null, responses: [], students: [] });
  const [questions, setQuestions] = useState([]);
  const [pipWindow, setPipWindow] = useState(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [showPresets, setShowPresets] = useState(true);
  const [showQuestions, setShowQuestions] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onTeacherSocket = (event) => {
      const nextSocket = event.detail?.socket || currentTeacherSocket();
      const nextCode = String(event.detail?.code || currentRoomCode()).replace(/\D/g, '').slice(0, 4);
      if (nextSocket) setSocket(nextSocket);
      if (nextCode) setRoomCode(nextCode);
    };
    window.addEventListener('iboard:teacher-socket', onTeacherSocket);
    const existingSocket = currentTeacherSocket();
    if (existingSocket) setSocket(existingSocket);
    const existingCode = currentRoomCode();
    if (existingCode) setRoomCode(existingCode);
    return () => window.removeEventListener('iboard:teacher-socket', onTeacherSocket);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const sync = () => {
      setConnected(socket.connected);
      socket.emit('teacher:live-sync', {});
      socket.emit('teacher:qna-sync', {});
    };
    const onDisconnect = () => setConnected(false);
    const onLive = (payload) => setLive(payload || { activity: null, responses: [], students: [] });
    const onQna = (payload) => setQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    const onRoom = (payload) => {
      const code = String(payload?.room?.code || '').replace(/\D/g, '').slice(0, 4);
      if (code) setRoomCode(code);
    };

    socket.on('connect', sync);
    socket.on('disconnect', onDisconnect);
    socket.on('live:teacher', onLive);
    socket.on('qna:teacher', onQna);
    socket.on('room:state', onRoom);
    sync();

    return () => {
      socket.off('connect', sync);
      socket.off('disconnect', onDisconnect);
      socket.off('live:teacher', onLive);
      socket.off('qna:teacher', onQna);
      socket.off('room:state', onRoom);
    };
  }, [socket]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 2800);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!pipWindow) return undefined;
    const onPageHide = () => setPipWindow(null);
    pipWindow.addEventListener('pagehide', onPageHide, { once: true });
    return () => pipWindow.removeEventListener('pagehide', onPageHide);
  }, [pipWindow]);

  const activity = live.activity || null;
  const responses = Array.isArray(live.responses) ? live.responses : [];
  const students = Array.isArray(live.students) ? live.students : [];
  const onlineCount = students.filter((student) => student.connected).length;
  const unansweredCount = students.filter((student) => student.connected && !student.hasResponded).length;
  const participantCount = Math.max(onlineCount, responses.length);
  const counts = useMemo(() => responseCounts(activity, responses), [activity, responses]);
  const pendingQuestions = useMemo(
    () => questions.filter((question) => question.status === 'pending').sort((a, b) => Number(a.id) - Number(b.id)),
    [questions]
  );

  useEffect(() => {
    if (activity?.id) setShowPresets(false);
    else setShowPresets(true);
  }, [activity?.id]);

  function launch(question) {
    if (!socket || busy) return;
    setBusy(true);
    socket.emit('teacher:live-launch', question, (ack) => {
      setBusy(false);
      if (!ack?.ok) {
        setMessage(ack?.error || 'Could not launch Pulse');
        return;
      }
      setShowPresets(false);
      setShowQuestions(false);
      setMessage('Pulse live');
    });
  }

  function finishPulse() {
    if (!socket || busy || !activity) return;
    setBusy(true);
    socket.emit('teacher:live-control', { action: 'clear' }, (ack) => {
      setBusy(false);
      setMessage(ack?.ok ? 'Pulse finished' : ack?.error || 'Could not finish Pulse');
      if (ack?.ok) setShowPresets(true);
    });
  }

  function remindUnanswered() {
    if (!socket || busy || !activity || !unansweredCount) return;
    setBusy(true);
    socket.emit('teacher:live-realert', {}, (ack) => {
      setBusy(false);
      setMessage(ack?.ok ? `Reminder sent to ${ack.count || 0}` : ack?.error || 'Could not send reminder');
    });
  }

  function bringBoardForward() {
    try {
      window.focus();
    } catch {
      /* Browser decides whether it can raise the main window. */
    }
  }

  function closeDock() {
    if (pipWindow) {
      try { pipWindow.close(); } catch { /* ignore */ }
      setPipWindow(null);
    }
    setFallbackOpen(false);
  }

  async function openDock() {
    setMessage('');
    const api = window.documentPictureInPicture;
    if (api?.requestWindow) {
      try {
        const nextWindow = await api.requestWindow({ width: 470, height: 360 });
        nextWindow.document.title = `iBOARD Presenter · ${roomCode}`;
        nextWindow.document.body.innerHTML = '';
        setFallbackOpen(false);
        setPipWindow(nextWindow);
        return;
      } catch {
        setMessage('Always-on-top window unavailable. Using in-page dock.');
      }
    } else {
      setMessage('Always-on-top window unavailable. Using in-page dock.');
    }
    setFallbackOpen(true);
  }

  const dock = (
    <>
      <style>{DOCK_CSS}</style>
      <div className="iboard-presenter-shell">
        <section className="iboard-presenter-card" aria-label="iBOARD Presenter Dock">
          <header className="iboard-presenter-head">
            <div className="iboard-presenter-brand">
              iBOARD <span className="iboard-presenter-room">{roomCode || '----'}</span>
            </div>
            <span className="iboard-presenter-chip">{onlineCount} online</span>
            <button
              type="button"
              className={`iboard-presenter-head-button${pendingQuestions.length ? ' is-question' : ''}`}
              onClick={() => setShowQuestions((value) => !value)}
              title="Waiting audience questions"
            >
              Q {pendingQuestions.length}
            </button>
            <button type="button" className="iboard-presenter-head-button" onClick={bringBoardForward}>Board</button>
            <button type="button" className="iboard-presenter-head-button" onClick={closeDock} aria-label="Close Presenter Dock">×</button>
          </header>

          <div className="iboard-presenter-body">
            {showQuestions && (
              <div className="iboard-presenter-questions">
                <p className="iboard-presenter-section-label">Question queue</p>
                {pendingQuestions.slice(0, 5).map((question, index) => (
                  <div className="iboard-presenter-question" key={question.id}>
                    <span className="iboard-presenter-qnum">{index + 1}</span>
                    <div>
                      <p className="iboard-presenter-qname">{question.studentName || 'Participant'}</p>
                      <p className="iboard-presenter-qtext">{question.text}</p>
                    </div>
                  </div>
                ))}
                {!pendingQuestions.length && <p className="iboard-presenter-qtext">No questions waiting.</p>}
              </div>
            )}

            {activity ? (
              <>
                <div className="iboard-presenter-status-row">
                  <span className="iboard-presenter-live-dot" />
                  <span className="iboard-presenter-live-title">{activityLabel(activity)}</span>
                  <span className="iboard-presenter-response-count">{responses.length}/{participantCount || 0}</span>
                </div>

                {activity.type !== 'short' && counts.length > 0 && (
                  <div className="iboard-presenter-results">
                    {counts.map(({ option, count }) => (
                      <span className="iboard-presenter-result" key={option} title={option}>
                        <span>{option}</span><strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                )}

                <div className="iboard-presenter-actions">
                  <button type="button" className="iboard-presenter-action primary" onClick={() => setShowPresets((value) => !value)}>
                    {showPresets ? 'Hide pulses' : 'Ask another'}
                  </button>
                  {unansweredCount > 0 && (
                    <button type="button" className="iboard-presenter-action" disabled={busy} onClick={remindUnanswered}>
                      Remind {unansweredCount}
                    </button>
                  )}
                  <button type="button" className="iboard-presenter-action finish" disabled={busy} onClick={finishPulse}>Finish</button>
                </div>
              </>
            ) : (
              <div className="iboard-presenter-status-row">
                <span className="iboard-presenter-live-title">Quik Pulse</span>
                <span className="iboard-presenter-response-count">Ready</span>
              </div>
            )}

            {showPresets && (
              <>
                <p className="iboard-presenter-section-label">Tap a response type</p>
                <div className="iboard-presenter-presets">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.title}
                      className="iboard-presenter-preset"
                      disabled={busy || !socket}
                      onClick={() => launch(preset.question)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {message && <p className={`iboard-presenter-message${connected ? '' : ' iboard-presenter-offline'}`}>{message}</p>}
            {!connected && <p className="iboard-presenter-message iboard-presenter-offline">Reconnecting to iBOARD…</p>}
          </div>
        </section>
      </div>
    </>
  );

  if (!socket || !roomCode) return null;

  return (
    <>
      {!pipWindow && !fallbackOpen && (
        <button
          type="button"
          onClick={openDock}
          title="Open Presenter Dock"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 70,
            border: '1px solid #3730a3',
            borderRadius: 999,
            background: '#4f46e5',
            color: '#fff',
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 900,
            boxShadow: '0 10px 24px rgba(15,23,42,.18)',
            cursor: 'pointer',
          }}
        >
          Presenter
        </button>
      )}
      {fallbackOpen && <div className="iboard-presenter-fallback">{dock}</div>}
      {pipWindow && createPortal(dock, pipWindow.document.body)}
    </>
  );
}
