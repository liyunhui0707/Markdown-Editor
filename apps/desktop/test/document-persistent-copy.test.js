'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { captureCopyDestination, inspectMacMetadata, suggestCopyPath } = require('../lib/document-save-policy');
const { createCopyProcess } = require('../lib/document-copy-process');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
const { createHomeFixture } = require('./helpers/home-fixture.cjs');
const hash = b => createHash('sha256').update(b).digest('hex');
const text = 'First 中文 😀\n\nSecond paragraph.';
const baselineCwd = process.cwd();
function destination({ cleanup = false } = {}) {
  const owned = createHomeFixture('Markdown-Persistent-Test-V1-');
  if (!cleanup) owned.keep('negative-or-uncertain-test-evidence');
  return { dir: owned.dir, filePath: path.join(owned.dir, 'copy.md'), owned };
}
function reclaim(owned) {
  // Last statement of a passing case, after writer exit and fresh-reader completion.
  const result = owned.cleanup({ passed: true, quiescent: true });
  assert.equal(result.state, 'removed', JSON.stringify(result));
  console.log('home-fixture-cleanup:' + JSON.stringify(result));
}
function nodeFork(hooks = {}) {
  return (entry, args, options) => {
    // Test-only Node transport. Production uses Electron utilityProcess exclusively.
    const child = spawn(process.execPath, ['-e', `
      const fs=require('node:fs');let target;
      const open=fs.openSync;fs.openSync=function(p,f,...args){const fd=open.call(fs,p,f,...args);if(f&fs.constants.O_CREAT){target=fd;
        ${hooks.nativeFileMetadata ? `for(const [name,value] of [['com.apple.macl','01020304'],['com.apple.lastuseddate#PS','01000000000000000000000000000000']]){const r=require('node:child_process').spawnSync('/usr/bin/xattr',['-wx',name,value,p]);if(r.status!==0)throw Error('synthetic xattr setup failed');}` : ''}
      }return fd};
      ${hooks.firstMetadata ? `
      const cp=require('node:child_process'),nativeSpawn=cp.spawnSync;let probes=0;
      cp.spawnSync=function(exe,args,opts){
        if(target && exe==='/bin/ls' && args[0]==='-lde' && args[1]===require('node:path').join(process.cwd(),'copy.md')){
          ++probes;
          if(probes===1){const r=nativeSpawn('/usr/bin/xattr',['-wx','com.apple.macl','01020304',args[1]]);if(r.status!==0)throw Error('synthetic xattr setup failed');}
          if(probes===2 && ${JSON.stringify(hooks.afterBaseline)}==='attribute')nativeSpawn('/usr/bin/xattr',['-wx','com.apple.macl','01020305',args[1]]);
          if(probes===2 && ${JSON.stringify(hooks.afterBaseline)}==='content')fs.writeSync(target,Buffer.from('X'),0,1,0);
          if(probes===2 && ${JSON.stringify(hooks.afterBaseline)}==='ctime')fs.fchmodSync(target,0o600);
          if(probes===2 && ${JSON.stringify(hooks.afterBaseline)}==='mode')fs.fchmodSync(target,0o640);
        }
        return nativeSpawn(exe,args,opts);
      };` : ''}
      ${hooks.fault === 'partial' ? `const write=fs.writeSync;let calls=0;fs.writeSync=function(fd,b,o,l,p){if(fd===target){if(calls++)throw Object.assign(Error(),{code:'EIO'});return write(fd,b,o,Math.min(l,3),p)}return write(fd,b,o,l,p)};` : ''}
      ${hooks.fault === 'sync' ? `const sync=fs.fsyncSync;fs.fsyncSync=function(fd){if(fs.fstatSync(fd).isDirectory())throw Object.assign(Error(),{code:'EIO'});return sync(fd)};` : ''}
      process.parentPort={on:(n,f)=>process.on(n,data=>f({data})),postMessage:m=>{${hooks.omitMetadataProof ? 'delete m.result.fileMetadataSha256;' : ''}${hooks.fault === 'missing' ? 'process.exit(0)' : hooks.fault === 'hang' ? 'void m' : 'process.send(m)'}}};
      require(${JSON.stringify(entry)});
    `], { ...options, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.postMessage = data => {
      if (data.ack && hooks.beforeAck) hooks.beforeAck();
      if (!data.ack && hooks.beforeTask) hooks.beforeTask();
      if (data.ack && hooks.fault === 'nonzero') { child.kill('SIGTERM'); return; }
      child.send(data);
    };
    return child;
  };
}
function fixture(writer, attachments = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-safe-create-'))); fs.chmodSync(root, 0o700);
  process.chdir(root); // Dedicated Node test process only.
  const seed = path.join(root, 'seed.md'); fs.writeFileSync(seed, '', { flag: 'wx', mode: 0o600 });
  const service = createDocumentService({ isolatedCreateRoot: root, persistentWriter: writer, attachmentsFor: () => attachments });
  const document = service.open(seed, { syntheticTemporary: true }).document;
  assert.equal(document.edit({ from: 0, to: 0, insert: text, expectedRevision: 0 }).ok, true);
  const request = filePath => ({ filePath, expectedRevision: document.revision, expectedSha256: hash(document.bytesForSave()), isAuthorized: () => true });
  return { root, seed, service, document, request };
}
for (const source of [text, '\ufeff---\r\na: synthetic\r\n---\r\n\r\n第一段😀\r\n\r\nsecond']) {
  test('actual child creation, exit and fresh reader preserve exact source ' + (source.startsWith('\ufeff') ? 'BOM/CRLF' : 'LF'), async () => {
    const dest = destination({ cleanup: true }), processCopy = createCopyProcess({ fork: nodeFork() });
    const f = fixture(processCopy.create); f.document.edit({ from: 0, to: f.document.text.length, insert: source });
    const before = { source: f.document.text, revision: f.document.revision, dirty: f.document.dirty, original: f.document.originalBytes };
    const r = await f.service.createPersistentCopy(f.document, f.request(dest.filePath));
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.state, 'created-confirmed');
    dest.owned.recordFile('copy.md', f.document.bytesForSave());
    assert.deepEqual(fs.readFileSync(dest.filePath), f.document.bytesForSave());
    assert.deepEqual({ source: f.document.text, revision: f.document.revision, dirty: f.document.dirty, original: f.document.originalBytes }, before);
    assert.equal(f.service.save(f.document, { expectedRevision: f.document.revision }).code, 'coordination-required');
    const read = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(require.resolve('../lib/document-file-store'))}).createDocumentFileStore().read(${JSON.stringify(dest.filePath)});console.log(s.sha256);`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(read.status, 0, read.stderr); assert.equal(read.signal, null); assert.equal(read.stdout.trim(), r.sha256);
    f.document.edit({ from: f.document.text.length, to: f.document.text.length, insert: '\n\nTHIRD' });
    assert.equal(hash(fs.readFileSync(dest.filePath)), r.sha256);
    assert.match(r.copyId, /^[a-f0-9-]{36}$/);
    const reopened = f.service.openConfirmedCopy(f.document, r.copyId);
    assert.equal(reopened.ok, true); assert.deepEqual(reopened.document.bytesForSave(), fs.readFileSync(dest.filePath));
    assert.equal(f.service.locateConfirmedCopy(f.document, r.copyId).filePath, dest.filePath);
    assert.equal(f.document.dirty, before.dirty); f.service.close(reopened.document);
    reclaim(dest.owned);
  });
}
for (const kind of ['existing','symlink','writable-by-others','tmp','wrong-name']) test('destination rejects '+kind, () => {
  const d = destination(); let file = d.filePath;
  if (kind === 'existing') fs.writeFileSync(file, 'SENTINEL', { flag: 'wx' });
  if (kind === 'symlink') fs.symlinkSync('missing.md', file);
  if (kind === 'writable-by-others') fs.chmodSync(d.dir,0o777);
  if (kind === 'tmp') file = path.join(os.tmpdir(),'copy.md');
  if (kind === 'wrong-name') file = path.join(d.dir,'../escape.md');
  assert.throws(()=>captureCopyDestination(file));
  if (kind === 'existing') assert.equal(fs.readFileSync(file,'utf8'),'SENTINEL');
  if (kind === 'symlink') assert.equal(fs.readlinkSync(file),'missing.md');
});
for (const phase of ['beforeTask','beforeAck']) test('directory replacement '+phase+' never writes replacement or confirms stale path', async () => {
  const d = destination(); const moved=d.dir+'-moved';
  const processCopy=createCopyProcess({fork:nodeFork({[phase]:()=>{fs.renameSync(d.dir,moved);fs.mkdirSync(d.dir,{mode:0o700});}})});
  const r=await processCopy.create({filePath:d.filePath,bytes:Buffer.from(text),revision:1,isAuthorized:()=>true});
  assert.equal(r.ok,false); assert.deepEqual(fs.readdirSync(d.dir),[]);
  if(phase==='beforeTask') assert.deepEqual(fs.readdirSync(moved),[]);
  else {assert.equal(r.state,'created-unverified');assert.equal(fs.readFileSync(path.join(moved,'copy.md'),'utf8'),text);}
});
for (const [fault,state] of [['partial','created-partial'],['sync','durability-uncertain'],['missing','create-outcome-unknown'],['nonzero','create-outcome-unknown']]) {
  test('writer '+fault+' retains state, residual and memory; repeat refused',async()=>{
    const d=destination(),f=fixture(createCopyProcess({fork:nodeFork({fault})}).create),before=f.document.text;
    const r=await f.service.createPersistentCopy(f.document,f.request(d.filePath));
    assert.equal(r.ok,false);assert.equal(r.state,state);assert.equal(f.document.text,before);assert.equal(fs.existsSync(d.filePath),true);
    const again=await f.service.createPersistentCopy(f.document,f.request(path.join(d.dir,'again.md')));
    assert.equal(again.code,'unresolved-copy-state');assert.equal(fs.existsSync(path.join(d.dir,'again.md')),false);
  });
}
test('invalid revision, hash, ordinary document and single-flight are rejected',async()=>{
  let release,calls=0;const f=fixture(()=>{calls++;return new Promise(r=>release=r)}),d=destination();
  assert.equal((await f.service.createPersistentCopy(f.document,{...f.request(d.filePath),expectedRevision:0})).code,'stale-revision');
  assert.equal((await f.service.createPersistentCopy(f.document,{...f.request(d.filePath),expectedSha256:'0'.repeat(64)})).code,'source-hash-mismatch');
  const ro=f.service.open(f.seed).document;assert.equal((await f.service.createPersistentCopy(ro,f.request(d.filePath))).code,'persistent-copy-unavailable');
  const pending=f.service.createPersistentCopy(f.document,f.request(d.filePath));
  assert.equal((await f.service.createPersistentCopy(f.document,f.request(d.filePath))).code,'save-in-progress');assert.equal(f.service.close(f.document).code,'save-in-progress');
  assert.equal(calls,1);release({ok:false,state:'not-created',created:false,code:'synthetic-refusal'});await pending;
});
test('source revision change during asynchronous writer cannot be confirmed',async()=>{
  let release;const f=fixture(()=>new Promise(r=>release=r)),d=destination(),q=f.request(d.filePath);
  const pending=f.service.createPersistentCopy(f.document,q);f.document.edit({from:0,to:0,insert:'LATER'});
  release({ok:true,state:'created-confirmed',created:true});const r=await pending;
  assert.equal(r.ok,false);assert.equal(r.state,'created-unverified');assert.equal(r.code,'copy-source-changed');assert.match(f.document.text,/^LATER/);
});
async function managerFixture(choose) {
  const {projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs');
  const f=fixture(createCopyProcess({fork:nodeFork()}).create),wc=new EventEmitter(),win=new EventEmitter(),frame={url:'file:///synthetic/document.html'};
  Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send:()=>{}});Object.assign(win,{webContents:wc,isDestroyed:()=>false});
  const manager=createDocumentSessions({service:f.service,projectSource,mapTextEdit,windowFor:()=>win,allowTestCopies:true,chooseCopy:choose,
    createTemporary: bytes => { const file=path.join(f.root,'seed-'+require('node:crypto').randomUUID()+'.md'); fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600}); return f.service.open(file,{syntheticTemporary:true,parse:projectSource}); }});
  manager.grant(win,frame.url);const id=manager.provision(win,f.document,'Temporary',{temporary:true}),event={sender:wc,senderFrame:frame};
  const q={operation:'create-persistent-copy',sessionId:id,expectedRevision:f.document.revision,expectedSha256:hash(f.document.bytesForSave())};
  return {...f,wc,win,frame,manager,event,id,q};
}
test('IPC native cancellation and rejected selection leave memory and history unchanged',async()=>{
  const f=await managerFixture(async()=>({canceled:true}));const before=f.manager.request(f.event,{operation:'snapshot',sessionId:f.id});
  const r=await f.manager.request(f.event,f.q);assert.equal(r.code,'create-cancelled');assert.deepEqual(r.snapshot,before.snapshot);
  assert.equal((await f.manager.request(f.event,{...f.q,filePath:'/forged.md'})).code,'invalid-request');
  assert.equal((await f.manager.request({...f.event,senderFrame:{}},f.q)).code,'unauthorized-sender');
  const ro=f.manager.provision(f.win,f.service.open(f.seed).document,'Real',{readOnly:true});
  assert.equal((await f.manager.request(f.event,{...f.q,sessionId:ro,expectedRevision:0})).code,'read-only-document');
});
test('IPC revoked native dialog cannot launch writer; pending blocks edits and close',async()=>{
  let release;const d=destination(),f=await managerFixture(()=>new Promise(r=>release=r));
  const pending=f.manager.request(f.event,f.q);
  assert.equal(f.manager.request(f.event,{operation:'edit',sessionId:f.id,expectedRevision:f.document.revision,from:0,to:0,insert:'X'}).code,'copy-in-progress');
  assert.equal(f.manager.request(f.event,{operation:'close',sessionId:f.id,expectedRevision:f.document.revision}).code,'copy-in-progress');
  f.manager.revoke(f.win);release({canceled:false,filePath:d.filePath});assert.equal((await pending).code,'copy-session-invalidated');assert.equal(fs.existsSync(d.filePath),false);
});
test.after(()=>process.chdir(baselineCwd));


test('cancellation after a receipt never becomes confirmed success', async () => {
  const d = destination(); let processCopy;
  processCopy = createCopyProcess({ fork: nodeFork({ beforeAck: () => processCopy.cancelAll() }) });
  const r = await processCopy.create({ filePath: d.filePath, bytes: Buffer.from(text), revision: 1, isAuthorized: () => true });
  assert.equal(r.ok, false); assert.equal(r.state, 'create-outcome-unknown');
  assert.equal(fs.readFileSync(d.filePath, 'utf8'), text);
});
test('unresponsive writer is bounded and remains unknown, with no dangerous retry', async () => {
  const d = destination(); const processCopy = createCopyProcess({ fork: nodeFork({ fault: 'hang' }), timeoutMs: 600 });
  const r = await processCopy.create({ filePath: d.filePath, bytes: Buffer.from(text), revision: 1, isAuthorized: () => true });
  assert.equal(r.ok, false); assert.equal(r.state, 'create-outcome-unknown'); assert.equal(r.created, null);
});


for (const raw of ['\ufeff---\r\nkind: test\r\n---\r\n\r\nFirst 中文😀\r\n\r\nSecond.', 'First 中文😀\n\nSecond.\n']) {
  test('editable original creates exact persistent bytes without accepting its baseline: ' + (raw.startsWith('\ufeff') ? 'BOM/CRLF' : 'LF/end newline'), async () => {
    let selected = { canceled: true };
    const f = await managerFixture(async () => selected), originalPath = path.join(f.root, 'original.md');
    const bytes = Buffer.from(raw); fs.writeFileSync(originalPath, bytes, { flag: 'wx' });
    const source = f.service.open(originalPath).document;
    const id = f.manager.provision(f.win, source, 'original.md', { readOnly: true });
    const call = q => f.manager.request(f.event, q);
    const original = call({ operation: 'snapshot', sessionId: id }).snapshot;
    const created = call({ operation: 'edit-copy', sessionId: id, expectedRevision: 0, expectedSha256: original.editCopySha256 });
    assert.equal(created.ok, true); let copy = created.snapshot;
    const { projectSource } = await import('../lib/document-source-map.mjs');
    const span = projectSource(copy.source).spans.find(s => s.text === 'First 中文😀');
    const edited = call({ operation: 'edit', sessionId: copy.sessionId, expectedRevision: 0, from: span.to, to: span.to, insert: ' EDITED' });
    assert.equal(edited.ok, true); copy = edited.snapshot;
    const q = { operation: 'create-persistent-copy', sessionId: copy.sessionId, expectedRevision: copy.revision, expectedSha256: copy.copySha256 };
    const cancelled = await call(q); assert.equal(cancelled.code, 'create-cancelled'); assert.deepEqual(cancelled.snapshot, copy);
    const d = destination({ cleanup: true }); selected = { canceled: false, filePath: d.filePath };
    const result = await call(q); assert.equal(result.ok, true, JSON.stringify(result));
    const expected = Buffer.from(raw.replace('First 中文😀', 'First 中文😀 EDITED'));
    d.owned.recordFile('copy.md', expected);
    assert.deepEqual(fs.readFileSync(d.filePath), expected); assert.equal(result.copy.sha256, hash(expected));
    for (const field of ['source','revision','dirty','canUndo','canRedo']) assert.equal(result.snapshot[field], copy[field]);
    assert.deepEqual(call({ operation: 'snapshot', sessionId: id }).snapshot, original);
    assert.deepEqual(fs.readFileSync(originalPath), bytes);
    assert.equal((await call(q)).code, 'target-exists');
    const undo = call({ operation: 'undo', sessionId: copy.sessionId, expectedRevision: copy.revision });
    assert.equal(undo.ok, true); assert.equal(undo.snapshot.source, original.source);
    assert.equal(call({ operation: 'redo', sessionId: copy.sessionId, expectedRevision: undo.snapshot.revision }).snapshot.source, copy.source);
    assert.deepEqual(fs.readFileSync(d.filePath), expected);
    const reader = spawnSync(process.execPath, ['-e', `const r=require(${JSON.stringify(require.resolve('../lib/document-service'))}).createDocumentService().open(${JSON.stringify(d.filePath)});if(!r.ok)process.exit(1);console.log(r.document.bytesForSave().toString('base64'));`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(reader.status, 0); assert.deepEqual(Buffer.from(reader.stdout.trim(), 'base64'), expected);
    assert.equal(call({ operation: 'save', sessionId: id, expectedRevision: 0 }).code, 'read-only-document');
    assert.equal(call({ operation: 'save', sessionId: copy.sessionId, expectedRevision: 3 }).code, 'temporary-not-persistable');
    reclaim(d.owned);
  });
}

// Save As New File V1: only synthetic folders/files are created by these tests.
function ordinaryDestination(name = '新文档 😀.md', { cleanup = false } = {}) {
  const owned = createHomeFixture('Writing-synthetic-'), dir = owned.dir;
  const sentinel = path.join(dir, 'untouched.md');
  fs.writeFileSync(sentinel, 'UNTOUCHED', { flag: 'wx', mode: 0o600 });
  if (cleanup) owned.recordFile('untouched.md', Buffer.from('UNTOUCHED'));
  else owned.keep('negative-or-race-test-evidence');
  return { dir, sentinel, filePath: path.join(dir, name), owned };
}
test('save as new: nonempty ordinary owned folder and Unicode filename, exact bytes and fresh reopen', async () => {
  const d = ordinaryDestination(undefined, { cleanup: true }), f = fixture(createCopyProcess({ fork: nodeFork() }).create);
  const bytes = Buffer.from('\ufeffFirst 中文😀\r\n\r\nSecond with no final newline');
  f.document.edit({ from: 0, to: f.document.text.length, insert: bytes.toString() });
  const before = { revision: f.document.revision, dirty: f.document.dirty, source: f.document.text };
  const r = await f.service.createPersistentCopy(f.document, f.request(d.filePath));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.state, 'created-confirmed');
  assert.deepEqual(fs.readFileSync(d.filePath), bytes); assert.equal(r.sha256, hash(bytes));
  d.owned.recordFile(path.basename(d.filePath), bytes);
  assert.equal(fs.readFileSync(d.sentinel, 'utf8'), 'UNTOUCHED');
  assert.deepEqual({ revision: f.document.revision, dirty: f.document.dirty, source: f.document.text }, before);
  const read = spawnSync(process.execPath, ['-e', `const r=require(${JSON.stringify(require.resolve('../lib/document-service'))}).createDocumentService().open(process.argv[1]);if(!r.ok)process.exit(1);console.log(r.document.bytesForSave().toString('base64'));`, d.filePath], { encoding: 'utf8', timeout: 5000 });
  assert.equal(read.status, 0, read.stderr); assert.deepEqual(Buffer.from(read.stdout.trim(), 'base64'), bytes);
  assert.equal((await f.service.createPersistentCopy(f.document, f.request(d.filePath))).code, 'target-exists');
  assert.deepEqual(fs.readFileSync(d.filePath), bytes);
  const again = await f.service.createPersistentCopy(f.document, f.request(path.join(d.dir, 'Another copy.md')));
  assert.equal(again.ok, true, JSON.stringify(again));
  d.owned.recordFile('Another copy.md', bytes);
  reclaim(d.owned);
});
test('save as new: raced-in target survives exclusive creation, even in a nonempty folder', async () => {
  const d = ordinaryDestination();
  const writer = createCopyProcess({ fork: nodeFork({ beforeTask: () => fs.writeFileSync(d.filePath, 'RACED-IN', { flag: 'wx', mode: 0o600 }) }) });
  const r = await writer.create({ filePath: d.filePath, bytes: Buffer.from(text), revision: 1, isAuthorized: () => true });
  assert.equal(r.ok, false); assert.equal(r.state, 'target-exists'); assert.equal(r.created, false);
  assert.equal(fs.readFileSync(d.filePath, 'utf8'), 'RACED-IN');
  assert.equal(fs.readFileSync(d.sentinel, 'utf8'), 'UNTOUCHED');
});
test('save as new: ordinary folder identity change cannot redirect writer', async () => {
  const d = ordinaryDestination('plain.md'), moved = d.dir + '-moved';
  const writer = createCopyProcess({ fork: nodeFork({ beforeTask: () => { fs.renameSync(d.dir, moved); fs.mkdirSync(d.dir, { mode: 0o700 }); } }) });
  const r = await writer.create({ filePath: d.filePath, bytes: Buffer.from(text), revision: 1, isAuthorized: () => true });
  assert.equal(r.ok, false); assert.equal(fs.existsSync(d.filePath), false);
  assert.equal(fs.readFileSync(path.join(moved, 'untouched.md'), 'utf8'), 'UNTOUCHED');
});
test('save as new: unsupported locations and unsafe names fail before creation', () => {
  const { copyName } = require('../lib/document-save-policy');
  for (const name of ['新文档 😀.md', 'Another copy.md', 'UPPER.MD']) assert.equal(copyName(name), true, name);
  for (const name of ['../escape.md', 'a/b.md', 'a\\b.md', '.hidden.md', 'trailing.md ', 'a:b.md', 'line\nname.md', 'a\u202ename.md', 'a\ud800.md', '中'.repeat(85) + '.md']) assert.equal(copyName(name), false, JSON.stringify(name));
  // Reserved locations are refused before metadata/content reads; no real files accessed.
  for (const name of ['Desktop','Documents','Library','Dropbox','OneDrive - Work','Google Drive','iCloud Drive','.hidden']) {
    assert.throws(() => captureCopyDestination(path.join(os.homedir(), name, 'new.md')), { code: 'unsupported-copy-directory' });
  }
  const d = ordinaryDestination('plain.md');
  const linked = d.dir + '-link'; fs.symlinkSync(d.dir, linked);
  assert.throws(() => captureCopyDestination(path.join(linked, 'new.md')), { code: 'unsupported-copy-directory' });
  fs.chmodSync(d.dir, 0o500);
  assert.throws(() => captureCopyDestination(d.filePath), { code: 'unsupported-copy-directory' });
  assert.equal(fs.readFileSync(d.sentinel, 'utf8'), 'UNTOUCHED');
});


test('Downloads-style directory ACL supports exclusive child creation and fresh-process read without changing permissions', async () => {
  const d = destination({ cleanup: true });
  const acl = 'group:everyone deny delete';
  const set = spawnSync('/bin/chmod', ['+a', acl, d.dir], { encoding: 'utf8' });
  assert.equal(set.status, 0, 'synthetic directory ACL setup');
  assert.equal(spawnSync('/usr/bin/xattr', ['-wx', 'com.apple.macl', '01020304', d.dir]).status, 0);
  const before = inspectMacMetadata(d.dir, { newFileDirectory: true });
  assert.notEqual(before.acl, false);
  assert.equal(before.xattrs['com.apple.macl'], hash(Buffer.from('01020304', 'hex')));
  assert.equal(suggestCopyPath(d.dir), path.join(d.dir, 'Untitled.md'));
  const processCopy = createCopyProcess({ fork: nodeFork() });
  const f = fixture(processCopy.create), original = f.document.bytesForSave();
  const revision = f.document.revision, dirty = f.document.dirty;
  const r = await f.service.createPersistentCopy(f.document, f.request(d.filePath));
  assert.equal(r.state, 'created-confirmed', JSON.stringify(r));
  d.owned.recordFile('copy.md', original);
  assert.deepEqual(inspectMacMetadata(d.dir, { newFileDirectory: true }), before);
  assert.equal(inspectMacMetadata(d.filePath).acl, false); // Directory ACE must not inherit.
  assert.equal(f.document.revision, revision); assert.equal(f.document.dirty, dirty);
  assert.deepEqual(f.document.bytesForSave(), original);
  assert.equal(f.service.save(f.document).code, 'coordination-required');
  const read = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(require.resolve('../lib/document-file-store'))}).createDocumentFileStore().read(${JSON.stringify(d.filePath)});console.log(s.sha256)`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(read.status, 0); assert.equal(read.stdout.trim(), r.sha256); assert.equal(r.sha256, hash(original));
  const again = await f.service.createPersistentCopy(f.document, f.request(d.filePath));
  assert.equal(again.code, 'target-exists'); assert.deepEqual(fs.readFileSync(d.filePath), original);
  // Revert only the exact synthetic ACE installed above, after all test writers exit.
  assert.equal(spawnSync('/bin/chmod', ['-a', acl, d.dir]).status, 0);
  reclaim(d.owned);
});

