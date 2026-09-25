import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleAiPrompt,
  buildAiPrompt,
  buildAiPromptParts,
  parseNumberedPaste,
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

test('prompt locks numbering and year guidance', () => {
  const parts = buildAiPromptParts({
    feedbackMode: 'writing',
    yearLevel: 'yr4',
    toggles: { showDontTell: true },
    students: [{ text: 'Hello' }, { text: 'World' }, { text: 'Again' }],
  });
  assert.match(parts.lockedRules, /1\./);
  assert.match(parts.lockedRules, /exactly 3/);
  assert.match(parts.guidance, /Year 4/);
  assert.match(parts.lockedClosing, /exactly 3/);
  const full = assembleAiPrompt({ ...parts, guidance: parts.guidance + '\nExtra note from teacher.' });
  assert.match(full, /CRITICAL/);
  assert.match(full, /Extra note from teacher/);
  assert.match(full, /END OF DRAFTS/);
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
