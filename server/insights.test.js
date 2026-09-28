import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iboard-insights-'));
const { openDatabase, queries } = await import('./db.js');
const insights = await import('./insights.js');

const db = openDatabase();
const MIN = 60 * 1000;

function classOf(code, names) {
  queries.ensureRoom(db, code);
  return names.map((name) => queries.addStudent(db, code, name));
}

test('insertedLength measures the pasted span', () => {
  assert.equal(insights.insertedLength('abc', 'aXYZbc'), 3);
  assert.equal(insights.insertedLength('', 'hello'), 5);
  assert.equal(insights.insertedLength('same', 'same'), 0);
  assert.equal(insights.insertedLength('abcdef', 'abf'), 0);
});

test('comment loop, pastes, words and resets roll up per lesson and survive a new class', () => {
  const code = '4101';
  const [mia, leo] = classOf(code, ['Mia', 'Leo']);
  const t0 = Date.UTC(2026, 8, 1, 9, 0);

  insights.insightCommentAdded(code, mia.id, 1, t0);
  insights.insightCommentAdded(code, mia.id, 2, t0 + MIN);
  insights.insightCommentAdded(code, leo.id, 3, t0 + MIN);
  insights.insightCommentAdded(code, leo.id, 4, t0 + MIN);
  insights.insightCommentFixed(code, mia.id, 1, t0 + 3 * MIN);
  insights.insightCommentReopened(code, mia.id, 1, t0 + 4 * MIN);
  insights.insightCommentFixed(code, mia.id, 1, t0 + 5 * MIN);
  insights.insightCommentConfirmed(code, mia.id, 1, t0 + 11 * MIN);
  insights.insightCommentFixed(code, leo.id, 3, t0 + 6 * MIN);
  insights.insightCommentDeleted(code, leo.id, 4, t0 + 7 * MIN);
  insights.insightPaste(code, leo.id, 30, t0 + 8 * MIN);
  insights.insightPaste(code, leo.id, 400, t0 + 9 * MIN);

  queries.updateStudentText(db, mia.id, 'one two three four');
  queries.updateStudentText(db, leo.id, 'one two');

  let result = insights.getInsights({ roomCode: code });
  assert.equal(result.lessons.length, 1);
  let [lesson] = result.lessons;
  assert.equal(lesson.endedAt, null);
  assert.equal(lesson.commentsGiven, 3, 'a comment withdrawn before it was acted on is not counted');
  assert.equal(lesson.actedOn, 2);
  assert.equal(lesson.actedOnPct, 67);
  assert.equal(lesson.checkAgain, 1);
  assert.equal(lesson.avgConfirmMinutes, 11);
  assert.equal(lesson.pastes, 2);
  assert.equal(lesson.pasteAlerts, 1);
  assert.equal(lesson.avgWords, 3);
  assert.equal(lesson.students, 2);

  insights.insightLessonEnd(code, t0 + 50 * MIN);
  queries.deleteAllStudents(db, code);

  result = insights.getInsights({ roomCode: code });
  [lesson] = result.lessons;
  assert.equal(lesson.endedAt, t0 + 50 * MIN);
  assert.equal(lesson.avgWords, 3, 'words were captured before the class was cleared');
  assert.equal(lesson.commentsGiven, 3);

  const byName = Object.fromEntries(result.students.map((row) => [row.name, row]));
  assert.equal(byName.Mia.commentsGiven, 2);
  assert.equal(byName.Mia.actedOn, 1);
  assert.equal(byName.Mia.checkAgain, 1);
  assert.equal(byName.Mia.avgWords, 4);
  assert.equal(byName.Leo.pasteAlerts, 1);

  const [mia2] = classOf(code, ['mia ']);
  insights.insightCommentAdded(code, mia2.id, 9, t0 + 24 * 60 * MIN);
  result = insights.getInsights({ roomCode: code });
  assert.equal(result.lessons.length, 2);
  assert.equal(result.students.find((row) => row.key === `${code}:mia`).lessons, 2, 'returning student lines up by name');

  const onlyFirst = insights.getInsights({ roomCode: code, lessonId: result.lessons[1].id });
  assert.equal(onlyFirst.students.find((row) => row.name === 'Mia').commentsGiven, 2);
});

test('a long idle gap splits lessons and activity sampling covers the whole class', () => {
  const code = '4102';
  const [a, , ] = classOf(code, ['Ana', 'Ben', 'Cy', 'Di']);
  const t0 = Date.UTC(2026, 8, 2, 9, 0);
  insights.insightTextChanged(code, a.id, t0);
  insights.sampleActivity(t0 + 5 * MIN);
  insights.insightTextChanged(code, a.id, t0 + 6 * MIN);
  insights.sampleActivity(t0 + 10 * MIN);
  let [lesson] = insights.getInsights({ roomCode: code }).lessons;
  assert.equal(lesson.writingSamples, 2);
  assert.equal(lesson.writingPct, 25);

  insights.insightCommentAdded(code, a.id, 50, t0 + 8 * 60 * MIN);
  const { lessons } = insights.getInsights({ roomCode: code });
  assert.equal(lessons.length, 2);
  assert.ok(lessons[1].endedAt, 'the stale lesson was closed');
  [lesson] = lessons;
  assert.equal(lesson.commentsGiven, 1);
});

test('live paste counts follow the current roster and clear on a new class', () => {
  const code = '4103';
  const [ana, ben] = classOf(code, ['Ana', 'Ben']);
  const now = Date.now();
  insights.insightPaste(code, ana.id, 5, now);
  insights.insightPaste(code, ana.id, 300, now + 1000);
  insights.insightPaste(code, ben.id, 2, now + 2000);
  assert.deepEqual(insights.livePasteCounts(code, now + 3000), { [ana.id]: 2, [ben.id]: 1 });

  insights.insightLessonEnd(code, now + 4000);
  assert.deepEqual(insights.livePasteCounts(code, now + 5000), {});
});

test('recording failures never throw into the lesson', () => {
  assert.doesNotThrow(() => insights.insightCommentAdded(null, 'nope', undefined));
  assert.doesNotThrow(() => insights.insightPaste('9999', 123456, 'x'));
});
