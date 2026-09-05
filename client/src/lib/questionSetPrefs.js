import { normalizeSetQuestions } from './liveResponseSets.js';

const OVERRIDES_KEY = 'iboard-pulse-set-overrides';
const FAVOURITES_KEY = 'iboard-pulse-set-favourites';

function readJson(key, fallback) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return raw == null ? fallback : raw;
  } catch {
    return fallback;
  }
}

/** @returns {Record<string, object>} */
export function loadBankOverrides() {
  const raw = readJson(OVERRIDES_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const next = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!id.startsWith('bank-') || !value || typeof value !== 'object') continue;
    const questions = normalizeSetQuestions(value.questions);
    const name = String(value.name || '').trim().slice(0, 80);
    if (!name || !questions.length) continue;
    next[id] = {
      name,
      subject: value.subject || 'General',
      years: value.years || 'All',
      skill: value.skill || '',
      minutes: Number(value.minutes) || Math.max(5, questions.length * 2),
      note: value.note || '',
      questions,
    };
  }
  return next;
}

export function saveBankOverrides(overrides) {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides || {}));
  } catch {
    /* ignore quota */
  }
}

/** Favourite ids, most recently starred first. */
export function loadFavouriteIds() {
  const raw = readJson(FAVOURITES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 80);
}

export function saveFavouriteIds(ids) {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify((ids || []).slice(0, 80)));
  } catch {
    /* ignore */
  }
}

export function applyBankOverride(bankSet, override) {
  if (!bankSet) return null;
  if (!override) {
    return { ...bankSet, bank: true, overridden: false };
  }
  return {
    ...bankSet,
    name: override.name,
    subject: override.subject || bankSet.subject,
    years: override.years || bankSet.years,
    skill: override.skill || bankSet.skill,
    minutes: override.minutes || bankSet.minutes,
    note: override.note ?? bankSet.note,
    questions: normalizeSetQuestions(override.questions),
    bank: true,
    overridden: true,
  };
}

export function toggleFavouriteId(ids, setId) {
  const id = String(setId || '').trim();
  if (!id) return ids || [];
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (list.includes(id)) return list.filter((item) => item !== id);
  return [id, ...list.filter((item) => item !== id)].slice(0, 80);
}

export function sortSetsByFavourite(sets, favouriteIds) {
  const rank = new Map((favouriteIds || []).map((id, index) => [id, index]));
  return [...sets].sort((a, b) => {
    const aRank = rank.has(a.id) ? rank.get(a.id) : Number.POSITIVE_INFINITY;
    const bRank = rank.has(b.id) ? rank.get(b.id) : Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}
