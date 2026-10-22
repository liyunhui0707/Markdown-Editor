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
const session = 'Inbox/AI Chats/codex/2026/session.md';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-session-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'ordinary.md': '# Ordinary\n\nKeep editing.',
    'source-note.md': '---\nsource: "codex"\n---\n# Imported\n\nKeep importing.',
    'Inbox/AI Chats/2026/09/legacy.md': '# Legacy\n\nKeep legacy imports.',
    'Inbox/AI Chats/Codex Output.md': '# Output\n\nKeep MCP notes.',
    [session]: '# Transcript\n\nDo not load or edit.',
    'Inbox/AI Chats/claude-code/project/session.md': '# Claude\n\nDo not edit.',
    'Inbox/AI Chats/codex-notes/allowed.md': '# Other\n\nNot an agent directory.',
  };
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  return { root, files };
}

function boot(root) {
  const handlers = new Map();
  const reads = [];
  const watchers = [];
  const timers = [];
  const fakeFs = new Proxy(fs, { get(target, key) {
    if (key === 'readFileSync') return (file, ...args) => {
      reads.push(String(file));
      return fs.readFileSync(file, ...args);
    };
    if (key === 'watch') return (_root, _options, callback) => {
      watchers.push(callback);
      return { close() {} };
    };
    return target[key];
  } });
  const electron = {
    app: { getPath: () => root, whenReady: () => new Promise(() => {}), on() {} },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
    dialog: { showOpenDialog: async () => ({ filePaths: [root], canceled: false }) },
  };
  vm.runInNewContext(mainSource, {
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'fs') return fakeFs;
      return localRequire(name);
    },
    __dirname: desktop, process: { platform: process.platform, env: {} },
    Buffer, URL, ArrayBuffer, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout, console,
  }, { filename: path.join(desktop, 'main.js') });
  return {
    handlers, reads, watchers, timers,
    invoke: (name, payload) => handlers.get(name)({}, payload),
  };
}

test('vault load excludes transcripts before reading bodies, preserving AI Imports', async (t) => {
  const { root } = fixture(t);
  const app = boot(root);
  const result = await app.invoke('load-vault-notes', { vaultPath: root });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.notes, (n) => n.relativePath).sort(), [
    'Inbox/AI Chats/2026/09/legacy.md', 'Inbox/AI Chats/Codex Output.md',
    'Inbox/AI Chats/codex-notes/allowed.md', 'ordinary.md', 'source-note.md',
  ].sort());
  assert.equal(app.reads.some((p) => /\/(codex|claude-code)\//.test(p)), false);
  assert.equal(result.notes.find((n) => n.relativePath === 'source-note.md').aiImported, true);
  assert.equal(result.notes.find((n) => n.relativePath === 'ordinary.md').aiImported, false);
  const again = await app.invoke('load-vault-notes', { vaultPath: root });
  assert.deepEqual(Array.from(again.notes, (n) => n.id), Array.from(result.notes, (n) => n.id));
});

for (const vaultSuffix of ['Inbox/AI Chats', 'Inbox/AI Chats/codex', 'Inbox/AI Chats/codex/2026']) {
  test(`selecting ${vaultSuffix} as root cannot expose transcripts`, async (t) => {
    const { root } = fixture(t);
    const selected = path.join(root, vaultSuffix);
    const app = boot(selected);
    const result = await app.invoke('load-vault-notes', { vaultPath: selected });
    assert.equal(result.ok, true);
    assert.equal(result.notes.some((n) => n.body.includes('Do not')), false);
    assert.equal(app.reads.some((p) => /\/(codex|claude-code)\//.test(p)), false);
  });
}

for (const relativePath of [session, 'Inbox/AI Chats/codex/2026/../2026/session.md']) {
  for (const action of ['save', 'rename', 'delete']) {
    test(`${action} refuses transcript path ${relativePath} without disk mutation`, async (t) => {
      const { root, files } = fixture(t);
      const app = boot(root);
      const result = action === 'delete'
        ? await app.invoke('delete-note-file', { vaultPath: root, relativePath })
        : await app.invoke('save-note', { vaultPath: root, note: {
          source: 'vault', relativePath, title: action === 'rename' ? 'Renamed' : 'Transcript',
          loadedTitle: 'Transcript', body: 'UNAUTHORIZED WRITE',
        } });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'session-library');
      assert.equal(fs.readFileSync(path.join(root, session), 'utf8'), files[session]);
      assert.equal(fs.existsSync(path.join(root, 'Inbox/AI Chats/codex/2026/renamed.md')), false);
    });
  }
}

test('symlink aliases and a symlink-selected agent root cannot bypass exclusion', async (t) => {
  const { root, files } = fixture(t);
  fs.symlinkSync(path.join(root, session), path.join(root, 'alias.md'));
  fs.symlinkSync(path.join(root, 'Inbox/AI Chats/codex'), path.join(root, 'agent-alias'));
  const app = boot(root);
  const loaded = await app.invoke('load-vault-notes', { vaultPath: path.join(root, 'agent-alias') });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.notes.length, 0);
  const saved = await app.invoke('save-note', { vaultPath: root, note: {
    source: 'vault', relativePath: 'alias.md', title: 'Alias', body: 'Do not write',
  } });
  assert.equal(saved.ok, false);
  assert.equal(fs.readFileSync(path.join(root, session), 'utf8'), files[session]);
});

