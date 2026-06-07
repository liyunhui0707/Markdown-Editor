/* test/ai-settings-remote.test.js
   Stage F (Privacy guardrails) — CF1: isLoopbackBaseUrl helper +
   MARKDOWN_AI_ALLOW_REMOTE env field.

   Contract:
   - `isLoopbackBaseUrl(url)` returns true ONLY for literal loopback hosts:
     localhost, 127.x.x.x, ::1 / [::1]. Everything else (0.0.0.0, LAN,
     public, Tailscale CGNAT, hostnames) is treated as remote.
   - `MARKDOWN_AI_ALLOW_REMOTE` env var: when unset/empty/whitespace, field
     is ABSENT (T1.1 deepEqual preservation, mirrors MARKDOWN_AI_STREAMING).
     Literal 'true' (case-insensitive) → settings.allowRemote === true.
     Anything else non-empty → false (opt-in is explicit).
   - Settings object key count stays additive only.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAiSettings, isLoopbackBaseUrl } = require('../lib/ai-settings');

// ===== CF1 — isLoopbackBaseUrl =====

test('CF1.1 plain localhost (default port) → loopback', () => {
  assert.equal(isLoopbackBaseUrl('http://localhost:1234/v1'), true);
});

test('CF1.2 localhost with https + path → loopback', () => {
  assert.equal(isLoopbackBaseUrl('https://localhost:11434/v1'), true);
});

test('CF1.3 127.0.0.1 → loopback', () => {
  assert.equal(isLoopbackBaseUrl('http://127.0.0.1:1234/v1'), true);
});

test('CF1.4 127.x.x.x range → loopback (entire 127.0.0.0/8 block)', () => {
  for (const ip of ['127.0.0.2', '127.1.2.3', '127.255.255.254']) {
    assert.equal(isLoopbackBaseUrl(`http://${ip}:8080`), true, `${ip} should be loopback`);
  }
});

test('CF1.5 IPv6 ::1 (bracketed) → loopback', () => {
  assert.equal(isLoopbackBaseUrl('http://[::1]:1234/v1'), true);
});

test('CF1.6 0.0.0.0 → NOT loopback (server bind-all, client semantics unclear)', () => {
  assert.equal(isLoopbackBaseUrl('http://0.0.0.0:1234/v1'), false);
});

test('CF1.7 LAN IP (192.168.x.x, 10.x, 172.16-31.x) → NOT loopback', () => {
  for (const url of [
    'http://192.168.1.50:1234/v1',
    'http://10.0.0.5:8080',
    'http://172.20.0.3:11434/v1',
  ]) {
    assert.equal(isLoopbackBaseUrl(url), false, `${url} should be remote`);
  }
});

test('CF1.8 Public IP / hostname → NOT loopback', () => {
  for (const url of [
    'http://203.0.113.42:443',
    'https://ai.example.com/v1',
    'https://my-model-server.internal:8443/v1',
  ]) {
    assert.equal(isLoopbackBaseUrl(url), false);
  }
});

test('CF1.9 Tailscale CGNAT range (100.64.0.0/10) → NOT loopback (strict policy)', () => {
  assert.equal(isLoopbackBaseUrl('http://100.100.100.100:1234/v1'), false);
});

test('CF1.10 Unparseable URL → NOT loopback (conservative default)', () => {
  for (const garbage of ['not a url', '', '   ', 'ftp://localhost', 'file:///etc/passwd']) {
    assert.equal(isLoopbackBaseUrl(garbage), false, `${JSON.stringify(garbage)} should not be loopback`);
  }
});

test('CF1.11 case-insensitive hostname match', () => {
  assert.equal(isLoopbackBaseUrl('http://LOCALHOST:1234/v1'), true);
  assert.equal(isLoopbackBaseUrl('http://LocalHost:1234/v1'), true);
});

test('CF1.12 wrong protocol but localhost host → NOT loopback (must be http/https)', () => {
  // Matches normalizeBaseUrl's protocol whitelist policy.
  assert.equal(isLoopbackBaseUrl('ftp://localhost:1234'), false);
});

// ===== CF2 — MARKDOWN_AI_ALLOW_REMOTE =====

test('CF2.1 unset env: allowRemote field ABSENT (T1.1 deepEqual preserved)', () => {
  const s = loadAiSettings({ env: {} });
  assert.equal('allowRemote' in s, false);
  assert.equal(s.allowRemote, undefined);
});

test('CF2.2 empty-string env: field ABSENT', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_ALLOW_REMOTE: '' } });
  assert.equal('allowRemote' in s, false);
});

test('CF2.3 whitespace-only env: field ABSENT', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_ALLOW_REMOTE: '   ' } });
  assert.equal('allowRemote' in s, false);
});

test('CF2.4 explicit "true" → allowRemote === true', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_ALLOW_REMOTE: 'true' } });
  assert.equal(s.allowRemote, true);
});

test('CF2.5 case-insensitive "TRUE" / "True" → true', () => {
  for (const raw of ['TRUE', 'True', 'tRuE']) {
    const s = loadAiSettings({ env: { MARKDOWN_AI_ALLOW_REMOTE: raw } });
    assert.equal(s.allowRemote, true, `expected true for ${JSON.stringify(raw)}`);
  }
});

test('CF2.6 trimmed "  true  " → true', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_ALLOW_REMOTE: '  true  ' } });
  assert.equal(s.allowRemote, true);
});

test('CF2.7 anything other than "true" → false (explicit opt-in only)', () => {
  for (const raw of ['1', 'yes', 'on', 'false', '0', 'no']) {
    const s = loadAiSettings({ env: { MARKDOWN_AI_ALLOW_REMOTE: raw } });
    assert.equal(s.allowRemote, false, `expected false for ${JSON.stringify(raw)}`);
  }
});

test('CF2.8 setting allowRemote does not perturb other default fields', () => {
  const base = loadAiSettings({ env: {} });
  const withFlag = loadAiSettings({ env: { MARKDOWN_AI_ALLOW_REMOTE: 'true' } });
  for (const key of Object.keys(base)) {
    assert.deepEqual(withFlag[key], base[key], `field ${key} changed`);
  }
  const extraKeys = Object.keys(withFlag).filter((k) => !(k in base));
  assert.deepEqual(extraKeys, ['allowRemote']);
});

test('CF2.9 module exports isLoopbackBaseUrl', () => {
  assert.equal(typeof isLoopbackBaseUrl, 'function');
});
