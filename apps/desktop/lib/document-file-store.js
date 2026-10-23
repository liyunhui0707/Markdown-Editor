'use strict';
const nativeFs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { isSessionLocation } = require('./editor-path-policy');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const error = (code, message) => Object.assign(Error(message), { code });
const metadata = stat => ({
  dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size),
  mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs),
  mode: Number(stat.mode & 0o7777n), uid: Number(stat.uid), gid: Number(stat.gid),
});
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameMetadata = (a, b) => Object.keys(a).every(key => a[key] === b[key]);
const sameSnapshot = (a, b) => a.filePath === b.filePath
  && sameMetadata(a.identity, b.identity) && a.sha256 === b.sha256 && a.bytes.equals(b.bytes);

// Existing files only; creation/Save As and native coordinated saving are later
// stages. All operations are synchronous to match the current main boundary.
function createDocumentFileStore({ fs = nativeFs } = {}) {
  function read(requestedPath) {
    if (typeof requestedPath !== 'string' || !path.isAbsolute(requestedPath)
        || !/\.md$/i.test(requestedPath) || isSessionLocation(requestedPath)) {
      throw error('unsupported-path', 'Expected an authorized absolute Markdown file path.');
    }
    const filePath = path.join(fs.realpathSync(path.dirname(requestedPath)), path.basename(requestedPath));
    const named = fs.lstatSync(filePath, { bigint: true });
    if (!named.isFile() || named.nlink !== 1n) {
      throw error('unsupported-file', 'Symlinks, hardlinks and non-regular files are not supported.');
    }
    let fd;
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || !sameMetadata(metadata(named), metadata(opened))) {
        throw error('external-change', 'File identity changed during open.');
      }
      const bytes = fs.readFileSync(fd);
      const after = fs.fstatSync(fd, { bigint: true });
      const current = fs.lstatSync(filePath, { bigint: true });
      if (!sameMetadata(metadata(opened), metadata(after)) || !current.isFile()
          || current.nlink !== 1n || !sameMetadata(metadata(after), metadata(current))) {
        throw error('external-change', 'File changed while reading.');
      }
      return { requestedPath, filePath, bytes, sha256: hash(bytes), identity: metadata(after) };
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }

  function check(expected) {
    try {
      const current = read(expected.requestedPath);
      if (sameSnapshot(expected, current)) return { ok: true, status: 'unchanged' };
    } catch (cause) {
      if (!['ENOENT', 'ENOTDIR', 'ELOOP', 'external-change', 'unsupported-file'].includes(cause.code)) {
        return { ok: false, status: 'error', code: 'read-failed', error: 'Unable to check the current disk file.' };
      }
    }
    return { ok: false, status: 'conflict', code: 'external-change', error: 'Disk file changed; local edits retained.' };
  }

  function requireBaseline(expected) {
    const checked = check(expected);
    if (!checked.ok) throw Object.assign(error(checked.code, checked.error), { status: checked.status });
  }

  function replace(expected, bytes) {
    let temp, fd, ownedIdentity, snapshot, result;
    let committed = false, tempCreated = false;
    try {
      requireBaseline(expected);
      if (!(expected.identity.mode & 0o222)) throw error('read-only', 'Read-only file will not be replaced.');
      fs.accessSync(expected.filePath, fs.constants.W_OK);
      temp = path.join(path.dirname(expected.filePath), `.${path.basename(expected.filePath)}.${randomBytes(16).toString('hex')}.tmp`);
      fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      tempCreated = true;
      ownedIdentity = metadata(fs.fstatSync(fd, { bigint: true }));
      for (let offset = 0; offset < bytes.length;) {
        const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (count <= 0) throw error('write-failed', 'Temporary file write made no progress.');
        offset += count;
      }
      if (ownedIdentity.uid !== expected.identity.uid || ownedIdentity.gid !== expected.identity.gid) {
        fs.fchownSync(fd, expected.identity.uid, expected.identity.gid);
      }
      fs.fchmodSync(fd, expected.identity.mode);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      requireBaseline(expected);
      const tempStat = fs.lstatSync(temp, { bigint: true });
      if (!tempStat.isFile() || tempStat.nlink !== 1n || !sameIdentity(metadata(tempStat), ownedIdentity)) {
        throw error('temporary-file-changed', 'Owned temporary file identity changed.');
      }
      // Not a compare-and-swap: an external writer can still race this rename
      // after the final check. Never describe this as eliminating TOCTOU.
      fs.renameSync(temp, expected.filePath);
      committed = true;
      snapshot = read(expected.requestedPath);
      if (!sameIdentity(snapshot.identity, ownedIdentity) || !snapshot.bytes.equals(bytes)) {
        snapshot = undefined;
        throw Object.assign(error('external-change', 'Disk changed immediately after replacement.'), { status: 'conflict' });
      }
      let directory;
      try {
        directory = fs.openSync(path.dirname(expected.filePath), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        fs.fsyncSync(directory);
      } catch {
        throw error('durability-uncertain', 'Replacement completed, but directory synchronization failed.');
      } finally { if (directory !== undefined) fs.closeSync(directory); }
      result = { ok: true, status: 'saved', committed: true, snapshot };
    } catch (cause) {
      result = { ok: false, status: cause.status || 'error', code: cause.code || 'save-failed',
        error: cause.message, committed, snapshot };
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { result.descriptorCleanupFailed = true; }
      }
      if (!committed && temp && ownedIdentity) {
        try {
          const stat = fs.lstatSync(temp, { bigint: true });
          if (!stat.isFile() || !sameIdentity(metadata(stat), ownedIdentity)) throw Error('Not owned');
          fs.unlinkSync(temp); // Only the exclusively created, identity-checked sibling.
        } catch (cause) {
          if (cause.code !== 'ENOENT') { result.cleanupFailed = true; result.recoveryTempPath = temp; }
        }
      } else if (!committed && tempCreated) {
        // Creation succeeded but identity capture failed: do not unlink a path
        // we cannot verify. Surface the exact recovery location instead.
        result.cleanupFailed = true;
        result.recoveryTempPath = temp;
      }
    }
    return result;
  }

  return { read, check, replace };
}

module.exports = { createDocumentFileStore };
