import { useEffect, useMemo, useState } from 'react';
import ConversationModal from './ConversationModal.jsx';
import QuestionInboxReply from './QuestionInboxReply.jsx';

function initialFor(name) {
  const text = String(name || '').trim();
  return text ? text.slice(0, 1).toUpperCase() : '?';
}

function formatInboxTime(at) {
  const ms = Number(at) || 0;
  if (!ms) return '';
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function previewFor(thread, hands) {
  if (hands.length) {
    const text = String(hands[0]?.text || '').replace(/\s+/g, ' ').trim();
    return text ? `Question: ${text}` : 'Asked a question';
  }
  return thread.lastText || 'No messages yet';
}

export default function TeacherInboxPanel({
  socket,
  students = [],
  pendingHandByStudentId,
  onOpenThread,
  onTeacherSent,
  onHandReplySent,
  onHandDismiss,
  focusStudentId = 0,
}) {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(0);

  function loadThreads(preferId) {
    if (!socket) return;
    socket.emit('teacher:chat-inbox', {}, (ack) => {
      if (!ack?.ok || !Array.isArray(ack.threads)) return;
      setThreads(ack.threads);
      setSelectedId((current) => {
        const next = Number(preferId) || current;
        if (next && ack.threads.some((row) => Number(row.studentId) === next)) return next;
        const waiting = ack.threads.find((row) => row.unread);
        return Number(waiting?.studentId || ack.threads[0]?.studentId || 0);
      });
    });
  }

  useEffect(() => {
    const prefer = Number(focusStudentId) || 0;
    if (prefer) setSelectedId(prefer);
  }, [focusStudentId]);

  useEffect(() => {
    loadThreads(focusStudentId);
    const refresh = () => loadThreads();
    socket.on('feedback:chat', refresh);
    socket.on('feedback:note-reply', refresh);
    socket.on('feedback:note-reply-batch', refresh);
    return () => {
      socket.off('feedback:chat', refresh);
      socket.off('feedback:note-reply', refresh);
      socket.off('feedback:note-reply-batch', refresh);
    };
  }, [socket]);

  const rows = useMemo(() => {
    const byId = new Map(threads.map((row) => [Number(row.studentId), row]));
    const list = (students.length ? students : threads).map((student) => {
      const id = Number(student.id || student.studentId);
      const thread = byId.get(id) || {
        studentId: id,
        studentName: student.name || student.studentName || 'Student',
        lastText: '',
        lastAt: 0,
        lastFrom: '',
        unread: false,
        messageCount: 0,
      };
      const hands = pendingHandByStudentId?.get(id) || [];
      return {
        ...thread,
        studentName: student.name || thread.studentName || 'Student',
        waiting: !!thread.unread || hands.length > 0,
        hands,
      };
    });
    list.sort((left, right) => {
      if (left.waiting !== right.waiting) return left.waiting ? -1 : 1;
      return (right.lastAt || 0) - (left.lastAt || 0) || String(left.studentName).localeCompare(String(right.studentName), undefined, { sensitivity: 'base' });
    });
    return list;
  }, [students, threads, pendingHandByStudentId]);

  useEffect(() => {
    if (!rows.length) return;
    if (selectedId && rows.some((row) => Number(row.studentId) === Number(selectedId))) return;
    const waiting = rows.find((row) => row.waiting);
    setSelectedId(Number(waiting?.studentId || rows[0].studentId));
  }, [rows, selectedId]);

  const selected = rows.find((row) => Number(row.studentId) === Number(selectedId)) || null;

  function selectThread(row) {
    const id = Number(row.studentId);
    setSelectedId(id);
    onOpenThread?.(row);
  }

  return (
    <div className="iboard-teacher-inbox">
      <aside className="iboard-teacher-inbox__list" aria-label="Inbox conversations">
        <div className="iboard-teacher-inbox__scroll">
          {rows.length ? rows.map((row) => {
            const on = Number(row.studentId) === Number(selectedId);
            return (
              <button
                key={row.studentId}
                type="button"
                className={`iboard-teacher-inbox__row${on ? ' is-on' : ''}${row.waiting ? ' is-unread' : ''}`}
                aria-current={on ? 'true' : undefined}
                onClick={() => selectThread(row)}
              >
                <span className="iboard-chat-avatar" aria-hidden="true">{initialFor(row.studentName)}</span>
                <span>
                  <span className="iboard-teacher-inbox__name">{row.studentName}</span>
                  <span className="iboard-teacher-inbox__preview">{previewFor(row, row.hands)}</span>
                  <span className="iboard-teacher-inbox__meta">
                    {row.waiting ? <span className="iboard-teacher-inbox__dot" aria-hidden="true" /> : null}
                    <span className="iboard-teacher-inbox__time">{formatInboxTime(row.lastAt)}</span>
                  </span>
                </span>
              </button>
            );
          }) : (
            <p className="iboard-teacher-inbox__empty">No students in the room yet.</p>
          )}
        </div>
      </aside>
      <section className="iboard-teacher-inbox__thread" aria-label="Conversation">
        {selected ? (
          <>
            {selected.hands.length ? (
              <div className="iboard-teacher-inbox__hand">
                {selected.hands.map((question) => (
                  <p key={question.id}>{question.text}</p>
                ))}
                <QuestionInboxReply
                  socket={socket}
                  studentId={selected.studentId}
                  studentName={selected.studentName}
                  questionText={selected.hands.map((question) => question.text).join(' · ')}
                  showToggle={false}
                  open
                  onSent={() => {
                    onHandReplySent?.(selected);
                    loadThreads(selected.studentId);
                  }}
                />
                <button
                  type="button"
                  className="mb-2 mt-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  onClick={() => onHandDismiss?.(selected)}
                >
                  Dismiss question
                </button>
              </div>
            ) : null}
            <ConversationModal
              key={selected.studentId}
              open
              variant="panel"
              socket={socket}
              role="teacher"
              studentId={selected.studentId}
              title={selected.studentName}
              subtitle="Private"
              allowUrgent
              onTeacherSent={(payload) => {
                onTeacherSent?.(payload);
                loadThreads(selected.studentId);
              }}
            />
          </>
        ) : (
          <p className="iboard-teacher-inbox__empty">Choose a student to read and reply.</p>
        )}
      </section>
    </div>
  );
}
