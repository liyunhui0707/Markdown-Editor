'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createDocumentService } = require('../lib/document-service');
const ioFailure = () => Object.assign(Error('Synthetic I/O fault'), { code: 'EIO' });
function command(exe, args) {
  const result = spawnSync(exe, args, { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
  assert.equal(result.status, 0, 'Synthetic metadata command failed');
  return result.stdout;
}
function fixture({ experimental = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-hardening-')));
  const filePath = path.join(root, 'synthetic.md');
  fs.writeFileSync(filePath, '# T\nBODY\n', { flag: 'wx', mode: 0o600 });
  const io = Object.create(fs);
  const service = createDocumentService({ fs: io, ...(experimental ? { unsafeExperimentalRoot: root } : {}) });
  const opened = service.open(filePath);
  assert.equal(opened.ok, true);
  const document = opened.document;
  return { root, filePath, io, service, document };
}
function edit(f, text = 'LOCAL\n') {
  return f.document.edit({ from: f.document.text.length, to: f.document.text.length, insert: text });
}
function uncertain() {
  const f = fixture();
  edit(f);
  f.io.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) throw ioFailure(); fs.fsyncSync(fd); };
  assert.equal(f.service.save(f.document).code, 'durability-uncertain');
  return f;
}

test('model exposes no acceptSaved authority; a caller cannot falsely clear dirty', () => {
  const f = fixture(); edit(f);
  assert.equal(f.document.acceptSaved, undefined);
  assert.throws(() => { f.document.acceptSaved = () => {}; }, TypeError);
  assert.equal(f.document.dirty, true);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
  const state = f.service.getSaveState(f.document);
  assert.throws(() => { state.state = 'saved-confirmed'; }, TypeError);
  assert.equal(f.service.getSaveState(f.document).state, 'not-submitted');
});

test('illegal edit parameters and getters return structured errors without mutation', () => {
  const f = fixture();
  const throwing = Object.defineProperty({}, 'from', { get() { throw Error('Synthetic getter'); } });
  const proxy = new Proxy({ from: 0, to: 0, insert: 'X' }, { get() { throw Error('Synthetic Proxy trap'); } });
  for (const payload of [null, undefined, [], 0, 'x', throwing, proxy,
    { from: 0, to: 0, insert: 5 }, { from: 2, to: 1, insert: '' },
    { from: 0, to: 0, insert: '', revision: 0 }]) {
    let result;
    assert.doesNotThrow(() => { result = f.document.edit(payload); });
    assert.equal(result.ok, false);
    assert.equal(typeof result.code, 'string');
    assert.equal(f.document.text, '# T\nBODY\n');
    assert.equal(f.document.dirty, false);
  }
});

test('optional expectedRevision is explicit on edit/save and stale revisions never write', () => {
  const f = fixture();
  assert.equal(f.document.edit({ from: 0, to: 0, insert: 'A', expectedRevision: 0 }).ok, true);
  assert.equal(f.document.revision, 1);
  const old = f.document.text;
  assert.equal(f.document.edit({ from: 0, to: 0, insert: 'B', expectedRevision: 0 }).code, 'stale-revision');
  assert.equal(f.document.edit({ from: 0, to: 0, insert: 'B', expectedRevision: '1' }).ok, false);
  assert.equal(f.service.save(f.document, { expectedRevision: 0 }).code, 'stale-revision');
  assert.equal(f.document.text, old);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
  assert.equal(f.service.save(f.document, { expectedRevision: 1 }).ok, true);
});

test('invalid service options and invalid session operations return structured errors', () => {
  const f = fixture();
  for (const options of [null, [], 1, 'x', { unexpected: true }]) {
    assert.doesNotThrow(() => {
      assert.equal(f.service.save(f.document, options).ok, false);
      assert.equal(f.service.open(f.filePath, options).ok, false);
    });
  }
  for (const value of [null, {}, 1, undefined]) {
    assert.equal(f.service.save(value).ok, false);
    assert.equal(f.service.close(value).ok, false);
    assert.equal(f.service.getSaveState(value).ok, false);
  }
  assert.equal(f.service.retryDurability(f.document).code, 'invalid-save-state');
});

test('durability uncertainty survives unchanged Save, later edits, failed retry and close', () => {
  const f = uncertain();
  assert.equal(f.document.dirty, false);
  const bytes = fs.readFileSync(f.filePath);
  for (let i = 0; i < 2; i++) {
    const result = f.service.save(f.document);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'durability-uncertain');
    assert.equal(result.committed, true);
    assert.equal(result.saveState.state, 'durability-uncertain');
  }
  edit(f, 'UNSAVED\n');
  assert.equal(f.service.save(f.document).code, 'durability-uncertain');
  assert.equal(f.service.retryDurability(f.document).ok, false);
  assert.equal(f.service.getSaveState(f.document).durabilityUncertain, true);
  assert.equal(f.service.close(f.document).code, 'unresolved-save-state');
  assert.deepEqual(fs.readFileSync(f.filePath), bytes);
  assert.ok(f.document.text.endsWith('UNSAVED\n'));
});

