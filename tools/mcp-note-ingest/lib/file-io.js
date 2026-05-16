const crypto = require('crypto');
const defaultFs = require('fs');

function sha256OfBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256OfFile(absPath, { fs = defaultFs } = {}) {
  const buf = fs.readFileSync(absPath);
  return sha256OfBuffer(buf);
}

// atomicWriteFileSync writes `contents` to `absPath` via a temp file + fsync + rename.
// `verifyBeforeRename(absPath)` (if provided) is invoked between fsync and rename and
// may throw to abort the swap (e.g., optimistic-concurrency guard). The tmp file is
// always cleaned up on any failure between openSync and a successful renameSync.
//
// Concurrency note: this is best-effort against *external* concurrent writers. The
// verify-then-rename pair is not a single syscall, so a writer that lands in the
// microsecond window between the verifier and rename can still be overwritten. For
// sequential calls inside a single MCP server process this is race-free; for full
// cross-process atomicity an OS-level file lock (flock) would be required, which is
// out of scope for the current zero-dependency tool.
function atomicWriteFileSync(absPath, contents, { fs = defaultFs, verifyBeforeRename } = {}) {
  const tmpPath = absPath + '.tmp-' + crypto.randomBytes(6).toString('hex');
  const data = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), 'utf8');
  let committed = false;

  // Preserve the existing file's permission bits when overwriting an existing target;
  // fall back to 0o644 when the target does not exist yet.
  let mode = 0o644;
  try {
    const targetStat = fs.statSync(absPath);
    if (targetStat && typeof targetStat.mode === 'number') {
      mode = targetStat.mode & 0o777;
    }
  } catch { /* new file or unreadable parent — use default */ }

  function cleanup() {
    if (committed) return;
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  let fd;
  try {
    fd = fs.openSync(tmpPath, 'wx', mode);
    try {
      let written = 0;
      while (written < data.length) {
        const n = fs.writeSync(fd, data, written, data.length - written);
        if (typeof n !== 'number' || n <= 0) {
          throw new Error('atomicWriteFileSync: writeSync returned non-positive byte count');
        }
        written += n;
      }
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    if (typeof verifyBeforeRename === 'function') {
      verifyBeforeRename(absPath);
    }
    fs.renameSync(tmpPath, absPath);
    committed = true;
  } finally {
    cleanup();
  }
}

module.exports = { sha256OfBuffer, sha256OfFile, atomicWriteFileSync };
