import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseButton } from './PanelActions.jsx';
import { confirmDialog } from './ConfirmDialogHost.jsx';
import HintWrap from './HintWrap.jsx';
import './conversationModal.css';

export function ChatIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function initialFor(name) {
  const text = String(name || '').trim();
  return text ? text.slice(0, 1).toUpperCase() : '?';
}

function formatChatTime(at) {
  const ms = Number(at) || 0;
  if (!ms) return '';
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function shouldShowTime(previous, current) {
  if (!current?.at) return false;
  if (!previous?.at) return true;
  return current.at - previous.at > 8 * 60 * 1000;
}

function mergeMessages(current, incoming) {
  const byId = new Map();
  for (const item of current) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of incoming) {
    if (!item?.id || !String(item.text || '').trim()) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => Number(a.at || 0) - Number(b.at || 0) || String(a.id).localeCompare(String(b.id)));
}

function isEmojiOnly(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 16) return false;
  if (/\p{L}|\p{N}/u.test(value)) return false;
  return /\p{Extended_Pictographic}/u.test(value);
}

const CHAT_QUICK = [
  { id: 'up', label: 'Thumbs up', text: '👍' },
  { id: 'smile', label: 'Smiley', text: '😊' },
  { id: 'grin', label: 'Very smiley', text: '😄' },
  { id: 'think', label: 'Thinking', text: '🤔' },
  { id: 'wink', label: 'Big wink', text: '😉' },
  { id: 'get-it', label: 'Mmm, now I get it', text: 'Mmm, now I get it', glyph: '💡' },
];

function messageFromChatEvent(payload) {
  const message = payload?.message;
  if (!message?.id || !String(message.text || '').trim()) return null;
  return {
    id: String(message.id),
    from: message.from === 'student' ? 'student' : 'teacher',
    text: String(message.text || ''),
    at: Number(message.at) || Date.now(),
    urgent: !!message.urgent,
    studentId: Number(message.studentId) || Number(payload?.studentId) || 0,
  };
}

/**
 * Phone-style private conversation between one teacher and one student.
 */
