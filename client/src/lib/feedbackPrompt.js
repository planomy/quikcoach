/** @typedef {'writing'|'explanation'|'argument'|'problem_solving'|'custom'} FeedbackMode */
/** @typedef {'lower'|'mid'|'senior'} YearBand */

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

/**
 * Teacher-facing focus toggles (5 per mode). Keys are stable ids used in saved room settings.
 * @type {Record<FeedbackMode, Record<string, string>>}
 */
export const MODE_TOGGLE_LABELS = {
  writing: {
    storyStructure: 'Story Structure',
    showDontTell: "Show, Don't Tell",
    wordChoice: 'Word Choice',
    sentenceVariety: 'Sentence Variety',
    paragraphingFlow: 'Paragraphing & Flow',
  },
  explanation: {
    structureSequencing: 'Structure & Sequencing',
    causeEffect: 'Cause and Effect',
    keyTermsVocab: 'Key Terms & Vocabulary',
    accuracyDetail: 'Accuracy & Detail',
    linkingWords: 'Linking Words',
  },
  argument: {
    clearPosition: 'Clear Position',
    paragraphTeel: 'Paragraph Structure (TEEL)',
    evidenceExamples: 'Evidence & Examples',
    explainingEvidence: 'Explaining the Evidence',
    audiencePersuasiveLanguage: 'Audience & Persuasive Language',
  },
  problem_solving: {
    understandingQuestion: 'Understanding the Question',
    settingOutWorking: 'Setting Out Working',
    methodStrategy: 'Method & Strategy',
    accuracy: 'Accuracy',
    answerReasonableness: 'Answer & Reasonableness',
  },
  custom: {},
};

/** Map old toggle keys (pre v3) onto the current set. */
const LEGACY_TOGGLE_KEY_MAP = {
  writing: {
    sensoryDetail: 'showDontTell',
    characterVoice: 'showDontTell',
    paragraphFlow: 'paragraphingFlow',
  },
  explanation: {
    clarityIdeas: 'structureSequencing',
    keyTerms: 'keyTermsVocab',
    accurateDetail: 'accuracyDetail',
    logicalSequencing: 'structureSequencing',
  },
  argument: {
    strongEvidence: 'evidenceExamples',
    explainEvidence: 'explainingEvidence',
    persuasiveReasoning: 'explainingEvidence',
    audienceAwareness: 'audiencePersuasiveLanguage',
  },
  problem_solving: {
    clearWorking: 'settingOutWorking',
    logicalSteps: 'settingOutWorking',
    methodAccuracy: 'methodStrategy',
    mathCommunication: 'accuracy',
    answerCheck: 'answerReasonableness',
  },
};

/**
 * Hidden AI glosses per focus. `default` is mid-band; lower/senior override when year band matches.
 * @type {Record<string, Record<string, { default: string, lower?: string, senior?: string }>>}
 */
const FOCUS_GLOSSES = {
  writing: {
    storyStructure: {
      default:
        'Check for a clear opening, a complication worth caring about, and a resolution that is not rushed.',
      lower: 'Help the story have a beginning, a problem in the middle, and an ending that finishes the problem.',
      senior: 'Judge orientation–complication–resolution pacing; flag rushed endings and undeveloped turning points.',
    },
    showDontTell: {
      default:
        'Replace stated feelings with action, dialogue, body language and sensory detail where useful.',
      lower: 'Use what a character sees, hears and does to show how they feel, instead of naming the feeling.',
      senior: 'Prefer implication and restraint over stating emotion; quote a told line and suggest a shown rewrite.',
    },
    wordChoice: {
      default: 'Prefer precise verbs and nouns; quote one weak or repeated word and offer a stronger alternative.',
      lower: 'Pick one everyday word and suggest a more interesting one the student could try.',
      senior: 'Push for precise diction and avoid vague intensifiers; one concrete upgrade is enough.',
    },
    sentenceVariety: {
      default: 'Mix short and long sentences; vary openers; avoid chains of “and then”.',
      lower: 'Try a short sentence next to a longer one so the writing does not all sound the same.',
    },
    paragraphingFlow: {
      default: 'New paragraph for a new time, place, speaker or event; smooth links between them.',
      lower: 'Start a new paragraph when something new happens (new time, place, or person speaking).',
    },
  },
  explanation: {
    structureSequencing: {
      default: 'Open by saying what the thing is, then take the reader through in a logical order.',
      lower: 'Start by saying what you are explaining, then put the steps in order.',
    },
    causeEffect: {
      default: 'Make the why and so-what explicit, not just the what.',
    },
    keyTermsVocab: {
      default: 'Use the correct subject terms accurately, not just as decoration.',
    },
    accuracyDetail: {
      default: 'Flag vagueness and anything that may be factually shaky; ask for specific detail where needed.',
    },
    linkingWords: {
      default: 'Use connectives that carry explanation: because, as a result, therefore, this means that, first/next/finally.',
      lower: 'Use simple linking words like because, so, first, next, and finally.',
    },
  },
  argument: {
    clearPosition: {
      default: 'A position stated up front, held consistently, and restated at the end.',
      lower: 'Say clearly what you think at the start and stick to it.',
    },
    paragraphTeel: {
      default: 'Topic sentence, evidence, explanation, link — one idea per paragraph (TEEL/PEEL).',
      lower: 'One idea per paragraph: say the idea, give an example, then say why it matters.',
      senior: 'Expect TEEL/PEEL control; flag missing explanation or weak links back to the contention.',
    },
    evidenceExamples: {
      default: 'Prefer specific, relevant support over bare assertion.',
    },
    explainingEvidence: {
      default: 'Spell out how each piece of evidence supports the position; do not leave the reader to join the dots.',
    },
    audiencePersuasiveLanguage: {
      default:
        'Word choice and devices pitched at the reader: emotive language, rhetorical questions, modality, inclusive language.',
      lower: 'Choose words that would convince a reader; try a question or feeling-word if it fits.',
    },
  },
  problem_solving: {
    understandingQuestion: {
      default: 'Identify what is given, what is asked, and the units before calculating.',
    },
    settingOutWorking: {
      default: 'One step per line, equals signs used carefully, so a reader can follow without guessing.',
    },
    methodStrategy: {
      default: 'Is the approach appropriate and efficient? Name a better strategy if there is one.',
    },
    accuracy: {
      default:
        'Check arithmetic and substitution. Raise anything suspect as a question (e.g. “check line 3 — 24 or 42?”) rather than declaring a final verdict.',
    },
    answerReasonableness: {
      default: 'Final answer clear, correct units, and a quick sanity check that the size of the answer makes sense.',
    },
  },
};

