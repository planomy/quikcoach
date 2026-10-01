import test from 'node:test';
import assert from 'node:assert/strict';
import { decideVerbalResponseAction, isVerbalActivity, liveActivityExpired, parseDbTime, VERBAL_PROMPT } from './verbalResponse.js';

const NOW = Date.UTC(2026, 9, 1, 9, 0);
const launchedAt = new Date(NOW - 10_000).toISOString();

function live(overrides = {}) {
  return { id: 'a1', type: 'short', prompt: 'Why?', locked: false, timerSeconds: 0, launchedAt, endsAt: '', ...overrides };
}

const decide = (activity, extra = {}) => decideVerbalResponseAction({ activity, now: NOW, ...extra }).action;

test('nothing live starts a new verbal round', () => {
  assert.equal(decide(null), 'launch');
});

test('an open teacher short question takes the + Answer instead of being replaced', () => {
  assert.equal(decide(live()), 'answer');
});

test('an open verbal round takes repeat answers as updates, never a new round', () => {
  assert.equal(decide(live({ prompt: VERBAL_PROMPT })), 'answer');
});

test('a re-answer inside 15s of the last answer changes it; after 15s quiet it starts the next round', () => {
  const verbal = live({ prompt: VERBAL_PROMPT });
  const at = (msAgo) => new Date(NOW - msAgo).toISOString().replace('T', ' ').slice(0, 19);
  const responses = [
    { activityId: 'a1', studentId: 1, submittedAt: at(40_000) },
    { activityId: 'a1', studentId: 2, submittedAt: at(5_000) },
    { activityId: 'old', studentId: 3, submittedAt: at(90_000) },
  ];
  assert.equal(decide(verbal, { responses, studentId: 1 }), 'answer');
  assert.equal(decide(verbal, { responses, studentId: 3 }), 'answer');
  const quiet = responses.map((response) => ({ ...response, submittedAt: at(16_000) }));
  assert.equal(decide(verbal, { responses: quiet, studentId: 1 }), 'launch');
  assert.equal(decide(verbal, { responses: quiet, studentId: 4 }), 'answer');
  assert.equal(decide(live(), { responses: quiet, studentId: 1 }), 'answer');
  const unreadable = [{ activityId: 'a1', studentId: 1, submittedAt: 'bad' }];
  assert.equal(decide(verbal, { responses: unreadable, studentId: 1 }), 'answer');
});

test('database times are read as UTC', () => {
  assert.equal(parseDbTime('2026-10-01 09:00:00'), Date.UTC(2026, 9, 1, 9, 0));
  assert.equal(parseDbTime('2026-10-01T09:00:00.000Z'), Date.UTC(2026, 9, 1, 9, 0));
  assert.ok(Number.isNaN(parseDbTime('')));
});

test('open choice, rating and set questions refuse with a friendly message', () => {
  for (const type of ['choice', 'rating', 'set']) {
    const result = decideVerbalResponseAction({ activity: live({ type, options: ['A', 'B'] }), now: NOW });
    assert.equal(result.action, 'refuse', type);
    assert.equal(result.error, 'Answer the question on your screen first');
  }
});

test('locked or timed-out questions make way for a fresh verbal round', () => {
  assert.equal(decide(live({ locked: true })), 'launch');
  assert.equal(decide(live({ type: 'choice', locked: true })), 'launch');
  assert.equal(decide(live({ prompt: VERBAL_PROMPT, locked: true })), 'launch');
  assert.equal(decide(live({ timerSeconds: 5 })), 'launch');
  assert.equal(decide(live({ type: 'choice', timerSeconds: 30, endsAt: new Date(NOW - 1).toISOString() })), 'launch');
  assert.equal(decide(live({ type: 'choice', timerSeconds: 30 })), 'refuse');
});

test('students left out of an open question cannot replace it', () => {
  const asker = decideVerbalResponseAction({ activity: live(), now: NOW, eligible: false, isAsker: true });
  assert.deepEqual(asker, { action: 'refuse', error: 'This is your question — no need to answer it' });
  const untargeted = decideVerbalResponseAction({ activity: live({ type: 'choice' }), now: NOW, eligible: false });
  assert.equal(untargeted.action, 'refuse');
  assert.match(untargeted.error, /other students/);
});

test('helpers recognise verbal rounds and timer expiry', () => {
  assert.equal(isVerbalActivity(live({ prompt: VERBAL_PROMPT })), true);
  assert.equal(isVerbalActivity(live({ type: 'choice', prompt: VERBAL_PROMPT })), false);
  assert.equal(liveActivityExpired(live(), NOW), false);
  assert.equal(liveActivityExpired(live({ timerSeconds: 15 }), NOW), false);
  assert.equal(liveActivityExpired(live({ timerSeconds: 10 }), NOW), true);
  assert.equal(liveActivityExpired(live({ timerSeconds: 15, launchedAt: 'bad' }), NOW), false);
});
