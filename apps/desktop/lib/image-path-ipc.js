'use strict';

/* Stage C — `resolve-image-path` IPC handler core.

   Pure function `resolveImagePath(noteDir, relPath, opts)` validates a
   vault-relative image path and returns a typed reason-code result:

     {ok: true,  fileUrl: 'file://...'}      — safe to render as <img>
     {ok: false, reason: <code>}             — reject; do not render

   reason ∈ {
     'no-vault'              vault not selected (noteDir/vaultPath missing)
     'invalid-path'          empty path, null byte, or absolute path
     'outside-vault'         resolves outside the vault root
     'not-a-file'            resolves to a directory or non-regular file
     'platform-unsupported'  O_NOFOLLOW unavailable on this platform
     'resolution-failed'     unexpected fs error (ENOENT, EACCES, ...)
   }

   Security pattern mirrors tools/session-import/lib/safe-read.mjs:
     1. Validate inputs syntactically (path shape).
     2. Resolve via path.resolve(noteDir, relPath).
     3. Open with O_NOFOLLOW so the LAST path component cannot be a symlink.
     4. fdStat to verify regular file (not directory).
     5. realpath(resolved) to canonicalize intermediate symlinks.
     6. realpath(vaultPath) so the containment check survives macOS /tmp ⇒
        /private/tmp realpath quirks.
     7. Assert realFile is inside vaultReal (or equals it).
     8. Identity-match fdStat dev/ino against stat(realFile) for TOCTOU
        defense between open and realpath.
     9. Close fd. Return file:// URL of realFile.

   `err.message` is dropped at every reject path — the typed reason code
   is the ONLY information returned to the renderer (Retrofit #1 pattern).

   Tests inject opts.fs (the node:fs/promises surface) and opts.fsConstants
   (node:fs constants) so the test can exercise the platform-unsupported
   branch and arrange tmp filesystems without coupling to global fs. */

const path = require('node:path');

// Test hooks. Same shape as safe-read.mjs.__testHooks. Tests assign to
// these to simulate platform-unsupported or to inject fs errors at known
// pivot points.
const __testHooks = {
  getONOFOLLOW: null, // optional override; defaults to opts.fsConstants.O_NOFOLLOW
};

async function resolveImagePath(noteDir, relPath, opts) {
  const o = opts || {};
  const fs = o.fs;
  const fsConstants = o.fsConstants;
  const vaultPath = o.vaultPath;

  if (!fs || !fsConstants || typeof fs.open !== 'function') {
    // Caller didn't supply the fs surface — this only happens in tests
    // that misuse the function. Return a clean reject; do not leak.
    return { ok: false, reason: 'resolution-failed' };
  }

  // ── 1. Vault presence ────────────────────────────────────────────────
  if (!vaultPath || typeof vaultPath !== 'string' || vaultPath.length === 0) {
    return { ok: false, reason: 'no-vault' };
  }
  if (!noteDir || typeof noteDir !== 'string' || noteDir.length === 0) {
    return { ok: false, reason: 'no-vault' };
  }

  // ── 2. Path shape validation ─────────────────────────────────────────
  if (relPath == null || typeof relPath !== 'string' || relPath.length === 0) {
    return { ok: false, reason: 'invalid-path' };
  }
  if (relPath.indexOf('\x00') !== -1) {
    return { ok: false, reason: 'invalid-path' };
  }
  // Reject absolute paths (POSIX). Project is macOS-focused per README.
  if (path.isAbsolute(relPath)) {
    return { ok: false, reason: 'invalid-path' };
  }

  // ── 3. O_NOFOLLOW availability ───────────────────────────────────────
  const oNoFollow =
    typeof __testHooks.getONOFOLLOW === 'function'
      ? __testHooks.getONOFOLLOW()
      : fsConstants.O_NOFOLLOW;
  if (oNoFollow === undefined || oNoFollow === null) {
    return { ok: false, reason: 'platform-unsupported' };
  }

  // ── 4. Resolve path against noteDir ──────────────────────────────────
  let resolved;
  try {
    resolved = path.resolve(noteDir, relPath);
  } catch (_err) {
    return { ok: false, reason: 'resolution-failed' };
  }

  // ── 5. Realpath the vault (catches macOS /tmp ⇒ /private/tmp) ────────
  let vaultReal;
  try {
    vaultReal = await fs.realpath(vaultPath);
  } catch (_err) {
    return { ok: false, reason: 'no-vault' };
  }

  // ── 6. Open with O_NOFOLLOW ──────────────────────────────────────────
  let fh = null;
  try {
    fh = await fs.open(resolved, fsConstants.O_RDONLY | oNoFollow);

    // 7. Stat via fd. Reject non-regular files (directories, devices, etc).
    const fdStat = await fh.stat();
    if (!fdStat.isFile()) {
      await fh.close();
      return { ok: false, reason: 'not-a-file' };
    }

    // 8. Realpath the resolved path to canonicalize intermediate
    //    symlinks; verify containment.
    let realFile;
    try {
      realFile = await fs.realpath(resolved);
    } catch (_err) {
      await fh.close();
      return { ok: false, reason: 'resolution-failed' };
    }
    const isInsideVault =
      realFile === vaultReal || realFile.startsWith(vaultReal + path.sep);
    if (!isInsideVault) {
      await fh.close();
      return { ok: false, reason: 'outside-vault' };
    }

    // 9. Post-open identity check (TOCTOU defense). The fd's dev/ino
    //    must match the realpath'd file's dev/ino. If not, something
    //    swapped the file between open() and realpath().
    let pathStat;
    try {
      pathStat = await fs.stat(realFile);
    } catch (_err) {
      await fh.close();
      return { ok: false, reason: 'resolution-failed' };
    }
    if (fdStat.dev !== pathStat.dev || fdStat.ino !== pathStat.ino) {
      await fh.close();
      return { ok: false, reason: 'resolution-failed' };
    }

    await fh.close();
    // 10. Return file:// URL of the canonical (realpath) path.
    return { ok: true, fileUrl: 'file://' + encodeURI(realFile) };
  } catch (err) {
    if (fh) {
      try { await fh.close(); } catch (_) { /* swallow */ }
    }
    // The open() can fail with ELOOP for symlinks (O_NOFOLLOW), ENOENT
    // for missing files, EACCES for permission, EISDIR for some
    // directories. All are treated as resolution-failed except ELOOP
    // which we also treat as resolution-failed (the symlink path itself
    // is the last component; treating it as failure is the right call
    // because we can't safely render its target without following).
    return { ok: false, reason: 'resolution-failed' };
  }
}

module.exports = {
  resolveImagePath: resolveImagePath,
  __testHooks: __testHooks,
};
