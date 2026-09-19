import { RemoveButton, CloseButton } from '../components/PanelActions.jsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { createSocket } from '../lib/socket.js';
import DraftTrailPanel from '../components/DraftTrailPanel.jsx';
import SessionPdfExport from '../components/SessionPdfExport.jsx';
import { activityStatus, isNotStarted, wordCount } from '../lib/text.js';
import useActivityClock from '../hooks/useActivityClock.js';
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
import RoomTimerPill from '../components/RoomTimerPill.jsx';
import ThinkingTrigger from '../components/ThinkingTrigger.jsx';
import { confirmDialog } from '../components/ConfirmDialogHost.jsx';
import QuestionInboxReply from '../components/QuestionInboxReply.jsx';
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
import { formatLiveAnswer } from '../lib/liveResponseUnknown.js';
import { useTheme } from '../lib/theme.jsx';
import HintWrap from '../components/HintWrap.jsx';
import LessonReportPanel from '../components/LessonReportPanel.jsx';
import { downloadLessonReportHtml } from '../lib/lessonReport.js';
import { placementNearAnchor } from '../lib/clampPopup.js';
import { subscribeViewportChanges } from '../lib/viewport.js';
import { lastTeacherRoomCode, rememberTeacherRoomCode } from '../lib/teacherRoom.js';
import {
  downloadSessionPack,
  emitAck,
  readSessionFile,
} from '../lib/iboardSession.js';

const NOTE_COMPOSER_WIDTH = 384;
const NOTE_COMPOSER_EST_HEIGHT = 360;

const MODE_LABELS = {
  writing: 'Writing',
  explanation: 'Explanation',
  argument: 'Argument',
  problem_solving: 'Problem Solving',
  custom: 'Custom',
};

const CARD_VIEW_STORAGE_KEY = 'iboard-teacher-card-view';
const OVERVIEW_COLUMNS_STORAGE_KEY = 'iboard-overview-columns';
const CARD_FONT_STORAGE_KEY = 'iboard-teacher-card-fonts';
const TEACHER_PANEL_HIDDEN_KEY = 'iboard-teacher-panel-hidden';
const MONITOR_STORAGE_KEY = 'iboard-teacher-monitor';
const LEGACY_WATCH_STORAGE_KEY = 'iboard-teacher-watch';
/** Per-card writing size steps (applied as rem so rich HTML inherits). */
const CARD_FONT_REMS = [0.75, 0.875, 1, 1.125, 1.25];
const CARD_FONT_DEFAULT = 2; /* index of 1rem */
const CARD_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'reading', label: 'Reading' },
  { id: 'full', label: 'Full drafts' },
];
/** Overview density steps (Classroom-style column count). Default 4 suits 10–11" iPads. */
const OVERVIEW_COLUMN_OPTIONS = [6, 5, 4, 3];
const OVERVIEW_COLUMNS_DEFAULT = 4;
const OVERVIEW_GRID_CLASS = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
};

function monitorRoomKey(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 4);
}

