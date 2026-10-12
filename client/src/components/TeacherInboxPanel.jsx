import { useEffect, useMemo, useRef, useState } from 'react';
import ConversationModal, { ChatCompose } from './ConversationModal.jsx';
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

function recipientLabel(list) {
  const names = list.map((row) => row.studentName).filter(Boolean);
  if (names.length <= 1) return names[0] || 'these students';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others`;
}

function InboxFanoutCompose({ recipients, socket, onSent }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  function send() {
    const text = String(draft || '').trim();
    const items = recipients
      .map((row) => ({
        studentId: Number(row.studentId),
        text,
        urgent: !!urgent,
        kind: 'chat',
      }))
      .filter((item) => item.studentId > 0 && item.text);
    if (!items.length || sending || !socket) return;
    setSending(true);
    setError('');
    setDraft('');
    socket.emit('teacher:distribute', { items }, (ack) => {
      setSending(false);
      if (!ack?.ok) {
        setDraft(text);
        setError(ack?.error || 'Could not send.');
        return;
      }
      setUrgent(false);
      onSent?.({
        studentIds: items.map((item) => item.studentId),
        urgent: !!urgent,
        name: recipientLabel(recipients),
      });
    });
  }

  return (
    <div className="iboard-chat-pane" role="region" aria-label={`Private message to ${recipientLabel(recipients)}`}>
      <div className="iboard-chat-pane__head">
        <h2>Private message to {recipientLabel(recipients)}</h2>
      </div>
      <div className="iboard-chat-thread">
        <p className="iboard-chat-empty">Each student gets a private copy.</p>
      </div>
      {error ? <p className="iboard-chat-error">{error}</p> : null}
      <ChatCompose
        allowUrgent
        draft={draft}
        onDraftChange={setDraft}
        urgent={urgent}
        onUrgentChange={setUrgent}
        sending={sending}
        role="teacher"
        inputRef={inputRef}
        onSend={send}
      />
    </div>
  );
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
  const [checkedIds, setCheckedIds] = useState(() => new Set());

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

  useEffect(() => {
    const live = new Set(rows.map((row) => Number(row.studentId)));
    setCheckedIds((current) => {
      const next = new Set([...current].filter((id) => live.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [rows]);

  const selected = rows.find((row) => Number(row.studentId) === Number(selectedId)) || null;
  const checkedRows = rows.filter((row) => checkedIds.has(Number(row.studentId)));
  const fanout = checkedRows.length >= 2;

  function selectThread(row) {
    const id = Number(row.studentId);
    setSelectedId(id);
    onOpenThread?.(row);
  }

  function toggleChecked(row, on) {
    const id = Number(row.studentId);
    if (!id) return;
    setCheckedIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="iboard-teacher-inbox">
      <aside className="iboard-teacher-inbox__list" aria-label="Inbox conversations">
        <div className="iboard-teacher-inbox__scroll">
          {rows.length ? rows.map((row) => {
            const on = Number(row.studentId) === Number(selectedId);
            const checked = checkedIds.has(Number(row.studentId));
            return (
              <div
                key={row.studentId}
                className={`iboard-teacher-inbox__row${on ? ' is-on' : ''}${checked ? ' is-checked' : ''}${row.waiting ? ' is-unread' : ''}`}
              >
                <label className="iboard-teacher-inbox__check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleChecked(row, event.target.checked)}
                    aria-label={`Select ${row.studentName}`}
                  />
                </label>
                <button
                  type="button"
                  className="iboard-teacher-inbox__open"
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
              </div>
            );
          }) : (
            <p className="iboard-teacher-inbox__empty">No students in the room yet.</p>
          )}
        </div>
      </aside>
      <section className="iboard-teacher-inbox__thread" aria-label={fanout ? 'Message several students' : 'Conversation'}>
        {fanout ? (
          <InboxFanoutCompose
            key={[...checkedIds].sort((a, b) => a - b).join('-')}
            recipients={checkedRows}
            socket={socket}
            onSent={(payload) => {
              onTeacherSent?.(payload);
              setCheckedIds(new Set());
              loadThreads(selectedId);
            }}
          />
        ) : selected ? (
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
