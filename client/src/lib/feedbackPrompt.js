/** @typedef {'writing'|'explanation'|'argument'|'problem_solving'|'custom'} FeedbackMode */

export const FEEDBACK_MODES = ['writing', 'explanation', 'argument', 'problem_solving', 'custom'];

const LEGACY_MODE_MAP = {
  narrative: 'writing',
  analytical: 'explanation',
  persuasive: 'argument',
  discussional: 'writing',
};

/** @param {string} [g] */
export function normalizeFeedbackMode(g) {
  if (g && FEEDBACK_MODES.includes(g)) return g;
  if (g && LEGACY_MODE_MAP[g]) return LEGACY_MODE_MAP[g];
  return 'writing';
}

/** Australian primary & secondary years; drives age-appropriate tone in the AI prompt. */
export const YEAR_LEVEL_OPTIONS = [
  { id: 'general', label: 'General (secondary)' },
  { id: 'yr2', label: 'Year 2' },
  { id: 'yr3', label: 'Year 3' },
  { id: 'yr4', label: 'Year 4' },
  { id: 'yr5', label: 'Year 5' },
  { id: 'yr6', label: 'Year 6' },
  { id: 'yr7', label: 'Year 7' },
  { id: 'yr8', label: 'Year 8' },
  { id: 'yr9', label: 'Year 9' },
  { id: 'yr10', label: 'Year 10' },
  { id: 'yr11', label: 'Year 11' },
  { id: 'yr12', label: 'Year 12' },
  { id: 'mixed', label: 'Mixed year levels' },
];

const YEAR_LEVEL_GUIDANCE = {
  general:
    'Pitch feedback for secondary students broadly (about Years 7–12): clear and respectful, neither childish nor university-level; explain discipline terms briefly when you use them.',
  yr2:
    'Students are about Year 2 (~7–8). Use very simple, encouraging language; very short sentences; concrete, everyday examples; celebrate effort; avoid abstract or technical jargon.',
  yr3:
    'Students are about Year 3 (~8–9). Keep language clear and friendly; simple explanations; short paragraphs of feedback; introduce one new idea at a time.',
  yr4:
    'Students are about Year 4 (~9–10). Use supportive, plain language; you may name simple writing or thinking moves; still favour concrete examples over abstract theory.',
  yr5:
    'Students are about Year 5 (~10–11). Balance warmth with growing expectations; you can reference paragraph structure and word choice in accessible terms.',
  yr6:
    'Students are about Year 6 (~11–12). Feedback can bridge primary and lower-secondary: clear reasoning, richer vocabulary allowed with brief explanations when needed.',
  yr7:
    'Students are about Year 7 (~12–13). Use warm, plain language, concrete examples, and manageable sentence length; define new terms simply.',
  yr8:
    'Students are about Year 8 (~13–14). Keep language clear while nudging toward more structured thinking; introduce subject vocabulary carefully.',
  yr9:
    'Students are about Year 9 (~14–15). You can reference structure, technique, and moderate abstraction; still keep explanations accessible.',
  yr10:
    'Students are about Year 10 (~15–16). Feedback can be more analytical; assume growing stamina for longer reasoning and appropriate subject terms.',
  yr11:
    'Students are about Year 11 (~16–17). Use senior-secondary rigour where helpful while remaining supportive.',
  yr12:
    'Students are about Year 12 (~17–18). Feedback may use mature vocabulary and standards appropriate to final-year secondary work.',
  mixed:
    'The class may span several year levels. Keep language understandable for younger students in the cohort while still useful for older ones; avoid narrow assumptions.',
};

export const SUBJECT_ASSIST_OPTIONS = [
  { id: 'general', label: 'General' },
  { id: 'english', label: 'English' },
  { id: 'science', label: 'Science' },
  { id: 'humanities', label: 'Humanities' },
  { id: 'maths', label: 'Maths' },
  { id: 'business', label: 'Business' },
  { id: 'legal_studies', label: 'Legal Studies' },
  { id: 'hpe', label: 'HPE' },
  { id: 'technologies', label: 'Technologies' },
  { id: 'the_arts', label: 'The Arts' },
];

/** Mode id -> toggle key -> human label */
export const MODE_TOGGLE_LABELS = {
  writing: {
    showDontTell: "Show Don't Tell",
    sensoryDetail: 'Sensory Detail',
    characterVoice: 'Character Voice',
    sentenceVariety: 'Sentence Variety',
    paragraphFlow: 'Paragraph Flow',
  },
  explanation: {
    clarityIdeas: 'Clarity of Ideas',
    keyTerms: 'Use of Key Terms',
    causeEffect: 'Cause and Effect',
    accurateDetail: 'Accurate Detail',
    logicalSequencing: 'Logical Sequencing',
  },
  argument: {
    clearPosition: 'Clear Position',
    strongEvidence: 'Strong Evidence',
    explainEvidence: 'Explanation of Evidence',
    persuasiveReasoning: 'Persuasive Reasoning',
    audienceAwareness: 'Audience Awareness',
  },
  problem_solving: {
    clearWorking: 'Clear Working',
    logicalSteps: 'Logical Steps',
    methodAccuracy: 'Accuracy of Method',
    mathCommunication: 'Mathematical Communication',
    answerCheck: 'Final Answer Check',
  },
  custom: {},
};