test('directory ACL change invalidates captured authorization before creation', () => {
  const d = destination(); // Retained race evidence, never successful-fixture cleanup.
  const acl = 'group:everyone deny delete';
  assert.equal(spawnSync('/bin/chmod', ['+a', acl, d.dir]).status, 0);
  const target = captureCopyDestination(d.filePath);
  try {
    assert.equal(spawnSync('/bin/chmod', ['-a', acl, d.dir]).status, 0);
    assert.throws(() => target.verify(), { code: 'copy-directory-changed' });
    assert.deepEqual(fs.readdirSync(d.dir), []);
  } finally { target.close(); }
  // Move verified empty, inactive race evidence out of Home; preserve directory,
  // never delete it. The private evidence parent is unique and on the same device.
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'document-acl-evidence-'));
  assert.equal(fs.statSync(evidence).dev, fs.statSync(d.dir).dev);
  const to = path.join(evidence, path.basename(d.dir)); fs.renameSync(d.dir, to);
  fs.writeFileSync(path.join(evidence, 'mapping.json'), JSON.stringify({ from: d.dir, to, reason: 'expected ACL mutation refusal; empty target; retained evidence' }), { flag: 'wx', mode: 0o600 });
  console.log('directory-metadata-evidence:' + evidence);
});


for (const phase of ['beforeTask', 'beforeAck']) test('native directory MACL change ' + phase + ' never produces confirmed success', async () => {
  const d = destination(), original = fs.lstatSync(d.dir);
  const macl = hex => assert.equal(spawnSync('/usr/bin/xattr', ['-wx', 'com.apple.macl', hex, d.dir]).status, 0);
  macl('01020304');
  const processCopy = createCopyProcess({ fork: nodeFork({ [phase]: () => macl('01020305') }) });
  const r = await processCopy.create({ filePath: d.filePath, bytes: Buffer.from(text), revision: 1, isAuthorized: () => true });
  assert.equal(r.ok, false);
  assert.equal(r.state, phase === 'beforeTask' ? 'not-created' : 'created-unverified');
  if (phase === 'beforeTask') assert.deepEqual(fs.readdirSync(d.dir), []);
  else assert.equal(fs.readFileSync(d.filePath, 'utf8'), text);
  // Preserve changed metadata and any unverified file, after the child exited.
  const now = fs.lstatSync(d.dir); assert.equal(now.ino, original.ino); assert.equal(now.dev, original.dev);
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'document-macl-evidence-'));
  assert.equal(fs.statSync(evidence).dev, original.dev);
  const to = path.join(evidence, path.basename(d.dir)); fs.renameSync(d.dir, to);
  assert.equal(fs.lstatSync(to).ino, original.ino);
  fs.writeFileSync(path.join(evidence, 'mapping.json'), JSON.stringify({ from: d.dir, to, result: r, phase, reason: 'native MACL mutation; retain all evidence without cleanup or retry' }), { flag: 'wx', mode: 0o600 });
  console.log('directory-metadata-evidence:' + evidence);
});


