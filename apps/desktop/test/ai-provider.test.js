/* test/ai-provider.test.js
   Stage C-3 — CS10: resolveProvider selector. Maps settings.provider to an
   adapter; unknown -> aiError('provider-error'). Both adapters expose the same
   { summarize, streamSummarize, listModels } interface — the contract behind
   the replaceable-provider abstraction.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveProvider } = require('../lib/ai-provider');

const deps = { fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) };
const IFACE = ['summarize', 'streamSummarize', 'listModels'];

test('CS10.1 openai-compatible -> adapter with the full interface', () => {
  const p = resolveProvider({ provider: 'openai-compatible' }, deps);
  IFACE.forEach((m) => assert.equal(typeof p[m], 'function', m));
});

test('CS10.2 ollama -> adapter with the full interface', () => {
  const p = resolveProvider({ provider: 'ollama' }, deps);
  IFACE.forEach((m) => assert.equal(typeof p[m], 'function', m));
});

test('CS10.3 both adapters expose the SAME interface (abstraction contract)', () => {
  const a = resolveProvider({ provider: 'openai-compatible' }, deps);
  const b = resolveProvider({ provider: 'ollama' }, deps);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
});

test('CS10.4 unknown provider -> aiError provider-error', () => {
  assert.throws(
    () => resolveProvider({ provider: 'made-up-thing' }, deps),
    (e) => e.reason === 'provider-error',
  );
});

test('CS10.5 missing provider -> provider-error', () => {
  assert.throws(() => resolveProvider({}, deps), (e) => e.reason === 'provider-error');
  assert.throws(() => resolveProvider(undefined, deps), (e) => e.reason === 'provider-error');
});
