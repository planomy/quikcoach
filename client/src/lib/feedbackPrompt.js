/** @typedef {'writing'|'explanation'|'argument'|'problem_solving'|'custom'} FeedbackMode */
/** @typedef {'lower'|'mid'|'senior'} YearBand */

export const FEEDBACK_MODES = ['writing', 'explanation', 'argument', 'problem_solving', 'custom'];

/** Chip order in Feedback settings (Custom last). */
export const FEEDBACK_MODE_CHIPS = FEEDBACK_MODES;

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
    'The class may span several year levels. Apply each selected focus at the individual student\'s year level. Expectations, terminology and depth must be developmentally appropriate. Do not penalise younger students for senior-level features that would not normally be expected at their year level.',
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

/**
 * Focus toggles — insertion order = grid order (2 columns).
 * Slot 1 (top-left): Structure. Slot 2 (top-right): Grammar / Accuracy.
 * Senior keys in SENIOR_FOCUS_KEYS appear only for older years; stay last.
 */
export const MODE_TOGGLE_LABELS = {
  writing: {
    storyStructure: 'Story Structure',
    mechanics: 'Grammar, Spelling & Punctuation',
    characterVoice: 'Character & Voice',
    showDontTell: "Show, Don't Tell",
    wordChoice: 'Word Choice',
    sentenceVariety: 'Sentence Variety',
    paragraphingFlow: 'Paragraphing & Flow',
    themeSubtext: 'Theme & Subtext',
  },
  explanation: {
    structureSequencing: 'Structure & Sequencing',
    mechanics: 'Grammar, Spelling & Punctuation',
    explainingHowWhy: 'Explaining How & Why',
    keyTermsVocab: 'Key Terms & Vocabulary',
    accuracyDetail: 'Accuracy & Detail',
    evidenceExamplesData: 'Evidence, Examples & Sources',
    cohesionConnections: 'Cohesion & Connections',
    depthPrecision: 'Depth & Precision',
  },
  argument: {
    structureCohesion: 'Structure & Cohesion',
    mechanics: 'Grammar, Spelling & Punctuation',
    positionContention: 'Position & Contention',
    argumentsReasoning: 'Arguments & Reasoning',
    evidenceExamples: 'Evidence & Examples',
    analysisEvidence: 'Analysis of Evidence',
    audienceLanguage: 'Audience & Language Choices',
    perspectivesValues: 'Perspectives, Values & Assumptions',
  },
  problem_solving: {
    understandingProblem: 'Understanding the Problem',
    accuracy: 'Accuracy',
    methodStrategy: 'Method & Strategy',
    workingProcess: 'Working & Process',
    reasoningJustification: 'Reasoning & Justification',
    answerReasonableness: 'Answer & Reasonableness',
    unitsNotation: 'Units, Notation & Conventions',
    efficiencyAlternatives: 'Efficiency & Alternative Methods',
  },
  custom: {},
};

/** Focus keys that only appear for senior / mixed / general secondary. */
export const SENIOR_FOCUS_KEYS = {
  writing: ['themeSubtext'],
  explanation: ['depthPrecision'],
  argument: ['perspectivesValues'],
  problem_solving: ['efficiencyAlternatives'],
  custom: [],
};

/** Map old toggle keys onto the current set. */
const LEGACY_TOGGLE_KEY_MAP = {
  writing: {
    sensoryDetail: 'showDontTell',
    paragraphFlow: 'paragraphingFlow',
  },
  explanation: {
    clarityIdeas: 'structureSequencing',
    causeEffect: 'explainingHowWhy',
    keyTerms: 'keyTermsVocab',
    accurateDetail: 'accuracyDetail',
    logicalSequencing: 'structureSequencing',
    linkingWords: 'cohesionConnections',
    structureSequencing: 'structureSequencing',
  },
  argument: {
    clearPosition: 'positionContention',
    paragraphTeel: 'structureCohesion',
    strongEvidence: 'evidenceExamples',
    explainEvidence: 'analysisEvidence',
    explainingEvidence: 'analysisEvidence',
    persuasiveReasoning: 'argumentsReasoning',
    audienceAwareness: 'audienceLanguage',
    audiencePersuasiveLanguage: 'audienceLanguage',
  },
  problem_solving: {
    understandingQuestion: 'understandingProblem',
    clearWorking: 'workingProcess',
    logicalSteps: 'workingProcess',
    settingOutWorking: 'workingProcess',
    methodAccuracy: 'methodStrategy',
    mathCommunication: 'unitsNotation',
    answerCheck: 'answerReasonableness',
  },
};