test('explicit durability retry rechecks the saved version and synchronizes file plus directory', () => {
  const f = uncertain();
  edit(f, 'UNSAVED\n');
  const synced = [];
  f.io.fsyncSync = fd => { synced.push(fs.fstatSync(fd).isDirectory() ? 'directory' : 'file'); fs.fsyncSync(fd); };
  const result = f.service.retryDurability(f.document);
  assert.equal(result.ok, true);
  assert.deepEqual(synced, ['file', 'directory']);
  assert.equal(f.service.getSaveState(f.document).state, 'saved-confirmed');
  assert.equal(f.service.getSaveState(f.document).durabilityUncertain, false);
  assert.equal(f.document.dirty, true); // confirming old disk bytes is not saving new edits
  assert.equal(f.service.save(f.document).ok, true);
  assert.ok(fs.readFileSync(f.filePath, 'utf8').endsWith('UNSAVED\n'));
});

test('external conflict during pending durability never silently resolves the warning', () => {
  const f = uncertain();
  fs.writeFileSync(f.filePath, 'EXTERNAL\n');
  assert.equal(f.service.retryDurability(f.document).status, 'conflict');
  assert.equal(f.service.getSaveState(f.document).durabilityUncertain, true);
  assert.equal(f.service.save(f.document).ok, false);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'EXTERNAL\n');
});

test('default service refuses dirty replacement before any rename; no external-writer assumption', () => {
  const f = fixture({ experimental: false }); edit(f);
  let renames = 0;
  f.io.renameSync = () => { renames++; throw Error('Must not reach unsafe replacement'); };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'coordination-required');
  assert.equal(result.committed, false);
  assert.equal(renames, 0);
  assert.equal(f.document.dirty, true);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
});

test('experimental policy is confined to its private synthetic temp root, not a general bypass', () => {
  const f = fixture();
  const other = fixture({ experimental: false });
  const doc = f.service.open(other.filePath).document;
  doc.edit({ from: 0, to: 0, insert: 'LOCAL' });
  assert.equal(f.service.save(doc).code, 'experimental-scope-required');
  assert.equal(fs.readFileSync(other.filePath, 'utf8'), '# T\nBODY\n');
  const plain = f.service.save(f.document);
  assert.equal(plain.status, 'unchanged');
  edit(f);
  const saved = f.service.save(f.document);
  assert.equal(saved.ok, true);
  assert.equal(saved.realFileSafe, false);
  assert.equal(saved.safety, 'experimental-uncoordinated');
});

test('same-inode temporary content tamper is detected before replacement', () => {
  const f = fixture(); edit(f);
  let temp;
  f.io.openSync = (p, flags, ...rest) => { if (flags & fs.constants.O_CREAT) temp = p; return fs.openSync(p, flags, ...rest); };
  f.io.fsyncSync = fd => { fs.fsyncSync(fd); if (temp) fs.writeFileSync(temp, 'TAMPER'); };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.code, 'temporary-file-content-changed');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
  assert.equal(f.document.dirty, true);
});

