'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions, registerDocumentIpc, CHANNEL } = require('../lib/document-session-ipc');
let projectSource, mapTextEdit, mapFormatEdit;
test.before(async () => { ({ projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs')); ({mapFormatEdit}=await import('../lib/document-format-edit.mjs')); });
function fixture(options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-ipc-')));
  const file = path.join(root, 'a.md'); fs.writeFileSync(file, '\ufeff# 标题😀\r\n\r\nA **粗体** end.\r\n', { flag: 'wx', mode: 0o640 });
  const service = createDocumentService(options.experimental ? { fs: options.io, unsafeExperimentalRoot: root } : {});
  const document = service.open(file).document;
  const windows = new Map();
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit, mapFormatEdit, windowFor: wc => windows.get(wc) });
  const win = new EventEmitter(), wc = new EventEmitter(), frame = { url: 'file:///synthetic/demo.html' };
  const notices = [];
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url,
    send: (channel, data) => notices.push({ channel, data }) });
  Object.assign(win, { webContents: wc, isDestroyed: () => false }); windows.set(wc, win);
  manager.grant(win, frame.url);
  const id = manager.provision(win, document, 'Synthetic A');
  const event = { sender: wc, senderFrame: frame };
  const call = request => manager.request(event, request);
  return { root, file, service, document, manager, win, wc, frame, id, event, call, windows, notices };
}
test('only trusted main provisions sessions; exact channel allowlist, no paths or capabilities', () => {
  const f = fixture(), handlers = new Map(); registerDocumentIpc({ handle: (c, h) => handlers.set(c, h) }, f.manager);
  assert.deepEqual([...handlers.keys()], [CHANNEL]);
  const listed = handlers.get(CHANNEL)(f.event, { operation: 'list' });
  assert.equal(listed.ok, true); assert.match(f.id, /^[a-f0-9-]{36}$/);
  assert.equal(listed.sessions[0].sessionId, f.id);
  assert.equal(JSON.stringify(listed).includes(f.root), false);
  for (const req of [{ operation: 'open', path: f.file }, { operation: 'list', unsafeExperimentalRoot: f.root }, null]) {
    assert.equal(f.call(req).ok, false);
  }
});
test('sender/window/main-frame/url checks reject unauthorized users of a known ID', () => {
  const f = fixture(), req = { operation: 'snapshot', sessionId: f.id };
  for (const event of [{ sender: {}, senderFrame: f.frame }, { sender: f.wc, senderFrame: { url: f.frame.url } }]) {
    assert.equal(f.manager.request(event, req).code, 'unauthorized-sender');
  }
  f.frame.url = 'https://example.invalid/'; assert.equal(f.call(req).ok, false);
});
test('revision-checked source edits keep full source, BOM/CRLF and independent sessions; save stays denied', () => {
  const f = fixture(), original = fs.readFileSync(f.file), old = f.document.text;
  const second = f.manager.provision(f.win, f.service.open(f.file).document, 'Synthetic B');
  const span = projectSource(old).spans.find(s => s.text === '粗体');
  const req = { operation: 'edit', sessionId: f.id, expectedRevision: 0, from: span.from + 1, to: span.to, insert: '文😀' };
  assert.equal(f.call({ ...req, expectedRevision: undefined }).ok, false);
  const r = f.call(req); assert.equal(r.ok, true); assert.equal(r.snapshot.revision, 1); assert.equal(r.snapshot.dirty, true);
  assert.equal(r.snapshot.source, old.replace('粗体', '粗文😀'));
  assert.equal(f.call(req).code, 'stale-revision');
  assert.equal(f.call({ operation: 'snapshot', sessionId: second }).snapshot.source, old);
  const saved = f.call({ operation: 'save', sessionId: f.id, expectedRevision: 1 });
  assert.equal(saved.code, 'coordination-required'); assert.equal(saved.snapshot.dirty, true);
  assert(fs.readFileSync(f.file).equals(original));
  assert.equal(f.document.bom, true);
});
test('unsafe edits, external conflicts, malformed revisions and capability injection retain edits', () => {
  const f = fixture();
  assert.equal(f.call({ operation: 'edit', sessionId: f.id, expectedRevision: 0, from: 0, to: 999, insert: 'bad' }).code, 'unsafe-source-range');
  assert.equal(f.call({ operation: 'save', sessionId: f.id, expectedRevision: '0' }).code, 'invalid-revision');
  assert.equal(f.call({ operation: 'save', sessionId: f.id, expectedRevision: 0, unsafeExperimentalRoot: f.root }).ok, false);
  fs.writeFileSync(f.file, 'EXTERNAL SYNTHETIC\n');
  const r = f.call({ operation: 'check', sessionId: f.id });
  assert.equal(r.ok, false); assert.equal(r.snapshot.saveState.state, 'conflict');
  assert.equal(r.snapshot.source, f.document.text);
});
test('closed/reloaded windows and explicitly closed IDs cannot be reused', () => {
  for (const event of ['did-start-loading', 'destroyed', 'render-process-gone']) {
    const f = fixture(); f.wc.emit(event);
    assert.equal(f.call({ operation: 'snapshot', sessionId: f.id }).ok, false);
  }
  const f = fixture(); assert.equal(f.call({ operation: 'close', sessionId: f.id, expectedRevision: 0 }).ok, true);
  assert.equal(f.call({ operation: 'snapshot', sessionId: f.id }).code, 'unknown-session');
});
test('a second authorized window cannot use the first window session ID', () => {
  const f = fixture(), win = new EventEmitter(), wc = new EventEmitter(), frame = { url: f.frame.url };
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url });
  Object.assign(win, { webContents: wc, isDestroyed: () => false }); f.windows.set(wc, win);
  f.manager.grant(win, frame.url);
  const id = f.manager.provision(win, f.service.open(f.file).document, 'Window B');
  assert.notEqual(id, f.id);
  const r = f.manager.request({ sender: wc, senderFrame: frame }, { operation: 'snapshot', sessionId: f.id });
  assert.equal(r.code, 'unknown-session'); assert.equal(r.snapshot, undefined);
});
test('a disappearing native frame fails as an unauthorized request rather than throwing', () => {
  const f = fixture(); Object.defineProperty(f.wc, 'mainFrame', { get() { throw Error('synthetic frame gone'); } });
  assert.equal(f.call({ operation: 'snapshot', sessionId: f.id }).code, 'unauthorized-sender');
});
for (const fault of ['durability', 'metadata']) test(`actual service ${fault} fault survives IPC projection independently of dirty`, () => {
  const io = Object.create(fs);
  if (fault === 'durability') io.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) throw Error('synthetic sync failure'); fs.fsyncSync(fd); };
  else io.renameSync = (a, b) => { fs.renameSync(a, b); fs.chmodSync(b, 0o666); };
  const f = fixture({ experimental: true, io }), span = projectSource(f.document.text).spans[0];
  assert.equal(f.call({ operation: 'edit', sessionId: f.id, expectedRevision: 0, from: span.from, to: span.to, insert: '新标题' }).ok, true);
  const r = f.call({ operation: 'save', sessionId: f.id, expectedRevision: 1 });
  assert.equal(r.ok, false); assert.equal(r.committed, true);
  assert.equal(r.snapshot.saveState.state, fault === 'durability' ? 'durability-uncertain' : 'replacement-unverified');
  assert.equal(r.snapshot.dirty, fault !== 'durability');
  const again = f.call({ operation: 'save', sessionId: f.id, expectedRevision: 1 });
  assert.equal(again.snapshot.saveState.state, r.snapshot.saveState.state);
  f.win.emit('closed'); assert.equal(f.manager.retainedCount(), 1);
  assert.equal(f.call({ operation: 'snapshot', sessionId: f.id }).ok, false);
});

