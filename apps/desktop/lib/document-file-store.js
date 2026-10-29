'use strict';
const nativeFs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { isSessionLocation } = require('./editor-path-policy');
const { createSavePolicy, createIsolatedCreatePolicy, createPersistentCreatePolicy, inspectMacMetadata } = require('./document-save-policy');
// Process-local exclusion only. It does not coordinate external applications.
const activeSaves = new Set();

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

// Operations are synchronous. Existing replacement remains independently gated;
// new-copy creation is available only inside an isolated synthetic test process.
function createDocumentFileStore({ fs = nativeFs, unsafeExperimentalRoot, isolatedCreateRoot, persistentCreateTask } = {}) {
  const policy = createSavePolicy({ fs, unsafeExperimentalRoot });
  if (persistentCreateTask && isolatedCreateRoot !== undefined) throw error('invalid-create-policy', 'Conflicting create authority.');
  const createPolicy = persistentCreateTask ? createPersistentCreatePolicy(persistentCreateTask) : createIsolatedCreatePolicy({ fs, isolatedCreateRoot });
  function read(requestedPath, maxBytes = Infinity) {
    if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576)) throw error('unsupported-size', 'Invalid read limit.');
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
      let bytes;
      if (maxBytes === Infinity) bytes = fs.readFileSync(fd);
      else {
        if (opened.size > BigInt(maxBytes)) throw error('unsupported-size', 'File exceeds the preview size limit.');
        const buffer = Buffer.alloc(maxBytes + 1); let count = 0;
        while (count < buffer.length) {
          const n = fs.readSync(fd, buffer, count, buffer.length - count, null);
          if (!n) break; count += n;
        }
        if (count > maxBytes) throw error('unsupported-size', 'File grew beyond the preview size limit.');
        bytes = buffer.subarray(0, count);
      }
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
    let committed = false, tempCreated = false, renameAttempted = false;
    const keys = [`path:${expected.filePath}`, `inode:${expected.identity.dev}:${expected.identity.ino}`];
    if (keys.some(key => activeSaves.has(key))) return { ok: false, status: 'blocked', code: 'save-in-progress', committed: false };
    keys.forEach(key => activeSaves.add(key));
    try {
      requireBaseline(expected);
      if (!(expected.identity.mode & 0o222)) throw error('read-only', 'Read-only file will not be replaced.');
      if (expected.identity.mode & 0o7000) throw error('unsupported-file-mode', 'Special file modes are not supported.');
      fs.accessSync(expected.filePath, fs.constants.W_OK);
      const originalMetadata = policy.capture(expected.filePath);
      requireBaseline(expected);
      temp = path.join(path.dirname(expected.filePath), `.${path.basename(expected.filePath)}.${randomBytes(16).toString('hex')}.tmp`);
      fd = fs.openSync(temp, fs.constants.O_RDWR | fs.constants.O_CREAT
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
      // Verify the pinned descriptor's bytes, not merely its inode. Keeping the
      // descriptor open reduces identity confusion, NOT the final rename race.
      const actual = Buffer.alloc(bytes.length);
      for (let offset = 0; offset < actual.length;) {
        const count = fs.readSync(fd, actual, offset, actual.length - offset, offset);
        if (count <= 0) throw error('temporary-file-content-changed', 'Temporary content changed.');
        offset += count;
      }
      const tempAfter = fs.fstatSync(fd, { bigint: true });
      if (tempAfter.size !== BigInt(bytes.length) || !actual.equals(bytes)) throw error('temporary-file-content-changed', 'Temporary content changed.');
      const tempMetadata = metadata(tempAfter);
      if (tempMetadata.mode !== expected.identity.mode || tempMetadata.uid !== expected.identity.uid
          || tempMetadata.gid !== expected.identity.gid) throw error('temporary-file-metadata-changed', 'Temporary POSIX metadata changed.');
      policy.verify(temp, originalMetadata);
      policy.verify(expected.filePath, originalMetadata);
      requireBaseline(expected);
      const tempStat = fs.lstatSync(temp, { bigint: true });
      if (!tempStat.isFile() || tempStat.nlink !== 1n || !sameIdentity(metadata(tempStat), ownedIdentity)) {
        throw error('temporary-file-changed', 'Owned temporary file identity changed.');
      }
      // Not a compare-and-swap: an external writer can still race this rename
      // after the final check. Never describe this as eliminating TOCTOU.
      renameAttempted = true;
      fs.renameSync(temp, expected.filePath);
      committed = true;
      const candidate = read(expected.requestedPath);
      if (!sameIdentity(candidate.identity, ownedIdentity) || !candidate.bytes.equals(bytes)) {
        throw Object.assign(error('external-change', 'Disk changed immediately after replacement.'), { status: 'conflict' });
      }
      if (candidate.identity.mode !== expected.identity.mode || candidate.identity.uid !== expected.identity.uid
          || candidate.identity.gid !== expected.identity.gid) {
        throw error('replacement-posix-metadata-changed', 'Replacement POSIX metadata differs from the save expectation.');
      }
      policy.verify(expected.filePath, originalMetadata);
      snapshot = candidate;
      let directory;
      try {
        directory = fs.openSync(path.dirname(expected.filePath), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        fs.fsyncSync(directory);
      } catch {
        throw error('durability-uncertain', 'Replacement completed, but directory synchronization failed.');
      } finally { if (directory !== undefined) fs.closeSync(directory); }
      result = { ok: true, status: 'saved', committed: true, snapshot };
    } catch (cause) {
      if (renameAttempted && !committed) {
        // A rename error is not enough to promise no replacement happened.
        // Only classify unchanged if BOTH original baseline and owned source
        // are still positively observed; otherwise the outcome is unknown.
        let unchanged = false;
        try {
          unchanged = check(expected).ok && sameIdentity(metadata(fs.lstatSync(temp, { bigint: true })), ownedIdentity);
        } catch { /* uncertainty must remain explicit */ }
        if (!unchanged) committed = null;
      }
      result = { ok: false, status: cause.status || 'error', code: cause.code || 'save-failed',
        error: cause.message, committed, snapshot };
      if (committed === null) { result.code = 'replacement-unverified'; result.recoveryTempPath = temp; }
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch {
          result.descriptorCleanupFailed = true;
          if (committed === true && snapshot) Object.assign(result, { ok: false, code: 'durability-uncertain', status: 'error' });
        }
      }
      if (committed === false && temp && ownedIdentity) {
        try {
          const stat = fs.lstatSync(temp, { bigint: true });
          if (!stat.isFile() || !sameIdentity(metadata(stat), ownedIdentity)) throw Error('Not owned');
          fs.unlinkSync(temp); // Only the exclusively created, identity-checked sibling.
        } catch (cause) {
          if (cause.code !== 'ENOENT') { result.cleanupFailed = true; result.recoveryTempPath = temp; }
        }
      } else if (committed === false && tempCreated) {
        // Creation succeeded but identity capture failed: do not unlink a path
        // we cannot verify. Surface the exact recovery location instead.
        result.cleanupFailed = true;
        result.recoveryTempPath = temp;
      }
      keys.forEach(key => activeSaves.delete(key));
    }
    return { ...result, safety: policy.safety, realFileSafe: false };
  }

  // Only a synchronous, isolated test process may call this. No renderer API.
  // Use the pinned cwd's single-component name, never a resolved parent path.
  function createCopy(name, input) {
    let directory, fd, owned, result, filePath, attempted = false, created = false, complete = false, verified = false;
    let bytes, verifiedMetadata;
    const verifyFile = () => {
      createPolicy.verify(directory);
      const stat = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(name, { bigint: true });
      const current = metadata(stat);
      if (verifiedMetadata && !sameMetadata(current, verifiedMetadata)) throw error('created-file-changed', 'File changed after verification.');
      if (!stat.isFile() || stat.nlink !== 1n || !named.isFile() || named.nlink !== 1n
          || !sameIdentity(current, owned) || !sameMetadata(current, metadata(named))
          || current.mode !== 0o600 || current.uid !== owned.uid || current.gid !== owned.gid
          || stat.size !== BigInt(bytes.length)) throw error('created-file-changed', 'Created file identity or metadata changed.');
      const actual = Buffer.alloc(bytes.length);
      for (let offset = 0; offset < actual.length;) {
        const n = fs.readSync(fd, actual, offset, actual.length - offset, offset);
        if (n <= 0) throw error('created-file-changed', 'Created content changed.');
        offset += n;
      }
      if (!actual.equals(bytes) || hash(actual) !== hash(bytes)
          || !sameMetadata(current, metadata(fs.fstatSync(fd, { bigint: true })))) throw error('created-file-changed', 'Created content changed.');
      inspectMacMetadata(filePath);
      createPolicy.verify(directory);
      if (!sameMetadata(current, metadata(fs.lstatSync(name, { bigint: true })))
          || !sameMetadata(current, metadata(fs.fstatSync(fd, { bigint: true })))) throw error('created-file-changed', 'Created file changed during verification.');
      return current;
    };
    try {
      if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.md$/.test(name)
          || !Buffer.isBuffer(input) || input.length > 1048576) throw error('invalid-create-request', 'Expected bounded bytes and a synthetic Markdown filename.');
      bytes = Buffer.from(input);
      const root = createPolicy.verify(); filePath = path.join(root, name);
      directory = fs.openSync('.', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      createPolicy.verify(directory);
      attempted = true;
      fd = fs.openSync(name, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      created = true;
      const stat = fs.fstatSync(fd, { bigint: true }); owned = metadata(stat);
      const parent = metadata(fs.fstatSync(directory, { bigint: true }));
      if (!stat.isFile() || stat.nlink !== 1n || owned.mode !== 0o600 || owned.uid !== process.getuid()
          || owned.gid !== parent.gid || owned.dev !== parent.dev || stat.size !== 0n) throw error('created-file-changed', 'Unexpected new file identity.');
      createPolicy.verify(directory);
      for (let offset = 0; offset < bytes.length;) {
        const n = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!Number.isSafeInteger(n) || n <= 0 || n > bytes.length - offset) throw error('write-failed', 'New file write made no valid progress.');
        offset += n;
      }
      complete = true;
      verifiedMetadata = verifyFile(); verified = true;
      fs.fsyncSync(fd);
      fs.fsyncSync(directory);
      verifyFile();
      result = { ok: true, state: 'created-confirmed', created: true, filePath, sha256: hash(bytes), byteLength: bytes.length };
    } catch (cause) {
      let state = 'not-created', outcome = false;
      if (created) {
        outcome = true;
        state = complete ? 'created-unverified' : 'created-partial';
        if (verified) {
          try { verifyFile(); state = 'durability-uncertain'; } catch { state = 'created-unverified'; }
        }
      } else if (attempted) {
        if (cause.code === 'EEXIST') state = 'target-exists';
        else if (!['EACCES', 'EPERM', 'EROFS'].includes(cause.code)) { state = 'create-outcome-unknown'; outcome = null; }
      }
      result = { ok: false, state, created: outcome, code: cause.code || 'create-failed',
        ...(filePath ? { filePath } : {}) };
    } finally {
      for (const handle of [fd, directory]) if (handle !== undefined) {
        try { fs.closeSync(handle); } catch {
          result.ok = false; result.code = 'descriptor-close-failed';
          if (result.state === 'created-confirmed') result.state = 'durability-uncertain';
          result.descriptorCleanupFailed = true;
        }
      }
      // Never unlink or retry: even a partial/uncertain file is retained.
    }
    return { ...result, ...(owned ? { fileIdentity: `${owned.dev}:${owned.ino}` } : {}),
      realFileSafe: false, safety: persistentCreateTask ? 'dedicated-persistent-test-copy-only' : 'isolated-synthetic-create-only' };
  }

  function confirmDurability(expected) {
    const keys = [`path:${expected.filePath}`, `inode:${expected.identity.dev}:${expected.identity.ino}`];
    if (keys.some(key => activeSaves.has(key))) return { ok: false, status: 'blocked', code: 'save-in-progress' };
    keys.forEach(key => activeSaves.add(key));
    let fd, directory;
    try {
      requireBaseline(expected);
      const meta = policy.capture(expected.filePath);
      fd = fs.openSync(expected.filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      if (!sameMetadata(metadata(fs.fstatSync(fd, { bigint: true })), expected.identity)) throw error('external-change', 'Saved identity changed.');
      fs.fsyncSync(fd);
      directory = fs.openSync(path.dirname(expected.filePath), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      fs.fsyncSync(directory);
      policy.verify(expected.filePath, meta);
      requireBaseline(expected);
      return { ok: true, status: 'saved', committed: true, safety: policy.safety, realFileSafe: false };
    } catch (cause) {
      return { ok: false, status: cause.status || (cause.code === 'external-change' ? 'conflict' : 'error'),
        code: cause.code || 'durability-uncertain', committed: true };
    } finally {
      try { if (fd !== undefined) fs.closeSync(fd); } finally {
        try { if (directory !== undefined) fs.closeSync(directory); } finally { keys.forEach(key => activeSaves.delete(key)); }
      }
    }
  }
  return { read, check, replace, confirmDurability, createCopy, authorizeSynthetic: createPolicy.authorizeSource };
}

module.exports = { createDocumentFileStore };
