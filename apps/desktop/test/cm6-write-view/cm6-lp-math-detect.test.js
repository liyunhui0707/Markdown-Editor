/* Stage F WAVE 1 — parseMath pure scanner.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-math-detect.test.js

   Covers Pandoc-style detection rules. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

delete require.cache[require.resolve('../../lib/cm6-lp-math-detect.js')];
const md = require('../../lib/cm6-lp-math-detect.js');

test('Stage F WAVE 1-T-M-1: simple inline $x$ at start of doc', () => {
  const r = md.parseMath('$x$');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { kind: 'inline', from: 0, to: 3, source: 'x' });
});

test('Stage F WAVE 1-T-M-2: inline math in prose', () => {
  // "Let $E=mc^2$ be the answer."
  //   0   4       12
  const r = md.parseMath('Let $E=mc^2$ be the answer.');
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'inline');
  assert.equal(r[0].from, 4);
  assert.equal(r[0].to, 12);
  assert.equal(r[0].source, 'E=mc^2');
});

test('Stage F WAVE 1-T-M-3: multiple inline math on one line', () => {
  const r = md.parseMath('$a$ and $b$');
  assert.equal(r.length, 2);
  assert.equal(r[0].source, 'a');
  assert.equal(r[1].source, 'b');
});

test('Stage F WAVE 1-T-M-4: simple display $$x$$ block', () => {
  const r = md.parseMath('$$x$$');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { kind: 'display', from: 0, to: 5, source: 'x' });
});

test('Stage F WAVE 1-T-M-5: display math spanning multiple lines', () => {
  const doc = '$$\nx + y\n$$';
  const r = md.parseMath(doc);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'display');
  assert.equal(r[0].from, 0);
  assert.equal(r[0].to, doc.length);
  assert.equal(r[0].source, '\nx + y\n');
});

test('Stage F WAVE 1-T-M-6: empty $$$$ does NOT match (precedence)', () => {
  const r = md.parseMath('$$$$');
  assert.equal(r.length, 0, 'empty display block must not match');
});

test('Stage F WAVE 1-T-M-7: escaped \\$ does NOT open math', () => {
  const r = md.parseMath('Price is \\$100 today.');
  assert.equal(r.length, 0, 'escaped $ must not start math');
});

test('Stage F WAVE 1-T-M-8: escaped \\$ inside potential math does NOT close', () => {
  // "$x\\$y$" — first $ opens, \\$ is escaped (skipped), last $ closes
  // → source is "x\\$y".
  const r = md.parseMath('$x\\$y$');
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'inline');
  assert.equal(r[0].source, 'x\\$y');
});

test('Stage F WAVE 1-T-M-9: whitespace after opening $ rejects', () => {
  // "$ x$" — opening $ followed by space → not math.
  const r = md.parseMath('$ x$');
  assert.equal(r.length, 0);
});

test('Stage F WAVE 1-T-M-10: whitespace before closing $ rejects', () => {
  // "$x $" — closing $ preceded by space → not math.
  const r = md.parseMath('$x $');
  assert.equal(r.length, 0);
});

test('Stage F WAVE 1-T-M-11: inline math does NOT span newlines', () => {
  // "$x\ny$" → opening $ at 0, closing $ would be at 4 but the newline
  // breaks the search. No math.
  const r = md.parseMath('$x\ny$');
  assert.equal(r.length, 0);
});

test('Stage F WAVE 1-T-M-12: lone $ is not math', () => {
  const r = md.parseMath('A $ alone.');
  assert.equal(r.length, 0);
});

test('Stage F WAVE 1-T-M-13: $100 and $200 in prose (no math)', () => {
  // "$100 and $200" — opening $ followed by digits (non-whitespace),
  // but the closing $ must NOT be preceded by whitespace. The "0" before
  // " and" is whitespace-adjacent, so... actually the closing $ at pos 9
  // is preceded by " " → rejected. Then opening $ at 9 is the start of
  // "$200" — must find a closing $ on the same line, none. So 0 matches.
  const r = md.parseMath('$100 and $200');
  assert.equal(r.length, 0);
});

test('Stage F WAVE 1-T-M-14: display math takes precedence over inline at same position', () => {
  // "$$x$$ and $y$" — $$x$$ as display, $y$ as inline.
  const r = md.parseMath('$$x$$ and $y$');
  assert.equal(r.length, 2);
  assert.equal(r[0].kind, 'display');
  assert.equal(r[0].source, 'x');
  assert.equal(r[1].kind, 'inline');
  assert.equal(r[1].source, 'y');
});

test('Stage F WAVE 1-T-M-15: empty doc returns empty array', () => {
  assert.deepEqual(md.parseMath(''), []);
});

test('Stage F WAVE 1-T-M-16: null/non-string returns empty array', () => {
  assert.deepEqual(md.parseMath(null), []);
  assert.deepEqual(md.parseMath(undefined), []);
});

test('Stage F WAVE 1-T-M-17: countTrailingBackslashes counts correctly', () => {
  const c = md._countTrailingBackslashes;
  assert.equal(c('abc$', 3), 0);
  assert.equal(c('\\$', 1), 1);
  assert.equal(c('\\\\$', 2), 2);
  assert.equal(c('\\\\\\$', 3), 3);
});

test('Stage F WAVE 1-T-M-18: isEscaped correct parity', () => {
  const e = md._isEscaped;
  assert.equal(e('\\$', 1),       true,  '1 backslash → escaped');
  assert.equal(e('\\\\$', 2),     false, '2 backslashes → literal then $');
  assert.equal(e('\\\\\\$', 3),   true,  '3 backslashes → escaped');
});

test('Stage F WAVE 1-T-M-19: display math without closing fence does NOT match', () => {
  const r = md.parseMath('$$x = 1\nno closing here\n');
  assert.equal(r.length, 0);
});

test('Stage F WAVE 1-T-M-20: $$ inside content of display $$...$$ is not treated as nested display', () => {
  // "$$ a $$ b $$" — first $$ opens, second $$ closes. Third $$ is
  // not paired. Result: 1 display, source = " a ".
  const r = md.parseMath('$$ a $$ b $$');
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'display');
  assert.equal(r[0].source, ' a ');
});
