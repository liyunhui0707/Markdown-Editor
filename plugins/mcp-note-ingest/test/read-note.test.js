const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const readNoteModule = require('../lib/handlers/read-note');
const { buildMarkdownDocument } = require('../lib/core');

function mkVault() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'read-note-')));
}

function expectErr(fn, code) {
  try { fn(); assert.fail(`expected ToolError(${code})`); }
  catch (err) { assert.equal(err.code, code, `got ${err.code}: ${err.message}`); }
}

test('read_note returns raw text and parsed frontmatter (unquoted)', () => {
  const vault = mkVault();
  const file = path.join(vault, 'a.md');
  const text = '---\ntags: [a, b]\nsource: claude\n---\n\n# Title\n\nbody\n';
  fs.writeFileSync(file, text);
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 'a.md' });
  assert.equal(res.content[0].text, text);
  assert.deepEqual(res.structuredContent.frontmatter.tags, ['a', 'b']);
  assert.equal(res.structuredContent.frontmatter.source, 'claude');
  assert.equal(res.structuredContent.body, '# Title\n\nbody\n');
});

test('read_note round-trips a note produced by buildMarkdownDocument (quoted YAML)', () => {
  const vault = mkVault();
  const md = buildMarkdownDocument({
    title: 'T',
    body: 'b',
    source: 'claude',
    createdAt: '2026-05-16T00:00:00Z',
    model: 'sonnet',
    tags: ['chat', 'imported']
  });
  fs.writeFileSync(path.join(vault, 'r.md'), md);
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 'r.md' });
  assert.equal(res.structuredContent.frontmatter.source, 'claude');
  assert.equal(res.structuredContent.frontmatter.created_at, '2026-05-16T00:00:00Z');
  assert.equal(res.structuredContent.frontmatter.model, 'sonnet');
  assert.deepEqual(res.structuredContent.frontmatter.tags, ['chat', 'imported']);
});

test('read_note handles single-quoted frontmatter values', () => {
  const vault = mkVault();
  const text = "---\nsource: 'codex'\ntags: ['x', 'y']\n---\n\nbody\n";
  fs.writeFileSync(path.join(vault, 'q.md'), text);
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 'q.md' });
  assert.equal(res.structuredContent.frontmatter.source, 'codex');
  assert.deepEqual(res.structuredContent.frontmatter.tags, ['x', 'y']);
});

test('read_note returns empty frontmatter when no fences are present', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'p.md'), '# plain note\nno frontmatter\n');
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 'p.md' });
  assert.deepEqual(res.structuredContent.frontmatter, {});
  assert.equal(res.structuredContent.body, '# plain note\nno frontmatter\n');
});

test('read_note traversal cannot reveal contents of an outside sentinel file', () => {
  const vault = mkVault();
  const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')));
  const outsidePath = path.join(outsideDir, 'leak.md');
  const sentinel = 'SECRET-MARKER-9f2';
  fs.writeFileSync(outsidePath, `# leak\n${sentinel}\n`);

  const rel = path.relative(vault, outsidePath); // e.g. ../outside-XXX/leak.md
  let captured;
  try {
    readNoteModule.handler({ vault_path: vault, relative_path: rel });
    assert.fail('expected ToolError');
  } catch (err) {
    captured = err;
    assert.equal(err.code, 'INVALID_PATH');
  }
  const serialized = JSON.stringify({
    msg: captured.message,
    data: captured.data,
    code: captured.code
  });
  assert.equal(
    serialized.includes(sentinel),
    false,
    'sentinel must never appear in the error payload'
  );
});

test('read_note rejects in-vault symlink that points outside', () => {
  const vault = mkVault();
  const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')));
  const outsidePath = path.join(outsideDir, 'leak.md');
  fs.writeFileSync(outsidePath, '# leak\nSECRET-MARKER-9f2\n');
  fs.symlinkSync(outsidePath, path.join(vault, 'link.md'));
  expectErr(() => readNoteModule.handler({ vault_path: vault, relative_path: 'link.md' }), 'INVALID_PATH');
});

test('read_note rejects non-.md extension', () => {
  const vault = mkVault();
  expectErr(() => readNoteModule.handler({ vault_path: vault, relative_path: 'pic.png' }), 'INVALID_PATH');
});

test('read_note returns NOT_FOUND for missing file', () => {
  const vault = mkVault();
  expectErr(() => readNoteModule.handler({ vault_path: vault, relative_path: 'nope.md' }), 'NOT_FOUND');
});

test('read_note returns INVALID_PATH for a directory named *.md', () => {
  const vault = mkVault();
  fs.mkdirSync(path.join(vault, 'dir.md'));
  expectErr(() => readNoteModule.handler({ vault_path: vault, relative_path: 'dir.md' }), 'INVALID_PATH');
});

test('read_note handles escaped quotes and quoted commas in tags', () => {
  const vault = mkVault();
  const text = '---\nsource: "say \\"hi\\""\ntags: ["a, b", "c"]\n---\n\nbody\n';
  fs.writeFileSync(path.join(vault, 'e.md'), text);
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 'e.md' });
  assert.equal(res.structuredContent.frontmatter.source, 'say "hi"');
  assert.deepEqual(res.structuredContent.frontmatter.tags, ['a, b', 'c']);
});

test('read_note exposes sha256 of the on-disk bytes for use as a guard token', () => {
  const vault = mkVault();
  const crypto = require('crypto');
  const text = '# hello\nworld\n';
  fs.writeFileSync(path.join(vault, 's.md'), text);
  const expected = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 's.md' });
  assert.equal(res.structuredContent.sha256, expected);
});

test('read_note parses block-sequence YAML tags', () => {
  const vault = mkVault();
  const text = '---\ntags:\n  - alpha\n  - beta\n  - "with space"\nsource: codex\n---\n\nbody\n';
  fs.writeFileSync(path.join(vault, 'b.md'), text);
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 'b.md' });
  assert.deepEqual(res.structuredContent.frontmatter.tags, ['alpha', 'beta', 'with space']);
  assert.equal(res.structuredContent.frontmatter.source, 'codex');
});

test('read_note preserves raw text (including CRLF) in content[0].text', () => {
  const vault = mkVault();
  const buf = Buffer.from('# title\r\nbody\r\n', 'utf8');
  fs.writeFileSync(path.join(vault, 'crlf.md'), buf);
  const res = readNoteModule.handler({ vault_path: vault, relative_path: 'crlf.md' });
  assert.ok(res.content[0].text.includes('\r\n'), 'raw CRLF preserved on read');
});
