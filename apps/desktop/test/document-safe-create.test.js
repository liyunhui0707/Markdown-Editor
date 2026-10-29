'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = (code = 'EIO') => Object.assign(Error('Synthetic fault'), { code });
function fixture(bytes = Buffer.from(''), enabled = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-safe-create-')));
  fs.chmodSync(root, 0o700);
  process.chdir(root); // Dedicated Node test process, never the Electron app.
  const seed = path.join(root, 'seed.md');
  fs.writeFileSync(seed, bytes, { flag: 'wx', mode: 0o600 });
  const io = Object.create(fs);
  const service = createDocumentService({ fs: io, ...(enabled ? { isolatedCreateRoot: root } : {}) });
  const opened = service.open(seed, enabled ? { syntheticTemporary: true } : {});
  assert.equal(opened.ok, true);
  const document = opened.document;
  const request = (name = 'copy.md') => ({ name, expectedRevision: document.revision, expectedSha256: hash(document.bytesForSave()) });
  return { root, seed, io, service, document, request, target: path.join(root, 'copy.md') };
}
function localEdit(f) {
  assert.equal(f.document.edit({ from: f.document.text.length, to: f.document.text.length,
    insert: '第一段 English 😀\n\n第二段 text 🐈', expectedRevision: f.document.revision }).ok, true);
}
function retained(f, before) {
  assert.deepEqual({ text: f.document.text, revision: f.document.revision, dirty: f.document.dirty,
    identity: f.document.identity, original: f.document.originalBytes }, before);
}
function memory(f) { return { text: f.document.text, revision: f.document.revision, dirty: f.document.dirty,
  identity: f.document.identity, original: f.document.originalBytes }; }

test('exclusive new copy preserves complete source, model baseline, dirty and revision', () => {
  const f = fixture(); localEdit(f); const before = memory(f), calls = [];
  f.io.openSync = (p, flags, ...args) => { if (flags & fs.constants.O_CREAT) calls.push(flags); return fs.openSync(p, flags, ...args); };
  f.io.unlinkSync = f.io.renameSync = () => { throw Error('No delete or replacement permitted'); };
  const result = f.service.createIsolatedCopy(f.document, f.request());
  assert.equal(result.ok, true); assert.equal(result.state, 'created-confirmed'); assert.equal(result.created, true);
  assert.equal(result.revision, before.revision); assert.equal(result.sha256, hash(f.document.bytesForSave()));
  assert.equal(result.realFileSafe, false); assert.equal(result.filePath, f.target);
  assert.deepEqual(fs.readFileSync(f.target), f.document.bytesForSave());
  assert.equal(fs.statSync(f.target).mode & 0o7777, 0o600);
  assert.equal(fs.readFileSync(f.seed).length, 0); retained(f, before);
  assert.equal(f.service.getSaveState(f.document).state, 'not-submitted');
  assert.equal(f.service.save(f.document, { expectedRevision: f.document.revision }).code, 'coordination-required');
  assert.equal(calls.length, 1);
  assert.ok(calls[0] & fs.constants.O_EXCL); assert.ok(calls[0] & fs.constants.O_NOFOLLOW);
  assert.equal(calls[0] & fs.constants.O_TRUNC, 0);
});

for (const [label, text] of [['LF', 'first\n\nsecond'], ['CRLF', 'first\r\n\r\nsecond'],
  ['BOM and untouched syntax', '\ufeff---\r\ntitle: synthetic\r\n---\r\n\r\n# H\r\n\r\n未知 **text** 😀\r\n\r\n    code\r\n<unknown>']]) {
  test('byte fidelity: ' + label + ', no added EOF newline', () => {
    const f = fixture(Buffer.from(text)); const before = memory(f);
    const r = f.service.createIsolatedCopy(f.document, f.request());
    assert.equal(r.ok, true); assert.deepEqual(fs.readFileSync(f.target), Buffer.from(text)); retained(f, before);
  });
}

