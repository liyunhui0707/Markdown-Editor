'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const desktop = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8');
const localRequire = createRequire(path.join(desktop, 'main.js'));

function boot(t, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmatter-save-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'original.md'), content);
  const handlers = new Map();
  vm.runInNewContext(mainSource, {
    require(name) {
      if (name === 'electron') return {
        app: { getPath: () => root, whenReady: () => new Promise(() => {}), on() {} },
        ipcMain: { handle: (key, cb) => handlers.set(key, cb), on() {} },
      };
      return localRequire(name);
    },
    __dirname: desktop, process: { platform: process.platform, env: {} },
    Buffer, URL, ArrayBuffer, setTimeout, clearTimeout, console,
  });
  return { root, invoke: (key, payload) => handlers.get(key)({}, { vaultPath: root, ...payload }) };
}

for (const header of [
  '---\ncustom: keep-me\naliases: [Synthetic Alias]\n---\n',
  '---\nsource: codex\ncustom: keep-me\n---\n',
  '---\ntags:\n  - keep-me\n---\n',
  '---\nsource: |\n  keep-me\n---\n',
  '---\nsource: one\nsource: two\n---\n',
  '---\ntags: [{nested: value}]\n---\n',
  '---\nsource: "Release: alpha"\n---\n',
  '---\nsource: "Release:"\n---\n',
  '---\nsource: "keep "\n---\n',
  "---\nsource: 'keep '\n---\n",
  '---\ntags: [safe, "keep "]\n---\n',
  "---\ntags: [safe, 'keep ']\n---\n",
  '---\n# keep this metadata comment\nsource: codex\n---\n',
  '---\r\ncustom: keep-me\r\n---\r\n',
  '\uFEFF---\ncustom: keep-me\n---\n',
  '---\ncustom: keep-me\n',
]) {
  test(`A6: save/rename rejects unsupported frontmatter without changing disk: ${JSON.stringify(header)}`, async t => {
    const original = header + '\n# Original\n\nOriginal body.\n';
    const app = boot(t, original);
    const loaded = await app.invoke('load-vault-notes', {});
    const note = loaded.notes.find(n => n.relativePath === 'original.md');
    for (const title of [note.title, 'Renamed']) {
      const result = await app.invoke('save-note', { note: { ...note, title, body: 'EDIT' } });
      assert.equal(result.ok, false);
      assert.match(result.error, /frontmatter/i);
      assert.equal(fs.readFileSync(path.join(app.root, 'original.md'), 'utf8'), original);
      assert.deepEqual(fs.readdirSync(app.root), ['original.md']);
    }
  });
}

test('A6: ordinary body saves and supported tags/source updates still work', async t => {
  const app = boot(t, '---\ntags: [old]\nsource: codex\n---\n\n# Original\n\nBody.\n');
  const loaded = await app.invoke('load-vault-notes', {});
  const note = loaded.notes[0];
  const result = await app.invoke('save-note', { note: { ...note, body: 'EDIT\n',
    frontmatter: { tags: ['new'], source: 'claude' } } });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(app.root, 'original.md'), 'utf8'),
    '---\ntags: [new]\nsource: claude\n---\n\n# Original\n\nEDIT\n');
});

test('A7: safe quoted metadata retains internal spaces on save and rename', async t => {
  const app = boot(t, '---\ntags: [  "keep  inside" , \'another tag\'  ]\nsource:   "Local  AI"  \n---\n\n# Original\n\nBody.\n');
  const loaded = await app.invoke('load-vault-notes', {});
  const note = loaded.notes[0];
  for (const title of [note.title, 'Renamed']) {
    const result = await app.invoke('save-note', { note: { ...note, title, body: 'EDIT\n' } });
    assert.equal(result.ok, true);
    const fileName = title === note.title ? 'original.md' : 'renamed.md';
    assert.equal(fs.readFileSync(path.join(app.root, fileName), 'utf8'),
      `---\ntags: [keep  inside, another tag]\nsource: Local  AI\n---\n\n# ${title}\n\nEDIT\n`);
    assert.deepEqual(fs.readdirSync(app.root), [fileName]);
  }
});

test('A6: guard checks current disk metadata, not an obsolete renderer snapshot', async t => {
  const app = boot(t, '# Original\n\nBody.\n');
  const loaded = await app.invoke('load-vault-notes', {});
  const external = '---\ncustom: external-update\n---\n\n# Original\n\nBody.\n';
  fs.writeFileSync(path.join(app.root, 'original.md'), external);
  const result = await app.invoke('save-note', { note: { ...loaded.notes[0], body: 'EDIT' } });
  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(path.join(app.root, 'original.md'), 'utf8'), external);
});

test('A6: unsupported new metadata is rejected without overwriting a plain note', async t => {
  const original = '# Original\n\nBody.\n';
  const app = boot(t, original);
  const loaded = await app.invoke('load-vault-notes', {});
  const result = await app.invoke('save-note', { note: { ...loaded.notes[0], body: 'EDIT',
    frontmatter: { tags: [], source: 'Release: alpha' } } });
  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(path.join(app.root, 'original.md'), 'utf8'), original);
});