/**
 * Hidden AI glosses. Band variants keep the same switch meaningful from Y3 to Y12.
 * @type {Record<string, Record<string, { default: string, lower?: string, senior?: string }>>}
 */
const FOCUS_GLOSSES = {
  writing: {
    storyStructure: {
      default: 'Clear opening, a complication worth caring about, and a resolution that is not rushed.',
      lower: 'Beginning, a problem in the middle, and an ending that finishes the problem.',
      senior: 'Orientation–complication–resolution pacing; flag rushed endings and thin turning points.',
    },
    characterVoice: {
      default: 'Character feelings and actions are clear; voice fits the story.',
      lower: 'Can we understand what the character is feeling and doing?',
      senior: 'Narrative voice is deliberate and consistent; point of view is controlled effectively.',
    },
    showDontTell: {
      default: 'Prefer action, dialogue, body language and sensory detail over naming feelings.',
      lower: 'Show feelings through what a character sees, hears and does.',
      senior: 'Implication and restraint over stated emotion; one concrete rewrite is enough.',
    },
    wordChoice: {
      default: 'Precise verbs and nouns; quote one weak word and offer a stronger alternative.',
    },
    sentenceVariety: {
      default: 'Mix short and long sentences; vary openers; avoid chains of “and then”.',
    },
    paragraphingFlow: {
      default: 'New paragraph for new time, place, speaker or event; smooth links between them.',
    },
    mechanics: {
      default:
        'Identify a few high-impact errors or patterns that the student should check; do not proofread or rewrite the whole response.',
    },
    themeSubtext: {
      default: 'What the story is really about; implication and controlled meaning beneath the plot.',
      senior: 'Theme and subtext are developing; avoid heavy-handed moralising.',
    },
  },
  explanation: {
    structureSequencing: {
      default: 'Introduce what is being explained, then organise ideas in a clear, logical sequence.',
    },
    explainingHowWhy: {
      default: 'Make how and why clear — processes, relationships and reasoning, not only description.',
      lower: 'Say what happens and why, in simple steps.',
    },
    keyTermsVocab: {
      default: 'Use subject terms accurately, not just as decoration.',
    },
    accuracyDetail: {
      default: 'Specific, enough detail to explain; flag vagueness or doubtful claims.',
    },
    evidenceExamplesData: {
      default: 'Use relevant evidence, examples, sources or data where they strengthen the explanation.',
    },
    cohesionConnections: {
      default: 'Ideas and paragraphs connect logically; relationships between concepts are explicit.',
      lower: 'Ideas are joined clearly with simple linking words.',
      senior: 'Synthesise ideas rather than listing isolated facts.',
    },
    mechanics: {
      default:
        'Identify a few high-impact errors or patterns that the student should check; do not proofread or rewrite the whole response.',
    },
    depthPrecision: {
      default: 'Push for conceptual precision and nuanced explanation where the draft stays surface-level.',
    },
  },
  argument: {
    structureCohesion: {
      default: 'Overall shape is clear; paragraphs and ideas connect; one main idea per paragraph where appropriate.',
      lower: 'Ideas are in a sensible order and easy to follow.',
      senior: 'Controlled essay/paragraph architecture (e.g. TEEL/PEEL) with clear links back to the contention.',
    },
    mechanics: {
      default:
        'Identify a few high-impact errors or patterns that the student should check; do not proofread or rewrite the whole response.',
    },
    positionContention: {
      default: 'A clear position stated early and held consistently.',
      lower: 'Say clearly what you think at the start and stick to it.',
      senior: 'Contention is precise and sustained through to the conclusion.',
    },
    argumentsReasoning: {
      default: 'Claims are reasoned, not just asserted; logic holds.',
      senior: 'Include counterargument/rebuttal where the task expects it; reasoning is nuanced.',
    },
    evidenceExamples: {
      default: 'Specific, relevant support rather than bare assertion.',
    },
    analysisEvidence: {
      default: 'Explain what the evidence shows and how it supports the point.',
      lower: 'Explain how the example supports your point.',
      mid: 'Explain what the evidence shows and connect it to the argument.',
      senior:
        'Analyse important details or quotations; show how language/textual choices construct meaning and connect explicitly to the contention.',
    },
    audienceLanguage: {
      default: 'Word choice and devices pitched at the reader (tone, modality, persuasive or analytical language as fits the task).',
    },
    perspectivesValues: {
      default: 'Acknowledge perspectives, values or assumptions where relevant to the text or issue.',
    },
  },
  problem_solving: {
    understandingProblem: {
      default: 'What is given, what is asked, and units — show the question was read correctly.',
    },
    methodStrategy: {
      default: 'Approach is appropriate; name a better strategy if there is one.',
    },
    workingProcess: {
      default: 'Working is set out so a reader can follow (one step per line where helpful).',
    },
    reasoningJustification: {
      default: 'Explain why steps were taken, not only what was calculated.',
    },
    accuracy: {
      default:
        'Check arithmetic and substitution. Raise possible errors as questions rather than declaring unverified verdicts.',
    },
    answerReasonableness: {
      default: 'Final answer clear, units correct, and a sanity check on size.',
    },
    unitsNotation: {
      default: 'Units, symbols and conventional notation used correctly for the subject.',
    },
    efficiencyAlternatives: {
      default: 'Note a more efficient method or a useful alternative approach when relevant.',
    },
  },
};

