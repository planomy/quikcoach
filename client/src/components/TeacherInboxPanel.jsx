import { useEffect, useMemo, useRef, useState } from 'react';
import ConversationModal, { ChatCompose } from './ConversationModal.jsx';
import QuestionInboxReply from './QuestionInboxReply.jsx';
import { parseInboxAt } from '../lib/inboxTime.js';

function initialFor(name) {
  const text = String(name || '').trim();
  return text ? text.slice(0, 1).toUpperCase() : '?';
}

function queueItemsFor(row) {
  const chat = Array.isArray(row.questions) ? row.questions : [];
  const hands = (row.hands || []).map((hand) => ({
    id: `hand-${hand.id}`,
    text: String(hand.text || '').replace(/\s+/g, ' ').trim(),
    at: parseInboxAt(hand),
    unseen: true,
  }));
  return [...chat, ...hands].filter((item) => item.text);
}

function askedAtFor(row) {
  const fromServer = Number(row?.askedAt) || 0;
  const fromLast = row?.lastFrom === 'student' ? Number(row?.lastAt) || 0 : 0;
  let handAt = 0;
  for (const hand of row?.hands || []) {
    const at = parseInboxAt(hand);
    if (at > 0 && (!handAt || at < handAt)) handAt = at;
  }
  const chatAt = fromServer || fromLast;
  if (chatAt && handAt) return Math.min(chatAt, handAt);
  return chatAt || handAt || 0;
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
  noteReceiptByStudentId = {},
  onOpenThread,
  onTeacherSent,
  onHandReplySent,
  onHandDismiss,
  focusStudentId = 0,
}) {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(0);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const markedReadRef = useRef(new Set());

  function loadThreads(preferId) {
    if (!socket) return;
    socket.emit('teacher:chat-inbox', {}, (ack) => {
      if (!ack?.ok || !Array.isArray(ack.threads)) return;
      for (const thread of ack.threads) {
        if (thread.unread) markedReadRef.current.delete(Number(thread.studentId));
      }
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
      const unreadChat = !!thread.unread || noteReceiptByStudentId[id] === 'replied';
      const askedAt = askedAtFor({ ...thread, hands });
      return {
        ...thread,
        studentName: student.name || thread.studentName || 'Student',
        unread: unreadChat,
        waiting: unreadChat || hands.length > 0,
        hands,
        askedAt,
        asked: askedAt > 0 || hands.length > 0,
      };
    });
    const rowsForList = list.map((row) => {
      const items = queueItemsFor(row).sort(
        (left, right) => (left.at || 0) - (right.at || 0) || String(left.id).localeCompare(String(right.id))
      );
      if (!items.length) return row;
      const oldest = items[0];
      return {
        ...row,
        previewText: oldest.text,
        extra: items.length - 1,
        lastAt: oldest.at || row.lastAt,
        askedAt: oldest.at || row.askedAt || 0,
        asked: true,
        open: true,
        waiting: items.some((item) => item.unseen !== false),
      };
    });
    rowsForList.sort((left, right) => {
      if (!!left.open !== !!right.open) return left.open ? -1 : 1;
      if (left.open && right.open && left.askedAt !== right.askedAt) return left.askedAt - right.askedAt;
      if (!left.open && left.asked !== right.asked) return left.asked ? -1 : 1;
      return String(left.studentName).localeCompare(String(right.studentName), undefined, { sensitivity: 'base' });
    });
    return rowsForList;
  }, [students, threads, pendingHandByStudentId, noteReceiptByStudentId]);

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
  const checkedRows = [];
  const seenChecked = new Set();
  for (const row of rows) {
    const id = Number(row.studentId);
    if (!checkedIds.has(id) || seenChecked.has(id)) continue;
    seenChecked.add(id);
    checkedRows.push(row);
  }
  const fanout = checkedRows.length >= 2;

  function markRowRead(row) {
    const id = Number(row?.studentId);
    if (!id) return;
    setThreads((current) => {
      let changed = false;
      const next = current.map((thread) => {
        if (Number(thread.studentId) !== id) return thread;
        const questions = Array.isArray(thread.questions)
          ? thread.questions.map((item) => ({ ...item, unseen: false }))
          : thread.questions;
        if (!thread.unread && questions === thread.questions) return thread;
        changed = true;
        return { ...thread, unread: false, questions };
      });
      return changed ? next : current;
    });
    if (markedReadRef.current.has(id)) return;
    markedReadRef.current.add(id);
    onOpenThread?.(row);
  }

  useEffect(() => {
    const row = rows.find((item) => Number(item.studentId) === Number(selectedId));
    if (!row?.unread) return;
    markRowRead(row);
  }, [selectedId, rows]);

  function selectThread(row) {
    const id = Number(row.studentId);
    setSelectedId(id);
    markRowRead(row);
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

  const allIds = [...new Set(rows.map((row) => Number(row.studentId)).filter((id) => id > 0))];
  const allChecked = allIds.length > 0 && allIds.every((id) => checkedIds.has(id));
  const someChecked = allIds.some((id) => checkedIds.has(id));

  function toggleAll() {
    setCheckedIds(allChecked ? new Set() : new Set(allIds));
  }

  return (
    <div className="iboard-teacher-inbox">
      <aside className="iboard-teacher-inbox__list" aria-label="Inbox conversations">
        {rows.length ? (
          <div className="iboard-teacher-inbox__toolbar">
            <label className="iboard-teacher-inbox__check">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(node) => {
                  if (node) node.indeterminate = someChecked && !allChecked;
                }}
                onChange={toggleAll}
                aria-label="Select all students"
              />
            </label>
            <button type="button" className="iboard-teacher-inbox__select-all" onClick={toggleAll}>
              {allChecked ? 'Clear' : 'Select all'}
            </button>
          </div>
        ) : null}
        <div className="iboard-teacher-inbox__scroll">
          {rows.length ? rows.map((row) => {
            const on = Number(row.studentId) === Number(selectedId);
            const checked = checkedIds.has(Number(row.studentId));
            return (
              <div
                key={row.studentId}
                className={`iboard-teacher-inbox__row${on ? ' is-on' : ''}${checked ? ' is-checked' : ''}${row.waiting ? ' is-unread' : ''}${row.asked ? '' : ' is-quiet'}`}
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
                  <span className="iboard-teacher-inbox__name">{row.studentName}</span>
                  {row.waiting ? <span className="iboard-teacher-inbox__dot" aria-label="Unread" /> : null}
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
