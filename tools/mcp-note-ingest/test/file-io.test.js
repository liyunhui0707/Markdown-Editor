const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { atomicWriteFileSync, sha256OfFile, sha256OfBuffer } = require('../lib/file-io');

function mkdir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'file-io-')));
}

test('atomicWriteFileSync writes contents and renames into place', () => {
  const dir = mkdir();
  const target = path.join(dir, 'out.md');
  atomicWriteFileSync(target, 'hi\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'hi\n');
});

test('atomicWriteFileSync preserves the existing file mode (e.g., 0600)', () => {
  const dir = mkdir();
  const target = path.join(dir, 'private.md');
  fs.writeFileSync(target, 'original\n');
  fs.chmodSync(target, 0o600);
  const beforeMode = fs.statSync(target).mode & 0o777;
  assert.equal(beforeMode, 0o600);
  atomicWriteFileSync(target, 'new\n');
  const afterMode = fs.statSync(target).mode & 0o777;
  assert.equal(afterMode, 0o600);
  assert.equal(fs.readFileSync(target, 'utf8'), 'new\n');
});

test('atomicWriteFileSync defaults to 0644 when target does not exist', () => {
  const dir = mkdir();
  const target = path.join(dir, 'fresh.md');
  atomicWriteFileSync(target, 'hello\n');
  // mode permissions are subject to the process umask; we only check the base mode bits
  // that survive a typical umask (e.g. 022 → 0644 stays 0644). We assert it's at most 0644.
  const mode = fs.statSync(target).mode & 0o777;
  assert.ok(mode <= 0o644, `expected mode <= 0644, got 0o${mode.toString(8)}`);
});

test('atomicWriteFileSync cleans up tmp on renameSync failure', () => {
  const dir = mkdir();
  const target = path.join(dir, 'out.md');
  fs.writeFileSync(target, 'original\n');
  let unlinkedTmp = null;
  const fakeFs = {
    openSync: fs.openSync,
    writeSync: fs.writeSync,
    fsyncSync: fs.fsyncSync,
    closeSync: fs.closeSync,
    renameSync: () => {
      throw new Error('boom');
    },
    unlinkSync: (p) => {
      unlinkedTmp = p;
      fs.unlinkSync(p);
    }
  };
  assert.throws(() => atomicWriteFileSync(target, 'new\n', { fs: fakeFs }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'original\n');
  assert.ok(unlinkedTmp && unlinkedTmp.startsWith(target + '.tmp-'), 'tmp file was unlinked');
});

test('atomicWriteFileSync loops on short writeSync until full buffer is written', () => {
  const dir = mkdir();
  const target = path.join(dir, 'short.md');
  const expected = 'abcdefghij'; // 10 bytes
  let calls = 0;
  const fakeFs = {
    openSync: fs.openSync,
    fsyncSync: fs.fsyncSync,
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    // Always write 3 bytes at a time (short write), respecting offset+length args.
    writeSync: (fd, buffer, offset, length) => {
      calls++;
      const chunk = Math.min(3, length);
      return fs.writeSync(fd, buffer, offset, chunk);
    }
  };
  atomicWriteFileSync(target, expected, { fs: fakeFs });
  assert.equal(fs.readFileSync(target, 'utf8'), expected);
  assert.ok(calls >= 4, `expected multiple writeSync calls due to short writes, got ${calls}`);
});

test('atomicWriteFileSync cleans up tmp on writeSync failure (no orphaned partial files)', () => {
  const dir = mkdir();
  const target = path.join(dir, 'wfail.md');
  fs.writeFileSync(target, 'original\n');
  const fakeFs = {
    openSync: fs.openSync,
    writeSync: () => { throw new Error('disk full'); },
    fsyncSync: fs.fsyncSync,
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync
  };
  assert.throws(() => atomicWriteFileSync(target, 'new\n', { fs: fakeFs }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'original\n');
  const leftovers = fs.readdirSync(dir).filter((n) => n.startsWith('wfail.md.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('atomicWriteFileSync cleans up tmp on fsyncSync failure', () => {
  const dir = mkdir();
  const target = path.join(dir, 'sfail.md');
  fs.writeFileSync(target, 'original\n');
  const fakeFs = {
    openSync: fs.openSync,
    writeSync: fs.writeSync,
    fsyncSync: () => { throw new Error('fsync failed'); },
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync
  };
  assert.throws(() => atomicWriteFileSync(target, 'new\n', { fs: fakeFs }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'original\n');
  const leftovers = fs.readdirSync(dir).filter((n) => n.startsWith('sfail.md.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('atomicWriteFileSync aborts if writeSync returns 0 or non-positive', () => {
  const dir = mkdir();
  const target = path.join(dir, 'zero.md');
  fs.writeFileSync(target, 'original\n');
  const fakeFs = {
    openSync: fs.openSync,
    fsyncSync: fs.fsyncSync,
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    writeSync: () => 0
  };
  assert.throws(() => atomicWriteFileSync(target, 'new\n', { fs: fakeFs }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'original\n');
});

test('sha256OfFile and sha256OfBuffer agree', () => {
  const dir = mkdir();
  const target = path.join(dir, 'x.md');
  const buf = Buffer.from('hello world\n', 'utf8');
  fs.writeFileSync(target, buf);
  assert.equal(sha256OfFile(target), sha256OfBuffer(buf));
});
