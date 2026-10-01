import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGrid } from './fitGrid.js';

test('28 students fit on one laptop-sized board', () => {
  const layout = fitGrid({ count: 28, width: 1190, height: 700 });
  assert.equal(layout.fits, true);
  assert.equal(layout.columns, 7);
  assert.ok(layout.rowHeight >= 150);
});

test('30 and 32 students still fit on one screen', () => {
  for (const count of [30, 32]) {
    const layout = fitGrid({ count, width: 1190, height: 700 });
    assert.equal(layout.fits, true, `${count} should fit`);
    const rows = Math.ceil(count / layout.columns);
    assert.ok(rows * layout.rowHeight + (rows - 1) * 12 <= 700);
  }
});

test('a double class on a small screen falls back to the minimum size and scrolls', () => {
  const layout = fitGrid({ count: 60, width: 900, height: 500 });
  assert.equal(layout.fits, false);
  assert.equal(layout.rowHeight, 96);
  assert.equal(layout.columns, 6);
});

test('a handful of students get big cards, capped in height', () => {
  const layout = fitGrid({ count: 2, width: 1190, height: 700 });
  assert.equal(layout.fits, true);
  assert.equal(layout.columns, 2);
  assert.equal(layout.rowHeight, 360);
});

test('no students or no space returns a safe default', () => {
  assert.deepEqual(fitGrid({ count: 0, width: 1000, height: 600 }), { columns: 1, rowHeight: 96, fits: false });
  assert.deepEqual(fitGrid({ count: 10, width: 0, height: 0 }), { columns: 1, rowHeight: 96, fits: false });
});
