/* lib/ai-provider-ollama.js
   Ollama NATIVE API adapter — the second provider, proving the replaceable-
   provider abstraction with a genuinely different wire protocol than the
   OpenAI-compatible one:
     - POST {baseUrl}/api/chat   body { model, messages, stream, options }
     - response { message: { content } }      (not choices[].message)
     - streaming is NDJSON (one JSON object per line), not SSE data: frames
     - GET  {baseUrl}/api/tags -> { models: [{ name }] }   (not { data:[{id}] })

   baseUrl is the Ollama ROOT (e.g. http://localhost:11434 — NO /v1). Same
   { summarize, streamSummarize, listModels } interface + typed-error mapping
   as the OpenAI adapter; the adapter never formats user-facing text.
*/

'use strict';

const { aiError, REASON_MESSAGES } = require('./ai-errors');

// Small fetch-error helpers (kept local — the OpenAI adapter has its own copies;
// extracting a shared module would mean refactoring a tested file for ~20 lines).
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
  const code = err.code || (err.cause && err.cause.code) || '';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') return true;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  return false;
}

function joinUrl(baseUrl, suffix) {
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return trimmed + suffix;
}

function createOllamaProvider(deps) {
  const fetchImpl = (deps && deps.fetch) || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('createOllamaProvider: fetch is required');
  }

  function buildBody(args, stream) {
    const options = {};
    if (typeof args.temperature === 'number') options.temperature = args.temperature;
    if (typeof args.maxTokens === 'number') options.num_predict = args.maxTokens;
    return JSON.stringify({ model: args.model, messages: args.messages, stream, options });
  }

  function mapRequestError(err, signal) {
    if (isAbortError(err) || (signal && signal.aborted)) {
      return aiError('timeout', REASON_MESSAGES['timeout']);
    }
    if (isUnreachable(err)) {
      return aiError('server-unreachable', REASON_MESSAGES['server-unreachable']);
    }
    return aiError('server-unreachable', REASON_MESSAGES['server-unreachable']);
  }

  function assertOk(res) {
    if (!res || res.ok !== true) {
      const status = res && Number.isInteger(res.status) ? res.status : undefined;
      throw aiError('http-error', REASON_MESSAGES['http-error'], { status });
    }
  }

  async function summarize(args) {
    const a = args || {};
    const url = joinUrl(a.baseUrl, '/api/chat');
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: buildBody(a, false),
        signal: a.signal,
      });
    } catch (err) {
      throw mapRequestError(err, a.signal);
    }
    assertOk(res);
    let json;
    try {
      json = await res.json();
    } catch (_e) {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }
    const content = json && json.message && json.message.content;
    if (typeof content !== 'string') {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }
    return { summary: content };
  }

  async function listModels(args) {
    const a = args || {};
    const url = joinUrl(a.baseUrl, '/api/tags');
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', signal: a.signal });
    } catch (err) {
      throw mapRequestError(err, a.signal);
    }
    assertOk(res);
    let json;
    try {
      json = await res.json();
    } catch (_e) {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }
    const arr = json && json.models;
    if (!Array.isArray(arr)) {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }
    const models = arr
      .map((m) => (m && typeof m.name === 'string' ? m.name : ''))
      .filter((n) => n.length > 0);
    return { models };
  }

  async function streamSummarize(args) {
    const a = args || {};
    const { signal, onChunk } = a;
    const url = joinUrl(a.baseUrl, '/api/chat');
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: buildBody(a, true),
        signal,
      });
    } catch (err) {
      throw mapRequestError(err, signal);
    }
    assertOk(res);
    if (!res.body || typeof res.body.getReader !== 'function') {
      throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
    }

    const reader = res.body.getReader();
    // Same cancel-on-abort guard as the OpenAI adapter: undici may not reject a
    // pending read() on signal abort; reader.cancel() resolves it with done.
    let onSignalAbort = null;
    if (signal && typeof signal.addEventListener === 'function') {
      onSignalAbort = () => {
        try {
          const p = reader.cancel();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_e) { /* sync throw — ignore */ }
      };
      signal.addEventListener('abort', onSignalAbort, { once: true });
    }

    const decoder = new TextDecoder();
    let accumulated = '';

    // Parse one NDJSON line. Returns true if the stream is done. Throws
    // invalid-response on an error line. Skips blank / non-JSON lines.
    function handleLine(raw) {
      const t = raw.trim();
      if (t === '') return false;
      let obj;
      try {
        obj = JSON.parse(t);
      } catch (_e) {
        return false;
      }
      if (obj && obj.error) {
        throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
      }
      const c = obj && obj.message && obj.message.content;
      if (typeof c === 'string' && c.length > 0) {
        accumulated += c;
        if (typeof onChunk === 'function') onChunk(c);
      }
      return !!(obj && obj.done === true);
    }

    try {
      let buffer = '';
      let finished = false;
      while (!finished) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (isAbortError(err) || (signal && signal.aborted)) {
            throw aiError('timeout', REASON_MESSAGES['timeout']);
          }
          throw aiError('invalid-response', REASON_MESSAGES['invalid-response']);
        }
        if (signal && signal.aborted) {
          throw aiError('timeout', REASON_MESSAGES['timeout']);
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const ln = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (handleLine(ln)) { finished = true; break; }
        }
      }
      // Flush a trailing line that arrived without a final newline.
      if (!finished) handleLine(buffer);
      return { summary: accumulated };
    } finally {
      if (signal && onSignalAbort && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onSignalAbort);
      }
    }
  }

  return { summarize, streamSummarize, listModels };
}

module.exports = { createOllamaProvider };
