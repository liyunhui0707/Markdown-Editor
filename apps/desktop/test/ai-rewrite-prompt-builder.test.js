/* CA1 — lib/ai-rewrite-prompt-builder.js
   Run focused: cd apps/desktop && node --test test/ai-rewrite-prompt-builder.test.js

   Tests the rewrite prompt shape (system + user messages), <text>…</text>
   delimiter safety so triple-backticks in the input don't break the prompt,
   and the empty-input contract (throws aiError reason='empty-input').

   Mirrors test/ai-prompt-builder.test.js (v0.2.0 Summarize) shape verbatim
   — only the system-prompt keywords differ.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildRewritePrompt } = require('../lib/ai-rewrite-prompt-builder');

test('CA1.1 shape: returns { messages: [...] } with length >= 2', () => {
  const r = buildRewritePrompt('Hello world');
  assert.ok(Array.isArray(r.messages));
  assert.ok(r.messages.length >= 2);
  for (const m of r.messages) {
    assert.equal(typeof m.role, 'string');
    assert.equal(typeof m.content, 'string');
  }
});

test('CA1.2 has at least one system and one user message', () => {
  const r = buildRewritePrompt('Hello world');
  assert.ok(r.messages.some((m) => m.role === 'system'));
  assert.ok(r.messages.some((m) => m.role === 'user'));
});

test('CA1.3 system message names the task (rewrite/clarity-or-concise/only — case-insensitive)', () => {
  const r = buildRewritePrompt('Hello world');
  const sys = r.messages.find((m) => m.role === 'system');
  const lower = sys.content.toLowerCase();
  assert.ok(lower.includes('rewrit'), 'system message should reference rewriting');
  assert.ok(lower.includes('clarity') || lower.includes('concise') || lower.includes('clear'),
    'system message should ask for clarity/concision');
  assert.ok(lower.includes('only'), 'system message should ask for only the rewritten text');
});

test('CA1.4 user message contains the input text verbatim', () => {
  const r = buildRewritePrompt('Hello world');
  const usr = r.messages.find((m) => m.role === 'user');
  assert.ok(usr.content.includes('Hello world'));
});

test('CA1.5 delimiter safety: triple-backtick content wrapped between explicit <text>…</text>', () => {
  const noisy = '```js\ncode\n```';
  const r = buildRewritePrompt(noisy);
  const usr = r.messages.find((m) => m.role === 'user');
  assert.ok(usr.content.includes('<text>'));
  assert.ok(usr.content.includes('</text>'));
  const start = usr.content.indexOf('<text>');
  const end = usr.content.indexOf('</text>');
  assert.ok(start >= 0 && end > start);
  const between = usr.content.slice(start, end);
  assert.ok(between.includes('```js'));
  assert.ok(between.includes('```'));
});

test('CA1.6 empty input throws aiError reason="empty-input"', () => {
  assert.throws(() => buildRewritePrompt(''), (err) => err && err.reason === 'empty-input');
});

test('CA1.7 whitespace-only input throws aiError reason="empty-input"', () => {
  assert.throws(() => buildRewritePrompt('   \n  '), (err) => err && err.reason === 'empty-input');
});

test('CA1.8 non-string input throws aiError reason="empty-input"', () => {
  for (const bad of [null, undefined, 0, {}, []]) {
    assert.throws(() => buildRewritePrompt(bad), (err) => err && err.reason === 'empty-input');
  }
});
