import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import TeacherPinGate from '../components/TeacherPinGate.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import LiveResponseTeacher from '../components/LiveResponseTeacher.jsx';
import RichTextDisplay from '../components/RichTextDisplay.jsx';
import AnnotatedStudentImage from '../components/AnnotatedStudentImage.jsx';
import TeacherDrawingMarkup from '../components/TeacherDrawingMarkup.jsx';
import SaveStatusChip from '../components/SaveStatusChip.jsx';
import {
  downloadTextFile,
  buildEvidenceHtml,
  evidenceFilenames,
  buildStudentEvidenceText,
  buildStudentPortfolioHtml,
  buildStudentPortfolioText,
} from '../lib/exportRoom.js';
import { fileToCompressedJpegDataUrl } from '../lib/image.js';
import { studentTileMeta } from '../lib/liveResponseMeta.js';
import { useTheme } from '../lib/theme.jsx';
import HintWrap from '../components/HintWrap.jsx';
import LessonReportPanel from '../components/LessonReportPanel.jsx';
import { downloadLessonReportHtml } from '../lib/lessonReport.js';

const MODE_LABELS = {
  writing: 'Writing',
  explanation: 'Explanation',
  argument: 'Argument',
  problem_solving: 'Problem Solving',
  custom: 'Custom',
};

const CARD_VIEW_STORAGE_KEY = 'iboard-teacher-card-view';
const CARD_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'reading', label: 'Reading' },
  { id: 'full', label: 'Full drafts' },
];

