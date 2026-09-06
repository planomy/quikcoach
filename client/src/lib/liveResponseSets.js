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
  const helper = String(raw?.helper || raw?.descriptor || '').trim().slice(0, 240);
  return {
    id: String(raw?.id || newId(`sq${index}`)),
    type,
    prompt,
    options: type === 'short' ? [] : options,
    correctAnswer: type === 'short' || options.includes(correctAnswer) ? correctAnswer : '',
    ...(helper ? { helper } : {}),
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

/** Plain-text fallback for Inbox / older clients when a set is sent as a prompt. */
export function buildSetInboxText(setName, questions) {
  const title = String(setName || 'Prompt set').trim().slice(0, 120) || 'Prompt set';
  const list = normalizeSetQuestions(questions);
  if (!list.length) return `Prompt set · ${title}`;
  const body = list
    .map((question, index) => {
      const helper = question.helper ? `\n   ${question.helper}` : '';
      return `${index + 1}. ${question.prompt}${helper}`;
    })
    .join('\n\n');
  return `Prompt set · ${title}\n\n${body}`.slice(0, 5000);
}

/**
 * Recover title + questions for Inbox display when structured meta is missing
 * or newlines were flattened in transit.
 */
export function parseSetPromptForDisplay(item) {
  if (Array.isArray(item?.questions) && item.questions.length) {
    return {
      title: String(item.title || '').trim() || 'Prompt set',
      questions: item.questions
        .map((question, index) => {
          const prompt = String(question?.prompt || '').trim();
          if (!prompt) return null;
          const helper = String(question?.helper || '').trim();
          return {
            id: String(question?.id || `q${index + 1}`),
            prompt,
            ...(helper ? { helper } : {}),
          };
        })
        .filter(Boolean),
    };
  }

  const text = String(item?.text || '').trim();
  if (!text) return null;
  const looksLikePromptSet = item?.type === 'set-prompt' || /^Prompt set\b/i.test(text);
  if (!looksLikePromptSet) return null;

  let title = String(item?.title || '').trim();
  let body = text;
  const header = text.match(/^Prompt set(?:\s*·\s*|\s*[-:]\s*|\s+)(.+?)(?:\n+|(?=\s*\d+\.\s)|$)/i);
  if (header) {
    if (!title) title = String(header[1] || '').trim();
    body = text.slice(header[0].length).trim();
  }
  if (!title) title = 'Prompt set';

  const questions = [];
  if (body.includes('\n')) {
    for (const line of body.split(/\n+/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+\.\s*/.test(trimmed)) {
        questions.push({
          id: `q-${questions.length}`,
          prompt: trimmed.replace(/^\d+\.\s*/, ''),
        });
      } else if (questions.length && /^\s/.test(line)) {
        questions[questions.length - 1].helper = trimmed;
      } else if (questions.length) {
        questions[questions.length - 1].prompt += ` ${trimmed}`;
      } else {
        questions.push({ id: `q-${questions.length}`, prompt: trimmed });
      }
    }
  } else {
    for (const part of body.split(/(?=\d+\.\s)/)) {
      const prompt = part.replace(/^\d+\.\s*/, '').trim();
      if (!prompt) continue;
      questions.push({ id: `q-${questions.length}`, prompt });
    }
  }

  if (!questions.length) return { title, questions: [{ id: 'q-0', prompt: body || title }] };
  return { title, questions };
}

/**
 * Build durable teacher:distribute items for a set prompt.
 * @returns {{ items: object[], error?: string }}
 */
export function buildSetInboxDistributeItems({ setName, questions, studentIds }) {
  const list = normalizeSetQuestions(questions);
  const ids = [...new Set((studentIds || []).map(Number).filter((id) => id > 0))];
  if (!list.length) return { items: [], error: 'That set is empty.' };
  if (!ids.length) return { items: [], error: 'No students in the room yet.' };
  const title = String(setName || 'Prompt set').trim().slice(0, 120) || 'Prompt set';
  const text = buildSetInboxText(title, list);
  const promptQuestions = list.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    ...(question.helper ? { helper: question.helper } : {}),
  }));
  return {
    items: ids.map((studentId) => ({
      studentId,
      text,
      kind: 'set-prompt',
      title,
      questions: promptQuestions,
    })),
  };
}

