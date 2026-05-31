/* T4 + T5 — lib/ai-provider-openai.js
   Run focused: cd apps/desktop && node --test test/ai-provider-openai.test.js

   T4 covers server-unreachable mapping (ECONNREFUSED / ENOTFOUND / abort).
   T5 covers invalid-response and http-error paths. err.status is carried
   on http-error so the IPC handler can build the canned ' (HTTP <int>)'
   suffix without trusting adapter-supplied free-form text (G4).
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createOpenAiCompatibleProvider } = require('../lib/ai-provider-openai');

function fakeOkResponse(json) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  };
}

function fakeBadResponse(status, json) {
  return {
    ok: false,
    status,
    json: async () => (json || {}),
  };
}

function fakeBrokenJsonResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
  };
}

function makeArgs() {
  return {
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ],
    temperature: 0.2,
    maxTokens: 64,
    signal: undefined,
  };
}

function asAiError(err) {
  return err && err.name === 'AiError' ? err : null;
}

async function expectReason(provider, args, reason) {
  let caught;
  try { await provider.summarize(args); } catch (e) { caught = e; }
  const ai = asAiError(caught);
  assert.ok(ai, `expected AiError, got ${caught && caught.name}: ${caught && caught.message}`);
  assert.equal(ai.reason, reason);
  return ai;
}

test('T5.1 happy path: returns { summary } and POSTs the expected body', async () => {
  let sentUrl, sentInit;
  const fetch = async (url, init) => {
    sentUrl = url;
    sentInit = init;
    return fakeOkResponse({ choices: [{ message: { content: 'ok' } }] });
  };
  const provider = createOpenAiCompatibleProvider({ fetch });
  const r = await provider.summarize(makeArgs());
  assert.deepEqual(r, { summary: 'ok' });
  assert.equal(sentUrl, 'http://localhost:1234/v1/chat/completions');
  assert.equal(sentInit.method, 'POST');
  assert.equal(sentInit.headers['content-type'], 'application/json');
  const body = JSON.parse(sentInit.body);
  assert.equal(body.model, 'local-model');
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 64);
  assert.equal(body.stream, false);
  assert.ok(Array.isArray(body.messages));
  assert.equal(body.messages[1].content, 'hi');
});

test('T4.1 ECONNREFUSED → server-unreachable, no path leak', async () => {
  const fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  const provider = createOpenAiCompatibleProvider({ fetch });
  const ai = await expectReason(provider, makeArgs(), 'server-unreachable');
  assert.ok(!ai.message.includes('/Users/'));
  assert.ok(!ai.message.includes('C:\\'));
});

test('T4.2 ENOTFOUND → server-unreachable', async () => {
  const fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND' };
    throw err;
  };
  const provider = createOpenAiCompatibleProvider({ fetch });
  await expectReason(provider, makeArgs(), 'server-unreachable');
});

test('T4.3 aborted signal → timeout', async () => {
  const fetch = async (_url, init) => {
    if (init && init.signal && init.signal.aborted) {
      const err = new DOMException('aborted', 'AbortError');
      throw err;
    }
    return fakeOkResponse({ choices: [{ message: { content: 'ok' } }] });
  };
  const provider = createOpenAiCompatibleProvider({ fetch });
  const ctrl = new AbortController();
  ctrl.abort();
  await expectReason(provider, { ...makeArgs(), signal: ctrl.signal }, 'timeout');
});

test('T4.4 [J1 regression] abort wrapped DEEP in cause chain still maps to timeout', async () => {
  // Codex review J1: undici can wrap an abort as TypeError('fetch failed')
  // with the AbortError nested in cause.cause.cause. Without recursive
  // cause-walking, this would fall through isAbortError() and be matched
  // by isUnreachable()'s "TypeError fetch failed" heuristic, producing
  // 'server-unreachable' instead of 'timeout'. We pass NO AbortSignal so
  // the signal.aborted guard cannot save us — the isAbortError recursion
  // must do the work.
  const fetch = async () => {
    const inner = new Error('inner');
    inner.code = 'ABORT_ERR';
    const mid = new TypeError('fetch failed', { cause: inner });
    const outer = new TypeError('fetch failed', { cause: mid });
    throw outer;
  };
  const provider = createOpenAiCompatibleProvider({ fetch });
  await expectReason(provider, makeArgs(), 'timeout'); // no signal passed
});

test('T5.2 http 404 → http-error with status carried on err.status', async () => {
  const fetch = async () => fakeBadResponse(404);
  const provider = createOpenAiCompatibleProvider({ fetch });
  const ai = await expectReason(provider, makeArgs(), 'http-error');
  assert.equal(ai.status, 404);
});

test('T5.3 http 500 → http-error', async () => {
  const fetch = async () => fakeBadResponse(500);
  const provider = createOpenAiCompatibleProvider({ fetch });
  const ai = await expectReason(provider, makeArgs(), 'http-error');
  assert.equal(ai.status, 500);
});

test('T5.4 broken JSON → invalid-response', async () => {
  const fetch = async () => fakeBrokenJsonResponse();
  const provider = createOpenAiCompatibleProvider({ fetch });
  await expectReason(provider, makeArgs(), 'invalid-response');
});

test('T5.5 missing choices in body → invalid-response', async () => {
  const fetch = async () => fakeOkResponse({ foo: 'bar' });
  const provider = createOpenAiCompatibleProvider({ fetch });
  await expectReason(provider, makeArgs(), 'invalid-response');
});

test('T5.6 builds chat/completions URL even with trailing slash baseUrl', async () => {
  let sentUrl;
  const fetch = async (url) => {
    sentUrl = url;
    return fakeOkResponse({ choices: [{ message: { content: 'ok' } }] });
  };
  const provider = createOpenAiCompatibleProvider({ fetch });
  // The settings loader strips one trailing slash, but the adapter should
  // be defensive too: if a caller passes a baseUrl with a trailing slash,
  // we should still produce the right URL exactly once.
  await provider.summarize({ ...makeArgs(), baseUrl: 'http://localhost:1234/v1/' });
  assert.equal(sentUrl, 'http://localhost:1234/v1/chat/completions');
});
