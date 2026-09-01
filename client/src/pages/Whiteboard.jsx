import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createSocket } from '../lib/socket.js';
import { activityStatus, wordCount } from '../lib/text.js';
import { buildEvidenceHtml, downloadTextFile, evidenceFilenames } from '../lib/exportRoom.js';
import { fileToCompressedJpegDataUrl } from '../lib/image.js';
import IBoardWordmark from '../components/IBoardWordmark.jsx';
import { gradeShortLabel } from '../components/StudentGradeSelect.jsx';
import SupaCoachLink from '../components/SupaCoachLink.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import TeacherPinGate from '../components/TeacherPinGate.jsx';
import FlipCountdown from '../components/FlipCountdown.jsx';
import RichTextDisplay from '../components/RichTextDisplay.jsx';

const TABLE_GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const MAX_BROADCAST = 6;

function toInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function normalizedTableGroup(raw) {
  const g = String(raw || '').trim().toUpperCase();
  return TABLE_GROUP_LETTERS.includes(g) ? g : null;
}

function normalizeStudentFromServer(s) {
  if (!s || typeof s !== 'object') return s;
  return {
    ...s,
    id: Number(s.id),
    name: String(s.name ?? ''),
    text: String(s.text ?? ''),
    rich_text_html: String(s.rich_text_html ?? ''),
    class_group: s.class_group != null ? String(s.class_group) : '',
    year_level: s.year_level != null ? String(s.year_level) : '',
    updated_at: s.updated_at,
    image_url: s.image_url || null,
  };
}

/** Full-screen board: up to 7 columns; row height fits ~3 rows on screen. */
function boardGridClass() {
  return 'grid grid-cols-2 content-start gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7';
}

const BoardCard = memo(function BoardCard({ s, displayName, picked, selectMode, onToggle, onRemove }) {
  const wc = wordCount(s.text);
  const st = activityStatus(s.updated_at);
  const light =
    st === 'live'
      ? 'bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.7)]'
      : st === 'warm'
        ? 'bg-amber-400'
        : 'bg-slate-600';
  const group = normalizedTableGroup(s.class_group);
  const yearLabel = gradeShortLabel(s.year_level);
  return (
    <article
      onClick={() => {
        if (selectMode) onToggle(s.id);
      }}
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-slate-900/80 shadow-xl transition ${
        picked ? 'border-violet-400 ring-2 ring-violet-400/60' : 'border-white/10'
      } ${selectMode ? 'cursor-pointer hover:border-violet-300/50' : ''}`}
    >
      <header className="flex shrink-0 items-start justify-between gap-1 border-b border-white/5 px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold tracking-tight text-white xl:text-base">
            {displayName ?? s.name}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {yearLabel && (
              <span className="inline-block rounded bg-white/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-200">
                {yearLabel}
              </span>
            )}
            {group && (
              <span className="inline-block rounded bg-indigo-500/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-300">
                {group}
              </span>
            )}
            {selectMode && (
              <span
                className={`inline-block rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                  picked ? 'bg-violet-500 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {picked ? 'On air' : 'Tap'}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SupaCoachLink />
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200">
            {wc}
          </span>
          <span className={`h-2 w-2 rounded-full ${light}`} title="Activity" />
          {!selectMode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.(s.id, s.name);
              }}
              className="flex h-5 w-5 items-center justify-center rounded bg-slate-800 text-xs font-bold text-slate-300 hover:bg-red-600 hover:text-white"
              title="Remove this student card"
            >
              ×
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2 text-xs leading-snug text-slate-200 scrollbar-thin xl:text-sm">
        {s.image_url && (
          <img
            src={s.image_url}
            alt=""
            className={`mx-auto w-full object-contain ${s.text?.trim() ? 'mb-2 max-h-28' : 'max-h-full'}`}
          />
        )}
        {s.text?.trim() ? (
          <RichTextDisplay html={s.rich_text_html} text={s.text} />
        ) : !s.image_url ? (
          <p className="italic text-slate-500">No text yet</p>
        ) : null}
      </div>
    </article>
  );
});