function readMonitorMap() {
  try {
    const raw = localStorage.getItem(MONITOR_STORAGE_KEY) || localStorage.getItem(LEGACY_WATCH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readMonitoredIdsForRoom(code) {
  const key = monitorRoomKey(code);
  if (key.length !== 4) return new Set();
  const list = readMonitorMap()[key];
  if (!Array.isArray(list)) return new Set();
  return new Set(list.map(Number).filter((id) => Number.isFinite(id) && id > 0));
}

function writeMonitoredIdsForRoom(code, ids) {
  const key = monitorRoomKey(code);
  if (key.length !== 4) return;
  try {
    const map = readMonitorMap();
    map[key] = [...ids];
    localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* Monitor list is optional when storage is unavailable. */
  }
}

function readCardFontMap() {
  try {
    const raw = localStorage.getItem(CARD_FONT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function cardFontIndex(map, studentId) {
  const idx = Number(map?.[studentId]);
  if (!Number.isFinite(idx)) return CARD_FONT_DEFAULT;
  return Math.max(0, Math.min(CARD_FONT_REMS.length - 1, Math.round(idx)));
}

function cardFontRem(map, studentId) {
  return CARD_FONT_REMS[cardFontIndex(map, studentId)];
}

function CardViewIcon({ id }) {
  if (id === 'overview') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
        <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
        <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
        <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
      </svg>
    );
  }
  if (id === 'reading') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3" width="6.5" height="14" rx="1.2" />
        <rect x="11" y="3" width="6.5" height="14" rx="1.2" />
        <path d="M4.2 6.5h3M4.2 9.2h3M4.2 11.9h2.2M12.7 6.5h3M12.7 9.2h3M12.7 11.9h2.2" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="2.5" width="11" height="15" rx="1.4" />
      <path d="M7 6.5h6M7 9.5h6M7 12.5h4" />
    </svg>
  );
}

const TEACHER_TOOLS_TABS = [
  { id: 'ask', label: 'Ask', icon: '/rail/ask-icon.png' },
  { id: 'respond', label: 'Reply', icon: '/rail/reply-icon.png' },
  { id: 'responses', label: 'Responses', icon: '/rail/responses-icon.png' },
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

function initialOverviewColumns() {
  if (typeof window === 'undefined') return OVERVIEW_COLUMNS_DEFAULT;
  try {
    const saved = Number(localStorage.getItem(OVERVIEW_COLUMNS_STORAGE_KEY));
    return OVERVIEW_COLUMN_OPTIONS.includes(saved) ? saved : OVERVIEW_COLUMNS_DEFAULT;
  } catch {
    return OVERVIEW_COLUMNS_DEFAULT;
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
    created_at: s.created_at || null,
    class_group: s.class_group != null ? String(s.class_group) : '',
    breakout_room_id: s.breakout_room_id != null ? String(s.breakout_room_id) : '',
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
  const activityNow = useActivityClock(5000);
  const [searchParams] = useSearchParams();
  const codeFromLink = String(searchParams.get('code') || '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const rememberedRoomRef = useRef(codeFromLink.length === 4 ? '' : lastTeacherRoomCode());
  const [codeInput, setCodeInput] = useState(() =>
    codeFromLink.length === 4 ? codeFromLink : rememberedRoomRef.current || randomRoomCode()
  );
  const clearPrefilledCodeOnFocusRef = useRef(codeFromLink.length !== 4);
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState(null);
  const [students, setStudents] = useState([]);
  const [breakouts, setBreakouts] = useState({ active: false, rooms: [], roomCount: 0 });
  const [breakoutBusy, setBreakoutBusy] = useState(false);
  const [breakoutRoomCountDraft, setBreakoutRoomCountDraft] = useState(1);
  const [breakoutSetupMode, setBreakoutSetupMode] = useState('auto'); // 'auto' | 'manual'
  /** @type {[Record<string, string>, Function]} studentId -> room id or '' */
  const [breakoutDraftAssign, setBreakoutDraftAssign] = useState({});
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState('');
  const [socketConnected, setSocketConnected] = useState(true);
  const [newClassConfirmOpen, setNewClassConfirmOpen] = useState(false);
  const [newClassBusy, setNewClassBusy] = useState(false);
  const [joinScreenOpen, setJoinScreenOpen] = useState(false);
  const [drawingMarkupTarget, setDrawingMarkupTarget] = useState(null);
  const [audienceQuestions, setAudienceQuestions] = useState([]);
  const [handQuestionTarget, setHandQuestionTarget] = useState(null);

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
  const [noteUrgent, setNoteUrgent] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const [noteReceiptByStudentId, setNoteReceiptByStudentId] = useState({});
  const [noteReplyByStudentId, setNoteReplyByStudentId] = useState({});
  const noteReplyByStudentIdRef = useRef({});
  const [noteAnchorRect, setNoteAnchorRect] = useState(null);
  const [noteBox, setNoteBox] = useState(null);
  const noteComposerRef = useRef(null);
  const noteDraftRef = useRef(null);
  const noteFocusTargetRef = useRef(null);
  const [broadcastPick, setBroadcastPick] = useState({});
  const [sendToMenuOpen, setSendToMenuOpen] = useState(false);
  const [sendRecipientPick, setSendRecipientPick] = useState({});
  const sendToMenuRef = useRef(null);
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
  const settingsButtonRef = useRef(null);
  const settingsPanelRef = useRef(null);
  const settingsChromeRef = useRef(null);
  const breakoutAssignPanelRef = useRef(null);
  const [settingsChromeHeight, setSettingsChromeHeight] = useState(44);
  const [teacherToolsTop, setTeacherToolsTop] = useState(0);
  const [removeStudentTarget, setRemoveStudentTarget] = useState(null);
  const [removeStudentBusy, setRemoveStudentBusy] = useState(false);
  const [lessonReportOpen, setLessonReportOpen] = useState(false);
  const [libraryPanel, setLibraryPanel] = useState(null);
  const [evidenceHubTab, setEvidenceHubTab] = useState('lessons'); // lessons | students

  const [fixedCommentCount, setFixedCommentCount] = useState(0);
  const [clearFixedBusy, setClearFixedBusy] = useState(false);
  const [clearFixedArmed, setClearFixedArmed] = useState(false);
  const [livePulse, setLivePulse] = useState({ activity: null, responses: [], students: [] });
  const [cardView, setCardView] = useState(initialCardView);
  const [overviewColumns, setOverviewColumns] = useState(initialOverviewColumns);
  const [overviewColumnsOpen, setOverviewColumnsOpen] = useState(false);
  const [cardFontById, setCardFontById] = useState(readCardFontMap);
  const [focusedStudentId, setFocusedStudentId] = useState(null);
  const [focusedPostId, setFocusedPostId] = useState(null);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [monitoredIds, setMonitoredIds] = useState(() => new Set());
  /** studentId → away (tab/app background). Synced from student:presence + live:teacher. */
  const [awayByStudentId, setAwayByStudentId] = useState(() => new Map());
  /** Pin attention cards (away / not started) to the top when true. */
  const [attentionFocus, setAttentionFocus] = useState(false);
  const [studentActionMenuId, setStudentActionMenuId] = useState(null);
  const [studentActionMenuAnchor, setStudentActionMenuAnchor] = useState(null);
  const studentActionMenuBtnRefs = useRef(new Map());
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teacherPanelHidden, setTeacherPanelHidden] = useState(() => {
    try {
      return localStorage.getItem(TEACHER_PANEL_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const teacherRevealLockRef = useRef(false);
  const teacherRevealTimerRef = useRef(null);
  const [draftTrailOpen, setDraftTrailOpen] = useState(false);
  const [sessionPdfOpen, setSessionPdfOpen] = useState(false);
  const [draftTrailBusy, setDraftTrailBusy] = useState(false);
  const [draftTrailFocusId, setDraftTrailFocusId] = useState(null);
  const [draftTrailLabelOpen, setDraftTrailLabelOpen] = useState(false);
  const [draftTrailLabelDraft, setDraftTrailLabelDraft] = useState('');
  const [draftTrailSaveHint, setDraftTrailSaveHint] = useState(false);
  const [addCardTitle, setAddCardTitle] = useState('Teacher');
  const [addCardText, setAddCardText] = useState('');
  const [addCardImage, setAddCardImage] = useState('');
  const [addCardFile, setAddCardFile] = useState(null);
  const [addCardBusy, setAddCardBusy] = useState(false);
  const [addCardError, setAddCardError] = useState('');
  const [addCardSendInbox, setAddCardSendInbox] = useState(true);
  const [addCardPlaceOnBoard, setAddCardPlaceOnBoard] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState('5');
  const [timerBusy, setTimerBusy] = useState(false);

  const socket = useMemo(() => createSocket(), []);
  const teacherRoomRef = useRef('');
  const joinedRef = useRef(false);
  const autoJoinTriedRef = useRef(false);
  const sessionDirtyRef = useRef(false);
  const sessionHydratedRef = useRef(false);
  const sessionFileInputRef = useRef(null);
  const saveStatusClearRef = useRef(null);

  const markSaved = useCallback(() => {
    setSaveStatus('saved');
    if (saveStatusClearRef.current) clearTimeout(saveStatusClearRef.current);
    saveStatusClearRef.current = setTimeout(() => {
      setSaveStatus((current) => (current === 'saved' ? 'idle' : current));
      saveStatusClearRef.current = null;
    }, 2000);
  }, []);

  const markSessionDirty = useCallback(() => {
    if (!sessionHydratedRef.current) return;
    sessionDirtyRef.current = true;
  }, []);

  const clearSessionDirty = useCallback(() => {
    sessionDirtyRef.current = false;
  }, []);

  const pushSettings = useCallback(
    (partial, { quiet = false } = {}) => {
      if (!room) return;
      if (!quiet) setSaveStatus('saving');
      socket.emit('teacher:settings', partial, (ack) => {
        if (ack && ack.ok === false) {
          if (!quiet) setSaveStatus('error');
          return;
        }
        if (!quiet) markSaved();
      });
    },
    [room, socket, markSaved]
  );

  const wordTargetPushRef = useRef(null);
  const commitWordTarget = useCallback(
    (value, { immediate = false } = {}) => {
      const v = Math.max(0, Math.min(500, Number(value) || 0));
      setRoom((r) => (r ? { ...r, word_target: v } : r));
      if (wordTargetPushRef.current) {
        clearTimeout(wordTargetPushRef.current);
        wordTargetPushRef.current = null;
      }
      const send = () => pushSettings({ word_target: v }, { quiet: true });
      if (immediate) send();
      else wordTargetPushRef.current = setTimeout(send, 320);
    },
    [pushSettings]
  );

  useEffect(() => () => {
    if (wordTargetPushRef.current) clearTimeout(wordTargetPushRef.current);
  }, []);

  useEffect(() => {
    const onStatus = (event) => {
      const next = event.detail?.status;
      if (next === 'saving') {
        if (saveStatusClearRef.current) {
          clearTimeout(saveStatusClearRef.current);
          saveStatusClearRef.current = null;
        }
        setSaveStatus('saving');
      } else if (next === 'error') {
        if (saveStatusClearRef.current) {
          clearTimeout(saveStatusClearRef.current);
          saveStatusClearRef.current = null;
        }
        setSaveStatus('error');
      } else if (next === 'saved') markSaved();
    };
    window.addEventListener('iboard:teacher-save-status', onStatus);
    return () => window.removeEventListener('iboard:teacher-save-status', onStatus);
  }, [markSaved]);

  useEffect(
    () => () => {
      if (saveStatusClearRef.current) clearTimeout(saveStatusClearRef.current);
    },
    []
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

  useLayoutEffect(() => {
    if (!studentActionMenuId) {
      setStudentActionMenuAnchor(null);
      return undefined;
    }
    const place = () => {
      const button = studentActionMenuBtnRefs.current.get(Number(studentActionMenuId));
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setStudentActionMenuAnchor({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      });
    };
    place();
    window.addEventListener('resize', place);
    // Capture scroll from nested board panes so the floating menu stays on the button.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [studentActionMenuId]);

  useEffect(() => {
    if (!studentActionMenuId) return undefined;
    const closeOutside = (event) => {
      if (!event.target?.closest?.('[data-student-actions-menu]')) setStudentActionMenuId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setStudentActionMenuId(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [studentActionMenuId]);

  useEffect(() => {
    if (!sendToMenuOpen) return undefined;
    const closeOutside = (event) => {
      if (!event.target?.closest?.('[data-send-to-menu]')) setSendToMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSendToMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [sendToMenuOpen]);

  useEffect(() => {
    if (Object.values(broadcastPick).some(Boolean)) return;
    setSendToMenuOpen(false);
    setSendRecipientPick({});
  }, [broadcastPick]);

  useEffect(() => {
    try {
      localStorage.setItem(CARD_VIEW_STORAGE_KEY, cardView);
    } catch {
      /* The view still works when browser storage is unavailable. */
    }
    if (cardView !== 'overview') setOverviewColumnsOpen(false);
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('iboard:teacher-layout')));
    return () => cancelAnimationFrame(frame);
  }, [cardView]);

  useEffect(() => {
    try {
      localStorage.setItem(OVERVIEW_COLUMNS_STORAGE_KEY, String(overviewColumns));
    } catch {
      /* Density still applies for this session if storage is unavailable. */
    }
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('iboard:teacher-layout')));
    return () => cancelAnimationFrame(frame);
  }, [overviewColumns]);

  useEffect(() => {
    if (!overviewColumnsOpen) return undefined;
    const closeOutside = (event) => {
      if (!event.target?.closest?.('[data-overview-columns-menu]')) setOverviewColumnsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOverviewColumnsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [overviewColumnsOpen]);

  useEffect(() => {
    if (!settingsOpen) setOverviewColumnsOpen(false);
  }, [settingsOpen]);

  useEffect(() => {
    function syncFullscreen() {
      setBrowserFullscreen(!!document.fullscreenElement);
    }
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  async function toggleBrowserFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        return;
      }
      const root = document.documentElement;
      if (root.requestFullscreen) await root.requestFullscreen();
      else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    } catch {
      setCopyToast('Fullscreen blocked — try the browser View menu');
      setTimeout(() => setCopyToast(''), 3200);
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(TEACHER_PANEL_HIDDEN_KEY, teacherPanelHidden ? '1' : '0');
    } catch {
      /* ignore */
    }
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('iboard:teacher-layout')));
    return () => cancelAnimationFrame(frame);
  }, [teacherPanelHidden]);

  useEffect(() => () => {
    if (teacherRevealTimerRef.current) window.clearTimeout(teacherRevealTimerRef.current);
  }, []);

  function revealTeacherPanel(event) {
    event.preventDefault();
    event.stopPropagation();
    if (teacherRevealTimerRef.current) window.clearTimeout(teacherRevealTimerRef.current);
    teacherRevealLockRef.current = true;
    setTeacherPanelHidden(false);
    teacherRevealTimerRef.current = window.setTimeout(() => {
      teacherRevealLockRef.current = false;
      teacherRevealTimerRef.current = null;
    }, 350);
  }

  function openFocusedTeacherPost(postId) {
    if (teacherRevealLockRef.current) return;
    setFocusedPostId(postId);
  }

  useEffect(() => {
    try {
      localStorage.setItem(CARD_FONT_STORAGE_KEY, JSON.stringify(cardFontById));
    } catch {
      /* Font preference is optional. */
    }
  }, [cardFontById]);


  function bumpCardFont(studentId, delta) {
    const id = String(studentId);
    setCardFontById((prev) => {
      const current = cardFontIndex(prev, id);
      const next = Math.max(0, Math.min(CARD_FONT_REMS.length - 1, current + delta));
      if (next === current) return prev;
      return { ...prev, [id]: next };
    });
  }

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
      setBreakouts(
        payload.breakouts && typeof payload.breakouts === 'object'
          ? {
              active: !!payload.breakouts.active,
              roomCount: Number(payload.breakouts.roomCount) || (payload.breakouts.rooms || []).length || 0,
              rooms: Array.isArray(payload.breakouts.rooms) ? payload.breakouts.rooms : [],
            }
          : { active: !!payload.room?.breakouts_active, roomCount: Number(payload.room?.breakout_count) || 0, rooms: [] }
      );
      const r = payload.room;
      if (!modalOpen && r?.feedback_toggles) {
        hydrateFeedbackStateFromRoom(r);
      }
      markSaved();
      if (sessionHydratedRef.current) markSessionDirty();
      else sessionHydratedRef.current = true;
    };
    const onLive = ({ student: s }) => {
      if (!s?.id) return;
      const row = normalizeStudentFromServer(s);
      // student:live is emitted only after the server has committed the draft.
      markSaved();
      setStudents((prev) => {
        const i = prev.findIndex((x) => x.id === row.id);
        if (i === -1) {
          markSessionDirty();
          return [...prev, row].sort((a, b) => a.id - b.id);
        }
        const cur = prev[i];
        if (
          cur.text === row.text &&
          cur.rich_text_html === row.rich_text_html &&
          cur.updated_at === row.updated_at &&
          cur.name === row.name &&
          cur.class_group === row.class_group &&
          cur.breakout_room_id === row.breakout_room_id &&
          cur.year_level === row.year_level &&
          cur.image_url === row.image_url &&
          cur.teacher_markup_url === row.teacher_markup_url
        ) {
          return prev;
        }
        markSessionDirty();
        const next = [...prev];
        next[i] = { ...cur, ...row };
        return next;
      });
    };
    socket.on('room:state', onState);
    socket.on('student:live', onLive);
    const onTimerState = (payload) => {
      setRoom((current) => current ? { ...current, timer: payload?.timer || null } : current);
      setTimerBusy(false);
    };
    socket.on('timer:state', onTimerState);
    return () => {
      socket.off('room:state', onState);
      socket.off('student:live', onLive);
      socket.off('timer:state', onTimerState);
    };
  }, [socket, modalOpen, hydrateFeedbackStateFromRoom, markSessionDirty, markSaved]);

  function controlRoomTimer(action, extra = {}) {
    if (timerBusy) return;
    setTimerBusy(true);
    socket.timeout(8000).emit('teacher:timer-control', { action, ...extra }, (err, ack) => {
      setTimerBusy(false);
      if (err || !ack?.ok) {
        setError(ack?.error || 'Could not update timer');
        return;
      }
      setRoom((current) => current ? { ...current, timer: ack.timer } : current);
    });
  }

  function openTimerSettings() {
    closeTeacherTools();
    setAddCardOpen(false);
    setSettingsOpen(true);
  }

  useEffect(() => {
    const onQna = (payload) => {
      setAudienceQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
      markSessionDirty();
      markSaved();
    };
    socket.on('qna:teacher', onQna);
    if (joinedRef.current) socket.emit('teacher:qna-sync', {});
    return () => socket.off('qna:teacher', onQna);
  }, [socket, markSessionDirty, markSaved]);

  useEffect(() => {
    noteReplyByStudentIdRef.current = noteReplyByStudentId;
  }, [noteReplyByStudentId]);

  useEffect(() => {
    const onFeedbackSeen = (payload = {}) => {
      const studentId = Number(payload.studentId);
      if (!studentId) return;
      if (noteReplyByStudentIdRef.current[studentId]) return;
      setNoteReceiptByStudentId((current) => {
        if (current[studentId] === 'replied') return current;
        return { ...current, [studentId]: 'seen' };
      });
      window.dispatchEvent(
        new CustomEvent('iboard:note-send-status', {
          detail: { studentId, status: 'seen' },
        })
      );
      // Brief green alert, then clear so the card chrome settles again.
      window.setTimeout(() => {
        setNoteReceiptByStudentId((current) => {
          if (current[studentId] !== 'seen') return current;
          const next = { ...current };
          delete next[studentId];
          return next;
        });
      }, 4500);
    };
    const ingestReply = (item, { replay = false } = {}) => {
      const studentId = Number(item?.studentId);
      const text = String(item?.text || '').trim();
      if (!studentId || !text) return;
      setNoteReplyByStudentId((current) => ({
        ...current,
        [studentId]: {
          replyId: Number(item.replyId) || 0,
          feedbackId: Number(item.feedbackId) || 0,
          text,
          parentText: String(item.parentText || '').trim(),
          at: Number(item.at) || Date.now(),
          studentName: String(item.studentName || '').trim(),
        },
      }));
      setNoteReceiptByStudentId((current) => ({ ...current, [studentId]: 'replied' }));
      window.dispatchEvent(
        new CustomEvent('iboard:note-send-status', {
          detail: { studentId, status: 'replied' },
        })
      );
      if (!replay) {
        const name = String(item.studentName || 'Student').trim() || 'Student';
        setCopyToast(`${name} replied to your note`);
        setTimeout(() => setCopyToast(''), 3200);
      }
    };
    const onNoteReply = (payload = {}) => ingestReply(payload.item);
    const onNoteReplyBatch = (payload = {}) => {
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) ingestReply(item, { replay: !!payload.replay });
    };
    socket.on('feedback:seen', onFeedbackSeen);
    socket.on('feedback:note-reply', onNoteReply);
    socket.on('feedback:note-reply-batch', onNoteReplyBatch);
    if (joinedRef.current) socket.emit('teacher:note-replies-sync', {});
    return () => {
      socket.off('feedback:seen', onFeedbackSeen);
      socket.off('feedback:note-reply', onNoteReply);
      socket.off('feedback:note-reply-batch', onNoteReplyBatch);
    };
  }, [socket]);

  useEffect(() => {
    function onBeforeUnload(event) {
      if (!sessionDirtyRef.current || !joinedRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

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
        rememberTeacherRoomCode(code);
        rememberedRoomRef.current = code;
        clearPrefilledCodeOnFocusRef.current = false;
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

  const visibleStudents = useMemo(
    () =>
      [...orderedStudents].sort((a, b) => {
        const aMonitored = monitoredIds.has(Number(a.id)) ? 0 : 1;
        const bMonitored = monitoredIds.has(Number(b.id)) ? 0 : 1;
        if (aMonitored !== bMonitored) return aMonitored - bMonitored;
        if (attentionFocus) {
          const aAttention =
            awayByStudentId.get(Number(a.id)) || isNotStarted(a, activityNow) ? 0 : 1;
          const bAttention =
            awayByStudentId.get(Number(b.id)) || isNotStarted(b, activityNow) ? 0 : 1;
          if (aAttention !== bAttention) return aAttention - bAttention;
        }
        return Number(a.id) - Number(b.id);
      }),
    [orderedStudents, monitoredIds, attentionFocus, awayByStudentId, activityNow]
  );

  const breakoutsActive = !!breakouts?.active;

  useEffect(() => {
    if (!breakoutsActive) return;
    const n = Number(breakouts.roomCount) || (breakouts.rooms || []).length || 1;
    setBreakoutRoomCountDraft(n);
  }, [breakoutsActive, breakouts.roomCount, breakouts.rooms]);

  useEffect(() => {
    const max = Math.max(1, Math.min(40, Math.floor(Number(breakoutRoomCountDraft) || 1)));
    setBreakoutDraftAssign((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [key, roomId] of Object.entries(next)) {
        const n = Number(roomId);
        if (roomId && (!Number.isFinite(n) || n < 1 || n > max)) {
          next[key] = '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [breakoutRoomCountDraft]);

  const breakoutRoomOptions = useMemo(() => {
    const fromMeta = (breakouts.rooms || []).map((r) => String(r.id));
    if (fromMeta.length) return fromMeta;
    const count = Number(breakouts.roomCount) || 0;
    return Array.from({ length: count }, (_, i) => String(i + 1));
  }, [breakouts]);

  const boardSections = useMemo(() => {
    if (!breakoutsActive) {
      return [{ id: 'class', label: null, count: visibleStudents.length, students: visibleStudents }];
    }
    const byId = new Map(visibleStudents.map((s) => [Number(s.id), s]));
    const rankStudent = (student) => {
      if (!student) return Number.MAX_SAFE_INTEGER;
      const monitored = monitoredIds.has(Number(student.id)) ? 0 : 1;
      const attention =
        attentionFocus &&
        (awayByStudentId.get(Number(student.id)) || isNotStarted(student, activityNow))
          ? 0
          : 1;
      return monitored * 10 + attention;
    };
    const sortMembers = (list) =>
      [...list].sort((a, b) => {
        const rank = rankStudent(a) - rankStudent(b);
        if (rank !== 0) return rank;
        return Number(a.id) - Number(b.id);
      });
    const used = new Set();
    const sections = [];
    for (const roomMeta of breakouts.rooms || []) {
      const members = sortMembers(
        (roomMeta.memberIds || []).map((id) => byId.get(Number(id))).filter(Boolean)
      );
      for (const s of members) used.add(Number(s.id));
      sections.push({
        id: String(roomMeta.id),
        label: roomMeta.label || `Room ${roomMeta.id}`,
        count: members.length,
        students: members,
      });
    }
    const rest = sortMembers(visibleStudents.filter((s) => !used.has(Number(s.id))));
    if (rest.length) {
      sections.push({ id: 'unassigned', label: 'Unassigned', count: rest.length, students: rest });
    }
    return sections;
  }, [
    breakoutsActive,
    breakouts,
    visibleStudents,
    monitoredIds,
    attentionFocus,
    awayByStudentId,
    activityNow,
  ]);

  function startBreakoutsAuto() {
    if (!socket || breakoutBusy) return;
    setBreakoutBusy(true);
    socket.emit('teacher:breakouts-start', { mode: 'auto' }, (ack) => {
      setBreakoutBusy(false);
      if (!ack?.ok) setError(ack?.error || 'Could not start breakouts');
    });
  }

  function startBreakoutsManual() {
    if (!socket || breakoutBusy) return;
    const roomCount = Math.max(1, Math.min(40, Math.floor(Number(breakoutRoomCountDraft) || 1)));
    const assignments = orderedStudents.map((student) => ({
      studentId: Number(student.id),
      breakout_room_id: String(breakoutDraftAssign[String(student.id)] || ''),
    }));
    setBreakoutBusy(true);
    socket.emit('teacher:breakouts-start', { mode: 'manual', roomCount, assignments }, (ack) => {
      setBreakoutBusy(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not start breakouts');
        return;
      }
      setBreakoutSetupMode('auto');
    });
  }

  const MAX_BREAKOUT_ROOM = 5; // self + 4 peers on student screen

  function countDraftInRoom(roomId, exceptStudentId = null) {
    const room = String(roomId || '');
    if (!room) return 0;
    return Object.entries(breakoutDraftAssign).filter(
      ([id, assigned]) =>
        String(assigned) === room &&
        (exceptStudentId == null || String(id) !== String(exceptStudentId))
    ).length;
  }

  function setDraftBreakoutRoom(studentId, roomId) {
    const key = String(studentId);
    const nextRoom = roomId ? String(roomId) : '';
    if (nextRoom) {
      const already = countDraftInRoom(nextRoom, key);
      if (already >= MAX_BREAKOUT_ROOM) {
        setError(`Room ${nextRoom} is full (max ${MAX_BREAKOUT_ROOM})`);
        return;
      }
    }
    setBreakoutDraftAssign((prev) => {
      if ((prev[key] || '') === nextRoom) return prev;
      return { ...prev, [key]: nextRoom };
    });
  }

  function endBreakouts() {
    if (!socket || breakoutBusy) return;
    setBreakoutBusy(true);
    socket.emit('teacher:breakouts-end', {}, (ack) => {
      setBreakoutBusy(false);
      if (!ack?.ok) setError(ack?.error || 'Could not end breakouts');
    });
  }

  function setBreakoutCount(nextCount) {
    if (!socket || !breakoutsActive || breakoutBusy) return;
    const roomCount = Math.max(1, Math.min(40, Math.floor(Number(nextCount) || 1)));
    setBreakoutBusy(true);
    socket.emit('teacher:breakouts-set-count', { roomCount }, (ack) => {
      setBreakoutBusy(false);
      if (!ack?.ok) setError(ack?.error || 'Could not change room count');
    });
  }

  function moveStudentBreakout(studentId, breakoutRoomId) {
    if (!socket || !breakoutsActive) return;
    const room = String(breakoutRoomId || '');
    if (room) {
      const already = students.filter(
        (s) =>
          Number(s.id) !== Number(studentId) &&
          String(s.breakout_room_id || '') === room
      ).length;
      if (already >= MAX_BREAKOUT_ROOM) {
        setError(`Room ${room} is full (max ${MAX_BREAKOUT_ROOM})`);
        return;
      }
    }
    socket.emit(
      'teacher:breakouts-update',
      { studentId: Number(studentId), breakout_room_id: room },
      (ack) => {
        if (!ack?.ok) setError(ack?.error || 'Could not move student');
      }
    );
  }

  useEffect(() => {
    setMonitoredIds(readMonitoredIdsForRoom(codeInput));
    setAwayByStudentId(new Map());
    setAttentionFocus(false);
  }, [codeInput, joined]);

  useEffect(() => {
    writeMonitoredIdsForRoom(codeInput, monitoredIds);
  }, [monitoredIds, codeInput]);

  // Drop monitors for students who have left the room.
  useEffect(() => {
    if (!orderedStudents.length) return;
    const live = new Set(orderedStudents.map((student) => Number(student.id)));
    setMonitoredIds((current) => {
      let changed = false;
      const next = new Set();
      for (const id of current) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
    setAwayByStudentId((current) => {
      let changed = false;
      const next = new Map();
      for (const [id, away] of current) {
        if (live.has(id) && away) next.set(id, true);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [orderedStudents]);

  function toggleMonitorStudent(studentId) {
    const id = Number(studentId);
    if (!id) return;
    setMonitoredIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function monitorSelectedStudents() {
    const ids = orderedStudents.filter((student) => broadcastPick[student.id]).map((student) => Number(student.id));
    if (!ids.length) return;
    setMonitoredIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setCopyToast(`Monitoring ${ids.length} student${ids.length === 1 ? '' : 's'}`);
    setTimeout(() => setCopyToast(''), 2500);
  }

  function clearMonitoredStudents() {
    setMonitoredIds(new Set());
  }

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
    const syncAwayFromLive = (payload) => {
      const next = new Map();
      for (const student of payload?.students || []) {
        if (student?.away) next.set(Number(student.id), true);
      }
      setAwayByStudentId(next);
    };
    const onLive = (payload) => {
      const safe = payload || { activity: null, responses: [], students: [] };
      setLivePulse(safe);
      syncAwayFromLive(safe);
    };
    const onPresence = ({ studentId, away }) => {
      const sid = Number(studentId);
      if (!sid) return;
      setAwayByStudentId((prev) => {
        const has = prev.get(sid) === true;
        if (Boolean(away) === has) return prev;
        const next = new Map(prev);
        if (away) next.set(sid, true);
        else next.delete(sid);
        return next;
      });
    };
    socket.on('live:teacher', onLive);
    socket.on('student:presence', onPresence);
    socket.emit('teacher:live-sync', {});
    return () => {
      socket.off('live:teacher', onLive);
      socket.off('student:presence', onPresence);
    };
  }, [socket, joined]);

  useEffect(() => {
    if (!livePulse.activity?.id) {
      setToolsHighlightStudentId(null);
    }
  }, [livePulse.activity?.id]);

  useEffect(() => {
    if (!noteTarget) {
      setNoteBox(null);
      return undefined;
    }

    const place = () => {
      const height = noteComposerRef.current?.offsetHeight || NOTE_COMPOSER_EST_HEIGHT;
      const width = noteComposerRef.current?.offsetWidth || NOTE_COMPOSER_WIDTH;
      if (noteAnchorRect) {
        setNoteBox(placementNearAnchor({
          anchor: noteAnchorRect,
          width,
          height,
          gap: 8,
          padding: 12,
          prefer: 'below-left',
        }));
        return;
      }
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;
      const topOffset = vv?.offsetTop ?? 0;
      const leftOffset = vv?.offsetLeft ?? 0;
      setNoteBox({
        top: topOffset + Math.max(12, (vh - height) / 2),
        left: leftOffset + Math.max(12, (vw - width) / 2),
      });
    };

    place();
    const frame = requestAnimationFrame(place);
    const unsubscribe = subscribeViewportChanges(place);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [noteTarget, noteAnchorRect, noteDraft, noteError]);

  useLayoutEffect(() => {
    const targetId = noteTarget?.id;
    if (!targetId) {
      noteFocusTargetRef.current = null;
      return undefined;
    }
    if (!noteBox || noteFocusTargetRef.current === targetId) return undefined;

    noteFocusTargetRef.current = targetId;
    let cancelled = false;
    const focusDraft = () => {
      if (cancelled) return;
      const field = noteDraftRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    };

    // The note popup is initially hidden while its position is measured, so
    // autofocus can happen too early. Focus again once it is actually visible.
    focusDraft();
    const frame = window.requestAnimationFrame(focusDraft);
    const timer = window.setTimeout(focusDraft, 60);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [noteTarget?.id, !!noteBox]);

  useEffect(() => {
    if (!noteTarget) return undefined;

    function onPointerDown(event) {
      if (noteSending) return;
      const target = event.target;
      if (noteComposerRef.current?.contains(target)) return;
      if (target?.closest?.('[aria-label^="Note "]')) return;
      if (target?.closest?.('button')?.textContent?.trim() === 'Send note') return;
      closeNoteComposer();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') closeNoteComposer();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [noteTarget, noteSending]);

  useEffect(() => {
    if (!toolsPanelOpen && !addCardOpen && !settingsOpen) return undefined;

    function closeHeaderPanelsIfOutside(event) {
      const target = event.target;
      if (toolsPanelOpen) {
        if (teacherToolsNavRef.current?.contains(target)) return;
        if (teacherToolsPanelRef.current?.contains(target)) return;
        // Saved-set previews are portalled to document.body so they can sit beside
        // the Ask dock. Treat that flyout as part of the tools panel; otherwise this
        // outside-click handler closes the dock on pointerdown before its buttons'
        // click handlers get a chance to run.
        if (target?.closest?.('[data-iboard-sets-preview="true"]')) return;
      }
      if (addCardOpen) {
        if (addCardButtonRef.current?.contains(target)) return;
        if (addCardPanelRef.current?.contains(target)) return;
      }
      if (settingsOpen) {
        if (settingsButtonRef.current?.contains(target)) return;
        if (settingsPanelRef.current?.contains(target)) return;
        if (breakoutAssignPanelRef.current?.contains(target)) return;
        // Native <select> menus are often outside the React tree; don't close while interacting.
        if (target?.closest?.('select') || document.activeElement?.tagName === 'SELECT') return;
      }
      if (toolsPanelOpen) {
        setToolsPanelOpen(false);
        setToolsHighlightStudentId(null);
      }
      if (addCardOpen && !addCardBusy) setAddCardOpen(false);
      if (settingsOpen) closeSettings();
    }

    function closeHeaderPanelsOnEscape(event) {
      if (event.key !== 'Escape') return;
      if (toolsPanelOpen) {
        setToolsPanelOpen(false);
        setToolsHighlightStudentId(null);
      }
      if (addCardOpen && !addCardBusy) setAddCardOpen(false);
      if (settingsOpen) closeSettings();
    }

    document.addEventListener('pointerdown', closeHeaderPanelsIfOutside);
    document.addEventListener('keydown', closeHeaderPanelsOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeHeaderPanelsIfOutside);
      document.removeEventListener('keydown', closeHeaderPanelsOnEscape);
    };
  }, [toolsPanelOpen, addCardOpen, settingsOpen, addCardBusy]);

  useLayoutEffect(() => {
    if ((!toolsPanelOpen && !addCardOpen && !settingsOpen) || !teacherHeaderRef.current) return undefined;

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
  }, [toolsPanelOpen, addCardOpen, settingsOpen]);

  const pendingQuestionCount = useMemo(
    () => audienceQuestions.filter((question) => question.status === 'pending').length,
    [audienceQuestions]
  );
  const pendingHandByStudentId = useMemo(() => {
    const map = new Map();
    for (const question of audienceQuestions) {
      if (question.status !== 'pending') continue;
      const sid = Number(question.studentId);
      if (!sid) continue;
      const list = map.get(sid) || [];
      list.push(question);
      map.set(sid, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return map;
  }, [audienceQuestions]);

  useEffect(() => {
    if (!handQuestionTarget) return;
    const sid = Number(handQuestionTarget.student?.id);
    const next = pendingHandByStudentId.get(sid) || [];
    if (!next.length) {
      setHandQuestionTarget(null);
      return;
    }
    setHandQuestionTarget((current) => {
      if (!current || Number(current.student?.id) !== sid) return current;
      return { ...current, questions: next };
    });
  }, [pendingHandByStudentId, handQuestionTarget?.student?.id]);

  const liveStudentById = useMemo(() => {
    const map = new Map();
    for (const student of livePulse.students || []) {
      map.set(Number(student.id), student);
    }
    return map;
  }, [livePulse.students]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    function measureChrome() {
      const h = settingsChromeRef.current?.offsetHeight;
      if (h && Number.isFinite(h)) setSettingsChromeHeight(h);
    }
    measureChrome();
    window.addEventListener('resize', measureChrome);
    return () => window.removeEventListener('resize', measureChrome);
  }, [settingsOpen]);

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

  function openNoteForStudent(student, event) {
    const trigger = event?.currentTarget;
    const rect = trigger?.getBoundingClientRect?.();
    const studentId = Number(student.id);
    setNoteAnchorRect(rect
      ? {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }
      : null);
    setNoteBox(null);
    setNoteTarget({ id: studentId, name: String(student.name || 'Student') });
    setNoteDraft('');
    setNoteUrgent(false);
    setNoteError('');
    setNoteSending(false);
    if (studentId && noteReplyByStudentId[studentId]) {
      socket.emit('teacher:note-reply-seen', { studentId });
      setNoteReceiptByStudentId((current) => ({ ...current, [studentId]: 'seen' }));
      window.dispatchEvent(
        new CustomEvent('iboard:note-send-status', {
          detail: { studentId, status: 'seen' },
        })
      );
    }
  }

  const noteClosePending = useRef(false);
  async function closeNoteComposer() {
    if (noteSending || noteClosePending.current) return;
    if (noteDraft.trim()) {
      noteClosePending.current = true;
      const discard = await confirmDialog({ title: 'Discard private note?', message: 'This note has not been sent.', confirmLabel: 'Discard note', cancelLabel: 'Keep writing' });
      noteClosePending.current = false;
      if (!discard) return;
    }
    setNoteTarget(null);
    setNoteDraft('');
    setNoteUrgent(false);
    setNoteError('');
    setNoteAnchorRect(null);
    setNoteBox(null);
    if (noteTarget?.id) {
      setNoteReplyByStudentId((current) => {
        if (!current[noteTarget.id]) return current;
        const next = { ...current };
        delete next[noteTarget.id];
        return next;
      });
    }
  }

  function sendNoteToStudent() {
    if (!noteTarget || noteSending) return;
    const text = noteDraft.trim();
    if (!text) {
      setNoteError('Write a note before sending.');
      return;
    }

    const target = noteTarget;
    const urgent = !!noteUrgent;
    setNoteError('');
    setNoteSending(true);
    window.__iboardPendingNoteStudentId = target.id;
    socket.emit('teacher:distribute', { items: [{ studentId: target.id, text, urgent }] }, (ack) => {
      setNoteSending(false);
      if (!ack?.ok) {
        setNoteError(ack?.error || 'Could not send this note.');
        return;
      }
      setNoteReceiptByStudentId((current) => ({ ...current, [target.id]: 'waiting' }));
      window.dispatchEvent(
        new CustomEvent('iboard:note-send-status', {
          detail: { studentId: target.id, status: 'waiting' },
        })
      );
      setNoteReplyByStudentId((current) => {
        if (!current[target.id]) return current;
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setNoteTarget(null);
      setNoteDraft('');
      setNoteUrgent(false);
      setNoteAnchorRect(null);
      setNoteBox(null);
      setCopyToast(
        urgent
          ? `Urgent note sent to ${target.name}`
          : `Note sent to ${target.name}`
      );
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

  function sendBroadcastToClass(recipientIds = null) {
    /** Use everyone in the room, not only the group filter — otherwise a filter can hide checked cards and send zero IDs. */
    const postIds = posts.filter((post) => broadcastPick[`post:${post.id}`]).map((post) => post.id).slice(0, 6);
    const remaining = Math.max(0, 6 - postIds.length);
    const ids = orderedStudents.filter((s) => broadcastPick[s.id]).map((s) => s.id).slice(0, remaining);
    if (!ids.length && !postIds.length) {
      setError(
        'Tick cards to include (up to 6). Names are not sent — only Exemplar A, B, …'
      );
      return;
    }
    const recipients = Array.isArray(recipientIds)
      ? recipientIds.map(Number).filter((id) => id > 0)
      : null;
    if (recipients && !recipients.length) {
      setError('Choose at least one student, or send to All.');
      return;
    }
    setError('');
    socket.emit(
      'teacher:broadcast',
      {
        studentIds: ids,
        postIds,
        ...(recipients ? { recipientIds: recipients } : {}),
      },
      (ack) => {
        if (!ack?.ok) setError(ack?.error || 'Send failed — check you opened the room and students are connected');
        else {
          const audience = recipients
            ? `${recipients.length} selected student${recipients.length === 1 ? '' : 's'}`
            : `${ack.reached ?? 0} student${(ack.reached ?? 0) === 1 ? '' : 's'}`;
          if (ack.count > 0 && ack.reached === 0) {
            setCopyToast('Sent, but 0 student tabs connected — ask students to refresh');
          } else {
            setCopyToast(`Sent ${ack.count} exemplar(s) → ${audience}`);
          }
          setTimeout(() => setCopyToast(''), 4000);
          setBroadcastPick({});
          setSendRecipientPick({});
          setSendToMenuOpen(false);
        }
      }
    );
  }

  function toggleSendRecipient(studentId) {
    const id = Number(studentId);
    if (!id) return;
    setSendRecipientPick((current) => ({ ...current, [id]: !current[id] }));
  }

  function closeAddCard() {
    if (addCardBusy) return;
    setAddCardOpen(false);
    setAddCardError('');
  }

  function closeSettings() {
    setSettingsOpen(false);
    setClearFixedArmed(false);
    setBreakoutSetupMode('auto');
  }

  function toggleSettings() {
    if (settingsOpen) {
      closeSettings();
      return;
    }
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardOpen(false);
    setClearFixedArmed(false);
    setSettingsOpen(true);
  }

  function openAddCard() {
    closeSettings();
    if (addCardOpen) {
      closeAddCard();
      return;
    }
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardTitle('Teacher');
    setAddCardText('');
    setAddCardImage('');
    setAddCardFile(null);
    setAddCardSendInbox(true);
    setAddCardError('');
    setAddCardPlaceOnBoard(true);
    setAddCardPlaceOnBoard(true);
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
        setAddCardFile(null);
        setAddCardImage(await fileToCompressedJpegDataUrl(file));
        setAddCardError('');
      } catch {
        setAddCardError('Could not read that image');
      }
      return;
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function handleAddCardFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAddCardError('File too large — keep under 5 MB');
      return;
    }
    const name = String(file.name || '').toLowerCase();
    const okExt = /\.(pdf|jpe?g|png|webp)$/.test(name);
    const okMime = /^(application\/pdf|image\/(jpeg|jpg|png|webp))$/i.test(file.type || '');
    if (!okExt && !okMime) {
      setAddCardError('Use a PDF or image — Word/PowerPoint can’t preview in class');
      return;
    }
    setAddCardImage('');
    setAddCardText('');
    setAddCardFile(file);
    setAddCardSendInbox(true);
    setAddCardPlaceOnBoard(true);
    if (!addCardTitle.trim() || addCardTitle.trim() === 'Teacher') {
      setAddCardTitle(String(file.name || 'Handout').replace(/\.[^.]+$/, '').slice(0, 80) || 'Handout');
    }
    setAddCardError('');
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
      setAddCardFile(null);
      setCopyToast(message);
      setTimeout(() => setCopyToast(''), 2500);
    };

    if (addCardFile) {
      if (!addCardSendInbox && !addCardPlaceOnBoard) {
        setAddCardError('Choose Send to Inbox and/or Place on this board');
        return;
      }
      setAddCardBusy(true);
      fileToBase64(addCardFile)
        .then((fileBase64) => {
          socket.emit(
            'teacher:material-send',
            {
              title,
              fileBase64,
              mimeType: addCardFile.type || '',
              originalName: addCardFile.name || 'handout',
              sendToInbox: addCardSendInbox,
              placeOnBoard: addCardPlaceOnBoard,
            },
            (ack) => {
              const bits = [];
              if (addCardSendInbox) bits.push('Inbox');
              if (addCardPlaceOnBoard) bits.push('board');
              finish(ack, `Handout sent to ${bits.join(' · ')}`);
            }
          );
        })
        .catch(() => {
          setAddCardBusy(false);
          setAddCardError('Could not read that file');
        });
      return;
    }

    if (addCardImage) {
      setAddCardBusy(true);
      if (addCardSendInbox || addCardPlaceOnBoard) {
        socket.emit(
          'teacher:material-send',
          {
            title,
            fileBase64: addCardImage,
            mimeType: 'image/jpeg',
            originalName: `${title.replace(/\s+/g, '-').slice(0, 40) || 'handout'}.jpg`,
            sendToInbox: addCardSendInbox,
            placeOnBoard: addCardPlaceOnBoard || !addCardSendInbox,
          },
          (ack) => {
            const bits = [];
            if (addCardSendInbox) bits.push('Inbox');
            if (addCardPlaceOnBoard || !addCardSendInbox) bits.push('board');
            finish(ack, `Image sent to ${bits.join(' · ')}`);
          }
        );
        return;
      }
      socket.emit(
        'teacher:board-post',
        { kind: 'image', title, imageBase64: addCardImage, mimeType: 'image/jpeg' },
        (ack) => finish(ack, 'Teacher image card added')
      );
      return;
    }

    const text = addCardText.trim();
    if (!text) {
      setAddCardError('Attach a PDF/DOC, paste an image, or type some text');
      return;
    }
    setAddCardBusy(true);
    socket.emit('teacher:board-post', { kind: 'text', title, text }, (ack) => {
      if (!ack?.ok || !addCardSendInbox) {
        finish(ack, 'Teacher card added');
        return;
      }
      // Also push the text note to every connected student inbox.
      const recipients = orderedStudents.map((student) => ({
        studentId: student.id,
        text: `${title}: ${text}`.slice(0, 4000),
      }));
      if (!recipients.length) {
        finish(ack, 'Teacher card added');
        return;
      }
      socket.emit('teacher:distribute', { items: recipients }, (distAck) => {
        finish(
          distAck?.ok === false ? distAck : ack,
          distAck?.ok === false ? distAck.error || 'Card added, but Inbox send failed' : 'Card added · sent to Inbox'
        );
      });
    });
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

  async function saveSessionFile() {
    closeSettings();
    if (!joinedRef.current || codeInput.length !== 4) {
      setError('Open a room before saving a session');
      return;
    }
    setSessionBusy(true);
    setError('');
    try {
      const ack = await emitAck(socket, 'teacher:session-export');
      if (!ack?.ok || !ack.pack) {
        throw new Error(ack?.error || 'Could not save session');
      }
      const result = await downloadSessionPack(ack.pack, codeInput);
      if (result.method === 'cancelled') {
        setCopyToast('Save cancelled');
      } else {
        clearSessionDirty();
        setCopyToast('Session saved — keep the .iboard file to reopen later');
      }
      setTimeout(() => setCopyToast(''), 3500);
    } catch (e) {
      setError(e?.message || 'Could not save session');
    } finally {
      setSessionBusy(false);
    }
  }

  async function openSessionFilePicker() {
    closeSettings();
    if (!joinedRef.current || codeInput.length !== 4) {
      setError('Open a room before opening a session');
      return;
    }
    if (sessionDirtyRef.current) {
      const ok = await confirmDialog({
        title: 'Replace the live board?',
        message:
          'Opening a session replaces the live board in this room (cards, responses, Pulse, notes).\n\nUnsaved changes on the board will be lost.',
        confirmLabel: 'Open session',
        tone: 'danger',
      });
      if (!ok) return;
    } else {
      const ok = await confirmDialog({
        title: 'Open a saved session?',
        message:
          'This replaces the live board (cards, responses, Pulse, notes) with the file contents.',
        confirmLabel: 'Open session',
        tone: 'brand',
      });
      if (!ok) return;
    }
    sessionFileInputRef.current?.click();
  }

  async function onSessionFileChosen(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSessionBusy(true);
    setError('');
    try {
      const pack = await readSessionFile(file);
      const ack = await emitAck(socket, 'teacher:session-import', { pack });
      if (!ack?.ok) {
        throw new Error(ack?.error || 'Could not open session');
      }
      if (Array.isArray(ack.snapshots)) setSnapshots(ack.snapshots);
      clearSessionDirty();
      sessionHydratedRef.current = true;
      setCopyToast(
        `Session opened — ${ack.studentCount ?? 0} students · ${ack.postCount ?? 0} teacher cards`
      );
      setTimeout(() => setCopyToast(''), 3500);
    } catch (e) {
      setError(e?.message || 'Could not open session');
    } finally {
      setSessionBusy(false);
    }
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

  function setDraftTrailRecording(active, label = '') {
    setDraftTrailBusy(true);
    setDraftTrailLabelOpen(false);
    socket.timeout(10000).emit('teacher:draft-trail-control', { active, label }, (err, ack) => {
      setDraftTrailBusy(false);
      if (err || !ack?.ok) {
        setError(ack?.error || 'Recording status could not be confirmed. Reconnect before trying again.');
        return;
      }
      setRoom((prev) => ({ ...prev, draftTrail: ack.status }));
      markSessionDirty();
      if (!active) setDraftTrailSaveHint(true);
      else setDraftTrailSaveHint(false);
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

  async function separateReportProfile() {
    if (!selectedEvidenceStudent?.combined) return;
    const aliases = selectedEvidenceStudent.aliases || [];
    const ok = await confirmDialog({
      title: 'Separate these names?',
      message: `Separate ${aliases.join(', ')} into individual reports again?\n\nThe saved evidence will not be changed.`,
      confirmLabel: 'Separate names',
      tone: 'brand',
    });
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
    closeSettings();
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
    closeSettings();
    setJoinScreenOpen(true);
  }

  function downloadParticipantList() {
    closeSettings();
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
      setFixedCommentCount(0);
      setClearFixedArmed(false);
      setToolsPanelOpen(false);
      setLibraryPanel(null);
      setNewClassConfirmOpen(false);
      clearSessionDirty();
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
          <IBoardWordmark size="hero" variant="full" className="mx-auto" />
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
          <div className="iboard-join-stack text-center">
            <div className="flex justify-center">
              <IBoardWordmark size="hero" variant="full" />
            </div>
            <div className="mt-10 flex items-center gap-2">
              <input
                value={codeInput}
                onFocus={() => {
                  if (!clearPrefilledCodeOnFocusRef.current) return;
                  clearPrefilledCodeOnFocusRef.current = false;
                  setCodeInput('');
                  setError('');
                }}
                onChange={(e) => {
                  clearPrefilledCodeOnFocusRef.current = false;
                  setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                }}
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
                onClick={() => {
                  clearPrefilledCodeOnFocusRef.current = true;
                  setCodeInput(randomRoomCode());
                }}
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
              <p className="mt-3 text-sm font-medium text-[#5a5fc3] dark:text-indigo-300">{copyToast}</p>
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

  function openTeacherTools(tab = 'ask', { highlightStudentId = null } = {}) {
    closeSettings();
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
    closeSettings();
    setLessonReportOpen(true);
  }

  async function downloadLessonReportQuick() {
    closeSettings();
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(codeInput)}/lesson-report`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not build report');
      downloadLessonReportHtml(data);
      setCopyToast('Class engagement report downloaded');
      setTimeout(() => setCopyToast(''), 2500);
    } catch (e) {
      setError(e.message || 'Could not download class engagement report');
    }
  }

  function openAnswerInRail(studentId) {
    if (!livePulse.activity) {
      openTeacherTools('ask');
      return;
    }
    openTeacherTools('responses', { highlightStudentId: studentId });
  }


  function openLibrary(panel, evidenceTab = 'lessons') {
    closeSettings();
    if (panel === 'reports') {
      setLibraryPanel('evidence');
      setEvidenceHubTab('students');
      setSnapshotsOpen(true);
      return;
    }
    setLibraryPanel(panel);
    if (panel === 'evidence') {
      setEvidenceHubTab(evidenceTab === 'students' ? 'students' : 'lessons');
      setSnapshotsOpen(true);
    }
  }

  const focusedStudent = orderedStudents.find((student) => student.id === focusedStudentId) || null;
  const focusedPost = posts.find((post) => Number(post.id) === Number(focusedPostId)) || null;
  // Overview: fixed column density (6/5/4/3). Reading / Full: wider reading columns.
  const studentGridClass =
    cardView === 'overview'
      ? `iboard-student-grid--overview ${OVERVIEW_GRID_CLASS[overviewColumns] || OVERVIEW_GRID_CLASS[OVERVIEW_COLUMNS_DEFAULT]}`
      : cardView === 'reading'
        ? 'grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))]'
        : 'grid-cols-[repeat(auto-fit,minmax(min(100%,30rem),1fr))]';
  // Student board only — teacher strip cards stay compact regardless of Overview/Reading/Full.
  const studentWritingPaneClass =
    cardView === 'overview'
      ? 'min-h-0 flex-1 overflow-y-auto overflow-x-visible'
      : cardView === 'reading'
        ? 'min-h-[22rem] max-h-[32rem] overflow-y-auto overflow-x-visible'
        : 'overflow-visible';
  const teacherWritingPaneClass = 'max-h-52 overflow-y-auto overflow-x-visible';

  const broadcastPickCount = Object.values(broadcastPick).filter(Boolean).length;
  const selectedStudentPickCount = orderedStudents.filter((student) => broadcastPick[student.id]).length;
  const monitoredCount = monitoredIds.size;
  const awayCount = orderedStudents.reduce(
    (n, student) => n + (awayByStudentId.get(Number(student.id)) ? 1 : 0),
    0
  );
  const notStartedCount = orderedStudents.reduce(
    (n, student) => n + (isNotStarted(student, activityNow) ? 1 : 0),
    0
  );
  const attentionSummary = [
    awayCount > 0 ? `${awayCount} away` : '',
    notStartedCount > 0 ? `${notStartedCount} not started` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const liveResponseCount = (livePulse.responses || []).length;
  const headerDockOpen = toolsPanelOpen || addCardOpen || settingsOpen;

  return (
    <div className="iboard-teacher-canvas flex h-full min-h-[100dvh] flex-col overflow-hidden dark:bg-slate-950">
      <input
        ref={sessionFileInputRef}
        type="file"
        accept=".iboard,application/json,text/json"
        className="hidden"
        onChange={onSessionFileChosen}
      />
      <div className="shrink-0">
      <header
        ref={teacherHeaderRef}
        className={`iboard-app-header relative z-50 shrink-0 border-b backdrop-blur${teacherPanelHidden ? ' is-teacher-hidden' : ''}`}
      >
        <div className="iboard-teacher-header-bar relative">
          <div className="iboard-teacher-header-rail">
            <div className="iboard-brand shrink-0" aria-label="TUIT">
              <img src="/brand/tuit-logo.png" alt="TUIT" className="iboard-brand-logo" />
            </div>
          </div>
          <div className="iboard-teacher-header-gutter" aria-hidden="true" />
          <div className="iboard-teacher-header-main">
            <div className="iboard-header-meta flex min-w-0 flex-wrap items-center gap-2.5 text-sm">
              <span>
                Room <b className="iboard-header-code font-mono">{codeInput}</b>
              </span>
              <span>
                Online <b>{orderedStudents.length}</b>
              </span>
              {attentionSummary ? (
                <button
                  type="button"
                  onClick={() => setAttentionFocus((on) => !on)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold transition ${
                    attentionFocus
                      ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                  title={attentionFocus ? 'Show all cards' : 'Bring away / not started cards to the top'}
                  aria-pressed={attentionFocus}
                >
                  {attentionSummary}
                </button>
              ) : null}
              {frozen && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Frozen
                </span>
              )}
            </div>

            <div className="iboard-header-actions ml-auto flex shrink-0 items-center justify-end gap-1.5">
            <RoomTimerPill
              timer={room?.timer}
              onClick={openTimerSettings}
              onFinishedClick={() => controlRoomTimer('end')}
            />
            {joined && <SaveStatusChip status={saveStatus} plain />}
            <button
              type="button"
              disabled={draftTrailBusy || !socketConnected || !joined}
              aria-pressed={!!room?.draftTrail?.active}
              aria-label={
                draftTrailBusy
                  ? 'Updating Draft Trail'
                  : room?.draftTrail?.active
                    ? (room?.draftTrail?.label ? `Stop Draft Trail · ${room.draftTrail.label}` : 'Stop Draft Trail')
                    : 'Record draft trail'
              }
              title={
                room?.draftTrail?.reason
                || (room?.draftTrail?.active
                  ? (room?.draftTrail?.label ? `Recording · ${room.draftTrail.label} — click to stop` : 'Draft Trail recording — click to stop')
                  : 'Record draft trail — writing changes only, not screen or audio')
              }
              className={`iboard-header-rec relative z-10 inline-flex items-center text-[11px] font-bold uppercase tracking-[0.13em] transition disabled:opacity-50 ${
                room?.draftTrail?.active ? 'is-recording text-[#dc2626]' : 'text-[#8b8b96]'
              }`}
              onClick={() => {
                if (room?.draftTrail?.active) {
                  setDraftTrailRecording(false);
                  return;
                }
                setDraftTrailLabelDraft(room?.draftTrail?.label || '');
                setDraftTrailLabelOpen(true);
              }}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  draftTrailBusy
                    ? 'bg-amber-400'
                    : room?.draftTrail?.active
                      ? 'bg-[#ef4444]'
                      : 'bg-[#b0b0ba]'
                }`}
              />
              <span aria-hidden="true">{draftTrailBusy ? '…' : 'REC'}</span>
            </button>
            <HintWrap hint={browserFullscreen ? 'Exit fullscreen' : 'Fullscreen (fills the display)'} prefer="below">
              <button
                type="button"
                onClick={() => void toggleBrowserFullscreen()}
                aria-pressed={browserFullscreen}
                data-active={browserFullscreen ? 'true' : 'false'}
                className="iboard-header-icon-button flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition dark:border-slate-500 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15 dark:hover:text-white"
                aria-label={browserFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {browserFullscreen ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 3v6H3" />
                    <path d="M15 3v6h6" />
                    <path d="M9 21v-6H3" />
                    <path d="M15 21v-6h6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 9V3h6" />
                    <path d="M21 9V3h-6" />
                    <path d="M3 15v6h6" />
                    <path d="M21 15v6h-6" />
                  </svg>
                )}
              </button>
            </HintWrap>
          </div>
          </div>

          <div className="pointer-events-none absolute inset-y-0 left-1/2 z-[1] flex max-w-[min(22rem,calc(100vw-11rem))] -translate-x-1/2 items-center">
            {!socketConnected ? null : copyToast ? (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-auto inline-flex h-8 max-w-full items-center truncate rounded-lg border border-[#cfcce8] bg-[#ebeaf8] px-3 text-[11px] font-black text-[#5a5fc3] shadow-sm dark:border-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200"
                title={copyToast}
              >
                {copyToast}
              </div>
            ) : broadcastPickCount > 0 ? (
              <div className="pointer-events-auto flex items-center gap-2">
              <div ref={sendToMenuRef} data-send-to-menu className="relative">
                <button
                  type="button"
                  onClick={() => {
                    closeSettings();
                    setSendToMenuOpen((open) => !open);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#5a5fc3] px-3 text-white shadow-sm hover:bg-[#4b50b0]"
                  aria-expanded={sendToMenuOpen}
                  aria-haspopup="menu"
                  aria-label={`Send ${Math.min(6, broadcastPickCount)} selected cards`}
                >
                  <span className="text-[11px] font-black uppercase tracking-[0.12em]">Send to</span>
                  <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-black tabular-nums">
                    {Math.min(6, broadcastPickCount)}
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {sendToMenuOpen && (
                  <div
                    className="absolute left-1/2 top-[calc(100%+0.4rem)] z-50 w-[min(18rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-[#d5d4e4] bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
                    role="menu"
                    aria-label="Send selected cards"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => sendBroadcastToClass(null)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-bold text-[#3c3c45] hover:bg-[#ebeaf8] dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <span>All students</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5a5fc3]">Class</span>
                    </button>
                    <div className="border-t border-[#d5d4e4] dark:border-slate-700">
                      <p className="px-3 pt-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#5a5fc3]">
                        Or choose students
                      </p>
                      <div className="max-h-48 overflow-y-auto py-1 scrollbar-thin">
                        {orderedStudents.length === 0 ? (
                          <p className="px-3 py-2 text-xs font-semibold text-slate-400">No students in the room yet.</p>
                        ) : (
                          orderedStudents.map((student) => (
                            <label
                              key={student.id}
                              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-[#3c3c45] hover:bg-[#ebeaf8] dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <input
                                type="checkbox"
                                checked={!!sendRecipientPick[student.id]}
                                onChange={() => toggleSendRecipient(student.id)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                              />
                              <span className="min-w-0 truncate font-semibold">{student.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                      <div className="border-t border-[#d5d4e4] p-2 dark:border-slate-700">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!Object.values(sendRecipientPick).some(Boolean)}
                          onClick={() => {
                            const recipients = orderedStudents
                              .filter((student) => sendRecipientPick[student.id])
                              .map((student) => student.id);
                            sendBroadcastToClass(recipients);
                          }}
                          className="w-full rounded-lg bg-[#5a5fc3] px-3 py-2 text-xs font-black text-white hover:bg-[#4f54b0] disabled:opacity-40"
                        >
                          Send to selected
                          {Object.values(sendRecipientPick).filter(Boolean).length
                            ? ` · ${Object.values(sendRecipientPick).filter(Boolean).length}`
                            : ''}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {selectedStudentPickCount > 0 ? (
                <button
                  type="button"
                  onClick={monitorSelectedStudents}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#5a5fc3] px-3 text-white shadow-sm hover:bg-[#4f54b0]"
                  aria-label={`Monitor ${selectedStudentPickCount} selected students`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                  <span className="text-[11px] font-black uppercase tracking-[0.12em]">Monitor</span>
                  <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-black tabular-nums">
                    {selectedStudentPickCount}
                  </span>
                </button>
              ) : null}
              </div>
            ) : monitoredCount > 0 ? (
              <div className="pointer-events-auto inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg bg-[#5a5fc3] px-2 pl-3 text-white shadow-sm">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 opacity-90" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
                <span className="truncate text-[11px] font-black">Monitoring · {monitoredCount}</span>
                <button
                  type="button"
                  onClick={clearMonitoredStudents}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-white/80 hover:bg-white/15 hover:text-white"
                  aria-label="Clear monitor list"
                  title="Clear monitor list"
                >
                  ×
                </button>
              </div>
            ) : draftTrailSaveHint && !room?.draftTrail?.active ? (
              <div className="pointer-events-auto inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg bg-[#5a5fc3] px-2 pl-3 text-white shadow-sm">
                <span className="truncate text-[11px] font-black">Save Draft Trail</span>
                <button
                  type="button"
                  disabled={sessionBusy || !joined}
                  onClick={() => {
                    setDraftTrailSaveHint(false);
                    saveSessionFile();
                  }}
                  className="shrink-0 rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide hover:bg-white/30 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setDraftTrailSaveHint(false)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-white/80 hover:bg-white/15 hover:text-white"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            ) : room?.draftTrail?.reason ? (
              <div
                role="alert"
                className="pointer-events-auto inline-flex h-8 max-w-full items-center truncate rounded-lg bg-amber-500 px-3 text-[11px] font-black text-amber-950 shadow-sm"
                title={room.draftTrail.reason}
              >
                {room.draftTrail.reason}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      </div>
      {draftTrailLabelOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900" role="dialog" aria-labelledby="draft-trail-label-title">
            <h2 id="draft-trail-label-title" className="font-display text-lg font-black text-slate-950 dark:text-white">Start Draft Trail</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Optional name for this recording (e.g. Period 3 narrative).</p>
            <input
              value={draftTrailLabelDraft}
              onChange={(event) => setDraftTrailLabelDraft(event.target.value.slice(0, 80))}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950"
              placeholder="Lesson or task name"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') setDraftTrailRecording(true, draftTrailLabelDraft.trim());
                if (event.key === 'Escape') setDraftTrailLabelOpen(false);
              }}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={draftTrailBusy} onClick={() => setDraftTrailRecording(true, draftTrailLabelDraft.trim())} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800 disabled:opacity-50">
                Start recording
              </button>
              <button type="button" disabled={draftTrailBusy} onClick={() => setDraftTrailRecording(true, '')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
                Start without name
              </button>
              <button type="button" onClick={() => setDraftTrailLabelOpen(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {draftTrailOpen && (
        <DraftTrailPanel
          socket={socket}
          initialStudentId={draftTrailFocusId}
          onClose={() => {
            setDraftTrailOpen(false);
            setDraftTrailFocusId(null);
          }}
        />
      )}
      {sessionPdfOpen && <SessionPdfExport socket={socket} onClose={() => setSessionPdfOpen(false)} />}

      {toolsPanelOpen && (
        <div
          ref={teacherToolsPanelRef}
          className="iboard-header-dock iboard-header-dock--start iboard-header-dock--rail fixed z-[60] w-[min(29rem,calc(100vw-4.75rem))]"
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
            subjectAssist={promptSubjectAssist}
            selectedStudentIds={orderedStudents.filter((s) => broadcastPick[s.id]).map((s) => s.id)}
            rosterStudentIds={orderedStudents.map((s) => s.id)}
            onClearStudentSelection={() => setBroadcastPick({})}
            onThinkingSent={({ count, recipients }) => {
              setCopyToast(
                recipients > 1
                  ? `Thinking: ${count} prompt${count === 1 ? '' : 's'} → ${recipients} students`
                  : `Thinking prompt${count === 1 ? '' : 's'} sent`
              );
              setTimeout(() => setCopyToast(''), 2500);
            }}
          />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {headerDockOpen ? (
        <div className="iboard-workspace-scrim pointer-events-none absolute inset-0 z-[55]" aria-hidden="true" />
      ) : null}
      <div className={`iboard-teacher-shell relative z-[1] min-h-0 flex-1 ${teacherPanelHidden ? 'is-teacher-hidden' : ''}`}>
        <nav ref={teacherToolsNavRef} className="iboard-arr-rail" aria-label="Teacher tools">
          <div className="iboard-arr-rail__tools">
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
                  className="iboard-arr-btn relative"
                  title={tab.label}
                  aria-label={tab.label}
                >
                  <img src={tab.icon} alt="" />
                  <span className="iboard-arr-label">{tab.label}</span>
                  {badge ? (
                    <span className="absolute right-1 top-1 z-[2] grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-black tabular-nums leading-none text-white shadow-sm">
                      {badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="iboard-arr-rail__foot">
            <HintWrap hint="Room settings" prefer="right">
              <button
                ref={settingsButtonRef}
                type="button"
                onClick={toggleSettings}
                aria-expanded={settingsOpen}
                data-active={settingsOpen ? 'true' : 'false'}
                className="iboard-arr-btn"
                title="Room settings"
                aria-label="Room settings"
              >
                <svg viewBox="0 0 24 24" className="h-[1.625rem] w-[1.625rem]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 7h10" />
                  <path d="M18 7h2" />
                  <circle cx="16" cy="7" r="2" />
                  <path d="M4 17h2" />
                  <path d="M10 17h10" />
                  <circle cx="8" cy="17" r="2" />
                </svg>
                <span className="iboard-arr-label">Settings</span>
              </button>
            </HintWrap>
          </div>
        </nav>

        <div className="iboard-teacher-panel-wrap">
          <button
            type="button"
            className="iboard-teacher-panel-reveal"
            onPointerDown={revealTeacherPanel}
            onClick={(event) => event.preventDefault()}
            aria-label="Show teacher"
            title="Show teacher"
            tabIndex={teacherPanelHidden ? 0 : -1}
            aria-hidden={!teacherPanelHidden}
          >
            <span aria-hidden="true">&gt;</span>
          </button>
          <aside
            className="iboard-teacher-panel"
            aria-label="Teacher cards"
            aria-hidden={teacherPanelHidden}
          >
            <div className="iboard-teacher-panel-head">
              <button
                type="button"
                className="iboard-teacher-panel-action iboard-teacher-panel-action--icon"
                onClick={() => setTeacherPanelHidden(true)}
                aria-label="Hide teacher"
                title="Hide"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 6 9 12l6 6" />
                </svg>
              </button>
              <h2>Teacher</h2>
              <button
                ref={addCardButtonRef}
                type="button"
                className="iboard-teacher-panel-action iboard-teacher-panel-action--icon"
                onClick={openAddCard}
                aria-expanded={addCardOpen}
                aria-label="Add teacher card"
                title="Add"
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
            <div className="iboard-teacher-panel-list">
              {posts.length === 0 && (
                <p className="px-1 py-6 text-center text-xs font-semibold text-slate-400">
                  No teacher cards yet — use +
                </p>
              )}
              {posts.map((post) => (
            <article
              key={`post-${post.id}`}
              className="iboard-teacher-card flex cursor-pointer flex-col rounded-xl border border-slate-300 bg-slate-100/80 p-3 transition hover:border-[#cfcce8] dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-indigo-500"
              onClick={() => openFocusedTeacherPost(post.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openFocusedTeacherPost(post.id);
                }
              }}
              role="button"
              tabIndex={teacherPanelHidden ? -1 : 0}
              aria-label={`Open larger view of ${post.title || 'teacher card'}`}
            >
              <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                <HintWrap hint="Include this card">
                  <label className="flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={!!broadcastPick[`post:${post.id}`]}
                      onChange={() => toggleBroadcastCard(`post:${post.id}`)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 dark:border-slate-600"
                    />
                    <span className="sr-only">Include teacher card</span>
                  </label>
                </HintWrap>
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  <HintWrap hint="Edit card">
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('iboard:edit-teacher-card', { detail: { post } }),
                        );
                      }}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-indigo-500 transition hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-100"
                      aria-label={`Edit ${post.title || 'teacher card'}`}
                      title=""
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                  </HintWrap>
                  <HintWrap hint="Remove card">
                    <RemoveButton onClick={() => deleteTeacherCard(post.id)} aria-label={`Remove ${post.title || 'teacher card'}`} title="" />
                  </HintWrap>
                </div>
              </div>
              <div className={`iboard-teacher-card-body mt-2 rounded-xl bg-white p-2.5 text-sm leading-relaxed text-slate-700 scrollbar-thin dark:bg-slate-950 dark:text-slate-300 ${teacherWritingPaneClass}`}>
                {post.kind === 'image' && post.image_url ? (
                  <img src={post.image_url} alt={post.title || 'Teacher card'} className="mx-auto max-h-80 w-full object-contain" />
                ) : post.kind === 'file' && post.file_url ? (
                  <div className="space-y-2">
                    {String(post.mime_type || '').includes('pdf') || /\.pdf$/i.test(post.text || '') ? (
                      <iframe
                        title={post.title || 'Handout'}
                        src={post.file_url}
                        className="pointer-events-none h-64 w-full rounded-lg border-0 bg-slate-50 outline-none dark:bg-slate-900"
                        tabIndex={-1}
                      />
                    ) : null}
                    <a
                      href={`${post.file_url}${post.file_url.includes('?') ? '&' : '?'}download=1&name=${encodeURIComponent(post.text || 'handout')}`}
                      className="inline-flex text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
                      download={post.text || 'handout'}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {post.text || 'Download handout'}
                    </a>
                  </div>
                ) : post.text?.trim() ? (
                  <p className="whitespace-pre-wrap break-words">{post.text}</p>
                ) : (
                  <span className="italic text-slate-400">Empty card</span>
                )}
              </div>
            </article>
              ))}
            </div>
          </aside>
        </div>

      <main className="iboard-student-board relative flex min-h-0 flex-col overflow-y-auto">
          {error && <p className="mb-2 shrink-0 text-sm text-red-600">{error}</p>}

              <div className="min-h-0 flex-1 overflow-y-auto pb-2 scrollbar-thin">
        <div className="iboard-student-board-stack">
          {orderedStudents.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900/60 p-10 text-center text-slate-500 dark:text-slate-400">
              Waiting for students to join…
            </div>
          )}
          {orderedStudents.length > 0 && boardSections.map((section) => (
            <section
              key={`breakout-${section.id}`}
              className={section.label ? 'iboard-room-section' : undefined}
              aria-label={section.label || 'Class board'}
            >
              {section.label ? (
                <div className="iboard-room-section__head">
                  <h3>{section.label}</h3>
                </div>
              ) : null}
              <div className={`grid ${cardView === 'overview' ? 'gap-3' : 'gap-4'} ${studentGridClass}`}>
          {section.students.map((s) => {
            const displayText = s.text || '';
            const wc = wordCount(s.text);
            const st = activityStatus(s.updated_at, activityNow);
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
                  ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.55)]'
                  : st === 'warm'
                    ? 'bg-amber-400'
                    : 'bg-slate-300';
            const handQuestions = pendingHandByStudentId.get(Number(s.id)) || [];
            const handUp = handQuestions.length > 0;
            const monitoring = monitoredIds.has(Number(s.id));
            const isAway = awayByStudentId.get(Number(s.id)) === true;
            const notStarted = isNotStarted(s, activityNow);
            return (
              <article
                key={s.id}
                data-student-id={s.id}
                title={handUp ? `${s.name} has a question — tap to open` : (showPulseState ? pulseMeta.title : undefined)}
                role={handUp ? 'button' : undefined}
                tabIndex={handUp ? 0 : undefined}
                onClick={handUp ? () => setHandQuestionTarget({ student: s, questions: handQuestions }) : undefined}
                onKeyDown={handUp ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setHandQuestionTarget({ student: s, questions: handQuestions });
                  }
                } : undefined}
                className={`iboard-student-card group/student-card relative flex flex-col overflow-visible rounded-xl p-3 ${
                  cardView === 'overview' ? 'iboard-student-card--overview' : ''
                } ${
                  handUp
                    ? 'cursor-pointer border border-[#5a5fc3] bg-[#ebeaf8] shadow-[inset_4px_0_0_0_#5a5fc3] dark:border-indigo-400 dark:bg-indigo-950/70 dark:shadow-[inset_4px_0_0_0_#818cf8] dark:ring-1 dark:ring-indigo-500/40'
                    : `bg-white dark:bg-slate-900 ${
                        broadcastPick[s.id]
                          ? 'border border-indigo-400 ring-2 ring-indigo-200 dark:border-indigo-500 dark:ring-indigo-900/70'
                          : monitoring
                          ? 'border border-[#5a5fc3] ring-2 ring-[#cfcce8] dark:border-indigo-400 dark:ring-indigo-900/50'
                          : showPulseState
                          ? pulseMeta.className
                          : notStarted
                          ? 'border border-[#d4d4dc] dark:border-slate-600'
                          : 'border border-[#dedee6] dark:border-slate-700/80'
                      }`
                }`}
              >
                <div className="group/card-head flex min-w-0 items-start gap-1.5">
                  <HintWrap hint="Include this card">
                    <label
                      className="mt-0.5 flex shrink-0 cursor-pointer items-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={!!broadcastPick[s.id]}
                        onChange={() => toggleBroadcastCard(s.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 dark:border-slate-600"
                      />
                      <span className="sr-only">Include this card</span>
                    </label>
                  </HintWrap>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1">
                      <h2
                        className={`min-w-0 truncate font-semibold text-[#52525c] dark:text-slate-100 ${
                          cardView === 'overview' ? 'text-[12px]' : 'text-[14px]'
                        } ${
                          handUp || inQuestion ? 'cursor-pointer hover:text-indigo-700 dark:hover:text-indigo-300' : ''
                        }`}
                        aria-label={handUp ? `${s.name} has a question` : undefined}
                        title={handUp ? 'Open question' : undefined}
                        onClick={(event) => {
                          if (handUp) {
                            event.stopPropagation();
                            setHandQuestionTarget({ student: s, questions: handQuestions });
                            return;
                          }
                          if (inQuestion) openAnswerInRail(s.id);
                        }}
                      >
                        {s.name}
                      </h2>
                      {gradeShortLabel(s.year_level) && (
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {gradeShortLabel(s.year_level)}
                        </span>
                      )}
                      {breakoutsActive ? (
                        <label className="ml-auto shrink-0" onClick={(event) => event.stopPropagation()}>
                          <span className="sr-only">Breakout room for {s.name}</span>
                          <select
                            value={String(s.breakout_room_id || '')}
                            onChange={(event) => moveStudentBreakout(s.id, event.target.value)}
                            className="rounded-md border border-[#e2e2e8] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#3c3c45] outline-none focus:border-[#5a5fc3] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="">—</option>
                            {breakoutRoomOptions.map((id) => (
                              <option key={id} value={id}>
                                Room {id}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {isAway ? (
                        <span
                          title="Tab or app in background"
                          className="shrink-0 rounded-md bg-[#ebeaf8] px-1.5 py-0.5 text-[10px] font-bold text-[#5a5fc3] dark:bg-indigo-950/60 dark:text-indigo-200"
                        >
                          Away
                        </span>
                      ) : notStarted ? (
                        <span
                          title="No writing yet"
                          className="shrink-0 rounded-md bg-[#f1f1f5] px-1.5 py-0.5 text-[10px] font-bold text-[#6b6b76] dark:bg-slate-800 dark:text-slate-300"
                        >
                          Not started
                        </span>
                      ) : null}
                      <span
                        title={
                          showPulseState
                            ? pulseMeta.title
                            : isAway
                              ? 'Away — tab or app in background'
                              : 'Writing activity'
                        }
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          isAway && !showPulseState
                            ? 'bg-[#5a5fc3] ring-1 ring-[#d5d4e4] dark:ring-indigo-900'
                            : light
                        }`}
                      />
                      {monitoring ? (
                        <span
                          className="grid h-3.5 w-3.5 shrink-0 place-items-center text-[#5a5fc3] dark:text-indigo-300"
                          title="Monitoring"
                          aria-label="Monitoring"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                            <circle cx="12" cy="12" r="2.5" />
                          </svg>
                        </span>
                      ) : null}
                      {Array.isArray(room?.draftTrail?.attentionIds) && room.draftTrail.attentionIds.map(Number).includes(Number(s.id)) ? (
                        <button
                          type="button"
                          title="Open Draft Trail"
                          aria-label={`Open Draft Trail for ${s.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDraftTrailFocusId(s.id);
                            setDraftTrailOpen(true);
                          }}
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600 ring-1 ring-red-200 hover:ring-red-300 dark:ring-red-900"
                        />
                      ) : null}
                    </div>
                    {showPulseState && inQuestion && pulseStudent?.hasResponded ? (
                      <HintWrap
                        hint={liveResponse ? formatLiveAnswer(liveResponse.value) : pulseMeta.title}
                        prefer="below"
                        multiline
                        tone="brand"
                        className="mt-0.5 block min-w-0"
                      >
                        <button
                          type="button"
                          onClick={() => openAnswerInRail(s.id)}
                          className="max-w-full truncate text-left text-[10px] font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                          aria-label={`Open ${s.name}'s answer: ${liveResponse ? formatLiveAnswer(liveResponse.value) : 'Answered'}`}
                        >
                          {liveResponse ? formatLiveAnswer(liveResponse.value) : 'Answered'}
                        </button>
                      </HintWrap>
                    ) : !showPulseState || !inQuestion ? (
                      <p className="mt-0.5 text-[10px] font-medium tabular-nums leading-none text-slate-400 dark:text-slate-500">
                        {wc}w
                      </p>
                    ) : null}
                  </div>
                  <div
                    className="iboard-student-card-actions ml-auto flex shrink-0 items-center gap-0.5"
                    data-open={studentActionMenuId === s.id ? 'true' : 'false'}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {/* Keep every action out of the student-name row; the tray appears on card hover/focus. */}
                    <HintWrap hint={
                      noteReceiptByStudentId[s.id] === 'replied'
                        ? 'Student replied — open to read'
                        : noteReceiptByStudentId[s.id] === 'seen'
                          ? 'Note seen'
                          : noteReceiptByStudentId[s.id] === 'waiting'
                            ? 'Note sent — waiting'
                            : 'Send note'
                    }>
                      <button
                        type="button"
                        data-note-student-id={s.id}
                        data-note-student-name={s.name}
                        data-note-status={noteReceiptByStudentId[s.id] || undefined}
                        onClick={(event) => openNoteForStudent(s, event)}
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 ${
                          noteReceiptByStudentId[s.id] === 'replied'
                            ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400'
                            : noteReceiptByStudentId[s.id] === 'seen'
                              ? 'text-green-500 hover:text-green-600 dark:text-green-400'
                              : noteReceiptByStudentId[s.id] === 'waiting'
                                ? 'text-blue-600 hover:text-blue-700 dark:text-blue-400'
                                : 'text-slate-500 hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-300'
                        }`}
                        aria-label={
                          noteReceiptByStudentId[s.id] === 'replied'
                            ? `${s.name} replied to your note`
                            : noteReceiptByStudentId[s.id] === 'seen'
                              ? `Note to ${s.name} seen`
                              : noteReceiptByStudentId[s.id] === 'waiting'
                                ? `Note sent to ${s.name} — waiting for them to open it`
                                : `Note ${s.name}`
                        }
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={noteReceiptByStudentId[s.id] ? 2.6 : 2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </HintWrap>
                    <div className="flex items-center gap-0.5">
                      <ThinkingTrigger
                        socket={socket}
                        studentIds={[s.id]}
                        targetLabel={s.name}
                        subjectAssist={promptSubjectAssist}
                        className="!h-7 !w-7 !text-slate-500 dark:!text-slate-300"
                        onSent={({ count }) => {
                          setCopyToast(`Thinking prompt${count === 1 ? '' : 's'} sent to ${s.name}`);
                          setTimeout(() => setCopyToast(''), 2500);
                        }}
                      />
                      <HintWrap hint="Smaller text">
                        <button
                          type="button"
                          onClick={() => bumpCardFont(s.id, -1)}
                          disabled={cardFontIndex(cardFontById, s.id) <= 0}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          aria-label={`Smaller text on ${s.name}'s card`}
                        >
                          <span className="text-[11px] font-black leading-none">A−</span>
                        </button>
                      </HintWrap>
                      <HintWrap hint="Larger text">
                        <button
                          type="button"
                          onClick={() => bumpCardFont(s.id, 1)}
                          disabled={cardFontIndex(cardFontById, s.id) >= CARD_FONT_REMS.length - 1}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          aria-label={`Larger text on ${s.name}'s card`}
                        >
                          <span className="text-[12px] font-black leading-none">A+</span>
                        </button>
                      </HintWrap>
                      <div className="relative" data-student-actions-menu>
                        <HintWrap hint="More actions">
                          <button
                            type="button"
                            ref={(node) => {
                              const id = Number(s.id);
                              if (node) studentActionMenuBtnRefs.current.set(id, node);
                              else studentActionMenuBtnRefs.current.delete(id);
                            }}
                            onClick={() => setStudentActionMenuId((current) => current === s.id ? null : s.id)}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                            aria-label={`More actions for ${s.name}`}
                            aria-expanded={studentActionMenuId === s.id}
                          >
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                        </HintWrap>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  data-student-writing-pane
                  data-card-font="true"
                  style={{ fontSize: `${cardFontRem(cardFontById, s.id)}rem` }}
                  className={`iboard-writing-surface relative mt-2 rounded-xl bg-white p-2.5 leading-relaxed text-slate-700 scrollbar-thin dark:bg-slate-950 dark:text-slate-300 ${studentWritingPaneClass}`}
                >
                  {s.image_url && (
                    <div className="relative mb-2 overflow-hidden rounded-lg bg-white dark:bg-slate-900">
                      <AnnotatedStudentImage
                        imageUrl={s.image_url}
                        markupUrl={s.teacher_markup_url}
                        alt={`${s.name}'s drawing`}
                        imageClassName="max-h-36 w-full object-contain"
                      />
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
            </section>
          ))}
        </div>
              </div>
      </main>
      </div>
      </div>

      {studentActionMenuId != null && studentActionMenuAnchor && typeof document !== 'undefined'
        && createPortal((() => {
          const menuStudent = visibleStudents.find((student) => Number(student.id) === Number(studentActionMenuId));
          if (!menuStudent) return null;
          const menuMonitoring = monitoredIds.has(Number(menuStudent.id));
          const menuText = String(menuStudent.text || '');
          const menuWidth = 176;
          const gap = 6;
          const left = Math.max(
            8,
            Math.min(studentActionMenuAnchor.right - menuWidth, (typeof window !== 'undefined' ? window.innerWidth : 400) - menuWidth - 8)
          );
          const bottom = Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - studentActionMenuAnchor.top + gap);
          return (
            <div
              data-student-actions-menu
              role="menu"
              className="fixed z-[90] w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-2xl dark:border-slate-700 dark:bg-slate-900"
              style={{ left, bottom }}
            >
              <button type="button" disabled={!menuText.trim()} onClick={() => { copyStudentText(menuStudent); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800" role="menuitem">
                Copy draft
              </button>
              <button type="button" onClick={() => { downloadOneStudent(menuStudent); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800" role="menuitem">
                Save file
              </button>
              <button type="button" onClick={() => { setFocusedStudentId(menuStudent.id); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800" role="menuitem">
                Open full draft
              </button>
              <button
                type="button"
                onClick={() => {
                  toggleMonitorStudent(menuStudent.id);
                  setStudentActionMenuId(null);
                }}
                className="w-full rounded-lg px-3 py-2 text-left font-semibold text-[#5a5fc3] hover:bg-[#ebeaf8] dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                role="menuitem"
              >
                {menuMonitoring ? 'Stop monitoring' : 'Monitor'}
              </button>
              {menuStudent.image_url && (
                <button type="button" onClick={() => { setDrawingMarkupTarget(menuStudent); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/50" role="menuitem">
                  Mark up drawing
                </button>
              )}
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
              <button type="button" onClick={() => { requestRemoveStudent(menuStudent); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40" role="menuitem">
                Remove card
              </button>
            </div>
          );
        })(), document.body)}

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
                {libraryPanel === 'feedback' ? 'AI feedback' : 'Evidence'}
              </h2>
              <CloseButton onClick={() => setLibraryPanel(null)} aria-label="Close" />
            </div>
            <div className="overflow-y-auto p-5 scrollbar-thin">
        {libraryPanel === 'evidence' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">
                Proof of learning for this room — snapshot writing now, or browse lesson packs and student portfolios.
              </p>
              <button type="button" onClick={openEvidenceModal} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
                Snapshot writing
              </button>
            </div>

            {snapshots.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-emerald-300 bg-white p-8 text-center shadow-sm dark:border-emerald-800 dark:bg-slate-900">
                <h3 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">No snapshots yet</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
                  Snapshot student drafts once to unlock lesson packs and individual portfolios.
                </p>
              </div>
            ) : (
              <>
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950" role="tablist" aria-label="Evidence views">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={evidenceHubTab === 'lessons'}
                    onClick={() => setEvidenceHubTab('lessons')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                      evidenceHubTab === 'lessons'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    Lesson saves · {snapshots.length}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={evidenceHubTab === 'students'}
                    onClick={() => setEvidenceHubTab('students')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                      evidenceHubTab === 'students'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    By student · {evidenceStudents.length || '…'}
                  </button>
                </div>

                {evidenceHubTab === 'lessons' && (
                  <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm dark:border-emerald-800 dark:bg-slate-900">
                    <div className="border-b border-emerald-100 px-4 py-3 dark:border-emerald-900">
                      <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-slate-100">Lesson saves</h3>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Whole-class packs from each Save. View or download HTML again.</p>
                    </div>
                    <ul className="max-h-96 divide-y divide-emerald-100/80 overflow-y-auto px-4 scrollbar-thin dark:divide-emerald-900/50">
                      {snapshots.map((sn) => (
                        <li key={sn.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
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
                  </div>
                )}

                {evidenceHubTab === 'students' && (
                <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm dark:border-indigo-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div>
                      <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-slate-100">By student</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose a name; their saved writing across lessons appears on the right.</p>
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
              </>
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
              visible student&apos;s draft (respects <strong>Show group</strong> above). Student names are not
              included — only Student 1, 2, … in list order.
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
                  This removes every student card and teacher card from Room <span className="font-mono font-bold text-slate-900 dark:text-white">{codeInput}</span>. Students will need to join again. Save a session (.iboard) or download the class engagement report first if you want to keep this lesson.
                </p>
              </div>
            </div>
            {error && (
              <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            )}
            <div className="space-y-2 border-b border-slate-200 px-5 py-3 dark:border-slate-700">
              <button
                type="button"
                disabled={newClassBusy || sessionBusy}
                onClick={saveSessionFile}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                Save session (.iboard) first
              </button>
              <button
                type="button"
                disabled={newClassBusy}
                onClick={downloadLessonReportQuick}
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
              >
                Download class engagement report
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
          className="iboard-header-dock iboard-header-dock--start fixed z-[60] w-[min(29rem,calc(100vw-4.75rem))]"
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
                <h2 id="add-teacher-card-title" className="font-display text-base font-black text-slate-950 dark:text-white">Add card or handout</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">PDF or image to Inbox for this lesson</p>
              </div>
              <CloseButton onClick={closeAddCard} disabled={addCardBusy} label="Close" />
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
              <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-3 text-sm dark:border-indigo-800 dark:bg-indigo-950/30">
                <span className="font-bold text-indigo-900 dark:text-indigo-200">Attach PDF or image</span>
                <span className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80">Up to 5 MB · previews in student Inbox (Word/PPT not supported)</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white dark:text-slate-300"
                  onChange={handleAddCardFileChange}
                  disabled={addCardBusy}
                />
              </label>
              {addCardFile && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950/40">
                  <p className="min-w-0 truncate font-semibold text-slate-800 dark:text-slate-100">{addCardFile.name}</p>
                  <button type="button" onClick={() => setAddCardFile(null)} className="shrink-0 text-xs font-bold text-indigo-600 dark:text-indigo-400">Clear</button>
                </div>
              )}
              <textarea
                value={addCardText}
                onChange={(event) => setAddCardText(event.target.value)}
                onPaste={handleAddCardPaste}
                rows={4}
                disabled={!!addCardImage || !!addCardFile}
                aria-label="Card text"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-400 focus:border-indigo-400 focus:ring-2 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                placeholder="Or write text / paste a screenshot…"
              />
              {addCardImage && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/30">
                  <img src={addCardImage} alt="Pasted card preview" className="max-h-48 w-full object-contain" />
                  <button type="button" onClick={() => setAddCardImage('')} className="mt-2 text-xs font-bold text-indigo-600 dark:text-indigo-400">Clear image</button>
                </div>
              )}
              {addCardError && <p className="text-sm font-semibold text-red-600 dark:text-red-300">{addCardError}</p>}
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <label
                data-iboard-add-card-send-option="true"
                className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  data-iboard-send-inbox="true"
                  checked={addCardSendInbox}
                  onChange={(event) => setAddCardSendInbox(event.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
                <span>Send to Inbox</span>
              </label>
              {(addCardFile || addCardImage) && (
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={addCardPlaceOnBoard}
                    onChange={(event) => setAddCardPlaceOnBoard(event.target.checked)}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  <span>Place on this board</span>
                </label>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
              <button type="button" disabled={addCardBusy} onClick={closeAddCard} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button
                type="submit"
                disabled={addCardBusy || (!addCardFile && !addCardImage && !addCardText.trim())}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {addCardBusy ? 'Sending…' : addCardFile || addCardImage ? 'Send' : 'Add card'}
              </button>
            </div>
          </form>
        </div>
      )}

      {settingsOpen && !breakoutsActive && breakoutSetupMode === 'manual' && (
        <div
          ref={breakoutAssignPanelRef}
          className="iboard-breakout-assign fixed z-[60]"
          style={{
            top: teacherToolsTop + settingsChromeHeight,
            maxHeight: `calc(100dvh - ${teacherToolsTop + settingsChromeHeight}px)`,
            left: 'calc(4.75rem + min(22rem, calc(100vw - 4.75rem)))',
          }}
          role="dialog"
          aria-modal="false"
          aria-label="Assign breakout rooms"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="iboard-breakout-assign__chrome">
            <h2>Assign rooms</h2>
            <span className="iboard-breakout-assign__meta">
              {Object.values(breakoutDraftAssign).filter(Boolean).length}/{orderedStudents.length} placed
            </span>
          </div>
          <div className="iboard-breakout-assign__toolbar">
            <label className="iboard-breakout-assign__rooms">
              <span>Rooms</span>
              <div className="iboard-breakout-assign__stepper">
                <button
                  type="button"
                  aria-label="Fewer rooms"
                  disabled={Math.floor(Number(breakoutRoomCountDraft) || 1) <= 1}
                  onClick={() => {
                    setBreakoutRoomCountDraft((n) => Math.max(1, Math.floor(Number(n) || 1) - 1));
                  }}
                >
                  −
                </button>
                <span className="iboard-breakout-assign__stepper-value" aria-live="polite">
                  {Math.max(1, Math.min(40, Math.floor(Number(breakoutRoomCountDraft) || 1)))}
                </span>
                <button
                  type="button"
                  aria-label="More rooms"
                  disabled={
                    Math.floor(Number(breakoutRoomCountDraft) || 1) >=
                    Math.max(1, Math.min(40, orderedStudents.length || 1))
                  }
                  onClick={() => {
                    const maxRooms = Math.max(1, Math.min(40, orderedStudents.length || 1));
                    setBreakoutRoomCountDraft((n) => Math.min(maxRooms, Math.floor(Number(n) || 1) + 1));
                  }}
                >
                  +
                </button>
              </div>
            </label>
            <button
              type="button"
              disabled={
                breakoutBusy ||
                !orderedStudents.length ||
                !Object.values(breakoutDraftAssign).some(Boolean)
              }
              onClick={startBreakoutsManual}
              className={`iboard-breakout-assign__start${
                Object.values(breakoutDraftAssign).some(Boolean) ? ' is-ready' : ''
              }`}
            >
              Start breakouts
            </button>
          </div>
          <div className="iboard-breakout-assign__body scrollbar-thin">
            {!orderedStudents.length ? (
              <p className="px-3 py-4 text-[12px] font-medium text-[#8a8a96]">Waiting for students…</p>
            ) : (
              <ul className="iboard-breakout-assign__list">
                {orderedStudents.map((student) => {
                  const selected = String(breakoutDraftAssign[String(student.id)] || '');
                  const roomCount = Math.max(1, Math.min(40, Math.floor(Number(breakoutRoomCountDraft) || 1)));
                  return (
                    <li key={student.id} className="iboard-breakout-assign__row">
                      <span className="iboard-breakout-assign__name" title={student.name}>
                        {student.name}
                      </span>
                      <div className="iboard-breakout-assign__chips" role="group" aria-label={`Room for ${student.name}`}>
                        <button
                          type="button"
                          aria-pressed={selected === ''}
                          className="iboard-breakout-assign__chip"
                          onClick={() => setDraftBreakoutRoom(student.id, '')}
                          title="Unassigned"
                        >
                          —
                        </button>
                        {Array.from({ length: roomCount }, (_, index) => {
                          const id = String(index + 1);
                          const selectedHere = selected === id;
                          const full =
                            !selectedHere && countDraftInRoom(id, student.id) >= MAX_BREAKOUT_ROOM;
                          return (
                            <button
                              key={id}
                              type="button"
                              aria-pressed={selectedHere}
                              disabled={full}
                              title={full ? `Room ${id} is full (max ${MAX_BREAKOUT_ROOM})` : `Room ${id}`}
                              className="iboard-breakout-assign__chip"
                              onClick={() => setDraftBreakoutRoom(student.id, id)}
                            >
                              {id}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          ref={settingsPanelRef}
          className="iboard-header-dock iboard-header-dock--start iboard-room-settings fixed z-[60] w-[min(22rem,calc(100vw-4.75rem))]"
          style={headerDockStyle}
          role="dialog"
          aria-modal="false"
          aria-label="Room settings"
        >
          <div className="iboard-room-settings__chrome" ref={settingsChromeRef}>
            <h2>Room settings</h2>
            <div className="iboard-room-settings__chrome-close">
              <CloseButton onClick={closeSettings} label="Close" />
            </div>
          </div>
          <div className="iboard-room-settings__body scrollbar-thin">
            <div className="iboard-room-settings__hero">
              <button
                type="button"
                disabled={sessionBusy}
                onClick={saveSessionFile}
                className="iboard-room-settings__primary"
              >
                {sessionBusy ? 'Saving session…' : 'Save session (.iboard)'}
              </button>
              <div className="iboard-room-settings__row">
                <button
                  type="button"
                  onClick={() => {
                    const v = !frozen;
                    setRoom((r) => (r ? { ...r, freeze_class: v } : r));
                    pushSettings({ freeze_class: v });
                  }}
                  className="iboard-room-settings__secondary"
                >
                  {frozen ? 'Unfreeze class' : 'Freeze class'}
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-pressed={isDark}
                  title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                  className="iboard-room-settings__icon-btn"
                >
                  {isDark ? (
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                    </svg>
                  ) : (
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <section className="iboard-room-settings__section">
              <h3 className="iboard-room-settings__label">Board</h3>
              <div className="iboard-room-settings__card iboard-room-settings__card-pad">
                <div className="iboard-room-settings__board">
                  <div
                    className="iboard-room-settings__seg relative"
                    role="group"
                    aria-label="Card view"
                    data-overview-columns-menu
                  >
                    {CARD_VIEWS.map((view) => (
                      <button
                        key={view.id}
                        type="button"
                        onClick={() => {
                          if (view.id === 'overview') {
                            if (cardView === 'overview') {
                              setOverviewColumnsOpen((open) => !open);
                            } else {
                              setCardView('overview');
                              setOverviewColumnsOpen(false);
                            }
                            return;
                          }
                          setOverviewColumnsOpen(false);
                          setCardView(view.id);
                        }}
                        title={view.id === 'overview' ? `${view.label} · columns` : view.label}
                        aria-label={view.id === 'overview' ? `${view.label}, choose columns` : view.label}
                        aria-pressed={cardView === view.id}
                        aria-expanded={view.id === 'overview' ? overviewColumnsOpen : undefined}
                        aria-haspopup={view.id === 'overview' ? 'menu' : undefined}
                        className="iboard-room-settings__seg-btn"
                      >
                        <CardViewIcon id={view.id} />
                      </button>
                    ))}
                  </div>
                  <div className="iboard-room-settings__board-timer">
                    {!room?.timer?.active ? (
                      <div className="iboard-room-settings__field-row">
                        <span className="iboard-room-settings__timer-label">Timer</span>
                        <input
                          type="number"
                          min="1"
                          max="120"
                          inputMode="numeric"
                          value={timerMinutes}
                          onFocus={() => setTimerMinutes('')}
                          onChange={(event) => {
                            const raw = event.target.value;
                            if (raw === '') {
                              setTimerMinutes('');
                              return;
                            }
                            const next = Math.floor(Number(raw));
                            if (!Number.isFinite(next)) return;
                            setTimerMinutes(String(Math.max(1, Math.min(120, next))));
                          }}
                          onBlur={() => {
                            if (timerMinutes === '' || !Number(timerMinutes)) setTimerMinutes('5');
                          }}
                          aria-label="Timer minutes"
                        />
                        <button
                          type="button"
                          disabled={timerBusy || !Number(timerMinutes)}
                          onClick={() =>
                            controlRoomTimer('start', {
                              seconds: Math.max(1, Math.min(120, Number(timerMinutes) || 5)) * 60,
                            })
                          }
                          className="iboard-room-settings__mini"
                        >
                          Start
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="iboard-room-settings__timer-head">
                          <span>Timer</span>
                          <RoomTimerPill
                            timer={room?.timer}
                            onFinishedClick={() => controlRoomTimer('end')}
                          />
                        </div>
                        <div className="iboard-room-settings__field-row flex-wrap">
                          <button
                            type="button"
                            disabled={timerBusy || Number(room.timer.remainingSeconds) <= 0}
                            onClick={() => controlRoomTimer(room.timer.running ? 'pause' : 'resume')}
                            className="iboard-room-settings__mini-ghost"
                          >
                            {room.timer.running ? 'Pause' : 'Resume'}
                          </button>
                          <button
                            type="button"
                            disabled={timerBusy}
                            onClick={() => controlRoomTimer('add', { seconds: 60 })}
                            className="iboard-room-settings__mini-ghost"
                          >
                            +1m
                          </button>
                          <button
                            type="button"
                            disabled={timerBusy}
                            onClick={() => controlRoomTimer('end')}
                            className="iboard-room-settings__mini-ghost iboard-room-settings__mini-danger"
                          >
                            End
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {overviewColumnsOpen && cardView === 'overview' ? (
                  <div
                    className="iboard-room-settings__columns"
                    role="menu"
                    aria-label="Overview columns"
                    data-overview-columns-menu
                  >
                    {OVERVIEW_COLUMN_OPTIONS.map((count) => {
                      const active = overviewColumns === count;
                      return (
                        <button
                          key={count}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          onClick={() => {
                            setOverviewColumns(count);
                            setOverviewColumnsOpen(false);
                          }}
                          className={`min-w-[2.25rem] rounded-lg px-2.5 py-1.5 text-[12px] font-black tabular-nums transition ${
                            active
                              ? 'bg-[#5a5fc3] text-white shadow-sm'
                              : 'text-[#52525c] hover:bg-[#ebeaf8] dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          {count}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="iboard-room-settings__section">
              <h3 className="iboard-room-settings__label">Breakouts</h3>
              <div className="iboard-room-settings__card iboard-room-settings__card-pad">
                {breakoutsActive ? (
                  <div className="space-y-2.5">
                    <div className="iboard-room-settings__field-row flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3c3c45] dark:text-slate-200">
                        Rooms
                        <input
                          type="number"
                          min={1}
                          max={40}
                          value={breakoutRoomCountDraft}
                          onChange={(event) => {
                            const n = Math.max(1, Math.min(40, Math.floor(Number(event.target.value) || 1)));
                            setBreakoutRoomCountDraft(n);
                          }}
                          onBlur={() => setBreakoutCount(breakoutRoomCountDraft)}
                          className="iboard-room-settings__mini w-14"
                          aria-label="Number of breakout rooms"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={breakoutBusy}
                        onClick={() => {
                          const next = Math.min(40, (Number(breakoutRoomCountDraft) || 1) + 1);
                          setBreakoutRoomCountDraft(next);
                          setBreakoutCount(next);
                        }}
                        className="iboard-room-settings__mini-ghost"
                      >
                        Add room
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={breakoutBusy}
                        onClick={startBreakoutsAuto}
                        className="iboard-room-settings__secondary"
                      >
                        Reshuffle (~4)
                      </button>
                      <button
                        type="button"
                        disabled={breakoutBusy}
                        onClick={endBreakouts}
                        className="iboard-room-settings__secondary"
                      >
                        End breakouts
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="iboard-breakout-mode" role="group" aria-label="Breakout setup mode">
                      <button
                        type="button"
                        aria-pressed={breakoutSetupMode === 'auto'}
                        onClick={() => setBreakoutSetupMode('auto')}
                        className="iboard-breakout-mode__btn"
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        aria-pressed={breakoutSetupMode === 'manual'}
                        onClick={() => setBreakoutSetupMode('manual')}
                        className="iboard-breakout-mode__btn"
                      >
                        Manual
                      </button>
                    </div>
                    {breakoutSetupMode === 'auto' ? (
                      <>
                        <p className="text-[12px] font-medium text-[#52525c] dark:text-slate-300">
                          Split into rooms of about 4. Ask stays whole-class.
                        </p>
                        <button
                          type="button"
                          disabled={breakoutBusy || !students.length}
                          onClick={startBreakoutsAuto}
                          className="iboard-room-settings__primary"
                        >
                          Start breakouts
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            <section className="iboard-room-settings__section">
              <h3 className="iboard-room-settings__label">Lesson</h3>
              <div className="iboard-room-settings__card iboard-room-settings__card-pad">
                <div className="iboard-word-target-row">
                  <div className="iboard-room-settings__meta">
                    <span>Word target</span>
                    <span>{wt}</span>
                  </div>
                  <div className="iboard-word-target-bar flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={500}
                      step={10}
                      value={wt}
                      onChange={(e) => commitWordTarget(e.target.value)}
                      onPointerUp={(e) => commitWordTarget(e.currentTarget.value, { immediate: true })}
                      onBlur={(e) => commitWordTarget(e.currentTarget.value, { immediate: true })}
                      className="iboard-word-target-slider min-w-0 flex-1 cursor-pointer accent-indigo-600"
                      aria-label="Word target"
                    />
                    <label className="iboard-word-target-enforce flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      <span>Enforce</span>
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
                  </div>
                </div>
              </div>
              {fixedCommentCount > 0 && (
                <div className="iboard-room-settings__cleanup">
                  {!clearFixedArmed ? (
                    <button type="button" onClick={() => setClearFixedArmed(true)}>
                      <span>Clear fixed comments</span>
                      <span className="iboard-room-settings__cleanup-badge">{fixedCommentCount}</span>
                    </button>
                  ) : (
                    <div className="iboard-room-settings__cleanup-confirm">
                      <p>
                        Remove {fixedCommentCount} green tick{fixedCommentCount === 1 ? '' : 's'}? Purple comments stay.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={clearFixedBusy}
                          onClick={() => {
                            window.dispatchEvent(new Event('iboard:clear-fixed-comments'));
                            setClearFixedArmed(false);
                            closeSettings();
                          }}
                          className="iboard-room-settings__mini flex-1"
                        >
                          {clearFixedBusy ? 'Clearing…' : 'Clear'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setClearFixedArmed(false)}
                          className="iboard-room-settings__mini-ghost"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="iboard-room-settings__section">
              <h3 className="iboard-room-settings__label">Evidence</h3>
              <div className="iboard-room-settings__card iboard-room-settings__list">
                <button type="button" onClick={() => openLibrary('evidence', 'lessons')}>
                  <span>Saved student content</span>
                  {snapshots.length > 0 ? (
                    <span className="iboard-room-settings__badge">{snapshots.length}</span>
                  ) : null}
                </button>
                <button type="button" onClick={() => { closeSettings(); setDraftTrailOpen(true); }}>
                  Draft trail
                </button>
                <button type="button" onClick={() => openLibrary('feedback')}>
                  AI feedback
                </button>
              </div>
            </section>

            <section className="iboard-room-settings__section">
              <h3 className="iboard-room-settings__label">Files &amp; reports</h3>
              <div className="iboard-room-settings__card iboard-room-settings__grid">
                <button
                  type="button"
                  disabled={sessionBusy}
                  onClick={() => { closeSettings(); setSessionPdfOpen(true); }}
                >
                  Export PDF
                </button>
                <button type="button" onClick={openLessonReport}>
                  Engagement
                </button>
                <button type="button" disabled={sessionBusy} onClick={openSessionFilePicker}>
                  Open .iboard
                </button>
                <button type="button" onClick={() => openLibrary('reports')}>
                  Student reports
                </button>
              </div>
            </section>

            <section className="iboard-room-settings__section">
              <h3 className="iboard-room-settings__label">Classroom</h3>
              <div className="iboard-room-settings__card iboard-room-settings__list">
                <button type="button" onClick={() => { closeSettings(); openJoinScreen(); }}>
                  Present join screen
                </button>
                <button type="button" onClick={() => { closeSettings(); downloadParticipantList(); }}>
                  Download participant list
                </button>
              </div>
            </section>

            <button
              type="button"
              onClick={() => { closeSettings(); openNewClassConfirmation(); }}
              className="iboard-room-settings__danger"
            >
              Start new class
            </button>
          </div>
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

      {handQuestionTarget && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-[1px] sm:items-center">
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl dark:border-rose-900 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hand-question-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setHandQuestionTarget(null);
            }}
          >
            <div className="px-5 py-5">
              <h2 id="hand-question-title" className="font-display text-lg font-black text-slate-950 dark:text-white">
                {handQuestionTarget.student.name}
              </h2>
              <div className="mt-3 space-y-2.5">
                {(handQuestionTarget.questions || []).map((question) => (
                  <p
                    key={question.id}
                    className="rounded-xl border border-rose-100 bg-rose-50/80 px-3 py-2.5 text-sm leading-relaxed text-slate-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-slate-100"
                  >
                    {question.text}
                  </p>
                ))}
              </div>
              <div className="mt-4">
                <QuestionInboxReply
                  socket={socket}
                  studentId={handQuestionTarget.student.id}
                  studentName={handQuestionTarget.student.name}
                  questionText={(handQuestionTarget.questions || []).map((q) => q.text).join(' · ')}
                  showToggle={false}
                  open
                  onSent={() => {
                    for (const question of handQuestionTarget.questions || []) {
                      socket.emit('teacher:qna-status', { questionId: question.id, action: 'answer' });
                    }
                    setHandQuestionTarget(null);
                    setCopyToast(`Reply sent to ${handQuestionTarget.student.name}`);
                    setTimeout(() => setCopyToast(''), 2500);
                  }}
                />
              </div>
            </div>
            <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => {
                  for (const question of handQuestionTarget.questions || []) {
                    socket.emit('teacher:qna-status', { questionId: question.id, action: 'dismiss' });
                  }
                  setHandQuestionTarget(null);
                }}
                className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Dismiss
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
                {Array.isArray(room?.draftTrail?.attentionIds) && room.draftTrail.attentionIds.map(Number).includes(Number(focusedStudent.id)) ? (
                  <button
                    type="button"
                    title="Open Draft Trail"
                    aria-label={`Open Draft Trail for ${focusedStudent.name}`}
                    onClick={() => {
                      setDraftTrailFocusId(focusedStudent.id);
                      setDraftTrailOpen(true);
                    }}
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600 ring-2 ring-red-200 hover:ring-red-300 dark:ring-red-900"
                  />
                ) : null}
                <p className="text-xs text-slate-500 dark:text-slate-400">{wordCount(focusedStudent.text)} words · select text to add an inline comment</p>
              </div>
              <div className="flex items-center gap-2">
                <HintWrap hint="Smaller text">
                  <button
                    type="button"
                    onClick={() => bumpCardFont(focusedStudent.id, -1)}
                    disabled={cardFontIndex(cardFontById, focusedStudent.id) <= 0}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label={`Smaller text on ${focusedStudent.name}'s draft`}
                  >
                    <span className="text-[12px] font-black leading-none">A−</span>
                  </button>
                </HintWrap>
                <HintWrap hint="Larger text">
                  <button
                    type="button"
                    onClick={() => bumpCardFont(focusedStudent.id, 1)}
                    disabled={cardFontIndex(cardFontById, focusedStudent.id) >= CARD_FONT_REMS.length - 1}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label={`Larger text on ${focusedStudent.name}'s draft`}
                  >
                    <span className="text-[13px] font-black leading-none">A+</span>
                  </button>
                </HintWrap>
                <button type="button" onClick={(event) => { const button = event.currentTarget; setFocusedStudentId(null); openNoteForStudent(focusedStudent, { currentTarget: button }); }} className="rounded-xl border border-indigo-200 px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                  Send note
                </button>
                {focusedStudent.image_url && (
                  <button type="button" onClick={() => setDrawingMarkupTarget(focusedStudent)} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white hover:bg-indigo-700">
                    ✎ Mark up drawing
                  </button>
                )}
                <CloseButton onClick={() => setFocusedStudentId(null)} aria-label="Close full draft" />
              </div>
            </div>
            <div
              data-student-writing-pane
              data-card-font="true"
              style={{ fontSize: `${cardFontRem(cardFontById, focusedStudent.id)}rem` }}
              className="iboard-writing-surface relative min-h-0 flex-1 overflow-x-visible overflow-y-auto whitespace-pre-wrap px-6 py-5 pr-12 leading-7 text-slate-800 scrollbar-thin dark:text-slate-200"
            >
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

      {focusedPost && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 p-4 sm:items-center"
          onClick={() => setFocusedPostId(null)}
        >
          <article
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="focused-teacher-card-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d5d4e4] bg-[#ebeaf8] px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#5a5fc3]">Teacher card</p>
                <h2 id="focused-teacher-card-title" className="truncate font-display text-xl font-bold text-[#3c3c45] dark:text-slate-100">
                  {focusedPost.title || 'Card'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const post = focusedPost;
                    setFocusedPostId(null);
                    window.dispatchEvent(new CustomEvent('iboard:edit-teacher-card', { detail: { post } }));
                  }}
                  className="rounded-xl border border-[#d5d4e4] bg-white px-3 py-2 text-sm font-bold text-[#5a5fc3] hover:bg-[#ebeaf8] dark:border-slate-600 dark:bg-slate-800 dark:text-indigo-300"
                >
                  Edit
                </button>
                <CloseButton onClick={() => setFocusedPostId(null)} aria-label="Close teacher card" />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-base leading-relaxed text-[#3c3c45] scrollbar-thin dark:text-slate-200">
              {focusedPost.kind === 'image' && focusedPost.image_url ? (
                <img
                  src={focusedPost.image_url}
                  alt={focusedPost.title || 'Teacher card'}
                  className="mx-auto max-h-[70vh] w-full object-contain"
                />
              ) : focusedPost.kind === 'file' && focusedPost.file_url ? (
                <div className="space-y-3">
                  {String(focusedPost.mime_type || '').includes('pdf') || /\.pdf$/i.test(focusedPost.text || '') ? (
                    <iframe
                      title={focusedPost.title || 'Handout'}
                      src={focusedPost.file_url}
                      className="h-[70vh] w-full rounded-xl border-0 bg-slate-50 outline-none dark:bg-slate-900"
                    />
                  ) : null}
                  <a
                    href={`${focusedPost.file_url}${focusedPost.file_url.includes('?') ? '&' : '?'}download=1&name=${encodeURIComponent(focusedPost.text || 'handout')}`}
                    className="inline-flex text-sm font-bold text-[#5a5fc3] hover:underline"
                    download={focusedPost.text || 'handout'}
                  >
                    {focusedPost.text || 'Download handout'}
                  </a>
                </div>
              ) : focusedPost.text?.trim() ? (
                <p className="whitespace-pre-wrap break-words">{focusedPost.text}</p>
              ) : (
                <span className="italic text-slate-400">Empty card</span>
              )}
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
        <form
          ref={noteComposerRef}
          className="fixed z-[70] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          style={{
            top: noteBox ? noteBox.top : -9999,
            left: noteBox ? noteBox.left : -9999,
            visibility: noteBox ? 'visible' : 'hidden',
          }}
          role="dialog"
          aria-modal="false"
          aria-labelledby="private-note-title"
          onSubmit={(event) => {
            event.preventDefault();
            sendNoteToStudent();
          }}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <h2 id="private-note-title" className="min-w-0 truncate font-display text-sm font-bold text-ink-900 dark:text-slate-100">
              Note for {noteTarget.name}
            </h2>
            <CloseButton disabled={noteSending} onClick={closeNoteComposer} aria-label="Close private note" />
          </div>
          <div className="px-4 py-2.5">
            {noteReplyByStudentId[noteTarget.id] ? (
              <div className="mb-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
                  Their reply
                </p>
                {noteReplyByStudentId[noteTarget.id].parentText ? (
                  <p className="mt-1 text-[11px] italic leading-snug text-amber-800/80 dark:text-amber-200/80">
                    Re: “{noteReplyByStudentId[noteTarget.id].parentText}”
                  </p>
                ) : null}
                <p className="mt-1.5 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-amber-950 dark:text-amber-50">
                  {noteReplyByStudentId[noteTarget.id].text}
                </p>
              </div>
            ) : null}
            <textarea
              id="private-note-text"
              ref={noteDraftRef}
              aria-labelledby="private-note-title"
              autoFocus
              rows={4}
              maxLength={5000}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendNoteToStudent();
                }
                if (event.key === 'Escape') closeNoteComposer();
              }}
              placeholder="Private note…"
              className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {noteError ? <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-300">{noteError}</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
            <label
              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
              title="Shows a toast over their draft"
            >
              <input
                type="checkbox"
                checked={noteUrgent}
                onChange={(event) => setNoteUrgent(event.target.checked)}
                className="h-3.5 w-3.5 accent-indigo-600"
              />
              Urgent
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={noteSending}
                onClick={closeNoteComposer}
                className="rounded-xl px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={noteSending || !noteDraft.trim()}
                className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
              >
                {noteSending ? 'Sending…' : noteUrgent ? 'Send urgent' : 'Send'}
              </button>
            </div>
          </div>
        </form>
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
              <CloseButton onClick={() => setSnapshotViewer(null)} aria-label="Close" />
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
              <CloseButton onClick={() => setModalOpen(false)} aria-label="Close" />
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
                          <RemoveButton onClick={() => removeExtraFocus(feedbackMode, item.id)} aria-label={`Remove ${item.text}`} />
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
                        <RemoveButton onClick={() => removeExtraFocus('custom', item.id)} aria-label={`Remove ${item.text}`} />
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
