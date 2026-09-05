import { useEffect, useMemo, useState } from 'react';
import {
  cloneSetForEdit,
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
  onLaunchSet,
  onEnqueueSet,
  onMessage,
}) {
  const showQueue = panel === 'queue';
  const showSets = panel === 'sets';

  const [customSets, setCustomSets] = useState(() => loadCustomSets());
  const [bankOverrides, setBankOverrides] = useState(() => loadBankOverrides());
  const [favouriteIds, setFavouriteIds] = useState(() => loadFavouriteIds());
  const [subject, setSubject] = useState('All');
  const [yearBand, setYearBand] = useState('All');
  const [activeSet, setActiveSet] = useState(null);
  const [mode, setMode] = useState(''); // preview | edit | create
  const [draftName, setDraftName] = useState('');
  const [draftPaste, setDraftPaste] = useState('');
  const [draftQuestions, setDraftQuestions] = useState([]);
  const [setNameDraft, setSetNameDraft] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);

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

  const favouriteSet = useMemo(() => new Set(favouriteIds), [favouriteIds]);

  function openPreview(set) {
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

  function duplicateSet(set) {
    const draft = cloneSetForEdit(set);
    draft.name = `${set.name} (copy)`.slice(0, 80);
    setActiveSet(draft);
    setDraftName(draft.name);
    setDraftQuestions(draft.questions);
    setMode('edit');
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

  const sheetOpen = mode === 'preview' || mode === 'edit' || mode === 'create';

  return (
    <div className={showQueue ? 'border-t border-slate-200 px-4 py-2.5 dark:border-slate-700' : 'p-4'}>
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
                      <button
                        type="button"
                        onClick={() => setQueue((items) => items.filter((question) => question.id !== item.id))}
                        className="text-xs font-black text-red-500"
                        aria-label="Remove from queue"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {showSets && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-black text-slate-950 dark:text-white">Sets · {filtered.length}</h3>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-500">Preview, edit, or launch a whole routine.</p>
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

          <div className="mt-3 max-h-[28rem] overflow-y-auto pr-1 scrollbar-thin">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2">
              {filtered.map((set) => {
                const isFavourite = favouriteSet.has(set.id);
                return (
                <article
                  key={set.id}
                  className="flex min-w-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 transition hover:border-indigo-200 hover:bg-indigo-50/35 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20"
                >
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
                  <button
                    type="button"
                    onClick={() => onLaunchSet(set)}
                    className="shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-indigo-800 dark:bg-indigo-950/55 dark:text-indigo-200 dark:hover:border-indigo-700 dark:hover:bg-indigo-950 dark:ring-offset-slate-900"
                  >
                    Launch
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

      {sheetOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">
                  {mode === 'create' ? 'New set' : mode === 'edit' ? 'Edit set' : 'Preview'}
                </p>
                {mode === 'preview' ? (
                  <>
                    <h4 className="mt-1 font-display text-xl font-black text-slate-950 dark:text-white">{activeSet?.name}</h4>
                    <p className="mt-1 text-[11px] font-bold text-slate-400">{formatSetMeta(activeSet || {})}</p>
                  </>
                ) : (
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value.slice(0, 80))}
                    placeholder="Set name…"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                )}
              </div>
              <button type="button" onClick={() => { setMode(''); setActiveSet(null); }} className="text-sm font-black text-slate-500">Close</button>
            </div>

            {mode === 'preview' && (
              <>
                {activeSet?.note && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">{activeSet.note}</p>
                )}
                <ol className="mt-4 space-y-2">
                  {(activeSet?.questions || []).map((question, index) => (
                    <li key={question.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold leading-snug text-slate-800 dark:border-slate-700 dark:text-slate-100">
                      <span className="mr-1.5 text-[10px] font-black text-slate-400">{index + 1}.</span>
                      {question.prompt}
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => onLaunchSet(activeSet)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700">Launch</button>
                  <button type="button" onClick={() => { onEnqueueSet(activeSet); setMode(''); }} className="rounded-lg bg-indigo-100 px-3 py-2 text-xs font-black text-indigo-900">Add to queue</button>
                  <button type="button" onClick={() => openEdit(activeSet)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                    Edit
                  </button>
                  <button type="button" onClick={() => duplicateSet(activeSet)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                    Duplicate
                  </button>
                  {activeSet?.overridden && (
                    <button
                      type="button"
                      onClick={() => resetBankOverride(activeSet.id)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Reset to original
                    </button>
                  )}
                  {!activeSet?.bank && (
                    <button
                      type="button"
                      onClick={() => deleteCustomSet(activeSet.id)}
                      className="ml-auto rounded-lg px-2 py-2 text-xs font-black text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </>
            )}

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
                      <button type="button" onClick={() => removeDraftPrompt(index)} className="text-sm font-black text-red-500">×</button>
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
                  <button type="button" onClick={() => { setMode(''); setActiveSet(null); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 dark:border-slate-700">Cancel</button>
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
                  <button type="button" onClick={() => setMode('')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 dark:border-slate-700">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
