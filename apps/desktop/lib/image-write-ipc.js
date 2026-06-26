'use strict';

/* save-image-to-vault IPC handler core (write side; mirrors image-path-ipc.js).

   Pure async `saveImageToVault({ vaultPath, noteDirRel, bytes, mime, fs, fsConstants, crypto })`
   writes a pasted/dropped image blob into `<vault>/<noteDir>/assets/<sha256-prefix>.<ext>`
   and returns a typed result:

     { ok: true,  relPath: './assets/<hash>.<ext>' }   // relative to the note dir
     { ok: false, reason: <code> }

   reason ∈ { no-vault, invalid-path, invalid-mime, invalid-bytes, too-large,
              outside-vault, write-failed, platform-unsupported, resolution-failed }

   Threat model: local single-user app; the vault is the user's own dir. Node has
   no openat(), so full TOCTOU symlink-race prevention isn't achievable; we match
   the read side (O_NOFOLLOW + O_EXCL + realpath containment + post-write dev/ino
   identity) and scope OUT an attacker with concurrent local-FS write access to the
   vault (who could corrupt it directly anyway). The hardened goal: a malicious
   RENDERER payload (traversal noteDir, planted/partial file, bad mime, oversized
   bytes) cannot write outside the vault or be trusted for dedup.

   Filenames are content hashes → dedup. On EEXIST the existing file is re-hashed
   and must match exactly before it is reused; a partial/planted file is rejected.
   `err.message` is never returned — only the typed reason. */

const path = require('node:path');

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MAX_BYTES = 20 * 1024 * 1024;

// Test hook (mirrors image-path-ipc / safe-read).
const __testHooks = { getONOFOLLOW: null };

function noteDirIsUnsafe(noteDirRel) {
  if (typeof noteDirRel !== 'string') return true;
  if (noteDirRel.indexOf('\x00') !== -1) return true;
  for (let i = 0; i < noteDirRel.length; i++) {
    if (noteDirRel.charCodeAt(i) < 32) return true; // control chars
  }
  if (path.isAbsolute(noteDirRel)) return true;
  const segs = noteDirRel.split(/[\\/]+/);
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === '..') return true; // no traversal segment
  }
  return false;
}

function inside(child, root, sep) {
  return child === root || child.startsWith(root + sep);
}

async function safeUnlink(fs, target) {
  try { await fs.unlink(target); } catch (_e) { /* best-effort */ }
}

