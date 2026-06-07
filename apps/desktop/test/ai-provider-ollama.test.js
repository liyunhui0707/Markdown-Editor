/* test/ai-provider-ollama.test.js
   Stage C-3 — CS9: Ollama NATIVE adapter (the second provider, proving the
   replaceable-provider abstraction). Different wire protocol from the
   OpenAI-compatible adapter:
     - POST {baseUrl}/api/chat  (body { model, messages, stream, options })
     - response { message: { content } }  (not choices[].message)
     - streaming is NDJSON (one JSON object per line), not SSE data: frames
     - GET {baseUrl}/api/tags -> { models: [{ name }] }  (not { data: [{ id }] })
   Same { summarize, streamSummarize, listModels } interface + typed-error
   mapping as the OpenAI adapter.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOllamaProvider } = require('../lib/ai-provider-ollama');

const BASE_ARGS = {
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5:3b',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.2,
  maxTokens: 256,
};

function fakeStreamResponse({ status = 200, ok = true, chunks = [] }) {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? new TextEncoder().encode(c) : c);
      controller.close();
    },
  });
  return { status, ok, body: stream, json: async () => ({}) };
}

const line = (obj) => JSON.stringify(obj) + '\n';

// ===== summarize (POST /api/chat, stream:false) =====

test('CS9.1 summarize POSTs /api/chat with the native body and returns message.content', async () => {
  const cap = {};
  const provider = createOllamaProvider({
    fetch: async (url, opts) => { cap.url = url; cap.opts = opts; return { ok: true, status: 200, json: async () => ({ message: { role: 'assistant', content: 'Summary.' } }) }; },
  });
  const r = await provider.summarize(BASE_ARGS);
  assert.deepEqual(r, { summary: 'Summary.' });
  assert.equal(cap.url, 'http://localhost:11434/api/chat');
  assert.equal(cap.opts.method, 'POST');
  const body = JSON.parse(cap.opts.body);
  assert.equal(body.model, 'qwen2.5:3b');
  assert.equal(body.stream, false);
  assert.equal(body.options.temperature, 0.2);
  assert.equal(body.options.num_predict, 256);
});

test('CS9.2 summarize http error -> http-error with status', async () => {
  const provider = createOllamaProvider({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await assert.rejects(() => provider.summarize(BASE_ARGS), (e) => e.reason === 'http-error' && e.status === 500);
});

test('CS9.3 summarize network failure -> server-unreachable', async () => {
  const provider = createOllamaProvider({ fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => provider.summarize(BASE_ARGS), (e) => e.reason === 'server-unreachable');
});

test('CS9.4 summarize invalid JSON -> invalid-response', async () => {
  const provider = createOllamaProvider({ fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) });
  await assert.rejects(() => provider.summarize(BASE_ARGS), (e) => e.reason === 'invalid-response');
});

test('CS9.5 summarize missing message.content -> invalid-response', async () => {
  const provider = createOllamaProvider({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ done: true }) }) });
  await assert.rejects(() => provider.summarize(BASE_ARGS), (e) => e.reason === 'invalid-response');
});

// ===== listModels (GET /api/tags) =====

test('CS9.6 listModels GETs /api/tags and maps name -> id', async () => {
  const cap = {};
  const provider = createOllamaProvider({
    fetch: async (url, opts) => { cap.url = url; cap.opts = opts; return { ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen2.5:7b' }, { name: 'bge-m3:latest' }, {}, { name: '' }] }) }; },
  });
  const { models } = await provider.listModels({ baseUrl: 'http://localhost:11434' });
  assert.deepEqual(models, ['qwen2.5:7b', 'bge-m3:latest']);
  assert.equal(cap.url, 'http://localhost:11434/api/tags');
  assert.equal(cap.opts.method, 'GET');
});

test('CS9.7 listModels without a models array -> invalid-response', async () => {
  const provider = createOllamaProvider({ fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  await assert.rejects(() => provider.listModels({ baseUrl: 'http://localhost:11434' }), (e) => e.reason === 'invalid-response');
});

// ===== streamSummarize (POST /api/chat, NDJSON) =====

test('CS9.8 streamSummarize accumulates NDJSON content + calls onChunk per line', async () => {
  const onChunkCalls = [];
  const provider = createOllamaProvider({
    fetch: async () => fakeStreamResponse({ chunks: [
      line({ message: { content: 'Hello, ' }, done: false }),
      line({ message: { content: 'world!' }, done: false }),
      line({ message: { content: '' }, done: true }),
    ] }),
  });
  const r = await provider.streamSummarize({ ...BASE_ARGS, onChunk: (t) => onChunkCalls.push(t) });
  assert.deepEqual(r, { summary: 'Hello, world!' });
  assert.deepEqual(onChunkCalls, ['Hello, ', 'world!']); // empty final content not emitted
});

test('CS9.9 streamSummarize handles a line split across chunk boundaries', async () => {
  const full = line({ message: { content: 'spanned' }, done: false }) + line({ message: { content: '' }, done: true });
  const mid = Math.floor(full.length / 2);
  const provider = createOllamaProvider({
    fetch: async () => fakeStreamResponse({ chunks: [full.slice(0, mid), full.slice(mid)] }),
  });
  const r = await provider.streamSummarize({ ...BASE_ARGS });
  assert.equal(r.summary, 'spanned');
});

test('CS9.10 streamSummarize sets stream:true in the request body', async () => {
  const cap = {};
  const provider = createOllamaProvider({
    fetch: async (url, opts) => { cap.body = JSON.parse(opts.body); return fakeStreamResponse({ chunks: [line({ message: { content: 'x' }, done: true })] }); },
  });
  await provider.streamSummarize({ ...BASE_ARGS });
  assert.equal(cap.body.stream, true);
});

test('CS9.11 streamSummarize http error -> http-error', async () => {
  const provider = createOllamaProvider({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(() => provider.streamSummarize({ ...BASE_ARGS }), (e) => e.reason === 'http-error' && e.status === 404);
});

test('CS9.12 streamSummarize line with an error field -> invalid-response', async () => {
  const provider = createOllamaProvider({
    fetch: async () => fakeStreamResponse({ chunks: [line({ error: 'model not found' })] }),
  });
  await assert.rejects(() => provider.streamSummarize({ ...BASE_ARGS }), (e) => e.reason === 'invalid-response');
});