// Electron may throw from this getter after BrowserWindow.closed. Keep the
// sender mock readable so denial proves removal of authorization, not merely
// an isDestroyed guard. No production object or successful reply is mocked.
function destroyedWindowProperty(f) {
  let destroyed = false, reads = 0;
  Object.defineProperty(f.win, 'webContents', { configurable: true, get() {
    reads++;
    if (destroyed) throw TypeError('Object has been destroyed');
    return f.wc;
  } });
  return { destroy: () => { destroyed = true; }, reads: () => reads };
}
for (const order of [
  ['closed'], ['reload', 'destroyed', 'closed'], ['destroyed', 'closed'],
  ['closed', 'closed', 'destroyed'], ['reload', 'reload', 'destroyed', 'closed'],
]) test(`destroyed window revoke is idempotent: ${order.join(' → ')}`, () => {
  const f = fixture(), trap = destroyedWindowProperty(f);
  for (const event of order) {
    if (event === 'closed') { trap.destroy(); assert.doesNotThrow(() => f.win.emit('closed')); }
    else assert.doesNotThrow(() => f.wc.emit(event === 'reload' ? 'did-start-loading' : event));
    assert.equal(f.call({ operation: 'snapshot', sessionId: f.id }).code, 'unauthorized-sender');
  }
  trap.destroy();
  for (let n = 0; n < 3; n++) assert.doesNotThrow(() => f.manager.revoke(f.win));
  assert.equal(trap.reads(), 0);
  assert.equal(f.manager.retainedCount(), 0);
  assert.equal(f.service.getSaveState(f.document).code, 'unknown-document');
});

test('revoking a destroyed window removes only its sessions, never another window grant', () => {
  const f = fixture(), win = new EventEmitter(), wc = new EventEmitter(), frame = { url: f.frame.url };
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url });
  Object.assign(win, { webContents: wc, isDestroyed: () => false }); f.windows.set(wc, win);
  f.manager.grant(win, frame.url);
  const doc = f.service.open(f.file).document, id = f.manager.provision(win, doc, 'Other window');
  const event = { sender: wc, senderFrame: frame };
  assert.equal(f.manager.request(event, { operation: 'snapshot', sessionId: f.id }).code, 'unknown-session');
  const trap = destroyedWindowProperty(f); trap.destroy();
  assert.doesNotThrow(() => f.win.emit('closed'));
  assert.equal(f.call({ operation: 'snapshot', sessionId: f.id }).ok, false);
  assert.equal(f.manager.request(event, { operation: 'snapshot', sessionId: id }).ok, true);
  assert.equal(f.manager.request(event, { operation: 'snapshot', sessionId: f.id }).code, 'unknown-session');
  assert.equal(trap.reads(), 0);
});

for (const kind of ['clean', 'dirty', 'durability', 'metadata']) test(`destroyed-window cleanup preserves ${kind} close contract`, () => {
  const io = Object.create(fs);
  if (kind === 'durability') io.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) throw Error('synthetic sync failure'); fs.fsyncSync(fd); };
  if (kind === 'metadata') io.renameSync = (a, b) => { fs.renameSync(a, b); fs.chmodSync(b, 0o666); };
  const f = fixture({ experimental: ['durability', 'metadata'].includes(kind), io });
  if (kind !== 'clean') {
    const span = projectSource(f.document.text).spans[0];
    assert.equal(f.call({ operation: 'edit', sessionId: f.id, expectedRevision: 0, from: span.from, to: span.to, insert: '新标题' }).ok, true);
  }
  if (['durability', 'metadata'].includes(kind)) {
    const result = f.call({ operation: 'save', sessionId: f.id, expectedRevision: 1 });
    assert.equal(result.code, kind === 'durability' ? 'durability-uncertain' : 'replacement-posix-metadata-changed');
  }
  const state = f.service.getSaveState(f.document), text = f.document.text, bytes = fs.readFileSync(f.file);
  if (kind !== 'clean') assert.equal(f.call({ operation: 'close', sessionId: f.id, expectedRevision: f.document.revision }).code, 'unresolved-save-state');
  const trap = destroyedWindowProperty(f); trap.destroy();
  assert.doesNotThrow(() => f.win.emit('closed'));
  assert.doesNotThrow(() => f.manager.revoke(f.win));
  assert.doesNotThrow(() => f.wc.emit('destroyed'));
  assert.equal(trap.reads(), 0);
  assert.equal(f.call({ operation: 'snapshot', sessionId: f.id }).ok, false);
  assert.equal(f.manager.retainedCount(), kind === 'clean' ? 0 : 1);
  assert.equal(f.document.text, text); assert(fs.readFileSync(f.file).equals(bytes));
  if (kind === 'clean') assert.equal(f.service.getSaveState(f.document).code, 'unknown-document');
  else assert.deepEqual(f.service.getSaveState(f.document), state);
});

