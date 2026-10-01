import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecipientIds, isTargetedMaterial, materialVisibleTo, materialHistoryForStudent } from './materialRecipients.js';

test('no recipient list means everyone', () => {
  assert.equal(normalizeRecipientIds(undefined, [1, 2]), null);
  assert.equal(normalizeRecipientIds(null, [1, 2]), null);
});

test('recipient list keeps only unique students in this room', () => {
  assert.deepEqual(normalizeRecipientIds([2, '3', 2, 99, 0, -1, 'x'], [1, 2, 3]), [2, 3]);
  assert.deepEqual(normalizeRecipientIds([99], [1, 2]), []);
  assert.deepEqual(normalizeRecipientIds('nope', [1, 2]), []);
});

test('untargeted files reach every student, including late joiners', () => {
  const item = { id: 'm1', url: '/a' };
  assert.equal(isTargetedMaterial(item), false);
  assert.equal(materialVisibleTo(item, 1), true);
  assert.equal(materialVisibleTo(item, 42), true);
});

test('targeted files reach only the chosen students', () => {
  const item = { id: 'm2', url: '/b', studentIds: [1, 3] };
  assert.equal(isTargetedMaterial(item), true);
  assert.equal(materialVisibleTo(item, 1), true);
  assert.equal(materialVisibleTo(item, '3'), true);
  assert.equal(materialVisibleTo(item, 2), false);
  assert.equal(materialVisibleTo(item, 42), false);
});

test('each student history hides other students’ files and strips the recipient list', () => {
  const history = [
    { id: 'a', url: '/a' },
    { id: 'b', url: '/b', studentIds: [1] },
    { id: 'c', url: '/c', studentIds: [2] },
  ];
  assert.deepEqual(materialHistoryForStudent(history, 1), [{ id: 'a', url: '/a' }, { id: 'b', url: '/b' }]);
  assert.deepEqual(materialHistoryForStudent(history, 2), [{ id: 'a', url: '/a' }, { id: 'c', url: '/c' }]);
  assert.deepEqual(materialHistoryForStudent(history, 7), [{ id: 'a', url: '/a' }]);
});
