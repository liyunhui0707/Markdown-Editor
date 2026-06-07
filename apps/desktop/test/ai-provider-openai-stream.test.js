/* test/ai-provider-openai-stream.test.js
   CB3 — Stage B: streaming adapter on the OpenAI-compatible provider.

   Contract: `provider.streamSummarize({baseUrl, model, messages, temperature,
   maxTokens, signal, onChunk})` returns Promise<{ summary }> where `summary`
   is the concatenation of all content chunks. Errors flow through the same
   typed `aiError` shape as `summarize`:
     - HTTP non-2xx → http-error + status.
     - 2xx but content-type lacks 'text/event-stream' → invalid-response.
     - fetch rejects before first byte → server-unreachable (or timeout when aborted).
     - SSE parser emits { kind:'error' } → invalid-response.
     - Signal aborted mid-stream → timeout.
   onChunk is called with each non-empty content delta string. The body is
   serialized with `stream: true`.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOpenAiCompatibleProvider } = require('../lib/ai-provider-openai');
const { REASON_MESSAGES } = require('../lib/ai-errors');

// Helper: build a fake Response with a ReadableStream of byte chunks.
function fakeStreamResponse({ status = 200, ok = true, headers = {}, chunks = [] }) {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(typeof c === 'string' ? new TextEncoder().encode(c) : c);
      }
      controller.close();
    },
  });
  return {
    status,
    ok,
    headers: { get: (k) => headers[k.toLowerCase()] || headers[k] || null },
    body: stream,
    text: async () => '',
    json: async () => ({}),
  };
}

function frame(content) {
  return `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\n`;
}

const DONE = 'data: [DONE]\n\n';

const BASE_ARGS = {
  baseUrl: 'http://localhost:1234/v1',
  model: 'local',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.2,
  maxTokens: 256,
};

test('CB3.1 happy path: chunks concatenated, onChunk called per delta', async () => {
  const onChunkCalls = [];
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [frame('Hello, '), frame('world!'), DONE],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  const result = await provider.streamSummarize({
    ...BASE_ARGS,
    onChunk: (t) => onChunkCalls.push(t),
  });
  assert.deepEqual(result, { summary: 'Hello, world!' });
  assert.deepEqual(onChunkCalls, ['Hello, ', 'world!']);
});

test('CB3.2 request body includes stream:true and reuses summarize params', async () => {
  let capturedBody = null;
  const fetchImpl = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return fakeStreamResponse({
      headers: { 'content-type': 'text/event-stream' },
      chunks: [frame('x'), DONE],
    });
  };
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  await provider.streamSummarize({ ...BASE_ARGS, onChunk: () => {} });
  assert.equal(capturedBody.stream, true);
  assert.equal(capturedBody.model, BASE_ARGS.model);
  assert.equal(capturedBody.temperature, BASE_ARGS.temperature);
  assert.equal(capturedBody.max_tokens, BASE_ARGS.maxTokens);
  assert.deepEqual(capturedBody.messages, BASE_ARGS.messages);
});

test('CB3.3 HTTP 4xx → aiError http-error + status; onChunk never called', async () => {
  let chunkCount = 0;
  const fetchImpl = async () => ({
    status: 404,
    ok: false,
    headers: { get: () => 'application/json' },
    body: null,
    text: async () => '',
    json: async () => ({ error: 'not found' }),
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  await assert.rejects(
    provider.streamSummarize({ ...BASE_ARGS, onChunk: () => { chunkCount += 1; } }),
    (err) => {
      assert.equal(err.reason, 'http-error');
      assert.equal(err.message, REASON_MESSAGES['http-error']);
      assert.equal(err.status, 404);
      return true;
    },
  );
  assert.equal(chunkCount, 0);
});

test('CB3.4 HTTP 500 → aiError http-error + status 500', async () => {
  const fetchImpl = async () => ({
    status: 500,
    ok: false,
    headers: { get: () => 'text/plain' },
    body: null,
    text: async () => '',
    json: async () => ({}),
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  await assert.rejects(
    provider.streamSummarize({ ...BASE_ARGS, onChunk: () => {} }),
    (err) => {
      assert.equal(err.reason, 'http-error');
      assert.equal(err.status, 500);
      return true;
    },
  );
});

test('CB3.5 2xx but wrong content-type → invalid-response', async () => {
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'application/json' },
    chunks: ['{"choices":[{"message":{"content":"hi"}}]}'],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  await assert.rejects(
    provider.streamSummarize({ ...BASE_ARGS, onChunk: () => {} }),
    (err) => {
      assert.equal(err.reason, 'invalid-response');
      assert.equal(err.message, REASON_MESSAGES['invalid-response']);
      return true;
    },
  );
});

test('CB3.6 fetch rejects before first byte (connection refused) → server-unreachable', async () => {
  const fetchImpl = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  await assert.rejects(
    provider.streamSummarize({ ...BASE_ARGS, onChunk: () => {} }),
    (err) => {
      assert.equal(err.reason, 'server-unreachable');
      return true;
    },
  );
});

test('CB3.7 abort before first byte → timeout', async () => {
  const ctrl = new AbortController();
  const fetchImpl = async (_url, init) => {
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  const p = provider.streamSummarize({ ...BASE_ARGS, signal: ctrl.signal, onChunk: () => {} });
  setTimeout(() => ctrl.abort(), 5);
  await assert.rejects(p, (err) => {
    assert.equal(err.reason, 'timeout');
    return true;
  });
});

test('CB3.8 abort MID-stream → timeout (signal-aborted while reading)', async () => {
  const ctrl = new AbortController();
  const fetchImpl = async (_url, init) => {
    // ReadableStream that blocks after one chunk, listens for abort.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame('first ')));
        init.signal.addEventListener('abort', () => {
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      },
    });
    return {
      status: 200,
      ok: true,
      headers: { get: (k) => k.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
      body: stream,
    };
  };
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  let firstChunkSeen = false;
  const p = provider.streamSummarize({
    ...BASE_ARGS,
    signal: ctrl.signal,
    onChunk: (t) => {
      if (!firstChunkSeen) { firstChunkSeen = true; setTimeout(() => ctrl.abort(), 1); }
    },
  });
  await assert.rejects(p, (err) => {
    assert.equal(err.reason, 'timeout');
    return true;
  });
  assert.equal(firstChunkSeen, true);
});

test('CB3.9 SSE parser emits error mid-stream → invalid-response, partial discarded', async () => {
  const onChunkCalls = [];
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [frame('partial '), 'data: {malformed\n\n'],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  await assert.rejects(
    provider.streamSummarize({ ...BASE_ARGS, onChunk: (t) => onChunkCalls.push(t) }),
    (err) => {
      assert.equal(err.reason, 'invalid-response');
      return true;
    },
  );
  // onChunk for the valid part may or may not have fired before the error;
  // contract is that the IPC layer discards the partial. We assert the
  // partial chunk WAS surfaced via onChunk (the IPC layer is the one that
  // owns the discard, not the adapter).
  assert.deepEqual(onChunkCalls, ['partial ']);
});

test('CB3.10 SSE error event (data: { "error" }) → invalid-response (G4: no leak)', async () => {
  const inner = 'secret upstream error';
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [`data: {"error":{"message":"${inner}"}}\n\n`],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  await assert.rejects(
    provider.streamSummarize({ ...BASE_ARGS, onChunk: () => {} }),
    (err) => {
      assert.equal(err.reason, 'invalid-response');
      assert.equal(err.message, REASON_MESSAGES['invalid-response']);
      assert.equal(err.message.includes(inner), false);
      return true;
    },
  );
});

test('CB3.11 CJK character split across two byte chunks reassembles correctly', async () => {
  const onChunkCalls = [];
  const fullFrame = frame('你好');
  const bytes = new TextEncoder().encode(fullFrame);
  const splitAt = Math.floor(bytes.length / 2);
  // Split inside the multi-byte sequence of the first CJK character.
  const part1 = bytes.slice(0, splitAt);
  const part2 = bytes.slice(splitAt);
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [part1, part2, new TextEncoder().encode(DONE)],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  const result = await provider.streamSummarize({
    ...BASE_ARGS,
    onChunk: (t) => onChunkCalls.push(t),
  });
  assert.equal(result.summary, '你好');
  assert.deepEqual(onChunkCalls, ['你好']);
});

test('CB3.12 onChunk receives only non-empty content deltas (role-only delta skipped)', async () => {
  const onChunkCalls = [];
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      frame('payload'),
      DONE,
    ],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  const result = await provider.streamSummarize({
    ...BASE_ARGS,
    onChunk: (t) => onChunkCalls.push(t),
  });
  assert.equal(result.summary, 'payload');
  assert.deepEqual(onChunkCalls, ['payload']);
});

test('CB3.13 onChunk is optional (no-op if omitted)', async () => {
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [frame('alone'), DONE],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  const result = await provider.streamSummarize({ ...BASE_ARGS });
  assert.equal(result.summary, 'alone');
});

test('CB3.14 stream ends without [DONE] → resolves with concatenated summary', async () => {
  // Some providers close the connection cleanly without emitting [DONE].
  // Adapter should still return what it has rather than throw.
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [frame('A'), frame('B')],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  const result = await provider.streamSummarize({ ...BASE_ARGS, onChunk: () => {} });
  assert.equal(result.summary, 'AB');
});

test('CB3.16 [QA-fix] abort mid-stream when fetch ignores signal: reader.cancel() unblocks the loop', async () => {
  // Real-world regression: undici on Node 20 does NOT reliably reject a
  // pending reader.read() when the parent fetch signal aborts mid-stream.
  // Without the explicit reader.cancel() on signal-abort + post-read
  // signal check, the loop hangs until the upstream sends more data —
  // which against LM Studio is "until the model fully finishes". The QA
  // bug surfaced as "click × → buttons stay grayed for ~13s".
  //
  // This test pins the fix: the fake stream emits one chunk then has no
  // pull() and no signal handler. Without the adapter's own
  // reader.cancel() the next read would hang forever. With the fix,
  // signal-abort triggers reader.cancel() → pending read resolves
  // { done: true } → adapter's signal.aborted re-check throws timeout.
  const ctrl = new AbortController();
  const fetchImpl = async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame('first ')));
        // No signal hook — stream is intentionally passive after the
        // single buffered chunk drains.
      },
    });
    return {
      status: 200,
      ok: true,
      headers: { get: (k) => k.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
      body: stream,
    };
  };
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  let firstChunkSeen = false;
  const p = provider.streamSummarize({
    ...BASE_ARGS,
    signal: ctrl.signal,
    onChunk: (t) => {
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        setTimeout(() => ctrl.abort(), 5);
      }
    },
  });
  await assert.rejects(p, (err) => {
    assert.equal(err.reason, 'timeout');
    return true;
  });
  assert.equal(firstChunkSeen, true);
});

test('CB3.15 empty body (no chunks at all) → resolves with empty string', async () => {
  // Borderline case: empty stream means model emitted nothing. Adapter
  // doesn't decide whether this is an error; the IPC handler / renderer
  // may treat empty summary differently. Adapter returns it faithfully.
  const fetchImpl = async () => fakeStreamResponse({
    headers: { 'content-type': 'text/event-stream' },
    chunks: [],
  });
  const provider = createOpenAiCompatibleProvider({ fetch: fetchImpl });
  const result = await provider.streamSummarize({ ...BASE_ARGS, onChunk: () => {} });
  assert.equal(result.summary, '');
});
