'use strict';
// Test-only ownership handle. Never adopts old fixtures or scans Home by prefix.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const prefixes = new Set(['Markdown-Persistent-Test-V1-', 'Markdown-Persistent-Test-E2E-', 'Writing-synthetic-', 'Writing-synthetic-E2E-']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = s => [s.dev, s.ino, s.uid, s.gid, s.mode].join(':');
const requireThat = (condition, reason) => { if (!condition) throw Error(reason); };
function createHomeFixture(prefix, { parent = os.homedir(), cleanupParent = os.tmpdir() } = {}) {
  requireThat(prefixes.has(prefix), 'unsupported-fixture-prefix');
  requireThat(!fs.lstatSync(parent).isSymbolicLink(), 'symlink-parent');
  const base = fs.realpathSync(parent), parentIdentity = identity(fs.lstatSync(base));
  const dir = fs.mkdtempSync(path.join(base, prefix)); // Fresh private directory only.
  const root = fs.lstatSync(dir), files = new Map();
  requireThat(root.uid === process.getuid() && (root.mode & 0o777) === 0o700, 'nonprivate-fixture');
  let kept, removed = false, location = dir, quarantine;
  const keep = reason => { kept ||= reason; };
  function readFile(at, name) {
    const file = path.join(at, name), before = fs.lstatSync(file);
    requireThat(before.isFile() && before.nlink === 1 && before.uid === root.uid && before.size <= 1048576, 'unsafe-fixture-file');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      requireThat(identity(fs.fstatSync(fd)) === identity(before), 'file-identity-changed');
      const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
      requireThat(identity(after) === identity(before) && after.nlink === 1 && after.size === before.size && after.mtimeMs === before.mtimeMs, 'file-changed-during-read');
      return { identity: identity(after), size: bytes.length, mtimeMs: after.mtimeMs, sha256: hash(bytes) };
    } finally { fs.closeSync(fd); }
  }
  function recordFile(name, expected) {
    try {
      requireThat(!removed && !kept && !files.has(name), 'fixture-already-recorded-or-retained');
      requireThat(typeof name === 'string' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && Buffer.isBuffer(expected), 'invalid-fixture-file');
      requireThat(identity(fs.lstatSync(dir)) === identity(root), 'directory-identity-changed');
      const record = readFile(dir, name);
      requireThat(record.sha256 === hash(expected), 'unexpected-fixture-content');
      files.set(name, record);
    } catch (error) { keep(error.message); throw error; }
  }
  function verify(at) {
    requireThat(identity(fs.lstatSync(at)) === identity(root), 'directory-identity-changed');
    requireThat(JSON.stringify(fs.readdirSync(at).sort()) === JSON.stringify([...files.keys()].sort()), 'unexpected-directory-entries');
    for (const [name, record] of files) requireThat(JSON.stringify(readFile(at, name)) === JSON.stringify(record), 'file-identity-or-content-changed');
  }
  function cleanup({ passed = false, quiescent = false } = {}) {
    if (removed) return { state: 'removed', path: dir, files: files.size };
    if (!passed || !quiescent) keep('test-or-process-outcome-unconfirmed');
    if (kept) return { state: 'retained', path: location, reason: kept };
    try {
      requireThat(fs.realpathSync(base) === base && identity(fs.lstatSync(base)) === parentIdentity, 'parent-identity-changed');
      verify(dir);
      // All legitimate writers/readers must have exited before this synchronous step.
      // Quarantine removes the public Home pathname before deleting exact files.
      // This is not a general cleaner or protection against hostile same-UID processes.
      quarantine = fs.mkdtempSync(path.join(fs.realpathSync(cleanupParent), 'document-fixture-cleanup-'));
      const q = fs.lstatSync(quarantine);
      requireThat(q.dev === root.dev && q.uid === root.uid && (q.mode & 0o777) === 0o700, 'unsafe-or-cross-device-quarantine');
      const target = path.join(quarantine, path.basename(dir));
      fs.renameSync(dir, target); location = target;
      verify(location); // A replacement or newly arrived entry is retained, never deleted.
      for (const [name, record] of files) {
        requireThat(identity(fs.lstatSync(quarantine)) === identity(q) && identity(fs.lstatSync(location)) === identity(root), 'cleanup-directory-changed');
        requireThat(JSON.stringify(readFile(location, name)) === JSON.stringify(record), 'cleanup-file-changed');
        fs.unlinkSync(path.join(location, name)); // No recursive deletion or symlink traversal.
      }
      fs.rmdirSync(location); fs.rmdirSync(quarantine); removed = true;
      return { state: 'removed', path: dir, files: files.size };
    } catch (error) {
      keep(error.message); return { state: 'retained', path: location, quarantine, reason: kept };
    }
  }
  return { dir, recordFile, keep, cleanup };
}
module.exports = { createHomeFixture };