for (const kind of ['existing', 'dangling symlink', 'competing creator']) {
  test('never overwrites ' + kind, () => {
    const f = fixture(); localEdit(f);
    if (kind === 'existing') fs.writeFileSync(f.target, 'OTHER', { flag: 'wx' });
    if (kind === 'dangling symlink') fs.symlinkSync(path.join(f.root, 'absent.md'), f.target);
    if (kind === 'competing creator') f.io.openSync = (p, flags, ...args) => {
      if (flags & fs.constants.O_CREAT) fs.writeFileSync(p, 'OTHER', { flag: 'wx' });
      return fs.openSync(p, flags, ...args);
    };
    const r = f.service.createIsolatedCopy(f.document, f.request());
    assert.equal(r.ok, false); assert.equal(r.state, 'target-exists'); assert.equal(r.created, false);
    if (kind === 'dangling symlink') { assert.ok(fs.lstatSync(f.target).isSymbolicLink()); assert.equal(fs.existsSync(path.join(f.root, 'absent.md')), false); }
    else assert.equal(fs.readFileSync(f.target, 'utf8'), 'OTHER');
    assert.equal(f.document.dirty, true);
  });
}

test('explicit revision/hash, default denial, non-synthetic and closed sessions', () => {
  const plain = fixture(Buffer.from('real synthetic fixture'), false);
  assert.equal(plain.service.createIsolatedCopy(plain.document, plain.request()).code, 'synthetic-copy-required');
  const f = fixture(); localEdit(f);
  for (const request of [{ ...f.request(), expectedRevision: 0 }, { ...f.request(), expectedSha256: '0'.repeat(64) },
    { name: 'copy.md' }, { ...f.request(), filePath: f.target }, { ...f.request(), name: '../escape.md' },
    { ...f.request(), name: '/private/tmp/escape.md' }]) {
    assert.equal(f.service.createIsolatedCopy(f.document, request).ok, false);
    assert.equal(fs.existsSync(f.target), false);
  }
  const readonly = f.service.open(f.seed).document;
  assert.equal(f.service.createIsolatedCopy(readonly, { ...f.request(), expectedRevision: 0 }).code, 'synthetic-copy-required');
  assert.equal(f.service.close(f.document).ok, true);
  assert.equal(f.service.createIsolatedCopy(f.document, f.request()).code, 'unknown-document');
});

test('cancellation and permission refusal create nothing and preserve memory', () => {
  const f = fixture(); localEdit(f); const before = memory(f);
  assert.equal(f.service.createIsolatedCopy(f.document, { ...f.request(), cancelled: true }).code, 'create-cancelled');
  f.io.openSync = (p, flags, ...args) => { if (flags & fs.constants.O_CREAT) throw fault('EACCES'); return fs.openSync(p, flags, ...args); };
  const r = f.service.createIsolatedCopy(f.document, f.request());
  assert.equal(r.state, 'not-created'); assert.equal(r.created, false);
  assert.equal(fs.existsSync(f.target), false); retained(f, before);
});

test('short writes are completed, zero-progress and disk full retain partial target', () => {
  const good = fixture(); localEdit(good);
  good.io.writeSync = (fd, b, offset, length, position) => fs.writeSync(fd, b, offset, Math.min(length, 3), position);
  assert.equal(good.service.createIsolatedCopy(good.document, good.request()).ok, true);
  assert.deepEqual(fs.readFileSync(good.target), good.document.bytesForSave());
  for (const code of ['ENOSPC', 'zero']) {
    const f = fixture(); localEdit(f); const before = memory(f); let calls = 0;
    f.io.writeSync = (fd, b, offset, length, position) => {
      if (++calls === 1) return fs.writeSync(fd, b, offset, Math.min(length, 3), position);
      if (code === 'zero') return 0;
      throw fault(code);
    };
    const r = f.service.createIsolatedCopy(f.document, f.request());
    assert.equal(r.state, 'created-partial'); assert.equal(r.created, true); assert.equal(r.filePath, f.target);
    assert.equal(fs.readFileSync(f.target).length, 3); retained(f, before);
    assert.equal(f.service.createIsolatedCopy(f.document, f.request('retry.md')).code, 'unresolved-copy-state');
    assert.equal(f.service.close(f.document).code, 'unresolved-copy-state');
    assert.equal(fs.existsSync(path.join(f.root, 'retry.md')), false);
  }
});

