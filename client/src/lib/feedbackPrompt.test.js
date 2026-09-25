import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleAiPrompt,
  buildAiPrompt,
  buildAiPromptParts,
  defaultModeTogglesForYear,
  mergeModeToggles,
  parseNumberedPaste,
  showSeniorFocuses,
  visibleToggleLabels,
  yearBand,
} from './feedbackPrompt.js';

test('prompt never includes student names', () => {
  const prompt = buildAiPrompt({
    feedbackMode: 'writing',
    yearLevel: 'yr5',
    students: [
      { name: 'Alex Rivera', text: 'Once upon a time' },
      { name: 'Sam Lee', text: 'The dragon roared' },
    ],
  });
  assert.equal(prompt.includes('Alex'), false);
  assert.equal(prompt.includes('Rivera'), false);
  assert.equal(prompt.includes('Sam Lee'), false);
  assert.match(prompt, /Student 1/);
  assert.match(prompt, /Student 2/);
});

test('prompt locks numbering and injects focus glosses', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr4',
    toggles: { storyStructure: true, showDontTell: true },
    students: [{ text: 'Hello' }, { text: 'World' }, { text: 'Again' }],
  });
  assert.match(parts.lockedRules, /1\./);
  assert.match(parts.lockedRules, /exactly 3/);
  assert.match(parts.lockedRules, /two stars and up to three wishes/);
  assert.match(parts.lockedRules, /Exactly two lines starting with "Star: "/);
  assert.match(parts.lockedRules, /Plain text only/);
  assert.match(parts.guidance, /Year 4/);
  assert.match(parts.guidance, /Story Structure/);
  assert.match(parts.lockedClosing, /exactly 3/);
  assert.match(parts.lockedClosing, /2 Star:/);
  const full = assembleAiPrompt({ ...parts, guidance: parts.guidance + '\nExtra note from teacher.' });
  assert.match(full, /CRITICAL/);
  assert.match(full, /Extra note from teacher/);
  assert.match(full, /END OF DRAFTS/);
});

test('year change does not rearrange defaults — all on', () => {
  const y3 = defaultModeTogglesForYear('yr3');
  const y10 = defaultModeTogglesForYear('yr10');
  assert.equal(y3.argument.positionContention, true);
  assert.equal(y10.argument.positionContention, true);
  assert.equal(y3.writing.sentenceVariety, true);
  assert.equal(y10.writing.themeSubtext, true);
});

test('senior focuses appear only for older / mixed / general', () => {
  assert.equal(showSeniorFocuses('yr3'), false);
  assert.equal(showSeniorFocuses('yr10'), true);
  assert.equal(showSeniorFocuses('mixed'), true);
  const y3 = visibleToggleLabels('argument', 'yr3');
  const y10 = visibleToggleLabels('argument', 'yr10');
  assert.equal('perspectivesValues' in y3, false);
  assert.equal('perspectivesValues' in y10, true);
  assert.equal('positionContention' in y3, true);
  assert.equal('positionContention' in y10, true);
});

test('year bands', () => {
  assert.equal(yearBand('yr3'), 'lower');
  assert.equal(yearBand('yr7'), 'mid');
  assert.equal(yearBand('yr11'), 'senior');
});

test('focus grid: structure left, grammar/accuracy right', () => {
  const narr = Object.keys(visibleToggleLabels('writing', 'yr3'));
  assert.equal(narr[0], 'storyStructure');
  assert.equal(narr[1], 'mechanics');
  const arg = Object.keys(visibleToggleLabels('argument', 'yr3'));
  assert.equal(arg[0], 'structureCohesion');
  assert.equal(arg[1], 'mechanics');
  const maths = Object.keys(visibleToggleLabels('problem_solving', 'yr3'));
  assert.equal(maths[0], 'understandingProblem');
  assert.equal(maths[1], 'accuracy');
});

test('legacy toggle keys remap', () => {
  const merged = mergeModeToggles(
    {
      writing: { sensoryDetail: true, paragraphFlow: true },
      argument: { clearPosition: true, paragraphTeel: true },
      problem_solving: { clearWorking: true, answerCheck: false },
    },
    'yr8'
  );
  assert.equal(merged.writing.showDontTell, true);
  assert.equal(merged.writing.paragraphingFlow, true);
  assert.equal(merged.argument.positionContention, true);
  assert.equal(merged.argument.structureCohesion, true);
  assert.equal(merged.problem_solving.workingProcess, true);
  assert.equal(merged.problem_solving.answerReasonableness, false);
});

