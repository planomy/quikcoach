import { formatLiveAnswer, isUnknownAnswer } from './liveResponseUnknown.js';

const SET_QUESTION_TYPES = new Set(['choice', 'truefalse', 'rating', 'short']);

export function newId(prefix = 'q') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSetQuestion(raw, index = 0) {
  const type = SET_QUESTION_TYPES.has(raw?.type) ? raw.type : 'short';
  const prompt = String(raw?.prompt || '').trim().slice(0, 500);
  if (!prompt) return null;
  let options = Array.isArray(raw?.options)
    ? raw.options.map((value) => String(value || '').trim().slice(0, 120)).filter(Boolean).slice(0, 6)
    : [];
  if (type === 'truefalse') options = ['True', 'False'];
  if (type === 'rating') options = ['1', '2', '3', '4', '5'];
  if (type === 'choice' && options.length < 2) return null;
  const correctAnswer = String(raw?.correctAnswer || '').trim().slice(0, type === 'short' ? 500 : 120);
  return {
    id: String(raw?.id || newId(`sq${index}`)),
    type,
    prompt,
    options: type === 'short' ? [] : options,
    correctAnswer: type === 'short' || options.includes(correctAnswer) ? correctAnswer : '',
  };
}

export function normalizeSetQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSetQuestion).filter(Boolean).slice(0, 12);
}

export function parseSetAnswers(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, answer]) => [key, String(answer ?? '')]));
  }
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, answer]) => [key, String(answer ?? '')]));
  } catch {
    return {};
  }
}

export function looksLikeSetAnswers(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value).length > 0;
  }
  const raw = String(value || '').trim();
  if (!raw.startsWith('{')) return false;
  const parsed = parseSetAnswers(raw);
  return Object.keys(parsed).length > 0;
}

export function encodeSetAnswers(answers) {
  return JSON.stringify(answers || {});
}

export function setAnswersComplete(questions, answers) {
  const list = normalizeSetQuestions(questions);
  const map = parseSetAnswers(answers);
  if (!list.length) return false;
  return list.every((question) => {
    const value = String(map[question.id] || '').trim();
    return !!value;
  });
}

/** Structured prompt/answer pairs for teacher UI (no "?: " glue). */
export function getSetAnswerPairs(value, questions = []) {
  const map = parseSetAnswers(value);
  const list = normalizeSetQuestions(questions);
  if (list.length) {
    return list.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      answer: formatLiveAnswer(map[question.id] || '') || '—',
    }));
  }
  return Object.entries(map).map(([id, answer], index) => ({
    id,
    prompt: `Question ${index + 1}`,
    answer: formatLiveAnswer(answer) || '—',
  }));
}

/** @deprecated Prefer getSetAnswerPairs for UI. Plain-text fallback only. */
export function formatSetAnswerLines(value, questions = []) {
  return getSetAnswerPairs(value, questions).map((pair) => `${pair.prompt}\n${pair.answer}`);
}

/** Compact human text for chips/tooltips — never raw JSON. */
export function formatSetAnswerPreview(value, questions = []) {
  const pairs = getSetAnswerPairs(value, questions);
  if (!pairs.length) return isUnknownAnswer(value) ? formatLiveAnswer(value) : '';
  const answers = pairs.map((pair) => pair.answer).filter((answer) => answer && answer !== '—');
  if (answers.length) return answers.join(' · ');
  return pairs.map((pair) => pair.prompt).join(' · ');
}


/** Split pasted AI / list text into short-answer prompts. */
export function parsePastedQuestions(text) {
  const raw = String(text || '').replace(/\r/g, '\n');
  const chunks = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/\s*[•·]\s+/))
    .map((line) => line
      .replace(/^\s*[-*–—]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/^\s*[A-Za-z][.)]\s+/, '')
      .trim())
    .filter(Boolean);

  const seen = new Set();
  const prompts = [];
  for (const prompt of chunks) {
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    prompts.push(prompt.slice(0, 500));
    if (prompts.length >= 12) break;
  }
  return normalizeSetQuestions(prompts.map((prompt, index) => ({ id: newId(`paste${index}`), type: 'short', prompt })));
}

export function cloneSetForEdit(source) {
  const questions = normalizeSetQuestions(source?.questions).map((question, index) => ({
    ...question,
    id: newId(`edit${index}`),
  }));
  return {
    id: newId('set'),
    name: String(source?.name || 'Untitled set').trim().slice(0, 80),
    subject: source?.subject || 'General',
    years: source?.years || 'All',
    skill: source?.skill || '',
    minutes: Number(source?.minutes) || 0,
    note: source?.note || '',
    bank: false,
    questions,
  };
}

