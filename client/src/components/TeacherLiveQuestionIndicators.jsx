import { useEffect, useMemo, useState } from 'react';

function currentTeacherConnection() {
  if (typeof window === 'undefined') return { socket: null, code: '' };
  return {
    socket: window.__iboardTeacherSocket || null,
    code: String(window.__iboardTeacherRoomCode || ''),
  };
}

function openPulseQuestion(position) {
  const pulseButton = [...document.querySelectorAll("nav[aria-label='Teacher tools'] button")]
    .find((button) => [...button.querySelectorAll('span')].some((span) => span.textContent?.trim() === 'Pulse'));
  pulseButton?.click();

  let attempts = 0;
  const openQuestion = () => {
    attempts += 1;
    const questionButton = document.querySelector(
      `button[aria-label^="Question ${position} in the queue from "]`
    );
    if (questionButton) {
      questionButton.click();
      questionButton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (attempts < 10) window.requestAnimationFrame(openQuestion);
  };
  window.requestAnimationFrame(openQuestion);
}

/**
 * Adds a direct question shortcut to the main LIVE student card when that student
 * has a waiting audience question. It reuses the existing Pulse queue rather than
 * inventing a second question workflow.
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

        const label = waiting.count > 1
          ? `Q${waiting.position}+${waiting.count - 1}`
          : `Q${waiting.position}`;
        badge.textContent = label;
        badge.title = `Open question ${waiting.position}`;
        badge.setAttribute('aria-label', `Open question ${waiting.position} from this student`);
        badge.onclick = (event) => {
          event.stopPropagation();
          openPulseQuestion(waiting.position);
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
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('iboard:teacher-layout', scheduleApply);

    return () => {
      observer.disconnect();
      window.removeEventListener('iboard:teacher-layout', scheduleApply);
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelectorAll('button[data-live-question-badge]').forEach((badge) => badge.remove());
      document.querySelectorAll('[data-live-question-waiting]').forEach((card) => {
        delete card.dataset.liveQuestionWaiting;
      });
      document.querySelectorAll('button[data-live-question-header-button]').forEach((button) => {
        button.hidden = false;
        delete button.dataset.liveQuestionHeaderButton;
      });
    };
  }, [waitingByStudent]);

  return (
    <style>{`
      main article[data-student-id][data-live-question-waiting='true'] {
        position: relative;
      }

      main button[data-live-question-badge='true'] {
        position: absolute;
        top: -0.5rem;
        right: 0.75rem;
        z-index: 3;
        display: grid;
        min-width: 1.45rem;
        height: 1.45rem;
        place-items: center;
        border: 0;
        border-radius: 9999px;
        padding: 0 0.3rem;
        background: rgb(192 38 211);
        color: white;
        cursor: pointer;
        font-size: 0.625rem;
        font-weight: 900;
        line-height: 1;
        letter-spacing: -0.01em;
        box-shadow: 0 0 0 2px white, 0 2px 7px rgb(15 23 42 / 0.18);
        transition: transform 120ms ease, background 120ms ease;
      }

      main button[data-live-question-badge='true']:hover,
      main button[data-live-question-badge='true']:focus-visible {
        background: rgb(162 28 175);
        transform: scale(1.08);
        outline: none;
      }

      html.dark main button[data-live-question-badge='true'] {
        box-shadow: 0 0 0 2px rgb(15 23 42), 0 2px 7px rgb(0 0 0 / 0.35);
      }
    `}</style>
  );
}
