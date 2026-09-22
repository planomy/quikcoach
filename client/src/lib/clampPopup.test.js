import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPopupSide } from './clampPopup.js';

test('prefers below when both sides fit', () => {
  assert.equal(pickPopupSide({ spaceBelow: 40, spaceAbove: 80, prefer: 'below' }), 'below');
});

test('flips above when below does not fit and nothing is locked', () => {
  assert.equal(pickPopupSide({ spaceBelow: -8, spaceAbove: 60, prefer: 'below' }), 'above');
});

test('keeps a locked below side through a small bottom-edge overflow', () => {
  assert.equal(
    pickPopupSide({ spaceBelow: -8, spaceAbove: 60, prefer: 'below', lock: 'below' }),
    'below'
  );
});

test('flips a locked below side only when overflow is clearly past hysteresis', () => {
  assert.equal(
    pickPopupSide({ spaceBelow: -40, spaceAbove: 60, prefer: 'below', lock: 'below' }),
    'above'
  );
});

test('picks the roomier side when neither fully fits', () => {
  assert.equal(pickPopupSide({ spaceBelow: -20, spaceAbove: -8, prefer: 'below' }), 'above');
  assert.equal(pickPopupSide({ spaceBelow: -8, spaceAbove: -20, prefer: 'below' }), 'below');
});