const ROLE_BY_MODE = {
  writing:
    'You are an expert narrative writing coach for school students. Focus on craft, clarity, and improvement at the year level given for each student.',
  explanation:
    'You are an expert teacher helping students improve explanatory writing. Focus on clarity, accurate detail, and logical development of ideas at the year level given for each student.',
  argument:
    'You are an expert teacher helping students improve argument and analytical writing. Focus on contention, reasoning, evidence, analysis, and audience impact at the year level given for each student.',
  problem_solving:
    'You are an expert teacher helping students improve written mathematical problem solving. Focus on clear working, logical method, and accuracy at the year level given for each student. When checking calculations, raise possible errors as questions rather than asserting answers you cannot verify.',
  custom:
    'You are an expert classroom teacher giving clear, practical feedback pitched to the year level given for each student.',
};

/**
 * @param {string} [yearLevel]
 * @returns {YearBand}
 */
export function yearBand(yearLevel) {
  const id = normalizeYearLevelId(yearLevel) || 'general';
  if (id === 'yr2' || id === 'yr3' || id === 'yr4') return 'lower';
  if (id === 'yr9' || id === 'yr10' || id === 'yr11' || id === 'yr12') return 'senior';
  return 'mid';
}

/** Whether senior-only focuses should be shown in the settings UI. */
export function showSeniorFocuses(yearLevel) {
  const id = String(yearLevel || 'general').trim().toLowerCase();
  if (id === 'mixed' || id === 'general') return true;
  return yearBand(id) === 'senior';
}

/**
 * Labels visible for this mode + year, in stable grid order
 * (structure top-left, grammar/accuracy top-right).
 * @param {FeedbackMode | string} mode
 * @param {string} [yearLevel]
 */
export function visibleToggleLabels(mode, yearLevel = 'general') {
  const m = normalizeFeedbackMode(mode);
  const all = MODE_TOGGLE_LABELS[m] || {};
  const senior = new Set(SENIOR_FOCUS_KEYS[m] || []);
  const allowSenior = showSeniorFocuses(yearLevel);
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, label] of Object.entries(all)) {
    if (senior.has(key) && !allowSenior) continue;
    out[key] = label;
  }
  return out;
}