test('post-replacement mismatch is sticky unverified state, not an unchanged failed save', () => {
  const f = fixture(); edit(f);
  f.io.renameSync = (...args) => { fs.renameSync(...args); fs.writeFileSync(f.filePath, 'AFTER REPLACEMENT\n'); };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, true);
  assert.equal(f.service.getSaveState(f.document).state, 'replacement-unverified');
  assert.equal(f.service.save(f.document).code, 'replacement-unverified');
  assert.equal(f.document.dirty, true);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'AFTER REPLACEMENT\n');
});

test('rename-then-error cannot falsely claim the original was unchanged', () => {
  const f = fixture(); edit(f);
  f.io.renameSync = (...args) => { fs.renameSync(...args); throw ioFailure(); };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, null);
  assert.equal(f.service.getSaveState(f.document).state, 'replacement-unverified');
  assert.equal(f.service.save(f.document).ok, false);
  assert.equal(f.document.dirty, true);
});

test('multiple service instances cannot re-enter replacement of the same canonical path', () => {
  const f = fixture(); edit(f);
  const second = createDocumentService({ unsafeExperimentalRoot: f.root });
  const doc = second.open(f.filePath).document;
  doc.edit({ from: 0, to: 0, insert: 'OTHER' });
  let nested;
  f.io.fsyncSync = fd => { if (!nested) nested = second.save(doc); fs.fsyncSync(fd); };
  assert.equal(f.service.save(f.document).ok, true);
  assert.equal(nested.code, 'save-in-progress');
  assert.equal(second.save(doc).status, 'conflict');
  assert.equal(doc.dirty, true);
});

test('failed pre-replacement write retains source and can be retried normally', () => {
  const f = fixture(); edit(f);
  f.io.writeSync = () => { throw ioFailure(); };
  assert.equal(f.service.save(f.document).committed, false);
  assert.equal(f.service.getSaveState(f.document).state, 'failed-unchanged');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
  f.io.writeSync = fs.writeSync;
  assert.equal(f.service.save(f.document).ok, true);
  assert.equal(f.service.getSaveState(f.document).state, 'saved-confirmed');
});

test('native ACL is safely refused without removing it or changing bytes', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  command('/bin/chmod', ['+a', 'everyone allow read', f.filePath]);
  f.document = f.service.open(f.filePath).document;
  const acl = command('/bin/ls', ['-lde', f.filePath]);
  edit(f);
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported-acl');
  assert.equal(command('/bin/ls', ['-lde', f.filePath]), acl);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
});

test('native custom xattr is safely refused and preserved byte-for-byte', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  command('/usr/bin/xattr', ['-w', 'com.example.synthetic-integrity', 'SYNTHETIC-METADATA', f.filePath]);
  f.document = f.service.open(f.filePath).document;
  const before = command('/usr/bin/xattr', ['-px', 'com.example.synthetic-integrity', f.filePath]);
  edit(f);
  assert.equal(f.service.save(f.document).code, 'unsupported-xattrs');
  assert.equal(command('/usr/bin/xattr', ['-px', 'com.example.synthetic-integrity', f.filePath]), before);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
});

test('native file flags are refused, not stripped by replacement', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  command('/usr/bin/chflags', ['hidden', f.filePath]);
  f.document = f.service.open(f.filePath).document;
  const flags = command('/usr/bin/stat', ['-f', '%f', f.filePath]);
  edit(f);
  assert.equal(f.service.save(f.document).code, 'unsupported-flags');
  assert.equal(command('/usr/bin/stat', ['-f', '%f', f.filePath]), flags);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
});

