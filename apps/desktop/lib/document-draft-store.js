'use strict';
// Application-owned recovery snapshots only. This grants no Markdown save authority.
const nativeFs = require('node:fs'), path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const filename = /^([a-f0-9-]{36})\.(\d{1,10})\.json$/;
const fail = code => { throw Object.assign(Error(code), { code }); };
const stamp = s => [s.dev, s.ino, s.mode, s.uid, s.gid, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(':');
const MAX_RECORD = 768 * 1024;
function createDraftStore(root, { fs = nativeFs } = {}) {
  if (!path.isAbsolute(root)) fail('draft-directory-unavailable');
  try { fs.mkdirSync(root, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const initial = fs.lstatSync(root, { bigint: true });
  const verifyRoot = () => {
    const s = fs.lstatSync(root, { bigint: true });
    if (!s.isDirectory() || s.uid !== BigInt(process.getuid()) || (s.mode & 0o7777n) !== 0o700n
        || s.dev !== initial.dev || s.ino !== initial.ino || fs.realpathSync(root) !== root) fail('draft-directory-changed');
  };
  verifyRoot();
  const names = () => {
    verifyRoot(); const all = fs.readdirSync(root);
    if (all.length > 128 || all.some(n => !filename.test(n) || !uuid.test(n.split('.')[0]))) fail('draft-directory-needs-attention');
    return all;
  };
  function read(name) {
    verifyRoot(); if (!filename.test(name)) fail('invalid-draft');
    let fd;
    try {
      const file = path.join(root, name), before = fs.lstatSync(file, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.uid !== initial.uid || (before.mode & 0o7777n) !== 0o600n
          || before.size > BigInt(MAX_RECORD)) fail('invalid-draft');
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      if (stamp(fs.fstatSync(fd, { bigint: true })) !== stamp(before)) fail('draft-changed');
      const buffer = Buffer.alloc(Number(before.size)); let offset = 0;
      while (offset < buffer.length) { const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset); if (!n) fail('invalid-draft'); offset += n; }
      if (stamp(fs.fstatSync(fd, { bigint: true })) !== stamp(before) || stamp(fs.lstatSync(file, { bigint: true })) !== stamp(before)) fail('draft-changed');
      const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)), r = envelope.record;
      if (!r || envelope.sha256 !== hash(JSON.stringify(r)) || r.version !== 1 || !uuid.test(r.id)
          || name !== `${r.id}.${r.generation}.json` || !Number.isSafeInteger(r.generation) || r.generation < 1
          || !Number.isSafeInteger(r.revision) || r.revision < 0 || typeof r.label !== 'string' || r.label.length > 512
          || !Number.isSafeInteger(r.time) || typeof r.body !== 'string') fail('invalid-draft');
      const bytes = Buffer.from(r.body, 'base64');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (bytes.length > 524288 || bytes.toString('base64') !== r.body || hash(bytes) !== r.contentHash
          || text.length > 131073 || text.includes('\0')) fail('invalid-draft');
      verifyRoot(); return { ...r, bytes, token: name, identity: stamp(before) };
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function group(id, all = names()) {
    if (!uuid.test(id)) fail('invalid-draft');
    return all.filter(n => n.startsWith(id + '.')).sort((a, b) => Number(b.split('.')[1]) - Number(a.split('.')[1]));
  }
  function recover(id) {
    const entries = group(id); let rejected = 0;
    for (const name of entries) {
      try { return { ok: true, ...read(name), warning: rejected ? 'newer-draft-unreadable' : null }; }
      catch { rejected++; }
    }
    return { ok: false, code: entries.length ? 'draft-unreadable' : 'draft-unavailable' };
  }
  function list() {
    try {
      const all = names(), ids = [...new Set(all.map(n => n.split('.')[0]))];
      if (ids.length > 32) fail('draft-capacity');
      return { ok: true, drafts: ids.map(id => {
        const r = recover(id);
        return { id, ...(r.ok ? { label: r.label, revision: r.revision, time: r.time, token: r.token, sha256: r.contentHash, warning: r.warning } : { label: '无法读取的草稿', warning: r.code }), recoverable: r.ok };
      }).sort((a, b) => (b.time || 0) - (a.time || 0)) };
    } catch (e) { return { ok: false, code: e.code || 'draft-read-failed', drafts: [] }; }
  }
  function save({ id, token = null, fingerprint = null, label, revision, bytes }) {
    let fd, directory, created = false, attempted = false;
    try {
      if (!uuid.test(id) || !Buffer.isBuffer(bytes) || bytes.length > 524288 || typeof label !== 'string' || label.length > 512
          || !Number.isSafeInteger(revision) || revision < 0) fail('invalid-draft');
      const all = names(), previous = group(id, all);
      if ((previous[0] || null) !== token) fail('draft-conflict');
      if (!previous.length && new Set(all.map(n => n.split('.')[0])).size >= 32 || all.length >= 128) fail('draft-capacity');
      if (token && read(token).identity !== fingerprint) fail('draft-conflict');
      const generation = token ? Number(token.split('.')[1]) + 1 : 1;
      if (generation > 9999999999) fail('draft-capacity');
      const name = `${id}.${generation}.json`, file = path.join(root, name);
      const record = { version: 1, id, generation, revision, label, time: Date.now(), contentHash: hash(bytes), body: bytes.toString('base64') };
      const encoded = Buffer.from(JSON.stringify({ record, sha256: hash(JSON.stringify(record)) }));
      if (encoded.length > MAX_RECORD) fail('draft-capacity');
      directory = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); verifyRoot();
      const d = fs.fstatSync(directory, { bigint: true }); if (d.dev !== initial.dev || d.ino !== initial.ino) fail('draft-directory-changed');
      attempted = true;
      fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); created = true;
      const owned = fs.fstatSync(fd, { bigint: true });
      for (let offset = 0; offset < encoded.length;) {
        const n = fs.writeSync(fd, encoded, offset, encoded.length - offset, offset); if (n <= 0) fail('draft-write-failed'); offset += n;
      }
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      const confirmed = read(name);
      if (!confirmed.bytes.equals(bytes) || !confirmed.identity.startsWith(`${owned.dev}:${owned.ino}:`)) fail('draft-changed');
      fs.fsyncSync(directory); verifyRoot();
      if (read(name).identity !== confirmed.identity) fail('draft-changed');
      // Keep two verified generations. Unknown/partial/foreign entries are retained.
      let cleanupPending = false;
      for (const old of previous.slice(1)) {
        try {
          const known = read(old); verifyRoot();
          if (stamp(fs.lstatSync(path.join(root, old), { bigint: true })) !== known.identity) fail('draft-changed');
          fs.unlinkSync(path.join(root, old));
        } catch { cleanupPending = true; }
      }
      return { ok: true, state: 'backed-up', id, token: name, revision, sha256: record.contentHash, time: record.time, fingerprint: confirmed.identity, cleanupPending };
    } catch (e) {
      return { ok: false, state: created || (attempted && !['EEXIST', 'EACCES', 'EPERM', 'ENOENT'].includes(e.code)) ? 'draft-unverified' : 'backup-failed', code: e.code || 'draft-write-failed' };
    } finally {
      // Closing failures never turn an uncertain write into success.
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* Unverified result already retained. */ }
      if (directory !== undefined) try { fs.closeSync(directory); } catch { /* Directory sync/read verification determines receipt. */ }
    }
  }
  // Explicit dismissal is not part of V1. At capacity retain drafts and report it.
  return { list, recover, save, newId: randomUUID };
}
module.exports = { createDraftStore };