for (const kind of ['file', 'directory']) test(kind + ' sync failure is sticky and never claims durable success', () => {
  const f = fixture(); localEdit(f); const before = memory(f);
  f.io.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory() === (kind === 'directory')) throw fault(); return fs.fsyncSync(fd); };
  const r = f.service.createIsolatedCopy(f.document, f.request());
  assert.equal(r.ok, false); assert.equal(r.state, 'durability-uncertain'); assert.equal(r.created, true);
  assert.deepEqual(fs.readFileSync(f.target), f.document.bytesForSave()); retained(f, before);
  assert.equal(f.service.createIsolatedCopy(f.document, f.request('retry.md')).code, 'unresolved-copy-state');
  assert.equal(f.service.save(f.document, { expectedRevision: f.document.revision }).code, 'unresolved-copy-state');
  assert.equal(f.service.getCopyState(f.document).state, 'durability-uncertain');
});

test('open result unknown retains possible created file without cleanup or retry', () => {
  const f = fixture(); localEdit(f); let orphan;
  f.io.openSync = (p, flags, ...args) => {
    const fd = fs.openSync(p, flags, ...args);
    if (flags & fs.constants.O_CREAT) { orphan = fd; throw fault(); }
    return fd;
  };
  const r = f.service.createIsolatedCopy(f.document, f.request());
  if (orphan !== undefined) fs.closeSync(orphan); // Fixture owns the injected lost descriptor.
  assert.equal(r.state, 'create-outcome-unknown'); assert.equal(r.created, null);
  assert.equal(fs.existsSync(f.target), true); assert.equal(r.filePath, f.target);
  assert.equal(f.service.createIsolatedCopy(f.document, f.request()).code, 'unresolved-copy-state');
});

test('root widening, identity replacement and nonlocal filesystem evidence fail closed', () => {
  for (const kind of ['mode', 'identity', 'filesystem']) {
    const f = fixture(); localEdit(f);
    if (kind === 'mode') fs.chmodSync(f.root, 0o755);
    if (kind === 'identity') { fs.renameSync(f.root, f.root + '-retained'); fs.mkdirSync(f.root, { mode: 0o700 }); }
    if (kind === 'filesystem') f.io.statfsSync = p => ({ ...fs.statfsSync(p), type: 0x6969 });
    const r = f.service.createIsolatedCopy(f.document, f.request());
    assert.equal(r.ok, false); assert.equal(r.state, 'not-created'); assert.equal(fs.existsSync(f.target), false);
  }
});

test('content interference and changed identity after writing never produce confirmed copy', () => {
  for (const kind of ['bytes', 'identity', 'mode']) {
    const f = fixture(); localEdit(f); let changed = false;
    f.io.fsyncSync = fd => {
      fs.fsyncSync(fd);
      if (!changed && fs.fstatSync(fd).isFile()) {
        changed = true;
        if (kind === 'bytes') fs.writeFileSync(f.target, 'TAMPER');
        if (kind === 'mode') fs.chmodSync(f.target, 0o666);
        if (kind === 'identity') { fs.renameSync(f.target, f.target + '.retained'); fs.writeFileSync(f.target, 'OTHER', { flag: 'wx' }); }
      }
    };
    const r = f.service.createIsolatedCopy(f.document, f.request());
    assert.equal(r.ok, false); assert.equal(r.state, 'created-unverified'); assert.equal(r.created, true);
    assert.equal(r.sha256, undefined); assert.equal(f.document.dirty, true);
  }
});

test('single flight rejects reentrant create/close/save and rechecks source revision', () => {
  const f = fixture(); localEdit(f); let checked = false;
  f.io.writeSync = (...args) => {
    if (!checked) { checked = true;
      assert.equal(f.service.createIsolatedCopy(f.document, f.request('second.md')).code, 'save-in-progress');
      assert.equal(f.service.close(f.document).code, 'save-in-progress');
      assert.equal(f.service.save(f.document, { expectedRevision: f.document.revision }).code, 'save-in-progress');
      f.document.edit({ from: 0, to: 0, insert: 'LATER' });
    }
    return fs.writeSync(...args);
  };
  const r = f.service.createIsolatedCopy(f.document, f.request());
  assert.equal(r.ok, false); assert.equal(r.code, 'copy-source-changed'); assert.equal(r.created, true);
  assert.equal(f.document.text.startsWith('LATER'), true); assert.equal(f.document.dirty, true);
});

