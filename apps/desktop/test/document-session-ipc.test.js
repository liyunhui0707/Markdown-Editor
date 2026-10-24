'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions, registerDocumentIpc, CHANNEL } = require('../lib/document-session-ipc');
let projectSource, mapTextEdit;
test.before(async () => { ({ projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs')); });
function fixture(options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-ipc-')));
  const file = path.join(root, 'a.md'); fs.writeFileSync(file, '\ufeff# 标题😀\r\n\r\nA **粗体** end.\r\n', { flag: 'wx', mode: 0o640 });
  const service = createDocumentService(options.experimental ? { fs: options.io, unsafeExperimentalRoot: root } : {});
  const document = service.open(file).document;
  const windows = new Map();
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit, windowFor: wc => windows.get(wc) });
  const win = new EventEmitter(), wc = new EventEmitter(), frame = { url: 'file:///synthetic/demo.html' };
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url });
  Object.assign(win, { webContents: wc, isDestroyed: () => false }); windows.set(wc, win);
  manager.grant(win, frame.url);
  const id = manager.provision(win, document, 'Synthetic A');
  const event = { sender: wc, senderFrame: frame };
  const call = request => manager.request(event, request);
  return { root, file, service, document, manager, win, wc, frame, id, event, call, windows };
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
