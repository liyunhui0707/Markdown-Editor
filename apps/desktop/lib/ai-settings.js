/* lib/ai-settings.js
   Pure settings loader. Caller passes env (typically process.env in main);
   tests inject explicit env maps. No singletons, no implicit reads.

   Defaults + override rules per plan §"Proposed defaults" + F6/G5:
   - protocol whitelist: http: or https: only
   - trailing-slash normalization on baseUrl (strip exactly one trailing '/')
   - numeric validation: parsed number must be finite and > 0
   - empty-string env treated as unset
*/

'use strict';

const DEFAULTS = Object.freeze({
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-model',
  temperature: 0.2,
  // QA bug A: bumped from 512 to 1024. Reasoning-capable models
  // (e.g. Gemma thinking, DeepSeek-R1) spend a large slice of their
  // budget on internal reasoning before emitting visible content;
  // 512 was small enough that visible content was empty or truncated
  // after finish_reason === 'length'. 1024 gives reasonable headroom
  // for both reasoning and non-reasoning models; heavy reasoning use
  // can override via MARKDOWN_AI_MAX_TOKENS.
  maxTokens: 1024,
  timeoutMs: 60000,
  maxInputChars: 48000,
});

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function readString(env, key, fallback) {
  const v = env[key];
  return isNonEmptyString(v) ? v : fallback;
}

function readPositiveNumber(env, key, fallback) {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function readPositiveOrZeroNumber(env, key, fallback) {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function normalizeBaseUrl(raw, fallback) {
  if (!isNonEmptyString(raw)) return fallback;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch (_e) {
    return fallback;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
  let s = raw.trim();
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function loadAiSettings({ env } = { env: {} }) {
  const envMap = env || {};
  return {
    provider:      readString(envMap, 'MARKDOWN_AI_PROVIDER', DEFAULTS.provider),
    baseUrl:       normalizeBaseUrl(envMap.MARKDOWN_AI_BASE_URL, DEFAULTS.baseUrl),
    model:         readString(envMap, 'MARKDOWN_AI_MODEL', DEFAULTS.model),
    // temperature uses readPositiveOrZeroNumber so 0 is acceptable; default
    // is 0.2. Note: T1.3 expects 0.5 to round-trip; T1.4 expects 'abc' to
    // fall back. The test suite does not currently exercise 0 explicitly
    // for temperature, but allowing zero is the conservative choice.
    temperature:   readPositiveOrZeroNumber(envMap, 'MARKDOWN_AI_TEMPERATURE', DEFAULTS.temperature),
    maxTokens:     readPositiveNumber(envMap, 'MARKDOWN_AI_MAX_TOKENS', DEFAULTS.maxTokens),
    timeoutMs:     readPositiveNumber(envMap, 'MARKDOWN_AI_TIMEOUT_MS', DEFAULTS.timeoutMs),
    maxInputChars: readPositiveNumber(envMap, 'MARKDOWN_AI_MAX_INPUT_CHARS', DEFAULTS.maxInputChars),
  };
}

module.exports = { loadAiSettings, DEFAULTS };
