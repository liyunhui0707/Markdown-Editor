const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  validateReadSideVault,
  resolveRelativePath,
  listMarkdownFiles
} = require('../lib/vault-fs');
const { ToolError } = require('../lib/tool-error');

function mkdtemp(prefix = 'vault-fs-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function assertToolErr(fn, code) {
  try {
    fn();
    assert.fail(`expected ToolError(${code})`);
  } catch (err) {
    assert.ok(err instanceof ToolError, `expected ToolError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
  }
}

test('validateReadSideVault rejects empty / non-string / relative input as INVALID_PATH', () => {
  assertToolErr(() => validateReadSideVault(''), 'INVALID_PATH');
  assertToolErr(() => validateReadSideVault('   '), 'INVALID_PATH');
  assertToolErr(() => validateReadSideVault('relative/path'), 'INVALID_PATH');
  assertToolErr(() => validateReadSideVault(null), 'INVALID_PATH');
  assertToolErr(() => validateReadSideVault(undefined), 'INVALID_PATH');
  assertToolErr(() => validateReadSideVault(42), 'INVALID_PATH');
});

test('validateReadSideVault returns NOT_FOUND for missing absolute path (and does not create it)', () => {
  const parent = mkdtemp();
  const missing = path.join(parent, 'does-not-exist');
  assertToolErr(() => validateReadSideVault(missing), 'NOT_FOUND');
  assert.equal(fs.existsSync(missing), false, 'must not create the missing path');
});

test('validateReadSideVault rejects an absolute path that is a regular file', () => {
  const parent = mkdtemp();
  const filePath = path.join(parent, 'not-a-dir.txt');
  fs.writeFileSync(filePath, 'hi');
  assertToolErr(() => validateReadSideVault(filePath), 'INVALID_PATH');
});

test('validateReadSideVault returns canonical real path (resolves symlinks)', () => {
  const real = mkdtemp();
  const linkParent = mkdtemp('vault-link-');
  const link = path.join(linkParent, 'vault');
  fs.symlinkSync(real, link, 'dir');
  const out = validateReadSideVault(link);
  assert.equal(out, real);
});

test('validateReadSideVault canonicalises trailing slash to non-trailing-slash', () => {
  const vault = mkdtemp();
  const withSlash = vault.endsWith(path.sep) ? vault : vault + path.sep;
  const a = validateReadSideVault(withSlash);
  const b = validateReadSideVault(vault);
  assert.equal(a, b);
});

test('resolveRelativePath maps a simple in-vault relative path to its absolute', () => {
  const vault = mkdtemp();
  fs.writeFileSync(path.join(vault, 'a.md'), '# a');
  fs.mkdirSync(path.join(vault, 'sub'));
  fs.writeFileSync(path.join(vault, 'sub', 'b.md'), '# b');
  assert.equal(resolveRelativePath(vault, 'a.md'), path.join(vault, 'a.md'));
  assert.equal(resolveRelativePath(vault, 'sub/b.md'), path.join(vault, 'sub', 'b.md'));
});

test('resolveRelativePath rejects empty, non-string, absolute, and traversing paths', () => {
  const vault = mkdtemp();
  assertToolErr(() => resolveRelativePath(vault, ''), 'INVALID_PATH');
  assertToolErr(() => resolveRelativePath(vault, null), 'INVALID_PATH');
  assertToolErr(() => resolveRelativePath(vault, 42), 'INVALID_PATH');
  assertToolErr(() => resolveRelativePath(vault, '/tmp/outside.md'), 'INVALID_PATH');
  assertToolErr(() => resolveRelativePath(vault, '../outside.md'), 'INVALID_PATH');
  assertToolErr(() => resolveRelativePath(vault, 'sub/../../outside.md'), 'INVALID_PATH');
});

test('resolveRelativePath rejects in-vault symlink whose target is outside the vault', () => {
  const vault = mkdtemp();
  const outside = mkdtemp('outside-');
  const outsideFile = path.join(outside, 'leak.md');
  fs.writeFileSync(outsideFile, '# leak');
  fs.symlinkSync(outsideFile, path.join(vault, 'leak.md'));
  assertToolErr(() => resolveRelativePath(vault, 'leak.md'), 'INVALID_PATH');
});

test('resolveRelativePath rejects a path that traverses through a symlinked-out subdirectory', () => {
  const vault = mkdtemp();
  const outside = mkdtemp('outside-');
  fs.writeFileSync(path.join(outside, 'leak.md'), '# leak');
  fs.symlinkSync(outside, path.join(vault, 'bridge'), 'dir');
  assertToolErr(() => resolveRelativePath(vault, 'bridge/leak.md'), 'INVALID_PATH');
});

test('resolveRelativePath allows an in-vault symlink that points to another in-vault file', () => {
  const vault = mkdtemp();
  const target = path.join(vault, 'target.md');
  fs.writeFileSync(target, '# target');
  fs.symlinkSync(target, path.join(vault, 'alias.md'));
  const resolved = resolveRelativePath(vault, 'alias.md');
  assert.equal(resolved, target);
});

test('listMarkdownFiles returns md files only and skips hidden entries', () => {
  const vault = mkdtemp();
  fs.writeFileSync(path.join(vault, 'a.md'), '# A\n\nbody');
  fs.mkdirSync(path.join(vault, 'nested'));
  fs.writeFileSync(path.join(vault, 'nested', 'b.md'), '# B');
  fs.writeFileSync(path.join(vault, 'nested', 'c.md'), 'no heading');
  fs.writeFileSync(path.join(vault, 'image.png'), 'png');
  fs.writeFileSync(path.join(vault, '.hidden.md'), '# hidden');
  fs.mkdirSync(path.join(vault, '.obsidian'));
  fs.writeFileSync(path.join(vault, '.obsidian', 'cache.md'), '# c');

  const notes = listMarkdownFiles(vault);
  const rels = notes.map((n) => n.relative_path).sort();
  assert.deepEqual(rels, ['a.md', 'nested/b.md', 'nested/c.md']);
  for (const note of notes) {
    assert.equal(typeof note.size, 'number');
    assert.equal(typeof note.mtime, 'number');
    assert.equal(typeof note.title, 'string');
  }
  const titleA = notes.find((n) => n.relative_path === 'a.md').title;
  const titleC = notes.find((n) => n.relative_path === 'nested/c.md').title;
  assert.equal(titleA, 'A', 'title extracted from H1');
  assert.equal(titleC, 'c', 'title falls back to basename when no H1');
});

test('listMarkdownFiles honors subdir option and rejects subdir escape', () => {
  const vault = mkdtemp();
  fs.writeFileSync(path.join(vault, 'top.md'), '# top');
  fs.mkdirSync(path.join(vault, 'inner'));
  fs.writeFileSync(path.join(vault, 'inner', 'x.md'), '# x');
  fs.writeFileSync(path.join(vault, 'inner', 'y.md'), '# y');

  const inner = listMarkdownFiles(vault, { subdir: 'inner' });
  const rels = inner.map((n) => n.relative_path).sort();
  assert.deepEqual(rels, ['inner/x.md', 'inner/y.md']);

  assertToolErr(() => listMarkdownFiles(vault, { subdir: '../outside' }), 'INVALID_PATH');
  assertToolErr(() => listMarkdownFiles(vault, { subdir: 'no-such-dir' }), 'NOT_FOUND');
});

test('listMarkdownFiles honors limit option', () => {
  const vault = mkdtemp();
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(vault, `n${i}.md`), `# n${i}`);
  const out = listMarkdownFiles(vault, { limit: 2 });
  assert.equal(out.length, 2);
});

test('listMarkdownFiles honors since option (mtime > since)', () => {
  const vault = mkdtemp();
  const a = path.join(vault, 'a.md');
  const b = path.join(vault, 'b.md');
  fs.writeFileSync(a, '# a');
  fs.writeFileSync(b, '# b');
  const tA = new Date(2025, 0, 1).getTime();
  const tB = new Date(2026, 0, 1).getTime();
  fs.utimesSync(a, tA / 1000, tA / 1000);
  fs.utimesSync(b, tB / 1000, tB / 1000);

  const out = listMarkdownFiles(vault, { since: tA + 1000 });
  const rels = out.map((n) => n.relative_path).sort();
  assert.deepEqual(rels, ['b.md']);
});

test('listMarkdownFiles returns empty array for an empty vault', () => {
  const vault = mkdtemp();
  assert.deepEqual(listMarkdownFiles(vault), []);
});
