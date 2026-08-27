import { useEffect, useMemo, useState } from 'react';

function currentTeacherConnection() {
  if (typeof window === 'undefined') return { socket: null, code: '' };
  return {
    socket: window.__iboardTeacherSocket || null,
    code: String(window.__iboardTeacherRoomCode || ''),
  };
}

/**
 * Marks the main LIVE student cards when that student has a waiting audience question.
 * TeacherDashboard already exposes stable data-student-id attributes, so this keeps the
 * Q&A signal lightweight without adding another control row to every card.
 */
export default function TeacherLiveQuestionIndicators() {
  const [connection, setConnection] = useState(currentTeacherConnection);
  const [questions, setQuestions] = useState([]);

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
      return undefined;
    }

    const onQna = (payload) => {
      setQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    };
    const sync = () => socket.emit('teacher:qna-sync', {});

    socket.on('qna:teacher', onQna);
    socket.on('connect', sync);
    if (socket.connected) sync();

    return () => {
      socket.off('qna:teacher', onQna);
      socket.off('connect', sync);
    };
  }, [connection.socket, connection.code]);

  const waitingByStudent = useMemo(() => {
    const pending = questions
      .filter((question) => question.status === 'pending')
      .sort((a, b) => Number(a.id) - Number(b.id));
    const map = new Map();

    pending.forEach((question, index) => {
      const studentId = Number(question.studentId);
      if (!studentId) return;
      const existing = map.get(studentId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(studentId, { position: index + 1, count: 1 });
      }
    });

    return map;
  }, [questions]);

  useEffect(() => {
    let frame = 0;

    const applyIndicators = () => {
      document.querySelectorAll('main article[data-student-id]').forEach((card) => {
        const studentId = Number(card.dataset.studentId);
        const waiting = waitingByStudent.get(studentId);

        if (!waiting) {
          delete card.dataset.liveQuestionWaiting;
          delete card.dataset.liveQuestionLabel;
          return;
        }

        card.dataset.liveQuestionWaiting = 'true';
        card.dataset.liveQuestionLabel = waiting.count > 1
          ? `Q${waiting.position}+${waiting.count - 1}`
          : `Q${waiting.position}`;
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
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('iboard:teacher-layout', scheduleApply);

    return () => {
      observer.disconnect();
      window.removeEventListener('iboard:teacher-layout', scheduleApply);
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelectorAll('main article[data-student-id]').forEach((card) => {
        delete card.dataset.liveQuestionWaiting;
        delete card.dataset.liveQuestionLabel;
      });
    };
  }, [waitingByStudent]);

  return (
    <style>{`
      main article[data-student-id][data-live-question-waiting='true'] {
        position: relative;
      }

      main article[data-student-id][data-live-question-waiting='true']::after {
        content: attr(data-live-question-label);
        position: absolute;
        top: -0.5rem;
        right: 0.75rem;
        z-index: 3;
        display: grid;
        min-width: 1.45rem;
        height: 1.45rem;
        place-items: center;
        border-radius: 9999px;
        padding: 0 0.3rem;
        background: rgb(192 38 211);
        color: white;
        font-size: 0.625rem;
        font-weight: 900;
        line-height: 1;
        letter-spacing: -0.01em;
        box-shadow: 0 0 0 2px white, 0 2px 7px rgb(15 23 42 / 0.18);
        pointer-events: none;
      }

      html.dark main article[data-student-id][data-live-question-waiting='true']::after {
        box-shadow: 0 0 0 2px rgb(15 23 42), 0 2px 7px rgb(0 0 0 / 0.35);
      }
    `}</style>
  );
}
