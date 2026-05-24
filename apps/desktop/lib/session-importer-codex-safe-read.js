/* Phase A.2 — safe-read + atomic-write + double-ancestor-defense for the
   Codex importer. Ported verbatim from Local-Web-Server/tools/import-codex.js
   (commit 4bb2eb3) lines 227–311 (defenses + makeFsDeps) and lines 557–655
   (writeAtomically + readSessionFileSafe). ESM exports → CommonJS.

   Security guarantees preserved:
     - O_RDONLY | O_NOFOLLOW on every read.
     - Post-open dev/ino realpath recheck (TOCTOU defense at read time).
     - Containment under canonical source root.
     - Atomic tmp+rename writes with up to 5 EEXIST retries.
     - DOUBLE ancestor-chain defense (lstat-symlink + realpath-canonical).
     - fsOverrides/makeFsDeps test seam — every fs call is injectable. */

'use strict';

const fs           = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path         = require('node:path');
const crypto       = require('node:crypto');

const { assertSafeInt } = require('./session-importer-codex-utils');

function isPathUnder(child, parent) {
  return child === parent || child.startsWith(parent + path.sep);
}

// Defense A — port of tools/import-claude.js:204-229. Walk every existing
// component from filesystem root through targetPath; lstat each; refuse on
// any symlink. Missing tail components are allowed.
async function validateAncestorChainNoSymlink(targetPath, _fs) {
  const norm = path.resolve(targetPath);
  const chain = [];
  let cur = norm;
  while (true) {
    chain.unshift(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const anc of chain) {
    let lst;
    try {
      lst = await _fs.lstat(anc);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    if (lst.isSymbolicLink()) {
      throw new Error(`output ancestor is a symlink: ${anc}`);
    }
  }
}

// Defense B — realpath every existing ancestor (and the target itself if it
// exists); refuse if any resolves equal to or under forbiddenCodexHome.
// Missing tail components are allowed.
async function validateAncestorChainCanonical(targetPath, forbiddenCodexHome, _fs) {
  const norm = path.resolve(targetPath);
  const chain = [];
  let cur = norm;
  while (true) {
    chain.unshift(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const anc of chain) {
    let real;
    try {
      real = await _fs.realpath(anc);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    if (isPathUnder(real, forbiddenCodexHome)) {
      throw new Error(
        `output path resolves into Codex config tree: ${anc} -> ${real}`,
      );
    }
  }
}

// Narrow fs injection seam used by runImport and readSessionFileSafe so tests
// can stub specific calls and exercise the real production logic.
function makeFsDeps(overrides) {
  const o = overrides || {};
  return {
    lstat: o.lstat || fs.lstat,
    realpath: o.realpath || fs.realpath,
    stat: o.stat || fs.stat,
    mkdir: o.mkdir || fs.mkdir,
    readdir: o.readdir || fs.readdir,
    open: o.open || fs.open,
    rename: o.rename || fs.rename,
    unlink: o.unlink || fs.unlink,
    chmod: o.chmod || fs.chmod,
  };
}

async function writeAtomically(dest, body, _fs) {
  const dir = path.dirname(dest);
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const tmp = path.join(dir, '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
    let fh = null;
    try {
      fh = await _fs.open(tmp, 'wx', 0o600);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        lastErr = err;
        continue;
      }
      throw err;
    }
    try {
      await fh.writeFile(body, 'utf8');
      await fh.close();
      fh = null;
      await _fs.rename(tmp, dest);
      return;
    } catch (err) {
      if (fh) {
        try { await fh.close(); } catch {}
      }
      try { await _fs.unlink(tmp); } catch {}
      throw err;
    }
  }
  const reason = lastErr ? `: ${lastErr.message}` : '';
  throw new Error(`atomic write failed after 5 attempts${reason}`);
}

async function readSessionFileSafe(filePath, canonicalSourceRoot, maxBytes, opts) {
  assertSafeInt('maxBytes', maxBytes, { min: 1, max: Number.MAX_SAFE_INTEGER });
  const _fs = makeFsDeps(opts && opts.fs);
  let fh = null;
  try {
    fh = await _fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const fdStat = await fh.stat();
    if (fdStat.size > maxBytes) {
      const err = new Error(`file exceeds maxBytes after open: ${fdStat.size} > ${maxBytes}`);
      err.code = 'OVER_CAP';
      throw err;
    }
    const realFile = await _fs.realpath(filePath);
    if (
      realFile !== canonicalSourceRoot &&
      !realFile.startsWith(canonicalSourceRoot + path.sep)
    ) {
      throw new Error('file resolves outside source root');
    }
    const pathStat = await _fs.stat(realFile);
    if (fdStat.dev !== pathStat.dev || fdStat.ino !== pathStat.ino) {
      throw new Error('post-open identity mismatch');
    }
    const buf = Buffer.alloc(fdStat.size);
    let total = 0;
    while (total < fdStat.size) {
      const { bytesRead } = await fh.read(buf, total, fdStat.size - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return { buf: buf.subarray(0, total), fdStat };
  } finally {
    if (fh) {
      try { await fh.close(); } catch {}
    }
  }
}

module.exports = {
  isPathUnder,
  validateAncestorChainNoSymlink,
  validateAncestorChainCanonical,
  makeFsDeps,
  writeAtomically,
  readSessionFileSafe,
};
