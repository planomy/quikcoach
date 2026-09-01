import { useEffect, useMemo, useState } from 'react';
import QuestionInboxReply from './QuestionInboxReply.jsx';
import { activeTeacherRoomCode, ensureTeacherRoom } from '../lib/teacherRoom.js';

function currentTeacherConnection() {
  if (typeof window === 'undefined') return { socket: null, code: '' };
  return {
    socket: window.__iboardTeacherSocket || null,
    code: String(window.__iboardTeacherRoomCode || ''),
  };
}

const ACTION_CLASS = 'h-9 rounded-lg px-3 text-xs font-black';

export default function TeacherLiveQuestionIndicators() {
  const [connection, setConnection] = useState(currentTeacherConnection);
  const [questions, setQuestions] = useState([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onTeacherSocket = (event) => {
      const socket = event.detail?.socket || window.__iboardTeacherSocket || null;
      const code = String(event.detail?.code || window.__iboardTeacherRoomCode || '');
      setConnection({ socket, code });
    };
    window.addEventListener('iboard:teacher-socket', onTeacherSocket);
    const current = currentTeacherConnection();
    if (current.socket) setConnection(current);
    return () => window.removeEventListener('iboard:teacher-socket', onTeacherSocket);
  }, []);

  useEffect(() => {
    const socket = connection.socket;
    if (!socket || !connection.code) {
      setQuestions([]);
      setSelectedQuestionId(null);
      return undefined;
    }
    const onQna = (payload) => setQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    const sync = () => {
      const code = activeTeacherRoomCode();
      if (code.length !== 4) return;
      socket.emit('teacher:join', { code }, (ack) => {
        if (ack?.ok) socket.emit('teacher:qna-sync', {});
      });
    };
    const onDisconnect = () => {
      setSelectedQuestionId(null);
      setMessage('');
    };
    socket.on('qna:teacher', onQna);
    socket.on('connect', sync);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) sync();
    return () => {
      socket.off('qna:teacher', onQna);
      socket.off('connect', sync);
      socket.off('disconnect', onDisconnect);
    };
  }, [connection.socket, connection.code]);

  const pendingQuestions = useMemo(
    () => questions.filter((question) => question.status === 'pending').sort((a, b) => Number(a.id) - Number(b.id)),
    [questions]
  );
  const queuePositionById = useMemo(
    () => new Map(pendingQuestions.map((question, index) => [Number(question.id), index + 1])),
    [pendingQuestions]
  );
  const waitingByStudent = useMemo(() => {
    const map = new Map();
    pendingQuestions.forEach((question, index) => {
      const studentId = Number(question.studentId);
      if (!studentId) return;
      const existing = map.get(studentId);
      if (existing) existing.count += 1;
      else map.set(studentId, { position: index + 1, count: 1, questionId: Number(question.id) });
    });
    return map;
  }, [pendingQuestions]);
  const selectedQuestion = useMemo(
    () => questions.find((question) => Number(question.id) === Number(selectedQuestionId)) || null,
    [questions, selectedQuestionId]
  );

  useEffect(() => {
    if (!selectedQuestionId) return;
    if (!selectedQuestion || selectedQuestion.status !== 'pending') {
      setSelectedQuestionId(null);
      setMessage('');
    }
  }, [selectedQuestion, selectedQuestionId]);

  useEffect(() => {
    let frame = 0;
    const applyIndicators = () => {
      document.querySelectorAll('main article[data-student-id]').forEach((card) => {
        const studentId = Number(card.dataset.studentId);
        const waiting = waitingByStudent.get(studentId);
        let badge = card.querySelector(':scope > button[data-live-question-badge]');
        if (!waiting) {
          badge?.remove();
          delete card.dataset.liveQuestionWaiting;
          return;
        }
        card.dataset.liveQuestionWaiting = 'true';
        if (!badge) {
          badge = document.createElement('button');
          badge.type = 'button';
          badge.dataset.liveQuestionBadge = 'true';
          card.appendChild(badge);
        }
        const label = waiting.count > 1 ? `Q${waiting.position}+${waiting.count - 1}` : `Q${waiting.position}`;
        if (badge.textContent !== label) badge.textContent = label;
        badge.title = `Open question ${waiting.position}`;
        badge.setAttribute('aria-label', `Open question ${waiting.position} from this student`);
        badge.onclick = (event) => {
          event.stopPropagation();
          setMessage('');
          setSelectedQuestionId(waiting.questionId);
        };
      });

      document.querySelectorAll('main button').forEach((button) => {
        if (button.textContent?.trim().startsWith('Q&A ·')) {
          button.dataset.liveQuestionHeaderButton = 'true';
          button.hidden = true;
        }
      });
    };
    const scheduleApply = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        applyIndicators();
      });
    };
    applyIndicators();
    const observer = new MutationObserver(scheduleApply);
    const main = document.querySelector('main');
    if (main) observer.observe(main, { childList: true, subtree: true });
    window.addEventListener('iboard:teacher-layout', scheduleApply);
    return () => {
      observer.disconnect();
      window.removeEventListener('iboard:teacher-layout', scheduleApply);
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelectorAll('button[data-live-question-badge]').forEach((badge) => badge.remove());
      document.querySelectorAll('[data-live-question-waiting]').forEach((card) => delete card.dataset.liveQuestionWaiting);
      document.querySelectorAll('button[data-live-question-header-button]').forEach((button) => {
        button.hidden = false;
        delete button.dataset.liveQuestionHeaderButton;
      });
    };
  }, [waitingByStudent]);

  function updateQuestion(action, anonymous) {
    if (!selectedQuestion || !connection.socket) return;
    setMessage('');
    ensureTeacherRoom(connection.socket, (joinAck) => {
      if (!joinAck?.ok) {
        setMessage(joinAck?.error || 'Open the room as teacher first');
        return;
      }
      connection.socket.emit('teacher:qna-status', { questionId: selectedQuestion.id, action, anonymous }, (ack) => {
        if (!ack?.ok) setMessage(ack?.error || 'Could not update the question.');
      });
    });
  }

  function askClass() {
    if (!selectedQuestion || !connection.socket) return;
    setMessage('');
    ensureTeacherRoom(connection.socket, (joinAck) => {
      if (!joinAck?.ok) {
        setMessage(joinAck?.error || 'Open the room as teacher first');
        return;
      }
      connection.socket.emit(
        'teacher:qna-ask-room',
        { questionId: selectedQuestion.id, anonymous: !!selectedQuestion.anonymousRequested },
        (ack) => {
          if (!ack?.ok) {
            setMessage(ack?.error || 'Could not ask the class.');
            return;
          }
          setSelectedQuestionId(null);
        }
      );
    });
  }

  const selectedPosition = selectedQuestion ? queuePositionById.get(Number(selectedQuestion.id)) : null;

  return (
    <>
      <style>{`
        main article[data-student-id][data-live-question-waiting='true'] { position: relative; }
        main button[data-live-question-badge='true'] {
          position:absolute;top:0.45rem;right:0.45rem;z-index:3;display:grid;min-width:1.45rem;height:1.45rem;
          place-items:center;border:0;border-radius:9999px;padding:0 0.3rem;background:rgb(79 70 229);color:white;
          cursor:pointer;font-size:0.625rem;font-weight:900;line-height:1;letter-spacing:-0.01em;
          box-shadow:0 0 0 2px white,0 2px 7px rgb(15 23 42 / 0.18);transition:transform 120ms ease,background 120ms ease;
        }
        main button[data-live-question-badge='true']:hover,main button[data-live-question-badge='true']:focus-visible {
          background:rgb(67 56 202);transform:scale(1.08);outline:none;
        }
        html.dark main button[data-live-question-badge='true'] { box-shadow:0 0 0 2px rgb(15 23 42),0 2px 7px rgb(0 0 0 / 0.35); }
      `}</style>

      {selectedQuestion && selectedPosition && (
        <aside
          className="fixed right-4 top-24 z-[65] w-[min(24rem,calc(100vw-2rem))] overflow-visible rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          role="dialog"
          aria-modal="false"
          aria-label={`Question ${selectedPosition} from ${selectedQuestion.studentName}`}
        >
          <div className="flex items-start gap-3">
            <span className="grid h-9 min-w-9 shrink-0 place-items-center rounded-full bg-indigo-600 px-1 text-sm font-black text-white">{selectedPosition}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{selectedQuestion.studentName}</p>
                <button type="button" onClick={() => { setSelectedQuestionId(null); setMessage(''); }} className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Close popup" title="Close popup — question stays in queue">Close</button>
              </div>
              <p className="mt-1 text-base font-bold leading-snug text-slate-950 dark:text-white">{selectedQuestion.text}</p>
            </div>
          </div>

          {message && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{message}</p>}

          <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 overflow-visible border-t border-slate-100 pt-3 dark:border-slate-800">
            <details className="relative">
              <summary className={`flex ${ACTION_CLASS} list-none cursor-pointer items-center bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200 [&::-webkit-details-marker]:hidden`}>Show ▾</summary>
              <div className="absolute left-0 top-full z-50 mt-1 min-w-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); updateQuestion('publish', false); }} className="block w-full rounded-md px-3 py-2 text-left text-xs font-black text-indigo-700 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-950">Named</button>
                <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); updateQuestion('publish', true); }} className="block w-full rounded-md px-3 py-2 text-left text-xs font-black text-indigo-700 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-950">Anonymous</button>
              </div>
            </details>
            <button type="button" onClick={askClass} className={`${ACTION_CLASS} bg-emerald-500 text-emerald-950`}>Ask class</button>
            <button type="button" onClick={() => updateQuestion('dismiss')} className={`${ACTION_CLASS} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200`}>Mark handled</button>
          </div>

          <QuestionInboxReply
            socket={connection.socket}
            studentId={selectedQuestion.studentId}
            studentName={selectedQuestion.studentName}
            questionText={selectedQuestion.text}
            className="mt-3"
          />
        </aside>
      )}
    </>
  );
}
