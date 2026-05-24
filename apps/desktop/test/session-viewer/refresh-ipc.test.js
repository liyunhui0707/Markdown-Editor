/* Stage S2 — refresh-ipc module.
   Run focused: node --test test/session-viewer/refresh-ipc.test.js

   Tests T-S2-1..T-S2-5 from .workflow/artifacts/s2-04-implementation-plan.md.
   The module is a thin wrapper around the S1 importers, registered as
   ipcMain.handle('sessionViewer:import'). Importers are injected at
   register-time so tests don't load real .mjs / hit the filesystem.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const MODULE_REL = '../../lib/session-import-ipc.js';

function loadModule() {
  delete require.cache[require.resolve(MODULE_REL)];
  return require(MODULE_REL);
}

function makeMockIpc() {
  const handlers = {};
  return {
    handle(channel, fn) {
      handlers[channel] = fn;
    },
    handlers,
    invoke(channel, payload) {
      const fn = handlers[channel];
      if (!fn) throw new Error('no handler for ' + channel);
      return fn({}, payload);
    },
  };
}

function makeMockImporters() {
  const calls = { claude: [], codex: [] };
  let claudeImpl = async () => ({ imported: 0, skipped: 0, errors: 0 });
  let codexImpl = async () => ({ imported: 0, skipped: 0, errors: 0 });
  return {
    calls,
    setClaudeImpl(fn) { claudeImpl = fn; },
    setCodexImpl(fn) { codexImpl = fn; },
    runClaudeImport: async (args) => { calls.claude.push(args); return claudeImpl(args); },
    runCodexImport: async (args) => { calls.codex.push(args); return codexImpl(args); },
  };
}

test('S2-1: claude outputBase = <vault>/Inbox/AI Chats/claude-code; codex outputBase = <vault>/Inbox/AI Chats/codex', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const vaultPath = '/some/vault';
  const result = await ipc.invoke('sessionViewer:import', { vaultPath });
  assert.equal(result.ok, true);

  assert.equal(mock.calls.claude.length, 1);
  assert.equal(mock.calls.codex.length, 1);
  assert.equal(
    mock.calls.claude[0].outputBase,
    path.join(vaultPath, 'Inbox/AI Chats', 'claude-code'),
  );
  assert.equal(
    mock.calls.codex[0].outputBase,
    path.join(vaultPath, 'Inbox/AI Chats', 'codex'),
  );
  assert.equal(
    mock.calls.claude[0].sourceRoot,
    path.join(os.homedir(), '.claude', 'projects'),
  );
  assert.equal(
    mock.calls.codex[0].sourceRoot,
    path.join(os.homedir(), '.codex', 'sessions'),
  );
});

test('S2-1: success response carries both summaries', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  mock.setClaudeImpl(async () => ({ imported: 3, skipped: 1, errors: 0 }));
  mock.setCodexImpl(async () => ({ imported: 2, skipped: 0, errors: 0, note: 'no-source' }));
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const result = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.deepEqual(result, {
    ok: true,
    claude: { imported: 3, skipped: 1, errors: 0 },
    codex: { imported: 2, skipped: 0, errors: 0, note: 'no-source' },
  });
});

test('S2-2: missing vaultPath -> {ok:false, error}; importers NOT invoked', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  for (const bad of [undefined, null, '', 0, {}]) {
    const result = await ipc.invoke('sessionViewer:import', bad === undefined ? undefined : (typeof bad === 'object' && bad !== null ? bad : { vaultPath: bad }));
    assert.equal(result.ok, false);
    assert.match(result.error, /vault/i);
  }
  assert.equal(mock.calls.claude.length, 0);
  assert.equal(mock.calls.codex.length, 0);
});

test('S2-3: single-flight — concurrent call returns {ok:false, error}; original still resolves', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  let release;
  const hang = new Promise((resolve) => { release = resolve; });
  mock.setClaudeImpl(() => hang.then(() => ({ imported: 1, skipped: 0, errors: 0 })));
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const first = ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  const second = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(second.ok, false);
  assert.match(second.error, /in progress/i);

  release({ imported: 1, skipped: 0, errors: 0 });
  const firstResult = await first;
  assert.equal(firstResult.ok, true);

  // After completion, a fresh call should proceed (lock released).
  mock.setClaudeImpl(async () => ({ imported: 5, skipped: 0, errors: 0 }));
  const third = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(third.ok, true);
  assert.equal(third.claude.imported, 5);
});

test('S2-4: importer rejection -> {ok:false, error}; not re-thrown; lock released', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  mock.setClaudeImpl(async () => { throw new Error('disk full'); });
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const result = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(result.ok, false);
  assert.match(result.error, /disk full/);

  // Lock released — next call must proceed.
  mock.setClaudeImpl(async () => ({ imported: 1, skipped: 0, errors: 0 }));
  const second = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(second.ok, true);
});

test('S2-4b: lock stays held when one importer rejects while the other is still running (round-1 diff-review M2 fix)', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  let codexRelease;
  const codexHang = new Promise((res) => { codexRelease = res; });
  let codexInProgressAfterClaudeReject = false;
  mock.setClaudeImpl(async () => { throw new Error('claude blew up'); });
  mock.setCodexImpl(() => codexHang.then(() => ({ imported: 1, skipped: 0, errors: 0 })));
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const first = ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  // While codex is still running, a second call should be rejected (lock held).
  await new Promise((res) => setTimeout(res, 5));
  const second = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(second.ok, false);
  assert.match(second.error, /in progress/i, 'lock must still be held even though claude rejected');
  codexInProgressAfterClaudeReject = true;

  codexRelease();
  const firstResult = await first;
  // First returns ok:false because claude rejected; the run completed cleanly.
  assert.equal(firstResult.ok, false);
  assert.match(firstResult.error, /claude blew up/);
  assert.ok(codexInProgressAfterClaudeReject);

  // Lock released — fresh call proceeds.
  mock.setClaudeImpl(async () => ({ imported: 7, skipped: 0, errors: 0 }));
  mock.setCodexImpl(async () => ({ imported: 8, skipped: 0, errors: 0 }));
  const third = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(third.ok, true);
});

test('S2-5: both importers run in parallel (not sequential)', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  const claudeStart = [];
  const codexStart = [];
  let claudeRelease;
  let codexRelease;
  const claudeHang = new Promise((res) => { claudeRelease = res; });
  const codexHang = new Promise((res) => { codexRelease = res; });
  mock.setClaudeImpl(() => {
    claudeStart.push(Date.now());
    return claudeHang.then(() => ({ imported: 1, skipped: 0, errors: 0 }));
  });
  mock.setCodexImpl(() => {
    codexStart.push(Date.now());
    return codexHang.then(() => ({ imported: 2, skipped: 0, errors: 0 }));
  });
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const p = ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  // Yield event loop a few times so both importers had a chance to start.
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(claudeStart.length, 1, 'claude should have started');
  assert.equal(codexStart.length, 1, 'codex should have started too (parallel, not sequential)');

  claudeRelease();
  codexRelease();
  const result = await p;
  assert.equal(result.ok, true);
});
