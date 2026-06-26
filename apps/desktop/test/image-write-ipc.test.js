/* save-image-to-vault IPC resolver — write side (mirrors cm6-lp-image-ipc.test.js).
   Real tmp filesystem; __testHooks for the platform-unsupported case. Every
   failure result must be sanitized (no host filesystem path leaked). */

'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

delete require.cache[require.resolve('../lib/image-write-ipc.js')];
const { saveImageToVault, __testHooks } = require('../lib/image-write-ipc.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const base = { fs, fsConstants: fsSync.constants, crypto, mime: 'image/png' };
const expectedHash = crypto.createHash('sha256').update(PNG).digest('hex').slice(0, 32);

let TMP_ROOT, VAULT;

before(async () => { TMP_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'img-write-')); });
after(async () => { if (TMP_ROOT) { try { await fs.rm(TMP_ROOT, { recursive: true, force: true }); } catch (_e) {} } __testHooks.getONOFOLLOW = null; });

beforeEach(async () => {
  VAULT = path.join(TMP_ROOT, 'vault-' + crypto.randomBytes(4).toString('hex'));
  await fs.mkdir(path.join(VAULT, 'notes'), { recursive: true });
});

const noHostPath = (r) => assert.equal(/\/(Users|tmp|var|private|home)\//.test(JSON.stringify(r)), false, 'result must not leak a host path');

test('happy path: writes ./assets/<hash>.png and the file contains the bytes', async () => {
  const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
  assert.equal(r.ok, true);
  assert.equal(r.relPath, './assets/' + expectedHash + '.png');
  const onDisk = await fs.readFile(path.join(VAULT, 'notes', 'assets', expectedHash + '.png'));
  assert.deepEqual(Buffer.from(onDisk), PNG);
});

test('dedup: same bytes twice -> same relPath, one file', async () => {
  const r1 = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
  const r2 = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
  assert.equal(r1.relPath, r2.relPath);
  assert.equal(r2.ok, true);
  const files = await fs.readdir(path.join(VAULT, 'notes', 'assets'));
  assert.equal(files.length, 1, 'no duplicate file');
});

test('EEXIST with MISMATCHED content is NOT trusted (planted file) -> outside-vault', async () => {
  await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
  // Corrupt the existing file so its content no longer matches the hash name.
  await fs.writeFile(path.join(VAULT, 'notes', 'assets', expectedHash + '.png'), Buffer.from('not the same content'));
  const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outside-vault');
  noHostPath(r);
});

test('noteDir traversal "../escape" is rejected and writes NOTHING outside the vault', async () => {
  const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: '../escape', bytes: PNG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-path');
  noHostPath(r);
  // The escape dir must not have been created.
  assert.equal(fsSync.existsSync(path.join(TMP_ROOT, 'escape')), false);
});

for (const bad of ['/abs/notes', 'notes/\x00x', 'notes/\tx', '..']) {
  test(`unsafe noteDir ${JSON.stringify(bad)} -> invalid-path`, async () => {
    const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: bad, bytes: PNG });
    assert.equal(r.reason, 'invalid-path');
  });
}

test('intermediate note dir that is a symlink outside the vault -> outside-vault, creates NO outside dir', async () => {
  const outside = path.join(TMP_ROOT, 'outside-note-' + crypto.randomBytes(3).toString('hex'));
  await fs.mkdir(outside, { recursive: true });
  await fs.symlink(outside, path.join(VAULT, 'linked')); // vault/linked -> outside (intermediate symlink)
  const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'linked', bytes: PNG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outside-vault');
  noHostPath(r);
  // The note dir must be validated BEFORE mkdir -> nothing created through the symlink.
  assert.equal(fsSync.existsSync(path.join(outside, 'assets')), false, 'no assets dir created outside the vault');
});

test('symlinked assets dir resolving outside the vault -> outside-vault (no write)', async () => {
  const outside = path.join(TMP_ROOT, 'outside-assets-' + crypto.randomBytes(3).toString('hex'));
  await fs.mkdir(outside, { recursive: true });
  await fs.symlink(outside, path.join(VAULT, 'notes', 'assets')); // assets -> outside
  const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outside-vault');
  assert.deepEqual(await fs.readdir(outside), [], 'nothing written through the symlink');
});

test('invalid mime -> invalid-mime', async () => {
  const r = await saveImageToVault({ ...base, mime: 'image/svg+xml', vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
  assert.equal(r.reason, 'invalid-mime');
});

test('empty / non-bytes -> invalid-bytes', async () => {
  assert.equal((await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: Buffer.alloc(0) })).reason, 'invalid-bytes');
  assert.equal((await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: 'nope' })).reason, 'invalid-bytes');
});

test('over the size cap -> too-large', async () => {
  const big = Buffer.alloc(20 * 1024 * 1024 + 1);
  const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: big });
  assert.equal(r.reason, 'too-large');
});

test('no vault -> no-vault', async () => {
  const r = await saveImageToVault({ ...base, vaultPath: '', noteDirRel: 'notes', bytes: PNG });
  assert.equal(r.reason, 'no-vault');
});

test('accepts a Uint8Array (IPC structured-clone shape)', async () => {
  const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: new Uint8Array(PNG) });
  assert.equal(r.ok, true);
});

test('platform without O_NOFOLLOW -> platform-unsupported', async () => {
  __testHooks.getONOFOLLOW = () => undefined;
  try {
    const r = await saveImageToVault({ ...base, vaultPath: VAULT, noteDirRel: 'notes', bytes: PNG });
    assert.equal(r.reason, 'platform-unsupported');
  } finally { __testHooks.getONOFOLLOW = null; }
});
