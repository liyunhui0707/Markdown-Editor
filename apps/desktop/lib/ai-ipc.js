/* lib/ai-ipc.js
   Registers the 'ai:summarize-note' + 'ai:rewrite-text' IPC handlers,
   plus the Stage B 'ai:cancel' channel for cross-process abort.

   Contract (v0.3.0 baseline preserved):
   - Never throws across the IPC boundary. Every error path resolves with
     { ok:false, reason, message } where message === REASON_MESSAGES[reason]
     (G4 + H3 + I5 — strict canned messages, no provider-supplied text echoed).
   - Single allow-listed extension: http-error with integer err.status →
     message + ' (HTTP <int>)'.
   - Timeout is enforced by Promise.race against a deterministic timeout
     promise (F1 + G2): a signal-ignoring adapter cannot hang the handler.
     Single source of truth: options.timeoutMs ?? settings.timeoutMs.

   Stage B (additive):
   - When the renderer's payload includes a `chunkChannel` AND streaming is
     enabled (settings.streaming ?? true) AND the resolved provider exposes
     `streamSummarize`, the handler takes the STREAMING branch.
   - Streaming branch wraps provider.streamSummarize in
     streamWithStallTimeout({ stallTimeoutMs, run }). The helper owns the
     AbortController, races run() against an actively-rejecting stall timer
     (F1), and exposes a progress() callback the provider calls BEFORE each
     event.sender.send(chunkChannel, { text }).
   - chunkChannelControllers is a module-scope Map keyed by composite
     `${event.sender.id}:${chunkChannel}` (D7 — two BrowserWindows safe).
   - registerCancel(ipc) installs the 'ai:cancel' listener (idempotent).
     Cancel handler looks up the composite key and calls controller.abort().
     Unknown chunkChannels are no-op.
   - When `chunkChannel` is absent OR streaming is opted out OR provider
     lacks streamSummarize, the v0.3.0 non-streaming path is taken byte-for-
     byte (T6/CA2 contracts preserved).
*/

'use strict';

const { aiError, REASON_MESSAGES, isKnownReason } = require('./ai-errors');
const { buildSummaryPrompt } = require('./ai-prompt-builder');
const { buildRewritePrompt } = require('./ai-rewrite-prompt-builder');
const { loadAiSettings, isLoopbackBaseUrl } = require('./ai-settings');
const { resolveProvider } = require('./ai-provider');

const CHANNEL = 'ai:summarize-note';
const REWRITE_CHANNEL = 'ai:rewrite-text';
const CANCEL_CHANNEL = 'ai:cancel';

// Composite-key Map<string, AbortController> for cross-process aborts.
// Key = `${event.sender.id}:${chunkChannel}`. Two BrowserWindows generating
// colliding chunkChannel names are safely distinguished by sender id (D7).
const chunkChannelControllers = new Map();

// registerCancel idempotency flag — keyed by ipc identity. Calling
// registerCancel(ipc) twice with the same ipc instance does NOT install
// duplicate listeners. (Defensive — main.js should only call once anyway.)
const cancelRegisteredFor = new WeakSet();

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

/* streamWithStallTimeout — Stage B D6.
   Runs `run({ signal, controller, progress })` racing against an
   actively-rejecting stall timer. The provider calls progress() before
   each chunk to reset the stall window. Even a misbehaving provider that
   ignores the signal cannot hang the IPC handler — the timer rejects the
   race and the handler resolves with `timeout`. */