test('year 8 is Year 8 not General', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr8',
    toggles: { storyStructure: true },
    students: [{ text: 'Draft one' }, { text: 'Draft two' }],
  });
  assert.match(parts.guidance, /Year level: Year 8/);
  assert.equal(parts.guidance.includes('General (secondary)'), false);
  assert.match(parts.roster, /Year level: Year 8/);
});

test('word target only when enforcement is on', () => {
  const off = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr8',
    wordTarget: 150,
    enforceWordCount: false,
    students: [{ text: 'Hi' }],
  });
  assert.equal(off.guidance.includes('150'), false);
  assert.equal(off.guidance.toLowerCase().includes('word'), false);

  const on = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr8',
    wordTarget: 150,
    enforceWordCount: true,
    students: [{ text: 'Hi' }],
  });
  assert.match(on.guidance, /approximately 150 words/);
  assert.match(on.guidance, /meaningfully under or over/);
});

test('students inherit class year unless personal override', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr8',
    students: [
      { text: 'A', year_level: '' },
      { text: 'B', year_level: 'yr5' },
    ],
  });
  assert.match(parts.roster, /Student 1 ---\nYear level: Year 8/);
  assert.match(parts.roster, /Student 2 ---\nYear level: Year 5 \(individual override\)/);
});

test('focus wording reviews selected areas only', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr8',
    toggles: { storyStructure: true, mechanics: true },
    students: [{ text: 'Hi' }],
  });
  assert.match(parts.lockedRules, /two stars and up to three wishes/);
  assert.match(parts.lockedRules, /Do not invent wishes outside the selected list/);
  assert.match(parts.guidance, /^[\s\S]*Teacher-selected focus areas:\n/);
  assert.equal(
    (parts.guidance.match(/Review the student’s writing against every selected/g) || []).length,
    0
  );
  assert.match(parts.guidance, /do not proofread or rewrite the whole response/);
  assert.equal(parts.guidance.includes('craft is rarely silent'), false);
});

test('stars may notice craft strengths; wishes stay on selected focuses', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr8',
    toggles: { paragraphingFlow: true, wordChoice: true, sentenceVariety: true },
    students: [{ text: 'Hi' }],
  });
  assert.match(parts.lockedRules, /paragraphing, vocabulary or sentence variety/);
  assert.match(parts.lockedRules, /Star: /);
  assert.equal(parts.guidance.includes('craft is rarely silent'), false);
});

test('explanation mode uses the same stars-and-wishes shape', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'explanation',
    yearLevel: 'yr8',
    toggles: { structureSequencing: true, keyTermsVocab: true },
    students: [{ text: 'Hi' }],
  });
  assert.match(parts.lockedRules, /two stars and up to three wishes/);
  assert.equal(parts.guidance.includes('craft is rarely silent'), false);
});

test('explanation structure gloss is logical not chronological', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'explanation',
    yearLevel: 'yr8',
    toggles: { structureSequencing: true },
    students: [{ text: 'Hi' }],
  });
  assert.match(parts.guidance, /clear, logical sequence/);
  assert.equal(parts.guidance.includes('through in order'), false);
});

test('explanation evidence focus uses Sources and keeps data optional', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'explanation',
    yearLevel: 'yr8',
    toggles: { evidenceExamplesData: true },
    students: [{ text: 'Hi' }],
  });
  assert.match(parts.guidance, /Evidence, Examples & Sources/);
  assert.match(
    parts.guidance,
    /relevant evidence, examples, sources or data where they strengthen the explanation/
  );
  assert.equal(parts.guidance.includes('Evidence, Examples & Data'), false);
});

test('parseNumberedPaste keeps newlines inside a student block', () => {
  const parsed = parseNumberedPaste(
    '1. Solid opening.\nAccuracy & Detail: be more specific.\nKey Terms & Vocabulary: use allies not friends.\n2. Clear conclusion.\nStructure & Sequencing: group long-term causes first.'
  );
  assert.equal(parsed.length, 2);
  assert.match(parsed[0].text, /Solid opening\.\nAccuracy & Detail:/);
  assert.match(parsed[0].text, /Key Terms & Vocabulary:/);
  assert.equal(parsed[0].text.includes('**'), false);
  assert.match(parsed[1].text, /Clear conclusion\.\nStructure & Sequencing:/);
});

test('parseNumberedPaste accepts 1. blocks', () => {
  const parsed = parseNumberedPaste('1. Great start\n2. Add more detail\n3. Check ending');
  assert.deepEqual(
    parsed.map((p) => ({ index: p.index, text: p.text })),
    [
      { index: 1, text: 'Great start' },
      { index: 2, text: 'Add more detail' },
      { index: 3, text: 'Check ending' },
    ]
  );
});