test('creator process exits; a fresh process reopens the bytes through existing readonly authorization', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-safe-create-')));
  fs.chmodSync(root, 0o700); const seed = path.join(root, 'seed.md'); fs.writeFileSync(seed, '', { mode: 0o600 });
  const servicePath = require.resolve('../lib/document-service');
  const writer = spawnSync(process.execPath, ['-e', `
    const {createDocumentService}=require(${JSON.stringify(servicePath)});
    const {createHash}=require('node:crypto');
    const s=createDocumentService({isolatedCreateRoot:${JSON.stringify(root)}});
    const d=s.open(${JSON.stringify(seed)},{syntheticTemporary:true}).document;
    d.edit({from:0,to:0,insert:'第一段 English 😀\\n\\n第二段 text 🐈',expectedRevision:0});
    const r=s.createIsolatedCopy(d,{name:'copy.md',expectedRevision:d.revision,expectedSha256:createHash('sha256').update(d.bytesForSave()).digest('hex')});
    if(!r.ok) throw Error(JSON.stringify(r)); console.log(JSON.stringify(r));
  `], { encoding: 'utf8', timeout: 15000, cwd: root });
  assert.equal(writer.status, 0, writer.stderr); assert.equal(writer.signal, null);
  const receipt = JSON.parse(writer.stdout);
  const reader = spawnSync(process.execPath, ['-e', `
    const {createDocumentService}=require(${JSON.stringify(servicePath)});
    const {createDocumentSessions}=require(${JSON.stringify(require.resolve('../lib/document-session-ipc'))});
    const {EventEmitter}=require('node:events');const {createHash}=require('node:crypto');
    (async()=>{ const {projectSource,mapTextEdit}=await import(${JSON.stringify(require('node:url').pathToFileURL(path.resolve(__dirname, '../lib/document-source-map.mjs')).href)});
      const wc=new EventEmitter(),win=new EventEmitter(),frame={url:'file:///synthetic/test.html'};
      Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send:()=>{}});
      Object.assign(win,{webContents:wc,isDestroyed:()=>false});
      const s=createDocumentService(),m=createDocumentSessions({service:s,projectSource,mapTextEdit,windowFor:()=>win,
        chooseFile:async()=>({canceled:false,filePaths:[${JSON.stringify(path.join(root, 'copy.md'))}]})});
      m.grant(win,frame.url);const event={sender:wc,senderFrame:frame};const r=await m.request(event,{operation:'open-file'});
      if(!r.ok||!r.snapshot.readOnly)throw Error('readonly reopen failed');
      const denied=m.request(event,{operation:'save',sessionId:r.snapshot.sessionId,expectedRevision:r.snapshot.revision});
      if(denied.code!=='read-only-document')throw Error('save not denied');
      console.log(JSON.stringify({hash:createHash('sha256').update(r.snapshot.source).digest('hex'),source:r.snapshot.source}));
    })().catch(e=>{console.error(e);process.exitCode=1;});
  `], { encoding: 'utf8', timeout: 15000, cwd: root });
  assert.equal(reader.status, 0, reader.stderr); assert.equal(reader.signal, null);
  const observed = JSON.parse(reader.stdout);
  assert.equal(observed.hash, receipt.sha256); assert.equal(observed.source, '第一段 English 😀\n\n第二段 text 🐈');
  assert.equal(hash(fs.readFileSync(path.join(root, 'copy.md'))), receipt.sha256);
  t.diagnostic(JSON.stringify({ creatorExit: writer.status, creatorSignal: writer.signal, readerExit: reader.status,
    readerSignal: reader.signal, filePath: receipt.filePath, sha256: receipt.sha256, byteLength: receipt.byteLength }));
});

