import { RemoveButton, CloseButton } from './PanelActions.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { confirmDialog } from './ConfirmDialogHost.jsx';
import {
  newId,
  normalizeSetQuestions,
  parsePastedQuestions,
} from '../lib/liveResponseSets.js';
import {
  QUESTION_SET_BANK,
  SUBJECTS,
  YEAR_BANDS,
  formatSetMeta,
  setMatchesFilters,
} from '../lib/questionSetBank.js';
import {
  applyBankOverride,
  loadBankOverrides,
  loadFavouriteIds,
  saveBankOverrides,
  saveFavouriteIds,
  sortSetsByFavourite,
  toggleFavouriteId,
} from '../lib/questionSetPrefs.js';

const CUSTOM_SETS_KEY = 'iboard-pulse-custom-sets';
const LEGACY_SETS_KEY = 'iboard-pulse-question-sets';
const LEGACY_TEMPLATE_KEY = 'iboard-pulse-question-templates';
const LEGACY_STARTER_IDS = new Set(['starter-source-analysis', 'starter-narrative']);

function StarIcon({ filled }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.6l2.4 4.86 5.36.78-3.88 3.78.92 5.34L12 15.9l-4.8 2.52.92-5.34-3.88-3.78 5.36-.78L12 3.6z" />
    </svg>
  );
}

function loadCustomSets() {
  const fromKey = (key) => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (!Array.isArray(saved)) return [];
      return saved
        .map((set) => {
          if (set?.bank || String(set?.id || '').startsWith('bank-') || LEGACY_STARTER_IDS.has(set?.id)) return null;
          const questions = normalizeSetQuestions(set?.questions);
          const name = String(set?.name || '').trim().slice(0, 80);
          if (!name || !questions.length) return null;
          return {
            id: String(set.id || newId('set')),
            name,
            subject: set.subject || 'General',
            years: set.years || 'All',
            skill: set.skill || 'Custom',
            minutes: Number(set.minutes) || Math.max(5, questions.length * 2),
            note: set.note || '',
            bank: false,
            questions,
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  const custom = fromKey(CUSTOM_SETS_KEY);
  if (custom.length) return custom.slice(0, 40);

  const migrated = fromKey(LEGACY_SETS_KEY);
  if (migrated.length) return migrated.slice(0, 40);

  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_TEMPLATE_KEY) || '[]');
    if (!Array.isArray(legacy) || !legacy.length) return [];
    return legacy
      .map((template) => {
        const questions = normalizeSetQuestions([template]);
        if (!questions.length) return null;
        return {
          id: String(template.id || newId('set')),
          name: questions[0].prompt.slice(0, 48),
          subject: 'General',
          years: 'All',
          skill: 'Custom',
          minutes: 5,
          note: '',
          bank: false,
          questions,
        };
      })
      .filter(Boolean)
      .slice(0, 40);
  } catch {
    return [];
  }
}

function formatSetCardMeta(set) {
  const years = set.years === 'All' ? 'All years' : set.years;
  const mins = set.minutes ? `${set.minutes} min` : '';
  return [set.subject, years, set.skill, mins].filter(Boolean).join(' · ');
}