const TEACHER_TOOLS_TABS = [
  { id: 'ask', label: 'Ask' },
  { id: 'respond', label: 'Respond' },
  { id: 'responses', label: 'Responses' },
];

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function initialCardView() {
  if (typeof window === 'undefined') return 'overview';
  try {
    const saved = localStorage.getItem(CARD_VIEW_STORAGE_KEY);
    return CARD_VIEWS.some((view) => view.id === saved) ? saved : 'overview';
  } catch {
    return 'overview';
  }
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
    teacher_markup_url: s.teacher_markup_url || null,
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
  const { isDark, toggleTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const codeFromLink = String(searchParams.get('code') || '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const [codeInput, setCodeInput] = useState(() =>
    codeFromLink.length === 4 ? codeFromLink : randomRoomCode()
  );
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState(null);
  const [students, setStudents] = useState([]);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState('');
  const [socketConnected, setSocketConnected] = useState(true);
  const [newClassConfirmOpen, setNewClassConfirmOpen] = useState(false);
  const [newClassBusy, setNewClassBusy] = useState(false);
  const [joinScreenOpen, setJoinScreenOpen] = useState(false);
  const [drawingMarkupTarget, setDrawingMarkupTarget] = useState(null);
  const [audienceQuestions, setAudienceQuestions] = useState([]);
  const roomActionsRef = useRef(null);

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
  const [copiedStudentId, setCopiedStudentId] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteError, setNoteError] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const [broadcastPick, setBroadcastPick] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [evidenceStudents, setEvidenceStudents] = useState([]);
  const [evidenceStudentsBusy, setEvidenceStudentsBusy] = useState(false);
  const [selectedEvidenceStudentKey, setSelectedEvidenceStudentKey] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  const [reportMergeMode, setReportMergeMode] = useState(false);
  const [reportMergeKeys, setReportMergeKeys] = useState([]);
  const [reportMergeCanonicalKey, setReportMergeCanonicalKey] = useState('');
  const [reportMergeBusy, setReportMergeBusy] = useState(false);
  const [snapshotViewer, setSnapshotViewer] = useState(null);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState('ask');
  const [toolsHighlightStudentId, setToolsHighlightStudentId] = useState(null);
  const teacherHeaderRef = useRef(null);
  const teacherToolsNavRef = useRef(null);
  const teacherToolsPanelRef = useRef(null);
  const addCardButtonRef = useRef(null);
  const addCardPanelRef = useRef(null);
  const [teacherToolsTop, setTeacherToolsTop] = useState(0);
  const [removeStudentTarget, setRemoveStudentTarget] = useState(null);
  const [removeStudentBusy, setRemoveStudentBusy] = useState(false);
  const [lessonReportOpen, setLessonReportOpen] = useState(false);
  const prevPendingQuestionCountRef = useRef(0);
  const [libraryPanel, setLibraryPanel] = useState(null);
  const [fixedCommentCount, setFixedCommentCount] = useState(0);
  const [clearFixedBusy, setClearFixedBusy] = useState(false);
  const [clearFixedArmed, setClearFixedArmed] = useState(false);
  const [livePulse, setLivePulse] = useState({ activity: null, responses: [], students: [] });
  const [cardView, setCardView] = useState(initialCardView);
  const [focusedStudentId, setFocusedStudentId] = useState(null);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [addCardTitle, setAddCardTitle] = useState('Teacher');
  const [addCardText, setAddCardText] = useState('');
  const [addCardImage, setAddCardImage] = useState('');
  const [addCardBusy, setAddCardBusy] = useState(false);
  const [addCardError, setAddCardError] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle');

  const socket = useMemo(() => createSocket(), []);
  const teacherRoomRef = useRef('');
  const joinedRef = useRef(false);
  const autoJoinTriedRef = useRef(false);
  const savedClearRef = useRef(null);

  const markSaved = useCallback(() => {
    setSaveStatus('saved');
    if (savedClearRef.current) clearTimeout(savedClearRef.current);
    savedClearRef.current = setTimeout(() => setSaveStatus('idle'), 2200);
  }, []);

  const pushSettings = useCallback(
    (partial) => {
      if (!room) return;
      setSaveStatus('saving');
      socket.emit('teacher:settings', partial, (ack) => {
        if (ack && ack.ok === false) {
          setSaveStatus('error');
          return;
        }
        markSaved();
      });
    },
    [room, socket, markSaved]
  );

  useEffect(() => () => {
    if (savedClearRef.current) clearTimeout(savedClearRef.current);
  }, []);

  useEffect(() => {
    const onStatus = (event) => {
      const next = event.detail?.status;
      if (next === 'saving') setSaveStatus('saving');
      else if (next === 'error') setSaveStatus('error');
      else if (next === 'saved') markSaved();
    };
    window.addEventListener('iboard:teacher-save-status', onStatus);
    return () => window.removeEventListener('iboard:teacher-save-status', onStatus);
  }, [markSaved]);

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
    const onFixed = (event) => {
      const count = Number(event.detail?.count) || 0;
      const busy = !!event.detail?.busy;
      setFixedCommentCount(count);
      setClearFixedBusy(busy);
      if (count <= 0) setClearFixedArmed(false);
    };
    window.addEventListener('iboard:fixed-comments', onFixed);
    return () => window.removeEventListener('iboard:fixed-comments', onFixed);
  }, []);

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
      setPosts(Array.isArray(payload.posts) ? payload.posts : []);
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
          cur.year_level === row.year_level &&
          cur.image_url === row.image_url &&
          cur.teacher_markup_url === row.teacher_markup_url
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

  useEffect(() => {
    const onQna = (payload) => {
      setAudienceQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
    };
    socket.on('qna:teacher', onQna);
    return () => socket.off('qna:teacher', onQna);
  }, [socket]);

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

  const visibleStudents = orderedStudents;

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
          current && profiles.some((profile) => profile.key === current)
            ? current
            : profiles[0]?.key || ''
        ));
        setReportMergeMode(false);
        setReportMergeKeys([]);
        setReportMergeCanonicalKey('');
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
  const filteredEvidenceStudents = useMemo(() => {
    const needle = reportSearch.trim().toLocaleLowerCase();
    if (!needle) return evidenceStudents;
    return evidenceStudents.filter((profile) =>
      [profile.name, ...(profile.aliases || [])]
        .some((value) => String(value || '').toLocaleLowerCase().includes(needle))
    );
  }, [evidenceStudents, reportSearch]);
  const reportMergeProfiles = useMemo(
    () => reportMergeKeys
      .map((key) => evidenceStudents.find((profile) => profile.key === key))
      .filter(Boolean),
    [evidenceStudents, reportMergeKeys]
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

  useEffect(() => {
    if (!joined) return;
    const onLive = (payload) => {
      setLivePulse(payload || { activity: null, responses: [], students: [] });
    };
    socket.on('live:teacher', onLive);
    socket.emit('teacher:live-sync', {});
    return () => socket.off('live:teacher', onLive);
  }, [socket, joined]);

  useEffect(() => {
    if (!livePulse.activity?.id) {
      setToolsHighlightStudentId(null);
    }
  }, [livePulse.activity?.id]);

  useEffect(() => {
    if (!joined) return undefined;
    function closeIfOutside(event) {
      const room = roomActionsRef.current;
      if (room?.open && !room.contains(event.target)) room.open = false;
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      if (roomActionsRef.current) roomActionsRef.current.open = false;
    }
    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [joined]);

  useEffect(() => {
    if (!toolsPanelOpen && !addCardOpen) return undefined;

    function closeHeaderPanelsIfOutside(event) {
      const target = event.target;
      if (toolsPanelOpen) {
        if (teacherToolsNavRef.current?.contains(target)) return;
        if (teacherToolsPanelRef.current?.contains(target)) return;
      }
      if (addCardOpen) {
        if (addCardButtonRef.current?.contains(target)) return;
        if (addCardPanelRef.current?.contains(target)) return;
      }
      if (toolsPanelOpen) {
        setToolsPanelOpen(false);
        setToolsHighlightStudentId(null);
      }
      if (addCardOpen && !addCardBusy) setAddCardOpen(false);
    }

    function closeHeaderPanelsOnEscape(event) {
      if (event.key !== 'Escape') return;
      if (toolsPanelOpen) {
        setToolsPanelOpen(false);
        setToolsHighlightStudentId(null);
      }
      if (addCardOpen && !addCardBusy) setAddCardOpen(false);
    }

    document.addEventListener('pointerdown', closeHeaderPanelsIfOutside);
    document.addEventListener('keydown', closeHeaderPanelsOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeHeaderPanelsIfOutside);
      document.removeEventListener('keydown', closeHeaderPanelsOnEscape);
    };
  }, [toolsPanelOpen, addCardOpen, addCardBusy]);

  useLayoutEffect(() => {
    if ((!toolsPanelOpen && !addCardOpen) || !teacherHeaderRef.current) return undefined;

    function alignHeaderDockToHeader() {
      const headerBottom = teacherHeaderRef.current?.getBoundingClientRect().bottom;
      if (Number.isFinite(headerBottom)) setTeacherToolsTop(Math.max(0, Math.round(headerBottom)));
    }

    alignHeaderDockToHeader();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(alignHeaderDockToHeader)
      : null;
    resizeObserver?.observe(teacherHeaderRef.current);
    window.addEventListener('resize', alignHeaderDockToHeader);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', alignHeaderDockToHeader);
    };
  }, [toolsPanelOpen, addCardOpen]);

  const pendingQuestionCount = useMemo(
    () => audienceQuestions.filter((question) => question.status === 'pending').length,
    [audienceQuestions]
  );

  useEffect(() => {
    if (!joined) return;
    const prev = prevPendingQuestionCountRef.current;
    if (pendingQuestionCount > prev && pendingQuestionCount > 0) {
      setToolsTab('respond');
      setToolsPanelOpen(true);
    }
    prevPendingQuestionCountRef.current = pendingQuestionCount;
  }, [pendingQuestionCount, joined]);

  const liveStudentById = useMemo(() => {
    const map = new Map();
    for (const student of livePulse.students || []) {
      map.set(Number(student.id), student);
    }
    return map;
  }, [livePulse.students]);

  const headerDockStyle = useMemo(
    () => ({
      top: teacherToolsTop,
      maxHeight: `calc(100dvh - ${teacherToolsTop}px)`,
    }),
    [teacherToolsTop]
  );

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

  function toggleBroadcastCard(key) {
    setBroadcastPick((current) => {
      if (current[key]) return { ...current, [key]: false };
      if (Object.values(current).filter(Boolean).length >= 6) {
        setError('Broadcast is limited to 6 cards');
        return current;
      }
      return { ...current, [key]: true };
    });
  }

  function sendBroadcastToClass() {
    /** Use everyone in the room, not only the group filter — otherwise a filter can hide checked cards and send zero IDs. */
    const postIds = posts.filter((post) => broadcastPick[`post:${post.id}`]).map((post) => post.id).slice(0, 6);
    const remaining = Math.max(0, 6 - postIds.length);
    const ids = orderedStudents.filter((s) => broadcastPick[s.id]).map((s) => s.id).slice(0, remaining);
    if (!ids.length && !postIds.length) {
      setError(
        'Tick “Include in broadcast” on at least one student or teacher card (up to 6). Names are not sent — only Exemplar A, B, …'
      );
      return;
    }
    setError('');
    socket.emit('teacher:broadcast', { studentIds: ids, postIds }, (ack) => {
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

  function closeAddCard() {
    if (addCardBusy) return;
    setAddCardOpen(false);
    setAddCardError('');
  }

  function openAddCard() {
    closeRoomMenu();
    if (addCardOpen) {
      closeAddCard();
      return;
    }
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardTitle('Teacher');
    setAddCardText('');
    setAddCardImage('');
    setAddCardError('');
    setAddCardOpen(true);
  }

  function requestRemoveStudent(student) {
    setRemoveStudentTarget({ id: Number(student.id), name: String(student.name || 'Student') });
  }

  function closeRemoveStudentConfirm() {
    if (removeStudentBusy) return;
    setRemoveStudentTarget(null);
  }

  function confirmRemoveStudent() {
    if (!removeStudentTarget || removeStudentBusy) return;
    setRemoveStudentBusy(true);
    socket.emit('teacher:student-remove', { studentId: removeStudentTarget.id }, (ack) => {
      setRemoveStudentBusy(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not remove student');
        return;
      }
      setStudents((prev) => prev.filter((x) => x.id !== removeStudentTarget.id));
      setBroadcastPick((p) => {
        const next = { ...p };
        delete next[removeStudentTarget.id];
        return next;
      });
      setRemoveStudentTarget(null);
    });
  }

  async function handleAddCardPaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      try {
        setAddCardImage(await fileToCompressedJpegDataUrl(file));
        setAddCardError('');
      } catch {
        setAddCardError('Could not read that image');
      }
      return;
    }
  }

  function submitTeacherCard() {
    const title = String(addCardTitle || 'Teacher').trim() || 'Teacher';
    const finish = (ack, message) => {
      setAddCardBusy(false);
      if (!ack?.ok) {
        setAddCardError(ack?.error || 'Could not add teacher card');
        return;
      }
      setAddCardOpen(false);
      setAddCardText('');
      setAddCardImage('');
      setCopyToast(message);
      setTimeout(() => setCopyToast(''), 2500);
    };

    if (addCardImage) {
      setAddCardBusy(true);
      socket.emit(
        'teacher:board-post',
        { kind: 'image', title, imageBase64: addCardImage, mimeType: 'image/jpeg' },
        (ack) => finish(ack, 'Teacher image card added')
      );
      return;
    }

    const text = addCardText.trim();
    if (!text) {
      setAddCardError('Type some text or paste an image');
      return;
    }
    setAddCardBusy(true);
    socket.emit('teacher:board-post', { kind: 'text', title, text }, (ack) => finish(ack, 'Teacher card added'));
  }

  function deleteTeacherCard(postId) {
    socket.emit('teacher:board-post-delete', { postId }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not remove teacher card');
        return;
      }
      setBroadcastPick((current) => {
        const next = { ...current };
        delete next[`post:${postId}`];
        return next;
      });
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

  async function copyStudentText(student) {
    const text = String(student?.text || '');
    if (!text.trim()) return;

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const copyBox = document.createElement('textarea');
        copyBox.value = text;
        copyBox.setAttribute('readonly', '');
        copyBox.style.position = 'fixed';
        copyBox.style.left = '-9999px';
        document.body.appendChild(copyBox);
        copyBox.select();
        copyBox.setSelectionRange(0, copyBox.value.length);
        const copied = document.execCommand('copy');
        copyBox.remove();
        if (!copied) throw new Error('Copy command failed');
      }

      const toast = `Copied ${student.name}'s work`;
      setCopiedStudentId(student.id);
      setCopyToast(toast);
      window.setTimeout(() => {
        setCopiedStudentId((current) => (current === student.id ? null : current));
        setCopyToast((current) => (current === toast ? '' : current));
      }, 2000);
    } catch {
      setError('Could not copy that writing. Open the full draft and try again.');
    }
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

  function applyEvidenceProfiles(nextProfiles, preferredKey = '') {
    const profiles = Array.isArray(nextProfiles) ? nextProfiles : [];
    setEvidenceStudents(profiles);
    setSelectedEvidenceStudentKey((current) => {
      if (preferredKey && profiles.some((profile) => profile.key === preferredKey)) return preferredKey;
      if (current && profiles.some((profile) => profile.key === current)) return current;
      return profiles[0]?.key || '';
    });
  }

  function toggleReportMergeProfile(key) {
    setReportMergeKeys((current) => {
      const next = current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key];
      setReportMergeCanonicalKey((canonical) =>
        canonical && next.includes(canonical) ? canonical : next[0] || ''
      );
      return next;
    });
  }

  function cancelReportMerge() {
    setReportMergeMode(false);
    setReportMergeKeys([]);
    setReportMergeCanonicalKey('');
  }

  function combineReportProfiles() {
    if (reportMergeKeys.length < 2 || !reportMergeCanonicalKey) return;
    setReportMergeBusy(true);
    setError('');
    socket.emit(
      'teacher:evidence-combine',
      { profileKeys: reportMergeKeys, canonicalKey: reportMergeCanonicalKey },
      (ack) => {
        setReportMergeBusy(false);
        if (!ack?.ok) {
          setError(ack?.error || 'Could not combine those names');
          return;
        }
        applyEvidenceProfiles(ack.students, ack.selectedKey || reportMergeCanonicalKey);
        const kept = reportMergeProfiles.find((profile) => profile.key === reportMergeCanonicalKey);
        cancelReportMerge();
        setCopyToast(`Combined names under ${kept?.name || 'one student'}`);
        setTimeout(() => setCopyToast(''), 3000);
      }
    );
  }

  function separateReportProfile() {
    if (!selectedEvidenceStudent?.combined) return;
    const aliases = selectedEvidenceStudent.aliases || [];
    const ok = window.confirm(
      `Separate ${aliases.join(', ')} into individual reports again?\n\nThe saved evidence will not be changed.`
    );
    if (!ok) return;
    setReportMergeBusy(true);
    setError('');
    socket.emit(
      'teacher:evidence-uncombine',
      { profileKey: selectedEvidenceStudent.key },
      (ack) => {
        setReportMergeBusy(false);
        if (!ack?.ok) {
          setError(ack?.error || 'Could not separate those names');
          return;
        }
        const profiles = Array.isArray(ack.students) ? ack.students : [];
        const preferred = profiles.find((profile) =>
          profile.name === selectedEvidenceStudent.name ||
          (profile.aliases || []).includes(selectedEvidenceStudent.name)
        )?.key;
        applyEvidenceProfiles(profiles, preferred || '');
        setCopyToast('Names separated');
        setTimeout(() => setCopyToast(''), 2500);
      }
    );
  }

  function openNewClassConfirmation() {
    closeRoomMenu();
    setError('');
    setNewClassConfirmOpen(true);
  }

  function closeNewClassConfirmation() {
    if (newClassBusy) return;
    setNewClassConfirmOpen(false);
  }

  function studentJoinUrl() {
    const base = `${window.location.origin}/student`;
    return codeInput.length === 4 ? `${base}?code=${encodeURIComponent(codeInput)}` : base;
  }

  async function copyStudentJoinLink() {
    try {
      await navigator.clipboard.writeText(studentJoinUrl());
      setCopyToast('Participant join link copied');
      setTimeout(() => setCopyToast(''), 3000);
    } catch {
      setError('Could not copy the participant join link');
    }
  }

  function openJoinScreen() {
    closeRoomMenu();
    setJoinScreenOpen(true);
  }

  function downloadParticipantList() {
    closeRoomMenu();
    const rows = [
      ['Name', 'Year level', 'Group', 'Words', 'Last updated'],
      ...orderedStudents.map((student) => [
        student.name,
        gradeShortLabel(student.year_level) || student.year_level || '',
        student.class_group || '',
        wordCount(student.text),
        student.updated_at || '',
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    downloadTextFile(`iboard-room-${codeInput}-participants.csv`, csv, 'text/csv;charset=utf-8');
    setCopyToast(`Downloaded ${orderedStudents.length} participant${orderedStudents.length === 1 ? '' : 's'}`);
    setTimeout(() => setCopyToast(''), 3000);
  }

  function startNewClass() {
    if (newClassBusy) return;
    setNewClassBusy(true);
    setError('');
    socket.emit('teacher:clear-cards', {}, (ack) => {
      setNewClassBusy(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not clear cards');
        return;
      }
      setStudents([]);
      setPosts([]);
      setBroadcastPick({});
      setToolsPanelOpen(false);
      setLibraryPanel(null);
      setNewClassConfirmOpen(false);
      setCopyToast('Board cleared — ready for a new class');
      setTimeout(() => setCopyToast(''), 3000);
      const code = String(codeInput || '').replace(/\D/g, '').slice(0, 4);
      if (code.length === 4) {
        // Same named window as the old FULL SCREEN control — reopen/focus the live board.
        window.open(
          `${window.location.origin}/iboard?code=${encodeURIComponent(code)}`,
          'iboard-fullscreen'
        );
      }
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
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm text-center">
            <IBoardWordmark className="text-3xl" iClassName="italic text-indigo-600" />
            <div className="mt-10 flex items-center gap-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && codeInput.length === 4) createOrJoin();
                }}
                placeholder="0000"
                inputMode="numeric"
                aria-label="Room code"
                className="min-w-0 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-center font-mono text-3xl font-bold tracking-[0.35em] text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                maxLength={4}
              />
              <button
                type="button"
                onClick={() => setCodeInput(randomRoomCode())}
                aria-label="Generate new room code"
                className="shrink-0 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                New
              </button>
            </div>
            {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
            <button
              type="button"
              onClick={() => createOrJoin()}
              disabled={codeInput.length !== 4}
              className="mt-5 w-full rounded-2xl bg-indigo-600 py-4 text-base font-bold text-white shadow-lift hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open room
            </button>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(studentJoinUrl());
                    setCopyToast('Student link copied');
                  } catch {
                    setError('Could not copy — select and copy the link manually');
                    return;
                  }
                  setTimeout(() => setCopyToast(''), 2500);
                }}
                className="font-medium text-slate-600 underline-offset-2 hover:text-indigo-600 hover:underline dark:text-slate-300"
              >
                Copy student link
              </button>
              <span aria-hidden className="text-slate-300 dark:text-slate-600">
                ·
              </span>
              <a
                href={codeInput.length === 4 ? `/pulse/teacher?code=${encodeURIComponent(codeInput)}` : '/pulse/teacher'}
                className="font-medium text-slate-600 underline-offset-2 hover:text-indigo-600 hover:underline dark:text-slate-300"
              >
                Pulse only
              </a>
            </div>
            {copyToast && (
              <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">{copyToast}</p>
            )}
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  const wt = room?.word_target ?? 0;
  const enforceWords = !!room?.enforce_word_count;
  const frozen = !!room?.freeze_class;

  function closeRoomMenu() {
    if (roomActionsRef.current) roomActionsRef.current.open = false;
    setClearFixedArmed(false);
  }

  function openTeacherTools(tab = 'ask', { highlightStudentId = null } = {}) {
    closeRoomMenu();
    setAddCardOpen(false);
    setToolsTab(tab);
    setToolsPanelOpen(true);
    setToolsHighlightStudentId(highlightStudentId != null ? Number(highlightStudentId) : null);
  }

  function closeTeacherTools() {
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
  }

  function openLessonReport() {
    closeRoomMenu();
    setLessonReportOpen(true);
  }

  async function downloadLessonReportQuick() {
    closeRoomMenu();
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(codeInput)}/lesson-report`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not build report');
      downloadLessonReportHtml(data);
      setCopyToast('Lesson report downloaded');
      setTimeout(() => setCopyToast(''), 2500);
    } catch (e) {
      setError(e.message || 'Could not download lesson report');
    }
  }

  function openAnswerInRail(studentId) {
    if (!livePulse.activity) {
      openTeacherTools('ask');
      return;
    }
    openTeacherTools('responses', { highlightStudentId: studentId });
  }


  function openLibrary(panel) {
    closeRoomMenu();
    setLibraryPanel(panel);
    if (panel === 'evidence' || panel === 'reports') setSnapshotsOpen(true);
  }

  const focusedStudent = orderedStudents.find((student) => student.id === focusedStudentId) || null;
  const studentGridClass =
    cardView === 'overview'
      ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-5'
      : cardView === 'reading'
        ? 'md:grid-cols-2 xl:grid-cols-3'
        : 'lg:grid-cols-2';
  const writingPaneClass =
    cardView === 'overview'
      ? 'max-h-52 overflow-y-auto overflow-x-visible'
      : cardView === 'reading'
        ? 'min-h-[22rem] max-h-[32rem] overflow-y-auto overflow-x-visible'
        : 'overflow-visible';

  const broadcastPickCount = Object.values(broadcastPick).filter(Boolean).length;
  const liveResponseCount = (livePulse.responses || []).length;

  return (
    <div className="iboard-teacher-canvas flex h-[100dvh] flex-col overflow-hidden dark:bg-slate-950">
      <div className="shrink-0">
      {!socketConnected && (
        <div
          role="status"
          className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm font-semibold text-amber-800 shadow-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Connection lost — reconnecting…
        </div>
      )}
      <header ref={teacherHeaderRef} className="iboard-app-header relative z-50 shrink-0 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="font-display text-lg font-bold tracking-tight text-ink-900 dark:text-slate-100">
              Room <span className="iboard-header-code font-mono text-indigo-600">{codeInput}</span>
            </h1>
            <SaveStatusChip status={saveStatus} />
            <span className="iboard-header-chip hidden rounded-full border border-indigo-100 bg-white/70 px-2.5 py-0.5 text-xs font-semibold text-slate-600 shadow-[0_1px_3px_rgba(79,70,229,0.06)] dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 sm:inline">
              Participants: {orderedStudents.length}
            </span>
            {frozen && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Frozen
              </span>
            )}
          </div>
          <nav ref={teacherToolsNavRef} aria-label="Teacher tools" className="ml-auto flex items-end gap-1 overflow-visible">
            {TEACHER_TOOLS_TABS.map((tab) => {
              const active = toolsPanelOpen && toolsTab === tab.id;
              const badge = tab.id === 'respond'
                ? pendingQuestionCount
                : tab.id === 'responses' && livePulse.activity
                  ? liveResponseCount
                  : 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (toolsPanelOpen && toolsTab === tab.id) closeTeacherTools();
                    else openTeacherTools(tab.id);
                  }}
                  aria-current={active ? 'page' : undefined}
                  data-active={active ? 'true' : 'false'}
                  className={`iboard-header-tab relative inline-flex items-center gap-1.5 overflow-visible rounded-t-lg px-3 py-2 text-[11px] font-bold transition sm:px-3.5 sm:text-xs ${
                    active
                      ? 'z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
                      : 'border border-indigo-100/80 bg-indigo-100/75 text-indigo-950 hover:border-indigo-200 hover:bg-indigo-200/70 dark:border-transparent dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                  {badge ? (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums leading-none ${
                        active ? 'bg-white/25' : 'bg-amber-500 text-amber-950'
                      }`}
                    >
                      {badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className="iboard-header-divider flex items-center gap-1.5 border-l border-slate-200 pl-1.5 dark:border-slate-700">
            <HintWrap hint="Add card" prefer="below">
              <button
                ref={addCardButtonRef}
                type="button"
                onClick={openAddCard}
                aria-expanded={addCardOpen}
                className={`iboard-header-icon-button flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white ${
                  addCardOpen
                    ? 'border-indigo-300 bg-indigo-600 text-white dark:border-indigo-500'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700'
                }`}
                aria-label="Add card"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </HintWrap>
            {broadcastPickCount > 0 && (
              <HintWrap hint="Send to Inbox" prefer="below">
                <button
                  type="button"
                  onClick={() => {
                    closeRoomMenu();
                    sendBroadcastToClass();
                  }}
                  className="relative flex h-9 items-center gap-1 rounded-xl bg-amber-500 px-2.5 text-amber-950 shadow-sm hover:bg-amber-400"
                  aria-label={`Broadcast ${Math.min(6, broadcastPickCount)} selected cards`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7M8 7h9v9" />
                  </svg>
                  <span className="text-[11px] font-black tabular-nums">{Math.min(6, broadcastPickCount)}</span>
                </button>
              </HintWrap>
            )}
            <details
              ref={roomActionsRef}
              className="relative z-[60]"
            >
              <summary
                className="iboard-header-icon-button flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title="Room settings"
                aria-label="Room settings"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
                  <path d="M2 14h4M10 8h4M18 16h4" />
                </svg>
              </summary>
              <div className="absolute right-0 z-[60] mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <p className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Card view</p>
                <div className="mb-1 flex gap-1 px-2">
                  {CARD_VIEWS.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      onClick={() => setCardView(view.id)}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${
                        cardView === view.id
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                      }`}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <p className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Lesson</p>
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    <span>Word target</span>
                    <span className="font-mono text-indigo-600">{wt}</span>
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
                    className="mt-1 h-1.5 w-full cursor-pointer accent-indigo-600"
                    aria-label="Word target"
                  />
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  <span>Enforce word count</span>
                  <input
                    type="checkbox"
                    checked={enforceWords}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setRoom((r) => (r ? { ...r, enforce_word_count: v } : r));
                      pushSettings({ enforce_word_count: v });
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const v = !frozen;
                    setRoom((r) => (r ? { ...r, freeze_class: v } : r));
                    pushSettings({ freeze_class: v });
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {frozen ? 'Unfreeze class' : 'Freeze class'}
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {isDark ? 'Light mode' : 'Dark mode'}
                </button>
                {fixedCommentCount > 0 && (
                  <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/40">
                    {!clearFixedArmed ? (
                      <button
                        type="button"
                        onClick={() => setClearFixedArmed(true)}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                      >
                        <span>Clear fixed comments</span>
                        <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-black text-white">
                          {fixedCommentCount}
                        </span>
                      </button>
                    ) : (
                      <div className="space-y-2 px-1 py-0.5">
                        <p className="text-[11px] font-semibold leading-snug text-emerald-900 dark:text-emerald-100">
                          Remove {fixedCommentCount} green tick{fixedCommentCount === 1 ? '' : 's'}? Purple comments stay.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={clearFixedBusy}
                            onClick={() => {
                              window.dispatchEvent(new Event('iboard:clear-fixed-comments'));
                              setClearFixedArmed(false);
                              closeRoomMenu();
                            }}
                            className="flex-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {clearFixedBusy ? 'Clearing…' : 'Clear'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setClearFixedArmed(false)}
                            className="rounded-lg px-2 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <button type="button" onClick={() => openLibrary('feedback')} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  AI feedback
                </button>
                <button type="button" onClick={() => openLibrary('evidence')} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Saved evidence
                  {snapshots.length > 0 && (
                    <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">{snapshots.length}</span>
                  )}
                </button>
                <button type="button" onClick={() => openLibrary('reports')} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Student reports
                </button>
                <button type="button" onClick={() => { closeRoomMenu(); openEvidenceModal(); }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Save current evidence
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <button type="button" onClick={() => { closeRoomMenu(); openJoinScreen(); }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Present join screen
                </button>
                <button type="button" onClick={() => { closeRoomMenu(); downloadParticipantList(); }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Download participant list
                </button>
                <button type="button" onClick={openLessonReport} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  View lesson report
                </button>
                <button type="button" onClick={downloadLessonReportQuick} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Download lesson report
                </button>
                <a href={`/pulse/teacher?code=${encodeURIComponent(codeInput)}`} className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Open Ask-only window ↗
                </a>
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <button type="button" onClick={() => { closeRoomMenu(); openNewClassConfirmation(); }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40">
                  Start new class
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>
      </div>

      {toolsPanelOpen && (
        <div
          ref={teacherToolsPanelRef}
          className="iboard-header-dock fixed right-0 z-[60] w-[min(29rem,100vw)] border-l border-t border-slate-200 bg-white shadow-[-8px_0_24px_-18px_rgba(15,23,42,0.35)] dark:border-slate-700 dark:bg-slate-900"
          style={headerDockStyle}
          role="dialog"
          aria-label={`${TEACHER_TOOLS_TABS.find((tab) => tab.id === toolsTab)?.label || 'Teacher tools'} panel`}
        >
          <LiveResponseTeacher
            socket={socket}
            overlay
            panelTab={toolsTab}
            onPanelTabChange={setToolsTab}
            onClose={closeTeacherTools}
            onQuestionLaunched={() => setToolsTab('responses')}
            highlightStudentId={toolsHighlightStudentId}
            onClearHighlight={() => setToolsHighlightStudentId(null)}
            onCopyStudentLink={copyStudentJoinLink}
          />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <main className="mx-auto flex w-full max-w-[1800px] min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-3 pt-6 sm:px-6">
          {copyToast && (
            <div className="mb-2 inline-flex shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {copyToast}
            </div>
          )}
          {error && <p className="mb-2 shrink-0 text-sm text-red-600">{error}</p>}

              {livePulse.activity && (
                <div className="iboard-live-question mb-2 shrink-0 rounded-xl border px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-[10px] font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                    Question live
                  </p>
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {livePulse.activity.prompt}
                  </p>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto pb-2 scrollbar-thin">
        <div className={`grid gap-4 ${studentGridClass}`}>
          {orderedStudents.length === 0 && posts.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900/60 p-10 text-center text-slate-500 dark:text-slate-400">
              Waiting for students to join…
            </div>
          )}
          {posts.map((post) => (
            <article key={`post-${post.id}`} className="flex flex-col rounded-2xl border border-slate-300 bg-slate-100/80 p-3 shadow-card dark:border-slate-600 dark:bg-slate-800/50">
              <div className="flex items-center gap-1.5">
                <HintWrap hint="Send to Inbox">
                  <label className="flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={!!broadcastPick[`post:${post.id}`]}
                      onChange={() => toggleBroadcastCard(`post:${post.id}`)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 dark:border-slate-600"
                    />
                    <span className="sr-only">Include teacher card in broadcast</span>
                  </label>
                </HintWrap>
                <h2 className="min-w-0 flex-1 truncate font-display text-base font-bold text-ink-900 dark:text-slate-100">{post.title || 'Teacher'}</h2>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-200">Teacher</span>
                <HintWrap hint="Remove card">
                  <button
                    type="button"
                    onClick={() => deleteTeacherCard(post.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-200 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                    aria-label="Remove teacher card"
                  >
                    ×
                  </button>
                </HintWrap>
              </div>
              <div className={`mt-2 rounded-xl bg-white p-2.5 text-sm leading-relaxed text-slate-700 scrollbar-thin dark:bg-slate-950 dark:text-slate-300 ${writingPaneClass}`}>
                {post.kind === 'image' && post.image_url ? (
                  <img src={post.image_url} alt={post.title || 'Teacher card'} className="mx-auto max-h-80 w-full object-contain" />
                ) : post.text?.trim() ? (
                  <p className="whitespace-pre-wrap break-words">{post.text}</p>
                ) : (
                  <span className="italic text-slate-400">Empty card</span>
                )}
              </div>
            </article>
          ))}
          {visibleStudents.map((s) => {
            const displayText = s.text || '';
            const wc = wordCount(s.text);
            const st = activityStatus(s.updated_at);
            const pulseStudent = liveStudentById.get(Number(s.id));
            const inQuestion = !!livePulse.activity;
            const pulseMeta = pulseStudent ? studentTileMeta(pulseStudent) : null;
            const showPulseState = pulseMeta && (inQuestion || (pulseStudent.engagement_status && pulseStudent.engagement_status !== 'ready'));
            const liveResponse = inQuestion
              ? (livePulse.responses || []).find((response) => Number(response.studentId) === Number(s.id))
              : null;
            const light =
              showPulseState
                ? pulseStudent?.hasResponded
                  ? 'bg-indigo-500'
                  : pulseStudent?.connected
                    ? 'bg-amber-500'
                    : 'bg-slate-200'
                : st === 'live'
                  ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]'
                  : st === 'warm'
                    ? 'bg-amber-400'
                    : 'bg-slate-300';
            return (
              <article
                key={s.id}
                data-student-id={s.id}
                title={showPulseState ? pulseMeta.title : undefined}
                className={`iboard-student-card relative flex flex-col overflow-visible rounded-2xl bg-white p-3 dark:bg-slate-900 ${
                  showPulseState ? pulseMeta.className : 'border dark:border-slate-700/80'
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <HintWrap hint="Send to Inbox">
                    <label className="flex shrink-0 cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={!!broadcastPick[s.id]}
                        onChange={() => toggleBroadcastCard(s.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 dark:border-slate-600"
                      />
                      <span className="sr-only">Include in broadcast</span>
                    </label>
                  </HintWrap>
                  <h2
                    className={`min-w-0 flex-1 truncate font-display text-base font-semibold text-ink-900 dark:text-slate-100 ${inQuestion ? 'cursor-pointer hover:text-indigo-700 dark:hover:text-indigo-300' : ''}`}
                    title={inQuestion ? `Show ${s.name}'s answer` : `${s.name} · ID #${s.id}`}
                    onClick={inQuestion ? () => openAnswerInRail(s.id) : undefined}
                  >
                    {s.name}
                  </h2>
                  <span title={showPulseState ? pulseMeta.title : 'Writing activity'} className={`h-2 w-2 shrink-0 rounded-full ${light}`} />
                  {showPulseState && inQuestion && pulseStudent?.hasResponded ? (
                    <button
                      type="button"
                      onClick={() => openAnswerInRail(s.id)}
                      className="max-w-[6rem] shrink-0 truncate rounded-full bg-indigo-50 px-1.5 py-0.5 text-left text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900"
                      title={liveResponse?.value || pulseMeta.title}
                    >
                      {liveResponse?.value || 'Answered'}
                    </button>
                  ) : !showPulseState || !inQuestion ? (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                      {wc}w
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                  {gradeShortLabel(s.year_level) && (
                    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {gradeShortLabel(s.year_level)}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-0.5 opacity-70 transition hover:opacity-100">
                    <HintWrap hint={copiedStudentId === s.id ? 'Copied!' : 'Copy draft'}>
                      <button
                        type="button"
                        disabled={!displayText.trim()}
                        onClick={(event) => {
                          event.stopPropagation();
                          copyStudentText(s);
                        }}
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-30 ${
                          copiedStudentId === s.id
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                        }`}
                        aria-label={
                          copiedStudentId === s.id
                            ? `Copied ${s.name}'s writing`
                            : `Copy ${s.name}'s writing`
                        }
                      >
                        {copiedStudentId === s.id ? (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        ) : (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="8" y="8" width="11" height="11" rx="2" />
                            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                          </svg>
                        )}
                      </button>
                    </HintWrap>
                    <HintWrap hint="Save file">
                      <button
                        type="button"
                        onClick={() => downloadOneStudent(s)}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label={`Save ${s.name}'s draft`}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3v12" />
                          <path d="m7 10 5 5 5-5" />
                          <path d="M5 21h14" />
                        </svg>
                      </button>
                    </HintWrap>
                    <HintWrap hint="Send note">
                      <button
                        type="button"
                        onClick={() => openNoteForStudent(s)}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label={`Note ${s.name}`}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </HintWrap>
                    <HintWrap hint="Open card">
                      <button
                        type="button"
                        onClick={() => setFocusedStudentId(s.id)}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label={`Open ${s.name}'s full draft`}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 3h6v6" />
                          <path d="M10 14 21 3" />
                          <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                        </svg>
                      </button>
                    </HintWrap>
                    <HintWrap hint="Remove card">
                      <button
                        type="button"
                        onClick={() => requestRemoveStudent(s)}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600 dark:text-slate-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                        aria-label={`Remove ${s.name} from the room`}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </HintWrap>
                  </div>
                </div>
                <div
                  data-student-writing-pane
                  className={`iboard-writing-surface relative mt-2 rounded-xl p-2.5 pr-9 text-sm leading-relaxed text-slate-700 scrollbar-thin dark:bg-slate-950 dark:text-slate-300 ${writingPaneClass}`}
                >
                  {s.image_url && (
                    <div className="relative mb-2 overflow-hidden rounded-lg bg-white dark:bg-slate-900">
                      <AnnotatedStudentImage
                        imageUrl={s.image_url}
                        markupUrl={s.teacher_markup_url}
                        alt={`${s.name}'s drawing`}
                        imageClassName="max-h-36 w-full object-contain"
                      />
                      <button
                        type="button"
                        onClick={() => setDrawingMarkupTarget(s)}
                        className="absolute bottom-2 right-2 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-black text-white shadow-lg hover:bg-indigo-700"
                      >
                        ✎ Mark up
                      </button>
                    </div>
                  )}
                  {displayText ? (
                    <div data-iboard-writing-content className="relative">
                      <RichTextDisplay html={s.rich_text_html} text={displayText} />
                    </div>
                  ) : !s.image_url ? (
                    <span className="italic text-slate-400 dark:text-slate-500">No text yet</span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
              </div>
      </main>
      </div>

      {lessonReportOpen && (
        <LessonReportPanel roomCode={codeInput} onClose={() => setLessonReportOpen(false)} />
      )}

      {libraryPanel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-panel-title"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h2 id="library-panel-title" className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">
                {libraryPanel === 'feedback' ? 'AI feedback' : libraryPanel === 'evidence' ? 'Saved evidence' : 'Student reports'}
              </h2>
              <button type="button" onClick={() => setLibraryPanel(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
                ×
              </button>
            </div>
            <div className="overflow-y-auto p-5 scrollbar-thin">
        {libraryPanel === 'evidence' && snapshots.length === 0 && (
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

        {libraryPanel === 'reports' && snapshots.length === 0 && (
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

        {(libraryPanel === 'evidence' || libraryPanel === 'reports') && snapshots.length > 0 && (
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
                    {libraryPanel === 'reports' ? 'Student reports' : 'Saved evidence'}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    {snapshots.length} {snapshots.length === 1 ? 'save' : 'saves'}
                  </span>
                </span>
                <span className="mt-1 block truncate text-sm text-slate-600 dark:text-slate-400">
                  {libraryPanel === 'reports'
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
                {libraryPanel === 'evidence' && (
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Download any earlier save again as HTML.</p>
                )}
                {libraryPanel === 'reports' && (
                <section className="mt-4 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm dark:border-indigo-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">Student reports</p>
                      <h4 className="mt-1 font-display text-lg font-semibold text-ink-900 dark:text-slate-100">Browse saved work quickly</h4>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose a name on the left; their complete saved history appears on the right.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (reportMergeMode) cancelReportMerge();
                        else {
                          setReportMergeMode(true);
                          setReportMergeKeys([]);
                          setReportMergeCanonicalKey('');
                        }
                      }}
                      className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                        reportMergeMode
                          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
                          : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200'
                      }`}
                    >
                      {reportMergeMode ? 'Cancel combining' : 'Combine names'}
                    </button>
                  </div>

                  <div className="grid min-h-[34rem] border-t border-indigo-100 dark:border-slate-700 md:grid-cols-[17rem_minmax(0,1fr)]">
                    <aside className="flex min-h-0 flex-col border-b border-indigo-100 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/40 md:border-b-0 md:border-r">
                      <div className="border-b border-slate-200 p-3 dark:border-slate-700">
                        <label htmlFor="report-student-search" className="sr-only">Search students</label>
                        <input
                          id="report-student-search"
                          value={reportSearch}
                          onChange={(event) => setReportSearch(event.target.value)}
                          placeholder="Search students…"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                        {reportMergeMode && (
                          <p className="mt-2 text-[11px] font-semibold leading-relaxed text-indigo-700 dark:text-indigo-300">
                            Tick every name used by the same student.
                          </p>
                        )}
                      </div>

                      <div className="max-h-[32rem] flex-1 overflow-y-auto p-2 scrollbar-thin">
                        {evidenceStudentsBusy && (
                          <p className="p-3 text-sm text-slate-500 dark:text-slate-400">Loading students…</p>
                        )}
                        {!evidenceStudentsBusy && filteredEvidenceStudents.map((profile) => (
                          reportMergeMode ? (
                            <label
                              key={profile.key}
                              className={`mb-1 flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 transition ${
                                reportMergeKeys.includes(profile.key)
                                  ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/50'
                                  : 'border-transparent bg-white hover:border-indigo-200 dark:bg-slate-900 dark:hover:border-indigo-800'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={reportMergeKeys.includes(profile.key)}
                                onChange={() => toggleReportMergeProfile(profile.key)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-black text-slate-900 dark:text-white">{profile.name}</span>
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                                  {profile.entries.length} {profile.entries.length === 1 ? 'submission' : 'submissions'}
                                  {profile.combined ? ' · combined' : ''}
                                </span>
                              </span>
                            </label>
                          ) : (
                            <button
                              key={profile.key}
                              type="button"
                              onClick={() => setSelectedEvidenceStudentKey(profile.key)}
                              aria-pressed={selectedEvidenceStudentKey === profile.key}
                              className={`mb-1 flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                                selectedEvidenceStudentKey === profile.key
                                  ? 'border-indigo-300 bg-indigo-600 text-white shadow-sm dark:border-indigo-500'
                                  : 'border-transparent bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 dark:bg-slate-900 dark:text-white dark:hover:border-indigo-800 dark:hover:bg-indigo-950/40'
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-black">{profile.name}</span>
                                {profile.combined && (
                                  <span className={`block truncate text-[10px] font-semibold ${selectedEvidenceStudentKey === profile.key ? 'text-indigo-100' : 'text-indigo-600 dark:text-indigo-300'}`}>
                                    Combined profile
                                  </span>
                                )}
                              </span>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                                selectedEvidenceStudentKey === profile.key
                                  ? 'bg-white/20 text-white'
                                  : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'
                              }`}>
                                {profile.entries.length}
                              </span>
                            </button>
                          )
                        ))}
                        {!evidenceStudentsBusy && !filteredEvidenceStudents.length && (
                          <p className="p-3 text-sm text-slate-500 dark:text-slate-400">
                            {evidenceStudents.length ? 'No students match that search.' : 'No written submissions were found in these saves.'}
                          </p>
                        )}
                      </div>

                      {reportMergeMode && (
                        <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                            {reportMergeKeys.length} selected
                          </p>
                          {reportMergeKeys.length >= 2 && (
                            <>
                              <label htmlFor="report-canonical-name" className="mt-2 block text-[11px] font-bold text-slate-600 dark:text-slate-300">Name to keep</label>
                              <select
                                id="report-canonical-name"
                                value={reportMergeCanonicalKey}
                                onChange={(event) => setReportMergeCanonicalKey(event.target.value)}
                                className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-900 dark:border-indigo-800 dark:bg-slate-950 dark:text-white"
                              >
                                {reportMergeProfiles.map((profile) => (
                                  <option key={profile.key} value={profile.key}>{profile.name}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={reportMergeBusy || !reportMergeCanonicalKey}
                                onClick={combineReportProfiles}
                                className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {reportMergeBusy ? 'Combining…' : 'Combine selected names'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </aside>

                    <div className="min-w-0 p-4">
                      {selectedEvidenceStudent ? (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
                            <div className="min-w-0">
                              <p className="truncate font-display text-xl font-black text-slate-900 dark:text-white">{selectedEvidenceStudent.name}</p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {selectedEvidenceStudent.entries.length} {selectedEvidenceStudent.entries.length === 1 ? 'submission' : 'submissions'} · {selectedEvidenceStudent.entries.reduce((total, entry) => total + wordCount(entry.text), 0)} words
                              </p>
                              {(selectedEvidenceStudent.aliases || []).length > 1 && (
                                <p className="mt-1 text-[11px] text-indigo-700 dark:text-indigo-300">
                                  Joined as: {selectedEvidenceStudent.aliases.join(', ')}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {selectedEvidenceStudent.combined && (
                                <button
                                  type="button"
                                  disabled={reportMergeBusy}
                                  onClick={separateReportProfile}
                                  className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                                >
                                  Separate names
                                </button>
                              )}
                              <button type="button" onClick={copyStudentPortfolio} className="rounded-lg bg-indigo-100 px-3 py-2 text-xs font-black text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200">Copy all</button>
                              <button type="button" onClick={downloadStudentPortfolio} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Download portfolio</button>
                            </div>
                          </div>
                          <div className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                            {selectedEvidenceStudent.entries.map((entry) => (
                              <article key={`${entry.snapshotId}-${entry.studentId}-${entry.updatedAt}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="font-bold text-slate-900 dark:text-white">{entry.label}</p>
                                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                      {entry.createdAt} · {wordCount(entry.text)} words
                                      {(selectedEvidenceStudent.aliases || []).length > 1 && entry.sourceName ? ` · as ${entry.sourceName}` : ''}
                                    </p>
                                  </div>
                                  <button type="button" onClick={() => loadSnapshotForView(entry.snapshotId)} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-300">Open lesson save</button>
                                </div>
                                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">{entry.text}</p>
                              </article>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="grid min-h-[28rem] place-items-center text-center">
                          <div>
                            <p className="font-display text-lg font-black text-slate-700 dark:text-slate-200">Choose a student</p>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Their saved work will appear here.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    iBoard still matches capital letters and extra spaces automatically. Other name variations are combined only when you approve them.
                  </p>
                </section>
                )}
                {libraryPanel === 'evidence' && (
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

        {libraryPanel === 'feedback' && (
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
          </div>
        </div>
      )}

      {joinScreenOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center overflow-auto bg-gradient-to-br from-indigo-950 via-indigo-950 to-slate-950 p-5 text-white sm:p-10"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-screen-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setJoinScreenOpen(false);
          }}
        >
          <button
            type="button"
            autoFocus
            onClick={() => setJoinScreenOpen(false)}
            className="fixed right-5 top-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-indigo-950 shadow-xl"
          >
            Back to dashboard
          </button>
          <div className="mx-auto w-full max-w-5xl text-center">
            <p className="text-sm font-black uppercase tracking-[0.3em] text-indigo-300">Join this iBOARD session</p>
            <h2 id="join-screen-title" className="mt-6 font-display text-4xl font-black sm:text-6xl">Enter room code</h2>
            <p className="mt-5 font-mono text-[clamp(5rem,20vw,12rem)] font-black leading-none tracking-[0.08em] text-white">
              {codeInput}
            </p>
            <p className="mx-auto mt-6 max-w-3xl break-all rounded-2xl bg-white/10 px-5 py-4 text-lg font-bold text-indigo-100 ring-1 ring-white/20 sm:text-2xl">
              {studentJoinUrl()}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={copyStudentJoinLink} className="rounded-2xl bg-emerald-400 px-6 py-3 text-base font-black text-emerald-950 shadow-xl hover:bg-emerald-300">
                Copy join link
              </button>
              <span className="rounded-2xl bg-white/10 px-5 py-3 text-base font-bold ring-1 ring-white/20">
                {orderedStudents.length} joined
              </span>
            </div>
            <p className="mt-7 text-sm font-semibold text-white/60">Keep this screen up while participants arrive.</p>
          </div>
        </div>
      )}

      {newClassConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-[2px] sm:items-center">
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-red-200 bg-white shadow-2xl dark:border-red-900 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-class-confirm-title"
            aria-describedby="new-class-confirm-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeNewClassConfirmation();
            }}
          >
            <div className="flex items-start gap-4 border-b border-slate-200 px-5 py-5 dark:border-slate-700">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-100 text-xl font-black text-red-700 dark:bg-red-950 dark:text-red-300" aria-hidden="true">
                !
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-600 dark:text-red-300">Room action</p>
                <h2 id="new-class-confirm-title" className="mt-1 font-display text-xl font-black text-slate-950 dark:text-white">
                  Start a new class?
                </h2>
                <p id="new-class-confirm-description" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  This removes every student card and teacher card from Room <span className="font-mono font-bold text-slate-900 dark:text-white">{codeInput}</span>. Students will need to join again. Download the lesson report first if you want to keep participation data.
                </p>
              </div>
            </div>
            {error && (
              <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            )}
            <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
              <button
                type="button"
                disabled={newClassBusy}
                onClick={downloadLessonReportQuick}
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
              >
                Download lesson report first
              </button>
            </div>
            <div className="flex flex-col-reverse gap-2 bg-slate-50 px-5 py-4 dark:bg-slate-950 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                disabled={newClassBusy}
                onClick={closeNewClassConfirmation}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Keep current class
              </button>
              <button
                type="button"
                disabled={newClassBusy}
                onClick={startNewClass}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
              >
                {newClassBusy ? 'Starting…' : 'Clear board & start'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addCardOpen && (
        <div
          ref={addCardPanelRef}
          data-iboard-add-card-panel="true"
          className="iboard-header-dock fixed right-0 z-[60] w-[min(29rem,100vw)] border-l border-t border-slate-200 bg-white shadow-[-8px_0_24px_-18px_rgba(15,23,42,0.35)] dark:border-slate-700 dark:bg-slate-900"
          style={headerDockStyle}
          role="dialog"
          aria-modal="false"
          aria-labelledby="add-teacher-card-title"
        >
          <form
            className="flex flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              submitTeacherCard();
            }}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 id="add-teacher-card-title" className="font-display text-base font-black text-slate-950 dark:text-white">Add card</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Text or paste a screenshot</p>
              </div>
              <button type="button" onClick={closeAddCard} disabled={addCardBusy} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 dark:text-indigo-400">
                Close
              </button>
            </div>
            <div className="space-y-3 px-4 py-3">
              <input
                autoFocus
                value={addCardTitle}
                onChange={(event) => setAddCardTitle(event.target.value)}
                maxLength={80}
                aria-label="Card title"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-400 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                placeholder="Title"
              />
              <textarea
                value={addCardText}
                onChange={(event) => setAddCardText(event.target.value)}
                onPaste={handleAddCardPaste}
                rows={5}
                disabled={!!addCardImage}
                aria-label="Card text"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-400 focus:border-indigo-400 focus:ring-2 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                placeholder="Write here, or paste a screenshot…"
              />
              {addCardImage && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/30">
                  <img src={addCardImage} alt="Pasted card preview" className="max-h-48 w-full object-contain" />
                  <button type="button" onClick={() => setAddCardImage('')} className="mt-2 text-xs font-bold text-indigo-600 dark:text-indigo-400">Clear image</button>
                </div>
              )}
              {addCardError && <p className="text-sm font-semibold text-red-600 dark:text-red-300">{addCardError}</p>}
            </div>
            <label
              data-iboard-add-card-send-option="true"
              className="flex shrink-0 cursor-pointer items-center gap-2 border-t border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              <input type="checkbox" data-iboard-send-inbox="true" defaultChecked className="h-4 w-4 accent-indigo-600" />
              <span>Send to Inbox</span>
            </label>
            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
              <button type="button" disabled={addCardBusy} onClick={closeAddCard} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="submit" disabled={addCardBusy || (!addCardImage && !addCardText.trim())} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50">
                {addCardBusy ? 'Adding…' : 'Add card'}
              </button>
            </div>
          </form>
        </div>
      )}

      {removeStudentTarget && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-[1px] sm:items-center">
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-student-title"
            aria-describedby="remove-student-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeRemoveStudentConfirm();
            }}
          >
            <div className="px-5 py-5">
              <h2 id="remove-student-title" className="font-display text-lg font-black text-slate-950 dark:text-white">
                Remove {removeStudentTarget.name}?
              </h2>
              <p id="remove-student-description" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Their card disappears from the board. They can join again with a new card.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-950 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                disabled={removeStudentBusy}
                onClick={closeRemoveStudentConfirm}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removeStudentBusy}
                onClick={confirmRemoveStudent}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
              >
                {removeStudentBusy ? 'Removing…' : 'Remove card'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <button type="button" onClick={() => { setFocusedStudentId(null); openNoteForStudent(focusedStudent); }} className="rounded-xl border border-indigo-200 px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                  Send note
                </button>
                {focusedStudent.image_url && (
                  <button type="button" onClick={() => setDrawingMarkupTarget(focusedStudent)} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white hover:bg-indigo-700">
                    ✎ Mark up drawing
                  </button>
                )}
                <button type="button" onClick={() => setFocusedStudentId(null)} className="flex h-10 w-10 items-center justify-center rounded-xl text-xl font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Close full draft">
                  ×
                </button>
              </div>
            </div>
            <div data-student-writing-pane className="relative min-h-0 flex-1 overflow-x-visible overflow-y-auto whitespace-pre-wrap px-6 py-5 pr-12 text-base leading-7 text-slate-800 scrollbar-thin dark:text-slate-200">
              {focusedStudent.image_url && (
                <AnnotatedStudentImage
                  imageUrl={focusedStudent.image_url}
                  markupUrl={focusedStudent.teacher_markup_url}
                  alt={`${focusedStudent.name}'s drawing`}
                  className="mb-5"
                  imageClassName="max-h-80 w-full object-contain"
                />
              )}
              {focusedStudent.text ? (
                <div data-iboard-writing-content className="relative">
                  <RichTextDisplay html={focusedStudent.rich_text_html} text={focusedStudent.text} />
                </div>
              ) : !focusedStudent.image_url ? (
                <span className="italic text-slate-400 dark:text-slate-500">No text yet</span>
              ) : null}
            </div>
          </article>
        </div>
      )}

      {drawingMarkupTarget?.image_url && (
        <TeacherDrawingMarkup
          student={drawingMarkupTarget}
          socket={socket}
          onClose={() => setDrawingMarkupTarget(null)}
        />
      )}

      {noteTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <form
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
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
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-indigo-600 dark:text-indigo-300">
                  Private feedback
                </p>
                <h2 id="private-note-title" className="mt-1 font-display text-lg font-bold text-ink-900 dark:text-slate-100">
                  Note for {noteTarget.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  This will appear in the student&apos;s Inbox tab.
                </p>
              </div>
              <button
                type="button"
                disabled={noteSending}
                onClick={closeNoteComposer}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Close private note"
              >
                ×
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
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
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
                {(visibleStudents.length ? visibleStudents : orderedStudents).length === 1 ? '' : 's'}.
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
                ×
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
                ×
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
