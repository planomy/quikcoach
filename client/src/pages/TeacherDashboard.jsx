import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createSocket } from '../lib/socket.js';
import { activityStatus, wordCount } from '../lib/text.js';
import {
  buildAiPrompt,
  parseNumberedPaste,
  normalizeFeedbackMode,
  FEEDBACK_MODES,
  SUBJECT_ASSIST_OPTIONS,
  YEAR_LEVEL_OPTIONS,
  MODE_TOGGLE_LABELS,
} from '../lib/feedbackPrompt.js';
import AppFooter from '../components/AppFooter.jsx';
import IBoardWordmark from '../components/IBoardWordmark.jsx';
import { gradeShortLabel } from '../components/StudentGradeSelect.jsx';
import SupaCoachLink from '../components/SupaCoachLink.jsx';
import TeacherPinGate from '../components/TeacherPinGate.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import LiveResponseTeacher from '../components/LiveResponseTeacher.jsx';
import RichTextDisplay from '../components/RichTextDisplay.jsx';
import {
  downloadTextFile,
  buildEvidenceHtml,
  evidenceFilenames,
  buildStudentEvidenceText,
  buildStudentPortfolioHtml,
  buildStudentPortfolioText,
} from '../lib/exportRoom.js';

const MODE_LABELS = {
  writing: 'Writing',
  explanation: 'Explanation',
  argument: 'Argument',
  problem_solving: 'Problem Solving',
  custom: 'Custom',
};

/** Fixed “table” groups for quick assignment (stored as one letter in `class_group`). */
const TABLE_GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const GROUP_FILTER_UNASSIGNED = '__unassigned__';

const TEACHER_WORKSPACES = [
  { id: 'live', label: 'Live', icon: '●' },
  { id: 'pulse', label: 'Pulse', icon: '◉' },
  { id: 'feedback', label: 'Feedback', icon: '✦' },
  { id: 'evidence', label: 'Evidence', icon: '▣' },
  { id: 'reports', label: 'Reports', icon: '≡' },
];

const CARD_VIEW_STORAGE_KEY = 'iboard-teacher-card-view';
const CARD_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'reading', label: 'Reading' },
  { id: 'full', label: 'Full drafts' },
];

function initialCardView() {
  if (typeof window === 'undefined') return 'overview';
  try {
    const saved = localStorage.getItem(CARD_VIEW_STORAGE_KEY);
    return CARD_VIEWS.some((view) => view.id === saved) ? saved : 'overview';
  } catch {
    return 'overview';
  }
}

function normalizedTableGroup(raw) {
  const g = String(raw || '').trim().toUpperCase();
  return TABLE_GROUP_LETTERS.includes(g) ? g : null;
}

/** Saved room settings with this version use merged toggles; older saves default to all-on. */
const FEEDBACK_SETTINGS_VERSION = 2;

function defaultModeToggles() {
  const o = {};
  for (const m of FEEDBACK_MODES) {
    o[m] = {};
    for (const k of Object.keys(MODE_TOGGLE_LABELS[m] || {})) {
      o[m][k] = true;
    }
  }
  return o;
}

function emptyExtraFocusState() {
  return {
    writing: [],
    explanation: [],
    argument: [],
    problem_solving: [],
    custom: [],
  };
}

