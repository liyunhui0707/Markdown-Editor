/* lib/ai-connection-ipc.js
   Stage C-2: ai:test-connection — pings the configured endpoint's /models and
   reports reachability + the model list for the settings panel's "Test
   connection" button + model picker.

   - Applies the SAME loopback/allow-remote privacy gate as the request
     handlers, against the PENDING panel values in the payload
     { baseUrl, allowRemote } (so the user can test before saving).
   - Returns { ok, models?, error? }. `error` is always app-controlled canned
     text — provider-supplied messages are never echoed (G4).
   - Deterministic timeout via Promise.race (a hanging server can't wedge the
     handler). Never throws across IPC.

   Kept out of ai-ipc.js, which is already at the file-size guideline.
*/

'use strict';

const { aiError, REASON_MESSAGES } = require('./ai-errors');
const { loadAiSettings, isLoopbackBaseUrl } = require('./ai-settings');
const { readStoredSettings } = require('./ai-settings-store');
const { resolveProvider } = require('./ai-provider');

const TEST_CHANNEL = 'ai:test-connection';
const DEFAULT_TEST_TIMEOUT_MS = 10000;

function isValidHttpUrl(v) {
  if (typeof v !== 'string' || v.trim() === '') return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_e) {
    return false;
  }
}

// Map a thrown error to a canned, sanitized message. Only known reasons pass
// through; anything else collapses to 'unknown'. http-error gets the (HTTP n)
// suffix from an integer status, matching the request handlers.
function messageFor(err) {
  const reason = err && err.reason && REASON_MESSAGES[err.reason] ? err.reason : 'unknown';
  let msg = REASON_MESSAGES[reason];
  if (reason === 'http-error' && err && Number.isInteger(err.status)) {
    msg += ' (HTTP ' + err.status + ')';
  }
  return msg;
}

function registerTestConnection(ipc, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const settingsPath = opts.settingsPath;
  const timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0)
    ? opts.timeoutMs
    : DEFAULT_TEST_TIMEOUT_MS;

  // Provider TYPE is env-only (not user-editable); resolve once. baseUrl is
  // passed per call from the pending panel value, not from settings.
  let provider = opts.provider;
  if (!provider) {
    try {
      provider = resolveProvider(
        loadAiSettings({ env, stored: readStoredSettings(settingsPath) }),
        { fetch: globalThis.fetch },
      );
    } catch (_err) {
      provider = null;
    }
  }

  ipc.handle(TEST_CHANNEL, async (_event, payload) => {
    const baseUrl = payload && payload.baseUrl;
    const allowRemote = !!(payload && payload.allowRemote === true);
    if (!isValidHttpUrl(baseUrl)) {
      return { ok: false, error: 'Enter a valid http:// or https:// URL first.' };
    }
    const url = baseUrl.trim();
    if (!isLoopbackBaseUrl(url) && allowRemote !== true) {
      return { ok: false, error: REASON_MESSAGES['remote-blocked'] };
    }
    if (!provider || typeof provider.listModels !== 'function') {
      return { ok: false, error: REASON_MESSAGES['provider-error'] };
    }

    const ctrl = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(aiError('timeout', REASON_MESSAGES['timeout']));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      const result = await Promise.race([
        provider.listModels({ baseUrl: url, signal: ctrl.signal }),
        timeout,
      ]);
      const models = result && Array.isArray(result.models) ? result.models : [];
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: messageFor(err) };
    } finally {
      clearTimeout(timer);
    }
  });
}

module.exports = { registerTestConnection, TEST_CHANNEL };