async function readAndHash(fh, size, crypto) {
  const buf = Buffer.alloc(size);
  let total = 0;
  while (total < size) {
    const { bytesRead } = await fh.read(buf, total, size - total, total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return { hash: crypto.createHash('sha256').update(buf.subarray(0, total)).digest('hex'), read: total };
}

// EEXIST path: the filename is the content hash, so the existing file SHOULD match
// — but verify (a planted or partial file must not be trusted for dedup).
async function reuseIfMatches(args) {
  const { fs, fsConstants, oNoFollow, target, vaultReal, sep, hash, expectedSize, relPath, crypto } = args;
  let fh = null;
  try {
    fh = await fs.open(target, fsConstants.O_RDONLY | oNoFollow);
    const fdStat = await fh.stat();
    if (!fdStat.isFile() || fdStat.size !== expectedSize) { await fh.close(); return { ok: false, reason: 'outside-vault' }; }
    const realFile = await fs.realpath(target);
    if (!inside(realFile, vaultReal, sep)) { await fh.close(); return { ok: false, reason: 'outside-vault' }; }
    const { hash: existingHash } = await readAndHash(fh, fdStat.size, crypto);
    await fh.close(); fh = null;
    if (existingHash !== hash) return { ok: false, reason: 'outside-vault' };
    return { ok: true, relPath: relPath };
  } catch (_e) {
    if (fh) { try { await fh.close(); } catch (_) { /* swallow */ } }
    return { ok: false, reason: 'write-failed' };
  }
}

async function saveImageToVault(opts) {
  const o = opts || {};
  const fs = o.fs;
  const fsConstants = o.fsConstants;
  const crypto = o.crypto;

  if (!fs || !fsConstants || !crypto || typeof fs.open !== 'function') {
    return { ok: false, reason: 'resolution-failed' };
  }
  if (!o.vaultPath || typeof o.vaultPath !== 'string') return { ok: false, reason: 'no-vault' };

  const ext = MIME_TO_EXT[o.mime];
  if (!ext) return { ok: false, reason: 'invalid-mime' };

  const bytes = o.bytes;
  const isBytes = Buffer.isBuffer(bytes) || (bytes && ArrayBuffer.isView(bytes));
  if (!isBytes) return { ok: false, reason: 'invalid-bytes' };
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
  if (buf.length === 0) return { ok: false, reason: 'invalid-bytes' };
  if (buf.length > MAX_BYTES) return { ok: false, reason: 'too-large' };

  const oNoFollow = (typeof __testHooks.getONOFOLLOW === 'function')
    ? __testHooks.getONOFOLLOW()
    : fsConstants.O_NOFOLLOW;
  if (oNoFollow === undefined || oNoFollow === null) return { ok: false, reason: 'platform-unsupported' };

  if (noteDirIsUnsafe(o.noteDirRel)) return { ok: false, reason: 'invalid-path' };

  const sep = path.sep;
  let vaultReal;
  try { vaultReal = await fs.realpath(o.vaultPath); } catch (_e) { return { ok: false, reason: 'no-vault' }; }

  // Lexical containment of the note dir (catches `..`) BEFORE touching the fs.
  const noteDirLexical = path.resolve(vaultReal, o.noteDirRel);
  if (!inside(noteDirLexical, vaultReal, sep)) return { ok: false, reason: 'outside-vault' };

  // Realpath the EXISTING note dir and verify it is inside the vault BEFORE creating
  // anything — otherwise a `mkdir -p` could FOLLOW an intermediate symlink and create
  // `assets` outside the vault before the post-hoc realpath check could detect it.
  let noteDirReal;
  try { noteDirReal = await fs.realpath(noteDirLexical); } catch (_e) { return { ok: false, reason: 'write-failed' }; }
  if (!inside(noteDirReal, vaultReal, sep)) return { ok: false, reason: 'outside-vault' };

  // Create ONLY the final `assets` component (non-recursive) under the validated real
  // parent, so mkdir never traverses/creates an intermediate symlinked directory.
  const assetsDir = path.join(noteDirReal, 'assets');
  try { await fs.mkdir(assetsDir); } catch (e) { if (!e || e.code !== 'EEXIST') return { ok: false, reason: 'write-failed' }; }

  let assetsReal;
  try { assetsReal = await fs.realpath(assetsDir); } catch (_e) { return { ok: false, reason: 'write-failed' }; }
  if (!inside(assetsReal, vaultReal, sep)) return { ok: false, reason: 'outside-vault' };

  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const name = hash.slice(0, 32) + '.' + ext;
  const target = path.join(assetsReal, name);
  const relPath = './assets/' + name;

  let fh = null;
  try {
    fh = await fs.open(target, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | oNoFollow);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      return reuseIfMatches({ fs, fsConstants, oNoFollow, target, vaultReal, sep, hash, expectedSize: buf.length, relPath, crypto });
    }
    return { ok: false, reason: 'write-failed' };
  }

  try {
    let total = 0;
    while (total < buf.length) {
      const { bytesWritten } = await fh.write(buf, total, buf.length - total, total);
      if (bytesWritten === 0) break;
      total += bytesWritten;
    }
    if (total !== buf.length) throw new Error('short-write');
    const fdStat = await fh.stat();
    if (!fdStat.isFile()) throw new Error('not-a-file');
    await fh.close(); fh = null;

    const realFile = await fs.realpath(target);
    if (!inside(realFile, vaultReal, sep)) { await safeUnlink(fs, target); return { ok: false, reason: 'outside-vault' }; }
    const pathStat = await fs.stat(realFile);
    if (fdStat.dev !== pathStat.dev || fdStat.ino !== pathStat.ino) { await safeUnlink(fs, target); return { ok: false, reason: 'write-failed' }; }
    return { ok: true, relPath: relPath };
  } catch (_e) {
    if (fh) { try { await fh.close(); } catch (_) { /* swallow */ } }
    await safeUnlink(fs, target);
    return { ok: false, reason: 'write-failed' };
  }
}

module.exports = { saveImageToVault: saveImageToVault, __testHooks: __testHooks, MIME_TO_EXT: MIME_TO_EXT, MAX_BYTES: MAX_BYTES };
