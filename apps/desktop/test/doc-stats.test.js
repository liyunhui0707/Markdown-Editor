/* TDD: doc-stats — pure helpers used by the status-bar readouts.
   Run: node --test test/doc-stats.test.js

   These helpers compute word / char / line counts for the current
   document and format integers for display. They must be:
     - pure (no DOM, no editor coupling)
     - safe on '', null, undefined
     - CJK-aware: each CJK ideograph counts as one word, summed with
       Latin/numeric token count
     - char-count uses code points (Array.from), not UTF-16 units, so
       emoji and surrogate-pair characters count as 1
     - line-count matches CM6's doc.lines for LF-normalized input
       (trailing '\n' yields an extra empty line)
*/
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { countWords, countChars, countLines, formatNumber } = require('../lib/doc-stats');

// ── countWords ──────────────────────────────────────────────────────

test('countWords: empty string is 0', () => {
  assert.equal(countWords(''), 0);
});

test('countWords: null and undefined are 0', () => {
  assert.equal(countWords(null), 0);
  assert.equal(countWords(undefined), 0);
});

test('countWords: whitespace-only is 0', () => {
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('\n\n\n'), 0);
  assert.equal(countWords('\t  \n  '), 0);
});

test('countWords: latin words split on whitespace', () => {
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('  hello   world  '), 2);
  assert.equal(countWords('one two three four five'), 5);
});

test('countWords: apostrophe inside a token does not split', () => {
  assert.equal(countWords("don't stop"), 2);
  assert.equal(countWords("it's a test"), 3);
});

test('countWords: numbers count as words', () => {
  assert.equal(countWords('there are 42 items'), 4);
});

test('countWords: punctuation alone is 0', () => {
  assert.equal(countWords('. , ! ? — —'), 0);
});

test('countWords: each CJK ideograph counts as one word', () => {
  assert.equal(countWords('一二三'), 3);
  assert.equal(countWords('你好世界'), 4);
});

test('countWords: mixed latin and CJK sums both', () => {
  assert.equal(countWords('hello 世界'), 3);   // 1 latin + 2 CJK
  assert.equal(countWords('test 一二三 done'), 5); // 2 latin + 3 CJK
});

test('countWords: emoji is not a word', () => {
  assert.equal(countWords('emoji 👋 test'), 2);
});

test('countWords: markdown punctuation does not inflate count', () => {
  assert.equal(countWords('# heading'), 1);
  assert.equal(countWords('- item one'), 2);
  assert.equal(countWords('**bold** text'), 2);
});

// ── countChars ──────────────────────────────────────────────────────

test('countChars: empty string is 0', () => {
  assert.equal(countChars(''), 0);
});

test('countChars: null and undefined are 0', () => {
  assert.equal(countChars(null), 0);
  assert.equal(countChars(undefined), 0);
});

test('countChars: simple ascii', () => {
  assert.equal(countChars('hello'), 5);
});

test('countChars: includes whitespace and newlines', () => {
  assert.equal(countChars('a b'), 3);
  assert.equal(countChars('a\nb'), 3);
  assert.equal(countChars('  '), 2);
});

test('countChars: emoji counts as 1 code point, not 2 UTF-16 units', () => {
  assert.equal(countChars('👋'), 1);
  assert.equal(countChars('a👋b'), 3);
});

test('countChars: CJK character is 1', () => {
  assert.equal(countChars('世'), 1);
  assert.equal(countChars('你好'), 2);
});

// ── countLines ──────────────────────────────────────────────────────

test('countLines: empty string is 0', () => {
  assert.equal(countLines(''), 0);
});

test('countLines: null and undefined are 0', () => {
  assert.equal(countLines(null), 0);
  assert.equal(countLines(undefined), 0);
});

test('countLines: single line with no newline is 1', () => {
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('hello world'), 1);
});

test('countLines: trailing newline yields an extra empty line (matches CM6 doc.lines)', () => {
  assert.equal(countLines('a\n'), 2);
});

test('countLines: two lines separated by newline', () => {
  assert.equal(countLines('a\nb'), 2);
});

test('countLines: three lines', () => {
  assert.equal(countLines('a\nb\nc'), 3);
});

test('countLines: many lines', () => {
  const text = Array.from({ length: 42 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(countLines(text), 42);
});

// ── formatNumber ────────────────────────────────────────────────────

test('formatNumber: 0', () => {
  assert.equal(formatNumber(0), '0');
});

test('formatNumber: small numbers unchanged', () => {
  assert.equal(formatNumber(7), '7');
  assert.equal(formatNumber(42), '42');
  assert.equal(formatNumber(999), '999');
});

test('formatNumber: thousands separator', () => {
  assert.equal(formatNumber(1000), '1,000');
  assert.equal(formatNumber(1247), '1,247');
});

test('formatNumber: millions', () => {
  assert.equal(formatNumber(1234567), '1,234,567');
});

test('formatNumber: null/undefined → "0"', () => {
  assert.equal(formatNumber(null), '0');
  assert.equal(formatNumber(undefined), '0');
});
