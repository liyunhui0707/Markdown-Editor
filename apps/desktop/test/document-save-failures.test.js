'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function fixture(override = {}) {
  const { createDocumentService } = require('../lib/document-service');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-save-failure-')));
  const filePath = path.join(root, 'synthetic.md');
  const original = Buffer.from('\uFEFF# Test\r\n    code\r\n');
  fs.writeFileSync(filePath, original, { flag: 'wx', mode: 0o640 });
  const io = Object.assign(Object.create(fs), override);
  const service = createDocumentService({ fs: io, unsafeExperimentalRoot: root });
  const opened = service.open(filePath);
  assert.equal(opened.ok, true);
  const document = opened.document;
  document.edit({ from: document.text.length, to: document.text.length, insert: 'LOCAL\r\n' });
  return { root, filePath, original, io, service, document };
}
function expectProtected(f, result) {
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.deepEqual(fs.readFileSync(f.filePath), f.original);
  assert.equal(f.document.text, '# Test\r\n    code\r\nLOCAL\r\n');
  assert.equal(f.document.dirty, true);
  assert.deepEqual(fs.readdirSync(f.root), ['synthetic.md']);
}
const failure = code => Object.assign(Error('Synthetic injected I/O failure'), { code });

for (const operation of ['openSync', 'writeSync', 'fsyncSync', 'fchmodSync', 'renameSync']) {
  test(`atomic Save: ${operation} failure protects original and edits, cleans only owned temp`, () => {
    const f = fixture();
    // Open succeeds above. Fail only the write-side operation, not initial reads.
    const original = fs[operation];
    f.io[operation] = (...args) => {
      if (operation !== 'openSync' || (args[1] & fs.constants.O_CREAT)) throw failure('EIO');
      return original(...args);
    };
    expectProtected(f, f.service.save(f.document));
  });
}

test('partial writes are retried; zero-progress writes fail without truncating original', () => {
  const good = fixture();
  let calls = 0;
  good.io.writeSync = (fd, buffer, offset, length, position) => {
    calls++;
    return fs.writeSync(fd, buffer, offset, Math.min(3, length), position);
  };
  assert.equal(good.service.save(good.document).ok, true);
  assert.ok(calls > 1);
  assert.deepEqual(fs.readFileSync(good.filePath), Buffer.concat([good.original, Buffer.from('LOCAL\r\n')]));
  const bad = fixture({ writeSync: () => 0 });
  expectProtected(bad, bad.service.save(bad.document));
});

test('late external edit during temp-file sync is caught by the final baseline check', () => {
  const f = fixture();
  f.io.fsyncSync = fd => {
    fs.fsyncSync(fd);
    fs.writeFileSync(f.filePath, 'LATE EXTERNAL\n');
  };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'conflict');
  assert.equal(result.committed, false);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'LATE EXTERNAL\n');
  assert.equal(f.document.dirty, true);
  assert.deepEqual(fs.readdirSync(f.root), ['synthetic.md']);
});

test('read-only destination is not bypassed merely because its directory is writable', () => {
  const f = fixture();
  fs.chmodSync(f.filePath, 0o440);
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  const readOnly = f.service.open(f.filePath).document;
  readOnly.edit({ from: 0, to: 0, insert: 'LOCAL\r\n' });
  const loadedReadOnly = f.service.save(readOnly);
  assert.equal(loadedReadOnly.ok, false);
  assert.equal(loadedReadOnly.code, 'read-only');
  assert.deepEqual(fs.readFileSync(f.filePath), f.original);
  assert.equal(fs.statSync(f.filePath).mode & 0o777, 0o440);
  assert.equal(f.document.dirty, true);
});

test('saved POSIX permissions are preserved and a second Save uses the new baseline', () => {
  const f = fixture();
  assert.equal(f.service.save(f.document).ok, true);
  assert.equal(fs.statSync(f.filePath).mode & 0o777, 0o640);
  f.document.edit({ from: 0, to: 0, insert: 'Second\r\n' });
  assert.equal(f.service.save(f.document).ok, true);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '\uFEFFSecond\r\n# Test\r\n    code\r\nLOCAL\r\n');
  assert.equal(f.document.dirty, false);
});

