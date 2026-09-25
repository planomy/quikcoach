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
    'You are an expert writing coach for school students. Focus on craft, clarity, and improvement at the year level given for each student.',
  explanation:
    'You are an expert teacher helping students improve explanatory writing. Focus on clarity, accurate detail, and logical development of ideas at the year level given for each student.',
  argument:
    'You are an expert teacher helping students improve argument writing. Focus on position, reasoning, evidence, and audience impact at the year level given for each student.',
  problem_solving:
    'You are an expert teacher helping students improve written mathematical problem solving. Focus on clear working, logical method, and accuracy at the year level given for each student.',
  custom:
    'You are an expert classroom teacher giving clear, practical feedback pitched to the year level given for each student.',
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

function studentYearLabel(yearLevel) {
  const id = String(yearLevel || '')
    .trim()
    .toLowerCase();
  if (!id) return '';
  if (YEAR_LEVEL_OPTIONS.some((o) => o.id === id)) return yearLevelLabel(id);
  const compact = id.replace(/^y(?:ear)?/, 'yr').replace(/^yr(?=\d)/, 'yr');
  const asYr = compact.startsWith('yr') ? compact : `yr${compact.replace(/\D/g, '')}`;
  if (YEAR_LEVEL_OPTIONS.some((o) => o.id === asYr)) return yearLevelLabel(asYr);
  return '';
}

function formatExampleLine(n) {
  return `${n}. [Your feedback for Student ${n}]`;
}

/**
 * Locked output rules — always prepended/appended on copy. Teachers must not remove these
 * or distribute cannot match feedback to students.
 * @param {number} studentCount
 */
export function buildLockedOutputRules(studentCount) {
  const n = Math.max(0, Number(studentCount) || 0);
  const example =
    n <= 0
      ? `${formatExampleLine(1)}\n${formatExampleLine(2)}`
      : Array.from({ length: Math.min(n, 3) }, (_, i) => formatExampleLine(i + 1)).join('\n') +
        (n > 3 ? `\n...\n${formatExampleLine(n)}` : n >= 2 ? '' : '');

  return `CRITICAL — how you must reply (do not skip):
- Write feedback for exactly ${n || 'each'} student${n === 1 ? '' : 's'} below, in the same order.
- Every reply item MUST start on its own line with the number, a full stop, then a space (1. 2. 3. …).
- Do not write any heading, intro, or closing before 1. or after the last number.
- Do not use real student names. If you refer to a writer, say Student 1, Student 2, etc.
- Pitch language and expectations to the year level shown for that student.

Required shape:
${example}`;
}

/**
 * Locked closing reminder — LLMs often obey the last instruction most reliably.
 * @param {number} studentCount
 */
export function buildLockedClosing(studentCount) {
  const n = Math.max(0, Number(studentCount) || 0);
  if (n <= 0) {
    return 'END OF DRAFTS. Reply with numbered feedback only, one line per student: 1. … 2. …';
  }
  return `END OF DRAFTS. Reply now with exactly ${n} numbered items and nothing else — start with "1. " and finish with "${n}. ".`;
}

/**
 * Editable middle: role, focuses, year, subject, custom notes from Feedback settings.
 * @param {object} params
 */
export function buildEditableGuidance({
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

  const list = students || [];
  const withPersonalYear = list.filter((s) => studentYearLabel(s.year_level)).length;
  const yearLine =
    withPersonalYear > 0
      ? `Year level: each student excerpt includes their own year level when known (${withPersonalYear} of ${list.length} marked). Pitch feedback to THAT student's year. If a student has no year marked, use the class default — ${yearLevelLabel(yearLevel)}.`
      : yearLevelLine(yearLevel);

  const customLine =
    mode === 'custom' && String(customFocusText || '').trim()
      ? `Teacher-requested focus: ${String(customFocusText).trim()}`
      : '';

  const targetLine =
    wordTarget > 0
      ? `The class word target is approximately ${wordTarget} words; comment on progress toward that goal where useful.`
      : '';

  return [role, '', focusLine, yearLine, subjectLine, customLine, targetLine]
    .filter((p) => p !== '')
    .join('\n');
}

/**
 * Locked anonymised student drafts — never includes real names.
 * @param {Array<{name?: string, text?: string, year_level?: string}>} students
 * @param {string} yearLevel
 */
export function buildLockedRoster(students = [], yearLevel = 'general') {
  const list = students || [];
  const fallbackYear = yearLevelLabel(yearLevel);
  return list
    .map((s, i) => {
      const excerpt = (s.text || '').trim() || '(empty draft)';
      const personal = studentYearLabel(s.year_level);
      const yearShown = personal || fallbackYear;
      return `--- Student ${i + 1} ---\nYear level: ${yearShown}${personal ? '' : ' (class default)'}\n${excerpt}`;
    })
    .join('\n\n');
}

/**
 * @returns {{ lockedRules: string, guidance: string, roster: string, lockedClosing: string, studentCount: number }}
 */
export function buildAiPromptParts(params) {
  const students = params.students || [];
  const studentCount = students.length;
  const yearLevel = params.yearLevel || 'general';
  return {
    lockedRules: buildLockedOutputRules(studentCount),
    guidance: buildEditableGuidance(params),
    roster: buildLockedRoster(students, yearLevel),
    lockedClosing: buildLockedClosing(studentCount),
    studentCount,
  };
}

/** Glue locked + guidance sections for clipboard. */
export function assembleAiPrompt({ lockedRules, guidance, roster, lockedClosing }) {
  return [lockedRules, guidance, roster, lockedClosing].filter((part) => String(part || '').trim()).join('\n\n');
}

/**
 * Full prompt (locked envelope + guidance + roster). Prefer assembleAiPrompt when teachers edit guidance.
 */
export function buildAiPrompt(params) {
  return assembleAiPrompt(buildAiPromptParts(params));
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
  if (out.length) return out.sort((a, b) => a.index - b.index);

  // Fallback: one feedback item per numbered line (when the model kept everything on single lines)
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*(\d+)\s*[\.):]\s*(.+?)\s*$/);
    if (!m) continue;
    out.push({ index: Number(m[1]), text: m[2].replace(/^\[/, '').replace(/\]$/, '').trim() });
  }
  return out.sort((a, b) => a.index - b.index);
}
