const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
const { createDraftStore } = require('../lib/document-draft-store');
let projectSource, mapTextEdit;
test.before(async () => ({ projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs')));
function fixture({ confirm = async () => true, draftFs = fs } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-close-')));
  const file = path.join(root, 'original.md'), original = Buffer.from('\ufeffFirst paragraph.\r\n\r\nSecond paragraph.\r\n');
  fs.writeFileSync(file, original, { flag: 'wx', mode: 0o600 });
  const service = createDocumentService(), store = createDraftStore(path.join(root, 'drafts'), { fs: draftFs });
  const win = new EventEmitter(), wc = new EventEmitter(), frame = { url: 'file:///synthetic/close.html' }, notices = [];
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, send: (channel, data) => notices.push({ channel, data }) });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  let number = 0;
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit, draftStore: store,
    windowFor: sender => sender === wc ? win : null, confirmClose: confirm,
    createTemporary: bytes => { const file = path.join(root, `temporary-${++number}.md`); fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); return service.open(file); } });
  manager.grant(win, frame.url);
  const originalDocument = service.open(file).document;
  const originalId = manager.provision(win, originalDocument, 'Original', { readOnly: true });
  const event = { sender: wc, senderFrame: frame }, call = payload => manager.request(event, payload);
  const snapshot = sessionId => call({ operation: 'snapshot', sessionId }).snapshot;
  const fork = () => call({ operation: 'edit-copy', sessionId: originalId, expectedRevision: 0, expectedSha256: snapshot(originalId).editCopySha256 }).snapshot;
  const edit = id => { const s = snapshot(id), span = projectSource(s.source).spans[0]; return call({ operation: 'edit', sessionId: id, expectedRevision: s.revision, from: span.from, to: span.from, insert: 'Edited ' }); };
  const close = (s, extra = {}) => call({ operation: 'close-document', sessionId: s.sessionId, expectedRevision: s.revision, ...extra });
  return { root, file, original, manager, service, store, win, wc, event, originalId, call, snapshot, fork, edit, close, notices };
}
test('read-only close revokes only its own session, never modifies the file', async () => {
  const f = fixture(), draft = f.fork();
  assert.equal((await f.close(f.snapshot(f.originalId))).ok, true);
  assert.equal(f.call({ operation: 'snapshot', sessionId: f.originalId }).code, 'unknown-session');
  assert.equal(f.snapshot(draft.sessionId).source, draft.source);
  assert.deepEqual(fs.readFileSync(f.file), f.original); f.win.emit('closed');
});
test('cancel keeps source, revision and history; confirmed close verifies a recoverable draft', async () => {
  let accepted = false; const f = fixture({ confirm: async () => accepted }), draft = f.fork();
  f.edit(draft.sessionId); const before = f.snapshot(draft.sessionId);
  assert.equal((await f.close(before)).code, 'close-cancelled');
  assert.equal(f.snapshot(draft.sessionId).source, before.source); assert.equal(f.snapshot(draft.sessionId).canUndo, true);
  accepted = true; const result = await f.close(before);
  assert.equal(result.ok, true); assert.equal(result.closed, true);
  assert.equal(result.sessionId, before.sessionId); assert.equal(result.requestRevision, before.revision);
  const rows = f.store.list().drafts; assert.equal(rows.length, 1);
  const recovered = f.store.recover(rows[0].id); assert.equal(recovered.revision, before.revision);
  assert.deepEqual(recovered.bytes, Buffer.from('\ufeff' + before.source));
  assert.equal(f.call({ operation: 'snapshot', sessionId: before.sessionId }).code, 'unknown-session');
  assert.equal(f.snapshot(f.originalId).readOnly, true);
  assert.deepEqual(fs.readFileSync(f.file), f.original); f.win.emit('closed');
});
test('failed draft write refuses close and preserves live edits and Undo', async () => {
  const io = Object.create(fs); io.fsyncSync = () => { throw Object.assign(Error('synthetic failure'), { code: 'EIO' }); };
  const f = fixture({ draftFs: io }), draft = f.fork(); f.edit(draft.sessionId);
  const before = f.snapshot(draft.sessionId), result = await f.close(before);
  assert.equal(result.ok, false); assert.equal(result.closed, false); assert.equal(result.code, 'close-backup-unverified');
  assert.equal(f.snapshot(draft.sessionId).source, before.source); assert.equal(f.snapshot(draft.sessionId).canUndo, true);
  f.win.emit('closed');
});
test('a previously backed-up record changed on disk cannot justify closing', async () => {
  const f = fixture(), draft = f.fork(); f.edit(draft.sessionId); f.manager.flushDrafts();
  const before = f.snapshot(draft.sessionId), record = fs.readdirSync(path.join(f.root, 'drafts'))[0];
  fs.writeFileSync(path.join(f.root, 'drafts', record), 'synthetic corrupt record');
  const result = await f.close(before); assert.equal(result.code, 'close-backup-unverified');
  assert.equal(result.snapshot.draftBackup.state, 'draft-unverified');
  assert.equal(f.snapshot(draft.sessionId).source, before.source); f.win.emit('closed');
});
test('pending native confirmation blocks mutation; stale revisions and foreign frames fail', async () => {
  let finish; const f = fixture({ confirm: () => new Promise(resolve => { finish = resolve; }) }), draft = f.fork();
  assert.equal((await f.close({ ...draft, revision: 1 })).code, 'stale-revision');
  assert.equal(f.manager.request({ sender: {}, senderFrame: f.event.senderFrame }, { operation: 'close-document', sessionId: draft.sessionId, expectedRevision: 0 }).code, 'unauthorized-sender');
  const pending = f.close(draft);
  assert.equal(f.call({ operation: 'undo', sessionId: draft.sessionId, expectedRevision: 0 }).code, 'close-in-progress');
  finish(false); assert.equal((await pending).code, 'close-cancelled');
  assert.equal(f.snapshot(draft.sessionId).source, draft.source); f.win.emit('closed');
});
test('window revocation during confirmation cannot return a successful close acknowledgement', async () => {
  let finish; const f = fixture({ confirm: () => new Promise(resolve => { finish = resolve; }) }), draft = f.fork();
  const pending = f.close(draft); f.win.emit('closed'); finish(true);
  assert.equal((await pending).ok, false);
});

