import { useEffect } from 'react';

const NOTE_BUTTON_TITLE = 'Send a private note to this student only';

function studentIdForButton(button) {
  const article = button?.closest?.('article');
  const heading = article?.querySelector?.('h2[title^="ID #"]');
  const match = String(heading?.getAttribute?.('title') || '').match(/ID #(\d+)/);
  return Number(match?.[1]) || 0;
}

function noteButtonForStudent(studentId) {
  const heading = document.querySelector(`h2[title="ID #${Number(studentId)}"]`);
  return heading?.closest?.('article')?.querySelector?.(`button[title="${NOTE_BUTTON_TITLE}"]`) || null;
}

export default function NoteSendStatusControl() {
  useEffect(() => {
    const onCapture = (event) => {
      const button = event.target?.closest?.(`button[title="${NOTE_BUTTON_TITLE}"]`);
      if (!button) return;
      const studentId = studentIdForButton(button);
      if (!studentId) return;
      window.__iboardPendingNoteStudentId = studentId;
    };

    const onBubble = (event) => {
      const button = event.target?.closest?.(`button[title="${NOTE_BUTTON_TITLE}"]`);
      if (!button) return;
      const studentId = studentIdForButton(button);
      // React's click handler runs before this document-level bubble listener. If the
      // prompt was cancelled, no distribute event consumed the marker, so clear it.
      setTimeout(() => {
        if (Number(window.__iboardPendingNoteStudentId) === studentId) {
          window.__iboardPendingNoteStudentId = 0;
        }
      }, 0);
    };

    const onStatus = (event) => {
      const studentId = Number(event.detail?.studentId);
      const status = String(event.detail?.status || '');
      if (!studentId || !['sending', 'sent', 'failed'].includes(status)) return;
      const button = noteButtonForStudent(studentId);
      if (!button) return;
      button.dataset.noteStatus = status;
      if (status === 'sent') button.title = 'Note saved and sent to this student';
      else if (status === 'failed') button.title = 'Note failed to send — click to retry';
      else button.title = 'Sending private note…';
    };

    document.addEventListener('click', onCapture, true);
    document.addEventListener('click', onBubble, false);
    window.addEventListener('iboard:note-send-status', onStatus);
    return () => {
      document.removeEventListener('click', onCapture, true);
      document.removeEventListener('click', onBubble, false);
      window.removeEventListener('iboard:note-send-status', onStatus);
    };
  }, []);

  return (
    <style>{`
      button[data-note-status="sending"] {
        border-color: rgb(245 158 11) !important;
        background: rgb(254 243 199) !important;
        color: rgb(146 64 14) !important;
      }
      button[data-note-status="sent"] {
        border-color: rgb(34 197 94) !important;
        background: rgb(220 252 231) !important;
        color: rgb(21 128 61) !important;
      }
      button[data-note-status="failed"] {
        border-color: rgb(239 68 68) !important;
        background: rgb(254 226 226) !important;
        color: rgb(185 28 28) !important;
      }
      .dark button[data-note-status="sending"] {
        background: rgb(69 26 3) !important;
        color: rgb(253 230 138) !important;
      }
      .dark button[data-note-status="sent"] {
        background: rgb(5 46 22) !important;
        color: rgb(187 247 208) !important;
      }
      .dark button[data-note-status="failed"] {
        background: rgb(69 10 10) !important;
        color: rgb(254 202 202) !important;
      }
    `}</style>
  );
}