test('main invalidates only successfully closed or revoked sessions, once per ID', () => {
  const f = fixture(), second = f.manager.provision(f.win, f.service.open(f.file).document, 'B');
  assert.equal(f.call({ operation: 'close', sessionId: f.id, expectedRevision: 99 }).code, 'stale-revision');
  assert.equal(f.notices.length, 0);
  assert.equal(f.call({ operation: 'close', sessionId: f.id, expectedRevision: 0 }).ok, true);
  assert.deepEqual(f.notices, [{ channel: 'document-demo:invalidated', data: { sessionId: f.id } }]);
  assert.equal(f.call({ operation: 'snapshot', sessionId: second }).ok, true);
  f.manager.revoke(f.win); f.manager.revoke(f.win);
  assert.deepEqual(f.notices.map(n => n.data.sessionId), [f.id, second]);
});

// Transport-order unit tests supplement, rather than replace, the real IPC E2E.
function preloadFixture() {
  const { runInNewContext } = require('node:vm'), events = new EventEmitter(), pending = [];
  let api; const dom = new EventEmitter();
  events.invoke = (channel, payload) => {
    events.beforeInvoke?.(payload);
    return new Promise((resolve, reject) => pending.push({ channel, payload, resolve, reject }));
  };
  runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/document-demo-preload.js'), 'utf8'), {
    document: { addEventListener: (name, fn) => dom.on(name, fn) },
    require: name => { assert.equal(name, 'electron'); return {
      ipcRenderer: events, contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'documentDemo'); api = value; } },
    }; },
  });
  return { api, events, pending, dom };
}
test('preload close acknowledgement tombstones old successes before resolving to the renderer', async () => {
  const f = preloadFixture(), id = 'synthetic-session', seen = [];
  f.api.onInvalidated(r => seen.push(r.sessionId));
  const snapshot = f.api.snapshot({ sessionId: id }), close = f.api.close({ sessionId: id, expectedRevision: 0 });
  f.pending[1].resolve({ ok: true }); assert.equal((await close).ok, true);
  assert.deepEqual(seen, [id]);
  f.pending[0].resolve({ ok: true, snapshot: { sessionId: id, source: 'old' } });
  const late = await snapshot; assert.equal(late.ok, false); assert.equal(late.code, 'unknown-session'); assert.equal(late.snapshot, undefined);
  f.events.emit('document-demo:invalidated', {}, { sessionId: id }); assert.deepEqual(seen, [id]);
  const replayed = []; f.api.onInvalidated(r => replayed.push(r.sessionId)); assert.deepEqual(replayed, [id]);
});
test('preload main invalidation wins over earlier snapshots even without a close request', async () => {
  const f = preloadFixture(), id = 'synthetic-session', seen = [];
  f.api.onInvalidated(r => seen.push(r.sessionId));
  const snapshot = f.api.snapshot({ sessionId: id });
  f.events.emit('document-demo:invalidated', {}, { sessionId: id });
  f.pending[0].resolve({ ok: true, snapshot: { sessionId: id, source: 'old' } });
  assert.equal((await snapshot).code, 'unknown-session'); assert.deepEqual(seen, [id]);
});
test('a refused close preserves terminal invalidation semantics but cannot automatically unlock', async () => {
  const f = preloadFixture(), seen = []; f.api.onInvalidated(r => seen.push(r.sessionId));
  const close = f.api.close({ sessionId: 'a', expectedRevision: 0 });
  f.pending[0].resolve({ ok: false, code: 'unresolved-save-state' }); assert.equal((await close).ok, false);
  const snapshot = f.api.snapshot({ sessionId: 'a' });
  f.pending[1]?.resolve({ ok: true, snapshot: { sessionId: 'a' } }); // Completes the old, unfenced RED path.
  assert.equal((await snapshot).code, 'close-outcome-unknown'); assert.equal(f.pending.length, 1); assert.deepEqual(seen, []);
});

test('close-pending is published synchronously before invoke; old snapshots and new edits are fenced', async () => {
  const f = preloadFixture(), states = []; f.api.onLifecycle(s => states.push(s.state));
  f.events.beforeInvoke = payload => { if (payload.operation === 'close') assert.deepEqual(states, ['close-pending']); };
  const old = f.api.snapshot({ sessionId: 'b' }), close = f.api.close({ sessionId: 'b', expectedRevision: 0 });
  assert.deepEqual(states, ['close-pending']); assert.equal(f.pending[1].payload.operation, 'close');
  const replay = []; f.api.onLifecycle(s => replay.push(s.state)); assert.deepEqual(replay, ['close-pending']);
  f.pending[0].resolve({ ok: true, snapshot: { sessionId: 'b', source: 'old' } });
  assert.equal((await old).code, 'close-pending');
  for (const op of ['snapshot', 'edit', 'undo', 'redo', 'save', 'check', 'close']) {
    assert.equal((await f.api[op]({ sessionId: 'b' })).code, 'close-pending');
  }
  assert.equal(f.pending.length, 2);
  f.pending[1].resolve({ ok: true }); await close;
  assert.deepEqual(states, ['close-pending', 'invalidated']);
});

