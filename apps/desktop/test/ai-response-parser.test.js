/* T3 — lib/ai-response-parser.js
   Run focused: cd apps/desktop && node --test test/ai-response-parser.test.js

   Verifies the OpenAI choices[0].message.content shape. Trim. All
   bad-shape paths throw aiError reason='invalid-response'. Empty content
   after trim is treated as invalid (E6 locked decision).
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseOpenAIChatResponse } = require('../lib/ai-response-parser');

function expectInvalid(input) {
  assert.throws(() => parseOpenAIChatResponse(input), (err) => err && err.reason === 'invalid-response');
}

test('T3.1 happy path: choices[0].message.content', () => {
  const r = parseOpenAIChatResponse({ choices: [{ message: { content: 'Summary.' } }] });
  assert.equal(r.summary, 'Summary.');
});

test('T3.2 trims whitespace', () => {
  const r = parseOpenAIChatResponse({ choices: [{ message: { content: '  Summary.\n' } }] });
  assert.equal(r.summary, 'Summary.');
});

test('T3.3 missing choices → invalid-response', () => {
  expectInvalid({});
});

test('T3.4 empty choices array → invalid-response', () => {
  expectInvalid({ choices: [] });
});

test('T3.5 missing message → invalid-response', () => {
  expectInvalid({ choices: [{}] });
});

test('T3.6 missing content → invalid-response', () => {
  expectInvalid({ choices: [{ message: {} }] });
});

test('T3.7 empty-string content after trim → invalid-response', () => {
  expectInvalid({ choices: [{ message: { content: '   ' } }] });
});

test('T3.8 non-object inputs → invalid-response', () => {
  for (const bad of [null, undefined, 0, '', 'no']) {
    expectInvalid(bad);
  }
});
