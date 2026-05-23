/* Phase A — safe-read + atomic-write helpers for the Claude importer.
   Ported verbatim from Local-Web-Server/tools/import-claude.js (lines
   219–332). ESM → CommonJS. Security guarantees preserved:
     - O_RDONLY | O_NOFOLLOW on every read
     - post-open dev/ino realpath recheck
     - containment under canonical source root
     - bounded read using fdStat.size
     - atomic tmp+rename writes with EEXIST retry (up to 5 attempts) */

'use strict';

const fs           = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path         = require('node:path');
const crypto       = require('node:crypto');

const { assertSafeInt } = require('./session-importer-claude-utils');

async function validateAncestorChain(targetPath) {
  // Walk from root down to targetPath. lstat every existing component;
  // refuse if any is a symlink. Intermediate-component symlinks would be
  // invisible to a single lstat on a deeper descendant, so each component
  // must be checked explicitly.
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
      lst = await fs.lstat(anc);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    if (lst.isSymbolicLink()) {
      throw new Error(`output ancestor is a symlink: ${anc}`);
    }
  }
}

async function writeAtomically(dest, body) {
  const dir = path.dirname(dest);
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const tmp = path.join(dir, '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
    let fh = null;
    try {
      fh = await fs.open(tmp, 'wx', 0o600);
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
      await fs.rename(tmp, dest);
      return;
    } catch (err) {
      if (fh) {
        try {
          await fh.close();
        } catch {}
      }
      try {
        await fs.unlink(tmp);
      } catch {}
      throw err;
    }
  }
  const reason = lastErr ? `: ${lastErr.message}` : '';
  throw new Error(`atomic write failed after 5 attempts${reason}`);
}

async function readSessionFileSafe(filePath, canonicalSourceRoot, maxBytes) {
  assertSafeInt('maxBytes', maxBytes, { min: 1, max: Number.MAX_SAFE_INTEGER });
  let fh = null;
  try {
    fh = await fs.open(
      filePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const fdStat = await fh.stat();
    if (fdStat.size > maxBytes) {
      const err = new Error(
        `file exceeds maxBytes after open: ${fdStat.size} > ${maxBytes}`,
      );
      err.code = 'OVER_CAP';
      throw err;
    }
    const realFile = await fs.realpath(filePath);
    if (
      realFile !== canonicalSourceRoot &&
      !realFile.startsWith(canonicalSourceRoot + path.sep)
    ) {
      throw new Error('file resolves outside source root');
    }
    const pathStat = await fs.stat(realFile);
    if (fdStat.dev !== pathStat.dev || fdStat.ino !== pathStat.ino) {
      throw new Error('post-open identity mismatch');
    }
    // Bounded read: read at most fdStat.size bytes from the opened handle.
    const buf = Buffer.alloc(fdStat.size);
    let total = 0;
    while (total < fdStat.size) {
      const { bytesRead } = await fh.read(
        buf,
        total,
        fdStat.size - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return { buf: buf.subarray(0, total), fdStat };
  } finally {
    if (fh) {
      try {
        await fh.close();
      } catch {}
    }
  }
}

module.exports = {
  validateAncestorChain,
  writeAtomically,
  readSessionFileSafe,
};
