import { RemoveButton, CloseButton } from '../components/PanelActions.jsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getOverlayRoot } from '../lib/overlayRoot.js';
import { useSearchParams } from 'react-router-dom';
import { createSocket } from '../lib/socket.js';
import { setHintsOff, useHintsOff } from '../lib/hintPrefs.js';
import { FULLSCREEN_UNAVAILABLE_MESSAGE, canFullscreen, isFullscreen, subscribeFullscreenChange, toggleFullscreen } from '../lib/fullscreen.js';
import DraftTrailPanel from '../components/DraftTrailPanel.jsx';
import LearningTrailView from '../components/LearningTrailView.jsx';
import SessionPdfExport from '../components/SessionPdfExport.jsx';
import ClassInsightsPanel from '../components/ClassInsightsPanel.jsx';
import { activityStatus, isDraftEmpty, isNotStarted, parseServerDateMs, wordCount } from '../lib/text.js';
import useActivityClock from '../hooks/useActivityClock.js';
import {
  buildAiPrompt,
  buildClassSummaryPrompt,
  parseNumberedPaste,
  normalizeFeedbackMode,
  FEEDBACK_MODES,
  SUBJECT_ASSIST_OPTIONS,
  YEAR_LEVEL_OPTIONS,
  MODE_TOGGLE_LABELS,
  defaultModeTogglesForYear,
  mergeModeToggles,
  visibleToggleLabels,
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
import AlertIcon from '../components/AlertIcon.jsx';
import WritingPulsePanel from '../components/WritingPulsePanel.jsx';
import ThinkingTrigger from '../components/ThinkingTrigger.jsx';
import { confirmDialog } from '../components/ConfirmDialogHost.jsx';
import { copyText } from '../lib/copyText.js';
import QuestionInboxReply from '../components/QuestionInboxReply.jsx';
import {
  downloadTextFile,
  buildEvidenceHtml,
  evidenceFilenames,
  buildStudentPortfolioText,
} from '../lib/exportRoom.js';
import { fileToCompressedJpegDataUrl } from '../lib/image.js';
import { LIVE_STATUS_LABELS } from '../lib/liveResponseMeta.js';
import { useTheme } from '../lib/theme.jsx';
import HintWrap from '../components/HintWrap.jsx';
import ClassGauge from '../components/ClassGauge.jsx';
import StudentPickerDialog from '../components/StudentPickerDialog.jsx';
import { JoinScreen, ObjectiveScreen, rememberObjective } from '../components/LessonStartScreens.jsx';
import { fitGrid } from '../lib/fitGrid.js';
import TeacherBoardTour from '../components/TeacherBoardTour.jsx';
import TeacherHelpPanel from '../components/TeacherHelpPanel.jsx';
import LessonReportPanel from '../components/LessonReportPanel.jsx';
import ConversationModal, { ChatIcon } from '../components/ConversationModal.jsx';
import { downloadLessonReportHtml } from '../lib/lessonReport.js';
import { lastTeacherRoomCode, rememberTeacherRoomCode } from '../lib/teacherRoom.js';
import {
  downloadSessionPack,
  emitAck,
  readSessionFile,
} from '../lib/iboardSession.js';

const MODE_LABELS = {
  writing: 'Narrative',
  explanation: 'Explanation',
  argument: 'Argument / Analysis',
  problem_solving: 'Problem Solving',
  custom: 'Custom',
};

const CARD_VIEW_STORAGE_KEY = 'iboard-teacher-card-view-v2';
const OVERVIEW_COLUMNS_STORAGE_KEY = 'iboard-overview-columns';
const CARD_FONT_STORAGE_KEY = 'iboard-teacher-card-fonts';
const TEACHER_PANEL_HIDDEN_KEY = 'iboard-teacher-panel-hidden-v2';
const LESSON_BEGUN_KEY = 'iboard-lesson-begun';
const LESSON_BEGUN_MAX_MS = 4 * 60 * 60 * 1000;
const ALERT_PREFS_KEY = 'tuit-alert-prefs';
const DEFAULT_ALERT_PREFS = { away: true, notStarted: true, notStartedMin: 4, noTyping: true, noTypingMin: 3, pasted: true };
const INBOX_NOTE_MAX = 20_000;

function readAlertPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(ALERT_PREFS_KEY) || '{}');
    return { ...DEFAULT_ALERT_PREFS, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return { ...DEFAULT_ALERT_PREFS };
  }
}

function readLessonBegun(code) {
  try {
    const saved = JSON.parse(localStorage.getItem(LESSON_BEGUN_KEY) || 'null');
    return saved?.code === code && Date.now() - Number(saved.at) < LESSON_BEGUN_MAX_MS;
  } catch {
    return false;
  }
}

function rememberLessonBegun(code) {
  try {
    localStorage.setItem(LESSON_BEGUN_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* storage may be unavailable */
  }
}

function forgetLessonBegun() {
  try {
    localStorage.removeItem(LESSON_BEGUN_KEY);
  } catch {
    /* storage may be unavailable */
  }
}
const MONITOR_STORAGE_KEY = 'iboard-teacher-monitor';
const LEGACY_WATCH_STORAGE_KEY = 'iboard-teacher-watch';
/** Per-card writing size steps (applied as rem so rich HTML inherits). */
const CARD_FONT_REMS = [0.75, 0.875, 1, 1.125, 1.25];
const CARD_FONT_DEFAULT = 2; /* index of 1rem */
const FIT_CARD_FONT_BASE = 0.72; /* Fit all cards are small; A−/A+ scale from this */
const CARD_VIEWS = [
  { id: 'all', label: 'Fit all', hint: 'Every student on one screen' },
  { id: 'overview', label: 'Columns' },
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

function CardViewIcon({ id, className = 'h-5 w-5' }) {
  if (id === 'all') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2.5" width="4" height="4" rx="0.8" />
        <rect x="8" y="2.5" width="4" height="4" rx="0.8" />
        <rect x="14" y="2.5" width="4" height="4" rx="0.8" />
        <rect x="2" y="8" width="4" height="4" rx="0.8" />
        <rect x="8" y="8" width="4" height="4" rx="0.8" />
        <rect x="14" y="8" width="4" height="4" rx="0.8" />
        <rect x="2" y="13.5" width="4" height="4" rx="0.8" />
        <rect x="8" y="13.5" width="4" height="4" rx="0.8" />
        <rect x="14" y="13.5" width="4" height="4" rx="0.8" />
      </svg>
    );
  }
  if (id === 'overview') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
        <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
        <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
        <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
      </svg>
    );
  }
  if (id === 'reading') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3" width="6.5" height="14" rx="1.2" />
        <rect x="11" y="3" width="6.5" height="14" rx="1.2" />
        <path d="M4.2 6.5h3M4.2 9.2h3M4.2 11.9h2.2M12.7 6.5h3M12.7 9.2h3M12.7 11.9h2.2" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="2.5" width="11" height="15" rx="1.4" />
      <path d="M7 6.5h6M7 9.5h6M7 12.5h4" />
    </svg>
  );
}

function studentHasInboxWait(student, pendingHandByStudentId, noteReceiptByStudentId) {
  const id = Number(student?.id);
  if (!id) return false;
  if ((pendingHandByStudentId.get(id) || []).length > 0) return true;
  return noteReceiptByStudentId[id] === 'replied';
}

function timerIsCounting(timer) {
  if (!timer?.active) return false;
  if (timer.finishedAt) return false;
  if (timer.running) return true;
  return Number(timer.remainingSeconds) > 0;
}

const TEACHER_TOOLS_TABS = [
  { id: 'ask', label: 'Ask the class', rail: 'Ask class', hint: 'Ask the class a question and see their answers' },
];

