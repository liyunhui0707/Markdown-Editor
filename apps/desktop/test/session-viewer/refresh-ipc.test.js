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

test("S2-2: missing vaultPath -> {ok:false, reason:'no-vault'}; importers NOT invoked", async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  for (const bad of [undefined, null, '', 0, {}]) {
    const result = await ipc.invoke('sessionViewer:import', bad === undefined ? undefined : (typeof bad === 'object' && bad !== null ? bad : { vaultPath: bad }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-vault');
    assert.equal(result.error, undefined);
  }
  assert.equal(mock.calls.claude.length, 0);
  assert.equal(mock.calls.codex.length, 0);
});

test("S2-3: single-flight — concurrent call returns {ok:false, reason:'in-progress'}; original still resolves", async () => {
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
  assert.equal(second.reason, 'in-progress');
  assert.equal(second.error, undefined);

  release({ imported: 1, skipped: 0, errors: 0 });
  const firstResult = await first;
  assert.equal(firstResult.ok, true);

  // After completion, a fresh call should proceed (lock released).
  mock.setClaudeImpl(async () => ({ imported: 5, skipped: 0, errors: 0 }));
  const third = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(third.ok, true);
  assert.equal(third.claude.imported, 5);
});

test("S2-4: importer rejection -> {ok:false, reason:'import-error'}; not re-thrown; lock released", async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  mock.setClaudeImpl(async () => { throw new Error('disk full'); });
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const result = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'import-error');
  assert.equal(result.error, undefined);

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
  assert.equal(second.reason, 'in-progress', 'lock must still be held even though claude rejected');
  assert.equal(second.error, undefined);
  codexInProgressAfterClaudeReject = true;

  codexRelease();
  const firstResult = await first;
  // First returns ok:false because claude rejected; the run completed cleanly.
  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.reason, 'import-error');
  assert.equal(firstResult.error, undefined);
  assert.ok(codexInProgressAfterClaudeReject);

  // Lock released — fresh call proceeds.
  mock.setClaudeImpl(async () => ({ imported: 7, skipped: 0, errors: 0 }));
  mock.setCodexImpl(async () => ({ imported: 8, skipped: 0, errors: 0 }));
  const third = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(third.ok, true);
});

// ---------------------------------------------------------------------------
// Retrofit #1 — typed IPC reason codes (replaces free-form `error: <string>`)
// ---------------------------------------------------------------------------
//
// Failure response is `{ ok: false, reason: <code> }` where <code> is one of:
//   'no-vault' | 'in-progress' | 'platform-unsupported' | 'import-error'
// `result.error` is NEVER set on failure. The IPC layer drops `err.message`
// entirely to avoid leaking absolute paths across the IPC boundary.
//
// The 'platform-unsupported' predicate matches err.message via
//   String.prototype.startsWith('symlink-safe reads unsupported on this platform')
// — the exact prefix emitted by all three importer throw sites:
//   apps/desktop/tools/session-import/import-claude.mjs:204
//   apps/desktop/tools/session-import/import-codex.mjs:59
//   apps/desktop/tools/session-import/lib/safe-read.mjs:17
// If any of those source strings is reworded, T2 below must be updated
// together with the predicate.

test('T1: importer rejection messages with absolute paths NEVER leak into the response (sanitization)', async () => {
  const messages = [
    "ENOENT, open '/Users/test/.codex/sessions/2026/05/27/rollout-deadbeef.jsonl'",
    "EACCES, write '/Users/test/Inbox/AI Chats/codex/sub/dir/foo.jsonl'",
    'output ancestor is a symlink: /Users/test/vault',
  ];
  for (const msg of messages) {
    const ipc = makeMockIpc();
    const mock = makeMockImporters();
    mock.setClaudeImpl(async () => { throw new Error(msg); });
    const mod = loadModule();
    mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

    const result = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'import-error');
    assert.equal(result.error, undefined);
    assert.equal(
      JSON.stringify(result).includes('/Users/'),
      false,
      `response must NOT contain '/Users/' substring (offending message: ${msg})`,
    );
  }
});

test("T2: importer rejection with the well-known O_NOFOLLOW prefix -> reason:'platform-unsupported'", async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  // Exact verbatim string from import-claude.mjs:204 / import-codex.mjs:59 /
  // lib/safe-read.mjs:17 — keep in sync with those throw sites.
  mock.setClaudeImpl(async () => {
    throw new Error('symlink-safe reads unsupported on this platform: fs.constants.O_NOFOLLOW unavailable');
  });
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const result = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'platform-unsupported');
  assert.equal(result.error, undefined);
});

test("T3: predicate tightness — near-miss prefix does NOT map to 'platform-unsupported'", async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  // 'writes' instead of 'reads' — must NOT trip the predicate.
  mock.setClaudeImpl(async () => {
    throw new Error('symlink-safe writes unsupported on this platform');
  });
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const result = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'import-error');
  assert.equal(result.error, undefined);
});

test('T7-A: no-vault NEVER acquires the lock', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  // Two invalid calls in a row — the SECOND must also return 'no-vault',
  // never 'in-progress'. If 'in-progress' surfaced, the first call would
  // have set inFlight = true before returning.
  const first = await ipc.invoke('sessionViewer:import', { vaultPath: '' });
  assert.equal(first.reason, 'no-vault');
  const second = await ipc.invoke('sessionViewer:import', { vaultPath: '' });
  assert.equal(second.reason, 'no-vault');

  // Belt-and-suspenders: a fresh valid call must proceed.
  const third = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(third.ok, true);
});

test('T7-B: platform-unsupported releases the lock in finally', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  mock.setClaudeImpl(async () => {
    throw new Error('symlink-safe reads unsupported on this platform: fs.constants.O_NOFOLLOW unavailable');
  });
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const first = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(first.reason, 'platform-unsupported');

  mock.setClaudeImpl(async () => ({ imported: 9, skipped: 0, errors: 0 }));
  const second = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(second.ok, true); // ← proves finally released the lock
});

test('T7-B: import-error releases the lock in finally', async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  mock.setClaudeImpl(async () => { throw new Error('disk full'); });
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const first = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(first.reason, 'import-error');

  mock.setClaudeImpl(async () => ({ imported: 1, skipped: 0, errors: 0 }));
  const second = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(second.ok, true); // ← proves finally released the lock
});

test("T7-C: an 'in-progress' second call does NOT release the original's lock", async () => {
  const ipc = makeMockIpc();
  const mock = makeMockImporters();
  let release;
  const hang = new Promise((resolve) => { release = resolve; });
  mock.setClaudeImpl(() => hang.then(() => ({ imported: 1, skipped: 0, errors: 0 })));
  const mod = loadModule();
  mod.register(ipc, { importers: { runClaudeImport: mock.runClaudeImport, runCodexImport: mock.runCodexImport } });

  const first = ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  // Yield so claude.start fires and the lock is acquired.
  await new Promise((res) => setTimeout(res, 5));

  const second = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(second.reason, 'in-progress');

  // Third call WHILE first is still hanging — must also see 'in-progress'.
  // If the second call had erroneously released the lock, this would proceed.
  const third = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(third.reason, 'in-progress');

  // Release the original; once it settles, a fresh call must proceed.
  release({ imported: 1, skipped: 0, errors: 0 });
  await first;
  mock.setClaudeImpl(async () => ({ imported: 4, skipped: 0, errors: 0 }));
  const fourth = await ipc.invoke('sessionViewer:import', { vaultPath: '/v' });
  assert.equal(fourth.ok, true);
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