for (const fault of ['rejection', 'null', 'bad-ok', 'refusal']) test(`close-pending ${fault} remains uncertain until authoritative invalidation`, async () => {
  const f = preloadFixture(), states = []; f.api.onLifecycle(s => states.push(s.state));
  const close = f.api.close({ sessionId: 'b', expectedRevision: 0 });
  if (fault === 'rejection') f.pending[0].reject(Error('Synthetic lost transport'));
  else f.pending[0].resolve(fault === 'null' ? null : fault === 'bad-ok' ? { ok: 'true' } : { ok: false, code: 'unresolved-save-state', snapshot: { sessionId: 'b' } });
  const result = await close; assert.equal(result.ok, false); assert.equal(result.snapshot, undefined);
  assert.deepEqual(states, ['close-pending', 'close-outcome-unknown']);
  const replay = []; f.api.onLifecycle(s => replay.push(s.state)); assert.deepEqual(replay, ['close-outcome-unknown']);
  assert.equal((await f.api.snapshot({ sessionId: 'b' })).code, 'close-outcome-unknown');
  const a = f.api.snapshot({ sessionId: 'a' }); f.pending[1].resolve({ ok: true, snapshot: { sessionId: 'a' } }); assert.equal((await a).ok, true);
  f.events.emit('document-demo:invalidated', {}, { sessionId: 'b' }); assert.equal((await f.api.snapshot({ sessionId: 'b' })).code, 'unknown-session');
});

test('invalidation during close cannot be downgraded by a later refusal or transport error', async () => {
  for (const rejects of [false, true]) {
    const f = preloadFixture(), states = []; f.api.onLifecycle(s => states.push(s.state));
    const close = f.api.close({ sessionId: 'b', expectedRevision: 0 });
    f.events.emit('document-demo:invalidated', {}, { sessionId: 'b' });
    if (rejects) f.pending[0].reject(Error('Synthetic lost reply')); else f.pending[0].resolve({ ok: false, code: 'unresolved-save-state' });
    await close; assert.deepEqual(states, ['close-pending', 'invalidated']);
    assert.equal((await f.api.snapshot({ sessionId: 'b' })).code, 'unknown-session');
  }
});


test('preload test copy fences pending IPC and unknown results without resetting lifecycle', async () => {
  const f = preloadFixture(), request = { sessionId: 'a', expectedRevision: 0, expectedSha256: 'a'.repeat(64) };
  const edit = f.api.edit({ sessionId: 'a' });
  assert.equal((await f.api.createTestCopy(request)).code, 'document-busy');
  f.pending[0].resolve({ ok: true }); await edit;
  const copy = f.api.createTestCopy(request);
  assert.equal((await f.api.edit({ sessionId: 'a' })).code, 'copy-in-progress');
  assert.equal((await f.api.createTestCopy(request)).code, 'document-busy');
  f.pending[1].reject(Error('Synthetic response loss'));
  assert.equal((await copy).code, 'copy-outcome-unknown');
  assert.equal((await f.api.createTestCopy(request)).code, 'copy-outcome-unknown');
  assert.equal(f.pending.length, 2);
});
test('preload test copy refuses composition, but does not interfere with normal completion', async () => {
  const f = preloadFixture(), request = { sessionId: 'a' };
  f.dom.emit('compositionstart');
  assert.equal((await f.api.createTestCopy(request)).code, 'composition-active'); assert.equal(f.pending.length, 0);
  f.dom.emit('compositionend'); const call = f.api.createTestCopy(request);
  f.pending[0].resolve({ ok: true, copy: { state: 'created-confirmed', created: true } }); assert.equal((await call).ok, true);
});
test('preload malformed copy receipt and previous edit transport loss stay fail closed', async () => {
  for (const kind of ['malformed', 'edit']) {
    const f = preloadFixture();
    if (kind === 'edit') { const edit = f.api.edit({ sessionId: 'a' }); f.pending[0].reject(Error('lost')); await assert.rejects(edit); }
    else { const copy = f.api.createTestCopy({ sessionId: 'a' }); f.pending[0].resolve(null); assert.equal((await copy).code, 'copy-outcome-unknown'); }
    assert.equal((await f.api.createTestCopy({ sessionId: 'a' })).ok, false); assert.equal(f.pending.length, 1);
  }
});


test('copy UI refuses unconfirmed/composing/busy/locked source without mutating it', async () => {
  const { copyRefusal } = await import('../lib/document-test-copy-view.mjs');
  const base = { confirmed: { temporary: true, copyEnabled: true, source: 'x', copySha256: 'a'.repeat(64) }, source: 'x', recoveryRecords: [], pending: 0 };
  assert.equal(copyRefusal(base), null);
  for (const [change, code] of [[{ composing: true }, 'composition-active'], [{ compositionInvalid: true }, 'composition-active'],
    [{ pending: 1 }, 'document-busy'], [{ historyPending: true }, 'document-busy'], [{ source: 'unsent' }, 'unconfirmed-input'],
    [{ recoveryRecords: [{}] }, 'unconfirmed-input'], [{ locked: true }, 'document-locked']]) {
    assert.equal(copyRefusal({ ...base, ...change }), code);
  }
  assert.equal(copyRefusal(base, { invalid: true }), 'document-locked');
  assert.equal(copyRefusal({ ...base, confirmed: { ...base.confirmed, readOnly: true } }), 'test-copy-unavailable');
  assert.equal(copyRefusal({ ...base, confirmed: { ...base.confirmed, copyState: { ok: false, created: null } } }), 'unresolved-copy-state');
});


