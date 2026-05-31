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

  return { summarize };
}

module.exports = { createOpenAiCompatibleProvider };
