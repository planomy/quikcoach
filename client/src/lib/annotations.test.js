import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationMarkersMatch, commentGutterLane, commentTone, inferReplacementPassage, locateQuote, resolveAnnotation, stackGutterMarkers } from './annotations.js';

const spelling = {
  quote: 'recieve',
  start_offset: 10,
  prefix_context: 'Please ',
  suffix_context: ' this word',
};

test('replacement is only the new word, not the following sentence', () => {
  const text = 'Please receive this word cupidatat non proident extra padding here';
  const found = inferReplacementPassage(spelling, text);
  assert.equal(found.before, 'recieve');
  assert.equal(found.after, 'receive');
});

test('missing suffix still does not grab neighbouring prose', () => {
  const text = 'Please receive cupidatat non proident extra padding here';
  const found = inferReplacementPassage(
    { ...spelling, suffix_context: ' this vanished suffix' },
    text
  );
  assert.equal(found.after, 'receive');
});

test('resolveAnnotation highlights the replacement once the quote is gone', () => {
  const text = 'Please receive this word';
  const resolved = resolveAnnotation(spelling, text);
  assert.equal(resolved.detached, true);
  assert.equal(text.slice(resolved.start, resolved.end), 'receive');
  assert.equal(commentTone({ status: 'open' }, true), 'fixed');
  assert.equal(commentTone({ status: 'open', student_fixed_at: '2026-09-22' }, true), 'reopen');
  assert.equal(commentTone({ status: 'resolved' }, true), 'resolved');
});

test('wholesale paste does not steal the highlight or invent a replacement', () => {
  const text = 'Brand new essay with a recieve hiding in the middle of other words';
  assert.equal(locateQuote(text, spelling.quote, spelling.start_offset, spelling.prefix_context, spelling.suffix_context), null);
  assert.equal(inferReplacementPassage(spelling, text), null);
  const resolved = resolveAnnotation(spelling, text);
  assert.equal(resolved.detached, true);
  assert.equal(resolved.replacement, undefined);
});

test('a full rewrite with no leftover quote detaches', () => {
  const resolved = resolveAnnotation(spelling, 'Completely different sentences about the weekend.');
  assert.equal(resolved.detached, true);
  assert.equal(resolved.replacement, undefined);
  assert.equal(inferReplacementPassage(spelling, 'Completely different sentences about the weekend.'), null);
});

test('same-line gutter bubbles stack instead of overlapping', () => {
  const stacked = stackGutterMarkers(
    [
      { id: 1, top: 100, left: 40 },
      { id: 2, top: 102, left: 80 },
      { id: 3, top: 104, left: 120 },
    ],
    () => 18,
  );
  assert.deepEqual(stacked.map((marker) => marker.top), [100, 118, 136]);
});

test('unread bubbles keep their own gutter column from reviewed ones', () => {
  assert.equal(commentGutterLane('open'), 'attention');
  assert.equal(commentGutterLane('reopen'), 'attention');
  assert.equal(commentGutterLane('fixed'), 'done');
  assert.equal(commentGutterLane('resolved'), 'done');
  const stacked = stackGutterMarkers(
    [
      { id: 1, top: 100, left: 40, lane: 'attention' },
      { id: 2, top: 102, left: 80, lane: 'done' },
      { id: 3, top: 104, left: 90, lane: 'done' },
    ],
    () => 18,
  );
  const byId = Object.fromEntries(stacked.map((marker) => [marker.id, marker.top]));
  assert.equal(byId[1], 100);
  assert.equal(byId[2], 102);
  assert.equal(byId[3], 120);
});

test('confirming a grey bubble rematches so the pip can turn green', () => {
  const fixed = [{
    studentId: 7,
    annotation: { id: 12, status: 'fixed', student_fixed_at: '2026-09-22' },
    detached: true,
    lane: 'done',
    layout: 'gutter',
    top: 40,
    left: 200,
    width: 18,
  }];
  const confirmed = [{
    ...fixed[0],
    annotation: { ...fixed[0].annotation, status: 'resolved' },
  }];
  assert.equal(annotationMarkersMatch(fixed, fixed), true);
  assert.equal(annotationMarkersMatch(fixed, confirmed), false);
});
