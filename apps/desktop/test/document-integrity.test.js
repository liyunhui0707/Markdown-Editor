'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// No real notes or profiles: each case owns an isolated synthetic directory.
// Keep failed fixtures for diagnosis rather than recursively deleting anything.
function fixture(content, options = {}) {
  const { createDocumentService } = require('../lib/document-service');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-integrity-')));
  const filePath = path.join(root, 'unrelated-file-name.md');
  fs.writeFileSync(filePath, content, { flag: 'wx', mode: 0o640 });
  // Experimental replacement is confined to this synthetic private temp root.
  // The production/default service must refuse uncoordinated replacement.
  const service = createDocumentService({ ...options, unsafeExperimentalRoot: root });
  const opened = service.open(filePath);
  assert.equal(opened.ok, true, JSON.stringify({ code: opened.code, error: opened.error }));
  return { root, filePath, service, document: opened.document };
}
function append(document, text) {
  const result = document.edit({ from: document.text.length, to: document.text.length, insert: text });
  assert.equal(result.ok, true);
}
function saved(f, expected) {
  const result = f.service.save(f.document);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(fs.readFileSync(f.filePath), Buffer.from(expected));
  assert.equal(f.document.dirty, false);
  const reopened = f.service.open(f.filePath);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.document.text, expected.replace(/^\uFEFF/, ''));
  return result;
}

test('1: H1 without blank separator never consumes the following body line', () => {
  const original = '# Title\nDO NOT LOSE THIS LINE\nSecond paragraph.\n';
  const f = fixture(original);
  assert.equal(f.document.text, original);
  assert.equal(f.document.filePath, f.filePath);
  append(f.document, 'Edited.\n');
  saved(f, original + 'Edited.\n');
});

test('2: leading four-space code and all untouched indentation survive editing', () => {
  for (const original of ['    const value = 1;\n\nText.\n', '# Title\n\n    const value = 1;\n\nText.\n']) {
    const f = fixture(original);
    assert.equal(f.document.text, original);
    append(f.document, 'Added.\n');
    saved(f, original + 'Added.\n');
  }
});

test('3: no H1 is injected and a changed H1 never renames a file', () => {
  const f = fixture('Ordinary **Markdown**.\n');
  append(f.document, 'Still no H1.\n');
  saved(f, 'Ordinary **Markdown**.\nStill no H1.\n');
  assert.deepEqual(fs.readdirSync(f.root), ['unrelated-file-name.md']);
  const g = fixture('# Heading\nBody\n');
  assert.equal(g.document.edit({ from: 2, to: 9, insert: 'Different' }).ok, true);
  saved(g, '# Different\nBody\n');
  assert.deepEqual(fs.readdirSync(g.root), ['unrelated-file-name.md']);
});

test('4: open/close and unchanged Save perform no write, rename or permission mutation', () => {
  const mutations = [];
  const io = Object.create(fs);
  for (const name of ['writeSync', 'writeFileSync', 'renameSync', 'unlinkSync', 'fchmodSync', 'fchownSync']) {
    io[name] = (...args) => { mutations.push(name); return fs[name](...args); };
  }
  const bytes = Buffer.from('\uFEFF---\r\ncustom: keep\r\n---\r\n# T\r\n  body  \r\n');
  const f = fixture(bytes, { fs: io });
  const stat = fs.statSync(f.filePath, { bigint: true });
  assert.deepEqual(f.document.originalBytes, bytes);
  assert.equal(f.service.save(f.document).status, 'unchanged');
  assert.equal(f.service.close(f.document).ok, true);
  assert.deepEqual(mutations, []);
  assert.deepEqual(fs.readFileSync(f.filePath), bytes);
  assert.equal(fs.statSync(f.filePath, { bigint: true }).mtimeNs, stat.mtimeNs);
});

