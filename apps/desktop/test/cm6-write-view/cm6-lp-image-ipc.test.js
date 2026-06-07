/* Stage C WAVE 3 — `resolve-image-path` IPC handler.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-image-ipc.test.js

   Tests use a real tmp filesystem (no jsdom; no mocks for fs ops). Each
   test sets up a tmp vault dir + a sub-note dir + an asset file, calls
   resolveImagePath with various inputs, and verifies the typed reason
   code OR the file:// URL result.

   Sanitization is asserted on EVERY failure case: JSON-serializing the
   result must not contain any host filesystem path (no `/Users/...` or
   `/tmp/...` leakage). The renderer only sees the typed reason. */

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');

delete require.cache[require.resolve('../../lib/image-path-ipc.js')];
const { resolveImagePath, __testHooks } = require('../../lib/image-path-ipc.js');

// Real fs surface for tests. The handler in main.js will use the same.
const fsOpts = {
  fs: fs,
  fsConstants: fsSync.constants,
};

// ── Test fixture: tmp vault with assets/, sub-note/, etc. ────────────────

let TMP_ROOT;
let VAULT;
let NOTE_DIR;
let ASSET_FILE;
let ASSET_DIR;
let OUTSIDE_FILE;

before(async () => {
  TMP_ROOT  = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-img-ipc-'));
  VAULT     = path.join(TMP_ROOT, 'vault');
  NOTE_DIR  = path.join(VAULT, 'notes');
  ASSET_DIR = path.join(VAULT, 'assets');
  await fs.mkdir(NOTE_DIR,  { recursive: true });
  await fs.mkdir(ASSET_DIR, { recursive: true });
  ASSET_FILE = path.join(ASSET_DIR, 'foo.png');
  await fs.writeFile(ASSET_FILE, Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG magic
  OUTSIDE_FILE = path.join(TMP_ROOT, 'outside.png');
  await fs.writeFile(OUTSIDE_FILE, Buffer.from([0x89, 0x50, 0x4E, 0x47]));
});

after(async () => {
  if (TMP_ROOT) {
    try { await fs.rm(TMP_ROOT, { recursive: true, force: true }); }
    catch (_err) { /* swallow */ }
  }
  __testHooks.getONOFOLLOW = null;
});

// Helper: assert the JSON-stringified result leaks no host path segments.
function assertNoPathLeak(result) {
  const json = JSON.stringify(result);
  assert.ok(!json.includes('/Users/'), 'result must not leak /Users/ paths: ' + json);
  assert.ok(!json.includes('/tmp/'),   'result must not leak /tmp/ paths: '   + json);
  assert.ok(!json.includes('/private/'), 'result must not leak /private/ paths: ' + json);
  // err.message is never serialized.
  assert.equal(result.error, undefined, 'result must not contain `error` field');
}

// ── AC-IPC-1: no vault ──────────────────────────────────────────────────

test('Stage C WAVE 3-T-IPC-1: noteDir null returns no-vault', async () => {
  const r = await resolveImagePath(null, 'foo.png', { ...fsOpts, vaultPath: VAULT });
  assert.deepEqual(r, { ok: false, reason: 'no-vault' });
  assertNoPathLeak(r);
});

test('Stage C WAVE 3-T-IPC-1b: vaultPath missing returns no-vault', async () => {
  const r = await resolveImagePath(NOTE_DIR, 'foo.png', { ...fsOpts, vaultPath: null });
  assert.deepEqual(r, { ok: false, reason: 'no-vault' });
  assertNoPathLeak(r);
});

// ── AC-IPC-2: invalid path ──────────────────────────────────────────────

test('Stage C WAVE 3-T-IPC-2a: empty relPath returns invalid-path', async () => {
  const r = await resolveImagePath(NOTE_DIR, '', { ...fsOpts, vaultPath: VAULT });
  assert.deepEqual(r, { ok: false, reason: 'invalid-path' });
  assertNoPathLeak(r);
});

test('Stage C WAVE 3-T-IPC-2b: null-byte in relPath returns invalid-path', async () => {
  const r = await resolveImagePath(NOTE_DIR, 'foo\x00bar.png', { ...fsOpts, vaultPath: VAULT });
  assert.deepEqual(r, { ok: false, reason: 'invalid-path' });
  assertNoPathLeak(r);
});

test('Stage C WAVE 3-T-IPC-2c: absolute relPath returns invalid-path', async () => {
  const r = await resolveImagePath(NOTE_DIR, '/etc/passwd', { ...fsOpts, vaultPath: VAULT });
  assert.deepEqual(r, { ok: false, reason: 'invalid-path' });
  assertNoPathLeak(r);
});

// ── AC-IPC-3: outside vault ─────────────────────────────────────────────

test('Stage C WAVE 3-T-IPC-3: ../../escape.png resolves outside vault → outside-vault', async () => {
  // From NOTE_DIR (vault/notes), `../../outside.png` resolves to TMP_ROOT/outside.png
  // which is OUTSIDE the vault.
  const r = await resolveImagePath(NOTE_DIR, '../../outside.png', { ...fsOpts, vaultPath: VAULT });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outside-vault');
  assertNoPathLeak(r);
});

// ── AC-IPC-4: not a file (directory) ────────────────────────────────────

test('Stage C WAVE 3-T-IPC-4: resolved path is a directory → not-a-file', async () => {
  const r = await resolveImagePath(NOTE_DIR, '../assets', { ...fsOpts, vaultPath: VAULT });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-a-file');
  assertNoPathLeak(r);
});

// ── AC-IPC-5: platform-unsupported ──────────────────────────────────────

test('Stage C WAVE 3-T-IPC-5: O_NOFOLLOW unavailable → platform-unsupported', async () => {
  __testHooks.getONOFOLLOW = () => undefined;
  try {
    const r = await resolveImagePath(NOTE_DIR, '../assets/foo.png', { ...fsOpts, vaultPath: VAULT });
    assert.deepEqual(r, { ok: false, reason: 'platform-unsupported' });
    assertNoPathLeak(r);
  } finally {
    __testHooks.getONOFOLLOW = null;
  }
});

// ── AC-IPC-6: unexpected fs error → resolution-failed ───────────────────

test('Stage C WAVE 3-T-IPC-6: missing file → resolution-failed', async () => {
  const r = await resolveImagePath(NOTE_DIR, '../assets/missing.png', { ...fsOpts, vaultPath: VAULT });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'resolution-failed');
  assertNoPathLeak(r);
});