export default function ConversationModal({
  open,
  onClose,
  socket,
  role = 'student',
  studentId,
  title,
  subtitle = 'Private',
  allowUrgent = false,
  onTeacherSent,
}) {
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const reactHoverRef = useRef(false);
  const reactCloseTimerRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [reactOpen, setReactOpen] = useState(false);
  const mine = role === 'teacher' ? 'teacher' : 'student';
  const sid = Number(studentId) || 0;

  useEffect(() => {
    if (!open || !socket) return undefined;
    setError('');
    setMessages([]);
    const eventName = role === 'teacher' ? 'teacher:chat-sync' : 'student:chat-sync';
    const payload = role === 'teacher' ? { studentId: sid } : {};
    socket.emit(eventName, payload, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not load conversation.');
        return;
      }
      setMessages(mergeMessages([], Array.isArray(ack.items) ? ack.items : []));
    });

    const onChat = (raw = {}) => {
      const next = messageFromChatEvent(raw);
      if (!next) return;
      if (role === 'teacher' && sid && next.studentId && next.studentId !== sid) return;
      setMessages((current) => mergeMessages(current, [next]));
    };

    socket.on('feedback:chat', onChat);
    return () => {
      socket.off('feedback:chat', onChat);
    };
  }, [open, socket, role, sid]);

  useEffect(() => {
    if (!open) {
      setDraft('');
      setUrgent(false);
      setMessages([]);
      setError('');
      setSending(false);
      setReactOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, messages]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (reactOpen) {
          setReactOpen(false);
          return;
        }
        requestClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, sending, draft, reactOpen]);

  async function requestClose() {
    if (sending) return;
    if (draft.trim()) {
      const discard = await confirmDialog({
        title: 'Discard message?',
        message: 'This message has not been sent.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep writing',
      });
      if (!discard) return;
    }
    onClose?.();
  }

  function sendMessage(raw, { preserveDraft = false, asUrgent = false } = {}) {
    const text = String(raw || '').trim();
    if (!text || sending || !socket) return;
    setSending(true);
    setError('');
    setReactOpen(false);
    if (!preserveDraft) setDraft('');
    if (role === 'teacher') {
      if (typeof window !== 'undefined') window.__iboardPendingNoteStudentId = sid;
      socket.emit('teacher:distribute', { items: [{ studentId: sid, text, urgent: !!asUrgent, kind: 'chat' }] }, (ack) => {
        setSending(false);
        if (!ack?.ok) {
          if (!preserveDraft) setDraft(text);
          setError(ack?.error || 'Could not send.');
          return;
        }
        const feedbackId = Number(ack.items?.[0]?.feedbackId) || 0;
        setMessages((current) =>
          mergeMessages(current, [
            {
              id: feedbackId ? `teacher-${feedbackId}` : `teacher-local-${Date.now()}`,
              from: 'teacher',
              text,
              at: Date.now(),
              urgent: !!asUrgent,
              studentId: sid,
            },
          ])
        );
        if (!preserveDraft) setUrgent(false);
        onTeacherSent?.({ studentId: sid, urgent: !!asUrgent, name: title });
      });
      return;
    }
    socket.emit('student:chat-send', { text }, (ack) => {
      setSending(false);
      if (!ack?.ok) {
        if (!preserveDraft) setDraft(text);
        setError(ack?.error || 'Could not send.');
        return;
      }
      const item = ack.message || {
        id: `student-local-${Date.now()}`,
        from: 'student',
        text,
        at: Date.now(),
        studentId: sid,
      };
      setMessages((current) => mergeMessages(current, [item]));
    });
  }

  function send() {
    sendMessage(draft, { asUrgent: urgent });
  }

  function keepReactOpen() {
    reactHoverRef.current = true;
    if (reactCloseTimerRef.current != null) {
      window.clearTimeout(reactCloseTimerRef.current);
      reactCloseTimerRef.current = null;
    }
    setReactOpen(true);
  }

  function scheduleReactClose() {
    reactHoverRef.current = false;
    if (reactCloseTimerRef.current != null) window.clearTimeout(reactCloseTimerRef.current);
    reactCloseTimerRef.current = window.setTimeout(() => {
      reactCloseTimerRef.current = null;
      if (!reactHoverRef.current) setReactOpen(false);
    }, 160);
  }

  function insertQuick(text) {
    const chunk = String(text || '');
    if (!chunk || sending) return;
    const node = inputRef.current;
    const start = node?.selectionStart ?? draft.length;
    const end = node?.selectionEnd ?? draft.length;
    const max = role === 'teacher' ? 5000 : 2000;
    const next = `${draft.slice(0, start)}${chunk}${draft.slice(end)}`.slice(0, max);
    const caret = Math.min(max, start + chunk.length);
    setDraft(next);
    requestAnimationFrame(() => {
      node?.focus();
      try {
        node?.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
    });
  }

  useEffect(() => () => {
    if (reactCloseTimerRef.current != null) window.clearTimeout(reactCloseTimerRef.current);
  }, []);

  const rows = useMemo(() => messages, [messages]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="iboard-chat-scrim" onClick={requestClose} role="presentation">
      <div
        className="iboard-chat-phone"
        role="dialog"
        aria-modal="true"
        aria-label={`Chat with ${title || 'teacher'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="iboard-chat-head">
          <span className="iboard-chat-avatar" aria-hidden="true">
            {initialFor(title)}
          </span>
          <div className="iboard-chat-head-copy">
            <h2>{title || (role === 'teacher' ? 'Student' : 'Teacher')}</h2>
            <p>{subtitle}</p>
          </div>
          <CloseButton onClick={requestClose} aria-label="Close chat" />
        </div>
        <div ref={threadRef} className="iboard-chat-thread" onPointerDown={() => setReactOpen(false)}>
          {rows.length === 0 ? (
            <p className="iboard-chat-empty">No messages yet. This stays between you and {role === 'teacher' ? title || 'this student' : 'your teacher'}.</p>
          ) : (
            rows.map((item, index) => {
              const mineBubble = item.from === mine;
              const time = shouldShowTime(rows[index - 1], item) ? formatChatTime(item.at) : '';
              return (
                <div key={item.id}>
                  {time ? <p className="iboard-chat-time">{time}</p> : null}
                  <div className={`iboard-chat-row ${mineBubble ? 'iboard-chat-row--mine' : 'iboard-chat-row--theirs'}`}>
                    <div className={`iboard-chat-bubble ${mineBubble ? 'iboard-chat-bubble--mine' : 'iboard-chat-bubble--theirs'}${isEmojiOnly(item.text) ? ' iboard-chat-bubble--emoji' : ''}`}>
                      {item.urgent ? <span className="iboard-chat-urgent">Urgent</span> : null}
                      {item.text}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {error ? <p className="iboard-chat-error">{error}</p> : null}
        <div className="iboard-chat-dock">
          {reactOpen ? (
            <div
              className="iboard-chat-react"
              role="listbox"
              aria-label="Quick replies"
              onMouseEnter={keepReactOpen}
              onMouseLeave={scheduleReactClose}
            >
              {CHAT_QUICK.map((chip) => (
                <HintWrap key={chip.id} hint={chip.label} prefer="above" className="w-full">
                  <button
                    type="button"
                    role="option"
                    className="iboard-chat-react__chip"
                    disabled={sending}
                    aria-label={chip.label}
                    onClick={() => insertQuick(chip.text)}
                  >
                    {chip.glyph || chip.text}
                  </button>
                </HintWrap>
              ))}
            </div>
          ) : null}
          <form
            className="iboard-chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            {allowUrgent ? (
              <HintWrap hint={urgent ? 'Urgent on — they will see a toast' : 'Mark urgent — they will see a toast'} prefer="above">
                <button
                  type="button"
                  className="iboard-chat-urgent-toggle"
                  aria-pressed={urgent}
                  title=""
                  aria-label={urgent ? 'Urgent on' : 'Mark urgent'}
                  onClick={() => setUrgent((current) => !current)}
                >
                  !
                </button>
              </HintWrap>
            ) : null}
            <HintWrap hint="Quick replies" prefer="above" suppressed={reactOpen}>
              <button
                type="button"
                className="iboard-chat-react-toggle"
                aria-expanded={reactOpen}
                aria-label={reactOpen ? 'Hide quick replies' : 'Quick replies'}
                onMouseEnter={keepReactOpen}
                onMouseLeave={scheduleReactClose}
                onClick={() => setReactOpen((current) => !current)}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8.4 14.2c1.1 1.2 2.3 1.8 3.6 1.8s2.5-.6 3.6-1.8" />
                  <path d="M9 10.1h.01M15 10.1h.01" />
                </svg>
              </button>
            </HintWrap>
            <textarea
              ref={inputRef}
              rows={1}
              maxLength={role === 'teacher' ? 5000 : 2000}
              value={draft}
              placeholder="Message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className="iboard-chat-send" disabled={sending || !draft.trim()} aria-label="Send">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M3.4 20.6 21 12 3.4 3.4 3 10.2l11.2 1.8L3 13.8z" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
