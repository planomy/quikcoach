import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createSocket } from '../lib/socket.js';
import { truncateToWordLimit } from '../lib/text.js';
import { fileToCompressedJpegDataUrl } from '../lib/image.js';
import AppFooter from '../components/AppFooter.jsx';
import IBoardWordmark from '../components/IBoardWordmark.jsx';
import StudentGradeSelect from '../components/StudentGradeSelect.jsx';
import SupaCoachLink from '../components/SupaCoachLink.jsx';
import PulseLink from '../components/PulseLink.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import LiveResponseStudent from '../components/LiveResponseStudent.jsx';
import AudienceQnaStudent from '../components/AudienceQnaStudent.jsx';
import StudentInbox from '../components/StudentInbox.jsx';
import RichTextEditor from '../components/RichTextEditor.jsx';
import StudentAnnotationController from '../components/StudentAnnotationController.jsx';
import AnnotatedStudentImage from '../components/AnnotatedStudentImage.jsx';
import { plainTextToRichHtml } from '../lib/richText.js';
import { downloadTextFile, safeFilePart, stampForFilename } from '../lib/exportRoom.js';
import { readDraftBackup, saveDraftBackup } from '../lib/draftBackup.js';
import {
  clearStudentSession,
  forgetRecentStudentSession,
  readSavedStudentSession,
  recentStudentSessionForRoom,
  saveStudentSession,
} from '../lib/studentSession.js';
import { dismissInboxItem as persistInboxDismiss, readDismissedInboxIds } from '../lib/inboxDismiss.js';
import { parseInboxAt } from '../lib/inboxTime.js';

function feedbackInboxItem(item, { fallbackAt = 0 } = {}) {
  const feedbackId = Number(item?.feedbackId) || 0;
  const text = String(item?.text || '');
  const createdAt = String(item?.createdAt || '');
  const at = parseInboxAt(item) || fallbackAt;
  return {
    id: feedbackId
      ? `feedback-${feedbackId}`
      : `feedback-${Number(item?.studentId) || 0}-${createdAt}-${text}`,
    type: 'note',
    text,
    at,
  };
}

function mergeFeedbackInbox(previous, incoming, { liveFallbackAt = 0 } = {}) {
  const byId = new Map();
  for (const item of previous) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const raw of incoming) {
    const item = feedbackInboxItem(raw, { fallbackAt: liveFallbackAt });
    if (item.text) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}

const SUPPORT_TABS = [
  { id: 'ask', label: 'Ask' },
  { id: 'respond', label: 'Respond' },
  { id: 'inbox', label: 'Inbox' },
];

function draftFromJoin({ raw, richHtml, code, studentId, limit }) {
  const next = limit > 0 ? truncateToWordLimit(raw, limit) : raw;
  const backup = readDraftBackup(code, studentId);
  if (!next.trim() && backup?.text?.trim()) {
    const text = limit > 0 ? truncateToWordLimit(backup.text, limit) : backup.text;
    return {
      text,
      html: backup.richHtml || plainTextToRichHtml(text),
    };
  }
  return {
    text: next,
    html: next === raw && richHtml ? richHtml : plainTextToRichHtml(next),
  };
}

