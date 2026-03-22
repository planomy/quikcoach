import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
import QuikCoachWordmark from '../components/QuikCoachWordmark.jsx';
import { buildRoomCsv, downloadTextFile } from '../lib/exportRoom.js';

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
    room_code: s.room_code != null ? String(s.room_code) : '',
    updated_at: s.updated_at,
    class_group: s.class_group != null ? String(s.class_group) : '',
  };
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm transition hover:border-indigo-200">
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
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}

export default function TeacherDashboard() {
  const [codeInput, setCodeInput] = useState('');
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState(null);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');

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
  const [groupFilter, setGroupFilter] = useState('');
  const [broadcastPick, setBroadcastPick] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotViewer, setSnapshotViewer] = useState(null);

  const socket = useMemo(() => createSocket(), []);
  const teacherRoomRef = useRef('');
  const joinedRef = useRef(false);

  const pushSettings = useCallback(
    (partial) => {
      if (!room) return;
      socket.emit('teacher:settings', partial);
    },
    [room, socket]
  );

  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

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
        const next = [...prev];
        next[i] = { ...next[i], ...row };
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

  async function createOrJoin() {
    setError('');
    const digits = codeInput.replace(/\D/g, '').slice(0, 4);
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
          setCopyToast('Exemplars built, but no student browsers are in the room socket — open/refresh student tabs.');
        } else {
          setCopyToast(`Broadcast: ${ack.count} exemplar(s) to ${ack.reached ?? '?'} connected device(s)`);
        }
        setTimeout(() => setCopyToast(''), 4000);
        setBroadcastPick({});
      }
    });
  }

  function saveSnapshot() {
    const label = window.prompt('Snapshot label (optional):', '');
    if (label === null) return;
    socket.emit('teacher:snapshot-save', { label: label || '' }, (ack) => {
      if (!ack?.ok) {
        setError('Could not save snapshot');
        return;
      }
      setSnapshots(ack.snapshots || []);
      setCopyToast('Snapshot saved');
      setTimeout(() => setCopyToast(''), 2500);
    });
  }

  function exportCurrentCsv() {
    if (!codeInput || codeInput.length !== 4) return;
    const suffix = groupFilter.trim() ? `-group-${groupFilter.trim().replace(/\W+/g, '_')}` : '';
    const csv = buildRoomCsv(visibleStudents);
    downloadTextFile(`quik-coach-${codeInput}${suffix}-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
    setCopyToast('Exported CSV');
    setTimeout(() => setCopyToast(''), 2000);
  }

  function exportCurrentJson() {
    if (!codeInput || codeInput.length !== 4) return;
    const body = {
      exported_at: new Date().toISOString(),
      room_code: codeInput,
      group_filter: groupFilter.trim() || null,
      room,
      students: visibleStudents,
    };
    downloadTextFile(
      `quik-coach-${codeInput}-${Date.now()}.json`,
      JSON.stringify(body, null, 2),
      'application/json'
    );
    setCopyToast('Exported JSON');
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

  async function exportSnapshotJsonFile(id) {
    try {
      const r = await fetch(`/api/rooms/${codeInput}/snapshots/${id}`);
      if (!r.ok) return;
      const data = await r.json();
      downloadTextFile(
        `quik-coach-snapshot-${codeInput}-${id}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );
    } catch {
      setError('Could not export snapshot');
    }
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
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <div className="flex flex-1 flex-col px-4 py-10">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-card">
            <QuikCoachWordmark className="text-2xl" quikClassName="italic text-indigo-600" />
            <Link
              to="/"
              className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              ← Home
            </Link>
            <h1 className="font-display mt-3 text-xl font-bold text-ink-900">Teacher dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">
              Create a room with a 4-digit code, or enter an existing code. Students use the same code to join.
            </p>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Room code
              </label>
              <div className="flex gap-2">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="e.g. 4821"
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-mono text-lg tracking-widest outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
                  maxLength={4}
                />
                <button
                  type="button"
                  onClick={() => setCodeInput(randomRoomCode())}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Random
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={createOrJoin}
                className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lift hover:bg-indigo-700"
              >
                Open room
              </button>
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

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-indigo-50/40">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Teacher</p>
            <h1 className="font-display text-xl font-bold text-ink-900">
              Room <span className="font-mono text-indigo-600">{codeInput}</span>
            </h1>
          </div>
          <Link to="/" className="text-sm font-medium text-slate-500 hover:text-indigo-600">
            Home
          </Link>
        </div>
      </header>

      <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-1 flex-col gap-2 sm:max-w-md">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
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
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800"
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
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
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
                  : 'border border-slate-200 bg-white text-slate-800 hover:border-amber-200'
              }`}
            >
              {frozen ? 'Class frozen' : 'Freeze class'}
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lift hover:bg-indigo-700"
          >
            Prepare feedback
          </button>
          <span className="text-xs text-slate-500">
            Mode:{' '}
            <strong className="text-slate-700">
              {MODE_LABELS[normalizeFeedbackMode(room?.genre)] || 'Writing'}
            </strong>
            {room?.feedback_toggles?.subjectAssist &&
              room.feedback_toggles.subjectAssist !== 'general' && (
                <>
                  {' '}
                  · Subject:{' '}
                  <strong className="text-slate-700">
                    {SUBJECT_ASSIST_OPTIONS.find((o) => o.id === room.feedback_toggles.subjectAssist)
                      ?.label || room.feedback_toggles.subjectAssist}
                  </strong>
                </>
              )}
            {room?.feedback_toggles?.yearLevel &&
              room.feedback_toggles.yearLevel !== 'general' && (
                <>
                  {' '}
                  · Year:{' '}
                  <strong className="text-slate-700">
                    {YEAR_LEVEL_OPTIONS.find((o) => o.id === room.feedback_toggles.yearLevel)?.label ||
                      room.feedback_toggles.yearLevel}
                  </strong>
                </>
              )}
          </span>
          {copyToast && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              {copyToast}
            </span>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[10rem] flex-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Show group</label>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
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
              title="Stored on the server in the class database (room_snapshots), not as a file on your computer"
              onClick={saveSnapshot}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Save snapshot
            </button>
            <button
              type="button"
              onClick={exportCurrentCsv}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:border-indigo-200"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={exportCurrentJson}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:border-indigo-200"
            >
              Export JSON
            </button>
          </div>
          <p className="w-full text-xs text-slate-500">
            <strong className="text-slate-700">Broadcast</strong>: tick students, then send — anonymised exemplars on
            student screens (max 6). <strong>Show group</strong> filters the grid and Copy for AI / paste-back order.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderedStudents.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-slate-500">
              Waiting for students to join…
            </div>
          )}
          {orderedStudents.length > 0 && visibleStudents.length === 0 && (
            <div className="col-span-full rounded-2xl border border-amber-200 bg-amber-50/80 p-6 text-center text-sm text-amber-950">
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
                className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg font-semibold text-ink-900">{s.name}</h2>
                    <p className="text-xs text-slate-500">ID #{s.id}</p>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-violet-800">
                      <input
                        type="checkbox"
                        checked={!!broadcastPick[s.id]}
                        onChange={() =>
                          setBroadcastPick((p) => ({ ...p, [s.id]: !p[s.id] }))
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600"
                      />
                      Include in broadcast
                    </label>
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Group</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {TABLE_GROUP_LETTERS.map((letter) => {
                          const current = normalizedTableGroup(s.class_group);
                          const active = current === letter;
                          return (
                            <button
                              key={letter}
                              type="button"
                              aria-pressed={active}
                              title={`Table ${letter}`}
                              onClick={() =>
                                setStudentTableGroup(s.id, active ? '' : letter)
                              }
                              className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition ${
                                active
                                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                                  : 'border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-800'
                              }`}
                            >
                              {letter}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setStudentTableGroup(s.id, '')}
                          className="ml-0.5 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                        >
                          Clear
                        </button>
                      </div>
                      {normalizedTableGroup(s.class_group) === null &&
                        String(s.class_group || '').trim() !== '' && (
                          <p className="mt-1 text-[10px] text-amber-700">
                            Legacy label &quot;{String(s.class_group).slice(0, 24)}
                            …&quot; — pick A–E or Clear to replace.
                          </p>
                        )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span title="Activity" className={`h-2.5 w-2.5 rounded-full ${light}`} />
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                      {wc} words
                    </span>
                  </div>
                </div>
                <div className="mt-3 max-h-40 overflow-auto rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 scrollbar-thin">
                  {displayText || <span className="text-slate-400 italic">No text yet</span>}
                </div>
              </article>
            );
          })}
        </div>

        {snapshots.length > 0 && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <h3 className="font-display text-lg font-semibold text-ink-900">Snapshots</h3>
            <p className="mt-1 text-sm text-slate-600">
              Point-in-time copies of every draft in the room (saved on the server in SQLite, table{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">room_snapshots</code> in{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">server/data/classroom.db</code>). View here or export
              JSON for your own archive.
            </p>
            <ul className="mt-3 divide-y divide-slate-100">
              {snapshots.map((sn) => (
                <li key={sn.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-slate-800">
                    <span className="font-medium">{sn.label || `Snapshot #${sn.id}`}</span>
                    <span className="ml-2 text-xs text-slate-500">{sn.created_at}</span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => loadSnapshotForView(sn.id)}
                      className="rounded-lg text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => exportSnapshotJsonFile(sn.id)}
                      className="rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900"
                    >
                      Export JSON
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <h3 className="font-display text-lg font-semibold text-ink-900">Copy for AI</h3>
            <p className="mt-1 text-sm text-slate-600">
              Builds a structured prompt from feedback mode, subject, year level, toggles, custom focuses, and each
              visible student&apos;s draft (respects <strong>Show group</strong> above).
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Payload: ~{aiPayloadStats.promptKb} KB · {aiPayloadStats.totalDraftWords} words of student drafts
              {visibleStudents.length > 0 ? ` · ${visibleStudents.length} students` : ''}
            </p>
            {aiPayloadStats.level === 'warn' && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Large prompt — some AI tools may slow down or truncate. Consider copying in two batches (e.g. half the
                class) or nudging students with the word target.
              </p>
            )}
            {aiPayloadStats.level === 'heavy' && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Very large prompt — high risk of truncation or errors. Batch students (smaller groups per copy) or lower
                the word target before feedback rounds.
              </p>
            )}
            <button
              type="button"
              onClick={copyForAi}
              className="mt-4 w-full rounded-xl border border-indigo-200 bg-indigo-50 py-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
            >
              Copy for AI
            </button>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">Preview prompt</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 scrollbar-thin">
                {aiPrompt}
              </pre>
            </details>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <h3 className="font-display text-lg font-semibold text-ink-900">Paste back</h3>
            <p className="mt-1 text-sm text-slate-600">
              Paste numbered ChatGPT output (e.g. <code className="rounded bg-slate-100 px-1">1. [Feedback]</code>
              ). Items are matched to <strong>visible</strong> students in list order (same order as Copy for AI).
            </p>
            <textarea
              value={pasteBox}
              onChange={(e) => setPasteBox(e.target.value)}
              rows={8}
              placeholder={`1. [Feedback for first student]\n2. [Feedback for second student]`}
              className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
            />
            <button
              type="button"
              onClick={distributePaste}
              className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Distribute to students
            </button>
          </div>
        </section>
      </main>

      <AppFooter />

      {snapshotViewer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink-900">
                {snapshotViewer.label || `Snapshot #${snapshotViewer.id}`}
              </h2>
              <button
                type="button"
                onClick={() => setSnapshotViewer(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5 text-sm scrollbar-thin">
              <p className="text-xs text-slate-500">{snapshotViewer.created_at}</p>
              {(snapshotViewer.payload?.students || []).map((st) => (
                <div key={st.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-ink-900">
                    {st.name}
                    {st.class_group ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">({st.class_group})</span>
                    ) : null}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{st.text || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ink-900">Prepare feedback</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5 scrollbar-thin">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-indigo-200'
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
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Subject
                  </label>
                  <select
                    id="subject"
                    value={subjectAssist}
                    onChange={(e) => setSubjectAssist(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
                  >
                    {SUBJECT_ASSIST_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Guides the AI with subject expectations (does not change student view).
                  </p>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="year-level"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Year level
                  </label>
                  <select
                    id="year-level"
                    value={yearLevel}
                    onChange={(e) => setYearLevel(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
                  >
                    {YEAR_LEVEL_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Age-appropriate vocabulary and complexity for the AI (does not change student view).
                  </p>
                </div>
              </div>

              {feedbackMode === 'custom' ? (
                <div>
                  <label
                    htmlFor="custom-focus"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Custom focus
                  </label>
                  <textarea
                    id="custom-focus"
                    value={customFocusText}
                    onChange={(e) => setCustomFocusText(e.target.value)}
                    rows={3}
                    placeholder="e.g. Focus on use of evidence and paragraph control"
                    className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Focus toggles</p>
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
                            className="shrink-0 rounded-lg border border-slate-200 px-2.5 text-sm font-semibold text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
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
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                          className="shrink-0 rounded-lg border border-slate-200 px-2.5 text-sm font-semibold text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
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
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-indigo-500 focus:border-indigo-500 focus:ring-2"
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
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200"
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
