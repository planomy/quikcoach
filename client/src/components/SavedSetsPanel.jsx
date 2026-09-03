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

const CUSTOM_SETS_KEY = 'iboard-pulse-custom-sets';
const LEGACY_SETS_KEY = 'iboard-pulse-question-sets';
const LEGACY_TEMPLATE_KEY = 'iboard-pulse-question-templates';
const LEGACY_STARTER_IDS = new Set(['starter-source-analysis', 'starter-narrative']);

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

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[10px] font-black transition ${
        active
          ? 'bg-indigo-600 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
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
  const [subject, setSubject] = useState('All');
  const [yearBand, setYearBand] = useState('All');
  const [activeSet, setActiveSet] = useState(null);
  const [mode, setMode] = useState(''); // preview | edit | create
  const [draftName, setDraftName] = useState('');
  const [draftPaste, setDraftPaste] = useState('');
  const [draftQuestions, setDraftQuestions] = useState([]);
  const [setNameDraft, setSetNameDraft] = useState('');
  const [queueOpen, setQueueOpen] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_SETS_KEY, JSON.stringify(customSets.slice(0, 40)));
    } catch {
      /* ignore */
    }
  }, [customSets]);

  useEffect(() => {
    if (showQueue && queue.length > 0) setQueueOpen(true);
  }, [showQueue, queue.length]);

  const library = useMemo(() => {
    const custom = customSets.map((set) => ({ ...set, bank: false }));
    return [...custom, ...QUESTION_SET_BANK];
  }, [customSets]);

  const filtered = useMemo(
    () => library.filter((set) => setMatchesFilters(set, subject, yearBand)),
    [library, subject, yearBand]
  );

  function openPreview(set) {
    setActiveSet(set);
    setMode('preview');
  }

  function openEdit(set) {
    const draft = set.bank ? cloneSetForEdit(set) : {
      ...set,
      questions: normalizeSetQuestions(set.questions),
    };
    if (set.bank) {
      draft.name = `${set.name} (edited)`;
    }
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
    const next = {
      ...(activeSet || {}),
      id: activeSet?.bank === false && activeSet?.id && !String(activeSet.id).startsWith('bank-')
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
    <div className={showQueue ? 'border-t border-slate-200 px-4 py-3 dark:border-slate-700' : 'p-4'}>
      {showQueue && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => setQueueOpen((open) => !open)} className="text-left">
              <h3 className="text-sm font-black text-slate-950 dark:text-white">
                Queue · {queue.length}
                <span className="ml-1 text-[10px] font-bold text-slate-400">{queueOpen ? '▴' : '▾'}</span>
              </h3>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-500">This lesson — launch any when ready.</p>
            </button>
            {queue.length > 0 && (
              <button type="button" onClick={() => setQueue([])} className="text-xs font-black text-red-600">Clear</button>
            )}
          </div>

          {queueOpen && (
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
                {!queue.length && (
                  <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-xs text-slate-500 dark:border-slate-700">
                    Nothing queued yet. Add from Write one, or open Sets.
                  </p>
                )}
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

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip active={subject === 'All'} onClick={() => setSubject('All')}>All subjects</Chip>
            {SUBJECTS.map((item) => (
              <Chip key={item} active={subject === item} onClick={() => setSubject(item)}>{item}</Chip>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip active={yearBand === 'All'} onClick={() => setYearBand('All')}>All years</Chip>
            {YEAR_BANDS.map((item) => (
              <Chip key={item} active={yearBand === item} onClick={() => setYearBand(item)}>{item}</Chip>
            ))}
          </div>

          <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {filtered.map((set) => (
              <article
                key={set.id}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 transition hover:border-indigo-200 hover:bg-indigo-50/35 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20"
              >
                <button
                  type="button"
                  onClick={() => openPreview(set)}
                  className="group min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-label={`Preview ${set.name}`}
                >
                  <p className="truncate text-sm font-black text-slate-900 group-hover:text-indigo-950 dark:text-white dark:group-hover:text-indigo-100">{set.name}</p>
                  <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">
                    <span className={set.bank ? '' : 'text-indigo-500'}>{set.bank ? 'Built-in' : 'Yours'}</span>
                    <span aria-hidden="true"> · </span>
                    {formatSetMeta(set)}
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
            ))}
            {!filtered.length && (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-700">
                No sets in this filter.
              </p>
            )}
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
                    {activeSet?.bank ? 'Edit a copy' : 'Edit'}
                  </button>
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
