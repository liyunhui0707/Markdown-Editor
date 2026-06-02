/* lib/ai-provider-openai.js
   OpenAI-compatible chat-completion adapter. Pure module: takes an
   injected fetch impl (test stub or globalThis.fetch in production).
   summarize() returns { summary } or throws aiError(reason, message[, {status}]).
   The IPC handler maps reasons → canned user-facing messages (G4); this
   adapter never formats the message — it only carries the reason and an
   integer http status when applicable.
*/

'use strict';

const { aiError, REASON_MESSAGES } = require('./ai-errors');
const { parseOpenAIChatResponse } = require('./ai-response-parser');
const { createSseParser } = require('./ai-sse-parser');

// [J1] Walk the err.cause chain (cap depth as a safety net) — undici can
// wrap an aborted fetch as `TypeError('fetch failed')` with an
// AbortError nested several levels deep. The IPC handler also passes an
// AbortSignal; checking `signal.aborted` is the primary guard, but this
// recursive scan is the defence-in-depth Codex review J1 asked for.
function isAbortError(err) {
  let current = err;
  let depth = 0;
  while (current && depth < 8) {
    if (current.name === 'AbortError') return true;
    if (current.code === 'ABORT_ERR') return true;
    current = current.cause;
    depth += 1;
  }
  return false;
}

function isUnreachable(err) {
  if (!err) return false;
  const code = (err.code) || (err.cause && err.cause.code) || '';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') return true;
  // node's fetch wraps connection errors in TypeError('fetch failed') with a cause
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  return false;
}

function joinUrl(baseUrl, suffix) {
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return trimmed + suffix;
}

function createOpenAiCompatibleProvider(deps) {
  const fetchImpl = (deps && deps.fetch) || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('createOpenAiCompatibleProvider: fetch is required');
  }

  async function summarize(args) {
    const { baseUrl, model, messages, temperature, maxTokens, signal } = args || {};
    const url = joinUrl(baseUrl, '/chat/completions');
    const body = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    });

    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal,
      });
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) {
        throw aiError('timeout', REASON_MESSAGES['timeout']);
      }
      if (isUnreachable(err)) {
        throw aiError('server-unreachable', REASON_MESSAGES['server-unreachable']);
      }
      // Unknown network error — treat as server-unreachable rather than leaking the
      // raw err.message through. The IPC handler will still get a canned message.
      throw aiError('server-unreachable', REASON_MESSAGES['server-unreachable']);
    }

    if (!res || res.ok !== true) {
      const status = res && Number.isInteger(res.status) ? res.status : undefined;
      throw aiError('http-error', REASON_MESSAGES['http-error'], { status });
    }

    let json;
    try {
      json = await res.json();
    } catch (_err) {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }

    return parseOpenAIChatResponse(json);
  }

  async function streamSummarize(args) {
    const { baseUrl, model, messages, temperature, maxTokens, signal, onChunk } = args || {};
    const url = joinUrl(baseUrl, '/chat/completions');
    const body = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body,
        signal,
      });
    } catch (err) {
      if (isAbortError(err) || (signal && signal.aborted)) {
        throw aiError('timeout', REASON_MESSAGES['timeout']);
      }
      if (isUnreachable(err)) {
        throw aiError('server-unreachable', REASON_MESSAGES['server-unreachable']);
      }
      throw aiError('server-unreachable', REASON_MESSAGES['server-unreachable']);
    }

    if (!res || res.ok !== true) {
      const status = res && Number.isInteger(res.status) ? res.status : undefined;
      throw aiError('http-error', REASON_MESSAGES['http-error'], { status });
    }

    const ct = (res.headers && typeof res.headers.get === 'function')
      ? (res.headers.get('content-type') || '')
      : '';
    if (!ct || !ct.toLowerCase().includes('text/event-stream')) {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }

    const reader = res.body.getReader();

    // QA fix: signal-abort doesn't reliably reject a pending reader.read()
    // in undici on Node 20 — the loop would keep draining chunks for the
    // model's full duration after a user cancel. Explicit reader.cancel()
    // on signal-abort destroys the stream synchronously; the pending
    // read then resolves with { done: true }, and we re-check signal.aborted
    // below to convert that into a typed timeout error rather than a
    // silent successful completion.
    let onSignalAbort = null;
    if (signal && typeof signal.addEventListener === 'function') {
      onSignalAbort = () => {
        try {
          // reader.cancel() returns a Promise. If the stream is already
          // errored by another listener (e.g., in tests), the promise
          // rejects — swallow to avoid an unhandled rejection.
          const p = reader.cancel();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_e) { /* sync throw — ignore */ }
      };
      signal.addEventListener('abort', onSignalAbort, { once: true });
    }

    try {
      const parser = createSseParser();
      let accumulated = '';
      let done = false;
      while (!done) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (isAbortError(err) || (signal && signal.aborted)) {
            throw aiError('timeout', REASON_MESSAGES['timeout']);
          }
          throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
        }
        // Post-read signal check: reader.cancel() (fired by our abort
        // listener above) resolves the pending read with { done: true }
        // rather than rejecting it, so the catch block above is not
        // guaranteed to fire on a user cancel.
        if (signal && signal.aborted) {
          throw aiError('timeout', REASON_MESSAGES['timeout']);
        }
        if (chunk.done) break;
        const events = parser.feed(chunk.value);
        for (const ev of events) {
          if (ev.kind === 'content') {
            accumulated += ev.text;
            if (typeof onChunk === 'function') onChunk(ev.text);
          } else if (ev.kind === 'done') {
            done = true;
            break;
          } else if (ev.kind === 'error') {
            throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
          }
        }
      }

      return { summary: accumulated };
    } finally {
      if (signal && onSignalAbort && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onSignalAbort);
      }
    }
  }

  return { summarize, streamSummarize };
}

module.exports = { createOpenAiCompatibleProvider };
