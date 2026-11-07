'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events'), { runInNewContext } = require('node:vm');
const { createNativeOpenQueue } = require('../lib/document-native-open');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
let projectSource, mapTextEdit;
test.before(async () => { ({ projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs')); });

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-native-open-unit-')));
  const file = path.join(root, '中文 article.md'); fs.writeFileSync(file, '\ufeff# Title\r\n\r\nSynthetic body.\r\n');
  const queue = createNativeOpenQueue(), wc = new EventEmitter(), win = new EventEmitter();
  const frame = { url: 'file:///synthetic/document.html' };
  Object.assign(wc, { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false, send() {} });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  let reads = 0; const io = Object.create(fs);
  io.openSync = (...args) => { assert.equal(args[1] & 3, fs.constants.O_RDONLY); ++reads; return fs.openSync(...args); };
  const service = createDocumentService({ fs: io });
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit, nativeOpens: queue, windowFor: sender => sender === wc ? win : null });
  manager.grant(win, frame.url);
  const event = { sender: wc, senderFrame: frame }, call = data => manager.request(event, data);
  const request = file => { queue.enqueue(file); return queue.list().requests.at(-1).id; };
  const open = id => call({ operation: 'open-native-file', requestId: id });
  return { root, file, queue, service, manager, win, wc, frame, event, call, request, open, reads: () => reads };
}
test('early native requests stay ordered, bounded, path-private and deduplicated until consumed', () => {
  const q = createNativeOpenQueue(); q.enqueue('/synthetic/first.md'); q.enqueue('/synthetic/first.md');
  for (let i = 0; i < 17; i++) q.enqueue(`/synthetic/${i}.md`);
  const listed = q.list(); assert.equal(listed.requests.length, 16); assert.equal(listed.overflow, 2);
  assert.equal(JSON.stringify(listed).includes('/synthetic'), false);
  let notices = 0; q.subscribe(() => notices++);
  const id = listed.requests[0].id;
  assert.equal(q.consume(id, file => { assert.equal(file, '/synthetic/first.md'); return { ok: false, code: 'session-limit' }; }).code, 'session-limit');
  assert.equal(q.list().requests.length, 16);
  assert.equal(q.consume(id, () => ({ ok: true })).ok, true);
  assert.equal(q.consume(id, () => { throw Error('must not reopen'); }).code, 'native-request-unavailable');
  assert.equal(q.dismiss(q.list().requests[0].id).ok, true); assert.equal(q.list().requests.length, 14); assert.equal(notices, 3);
});
test('native IPC accepts only main-queued IDs from the bound top frame, with no paths or privilege escalation', () => {
  const f = fixture(), id = f.request(f.file), q = { operation: 'open-native-file', requestId: id };
  for (const extra of [{ filePath: f.file }, { readOnly: false }, { source: 'X' }, { unsafeExperimentalRoot: f.root }])
    assert.equal(f.call({ ...q, ...extra }).code, 'invalid-request');
  assert.equal(f.manager.request({ ...f.event, senderFrame: {} }, q).code, 'unauthorized-sender');
  assert.equal(f.call({ ...q, requestId: '00000000-0000-0000-0000-000000000000' }).code, 'native-request-unavailable');
  assert.equal(f.reads(), 0);
  const opened = f.open(id); assert.equal(opened.requestId, id); assert.equal(opened.ok, true);
  const s = opened.snapshot; assert.equal(s.readOnly, true); assert.equal(s.bom, true); assert.equal(s.revision, 0);
  for (const operation of ['save', 'undo', 'redo']) assert.equal(f.call({ operation, sessionId: s.sessionId, expectedRevision: 0 }).code, 'read-only-document');
  assert.equal(f.queue.list().requests.length, 0);
  f.request(f.file); f.win.emit('closed'); assert.equal(f.call({ operation: 'list-native-opens' }).code, 'unauthorized-sender');
});
test('repeated native open rereads identity and bytes, reuses unchanged originals and retains changed snapshots', () => {
  const f = fixture(), bytes = fs.readFileSync(f.file), first = f.open(f.request(f.file)).snapshot;
  const same = f.open(f.request(f.file)); assert.equal(same.reused, true); assert.equal(same.snapshot.sessionId, first.sessionId);
  assert.equal(f.reads(), 2); assert.equal(f.call({ operation: 'list' }).sessions.length, 1);
  fs.utimesSync(f.file, new Date(), new Date(Date.now() + 5000));
  assert.equal(f.open(f.request(f.file)).reused, true, 'metadata-only change does not replace readonly content');
  fs.writeFileSync(f.file, 'External change');
  assert.equal(f.open(f.request(f.file)).code, 'native-file-changed');
  assert.equal(f.call({ operation: 'snapshot', sessionId: first.sessionId }).snapshot.source, first.source);
  fs.renameSync(f.file, path.join(f.root, 'old.md')); fs.writeFileSync(f.file, bytes);
  assert.equal(f.open(f.request(f.file)).code, 'native-file-changed');
  assert.deepEqual(fs.readFileSync(f.file), bytes);
});
test('native refusal paths retain the active document; protected files are not read', () => {
  const f = fixture(), before = f.open(f.request(f.file)).snapshot;
  for (const file of [path.join(f.root, 'secrets', 'private.md'), path.join(f.root, '.env.md'), '/tmp/x.txt', 'relative.md'])
    assert.equal(f.open(f.request(file)).code, 'unsupported-path');
  assert.equal(f.reads(), 1);
  const link = path.join(f.root, 'link.md'); fs.symlinkSync(f.file, link);
  assert.equal(f.open(f.request(link)).code, 'unsupported-file');
  assert.equal(f.open(f.request(path.join(f.root, 'missing.md'))).code, 'file-unavailable');
  const large = path.join(f.root, 'large.md'); fs.writeFileSync(large, 'x'.repeat(2097153));
  assert.equal(f.open(f.request(large)).code, 'unsupported-size');
  assert.deepEqual(f.call({ operation: 'snapshot', sessionId: before.sessionId }).snapshot, before);
});
test('capacity keeps new native intent retryable but still allows focusing an unchanged open document', () => {
  const f = fixture(); f.open(f.request(f.file));
  for (let i = 0; i < 7; i++) { const p = path.join(f.root, `${i}.md`); fs.writeFileSync(p, String(i)); assert.equal(f.open(f.request(p)).ok, true); }
  assert.equal(f.open(f.request(f.file)).reused, true);
  const extra = path.join(f.root, 'extra.md'); fs.writeFileSync(extra, 'Extra');
  const id = f.request(extra); assert.equal(f.open(id).code, 'session-limit');
  assert.equal(f.queue.list().requests[0].id, id);
  const s = f.call({ operation: 'list' }).sessions[0]; assert.equal(f.call({ operation: 'close', sessionId: s.sessionId, expectedRevision: 0 }).ok, true);
  assert.equal(f.open(id).ok, true);
});
function preload() {
  const events = new EventEmitter(), dom = new EventEmitter(), pending = []; let api;
  events.invoke = (_channel, payload) => new Promise((resolve, reject) => pending.push({ payload, resolve, reject }));
  runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/document-demo-preload.js'), 'utf8'), {
    document: { addEventListener: (name, fn) => dom.on(name, fn) },
    require: () => ({ ipcRenderer: events, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }),
  });
  return { api, events, dom, pending };
}
test('preload native opens fence composition, outstanding IPC and unknown outcomes', async () => {
  const f = preload(); f.dom.emit('compositionstart'); assert.equal((await f.api.openNativeFile('id')).code, 'composition-active');
  f.dom.emit('compositionend'); const first = f.api.list();
  assert.equal((await f.api.openNativeFile('id')).code, 'document-busy');
  f.pending[0].resolve({ ok: true }); await first;
  const opened = f.api.openNativeFile('id'); f.pending[1].reject(Error('lost reply'));
  assert.equal((await opened).code, 'ipc-outcome-unknown'); assert.equal((await f.api.openNativeFile('id')).code, 'ipc-outcome-unknown');
  assert.equal(f.pending.length, 2);
});
test('preload requires matching native request and a live read-only session before publishing success', async () => {
  for (const [reply, invalidate] of [
    [{ ok: true, requestId: 'other', snapshot: { sessionId: 's', readOnly: true } }],
    [{ ok: true, requestId: 'id', snapshot: { sessionId: 's', temporary: true, readOnly: false } }],
    [{ ok: true, requestId: 'id', snapshot: { sessionId: 's', readOnly: true } }, true],
  ]) {
    const f = preload(), waiting = f.api.openNativeFile('id');
    if (invalidate) f.events.emit('document-demo:invalidated', {}, { sessionId: 's' });
    f.pending[0].resolve(reply); assert.equal((await waiting).code, 'ipc-outcome-unknown');
  }
  const f = preload(), p = f.api.openNativeFile('id');
  f.pending[0].resolve({ ok: true, requestId: 'id', snapshot: { sessionId: 's', readOnly: true } }); assert.equal((await p).ok, true);
});
test('packaging declares only supported .md and never asks to become default handler', () => {
  assert.deepEqual(require('../electron-builder.document.cjs').fileAssociations,
    [{ ext: 'md', name: 'Markdown document', role: 'Editor', rank: 'Alternate' }]);
});
