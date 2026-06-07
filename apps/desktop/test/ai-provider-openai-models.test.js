/* test/ai-provider-openai-models.test.js
   Stage C-2 — CS6: provider.listModels({ baseUrl, signal }).

   GETs {baseUrl}/models and returns { models: [id, ...] }, or throws a typed
   aiError on failure, mirroring summarize's error mapping (server-unreachable
   / http-error+status / invalid-response / timeout). The IPC layer maps the
   reason → a canned user-facing message (G4); the adapter never formats text.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOpenAiCompatibleProvider } = require('../lib/ai-provider-openai');

function okFetch(json, capture) {
  return async (url, opts) => {
    if (capture) { capture.url = url; capture.opts = opts; }
    return { ok: true, status: 200, json: async () => json };
  };
}

test('CS6.1 listModels GETs {baseUrl}/models and returns model ids', async () => {
  const cap = {};
  const provider = createOpenAiCompatibleProvider({
    fetch: okFetch({ data: [{ id: 'qwen2.5:3b' }, { id: 'llama3.1' }] }, cap),
  });
  const { models } = await provider.listModels({ baseUrl: 'http://localhost:1234/v1' });
  assert.deepEqual(models, ['qwen2.5:3b', 'llama3.1']);
  assert.equal(cap.url, 'http://localhost:1234/v1/models');
  assert.equal(cap.opts.method, 'GET');
});

test('CS6.2 listModels keeps only entries with a non-empty string id', async () => {
  const provider = createOpenAiCompatibleProvider({
    fetch: okFetch({ data: [{ id: 'a' }, {}, { id: '' }, { id: 5 }, { id: 'b' }] }),
  });
  const { models } = await provider.listModels({ baseUrl: 'http://localhost:1234/v1' });
  assert.deepEqual(models, ['a', 'b']);
});

test('CS6.3 http error -> aiError http-error carrying the status', async () => {
  const provider = createOpenAiCompatibleProvider({
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  await assert.rejects(
    () => provider.listModels({ baseUrl: 'http://localhost:1234/v1' }),
    (e) => e.reason === 'http-error' && e.status === 404,
  );
});

test('CS6.4 network failure -> server-unreachable', async () => {
  const provider = createOpenAiCompatibleProvider({
    fetch: async () => { throw new TypeError('fetch failed'); },
  });
  await assert.rejects(
    () => provider.listModels({ baseUrl: 'http://localhost:1234/v1' }),
    (e) => e.reason === 'server-unreachable',
  );
});

test('CS6.5 invalid JSON -> invalid-response', async () => {
  const provider = createOpenAiCompatibleProvider({
    fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
  });
  await assert.rejects(
    () => provider.listModels({ baseUrl: 'http://localhost:1234/v1' }),
    (e) => e.reason === 'invalid-response',
  );
});

test('CS6.6 response without a data array -> invalid-response', async () => {
  const provider = createOpenAiCompatibleProvider({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ object: 'list' }) }),
  });
  await assert.rejects(
    () => provider.listModels({ baseUrl: 'http://localhost:1234/v1' }),
    (e) => e.reason === 'invalid-response',
  );
});

test('CS6.7 aborted signal -> timeout', async () => {
  const provider = createOpenAiCompatibleProvider({
    fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
  });
  await assert.rejects(
    () => provider.listModels({ baseUrl: 'http://localhost:1234/v1', signal: { aborted: true } }),
    (e) => e.reason === 'timeout',
  );
});