async function streamWithStallTimeout({ stallTimeoutMs, run }) {
  const controller = new AbortController();
  let stallTimer;
  let rejectTimeout;
  const timeoutPromise = new Promise((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const armStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      controller.abort();
      rejectTimeout(aiError('timeout', REASON_MESSAGES['timeout']));
    }, stallTimeoutMs);
    if (typeof stallTimer.unref === 'function') stallTimer.unref();
  };
  armStallTimer();
  const progress = () => armStallTimer();
  try {
    return await Promise.race([
      run({ signal: controller.signal, controller, progress }),
      timeoutPromise,
    ]);
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

// Streaming branch is identical in both register / registerRewrite handlers.
// Extracted here to avoid duplicating ~40 lines twice; the non-streaming
// branch stays inline in each handler so the v0.3.0 code path is visibly
// unchanged in source review.
async function runStreamingRequest({
  event, payload, settings, provider, timeoutMs, messages,
}) {
  const chunkChannel = payload.chunkChannel;
  const senderKey = String(event.sender.id) + ':' + chunkChannel;
  try {
    const result = await streamWithStallTimeout({
      stallTimeoutMs: timeoutMs,
      run: ({ signal, controller, progress }) => {
        chunkChannelControllers.set(senderKey, controller);
        return provider.streamSummarize({
          baseUrl: settings.baseUrl,
          model: settings.model,
          messages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal,
          onChunk: (text) => {
            if (typeof text !== 'string' || text.length === 0) return;
            progress();
            try {
              event.sender.send(chunkChannel, { text });
            } catch (_err) {
              // Sender may have gone away (window closed); abort the stream.
              controller.abort();
            }
          },
        });
      },
    });
    return { ok: true, summary: (result && result.summary) || '' };
  } catch (err) {
    return failureFromError(err);
  } finally {
    chunkChannelControllers.delete(senderKey);
  }
}

function shouldStream(settings, provider, payload) {
  if (!payload || payload.chunkChannel == null) return false;
  if ((settings.streaming ?? true) !== true) return false;
  if (typeof provider.streamSummarize !== 'function') return false;
  return true;
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

  ipc.handle(CHANNEL, async (event, payload) => {
    // Stage F: privacy pre-flight. Non-loopback baseUrl + no opt-in →
    // refuse before any other work (no provider call, no info leak).
    if (!isLoopbackBaseUrl(settings.baseUrl) && (settings.allowRemote ?? false) !== true) {
      return failure('remote-blocked');
    }
    const text = payload && payload.text;
    if (typeof text !== 'string' || text.trim() === '') return failure('empty-input');
    if (text.length > settings.maxInputChars) return failure('input-too-large');

    let messages;
    try {
      messages = buildSummaryPrompt(text).messages;
    } catch (err) {
      return failureFromError(err);
    }

    if (shouldStream(settings, provider, payload)) {
      return runStreamingRequest({ event, payload, settings, provider, timeoutMs, messages });
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

  ipc.handle(REWRITE_CHANNEL, async (event, payload) => {
    // Stage F: same pre-flight as Summarize handler.
    if (!isLoopbackBaseUrl(settings.baseUrl) && (settings.allowRemote ?? false) !== true) {
      return failure('remote-blocked');
    }
    const text = payload && payload.text;
    if (typeof text !== 'string' || text.trim() === '') return failure('empty-input');
    if (text.length > settings.maxInputChars) return failure('input-too-large');

    let messages;
    try {
      messages = buildRewritePrompt(text).messages;
    } catch (err) {
      return failureFromError(err);
    }

    if (shouldStream(settings, provider, payload)) {
      return runStreamingRequest({ event, payload, settings, provider, timeoutMs, messages });
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

/* registerCancel — Stage B D5/D7.
   Installs the 'ai:cancel' listener on the given ipc. The renderer's
   preload sends { chunkChannel } when the user clicks × on the panel.
   The handler composes ${event.sender.id}:${chunkChannel} and aborts the
   AbortController if one is in flight. Idempotent: calling registerCancel
   with the same ipc instance more than once does not install a second
   listener. Unknown chunkChannels are silently ignored. */
function registerCancel(ipc) {
  if (cancelRegisteredFor.has(ipc)) return;
  cancelRegisteredFor.add(ipc);
  ipc.on(CANCEL_CHANNEL, (event, payload) => {
    if (!event || !event.sender || event.sender.id == null) return;
    if (!payload || payload.chunkChannel == null) return;
    const key = String(event.sender.id) + ':' + payload.chunkChannel;
    const controller = chunkChannelControllers.get(key);
    if (controller) {
      try { controller.abort(); } catch (_e) { /* ignore */ }
      chunkChannelControllers.delete(key);
    }
  });
}

module.exports = {
  register,
  registerRewrite,
  registerCancel,
  CHANNEL,
  REWRITE_CHANNEL,
  CANCEL_CHANNEL,
};