test('persistent new file with native Save Dialog metadata is confirmed without altering memory or original', async () => {
  const d = destination({ cleanup: true }), f = fixture(createCopyProcess({ fork: nodeFork({ nativeFileMetadata: true }) }).create);
  const before = { text: f.document.text, revision: f.document.revision, dirty: f.document.dirty };
  const r = await f.service.createPersistentCopy(f.document, f.request(d.filePath));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.state, 'created-confirmed');
  assert.equal(r.fileMetadataSha256, undefined); // Internal proof never becomes renderer authority.
  assert.deepEqual({ text: f.document.text, revision: f.document.revision, dirty: f.document.dirty }, before);
  assert.equal(fs.readFileSync(f.seed).length, 0);
  assert.equal(f.service.save(f.document).code, 'coordination-required');
  const metadata = inspectMacMetadata(d.filePath, { newlyCreatedFile: true });
  assert.ok(metadata.xattrs['com.apple.macl']); assert.ok(metadata.xattrs['com.apple.lastuseddate#PS']);
  assert.throws(() => inspectMacMetadata(d.filePath), { code: 'unsupported-xattrs' });
  d.owned.recordFile('copy.md', f.document.bytesForSave());
  const read = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(require.resolve('../lib/document-file-store'))}).createDocumentFileStore().read(${JSON.stringify(d.filePath)});console.log(s.sha256)`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(read.status, 0); assert.equal(read.stdout.trim(), r.sha256);
  assert.equal((await f.service.createPersistentCopy(f.document, f.request(d.filePath))).code, 'target-exists');
  reclaim(d.owned);
});

for (const kind of ['macl-change', 'lastused-change', 'remove', 'unknown', 'missing-proof']) test('native created-file metadata ' + kind + ' is not falsely confirmed', async () => {
  const d = destination(), original = fs.lstatSync(d.dir);
  const hooks = { nativeFileMetadata: true, omitMetadataProof: kind === 'missing-proof', beforeAck() {
    if (kind === 'missing-proof') return;
    const args = kind === 'remove' ? ['-d', 'com.apple.macl', d.filePath]
      : ['-wx', kind === 'macl-change' ? 'com.apple.macl' : kind === 'lastused-change' ? 'com.apple.lastuseddate#PS' : 'com.example.unknown', '01020305', d.filePath];
    assert.equal(spawnSync('/usr/bin/xattr', args).status, 0);
  } };
  const f = fixture(createCopyProcess({ fork: nodeFork(hooks) }).create), before = f.document.text;
  const r = await f.service.createPersistentCopy(f.document, f.request(d.filePath));
  assert.equal(r.ok, false); assert.equal(r.state, 'created-unverified'); assert.equal(r.code, 'copy-post-verification-failed');
  assert.equal(f.document.text, before); assert.equal(fs.readFileSync(d.filePath, 'utf8'), text);
  assert.equal((await f.service.createPersistentCopy(f.document, f.request(path.join(d.dir, 'retry.md')))).code, 'unresolved-copy-state');
  assert.deepEqual(fs.readdirSync(d.dir), ['copy.md']);
  // Child exited; retain the complete unverified file, metadata and old/new path mapping.
  assert.equal(fs.lstatSync(d.dir).ino, original.ino);
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'document-file-metadata-evidence-'));
  assert.equal(fs.statSync(evidence).dev, original.dev);
  const to = path.join(evidence, path.basename(d.dir)); fs.renameSync(d.dir, to);
  assert.equal(fs.lstatSync(to).ino, original.ino);
  fs.writeFileSync(path.join(evidence, 'mapping.json'), JSON.stringify({ from: d.dir, to, result: r, kind }), { flag: 'wx', mode: 0o600 });
  console.log('created-metadata-evidence:' + evidence);
});


for (const mutation of [null, 'attribute', 'content', 'ctime', 'mode']) test('first native metadata inspection: ' + (mutation || 'initial MACL') + ' retains strict confirmation', async () => {
  const d = destination({ cleanup: true }), original = fs.lstatSync(d.dir);
  const f = fixture(createCopyProcess({ fork: nodeFork({ firstMetadata: true, afterBaseline: mutation }) }).create);
  const before = { text: f.document.text, revision: f.document.revision, dirty: f.document.dirty };
  const r = await f.service.createPersistentCopy(f.document, f.request(d.filePath));
  try {
    assert.deepEqual({ text: f.document.text, revision: f.document.revision, dirty: f.document.dirty }, before);
    if (!mutation) {
      assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.state, 'created-confirmed');
      assert.equal(hash(fs.readFileSync(d.filePath)), r.sha256);
      const fresh = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(require.resolve('../lib/document-file-store'))}).createDocumentFileStore().read(${JSON.stringify(d.filePath)});console.log(s.sha256)`], { encoding: 'utf8', timeout: 5000 });
      assert.equal(fresh.status, 0); assert.equal(fresh.stdout.trim(), r.sha256);
      d.owned.recordFile('copy.md', f.document.bytesForSave()); reclaim(d.owned);
    } else {
      assert.equal(r.ok, false); assert.equal(r.state, 'created-unverified');
      assert.equal((await f.service.createPersistentCopy(f.document, f.request(path.join(d.dir, 'retry.md')))).code, 'unresolved-copy-state');
      assert.deepEqual(fs.readdirSync(d.dir), ['copy.md']);
    }
  } finally {
    // Failed/new mutation evidence remains intact; never leave random Home entries.
    if (fs.existsSync(d.dir)) {
      assert.equal(fs.lstatSync(d.dir).ino, original.ino);
      const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'document-first-metadata-evidence-'));
      assert.equal(fs.statSync(evidence).dev, original.dev);
      const to = path.join(evidence, path.basename(d.dir)); fs.renameSync(d.dir, to);
      assert.equal(fs.lstatSync(to).ino, original.ino);
      fs.writeFileSync(path.join(evidence, 'mapping.json'), JSON.stringify({ from: d.dir, to, mutation, result: r }), { flag: 'wx', mode: 0o600 });
      console.log('first-metadata-evidence:' + evidence);
    }
  }
});