const POST_SIZE_CLASS = {
  1: 'col-span-1 row-span-1',
  2: 'col-span-2 row-span-1',
  3: 'col-span-2 row-span-2',
  4: 'col-span-3 row-span-2 max-xl:col-span-2',
};

const POST_TEXT_CLASS = {
  1: 'text-xs leading-snug xl:text-sm',
  2: 'text-sm leading-relaxed xl:text-base',
  3: 'text-base leading-relaxed xl:text-lg',
  4: 'text-lg leading-relaxed xl:text-xl',
};

const TeacherPostCard = memo(function TeacherPostCard({
  post,
  onDelete,
  onResize,
  selectMode,
  picked,
  onToggle,
}) {
  const size = Math.max(1, Math.min(4, Number(post.size) || 1));
  return (
    <article
      onClick={() => {
        if (selectMode) onToggle(post.id);
      }}
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-slate-900/90 shadow-xl transition ${POST_SIZE_CLASS[size]} ${
        picked
          ? 'border-violet-400 ring-2 ring-violet-400/60'
          : 'border-slate-500/50 ring-1 ring-slate-500/25'
      } ${selectMode ? 'cursor-pointer hover:border-violet-300/50' : ''}`}
    >
      <header className="flex shrink-0 items-start justify-between gap-1 border-b border-slate-500/25 px-2.5 py-2">
        <div className="min-w-0">
          <h2
            className={`truncate font-bold tracking-tight text-white ${
              size >= 3 ? 'text-base xl:text-lg' : 'text-sm xl:text-base'
            }`}
          >
            {post.title || 'Teacher'}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="inline-block rounded bg-slate-500/25 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-300">
              Teacher
            </span>
            {selectMode && (
              <span
                className={`inline-block rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                  picked ? 'bg-violet-500 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {picked ? 'On air' : 'Tap'}
              </span>
            )}
          </div>
        </div>
        {!selectMode && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={size <= 1}
              onClick={(e) => {
                e.stopPropagation();
                onResize(post.id, size - 1);
              }}
              className="rounded-lg bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
              title="Smaller"
            >
              −
            </button>
            <span className="min-w-[1.25rem] text-center text-[10px] font-bold uppercase text-slate-400">
              {['S', 'M', 'L', 'XL'][size - 1]}
            </span>
            <button
              type="button"
              disabled={size >= 4}
              onClick={(e) => {
                e.stopPropagation();
                onResize(post.id, size + 1);
              }}
              className="rounded-lg bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
              title="Larger — easier for the class to read"
            >
              +
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(post.id);
              }}
              className="rounded-lg bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-300 hover:bg-red-600 hover:text-white"
              title="Remove this card"
            >
              Remove
            </button>
          </div>
        )}
      </header>
      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2 text-slate-200 scrollbar-thin ${POST_TEXT_CLASS[size]}`}
      >
        {post.kind === 'image' && post.image_url ? (
          <img
            src={post.image_url}
            alt={post.title || 'Teacher card'}
            className="mx-auto max-h-full w-full object-contain"
          />
        ) : post.text?.trim() ? (
          <p className="whitespace-pre-wrap break-words">{post.text}</p>
        ) : (
          <p className="italic text-slate-500">Empty card</p>
        )}
      </div>
    </article>
  );
});

function WhiteboardInner() {
  const [searchParams] = useSearchParams();
  const initialCode = String(searchParams.get('code') || '')
    .replace(/\D/g, '')
    .slice(0, 4);

  const [codeInput, setCodeInput] = useState(initialCode);
  const [joined, setJoined] = useState(false);
  const [students, setStudents] = useState([]);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [chromeVisible, setChromeVisible] = useState(true);
  const [broadcastPick, setBroadcastPick] = useState({});
  const [selectMode, setSelectMode] = useState(false);
  const [showInitials, setShowInitials] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('Teacher');
  const [addText, setAddText] = useState('');
  const [addImagePreview, setAddImagePreview] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const [timesUp, setTimesUp] = useState(false);

  const socket = useMemo(() => createSocket(), []);
  const roomRef = useRef('');
  const hideTimer = useRef(null);
  const addPasteRef = useRef(null);
  const hadDisconnectRef = useRef(false);
  const backOnlineTimer = useRef(null);

  useEffect(() => {
    socket.connect();
    setSocketConnected(socket.connected);
    const onConnect = () => {
      setSocketConnected(true);
      if (hadDisconnectRef.current) {
        setBackOnline(true);
        if (backOnlineTimer.current) clearTimeout(backOnlineTimer.current);
        backOnlineTimer.current = setTimeout(() => setBackOnline(false), 2500);
      }
      hadDisconnectRef.current = false;
    };
    const onDisconnect = () => {
      setSocketConnected(false);
      hadDisconnectRef.current = true;
      setBackOnline(false);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      if (backOnlineTimer.current) clearTimeout(backOnlineTimer.current);
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    const onState = (payload) => {
      const list = (payload.students || []).map(normalizeStudentFromServer);
      setStudents((prev) => {
        if (!prev.length) return list;
        // Merge: keep fresher draft text if a live patch beat this full snapshot
        const prevById = new Map(prev.map((s) => [s.id, s]));
        return list.map((s) => {
          const old = prevById.get(s.id);
          if (!old) return s;
          if (old.updated_at && s.updated_at && String(old.updated_at) > String(s.updated_at)) {
            return {
              ...s,
              text: old.text,
              rich_text_html: old.rich_text_html,
              updated_at: old.updated_at,
            };
          }
          return s;
        });
      });
      setPosts(Array.isArray(payload.posts) ? payload.posts : []);
    };
    const onLive = ({ student: s }) => {
      if (!s?.id) return;
      const n = normalizeStudentFromServer(s);
      setStudents((prev) => {
        const i = prev.findIndex((x) => x.id === n.id);
        if (i < 0) return [...prev, n].sort((a, b) => a.id - b.id);
        const cur = prev[i];
        if (
          cur.text === n.text &&
          cur.rich_text_html === n.rich_text_html &&
          cur.updated_at === n.updated_at &&
          cur.name === n.name &&
          cur.image_url === n.image_url
        ) {
          return prev;
        }
        const next = [...prev];
        next[i] = { ...cur, ...n };
        return next;
      });
    };
    socket.on('room:state', onState);
    socket.on('student:live', onLive);
    return () => {
      socket.off('room:state', onState);
      socket.off('student:live', onLive);
    };
  }, [socket]);

  useEffect(() => {
    const rejoin = () => {
      const code = roomRef.current;
      if (!code || code.length !== 4) return;
      socket.emit('teacher:join', { code });
    };
    socket.on('connect', rejoin);
    return () => socket.off('connect', rejoin);
  }, [socket]);

  function bumpChrome() {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Keep chrome visible longer while selecting for broadcast
    const ms = selectMode ? 12000 : 4000;
    hideTimer.current = setTimeout(() => setChromeVisible(false), ms);
  }

  useEffect(() => {
    if (!joined) return;
    bumpChrome();
    const onMove = () => bumpChrome();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchstart', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchstart', onMove);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [joined, selectMode]);

  function openBoard() {
    const code = codeInput.replace(/\D/g, '').slice(0, 4).padStart(4, '0');
    if (code.length !== 4) {
      setError('Enter a 4-digit room code');
      return;
    }
    setError('');
    roomRef.current = code;
    socket.emit('teacher:join', { code }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not open room');
        return;
      }
      setCodeInput(code);
      setJoined(true);
      const url = new URL(window.location.href);
      url.searchParams.set('code', code);
      window.history.replaceState({}, '', url);
    });
  }

  useEffect(() => {
    if (initialCode.length !== 4) return;
    const code = initialCode.replace(/\D/g, '').slice(0, 4);
    if (code.length !== 4) return;
    roomRef.current = code;
    const tryJoin = () => {
      socket.emit('teacher:join', { code }, (ack) => {
        if (ack?.ok) {
          setCodeInput(code);
          setJoined(true);
        } else {
          setError(ack?.error || 'Could not open room');
        }
      });
    };
    if (socket.connected) tryJoin();
    else socket.once('connect', tryJoin);
    return () => socket.off('connect', tryJoin);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-join once from URL
  }, [socket]);

  const ordered = useMemo(
    () => [...students].sort((a, b) => a.id - b.id),
    [students]
  );

  const visible = useMemo(() => {
    if (!groupFilter) return ordered;
    return ordered.filter((s) => normalizedTableGroup(s.class_group) === groupFilter);
  }, [ordered, groupFilter]);

  const pickedCount = useMemo(
    () => Object.values(broadcastPick).filter(Boolean).length,
    [broadcastPick]
  );

  const toggleStudentPick = useCallback((id) => {
    const key = `s:${id}`;
    setBroadcastPick((p) => {
      const on = !!p[key];
      if (on) return { ...p, [key]: false };
      const count = Object.values(p).filter(Boolean).length;
      if (count >= MAX_BROADCAST) {
        setError(`Broadcast is limited to ${MAX_BROADCAST} exemplars`);
        setTimeout(() => setError(''), 2500);
        return p;
      }
      return { ...p, [key]: true };
    });
    setChromeVisible(true);
  }, []);

  const togglePostPick = useCallback((id) => {
    const key = `p:${id}`;
    setBroadcastPick((p) => {
      const on = !!p[key];
      if (on) return { ...p, [key]: false };
      const count = Object.values(p).filter(Boolean).length;
      if (count >= MAX_BROADCAST) {
        setError(`Broadcast is limited to ${MAX_BROADCAST} exemplars`);
        setTimeout(() => setError(''), 2500);
        return p;
      }
      return { ...p, [key]: true };
    });
    setChromeVisible(true);
  }, []);

  function sendBroadcast() {
    const studentIds = ordered.filter((s) => broadcastPick[`s:${s.id}`]).map((s) => s.id);
    const postIds = posts.filter((p) => broadcastPick[`p:${p.id}`]).map((p) => p.id);
    if (!studentIds.length && !postIds.length) {
      setError(`Select 1–${MAX_BROADCAST} cards, then Broadcast`);
      bumpChrome();
      return;
    }
    setError('');
    socket.emit('teacher:broadcast', { studentIds, postIds }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Broadcast failed');
        bumpChrome();
        return;
      }
      if (ack.count > 0 && ack.reached === 0) {
        setToast('Sent, but 0 student tabs connected — ask students to refresh');
      } else {
        setToast(`Broadcast ${ack.count} exemplar(s) → ${ack.reached ?? 0} student(s)`);
      }
      setBroadcastPick({});
      setSelectMode(false);
      setTimeout(() => setToast(''), 4000);
      bumpChrome();
    });
  }

  function saveAllStudentWork() {
    const pack = visible.length ? visible : ordered;
    if (!pack.length) {
      setError('No student work to save yet');
      bumpChrome();
      return;
    }
    const label = `Room ${codeInput} · ${new Date().toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
    const names = evidenceFilenames(codeInput, label);
    const html = buildEvidenceHtml({
      roomCode: codeInput,
      label,
      savedAt: new Date().toISOString(),
      students: pack,
      origin: window.location.origin,
    });

    setSaveBusy(true);
    setError('');
    socket.emit('teacher:snapshot-save', { label }, () => {
      setSaveBusy(false);
      downloadTextFile(names.html, html, 'text/html;charset=utf-8');
      setToast('Saved — open the HTML file to view or print');
      setTimeout(() => setToast(''), 4000);
      bumpChrome();
    });
  }

  function openAddCard() {
    setAddTitle('Teacher');
    setAddText('');
    setAddImagePreview('');
    setAddOpen(true);
    setChromeVisible(true);
    setTimeout(() => addPasteRef.current?.focus(), 50);
  }

  async function onAddPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      try {
        const dataUrl = await fileToCompressedJpegDataUrl(file);
        setAddImagePreview(dataUrl);
        setToast('Image ready — tap Post card');
        setTimeout(() => setToast(''), 2500);
      } catch {
        setError('Could not read that image');
        setTimeout(() => setError(''), 3000);
      }
      return;
    }
  }

  function submitTeacherCard() {
    const title = String(addTitle || 'Teacher').trim() || 'Teacher';
    if (addImagePreview) {
      setAddBusy(true);
      socket.emit(
        'teacher:board-post',
        {
          kind: 'image',
          title,
          imageBase64: addImagePreview,
          mimeType: 'image/jpeg',
        },
        (ack) => {
          setAddBusy(false);
          if (!ack?.ok) {
            setError(ack?.error || 'Could not post image card');
            bumpChrome();
            return;
          }
          setAddOpen(false);
          setAddImagePreview('');
          setToast('Teacher card posted');
          setTimeout(() => setToast(''), 2500);
          bumpChrome();
        }
      );
      return;
    }
    const text = String(addText || '').trim();
    if (!text) {
      setError('Type text or paste an image (Ctrl+V / Cmd+V)');
      bumpChrome();
      return;
    }
    setAddBusy(true);
    socket.emit('teacher:board-post', { kind: 'text', title, text }, (ack) => {
      setAddBusy(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not post card');
        bumpChrome();
        return;
      }
      setAddOpen(false);
      setAddText('');
      setToast('Teacher card posted');
      setTimeout(() => setToast(''), 2500);
      bumpChrome();
    });
  }

  function deleteTeacherPost(postId) {
    socket.emit('teacher:board-post-delete', { postId }, (ack) => {
      if (!ack?.ok) {
        setError('Could not remove card');
        bumpChrome();
        return;
      }
      setBroadcastPick((p) => {
        const next = { ...p };
        delete next[`p:${postId}`];
        return next;
      });
    });
  }

  function resizeTeacherPost(postId, size) {
    // Optimistic local update so the projector feels instant
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, size: Math.max(1, Math.min(4, size)) } : p))
    );
    socket.emit('teacher:board-post-size', { postId, size }, (ack) => {
      if (!ack?.ok) {
        setError('Could not resize card');
        bumpChrome();
      }
    });
    bumpChrome();
  }

  function clearAllCards() {
    const ok = window.confirm(
      'New class?\n\nThis clears the board — every student card and teacher card will be removed. Students will need to join again.'
    );
    if (!ok) return;
    socket.emit('teacher:clear-cards', {}, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not clear cards');
        bumpChrome();
        return;
      }
      setStudents([]);
      setPosts([]);
      setBroadcastPick({});
      setToast('Board cleared — ready for a new class');
      setTimeout(() => setToast(''), 3000);
      bumpChrome();
    });
  }

  function removeStudentCard(studentId, name) {
    const label = name ? `"${name}"` : 'this student';
    const ok = window.confirm(`Remove ${label} from the board?\n\nTheir card will disappear. They can join again with a new card.`);
    if (!ok) return;
    socket.emit('teacher:student-remove', { studentId }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not remove card');
        bumpChrome();
        return;
      }
      setStudents((prev) => prev.filter((s) => s.id !== studentId));
      setBroadcastPick((p) => {
        const next = { ...p };
        delete next[`s:${studentId}`];
        return next;
      });
      bumpChrome();
    });
  }

  if (!joined) {
    // Room code in URL (from dashboard FULL SCREEN) — skip startup form
    if (initialCode.length === 4 && !error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
          <IBoardWordmark className="text-3xl text-white" iClassName="italic text-indigo-400" />
          <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Opening room {initialCode}…
          </p>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
        <IBoardWordmark className="text-3xl text-white" iClassName="italic text-indigo-400" />
        <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-slate-400">FULL SCREEN</p>
        <p className="mt-2 max-w-sm text-center text-sm text-slate-400">
          Live student cards for the projector — up to 7 across, with class broadcast.
        </p>
        <div className="mt-8 w-full max-w-xs space-y-3">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="Room code"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-lg tracking-widest text-white outline-none ring-indigo-500 focus:ring-2"
            maxLength={4}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={openBoard}
            className="w-full rounded-xl bg-indigo-500 py-3 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            Open FULL SCREEN
          </button>
          <Link
            to={codeInput.length === 4 ? `/teacher?code=${encodeURIComponent(codeInput)}` : '/teacher'}
            onClick={(e) => {
              // Prefer returning to the existing teacher tab (no re-join / startup flash)
              if (window.opener && !window.opener.closed) {
                e.preventDefault();
                try {
                  window.opener.focus();
                } catch {
                  /* ignore */
                }
                window.close();
              }
            }}
            className="block text-center text-sm text-slate-500 hover:text-indigo-300"
          >
            ← Back to room
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {(!socketConnected || backOnline) && (
        <div
          className={`fixed inset-x-0 top-0 z-50 px-3 py-2 text-center text-sm font-semibold ${
            !socketConnected ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-white'
          }`}
        >
          {!socketConnected ? 'Connection lost — reconnecting…' : 'Back online'}
        </div>
      )}
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 z-30 flex flex-wrap items-start justify-between gap-3 px-3 py-3 transition-opacity duration-500 sm:px-5 ${
          !socketConnected || backOnline ? 'mt-9' : ''
        } ${chromeVisible || selectMode ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/95 px-3 py-2 shadow-lg backdrop-blur">
          <span className="text-xs font-semibold uppercase tracking-widest text-indigo-300">
            FULL SCREEN
          </span>
          <span className="font-mono text-sm font-bold text-white">{codeInput}</span>
          <span className="text-xs text-slate-400">
            {visible.length}/{ordered.length}
          </span>
          <FlipCountdown
            compact
            className="scale-90 origin-left"
            onFinished={() => {
              setTimesUp(true);
              bumpChrome();
              socket.emit('teacher:times-up', {});
            }}
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setGroupFilter('')}
              className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                !groupFilter ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
            {TABLE_GROUP_LETTERS.map((letter) => (
              <button
                key={letter}
                type="button"
                onClick={() => setGroupFilter(letter)}
                className={`h-6 w-6 rounded-lg text-[10px] font-bold ${
                  groupFilter === letter
                    ? 'bg-indigo-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {letter}
              </button>
            ))}
          </div>
          <div className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v);
              bumpChrome();
            }}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              selectMode
                ? 'bg-violet-500 text-white'
                : 'bg-slate-800 text-violet-200 hover:bg-violet-600 hover:text-white'
            }`}
          >
            {selectMode ? 'Selecting…' : 'Select'}
          </button>
          <button
            type="button"
            onClick={sendBroadcast}
            disabled={pickedCount === 0}
            className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            title={`Send up to ${MAX_BROADCAST} anonymised exemplars to student screens`}
          >
            Broadcast{pickedCount ? ` (${pickedCount})` : ''}
          </button>
          {pickedCount > 0 && (
            <button
              type="button"
              onClick={() => setBroadcastPick({})}
              className="rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:text-white"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowInitials((v) => !v);
              bumpChrome();
            }}
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-200 hover:bg-slate-700"
            title={showInitials ? 'Show full names' : 'Show initials only'}
          >
            {showInitials ? 'Names' : 'Initials'}
          </button>
          <div className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          <button
            type="button"
            onClick={openAddCard}
            className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-950 hover:bg-amber-400"
            title="Post your own text or paste an image"
          >
            Add card
          </button>
          <button
            type="button"
            onClick={clearAllCards}
            disabled={ordered.length === 0 && posts.length === 0}
            className="rounded-lg bg-red-700/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Clear the board for a new class"
          >
            New class
          </button>
          <button
            type="button"
            onClick={saveAllStudentWork}
            disabled={saveBusy || ordered.length === 0}
            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            title="Download student writing as an HTML file"
          >
            {saveBusy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <ThemeToggle className="border-white/10 bg-slate-900/90 text-slate-200 hover:border-indigo-400 hover:text-white dark:border-white/10 dark:bg-slate-900/90" />
          <Link
            to={codeInput.length === 4 ? `/teacher?code=${encodeURIComponent(codeInput)}` : '/teacher'}
            onClick={(e) => {
              if (window.opener && !window.opener.closed) {
                e.preventDefault();
                try {
                  window.opener.focus();
                } catch {
                  /* ignore */
                }
                window.close();
              }
            }}
            className="rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-200 backdrop-blur hover:border-indigo-400 hover:text-white"
          >
            Back to room
          </Link>
        </div>
      </div>

      {timesUp && (
        <button
          type="button"
          onClick={() => setTimesUp(false)}
          className="fixed inset-0 z-[60] flex cursor-pointer items-center justify-center bg-red-950/55 px-6 backdrop-blur-[2px]"
          aria-live="assertive"
        >
          <div className="animate-pulse rounded-3xl border-4 border-red-400 bg-red-600 px-10 py-8 text-center shadow-2xl shadow-red-900/50 sm:px-16 sm:py-12">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-100">Timer</p>
            <p className="mt-2 font-display text-5xl font-black uppercase tracking-wide text-white sm:text-7xl">
              Time&apos;s up!
            </p>
            <p className="mt-4 text-sm font-semibold text-red-100">Tap to dismiss</p>
          </div>
        </button>
      )}

      {(error || toast) && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div
            className={`rounded-xl px-4 py-2 text-sm font-medium shadow-lg ${
              error ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
            }`}
          >
            {error || toast}
          </div>
        </div>
      )}

      <main className="flex flex-1 flex-col overflow-auto px-2 pb-3 pt-14 sm:px-3 sm:pt-14">
        {ordered.length === 0 && posts.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-3xl border border-dashed border-slate-700 text-slate-500">
            Waiting for students… or tap Add card
          </div>
        )}
        {ordered.length > 0 && visible.length === 0 && posts.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-3xl border border-amber-500/30 bg-amber-500/10 text-amber-100">
            No students in group {groupFilter}
          </div>
        )}
        {(visible.length > 0 || posts.length > 0) && (
          <div
            className={boardGridClass()}
            style={{
              /* Fixed row height (~3 rows on screen) so growing text doesn't shove other cards around */
              gridAutoRows: 'calc((100dvh - 4.25rem) / 3)',
            }}
          >
            {posts.map((p) => (
              <TeacherPostCard
                key={`post-${p.id}`}
                post={p}
                onDelete={deleteTeacherPost}
                onResize={resizeTeacherPost}
                selectMode={selectMode}
                picked={!!broadcastPick[`p:${p.id}`]}
                onToggle={togglePostPick}
              />
            ))}
            {visible.map((s) => (
              <BoardCard
                key={s.id}
                s={s}
                displayName={showInitials ? toInitials(s.name) : s.name}
                picked={!!broadcastPick[`s:${s.id}`]}
                selectMode={selectMode}
                onToggle={toggleStudentPick}
                onRemove={removeStudentCard}
              />
            ))}
          </div>
        )}
      </main>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-card-title"
          >
            <div className="border-b border-white/10 px-5 py-4">
              <h2 id="add-card-title" className="text-lg font-bold text-white">
                Add teacher card
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Type text, or click the box and paste an image (Ctrl+V / Cmd+V).
              </p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Title
              </label>
              <input
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-amber-500 focus:ring-2"
                placeholder="Teacher"
              />
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Text or paste image
              </label>
              <textarea
                ref={addPasteRef}
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onPaste={onAddPaste}
                rows={5}
                disabled={!!addImagePreview}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none ring-amber-500 focus:ring-2 disabled:opacity-50"
                placeholder="Write here, or paste a screenshot…"
              />
              {addImagePreview && (
                <div className="relative overflow-hidden rounded-xl border border-amber-400/40 bg-black/40 p-2">
                  <img src={addImagePreview} alt="Paste preview" className="max-h-48 w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setAddImagePreview('')}
                    className="mt-2 text-xs font-semibold text-amber-200 hover:text-white"
                  >
                    Clear image (use text instead)
                  </button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 bg-slate-950/80 px-5 py-3">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-400 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addBusy}
                onClick={submitTeacherCard}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
              >
                {addBusy ? 'Posting…' : 'Post card'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Whiteboard() {
  return (
    <TeacherPinGate title="FULL SCREEN">
      <WhiteboardInner />
    </TeacherPinGate>
  );
}