/**
 * Default toggle map — all known focuses on (teacher turns off what they don't want).
 * @param {string} [yearLevel]
 */
export function defaultModeTogglesForYear(yearLevel = 'general') {
  const o = {};
  for (const m of FEEDBACK_MODES) {
    const labels = MODE_TOGGLE_LABELS[m] || {};
    o[m] = {};
    for (const k of Object.keys(labels)) {
      o[m][k] = true;
    }
  }
  return o;
}

/**
 * Merge saved toggles onto current keys; remap legacy keys.
 * @param {Record<string, Record<string, boolean>> | null | undefined} saved
 * @param {string} [yearLevel]
 */
export function mergeModeToggles(saved, yearLevel = 'general') {
  const next = defaultModeTogglesForYear(yearLevel);
  if (!saved || typeof saved !== 'object') return next;
  for (const m of FEEDBACK_MODES) {
    const incoming = saved[m];
    if (!incoming || typeof incoming !== 'object') continue;
    const remap = LEGACY_TOGGLE_KEY_MAP[m] || {};
    const known = MODE_TOGGLE_LABELS[m] || {};
    for (const [rawKey, value] of Object.entries(incoming)) {
      const key = known[rawKey] ? rawKey : remap[rawKey];
      if (key && known[key]) next[m][key] = !!value;
    }
  }
  return next;
}

function subjectLabel(id) {
  const row = SUBJECT_ASSIST_OPTIONS.find((o) => o.id === id);
  return row ? row.label : 'General';
}

/**
 * Normalise year ids from settings / student cards (yr8, Year 8, y8, 8, …).
 * @param {string} [raw]
 * @returns {string} option id or ''
 */
export function normalizeYearLevelId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase();
  if (!id) return '';
  if (YEAR_LEVEL_OPTIONS.some((o) => o.id === id)) return id;
  if (id === 'mixed' || id.startsWith('mixed')) return 'mixed';
  if (id.includes('general')) return 'general';
  const digits = id.replace(/\D/g, '');
  if (digits) {
    const asYr = `yr${digits}`;
    if (YEAR_LEVEL_OPTIONS.some((o) => o.id === asYr)) return asYr;
  }
  const compact = id.replace(/^y(?:ear)?\s*/, 'yr').replace(/^yr(?=\d)/, 'yr');
  if (YEAR_LEVEL_OPTIONS.some((o) => o.id === compact)) return compact;
  return '';
}

function yearLevelLabel(id) {
  const key = normalizeYearLevelId(id);
  const row = YEAR_LEVEL_OPTIONS.find((o) => o.id === key);
  return row ? row.label : '';
}

function yearLevelLine(id) {
  const key = normalizeYearLevelId(id) || 'general';
  const guide = YEAR_LEVEL_GUIDANCE[key] || YEAR_LEVEL_GUIDANCE.general;
  const label = yearLevelLabel(key) || YEAR_LEVEL_OPTIONS[0].label;
  return `Year level: ${label}. ${guide}`;
}

function studentYearLabel(yearLevel) {
  return yearLevelLabel(yearLevel);
}

/**
 * Effective year for a student: personal override if set, else class year
 * (unless class is Mixed — then only personal counts).
 * @param {{ year_level?: string }} student
 * @param {string} classYearLevel
 */
export function effectiveStudentYearId(student, classYearLevel) {
  const personal = normalizeYearLevelId(student?.year_level);
  if (personal) return personal;
  const classId = normalizeYearLevelId(classYearLevel) || 'general';
  if (classId === 'mixed') return '';
  return classId;
}

function glossFor(mode, key, band) {
  const entry = FOCUS_GLOSSES[mode]?.[key];
  if (!entry) return '';
  if (band === 'lower' && entry.lower) return entry.lower;
  if (band === 'senior' && entry.senior) return entry.senior;
  if (band === 'mid' && entry.mid) return entry.mid;
  return entry.default;
}