test('preload unknown native-choice IPC blocks test creation without claiming a copy was attempted', async () => {
  const f = preloadFixture(), opening = f.api.openFile();
  f.pending[0].reject(Error('lost dialog response')); await assert.rejects(opening);
  assert.equal((await f.api.createTestCopy({ sessionId: 'a' })).code, 'ipc-outcome-unknown');
  assert.equal(f.pending.length, 1);
});
test('development launcher only spawns the same document window in a fresh private root', () => {
  const { runInNewContext } = require('node:vm'); const calls = [], child = new EventEmitter();
  const runtime = __filename; // Existing regular file; never executed by this spawn stub.
  runInNewContext(fs.readFileSync(path.join(__dirname, '../tools/run-document-copy-demo.cjs'), 'utf8'), {
    __dirname: path.join(__dirname, '../tools'), console: { log() {}, error() {} },
    process: { platform: 'darwin', argv: ['node', 'launcher.cjs'], env: { PATH: '/usr/bin:/bin', SECRET_SENTINEL: 'not-forwarded' } },
    require: name => name === 'electron' ? runtime : name === 'node:child_process' ? { spawn: (...a) => { calls.push(a); return child; } } : require(name),
  });
  assert.equal(calls.length, 1); const [binary, args, opts] = calls[0];
  assert.equal(binary, runtime); assert.equal(args[0], path.resolve(__dirname, '../main.js'));
  assert.deepEqual(Array.from(args.slice(1)), ['--document-readonly', '--document-test-copy']);
  assert.match(path.basename(opts.cwd), /^document-safe-create-/); assert.equal(fs.statSync(opts.cwd).mode & 0o777, 0o700);
  assert.equal(path.dirname(opts.cwd), fs.realpathSync(os.tmpdir())); assert.equal(opts.env.SECRET_SENTINEL, undefined);
});


test('persistent-copy preload preserves composition, pending and unknown-response fences', async () => {
  const f = preloadFixture(), q = { sessionId: 'a', expectedRevision: 0, expectedSha256: 'a'.repeat(64) };
  f.dom.emit('compositionstart'); assert.equal((await f.api.createPersistentCopy(q)).code, 'composition-active');
  f.dom.emit('compositionend'); const edit = f.api.edit({ sessionId: 'a' });
  assert.equal((await f.api.createPersistentCopy(q)).code, 'document-busy'); f.pending[0].resolve({ ok: true }); await edit;
  const copy = f.api.createPersistentCopy(q); assert.equal(f.pending[1].payload.operation, 'create-persistent-copy');
  assert.equal((await f.api.edit({ sessionId: 'a' })).code, 'copy-in-progress');
  f.pending[1].reject(Error('Synthetic lost response')); assert.equal((await copy).code, 'copy-outcome-unknown');
  assert.equal((await f.api.createPersistentCopy(q)).code, 'copy-outcome-unknown');
});


// Evaluate the actual renderer header statements without launching Electron.
// This covers the visible note AND Not saved badge, not a duplicate formatter.
function copyHeader(confirmed) {
  const entry = fs.readFileSync(path.join(__dirname, '../lib/document-demo-entry.js'), 'utf8');
  const block = entry.match(/    const current = s\.confirmed, temporary = current\.temporary === true;[\s\S]*?byId\('document-info-note'\)\.textContent = [^\n]+;/);
  assert.ok(block, 'Actual document header block must be found');
  const helper = entry.match(/function persistentCopyNote\(receipt\) \{[\s\S]*?\n\}/)?.[0] || '';
  const nodes = new Map();
  const byId = id => { if (!nodes.has(id)) nodes.set(id, { querySelector: () => ({}) }); return nodes.get(id); };
  require('node:vm').runInNewContext(helper + '\n' + block[0], { s: { confirmed, recoveryRecords: [] }, byId, busy: false, activeInvalid: () => false });
  return { note: byId('document-info-note').textContent, badge: byId('readonly-badge').textContent };
}
for (const receipt of [undefined, { ok: true, state: 'not-created', created: false },
  { ok: false, state: 'target-exists', created: false }]) {
  test('persistent copy note: no confirmed receipt does not imply an existing copy ' + (receipt?.state || 'initial'), () => {
    const h = copyHeader({ temporary: true, persistentCopyEnabled: true, copyState: receipt });
    assert.match(h.note, /尚无已确认的文件副本/); assert.doesNotMatch(h.note, /exists on disk|no file exists|no file was created/i);
    assert.equal(h.badge, '本地草稿');
  });
}
test('persistent copy note: only confirmed success names the copied revision and excludes later edits', () => {
  const h = copyHeader({ temporary: true, persistentCopyEnabled: true, revision: 9,
    copyState: { ok: true, state: 'created-confirmed', created: true, revision: 7 } });
  assert.match(h.note, /修订 7/); assert.doesNotMatch(h.note, /修订 9/);
  assert.match(h.note, /不包含后续编辑/); assert.equal(h.badge, '本地草稿');
});
for (const state of ['create-outcome-unknown', 'created-partial', 'created-unverified', 'durability-uncertain']) {
  test('persistent copy note: ' + state + ' never claims absence or confirmed success', () => {
    const h = copyHeader({ temporary: true, persistentCopyEnabled: true,
      copyState: { ok: false, state, created: state === 'create-outcome-unknown' ? null : true, revision: 7 } });
    assert.match(h.note, /创建结果未确认，文件可能已存在/); assert.doesNotMatch(h.note, /已确认文件副本：|文件不存在/i);
    assert.equal(h.badge, '本地草稿');
  });
}
test('copy wording leaves normal temporary and readonly header behavior unchanged', () => {
  assert.match(copyHeader({ temporary: true }).note, /No save or export/);
  const ro = copyHeader({ readOnly: true }); assert.match(ro.note, /原文件只读/); assert.equal(ro.badge, '原文只读');
});