test('4b: edit then undo to exact source baseline is also a no-op Save', () => {
  const f = fixture('Keep me.\n');
  const before = fs.statSync(f.filePath, { bigint: true });
  append(f.document, 'TEMP');
  assert.equal(f.document.dirty, true);
  f.document.edit({ from: 9, to: 13, insert: '' });
  assert.equal(f.document.dirty, false);
  assert.equal(f.service.save(f.document).status, 'unchanged');
  assert.equal(fs.statSync(f.filePath, { bigint: true }).mtimeNs, before.mtimeNs);
});

test('5: stale save reports conflict and retains external disk content and local edits', () => {
  const f = fixture('Baseline.\n');
  append(f.document, 'LOCAL\n');
  fs.writeFileSync(f.filePath, 'EXTERNAL\n');
  assert.equal(f.service.checkExternal(f.document).status, 'conflict');
  const result = f.service.save(f.document);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'conflict');
  assert.equal(result.committed, false);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'EXTERNAL\n');
  assert.equal(f.document.text, 'Baseline.\nLOCAL\n');
  assert.equal(f.document.dirty, true);
  assert.deepEqual(fs.readdirSync(f.root), ['unrelated-file-name.md']);
});

test('5b: atomic external replacement is a conflict even with identical bytes', () => {
  const f = fixture('Baseline.\n');
  append(f.document, 'LOCAL\n');
  const other = path.join(f.root, 'external-replacement');
  fs.writeFileSync(other, 'Baseline.\n');
  fs.renameSync(other, f.filePath);
  assert.equal(f.service.save(f.document).status, 'conflict');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'Baseline.\n');
  assert.equal(f.document.dirty, true);
});

test('6a: parser failure does not clear current Markdown and blocks unsafe Save', () => {
  const f = fixture('Original.\n');
  append(f.document, 'LOCAL\n');
  assert.equal(f.document.parse(() => { throw Error('synthetic parser failure'); }).ok, false);
  assert.equal(f.service.save(f.document).status, 'blocked');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'Original.\n');
  assert.equal(f.document.text, 'Original.\nLOCAL\n');
  assert.equal(f.document.dirty, true);
  assert.equal(f.document.parse(text => ({ type: 'source', text })).ok, true);
  saved(f, 'Original.\nLOCAL\n');
});

test('6b: thrown, empty, invalid and normalized serializer output never reaches disk', () => {
  for (const serialize of [() => { throw Error('synthetic serialization failure'); },
    () => '', () => undefined, () => null, () => Buffer.from('bad'), text => text.trim()]) {
    const f = fixture('Original.\n');
    append(f.document, 'LOCAL\n');
    const result = f.service.save(f.document, { serialize });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'Original.\n');
    assert.equal(f.document.text, 'Original.\nLOCAL\n');
    assert.equal(f.document.dirty, true);
    // Retrying without explicit recovery must not silently clear the failure.
    assert.equal(f.service.save(f.document).status, 'blocked');
    f.document.recoverSource();
    saved(f, 'Original.\nLOCAL\n');
  }
});

test('6c: failed parse during open returns the intact document for recovery', () => {
  const f = fixture('Never clear this.\n');
  const result = f.service.open(f.filePath, { parse() { throw Error('synthetic failure'); } });
  assert.equal(result.ok, false);
  assert.equal(result.document.text, 'Never clear this.\n');
  assert.deepEqual(result.document.originalBytes, Buffer.from('Never clear this.\n'));
  assert.equal(f.service.save(result.document).status, 'blocked');
});

test('explicit intentional deletion can save a genuinely empty document', () => {
  const f = fixture('Delete this intentionally.\n');
  f.document.edit({ from: 0, to: f.document.text.length, insert: '' });
  saved(f, '');
});

test('BOM, LF, CRLF, mixed endings, CR-only and missing final newline stay exact', () => {
  for (const original of ['\uFEFF# T\r\nBody\r\n', '# T\nBody\n',
    '# T\r\nBody\n\tend\r', 'First\rSecond\r', 'No final newline']) {
    const f = fixture(original);
    assert.equal(f.document.bom, original.startsWith('\uFEFF'));
    assert.equal(f.document.encoding, 'utf-8');
    append(f.document, ' suffix');
    saved(f, original + ' suffix');
  }
});

