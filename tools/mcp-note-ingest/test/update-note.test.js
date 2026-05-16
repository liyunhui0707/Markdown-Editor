const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  handler: updateNote,
  createUpdateNoteHandler,
  schema: updateNoteSchema
} = require('../lib/handlers/update-note');
const { sha256OfBuffer } = require('../lib/file-io');

function mkVault() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'update-note-')));
}

function seed(vault, rel, content) {
  const p = path.join(vault, rel);
  fs.writeFileSync(p, content);
  const stat = fs.statSync(p);
  const sha = sha256OfBuffer(Buffer.from(content, 'utf8'));
  return { absPath: p, mtime: Math.round(stat.mtimeMs), sha };
}

function expectErr(fn, code) {
  try { fn(); assert.fail(`expected ToolError(${code})`); }
  catch (err) { assert.equal(err.code, code, `got ${err.code}: ${err.message}`); }
}

test('update_note schema declares anyOf for the guard requirement', () => {
  assert.ok(Array.isArray(updateNoteSchema.inputSchema.anyOf));
  const required = updateNoteSchema.inputSchema.anyOf.map((c) => c.required[0]).sort();
  assert.deepEqual(required, ['expected_mtime', 'expected_sha256']);
});

test('update_note happy path with sha guard', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'old body\n');
  const res = updateNote({
    vault_path: vault,
    relative_path: 'a.md',
    body: 'new body\n',
    expected_sha256: sha
  });
  assert.equal(res.structuredContent.written, true);
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'new body\n');
});

test('update_note happy path with mtime guard', () => {
  const vault = mkVault();
  const { mtime } = seed(vault, 'a.md', 'old\n');
  const res = updateNote({
    vault_path: vault,
    relative_path: 'a.md',
    body: 'new\n',
    expected_mtime: mtime
  });
  assert.equal(res.structuredContent.written, true);
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'new\n');
});

test('update_note rejects stale sha guard and preserves on-disk content', () => {
  const vault = mkVault();
  seed(vault, 'a.md', 'unchanged\n');
  expectErr(() => updateNote({
    vault_path: vault,
    relative_path: 'a.md',
    body: 'nope\n',
    expected_sha256: 'deadbeef'
  }), 'STALE_GUARD');
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'unchanged\n');
});

test('update_note rejects stale mtime guard', () => {
  const vault = mkVault();
  seed(vault, 'a.md', 'unchanged\n');
  expectErr(() => updateNote({
    vault_path: vault,
    relative_path: 'a.md',
    body: 'nope\n',
    expected_mtime: 1
  }), 'STALE_GUARD');
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'unchanged\n');
});

test('update_note: factory with fake fs whose renameSync throws preserves the original file', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'safe\n');
  const realFs = require('fs');
  const fakeFs = {
    statSync: realFs.statSync,
    readFileSync: realFs.readFileSync,
    openSync: realFs.openSync,
    writeSync: realFs.writeSync,
    fsyncSync: realFs.fsyncSync,
    closeSync: realFs.closeSync,
    renameSync: () => { throw new Error('boom'); },
    unlinkSync: realFs.unlinkSync
  };
  const handlerWithFake = createUpdateNoteHandler({ fs: fakeFs });
  assert.throws(() =>
    handlerWithFake({
      vault_path: vault,
      relative_path: 'a.md',
      body: 'should not stick\n',
      expected_sha256: sha
    })
  );
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'safe\n');
});

test('update_note refuses to create a non-existent note (NOT_FOUND)', () => {
  const vault = mkVault();
  expectErr(() => updateNote({
    vault_path: vault,
    relative_path: 'nope.md',
    body: 'x',
    expected_sha256: 'deadbeef'
  }), 'NOT_FOUND');
  assert.equal(fs.existsSync(path.join(vault, 'nope.md')), false);
});

test('update_note rejects path traversal', () => {
  const vault = mkVault();
  expectErr(() => updateNote({
    vault_path: vault,
    relative_path: '../leak.md',
    body: 'x',
    expected_sha256: 'deadbeef'
  }), 'INVALID_PATH');
});

test('update_note requires at least one guard', () => {
  const vault = mkVault();
  seed(vault, 'a.md', 'x\n');
  expectErr(() => updateNote({
    vault_path: vault,
    relative_path: 'a.md',
    body: 'y\n'
  }), 'GUARD_REQUIRED');
});

test('update_note rejects non-.md extension', () => {
  const vault = mkVault();
  expectErr(() => updateNote({
    vault_path: vault,
    relative_path: 'foo.png',
    body: 'x',
    expected_sha256: 'deadbeef'
  }), 'INVALID_PATH');
});

test('update_note LF-normalizes CRLF input', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'old\n');
  updateNote({
    vault_path: vault,
    relative_path: 'a.md',
    body: 'a\r\nb\r\n',
    expected_sha256: sha
  });
  const bytes = fs.readFileSync(path.join(vault, 'a.md'));
  assert.equal(bytes.indexOf(0x0d), -1, 'no CR byte should remain');
  assert.equal(bytes.toString('utf8'), 'a\nb\n');
});

test('update_note: TOCTOU — concurrent edit between pre-flight and rename triggers STALE_GUARD; concurrent content preserved', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'original\n');
  const realFs = require('fs');
  // Wrap fs so the first writeSync (preparing the temp file) triggers a concurrent
  // mutation of the target. The verifyBeforeRename re-check should see the new sha
  // and abort the rename.
  let mutated = false;
  const fakeFs = {
    statSync: realFs.statSync,
    readFileSync: realFs.readFileSync,
    openSync: realFs.openSync,
    writeSync: (...args) => {
      const r = realFs.writeSync(...args);
      if (!mutated) {
        mutated = true;
        realFs.writeFileSync(path.join(vault, 'a.md'), 'concurrent edit\n');
      }
      return r;
    },
    fsyncSync: realFs.fsyncSync,
    closeSync: realFs.closeSync,
    renameSync: realFs.renameSync,
    unlinkSync: realFs.unlinkSync
  };
  const handlerWithFake = createUpdateNoteHandler({ fs: fakeFs });
  expectErr(
    () => handlerWithFake({
      vault_path: vault,
      relative_path: 'a.md',
      body: 'will be lost\n',
      expected_sha256: sha
    }),
    'STALE_GUARD'
  );
  // Concurrent content survives.
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'concurrent edit\n');
  // No stray tmp files left.
  const leftovers = fs.readdirSync(vault).filter((n) => n.startsWith('a.md.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('update_note rejects directory named *.md', () => {
  const vault = mkVault();
  fs.mkdirSync(path.join(vault, 'd.md'));
  expectErr(() => updateNote({
    vault_path: vault,
    relative_path: 'd.md',
    body: 'x',
    expected_sha256: 'deadbeef'
  }), 'INVALID_PATH');
  // directory still exists
  assert.equal(fs.statSync(path.join(vault, 'd.md')).isDirectory(), true);
});
