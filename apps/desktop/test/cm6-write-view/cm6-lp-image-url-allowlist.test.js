/* Stage C WAVE 1 — URL allowlist pure function.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-image-url-allowlist.test.js

   `isSafeImageUrl(url)` returns:
     - {safe: true, kind: 'https'|'data'|'vault-relative'}  for allowed URLs
     - {safe: false, reason: <code>}                         for disallowed URLs

   Allowed:
     - https: scheme
     - data:image/<mime> with mime in the image-MIME allowlist
     - vault-relative paths (no scheme, not absolute, not empty, no null byte)

   Disallowed:
     - http:, javascript:, file:, chrome-extension:, blob:, mailto:, tel:, any other scheme
     - data: with non-image MIME (text/html, application/json, etc.)
     - absolute paths (start with `/`)
     - empty string
     - strings containing null bytes */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

delete require.cache[require.resolve('../../lib/cm6-lp-image-widget.js')];
const { isSafeImageUrl } = require('../../lib/cm6-lp-image-widget.js');

// ── Allowed ──────────────────────────────────────────────────────────────

test('Stage C WAVE 1-T-URL-1: https URL is safe (kind: https)', () => {
  assert.deepEqual(isSafeImageUrl('https://example.com/x.png'), { safe: true, kind: 'https' });
});

test('Stage C WAVE 1-T-URL-1b: HTTPS uppercase scheme is safe (case-insensitive)', () => {
  assert.deepEqual(isSafeImageUrl('HTTPS://example.com/x.png'), { safe: true, kind: 'https' });
});

test('Stage C WAVE 1-T-URL-3: data:image/png is safe (kind: data)', () => {
  assert.deepEqual(isSafeImageUrl('data:image/png;base64,iVBORw0KGgo'), { safe: true, kind: 'data' });
});

test('Stage C WAVE 1-T-URL-3b: data:image/svg+xml is safe', () => {
  assert.deepEqual(isSafeImageUrl('data:image/svg+xml;charset=utf-8,<svg></svg>'), { safe: true, kind: 'data' });
});

test('Stage C WAVE 1-T-URL-3c: data:image/jpeg is safe', () => {
  assert.deepEqual(isSafeImageUrl('data:image/jpeg;base64,xxx'), { safe: true, kind: 'data' });
});

test('Stage C WAVE 1-T-URL-3d: data:image/webp is safe', () => {
  assert.deepEqual(isSafeImageUrl('data:image/webp;base64,xxx'), { safe: true, kind: 'data' });
});

test('Stage C WAVE 1-T-URL-6: vault-relative ./assets/foo.png is safe (kind: vault-relative)', () => {
  assert.deepEqual(isSafeImageUrl('./assets/foo.png'), { safe: true, kind: 'vault-relative' });
});

test('Stage C WAVE 1-T-URL-7: vault-relative assets/foo.png is safe', () => {
  assert.deepEqual(isSafeImageUrl('assets/foo.png'), { safe: true, kind: 'vault-relative' });
});

test('Stage C WAVE 1-T-URL-7b: vault-relative ../sibling/foo.png is safe at allowlist level (containment enforced at IPC layer)', () => {
  // The pure allowlist accepts `..` traversal in syntax; the IPC handler's
  // realpath containment check is what actually rejects out-of-vault paths.
  assert.deepEqual(isSafeImageUrl('../sibling/foo.png'), { safe: true, kind: 'vault-relative' });
});

// ── Disallowed schemes ───────────────────────────────────────────────────

test('Stage C WAVE 1-T-URL-2: http URL is unsafe (scheme-not-allowed)', () => {
  assert.deepEqual(isSafeImageUrl('http://example.com/x.png'), { safe: false, reason: 'scheme-not-allowed' });
});

test('Stage C WAVE 1-T-URL-5: javascript: URL is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('javascript:alert(1)'), { safe: false, reason: 'scheme-not-allowed' });
});

test('Stage C WAVE 1-T-URL-5b: file: URL is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('file:///etc/passwd'), { safe: false, reason: 'scheme-not-allowed' });
});

test('Stage C WAVE 1-T-URL-5c: chrome-extension: URL is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('chrome-extension://abc/x.png'), { safe: false, reason: 'scheme-not-allowed' });
});

test('Stage C WAVE 1-T-URL-5d: blob: URL is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('blob:https://x.test/abc'), { safe: false, reason: 'scheme-not-allowed' });
});

test('Stage C WAVE 1-T-URL-5e: mailto: URL is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('mailto:foo@bar'), { safe: false, reason: 'scheme-not-allowed' });
});

// ── data: rejected MIME types ────────────────────────────────────────────

test('Stage C WAVE 1-T-URL-4: data:text/html is unsafe (data-mime-not-allowed)', () => {
  assert.deepEqual(isSafeImageUrl('data:text/html,<script>'), { safe: false, reason: 'data-mime-not-allowed' });
});

test('Stage C WAVE 1-T-URL-4b: data:application/json is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('data:application/json,{}'), { safe: false, reason: 'data-mime-not-allowed' });
});

test('Stage C WAVE 1-T-URL-4c: data:image/X where X is not in the allowlist is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('data:image/exotic-format,xxx'), { safe: false, reason: 'data-mime-not-allowed' });
});

test('Stage C WAVE 1-T-URL-4d: bare data: with no MIME is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('data:'), { safe: false, reason: 'data-mime-not-allowed' });
});

// ── Path-shape rejections ────────────────────────────────────────────────

test('Stage C WAVE 1-T-URL-8: absolute path /etc/passwd is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('/etc/passwd'), { safe: false, reason: 'absolute-path-not-allowed' });
});

test('Stage C WAVE 1-T-URL-9: empty string is unsafe', () => {
  assert.deepEqual(isSafeImageUrl(''), { safe: false, reason: 'empty-url' });
});

test('Stage C WAVE 1-T-URL-9b: null is unsafe', () => {
  assert.deepEqual(isSafeImageUrl(null), { safe: false, reason: 'empty-url' });
});

test('Stage C WAVE 1-T-URL-9c: undefined is unsafe', () => {
  assert.deepEqual(isSafeImageUrl(undefined), { safe: false, reason: 'empty-url' });
});

test('Stage C WAVE 1-T-URL-10: null-byte in path is unsafe', () => {
  assert.deepEqual(isSafeImageUrl('foo\x00bar'), { safe: false, reason: 'invalid-path' });
});

test('Stage C WAVE 1-T-URL-10b: null-byte in https URL is also unsafe', () => {
  assert.deepEqual(isSafeImageUrl('https://example.com/x\x00.png'), { safe: false, reason: 'invalid-path' });
});
