/* lib/ai-settings-ipc.js
   Stage C: IPC for the in-app AI settings panel. Single source of truth for
   BOTH the renderer's settings UI and the privacy badge — the badge is derived
   from the same effective settings the request layer uses, so it can never
   disagree with what a request will actually do.

   Channels:
   - ai:get-settings  -> { effective, envOverridden, badge }
   - ai:save-settings -> { ok, error?, effective, envOverridden, badge }

   effective = loadAiSettings(env > stored > default), narrowed to the user-
   editable fields (baseUrl, model, allowRemote). envOverridden flags which of
   those are locked by an env var so the UI can disable them. Validation:
   baseUrl must be http(s); model non-empty; allowRemote boolean. Never throws
   across IPC.
*/

'use strict';

const { loadAiSettings, isLoopbackBaseUrl } = require('./ai-settings');
const { readStoredSettings, writeStoredSettings } = require('./ai-settings-store');

const GET_CHANNEL = 'ai:get-settings';
const SAVE_CHANNEL = 'ai:save-settings';

function envHas(env, key) {
  const v = env[key];
  return typeof v === 'string' && v.trim() !== '';
}

function computeBadge(effective) {
  let hostname = '';
  try { hostname = new URL(effective.baseUrl).hostname; } catch (_e) { /* leave empty */ }
  return {
    isRemote: !isLoopbackBaseUrl(effective.baseUrl),
    allowRemote: effective.allowRemote ?? false,
    hostname,
  };
}

function snapshot(env, settingsPath) {
  const effective = loadAiSettings({ env, stored: readStoredSettings(settingsPath) });
  return {
    effective: {
      baseUrl: effective.baseUrl,
      model: effective.model,
      allowRemote: effective.allowRemote ?? false,
    },
    envOverridden: {
      baseUrl: envHas(env, 'MARKDOWN_AI_BASE_URL'),
      model: envHas(env, 'MARKDOWN_AI_MODEL'),
      allowRemote: envHas(env, 'MARKDOWN_AI_ALLOW_REMOTE'),
    },
    badge: computeBadge(effective),
  };
}

// Validate only the user-editable fields present in the payload. Returns the
// sanitized partial plus any human-readable errors. URL validity is enforced
// here (the store stays a dumb typed persister).
function validatePartial(partial) {
  const out = {};
  const errors = [];
  if (!partial || typeof partial !== 'object') return { out, errors };
  if ('baseUrl' in partial) {
    const v = partial.baseUrl;
    let ok = false;
    if (typeof v === 'string') {
      try { const u = new URL(v.trim()); ok = (u.protocol === 'http:' || u.protocol === 'https:'); } catch (_e) { ok = false; }
    }
    if (ok) out.baseUrl = v.trim();
    else errors.push('baseUrl must be a valid http(s) URL');
  }
  if ('model' in partial) {
    const v = partial.model;
    if (typeof v === 'string' && v.trim() !== '') out.model = v.trim();
    else errors.push('model must be a non-empty string');
  }
  if ('allowRemote' in partial) {
    const v = partial.allowRemote;
    if (typeof v === 'boolean') out.allowRemote = v;
    else errors.push('allowRemote must be a boolean');
  }
  return { out, errors };
}

function registerSettings(ipc, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const settingsPath = opts.settingsPath;

  ipc.handle(GET_CHANNEL, async () => snapshot(env, settingsPath));

  ipc.handle(SAVE_CHANNEL, async (_event, payload) => {
    const { out, errors } = validatePartial(payload);
    if (errors.length > 0) {
      return { ok: false, error: errors.join('; '), ...snapshot(env, settingsPath) };
    }
    try {
      writeStoredSettings(settingsPath, out);
    } catch (_err) {
      return { ok: false, error: 'Could not save settings.', ...snapshot(env, settingsPath) };
    }
    return { ok: true, ...snapshot(env, settingsPath) };
  });
}

module.exports = { registerSettings, GET_CHANNEL, SAVE_CHANNEL };
