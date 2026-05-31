/* T2 — lib/ai-prompt-builder.js
   Run focused: cd apps/desktop && node --test test/ai-prompt-builder.test.js

   Tests the prompt shape (system+user messages), <note>…</note> delimiter
   safety so triple-backticks in the input don't break the prompt, and the
   empty-input contract (throws aiError reason='empty-input').
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSummaryPrompt } = require('../lib/ai-prompt-builder');

test('T2.1 shape: returns { messages: [...] } with length >= 2', () => {
  const r = buildSummaryPrompt('Hello world');
  assert.ok(Array.isArray(r.messages));
  assert.ok(r.messages.length >= 2);
  for (const m of r.messages) {
    assert.equal(typeof m.role, 'string');
    assert.equal(typeof m.content, 'string');
  }
});

test('T2.2 has at least one system and one user message', () => {
  const r = buildSummaryPrompt('Hello world');
  assert.ok(r.messages.some((m) => m.role === 'system'));
  assert.ok(r.messages.some((m) => m.role === 'user'));
});

test('T2.3 system message names the task (summarize/concise/Markdown — case-insensitive)', () => {
  const r = buildSummaryPrompt('Hello world');
  const sys = r.messages.find((m) => m.role === 'system');
  const lower = sys.content.toLowerCase();
  assert.ok(lower.includes('summari'), 'system message should reference summarizing');
  assert.ok(lower.includes('concise') || lower.includes('brief') || lower.includes('short'),
    'system message should ask for concise/brief/short output');
  assert.ok(lower.includes('markdown'), 'system message should reference Markdown');
});

test('T2.4 user message contains the input text verbatim', () => {
  const r = buildSummaryPrompt('Hello world');
  const usr = r.messages.find((m) => m.role === 'user');
  assert.ok(usr.content.includes('Hello world'));
});

test('T2.5 delimiter safety: triple-backtick content wrapped between explicit delimiters', () => {
  const noisy = '```js\ncode\n```';
  const r = buildSummaryPrompt(noisy);
  const usr = r.messages.find((m) => m.role === 'user');
  assert.ok(usr.content.includes('<note>'));
  assert.ok(usr.content.includes('</note>'));
  const start = usr.content.indexOf('<note>');
  const end = usr.content.indexOf('</note>');
  assert.ok(start >= 0 && end > start);
  // Original literal backticks must sit BETWEEN the delimiters, not break them.
  const between = usr.content.slice(start, end);
  assert.ok(between.includes('```js'));
  assert.ok(between.includes('```'));
});

test('T2.6 empty input throws aiError reason="empty-input"', () => {
  assert.throws(() => buildSummaryPrompt(''), (err) => err && err.reason === 'empty-input');
});

test('T2.7 whitespace-only input throws aiError reason="empty-input"', () => {
  assert.throws(() => buildSummaryPrompt('   \n  '), (err) => err && err.reason === 'empty-input');
});