export default function StudentView() {
  const [searchParams] = useSearchParams();
  const codeFromLink = String(searchParams.get('code') || '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const [codeInput, setCodeInput] = useState(codeFromLink);
  const [nameInput, setNameInput] = useState('');
  const [student, setStudent] = useState(null);
  const [room, setRoom] = useState(null);
  const [draft, setDraft] = useState('');
  const [draftHtml, setDraftHtml] = useState('');
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [feedbackInbox, setFeedbackInbox] = useState([]);
  const [broadcastHistory, setBroadcastHistory] = useState([]);
  const [materialHistory, setMaterialHistory] = useState([]);
  const [supportTab, setSupportTab] = useState('inbox');
  const [inboxExpandedId, setInboxExpandedId] = useState(null);
  const [inboxUnreadIds, setInboxUnreadIds] = useState(() => new Set());
  const [dismissedInboxIds, setDismissedInboxIds] = useState(() => new Set());
  const [largeMaterialId, setLargeMaterialId] = useState(null);
  const [respondPendingCount, setRespondPendingCount] = useState(0);
  const [timesUp, setTimesUp] = useState(false);
  const [connBanner, setConnBanner] = useState(null); // 'lost' | 'online' | null
  const [helpSeenToast, setHelpSeenToast] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageHint, setImageHint] = useState('');
  const [yearInput, setYearInput] = useState('');
  const [recentDismissedCode, setRecentDismissedCode] = useState('');

  const socket = useMemo(() => createSocket(), []);
  const pendingRef = useRef({ text: '', richTextHtml: '' });
  const lastSentRef = useRef('');
  const saveBootstrappedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const studentRef = useRef(null);
  /** Until React commits `student`, `room:state` may arrive first; match payload by this id. */
  const hydrateStudentIdRef = useRef(null);
  const wasDisconnectedRef = useRef(false);
  const onlineBannerTimerRef = useRef(null);
  const helpSeenTimerRef = useRef(null);
  const supportTabRef = useRef(supportTab);
  const broadcastBootstrappedRef = useRef(false);
  const lastBroadcastAtRef = useRef(null);
  const materialBootstrappedRef = useRef(false);
  const lastMaterialAtRef = useRef(null);

  useEffect(() => {
    studentRef.current = student;
  }, [student]);

  useEffect(() => {
    supportTabRef.current = supportTab;
  }, [supportTab]);

  useEffect(() => {
    if (!joined) return undefined;
    document.documentElement.classList.add('iboard-student-workspace');
    return () => document.documentElement.classList.remove('iboard-student-workspace');
  }, [joined]);

  function activateInbox(itemId) {
    setSupportTab('inbox');
    setInboxExpandedId(itemId);
    setInboxUnreadIds((current) => {
      const next = new Set(current);
      next.add(itemId);
      return next;
    });
  }

  function dismissInboxItem(itemId) {
    const code = String(room?.code || codeInput || '').replace(/\D/g, '').slice(0, 4);
    const sid = Number(student?.id);
    if (code.length !== 4 || !sid) return;
    persistInboxDismiss(code, sid, itemId);
    setDismissedInboxIds((current) => {
      const next = new Set(current);
      next.add(String(itemId));
      return next;
    });
    setInboxExpandedId((current) => (current === itemId ? null : current));
    setLargeMaterialId((current) => (current === itemId ? null : current));
    setInboxUnreadIds((current) => {
      if (!current.has(itemId)) return current;
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
  }

  useEffect(() => {
    const sid = Number(student?.id);
    const code = String(room?.code || codeInput || '').replace(/\D/g, '').slice(0, 4);
    if (!joined || !sid || code.length !== 4) {
      setDismissedInboxIds(new Set());
      return;
    }
    setDismissedInboxIds(readDismissedInboxIds(code, sid));
  }, [joined, student?.id, room?.code, codeInput]);

  function selectSupportTab(tabId) {
    setSupportTab(tabId);
    if (tabId === 'inbox') {
      setInboxUnreadIds(new Set());
    }
    if (tabId === 'respond') {
      setRespondPendingCount(0);
    }
  }

  useEffect(() => {
    socket.connect();
    return () => socket.disconnect();
  }, [socket]);

  // Connection status banner (lost / brief back-online)
  useEffect(() => {
    const onConnect = () => {
      if (!wasDisconnectedRef.current) return;
      wasDisconnectedRef.current = false;
      setConnBanner('online');
      if (onlineBannerTimerRef.current) clearTimeout(onlineBannerTimerRef.current);
      onlineBannerTimerRef.current = setTimeout(() => setConnBanner(null), 2500);
    };
    const onDisconnect = () => {
      wasDisconnectedRef.current = true;
      if (onlineBannerTimerRef.current) clearTimeout(onlineBannerTimerRef.current);
      setConnBanner('lost');
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      if (onlineBannerTimerRef.current) clearTimeout(onlineBannerTimerRef.current);
    };
  }, [socket]);

  // After Wi‑Fi blips, rejoin the room so broadcasts / live sync still work
  useEffect(() => {
    const onConnect = () => {
      try {
        const saved = readSavedStudentSession();
        if (!saved) return;
        const { code, studentId } = saved;
        if (!code || !studentId) return;
        const savedCode = String(code).replace(/\D/g, '').slice(0, 4);
        if (codeFromLink && savedCode !== codeFromLink) {
          clearStudentSession();
          return;
        }
        const sidNum = Number(studentId);
        if (!sidNum) return;
        hydrateStudentIdRef.current = sidNum;
        socket.emit('student:rejoin', { code, studentId: sidNum }, (ack) => {
          if (!ack?.ok) return;
          saveStudentSession({
            code,
            studentId: ack.student?.id ?? sidNum,
            name: ack.student?.name || saved.name,
          });
          if (ack.student) setStudent(ack.student);
          if (ack.room) setRoom(ack.room);
          setJoined(true);
        });
      } catch {
        /* ignore */
      }
    };
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [codeFromLink, socket]);

  useEffect(() => {
    const onState = (payload) => {
      setRoom(payload.room || null);
      const sid = studentRef.current?.id ?? hydrateStudentIdRef.current;
      if (!sid || !payload.students) return;
      const me = payload.students.find((s) => s.id === sid);
      if (!me) return;
      hydrateStudentIdRef.current = null;
      setStudent(me);
      const typing = !!document.activeElement?.isContentEditable;
      const r = payload.room;
      const lim =
        r?.enforce_word_count && (r?.word_target ?? 0) > 0 ? Number(r.word_target) : 0;
      const raw = me.text || '';
      if (!typing) {
        const next = lim > 0 ? truncateToWordLimit(raw, lim) : raw;
        setDraft(next);
        setDraftHtml(
          next === raw && me.rich_text_html ? me.rich_text_html : plainTextToRichHtml(next)
        );
      }
    };
    const onLive = ({ student: s }) => {
      const sid = studentRef.current?.id ?? hydrateStudentIdRef.current;
      if (!sid || !s?.id || Number(s.id) !== Number(sid)) return;
      setStudent((prev) => ({ ...(prev || {}), ...s }));
    };
    const onBatch = ({ items, replay }) => {
      const sid =
        studentRef.current?.id ??
        hydrateStudentIdRef.current ??
        Number(readSavedStudentSession()?.studentId);
      if (!sid || !Array.isArray(items)) return;
      const mine = items.filter((i) => Number(i?.studentId) === Number(sid));
      if (!mine.length) return;
      const liveFallbackAt = replay ? 0 : Date.now();
      const mapped = mine.map((item) => feedbackInboxItem(item, { fallbackAt: liveFallbackAt })).filter((item) => item.text);
      setFeedbackInbox((prev) => mergeFeedbackInbox(prev, mine, { liveFallbackAt }));
      if (replay) return;
      const newest = mapped.reduce(
        (best, item) => (!best || Number(item.at) > Number(best.at) ? item : best),
        null
      );
      if (newest) activateInbox(newest.id);
    };
    const onBroadcast = (payload = {}) => {
      const serverHistory = Array.isArray(payload.history)
        ? payload.history.filter((entry) => Array.isArray(entry?.items)).slice(-10)
        : null;
      const items = Array.isArray(payload.items) ? payload.items : [];
      const entry = items.length ? { items, at: Number(payload.at) || Date.now() } : null;

      setBroadcastHistory((previous) => {
        let nextHistory;
        if (serverHistory) nextHistory = serverHistory;
        else if (entry) {
          const deduped = previous.filter((old) => Number(old?.at) !== Number(entry.at));
          nextHistory = [...deduped, entry].slice(-10);
        } else {
          nextHistory = [];
        }

        const latest = nextHistory[nextHistory.length - 1];
        const latestAt = latest ? Number(latest.at) || 0 : 0;
        const hadBootstrap = broadcastBootstrappedRef.current;
        const isNew = hadBootstrap && latestAt && latestAt !== Number(lastBroadcastAtRef.current || 0);
        lastBroadcastAtRef.current = latestAt || null;
        broadcastBootstrappedRef.current = true;

        if (isNew && latest?.items?.length) {
          queueMicrotask(() => activateInbox(`broadcast-${latestAt}`));
        }
        return nextHistory;
      });
    };
    const onMaterial = (payload) => {
      const serverHistory = Array.isArray(payload?.history)
        ? payload.history.filter((entry) => entry && entry.id && entry.url)
        : null;
      if (payload?.cleared) {
        setMaterialHistory([]);
        lastMaterialAtRef.current = null;
        materialBootstrappedRef.current = true;
        return;
      }
      const isReplay = !!payload?.replay;
      setMaterialHistory((previous) => {
        let nextHistory;
        if (serverHistory) nextHistory = serverHistory.slice(-20);
        else if (payload?.item?.id && payload.item.url) {
          const deduped = previous.filter((old) => old.id !== payload.item.id);
          nextHistory = [...deduped, payload.item].slice(-20);
        } else {
          nextHistory = previous;
        }
        const latest = nextHistory[nextHistory.length - 1];
        const latestAt = latest ? Number(latest.at) || 0 : 0;
        const prevAt = Number(lastMaterialAtRef.current || 0);
        // Notify on any live send newer than what we've seen — including the first
        // handout after join (empty history never bootstrapped the old gate).
        const shouldNotify = !isReplay && !!latest?.id && latestAt > prevAt;
        lastMaterialAtRef.current = latestAt > prevAt ? latestAt : prevAt || null;
        materialBootstrappedRef.current = true;
        if (shouldNotify) {
          queueMicrotask(() => {
            setInboxUnreadIds((current) => {
              const next = new Set(current);
              next.add(latest.id);
              return next;
            });
            // Keep writing focus: only open Inbox if they're already there.
            if (supportTabRef.current === 'inbox') {
              setInboxExpandedId(latest.id);
            }
          });
        }
        return nextHistory;
      });
    };
    const showRespondBadge = (activity) => {
      if (!activity?.id) {
        setRespondPendingCount(0);
        return;
      }
      if (supportTabRef.current === 'respond') {
        setRespondPendingCount(0);
        return;
      }
      // Count of live questions still waiting for this student — not the Q number.
      setRespondPendingCount(1);
    };
    const onLiveActivity = (payload) => {
      if (payload?.activity?.id) showRespondBadge(payload.activity);
      else setRespondPendingCount(0);
    };
    const onLiveRealert = (payload) => {
      if (payload?.activity?.id) showRespondBadge(payload.activity);
    };
    const onLiveStudent = (payload) => {
      if (!payload?.activity?.id) {
        setRespondPendingCount(0);
        return;
      }
      if (payload?.response?.value) {
        setRespondPendingCount(0);
      }
    };
    const onLiveNudge = () => {
      setSupportTab('respond');
    };
    const onLiveHelpSeen = () => {
      setHelpSeenToast(true);
      if (helpSeenTimerRef.current) clearTimeout(helpSeenTimerRef.current);
      helpSeenTimerRef.current = setTimeout(() => setHelpSeenToast(false), 4000);
    };
    const onTimesUp = () => setTimesUp(true);
    socket.on('room:state', onState);
    socket.on('student:live', onLive);
    socket.on('feedback:batch', onBatch);
    socket.on('broadcast:exemplars', onBroadcast);
    socket.on('inbox:material', onMaterial);
    socket.on('live:activity', onLiveActivity);
    socket.on('live:realert', onLiveRealert);
    socket.on('live:student', onLiveStudent);
    socket.on('live:nudge', onLiveNudge);
    socket.on('live:help-seen', onLiveHelpSeen);
    socket.on('timer:times-up', onTimesUp);
    return () => {
      socket.off('room:state', onState);
      socket.off('student:live', onLive);
      socket.off('feedback:batch', onBatch);
      socket.off('broadcast:exemplars', onBroadcast);
      socket.off('inbox:material', onMaterial);
      socket.off('live:activity', onLiveActivity);
      socket.off('live:realert', onLiveRealert);
      socket.off('live:student', onLiveStudent);
      socket.off('live:nudge', onLiveNudge);
      socket.off('live:help-seen', onLiveHelpSeen);
      socket.off('timer:times-up', onTimesUp);
      if (helpSeenTimerRef.current) clearTimeout(helpSeenTimerRef.current);
    };
  }, [socket]);

  // Recover the durable mailbox only after React has committed the student identity.
  // This closes the join/rejoin race even if the server replay arrived during startup.
  useEffect(() => {
    const sid = Number(student?.id);
    if (!joined || !sid) return;
    socket.emit('student:feedback-sync', {}, (ack) => {
      if (!ack?.ok || !Array.isArray(ack.items)) return;
      const mine = ack.items.filter((item) => Number(item?.studentId) === sid);
      if (mine.length) setFeedbackInbox((prev) => mergeFeedbackInbox(prev, mine));
    });
  }, [joined, student?.id, socket]);

  useEffect(() => {
    pendingRef.current = { text: draft, richTextHtml: draftHtml };
  }, [draft, draftHtml]);

  useEffect(() => {
    if (!joined || !student?.id) {
      saveBootstrappedRef.current = false;
      return undefined;
    }

    const fingerprint = `${draft}\n${draftHtml}`;
    if (!saveBootstrappedRef.current) {
      saveBootstrappedRef.current = true;
      lastSentRef.current = fingerprint;
      return undefined;
    }
    if (fingerprint === lastSentRef.current) return undefined;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const payload = pendingRef.current;
      const sentAt = `${payload.text}\n${payload.richTextHtml}`;
      socket.emit('student:text', payload, (ack) => {
        if (sentAt !== `${pendingRef.current.text}\n${pendingRef.current.richTextHtml}`) return;
        if (ack && ack.ok === false) return;
        lastSentRef.current = sentAt;
      });
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [joined, student?.id, draft, draftHtml, socket]);

  useEffect(() => {
    if (!joined || !student?.id) return undefined;
    const code = String(room?.code || codeInput || '').replace(/\D/g, '').slice(0, 4);
    if (code.length !== 4) return undefined;
    const t = setTimeout(() => {
      saveDraftBackup({
        code,
        studentId: student.id,
        name: student.name,
        text: draft,
        richHtml: draftHtml,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [joined, student?.id, student?.name, room?.code, codeInput, draft, draftHtml]);

  useEffect(() => {
    if (!joined || !room) return;
    const wt = room.word_target ?? 0;
    if (!room.enforce_word_count || wt <= 0) return;
    setDraft((d) => {
      const next = truncateToWordLimit(d, wt);
      if (next !== d) setDraftHtml(plainTextToRichHtml(next));
      return next;
    });
  }, [joined, room?.enforce_word_count, room?.word_target]);

  useEffect(() => {
    let cancelled = false;
    try {
      const saved = readSavedStudentSession();
      if (!saved) return;
      const { code, studentId } = saved;
      if (!code || !studentId) return;
      const savedCode = String(code).replace(/\D/g, '').slice(0, 4);
      if (codeFromLink && savedCode !== codeFromLink) {
        hydrateStudentIdRef.current = null;
        clearStudentSession();
        return;
      }
      const sidNum = Number(studentId);
      if (!sidNum) return;
      hydrateStudentIdRef.current = sidNum;
      socket.emit('student:rejoin', { code, studentId }, (ack) => {
        if (cancelled) return;
        if (!ack?.ok) {
          hydrateStudentIdRef.current = null;
          try {
            clearStudentSession();
          } catch {
            /* ignore */
          }
          setError(ack?.error || 'Could not restore session — join again.');
          return;
        }
        hydrateStudentIdRef.current = ack.student?.id ?? sidNum;
        saveStudentSession({
          code,
          studentId: ack.student?.id ?? sidNum,
          name: ack.student?.name || saved.name,
        });
        setCodeInput(code);
        setStudent(ack.student);
        if (ack.room) setRoom(ack.room);
        const lim =
          ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
            ? Number(ack.room.word_target)
            : 0;
        const raw = ack.student.text || '';
        const joinedDraft = draftFromJoin({
          raw,
          richHtml: ack.student?.rich_text_html,
          code,
          studentId: ack.student?.id ?? sidNum,
          limit: lim,
        });
        setDraft(joinedDraft.text);
        setDraftHtml(joinedDraft.html);
        setJoined(true);
        const yl = String(ack.student?.year_level || '').trim().toLowerCase();
        if (yl) setYearInput(yl);
      });
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, [codeFromLink, socket]);

  const recentRoomSession = useMemo(() => {
    const code = String(codeInput || '').replace(/\D/g, '').slice(0, 4);
    if (code.length !== 4 || recentDismissedCode === code) return null;
    return recentStudentSessionForRoom(code);
  }, [codeInput, recentDismissedCode]);

  function continueRecentRoom() {
    const saved = recentRoomSession;
    if (!saved) return;
    setError('');
    hydrateStudentIdRef.current = saved.studentId;
    socket.emit('student:rejoin', { code: saved.code, studentId: saved.studentId }, (ack) => {
      if (!ack?.ok || !ack.student) {
        hydrateStudentIdRef.current = null;
        forgetRecentStudentSession(saved.code);
        setRecentDismissedCode(saved.code);
        setError('That previous student card is no longer available. Enter your name to join.');
        return;
      }

      hydrateStudentIdRef.current = ack.student.id;
      saveStudentSession({
        code: saved.code,
        studentId: ack.student.id,
        name: ack.student.name || saved.name,
      });
      setCodeInput(saved.code);
      setStudent(ack.student);
      if (ack.room) setRoom(ack.room);

      const limit =
        ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
          ? Number(ack.room.word_target)
          : 0;
      const raw = ack.student.text || '';
      const joinedDraft = draftFromJoin({
        raw,
        richHtml: ack.student?.rich_text_html,
        code: saved.code,
        studentId: ack.student.id,
        limit,
      });
      setDraft(joinedDraft.text);
      setDraftHtml(joinedDraft.html);
      const savedYear = String(ack.student.year_level || '').trim().toLowerCase();
      if (savedYear) setYearInput(savedYear);
      setJoined(true);
    });
  }

  function join() {
    setError('');
    const c = codeInput.replace(/\D/g, '').slice(0, 4).padStart(4, '0');
    const n = nameInput.trim();
    if (c.length !== 4 || !n) {
      setError('Enter 4-digit code and your name.');
      return;
    }
    socket.emit('student:join', { code: c, name: n }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not join');
        return;
      }
      hydrateStudentIdRef.current = ack.student?.id ?? null;
      saveStudentSession({ code: c, studentId: ack.student.id, name: ack.student?.name || n });
      setStudent(ack.student);
      if (ack.room) setRoom(ack.room);
      const lim =
        ack.room?.enforce_word_count && (ack.room?.word_target ?? 0) > 0
          ? Number(ack.room.word_target)
          : 0;
      const raw = ack.student.text || '';
      const joinedDraft = draftFromJoin({
        raw,
        richHtml: ack.student?.rich_text_html,
        code: c,
        studentId: ack.student.id,
        limit: lim,
      });
      setDraft(joinedDraft.text);
      setDraftHtml(joinedDraft.html);
      setJoined(true);
      const fromServer = String(ack.student?.year_level || '').trim().toLowerCase();
      const chosen = String(yearInput || '').trim().toLowerCase();
      if (chosen) {
        setYearInput(chosen);
        socket.emit('student:year', { year_level: chosen }, (yAck) => {
          if (yAck?.ok && yAck.student) setStudent(yAck.student);
        });
      } else if (fromServer) {
        setYearInput(fromServer);
      }
    });
  }

  async function onDraftPaste(e) {
    if (frozen) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      setImageBusy(true);
      setImageHint('');
      try {
        const dataUrl = await fileToCompressedJpegDataUrl(file);
        socket.emit(
          'student:image',
          { imageBase64: dataUrl, mimeType: 'image/jpeg' },
          (ack) => {
            setImageBusy(false);
            if (!ack?.ok) {
              setError(ack?.error || 'Could not save image');
              return;
            }
            if (ack.student) setStudent(ack.student);
            setImageHint('Image added to your card');
            setTimeout(() => setImageHint(''), 2500);
          }
        );
      } catch {
        setImageBusy(false);
        setError('Could not read that image');
      }
      return;
    }
  }

  function setMyYearLevel(year_level) {
    const y = String(year_level || '').trim().toLowerCase();
    setYearInput(y);
    setStudent((s) => (s ? { ...s, year_level: y } : s));
    if (!joined) return;
    socket.emit('student:year', { year_level: y }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Could not save year level');
        return;
      }
      if (ack.student) setStudent(ack.student);
    });
  }

  async function saveDraftToDevice() {
    if (!student?.id || !activeRoomCode) return;
    saveDraftBackup({
      code: activeRoomCode,
      studentId: student.id,
      name: student.name,
      text: draft,
      richHtml: draftHtml,
    });
    const filename = `iboard-${safeFilePart(student.name)}-room${activeRoomCode}-${stampForFilename()}.txt`;
    const result = await downloadTextFile(filename, draft, 'text/plain;charset=utf-8');
    if (result?.method === 'cancelled') return;
    setImageHint(result?.method === 'picker' ? 'Draft saved' : 'Draft downloaded');
    setTimeout(() => setImageHint(''), 2500);
  }

  function changeRoom() {
    clearStudentSession();
    hydrateStudentIdRef.current = null;
    studentRef.current = null;
    try {
      socket.disconnect();
    } catch {
      /* Page navigation will still close the old room connection. */
    }
    window.location.assign('/student');
  }

  function clearMyImage() {
    if (frozen) return;
    socket.emit('student:image-clear', {}, (ack) => {
      if (!ack?.ok) {
        setError('Could not remove image');
        return;
      }
      if (ack.student) setStudent(ack.student);
      else setStudent((s) => (s ? { ...s, image_url: null } : s));
    });
  }

  const activeRoomDigits = String(room?.code || codeInput || '').replace(/\D/g, '').slice(0, 4);
  const activeRoomCode = activeRoomDigits ? activeRoomDigits.padStart(4, '0') : '';
  const wt = room?.word_target ?? 0;
  const enforce = !!room?.enforce_word_count;
  const frozen = !!room?.freeze_class;
  const inboxItems = useMemo(() => {
    const notes = feedbackInbox.map((item) => ({
      ...item,
      unread: inboxUnreadIds.has(item.id),
    }));
    const broadcasts = broadcastHistory
      .filter((entry) => Array.isArray(entry?.items) && entry.items.length)
      .map((entry) => {
        const at = Number(entry.at) || 0;
        const id = `broadcast-${at}`;
        return {
          id,
          type: 'broadcast',
          at,
          exemplars: entry.items,
          unread: inboxUnreadIds.has(id),
        };
      });
    const materials = materialHistory.map((entry) => ({
      ...entry,
      type: 'material',
      unread: inboxUnreadIds.has(entry.id),
    }));
    return [...notes, ...broadcasts, ...materials]
      .filter((item) => !dismissedInboxIds.has(item.id) && !dismissedInboxIds.has(String(item.id)))
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  }, [feedbackInbox, broadcastHistory, materialHistory, inboxUnreadIds, dismissedInboxIds]);
  const inboxTabCount = inboxUnreadIds.size;

  if (!joined) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-1 flex-col px-4 py-10">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <IBoardWordmark className="text-2xl" iClassName="italic text-indigo-600" />
              <ThemeToggle />
            </div>
            <h1 className="font-display mt-6 text-xl font-bold text-ink-900 dark:text-slate-100">Join your class</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Your writing appears on your teacher’s screen as you type. Live questions can also show up here.
            </p>
            <div className="mt-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Room code from your teacher</label>
              <input
                value={codeInput}
                onChange={(e) => {
                  setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setRecentDismissedCode('');
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 font-mono text-lg outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                placeholder="0000"
                inputMode="numeric"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              {recentRoomSession ? (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/50">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
                    Returning student
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    You previously joined this room as
                  </p>
                  <p className="mt-1 font-display text-lg font-black text-slate-950 dark:text-white">
                    {recentRoomSession.name || 'your previous student card'}
                  </p>
                  <button
                    type="button"
                    onClick={continueRecentRoom}
                    className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-lift hover:bg-indigo-700"
                  >
                    Continue and restore my work
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRecentDismissedCode(recentRoomSession.code);
                      setNameInput('');
                    }}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    This isn&apos;t me
                  </button>
                </div>
              ) : (
                <>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Your name</label>
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 outline-none ring-indigo-500 focus:border-indigo-500 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-600 focus:ring-2"
                    placeholder="Name as shown to teacher"
                  />
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Your year</label>
                  <StudentGradeSelect
                    value={yearInput}
                    onChange={setYearInput}
                    className="w-full !rounded-xl !px-3 !py-2.5 !text-sm"
                  />
                  <button
                    type="button"
                    onClick={join}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lift hover:bg-indigo-700"
                  >
                    Join and start writing
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="iboard-student-canvas flex min-h-screen flex-col dark:bg-slate-950">
      {timesUp && (
        <button
          type="button"
          onClick={() => setTimesUp(false)}
          className="fixed inset-0 z-[60] flex cursor-pointer items-center justify-center bg-red-950/50 px-6 backdrop-blur-[1px]"
          aria-live="assertive"
        >
          <div className="animate-pulse rounded-3xl border-4 border-red-400 bg-red-600 px-10 py-8 text-center shadow-2xl sm:px-14 sm:py-10">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-100">Timer</p>
            <p className="mt-2 font-display text-4xl font-black uppercase tracking-wide text-white sm:text-6xl">
              Time&apos;s up!
            </p>
            <p className="mt-3 text-sm font-semibold text-red-100">Tap to dismiss</p>
          </div>
        </button>
      )}
      {helpSeenToast && (
        <div
          role="status"
          className="fixed inset-x-4 top-4 z-[75] mx-auto max-w-md rounded-2xl bg-indigo-600 px-4 py-3 text-center shadow-lg ring-2 ring-white/80"
        >
          <p className="text-sm font-black text-white">Response seen</p>
        </div>
      )}
      {connBanner === 'lost' && (
        <div
          role="status"
          className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm font-semibold text-amber-800 shadow-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Connection lost — reconnecting…
        </div>
      )}
      {connBanner === 'online' && (
        <div
          role="status"
          className="sticky top-0 z-40 border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center text-sm font-semibold text-emerald-800 shadow-sm dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        >
          Back online
        </div>
      )}
      <header className="iboard-app-header border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {activeRoomCode && (
              <h1 className="font-display text-lg font-bold tracking-tight text-ink-900 dark:text-slate-100">
                Room <span className="iboard-header-code font-mono text-indigo-600">{activeRoomCode}</span>
              </h1>
            )}
            <span className="iboard-header-chip truncate rounded-full border border-indigo-100 bg-white/70 px-2.5 py-0.5 text-xs font-semibold text-slate-600 shadow-[0_1px_3px_rgba(79,70,229,0.06)] dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
              {student?.name}
            </span>
          </div>
          <details className="group relative shrink-0">
            <summary
              className="iboard-header-icon-button grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-500 [&::-webkit-details-marker]:hidden"
              aria-label="Student tools"
              title="Student tools"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h10" />
                <path d="M18 7h2" />
                <circle cx="16" cy="7" r="2" />
                <path d="M4 17h2" />
                <path d="M10 17h10" />
                <circle cx="8" cy="17" r="2" />
              </svg>
            </summary>
            <div className="absolute right-0 top-full z-50 mt-2 w-64 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Year level</p>
                <StudentGradeSelect
                  value={student?.year_level || yearInput}
                  onChange={setMyYearLevel}
                  className="w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  <span>Pulse</span>
                  <PulseLink size="md" code={codeInput} studentId={student?.id} />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  <span>SupaCoach</span>
                  <SupaCoachLink size="md" />
                </div>
              </div>
              <ThemeToggle className="w-full justify-center" />
              <button
                type="button"
                onClick={saveDraftToDevice}
                disabled={!draft.trim()}
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800 transition hover:border-indigo-300 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200"
              >
                Save draft to device
              </button>
              <button
                type="button"
                onClick={changeRoom}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Change room
              </button>
            </div>
          </details>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 xl:grid xl:max-w-none xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)] xl:items-start xl:gap-6">
          <aside className="order-1 flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden xl:col-start-2 xl:row-start-1">
            <nav aria-label="Student tools" className="relative z-10 flex shrink-0 items-end gap-1 overflow-visible border-b border-slate-200 pt-3.5 dark:border-slate-700">
              {SUPPORT_TABS.map((tab) => {
                const active = supportTab === tab.id;
                const badge = tab.id === 'inbox'
                  ? inboxTabCount
                  : tab.id === 'respond' && respondPendingCount > 0
                    ? respondPendingCount
                    : 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectSupportTab(tab.id)}
                    className={`relative inline-flex items-center overflow-visible rounded-t-lg px-3 py-2 text-[11px] font-bold transition sm:px-3.5 sm:text-xs ${
                      active
                        ? 'z-[1] -mb-px border border-b-white border-slate-200 bg-indigo-600 text-white shadow-sm dark:border-b-slate-900 dark:border-slate-600'
                        : 'border border-transparent bg-slate-200/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                    {badge ? (
                      <span
                        data-iboard-tab-badge=""
                        className="absolute left-1/2 top-0 z-[2] grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-rose-600 text-[10px] font-black tabular-nums leading-none text-white shadow-sm ring-2 ring-white dark:ring-slate-900"
                      >
                        {badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="iboard-student-support-scroll flex min-h-0 flex-1 flex-col gap-3">
            <div className={supportTab === 'ask' ? '' : 'hidden'}>
              <AudienceQnaStudent socket={socket} embedded />
            </div>
            <div className={supportTab === 'respond' ? '' : 'hidden'}>
              <LiveResponseStudent socket={socket} standalone />
            </div>
            <div className={supportTab === 'inbox' ? '' : 'hidden'}>
              <StudentInbox
                items={inboxItems}
                expandedId={inboxExpandedId}
                largeMaterialId={largeMaterialId}
                onToggleMaterialLarge={(id) => {
                  setLargeMaterialId((current) => (current === id ? null : id));
                  setInboxExpandedId(id);
                }}
                onToggle={(id) => {
                  setInboxExpandedId((current) => (current === id ? null : id));
                  setInboxUnreadIds((current) => {
                    if (!current.has(id)) return current;
                    const next = new Set(current);
                    next.delete(id);
                    return next;
                  });
                }}
                onDismiss={dismissInboxItem}
              />
            </div>
            </div>
          </aside>

          <section className="order-2 flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tip: paste a screenshot into the box to add an image to your board card.
            </p>
            {student?.image_url && (
              <div
                data-student-image-preview
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-900"
              >
                {student.teacher_markup_url && (
                  <p className="mb-2 inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-black text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                    Teacher correction
                  </p>
                )}
                <AnnotatedStudentImage
                  imageUrl={student.image_url}
                  markupUrl={student.teacher_markup_url}
                  alt="Your uploaded image"
                  imageClassName="max-h-56 w-full object-contain"
                />
                <button
                  type="button"
                  disabled={frozen || imageBusy}
                  onClick={clearMyImage}
                  className="mt-2 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  Remove image
                </button>
              </div>
            )}
            {(imageBusy || imageHint) && (
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                {imageBusy ? 'Uploading image…' : imageHint}
              </p>
            )}
            {error && joined && <p className="text-sm text-red-600">{error}</p>}
            <StudentAnnotationController socket={socket} studentId={student?.id} />
            <RichTextEditor
              text={draft}
              html={draftHtml}
              onChange={({ text, html }) => {
                setDraft(text);
                setDraftHtml(html);
              }}
              onPaste={onDraftPaste}
              disabled={frozen}
              maxWords={enforce && wt > 0 ? wt : 0}
              placeholder="Write here… or paste an image"
            />
          </section>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
