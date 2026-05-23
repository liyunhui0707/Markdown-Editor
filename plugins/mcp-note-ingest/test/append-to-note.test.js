const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  handler: appendToNote,
  createAppendToNoteHandler
} = require('../lib/handlers/append-to-note');
const { sha256OfBuffer } = require('../lib/file-io');

function mkVault() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'append-')));
}

function seed(vault, rel, content) {
  const p = path.join(vault, rel);
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(p, content);
  } else {
    fs.writeFileSync(p, content);
  }
  const buf = fs.readFileSync(p);
  return { absPath: p, sha: sha256OfBuffer(buf) };
}

function expectErr(fn, code) {
  try { fn(); assert.fail(`expected ToolError(${code})`); }
  catch (err) { assert.equal(err.code, code, `got ${err.code}: ${err.message}`); }
}

test('append: "body\\n" + "new block" -> "body\\n\\nnew block\\n"', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'body\n');
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'new block', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'body\n\nnew block\n');
});

test('append: no trailing newline -> still single blank-line separator', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'body');
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'new block', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'body\n\nnew block\n');
});

test('append: many trailing newlines collapse to a single separator', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'body\n\n\n\n');
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'new block', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'body\n\nnew block\n');
});

test('append: existing CRLF gets LF-normalized; no CR byte remains', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', Buffer.from('body\r\n'));
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'new block', expected_sha256: sha });
  const bytes = fs.readFileSync(path.join(vault, 'a.md'));
  assert.equal(bytes.indexOf(0x0d), -1, 'no CR byte');
  assert.equal(bytes.toString('utf8'), 'body\n\nnew block\n');
});

test('append: existing mixed CRLF body gets LF-normalized in place', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', Buffer.from('a\r\nb\r\nc'));
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'new block', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'a\nb\nc\n\nnew block\n');
});

test('append: block with leading newlines: leading collapsed', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'body\n');
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: '\n\n\nfoo', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'body\n\nfoo\n');
});

test('append: block without trailing newline gets one', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'body\n');
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'foo', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'body\n\nfoo\n');
});

test('append: empty existing file + block -> "block\\n"', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', '');
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'new block', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'new block\n');
});

test('append: empty block on LF-normalized file keeps content byte-identical', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'body\n');
  // Seed an older mtime to avoid same-tick flake on the "mtime advances" expectation.
  const old = Date.now() / 1000 - 5;
  fs.utimesSync(path.join(vault, 'a.md'), old, old);
  const res = appendToNote({ vault_path: vault, relative_path: 'a.md', block: '', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'body\n');
  assert.equal(res.structuredContent.new_sha256, sha);
});

test('append: empty block on CRLF file normalizes to LF (content changes)', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', Buffer.from('body\r\n'));
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: '', expected_sha256: sha });
  const bytes = fs.readFileSync(path.join(vault, 'a.md'));
  assert.equal(bytes.indexOf(0x0d), -1);
  assert.equal(bytes.toString('utf8'), 'body\n');
});

test('append: missing block -> INVALID_ARGS, no write', () => {
  const vault = mkVault();
  const { sha, absPath } = seed(vault, 'a.md', 'body\n');
  const before = fs.readFileSync(absPath);
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'a.md', expected_sha256: sha }), 'INVALID_ARGS');
  assert.deepEqual(fs.readFileSync(absPath), before);
});

test('append: non-string block -> INVALID_ARGS, no write', () => {
  const vault = mkVault();
  const { sha, absPath } = seed(vault, 'a.md', 'body\n');
  const before = fs.readFileSync(absPath);
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'a.md', block: 123, expected_sha256: sha }), 'INVALID_ARGS');
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'a.md', block: { x: 1 }, expected_sha256: sha }), 'INVALID_ARGS');
  assert.deepEqual(fs.readFileSync(absPath), before);
});

test('append: stale guard -> STALE_GUARD, no write', () => {
  const vault = mkVault();
  const { absPath } = seed(vault, 'a.md', 'body\n');
  const before = fs.readFileSync(absPath);
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'x', expected_sha256: 'deadbeef' }), 'STALE_GUARD');
  assert.deepEqual(fs.readFileSync(absPath), before);
});

test('append: factory with throwing renameSync preserves original', () => {
  const vault = mkVault();
  const { sha, absPath } = seed(vault, 'a.md', 'safe\n');
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
  const handlerWithFake = createAppendToNoteHandler({ fs: fakeFs });
  assert.throws(() =>
    handlerWithFake({ vault_path: vault, relative_path: 'a.md', block: 'x', expected_sha256: sha })
  );
  assert.equal(fs.readFileSync(absPath, 'utf8'), 'safe\n');
});

test('append: TOCTOU — concurrent edit between pre-flight and rename triggers STALE_GUARD; concurrent content preserved', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'original\n');
  const realFs = require('fs');
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
  const handlerWithFake = createAppendToNoteHandler({ fs: fakeFs });
  expectErr(
    () => handlerWithFake({
      vault_path: vault,
      relative_path: 'a.md',
      block: 'lost block',
      expected_sha256: sha
    }),
    'STALE_GUARD'
  );
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'concurrent edit\n');
  const leftovers = fs.readdirSync(vault).filter((n) => n.startsWith('a.md.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('append: missing file -> NOT_FOUND', () => {
  const vault = mkVault();
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'nope.md', block: 'x', expected_sha256: 'd' }), 'NOT_FOUND');
});

test('append: directory named *.md -> INVALID_PATH', () => {
  const vault = mkVault();
  fs.mkdirSync(path.join(vault, 'd.md'));
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'd.md', block: 'x', expected_sha256: 'd' }), 'INVALID_PATH');
});

test('append: path traversal -> INVALID_PATH', () => {
  const vault = mkVault();
  expectErr(() => appendToNote({ vault_path: vault, relative_path: '../leak.md', block: 'x', expected_sha256: 'd' }), 'INVALID_PATH');
});

test('append: non-.md extension -> INVALID_PATH', () => {
  const vault = mkVault();
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'foo.png', block: 'x', expected_sha256: 'd' }), 'INVALID_PATH');
});

test('append: block CRLF gets LF-normalized', () => {
  const vault = mkVault();
  const { sha } = seed(vault, 'a.md', 'body\n');
  appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'a\r\nb', expected_sha256: sha });
  assert.equal(fs.readFileSync(path.join(vault, 'a.md'), 'utf8'), 'body\n\na\nb\n');
});

test('append: missing guard -> GUARD_REQUIRED', () => {
  const vault = mkVault();
  seed(vault, 'a.md', 'body\n');
  expectErr(() => appendToNote({ vault_path: vault, relative_path: 'a.md', block: 'x' }), 'GUARD_REQUIRED');
});