function clockTime(ms) {
  return ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function initialCardView() {
  if (typeof window === 'undefined') return 'all';
  try {
    const saved = localStorage.getItem(CARD_VIEW_STORAGE_KEY);
    return CARD_VIEWS.some((view) => view.id === saved) ? saved : 'all';
  } catch {
    return 'all';
  }
}

/** SQLite `datetime('now')` is UTC without a zone marker — show it in local time. */
function formatSqlUtc(value) {
  if (!value) return '';
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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

/** Saved room settings version; older saves remapped via mergeModeToggles. */
const FEEDBACK_SETTINGS_VERSION = 4;

function defaultModeToggles(yearLevel = 'general') {
  return defaultModeTogglesForYear(yearLevel);
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

function ToggleRow({ label, checked, onChange, compact = false }) {
  return (
    <label
      className={
        compact
          ? 'iboard-feedback-settings__toggle'
          : 'flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 shadow-sm transition hover:border-indigo-200'
      }
    >
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
  const [newClassStep, setNewClassStep] = useState('');
  const hintsOff = useHintsOff();
  const [alertPrefs, setAlertPrefs] = useState(readAlertPrefs);
  const updateAlertPrefs = useCallback((patch) => {
    setAlertPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next));
      } catch {
        /* storage may be unavailable */
      }
      return next;
    });
  }, []);
  const [joinScreenOpen, setJoinScreenOpen] = useState(false);
  const [lessonBegun, setLessonBegun] = useState(false);
  const [entranceStep, setEntranceStep] = useState('join');
  const [drawingMarkupTarget, setDrawingMarkupTarget] = useState(null);
  const [audienceQuestions, setAudienceQuestions] = useState([]);
  const [handQuestionTarget, setHandQuestionTarget] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState('writing');
  const [subjectAssist, setSubjectAssist] = useState('general');
  const [yearLevel, setYearLevel] = useState('general');
  const [customFocusText, setCustomFocusText] = useState('');
  const [modeToggles, setModeToggles] = useState(() => defaultModeToggles('general'));
  const [extraFocusByMode, setExtraFocusByMode] = useState(emptyExtraFocusState);
  const [addFocusDraft, setAddFocusDraft] = useState('');

  const [pasteBox, setPasteBox] = useState('');
  const [copyToast, setCopyToast] = useState('');
  const [copiedStudentId, setCopiedStudentId] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteReceiptByStudentId, setNoteReceiptByStudentId] = useState({});
  const [noteReplyByStudentId, setNoteReplyByStudentId] = useState({});
  const noteReplyByStudentIdRef = useRef({});
  const noteTargetIdRef = useRef(0);
  const [shareTarget, setShareTarget] = useState(null);
  const [actionMenuShareStep, setActionMenuShareStep] = useState(false);
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
  const [portfolioDownloadKind, setPortfolioDownloadKind] = useState('');
  const [snapshotViewer, setSnapshotViewer] = useState(null);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState('ask');
  const [toolsHighlightStudentId, setToolsHighlightStudentId] = useState(null);
  const teacherHeaderRef = useRef(null);
  const teacherToolsNavRef = useRef(null);
  const tourShareRef = useRef(null);
  const tourEngageRef = useRef(null);
  const tourBoardRef = useRef(null);
  const tourRecRef = useRef(null);
  const tourHeaderToolsRef = useRef(null);
  const viewButtonRef = useRef(null);
  const [viewDockRight, setViewDockRight] = useState(12);
  const tourAnchors = useMemo(
    () => ({
      share: tourShareRef,
      engage: tourEngageRef,
      board: tourBoardRef,
      view: viewButtonRef,
      rec: tourRecRef,
      headerTools: tourHeaderToolsRef,
    }),
    [],
  );
  const teacherToolsPanelRef = useRef(null);
  const addCardPanelRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const recordsButtonRef = useRef(null);
  const settingsPanelRef = useRef(null);
  const viewPanelRef = useRef(null);
  const helpButtonRef = useRef(null);
  const helpPanelRef = useRef(null);
  const settingsChromeRef = useRef(null);
  const breakoutAssignPanelRef = useRef(null);
  const [settingsChromeHeight, setSettingsChromeHeight] = useState(44);
  const [teacherToolsTop, setTeacherToolsTop] = useState(0);
  const [teacherToolsDockHeight, setTeacherToolsDockHeight] = useState(() => (
    typeof window === 'undefined' ? 560 : Math.min(560, Math.max(220, window.innerHeight - 20))
  ));
  const [removeStudentTarget, setRemoveStudentTarget] = useState(null);
  const [removeStudentBusy, setRemoveStudentBusy] = useState(false);
  const [libraryPanel, setLibraryPanel] = useState(null); // null | 'evidence' (Lesson records hub shell)
  const [libraryView, setLibraryView] = useState('home'); // home | feedback | feedback-sent | drafting | participation | pdf | portfolios
  const [aiFeedbackLog, setAiFeedbackLog] = useState(null);
  const [aiSummaries, setAiSummaries] = useState([]);
  const [aiTask, setAiTask] = useState('feedback');
  const [summaryBox, setSummaryBox] = useState('');
  const [summarySaving, setSummarySaving] = useState(false);
  const [aiFeedbackLogError, setAiFeedbackLogError] = useState('');
  const [fixedCommentCount, setFixedCommentCount] = useState(0);
  const [clearFixedBusy, setClearFixedBusy] = useState(false);
  const [clearFixedArmed, setClearFixedArmed] = useState(false);
  const [livePulse, setLivePulse] = useState({ activity: null, responses: [], students: [] });
  const [cardView, setCardView] = useState(initialCardView);
  const [overviewColumns, setOverviewColumns] = useState(initialOverviewColumns);
  const boardScrollRef = useRef(null);
  const [boardBox, setBoardBox] = useState({ width: 0, height: 0 });
  const [cardFontById, setCardFontById] = useState(readCardFontMap);
  const [focusedStudentId, setFocusedStudentId] = useState(null);
  const [focusedPostId, setFocusedPostId] = useState(null);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [windowHeight, setWindowHeight] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  const [monitoredIds, setMonitoredIds] = useState(() => new Set());
  /** studentId → away (tab/app background). Synced from student:presence + live:teacher. */
  const [awayByStudentId, setAwayByStudentId] = useState(() => new Map());
  /** Pin attention cards (away / not started) to the top when true. */
  const [attentionFocus, setAttentionFocus] = useState(null); // null | 'away' | 'notStarted' | 'pasted'
  /** Pastes this lesson by student id, pushed live by the server whether REC is on or off. */
  const [pasteCounts, setPasteCounts] = useState({});
  const [pasteMenu, setPasteMenu] = useState(null); // { studentId, left, top }
  const [pasteDetail, setPasteDetail] = useState(null); // { studentId, loading, pastes }
  /** Pin students who asked a question or replied to a teacher message to the top. */
  const [inboxFocus, setInboxFocus] = useState(false);
  const [studentActionMenuId, setStudentActionMenuId] = useState(null);
  const [studentActionMenuAnchor, setStudentActionMenuAnchor] = useState(null);
  const studentActionMenuBtnRefs = useRef(new Map());
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [addCardDragOver, setAddCardDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('settings');
  const [viewOpen, setViewOpen] = useState(false);
  const [overviewColsPeek, setOverviewColsPeek] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourKey, setTourKey] = useState(0);
  const [helpDockBox, setHelpDockBox] = useState(null);
  const [helpFlash, setHelpFlash] = useState(null);
  const [teacherPanelHidden, setTeacherPanelHidden] = useState(() => {
    try {
      return localStorage.getItem(TEACHER_PANEL_HIDDEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const teacherRevealLockRef = useRef(false);
  const teacherRevealTimerRef = useRef(null);
  const [draftTrailOpen, setDraftTrailOpen] = useState(false);
  const [sessionPdfOpen, setSessionPdfOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const closeInsights = useCallback(() => setInsightsOpen(false), []);
  const [draftTrailFocusId, setDraftTrailFocusId] = useState(null);
  const [learningTrailId, setLearningTrailId] = useState(null);
  const [addCardTitle, setAddCardTitle] = useState('');
  const [addCardText, setAddCardText] = useState('');
  const [addCardImage, setAddCardImage] = useState('');
  const [addCardFile, setAddCardFile] = useState(null);
  const [addCardBusy, setAddCardBusy] = useState(false);
  const [addCardError, setAddCardError] = useState('');
  const [addCardPickerOpen, setAddCardPickerOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState('5');
  const [timerBusy, setTimerBusy] = useState(false);

  const socket = useMemo(() => createSocket(), []);
  const independentSince = Number(room?.draftTrail?.independentSince) || 0;
  const independentRef = useRef(0);
  independentRef.current = independentSince;
  useEffect(() => {
    const guarded = new Set(['teacher:distribute', 'teacher:annotation-add', 'teacher:material-send', 'teacher:broadcast']);
    const innerEmit = socket.emit;
    let asking = null;
    let allowUntil = 0;
    const askOnce = () => {
      if (!asking) {
        asking = confirmDialog({
          title: 'Independent writing is on',
          message: 'This will show as teacher support on the Learning trail. Send anyway?',
          confirmLabel: 'Send anyway',
          cancelLabel: 'Don’t send',
          tone: 'brand',
        }).then((ok) => {
          asking = null;
          if (ok) allowUntil = Date.now() + 15000;
          return ok;
        });
      }
      return asking;
    };
    socket.emit = (eventName, ...args) => {
      if (!independentRef.current || !guarded.has(eventName) || Date.now() < allowUntil) {
        return innerEmit.call(socket, eventName, ...args);
      }
      // Deferred emit: keep socket.timeout() flags for this call only.
      const flags = { ...(socket.flags || {}) };
      socket.flags = {};
      askOnce().then((ok) => {
        if (ok) {
          socket.flags = flags;
          innerEmit.call(socket, eventName, ...args);
          return;
        }
        window.__iboardPendingNoteStudentId = 0;
        const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        const ack = { ok: false, error: 'Not sent. Independent writing is on.' };
        if (cb) {
          if (flags.timeout !== undefined) cb(null, ack);
          else cb(ack);
        }
      });
      return socket;
    };
    return () => {
      socket.emit = innerEmit;
    };
  }, [socket]);
  const teacherRoomRef = useRef('');
  const joinedRef = useRef(false);
  const autoJoinTriedRef = useRef(false);
  const sessionDirtyRef = useRef(false);
  const sessionHydratedRef = useRef(false);
  const sessionFileInputRef = useRef(null);
  const sessionMenuRef = useRef(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  useEffect(() => {
    if (!sessionMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!sessionMenuRef.current?.contains(event.target)) setSessionMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSessionMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [sessionMenuOpen]);
  const gaugeSlotRef = useRef(null);
  const gaugePanelRef = useRef(null);
  const [gaugePanelOpen, setGaugePanelOpen] = useState(false);
  const [gaugeBox, setGaugeBox] = useState(null);
  useLayoutEffect(() => {
    if (!gaugePanelOpen) return undefined;
    const place = () => {
      const rect = gaugeSlotRef.current?.querySelector('.iboard-class-gauge')?.getBoundingClientRect();
      if (rect) setGaugeBox({ top: Math.round(rect.bottom + 18), centre: Math.round(rect.left + rect.width / 2) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('iboard:teacher-layout', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('iboard:teacher-layout', place);
    };
  }, [gaugePanelOpen]);
  useEffect(() => {
    if (!gaugePanelOpen) return undefined;
    // Learning trails, presenting and pickers open on top; the panel waits underneath.
    const overlayOpen = () => document.querySelector('dialog[open], [data-iboard-dialog]');
    const onPointerDown = (event) => {
      const target = event.target;
      if (gaugeSlotRef.current?.contains(target) || gaugePanelRef.current?.contains(target)) return;
      if (target?.closest?.('dialog, [role="dialog"], [role="menu"], [data-iboard-sets-preview], .fixed.inset-0, select')) return;
      if (overlayOpen()) return;
      setGaugePanelOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !overlayOpen()) setGaugePanelOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [gaugePanelOpen]);
  const [headerTool, setHeaderTool] = useState(null);
  const breakoutsMenuOpen = headerTool === 'breakouts';
  useEffect(() => {
    if (!headerTool) return undefined;
    const close = () => {
      setHeaderTool(null);
      setBreakoutSetupMode('auto');
    };
    const onPointerDown = (event) => {
      if (event.target?.closest?.(`[data-header-tool="${headerTool}"]`)) return;
      if (event.target?.closest?.('select')) return;
      close();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [headerTool]);
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
    if (studentActionMenuId == null) setActionMenuShareStep(false);
  }, [studentActionMenuId]);

  useEffect(() => {
    try {
      localStorage.setItem(CARD_VIEW_STORAGE_KEY, cardView);
    } catch {
      /* The view still works when browser storage is unavailable. */
    }
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
    const node = boardScrollRef.current;
    if (!node || typeof ResizeObserver !== 'function') return undefined;
    const measure = () => {
      const style = window.getComputedStyle(node);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const next = { width: node.clientWidth, height: Math.max(0, node.clientHeight - padY) };
      setBoardBox((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [joined]);

  useEffect(() => {
    const syncHeight = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', syncHeight);
    return () => {
      window.removeEventListener('resize', syncHeight);
      window.removeEventListener('orientationchange', syncHeight);
    };
  }, []);

  useEffect(() => {
    function syncFullscreen() {
      setBrowserFullscreen(isFullscreen());
    }
    syncFullscreen();
    return subscribeFullscreenChange(syncFullscreen);
  }, []);

  // Browsers only allow full screen from a user gesture, so the teacher's first click enters it. Esc leaves.
  useEffect(() => {
    if (!canFullscreen()) return undefined;
    const enter = () => {
      document.removeEventListener('click', enter, true);
      if (!isFullscreen()) toggleFullscreen().catch(() => {});
    };
    document.addEventListener('click', enter, true);
    return () => document.removeEventListener('click', enter, true);
  }, []);

  const moreMenuRef = useRef(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!moreMenuRef.current?.contains(event.target)) setMoreMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreMenuOpen]);

  async function toggleBrowserFullscreen() {
    try {
      await toggleFullscreen();
    } catch {
      setCopyToast(canFullscreen() ? 'Fullscreen blocked — try the browser View menu' : FULLSCREEN_UNAVAILABLE_MESSAGE);
      setTimeout(() => setCopyToast(''), 4500);
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

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => window.dispatchEvent(new Event('iboard:teacher-layout')));
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedStudentId]);

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
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('iboard:teacher-layout')));
    return () => cancelAnimationFrame(frame);
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
    const yearForDefaults =
      rawYl != null && String(rawYl).trim() !== '' ? String(rawYl).trim() : 'general';
    setModeToggles(ft.modes ? mergeModeToggles(ft.modes, yearForDefaults) : defaultModeToggles(yearForDefaults));
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
      if (sessionHydratedRef.current) markSessionDirty();
      else sessionHydratedRef.current = true;
    };
    const onLive = ({ student: s }) => {
      if (!s?.id) return;
      const row = normalizeStudentFromServer(s);
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

  function openTimerDock() {
    toggleHeaderTool('timer');
  }

  function openViewDock() {
    closeSettings();
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardOpen(false);
    setHelpOpen(false);
    const rect = viewButtonRef.current?.getBoundingClientRect();
    if (rect) setViewDockRight(Math.max(12, window.innerWidth - rect.right - 8));
    setViewOpen((open) => !open);
  }

  function openHelpDock() {
    closeSettings();
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardOpen(false);
    setViewOpen(false);
    setHelpOpen((open) => !open);
  }

  function closeHelpDock() {
    setHelpOpen(false);
  }

  function flashHelpTarget(id) {
    setHelpFlash(id);
    window.setTimeout(() => {
      setHelpFlash((current) => (current === id ? null : current));
    }, 1650);
  }

  function openSessionFromHelp(target) {
    setHelpOpen(false);
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardOpen(false);
    setViewOpen(false);
    setClearFixedArmed(false);
    if (target === 'session') {
      setSettingsOpen(false);
      setSessionMenuOpen(true);
      window.requestAnimationFrame(() => flashHelpTarget(target));
      return;
    }
    setSettingsOpen(false);
    setSessionMenuOpen(false);
    setHeaderTool(target === 'breakouts' ? 'breakouts' : null);
    window.requestAnimationFrame(() => {
      flashHelpTarget(target);
      const el = document.querySelector(`[data-help-target="${target}"]`);
      el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function handleHelpAction(action) {
    if (action === 'tour') {
      try {
        localStorage.removeItem('iboard-teacher-tour');
      } catch {
        /* ignore */
      }
      setHelpOpen(false);
      setTourKey((value) => value + 1);
      return;
    }
    if (action === 'share') {
      setHelpOpen(false);
      openAddCard({ forceOpen: true });
      window.requestAnimationFrame(() => flashHelpTarget('share'));
      return;
    }
    if (action === 'ask') {
      setHelpOpen(false);
      openTeacherTools('ask');
      window.requestAnimationFrame(() => flashHelpTarget('ask'));
      return;
    }
    if (action === 'responses') {
      setHelpOpen(false);
      openTeacherTools('responses');
      window.requestAnimationFrame(() => flashHelpTarget('ask'));
      return;
    }
    if (action === 'freeze') {
      openSessionFromHelp('freeze');
      return;
    }
    if (action === 'session') {
      openSessionFromHelp('session');
      return;
    }
    if (action === 'breakouts') {
      openSessionFromHelp('breakouts');
      return;
    }
    if (action === 'records') {
      setHelpOpen(false);
      openLibrary('evidence', 'lessons');
      window.requestAnimationFrame(() => flashHelpTarget('records'));
      return;
    }
    if (action === 'ai') {
      setHelpOpen(false);
      openLibrary('feedback');
      window.requestAnimationFrame(() => flashHelpTarget('ai'));
    }
  }

  useEffect(() => {
    const onQna = (payload) => {
      setAudienceQuestions(Array.isArray(payload?.questions) ? payload.questions : []);
      markSessionDirty();
    };
    socket.on('qna:teacher', onQna);
    if (joinedRef.current) socket.emit('teacher:qna-sync', {});
    return () => socket.off('qna:teacher', onQna);
  }, [socket, markSessionDirty]);

  useEffect(() => {
    const onPasteAlerts = (payload) => setPasteCounts(payload?.counts || {});
    socket.on('teacher:paste-alerts', onPasteAlerts);
    if (joinedRef.current) {
      socket.emit('teacher:paste-alerts-sync', {}, (ack) => {
        if (ack?.ok) setPasteCounts(ack.counts || {});
      });
    }
    return () => socket.off('teacher:paste-alerts', onPasteAlerts);
  }, [socket]);

  useEffect(() => {
    if (!pasteMenu) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if ((event.type === 'pointerdown' || event.type === 'scroll') && event.target.closest?.('[data-paste-menu]')) return;
      setPasteMenu(null);
      setPasteDetail(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [pasteMenu]);

  function openPasteDetail(studentId, menu) {
    socket.timeout(5000).emit('teacher:paste-detail', { studentId }, (err, ack) => {
      setPasteDetail({ studentId, loading: false, pastes: !err && ack?.ok && Array.isArray(ack.pastes) ? ack.pastes : [] });
      setPasteMenu(menu);
    });
  }

  function clearPasteAlert(studentId) {
    setPasteMenu(null);
    setPasteDetail(null);
    setPasteCounts((prev) => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    socket.emit('teacher:paste-ack', { studentId });
  }

  useEffect(() => {
    noteReplyByStudentIdRef.current = noteReplyByStudentId;
  }, [noteReplyByStudentId]);

  useEffect(() => {
    noteTargetIdRef.current = Number(noteTarget?.id) || 0;
  }, [noteTarget]);

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
      // Chat already open with this student: they're reading it now, so it isn't waiting.
      if (noteTargetIdRef.current === studentId) {
        socket.emit('teacher:note-reply-seen', { studentId });
        return;
      }
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
      // Persistent header pill + card sort handle off-screen replies.
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

  function beginLesson(code) {
    rememberLessonBegun(String(code || '').replace(/\D/g, '').slice(0, 4));
    setCardView('all');
    setLessonBegun(true);
  }

  async function createOrJoin(overrideCode, { skipJoinScreen = false, showJoinScreen = false } = {}) {
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
          setError('TUIT can’t reach the class server. Check the Wi-Fi, or ask IT to check the TUIT server is running.');
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
        setEntranceStep('join');
        if (skipJoinScreen) beginLesson(code);
        else setLessonBegun(showJoinScreen ? false : readLessonBegun(code));
        setJoined(true);
        setCodeInput(code);
        try {
          const snap = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
          if (snap.ok) {
            const data = await snap.json();
            const startingFresh = !(data.students || []).some((student) => student.connected);
            if (startingFresh && data.room?.lesson_objective) {
              data.room = { ...data.room, lesson_objective: '' };
              socket.emit('teacher:settings', { lesson_objective: '' }, () => {});
            }
            setRoom(data.room);
            setStudents((data.students || []).map(normalizeStudentFromServer));
            hydrateFeedbackStateFromRoom(data.room);
          }
        } catch {
          /* room:state from socket will catch up */
        }
      });
    } catch {
      setError('TUIT can’t reach the class server. Check the Wi-Fi, or ask IT to check the TUIT server is running.');
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
  const connectedStudents = useMemo(() => {
    const connectedIds = new Set(
      (livePulse.students || []).filter((student) => student.connected).map((student) => Number(student.id))
    );
    return orderedStudents.filter((student) => connectedIds.has(Number(student.id)));
  }, [livePulse.students, orderedStudents]);

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

  const connectedIdSet = useMemo(() => new Set(connectedStudents.map((student) => Number(student.id))), [connectedStudents]);

  const isAwayAlert = useCallback(
    (student) => alertPrefs.away && awayByStudentId.get(Number(student.id)) === true,
    [alertPrefs.away, awayByStudentId]
  );

  const isNotStartedAlert = useCallback(
    (student) => alertPrefs.notStarted && isNotStarted(student, activityNow, Number(alertPrefs.notStartedMin) * 60 * 1000),
    [alertPrefs.notStarted, alertPrefs.notStartedMin, activityNow]
  );

  const isNoTyping = useCallback(
    (student) => {
      if (!alertPrefs.noTyping) return false;
      if (!String(student.text || '').trim()) return false;
      if (!connectedIdSet.has(Number(student.id))) return false;
      if (awayByStudentId.get(Number(student.id))) return false;
      if (room?.freeze_class || livePulse.activity) return false;
      const target = Number(room?.word_target) || 0;
      if (target > 0 && wordCount(student.text) >= target) return false;
      const changedAt = parseServerDateMs(student.updated_at);
      return Number.isFinite(changedAt) && activityNow - changedAt >= Number(alertPrefs.noTypingMin) * 60 * 1000;
    },
    [alertPrefs.noTyping, alertPrefs.noTypingMin, connectedIdSet, awayByStudentId, room?.freeze_class, room?.word_target, livePulse.activity, activityNow]
  );

  const matchesAttention = useCallback(
    (student, filter) => {
      if (filter === 'away') return isAwayAlert(student);
      if (filter === 'notStarted') return isNotStartedAlert(student);
      if (filter === 'noTyping') return isNoTyping(student);
      if (filter === 'pasted') return alertPrefs.pasted && !!pasteCounts[student.id];
      return false;
    },
    [isAwayAlert, isNotStartedAlert, isNoTyping, alertPrefs.pasted, pasteCounts]
  );

  const attentionNames = useMemo(() => {
    const names = { away: [], notStarted: [], noTyping: [], pasted: [] };
    for (const student of orderedStudents) {
      for (const filter of Object.keys(names)) {
        if (!matchesAttention(student, filter)) continue;
        const pastes = filter === 'pasted' ? Number(pasteCounts[student.id]) || 0 : 0;
        names[filter].push(`${student.name || 'Unnamed'}${pastes > 1 ? ` (${pastes})` : ''}`);
      }
    }
    return names;
  }, [orderedStudents, matchesAttention, pasteCounts]);

  const attentionCounts = useMemo(
    () => Object.fromEntries(Object.entries(attentionNames).map(([filter, list]) => [filter, list.length])),
    [attentionNames]
  );

  useEffect(() => {
    if (attentionFocus && !attentionCounts[attentionFocus]) setAttentionFocus(null);
  }, [attentionFocus, attentionCounts]);

  const classGauge = useMemo(() => {
    if (livePulse.activity) {
      const asked = (livePulse.students || []).filter(
        (student) => !student.promptExcluded && (student.connected || student.hasResponded)
      );
      const answered = asked.filter((student) => student.hasResponded).length;
      const thinking = asked.filter((student) => !student.hasResponded && student.engagement_status === 'unsure').length;
      return {
        title: 'Live question',
        caption: 'answered',
        done: answered,
        total: asked.length,
        segments: [
          { key: 'answered', label: 'Answered', count: answered, color: 'var(--class-gauge-done)' },
          { key: 'thinking', label: 'Still thinking', count: thinking, color: 'var(--class-gauge-mid)' },
          { key: 'waiting', label: 'Not answered yet', count: asked.length - answered - thinking, color: 'var(--class-gauge-rest)' },
        ],
      };
    }
    const online = orderedStudents.filter((student) => connectedIdSet.has(Number(student.id)));
    let writing = 0;
    let paused = 0;
    for (const student of online) {
      if (isDraftEmpty(student)) continue;
      if (!awayByStudentId.get(Number(student.id)) && activityStatus(student.updated_at, activityNow) !== 'idle') writing += 1;
      else paused += 1;
    }
    return {
      title: 'Class writing',
      caption: 'writing',
      done: writing,
      total: online.length,
      segments: [
        { key: 'writing', label: 'Writing now', count: writing, color: 'var(--class-gauge-done)' },
        { key: 'paused', label: 'Paused or away', count: paused, color: 'var(--class-gauge-mid)' },
        { key: 'empty', label: 'Not started', count: online.length - writing - paused, color: 'var(--class-gauge-rest)' },
      ],
    };
  }, [livePulse.activity, livePulse.students, orderedStudents, connectedIdSet, awayByStudentId, activityNow]);

  const writingPulseStudents = useMemo(() => {
    if (!gaugePanelOpen || livePulse.activity) return [];
    return orderedStudents.map((student) => {
      const id = Number(student.id);
      let state = 'offline';
      if (connectedIdSet.has(id)) {
        if (awayByStudentId.get(id)) state = 'away';
        else if (isDraftEmpty(student)) state = 'empty';
        else state = activityStatus(student.updated_at, activityNow) !== 'idle' ? 'writing' : 'paused';
      }
      return {
        id,
        name: student.name,
        words: wordCount(student.text),
        state,
        pasted: !!(alertPrefs.pasted && pasteCounts[id]),
        inbox: studentHasInboxWait(student, pendingHandByStudentId, noteReceiptByStudentId),
      };
    });
  }, [gaugePanelOpen, livePulse.activity, orderedStudents, connectedIdSet, awayByStudentId, activityNow, alertPrefs.pasted, pasteCounts, pendingHandByStudentId, noteReceiptByStudentId]);

  const visibleStudents = useMemo(
    () =>
      [...orderedStudents].sort((a, b) => {
        const aMonitored = monitoredIds.has(Number(a.id)) ? 0 : 1;
        const bMonitored = monitoredIds.has(Number(b.id)) ? 0 : 1;
        if (aMonitored !== bMonitored) return aMonitored - bMonitored;
        if (inboxFocus) {
          const aInbox = studentHasInboxWait(a, pendingHandByStudentId, noteReceiptByStudentId) ? 0 : 1;
          const bInbox = studentHasInboxWait(b, pendingHandByStudentId, noteReceiptByStudentId) ? 0 : 1;
          if (aInbox !== bInbox) return aInbox - bInbox;
        }
        if (attentionFocus) {
          const aAttention = matchesAttention(a, attentionFocus) ? 0 : 1;
          const bAttention = matchesAttention(b, attentionFocus) ? 0 : 1;
          if (aAttention !== bAttention) return aAttention - bAttention;
        }
        return Number(a.id) - Number(b.id);
      }),
    [orderedStudents, monitoredIds, inboxFocus, pendingHandByStudentId, noteReceiptByStudentId, attentionFocus, matchesAttention]
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
      const attention = attentionFocus && matchesAttention(student, attentionFocus) ? 0 : 1;
      const inbox =
        inboxFocus &&
        studentHasInboxWait(student, pendingHandByStudentId, noteReceiptByStudentId)
          ? 0
          : 1;
      return inbox * 100 + monitored * 10 + attention;
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
    inboxFocus,
    pendingHandByStudentId,
    noteReceiptByStudentId,
    matchesAttention,
  ]);

  function startBreakoutsAuto() {
    if (!socket || breakoutBusy || room?.class_wall_active) return;
    setBreakoutBusy(true);
    socket.emit('teacher:breakouts-start', { mode: 'auto' }, (ack) => {
      setBreakoutBusy(false);
      if (!ack?.ok) setError(ack?.error || 'Could not start breakouts');
    });
  }

  function startBreakoutsManual() {
    if (!socket || breakoutBusy || room?.class_wall_active) return;
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
    setAttentionFocus(null);
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
    const y = ft?.yearLevel ?? ft?.year_level ?? room?.teacherYearLevel;
    const yStr = y == null ? '' : String(y).trim();
    if (yStr !== '') return yStr;
    return yearLevel;
  }, [modalOpen, room?.feedback_toggles?.yearLevel, room?.teacherYearLevel, yearLevel]);

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

  const assembledAiPrompt = useMemo(() => {
    return buildAiPrompt({
      feedbackMode: normalizeFeedbackMode(promptModeKey),
      subjectAssist: promptSubjectAssist,
      yearLevel: promptYearLevel,
      customFocusText: promptCustomFocusText,
      toggles: modeToggles[promptModeKey] || {},
      extraFocusLabels: enabledExtraLabels,
      students: visibleStudents,
      wordTarget: room?.word_target ?? 0,
      enforceWordCount: !!room?.enforce_word_count,
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
    room?.enforce_word_count,
  ]);

  const classSummaryPrompt = useMemo(() => {
    if (aiTask !== 'summary') return '';
    return buildClassSummaryPrompt({
      students: visibleStudents,
      yearLevel: promptYearLevel,
      subjectAssist: promptSubjectAssist,
      objective: room?.lesson_objective || '',
    });
  }, [aiTask, visibleStudents, promptYearLevel, promptSubjectAssist, room?.lesson_objective]);

  const aiPayloadStats = useMemo(() => {
    const promptChars = assembledAiPrompt.length;
    const draftChars = visibleStudents.reduce((n, s) => n + (s.text || '').length, 0);
    const totalDraftWords = visibleStudents.reduce((n, s) => n + wordCount(s.text || ''), 0);
    const promptKb = Math.round((promptChars / 1024) * 10) / 10;
    let level = 'ok';
    if (promptChars >= 140_000 || draftChars >= 120_000) level = 'heavy';
    else if (promptChars >= 55_000 || draftChars >= 45_000) level = 'warn';
    return { promptChars, draftChars, totalDraftWords, promptKb, level };
  }, [assembledAiPrompt, visibleStudents]);

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

  useLayoutEffect(() => {
    if (!helpOpen) {
      setHelpDockBox(null);
      return undefined;
    }
    const place = () => {
      const btn = helpButtonRef.current;
      const header = teacherHeaderRef.current;
      if (!btn) return;
      const br = btn.getBoundingClientRect();
      const hr = header?.getBoundingClientRect();
      const width = Math.min(352, window.innerWidth - 20);
      let left = br.right - width;
      left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
      const top = Math.round((hr?.bottom ?? br.bottom));
      setHelpDockBox({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [helpOpen]);

  useEffect(() => {
    if (!toolsPanelOpen && !settingsOpen && !viewOpen && !helpOpen) return undefined;

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
      if (settingsOpen) {
        if (settingsButtonRef.current?.contains(target)) return;
        if (recordsButtonRef.current?.contains(target)) return;
        if (settingsPanelRef.current?.contains(target)) return;
        if (breakoutAssignPanelRef.current?.contains(target)) return;
        // Ask and Share close settings themselves; letting them through keeps one dock
        // handing over to the next instead of closing first and re-opening cold.
        if (target?.closest?.('.iboard-arr-rail__tools, .iboard-arr-rail__add')) return;
        // Native <select> menus are often outside the React tree; don't close while interacting.
        if (target?.closest?.('select') || document.activeElement?.tagName === 'SELECT') return;
      }
      if (viewOpen) {
        if (viewButtonRef.current?.contains(target)) return;
        if (viewPanelRef.current?.contains(target)) return;
      }
      if (helpOpen) {
        if (helpButtonRef.current?.contains(target)) return;
        if (helpPanelRef.current?.contains(target)) return;
      }
      if (toolsPanelOpen) {
        setToolsPanelOpen(false);
        setToolsHighlightStudentId(null);
      }
      if (settingsOpen) closeSettings();
      if (viewOpen) {
        setViewOpen(false);
        setOverviewColsPeek(false);
      }
      if (helpOpen) setHelpOpen(false);
    }

    function closeHeaderPanelsOnEscape(event) {
      if (event.key !== 'Escape') return;
      if (toolsPanelOpen) {
        setToolsPanelOpen(false);
        setToolsHighlightStudentId(null);
      }
      if (settingsOpen) closeSettings();
      if (viewOpen) {
        setViewOpen(false);
        setOverviewColsPeek(false);
      }
      if (helpOpen) setHelpOpen(false);
    }

    document.addEventListener('pointerdown', closeHeaderPanelsIfOutside);
    document.addEventListener('keydown', closeHeaderPanelsOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeHeaderPanelsIfOutside);
      document.removeEventListener('keydown', closeHeaderPanelsOnEscape);
    };
  }, [toolsPanelOpen, settingsOpen, viewOpen, helpOpen]);

  useEffect(() => {
    if (!addCardOpen) return undefined;
    function rollUpComposerOnEscape(event) {
      if (event.key === 'Escape' && !addCardBusy) setAddCardOpen(false);
    }
    document.addEventListener('keydown', rollUpComposerOnEscape);
    return () => document.removeEventListener('keydown', rollUpComposerOnEscape);
  }, [addCardOpen, addCardBusy]);

  useEffect(() => {
    if (!focusedStudentId) return undefined;
    function closeFullDraftOnEscape(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], .iboard-learning-trail')) return;
      setFocusedStudentId(null);
    }
    document.addEventListener('keydown', closeFullDraftOnEscape);
    return () => document.removeEventListener('keydown', closeFullDraftOnEscape);
  }, [focusedStudentId]);

  useEffect(() => {
    if (!addCardOpen) return;
    const titleField = addCardPanelRef.current?.querySelector('input[aria-label="Card title"]');
    titleField?.focus();
  }, [addCardOpen]);

  const railDockKey = toolsPanelOpen
    ? `tools:${toolsTab === 'sets' ? 'sets' : 'ask'}`
    : settingsOpen
      ? `settings:${settingsSection}`
      : '';
  const railDockKeyRef = useRef('');
  useLayoutEffect(() => {
    const previous = railDockKeyRef.current;
    railDockKeyRef.current = railDockKey;
    if (!railDockKey || !previous || previous === railDockKey) return undefined;
    // One rail dock handing over to another: glide from the old position to the new
    // rail button and fade the content in, rather than sliding in from the rail again.
    const panel = railDockKey.startsWith('tools') ? teacherToolsPanelRef.current : settingsPanelRef.current;
    if (!panel) return undefined;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    panel.style.animation = 'none';
    let glideTimer = null;
    if (!reduceMotion) {
      panel.style.transition = 'top 280ms cubic-bezier(0.22, 1, 0.36, 1)';
      void panel.offsetHeight;
      glideTimer = window.setTimeout(() => {
        panel.style.transition = '';
      }, 320);
    }
    for (const child of panel.children) {
      child.animate?.(
        reduceMotion
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translateY(6px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
        { duration: reduceMotion ? 160 : 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
    return () => {
      if (glideTimer !== null) window.clearTimeout(glideTimer);
      panel.style.transition = '';
      panel.style.animation = '';
    };
  }, [railDockKey]);

  useLayoutEffect(() => {
    if (!toolsPanelOpen && !settingsOpen && !viewOpen) return undefined;

    function currentDockAnchor() {
      if (viewOpen) return viewButtonRef.current;
      if (settingsOpen) {
        if (settingsSection === 'records') return recordsButtonRef.current;
        return settingsButtonRef.current;
      }
      if (toolsPanelOpen) {
        const group = toolsTab === 'sets' ? '.iboard-arr-rail__add' : '.iboard-arr-rail__tools';
        return teacherToolsNavRef.current?.querySelector(`${group} [data-active="true"]`);
      }
      return null;
    }

    function currentDockPanel() {
      if (viewOpen) return viewPanelRef.current;
      if (settingsOpen) return settingsPanelRef.current;
      if (toolsPanelOpen) return teacherToolsPanelRef.current;
      return null;
    }

    function alignDockToRailButton() {
      const button = currentDockAnchor();
      const panel = currentDockPanel();
      const visual = window.visualViewport;
      const viewport = visual?.height ?? window.innerHeight;
      const offsetTop = visual?.offsetTop ?? 0;
      const margin = 10;
      if (viewOpen) {
        const headerBottom = button?.closest('.iboard-teacher-header-bar')?.getBoundingClientRect().bottom;
        const nextTop = Math.round(headerBottom ?? (button?.getBoundingClientRect().bottom ?? 0) + margin);
        setTeacherToolsTop((prev) => (Math.abs(prev - nextTop) < 2 ? prev : nextTop));
        setTeacherToolsDockHeight(null);
        return;
      }
      const buttonBox = button?.getBoundingClientRect();
      const setsOpen = Boolean(panel?.querySelector('#sets-subject-filter'));
      const maxHeight = Math.max(220, viewport - margin * 2);
      if (setsOpen) {
        const nextTop = Math.round(Math.max(offsetTop + margin, buttonBox?.top ?? offsetTop + margin));
        setTeacherToolsTop((prev) => (Math.abs(prev - nextTop) < 2 ? prev : nextTop));
        setTeacherToolsDockHeight(null);
        return;
      }
      let desired = settingsOpen ? 560 : toolsTab === 'ask' ? 720 : 480;
      if (toolsTab === 'ask' && panel) {
        const section = panel.querySelector('section');
        if (section) {
          let content = 0;
          for (const child of section.children) {
            if (window.getComputedStyle(child).position === 'absolute') continue;
            content += Math.max(child.scrollHeight, child.offsetHeight);
          }
          if (content > 160) desired = content + 12;
        }
      }
      const dockHeight = Math.min(desired, maxHeight);
      const preferredTop = settingsOpen
        ? (buttonBox?.top ?? offsetTop + margin)
        : (buttonBox ? buttonBox.top + buttonBox.height / 2 - 48 : offsetTop + margin);
      const nextTop = Math.round(Math.max(
        offsetTop + margin,
        Math.min(preferredTop, offsetTop + viewport - dockHeight - margin)
      ));
      setTeacherToolsTop((prev) => (Math.abs(prev - nextTop) < 2 ? prev : nextTop));
      setTeacherToolsDockHeight((prev) => (Math.abs((prev || 0) - dockHeight) < 2 ? prev : dockHeight));
      if (typeof location !== 'undefined' && /[?&]dockdebug=1/.test(location.search) && panel) {
        const body = panel.querySelector('.iboard-room-settings__body') || panel.querySelector('section');
        const rect = panel.getBoundingClientRect();
        console.table({
          innerHeight: window.innerHeight,
          visualHeight: visual?.height,
          dockOffsetHeight: panel.offsetHeight,
          dockScrollHeight: panel.scrollHeight,
          dockRectHeight: rect.height,
          dockTop: rect.top,
          dockBottom: rect.bottom,
          bodyOffsetHeight: body?.offsetHeight,
          bodyScrollHeight: body?.scrollHeight,
          bodyRectHeight: body?.getBoundingClientRect().height,
          inlineHeight: dockHeight,
          inlineTop: nextTop,
        });
      }
    }

    alignDockToRailButton();
    const settleFrame = requestAnimationFrame(alignDockToRailButton);
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(alignDockToRailButton)
      : null;
    const button = currentDockAnchor();
    if (button) resizeObserver?.observe(button);
    window.addEventListener('resize', alignDockToRailButton);
    window.visualViewport?.addEventListener('resize', alignDockToRailButton);
    window.visualViewport?.addEventListener('scroll', alignDockToRailButton);
    return () => {
      cancelAnimationFrame(settleFrame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', alignDockToRailButton);
      window.visualViewport?.removeEventListener('resize', alignDockToRailButton);
      window.visualViewport?.removeEventListener('scroll', alignDockToRailButton);
    };
  }, [toolsPanelOpen, settingsOpen, settingsSection, viewOpen, toolsTab]);

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

  useEffect(() => {
    if (!inboxFocus) return;
    const waiting = orderedStudents.some((student) => (
      studentHasInboxWait(student, pendingHandByStudentId, noteReceiptByStudentId)
    ));
    if (!waiting) setInboxFocus(false);
  }, [inboxFocus, orderedStudents, pendingHandByStudentId, noteReceiptByStudentId]);

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

  const aiPasteParsed = useMemo(() => parseNumberedPaste(pasteBox), [pasteBox]);

  const distributeReady = useMemo(() => {
    if (!aiPasteParsed.length || !visibleStudents.length) return false;
    if (aiPasteParsed.length < visibleStudents.length) return false;
    return visibleStudents.every((_, i) => aiPasteParsed.some((row) => row.index === i + 1));
  }, [aiPasteParsed, visibleStudents]);

  const aiPasteHint = useMemo(() => {
    if (!String(pasteBox || '').trim()) return '';
    if (!aiPasteParsed.length) {
      return 'No numbered items found — ask the AI to redo with 1. 2. 3. …';
    }
    if (visibleStudents.length && aiPasteParsed.length < visibleStudents.length) {
      return `Found ${aiPasteParsed.length} of ${visibleStudents.length} numbered items.`;
    }
    if (!distributeReady) return 'Numbers don’t match the current student list.';
    return '';
  }, [pasteBox, aiPasteParsed, visibleStudents.length, distributeReady]);

  const headerDockStyle = useMemo(
    () => ({
      top: teacherToolsTop,
      ...(teacherToolsDockHeight != null ? { height: teacherToolsDockHeight } : {}),
    }),
    [teacherToolsTop, teacherToolsDockHeight]
  );

  function saveClassSummary() {
    const text = summaryBox.trim();
    if (!text || summarySaving) return;
    setSummarySaving(true);
    socket.timeout(8000).emit(
      'teacher:class-summary-save',
      { text, roster: visibleStudents.map((s) => String(s.name || '')) },
      (err, ack) => {
        setSummarySaving(false);
        if (err || !ack?.ok) {
          setError(ack?.error || 'Could not save the summary.');
          return;
        }
        setSummaryBox('');
        setCopyToast('Summary saved — find it in Reports → AI feedback & summaries');
        setTimeout(() => setCopyToast(''), 3500);
      }
    );
  }

  async function copyForAi() {
    try {
      await copyText(aiTask === 'summary' ? classSummaryPrompt : assembledAiPrompt);
      setCopyToast('Copied prompt');
      setTimeout(() => setCopyToast(''), 2500);
    } catch {
      setCopyToast('Copy failed — select the prompt and copy manually');
      setTimeout(() => setCopyToast(''), 3500);
    }
  }

  function distributePaste() {
    const parsed = parseNumberedPaste(pasteBox);
    if (!parsed.length) {
      setError('Could not parse numbered feedback. The AI must start each item with 1. 2. 3. …');
      return;
    }
    const expected = visibleStudents.length;
    if (expected > 0 && parsed.length < expected) {
      setError(
        `Only found ${parsed.length} of ${expected} numbered items. Ask the AI to redo with 1. through ${expected}.`
      );
      return;
    }
    const items = visibleStudents
      .map((s, i) => {
        const n = i + 1;
        const row = parsed.find((p) => p.index === n);
        return row ? { studentId: s.id, text: row.text, source: 'ai' } : null;
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
        setCopyToast(items.length === 1 ? 'Sent to 1 student' : `Sent to ${items.length} students`);
        setTimeout(() => setCopyToast(''), 2500);
      }
    });
  }

  function openNoteForStudent(student, event) {
    event?.stopPropagation?.();
    const studentId = Number(student.id);
    setNoteTarget({ id: studentId, name: String(student.name || 'Student') });
    if (studentId && (noteReplyByStudentId[studentId] || noteReceiptByStudentId[studentId] === 'replied')) {
      socket.emit('teacher:note-reply-seen', { studentId });
      // The teacher is reading the reply now, so the card icon settles back to neutral.
      setNoteReceiptByStudentId((current) => {
        if (!(studentId in current)) return current;
        const next = { ...current };
        delete next[studentId];
        return next;
      });
    }
  }

  function closeNoteComposer() {
    if (noteTarget?.id) {
      setNoteReplyByStudentId((current) => {
        if (!current[noteTarget.id]) return current;
        const next = { ...current };
        delete next[noteTarget.id];
        return next;
      });
      setNoteReceiptByStudentId((current) => {
        if (current[noteTarget.id] !== 'replied') return current;
        const next = { ...current };
        delete next[noteTarget.id];
        return next;
      });
    }
    setNoteTarget(null);
  }

  function handleTeacherChatSent({ studentId, urgent, name }) {
    setNoteReceiptByStudentId((current) => ({ ...current, [studentId]: 'waiting' }));
      window.dispatchEvent(
        new CustomEvent('iboard:note-send-status', {
        detail: { studentId, status: 'waiting' },
        })
      );
      setNoteReplyByStudentId((current) => {
      if (!current[studentId]) return current;
        const next = { ...current };
      delete next[studentId];
        return next;
      });
    setCopyToast(urgent ? `Urgent message sent to ${name}` : `Message sent to ${name}`);
      setTimeout(() => setCopyToast(''), 2500);
  }

  function shareStudentWriting(student, recipientIds = null) {
    const id = Number(student?.id);
    if (!id) return;
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
        studentIds: [id],
        postIds: [],
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
            setCopyToast(`Shared ${student.name}’s writing with ${audience}`);
        }
        setTimeout(() => setCopyToast(''), 4000);
        }
      }
    );
  }

  function closeAddCard() {
    if (addCardBusy) return;
    setAddCardPickerOpen(false);
    setAddCardOpen(false);
    setAddCardError('');
  }

  function closeSettings() {
    setSettingsOpen(false);
    setClearFixedArmed(false);
    setBreakoutSetupMode('auto');
  }

  function toggleSettings(section = 'settings') {
    if (settingsOpen && settingsSection === section) {
      closeSettings();
      return;
    }
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardOpen(false);
    setViewOpen(false);
    setHelpOpen(false);
    setClearFixedArmed(false);
    setBreakoutSetupMode('auto');
    setHeaderTool(null);
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  function toggleHeaderTool(id) {
    setBreakoutSetupMode('auto');
    if (headerTool === id) {
      setHeaderTool(null);
      return;
    }
    closeSettings();
    setSessionMenuOpen(false);
    setHeaderTool(id);
  }

  function openAddCard({ forceOpen = false } = {}) {
    closeSettings();
    setViewOpen(false);
    setHelpOpen(false);
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    if (!forceOpen && addCardOpen && !teacherPanelHidden) {
      closeAddCard();
      return;
    }
    setTeacherPanelHidden(false);
    setAddCardDragOver(false);
    setAddCardTitle('');
    setAddCardText('');
    setAddCardImage('');
    setAddCardFile(null);
    setAddCardError('');
    setAddCardPickerOpen(false);
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

  function handleAddCardFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) acceptAddCardFile(file);
  }

  function handleAddCardDrop(event) {
    event.preventDefault();
    setAddCardDragOver(false);
    if (addCardBusy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) acceptAddCardFile(file);
  }

  function acceptAddCardFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      setAddCardError('File too large — keep under 5 MB');
      return;
    }
    const name = String(file.name || '').toLowerCase();
    const imageExt = /\.(jpe?g|png|webp)$/.test(name);
    const imageMime = /^image\/(jpeg|jpg|png|webp)$/i.test(file.type || '');
    const pdfExt = /\.pdf$/.test(name);
    const pdfMime = /^application\/pdf$/i.test(file.type || '');
    if (!pdfExt && !pdfMime && !imageExt && !imageMime) {
      setAddCardError('Use a PDF or image (JPG, PNG, WebP) — Word/PowerPoint can’t preview in class');
      return;
    }
    setAddCardImage('');
    setAddCardFile(file);
    if (!addCardTitle.trim() || addCardTitle.trim() === 'Teacher') {
      setAddCardTitle(String(file.name || 'Handout').replace(/\.[^.]+$/, '').slice(0, 80) || 'Handout');
    }
    setAddCardError('');
  }

  function submitTeacherCard(recipientIds = null) {
    const title = String(addCardText || '').trim().split('\n')[0].slice(0, 80) || String(addCardTitle || '').trim() || 'Handout';
    const chosenIds = Array.isArray(recipientIds) ? recipientIds.map(Number).filter((id) => id > 0) : null;
    const recipientOption = chosenIds ? { studentIds: chosenIds } : {};
    const finish = (ack, message) => {
      setAddCardBusy(false);
      if (!ack?.ok) {
        setAddCardError(ack?.error || 'Could not send to inboxes');
        return;
      }
      setAddCardPickerOpen(false);
      setAddCardOpen(false);
      setAddCardTitle('');
      setAddCardText('');
      setAddCardImage('');
      setAddCardFile(null);
      const toastMessage = chosenIds && ack.item && !Array.isArray(ack.item.studentIds)
        ? 'Sent to every student — restart the TUIT server to send files to chosen students only'
        : message;
      setCopyToast(toastMessage);
      setTimeout(() => setCopyToast(''), toastMessage === message ? 2500 : 6000);
    };

    const sentMessage = chosenIds
      ? (chosenIds.length === 1 ? 'Sent to 1 student’s inbox' : `Sent to ${chosenIds.length} students’ inboxes`)
      : 'Sent to students’ inboxes';
    if (chosenIds && !chosenIds.length) {
      setAddCardError('Tick at least one student first');
        return;
      }

    if (addCardFile) {
      setAddCardBusy(true);
      setAddCardError('');
      fileToBase64(addCardFile)
        .then((fileBase64) => {
          socket.emit(
            'teacher:material-send',
            {
              title,
              fileBase64,
              mimeType: addCardFile.type || '',
              originalName: addCardFile.name || 'handout',
              sendToInbox: true,
              placeOnBoard: true,
              ...recipientOption,
            },
            (ack) => finish(ack, sentMessage)
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
      setAddCardError('');
        socket.emit(
          'teacher:material-send',
          {
            title,
            fileBase64: addCardImage,
            mimeType: 'image/jpeg',
            originalName: `${title.replace(/\s+/g, '-').slice(0, 40) || 'handout'}.jpg`,
          sendToInbox: true,
          placeOnBoard: true,
          ...recipientOption,
        },
        (ack) => finish(ack, sentMessage)
      );
      return;
    }

    const text = addCardText.trim();
    if (!text) {
      setAddCardError('Add text or choose a file first');
      return;
    }
    const recipients = orderedStudents
      .filter((student) => !chosenIds || chosenIds.includes(Number(student.id)))
      .map((student) => ({
        studentId: student.id,
        text: text.slice(0, INBOX_NOTE_MAX),
        type: 'resource',
      }));
      if (!recipients.length) {
      setAddCardError(chosenIds ? 'Those students are no longer in this room — nothing was sent' : 'No students have joined yet — nothing was sent');
        return;
      }
    setAddCardBusy(true);
    setAddCardError('');
    const clipped = text.length > INBOX_NOTE_MAX;
    socket.emit('teacher:distribute', { items: recipients }, (ack) => {
      if (ack?.ok) {
        // Keep a copy in the teacher's Resources panel as well as the inboxes.
        socket.emit('teacher:board-post', { kind: 'text', title: 'Teacher note', text: text.slice(0, INBOX_NOTE_MAX) }, () => {});
      }
      finish(
        ack,
        clipped
          ? `${sentMessage} · first ${INBOX_NOTE_MAX.toLocaleString()} characters`
          : sentMessage
      );
    });
  }

  function deleteTeacherCard(postId) {
    socket.emit('teacher:board-post-delete', { postId }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not remove teacher card');
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

  async function saveSessionFile(options = {}) {
    const {
      fromAuto = false,
      label = '',
      successToast = 'Session saved — keep the .iboard file to reopen later',
      silent = false,
      timeoutMs,
    } = options;
    if (!fromAuto) closeSettings();
    if (!joinedRef.current || codeInput.length !== 4) {
      if (!fromAuto) setError('Open a room before saving a session');
      return { ok: false };
    }
    setSessionBusy(true);
    setError('');
    try {
      const ack = await emitAck(socket, 'teacher:session-export', {}, timeoutMs);
      if (!ack?.ok || !ack.pack) {
        throw new Error(ack?.error || 'Could not save session');
      }
      const result = await downloadSessionPack(ack.pack, codeInput, label, { picker: !silent });
      if (result.method === 'cancelled') {
        setCopyToast(fromAuto ? 'Save cancelled — learning trail still live until you save' : 'Save cancelled');
        setTimeout(() => setCopyToast(''), 3500);
        return { ok: false, cancelled: true };
      }
      clearSessionDirty();
      setCopyToast(successToast);
      setTimeout(() => setCopyToast(''), 3500);
      return { ok: true };
    } catch (e) {
      setError(e?.message || 'Could not save session');
      return { ok: false };
    } finally {
      setSessionBusy(false);
    }
  }

  async function openSessionFilePicker() {
    closeSettings();
    if (!joinedRef.current || codeInput.length !== 4) {
      setError('Open a room before loading a session');
      return;
    }
    if (sessionDirtyRef.current) {
      const ok = await confirmDialog({
        title: 'Replace the live board?',
        message:
          'Loading a session replaces the live board in this room (cards, responses, Pulse, notes).\n\nUnsaved changes on the board will be lost.',
        confirmLabel: 'Load session',
        tone: 'danger',
      });
      if (!ok) return;
    } else {
      const ok = await confirmDialog({
        title: 'Load a saved session?',
        message:
          'This replaces the live board (cards, responses, Pulse, notes) with the file contents.',
        confirmLabel: 'Load session',
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

  function downloadEvidenceHtml({ label, students: packStudents, objective } = {}) {
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
      objective: objective || room?.lesson_objective || '',
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

  function quickSnapshotWriting() {
    const packStudents = visibleStudents.length ? visibleStudents : orderedStudents;
    if (!packStudents.length) {
      setError('No student work to snapshot yet.');
      return;
    }
    if (evidenceBusy) return;
    const now = new Date();
    const label = `Room ${codeInput} · ${now.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
    setEvidenceBusy(true);
    setError('');
    socket.emit('teacher:snapshot-save', { label }, (ack) => {
      setEvidenceBusy(false);
      if (!ack?.ok) {
        setError(ack?.error || 'Could not save snapshot.');
        return;
      }
      setSnapshots(ack.snapshots || []);
      setCopyToast('Snapshot saved — find it in Reports');
      setTimeout(() => setCopyToast(''), 3000);
    });
  }

  async function copyStudentText(student) {
    const text = String(student?.text || '');
    if (!text.trim()) return;

    try {
      await copyText(text);
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
        objective: data.payload?.lesson_objective || '',
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
      await copyText(text);
      setCopyToast(`Copied ${selectedEvidenceStudent.name}’s evidence`);
    } catch {
      setCopyToast('Copy failed — download the portfolio instead');
    }
    setTimeout(() => setCopyToast(''), 3000);
  }

  async function downloadStudentPortfolio() {
    if (!selectedEvidenceStudent || portfolioDownloadKind) return;
    setPortfolioDownloadKind('one');
    setError('');
    try {
      const { downloadPortfolioPdf } = await import('../lib/portfolioPdf.js');
      await downloadPortfolioPdf({ roomCode: codeInput, student: selectedEvidenceStudent });
      setCopyToast(`Downloaded ${selectedEvidenceStudent.name}’s portfolio PDF`);
    setTimeout(() => setCopyToast(''), 3000);
    } catch (e) {
      setError(e?.message || 'Could not download that portfolio');
    } finally {
      setPortfolioDownloadKind('');
    }
  }

  async function downloadAllPortfolioPdfs() {
    if (!evidenceStudents.length || portfolioDownloadKind) return;
    setPortfolioDownloadKind('all');
    setError('');
    try {
      const { downloadPortfolioZip } = await import('../lib/portfolioPdf.js');
      const result = await downloadPortfolioZip({ roomCode: codeInput, students: evidenceStudents });
      setCopyToast(`Downloaded ${result.count} portfolio PDF${result.count === 1 ? '' : 's'} as a zip`);
      setTimeout(() => setCopyToast(''), 4000);
    } catch (e) {
      setError(e?.message || 'Could not download class portfolios');
    } finally {
      setPortfolioDownloadKind('');
    }
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
      await copyText(studentJoinUrl());
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

  function setIndependentWriting(active) {
    socket.emit('teacher:independent', { active }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not change independent writing');
        return;
      }
      markSaved();
      setRoom((current) => (current
        ? { ...current, draftTrail: { ...(current.draftTrail || {}), independentSince: Number(ack.independentSince) || 0 } }
        : current));
      setCopyToast(active ? 'Independent writing on. The start time is on the Learning trail.' : 'Independent writing ended');
      setTimeout(() => setCopyToast(''), 3000);
    });
  }

  async function endIndependentWriting() {
    const ok = await confirmDialog({
      title: 'End independent writing?',
      message: `Started at ${clockTime(independentSince)}. The end time goes on the Learning trail.`,
      confirmLabel: 'End independent writing',
      tone: 'brand',
    });
    if (ok) setIndependentWriting(false);
  }

  function setLessonObjective(text) {
    const clean = String(text || '').trim();
    rememberObjective(clean);
    setRoom((current) => (current ? { ...current, lesson_objective: clean } : current));
    pushSettings({ lesson_objective: clean });
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

  async function startNewClass() {
    if (newClassBusy) return;
    setNewClassBusy(true);
    setNewClassStep('Saving a backup…');
    setError('');
    try {
      if (room?.draftTrail?.active && socket) {
        await new Promise((resolve) => {
          socket.timeout(10000).emit('teacher:draft-trail-control', { active: false, label: '' }, (err, ack) => {
            if (!err && ack?.ok) {
              setRoom((prev) => ({ ...prev, draftTrail: ack.status }));
            }
            resolve();
          });
        });
      }
      await saveSessionFile({
        fromAuto: true,
        label: 'before-reset',
        successToast: 'Session saved before reset — keep the .iboard file',
        silent: true,
        timeoutMs: 30_000,
      });
    } catch {
      // Still reset; teacher can recover from an earlier save if this one failed.
    }
    setNewClassStep('Clearing the board…');
    socket.timeout(20_000).emit('teacher:start-new-class', {}, (err, ack) => {
      setNewClassBusy(false);
      setNewClassStep('');
      if (err || !ack?.ok) {
        setError(err ? 'The server didn’t answer — check the connection and try Reset again.' : ack?.error || 'Could not clear cards');
        return;
      }
      setStudents([]);
      setPosts([]);
      setFixedCommentCount(0);
      setClearFixedArmed(false);
      setToolsPanelOpen(false);
      setLibraryPanel(null);
      setLibraryView('home');
      setNewClassConfirmOpen(false);
      clearSessionDirty();
      forgetLessonBegun();
      setLessonBegun(false);
      setEntranceStep('join');
      setCopyToast('Board reset — ready for a fresh lesson');
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
                  if (e.key === 'Enter' && codeInput.length === 4) createOrJoin(undefined, { showJoinScreen: true });
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
              onClick={() => createOrJoin(undefined, { showJoinScreen: true })}
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
                    await copyText(studentJoinUrl());
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
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <button
                type="button"
                onClick={() => createOrJoin(undefined, { skipJoinScreen: true })}
                disabled={codeInput.length !== 4}
                className="font-medium text-slate-600 underline-offset-2 hover:text-indigo-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline dark:text-slate-300"
              >
                Go straight to room
              </button>
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

  function toggleFreeze() {
    const next = !frozen;
    setRoom((r) => (r ? { ...r, freeze_class: next } : r));
    pushSettings({ freeze_class: next });
  }

  function openGaugePanel() {
    closeSettings();
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setViewOpen(false);
    setHelpOpen(false);
    setHeaderTool(null);
    setSessionMenuOpen(false);
    setMoreMenuOpen(false);
    setGaugePanelOpen(true);
  }

  function openTeacherTools(tab = 'ask', { highlightStudentId = null } = {}) {
    if (tab === 'responses') {
      openGaugePanel();
      return;
    }
    setGaugePanelOpen(false);
    closeSettings();
    setAddCardOpen(false);
    setViewOpen(false);
    setHelpOpen(false);
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
    setLibraryPanel('evidence');
    setLibraryView('participation');
  }

  function openAiFeedback() {
    openLibrary('feedback');
  }

  function openLibrary(panel, evidenceTab = 'lessons') {
    closeSettings();
    setToolsPanelOpen(false);
    setToolsHighlightStudentId(null);
    setAddCardOpen(false);
    setViewOpen(false);
    setHelpOpen(false);
    setLibraryPanel('evidence');
    if (panel === 'reports' || (panel === 'evidence' && evidenceTab === 'students')) {
      setLibraryView('portfolios');
      setSnapshotsOpen(true);
      return;
    }
    if (panel === 'feedback') {
      setLibraryView('feedback');
      setSnapshotsOpen(true);
      return;
    }
    setLibraryView('home');
    setSnapshotsOpen(true);
  }

  function closeLibraryHub() {
    setLibraryPanel(null);
    setLibraryView('home');
  }

  function goLibraryHome() {
    setLibraryView((view) => (view === 'pdf' ? 'drafting' : 'home'));
  }

  function openFeedbackSent() {
    setLibraryView('feedback-sent');
    setAiFeedbackLog(null);
    setAiFeedbackLogError('');
    socket.emit('teacher:ai-feedback-log', {}, (ack) => {
      setAiSummaries(ack?.ok && Array.isArray(ack.summaries) ? ack.summaries : []);
      if (ack?.ok && Array.isArray(ack.items)) setAiFeedbackLog(ack.items);
      else {
        setAiFeedbackLog([]);
        setAiFeedbackLogError(ack?.error || 'Could not load sent feedback');
      }
    });
  }

  async function downloadLessonReportQuick() {
    closeSettings();
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(codeInput)}/lesson-report`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not build report');
      downloadLessonReportHtml(data);
      setCopyToast('Participation report downloaded');
      setTimeout(() => setCopyToast(''), 2500);
    } catch (e) {
      setError(e.message || 'Could not download participation report');
    }
  }

  const focusedStudent = orderedStudents.find((student) => student.id === focusedStudentId) || null;
  const focusedPost = posts.find((post) => Number(post.id) === Number(focusedPostId)) || null;
  // Overview: fixed column density (6/5/4/3). Reading / Full: wider reading columns.
  const fitLayout = cardView === 'all'
    ? fitGrid({ count: orderedStudents.length, width: boardBox.width, height: boardBox.height, gap: 12 })
    : null;
  const studentGridClass =
    cardView === 'all'
      ? 'iboard-student-grid--fit'
      : cardView === 'overview'
      ? `iboard-student-grid--overview ${OVERVIEW_GRID_CLASS[overviewColumns] || OVERVIEW_GRID_CLASS[OVERVIEW_COLUMNS_DEFAULT]}`
      : cardView === 'reading'
        ? 'grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))]'
        : 'grid-cols-[repeat(auto-fit,minmax(min(100%,30rem),1fr))]';
  // Student board only — teacher strip cards stay compact regardless of Overview/Reading/Full.
  const studentWritingPaneClass =
    cardView === 'all'
      ? 'iboard-student-card__fit-pane'
      : cardView === 'overview'
      ? 'min-h-0 flex-1 overflow-y-auto overflow-x-visible'
      : cardView === 'reading'
        ? 'min-h-[22rem] max-h-[32rem] overflow-y-auto overflow-x-visible'
        : 'overflow-visible';
  const teacherWritingPaneClass = 'max-h-52 overflow-y-auto overflow-x-visible';

  const monitoredCount = monitoredIds.size;
  const attentionPills = [
    { id: 'away', label: `${attentionCounts.away} away` },
    { id: 'notStarted', label: `${attentionCounts.notStarted} not started` },
    { id: 'noTyping', label: `${attentionCounts.noTyping} no typing` },
    { id: 'pasted', label: `${attentionCounts.pasted} pasted` },
  ].filter((pill) => alertPrefs[pill.id] !== false);
  const messageWaitCount = orderedStudents.reduce(
    (n, student) => n + (studentHasInboxWait(student, pendingHandByStudentId, noteReceiptByStudentId) ? 1 : 0),
    0
  );
  const inboxSummary = messageWaitCount > 0
    ? `${messageWaitCount} message${messageWaitCount === 1 ? '' : 's'} waiting`
    : '';
  const inboxNames = messageWaitCount > 0
    ? orderedStudents
      .filter((student) => studentHasInboxWait(student, pendingHandByStudentId, noteReceiptByStudentId))
      .map((student) => student.name || 'Unnamed')
    : [];
  const attentionHint = (names, on, title = '') => (
    <span className="block min-w-[9rem]">
      <span className="block whitespace-nowrap bg-[#3c3f8f] px-2.5 py-1 text-[9px] font-semibold text-white dark:bg-[#5a5fc3]">
        {title ? <b className="mr-1 font-extrabold">{title} ·</b> : null}
        {on ? 'Click to show all cards' : 'Click to bring to the top'}
      </span>
      <span className="block px-2.5 py-1.5 text-[#5a5fc3] dark:text-indigo-200">
        {names.slice(0, 8).map((name, n) => (
          <span key={`${name}-${n}`} className="block truncate">{name}</span>
        ))}
        {names.length > 8 ? <span className="block font-semibold opacity-70">and {names.length - 8} more</span> : null}
      </span>
    </span>
  );
  const breakoutControls = (
    <>
      {breakoutsActive ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={breakoutBusy}
                      onClick={startBreakoutsAuto}
                      className="iboard-room-settings__secondary"
                    >
                      Shuffle students
            </button>
                    <button
                      type="button"
                      disabled={breakoutBusy}
                      onClick={endBreakouts}
                      className="iboard-room-settings__secondary"
                    >
                      Close rooms
            </button>
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
                      <HintWrap hint={room?.class_wall_active ? 'Close class wall first' : "Student writing cards appear on group members' screens"} className="w-full">
            <button
              type="button"
                          disabled={breakoutBusy || !students.length || !!room?.class_wall_active}
                          onClick={startBreakoutsAuto}
                          className="iboard-room-settings__primary w-full"
                        >
                          Start breakouts
            </button>
                      </HintWrap>
                    ) : null}
                  </div>
                )}
    </>
  );
  const breakoutAssignContent = (
    <>
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
                !!room?.class_wall_active ||
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
                        <HintWrap hint="Unassigned" prefer="above">
                          <button
                            type="button"
                            aria-pressed={selected === ''}
                            className="iboard-breakout-assign__chip"
                            onClick={() => setDraftBreakoutRoom(student.id, '')}
                            title=""
                          >
                            —
              </button>
                        </HintWrap>
                        {Array.from({ length: roomCount }, (_, index) => {
                          const id = String(index + 1);
                          const selectedHere = selected === id;
                          const full =
                            !selectedHere && countDraftInRoom(id, student.id) >= MAX_BREAKOUT_ROOM;
                          return (
                            <HintWrap
                              key={id}
                              hint={full ? `Room ${id} is full (max ${MAX_BREAKOUT_ROOM})` : `Room ${id}`}
                              prefer="above"
                            >
              <button
                                type="button"
                                aria-pressed={selectedHere}
                                disabled={full}
                                title=""
                                className="iboard-breakout-assign__chip"
                                onClick={() => setDraftBreakoutRoom(student.id, id)}
                              >
                                {id}
              </button>
                            </HintWrap>
                          );
                        })}
            </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
    </>
  );
  const timerControls = !room?.timer?.active ? (
    <div className="iboard-room-settings__field-row">
      <span className="iboard-room-settings__timer-label">Minutes</span>
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
    <div className="space-y-3">
      <div className="iboard-room-settings__timer-head">
        <span>Running</span>
        <RoomTimerPill timer={room?.timer} onFinishedClick={() => controlRoomTimer('end')} />
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
  );
  const classWallControls = (
    <div className="space-y-2.5">
      {room?.class_wall_active ? (
        <button
          type="button"
          onClick={() => {
            setRoom((r) => (r ? { ...r, class_wall_active: false } : r));
            pushSettings({ class_wall_active: false });
          }}
          className="iboard-room-settings__secondary w-full"
        >
          Close class wall
        </button>
      ) : (
        <HintWrap hint={breakoutsActive ? 'Close breakouts first' : 'Students see each other’s writing as equal cards'} className="w-full">
          <button
            type="button"
            disabled={breakoutsActive}
            onClick={() => {
              setRoom((r) => (r ? { ...r, class_wall_active: true } : r));
              pushSettings({ class_wall_active: true });
            }}
            className="iboard-room-settings__primary w-full"
          >
            Start class wall
          </button>
        </HintWrap>
      )}
      <label className="flex cursor-pointer items-center justify-between gap-3 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        <HintWrap hint="Peers see Classmate instead of names">Hide names</HintWrap>
        <input
          type="checkbox"
          checked={!!room?.class_wall_hide_names}
          onChange={(e) => {
            const v = e.target.checked;
            setRoom((r) => (r ? { ...r, class_wall_hide_names: v } : r));
            pushSettings({ class_wall_hide_names: v });
          }}
          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
        />
      </label>
    </div>
  );
  const wordLimitControls = (
    <div className="iboard-word-target-row">
      <div className="iboard-word-target-bar flex items-center gap-2">
        <span className="w-8 shrink-0 text-right font-mono text-[0.72rem] font-bold tabular-nums text-[#5a5fc3] dark:text-indigo-300">{wt}</span>
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
          aria-label="Word limit"
        />
        <HintWrap hint="Students cannot type past the word limit" className="shrink-0">
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
        </HintWrap>
      </div>
    </div>
  );
  const headerDockOpen = toolsPanelOpen || settingsOpen || viewOpen || helpOpen;
  const settingsTitle = settingsSection === 'records' ? 'Reports' : 'Settings';
  const aiFeedbackOpen = !!libraryPanel && libraryView === 'feedback';
  const reportsOpen = !!libraryPanel && libraryView !== 'feedback';

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
            <div className="iboard-brand iboard-brand--stacked shrink-0" aria-label="TUIT">
              <img src="/brand/tuit-mark.png?v=2" alt="" className="iboard-brand-mark" />
              <span className="iboard-brand-word" aria-hidden="true">TUIT</span>
            </div>
          </div>
          <div className="iboard-teacher-header-gutter" aria-hidden="true" />
          <div className="iboard-teacher-header-main iboard-teacher-header-main--command">
            <div className="iboard-header-meta flex min-w-0 items-center gap-2.5">
              <span className="iboard-header-vrule" aria-hidden="true" />
              <HintWrap hint="Show how students join, full screen" prefer="below">
                <button
                  type="button"
                  className="iboard-header-room iboard-header-room--stacked"
                  onClick={openJoinScreen}
                  aria-label={`Room ${codeInput}. Show the join screen`}
                >
                  <span className="iboard-header-room__label" aria-hidden="true">Room</span>
                  <span className="iboard-header-code">{codeInput}</span>
                </button>
              </HintWrap>
              <span className="iboard-header-vrule" aria-hidden="true" />
              {socketConnected && monitoredCount > 0 ? (
                <div className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg bg-[#5a5fc3] px-2 pl-2.5 text-white shadow-sm">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 opacity-90" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                  <span className="truncate text-[11px] font-black">Monitoring · {monitoredCount}</span>
                  <HintWrap hint="Clear monitor list" prefer="below">
                    <button
                      type="button"
                      onClick={clearMonitoredStudents}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-white/80 hover:bg-white/15 hover:text-white"
                      aria-label="Clear monitor list"
                      title=""
                    >
                      ×
                    </button>
                  </HintWrap>
                </div>
              ) : null}
            </div>

            <div className="iboard-command-bar">
              <div className="iboard-command-frame" aria-hidden="true">
                <svg viewBox="-70 -52 140 104">
                  <path className="iboard-command-frame__fill" d="M67.78 -25.5 A56 56 0 0 1 31.97 -38.44 A50 50 0 0 0 -31.97 -38.44 A56 56 0 0 1 -67.78 -25.5 L-67.78 25.5 A56 56 0 0 1 -31.97 38.44 A50 50 0 0 0 31.97 38.44 A56 56 0 0 1 67.78 25.5 Z" />
                  <path className="iboard-command-frame__line" d="M67.78 -25.5 A56 56 0 0 1 31.97 -38.44 A50 50 0 0 0 -31.97 -38.44 A56 56 0 0 1 -67.78 -25.5 M-67.78 25.5 A56 56 0 0 1 -31.97 38.44 A50 50 0 0 0 31.97 38.44 A56 56 0 0 1 67.78 25.5" />
                </svg>
              </div>
              <div className="iboard-command-bar__side iboard-command-bar__side--monitor">
                <span className="iboard-command-bar__title">Monitor class</span>
                <div className="iboard-attention-home" role="group" aria-label="Needs a look">
                    {attentionPills.map((pill) => {
                      const on = attentionFocus === pill.id;
                      const count = attentionCounts[pill.id] || 0;
                      return (
                        <HintWrap
                          key={pill.id}
                          hint={count ? attentionHint(attentionNames[pill.id], on, pill.label) : pill.label}
                          prefer="below"
                          tone={count ? 'card' : 'brand'}
                        >
                          <button
                            type="button"
                            onClick={() => { if (count) setAttentionFocus(on ? null : pill.id); }}
                            className={`iboard-alert-chip${count ? ' has-count' : ''}${on ? ' is-on' : ''}`}
                            title=""
                            aria-disabled={!count}
                            aria-pressed={on}
                            aria-label={pill.label}
                          >
                            <AlertIcon id={pill.id} />
                            <span className="tabular-nums">{count}</span>
                          </button>
                        </HintWrap>
                      );
                    })}
                  <span className="iboard-command-bar__divider" aria-hidden="true" />
                  <HintWrap
                    hint={messageWaitCount ? attentionHint(inboxNames, inboxFocus, inboxSummary) : 'No messages waiting'}
                    prefer="below"
                    tone={messageWaitCount ? 'card' : 'brand'}
                  >
                      <button
                        type="button"
                        onClick={() => {
                          if (!messageWaitCount) return;
                          setInboxFocus((on) => {
                            const next = !on;
                            if (next) {
                              window.requestAnimationFrame(() => {
                                document.querySelector('[data-inbox-waiting="true"]')
                                  ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                              });
                            }
                            return next;
                          });
                        }}
                        className={`iboard-alert-chip${messageWaitCount ? ' has-count' : ''}${inboxFocus ? ' is-on' : ''}`}
                        title=""
                        aria-disabled={!messageWaitCount}
                        aria-pressed={inboxFocus}
                        aria-label={inboxSummary || 'No messages waiting'}
                      >
                        <AlertIcon id="messages" />
                        <span className="tabular-nums">{messageWaitCount}</span>
                      </button>
                  </HintWrap>
                </div>
              </div>
              <div ref={gaugeSlotRef} className="iboard-command-bar__gauge">
                <ClassGauge
                  title={classGauge.title}
                  caption={classGauge.caption}
                  done={classGauge.done}
                  total={classGauge.total}
                  online={connectedStudents.length}
                  segments={classGauge.segments}
                  onClick={() => (gaugePanelOpen ? setGaugePanelOpen(false) : openGaugePanel())}
                  expanded={gaugePanelOpen}
                  opens={livePulse.activity ? 'responses' : 'class writing'}
                />
              </div>
              <div className="iboard-command-bar__side iboard-command-bar__side--manage">
                <span className="iboard-command-bar__title">Manage class</span>
                <div className="iboard-manage-tools" role="group" aria-label="Manage class">
                  <div className="relative" data-header-tool="timer">
                  <HintWrap hint={room?.timer?.active ? 'Timer running. Open to pause, add time or end' : 'Class timer'} prefer="below" suppressed={headerTool === 'timer'}>
                    <button
                      type="button"
                      onClick={() => toggleHeaderTool('timer')}
                      aria-expanded={headerTool === 'timer'}
                      data-active={headerTool === 'timer' || timerIsCounting(room?.timer) ? 'true' : 'false'}
                      className="iboard-header-icon-button flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white"
                      aria-label="Timer"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="13.5" r="7.5" />
                        <path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6" />
                      </svg>
                    </button>
                  </HintWrap>
                  {headerTool === 'timer' ? (
                    <div className="iboard-room-settings iboard-tool-popover" role="dialog" aria-label="Timer">
                      <div className="iboard-tool-popover__head">
                        <h2>Timer</h2>
                        <span>Shows on the teacher and student boards</span>
                      </div>
                      <div className="iboard-tool-popover__body">{timerControls}</div>
                    </div>
                  ) : null}
                  </div>
                  <div className="relative" data-header-tool="words">
                  <HintWrap hint={wt ? `Word limit: ${wt}${enforceWords ? ', enforced' : ''}` : 'Word limit'} prefer="below" suppressed={headerTool === 'words'}>
                    <button
                      type="button"
                      onClick={() => toggleHeaderTool('words')}
                      aria-expanded={headerTool === 'words'}
                      data-active={headerTool === 'words' || (wt > 0 && enforceWords) ? 'true' : 'false'}
                      className="iboard-header-icon-button flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white"
                      aria-label="Word limit"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 6h16M4 11h16M4 16h9" />
                        <path d="M17 14v6M15 18l2 2 2-2" />
                      </svg>
                    </button>
                  </HintWrap>
                  {headerTool === 'words' ? (
                    <div className="iboard-room-settings iboard-tool-popover" role="dialog" aria-label="Word limit">
                      <div className="iboard-tool-popover__head">
                        <h2>Word limit</h2>
                        <span>Tick Enforce to stop students typing past it</span>
                      </div>
                      <div className="iboard-tool-popover__body">{wordLimitControls}</div>
                    </div>
                  ) : null}
                  </div>
                  <div className="relative" data-header-tool="breakouts">
                  <HintWrap hint={breakoutsActive ? 'Breakouts are running. Open to shuffle or close rooms' : room?.class_wall_active ? 'Class wall is on. Open to close it' : 'Breakout rooms and class wall'} prefer="below" suppressed={breakoutsMenuOpen}>
                    <button
                      type="button"
                      onClick={() => toggleHeaderTool('breakouts')}
                      aria-expanded={breakoutsMenuOpen}
                      data-active={breakoutsActive || room?.class_wall_active || breakoutsMenuOpen ? 'true' : 'false'}
                      className={`iboard-header-icon-button flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white${helpFlash === 'breakouts' ? ' is-help-flash' : ''}`}
                      aria-label="Breakout rooms and class wall"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
                        <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
                        <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
                        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
                      </svg>
                    </button>
                  </HintWrap>
                  {breakoutsMenuOpen ? (
                    <div className="iboard-room-settings iboard-tool-popover" role="dialog" aria-label="Breakout rooms and class wall">
                      <div className="iboard-tool-popover__head">
                        <h2>Breakouts</h2>
                        <span>{breakoutsActive ? 'Running' : 'Student writing cards appear on group members’ screens'}</span>
                      </div>
                      <div className="iboard-tool-popover__body" data-help-target="breakouts">{breakoutControls}</div>
                      {!breakoutsActive && breakoutSetupMode === 'manual' ? (
                        <div className="iboard-breakout-assign iboard-breakout-assign--inline" aria-label="Assign breakout rooms">
                          {breakoutAssignContent}
                        </div>
                      ) : null}
                      <div className="iboard-tool-popover__section">
                        <h3>Class wall</h3>
                        <span>Every student sees the class writing as equal cards</span>
                      </div>
                      <div className="iboard-tool-popover__body">{classWallControls}</div>
                    </div>
                  ) : null}
                  </div>
                  <div ref={sessionMenuRef} className="relative">
                    <HintWrap hint="Save or load a lesson" prefer="below" suppressed={sessionMenuOpen}>
                    <button
                      type="button"
                        data-help-target="session"
                        onClick={() => setSessionMenuOpen((open) => !open)}
                        aria-expanded={sessionMenuOpen}
                        data-active={sessionMenuOpen ? 'true' : 'false'}
                        className={`iboard-header-icon-button flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white${helpFlash === 'session' ? ' is-help-flash' : ''}`}
                        aria-label="Save or open a lesson"
                      >
                        <span className={`iboard-header-icon iboard-header-icon--save${joined && saveStatus === 'saved' ? ' is-saved' : ''}`} aria-hidden="true" />
                    </button>
                  </HintWrap>
                    <span
                      aria-hidden="true"
                      className={`iboard-header-saved-label${joined && saveStatus === 'saved' ? ' is-on' : ''}`}
                    >
                      Saved
                    </span>
                    {sessionMenuOpen && (
                      <div className="absolute left-0 top-full z-50 mt-1.5 flex w-64 flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        <HintWrap hint="Downloads this lesson so you can open it again later" prefer="side" className="w-full">
                <button
                  type="button"
                            disabled={sessionBusy}
                  onClick={() => {
                              setSessionMenuOpen(false);
                              void saveSessionFile();
                  }}
                            className="w-full rounded-lg bg-[#5a5fc3] px-3 py-2 text-left text-sm font-semibold text-white hover:bg-[#4b50b0] disabled:opacity-50"
                >
                            {sessionBusy ? 'Saving lesson…' : 'Save lesson to a file'}
                </button>
                        </HintWrap>
                        <HintWrap hint="Open a lesson you saved earlier" prefer="side" className="w-full">
                          <button
                            type="button"
                            disabled={sessionBusy}
                            onClick={() => {
                              setSessionMenuOpen(false);
                              void openSessionFilePicker();
                            }}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            {sessionBusy ? 'Opening…' : 'Open a saved lesson'}
                </button>
                        </HintWrap>
                        <HintWrap hint="Keeps a copy of every student’s writing right now. Find it later in Reports." prefer="side" className="w-full" multiline>
                          <button
                            type="button"
                            disabled={evidenceBusy || !(visibleStudents.length ? visibleStudents : orderedStudents).length}
                            onClick={() => {
                              setSessionMenuOpen(false);
                              quickSnapshotWriting();
                            }}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            {evidenceBusy ? 'Saving snapshot…' : 'Save a snapshot of everyone’s writing'}
                          </button>
                        </HintWrap>
              </div>
            )}
                  </div>
                  <HintWrap hint="Present mode: keeps the question panel on top while you show other windows" prefer="below" multiline>
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new Event("iboard:open-presenter-dock"))}
                      className="iboard-header-icon-button flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white"
                      aria-label="Present mode"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="12" rx="2" />
                        <path d="M12 16v4M8 20h8" />
                      </svg>
                    </button>
                  </HintWrap>
                  <HintWrap hint={frozen ? "Board is frozen. Click to let students write again" : "Freeze board: stops student writing"} prefer="below">
                    <button
                      type="button"
                      data-help-target="freeze"
                      onClick={toggleFreeze}
                      aria-pressed={frozen}
                      data-active={frozen ? "true" : "false"}
                      className={`iboard-header-icon-button iboard-manage-tools__freeze flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white${frozen ? " is-frozen" : ""}${helpFlash === 'freeze' ? ' is-help-flash' : ''}`}
                      aria-label={frozen ? "Unfreeze board" : "Freeze board"}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
                        <path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" />
                      </svg>
                    </button>
                  </HintWrap>
                </div>
              </div>
            </div>

            <div className="iboard-header-actions flex shrink-0 items-center justify-end gap-1.5">
            {joined && saveStatus === 'error' ? <SaveStatusChip status="error" plain /> : null}
            <RoomTimerPill
              timer={room?.timer}
              onClick={openTimerDock}
              onFinishedClick={() => controlRoomTimer('end')}
            />
            {independentSince ? (
              <HintWrap hint="Feedback asks before sending while this is on. Click to end." prefer="below" multiline>
                <button
                  type="button"
                  onClick={endIndependentWriting}
                  className="rounded-full border border-[#5a5fc3]/30 bg-[#ebeaf8] px-2.5 py-0.5 text-[11px] font-semibold text-[#3c3f8f] transition hover:border-[#5a5fc3] dark:border-[#818cf8]/40 dark:bg-[rgba(90,95,195,0.22)] dark:text-[#c7d2fe]"
                  aria-label={`Independent writing since ${clockTime(independentSince)}. End it`}
                >
                  Independent writing · {clockTime(independentSince)}
                </button>
              </HintWrap>
            ) : null}
            {room?.draftTrail?.reason ? (
              <HintWrap hint={room.draftTrail.reason} multiline>
                <span role="status" className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                  Learning trail paused
                </span>
              </HintWrap>
            ) : null}
            <span className="iboard-header-vrule" aria-hidden="true" />
            <div ref={(node) => { tourHeaderToolsRef.current = node; moreMenuRef.current = node; }} className="relative flex items-center">
            <HintWrap hint="Card view, full screen and help" prefer="below" suppressed={moreMenuOpen || viewOpen || helpOpen}>
              <button
                ref={(node) => { viewButtonRef.current = node; helpButtonRef.current = node; }}
                type="button"
                onClick={() => setMoreMenuOpen((open) => !open)}
                aria-expanded={moreMenuOpen}
                aria-haspopup="menu"
                data-active={moreMenuOpen || viewOpen || helpOpen ? 'true' : 'false'}
                className="iboard-header-icon-button iboard-more-button flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl transition dark:text-slate-300 dark:hover:bg-[#5a5fc3] dark:hover:text-white"
                aria-label="More: card view, full screen and help"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
                </svg>
              </button>
            </HintWrap>
            {moreMenuOpen ? (
              <div className="iboard-more-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); openViewDock(); }}>
                  <span className="iboard-header-icon iboard-header-icon--view" aria-hidden="true" />
                  Card view
                </button>
                <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); void toggleBrowserFullscreen(); }}>
                  <span className="iboard-header-icon iboard-header-icon--fullscreen" aria-hidden="true" />
                  {browserFullscreen ? 'Exit full screen' : 'Full screen'}
                </button>
                <button type="button" role="menuitem" onClick={() => { setMoreMenuOpen(false); openHelpDock(); }}>
                  <span className="iboard-header-icon iboard-header-icon--help" aria-hidden="true" />
                  How to use TUIT
                </button>
              </div>
            ) : null}
            </div>
          </div>
          </div>

        </div>
      </header>
      <TeacherHelpPanel
        open={helpOpen}
        onClose={closeHelpDock}
        panelRef={helpPanelRef}
        onAction={handleHelpAction}
        style={
          helpDockBox
            ? { top: helpDockBox.top, left: helpDockBox.left, width: helpDockBox.width }
            : { top: -9999, left: -9999, visibility: 'hidden' }
        }
      />
      </div>
      {copyToast
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="iboard-header-whisper iboard-header-whisper--float pointer-events-none"
              title={copyToast}
            >
              {copyToast}
            </div>,
            document.body
          )
        : null}
      {learningTrailId != null && (
        <LearningTrailView
          socket={socket}
          studentId={learningTrailId}
          onClose={() => setLearningTrailId(null)}
          onOpenDrafts={(id) => {
            setLearningTrailId(null);
            setDraftTrailFocusId(id);
            setDraftTrailOpen(true);
          }}
        />
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
      {sessionPdfOpen ? (
        <SessionPdfExport socket={socket} onClose={() => setSessionPdfOpen(false)} />
      ) : null}
      {insightsOpen ? <ClassInsightsPanel socket={socket} onClose={closeInsights} /> : null}

      {toolsPanelOpen && createPortal(
        <div
          ref={teacherToolsPanelRef}
          className={`iboard-header-dock iboard-header-dock--start iboard-header-dock--rail iboard-header-dock--from-rail z-[60] ${toolsTab === 'sets' ? 'w-[min(27rem,calc(100vw-4.75rem))]' : 'w-[min(29rem,calc(100vw-4.75rem))]'}`}
          style={headerDockStyle}
          role="dialog"
          aria-label={toolsTab === 'sets' ? 'Question sets panel' : 'Ask the class panel'}
        >
          <LiveResponseTeacher
            socket={socket}
            overlay
            panelTab={toolsTab}
            onPanelTabChange={(tab) => (tab === 'responses' ? openGaugePanel() : setToolsTab(tab))}
            onClose={closeTeacherTools}
            onQuestionLaunched={openGaugePanel}
            hideResponsesTab
            highlightStudentId={toolsHighlightStudentId}
            onClearHighlight={() => setToolsHighlightStudentId(null)}
            onCopyStudentLink={copyStudentJoinLink}
            subjectAssist={promptSubjectAssist}
            rosterStudentIds={orderedStudents.map((s) => s.id)}
            initialLive={livePulse}
            onThinkingSent={({ count, recipients }) => {
              setCopyToast(
                recipients > 1
                  ? `Thinking: ${count} prompt${count === 1 ? '' : 's'} → ${recipients} students`
                  : `Thinking prompt${count === 1 ? '' : 's'} sent`
              );
              setTimeout(() => setCopyToast(''), 2500);
            }}
          />
        </div>,
        getOverlayRoot()
      )}

      {gaugePanelOpen && gaugeBox && createPortal(
        <div
          ref={gaugePanelRef}
          className={`iboard-gauge-panel z-[60]${livePulse.activity ? ' is-responses' : ''}`}
          style={{
            top: gaugeBox.top,
            left: gaugeBox.centre,
            maxHeight: `calc(100dvh - ${gaugeBox.top + 16}px)`,
            ...(livePulse.activity ? { height: `min(42rem, calc(100dvh - ${gaugeBox.top + 16}px))` } : {}),
          }}
          aria-label={livePulse.activity ? 'Responses' : 'Class writing'}
        >
          {livePulse.activity ? (
            <LiveResponseTeacher
              socket={socket}
              overlay
              panelTab="responses"
              responsesOnly
              onPanelTabChange={(tab) => {
                if (tab === 'responses') return;
                setGaugePanelOpen(false);
                openTeacherTools(tab);
              }}
              onClose={() => setGaugePanelOpen(false)}
              subjectAssist={promptSubjectAssist}
              rosterStudentIds={orderedStudents.map((s) => s.id)}
              initialLive={livePulse}
              onThinkingSent={({ count, recipients }) => {
                setCopyToast(
                  recipients > 1
                    ? `Thinking: ${count} prompt${count === 1 ? '' : 's'} → ${recipients} students`
                    : `Thinking prompt${count === 1 ? '' : 's'} sent`
                );
                setTimeout(() => setCopyToast(''), 2500);
              }}
            />
          ) : (
            <WritingPulsePanel
              socket={socket}
              students={writingPulseStudents}
              trailActive={!!room?.draftTrail?.active}
              onOpenTrail={(id) => setLearningTrailId(id)}
              onClose={() => setGaugePanelOpen(false)}
            />
          )}
        </div>,
        getOverlayRoot()
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {headerDockOpen ? (
        <div className="iboard-workspace-scrim pointer-events-none absolute inset-0 z-[55]" aria-hidden="true" />
      ) : null}
      <div className={`iboard-teacher-shell relative z-[1] min-h-0 flex-1 ${teacherPanelHidden ? 'is-teacher-hidden' : ''}`}>
        <nav ref={teacherToolsNavRef} className="iboard-arr-rail" aria-label="Teacher tools">
          <div ref={tourShareRef} className="iboard-arr-rail__add" aria-label="Share with class">
            <span className="iboard-command-bar__title iboard-rail-title">Teach class</span>
            <HintWrap hint="Send resources to students" prefer="right" suppressed={(addCardOpen && !teacherPanelHidden) || (toolsPanelOpen && toolsTab === 'sets')}>
              <button
                type="button"
                data-iboard-add-card-trigger="true"
                data-help-target="share"
                onClick={() => openAddCard()}
                aria-expanded={addCardOpen && !teacherPanelHidden}
                data-active={(addCardOpen && !teacherPanelHidden) || (toolsPanelOpen && toolsTab === 'sets') ? 'true' : 'false'}
                className={`iboard-arr-btn${helpFlash === 'share' ? ' is-help-flash' : ''}`}
                aria-label="Share an image, PDF or text"
              >
                <span className="iboard-arr-btn__icon iboard-arr-btn__icon--share" aria-hidden="true" />
                <span className="iboard-arr-label">Share resources</span>
              </button>
            </HintWrap>
            </div>
          <div ref={tourEngageRef} className="iboard-arr-rail__tools">
            {TEACHER_TOOLS_TABS.map((tab) => {
              const active = toolsPanelOpen && (toolsTab === tab.id || (tab.id === 'ask' && toolsTab === 'responses'));
              return (
                <HintWrap key={tab.id} hint={tab.hint} prefer="right" suppressed={active}>
                  <button
                    type="button"
                    data-help-target={tab.id}
                    onClick={() => {
                      if (active) closeTeacherTools();
                      else openTeacherTools(tab.id);
                    }}
                    aria-current={active ? 'page' : undefined}
                    data-active={active ? 'true' : 'false'}
                    className={`iboard-arr-btn relative${helpFlash === tab.id ? ' is-help-flash' : ''}`}
                    aria-label={tab.label}
                  >
                    <span className="iboard-arr-btn__icon iboard-arr-btn__icon--ask" aria-hidden="true" />
                    <span className="iboard-arr-label">{tab.rail || tab.label}</span>
                  </button>
                </HintWrap>
              );
            })}
            <HintWrap hint="Get AI feedback on everyone's writing, then send it to students" suppressed={aiFeedbackOpen}>
              <button
                type="button"
                data-help-target="ai"
                onClick={() => (aiFeedbackOpen ? closeLibraryHub() : openAiFeedback())}
                aria-expanded={aiFeedbackOpen}
                data-active={aiFeedbackOpen ? 'true' : 'false'}
                className={`iboard-arr-btn${helpFlash === 'ai' ? ' is-help-flash' : ''}`}
                aria-label="AI feedback"
              >
                <span className="iboard-arr-btn__icon iboard-arr-btn__icon--ai" aria-hidden="true" />
                <span className="iboard-arr-label">AI feedback</span>
              </button>
            </HintWrap>
          </div>
          <div ref={tourBoardRef} className="iboard-arr-rail__lower">
            <div className="iboard-arr-rail__foot">
              <HintWrap hint="Snapshots, portfolios, participation and class insights" prefer="right" suppressed={reportsOpen}>
                <button
                  ref={recordsButtonRef}
                  type="button"
                  onClick={() => (reportsOpen ? closeLibraryHub() : openLibrary('evidence', 'lessons'))}
                  aria-expanded={reportsOpen}
                  data-active={reportsOpen ? 'true' : 'false'}
                  className="iboard-arr-btn"
                  aria-label="View reports"
                >
                  <span className="iboard-arr-btn__icon iboard-arr-btn__icon--review" aria-hidden="true" />
                  <span className="iboard-arr-label">View reports</span>
                </button>
              </HintWrap>
              <HintWrap hint="Settings" prefer="right" suppressed={settingsOpen && settingsSection === 'settings'}>
                <button
                  ref={settingsButtonRef}
                  type="button"
                  onClick={() => toggleSettings('settings')}
                  aria-expanded={settingsOpen && settingsSection === 'settings'}
                  data-active={settingsOpen && settingsSection === 'settings' ? 'true' : 'false'}
                  className="iboard-arr-btn iboard-arr-btn--cog"
                  aria-label="Settings"
                >
                  <svg className="iboard-arr-btn__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                  </svg>
                </button>
              </HintWrap>
            </div>
          </div>
        </nav>

        {tourKey > 0 ? <TeacherBoardTour key={tourKey} anchors={tourAnchors} /> : null}

        <div className="iboard-teacher-panel-wrap">
          <HintWrap hint="Show resources" prefer="right" suppressed={!teacherPanelHidden}>
            <button
              type="button"
              className="iboard-teacher-panel-reveal"
              onPointerDown={revealTeacherPanel}
              onClick={(event) => event.preventDefault()}
              aria-label="Show resources"
              title=""
              tabIndex={teacherPanelHidden ? 0 : -1}
              aria-hidden={!teacherPanelHidden}
            >
              <span aria-hidden="true">&gt;</span>
            </button>
          </HintWrap>
          <aside
            className="iboard-teacher-panel"
            aria-label="Resources"
            aria-hidden={teacherPanelHidden}
          >
            <div className="iboard-teacher-panel-head">
              <HintWrap hint="Hide resources" prefer="below">
                <button
                  type="button"
                  className="iboard-teacher-panel-action iboard-teacher-panel-action--icon"
                  onClick={() => {
                    setTeacherPanelHidden(true);
                    if (!addCardBusy) {
                      setAddCardPickerOpen(false);
                      setAddCardOpen(false);
                    }
                  }}
                  aria-label="Hide resources"
                  title=""
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 6 9 12l6 6" />
                  </svg>
                </button>
              </HintWrap>
              <h2>Resources</h2>
            </div>
            <div
              ref={addCardPanelRef}
              className={`iboard-teacher-composer${addCardOpen ? ' is-open' : ''}`}
              data-iboard-add-card-panel="true"
              inert={!addCardOpen ? '' : undefined}
              aria-hidden={!addCardOpen ? 'true' : undefined}
            >
              <div className="iboard-teacher-composer__inner">
                <form
                  className="iboard-teacher-composer__form relative"
                  onPaste={handleAddCardPaste}
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitTeacherCard();
                  }}
                >
                  <CloseButton
                    onClick={closeAddCard}
                    disabled={addCardBusy}
                    label="Close"
                    className="absolute right-1.5 top-1.5"
                  />
                  <h2 id="add-teacher-card-title" className="whitespace-nowrap pr-7 text-[13px] font-semibold leading-6 text-[#3c3c45] dark:text-white">
                    Add image, PDF or send text
                  </h2>
                  {addCardFile ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950/40">
                      <p className="min-w-0 truncate font-semibold text-slate-800 dark:text-slate-100">
                        <span className="mr-1.5 rounded bg-[#ebeaf8] px-1 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#5a5fc3] dark:bg-indigo-950/60 dark:text-indigo-300">
                          {/pdf$/i.test(addCardFile.type || addCardFile.name || '') ? 'PDF' : 'Image'}
                        </span>
                        {addCardFile.name}
                      </p>
                      <button type="button" onClick={() => setAddCardFile(null)} className="shrink-0 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">Clear</button>
                    </div>
                  ) : addCardImage ? (
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-1.5 dark:border-slate-700 dark:bg-slate-950/30">
                      <img src={addCardImage} alt="Pasted card preview" className="max-h-28 w-full object-contain" />
                      <button type="button" onClick={() => setAddCardImage('')} className="mt-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">Clear image</button>
                    </div>
                  ) : (
                      <HintWrap hint="Pick a picture or PDF to share with the class" className="w-full">
                      <label
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-sm transition dark:border-indigo-800 dark:bg-indigo-950/30 ${
                          addCardDragOver ? 'border-[#5a5fc3] bg-[#dcdaf5]' : 'border-[#cfcce8] bg-[#ebeaf8]/70'
                        }`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (!addCardDragOver) setAddCardDragOver(true);
                        }}
                        onDragLeave={() => setAddCardDragOver(false)}
                        onDrop={handleAddCardDrop}
                      >
                        <span className="shrink-0 rounded-md bg-[#5a5fc3] px-2 py-1 text-[11px] font-bold text-white">
                          Choose file
                        </span>
                        <span className="min-w-0 text-[11px] font-semibold leading-tight text-[#5a5fc3]/80 dark:text-indigo-300/80">
                          Image or PDF — or drop it here
                        </span>
                        <input
                          type="file"
                          accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                          className="sr-only"
                          aria-label="Choose an image or PDF"
                          onChange={handleAddCardFileChange}
                          disabled={addCardBusy}
                        />
                      </label>
                      </HintWrap>
                  )}
                  <textarea
                    autoFocus={addCardOpen}
                    value={addCardText}
                    onChange={(event) => setAddCardText(event.target.value)}
                    rows={2}
                    aria-label="Add text"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none ring-indigo-400 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder={addCardFile || addCardImage ? 'Add a title (optional)' : 'Add text'}
                  />
                  {addCardText.trim() && !addCardFile && !addCardImage ? (
                    <p className={`text-[10px] font-semibold tabular-nums ${addCardText.trim().length > INBOX_NOTE_MAX ? 'text-red-600 dark:text-red-300' : 'text-slate-400'}`}>
                      {addCardText.trim().length.toLocaleString()} / {INBOX_NOTE_MAX.toLocaleString()}
                    </p>
                  ) : null}
                  {addCardError && <p className="text-xs font-semibold text-red-600 dark:text-red-300">{addCardError}</p>}
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400" aria-hidden="true">
                    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                    or
                    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                  </div>
                  <HintWrap hint="Send a set of questions to student inboxes" className="w-full">
                  <button
                    type="button"
                    disabled={addCardBusy}
                    onClick={() => openTeacherTools('sets')}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#cfcce8] bg-white px-2.5 py-2 text-left hover:bg-[#ebeaf8] disabled:opacity-50 dark:border-indigo-800 dark:bg-slate-950 dark:hover:bg-indigo-950/40"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-[#5a5fc3] dark:text-indigo-300">Question sets</span>
                      <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Curriculum questions to prompt thinking</span>
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#5a5fc3]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                  </HintWrap>
                  <div className="flex flex-col gap-1.5 pt-1">
                    <HintWrap hint={addCardFile || addCardImage || addCardText.trim() ? 'Choose which students get it' : 'Add text or choose a file first'} className="w-full">
                      <button
                        type="button"
                        disabled={addCardBusy || (!addCardFile && !addCardImage && !addCardText.trim())}
                        onClick={() => {
                          setAddCardError('');
                          setAddCardPickerOpen(true);
                        }}
                        className="w-full whitespace-nowrap rounded-md border border-[#cfcce8] bg-white px-2 py-1.5 text-[11px] font-semibold text-[#5a5fc3] hover:border-[#5a5fc3] hover:bg-[#ebeaf8] disabled:opacity-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-indigo-950"
                      >
                        Select students…
                      </button>
                    </HintWrap>
                    <HintWrap hint={addCardFile || addCardImage || addCardText.trim() ? 'Send it to every student’s inbox' : 'Add text or choose a file first'} className="w-full">
                      <button
                        type="submit"
                        disabled={addCardBusy || (!addCardFile && !addCardImage && !addCardText.trim())}
                        className="w-full whitespace-nowrap rounded-md bg-[#5a5fc3] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#4b50b0] disabled:opacity-50"
                      >
                        {addCardBusy && !addCardPickerOpen ? 'Sending…' : 'Send to inbox'}
                      </button>
                    </HintWrap>
                  </div>
                </form>
                <StudentPickerDialog
                  open={addCardOpen && addCardPickerOpen}
                  subtitle={String(addCardText || '').trim().split('\n')[0].slice(0, 80) || (addCardFile ? addCardFile.name : addCardImage ? 'Pasted image' : 'Note')}
                  students={orderedStudents.map((student) => ({
                    ...student,
                    connected: livePulse.students?.length ? connectedStudents.some((item) => item.id === student.id) : undefined,
                  }))}
                  initialIds={[]}
                  busy={addCardBusy}
                  error={addCardError}
                  onCancel={() => {
                    setAddCardPickerOpen(false);
                    setAddCardError('');
                  }}
                  onConfirm={(ids) => submitTeacherCard(ids)}
                />
              </div>
            </div>
            <div className="iboard-teacher-panel-list">
              {posts.length === 0 && !addCardOpen && (
                <p className="px-1 py-6 text-center text-xs font-semibold text-slate-400">
                  No resources yet — press + to send an image, PDF or text
                </p>
              )}
              {posts.map((post) => (
            <article
              key={`post-${post.id}`}
              className={`iboard-teacher-card flex cursor-pointer flex-col rounded-xl border border-slate-300 bg-slate-100/80 p-3 transition hover:border-[#cfcce8] dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-indigo-500`}
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
              <div className="iboard-teacher-card__head flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                <div className="iboard-teacher-card__actions ml-auto flex shrink-0 items-center gap-0.5">
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
                  <>
                    {post.title && post.title !== 'Handout' ? (
                      <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{post.title}</p>
                    ) : null}
                  <p className="whitespace-pre-wrap break-words">{post.text}</p>
                  </>
                ) : (
                  <span className="italic text-slate-400">Empty card</span>
                )}
              </div>
            </article>
          ))}
            </div>
          </aside>
        </div>

      <main className={`iboard-student-board relative flex min-h-0 flex-col overflow-y-auto`}>
          {error && <p className="mb-2 shrink-0 text-sm text-red-600">{error}</p>}
          {!lessonBegun && entranceStep === 'join' && (
            <JoinScreen
              code={codeInput}
              joinUrl={studentJoinUrl()}
              joinedCount={connectedStudents.length}
              rosterCount={orderedStudents.length}
              primaryLabel="Next"
              onClose={() => setEntranceStep('objective')}
            />
          )}
          {!lessonBegun && entranceStep === 'objective' && (
            <ObjectiveScreen
              entrance
              initialObjective={room?.lesson_objective || ''}
              onClose={() => setEntranceStep('join')}
              onSave={(text) => {
                if (text !== (room?.lesson_objective || '')) setLessonObjective(text);
                setEntranceStep('join');
                beginLesson(codeInput);
              }}
            />
          )}

              <div ref={boardScrollRef} className="min-h-0 flex-1 overflow-y-auto pb-2 scrollbar-thin">
        <div className="iboard-student-board-stack">
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
              <div
                className={`grid ${cardView === 'overview' || cardView === 'all' ? 'gap-3' : 'gap-4'} ${studentGridClass}`}
                style={fitLayout ? {
                  gridTemplateColumns: `repeat(${fitLayout.columns}, minmax(0, 1fr))`,
                  gridAutoRows: `${fitLayout.rowHeight}px`,
                } : undefined}
              >
          {section.students.map((s) => {
            const displayText = String(s.text || '').trim();
            const wc = wordCount(s.text);
            const st = activityStatus(s.updated_at, activityNow);
            const pulseStudent = liveStudentById.get(Number(s.id));
            const inQuestion = !!livePulse.activity;
            const askedIn = inQuestion && !!pulseStudent?.hasResponded;
            const engagementKey = String(pulseStudent?.engagement_status || '');
            const engagementLabel =
              engagementKey && engagementKey !== 'ready'
                ? LIVE_STATUS_LABELS[engagementKey] || engagementKey
                : '';
            const writingNow = st === 'live';
            const handQuestions = pendingHandByStudentId.get(Number(s.id)) || [];
            const handUp = handQuestions.length > 0;
            const monitoring = monitoredIds.has(Number(s.id));
            const isAway = isAwayAlert(s);
            const notStarted = isNotStartedAlert(s);
            const noTyping = isNoTyping(s);
            const inboxWaiting = studentHasInboxWait(s, pendingHandByStudentId, noteReceiptByStudentId);
            const cardEmpty = !displayText && !s.image_url;
            const noteStatus = noteReceiptByStudentId[s.id] || '';
            return (
              <article
                key={s.id}
                data-student-id={s.id}
                data-inbox-waiting={inboxWaiting ? 'true' : undefined}
                aria-label={handUp ? `${s.name} has a question — tap to open` : undefined}
                role={handUp ? 'button' : undefined}
                tabIndex={handUp ? 0 : undefined}
                onClick={handUp ? () => setHandQuestionTarget({ student: s, questions: handQuestions }) : undefined}
                onKeyDown={handUp ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setHandQuestionTarget({ student: s, questions: handQuestions });
                  }
                } : undefined}
                className={`iboard-student-card group/student-card relative flex min-h-0 flex-col overflow-hidden rounded-xl p-3 ${
                  cardView === 'overview' ? 'iboard-student-card--overview' : cardView === 'all' ? 'iboard-student-card--fit' : ''
                } ${cardEmpty ? 'iboard-student-card--empty' : ''} ${
                  handUp
                    ? 'cursor-pointer border border-[#5a5fc3] bg-[#ebeaf8] shadow-[inset_4px_0_0_0_#5a5fc3] dark:border-indigo-400 dark:bg-indigo-950/70 dark:shadow-[inset_4px_0_0_0_#818cf8] dark:ring-1 dark:ring-indigo-500/40'
                    : `${cardEmpty && cardView !== 'all' ? '' : 'bg-white dark:bg-slate-900'} ${
                        monitoring
                          ? 'border border-[#5a5fc3] ring-2 ring-[#cfcce8] dark:border-indigo-400 dark:ring-indigo-900/50'
                          : notStarted
                          ? 'border border-[#d4d4dc] dark:border-slate-600'
                          : 'border border-[#dedee6] dark:border-slate-700/80'
                      }`
                }`}
              >
                <div className="iboard-student-card__head group/card-head">
                  <div className="iboard-student-card__head-start">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      <HintWrap hint={s.name} prefer="above" className="min-w-0">
                      <h2
                        className={`iboard-student-card__name min-w-0 truncate ${
                          cardView === 'overview' || cardView === 'all' ? 'text-[13px]' : 'text-[14px]'
                        } ${
                          handUp ? 'cursor-pointer hover:text-indigo-700 dark:hover:text-indigo-300' : 'cursor-pointer hover:text-[#5a5fc3] dark:hover:text-[#818cf8]'
                    }`}
                    aria-label={handUp ? `${s.name} has a question` : `Open ${s.name}’s learning trail`}
                        title=""
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (handUp || (event.key !== 'Enter' && event.key !== ' ')) return;
                      event.preventDefault();
                      setLearningTrailId(s.id);
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        if (!handUp) {
                          setLearningTrailId(s.id);
                          return;
                        }
                        setHandQuestionTarget({ student: s, questions: handQuestions });
                    }}
                  >
                    {s.name}
                  </h2>
                      </HintWrap>
                      {gradeShortLabel(s.year_level) && (
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {gradeShortLabel(s.year_level)}
                        </span>
                      )}
                      {writingNow ? (
                        <HintWrap hint="Writing now" prefer="above">
                        <span
                          title=""
                          aria-label="Writing now"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.55)]"
                        />
                        </HintWrap>
                      ) : null}
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
                        <HintWrap hint="Tab or app in background" prefer="above">
                        <span
                          title=""
                          className="shrink-0 rounded-md bg-[#ebeaf8] px-1.5 py-0.5 text-[10px] font-bold text-[#5a5fc3] dark:bg-indigo-950/60 dark:text-indigo-200"
                        >
                          Away
                        </span>
                        </HintWrap>
                      ) : null}
                      {noTyping ? (
                        <HintWrap hint={`No changes to their writing for ${alertPrefs.noTypingMin} minutes or more`} prefer="above">
                        <span
                          title=""
                          className="shrink-0 rounded-md bg-[#ebeaf8] px-1.5 py-0.5 text-[10px] font-bold text-[#5a5fc3] dark:bg-indigo-950/60 dark:text-indigo-200"
                        >
                          No typing
                        </span>
                        </HintWrap>
                      ) : null}
                      {engagementLabel ? (
                        <span
                          className="shrink-0 rounded-md bg-[#ebeaf8] px-1.5 py-0.5 text-[10px] font-bold text-[#5a5fc3] dark:bg-indigo-950/60 dark:text-indigo-200"
                        >
                          {engagementLabel}
                        </span>
                      ) : null}
                      {askedIn ? (
                        <HintWrap hint="Answered" prefer="above">
                        <span
                          title=""
                          aria-label="Answered"
                          className="grid h-3.5 w-3.5 shrink-0 place-items-center text-[#5a5fc3] dark:text-indigo-300"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m5 12 4.5 4.5L19 7" />
                          </svg>
                        </span>
                        </HintWrap>
                      ) : null}
                      {monitoring ? (
                        <HintWrap hint="Monitoring" prefer="above">
                        <span
                          className="grid h-3.5 w-3.5 shrink-0 place-items-center text-[#5a5fc3] dark:text-indigo-300"
                          title=""
                          aria-label="Monitoring"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                            <circle cx="12" cy="12" r="2.5" />
                          </svg>
                        </span>
                        </HintWrap>
                      ) : null}
                  {Array.isArray(room?.draftTrail?.attentionIds) && room.draftTrail.attentionIds.map(Number).includes(Number(s.id)) ? (
                        <HintWrap hint="Open learning trail" prefer="above">
                    <button
                      type="button"
                          title=""
                          aria-label={`Open learning trail for ${s.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setLearningTrailId(s.id);
                      }}
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600 ring-1 ring-red-200 hover:ring-red-300 dark:ring-red-900"
                    />
                        </HintWrap>
                  ) : null}
                      {alertPrefs.pasted && pasteCounts[s.id] ? (
                        <HintWrap hint={`Pasted ${pasteCounts[s.id]} ${pasteCounts[s.id] === 1 ? 'time' : 'times'} this lesson`} prefer="above">
                      <button
                        type="button"
                          title=""
                          aria-label={`Pasted ${pasteCounts[s.id]} ${pasteCounts[s.id] === 1 ? 'time' : 'times'}. Options for ${s.name}`}
                          aria-haspopup="menu"
                          aria-expanded={pasteMenu?.studentId === s.id}
                          data-paste-menu
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            if (pasteMenu?.studentId === s.id) {
                              setPasteMenu(null);
                              setPasteDetail(null);
                              return;
                            }
                            openPasteDetail(s.id, { studentId: s.id, left: rect.left, top: rect.bottom + 6 });
                          }}
                          className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/50"
                        >
                          Pasted{pasteCounts[s.id] > 1 ? ` ×${pasteCounts[s.id]}` : ''}
                      </button>
                    </HintWrap>
                  ) : null}
                    </div>
                  </div>
                  <p
                    className="iboard-student-card__wordcount"
                    aria-label={`${wc} ${wc === 1 ? 'word' : 'words'}`}
                  >
                    {wc}w
                  </p>
                  <div className="iboard-student-card__head-end">
                  <HintWrap
                    hint={
                        noteReceiptByStudentId[s.id] === 'replied'
                        ? 'Student replied — open chat'
                          : noteReceiptByStudentId[s.id] === 'seen'
                          ? 'Message seen'
                            : noteReceiptByStudentId[s.id] === 'waiting'
                            ? 'Sent — waiting'
                            : 'Private chat'
                    }
                  >
                        <button
                          type="button"
                          data-note-student-id={s.id}
                          data-note-student-name={s.name}
                      data-note-status={noteStatus || undefined}
                          onClick={(event) => openNoteForStudent(s, event)}
                      className={`iboard-student-card__chat relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 ${
                        noteStatus === 'replied'
                              ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400'
                          : noteStatus === 'seen'
                                ? 'text-green-500 hover:text-green-600 dark:text-green-400'
                            : noteStatus === 'waiting'
                                  ? 'text-blue-600 hover:text-blue-700 dark:text-blue-400'
                                  : 'text-slate-500 hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-300'
                          }`}
                          aria-label={
                            noteReceiptByStudentId[s.id] === 'replied'
                          ? `Chat with ${s.name} — they replied`
                              : noteReceiptByStudentId[s.id] === 'seen'
                            ? `Chat with ${s.name} — seen`
                                : noteReceiptByStudentId[s.id] === 'waiting'
                              ? `Chat with ${s.name} — waiting`
                              : `Chat with ${s.name}`
                      }
                    >
                      <ChatIcon className="h-4 w-4" />
                      {noteReceiptByStudentId[s.id] === 'replied' ? (
                        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                      ) : null}
                        </button>
                      </HintWrap>
                  <div
                    className="iboard-student-card-actions ml-auto flex shrink-0 items-center gap-0.5"
                    data-open={studentActionMenuId === s.id ? 'true' : 'false'}
                    onClick={(event) => event.stopPropagation()}
                  >
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
                      <HintWrap hint="Open full draft">
                        <button
                          type="button"
                          onClick={() => setFocusedStudentId(s.id)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          aria-label={`Open ${s.name}'s full draft`}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" />
                          </svg>
                        </button>
                      </HintWrap>
                      <HintWrap hint="Learning trail">
                        <button
                          type="button"
                          onClick={() => setLearningTrailId(s.id)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          aria-label={`Open ${s.name}'s learning trail`}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="6" cy="19" r="2.5" />
                            <circle cx="18" cy="5" r="2.5" />
                            <path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5" />
                          </svg>
                        </button>
                      </HintWrap>
                      <HintWrap hint={monitoredIds.has(Number(s.id)) ? 'Stop monitoring' : 'Monitor'}>
                        <button
                          type="button"
                          onClick={() => toggleMonitorStudent(s.id)}
                          aria-pressed={monitoredIds.has(Number(s.id))}
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
                            monitoredIds.has(Number(s.id))
                              ? 'bg-[#ebeaf8] text-[#5a5fc3] hover:bg-[#e0dff5] dark:bg-[rgba(90,95,195,0.22)] dark:text-[#a5b4fc]'
                              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                          }`}
                          aria-label={monitoredIds.has(Number(s.id)) ? `Stop monitoring ${s.name}` : `Monitor ${s.name}`}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill={monitoredIds.has(Number(s.id)) ? 'currentColor' : 'none'} fillOpacity="0.18" />
                            <circle cx="12" cy="12" r="2.8" fill={monitoredIds.has(Number(s.id)) ? 'currentColor' : 'none'} />
                          </svg>
                        </button>
                      </HintWrap>
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
                </div>
                <div
                  data-student-writing-pane
                  data-card-font="true"
                  style={{ fontSize: `${(cardView === 'all' ? FIT_CARD_FONT_BASE : 1) * cardFontRem(cardFontById, s.id)}rem` }}
                  className={`iboard-writing-surface relative mt-2 rounded-xl px-2.5 py-2.5 scrollbar-thin ${cardEmpty && cardView !== 'all' ? 'iboard-student-card__empty-pane' : studentWritingPaneClass}`}
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
                    <span className="iboard-student-card__empty-copy">No writing yet</span>
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
              {actionMenuShareStep ? (
                <>
                  <button type="button" onClick={() => { shareStudentWriting(menuStudent); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-slate-700 hover:bg-[#ebeaf8] hover:text-[#3c3f8f] dark:text-slate-200 dark:hover:bg-slate-800" role="menuitem">
                    All students
                  </button>
                  <button type="button" onClick={() => { setShareTarget(menuStudent); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-slate-700 hover:bg-[#ebeaf8] hover:text-[#3c3f8f] dark:text-slate-200 dark:hover:bg-slate-800" role="menuitem">
                    Choose students
                  </button>
                </>
              ) : (
              <>
              <button type="button" disabled={!menuText.trim()} onClick={() => { copyStudentText(menuStudent); setStudentActionMenuId(null); }} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800" role="menuitem">
                Copy draft
              </button>
              <button type="button" disabled={!menuText.trim() && !menuStudent.image_url} onClick={() => setActionMenuShareStep(true)} className="w-full rounded-lg px-3 py-2 text-left font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800" role="menuitem">
                Share writing
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
              </>
              )}
            </div>
          );
        })(), document.body)}

      {pasteMenu && pasteCounts[pasteMenu.studentId] ? createPortal(
        <div
          data-paste-menu
          role="menu"
          style={{
            left: Math.max(8, Math.min(pasteMenu.left, window.innerWidth - 344)),
            top: Math.max(8, Math.min(pasteMenu.top, window.innerHeight - 420)),
          }}
          className="fixed z-[80] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Pasted {pasteCounts[pasteMenu.studentId]} {pasteCounts[pasteMenu.studentId] === 1 ? 'time' : 'times'} this lesson
          </p>
            <div className="max-h-72 space-y-1.5 overflow-y-auto px-2 pb-1.5">
              {!pasteDetail || pasteDetail.studentId !== pasteMenu.studentId || pasteDetail.loading ? (
                <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">Loading…</p>
              ) : pasteDetail.pastes.length === 0 ? (
                <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">
                  No pasted words are in this lesson’s learning trail yet.
                </p>
              ) : (
                pasteDetail.pastes.map((paste, index) => (
                  <div key={`${paste.at}-${index}`} className="rounded-lg bg-[#f1f0f8] px-2.5 py-2 dark:bg-slate-800">
                    <p className="text-[10px] font-bold text-[#5a5fc3] dark:text-indigo-300">
                      {paste.at ? new Date(paste.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}
                      {' · '}
                      {paste.text.trim().split(/\s+/).filter(Boolean).length} words
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-200">{paste.text}</p>
                  </div>
                ))
              )}
            </div>
          <div className="flex justify-end px-2 pb-1 pt-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => clearPasteAlert(pasteMenu.studentId)}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-[#ebeaf8] hover:text-[#3c3f8f] dark:text-slate-400 dark:hover:bg-[rgba(90,95,195,0.22)] dark:hover:text-indigo-200"
            >
              Clear alert
            </button>
          </div>
        </div>,
        document.body
      ) : null}

      {libraryPanel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            className={`flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900${
              helpFlash === 'records' && libraryView === 'home' ? ' is-help-flash' : ''
            }${helpFlash === 'ai' && libraryView === 'feedback' ? ' is-help-flash' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-panel-title"
            data-help-target={libraryView === 'feedback' ? 'ai' : 'records'}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
              <div className="flex min-w-0 items-center gap-1">
                {libraryView !== 'home' && libraryView !== 'feedback' ? (
                  <button
                    type="button"
                    onClick={goLibraryHome}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Back"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                ) : null}
                <div className="min-w-0">
              <h2 id="library-panel-title" className="font-display text-lg font-bold text-ink-900 dark:text-slate-100">
                    {libraryView === 'feedback'
                      ? 'AI feedback'
                      : libraryView === 'drafting'
                        ? 'Learning trail'
                        : libraryView === 'participation'
                          ? 'Participation'
                          : libraryView === 'pdf'
                            ? 'Evidence of learning PDF'
                            : libraryView === 'portfolios'
                              ? 'Student portfolios'
                              : libraryView === 'feedback-sent'
                                ? 'AI feedback & summaries'
                                : 'Reports'}
              </h2>
                  {libraryView === 'feedback' ? (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Students are only identified by number — names are never sent to the AI.
                    </p>
                  ) : null}
            </div>
              </div>
              <CloseButton onClick={closeLibraryHub} aria-label={libraryView === 'feedback' ? 'Close AI feedback' : 'Close Reports'} />
            </div>
            <div className={`overflow-y-auto scrollbar-thin${libraryView === 'feedback' || libraryView === 'pdf' ? ' p-4' : ' p-5'}`}>
        {libraryView === 'home' && (
          <section className="space-y-4">
              <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">
              Everything from your lessons in one place. To capture today’s writing, use the save icon in the header and save a snapshot.
            </p>
            <div className="flex flex-wrap gap-2" role="navigation" aria-label="Report sections">
              {[
                { label: 'Learning trail', hint: 'How each student’s writing grew, the support you gave, and anything pasted. Download the Evidence of learning PDF here too.', onClick: () => setLibraryView('drafting') },
                { label: 'Participation', hint: 'Who answered your Ask class questions, and how often. Download the participant list here too.', onClick: () => setLibraryView('participation') },
                { label: 'Student portfolios', hint: 'Download each student’s saved work as a PDF', onClick: () => setLibraryView('portfolios') },
                { label: 'AI feedback & summaries', hint: 'Class summaries you saved, plus every piece of AI feedback you sent and who opened it', onClick: openFeedbackSent },
                { label: 'Class insights', hint: 'Trends across your lessons and classes, with no student names', onClick: () => { closeLibraryHub(); setInsightsOpen(true); } },
              ].map((item) => (
                <HintWrap key={item.label} hint={item.hint}>
                  <button
                    type="button"
                    disabled={!!item.disabled}
                    onClick={item.onClick}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#5a5fc3] hover:bg-[#ebeaf8] hover:text-[#3c3f8f] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-[#818cf8] dark:hover:bg-[rgba(90,95,195,0.22)]"
                  >
                    {item.label}
                  </button>
                </HintWrap>
              ))}
            </div>

            {snapshots.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#cfcce8] bg-white p-8 text-center shadow-sm dark:border-indigo-800 dark:bg-slate-900">
                <h3 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">No snapshots yet</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
                  Snapshot everyone’s writing from the save icon in the header to unlock class packs and student portfolios.
                </p>
                    </div>
            ) : (
                  <div className="overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-slate-100">Class snapshots</h3>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Whole-class packs from each snapshot. View or download HTML again.</p>
                    </div>
                    <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto px-4 scrollbar-thin dark:divide-slate-800">
                      {snapshots.map((sn) => (
                        <li key={sn.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                          <span className="text-slate-800 dark:text-slate-200">
                            <span className="font-medium">{sn.label || `Evidence #${sn.id}`}</span>
                            {String(sn.label || '').includes(formatSqlUtc(sn.created_at)) ? null : (
                              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{formatSqlUtc(sn.created_at)}</span>
                            )}
                            {sn.lesson_objective ? (
                              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Today: {sn.lesson_objective}</span>
                            ) : null}
                          </span>
                          <span className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => loadSnapshotForView(sn.id)}
                              className="rounded-lg text-xs font-semibold text-[#5a5fc3] hover:text-[#4b50b0] dark:text-indigo-300 dark:hover:text-indigo-200"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => redownloadEvidence(sn.id)}
                              className="rounded-lg text-xs font-semibold text-[#5a5fc3] hover:text-[#4b50b0] dark:text-indigo-300 dark:hover:text-indigo-200"
                            >
                              Download HTML
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
            )}
          </section>
                )}

        {libraryView === 'feedback-sent' && (
          <section className="space-y-4">
            <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">
              Class summaries you saved, then every piece of AI feedback you’ve sent from this room. Newest first.
            </p>
            {aiSummaries.length ? (
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Class summaries · only you see these</h3>
                {aiSummaries.map((summary, index) => (
                  <details key={summary.id} open={index === 0} className="group overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="font-display text-base font-semibold text-ink-900 dark:text-slate-100">{formatSqlUtc(summary.createdAt)}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{summary.roster.length} students</span>
                    </summary>
                    <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{summary.text}</p>
                      {summary.roster.length ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-bold text-[#5a5fc3] dark:text-indigo-300">Who is Student 1, 2, 3…?</summary>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                            {summary.roster.map((name, i) => `${i + 1}. ${name || 'Unnamed'}`).join(' · ')}
                          </p>
                        </details>
                      ) : null}
                    </div>
                  </details>
                ))}
                {aiFeedbackLog?.length ? (
                  <h3 className="pt-2 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Feedback sent to students</h3>
                ) : null}
              </div>
            ) : null}
            {aiFeedbackLog === null ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
            ) : aiFeedbackLogError ? (
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">{aiFeedbackLogError}</p>
            ) : aiFeedbackLog.length === 0 ? (
              aiSummaries.length ? null : (
              <div className="rounded-2xl border border-dashed border-[#cfcce8] bg-white p-8 text-center shadow-sm dark:border-indigo-800 dark:bg-slate-900">
                <h3 className="font-display text-xl font-bold text-ink-900 dark:text-slate-100">Nothing here yet</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">
                  Feedback you distribute and class summaries you save from the AI feedback button on the rail will appear here.
                </p>
              </div>
              )
            ) : (
              Object.entries(
                aiFeedbackLog.reduce((groups, item) => {
                  const key = String(item.createdAt || '').slice(0, 16);
                  (groups[key] ||= []).push(item);
                  return groups;
                }, {})
              ).map(([key, items]) => (
                <div key={key} className="overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <h3 className="font-display text-base font-semibold text-ink-900 dark:text-slate-100">{formatSqlUtc(items[0].createdAt)}</h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {items.length === 1 ? '1 student' : `${items.length} students`}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {[...items]
                      .sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''))
                      .map((item) => (
                        <li key={item.id}>
                          <details className="group px-4 py-2.5">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden">
                              <span className="font-semibold text-slate-800 dark:text-slate-100">{item.studentName || 'Student who left'}</span>
                              <span className={`text-xs font-semibold ${item.seen ? 'text-[#5a5fc3] dark:text-indigo-300' : 'text-slate-400 dark:text-slate-500'}`}>
                                {item.seen ? 'Opened' : 'Not opened yet'}
                              </span>
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-[#f1f0f8] px-3 py-2 text-sm leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {item.text}
                            </p>
                          </details>
                        </li>
                      ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        )}

        {libraryView === 'portfolios' && (
                <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm dark:border-indigo-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div>
                      <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-slate-100">Student portfolios</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose a name for one PDF, or download the class as a zip of separate files.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!!portfolioDownloadKind || !evidenceStudents.length}
                        onClick={downloadAllPortfolioPdfs}
                        className="rounded-xl bg-[#5a5fc3] px-3 py-2 text-xs font-black text-white hover:bg-[#4b50b0] disabled:opacity-50"
                      >
                        {portfolioDownloadKind === 'all' ? 'Preparing PDFs…' : 'Download all PDFs (zip)'}
                      </button>
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
                              <button type="button" disabled={!!portfolioDownloadKind} onClick={downloadStudentPortfolio} className="rounded-lg bg-[#5a5fc3] px-3 py-2 text-xs font-black text-white hover:bg-[#4b50b0] disabled:opacity-50">{portfolioDownloadKind === 'one' ? 'Preparing PDF…' : 'Download PDF'}</button>
                            </div>
                          </div>
                          <div className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                            {selectedEvidenceStudent.entries.map((entry) => (
                              <article key={`${entry.snapshotId}-${entry.studentId}-${entry.updatedAt}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="font-bold text-slate-900 dark:text-white">{entry.label}</p>
                                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                      {formatSqlUtc(entry.createdAt)} · {wordCount(entry.text)} words
                                      {(selectedEvidenceStudent.aliases || []).length > 1 && entry.sourceName ? ` · as ${entry.sourceName}` : ''}
                                      {entry.lessonObjective ? ` · Today: ${entry.lessonObjective}` : ''}
                                    </p>
                                  </div>
                                  <button type="button" onClick={() => loadSnapshotForView(entry.snapshotId)} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-300">Open class snapshot</button>
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
                    TUIT still matches capital letters and extra spaces automatically. Other name variations are combined only when you approve them.
                  </p>
          </section>
        )}

        {libraryView === 'feedback' && (
          <section data-help-target="ai" className="iboard-ai-feedback">
            <div className="iboard-ai-feedback__bar">
              <div className="min-w-0">
                <p className="iboard-ai-feedback__meta">
                  {[
                    MODE_LABELS[normalizeFeedbackMode(room?.genre)] || 'Narrative',
                    room?.feedback_toggles?.subjectAssist && room.feedback_toggles.subjectAssist !== 'general'
                      ? SUBJECT_ASSIST_OPTIONS.find((o) => o.id === room.feedback_toggles.subjectAssist)?.label || room.feedback_toggles.subjectAssist
                      : null,
                    room?.feedback_toggles?.yearLevel && room.feedback_toggles.yearLevel !== 'general'
                      ? YEAR_LEVEL_OPTIONS.find((o) => o.id === room.feedback_toggles.yearLevel)?.label || room.feedback_toggles.yearLevel
                      : null,
                    visibleStudents.length ? `${visibleStudents.length} students` : null,
                    `~${aiPayloadStats.promptKb} KB`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(true)} className="iboard-ai-feedback__settings">
                Settings
              </button>
            </div>

            {(aiPayloadStats.level === 'warn' || aiPayloadStats.level === 'heavy') && (
              <p className="iboard-ai-feedback__warn">
                {aiPayloadStats.level === 'heavy'
                  ? 'Very large prompt — copy in smaller batches.'
                  : 'Large prompt — try half the class if your AI tool truncates it.'}
              </p>
            )}

            <div className="iboard-ai-feedback__tasks" role="tablist" aria-label="What do you want back?">
              {[
                { id: 'feedback', label: 'Feedback for students', hint: 'Personal feedback for each student, sent to their inbox' },
                { id: 'summary', label: 'Class summary for me', hint: 'Strengths, misconceptions and next teaching steps across the class. Only you see it.' },
              ].map((task) => (
                <HintWrap key={task.id} hint={task.hint}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aiTask === task.id}
                    onClick={() => setAiTask(task.id)}
                    className={`iboard-ai-feedback__task${aiTask === task.id ? ' is-active' : ''}`}
                  >
                    {task.label}
                  </button>
                </HintWrap>
              ))}
            </div>

            <button type="button" onClick={copyForAi} className="iboard-ai-feedback__copy">
              Copy prompt for AI
            </button>
            <p className="iboard-ai-feedback__step">Paste it into your AI (ChatGPT, Gemini, Copilot)</p>

            {aiTask === 'summary' ? (
              <>
                <label className="iboard-ai-feedback__paste-label" htmlFor="ai-summary-back">
                  Paste the summary below
                </label>
                <textarea
                  id="ai-summary-back"
                  value={summaryBox}
                  onChange={(e) => setSummaryBox(e.target.value)}
                  rows={10}
                  className="iboard-ai-feedback__paste"
                />
                <button
                  type="button"
                  onClick={saveClassSummary}
                  disabled={!summaryBox.trim() || summarySaving}
                  className={`iboard-ai-feedback__distribute${summaryBox.trim() && !summarySaving ? ' is-ready' : ''}`}
                >
                  {summarySaving ? 'Saving…' : 'Save to Reports'}
                </button>
                <p className="iboard-ai-feedback__hint">Only you see this. Students are not sent anything.</p>
              </>
            ) : (
              <>
                <label className="iboard-ai-feedback__paste-label" htmlFor="ai-paste-back">
                  Paste the feedback below
                </label>
                <textarea
                  id="ai-paste-back"
                  value={pasteBox}
                  onChange={(e) => setPasteBox(e.target.value)}
                  rows={10}
                  className="iboard-ai-feedback__paste"
                />
                <button
                  type="button"
                  onClick={distributePaste}
                  disabled={!distributeReady}
                  className={`iboard-ai-feedback__distribute${distributeReady ? ' is-ready' : ''}`}
                >
                  Distribute to students
                </button>
                {aiPasteHint ? <p className="iboard-ai-feedback__hint">{aiPasteHint}</p> : null}
              </>
            )}
          </section>
        )}

        {libraryView === 'drafting' && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#ebeaf8] px-3 py-2 dark:bg-[rgba(90,95,195,0.22)]">
              <p className="text-xs text-[#3c3f8f] dark:text-indigo-100">Today’s writing and every learning trail, as one PDF.</p>
              <button
                type="button"
                disabled={sessionBusy}
                onClick={() => setLibraryView('pdf')}
                className="rounded-lg bg-[#5a5fc3] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#4b50b0] disabled:opacity-50"
              >
                Evidence of learning PDF
              </button>
            </div>
            <DraftTrailPanel
              key="library-drafting"
              embedded
              socket={socket}
              onClose={goLibraryHome}
              onOpenSummary={(id) => setLearningTrailId(id)}
            />
          </>
        )}

        {libraryView === 'participation' && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#ebeaf8] px-3 py-2 dark:bg-[rgba(90,95,195,0.22)]">
              <p className="text-xs text-[#3c3f8f] dark:text-indigo-100">Names, year levels and word counts for everyone who joined.</p>
              <button
                type="button"
                onClick={downloadParticipantList}
                className="rounded-lg bg-[#5a5fc3] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#4b50b0]"
              >
                Download participant list
              </button>
            </div>
            <LessonReportPanel
              key="library-participation"
              embedded
              roomCode={codeInput}
              onClose={goLibraryHome}
            />
          </>
        )}

        {libraryView === 'pdf' && (
          <SessionPdfExport
            key="library-pdf"
            embedded
            socket={socket}
            onClose={goLibraryHome}
          />
        )}
            </div>
          </div>
        </div>
      )}

      <StudentPickerDialog
        open={!!shareTarget}
        title="Who should see this writing?"
        subtitle="The writer’s name is hidden"
        students={orderedStudents.filter((student) => Number(student.id) !== Number(shareTarget?.id))}
        initialIds={[]}
        onCancel={() => setShareTarget(null)}
        onConfirm={(ids) => {
          const target = shareTarget;
          setShareTarget(null);
          shareStudentWriting(target, ids);
        }}
      />
      {joinScreenOpen && (
        <JoinScreen
          code={codeInput}
          joinUrl={studentJoinUrl()}
          joinedCount={connectedStudents.length}
          rosterCount={orderedStudents.length}
          onClose={() => setJoinScreenOpen(false)}
        />
      )}
      {newClassConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-[2px] sm:items-center">
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[#d5d4e4] bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
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
                <h2 id="new-class-confirm-title" className="mt-1 font-display text-xl font-black text-slate-950 dark:text-white">
                  Reset class board?
                </h2>
                <p id="new-class-confirm-description" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  This clears every card in Room <span className="font-mono font-bold text-slate-900 dark:text-white">{codeInput}</span> and empties students’ screens. They’ll need to join again. A backup of the lesson saves automatically first.
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
                className="w-full rounded-xl border border-[#e2e2e8] bg-white px-4 py-2.5 text-sm font-bold text-[#3c3c45] transition-colors hover:border-[#5a5fc3] hover:bg-[#ebeaf8] hover:text-[#3c3f8f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5a5fc3] focus-visible:ring-offset-2 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/50"
              >
                Download participation report
              </button>
            </div>
            <div className="flex flex-col-reverse gap-2 bg-[#f7f6fb] px-5 py-4 dark:bg-slate-950 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                disabled={newClassBusy}
                onClick={closeNewClassConfirmation}
                className="rounded-xl border border-[#e2e2e8] bg-white px-4 py-2.5 text-sm font-bold text-[#3c3c45] transition-colors hover:border-[#5a5fc3] hover:bg-[#ebeaf8] hover:text-[#3c3f8f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a5fc3] focus-visible:ring-offset-2 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/50"
              >
                Keep board
              </button>
              <button
                type="button"
                disabled={newClassBusy}
                onClick={startNewClass}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
              >
                {newClassBusy ? newClassStep || 'Resetting…' : 'Reset board'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewOpen && (
        <div
          ref={viewPanelRef}
          className="iboard-header-dock iboard-header-dock--view fixed z-[60] w-auto max-w-[min(22rem,calc(100vw-1.5rem))]"
          style={{ top: teacherToolsTop, right: viewDockRight }}
          role="dialog"
          aria-modal="false"
          aria-labelledby="card-view-title"
        >
          <h2 id="card-view-title" className="sr-only">View</h2>
          <div
            className="relative"
            onMouseLeave={() => setOverviewColsPeek(false)}
          >
            <div className="flex items-stretch gap-0.5 p-1.5" role="group" aria-label="Card view">
              {CARD_VIEWS.map((view) => {
                const active = cardView === view.id;
                const isOverview = view.id === 'overview';
                return (
                  <HintWrap key={view.id} hint={view.hint || view.label} prefer="above" suppressed={active || (isOverview && overviewColsPeek)}>
                    <button
                      type="button"
                      onClick={() => {
                        setCardView(view.id);
                        setOverviewColsPeek(isOverview);
                      }}
                      onMouseEnter={() => setOverviewColsPeek(isOverview)}
                      onFocus={() => setOverviewColsPeek(isOverview)}
                      aria-pressed={active}
                      aria-expanded={isOverview ? overviewColsPeek : undefined}
                      title=""
                      className={`group flex min-w-[4.6rem] flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold leading-tight transition active:scale-[0.98] ${
                        active
                          ? 'border-transparent bg-[#5a5fc3] text-white shadow-sm'
                          : 'border-transparent text-slate-700 hover:border-[#5a5fc3] hover:bg-[#ebeaf8] hover:text-[#3c3f8f] dark:text-slate-200 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/50 dark:hover:text-white'
                      }`}
                    >
                      <CardViewIcon id={view.id} className={`h-4 w-4 shrink-0 transition-transform duration-[260ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none${active ? '' : ' group-hover:scale-[1.15]'}`} />
                      <span>{view.id === 'full' ? 'Full' : view.label}</span>
                    </button>
                  </HintWrap>
                );
              })}
              </div>
            {overviewColsPeek ? (
              <div
                className="flex items-center justify-start gap-1 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700"
                role="group"
                aria-label="Number of columns"
              >
                <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8b8b96] dark:text-slate-400" aria-hidden="true">
                  How many
                </span>
                {OVERVIEW_COLUMN_OPTIONS.map((count) => {
                  const active = overviewColumns === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      aria-label={`${count} columns`}
                      aria-pressed={active}
                      onClick={() => {
                        setOverviewColumns(count);
                        setCardView('overview');
                      }}
                      onFocus={() => setOverviewColsPeek(true)}
                      className={`min-w-[1.75rem] rounded-md border px-1.5 py-1 text-[11px] font-semibold tabular-nums transition ${
                        active
                          ? 'border-transparent bg-[#5a5fc3] text-white shadow-sm'
                          : 'border-transparent text-[#52525c] hover:border-[#5a5fc3] hover:bg-[#ebeaf8] hover:text-[#3c3f8f] dark:text-slate-300 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/50 dark:hover:text-white'
                      }`}
                    >
                      {count}
                    </button>
                  );
                })}
            </div>
            ) : null}
                </div>
                </div>
              )}

      {settingsOpen && createPortal(
        <div
          ref={settingsPanelRef}
          className="iboard-header-dock iboard-header-dock--start iboard-header-dock--from-rail iboard-room-settings z-[60] w-[min(22rem,calc(100vw-4.75rem))]"
          style={headerDockStyle}
          role="dialog"
          aria-modal="false"
          aria-label={settingsTitle}
        >
          <div className="iboard-room-settings__chrome" ref={settingsChromeRef}>
            <h2>{settingsTitle}</h2>
            <div className="iboard-room-settings__chrome-close">
              <CloseButton onClick={closeSettings} label="Close" />
            </div>
          </div>
          <div className="iboard-room-settings__body scrollbar-thin">
            {settingsSection === 'settings' && (
            <div className="iboard-room-settings__hero">
              <div className="iboard-room-settings__row">
                <HintWrap hint="Stamps the start and end on the Learning trail. Feedback asks before sending. Students see a calm banner." className="min-w-0 flex-1" multiline>
                  <button
                    type="button"
                    role="switch"
                    onClick={() => (independentSince ? endIndependentWriting() : setIndependentWriting(true))}
                    aria-checked={!!independentSince}
                    className="iboard-room-settings__secondary w-full justify-between gap-3"
                  >
                    <span>Independent writing</span>
                    <span className="iboard-switch" data-on={independentSince ? 'true' : 'false'} aria-hidden="true" />
                  </button>
                </HintWrap>
              </div>
              <div className="iboard-room-settings__row">
                <HintWrap hint="Change the colours of your screen only" className="min-w-0 flex-1">
                  <button
                    type="button"
                    role="switch"
                onClick={toggleTheme}
                    aria-checked={isDark}
                    className="iboard-room-settings__secondary w-full justify-between gap-3"
              >
                    <span>Dark mode</span>
                    <span className="iboard-switch" data-on={isDark ? 'true' : 'false'} aria-hidden="true" />
              </button>
                </HintWrap>
            </div>
              <div className="iboard-room-settings__row">
                <HintWrap hint="Show a short tip when you hover a button" className="min-w-0 flex-1">
                  <button
                    type="button"
                    role="switch"
                    onClick={() => setHintsOff(!hintsOff)}
                    aria-checked={!hintsOff}
                    className="iboard-room-settings__secondary w-full justify-between gap-3"
                  >
                    <span>Tooltips</span>
                    <span className="iboard-switch" data-on={hintsOff ? 'false' : 'true'} aria-hidden="true" />
                  </button>
                </HintWrap>
              </div>
              <p className="iboard-room-settings__alerts-title">Alerts</p>
              {[
                { key: 'notStarted', label: 'Not started', hint: 'Flags an empty card a few minutes after the student joins', minutesKey: 'notStartedMin', minutesLabel: 'after joining' },
                { key: 'noTyping', label: 'No typing', hint: 'Flags a student whose writing hasn’t changed for a while', minutesKey: 'noTypingMin', minutesLabel: 'without changes' },
                { key: 'away', label: 'Away', hint: 'Flags a student whose TUIT tab has been in the background for a minute' },
                { key: 'pasted', label: 'Pasted', hint: 'Flags a student who pastes into their writing. Pastes are still recorded when this is off.' },
              ].map((alert) => (
                <div key={alert.key} className="iboard-room-settings__alert">
                  <HintWrap hint={alert.hint} className="w-full" multiline>
                    <button
                      type="button"
                      role="switch"
                      onClick={() => updateAlertPrefs({ [alert.key]: !alertPrefs[alert.key] })}
                      aria-checked={!!alertPrefs[alert.key]}
                      className="iboard-room-settings__secondary w-full justify-between gap-3"
                    >
                      <span>{alert.label}</span>
                      <span className="iboard-switch" data-on={alertPrefs[alert.key] ? 'true' : 'false'} aria-hidden="true" />
                    </button>
                  </HintWrap>
                  {alert.minutesKey && alertPrefs[alert.key] ? (
                    <label className="iboard-room-settings__alert-minutes">
                      <input
                        type="range"
                        min={2}
                        max={10}
                        step={1}
                        value={alertPrefs[alert.minutesKey]}
                        onChange={(event) => updateAlertPrefs({ [alert.minutesKey]: Number(event.target.value) })}
                        className="iboard-word-target-slider min-w-0 flex-1 cursor-pointer accent-indigo-600"
                        aria-label={`${alert.label}: minutes ${alert.minutesLabel}`}
                      />
                      <span>{alertPrefs[alert.minutesKey]} min {alert.minutesLabel}</span>
                    </label>
                  ) : null}
                </div>
              ))}
              {fixedCommentCount > 0 && (
                <div className="iboard-room-settings__cleanup">
                  {!clearFixedArmed ? (
                    <HintWrap hint="Removes the green comment bubbles you’ve confirmed from student cards. Purple comments, including ones waiting for you to check, stay." className="w-full" multiline>
                    <button type="button" className="iboard-room-settings__cleanup-btn" onClick={() => setClearFixedArmed(true)}>
                    <span>Clear confirmed comments</span>
                      <span className="iboard-room-settings__cleanup-badge">{fixedCommentCount}</span>
                  </button>
                    </HintWrap>
                ) : (
                    <div className="iboard-room-settings__cleanup-confirm">
                      <p>
                      Remove {fixedCommentCount} green comment{fixedCommentCount === 1 ? '' : 's'}? Purple ones stay.
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
            </div>
            )}

            {settingsSection === 'records' && (
            <section className="iboard-room-settings__section">
              <div className="iboard-room-settings__card iboard-room-settings__list">
                <HintWrap hint="Snapshots of student writing from past lessons" className="w-full">
                  <button type="button" onClick={() => openLibrary('evidence', 'lessons')}>
                    <span>Lesson records</span>
                    {snapshots.length > 0 ? (
                      <span className="iboard-room-settings__badge">{snapshots.length}</span>
                    ) : null}
            </button>
                </HintWrap>
                <HintWrap hint="Participation and engagement across the class" className="w-full">
                  <button type="button" onClick={() => { closeSettings(); setInsightsOpen(true); }}>
                    Class insights
                  </button>
                </HintWrap>
                <HintWrap hint="Download a list of everyone who joined" className="w-full">
                  <button type="button" onClick={() => { closeSettings(); downloadParticipantList(); }}>
              Download participant list
            </button>
                </HintWrap>
              </div>
            </section>
            )}

            {settingsSection === 'settings' && (
            <HintWrap hint="Clear every student and card to start a new class (asks first)" className="w-full">
              <button
                type="button"
                onClick={() => { closeSettings(); openNewClassConfirmation(); }}
                className="iboard-room-settings__danger"
              >
                Reset class board
            </button>
            </HintWrap>
            )}
          </div>
        </div>,
        getOverlayRoot()
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
            data-full-draft="true"
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
                  <HintWrap hint="Open learning trail" prefer="below">
                  <button
                    type="button"
                      title=""
                      aria-label={`Open learning trail for ${focusedStudent.name}`}
                    onClick={() => setLearningTrailId(focusedStudent.id)}
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600 ring-2 ring-red-200 hover:ring-red-300 dark:ring-red-900"
                  />
                  </HintWrap>
                ) : null}
                <p className="text-xs text-slate-500 dark:text-slate-400">{wordCount(focusedStudent.text)} words · select text to add an inline comment</p>
              </div>
              <div className="flex items-center gap-2">
                <HintWrap hint="How this draft grew and the support you gave">
                  <button
                    type="button"
                    onClick={() => setLearningTrailId(focusedStudent.id)}
                    className="h-9 shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:border-[#5a5fc3] hover:bg-[#ebeaf8] hover:text-[#3c3f8f] dark:border-slate-700 dark:text-slate-300 dark:hover:border-[#818cf8] dark:hover:bg-[rgba(90,95,195,0.22)]"
                  >
                    Learning trail
                  </button>
                </HintWrap>
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
                <HintWrap
                  hint={
                    noteReceiptByStudentId[focusedStudent.id] === 'replied'
                      ? 'Student replied — open chat'
                      : noteReceiptByStudentId[focusedStudent.id] === 'seen'
                        ? 'Message seen'
                        : noteReceiptByStudentId[focusedStudent.id] === 'waiting'
                          ? 'Sent — waiting'
                          : 'Private chat'
                  }
                >
                  <button
                    type="button"
                    onClick={() => { setFocusedStudentId(null); openNoteForStudent(focusedStudent); }}
                    className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 ${
                      noteReceiptByStudentId[focusedStudent.id] === 'replied'
                        ? 'text-amber-500'
                        : noteReceiptByStudentId[focusedStudent.id] === 'seen'
                          ? 'text-green-500'
                          : noteReceiptByStudentId[focusedStudent.id] === 'waiting'
                            ? 'text-blue-600'
                            : 'text-slate-600 dark:text-slate-300'
                    }`}
                    aria-label={`Chat with ${focusedStudent.name}`}
                  >
                    <ChatIcon className="h-4 w-4" />
                    {noteReceiptByStudentId[focusedStudent.id] === 'replied' ? (
                      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                    ) : null}
                </button>
                </HintWrap>
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
              data-full-draft-pane="true"
              data-card-font="true"
              style={{ fontSize: `${cardFontRem(cardFontById, focusedStudent.id)}rem` }}
              className="iboard-writing-surface relative min-h-0 flex-1 overflow-x-visible overflow-y-auto whitespace-pre-wrap px-6 py-5 leading-7 text-slate-800 scrollbar-thin dark:text-slate-200"
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

      <ConversationModal
        open={!!noteTarget}
        onClose={closeNoteComposer}
        socket={socket}
        role="teacher"
        studentId={noteTarget?.id}
        title={noteTarget?.name || 'Student'}
        subtitle="Private"
        allowUrgent
        onTeacherSent={handleTeacherChatSent}
      />

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
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatSqlUtc(snapshotViewer.created_at)}</p>
              {snapshotViewer.payload?.lesson_objective ? (
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Today’s objective: {snapshotViewer.payload.lesson_objective}
                </p>
              ) : null}
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
            className="iboard-feedback-settings max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-settings-title"
          >
            <div className="iboard-feedback-settings__chrome">
              <h2 id="feedback-settings-title">Feedback settings</h2>
              <CloseButton onClick={() => setModalOpen(false)} aria-label="Close" />
            </div>
            <div className="iboard-feedback-settings__body scrollbar-thin">
              <div className="iboard-feedback-settings__modes" role="group" aria-label="Feedback mode">
                  {FEEDBACK_MODES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFeedbackMode(id)}
                    data-active={feedbackMode === id ? 'true' : 'false'}
                    >
                      {MODE_LABELS[id]}
                    </button>
                  ))}
              </div>

              <div className="iboard-feedback-settings__selects">
                <label>
                  <span>Subject</span>
                  <select
                    id="subject"
                    value={subjectAssist}
                    onChange={(e) => setSubjectAssist(e.target.value)}
                  >
                    {SUBJECT_ASSIST_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  </label>
                <label>
                  <span>Year</span>
                  <select
                    id="year-level"
                    value={yearLevel}
                    onChange={(e) => setYearLevel(e.target.value)}
                  >
                    {YEAR_LEVEL_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {feedbackMode === 'custom' ? (
                <div className="iboard-feedback-settings__custom">
                  <textarea
                    id="custom-focus"
                    value={customFocusText}
                    onChange={(e) => setCustomFocusText(e.target.value)}
                    rows={3}
                    placeholder="What should the AI focus on?"
                    aria-label="Custom focus"
                  />
                  {(extraFocusByMode.custom || []).length > 0 && (
                    <div className="iboard-feedback-settings__toggles">
                      {(extraFocusByMode.custom || []).map((item) => (
                        <div key={item.id} className="iboard-feedback-settings__toggle-row">
                        <ToggleRow
                            compact
                              label={item.text}
                              checked={item.enabled}
                            onChange={(v) => setExtraFocusEnabled('custom', item.id, v)}
                            />
                          <RemoveButton onClick={() => removeExtraFocus('custom', item.id)} aria-label={`Remove ${item.text}`} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="iboard-feedback-settings__add">
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
                      placeholder="Add focus"
                      aria-label="Add focus"
                    />
                    <button type="button" onClick={addCustomFocusLine} aria-label="Add focus">
                      +
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="iboard-feedback-settings__toggles">
                    {Object.entries(visibleToggleLabels(feedbackMode, yearLevel)).map(([key, label]) => (
                          <ToggleRow
                        key={key}
                        compact
                        label={label}
                        checked={!!modeToggles[feedbackMode]?.[key]}
                        onChange={(v) => setModeToggle(feedbackMode, key, v)}
                      />
                    ))}
                    {(extraFocusByMode[feedbackMode] || []).map((item) => (
                      <div key={item.id} className="iboard-feedback-settings__toggle-row">
                        <ToggleRow
                          compact
                            label={item.text}
                            checked={item.enabled}
                          onChange={(v) => setExtraFocusEnabled(feedbackMode, item.id, v)}
                          />
                        <RemoveButton onClick={() => removeExtraFocus(feedbackMode, item.id)} aria-label={`Remove ${item.text}`} />
                      </div>
                    ))}
                  </div>
                  <div className="iboard-feedback-settings__add">
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
                      placeholder="Add focus"
                      aria-label="Add focus"
                    />
                    <button type="button" onClick={addCustomFocusLine} aria-label="Add focus">
                      +
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="iboard-feedback-settings__footer">
              <button type="button" onClick={() => setModalOpen(false)} className="iboard-feedback-settings__cancel">
                Cancel
              </button>
              <button type="button" onClick={saveFeedbackSettings} className="iboard-feedback-settings__save">
                Save
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