test('known automatic provenance metadata is compared, never silently dropped', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  const names = command('/usr/bin/xattr', [f.filePath]);
  const provenance = names.includes('com.apple.provenance')
    ? command('/usr/bin/xattr', ['-px', 'com.apple.provenance', f.filePath]) : null;
  edit(f);
  assert.equal(f.service.save(f.document).ok, true);
  assert.equal(command('/usr/bin/xattr', [f.filePath]), names);
  if (provenance !== null) assert.equal(command('/usr/bin/xattr', ['-px', 'com.apple.provenance', f.filePath]), provenance);
});

test('metadata inspection fails closed for unavailable tools and ambiguous xattr names', () => {
  const { inspectMacMetadata } = require('../lib/document-save-policy');
  for (const names of ['\n\n', 'com.apple.provenance\n\n', 'com.apple.provenance', 'unknown\n']) {
    const spawn = exe => ({ status: 0, stdout: exe === '/bin/ls' ? '-rw------- 1 synthetic synthetic 1 synthetic\n'
      : exe === '/usr/bin/stat' ? '0\n' : names });
    assert.throws(() => inspectMacMetadata('/synthetic-only.md', { spawn, platform: 'darwin' }),
      error => ['unsupported-xattrs', 'metadata-inspection-unavailable'].includes(error.code));
  }
  assert.throws(() => inspectMacMetadata('/synthetic-only.md', { platform: 'other' }),
    error => error.code === 'metadata-inspection-unavailable');
  assert.throws(() => inspectMacMetadata('/synthetic-only.md', {
    platform: 'darwin', spawn: () => ({ status: 1, stdout: '' }),
  }), error => error.code === 'metadata-inspection-unavailable');
});

test('experimental filesystem mismatch and a widened root permission both refuse replacement', () => {
  for (const kind of ['filesystem', 'permissions']) {
    const f = fixture(); edit(f);
    if (kind === 'filesystem') f.io.statfsSync = p => {
      const value = fs.statfsSync(p);
      return { ...value, type: p === f.filePath ? value.type + 1 : value.type };
    };
    else fs.chmodSync(f.root, 0o755);
    const result = f.service.save(f.document);
    assert.equal(result.code, kind === 'filesystem' ? 'unsupported-filesystem' : 'experimental-scope-required');
    assert.equal(result.committed, false);
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
  }
});

test('temporary pathname substitution is refused without deleting the intruder file', () => {
  const f = fixture(); edit(f);
  let temp;
  f.io.openSync = (p, flags, ...rest) => { if (flags & fs.constants.O_CREAT) temp = p; return fs.openSync(p, flags, ...rest); };
  f.io.fsyncSync = fd => {
    fs.fsyncSync(fd);
    if (temp) { fs.renameSync(temp, path.join(f.root, 'parked-owned-temp')); fs.writeFileSync(temp, 'INTRUDER'); }
  };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.cleanupFailed, true);
  assert.equal(fs.readFileSync(temp, 'utf8'), 'INTRUDER');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '# T\nBODY\n');
});

test('a durability-retry close error stays structured and cannot clear pending uncertainty', () => {
  const f = uncertain();
  f.io.fsyncSync = fs.fsyncSync;
  f.io.closeSync = fd => {
    const directory = fs.fstatSync(fd).isDirectory();
    fs.closeSync(fd);
    if (directory) throw ioFailure();
  };
  const result = f.service.retryDurability(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'durability-uncertain');
  assert.equal(result.committed, true);
  assert.equal(f.service.getSaveState(f.document).durabilityUncertain, true);
  f.io.closeSync = fs.closeSync;
  assert.equal(f.service.retryDurability(f.document).ok, true);
});

