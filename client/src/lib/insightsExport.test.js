import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymisedRows, headlineTotals, insightsCsv, suppressCount } from './insightsExport.js';

const lesson = (over) => ({
  id: 1,
  roomCode: '4101',
  startedAt: Date.UTC(2026, 8, 1),
  endedAt: Date.UTC(2026, 8, 1, 1),
  students: 24,
  commentsGiven: 40,
  actedOn: 30,
  actedOnPct: 75,
  checkAgain: 6,
  checkAgainPct: 15,
  confirmed: 20,
  avgConfirmMinutes: 12,
  pastes: 7,
  pasteAlerts: 3,
  avgWords: 180,
  writingPct: 70,
  writingSamples: 8,
  ...over,
});

test('counts from 1 to 4 are hidden, zero and 5+ are shown', () => {
  assert.equal(suppressCount(0), '0');
  assert.equal(suppressCount(1), '<5');
  assert.equal(suppressCount(4), '<5');
  assert.equal(suppressCount(5), '5');
});

test('export is class-level, anonymised and suppresses small groups', () => {
  const lessons = [
    lesson({ id: 2, startedAt: Date.UTC(2026, 8, 8), roomCode: '4102', students: 3, commentsGiven: 4, actedOn: 2 }),
    lesson({ id: 1 }),
  ];
  const rows = anonymisedRows(lessons);
  assert.equal(rows[0].lesson, 'Lesson 1');
  assert.equal(rows[0].group, 'Group 1');
  assert.equal(rows[0].actedOn, '75%');
  assert.equal(rows[0].pasteAlerts, '<5');
  assert.equal(rows[1].students, '<5');
  assert.equal(rows[1].actedOn, '—', 'rates need at least 5 comments behind them');
  assert.equal(rows[1].avgWords, '—', 'averages hidden for groups under 5');

  const csv = insightsCsv(lessons);
  assert.ok(!csv.includes('4101') && !csv.includes('4102'), 'room codes are not exported');
  assert.match(csv.split('\n')[0], /^Lesson,Group,Date,Students/);
});

test('headline totals weight averages by what sits behind them', () => {
  const totals = headlineTotals([
    lesson({ commentsGiven: 10, actedOn: 5, avgConfirmMinutes: 10, confirmed: 1, pasteAlerts: 2 }),
    lesson({ commentsGiven: 30, actedOn: 27, avgConfirmMinutes: 20, confirmed: 3, pasteAlerts: 0 }),
  ]);
  assert.equal(totals.commentsGiven, 40);
  assert.equal(totals.actedOnPct, 80);
  assert.equal(totals.avgConfirmMinutes, 17.5);
  assert.equal(totals.pasteAlertsPerLesson, 1);
});