test('partial/unknown export results and saving are never treated as safe to close', async () => {
  const { closeDocumentSession } = require('../lib/document-close');
  for (const copy of [{ created: true, ok: false }, { created: null, ok: false }]) {
    let invalidated = false;
    const result = await closeDocumentSession({ id: 'a', session: { readOnly: true, document: { revision: 0 } }, revision: 0,
      authorized: () => true, service: { getSaveState: () => ({ ok: true }), getCopyState: () => copy,
        close: () => { assert.fail('Unresolved export must not reach close'); } }, invalidate: () => { invalidated = true; } });
    assert.equal(result.code, 'unresolved-save-state'); assert.equal(result.closed, false); assert.equal(invalidated, false);
  }
});


test('cancel returns backup progress completed during native confirmation without changing history', async () => {
  let finish;
  const f = fixture({ confirm: () => new Promise(resolve => { finish = resolve; }) }), draft = f.fork();
  f.edit(draft.sessionId); const before = f.snapshot(draft.sessionId), pending = f.close(before);
  f.manager.flushDrafts(); finish(false); const result = await pending;
  assert.equal(result.code, 'close-cancelled');
  assert.equal(result.snapshot.draftBackup.state, 'backed-up');
  assert.equal(result.snapshot.draftBackup.revision, before.revision);
  assert.equal(result.snapshot.source, before.source); assert.equal(result.snapshot.canUndo, true);
  f.win.emit('closed');
});
test('closing frees a session slot and keeps another draft and its Undo/Redo intact', async () => {
  const f = fixture(), first = f.fork(); f.edit(first.sessionId);
  const second = f.fork(); f.edit(second.sessionId); const before = f.snapshot(second.sessionId);
  for (let i = 0; i < 5; i++) assert.equal(f.call({ operation: 'new-temporary' }).ok, true);
  assert.equal(f.call({ operation: 'new-temporary' }).code, 'session-limit');
  assert.equal((await f.close(f.snapshot(first.sessionId))).ok, true);
  assert.equal(f.call({ operation: 'new-temporary' }).ok, true);
  assert.equal(f.snapshot(second.sessionId).source, before.source);
  const undo = f.call({ operation: 'undo', sessionId: second.sessionId, expectedRevision: before.revision });
  assert.equal(undo.ok, true); assert.equal(undo.snapshot.source, second.source);
  const redo = f.call({ operation: 'redo', sessionId: second.sessionId, expectedRevision: undo.snapshot.revision });
  assert.equal(redo.ok, true); assert.equal(redo.snapshot.source, before.source);
  f.win.emit('closed');
});
