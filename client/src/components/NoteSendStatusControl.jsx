import { useEffect } from 'react';

function noteButtonForStudent(studentId) {
  const id = Number(studentId);
  if (!id) return null;
  return (
    document.querySelector(`button[data-note-student-id="${id}"]`) ||
    document.querySelector(`article[data-student-id="${id}"] button[aria-label^="Note "]`)
  );
}

export default function NoteSendStatusControl() {
  useEffect(() => {
    const onStatus = (event) => {
      const studentId = Number(event.detail?.studentId);
      const status = String(event.detail?.status || '');
      if (!studentId || !['sending', 'waiting', 'sent', 'seen', 'failed'].includes(status)) return;
      const button = noteButtonForStudent(studentId);
      if (!button) return;
      const nextStatus = status === 'sent' ? 'waiting' : status;
      button.dataset.noteStatus = nextStatus;
      const name = String(button.getAttribute('data-note-student-name') || 'student');
      button.setAttribute(
        'aria-label',
        nextStatus === 'waiting'
          ? `Note sent to ${name} — waiting for them to open it`
          : nextStatus === 'seen'
            ? `Note to ${name} seen`
            : nextStatus === 'failed'
              ? `Note to ${name} failed — click to retry`
              : `Sending note to ${name}`
      );
      button.title =
        nextStatus === 'waiting'
          ? 'Sent — waiting for student to open'
          : nextStatus === 'seen'
            ? 'Seen by student'
            : nextStatus === 'failed'
              ? 'Failed to send'
              : 'Sending…';
    };

    window.addEventListener('iboard:note-send-status', onStatus);
    return () => window.removeEventListener('iboard:note-send-status', onStatus);
  }, []);

  return (
    <style>{`
      /* Outline-only status on the note icon (stroke uses currentColor). */
      button[data-note-status="sending"] {
        color: rgb(79 70 229) !important;
        opacity: 0.7;
      }
      button[data-note-status="waiting"],
      button[data-note-status="sent"] {
        color: rgb(79 70 229) !important;
      }
      button[data-note-status="seen"] {
        color: rgb(22 163 74) !important;
      }
      button[data-note-status="failed"] {
        color: rgb(220 38 38) !important;
      }
      .dark button[data-note-status="sending"],
      .dark button[data-note-status="waiting"],
      .dark button[data-note-status="sent"] {
        color: rgb(129 140 248) !important;
      }
      .dark button[data-note-status="seen"] {
        color: rgb(74 222 128) !important;
      }
      .dark button[data-note-status="failed"] {
        color: rgb(248 113 113) !important;
      }
    `}</style>
  );
}