// P1: mutation occurs after the real rename, before the candidate is read.
// mode/gid use real permissions where available; uid never requires chown.
function postReplacementMetadata(field, t) {
  const f = fixture();
  fs.chmodSync(f.filePath, 0o640);
  f.document = f.service.open(f.filePath).document;
  const originalIdentity = f.document.identity;
  let changedValue = field === 'mode' ? 0o666 : originalIdentity[field] + 1;
  let native = field === 'mode';
  if (field === 'gid') {
    const probe = path.join(f.root, 'synthetic-group-permission-probe');
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    for (const gid of process.getgroups?.() || []) {
      if (gid === originalIdentity.gid) continue;
      try {
        fs.chownSync(probe, -1, gid);
        if (fs.statSync(probe).gid === gid) { changedValue = gid; native = true; break; }
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EINVAL'].includes(error.code)) throw error;
      }
    }
  }
  let replaced = false, renames = 0;
  if (!native) {
    const observed = stat => {
      if (!replaced || !stat.isFile()) return stat;
      return Object.assign(Object.create(stat), {
        [field]: typeof stat[field] === 'bigint' ? BigInt(changedValue) : changedValue,
      });
    };
    f.io.lstatSync = (...args) => observed(fs.lstatSync(...args));
    f.io.fstatSync = (...args) => observed(fs.fstatSync(...args));
  }
  f.io.renameSync = (from, to) => {
    fs.renameSync(from, to);
    renames++;
    replaced = true;
    if (native && field === 'mode') fs.chmodSync(to, changedValue);
    if (native && field === 'gid') fs.chownSync(to, -1, changedValue);
  };
  t.diagnostic(`${field}: ${native ? 'native owned-file mutation' : 'injected consistent post-rename stat observation'}`);
  edit(f);
  return { ...f, originalIdentity, changedValue, native, renameCount: () => renames };
}

for (const field of ['mode', 'gid', 'uid']) {
  test(`P1 ${field}: storage must not publish a post-replacement POSIX-invalid snapshot`, t => {
    const f = postReplacementMetadata(field, t);
    const { createDocumentFileStore } = require('../lib/document-file-store');
    const store = createDocumentFileStore({ fs: f.io, unsafeExperimentalRoot: f.root });
    const expected = store.read(f.filePath);
    const result = store.replace(expected, Buffer.from(f.document.text, 'utf8'));
    t.diagnostic(`snapshot published: ${Boolean(result.snapshot)}; ok: ${result.ok}; committed: ${result.committed}`);
    assert.equal(result.ok, false);
    assert.equal(result.committed, true);
    assert.equal(result.code, 'replacement-posix-metadata-changed');
    assert.equal(result.snapshot, undefined);
    assert.equal(f.renameCount(), 1);
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), f.document.text);
    if (f.native) {
      const actual = fs.statSync(f.filePath);
      assert.equal(field === 'mode' ? actual.mode & 0o7777 : actual[field], f.changedValue);
    }
  });

  test(`P1 ${field}: service keeps dirty/baseline and blocks further saves after invalid replacement`, t => {
    const f = postReplacementMetadata(field, t);
    const text = f.document.text, revision = f.document.revision;
    const result = f.service.save(f.document);
    t.diagnostic(`service outcome: ${JSON.stringify({ ok: result.ok, state: result.saveState?.state, dirty: f.document.dirty, committed: result.committed })}`);
    assert.equal(result.ok, false);
    assert.equal(result.committed, true);
    assert.equal(result.code, 'replacement-posix-metadata-changed');
    assert.equal(result.saveState.state, 'replacement-unverified');
    assert.equal(result.saveState.replacementUnverified, true);
    assert.equal(f.document.dirty, true);
    assert.deepEqual(f.document.identity, f.originalIdentity);
    assert.equal(f.document.text, text);
    assert.equal(f.document.revision, revision);
    assert.equal(f.service.checkExternal(f.document).status, 'conflict'); // old baseline, not the bad candidate
    assert.equal(f.service.save(f.document).code, 'replacement-unverified');
    assert.equal(f.service.retryDurability(f.document).code, 'replacement-unverified');
    assert.equal(f.service.close(f.document).code, 'unresolved-save-state');
    assert.equal(f.service.getSaveState(f.document).state, 'replacement-unverified');
    assert.equal(f.renameCount(), 1); // no rollback or retry overwrite
    assert.equal(f.document.dirty, true);
    assert.deepEqual(f.document.identity, f.originalIdentity);
    assert.equal(f.document.text, text);
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), text);
  });
}
