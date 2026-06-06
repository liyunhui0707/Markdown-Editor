/* T1 — lib/ai-settings.js
   Run focused: cd apps/desktop && node --test test/ai-settings.test.js

   Tests defaults, env-var overrides, numeric validation, URL protocol
   whitelist (G5), trailing-slash normalization (F6), and zero/negative
   numeric rejection. Plan: .workflow/artifacts/04-minimal-tdd-implementation-plan.md
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadAiSettings } = require('../lib/ai-settings');

const DEFAULTS = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-model',
  temperature: 0.2,
  // Bumped 512 -> 1024 to give reasoning-capable models (e.g., Gemma
  // thinking, DeepSeek-R1) enough budget to emit a non-empty summary.
  // QA bug A: 512 was eaten by reasoning_content and the parser
  // correctly rejected the empty content as 'invalid-response'.
  maxTokens: 1024,
  timeoutMs: 60000,
  maxInputChars: 48000,
};

test('T1.1 defaults: empty env returns documented defaults', () => {
  assert.deepEqual(loadAiSettings({ env: {} }), DEFAULTS);
});

test('T1.2 env override: baseUrl + model', () => {
  const s = loadAiSettings({
    env: {
      MARKDOWN_AI_BASE_URL: 'http://localhost:11434/v1',
      MARKDOWN_AI_MODEL: 'llama3.1',
    },
  });
  assert.equal(s.baseUrl, 'http://localhost:11434/v1');
  assert.equal(s.model, 'llama3.1');
  assert.equal(s.provider, DEFAULTS.provider);
  assert.equal(s.temperature, DEFAULTS.temperature);
});

test('T1.3 numeric env (temperature): valid number', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_TEMPERATURE: '0.5' } });
  assert.equal(s.temperature, 0.5);
  assert.equal(typeof s.temperature, 'number');
});

test('T1.4 invalid numeric env (temperature): falls back to default', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_TEMPERATURE: 'abc' } });
  assert.equal(s.temperature, DEFAULTS.temperature);
});

test('T1.5 invalid url env: not-a-url falls back to default', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_BASE_URL: 'not-a-url' } });
  assert.equal(s.baseUrl, DEFAULTS.baseUrl);
});

test('T1.6 empty-string env: model uses default', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_MODEL: '' } });
  assert.equal(s.model, DEFAULTS.model);
});

test('T1.7 input cap override: maxInputChars', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_MAX_INPUT_CHARS: '16' } });
  assert.equal(s.maxInputChars, 16);
});

test('T1.8 provider override: openai-compatible', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_PROVIDER: 'openai-compatible' } });
  assert.equal(s.provider, 'openai-compatible');
});

test('T1.9 numeric env (timeoutMs)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_TIMEOUT_MS: '15000' } });
  assert.equal(s.timeoutMs, 15000);
});

test('T1.10 invalid numeric env (timeoutMs)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_TIMEOUT_MS: 'fast' } });
  assert.equal(s.timeoutMs, DEFAULTS.timeoutMs);
});

test('T1.11 numeric env (maxTokens)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_MAX_TOKENS: '1024' } });
  assert.equal(s.maxTokens, 1024);
});

test('T1.12 invalid numeric env (maxTokens)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_MAX_TOKENS: 'lots' } });
  assert.equal(s.maxTokens, DEFAULTS.maxTokens);
});

test('T1.13 invalid numeric env (maxInputChars)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_MAX_INPUT_CHARS: 'big' } });
  assert.equal(s.maxInputChars, DEFAULTS.maxInputChars);
});

test('T1.14 base URL trailing slash normalized', () => {
  const a = loadAiSettings({ env: { MARKDOWN_AI_BASE_URL: 'http://localhost:1234/v1/' } });
  const b = loadAiSettings({ env: { MARKDOWN_AI_BASE_URL: 'http://localhost:1234/v1' } });
  assert.equal(a.baseUrl, b.baseUrl);
  assert.equal(a.baseUrl, 'http://localhost:1234/v1');
});

test('T1.15 zero/negative numeric envs rejected', () => {
  const a = loadAiSettings({ env: { MARKDOWN_AI_TIMEOUT_MS: '0' } });
  assert.equal(a.timeoutMs, DEFAULTS.timeoutMs);
  const b = loadAiSettings({ env: { MARKDOWN_AI_MAX_TOKENS: '-1' } });
  assert.equal(b.maxTokens, DEFAULTS.maxTokens);
});

test('T1.16 non-http protocol (file://) rejected', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_BASE_URL: 'file:///tmp/x' } });
  assert.equal(s.baseUrl, DEFAULTS.baseUrl);
});

test('T1.17 non-http protocol (ftp://) rejected', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_BASE_URL: 'ftp://example/v1' } });
  assert.equal(s.baseUrl, DEFAULTS.baseUrl);
});

test('T1.18 whitespace-only baseUrl rejected', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_BASE_URL: '   ' } });
  assert.equal(s.baseUrl, DEFAULTS.baseUrl);
});

test('T1.19 https accepted (positive control)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_BASE_URL: 'https://my-local-tls/v1' } });
  assert.equal(s.baseUrl, 'https://my-local-tls/v1');
});
