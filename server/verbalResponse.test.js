import test from 'node:test';
import assert from 'node:assert/strict';
import { decideVerbalResponseAction, isVerbalActivity, liveActivityExpired, VERBAL_PROMPT } from './verbalResponse.js';

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