test('renderer has no create capability, even for temporary/readonly/revoked sessions or extra paths', async () => {
  const { projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs');
  const f = fixture(), wc = new EventEmitter(), win = new EventEmitter(), frame = { url: 'file:///synthetic/test.html' };
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, send: () => {} });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  const m = createDocumentSessions({ service: f.service, projectSource, mapTextEdit, windowFor: () => win });
  m.grant(win, frame.url);
  const temp = m.provision(win, f.document, 'Temporary', { temporary: true });
  const ro = m.provision(win, f.service.open(f.seed).document, 'Readonly', { readOnly: true });
  const event = { sender: wc, senderFrame: frame };
  for (const sessionId of [temp, ro, 'invalid']) for (const extra of [{}, { path: f.target }, { pending: 1 }, { composing: true }]) {
    assert.equal((await m.request(event, { operation: 'create-copy', sessionId, expectedRevision: 0, ...extra })).ok, false);
  }
  assert.equal(m.request(event, { operation: 'save', sessionId: temp, expectedRevision: 0 }).code, 'temporary-not-persistable');
  assert.equal(m.request(event, { operation: 'save', sessionId: ro, expectedRevision: 0 }).code, 'read-only-document');
  m.revoke(win); assert.equal(m.request(event, { operation: 'create-copy', sessionId: temp }).code, 'unauthorized-sender');
  assert.equal(fs.existsSync(f.target), false);
});

test('wrong cwd, symlink root and outside-root synthetic source are refused', () => {
  const f = fixture(); localEdit(f);
  process.chdir(path.dirname(f.root));
  assert.equal(f.service.createIsolatedCopy(f.document, f.request()).state, 'not-created');
  assert.equal(fs.existsSync(f.target), false);
  process.chdir(f.root);
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-safe-create-')));
  const outside = path.join(other, 'seed.md'); fs.writeFileSync(outside, 'OTHER', { mode: 0o600 });
  assert.equal(f.service.open(outside, { syntheticTemporary: true }).ok, false);
  const link = path.join(path.dirname(f.root), path.basename(f.root) + '-link');
  fs.symlinkSync(f.root, link);
  assert.throws(() => createDocumentService({ isolatedCreateRoot: link }), { code: 'isolated-create-scope-required' });
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OTHER');
});

test('parent replacement at open cannot redirect the relative creation into replacement directory', () => {
  const f = fixture(); localEdit(f); const moved = f.root + '-retained'; let raced = false;
  f.io.openSync = (p, flags, ...args) => {
    if (flags & fs.constants.O_CREAT) {
      assert.equal(p, 'copy.md'); // Kernel cwd remains the original directory vnode.
      raced = true; fs.renameSync(f.root, moved); fs.mkdirSync(f.root, { mode: 0o700 });
    }
    return fs.openSync(p, flags, ...args);
  };
  const r = f.service.createIsolatedCopy(f.document, f.request());
  assert.equal(raced, true); assert.equal(r.ok, false); assert.equal(r.created, true);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.readFileSync(path.join(moved, 'copy.md')).length, 0);
  assert.equal(typeof r.fileIdentity, 'string'); assert.equal(r.state, 'created-partial');
});

test('unsupported directory xattrs are refused, never inherited silently', () => {
  const f = fixture(); localEdit(f);
  const r = spawnSync('/usr/bin/xattr', ['-w', 'org.markdown.synthetic-test', 'synthetic', f.root], { encoding: 'utf8', timeout: 3000 });
  assert.equal(r.status, 0, r.stderr);
  const result = f.service.createIsolatedCopy(f.document, f.request());
  assert.equal(result.ok, false); assert.equal(result.code, 'unsupported-xattrs');
  assert.equal(result.state, 'not-created'); assert.equal(fs.existsSync(f.target), false);
});

test('parse failure and external seed changes retain source and refuse creation', () => {
  for (const kind of ['parse', 'external']) {
    const f = fixture(); localEdit(f); const before = memory(f), request = f.request();
    if (kind === 'parse') f.document.parse(() => { throw fault(); });
    else fs.writeFileSync(f.seed, 'EXTERNAL');
    const r = f.service.createIsolatedCopy(f.document, request);
    assert.equal(r.ok, false); assert.equal(r.code, kind === 'parse' ? 'conversion-blocked' : 'external-change');
    assert.equal(fs.existsSync(f.target), false); retained(f, before);
  }
});

