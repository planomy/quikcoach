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
    text: 'Say that again in one clear sentence.',
    bySubject: {
      english: 'Restate your point in one clear sentence.',
      maths: 'State your answer and what it means in one clear sentence.',
      science: 'State your conclusion in one clear sentence.',
      humanities: 'State your claim in one clear sentence.',
    },
    tags: ['understand', 'clarify'],
  },
  {
    id: 'clarify-main-idea',
    category: 'clarify',
    text: 'What is the main idea you want me to take away?',
    bySubject: {
      english: 'What is the main idea in this part of your writing?',
      science: 'What is the key scientific idea here?',
      maths: 'What is the key idea in your method?',
    },
    tags: ['understand', 'identify'],
  },
  {
    id: 'clarify-example',
    category: 'clarify',
    text: 'Add one concrete example so I can see what you mean.',
    bySubject: {
      english: 'Add one detail from the text that shows what you mean.',
      science: 'Add one observation or example that shows what you mean.',
      maths: 'Show one worked step that makes your method clear.',
      humanities: 'Add one fact or example that shows what you mean.',
    },
    tags: ['understand', 'apply'],
  },

  // —— Deepen ——
  {
    id: 'deepen-how-know',
    category: 'deepen',
    text: 'How do you know that?',
    bySubject: {
      english: 'How do you know that from the text?',
      science: 'How do you know that from the evidence?',
      maths: 'How do you know your method works here?',
      humanities: 'How do you know that from the sources?',
    },
    tags: ['analyse', 'evidence'],
  },
  {
    id: 'deepen-beneath',
    category: 'deepen',
    text: 'What else is going on beneath the surface here?',
    bySubject: {
      english: 'What else might this reveal about the character or idea?',
      science: 'What else could be affecting this result?',
      humanities: 'What else might be shaping this situation?',
    },
    tags: ['analyse', 'infer'],
  },
  {
    id: 'deepen-next',
    category: 'deepen',
    text: 'What would someone need to understand next?',
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
      legal_studies: 'What evidence or rule supports this claim?',
      business: 'What evidence supports this decision?',
    },
    tags: ['evaluate', 'evidence'],
  },
  {
    id: 'justify-strongest',
    category: 'justify',
    text: 'Which part of your answer is strongest — and why?',
    tags: ['evaluate', 'reasoning'],
  },
  {
    id: 'justify-reasoning',
    category: 'justify',
    text: 'Walk me through the reasoning that got you here.',
    bySubject: {
      maths: 'Explain each step so someone else could follow your method.',
      science: 'Explain the reasoning that links your evidence to your conclusion.',
    },
    tags: ['analyse', 'reasoning'],
  },

  // —— Challenge ——
  {
    id: 'challenge-disagree',
    category: 'challenge',
    text: 'What might someone disagree with in your answer?',
    bySubject: {
      english: 'How might another reader interpret this differently?',
      humanities: 'What perspective might disagree with this claim?',
      legal_studies: 'What counter-argument could be made?',
    },
    tags: ['evaluate', 'challenge'],
  },
  {
    id: 'challenge-assume',
    category: 'challenge',
    text: 'What are you assuming here?',
    tags: ['evaluate', 'metacognition'],
  },
  {
    id: 'challenge-exception',
    category: 'challenge',
    text: 'When might this not be true?',
    bySubject: {
      science: 'What variable or condition could change this result?',
      maths: 'Is there a case where this method would not work?',
      humanities: 'What exception or counter-example weakens this idea?',
    },
    tags: ['evaluate', 'challenge'],
  },

  // —— Connect ——
  {
    id: 'connect-earlier',
    category: 'connect',
    text: 'What does this connect to from earlier in the lesson?',
    tags: ['connect', 'retrieval'],
  },
  {
    id: 'connect-elsewhere',
    category: 'connect',
    text: 'Where else could this idea apply?',
    bySubject: {
      maths: 'Where else could you use this method?',
      science: 'Where else does this idea show up in the real world?',
      english: 'Where else in the text (or in life) does this idea appear?',
    },
    tags: ['connect', 'transfer'],
  },
  {
    id: 'connect-similar',
    category: 'connect',
    text: 'How is this similar to something you have seen before?',
    tags: ['connect', 'transfer'],
  },

  // —— Reflect ——
  {
    id: 'reflect-strategy',
    category: 'reflect',
    text: 'What strategy did you use to work this out?',
    bySubject: {
      maths: 'What strategy did you use to solve this?',
      english: 'What strategy did you use as you wrote this?',
    },
    tags: ['metacognition', 'reflect'],
  },
  {
    id: 'reflect-stuck',
    category: 'reflect',
    text: 'Where did you get stuck — and what helped?',
    tags: ['metacognition', 'reflect'],
  },
  {
    id: 'reflect-change',
    category: 'reflect',
    text: 'If you had one more minute, what would you change?',
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