function formatExampleLine(n) {
  return `${n}. What I like about your writing
[specific strength in Student ${n}’s draft]
[second specific strength]
What I think needs your attention
[Focus label]: [specific wish — what to try next]
[Focus label]: [specific wish]
[Focus label]: [specific wish]`;
}

/**
 * @param {number} studentCount
 */
export function buildLockedOutputRules(studentCount) {
  const n = Math.max(0, Number(studentCount) || 0);
  const example =
    n <= 0
      ? `${formatExampleLine(1)}\n\n${formatExampleLine(2)}`
      : Array.from({ length: Math.min(n, 3) }, (_, i) => formatExampleLine(i + 1)).join('\n\n') +
        (n > 3 ? `\n\n...\n\n${formatExampleLine(n)}` : n >= 2 ? '' : '');

  return `CRITICAL — how you must reply (do not skip):
- Write feedback for exactly ${n || 'each'} student${n === 1 ? '' : 's'} below, in the same order.
- Every reply item MUST start on its own line with the number, a full stop, then a space (1. 2. 3. …). Never start any other line with a number and full stop — that would look like the next student.
- Plain text only: no markdown, no asterisks for bold or italics (write allies not *allies* or **allies**).
- Within each numbered item use exactly this shape (two likes, then up to three wishes):
  - First line after the number: the heading What I like about your writing
  - Then exactly two short lines — each names one specific strength (not vague praise). Prefer real micro-strengths even on a weak draft (e.g. one accurate fact, a clear opening, finishing the task). You may notice craft such as paragraphing, vocabulary or sentence variety when those strengths are real. Do not invent empty compliments.
  - Then the heading What I think needs your attention on its own line
  - Then up to three wish lines. Each wish starts with a teacher-selected focus label and a colon (e.g. Accuracy & Detail: …) and gives specific, actionable advice. Prefer the 2–3 selected areas where advice would most improve the draft. If fewer than three focuses are selected, write fewer wishes. Do not invent wishes outside the selected list.
- Do not write any other heading, intro, or closing before 1. or after the last number.
- Do not use real student names. If you refer to a writer, say Student 1, Student 2, etc.
- Pitch language and expectations to the year level shown for that student. Write in first person (“I”) as a supportive teacher.

Required shape:
${example}`;
}

/**
 * @param {number} studentCount
 */
export function buildLockedClosing(studentCount) {
  const n = Math.max(0, Number(studentCount) || 0);
  if (n <= 0) {
    return 'END OF DRAFTS. Reply with numbered feedback only (plain text; “What I like about your writing” then 2 likes, then “What I think needs your attention” then up to 3 focus wishes): 1. … 2. …';
  }
  return `END OF DRAFTS. Reply now with exactly ${n} numbered items and nothing else — start with "1. " and finish with "${n}. ". Plain text only; each item = What I like about your writing (2 likes) then What I think needs your attention (up to 3 focus-label wishes).`;
}