test('case-insensitive directory spelling is protected, prefix lookalikes remain editable', async (t) => {
  const { root } = fixture(t);
  const app = boot(root);
  const rejected = await app.invoke('save-note', { vaultPath: root, note: {
    source: 'vault', relativePath: 'INBOX/AI CHATS/CODEX/new.md', title: 'New', body: 'No',
  } });
  assert.equal(rejected.ok, false);
  const allowed = await app.invoke('save-note', { vaultPath: root, note: {
    source: 'vault', relativePath: 'Inbox/AI Chats/codex-notes/allowed.md', title: 'Other', body: 'Updated',
  } });
  assert.equal(allowed.ok, true);
});

test('ordinary and AI import save, rename and delete remain operational', async (t) => {
  const { root } = fixture(t);
  const app = boot(root);
  const saved = await app.invoke('save-note', { vaultPath: root, note: {
    source: 'vault', relativePath: 'source-note.md', title: 'Imported', body: 'Changed',
    frontmatter: { source: 'codex', tags: ['keep'] },
  } });
  assert.equal(saved.ok, true);
  assert.match(fs.readFileSync(path.join(root, 'source-note.md'), 'utf8'), /source: codex/);
  const renamed = await app.invoke('save-note', { vaultPath: root, note: {
    source: 'vault', relativePath: 'ordinary.md', title: 'Renamed', loadedTitle: 'Ordinary', body: 'New body',
  } });
  assert.equal(renamed.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'renamed.md')), true);
  assert.equal((await app.invoke('delete-note-file', { vaultPath: root, relativePath: 'renamed.md' })).ok, true);
});

test('session IPC is absent while Local AI and vault handlers remain registered', (t) => {
  const { root } = fixture(t);
  const app = boot(root);
  assert.equal(app.handlers.has('sessionViewer:import'), false);
  for (const name of ['load-vault-notes', 'save-note', 'delete-note-file', 'ai:get-settings']) {
    assert.equal(app.handlers.has(name), true, name);
  }
});

test('loading or watching a missing agent root does not create it', async (t) => {
  const { root } = fixture(t);
  const missing = path.join(root, 'other/Inbox/AI Chats/codex');
  const app = boot(root);
  const loaded = await app.invoke('load-vault-notes', { vaultPath: missing });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.notes.length, 0);
  const watched = await app.invoke('watch-vault-folder', { vaultPath: missing });
  assert.equal(watched.ok, false);
  assert.equal(watched.reason, 'session-library');
  assert.equal(fs.existsSync(missing), false);
  assert.equal(app.watchers.length, 0);
});

test('watcher ignores agent changes but still refreshes MCP and ordinary notes', async (t) => {
  const { root } = fixture(t);
  const app = boot(root);
  await app.invoke('watch-vault-folder', { vaultPath: root });
  const notify = app.watchers[0];
  notify('change', session);
  notify('rename', 'INBOX/AI CHATS/CLAUDE-CODE/new.md');
  assert.equal(app.timers.length, 0);
  notify('change', 'Inbox/AI Chats/Codex Output.md');
  notify('change', 'ordinary.md');
  assert.equal(app.timers.length, 2);
});

test('image writes and demo seeding cannot mutate an agent directory', async (t) => {
  const { root, files } = fixture(t);
  const app = boot(root);
  await app.invoke('watch-vault-folder', { vaultPath: root });
  const image = await app.invoke('save-image-to-vault', {
    noteDir: 'Inbox/AI Chats/codex', bytes: Buffer.from('synthetic'), mime: 'image/png',
  });
  assert.equal(image.ok, false);
  assert.equal(image.reason, 'session-library');
  const seeded = await app.invoke('seed-demo-vault', { vaultPath: path.join(root, 'Inbox/AI Chats/codex') });
  assert.equal(seeded.ok, false);
  assert.equal(fs.existsSync(path.join(root, 'Inbox/AI Chats/codex/assets')), false);
  assert.equal(fs.readFileSync(path.join(root, session), 'utf8'), files[session]);
});

test('preload exposes no session-import capability and retains Local AI', () => {
  const exposed = {};
  vm.runInNewContext(fs.readFileSync(path.join(desktop, 'preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
      ipcRenderer: { invoke() {}, on() {}, removeListener() {} } }),
  });
  assert.equal(exposed.vaultApi.refreshSessions, undefined);
  assert.equal(typeof exposed.vaultApi.loadVaultNotes, 'function');
  assert.equal(typeof exposed.ai.summarizeNote, 'function');
  assert.equal(typeof exposed.ai.rewriteText, 'function');
});
