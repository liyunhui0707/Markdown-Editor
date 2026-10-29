'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { captureCopyDestination } = require('../lib/document-save-policy');
const { createCopyProcess } = require('../lib/document-copy-process');
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
const hash = b => createHash('sha256').update(b).digest('hex');
const text = 'First 中文 😀\n\nSecond paragraph.';
const baselineCwd = process.cwd();
function destination() {
  // Never reuse an existing directory or inspect real notes. Retain all fixtures.
  const dir = fs.mkdtempSync(path.join(os.homedir(), 'Markdown-Persistent-Test-V1-'));
  fs.chmodSync(dir, 0o700);
  return { dir, filePath: path.join(dir, 'copy.md') };
}
function nodeFork(hooks = {}) {
  return (entry, args, options) => {
    // Test-only Node transport. Production uses Electron utilityProcess exclusively.
    const child = spawn(process.execPath, ['-e', `
      const fs=require('node:fs');let target;
      const open=fs.openSync;fs.openSync=function(p,f,...args){const fd=open.call(fs,p,f,...args);if(f&fs.constants.O_CREAT)target=fd;return fd};
      ${hooks.fault === 'partial' ? `const write=fs.writeSync;let calls=0;fs.writeSync=function(fd,b,o,l,p){if(fd===target){if(calls++)throw Object.assign(Error(),{code:'EIO'});return write(fd,b,o,Math.min(l,3),p)}return write(fd,b,o,l,p)};` : ''}
      ${hooks.fault === 'sync' ? `const sync=fs.fsyncSync;fs.fsyncSync=function(fd){if(fs.fstatSync(fd).isDirectory())throw Object.assign(Error(),{code:'EIO'});return sync(fd)};` : ''}
      process.parentPort={on:(n,f)=>process.on(n,data=>f({data})),postMessage:m=>{${hooks.fault === 'missing' ? 'process.exit(0)' : hooks.fault === 'hang' ? 'void m' : 'process.send(m)'}}};
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
function fixture(writer) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-safe-create-'))); fs.chmodSync(root, 0o700);
  process.chdir(root); // Dedicated Node test process only.
  const seed = path.join(root, 'seed.md'); fs.writeFileSync(seed, '', { flag: 'wx', mode: 0o600 });
  const service = createDocumentService({ isolatedCreateRoot: root, persistentWriter: writer });
  const document = service.open(seed, { syntheticTemporary: true }).document;
  assert.equal(document.edit({ from: 0, to: 0, insert: text, expectedRevision: 0 }).ok, true);
  const request = filePath => ({ filePath, expectedRevision: document.revision, expectedSha256: hash(document.bytesForSave()), isAuthorized: () => true });
  return { root, seed, service, document, request };
}
for (const source of [text, '\ufeff---\r\na: synthetic\r\n---\r\n\r\n第一段😀\r\n\r\nsecond']) {
  test('actual child creation, exit and fresh reader preserve exact source ' + (source.startsWith('\ufeff') ? 'BOM/CRLF' : 'LF'), async () => {
    const dest = destination(), processCopy = createCopyProcess({ fork: nodeFork() });
    const f = fixture(processCopy.create); f.document.edit({ from: 0, to: f.document.text.length, insert: source });
    const before = { source: f.document.text, revision: f.document.revision, dirty: f.document.dirty, original: f.document.originalBytes };
    const r = await f.service.createPersistentCopy(f.document, f.request(dest.filePath));
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.state, 'created-confirmed');
    assert.deepEqual(fs.readFileSync(dest.filePath), f.document.bytesForSave());
    assert.deepEqual({ source: f.document.text, revision: f.document.revision, dirty: f.document.dirty, original: f.document.originalBytes }, before);
    assert.equal(f.service.save(f.document, { expectedRevision: f.document.revision }).code, 'coordination-required');
    const read = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(require.resolve('../lib/document-file-store'))}).createDocumentFileStore().read(${JSON.stringify(dest.filePath)});console.log(s.sha256);`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(read.status, 0, read.stderr); assert.equal(read.signal, null); assert.equal(read.stdout.trim(), r.sha256);
    f.document.edit({ from: f.document.text.length, to: f.document.text.length, insert: '\n\nTHIRD' });
    assert.equal(hash(fs.readFileSync(dest.filePath)), r.sha256);
  });
}
for (const kind of ['existing','symlink','nonempty','writable-by-others','tmp','wrong-name']) test('destination rejects '+kind, () => {
  const d = destination(); let file = d.filePath;
  if (kind === 'existing') fs.writeFileSync(file, 'SENTINEL', { flag: 'wx' });
  if (kind === 'symlink') fs.symlinkSync('missing.md', file);
  if (kind === 'nonempty') fs.writeFileSync(path.join(d.dir,'untouched.md'), 'SENTINEL', { flag: 'wx' });
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
  const manager=createDocumentSessions({service:f.service,projectSource,mapTextEdit,windowFor:()=>win,allowTestCopies:true,chooseCopy:choose});
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
