/* Phase A.1 — IPC handler + lock-integration tests.
   Run focused: node --test test/session-ipc.test.js */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const {
  createSessionHandlers,
  registerSessionIpc,
  isNoFollowUnsupportedError,
  O_NOFOLLOW_UNSUPPORTED_MSG,
} = require('../lib/session-ipc');

// In-memory fake lock with deterministic behavior.
function makeFakeLock() {
  const held    = new Set();
  const byToken = new Map(); // Symbol → kind
  const log     = [];
  return {
    log,
    held,
    acquire(kind) {
      log.push({ op: 'acquire', kind });
      if (held.has(kind)) return null;
      const token = Symbol('fake-' + kind);
      held.add(kind);
      byToken.set(token, kind);
      return token;
    },
    release(token) {
      log.push({ op: 'release', token });
      if (token && typeof token === 'symbol' && byToken.has(token)) {
        const kind = byToken.get(token);
        byToken.delete(token);
        held.delete(kind);
      }
    },
  };
}

// In-memory fake ipcMain that records handle() calls.
function makeFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      if (handlers.has(channel)) {
        throw new Error(`fake ipcMain: handler already registered for ${channel}`);
      }
      handlers.set(channel, fn);
    },
  };
}

const FIXED_HOME = '/fake/home';
const homedir    = () => FIXED_HOME;

/* ─────────────────────── Stage A-IPC-1 ─────────────────────── */
test('Stage A-IPC-1 — registerSessionIpc registers exactly "import-claude" (Phase A.2 adds "import-codex")', () => {
  const ipc = makeFakeIpcMain();
  registerSessionIpc(ipc);
  assert.strictEqual(ipc.handlers.size, 1);
  assert.ok(ipc.handlers.has('import-claude'));
});

/* ─────────────────────── Stage A-IPC-2 ─────────────────────── */
test('Stage A-IPC-2 — handler ignores payload, uses hardcoded paths, hardcodes includeRaw=false even when env says SESSION_IMPORT_RAW=1', async () => {
  const calls = [];
  const claudeImporter = async (opts) => {
    calls.push(opts);
    return { imported: 0, skipped: 0, errors: 0, outputs: [], root: opts.outputBase };
  };
  const lock = makeFakeLock();
  const clock = () => new Date('2026-05-23T00:00:00.000Z');

  const handlers = createSessionHandlers({
    homedir,
    claudeImporter,
    lock,
    clock,
    env: { SESSION_IMPORT_RAW: '1', SESSION_IMPORT_MAX_BYTES: '12345' },
  });

  await handlers.importClaude(); // no payload
  assert.strictEqual(calls.length, 1);
  const opts = calls[0];
  assert.strictEqual(opts.sourceRoot, '/fake/home/.claude/projects');
  assert.strictEqual(opts.outputBase, '/fake/home/agent-sessions/claude-code');
  assert.strictEqual(opts.includeRaw, false, 'includeRaw HARDCODED to false — allowlist guarantee preserved');
  assert.ok(opts.now instanceof Date);
});

/* ─────────────────────── Stage A-IPC-3 ─────────────────────── */
test('Stage A-IPC-3 — success returns { ok: true, importedCount, skippedCount, errorCount, durationMs } and nothing else', async () => {
  const claudeImporter = async () => ({ imported: 3, skipped: 1, errors: 0, outputs: [], root: '/x' });
  const lock = makeFakeLock();
  const handlers = createSessionHandlers({ homedir, claudeImporter, lock, clock: () => new Date() });

  const res = await handlers.importClaude();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.importedCount, 3);
  assert.strictEqual(res.skippedCount,  1);
  assert.strictEqual(res.errorCount,    0);
  assert.strictEqual(typeof res.durationMs, 'number');
  assert.ok(res.durationMs >= 0);
  // Shape contains exactly these 5 keys; no err.message, no abs paths.
  assert.deepStrictEqual(
    Object.keys(res).sort(),
    ['durationMs', 'errorCount', 'importedCount', 'ok', 'skippedCount'],
  );
});