test('descriptor close failure does not bless success or retry; recovery receipt cannot be mutated', () => {
  const f = fixture(); localEdit(f); let leaked;
  f.io.closeSync = fd => {
    if (fs.fstatSync(fd).isFile() && fs.fstatSync(fd).size === f.document.bytesForSave().length) { leaked = fd; throw fault(); }
    return fs.closeSync(fd);
  };
  const r = f.service.createIsolatedCopy(f.document, f.request());
  if (leaked !== undefined) fs.closeSync(leaked);
  assert.equal(r.ok, false); assert.equal(r.state, 'durability-uncertain');
  assert.equal(r.descriptorCleanupFailed, true);
  assert.throws(() => { r.ok = true; }, TypeError);
  assert.equal(f.service.getCopyState(f.document).ok, false);
  assert.equal(f.service.createIsolatedCopy(f.document, f.request('retry.md')).code, 'unresolved-copy-state');
});

test('creating a confirmed revision copy preserves existing IPC Undo/Redo history', async () => {
  const { projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs');
  const f = fixture(Buffer.from('original')), wc = new EventEmitter(), win = new EventEmitter(), frame = { url: 'file:///synthetic/test.html' };
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, send: () => {} });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  const m = createDocumentSessions({ service: f.service, projectSource, mapTextEdit, windowFor: () => win });
  m.grant(win, frame.url); const id = m.provision(win, f.document, 'Temporary', { temporary: true });
  const call = (operation, data = {}) => m.request({ sender: wc, senderFrame: frame }, { operation, sessionId: id, ...data });
  const edited = call('edit', { expectedRevision: 0, from: 1, to: 1, insert: '新😀' });
  assert.equal(edited.ok, true); const before = call('snapshot').snapshot;
  assert.equal(f.service.createIsolatedCopy(f.document, f.request()).ok, true);
  assert.deepEqual(call('snapshot').snapshot, before);
  const undo = call('undo', { expectedRevision: before.revision }); assert.equal(undo.ok, true); assert.equal(undo.snapshot.source, 'original');
  const redo = call('redo', { expectedRevision: undo.snapshot.revision }); assert.equal(redo.ok, true); assert.equal(redo.snapshot.source, before.source);
  assert.equal(fs.readFileSync(f.target, 'utf8'), before.source);
});

test('same-byte rewrite after fsync cannot reuse the earlier synchronization evidence', () => {
  const f = fixture(); localEdit(f); let changed = false;
  f.io.fsyncSync = fd => {
    fs.fsyncSync(fd);
    if (!changed && fs.fstatSync(fd).isFile()) {
      changed = true;
      fs.writeFileSync(f.target, f.document.bytesForSave());
      // Deterministic metadata transition even on low-resolution filesystems.
      fs.utimesSync(f.target, new Date(0), new Date(0));
    }
  };
  const r = f.service.createIsolatedCopy(f.document, f.request());
  assert.equal(r.ok, false); assert.equal(r.state, 'created-unverified');
  assert.equal(r.created, true); assert.equal(r.sha256, undefined);
  assert.deepEqual(fs.readFileSync(f.target), f.document.bytesForSave());
});


