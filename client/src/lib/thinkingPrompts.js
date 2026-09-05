/** Thinking prompt bank — short stems teachers will actually fire in a live lesson. */

export const THINKING_CATEGORIES = [
  { id: 'clarify', label: 'Clarify' },
  { id: 'deepen', label: 'Deepen' },
  { id: 'justify', label: 'Justify' },
  { id: 'challenge', label: 'Challenge' },
  { id: 'connect', label: 'Connect' },
  { id: 'reflect', label: 'Reflect' },
];

export const THINKING_MAX_SELECT = 3;

/**
 * @typedef {{ id: string, category: string, text: string, bySubject?: Record<string, string>, tags?: string[] }} ThinkingPrompt
 */

/** @type {ThinkingPrompt[]} */
export const THINKING_PROMPTS = [
  // —— Clarify ——
  {
    id: 'clarify-clear-sentence',
    category: 'clarify',
    text: 'Say your idea in one clear sentence.',
    bySubject: {
      maths: 'State your answer in one clear sentence.',
      science: 'State your conclusion in one clear sentence.',
    },
    tags: ['understand', 'clarify'],
  },
  {
    id: 'clarify-main-point',
    category: 'clarify',
    text: 'What is the main point you are making?',
    tags: ['understand', 'identify'],
  },
  {
    id: 'clarify-example',
    category: 'clarify',
    text: 'Give one example that shows what you mean.',
    bySubject: {
      english: 'Give one detail from the text that shows what you mean.',
      maths: 'Show one worked step that makes your method clear.',
      science: 'Give one observation that shows what you mean.',
    },
    tags: ['understand', 'apply'],
  },

  // —— Deepen ——
  {
    id: 'deepen-matter',
    category: 'deepen',
    text: 'Why does this matter?',
    tags: ['analyse', 'infer'],
  },
  {
    id: 'deepen-beneath',
    category: 'deepen',
    text: 'What is happening beneath the surface?',
    bySubject: {
      english: 'What else might this reveal about the character or idea?',
      science: 'What else could be affecting this result?',
    },
    tags: ['analyse', 'infer'],
  },
  {
    id: 'deepen-stronger',
    category: 'deepen',
    text: 'What could you add to make this idea stronger?',
    tags: ['analyse', 'generalise'],
  },

  // —— Justify ——
  {
    id: 'justify-evidence',
    category: 'justify',
    text: 'What evidence supports this?',
    bySubject: {
      english: 'What evidence from the text supports this?',
      science: 'What evidence supports this conclusion?',
      maths: 'Which step or result supports your answer?',
      humanities: 'Which source or fact best supports this claim?',
    },
    tags: ['evaluate', 'evidence'],
  },
  {
    id: 'justify-prove',
    category: 'justify',
    text: 'How does your evidence prove your point?',
    bySubject: {
      maths: 'How do your steps prove your answer is correct?',
      science: 'How does your evidence lead to this conclusion?',
    },
    tags: ['analyse', 'reasoning'],
  },
  {
    id: 'justify-strongest',
    category: 'justify',
    text: 'Why is this your strongest answer?',
    tags: ['evaluate', 'reasoning'],
  },

  // —— Challenge ——
  {
    id: 'challenge-disagree',
    category: 'challenge',
    text: 'What might someone disagree with?',
    tags: ['evaluate', 'challenge'],
  },
  {
    id: 'challenge-assume',
    category: 'challenge',
    text: 'What are you assuming here?',
    tags: ['evaluate', 'metacognition'],
  },
  {
    id: 'challenge-wrong',
    category: 'challenge',
    text: 'What evidence could prove you wrong?',
    bySubject: {
      science: 'What result or variable could prove this wrong?',
      maths: 'What case or counter-example could prove this wrong?',
    },
    tags: ['evaluate', 'challenge'],
  },

  // —— Connect ——
  {
    id: 'connect-earlier',
    category: 'connect',
    text: 'What does this connect to from earlier?',
    tags: ['connect', 'retrieval'],
  },
  {
    id: 'connect-elsewhere',
    category: 'connect',
    text: 'Where else could this idea apply?',
    tags: ['connect', 'transfer'],
  },
  {
    id: 'connect-similar',
    category: 'connect',
    text: 'How is this similar to something you already know?',
    tags: ['connect', 'transfer'],
  },

  // —— Reflect ——
  {
    id: 'reflect-strategy',
    category: 'reflect',
    text: 'What strategy did you use?',
    tags: ['metacognition', 'reflect'],
  },
  {
    id: 'reflect-stuck',
    category: 'reflect',
    text: 'Where did you get stuck, and what helped?',
    tags: ['metacognition', 'reflect'],
  },
  {
    id: 'reflect-change',
    category: 'reflect',
    text: 'What would you change if you tried again?',
    tags: ['metacognition', 'create'],
  },
];

const SUBJECT_ALIASES = {
  hass: 'humanities',
  history: 'humanities',
  geography: 'humanities',
  math: 'maths',
  mathematics: 'maths',
};

/**
 * @param {string} [subjectAssist]
 * @returns {string}
 */
export function normalizeThinkingSubject(subjectAssist) {
  const raw = String(subjectAssist || 'general')
    .trim()
    .toLowerCase();
  if (!raw || raw === 'general') return 'general';
  return SUBJECT_ALIASES[raw] || raw;
}

/**
 * @param {ThinkingPrompt} prompt
 * @param {string} [subjectAssist]
 */
export function resolveThinkingPromptText(prompt, subjectAssist) {
  const subject = normalizeThinkingSubject(subjectAssist);
  if (subject !== 'general' && prompt.bySubject?.[subject]) {
    return prompt.bySubject[subject];
  }
  return prompt.text;
}

/**
 * @param {string} [subjectAssist]
 * @returns {Record<string, { id: string, text: string, tags?: string[] }[]>}
 */
export function promptsByCategory(subjectAssist) {
  /** @type {Record<string, { id: string, text: string, tags?: string[] }[]>} */
  const out = Object.fromEntries(THINKING_CATEGORIES.map((c) => [c.id, []]));
  for (const prompt of THINKING_PROMPTS) {
    if (!out[prompt.category]) continue;
    out[prompt.category].push({
      id: prompt.id,
      text: resolveThinkingPromptText(prompt, subjectAssist),
      tags: prompt.tags,
    });
  }
  return out;
}

/**
 * @param {string[]} texts
 */
export function buildThinkingInboxText(texts) {
  const lines = (texts || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!lines.length) return '';
  if (lines.length === 1) return `Push your thinking\n\n${lines[0]}`;
  return `Push your thinking\n\n${lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}`;
}

/**
 * @param {import('socket.io-client').Socket | null | undefined} socket
 * @param {{ studentIds: Array<number|string>, texts: string[] }} payload
 * @param {(ack: { ok?: boolean, error?: string, count?: number, reached?: number }) => void} [cb]
 */
export function sendThinkingToInbox(socket, { studentIds, texts }, cb) {
  const text = buildThinkingInboxText(texts);
  const ids = [...new Set((studentIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (!socket || !text || !ids.length) {
    cb?.({ ok: false, error: !ids.length ? 'No students to send to' : 'Nothing to send' });
    return;
  }
  const items = ids.map((studentId) => ({ studentId, text }));
  socket.emit('teacher:distribute', { items }, cb);
}
