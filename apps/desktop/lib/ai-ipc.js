/* lib/ai-ipc.js
   Registers the 'ai:summarize-note' IPC handler.

   Contract:
   - Never throws across the IPC boundary. Every error path resolves with
     { ok:false, reason, message } where message === REASON_MESSAGES[reason]
     (G4 + H3 + I5 — strict canned messages, no provider-supplied text echoed).
   - Single allow-listed extension: http-error with integer err.status →
     message + ' (HTTP <int>)'.
   - Timeout is enforced by Promise.race against a deterministic timeout
     promise (F1 + G2): a signal-ignoring adapter cannot hang the handler.
     Single source of truth: options.timeoutMs ?? settings.timeoutMs.
   - Wiring (F7): main.js calls register(ipcMain) with no options;
     ai-ipc.js loads settings from process.env internally via loadAiSettings.
     Tests inject { settings, provider, timeoutMs } directly.
*/

'use strict';

const { aiError, REASON_MESSAGES, isKnownReason } = require('./ai-errors');
const { buildSummaryPrompt } = require('./ai-prompt-builder');
const { buildRewritePrompt } = require('./ai-rewrite-prompt-builder');
const { loadAiSettings } = require('./ai-settings');
const { resolveProvider } = require('./ai-provider');

const CHANNEL = 'ai:summarize-note';
const REWRITE_CHANNEL = 'ai:rewrite-text';

function failure(reason) {
  return { ok: false, reason, message: REASON_MESSAGES[reason] };
}

function failureFromError(err) {
  if (err && err.name === 'AiError' && isKnownReason(err.reason)) {
    const reason = err.reason;
    if (reason === 'http-error' && Number.isInteger(err.status) && err.status > 0) {
      return {
        ok: false,
        reason,
        message: REASON_MESSAGES[reason] + ' (HTTP ' + err.status + ')',
      };
    }
    return failure(reason);
  }
  return failure('unknown');
}

function makeFailFastProvider(err) {
  return {
    summarize: async () => { throw err; },
  };
}

function register(ipc, options) {
  const opts = options || {};
  const settings = opts.settings || loadAiSettings({ env: process.env });
  const timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0)
    ? opts.timeoutMs
    : settings.timeoutMs;

  // Resolve provider at registration. If the provider selector throws (unknown
  // provider, etc.), cache the AiError as a fail-fast provider so every invoke
  // returns the typed failure without the handler needing a special case.
  let provider = opts.provider;
  if (!provider) {
    try {
      provider = resolveProvider(settings, { fetch: globalThis.fetch });
    } catch (err) {
      provider = makeFailFastProvider(err);
    }
  }

  ipc.handle(CHANNEL, async (_event, payload) => {
    const text = payload && payload.text;
    if (typeof text !== 'string' || text.trim() === '') return failure('empty-input');
    if (text.length > settings.maxInputChars) return failure('input-too-large');

    let messages;
    try {
      messages = buildSummaryPrompt(text).messages;
    } catch (err) {
      return failureFromError(err);
    }

    const ctrl = new AbortController();
    let timeoutTimer;                                        // [G2] declared OUTSIDE the executor — no TDZ
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        ctrl.abort();
        reject(aiError('timeout', REASON_MESSAGES['timeout']));
      }, timeoutMs);
      if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
    });

    try {
      const result = await Promise.race([
        provider.summarize({
          baseUrl: settings.baseUrl,
          model: settings.model,
          messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: ctrl.signal,
        }),
        timeoutPromise,
      ]);
      return { ok: true, summary: result.summary };
    } catch (err) {
      return failureFromError(err);
    } finally {
      clearTimeout(timeoutTimer);
    }
  });
}

// Stage A: parallel handler for 'ai:rewrite-text'. Per plan D1, this is a
// DUPLICATE of `register` differing only in (1) channel name and (2) prompt
// builder (buildRewritePrompt instead of buildSummaryPrompt). Same
// failureFromError / Promise.race timeout / provider resolution path —
// zero risk of regressing the v0.2.0 Summarize behavior.
function registerRewrite(ipc, options) {
  const opts = options || {};
  const settings = opts.settings || loadAiSettings({ env: process.env });
  const timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0)
    ? opts.timeoutMs
    : settings.timeoutMs;

  let provider = opts.provider;
  if (!provider) {
    try {
      provider = resolveProvider(settings, { fetch: globalThis.fetch });
    } catch (err) {
      provider = makeFailFastProvider(err);
    }
  }

  ipc.handle(REWRITE_CHANNEL, async (_event, payload) => {
    const text = payload && payload.text;
    if (typeof text !== 'string' || text.trim() === '') return failure('empty-input');
    if (text.length > settings.maxInputChars) return failure('input-too-large');

    let messages;
    try {
      messages = buildRewritePrompt(text).messages;
    } catch (err) {
      return failureFromError(err);
    }

    const ctrl = new AbortController();
    let timeoutTimer;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        ctrl.abort();
        reject(aiError('timeout', REASON_MESSAGES['timeout']));
      }, timeoutMs);
      if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
    });

    try {
      const result = await Promise.race([
        provider.summarize({
          baseUrl: settings.baseUrl,
          model: settings.model,
          messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: ctrl.signal,
        }),
        timeoutPromise,
      ]);
      return { ok: true, summary: result.summary };
    } catch (err) {
      return failureFromError(err);
    } finally {
      clearTimeout(timeoutTimer);
    }
  });
}

module.exports = { register, CHANNEL, registerRewrite, REWRITE_CHANNEL };