/**
 * @param {object} params
 * @param {boolean} [params.enforceWordCount] — only include word target when true
 * @param {number} [params.wordTarget]
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
  enforceWordCount = false,
}) {
  const mode = normalizeFeedbackMode(feedbackMode);
  const role = ROLE_BY_MODE[mode] || ROLE_BY_MODE.writing;
  const classYearId = normalizeYearLevelId(yearLevel) || 'general';
  const band = yearBand(classYearId);
  const labels = visibleToggleLabels(mode, classYearId);

  const enabledKeys = Object.entries(toggles || {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .filter((k) => labels[k] || (MODE_TOGGLE_LABELS[mode] || {})[k]);

  const focusBlocks = enabledKeys.map((key) => {
    const label = labels[key] || MODE_TOGGLE_LABELS[mode]?.[key] || key;
    const gloss = glossFor(mode, key, band);
    return gloss ? `- ${label}: ${gloss}` : `- ${label}`;
  });

  const extras = (extraFocusLabels || []).map((s) => String(s).trim()).filter(Boolean);
  for (const extra of extras) {
    focusBlocks.push(`- ${extra}`);
  }

  const focusLine =
    focusBlocks.length > 0
      ? `Teacher-selected focus areas:\n${focusBlocks.join('\n')}`
      : 'Give general improvement feedback suitable for this mode. Prefer one or two concrete next steps per student.';

  const subjectLine =
    subjectAssist && subjectAssist !== 'general'
      ? `Subject context: ${subjectLabel(subjectAssist)}. Tailor feedback to the expectations of this subject while keeping comments simple and useful for students.`
      : '';

  const list = students || [];
  const withPersonalYear = list.filter((s) => normalizeYearLevelId(s.year_level)).length;
  let yearLine;
  if (classYearId === 'mixed') {
    yearLine =
      withPersonalYear > 0
        ? `Year level: mixed class. Each student excerpt includes their own year level when known (${withPersonalYear} of ${list.length} marked). Apply selected focuses at THAT student’s year. Do not expect senior features from younger students.`
        : yearLevelLine('mixed');
  } else if (withPersonalYear > 0) {
    yearLine = `Year level: class default is ${yearLevelLabel(classYearId)}. Some students have an individual year override — use the year shown on each student excerpt. Pitch feedback to that year.`;
  } else {
    yearLine = yearLevelLine(classYearId);
  }

  const customLine =
    mode === 'custom' && String(customFocusText || '').trim()
      ? `Teacher-requested focus: ${String(customFocusText).trim()}`
      : '';

  const enforcedTarget = Number(wordTarget) || 0;
  const targetLine =
    enforceWordCount && enforcedTarget > 0
      ? `The target length is approximately ${enforcedTarget} words. Comment on whether the student is meaningfully under or over the target only when it affects the quality or completeness of the response.`
      : '';

  return [role, '', focusLine, yearLine, subjectLine, customLine, targetLine]
    .filter((p) => p !== '')
    .join('\n');
}

/**
 * @param {Array<{name?: string, text?: string, year_level?: string}>} students
 * @param {string} yearLevel
 */
export function buildLockedRoster(students = [], yearLevel = 'general') {
  const list = students || [];
  const classYearId = normalizeYearLevelId(yearLevel) || 'general';
  return list
    .map((s, i) => {
      const excerpt = (s.text || '').trim() || '(empty draft)';
      const personalId = normalizeYearLevelId(s.year_level);
      const effectiveId = effectiveStudentYearId(s, classYearId);
      const yearShown = yearLevelLabel(effectiveId) || (classYearId === 'mixed' ? 'Not set' : yearLevelLabel(classYearId));
      const note =
        personalId && classYearId !== 'mixed' && personalId !== classYearId
          ? ' (individual override)'
          : '';
      return `--- Student ${i + 1} ---\nYear level: ${yearShown}${note}\n${excerpt}`;
    })
    .join('\n\n');
}

export function buildAiPromptParts(params) {
  const students = params.students || [];
  const studentCount = students.length;
  const yearLevel = normalizeYearLevelId(params.yearLevel) || params.yearLevel || 'general';
  return {
    lockedRules: buildLockedOutputRules(studentCount),
    guidance: buildEditableGuidance({ ...params, yearLevel }),
    roster: buildLockedRoster(students, yearLevel),
    lockedClosing: buildLockedClosing(studentCount),
    studentCount,
  };
}

export function assembleAiPrompt({ lockedRules, guidance, roster, lockedClosing }) {
  return [lockedRules, guidance, roster, lockedClosing].filter((part) => String(part || '').trim()).join('\n\n');
}

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

  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*(\d+)\s*[\.):]\s*(.+?)\s*$/);
    if (!m) continue;
    out.push({ index: Number(m[1]), text: m[2].replace(/^\[/, '').replace(/\]$/, '').trim() });
  }
  return out.sort((a, b) => a.index - b.index);
}
