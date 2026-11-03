'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto'), { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createDraftStore } = require('../lib/document-draft-store');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
const hash = b => createHash('sha256').update(b).digest('hex');
const root = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-drafts-unit-')));
function fixture(io = fs) { const dir = path.join(root(), 'drafts'); return { dir, store: createDraftStore(dir, { fs: io }) }; }
function save(store, body, previous, id = previous?.id || store.newId()) {
  return store.save({ id, token: previous?.token, fingerprint: previous?.fingerprint, label: 'Synthetic', revision: previous ? previous.revision + 1 : 1, bytes: Buffer.from(body) });
}
test('two distinct drafts survive a new process with exact BOM/CRLF and unicode bytes', () => {
  const { dir, store } = fixture();
  const sources = ['\ufeff---\r\nx: keep\r\n---\r\n\r\n中文😀\r\n\r\n```\r\nopaque()\r\n```', 'Second\n\nparagraph.'];
  const results = sources.map(text => save(store, text));
  assert.ok(results.every(r => r.ok));
  const fresh = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(require.resolve('../lib/document-draft-store'))}).createDraftStore(${JSON.stringify(dir)});console.log(JSON.stringify(s.list().drafts.map(d=>({id:d.id,hash:require('node:crypto').createHash('sha256').update(s.recover(d.id).bytes).digest('hex')}))))`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(fresh.status, 0); const actual = JSON.parse(fresh.stdout);
  for (const [i, r] of results.entries()) assert.equal(actual.find(d => d.id === r.id).hash, hash(sources[i]));
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.ok(fs.readdirSync(dir).every(n => (fs.statSync(path.join(dir, n)).mode & 0o777) === 0o600));
});
test('retention keeps the two newest confirmed generations and refuses a stale writer', () => {
  const { dir, store } = fixture(); let previous;
  for (let i = 0; i < 8; i++) { previous = save(store, 'revision ' + i, previous); assert.equal(previous.ok, true); }
  assert.equal(fs.readdirSync(dir).length, 2);
  const old = { ...previous }; previous = save(store, 'new', previous); assert.equal(previous.ok, true);
  const collision = save(store, 'must not replace', old); assert.equal(collision.ok, false); assert.equal(collision.code, 'draft-conflict');
  assert.equal(store.recover(previous.id).bytes.toString(), 'new');
});
test('partial newest record retains older recoverable content with an explicit warning', () => {
  const { dir, store } = fixture(), first = save(store, 'older');
  fs.writeFileSync(path.join(dir, `${first.id}.2.json`), '{partial', { flag: 'wx', mode: 0o600 });
  const r = createDraftStore(dir).recover(first.id);
  assert.equal(r.bytes.toString(), 'older'); assert.equal(r.warning, 'newer-draft-unreadable');
  assert.equal(store.list().drafts[0].warning, r.warning);
  assert.equal(save(store, 'NO', first).code, 'draft-conflict'); assert.equal(fs.readdirSync(dir).length, 2);
});
for (const fault of ['partial', 'sync']) test('failed '+fault+' write never confirms or discards earlier records', () => {
  const io = Object.create(fs); let enabled = false;
  io.writeSync = (...args) => { if (enabled && fault === 'partial') { fs.writeSync(args[0], args[1], 0, 5, 0); throw Error('synthetic'); } return fs.writeSync(...args); };
  io.fsyncSync = fd => { if (enabled && fault === 'sync') throw Error('synthetic'); fs.fsyncSync(fd); };
  const { dir, store } = fixture(io), first = save(store, 'original backup'); enabled = true;
  const r = save(store, 'new writing', first); assert.equal(r.ok, false); assert.equal(r.state, 'draft-unverified');
  assert.equal(fs.readdirSync(dir).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, first.token))).record.contentHash, hash('original backup'));
});
test('directory replacement, symlinks, foreign entries and permissive modes fail closed', () => {
  const { dir, store } = fixture(), id = store.newId(), other = path.join(root(), 'foreign'); fs.mkdirSync(other, { mode: 0o700 });
  fs.renameSync(dir, dir+'-moved'); fs.mkdirSync(dir, { mode: 0o700 });
  assert.equal(save(store, 'NO', null, id).code, 'draft-directory-changed'); assert.deepEqual(fs.readdirSync(dir), []);
  fs.symlinkSync(other, path.join(dir, id+'.1.json'));
  assert.equal(createDraftStore(dir).recover(id).ok, false); assert.deepEqual(fs.readdirSync(other), []);
  fs.writeFileSync(path.join(dir, 'unknown'), 'untouched'); assert.equal(createDraftStore(dir).list().ok, false);
  fs.chmodSync(other, 0o755); assert.throws(() => createDraftStore(other), { code: 'draft-directory-changed' });
});
test('modified baseline is not silently adopted and corrupt hashes cannot be restored', () => {
  const { dir, store } = fixture(), first = save(store, 'trusted'), file = path.join(dir, first.token);
  fs.writeFileSync(file, fs.readFileSync(file)); // same bytes, changed ctime
  assert.equal(save(store, 'NO', first).code, 'draft-conflict');
  const record = JSON.parse(fs.readFileSync(file)); record.record.body = Buffer.from('tampered').toString('base64');
  fs.writeFileSync(file, JSON.stringify(record)); assert.equal(store.recover(first.id).ok, false);
});
test('capacity refuses new drafts while preserving existing content', () => {
  const { dir, store } = fixture();
  for (let i=0;i<32;i++) assert.equal(save(store, 'keep '+i).ok, true);
  assert.equal(save(store, 'overflow').code, 'draft-capacity'); assert.equal(fs.readdirSync(dir).length, 32);
  assert.equal(store.list().drafts.length, 32);
});
let projectSource, mapTextEdit;
test.before(async () => ({ projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs')));
function sessions(store) {
  const dir = root(), service = createDocumentService(), wc = new EventEmitter(), win = new EventEmitter(), frame = { url: 'file:///synthetic/document.html' }, notices = [];
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, send: (channel, data) => notices.push({ channel, data }) });
  Object.assign(win, { webContents: wc, isDestroyed: () => false }); let count=0;
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit, windowFor: s => s===wc?win:null, draftStore: store,
    createTemporary: bytes => { const file=path.join(dir, `seed-${++count}.md`); fs.writeFileSync(file, bytes, {flag:'wx',mode:0o600}); return service.open(file); } });
  manager.grant(win, frame.url); const event={sender:wc,senderFrame:frame};
  return { dir, manager, service, win, wc, frame, event, notices, call: p=>manager.request(event,p) };
}
test('only main-confirmed edits are backed up; restore grants a fresh temporary identity and empty history', () => {
  const { dir, store } = fixture(), f = sessions(store), s = f.call({operation:'new-temporary'}).snapshot;
  const edited = f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:0,from:1,to:1,insert:'First 中文😀'}).snapshot;
  f.manager.flushDrafts(); const status=f.call({operation:'snapshot',sessionId:s.sessionId}).snapshot;
  assert.equal(status.draftBackup.state,'backed-up'); assert.equal(status.draftBackup.revision,1); assert.equal(status.dirty,true); assert.equal(status.canUndo,true);
  assert.equal(f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:0,from:1,to:1,insert:'NO'}).code,'stale-revision');
  assert.equal(f.call({operation:'save',sessionId:s.sessionId,expectedRevision:1}).code,'temporary-not-persistable');
  const listed=f.call({operation:'list-drafts'}); assert.equal(listed.drafts.length,1); assert.equal(listed.drafts[0].active,true);
  const draftId=listed.drafts[0].id; assert.equal(f.call({operation:'restore-draft',draftId}).code,'draft-already-open');
  f.win.emit('closed');
  const g=sessions(createDraftStore(dir)), recovered=g.call({operation:'restore-draft',draftId});
  assert.equal(recovered.ok,true); const r=recovered.snapshot;
  assert.notEqual(r.sessionId,s.sessionId); assert.equal(r.source,edited.source); assert.equal(r.temporary,true); assert.equal(r.readOnly,false);
  assert.equal(r.revision,0); assert.equal(r.canUndo,false); assert.equal(r.canRedo,false);
  assert.equal(g.call({operation:'snapshot',sessionId:s.sessionId}).code,'unknown-session');
  assert.equal(g.call({operation:'save',sessionId:r.sessionId,expectedRevision:0}).code,'temporary-not-persistable');
  g.win.emit('closed');
});
test('draft IPC rejects forged paths/body, foreign senders and unreadable records without changing active writing', () => {
  const { store }=fixture(), f=sessions(store), s=f.call({operation:'new-temporary'}).snapshot;
  for(const payload of [{operation:'list-drafts',path:f.dir},{operation:'restore-draft',draftId:'../private'},{operation:'restore-draft',draftId:store.newId(),source:'NO'}]) assert.equal(f.call(payload).ok,false);
  assert.equal(f.manager.request({sender:{},senderFrame:f.frame},{operation:'list-drafts'}).code,'unauthorized-sender');
  assert.equal(f.call({operation:'snapshot',sessionId:s.sessionId}).snapshot.source,'');f.win.emit('closed');
});
test('undo/redo backup latest confirmed revision; failed backup does not fail editing or lose prior receipt', () => {
  const { store }=fixture(), f=sessions(store), s=f.call({operation:'new-temporary'}).snapshot;
  f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:0,from:1,to:1,insert:'First'});f.manager.flushDrafts();
  f.call({operation:'undo',sessionId:s.sessionId,expectedRevision:1});f.manager.flushDrafts();
  assert.equal(store.recover(store.list().drafts[0].id).bytes.toString(),'');
  f.call({operation:'redo',sessionId:s.sessionId,expectedRevision:2});f.manager.flushDrafts();
  assert.equal(store.recover(store.list().drafts[0].id).bytes.toString(),'First');
  store.save=()=>({ok:false,state:'draft-unverified',code:'synthetic-fault'});
  const r=f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:3,from:6,to:6,insert:' later'});assert.equal(r.ok,true);f.manager.flushDrafts();
  const after=f.call({operation:'snapshot',sessionId:s.sessionId}).snapshot;
  assert.equal(after.source,'First later');assert.equal(after.draftBackup.state,'draft-unverified');assert.equal(after.draftBackup.revision,3);assert.equal(after.canUndo,true);
  f.win.emit('closed');
});


test('automatic timer backs up only accepted revisions and session revocation flushes pending edits', async () => {
  const { store } = fixture(), f = sessions(store), s = f.call({ operation: 'new-temporary' }).snapshot;
  f.call({ operation: 'edit', sessionId: s.sessionId, expectedRevision: 0, from: 1, to: 1, insert: 'Confirmed' });
  assert.equal(store.list().drafts.length, 0);
  await new Promise(resolve => setTimeout(resolve, 950));
  assert.equal(store.list().drafts.length, 1);
  assert.equal(f.notices.some(n => n.channel === 'document-demo:draft-status' && n.data.backup.state === 'backed-up'), true);
  f.call({ operation: 'edit', sessionId: s.sessionId, expectedRevision: 1, from: 10, to: 10, insert: ' latest' });
  f.win.emit('closed');
  assert.equal(store.recover(store.list().drafts[0].id).bytes.toString(), 'Confirmed latest');
});
test('original readonly bytes and authority survive copy backup and recovery', () => {
  const { store } = fixture(), f = sessions(store), original = Buffer.from('\ufeffFirst 中文😀\r\n\r\nSecond.\r\n');
  const file = path.join(f.dir, 'original.md'); fs.writeFileSync(file, original, { flag: 'wx', mode: 0o600 });
  const opened = f.service.open(file), id = f.manager.provision(f.win, opened.document, 'original.md', { readOnly: true });
  const s = f.call({ operation: 'snapshot', sessionId: id }).snapshot;
  const copy = f.call({ operation: 'edit-copy', sessionId: id, expectedRevision: 0, expectedSha256: s.editCopySha256 });
  assert.equal(copy.ok, true); f.manager.flushDrafts();
  for (const operation of ['edit', 'save']) assert.equal(f.call({ operation, sessionId: id, expectedRevision: 0 }).code, 'read-only-document');
  assert.equal(store.list().drafts.length, 1); assert.ok(store.recover(store.list().drafts[0].id).bytes.equals(original));
  assert.equal(hash(fs.readFileSync(file)), hash(original)); f.win.emit('closed');
});
test('permission denial remains failed; ambiguous creation stops automatic attempts', () => {
  for (const code of ['EACCES', 'EIO']) {
    const io = Object.create(fs); io.openSync = (file, flags, ...args) => {
      if (flags & fs.constants.O_CREAT) throw Object.assign(Error('synthetic'), { code });
      return fs.openSync(file, flags, ...args);
    };
    const { store } = fixture(io), f = sessions(store), s = f.call({ operation: 'new-temporary' }).snapshot;
    f.call({ operation: 'edit', sessionId: s.sessionId, expectedRevision: 0, from: 1, to: 1, insert: 'Keep' }); f.manager.flushDrafts();
    const before = f.call({ operation: 'snapshot', sessionId: s.sessionId }).snapshot;
    assert.equal(before.draftBackup.state, code === 'EIO' ? 'draft-unverified' : 'backup-failed');
    assert.equal(before.draftBackup.revision, null); assert.equal(before.source, 'Keep');
    let attempts = 0; store.save = () => { attempts++; return { ok: false, state: 'backup-failed', code }; };
    f.call({ operation: 'edit', sessionId: s.sessionId, expectedRevision: 1, from: 5, to: 5, insert: ' safe' }); f.manager.flushDrafts();
    assert.equal(attempts, code === 'EIO' ? 0 : 1); f.win.emit('closed');
  }
});


test('draft UI rejects stale receipts and distinguishes backup from unconfirmed input and file saving', async () => {
  const { createDraftView } = await import('../lib/document-draft-view.mjs');
  const nodes = new Map(), byId = id => { if (!nodes.has(id)) nodes.set(id, { dataset: {}, replaceChildren() {} }); return nodes.get(id); };
  let received;
  const s = { confirmed: { temporary: true, sessionId: 'a', revision: 3, source: 'confirmed', draftBackup: { sequence: 1, state: 'backup-pending', revision: 2 } }, source: 'confirmed', recoveryRecords: [] };
  const view = createDraftView({ api: { onDraftStatus: handler => { received = handler; }, listDrafts: async () => ({ ok: true, drafts: [] }) }, byId, context: () => ({ state: s }), restore: async () => {} });
  view.configure({ draftsEnabled: true }); view.render(s);
  assert.match(byId('draft-backup-status').textContent, /最后已备份修订 2/);
  received({ sessionId: 'a', backup: { sequence: 2, state: 'backed-up', revision: 3 } });
  view.render(s); // Older snapshot must not replace a newer receipt.
  assert.match(byId('draft-backup-status').textContent, /已备份（修订 3）/); assert.match(byId('draft-backup-status').textContent, /Not saved/);
  s.recoveryRecords = [{ text: 'not committed' }]; view.render(s); assert.match(byId('draft-backup-status').textContent, /不包含在备份保证中/);
  received({ sessionId: 'b', backup: { sequence: 99, state: 'backed-up', revision: 99 } });
  assert.doesNotMatch(byId('draft-backup-status').textContent, /99/);
  received({ sessionId: 'a', backup: { sequence: 3, state: 'draft-unverified', revision: 3, code: 'synthetic' } });
  assert.match(byId('draft-backup-status').textContent, /未确认/); assert.match(byId('draft-backup-status').textContent, /最后已备份修订 3/);
});