test('preload editable-copy fences composition, pending IPC, unknown outcomes and invalidation', async () => {
  const f = preloadFixture(), q = { sessionId: 'original', expectedRevision: 0, expectedSha256: 'a'.repeat(64) };
  assert.equal(typeof f.api.editCopy, 'function');
  f.dom.emit('compositionstart'); assert.equal((await f.api.editCopy(q)).code, 'composition-active'); f.dom.emit('compositionend');
  const snapshot = f.api.snapshot({ sessionId: 'original' }); assert.equal((await f.api.editCopy(q)).code, 'document-busy');
  f.pending[0].resolve({ ok: true }); await snapshot;
  const copy = f.api.editCopy(q); assert.equal((await f.api.close({ sessionId: 'original' })).code, 'copy-in-progress');
  f.pending[1].reject(Error('synthetic response loss')); assert.equal((await copy).code, 'edit-copy-outcome-unknown');
  assert.equal((await f.api.editCopy(q)).code, 'edit-copy-outcome-unknown'); assert.equal(f.pending.length, 2);
  f.events.emit('document-demo:invalidated', {}, { sessionId: 'original' }); assert.equal((await f.api.editCopy(q)).code, 'unknown-session');
});
test('preload editable-copy validates independent identity and fences late invalidation', async () => {
  for (const kind of ['valid', 'same-id', 'invalidated', 'malformed']) {
    const f = preloadFixture(), q = { sessionId: 'a', expectedRevision: 0 }; assert.equal(typeof f.api.editCopy, 'function');
    const call = f.api.editCopy(q);
    if (kind === 'invalidated') f.events.emit('document-demo:invalidated', {}, { sessionId: 'a' });
    f.pending[0].resolve(kind === 'malformed' ? null : { ok: true, snapshot: { sessionId: kind === 'same-id' ? 'a' : 'b', temporary: true, readOnly: false } });
    const r = await call; assert.equal(r.ok, kind === 'valid'); if (kind !== 'valid') assert.equal(r.snapshot, undefined);
  }
});

function pointerCompositionFixture({ composing = true, invalid = false, capacity = false, readOnly = false } = {}) {
  const entry = fs.readFileSync(path.join(__dirname, '../lib/document-demo-entry.js'), 'utf8');
  const helper = entry.match(/function finishCompositionForPointer\(view, event\) \{[\s\S]*?\n\}/);
  assert.ok(helper, 'Use the actual renderer pointer handler');
  const state = { composing, compositionInvalid: invalid }, records = [], calls = [];
  const controller = { state: () => state, retainCompositionCopy: text => {
    calls.push('retain'); if (capacity) return { ok: false, code: 'recovery-capacity' };
    records.push(text); return { ok: true };
  }, endComposition: () => { throw Error('Pointer must not manufacture compositionend'); } };
  const handler = require('node:vm').runInNewContext(helper[0] + '\nfinishCompositionForPointer', {
    controller, loading: false, activeInvalid: () => false, readOnlyDocument: () => readOnly,
    viewerStatus: () => calls.push('warning'),
  });
  const view = { dom: { textContent: 'synthetic partial input', blur: () => calls.push('blur') } };
  const event = { button: 0, preventDefault: () => calls.push('prevent') };
  return { handler, controller, state, records, calls, view, event };
}
test('composition pointer request cannot unlock when the browser emits no end event', async () => {
  const h = pointerCompositionFixture(), f = preloadFixture(); f.dom.emit('compositionstart');
  assert.equal(h.handler(h.view, h.event), false); assert.deepEqual(h.calls, ['blur']);
  assert.equal(h.state.composing, true);
  assert.equal((await f.api.createPersistentCopy({ sessionId: 'a' })).code, 'composition-active');
  assert.equal(f.pending.length, 0);
});
test('composition pointer retains available invalid input before requesting browser completion', () => {
  const h = pointerCompositionFixture({ invalid: true }); h.handler(h.view, h.event);
  assert.deepEqual(h.calls, ['retain','blur']); assert.deepEqual(h.records, ['synthetic partial input']);
  assert.equal(h.state.composing, true);
  const full = pointerCompositionFixture({ invalid: true, capacity: true });
  assert.equal(full.handler(full.view, full.event), true); assert.equal(full.calls.includes('blur'), false);
  assert.equal(full.calls.includes('prevent'), true); assert.equal(full.state.composing, true);
});
test('ordinary clicks, right clicks and readonly sessions do not request composition completion', () => {
  for (const options of [{ composing: false }, { readOnly: true }]) {
    const h = pointerCompositionFixture(options); assert.equal(h.handler(h.view, h.event), false); assert.deepEqual(h.calls, []);
  }
  const h = pointerCompositionFixture(); h.event.button = 2; h.handler(h.view, h.event); assert.deepEqual(h.calls, []);
});

test('opaque projection blocks are browser-readonly without changing original PM content or plain paragraphs', () => {
  const entry = fs.readFileSync(path.join(__dirname, '../lib/document-demo-entry.js'), 'utf8');
  const helper = entry.match(/function protectOpaqueBlocks\(state\) \{[\s\S]*?\n\}/);
  assert.ok(helper, 'Use the actual projection decoration function');
  const { getSchema } = require('@tiptap/core'), StarterKit = require('@tiptap/starter-kit').default;
  const { EditorState } = require('@tiptap/pm/state'), { Decoration, DecorationSet } = require('@tiptap/pm/view');
  const schema = getSchema([StarterKit.configure({ undoRedo: false, trailingNode: false })]);
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(projectSource('# Heading\n\nPlain 中文\n\n```js\nconst sample=1;\n```\n\n::: unknown').doc) });
  const before = state.doc.toJSON();
  const protect = require('node:vm').runInNewContext(helper[0] + '\nprotectOpaqueBlocks', { Decoration, DecorationSet });
  const decorations = protect(state).find(); assert.equal(decorations.length, 2);
  for (const d of decorations) {
    assert.equal(state.doc.nodeAt(d.from).type.name, 'codeBlock');
    assert.equal(d.type.attrs.contenteditable, 'false'); assert.match(d.type.attrs.title, /暂不支持编辑/);
  }
  assert.deepEqual(state.doc.toJSON(), before);
});