async function copyIpc({ enabled = true, readOnly = false } = {}) {
  const f = fixture(Buffer.from('first\r\n\r\n第二段😀'));
  const { projectSource, mapTextEdit } = await import('../lib/document-source-map.mjs');
  const wc = new EventEmitter(), win = new EventEmitter(), frame = { url: 'file:///synthetic/copy.html' };
  Object.assign(wc, { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, send: () => {} });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  const manager = createDocumentSessions({ service: f.service, projectSource, mapTextEdit, windowFor: () => win, allowTestCopies: enabled });
  manager.grant(win, frame.url);
  const id = manager.provision(win, f.document, 'Synthetic', readOnly ? { readOnly: true } : { temporary: true });
  const event = { sender: wc, senderFrame: frame };
  const call = (operation, data = {}) => manager.request(event, { operation, sessionId: id, ...data });
  const copy = (data = {}) => call('create-test-copy', { expectedRevision: f.document.revision, expectedSha256: hash(f.document.bytesForSave()), ...data });
  return { ...f, manager, win, wc, frame, id, event, call, copy };
}
test('test copy IPC uses authoritative bytes; receipt never advances dirty/revision/history', async () => {
  const f = await copyIpc();
  const edit = f.call('edit', { expectedRevision: 0, from: 1, to: 1, insert: '新' }); assert.equal(edit.ok, true);
  const before = f.call('snapshot').snapshot, result = f.copy();
  assert.equal(result.ok, true); assert.equal(result.copy.state, 'created-confirmed');
  assert.equal(result.copy.revision, before.revision); assert.equal(result.copy.sha256, before.copySha256);
  assert.deepEqual(fs.readFileSync(result.copy.filePath), f.document.bytesForSave());
  for (const key of ['source', 'revision', 'dirty', 'canUndo', 'canRedo', 'saveState']) assert.deepEqual(result.snapshot[key], before[key]);
  assert.equal(f.call('undo', { expectedRevision: before.revision }).ok, true);
  assert.equal(f.call('redo', { expectedRevision: f.document.revision }).ok, true);
  assert.equal(f.copy().ok, true); // A new main-generated name, never overwrite the first receipt.
  assert.deepEqual(fs.readFileSync(result.copy.filePath), Buffer.from(before.source));
});
test('test copy IPC refuses default capability, readonly sessions, arbitrary paths and stale identity', async () => {
  for (const options of [{ enabled: false }, { readOnly: true }]) {
    const f = await copyIpc(options); assert.equal(f.copy().ok, false); assert.deepEqual(fs.readdirSync(f.root), ['seed.md']);
  }
  const f = await copyIpc();
  for (const data of [{ name: 'x.md' }, { filePath: '/private/tmp/forbidden.md' }, { source: 'FAKE' }, { unsafeExperimentalRoot: f.root },
    { expectedRevision: 99 }, { expectedSha256: '0'.repeat(64) }]) assert.equal(f.copy(data).ok, false);
  assert.equal(f.manager.request({ sender: f.wc, senderFrame: {} }, { operation: 'create-test-copy', sessionId: f.id }).code, 'unauthorized-sender');
  assert.deepEqual(fs.readdirSync(f.root), ['seed.md']);
  f.manager.revoke(f.win); assert.equal(f.copy().ok, false);
});
test('test copy IPC propagates partial and uncertain receipts without retry or memory loss', async () => {
  for (const kind of ['partial', 'sync', 'exists']) {
    const f = await copyIpc(), before = memory(f); let target;
    f.io.openSync = (p, flags, ...rest) => {
      if (flags & fs.constants.O_CREAT) { target = path.join(f.root, p); if (kind === 'exists') fs.writeFileSync(target, 'OTHER', { flag: 'wx' }); }
      return fs.openSync(p, flags, ...rest);
    };
    if (kind === 'partial') f.io.writeSync = () => { throw fault('ENOSPC'); };
    if (kind === 'sync') f.io.fsyncSync = () => { throw fault(); };
    const result = f.copy(); assert.equal(result.ok, false);
    assert.equal(result.copy.state, kind === 'partial' ? 'created-partial' : kind === 'sync' ? 'durability-uncertain' : 'target-exists');
    assert.equal(result.copy.filePath, target); retained(f, before);
    if (kind !== 'exists') { assert.equal(f.copy().code, 'unresolved-copy-state'); assert.equal(fs.readdirSync(f.root).length, 2); }
    else assert.equal(fs.readFileSync(target, 'utf8'), 'OTHER');
  }
});
test('test copy IPC serializes reentrant edits and refuses a revoked response', async () => {
  const f = await copyIpc(); let during, nested, once = false;
  f.io.fsyncSync = fd => {
    if (!once) { once = true; during = f.call('edit', { expectedRevision: 0, from: 1, to: 1, insert: 'BAD' }); nested = f.copy(); }
    return fs.fsyncSync(fd);
  };
  assert.equal(f.copy().ok, true); assert.equal(during.code, 'copy-in-progress'); assert.equal(nested.code, 'copy-in-progress');
  const g = await copyIpc(); let revoked = false;
  g.io.fsyncSync = fd => { if (!revoked) { revoked = true; g.manager.revoke(g.win); } fs.fsyncSync(fd); };
  const result = g.copy(); assert.equal(result.ok, false); assert.equal(result.code, 'copy-session-invalidated');
  assert.equal(result.snapshot, undefined); assert.equal(g.manager.retainedCount(), 1);
});