export default function SavedSetsPanel({
  panel = 'sets', // 'queue' | 'sets'
  queue,
  setQueue,
  onLaunchQuestion,
  onLaunchSets,
  onSendSetsToInbox,
  onEnqueueSet,
  onMessage,
  students = [],
  selectedStudentIds = [],
}) {
  const showQueue = panel === 'queue';
  const showSets = panel === 'sets';

  const [customSets, setCustomSets] = useState(() => loadCustomSets());
  const [bankOverrides, setBankOverrides] = useState(() => loadBankOverrides());
  const [favouriteIds, setFavouriteIds] = useState(() => loadFavouriteIds());
  const [subject, setSubject] = useState('All');
  const [yearBand, setYearBand] = useState('All');
  const [activeSet, setActiveSet] = useState(null);
  const [selectedSetIds, setSelectedSetIds] = useState([]);
  const [recipientSets, setRecipientSets] = useState([]);
  const [recipientIds, setRecipientIds] = useState([]);
  const recipientChoices = [...new Map(students.map(s => [Number(s.id), s])).values()].filter(s => Number(s.id) > 0);
  const validRecipientIds = recipientIds.filter(id => recipientChoices.some(s => Number(s.id) === id));
  const recipientQuestionCount = recipientSets.reduce((n, set) => n + (set.questions?.length || 0), 0);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState('');
  const sendingRef = useRef(false);
  const [mode, setMode] = useState(''); // preview | edit | create
  const [draftName, setDraftName] = useState('');
  const [draftPaste, setDraftPaste] = useState('');
  const [draftQuestions, setDraftQuestions] = useState([]);
  const [setNameDraft, setSetNameDraft] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);
  const [previewFlyout, setPreviewFlyout] = useState(null);
  const setsRootRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_SETS_KEY, JSON.stringify(customSets.slice(0, 40)));
    } catch {
      /* ignore */
    }
  }, [customSets]);

  useEffect(() => {
    saveBankOverrides(bankOverrides);
  }, [bankOverrides]);

  useEffect(() => {
    saveFavouriteIds(favouriteIds);
  }, [favouriteIds]);

  useEffect(() => {
    if (!showQueue) return;
    // Expand when something lands; stay quiet when empty.
    setQueueOpen(queue.length > 0);
  }, [showQueue, queue.length]);

  const previewOpen = (mode === 'preview' && !!activeSet) || mode === 'recipients';

  useEffect(() => {
    if (!previewOpen) {
      setPreviewFlyout(null);
      return undefined;
    }

    const dock = setsRootRef.current?.closest('.iboard-header-dock') || setsRootRef.current;
    if (!dock) return undefined;

    const sync = () => {
      const rect = dock.getBoundingClientRect();
      const gap = 8;
      const maxWidth = mode === 'recipients'
        ? 416
        : 26 * 16;
      const minWidth = 20 * 16;
      const available = window.innerWidth - rect.right - gap - 8;
      let width = Math.min(maxWidth, available > minWidth ? available : maxWidth);
      width = Math.max(minWidth, Math.min(width, window.innerWidth - 16));
      let left = rect.right + gap;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - 8 - width);
      }
      setPreviewFlyout({
        top: rect.top,
        left,
        height: Math.max(280, rect.height),
        width,
      });
    };

    sync();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    observer?.observe(dock);
    window.addEventListener('resize', sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [previewOpen, activeSet?.id, mode, recipientChoices.length]);

  const library = useMemo(() => {
    const custom = customSets.map((set) => ({ ...set, bank: false, overridden: false }));
    const bank = QUESTION_SET_BANK.map((set) => applyBankOverride(set, bankOverrides[set.id]));
    return [...custom, ...bank];
  }, [customSets, bankOverrides]);

  const filtered = useMemo(
    () => sortSetsByFavourite(
      library.filter((set) => setMatchesFilters(set, subject, yearBand)),
      favouriteIds
    ),
    [library, subject, yearBand, favouriteIds]
  );

  const selectedSets = selectedSetIds.map((id) => library.find((set) => set.id === id)).filter(Boolean);
  const hiddenSelectionCount = selectedSets.filter((set) => !filtered.some((item) => item.id === set.id)).length;
  const questionCount = selectedSets.reduce((total, set) => total + (set.questions?.length || 0), 0);
  function toggleSet(id) {
    if (sendingRef.current) return;
    setSelectedSetIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
    setSendStatus('');
  }
  function chooseRecipients(sets) {
    if (!sets.length || sendingRef.current) return;
    setRecipientSets(sets);
    const previous = recipientIds.filter(id => recipientChoices.some(s => Number(s.id) === id));
    const checked = selectedStudentIds.map(Number).filter(id => recipientChoices.some(s => Number(s.id) === id));
    setRecipientIds(previous.length ? previous : checked.length ? checked : recipientChoices.map(s => Number(s.id)));
    setSendStatus('');
    setMode('recipients');
  }
  async function sendSelected(destination) {
    if (!recipientSets.length || !validRecipientIds.length || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendStatus('Sending…');
    try {
      const result = await (destination === 'ask' ? onLaunchSets(recipientSets, validRecipientIds) : onSendSetsToInbox(recipientSets, validRecipientIds));
      setSendStatus(result.message);
      if (result.ok) {
        setSelectedSetIds(ids => ids.filter(id => !recipientSets.some(set => set.id === id)));
        setMode('');
        setActiveSet(null);
      }
    } catch {
      setSendStatus('Could not confirm delivery. Check the class before retrying.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const favouriteSet = useMemo(() => new Set(favouriteIds), [favouriteIds]);

  function openPreview(set) {
    if (sendingRef.current) return;
    setActiveSet(set);
    setMode('preview');
  }

  function openEdit(set) {
    // Bank sets keep their id so Save writes a personal override, not a fork.
    const draft = {
      ...set,
      questions: normalizeSetQuestions(set.questions),
    };
    setActiveSet(draft);
    setDraftName(draft.name);
    setDraftQuestions(draft.questions);
    setMode('edit');
  }


  const closePending = useRef(false);
  async function closeSetEditor() {
    if (closePending.current) return;
    const dirty = mode === 'create'
      ? !!(draftName.trim() || draftPaste.trim())
      : draftName !== activeSet?.name || JSON.stringify(draftQuestions) !== JSON.stringify(activeSet?.questions || []);
    if (dirty) {
      closePending.current = true;
      const discard = await confirmDialog({ title: 'Discard set changes?', message: 'Your unsaved questions and edits will be lost.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing' });
      closePending.current = false;
      if (!discard) return;
    }
    setMode('');
    setActiveSet(null);
  }

  function openCreate() {
    setActiveSet(null);
    setDraftName('');
    setDraftPaste('');
    setDraftQuestions([]);
    setMode('create');
  }

  function toggleFavourite(setId, event) {
    event?.stopPropagation?.();
    setFavouriteIds((ids) => toggleFavouriteId(ids, setId));
  }

  function saveEditedSet() {
    const questions = normalizeSetQuestions(draftQuestions);
    const name = String(draftName || '').trim().slice(0, 80);
    if (!name) {
      onMessage?.('Name this set first.');
      return;
    }
    if (!questions.length) {
      onMessage?.('Add at least one question.');
      return;
    }

    const editingBank = !!(activeSet?.bank || String(activeSet?.id || '').startsWith('bank-'));
    if (editingBank) {
      const bankId = String(activeSet.id);
      setBankOverrides((current) => ({
        ...current,
        [bankId]: {
          name,
          subject: activeSet.subject || 'General',
          years: activeSet.years || 'All',
          skill: activeSet.skill || '',
          minutes: activeSet.minutes || Math.max(5, questions.length * 2),
          note: activeSet.note || '',
          questions,
        },
      }));
      setMode('');
      setActiveSet(null);
      onMessage?.(`Saved changes to “${name}” on this device.`);
      return;
    }

    const next = {
      ...(activeSet || {}),
      id: activeSet?.id && !String(activeSet.id).startsWith('bank-')
        ? activeSet.id
        : newId('set'),
      name,
      subject: activeSet?.subject || 'General',
      years: activeSet?.years || 'All',
      skill: activeSet?.skill || 'Custom',
      minutes: activeSet?.minutes || Math.max(5, questions.length * 2),
      note: activeSet?.note || '',
      bank: false,
      questions,
    };
    setCustomSets((items) => {
      const without = items.filter((item) => item.id !== next.id);
      return [next, ...without].slice(0, 40);
    });
    setMode('');
    setActiveSet(null);
    onMessage?.(`Saved “${name}”.`);
  }

  function resetBankOverride(setId) {
    const id = String(setId || '');
    if (!id.startsWith('bank-')) return;
    setBankOverrides((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    const original = QUESTION_SET_BANK.find((set) => set.id === id);
    if (activeSet?.id === id && original) {
      setActiveSet(applyBankOverride(original, null));
    }
    onMessage?.('Restored the original set.');
  }

  function savePastedSet() {
    const name = String(draftName || '').trim().slice(0, 80);
    const questions = parsePastedQuestions(draftPaste);
    if (!name) {
      onMessage?.('Name this set first.');
      return;
    }
    if (questions.length < 2) {
      onMessage?.('Paste at least two questions (one per line).');
      return;
    }
    const next = {
      id: newId('set'),
      name,
      subject: 'General',
      years: 'All',
      skill: 'Custom',
      minutes: Math.max(5, questions.length * 2),
      note: '',
      bank: false,
      questions,
    };
    setCustomSets((items) => [next, ...items].slice(0, 40));
    setMode('');
    setDraftName('');
    setDraftPaste('');
    onMessage?.(`Saved set “${name}”.`);
  }

  function saveQueueAsSet() {
    const questions = normalizeSetQuestions(queue);
    if (questions.length < 2) {
      onMessage?.('Queue at least two questions, then save them as a set.');
      return;
    }
    const name = String(setNameDraft || '').trim().slice(0, 80) || `Set · ${questions.length} questions`;
    const next = {
      id: newId('set'),
      name,
      subject: 'General',
      years: 'All',
      skill: 'Custom',
      minutes: Math.max(5, questions.length * 2),
      note: '',
      bank: false,
      questions,
    };
    setCustomSets((items) => [next, ...items].slice(0, 40));
    setSetNameDraft('');
    onMessage?.(`Saved set “${name}”.`);
  }

  function deleteCustomSet(id) {
    setCustomSets((items) => items.filter((item) => item.id !== id));
    if (activeSet?.id === id) {
      setActiveSet(null);
      setMode('');
    }
    onMessage?.('Set removed.');
  }

  function updateDraftPrompt(index, prompt) {
    setDraftQuestions((items) => items.map((item, i) => (i === index ? { ...item, prompt: prompt.slice(0, 500) } : item)));
  }

  function removeDraftPrompt(index) {
    setDraftQuestions((items) => items.filter((_, i) => i !== index));
  }

  const sheetOpen = mode === 'edit' || mode === 'create';

  return (
    <div
      ref={showSets ? setsRootRef : undefined}
      className={showQueue ? 'border-t border-slate-200 px-4 py-2.5 dark:border-slate-700' : 'flex h-full min-h-0 flex-col p-4'}
    >
      {showQueue && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                if (!queue.length) return;
                setQueueOpen((open) => !open);
              }}
              className="text-left"
              aria-expanded={queue.length > 0 ? queueOpen : undefined}
              disabled={!queue.length}
            >
              <h3 className="text-sm font-black text-slate-950 dark:text-white">
                Queue · {queue.length}
                {queue.length > 0 ? (
                  <span className="ml-1 text-[10px] font-bold text-slate-400">{queueOpen ? '▴' : '▾'}</span>
                ) : null}
              </h3>
            </button>
            {queue.length > 0 && (
              <button type="button" onClick={() => setQueue([])} className="text-xs font-black text-red-600">Clear</button>
            )}
          </div>

          {queueOpen && queue.length > 0 && (
            <>
              {queue.length >= 2 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/50">
                  <input
                    value={setNameDraft}
                    onChange={(event) => setSetNameDraft(event.target.value.slice(0, 80))}
                    placeholder="Name this set…"
                    className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <button type="button" onClick={saveQueueAsSet} className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[10px] font-black text-white">
                    Save queue as set
                  </button>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {queue.map((item, index) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 w-4 shrink-0 text-[10px] font-black tabular-nums text-slate-400">{index + 1}</span>
                      <p className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-slate-900 dark:text-white">{item.prompt}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2 pl-6">
                      <button
                        type="button"
                        onClick={() => onLaunchQuestion(item, item.id)}
                        className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-900"
                      >
                        Launch
                      </button>
                      <RemoveButton onClick={() => setQueue((items) => items.filter((question) => question.id !== item.id))} aria-label="Remove from queue" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {showSets && (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-black text-slate-950 dark:text-white">Sets · {filtered.length}</h3>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-500">Tick sets to send · Click a title to preview.</p>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
            >
              + New set
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="sets-subject-filter" className="sr-only">Subject</label>
            <select
              id="sets-subject-filter"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-indigo-950"
            >
              <option value="All">All subjects</option>
              {SUBJECTS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>

            <label htmlFor="sets-year-filter" className="sr-only">Year level</label>
            <select
              id="sets-year-filter"
              value={yearBand}
              onChange={(event) => setYearBand(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-indigo-950"
            >
              <option value="All">All years</option>
              {YEAR_BANDS.map((item) => (
                <option key={item} value={item}>Years {item}</option>
              ))}
            </select>
          </div>

          <div className="mt-3 shrink-0 border-y border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 text-xs">
              <p className="font-bold text-slate-700 dark:text-slate-200">{selectedSets.length ? `${selectedSets.length} set${selectedSets.length === 1 ? '' : 's'} selected` : 'Select sets'}</p>
              {selectedSets.length > 0 && <button type="button" disabled={sending} onClick={() => setSelectedSetIds([])} className="text-slate-500 hover:text-indigo-600 disabled:opacity-50">Clear</button>}
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={!selectedSets.length || sending} onClick={() => chooseRecipients(selectedSets)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">Send selected sets to…</button>
            </div>
            {hiddenSelectionCount > 0 && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{hiddenSelectionCount} selected outside this filter</p>}
            {questionCount > 60 && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Ask up to 60 questions at once. Select fewer sets or send to inbox.</p>}
            {sendStatus && <p role="status" className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{sendStatus}</p>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pr-1 scrollbar-thin">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2">
              {filtered.map((set) => {
                const isFavourite = favouriteSet.has(set.id);
                const isActive = previewOpen && activeSet?.id === set.id;
                return (
                <article
                  key={set.id}
                  className={`flex min-w-0 items-center gap-1.5 rounded-xl border p-1.5 transition ${
                    isActive || selectedSetIds.includes(set.id)
                      ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300 dark:border-indigo-500 dark:bg-indigo-950/40 dark:ring-indigo-700'
                      : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/35 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20'
                  }`}
                >
                  <input type="checkbox" checked={selectedSetIds.includes(set.id)} disabled={sending} onChange={() => toggleSet(set.id)} aria-label={`Select ${set.name}`} className="ml-1 h-4 w-4 shrink-0 accent-indigo-600" />
                  <button
                    type="button"
                    onClick={(event) => toggleFavourite(set.id, event)}
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${
                      isFavourite
                        ? 'text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40'
                        : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300'
                    }`}
                    aria-label={isFavourite ? `Unfavourite ${set.name}` : `Favourite ${set.name}`}
                    aria-pressed={isFavourite}
                    title={isFavourite ? 'Remove from favourites' : 'Favourite — keep at top'}
                  >
                    <StarIcon filled={isFavourite} />
                  </button>
                  <button
                    type="button"
                    onClick={() => openPreview(set)}
                    className="group min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    aria-label={`Preview ${set.name}`}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <p className="truncate text-sm font-black text-slate-900 group-hover:text-indigo-950 dark:text-white dark:group-hover:text-indigo-100">{set.name}</p>
                    <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">
                      {!set.bank && (
                        <>
                          <span className="text-indigo-500">Yours</span>
                          <span aria-hidden="true"> · </span>
                        </>
                      )}
                      {set.overridden && (
                        <>
                          <span className="text-indigo-500">Edited</span>
                          <span aria-hidden="true"> · </span>
                        </>
                      )}
                      {formatSetCardMeta(set)}
                    </p>
                  </button>
                </article>
                );
              })}
              {!filtered.length && (
                <p className="col-span-full rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-700">
                  No sets in this filter.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {mode === 'preview' && previewOpen && previewFlyout && typeof document !== 'undefined' && createPortal(
        <aside
          data-iboard-sets-preview="true"
          className="sets-question-preview sets-preview-flyout flex flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl dark:border-indigo-800 dark:bg-slate-900"
          style={{
            top: previewFlyout.top,
            left: previewFlyout.left,
            height: 'auto',
            maxHeight: `calc(100dvh - ${previewFlyout.top + 8}px)`,
            width: previewFlyout.width,
          }}
          role="dialog"
          aria-label={`Preview ${activeSet.name}`}
        >
          <div className="preview-heading flex shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">Preview</p>
              <h4 className="mt-0.5 text-base font-bold text-slate-950 dark:text-white">{activeSet.name}</h4>
              <p className="mt-0.5 text-[11px] font-bold text-slate-400">{formatSetMeta(activeSet)}</p>
            </div>
            <CloseButton onClick={() => { setMode(''); setActiveSet(null); }} label="Close" />
          </div>

          <div className="preview-questions min-h-0 flex-[0_1_auto] overflow-y-auto mx-3 mb-3 rounded-md px-3 py-2 scrollbar-thin">
            {activeSet.note && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">{activeSet.note}</p>
            )}
            <ol className="space-y-2">
              {(activeSet.questions || []).map((question, index) => (
                <li key={question.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold leading-snug text-slate-800 dark:border-slate-700 dark:text-slate-100">
                  <span className="mr-1.5 text-[10px] font-black text-slate-400">{index + 1}.</span>
                  {question.prompt}
                  {question.helper ? (
                    <span className="mt-0.5 block text-[11px] font-medium leading-snug text-slate-500 dark:text-slate-400">
                      {question.helper}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>

          <div className="preview-actions shrink-0 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
            <label className="mr-auto flex items-center gap-2 px-1 text-xs font-bold text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={selectedSetIds.includes(activeSet.id)} disabled={sending} onChange={() => toggleSet(activeSet.id)} className="h-4 w-4 accent-indigo-600" />
              Select set
            </label>
            <button type="button" disabled={sending} onClick={() => chooseRecipients([activeSet])} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40">Select students</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => openEdit(activeSet)} className="rounded px-1 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
              Edit
            </button>
            <button type="button" disabled={!activeSet.bank || !activeSet.overridden} onClick={() => resetBankOverride(activeSet.id)} className="rounded px-1 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800">
              Reset to original
            </button>
            {!activeSet.bank && (
              <button
                type="button"
                onClick={() => deleteCustomSet(activeSet.id)}
                className="ml-auto rounded-lg px-2 py-2 text-xs font-black text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                Delete
              </button>
            )}
            </div>
          </div>
        </aside>,
        document.body
      )}


      {mode === 'recipients' && previewFlyout && createPortal(
        <aside data-iboard-sets-preview="true" role="dialog" aria-label="Select students"
          className="sets-recipient-panel sets-preview-flyout flex flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl dark:border-indigo-800 dark:bg-slate-900"
          style={{ top: previewFlyout.top, left: previewFlyout.left, height: 'auto', maxHeight: `calc(100dvh - ${previewFlyout.top + 8}px)`, width: previewFlyout.width }}>
          <div className="recipient-heading shrink-0 px-4 pt-4 pb-2">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-base font-bold text-slate-950 dark:text-white">Select students</h4>
              <button type="button" disabled={sending} onClick={() => setMode(activeSet ? 'preview' : '')} className="text-xs font-bold text-slate-500 disabled:opacity-40">Back</button>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">{recipientSets.length === 1 ? recipientSets[0].name : `${recipientSets.length} sets selected`}</p>
            {recipientSets.length > 1 && <p className="mt-1 text-xs text-slate-500">{recipientSets.map(set => set.name).join(' · ')}</p>}
          </div>
          <div className="recipient-all flex shrink-0 items-center justify-between px-4 py-2">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
              <input type="checkbox" disabled={sending || !recipientChoices.length} checked={recipientChoices.length > 0 && validRecipientIds.length === recipientChoices.length}
                onChange={e => setRecipientIds(e.target.checked ? recipientChoices.map(s => Number(s.id)) : [])} className="h-4 w-4 accent-indigo-600" />
              All students
            </label>
            <span className="text-xs text-slate-500">{validRecipientIds.length} selected</span>
          </div>
          <div className="recipient-names min-h-0 flex-[0_1_auto] overflow-y-auto mx-3 mb-3 p-2 rounded-md">
            <div className="sets-recipient-grid" style={{ '--recipient-columns': 2 }}>
            {recipientChoices.map(student => <label key={student.id} className="sets-recipient-row flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 text-xs font-semibold text-slate-800 hover:bg-indigo-50 dark:text-slate-100 dark:hover:bg-slate-800">
              <input type="checkbox" disabled={sending} checked={validRecipientIds.includes(Number(student.id))}
                onChange={e => setRecipientIds(ids => e.target.checked ? [...ids, Number(student.id)] : ids.filter(id => id !== Number(student.id)))} className="h-3.5 w-3.5 shrink-0 accent-indigo-600" />
              <span title={student.name} className="min-w-0 flex-1 truncate">{student.name}</span>
              {student.connected === false && <span className="text-[10px] font-normal text-slate-400">Offline</span>}
            </label>)}
            </div>
            {!recipientChoices.length && <p className="p-2 text-sm text-slate-500">No students in this room yet.</p>}
          </div>
          <div className="recipient-actions shrink-0 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
            {recipientQuestionCount > 60 && <p className="mb-2 text-xs text-amber-700">Ask supports up to 60 questions. Send these sets to inbox instead.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={sending || !validRecipientIds.length || recipientQuestionCount > 60} onClick={() => sendSelected('ask')} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">Ask now</button>
              <button type="button" disabled={sending || !validRecipientIds.length} onClick={() => sendSelected('inbox')} className="recipient-inbox rounded-lg border border-indigo-200 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-200 dark:hover:bg-indigo-950">Send to inbox</button>
            </div>
            {sendStatus && <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-300">{sendStatus}</p>}
          </div>
        </aside>, document.body
      )}

      {sheetOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">
                  {mode === 'create' ? 'New set' : 'Edit set'}
                </p>
                <input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value.slice(0, 80))}
                  placeholder="Set name…"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <CloseButton onClick={closeSetEditor} label="Close set editor" />
            </div>

            {mode === 'edit' && (
              <>
                <div className="mt-4 space-y-2">
                  {draftQuestions.map((question, index) => (
                    <div key={question.id} className="flex gap-2">
                      <span className="mt-2 w-4 text-[10px] font-black text-slate-400">{index + 1}</span>
                      <textarea
                        value={question.prompt}
                        onChange={(event) => updateDraftPrompt(index, event.target.value)}
                        className="min-h-[3rem] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                      <RemoveButton onClick={() => removeDraftPrompt(index)} label={`Remove question ${index + 1}`} />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setDraftQuestions((items) => [...items, { id: newId('q'), type: 'short', prompt: '', options: [], correctAnswer: '' }].slice(0, 12))}
                  className="mt-3 text-xs font-black text-indigo-700"
                >
                  + Add question
                </button>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={saveEditedSet} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white">Save set</button>
                  <button type="button" onClick={closeSetEditor} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 dark:border-slate-700">Cancel</button>
                </div>
              </>
            )}

            {mode === 'create' && (
              <>
                <p className="mt-3 text-xs font-semibold text-slate-500">Paste questions from AI or notes — one per line.</p>
                <textarea
                  value={draftPaste}
                  onChange={(event) => setDraftPaste(event.target.value.slice(0, 6000))}
                  placeholder={'What information does the source contain?\nWho created it and when?\nWhy was it created?'}
                  className="mt-2 min-h-[12rem] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={savePastedSet} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white">Save set</button>
                  <button type="button" onClick={closeSetEditor} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 dark:border-slate-700">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