test('preload draft restoration fences composition, pending and unknown IPC without losing active writing', async () => {
  const f = preloadFixture();
  f.dom.emit('compositionstart'); assert.equal((await f.api.restoreDraft('draft')).code, 'composition-active');
  assert.equal(f.pending.length, 0); f.dom.emit('compositionend');
  const edit = f.api.edit({ sessionId: 'active', expectedRevision: 0 });
  assert.equal((await f.api.restoreDraft('draft')).code, 'document-busy');
  f.pending[0].reject(Error('synthetic edit response loss')); await assert.rejects(edit);
  assert.equal((await f.api.restoreDraft('draft')).code, 'ipc-outcome-unknown'); assert.equal(f.pending.length, 1);
});
test('preload draft restoration validates temporary identity and rejects late revoked snapshots', async () => {
  for (const kind of ['valid', 'readonly', 'malformed', 'invalidated']) {
    const f = preloadFixture(), call = f.api.restoreDraft('draft');
    assert.equal(f.pending[0].payload.operation, 'restore-draft');
    if (kind === 'invalidated') f.events.emit('document-demo:invalidated', {}, { sessionId: 'fresh' });
    f.pending[0].resolve(kind === 'malformed' ? null : { ok: true, snapshot: { sessionId: 'fresh', temporary: true, readOnly: kind === 'readonly' } });
    const result = await call; assert.equal(result.ok, kind === 'valid');
    if (kind !== 'valid') assert.equal(result.snapshot, undefined);
  }
});
test('preload backup receipts for revoked sessions never reach the renderer', () => {
  const f = preloadFixture(), seen = []; f.api.onDraftStatus(r => seen.push(r));
  f.events.emit('document-demo:draft-status', {}, { sessionId: 'live', backup: { revision: 1 } });
  f.events.emit('document-demo:invalidated', {}, { sessionId: 'live' });
  f.events.emit('document-demo:draft-status', {}, { sessionId: 'live', backup: { revision: 2 } });
  assert.equal(seen.length, 1); assert.equal(seen[0].backup.revision, 1);
});


test('preload draft management fences composition, concurrent operations and lost/malformed acknowledgements', async () => {
  const request = { draftId: 'draft', action: 'archive', expectedToken: 'a'.repeat(64) }, f = preloadFixture();
  f.dom.emit('compositionstart'); assert.equal((await f.api.manageDraft(request)).code, 'composition-active');
  assert.equal(f.pending.length, 0); f.dom.emit('compositionend');
  const operation = f.api.manageDraft(request);
  assert.equal((await f.api.restoreDraft('draft')).code, 'document-busy');
  assert.equal((await f.api.manageDraft(request)).code, 'document-busy');
  f.pending[0].reject(Error('lost')); assert.equal((await operation).code, 'draft-operation-unknown');
  assert.equal((await f.api.manageDraft(request)).code, 'draft-operation-unknown'); assert.equal(f.pending.length, 1);
  const list = f.api.listDrafts(); f.pending[1].resolve({ ok: true, drafts: [], archived: [] }); assert.equal((await list).ok, true);
  // Uncertain archive membership cannot taint an unrelated document export.
  const copy = f.api.createPersistentCopy({ sessionId: 'active', expectedRevision: 2, expectedSha256: 'b'.repeat(64) });
  f.pending[2].resolve({ ok: true, copy: { state: 'created-confirmed' } }); assert.equal((await copy).ok, true);
  for (const response of [null, { ok: true, state: 'available' }, { ok: true, state: 'archived' }]) {
    const g = preloadFixture(), call = g.api.manageDraft(request); g.pending[0].resolve(response);
    const result = await call; assert.equal(result.ok, response?.state === 'archived');
  }
});

test('format IPC rejects readonly, foreign frames, stale revision and injected source/history/path fields',()=>{
  const f=fixture(),disk=fs.readFileSync(f.file),span=projectSource(f.document.text).spans[0];
  const q={operation:'format',sessionId:f.id,expectedRevision:0,from:span.from,to:span.to,action:'heading-2'};
  assert.equal(f.manager.request({sender:f.wc,senderFrame:{url:f.frame.url}},q).code,'unauthorized-sender');
  for(const [key,value] of [['source','bad'],['path','/tmp/target'],['inverseSource',{}],['format',true],['leaf',{}]])assert.equal(f.call({...q,[key]:value}).code,'invalid-request');
  assert.equal(f.call({...q,expectedRevision:1}).code,'stale-revision');
  const id=f.manager.provision(f.win,f.service.open(f.file).document,'Readonly',{readOnly:true});
  assert.equal(f.call({...q,sessionId:id}).code,'read-only-document');
  assert.equal(f.call(q).ok,true);assert.equal(f.document.text.startsWith('## 标题😀\r\n'),true);
  assert.equal(f.call({...q,expectedRevision:0}).code,'stale-revision');
  assert.equal(f.call({operation:'snapshot',sessionId:id}).snapshot.revision,0);
  assert.deepEqual(fs.readFileSync(f.file),disk);
  f.win.emit('closed');assert.equal(f.call({...q,expectedRevision:1}).code,'unauthorized-sender');
});
test('format preload refuses live composition, concurrent request and invalidated authority',async()=>{
  const f=preloadFixture(),q={sessionId:'a',expectedRevision:0,action:'heading-1',from:1,to:1};
  f.dom.emit('compositionstart');assert.equal((await f.api.format(q)).code,'composition-active');assert.equal(f.pending.length,0);
  f.dom.emit('compositionend');const request=f.api.format(q);assert.equal(f.pending[0].payload.operation,'format');
  assert.equal((await f.api.format(q)).code,'document-busy');
  f.events.emit('document-demo:invalidated',{}, {sessionId:'a'});f.pending[0].resolve({ok:true});
  assert.equal((await request).code,'unknown-session');assert.equal((await f.api.format(q)).code,'unknown-session');
});