const ROLE_BY_MODE = {
  writing:
    'You are an expert writing coach for student writing in a secondary classroom. Focus on craft, clarity, and improvement.',
  explanation:
    'You are an expert teacher helping students improve explanatory writing. Focus on clarity, accurate detail, and logical development of ideas.',
  argument:
    'You are an expert teacher helping students improve argument writing. Focus on position, reasoning, evidence, and audience impact.',
  problem_solving:
    'You are an expert teacher helping students improve written mathematical problem solving. Focus on clear working, logical method, and accuracy.',
  custom:
    'You are an expert classroom teacher giving clear, practical feedback to students.',
};

function subjectLabel(id) {
  const row = SUBJECT_ASSIST_OPTIONS.find((o) => o.id === id);
  return row ? row.label : 'General';
}

function yearLevelLabel(id) {
  const row = YEAR_LEVEL_OPTIONS.find((o) => o.id === id);
  return row ? row.label : YEAR_LEVEL_OPTIONS[0].label;
}

function yearLevelLine(id) {
  const key = YEAR_LEVEL_OPTIONS.some((o) => o.id === id) ? id : 'general';
  const guide = YEAR_LEVEL_GUIDANCE[key] || YEAR_LEVEL_GUIDANCE.general;
  return `Year level: ${yearLevelLabel(key)}. ${guide}`;
}

/**
 * @param {object} params
 * @param {FeedbackMode} params.feedbackMode
 * @param {string} [params.subjectAssist]
 * @param {string} [params.customFocusText]
 * @param {Record<string, boolean>} [params.toggles]
 * @param {string[]} [params.extraFocusLabels] — enabled teacher-added focus lines (current mode)
 * @param {Array<{name: string, text?: string}>} [params.students]
 * @param {number} [params.wordTarget]
 * @param {string} [params.yearLevel] — id from YEAR_LEVEL_OPTIONS
 */
export function buildAiPrompt({
  feedbackMode,
  subjectAssist = 'general',
  yearLevel = 'general',
  customFocusText = '',
  toggles = {},
  extraFocusLabels = [],
  students = [],
  wordTarget = 0,
}) {
  const mode = normalizeFeedbackMode(feedbackMode);
  const role = ROLE_BY_MODE[mode] || ROLE_BY_MODE.writing;

  const labels = MODE_TOGGLE_LABELS[mode] || {};
  const fromToggles = Object.entries(toggles || {})
    .filter(([, v]) => v)
    .map(([k]) => labels[k] || k);

  const extras = (extraFocusLabels || []).map((s) => String(s).trim()).filter(Boolean);
  const combined = [...fromToggles, ...extras];

  const focusLine =
    combined.length > 0
      ? `Pay special attention to: ${combined.join(', ')}.`
      : 'Give general improvement feedback suitable for this mode.';

  const subjectLine =
    subjectAssist && subjectAssist !== 'general'
      ? `Subject context: ${subjectLabel(subjectAssist)}. Tailor feedback to the expectations of this subject while keeping comments simple and useful for students.`
      : '';

  const yearLine = yearLevelLine(yearLevel);

  const customLine =
    mode === 'custom' && String(customFocusText || '').trim()
      ? `Teacher-requested focus: ${String(customFocusText).trim()}`
      : '';

  const targetLine =
    wordTarget > 0
      ? `The class word target is approximately ${wordTarget} words; comment on progress toward that goal where useful.`
      : '';

  const headerParts = [
    role,
    '',
    focusLine,
    yearLine,
    subjectLine,
    customLine,
    targetLine,
  ].filter((p) => p !== '');

  const header = `${headerParts.join('\n')}

Respond with numbered feedback ONLY, one item per student, in this exact format (no extra prose before item 1):
1. [Your feedback for student 1]
2. [Your feedback for student 2]
...and so on.

Students are listed below in the same order as the numbers you must use.`;

  const body = (students || [])
    .map((s, i) => {
      const excerpt = (s.text || '').trim() || '(empty draft)';
      return `--- Student ${i + 1}: ${s.name} ---\n${excerpt}`;
    })
    .join('\n\n');

  return `${header}\n\n${body}`;
}

export function parseNumberedPaste(raw) {
  if (!raw || !String(raw).trim()) return [];
  const text = String(raw).trim();
  const blocks = text.split(/(?=^\s*\d+\s*[\.)]\s+)/m).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const m = block.match(/^\s*(\d+)\s*[\.)]\s*\[?([\s\S]+)/);
    if (!m) continue;
    const idx = Number(m[1]);
    let content = m[2].replace(/\]\s*$/, '').trim();
    out.push({ index: idx, text: content });
  }
  return out.sort((a, b) => a.index - b.index);
}