function newFocusId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `xf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function randomRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Keep `class_group` and ids stable when merging socket + REST payloads. */
function normalizeStudentFromServer(s) {
  if (!s || typeof s !== 'object') return s;
  return {
    ...s,
    id: Number(s.id),
    name: String(s.name ?? ''),
    text: String(s.text ?? ''),
    rich_text_html: String(s.rich_text_html ?? ''),
    room_code: s.room_code != null ? String(s.room_code) : '',
    updated_at: s.updated_at,
    class_group: s.class_group != null ? String(s.class_group) : '',
    year_level: s.year_level != null ? String(s.year_level) : '',
    image_url: s.image_url || null,
  };
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 shadow-sm transition hover:border-indigo-200">
      <span className="min-w-0 flex-1 pr-2">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-indigo-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white dark:bg-slate-900 shadow transition ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}

function TeacherDashboardInner() {
  const [searchParams] = useSearchParams();
  const codeFromLink = String(searchParams.get('code') || '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const [codeInput, setCodeInput] = useState(codeFromLink);
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState(null);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');
  const [socketConnected, setSocketConnected] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState('writing');
  const [subjectAssist, setSubjectAssist] = useState('general');
  const [yearLevel, setYearLevel] = useState('general');
  const [customFocusText, setCustomFocusText] = useState('');
  const [modeToggles, setModeToggles] = useState(defaultModeToggles);
  const [extraFocusByMode, setExtraFocusByMode] = useState(emptyExtraFocusState);
  const [addFocusDraft, setAddFocusDraft] = useState('');

  const [pasteBox, setPasteBox] = useState('');
  const [copyToast, setCopyToast] = useState('');
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteError, setNoteError] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [broadcastPick, setBroadcastPick] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [evidenceStudents, setEvidenceStudents] = useState([]);
  const [evidenceStudentsBusy, setEvidenceStudentsBusy] = useState(false);
  const [selectedEvidenceStudentKey, setSelectedEvidenceStudentKey] = useState('');
  const [snapshotViewer, setSnapshotViewer] = useState(null);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState('live');
  const [cardView, setCardView] = useState(initialCardView);
  const [focusedStudentId, setFocusedStudentId] = useState(null);

  const socket = useMemo(() => createSocket(), []);
  const teacherRoomRef = useRef('');
  const joinedRef = useRef(false);
  const autoJoinTriedRef = useRef(false);

  const pushSettings = useCallback(
    (partial) => {
      if (!room) return;
      socket.emit('teacher:settings', partial);
    },
    [room, socket]
  );

  useEffect(() => {
    socket.connect();
    setSocketConnected(socket.connected);
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setSocketConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    try {
      localStorage.setItem(CARD_VIEW_STORAGE_KEY, cardView);
    } catch {
      /* The view still works when browser storage is unavailable. */
    }
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('iboard:teacher-layout')));
    return () => cancelAnimationFrame(frame);
  }, [cardView]);

  const hydrateFeedbackStateFromRoom = useCallback((r) => {
    if (!r?.feedback_toggles) return;
    const ft = r.feedback_toggles;
    setFeedbackMode(normalizeFeedbackMode(r.genre));
    setSubjectAssist(ft.subjectAssist ?? 'general');
    const rawYl = ft.yearLevel ?? ft.year_level;
    setYearLevel(
      rawYl != null && String(rawYl).trim() !== '' ? String(rawYl).trim() : 'general'
    );
    setCustomFocusText(ft.customFocusText ?? '');
    const defaults = defaultModeToggles();
    const v = ft.version ?? 0;
    let next;
    if (v >= FEEDBACK_SETTINGS_VERSION && ft.modes) {
      next = { ...defaults };
      for (const m of FEEDBACK_MODES) {
        next[m] = { ...defaults[m], ...(ft.modes[m] || {}) };
      }
    } else {
      next = defaults;
    }
    setModeToggles(next);
    const ex = emptyExtraFocusState();
    if (ft.extraFocuses) {
      for (const m of FEEDBACK_MODES) {
        const list = ft.extraFocuses[m];
        ex[m] = Array.isArray(list)
          ? list.map((x) => ({
              id: x.id || newFocusId(),
              text: String(x.text || ''),
              enabled: x.enabled !== false,
            }))
          : [];
      }
    }
    setExtraFocusByMode(ex);
  }, []);

  useEffect(() => {
    const rejoinIfTeacher = () => {
      const code = teacherRoomRef.current;
      if (!joinedRef.current || !code || code.length !== 4) return;
      socket.emit('teacher:join', { code });
    };
    socket.on('connect', rejoinIfTeacher);
    return () => socket.off('connect', rejoinIfTeacher);
  }, [socket]);

  useEffect(() => {
    const onState = (payload) => {
      setRoom(payload.room);
      setStudents((payload.students || []).map(normalizeStudentFromServer));
      const r = payload.room;
      if (!modalOpen && r?.feedback_toggles) {
        hydrateFeedbackStateFromRoom(r);
      }
    };
    const onLive = ({ student: s }) => {
      if (!s?.id) return;
      const row = normalizeStudentFromServer(s);
      setStudents((prev) => {
        const i = prev.findIndex((x) => x.id === row.id);
        if (i === -1) {
          return [...prev, row].sort((a, b) => a.id - b.id);
        }
        const cur = prev[i];
        if (
          cur.text === row.text &&
          cur.rich_text_html === row.rich_text_html &&
          cur.updated_at === row.updated_at &&
          cur.name === row.name &&
          cur.class_group === row.class_group &&
          cur.year_level === row.year_level
        ) {
          return prev;
        }
        const next = [...prev];
        next[i] = { ...cur, ...row };
        return next;
      });
    };
    socket.on('room:state', onState);
    socket.on('student:live', onLive);
    return () => {
      socket.off('room:state', onState);
      socket.off('student:live', onLive);
    };
  }, [socket, modalOpen, hydrateFeedbackStateFromRoom]);

  const prevModalOpenRef = useRef(false);
  useEffect(() => {
    if (modalOpen && !prevModalOpenRef.current && room?.feedback_toggles) {
      hydrateFeedbackStateFromRoom(room);
    }
    prevModalOpenRef.current = modalOpen;
  }, [modalOpen, room, hydrateFeedbackStateFromRoom]);

  async function createOrJoin(overrideCode) {
    setError('');
    const digits = String(overrideCode ?? codeInput)
      .replace(/\D/g, '')
      .slice(0, 4);
    if (digits.length !== 4) {
      setError('Enter a 4-digit room code.');
      return;
    }
    const code = digits.padStart(4, '0');
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error('Could not open room');
      teacherRoomRef.current = code;
      if (!socket.connected) {
        socket.connect();
        try {
          await new Promise((resolve, reject) => {
            if (socket.connected) return resolve();
            const t = setTimeout(() => reject(new Error('timeout')), 15000);
            const done = () => {
              clearTimeout(t);
              socket.off('connect_error', onErr);
            };
            const onErr = (e) => {
              done();
              reject(e);
            };
            socket.once('connect', () => {
              done();
              resolve();
            });
            socket.once('connect_error', onErr);
          });
        } catch {
          setError('Cannot connect for live class updates — is the server running?');
          return;
        }
      }
      socket.emit('teacher:join', { code }, async (ack) => {
        if (!ack?.ok) {
          teacherRoomRef.current = '';
          joinedRef.current = false;
          setError(ack?.error || 'Could not join room');
          return;
        }
        joinedRef.current = true;
        setJoined(true);
        setCodeInput(code);
        try {
          const snap = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
          if (snap.ok) {
            const data = await snap.json();
            setRoom(data.room);
            setStudents((data.students || []).map(normalizeStudentFromServer));
            hydrateFeedbackStateFromRoom(data.room);
          }
        } catch {
          /* room:state from socket will catch up */
        }
      });
    } catch {
      setError('Network error — is the server running?');
    }
  }

  useEffect(() => {
    if (autoJoinTriedRef.current || joined) return;
    if (codeFromLink.length !== 4) return;
    autoJoinTriedRef.current = true;
    void createOrJoin(codeFromLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot return from FULL SCREEN
  }, [codeFromLink]);

  function setModeToggle(mode, key, value) {
    setModeToggles((prev) => ({
      ...prev,
      [mode]: { ...prev[mode], [key]: value },
    }));
  }

  function setExtraFocusEnabled(mode, id, enabled) {
    setExtraFocusByMode((prev) => ({
      ...prev,
      [mode]: (prev[mode] || []).map((x) => (x.id === id ? { ...x, enabled } : x)),
    }));
  }

  function removeExtraFocus(mode, id) {
    setExtraFocusByMode((prev) => ({
      ...prev,
      [mode]: (prev[mode] || []).filter((x) => x.id !== id),
    }));
  }

  function addCustomFocusLine() {
    const t = addFocusDraft.trim();
    if (!t) return;
    const id = newFocusId();
    setExtraFocusByMode((prev) => ({
      ...prev,
      [feedbackMode]: [...(prev[feedbackMode] || []), { id, text: t, enabled: true }],
    }));
    setAddFocusDraft('');
  }

  const orderedStudents = useMemo(
    () => [...students].sort((a, b) => a.id - b.id),
    [students]
  );

  const visibleStudents = useMemo(() => {
    if (groupFilter === GROUP_FILTER_UNASSIGNED) {
      return orderedStudents.filter((s) => normalizedTableGroup(s.class_group) === null);
    }
    if (groupFilter && TABLE_GROUP_LETTERS.includes(groupFilter)) {
      return orderedStudents.filter((s) => normalizedTableGroup(s.class_group) === groupFilter);
    }
    return orderedStudents;
  }, [orderedStudents, groupFilter]);

  useEffect(() => {
    if (!joined || codeInput.length !== 4) return;
    fetch(`/api/rooms/${codeInput}/snapshots`)
      .then((r) => r.json())
      .then((d) => setSnapshots(Array.isArray(d.snapshots) ? d.snapshots : []))
      .catch(() => {});
  }, [joined, codeInput]);

  useEffect(() => {
    if (!joined || !snapshotsOpen || codeInput.length !== 4 || !snapshots.length) return;
    let cancelled = false;
    setEvidenceStudentsBusy(true);
    fetch(`/api/rooms/${codeInput}/evidence-students`)
      .then((r) => {
        if (!r.ok) throw new Error('Could not load student evidence');
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const profiles = Array.isArray(data.students) ? data.students : [];
        setEvidenceStudents(profiles);
        setSelectedEvidenceStudentKey((current) => (
          current && profiles.some((profile) => profile.key === current) ? current : ''
        ));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load student evidence history');
      })
      .finally(() => {
        if (!cancelled) setEvidenceStudentsBusy(false);
      });
    return () => { cancelled = true; };
  }, [joined, codeInput, snapshotsOpen, snapshots.length]);

  const selectedEvidenceStudent = useMemo(
    () => evidenceStudents.find((profile) => profile.key === selectedEvidenceStudentKey) || null,
    [evidenceStudents, selectedEvidenceStudentKey]
  );

  /** When the modal is closed, prefer server `room` for the AI prompt so Copy for AI matches saved settings (avoids stale React state before/without socket sync). */
  const promptModeKey = useMemo(() => {
    if (modalOpen) return feedbackMode;
    return normalizeFeedbackMode(room?.genre ?? feedbackMode);
  }, [modalOpen, room?.genre, feedbackMode]);

  const promptSubjectAssist = useMemo(() => {
    if (modalOpen) return subjectAssist;
    const s = room?.feedback_toggles?.subjectAssist;
    if (s != null && SUBJECT_ASSIST_OPTIONS.some((o) => o.id === s)) return s;
    return subjectAssist;
  }, [modalOpen, room?.feedback_toggles?.subjectAssist, subjectAssist]);

  const promptYearLevel = useMemo(() => {
    if (modalOpen) return yearLevel;
    const ft = room?.feedback_toggles;
    const y = ft?.yearLevel ?? ft?.year_level;
    const yStr = y == null ? '' : String(y).trim();
    if (yStr !== '' && YEAR_LEVEL_OPTIONS.some((o) => o.id === yStr)) return yStr;
    return yearLevel;
  }, [modalOpen, room?.feedback_toggles?.yearLevel, yearLevel]);

  const promptCustomFocusText = useMemo(() => {
    if (modalOpen) return customFocusText;
    const t = room?.feedback_toggles?.customFocusText;
    return t != null ? String(t) : customFocusText;
  }, [modalOpen, room?.feedback_toggles?.customFocusText, customFocusText]);

  const enabledExtraLabels = useMemo(() => {
    return (extraFocusByMode[promptModeKey] || [])
      .filter((x) => x.enabled && x.text.trim())
      .map((x) => x.text.trim());
  }, [extraFocusByMode, promptModeKey]);

  const aiPrompt = useMemo(() => {
    return buildAiPrompt({
      feedbackMode: normalizeFeedbackMode(promptModeKey),
      subjectAssist: promptSubjectAssist,
      yearLevel: promptYearLevel,
      customFocusText: promptCustomFocusText,
      toggles: modeToggles[promptModeKey] || {},
      extraFocusLabels: enabledExtraLabels,
      students: visibleStudents,
      wordTarget: room?.word_target ?? 0,
    });
  }, [
    promptModeKey,
    promptSubjectAssist,
    promptYearLevel,
    promptCustomFocusText,
    modeToggles,
    enabledExtraLabels,
    visibleStudents,
    room?.word_target,
  ]);

  const aiPayloadStats = useMemo(() => {
    const promptChars = aiPrompt.length;
    const draftChars = visibleStudents.reduce((n, s) => n + (s.text || '').length, 0);
    const totalDraftWords = visibleStudents.reduce((n, s) => n + wordCount(s.text || ''), 0);
    const promptKb = Math.round((promptChars / 1024) * 10) / 10;
    let level = 'ok';
    if (promptChars >= 140_000 || draftChars >= 120_000) level = 'heavy';
    else if (promptChars >= 55_000 || draftChars >= 45_000) level = 'warn';
    return { promptChars, draftChars, totalDraftWords, promptKb, level };
  }, [aiPrompt, visibleStudents]);

  async function copyForAi() {
    try {
      await navigator.clipboard.writeText(aiPrompt);
      setCopyToast('Copied structured prompt');
      setTimeout(() => setCopyToast(''), 2500);
    } catch {
      setCopyToast('Copy failed — select and copy manually');
      setTimeout(() => setCopyToast(''), 3500);
    }
  }

  function distributePaste() {
    const parsed = parseNumberedPaste(pasteBox);
    if (!parsed.length) {
      setError('Could not parse numbered feedback. Use lines like: 1. [Your feedback]');
      return;
    }
    const items = visibleStudents
      .map((s, i) => {
        const n = i + 1;
        const row = parsed.find((p) => p.index === n);
        return row ? { studentId: s.id, text: row.text } : null;
      })
      .filter(Boolean);
    if (!items.length) {
      setError('No matching numbers for current students.');
      return;
    }
    setError('');
    socket.emit('teacher:distribute', { items }, (ack) => {
      if (!ack?.ok) setError('Could not send feedback.');
      else {
        setPasteBox('');
        setCopyToast(`Sent to ${items.length} student(s)`);
        setTimeout(() => setCopyToast(''), 2500);
      }
    });
  }

  function updateStudentGroupDraft(studentId, class_group) {
    setStudents((prev) =>
      prev.map((x) => (x.id === studentId ? { ...x, class_group: String(class_group) } : x))
    );
  }

  function commitStudentGroup(studentId, class_group) {
    socket.emit('teacher:student-group', { studentId, class_group }, (ack) => {
      if (!ack?.ok) setError('Could not update group');
    });
  }

  /** Set group to A–E or clear. Always commits immediately (no blur needed). */
  function setStudentTableGroup(studentId, letterOrEmpty) {
    const g =
      letterOrEmpty === '' || letterOrEmpty == null
        ? ''
        : TABLE_GROUP_LETTERS.includes(String(letterOrEmpty).toUpperCase())
          ? String(letterOrEmpty).toUpperCase()
          : '';
    updateStudentGroupDraft(studentId, g);
    commitStudentGroup(studentId, g);
  }

  function openNoteForStudent(student) {
    setNoteTarget({ id: Number(student.id), name: String(student.name || 'Student') });
    setNoteDraft('');
    setNoteError('');
    setNoteSending(false);
  }

  function closeNoteComposer() {
    if (noteSending) return;
    setNoteTarget(null);
    setNoteDraft('');
    setNoteError('');
  }

  function sendNoteToStudent() {
    if (!noteTarget || noteSending) return;
    const text = noteDraft.trim();
    if (!text) {
      setNoteError('Write a note before sending.');
      return;
    }

    const target = noteTarget;
    setNoteError('');
    setNoteSending(true);
    window.__iboardPendingNoteStudentId = target.id;
    socket.emit('teacher:distribute', { items: [{ studentId: target.id, text }] }, (ack) => {
      setNoteSending(false);
      if (!ack?.ok) {
        setNoteError(ack?.error || 'Could not send this note.');
        return;
      }
      setNoteTarget(null);
      setNoteDraft('');
      setCopyToast(`Note sent to ${target.name}`);
      setTimeout(() => setCopyToast(''), 2500);
    });
  }

  function sendBroadcastToClass() {
    /** Use everyone in the room, not only the group filter — otherwise a filter can hide checked cards and send zero IDs. */
    const ids = orderedStudents.filter((s) => broadcastPick[s.id]).map((s) => s.id).slice(0, 6);
    if (!ids.length) {
      setError(
        'Tick “Include in broadcast” on at least one student card (up to 6). Names are not sent — only Exemplar A, B, …'
      );
      return;
    }
    setError('');
    socket.emit('teacher:broadcast', { studentIds: ids }, (ack) => {
      if (!ack?.ok) setError(ack?.error || 'Broadcast failed — check you opened the room and students are connected');
      else {
        if (ack.count > 0 && ack.reached === 0) {
          setCopyToast('Sent, but 0 student tabs connected — ask students to refresh');
        } else {
          setCopyToast(`Broadcast: ${ack.count} exemplar(s) → ${ack.reached ?? 0} student(s)`);
        }
        setTimeout(() => setCopyToast(''), 4000);
        setBroadcastPick({});
      }
    });
  }

  function openEvidenceModal() {
    const now = new Date();
    const defaultLabel = `Room ${codeInput} · ${now.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
    setEvidenceLabel(defaultLabel);
    setEvidenceModalOpen(true);
  }

  function downloadEvidenceHtml({ label, students: packStudents }) {
    const names = evidenceFilenames(codeInput, label);
    const savedAt = new Date().toISOString();
    const modeLabel = MODE_LABELS[normalizeFeedbackMode(room?.genre)] || '';
    const subjectLabel =
      SUBJECT_ASSIST_OPTIONS.find((o) => o.id === room?.feedback_toggles?.subjectAssist)?.label || '';
    const yearLabel =
      YEAR_LEVEL_OPTIONS.find((o) => o.id === room?.feedback_toggles?.yearLevel)?.label || '';
    const html = buildEvidenceHtml({
      roomCode: codeInput,
      label,
      savedAt,
      students: packStudents,
      modeLabel,
      subjectLabel: subjectLabel !== 'General' ? subjectLabel : '',
      yearLabel: yearLabel && !String(yearLabel).startsWith('General') ? yearLabel : '',
      origin: window.location.origin,
    });
    downloadTextFile(names.html, html, 'text/html;charset=utf-8');
  }

  function saveEvidenceOfLearning() {
    const label = String(evidenceLabel || '').trim();
    if (!label) {
      setError('Add a short label (e.g. lesson focus).');
      return;
    }
    const packStudents = visibleStudents.length ? visibleStudents : orderedStudents;
    if (!packStudents.length) {
      setError('No student work to save yet.');
      return;
    }
    setEvidenceBusy(true);
    setError('');
    socket.emit('teacher:snapshot-save', { label }, (ack) => {
      setEvidenceBusy(false);
      if (ack?.ok) setSnapshots(ack.snapshots || []);
      downloadEvidenceHtml({ label, students: packStudents });
      setEvidenceModalOpen(false);
      setCopyToast('Saved — open the HTML file to view or print');
      setTimeout(() => setCopyToast(''), 4000);
    });
  }

  function downloadOneStudent(s) {
    const names = evidenceFilenames(codeInput, s.name);
    const text = buildStudentEvidenceText({
      roomCode: codeInput,
      student: s,
      label: `Individual evidence · Room ${codeInput}`,
      savedAt: new Date().toISOString(),
    });
    downloadTextFile(names.studentTxt(s.name, s.id), text, 'text/plain;charset=utf-8');
    setCopyToast(`Saved ${s.name}`);
    setTimeout(() => setCopyToast(''), 2000);
  }

  async function loadSnapshotForView(id) {
    try {
      const r = await fetch(`/api/rooms/${codeInput}/snapshots/${id}`);
      if (!r.ok) return;
      const data = await r.json();
      setSnapshotViewer(data);
    } catch {
      setError('Could not load snapshot');
    }
  }

  async function redownloadEvidence(id) {
    try {
      const r = await fetch(`/api/rooms/${codeInput}/snapshots/${id}`);
      if (!r.ok) throw new Error('fail');
      const data = await r.json();
      const students = data.payload?.students || [];
      downloadEvidenceHtml({
        label: data.label || `Evidence #${id}`,
        students,
      });
      setCopyToast('Saved — open the HTML file to view or print');
      setTimeout(() => setCopyToast(''), 4000);
    } catch {
      setError('Could not open evidence pack');
    }
  }

  async function copyStudentPortfolio() {
    if (!selectedEvidenceStudent) return;
    const text = buildStudentPortfolioText({
      roomCode: codeInput,
      studentName: selectedEvidenceStudent.name,
      entries: selectedEvidenceStudent.entries,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast(`Copied ${selectedEvidenceStudent.name}’s evidence`);
    } catch {
      setCopyToast('Copy failed — download the portfolio instead');
    }
    setTimeout(() => setCopyToast(''), 3000);
  }

  function downloadStudentPortfolio() {
    if (!selectedEvidenceStudent) return;
    const html = buildStudentPortfolioHtml({
      roomCode: codeInput,
      studentName: selectedEvidenceStudent.name,
      entries: selectedEvidenceStudent.entries,
    });
    const names = evidenceFilenames(codeInput, `${selectedEvidenceStudent.name}-portfolio`);
    downloadTextFile(names.html, html, 'text/html;charset=utf-8');
    setCopyToast(`Downloaded ${selectedEvidenceStudent.name}’s portfolio`);
    setTimeout(() => setCopyToast(''), 3000);
  }

  function startNewClass() {
    const ok = window.confirm(
      'Start a new class?\n\nThis removes every student card and teacher card from this room. Students will need to join again.'
    );
    if (!ok) return;
    socket.emit('teacher:clear-cards', {}, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not clear cards');
        return;
      }
      setStudents([]);
      setBroadcastPick({});
      setActiveWorkspace('live');
      setCopyToast('Board cleared — ready for a new class');
      setTimeout(() => setCopyToast(''), 3000);
    });
  }

  function saveFeedbackSettings() {
    if (!room) return;
    pushSettings({
      genre: feedbackMode,
      /** Root-level duplicate: some clients/proxies mishandle nested `yearLevel`; server merges this into `feedback_toggles`. */
      teacherYearLevel: yearLevel,
      feedback_toggles: {
        version: FEEDBACK_SETTINGS_VERSION,
        subjectAssist,
        yearLevel,
        customFocusText,
        modes: modeToggles,
        extraFocuses: extraFocusByMode,
      },
    });
    setModalOpen(false);
  }

  if (!joined) {
    // Returning from FULL SCREEN with ?code= — skip startup form
    if (codeFromLink.length === 4 && !error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
          <IBoardWordmark className="text-2xl" iClassName="italic text-indigo-600" />
          <p className="mt-6 text-sm font-semibold text-slate-600 dark:text-slate-400">
            Opening room {codeFromLink}…
          </p>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-1 flex-col px-4 py-10">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <IBoardWordmark className="text-2xl" iClassName="italic text-indigo-600" />
              <ThemeToggle />
            </div>
            <h1 className="font-display mt-6 text-xl font-bold text-ink-900 dark:text-slate-100">Teacher dashboard</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Create a room with a 4-digit code, or enter an existing code. Students join at the main site with that code
              (they do not see this teacher page).
            </p>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Room code
              </label>
              <div className="flex gap-2">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="e.g. 4821"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 font-mono text-lg tracking-widest outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                  maxLength={4}
                />
                <button
                  type="button"
                  onClick={() => setCodeInput(randomRoomCode())}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-800"
                >
                  Random
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={() => createOrJoin()}
                className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lift hover:bg-indigo-700"
              >
                Open room
              </button>
              <a
                href={codeInput.length === 4 ? `/pulse/teacher?code=${encodeURIComponent(codeInput)}` : '/pulse/teacher'}
                className="block w-full rounded-xl bg-violet-100 py-3 text-center text-sm font-black text-violet-800 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-200"
              >
                Open Pulse only
              </a>
              <button
                type="button"
                onClick={async () => {
                  const base = `${window.location.origin}/student`;
                  const url =
                    codeInput.length === 4 ? `${base}?code=${encodeURIComponent(codeInput)}` : base;
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopyToast(
                      codeInput.length === 4
                        ? 'Student join link copied (includes room code)'
                        : 'Student join link copied'
                    );
                  } catch {
                    setError('Could not copy — select and copy the link manually');
                    return;
                  }
                  setTimeout(() => setCopyToast(''), 3000);
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 py-3 text-sm font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Copy student join link
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Paste into Teams so students can click to join
                {codeInput.length === 4 ? ' with this room code.' : '. Add a room code first to include it in the link.'}
              </p>
              {copyToast && (
                <p className="text-center text-sm font-medium text-emerald-700 dark:text-emerald-400">{copyToast}</p>
              )}
            </div>
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  const wt = room?.word_target ?? 0;
  const enforceWords = !!room?.enforce_word_count;
  const frozen = !!room?.freeze_class;
  const focusedStudent = orderedStudents.find((student) => student.id === focusedStudentId) || null;
  const studentGridClass =
    cardView === 'overview'
      ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5'
      : cardView === 'reading'
        ? 'md:grid-cols-2 xl:grid-cols-3'
        : 'lg:grid-cols-2';
  const writingPaneClass =
    cardView === 'overview'
      ? 'max-h-52 overflow-auto'
      : cardView === 'reading'
        ? 'min-h-[22rem] max-h-[32rem] overflow-auto'
        : 'overflow-visible';

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-indigo-50/40 dark:from-slate-950 dark:to-indigo-950/40">
      {!socketConnected && (
        <div
          role="status"
          className="sticky top-0 z-40 border-b border-amber-300 bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-amber-950 shadow-sm"
        >
          Connection lost — reconnecting…
        </div>
      )}
      <header className="border-b border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Teacher</p>
            <h1 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">
              Room <span className="font-mono text-indigo-600">{codeInput}</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/iboard?code=${encodeURIComponent(codeInput)}`;
                // Keep opener link so FULL SCREEN can return without reloading the room
                window.open(url, 'iboard-fullscreen');
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white shadow-sm hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              title="Opens full-screen student cards (up to 7 across) with broadcast"
            >
              FULL SCREEN
            </button>
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                Room actions ···
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button type="button" onClick={startNewClass} className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40">
                  Start new class
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-1 flex-col gap-1.5 sm:max-w-md">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
              <span>Word target</span>
              <span className="font-mono text-indigo-600">{wt} words</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              value={wt}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRoom((r) => (r ? { ...r, word_target: v } : r));
                pushSettings({ word_target: v });
              }}
              className="h-2 w-full cursor-pointer accent-indigo-600"
            />
            {enforceWords && wt <= 0 && (
              <p className="text-xs font-medium text-amber-800">Set the slider above zero to cap how many words are saved.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-200"
              title="When on, only the first N words (word target) of each student draft are saved. Set word target above to N."
            >
              <input
                type="checkbox"
                checked={enforceWords}
                onChange={(e) => {
                  const v = e.target.checked;
                  setRoom((r) => (r ? { ...r, enforce_word_count: v } : r));
                  pushSettings({ enforce_word_count: v });
                }}
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
              />
              Enforce word count
            </label>
            <button
              type="button"
              onClick={() => {
                const v = !frozen;
                setRoom((r) => (r ? { ...r, freeze_class: v } : r));
                pushSettings({ freeze_class: v });
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition ${
                frozen
                  ? 'bg-amber-500 text-white ring-2 ring-amber-300'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-amber-200 dark:border-amber-800'
              }`}
            >
              {frozen ? 'Class frozen' : 'Freeze class'}
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-start">
        <nav
          aria-label="Teacher tools"
          className="sticky top-[76px] z-10 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:w-24 lg:shrink-0 lg:flex-col lg:overflow-visible"
        >
          {TEACHER_WORKSPACES.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => {
                setActiveWorkspace(workspace.id);
                if (workspace.id === 'evidence' || workspace.id === 'reports') setSnapshotsOpen(true);
              }}
              aria-current={activeWorkspace === workspace.id ? 'page' : undefined}
              className={`flex min-w-[4.6rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-bold transition lg:min-w-0 lg:py-3 ${
                activeWorkspace === workspace.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-400 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-200'
              }`}
            >
              <span aria-hidden="true" className="text-base leading-none">{workspace.icon}</span>
              <span>{workspace.label}</span>
              {workspace.id === 'evidence' && snapshots.length > 0 && (
                <span className={`rounded-full px-1.5 text-[9px] ${activeWorkspace === workspace.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'}`}>
                  {snapshots.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {copyToast && (
            <div className="mb-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {copyToast}
            </div>
          )}
          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          {activeWorkspace === 'pulse' && (
            <section>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">Pulse</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Run a quick whole-class check without leaving the room.</p>
                </div>
                <a href={`/pulse/teacher?code=${encodeURIComponent(codeInput)}`} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-300">
                  Open Pulse in its own window ↗
                </a>
              </div>
              <LiveResponseTeacher socket={socket} />
            </section>
          )}

          {activeWorkspace === 'live' && (
            <>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">Live student work</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {orderedStudents.length ? `${orderedStudents.length} student${orderedStudents.length === 1 ? '' : 's'} in this room` : 'Waiting for students to join'}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Student card view">
                  {CARD_VIEWS.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      onClick={() => setCardView(view.id)}
                      aria-pressed={cardView === view.id}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        cardView === view.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-400 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-200'
                      }`}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              </div>

        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[10rem] flex-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Show group</label>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
            >
              <option value="">All students ({orderedStudents.length})</option>
              <option value={GROUP_FILTER_UNASSIGNED}>
                Unassigned / other (
                {orderedStudents.filter((s) => normalizedTableGroup(s.class_group) === null).length})
              </option>
              {TABLE_GROUP_LETTERS.map((letter) => (
                <option key={letter} value={letter}>
                  Group {letter} (
                  {orderedStudents.filter((s) => normalizedTableGroup(s.class_group) === letter).length})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sendBroadcastToClass}
              className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700"
            >
              Send broadcast
            </button>
            <button
              type="button"
              title="Download student writing as an HTML file"
              onClick={openEvidenceModal}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              Save evidence
            </button>
          </div>
        </div>

        <div className={`grid gap-4 ${studentGridClass}`}>
          {orderedStudents.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900/60 p-10 text-center text-slate-500 dark:text-slate-400">
              Waiting for students to join…
            </div>
          )}
          {orderedStudents.length > 0 && visibleStudents.length === 0 && (
            <div className="col-span-full rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 p-6 text-center text-sm text-amber-950 dark:text-amber-100">
              No students in this group. Choose &quot;All students&quot; or assign A–E on each card.
            </div>
          )}
          {visibleStudents.map((s) => {
            const displayText = s.text || '';
            const wc = wordCount(s.text);
            const st = activityStatus(s.updated_at);
            const light =
              st === 'live'
                ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]'
                : st === 'warm'
                  ? 'bg-amber-400'
                  : 'bg-slate-300';
            return (
              <article
                key={s.id}
                data-student-id={s.id}
                className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 p-3 shadow-card"
              >
                <div className="flex items-center gap-1.5">
                  <label
                    className="flex shrink-0 cursor-pointer items-center"
                    title="Include in broadcast"
                  >
                    <input
                      type="checkbox"
                      checked={!!broadcastPick[s.id]}
                      onChange={() =>
                        setBroadcastPick((p) => ({ ...p, [s.id]: !p[s.id] }))
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 dark:border-slate-600"
                    />
                    <span className="sr-only">Include in broadcast</span>
                  </label>
                  <h2
                    className="min-w-0 flex-1 truncate font-display text-base font-semibold text-ink-900 dark:text-slate-100"
                    title={`ID #${s.id}`}
                  >
                    {s.name}
                  </h2>
                  <span title="Activity" className={`h-2 w-2 shrink-0 rounded-full ${light}`} />
                  <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                    {wc}w
                  </span>
                  <SupaCoachLink />
                  <button
                    type="button"
                    onClick={() => downloadOneStudent(s)}
                    className="shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 hover:border-emerald-300 hover:text-emerald-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-emerald-300"
                    title="Download this student's draft"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => openNoteForStudent(s)}
                    className="shrink-0 rounded-md border border-violet-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300"
                    title="Send a private note to this student only"
                  >
                    Note
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusedStudentId(s.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-indigo-200 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/50"
                    title={`Open ${s.name}'s full draft`}
                    aria-label={`Open ${s.name}'s full draft`}
                  >
                    ↗
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const ok = window.confirm(
                        `Remove "${s.name}" from the room?\n\nTheir card will disappear. They can join again with a new card.`
                      );
                      if (!ok) return;
                      socket.emit('teacher:student-remove', { studentId: s.id }, (ack) => {
                        if (!ack?.ok) {
                          setError(ack?.error || 'Could not remove student');
                          return;
                        }
                        setStudents((prev) => prev.filter((x) => x.id !== s.id));
                        setBroadcastPick((p) => {
                          const next = { ...p };
                          delete next[s.id];
                          return next;
                        });
                      });
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-200 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300"
                    title="Remove this student card from the room"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {gradeShortLabel(s.year_level) && (
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {gradeShortLabel(s.year_level)}
                    </span>
                  )}
                  {TABLE_GROUP_LETTERS.map((letter) => {
                    const current = normalizedTableGroup(s.class_group);
                    const active = current === letter;
                    return (
                      <button
                        key={letter}
                        type="button"
                        aria-pressed={active}
                        title={`Table ${letter}`}
                        onClick={() => setStudentTableGroup(s.id, active ? '' : letter)}
                        className={`flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold transition ${
                          active
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-indigo-300'
                        }`}
                      >
                        {letter}
                      </button>
                    );
                  })}
                  {normalizedTableGroup(s.class_group) === null &&
                    String(s.class_group || '').trim() !== '' && (
                      <span className="text-[10px] text-amber-700" title="Legacy group label">
                        !
                      </span>
                    )}
                </div>
                <div
                  data-student-writing-pane
                  className={`mt-2 rounded-xl bg-slate-50 p-2.5 text-sm leading-relaxed text-slate-700 scrollbar-thin dark:bg-slate-950 dark:text-slate-300 ${writingPaneClass}`}
                >
                  {s.image_url && (
                    <img
                      src={s.image_url}
                      alt=""
                      className="mb-2 max-h-36 w-full object-contain"
                    />
                  )}
                  {displayText ? (
                    <RichTextDisplay html={s.rich_text_html} text={displayText} />
                  ) : !s.image_url ? (
                    <span className="italic text-slate-400 dark:text-slate-500">No text yet</span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
            </>
          )}

        {activeWorkspace === 'evidence' && snapshots.length === 0 && (
          <section className="rounded-2xl border border-dashed border-emerald-300 bg-white p-8 text-center shadow-sm dark:border-emerald-800 dark:bg-slate-900">
            <h2 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">Evidence</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
              Save the current student drafts to create lesson evidence and unlock individual student reports.
            </p>
            <button type="button" onClick={openEvidenceModal} className="mt-5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
              Save current evidence
            </button>
          </section>
        )}

        {activeWorkspace === 'reports' && snapshots.length === 0 && (
          <section className="rounded-2xl border border-dashed border-indigo-300 bg-white p-8 text-center shadow-sm dark:border-indigo-800 dark:bg-slate-900">
            <h2 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">Student reports</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
              Reports build automatically from saved evidence. Save at least one lesson first, then each student&apos;s work will appear here over time.
            </p>
            <button type="button" onClick={openEvidenceModal} className="mt-5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
              Save current evidence
            </button>
          </section>
        )}

        {(activeWorkspace === 'evidence' || activeWorkspace === 'reports') && snapshots.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/40 shadow-card dark:border-emerald-800 dark:bg-emerald-950/30">
            <button
              type="button"
              onClick={() => setSnapshotsOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
              aria-expanded={snapshotsOpen}
              aria-controls="saved-evidence-list"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-semibold text-ink-900 dark:text-slate-100">
                    {activeWorkspace === 'reports' ? 'Student reports' : 'Saved evidence'}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    {snapshots.length} {snapshots.length === 1 ? 'save' : 'saves'}
                  </span>
                </span>
                <span className="mt-1 block truncate text-sm text-slate-600 dark:text-slate-400">
                  {activeWorkspace === 'reports'
                    ? 'Review one student’s contributions across saved lessons.'
                    : snapshotsOpen
                      ? 'Earlier saves from this room.'
                      : `Latest: ${snapshots[0]?.label || `Evidence #${snapshots[0]?.id}`}`}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 shadow-sm dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-200">
                {snapshotsOpen ? 'Hide' : 'Show'}
                <span aria-hidden="true" className={`text-base transition-transform ${snapshotsOpen ? 'rotate-180' : ''}`}>⌄</span>
              </span>
            </button>
            {snapshotsOpen && (
              <div id="saved-evidence-list" className="border-t border-emerald-200 px-5 pb-4 dark:border-emerald-800">
                {activeWorkspace === 'evidence' && (
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Download any earlier save again as HTML.</p>
                )}
                {activeWorkspace === 'reports' && (
                <section className="mt-4 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm dark:border-indigo-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Student evidence finder</p>
                      <h4 className="mt-1 font-display text-lg font-semibold text-ink-900 dark:text-slate-100">Show one student’s saved work</h4>
                    </div>
                    {selectedEvidenceStudent && (
                      <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
                        {selectedEvidenceStudent.entries.length} {selectedEvidenceStudent.entries.length === 1 ? 'submission' : 'submissions'}
                      </span>
                    )}
                  </div>
                  <label htmlFor="evidence-student" className="mt-4 block text-xs font-bold text-slate-600 dark:text-slate-300">Student</label>
                  <select
                    id="evidence-student"
                    value={selectedEvidenceStudentKey}
                    onChange={(event) => setSelectedEvidenceStudentKey(event.target.value)}
                    disabled={evidenceStudentsBusy}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">{evidenceStudentsBusy ? 'Loading students…' : 'Select a student…'}</option>
                    {evidenceStudents.map((profile) => (
                      <option key={profile.key} value={profile.key}>{profile.name} · {profile.entries.length}</option>
                    ))}
                  </select>
                  {!evidenceStudentsBusy && !evidenceStudents.length && (
                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No written submissions were found in these saves.</p>
                  )}
                  {selectedEvidenceStudent && (
                    <div className="mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-700">
                        <div>
                          <p className="font-black text-slate-900 dark:text-white">{selectedEvidenceStudent.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {selectedEvidenceStudent.entries.reduce((total, entry) => total + wordCount(entry.text), 0)} words across saved work
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={copyStudentPortfolio} className="rounded-lg bg-indigo-100 px-3 py-2 text-xs font-black text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200">Copy all</button>
                          <button type="button" onClick={downloadStudentPortfolio} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Download portfolio</button>
                        </div>
                      </div>
                      <div className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                        {selectedEvidenceStudent.entries.map((entry) => (
                          <article key={`${entry.snapshotId}-${entry.studentId}-${entry.updatedAt}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-bold text-slate-900 dark:text-white">{entry.label}</p>
                                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{entry.createdAt} · {wordCount(entry.text)} words</p>
                              </div>
                              <button type="button" onClick={() => loadSnapshotForView(entry.snapshotId)} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-300">Open lesson save</button>
                            </div>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">{entry.text}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Names are matched ignoring capital letters and extra spaces. Blank cards and unchanged duplicate drafts are left out.</p>
                </section>
                )}
                {activeWorkspace === 'evidence' && (
                  <>
                <h4 className="mt-5 text-xs font-black uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-300">All saved lessons</h4>
                <ul className="mt-2 max-h-80 divide-y divide-emerald-100/80 overflow-y-auto pr-1 scrollbar-thin dark:divide-emerald-900/50">
                  {snapshots.map((sn) => (
                    <li key={sn.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="text-slate-800 dark:text-slate-200">
                        <span className="font-medium">{sn.label || `Evidence #${sn.id}`}</span>
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{sn.created_at}</span>
                      </span>
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => loadSnapshotForView(sn.id)}
                          className="rounded-lg text-xs font-semibold text-indigo-600 hover:text-indigo-800 dark:hover:text-indigo-300"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => redownloadEvidence(sn.id)}
                          className="rounded-lg text-xs font-semibold text-emerald-700 hover:text-emerald-900"
                        >
                          Download HTML
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {activeWorkspace === 'feedback' && (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm dark:border-indigo-800 dark:bg-slate-900">
              <div>
                <h2 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">Feedback</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {MODE_LABELS[normalizeFeedbackMode(room?.genre)] || 'Writing'}
                  {room?.feedback_toggles?.subjectAssist && room.feedback_toggles.subjectAssist !== 'general'
                    ? ` · ${SUBJECT_ASSIST_OPTIONS.find((o) => o.id === room.feedback_toggles.subjectAssist)?.label || room.feedback_toggles.subjectAssist}`
                    : ''}
                  {room?.feedback_toggles?.yearLevel && room.feedback_toggles.yearLevel !== 'general'
                    ? ` · ${YEAR_LEVEL_OPTIONS.find((o) => o.id === room.feedback_toggles.yearLevel)?.label || room.feedback_toggles.yearLevel}`
                    : ''}
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(true)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700">
                Feedback settings
              </button>
            </div>
            <div className="mb-3">
              <h3 className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">AI batch feedback</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Copy student work, paste the numbered feedback, then distribute it to the visible group.</p>
            </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-card">
            <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-slate-100">Copy for AI</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Builds a structured prompt from feedback mode, subject, year level, toggles, custom focuses, and each
              visible student&apos;s draft (respects <strong>Show group</strong> above).
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Payload: ~{aiPayloadStats.promptKb} KB · {aiPayloadStats.totalDraftWords} words of student drafts
              {visibleStudents.length > 0 ? ` · ${visibleStudents.length} students` : ''}
            </p>
            {aiPayloadStats.level === 'warn' && (
              <p className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                Large prompt — some AI tools may slow down or truncate. Consider copying in two batches (e.g. half the
                class) or nudging students with the word target.
              </p>
            )}
            {aiPayloadStats.level === 'heavy' && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                Very large prompt — high risk of truncation or errors. Batch students (smaller groups per copy) or lower
                the word target before feedback rounds.
              </p>
            )}
            <button
              type="button"
              onClick={copyForAi}
              className="mt-4 w-full rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/50 py-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
            >
              Copy for AI
            </button>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-slate-500 dark:text-slate-400">Preview prompt</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 scrollbar-thin">
                {aiPrompt}
              </pre>
            </details>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-card">
            <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-slate-100">Paste back</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Paste numbered ChatGPT output (e.g. <code className="rounded bg-slate-100 dark:bg-slate-800 px-1">1. [Feedback]</code>
              ). Items are matched to <strong>visible</strong> students in list order (same order as Copy for AI).
            </p>
            <textarea
              value={pasteBox}
              onChange={(e) => setPasteBox(e.target.value)}
              rows={8}
              placeholder={`1. [Feedback for first student]\n2. [Feedback for second student]`}
              className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
            />
            <button
              type="button"
              onClick={distributePaste}
              className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Distribute to students
            </button>
          </div>
        </div>
          </section>
        )}
        </div>
      </main>

      <AppFooter />

      {focusedStudent && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 p-4 sm:items-center">
          <article
            data-student-id={focusedStudent.id}
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="focused-student-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Full draft</p>
                <h2 id="focused-student-title" title={`ID #${focusedStudent.id}`} className="truncate font-display text-xl font-bold text-ink-900 dark:text-slate-100">
                  {focusedStudent.name}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{wordCount(focusedStudent.text)} words · select text to add an inline comment</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setFocusedStudentId(null); openNoteForStudent(focusedStudent); }} className="rounded-xl border border-violet-200 px-3 py-2 text-sm font-bold text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40">
                  Send note
                </button>
                <button type="button" onClick={() => setFocusedStudentId(null)} className="flex h-10 w-10 items-center justify-center rounded-xl text-xl font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Close full draft">
                  ×
                </button>
              </div>
            </div>
            <div data-student-writing-pane className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-6 py-5 text-base leading-7 text-slate-800 scrollbar-thin dark:text-slate-200">
              {focusedStudent.image_url && (
                <img src={focusedStudent.image_url} alt="" className="mb-5 max-h-80 w-full object-contain" />
              )}
              {focusedStudent.text ? (
                <RichTextDisplay html={focusedStudent.rich_text_html} text={focusedStudent.text} />
              ) : !focusedStudent.image_url ? (
                <span className="italic text-slate-400 dark:text-slate-500">No text yet</span>
              ) : null}
            </div>
          </article>
        </div>
      )}

      {noteTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <form
            className="w-full max-w-md overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl dark:border-violet-800 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="private-note-title"
            onSubmit={(event) => {
              event.preventDefault();
              sendNoteToStudent();
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-violet-600 dark:text-violet-300">
                  Private feedback
                </p>
                <h2 id="private-note-title" className="mt-1 font-display text-lg font-bold text-ink-900 dark:text-slate-100">
                  Note for {noteTarget.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  This will appear in the student&apos;s feedback inbox.
                </p>
              </div>
              <button
                type="button"
                disabled={noteSending}
                onClick={closeNoteComposer}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Close private note"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4">
              <label htmlFor="private-note-text" className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                Your note
              </label>
              <textarea
                id="private-note-text"
                autoFocus
                rows={5}
                maxLength={5000}
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    sendNoteToStudent();
                  }
                  if (event.key === 'Escape') closeNoteComposer();
                }}
                placeholder="Write a private note…"
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-violet-500 focus:border-violet-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <div className="mt-2 flex items-start justify-between gap-3">
                <p className="text-xs font-medium text-red-600 dark:text-red-300">{noteError}</p>
                <p className="shrink-0 text-[11px] text-slate-400">{noteDraft.length}/5000</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-950">
              <button
                type="button"
                disabled={noteSending}
                onClick={closeNoteComposer}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={noteSending || !noteDraft.trim()}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-violet-700 disabled:opacity-40"
              >
                {noteSending ? 'Sending…' : 'Send note'}
              </button>
            </div>
          </form>
        </div>
      )}

      {evidenceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-title"
          >
            <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <h2 id="evidence-title" className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">
                Save evidence
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Downloads one HTML file with{' '}
                {(visibleStudents.length ? visibleStudents : orderedStudents).length} student
                {(visibleStudents.length ? visibleStudents : orderedStudents).length === 1 ? '' : 's'}
                {groupFilter ? ` · group ${groupFilter}` : ''}.
              </p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Label
              </label>
              <input
                value={evidenceLabel}
                onChange={(e) => setEvidenceLabel(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-2"
                placeholder="e.g. Persuasive intro — Week 3"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEvidenceOfLearning();
                }}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-5 py-3">
              <button
                type="button"
                onClick={() => setEvidenceModalOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={evidenceBusy}
                onClick={saveEvidenceOfLearning}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {evidenceBusy ? 'Saving…' : 'Download HTML'}
              </button>
            </div>
          </div>
        </div>
      )}

      {snapshotViewer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">
                {snapshotViewer.label || `Snapshot #${snapshotViewer.id}`}
              </h2>
              <button
                type="button"
                onClick={() => setSnapshotViewer(null)}
                className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5 text-sm scrollbar-thin">
              <p className="text-xs text-slate-500 dark:text-slate-400">{snapshotViewer.created_at}</p>
              {(snapshotViewer.payload?.students || []).map((st) => (
                <div key={st.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3">
                  <p className="font-semibold text-ink-900 dark:text-slate-100">
                    {st.name}
                    {st.class_group ? (
                      <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">({st.class_group})</span>
                    ) : null}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{st.text || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">Prepare feedback</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5 scrollbar-thin">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Feedback mode
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {FEEDBACK_MODES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFeedbackMode(id)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                        feedbackMode === id
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-indigo-200'
                      }`}
                    >
                      {MODE_LABELS[id]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label
                    htmlFor="subject"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    Subject
                  </label>
                  <select
                    id="subject"
                    value={subjectAssist}
                    onChange={(e) => setSubjectAssist(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                  >
                    {SUBJECT_ASSIST_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Guides the AI with subject expectations (does not change student view).
                  </p>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="year-level"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    Year level
                  </label>
                  <select
                    id="year-level"
                    value={yearLevel}
                    onChange={(e) => setYearLevel(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                  >
                    {YEAR_LEVEL_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Age-appropriate vocabulary and complexity for the AI (does not change student view).
                  </p>
                </div>
              </div>

              {feedbackMode === 'custom' ? (
                <div>
                  <label
                    htmlFor="custom-focus"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    Custom focus
                  </label>
                  <textarea
                    id="custom-focus"
                    value={customFocusText}
                    onChange={(e) => setCustomFocusText(e.target.value)}
                    rows={3}
                    placeholder="e.g. Focus on use of evidence and paragraph control"
                    className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Focus toggles</p>
                    <div className="mt-2 grid grid-cols-2 gap-4">
                      {Object.entries(MODE_TOGGLE_LABELS[feedbackMode] || {}).map(([key, label]) => (
                        <ToggleRow
                          key={key}
                          label={label}
                          checked={!!modeToggles[feedbackMode]?.[key]}
                          onChange={(v) => setModeToggle(feedbackMode, key, v)}
                        />
                      ))}
                      {(extraFocusByMode[feedbackMode] || []).map((item) => (
                        <div key={item.id} className="flex items-stretch gap-1">
                          <div className="min-w-0 flex-1">
                            <ToggleRow
                              label={item.text}
                              checked={item.enabled}
                              onChange={(v) => setExtraFocusEnabled(feedbackMode, item.id, v)}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeExtraFocus(feedbackMode, item.id)}
                            className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                            aria-label={`Remove ${item.text}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={addFocusDraft}
                      onChange={(e) => setAddFocusDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomFocusLine();
                        }
                      }}
                      placeholder="Add custom focus"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                    />
                    <button
                      type="button"
                      onClick={addCustomFocusLine}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-2xl font-light leading-none text-white shadow-md transition hover:bg-indigo-700"
                      aria-label="Add custom focus"
                    >
                      +
                    </button>
                  </div>
                </>
              )}

              {feedbackMode === 'custom' && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Extra focus lines (optional)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(extraFocusByMode.custom || []).map((item) => (
                      <div key={item.id} className="flex items-stretch gap-1">
                        <div className="min-w-0 flex-1">
                          <ToggleRow
                            label={item.text}
                            checked={item.enabled}
                            onChange={(v) => setExtraFocusEnabled('custom', item.id, v)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeExtraFocus('custom', item.id)}
                          className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                          aria-label={`Remove ${item.text}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={addFocusDraft}
                      onChange={(e) => setAddFocusDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomFocusLine();
                        }
                      }}
                      placeholder="Add custom focus"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                    />
                    <button
                      type="button"
                      onClick={addCustomFocusLine}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-2xl font-light leading-none text-white shadow-md transition hover:bg-indigo-700"
                      aria-label="Add custom focus"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-5 py-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveFeedbackSettings}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeacherDashboard() {
  return (
    <TeacherPinGate>
      <TeacherDashboardInner />
    </TeacherPinGate>
  );
}