// ── AC-IPC-7: valid in-vault file → ok ──────────────────────────────────

test('Stage C WAVE 3-T-IPC-7: valid in-vault file → ok with file:// URL', async () => {
  const r = await resolveImagePath(NOTE_DIR, '../assets/foo.png', { ...fsOpts, vaultPath: VAULT });
  assert.equal(r.ok, true);
  assert.ok(r.fileUrl, 'fileUrl present');
  assert.ok(r.fileUrl.startsWith('file://'), 'fileUrl starts with file://');
  // The URL ends with the realpath segment of /assets/foo.png — verify
  // structurally without leaking host path into the assertion message.
  assert.ok(r.fileUrl.endsWith('/assets/foo.png'), 'fileUrl ends with /assets/foo.png');
});

test('Stage C WAVE 3-T-IPC-7b: ./relative-to-vault works', async () => {
  // From vault root (use VAULT as noteDir for this synthetic test), resolve `./assets/foo.png`.
  const r = await resolveImagePath(VAULT, './assets/foo.png', { ...fsOpts, vaultPath: VAULT });
  assert.equal(r.ok, true);
  assert.ok(r.fileUrl.endsWith('/assets/foo.png'));
});

// ── AC-IPC-9: vault realpath (macOS /tmp ⇒ /private/tmp) ────────────────

test('Stage C WAVE 3-T-IPC-9: vault path realpathed for containment check (macOS /tmp ⇒ /private/tmp)', async () => {
  // On macOS, /tmp is a symlink to /private/tmp; without realpathing the
  // vault path, the containment check would compare a realpath'd file
  // (in /private/tmp/...) against a non-realpath'd vault (/tmp/...) and
  // incorrectly fail. This test passes a /tmp-prefixed vault path and
  // verifies the resolver succeeds.
  if (!VAULT.startsWith('/var/folders/') && !VAULT.startsWith('/tmp/')) {
    // On non-macOS or if mkdtemp returned a different root, skip
    // the macOS-specific assertion. Test still useful as a regression
    // guard wherever VAULT is symlinkable.
    return;
  }
  const r = await resolveImagePath(NOTE_DIR, '../assets/foo.png', { ...fsOpts, vaultPath: VAULT });
  assert.equal(r.ok, true,
    'vault path must be realpathed before containment check');
});

// ── Sanitization sweep ─────────────────────────────────────────────────

test('Stage C WAVE 3-T-IPC-8: sanitization — every failure case has no path leak + no `error` field', async () => {
  const failures = [
    [null,    'foo.png',       { ...fsOpts, vaultPath: VAULT },  'no-vault'],
    [NOTE_DIR, null,           { ...fsOpts, vaultPath: VAULT },  'invalid-path'],
    [NOTE_DIR, '/etc/passwd',  { ...fsOpts, vaultPath: VAULT },  'invalid-path'],
    [NOTE_DIR, '../../outside.png', { ...fsOpts, vaultPath: VAULT }, 'outside-vault'],
    [NOTE_DIR, '../assets',    { ...fsOpts, vaultPath: VAULT },  'not-a-file'],
    [NOTE_DIR, '../assets/missing.png', { ...fsOpts, vaultPath: VAULT }, 'resolution-failed'],
  ];
  for (const [nd, rp, o, expectedReason] of failures) {
    const r = await resolveImagePath(nd, rp, o);
    assertNoPathLeak(r);
    assert.equal(r.ok, false);
    assert.equal(r.reason, expectedReason, 'reason for input ' + JSON.stringify({nd, rp}));
  }
});