/** Default-on keys by year band (about 3 per mode — depth over checklist). */
const DEFAULT_ON_BY_BAND = {
  writing: {
    lower: ['storyStructure', 'showDontTell', 'wordChoice'],
    mid: ['storyStructure', 'showDontTell', 'paragraphingFlow'],
    senior: ['showDontTell', 'wordChoice', 'paragraphingFlow'],
  },
  explanation: {
    lower: ['structureSequencing', 'causeEffect', 'linkingWords'],
    mid: ['linkingWords', 'keyTermsVocab', 'accuracyDetail'],
    senior: ['keyTermsVocab', 'causeEffect', 'accuracyDetail'],
  },
  argument: {
    lower: ['clearPosition', 'evidenceExamples', 'explainingEvidence'],
    mid: ['clearPosition', 'paragraphTeel', 'explainingEvidence'],
    senior: ['paragraphTeel', 'explainingEvidence', 'audiencePersuasiveLanguage'],
  },
  problem_solving: {
    lower: ['understandingQuestion', 'settingOutWorking', 'answerReasonableness'],
    mid: ['understandingQuestion', 'settingOutWorking', 'methodStrategy'],
    senior: ['methodStrategy', 'answerReasonableness', 'accuracy'],
  },
  custom: { lower: [], mid: [], senior: [] },
};

const ROLE_BY_MODE = {
  writing:
    'You are an expert narrative writing coach for school students. Focus on craft, clarity, and improvement at the year level given for each student.',
  explanation:
    'You are an expert teacher helping students improve explanatory writing. Focus on clarity, accurate detail, and logical development of ideas at the year level given for each student.',
  argument:
    'You are an expert teacher helping students improve argument writing. Focus on position, reasoning, evidence, and audience impact at the year level given for each student.',
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
  const id = String(yearLevel || 'general').trim().toLowerCase();
  if (id === 'yr2' || id === 'yr3' || id === 'yr4') return 'lower';
  if (id === 'yr9' || id === 'yr10' || id === 'yr11' || id === 'yr12') return 'senior';
  return 'mid';
}

/**
 * Default toggle map for a year level (about three focuses on).
 * @param {string} [yearLevel]
 */
export function defaultModeTogglesForYear(yearLevel = 'general') {
  const band = yearBand(yearLevel);
  const o = {};
  for (const m of FEEDBACK_MODES) {
    const labels = MODE_TOGGLE_LABELS[m] || {};
    const on = new Set(DEFAULT_ON_BY_BAND[m]?.[band] || []);
    o[m] = {};
    for (const k of Object.keys(labels)) {
      o[m][k] = on.has(k);
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

function glossFor(mode, key, band) {
  const entry = FOCUS_GLOSSES[mode]?.[key];
  if (!entry) return '';
  if (band === 'lower' && entry.lower) return entry.lower;
  if (band === 'senior' && entry.senior) return entry.senior;
  return entry.default;
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
- For each student, use at most two or three focus points — choose the ones that will most improve that draft. Do not tick through every focus as a checklist.

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
  const band = yearBand(yearLevel);
  const labels = MODE_TOGGLE_LABELS[mode] || {};

  const enabledKeys = Object.entries(toggles || {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .filter((k) => labels[k]);

  const focusBlocks = enabledKeys.map((key) => {
    const label = labels[key];
    const gloss = glossFor(mode, key, band);
    return gloss ? `- ${label}: ${gloss}` : `- ${label}`;
  });

  const extras = (extraFocusLabels || []).map((s) => String(s).trim()).filter(Boolean);
  for (const extra of extras) {
    focusBlocks.push(`- ${extra}`);
  }

  const focusLine =
    focusBlocks.length > 0
      ? `Teacher focus points (use at most two or three per student — pick what will help most):\n${focusBlocks.join('\n')}`
      : 'Give general improvement feedback suitable for this mode. Prefer one or two concrete next steps per student.';

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
 * Full prompt (locked envelope + guidance + roster).
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

  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*(\d+)\s*[\.):]\s*(.+?)\s*$/);
    if (!m) continue;
    out.push({ index: Number(m[1]), text: m[2].replace(/^\[/, '').replace(/\]$/, '').trim() });
  }
  return out.sort((a, b) => a.index - b.index);
}