test('directory fsync failure reports that replacement committed; it does not claim rollback', () => {
  const f = fixture();
  f.io.fsyncSync = fd => {
    if (fs.fstatSync(fd).isDirectory()) throw failure('EIO');
    fs.fsyncSync(fd);
  };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, true);
  assert.equal(result.code, 'durability-uncertain');
  assert.deepEqual(fs.readFileSync(f.filePath), Buffer.concat([f.original, Buffer.from('LOCAL\r\n')]));
  assert.equal(f.document.text, '# Test\r\n    code\r\nLOCAL\r\n');
  assert.equal(f.service.checkExternal(f.document).status, 'unchanged');
});

test('failed cleanup is explicit and the original and editor text are still safe', () => {
  const f = fixture({ renameSync() { throw failure('EIO'); }, unlinkSync() { throw failure('EACCES'); } });
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.cleanupFailed, true);
  assert.ok(result.recoveryTempPath.startsWith(f.root + path.sep));
  assert.deepEqual(fs.readFileSync(f.filePath), f.original);
  assert.equal(f.document.dirty, true);
  assert.ok(fs.existsSync(result.recoveryTempPath));
});

test('failure to identify a just-created temp is reported without deleting an unverified path', () => {
  const f = fixture();
  let tempFd;
  f.io.openSync = (filePath, flags, ...rest) => {
    const fd = fs.openSync(filePath, flags, ...rest);
    if (flags & fs.constants.O_CREAT) tempFd = fd;
    return fd;
  };
  f.io.fstatSync = (fd, ...rest) => {
    if (fd === tempFd) throw failure('EIO');
    return fs.fstatSync(fd, ...rest);
  };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.cleanupFailed, true);
  assert.ok(fs.existsSync(result.recoveryTempPath));
  assert.deepEqual(fs.readFileSync(f.filePath), f.original);
  assert.equal(f.document.dirty, true);
});

test('same-directory temp creation is exclusive and never truncates a pre-existing collision', () => {
  const f = fixture();
  let collision;
  f.io.openSync = (filePath, flags, ...rest) => {
    if (flags & fs.constants.O_CREAT) {
      assert.equal(path.dirname(filePath), f.root);
      assert.ok(flags & fs.constants.O_EXCL);
      collision = filePath;
      fs.writeFileSync(collision, 'DO NOT DELETE OR OVERWRITE');
    }
    return fs.openSync(filePath, flags, ...rest);
  };
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(fs.readFileSync(collision, 'utf8'), 'DO NOT DELETE OR OVERWRITE');
  assert.deepEqual(fs.readFileSync(f.filePath), f.original);
});

test('UTF-16, malformed UTF-8 and NUL/binary inputs fail closed with original bytes available', () => {
  const { createDocumentService } = require('../lib/document-service');
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x41, 0]), Buffer.from([0xc3, 0x28]), Buffer.from([0, 0x41])]) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-encoding-')));
    const filePath = path.join(root, 'synthetic.md');
    fs.writeFileSync(filePath, bytes, { flag: 'wx' });
    const service = createDocumentService();
    const result = service.open(filePath);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported-encoding');
    assert.deepEqual(result.document.originalBytes, bytes);
    assert.equal(result.document.text, null);
    assert.equal(service.save(result.document).status, 'blocked');
    assert.deepEqual(fs.readFileSync(filePath), bytes);
  }
});

test('symlink and hardlink paths are refused; another open session cannot overwrite an intervening Save', () => {
  const f = fixture();
  const symlink = path.join(f.root, 'symlink.md');
  fs.symlinkSync(f.filePath, symlink);
  assert.equal(f.service.open(symlink).ok, false);
  const other = f.service.open(f.filePath).document;
  other.edit({ from: 0, to: 0, insert: 'OTHER\r\n' });
  assert.equal(f.service.save(other).ok, true);
  assert.equal(f.service.save(f.document).status, 'conflict');
  const hardlink = path.join(f.root, 'hardlink.md');
  fs.linkSync(f.filePath, hardlink);
  assert.equal(f.service.open(hardlink).ok, false);
  assert.equal(f.service.open(f.filePath).ok, false);
});
