import test from 'node:test';
import assert from 'node:assert/strict';
import { commentTone, inferReplacementPassage, locateQuote, resolveAnnotation } from './annotations.js';

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