test('custom Front Matter and unknown Markdown remain untouched outside an explicit edit', () => {
  const original = '---\r\n# keep YAML comment\r\naliases: [A, B]\r\ncustom: |\r\n  keep\r\n---\r\n'
    + '# T\r\n    code\r\n[^note]: keep\r\n:::unknown custom\r\n<div data-x="yes">raw</div>\r\n'
    + '$$\r\nx+y\r\n$$\r\n![local](../images/a.png)\r\n';
  const f = fixture(original);
  append(f.document, 'A safe explicit source addition.\r\n');
  saved(f, original + 'A safe explicit source addition.\r\n');
});

test('lossy real remark conversion is rejected rather than rewriting untouched syntax', async () => {
  const [{ unified }, { default: parse }, { default: stringify }] = await Promise.all([
    import('unified'), import('remark-parse'), import('remark-stringify'),
  ]);
  const processor = unified().use(parse).use(stringify);
  const f = fixture('#   Unnormalized\n\n:::unknown\n');
  assert.equal(f.document.parse(text => processor.parse(text)).ok, true);
  append(f.document, 'LOCAL\n');
  const result = f.service.save(f.document, {
    serialize: text => processor.stringify(processor.parse(text)),
  });
  assert.equal(result.status, 'blocked');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), '#   Unnormalized\n\n:::unknown\n');
  assert.equal(f.document.text, '#   Unnormalized\n\n:::unknown\nLOCAL\n');
});

test('original bytes are defensive copies and UTF-16 surrogate splits cannot corrupt text', () => {
  const f = fixture('😀中文\n');
  const copy = f.document.originalBytes;
  copy.fill(0);
  assert.deepEqual(f.document.originalBytes, Buffer.from('😀中文\n'));
  for (const edit of [{ from: 1, to: 2, insert: '' }, { from: 0, to: 0, insert: '\ud800' },
    { from: -1, to: 0, insert: '' }, { from: 0, to: 99, insert: '' }]) {
    assert.equal(f.document.edit(edit).ok, false);
    assert.equal(f.document.text, '😀中文\n');
  }
});

test('closing a document revokes the session without discarding its in-memory text', () => {
  const f = fixture('Baseline\n');
  append(f.document, 'Unsaved\n');
  assert.equal(f.service.close(f.document).ok, true);
  assert.equal(f.service.save(f.document).ok, false);
  assert.equal(f.document.text, 'Baseline\nUnsaved\n');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'Baseline\n');
});

test('document paths and identities cannot be redirected by mutating a view', () => {
  const f = fixture('Original\n');
  assert.throws(() => { f.document.filePath = path.join(f.root, 'other.md'); }, TypeError);
  const identity = f.document.identity;
  assert.throws(() => { identity.ino = 'forged'; }, TypeError);
  append(f.document, 'LOCAL\n');
  saved(f, 'Original\nLOCAL\n');
});

test('conversion in progress cannot re-enter Save before parser success is known', () => {
  const f = fixture('Original\n');
  append(f.document, 'LOCAL\n');
  let nested;
  const parsed = f.document.parse(() => {
    nested = f.service.save(f.document);
    throw Error('Synthetic parser failure after attempted reentry');
  });
  assert.equal(parsed.ok, false);
  assert.equal(nested.status, 'blocked');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'Original\n');
  assert.equal(f.document.text, 'Original\nLOCAL\n');
});

test('async conversion is refused, and side-effectful conversion keeps its edits but cannot save them', () => {
  const f = fixture('Original\n');
  assert.equal(f.document.parse(async () => { throw Error('Synthetic async parser failure'); }).ok, false);
  f.document.recoverSource();
  const result = f.service.save(f.document, { serialize: text => {
    append(f.document, 'CHANGED DURING CONVERSION\n');
    return text;
  } });
  assert.equal(result.status, 'blocked');
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), 'Original\n');
  assert.equal(f.document.text, 'Original\nCHANGED DURING CONVERSION\n');
});
