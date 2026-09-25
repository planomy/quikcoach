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
  assert.match(parts.lockedRules, /two or three/);
  assert.match(parts.guidance, /Year 4/);
  assert.match(parts.guidance, /Story Structure/);
  assert.match(parts.lockedClosing, /exactly 3/);
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