test('confirmed-copy preload refuses composition, pending work, malformed authority and late invalidation', async () => {
  for (const name of ['openConfirmedCopy', 'revealConfirmedCopy']) {
    const f = preloadFixture(), q = { sessionId: 'source', expectedRevision: 2, copyId: 'receipt' };
    f.dom.emit('compositionstart'); assert.equal((await f.api[name](q)).code, 'composition-active');
    f.dom.emit('compositionend'); const pending = f.api[name](q);
    assert.equal((await f.api[name](q)).code, 'document-busy');
    assert.equal((await f.api.edit({ sessionId: 'source' })).code, 'copy-in-progress');
    f.pending[0].resolve({ ok: true, copyId: 'wrong' }); assert.equal((await pending).code, 'copy-action-unknown');
    assert.equal((await f.api[name](q)).code, 'copy-action-unknown');
    const g = preloadFixture(), late = g.api[name](q);
    g.events.emit('document-demo:invalidated', {}, { sessionId: 'source' });
    g.pending[0].resolve({ ok: true, copyId: 'receipt', snapshot: { sessionId: 'new', readOnly: true } });
    assert.equal((await late).ok, false);
  }
});
test('confirmed-copy preload accepts only new readonly snapshots and retains an IPC failure fence', async () => {
  const q = { sessionId: 'source', expectedRevision: 2, copyId: 'receipt' };
  for (const snapshot of [{ sessionId: 'source', readOnly: true }, { sessionId: 'new', readOnly: false }, { sessionId: 'new', readOnly: true, temporary: true }]) {
    const f = preloadFixture(), pending = f.api.openConfirmedCopy(q);
    f.pending[0].resolve({ ok: true, copyId: 'receipt', snapshot }); assert.equal((await pending).ok, false);
  }
  const f = preloadFixture(), pending = f.api.openConfirmedCopy(q);
  f.pending[0].resolve({ ok: true, copyId: 'receipt', snapshot: { sessionId: 'new', readOnly: true } });
  assert.equal((await pending).ok, true);
  const next = f.api.openConfirmedCopy(q); f.pending[1].reject(Error('synthetic disconnect'));
  assert.equal((await next).code, 'copy-action-unknown');
  assert.equal((await f.api.createPersistentCopy(q)).code, 'copy-action-unknown');
});


test('user close blocks composition and pending edits before establishing a fence', async () => {
  const f = preloadFixture(), data = { sessionId: 'a', expectedRevision: 2 };
  f.dom.emit('compositionstart'); assert.equal((await f.api.closeDocument(data)).code, 'composition-active');
  assert.equal(f.pending.length, 0); f.dom.emit('compositionend');
  const edit = f.api.edit(data); assert.equal((await f.api.closeDocument(data)).code, 'document-busy');
  assert.equal(f.pending.length, 1); f.pending[0].resolve({ ok: true }); await edit;
});
for (const code of ['close-cancelled', 'close-backup-unverified', 'unresolved-save-state']) test(`matched user close refusal resumes only the still-live session: ${code}`, async () => {
  const f = preloadFixture(), states = [], data = { sessionId: 'a', expectedRevision: 2 };
  f.api.onLifecycle(s => states.push(s.state)); const closing = f.api.closeDocument(data);
  assert.equal((await f.api.edit(data)).code, 'close-pending');
  f.pending[0].resolve({ ...data, requestRevision: 2, ok: false, closed: false, code });
  assert.equal((await closing).code, code); assert.deepEqual(states, ['close-pending', 'open']);
  const snapshot = f.api.snapshot({ sessionId: 'a' }); f.pending[1].resolve({ ok: true, snapshot: { sessionId: 'a' } });
  assert.equal((await snapshot).ok, true);
});
for (const fault of ['transport', 'identity', 'revision', 'missing-state']) test(`uncertain user close remains fenced: ${fault}`, async () => {
  const f = preloadFixture(), data = { sessionId: 'a', expectedRevision: 2 }, closing = f.api.closeDocument(data);
  if (fault === 'transport') f.pending[0].reject(Error('Synthetic transport failure'));
  else f.pending[0].resolve({ ok: false, code: 'close-cancelled', sessionId: fault === 'identity' ? 'b' : 'a',
    requestRevision: fault === 'revision' ? 1 : 2, ...(fault === 'missing-state' ? {} : { closed: false }) });
  assert.equal((await closing).code, 'close-outcome-unknown');
  assert.equal((await f.api.edit(data)).code, 'close-outcome-unknown');
});
test('main invalidation wins over a matched cancellation; a confirmed close cannot be reused', async () => {
  for (const ok of [false, true]) {
    const f = preloadFixture(), data = { sessionId: 'a', expectedRevision: 2 }, closing = f.api.closeDocument(data);
    f.events.emit('document-demo:invalidated', {}, { sessionId: 'a' });
    f.pending[0].resolve({ ...data, requestRevision: 2, ok, closed: ok, code: ok ? undefined : 'close-cancelled' });
    const result = await closing; assert.equal(result.ok, ok);
    assert.equal((await f.api.snapshot(data)).code, 'unknown-session');
  }
});