/* ─────────────────────── Stage A-IPC-4 ─────────────────────── */
test('Stage A-IPC-4 — in-flight: second call returns { ok: false, reason: "in-progress" } WITHOUT invoking the importer', async () => {
  let importerCallCount = 0;
  // Importer that blocks until released so we can observe the lock.
  let release;
  const slowImporter = () => new Promise((res) => { release = () => res({ imported: 1, skipped: 0, errors: 0 }); }).then((v) => {
    importerCallCount += 1;
    return v;
  });
  // Wait, importerCallCount needs to increment when the importer is INVOKED, not when its promise resolves.
  // Re-do: count invocations directly.
  let invocations = 0;
  const observed = () => {
    invocations += 1;
    return new Promise((res) => { release = () => res({ imported: 1, skipped: 0, errors: 0 }); });
  };
  const lock = makeFakeLock();
  const handlers = createSessionHandlers({ homedir, claudeImporter: observed, lock, clock: () => new Date() });

  const firstPromise = handlers.importClaude();
  // While first is in flight, second should bounce.
  const secondResult = await handlers.importClaude();
  assert.deepStrictEqual(secondResult, { ok: false, reason: 'in-progress' });
  assert.strictEqual(invocations, 1, 'importer invoked exactly once');

  // Unblock first; clean up.
  release();
  const firstResult = await firstPromise;
  assert.strictEqual(firstResult.ok, true);
});

/* ─────────────────────── Stage A-IPC-5 ─────────────────────── */
test('Stage A-IPC-5 — importer throw returns { ok: false, reason: "import-error" }; lock is released', async () => {
  const claudeImporter = async () => { throw new Error('boom'); };
  const lock = makeFakeLock();
  const handlers = createSessionHandlers({ homedir, claudeImporter, lock, clock: () => new Date() });

  const res = await handlers.importClaude();
  assert.deepStrictEqual(res, { ok: false, reason: 'import-error' });
  // Lock must be released — a subsequent call must be allowed to acquire.
  const res2 = await handlers.importClaude();
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.reason, 'import-error', 'second call also fails but did re-enter the importer');
});

/* ─────────────────────── Stage A-IPC-6 ─────────────────────── */
test('Stage A-IPC-6 — response shape on success contains NO err.message and NO non-binding keys', async () => {
  const claudeImporter = async () => ({ imported: 5, skipped: 0, errors: 0, outputs: ['/secret/path/file.md'], root: '/secret/path' });
  const lock = makeFakeLock();
  const handlers = createSessionHandlers({ homedir, claudeImporter, lock, clock: () => new Date() });

  const res = await handlers.importClaude();
  // outputs and root MUST NOT leak into the response.
  const json = JSON.stringify(res);
  assert.ok(!/\/secret\//.test(json), 'no absolute paths from importer summary leak into response');
  assert.ok(!('outputs' in res));
  assert.ok(!('root' in res));
});

/* ─────────────────────── Stage A-IPC-7 ─────────────────────── */
test('Stage A-IPC-7 — error containing absolute paths is sanitized (no /Users/, no hardcoded roots in response)', async () => {
  const claudeImporter = async () => {
    throw new Error('output ancestor is a symlink: /Users/abs/path/.claude/projects');
  };
  const lock = makeFakeLock();
  const handlers = createSessionHandlers({ homedir, claudeImporter, lock, clock: () => new Date() });

  const res = await handlers.importClaude();
  const json = JSON.stringify(res);
  assert.ok(!/\/Users\//.test(json),   'no /Users/ leaks into response');
  assert.ok(!/\.claude/.test(json),    'no source-root token leaks');
  assert.ok(!/agent-sessions/.test(json), 'no output-root token leaks');
  assert.ok(!/symlink/.test(json),     'no error message leaks at all');
  assert.deepStrictEqual(res, { ok: false, reason: 'import-error' });
});

/* ─────────────────────── Stage A-IPC-8 ─────────────────────── */
test('Stage A-IPC-8 — O_NOFOLLOW-unavailable importer throw maps to { ok: false, reason: "platform-unsupported" }', async () => {
  const claudeImporter = async () => {
    throw new Error(O_NOFOLLOW_UNSUPPORTED_MSG);
  };
  const lock = makeFakeLock();
  const handlers = createSessionHandlers({ homedir, claudeImporter, lock, clock: () => new Date() });

  const res = await handlers.importClaude();
  assert.deepStrictEqual(res, { ok: false, reason: 'platform-unsupported' });

  // Helper-level pin: exact prefix match, not broad includes('O_NOFOLLOW').
  assert.ok(isNoFollowUnsupportedError(new Error(O_NOFOLLOW_UNSUPPORTED_MSG)));
  assert.ok(!isNoFollowUnsupportedError(new Error('unrelated error mentioning O_NOFOLLOW in middle')));
  assert.ok(!isNoFollowUnsupportedError(null));
  assert.ok(!isNoFollowUnsupportedError({ message: 12345 }));
});