const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
const imageName=require('../lib/document-local-images').imageAsset(imageBytes).name;
const imageAttachments=[{name:imageName,base64:imageBytes.toString('base64')}];
test('image sidecars use exclusive writer, parent verification and identical readonly reuse',async()=>{
 const d=destination({cleanup:true}),f=fixture(createCopyProcess({fork:nodeFork()}).create,imageAttachments);
 const first=await f.service.createPersistentCopy(f.document,f.request(d.filePath));assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.attachments.length,1);
 assert.deepEqual(fs.readFileSync(path.join(d.dir,imageName)),imageBytes);const identity=fs.statSync(path.join(d.dir,imageName)).ino;
 d.owned.recordFile('copy.md',Buffer.from(text));d.owned.recordFile(imageName,imageBytes);
 const second=await f.service.createPersistentCopy(f.document,f.request(path.join(d.dir,'second.md')));assert.equal(second.ok,true,JSON.stringify(second));assert.equal(second.attachments[0].created,false);assert.equal(fs.statSync(path.join(d.dir,imageName)).ino,identity);
 assert.equal(f.document.dirty,true);assert.equal(fs.readFileSync(f.seed,'utf8'),'');d.owned.recordFile('second.md',Buffer.from(text));reclaim(d.owned);
});
test('partial image write retains artifacts and draft, never creates Markdown or retries',async()=>{
 const d=destination(),f=fixture(createCopyProcess({fork:nodeFork({fault:'partial'})}).create,imageAttachments);
 const r=await f.service.createPersistentCopy(f.document,f.request(d.filePath));assert.equal(r.ok,false);assert.equal(r.state,'created-partial');assert.equal(fs.existsSync(d.filePath),false);
 assert.equal(fs.readFileSync(path.join(d.dir,imageName)).length,3);assert.equal(f.document.dirty,true);
 assert.equal((await f.service.createPersistentCopy(f.document,f.request(d.filePath))).code,'unresolved-copy-state');
});
test('existing wrong or linked attachment rejects before writing the Markdown target',async()=>{
 const d=destination(),f=fixture(createCopyProcess({fork:nodeFork()}).create,imageAttachments),imagePath=path.join(d.dir,imageName);fs.writeFileSync(imagePath,'wrong',{mode:0o600});
 const r=await f.service.createPersistentCopy(f.document,f.request(d.filePath));assert.equal(r.ok,false);assert.equal(r.created,false);assert.equal(fs.readFileSync(imagePath,'utf8'),'wrong');assert.equal(fs.existsSync(d.filePath),false);
});
test('parent catches a sidecar replaced after child verification, and keeps the result unresolved',async()=>{
 const d=destination(),f=fixture(createCopyProcess({fork:nodeFork({beforeAck:()=>{const imagePath=path.join(d.dir,imageName);fs.renameSync(imagePath,imagePath+'.evidence');fs.writeFileSync(imagePath,imageBytes,{mode:0o600});}})}).create,imageAttachments);
 const r=await f.service.createPersistentCopy(f.document,f.request(d.filePath));assert.equal(r.ok,false);assert.equal(r.state,'created-unverified');assert.equal(r.code,'copy-post-verification-failed');assert.equal(f.document.dirty,true);
});
