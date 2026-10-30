const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createDocumentService}=require('../lib/document-service');
const {createDocumentSessions}=require('../lib/document-session-ipc');
let projectSource,mapTextEdit;
test.before(async()=>{({projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs'));});
function fixture(temporary = false){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-open-unit-')));
  const a=path.join(root,'ProjectA','x.md'),b=path.join(root,'Notes','Y.md');
  fs.mkdirSync(path.dirname(a));fs.mkdirSync(path.dirname(b));
  fs.writeFileSync(a,'\ufeff# A\r\n\r\nText **粗体** 😀\r\n');fs.writeFileSync(b,'# B\n\nSecond directory.');
  const reads=[],writes=[],denied=new Set(),io=Object.create(fs);
  io.openSync=(file,flags,...args)=>{
    reads.push(file);assert.equal(flags&3,fs.constants.O_RDONLY);
    if(denied.has(file))throw Object.assign(Error('synthetic refusal'),{code:'EACCES'});
    return fs.openSync(file,flags,...args);
  };
  io.readFileSync=()=>{throw Error('Native-dialog opens must use a bounded read');};
  for(const key of ['writeSync','writeFileSync','renameSync','unlinkSync'])io[key]=()=>{writes.push(key);throw Error('Write forbidden');};
  const service=createDocumentService({fs:io}),wc=new EventEmitter(),win=new EventEmitter(),frame={url:'file:///synthetic/document.html'};
  Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send:()=>{}});
  Object.assign(win,{webContents:wc,isDestroyed:()=>false});
  const choices=[],events=[],event={sender:wc,senderFrame:frame};let pickerCalls=0;
  const manager=createDocumentSessions({service,projectSource,mapTextEdit,windowFor:s=>s===wc?win:null,
    createTemporary: temporary ? (bytes = Buffer.alloc(0)) => { const file=path.join(root,'temporary-'+reads.length+'.md'); fs.writeFileSync(file,bytes,{flag:'wx'}); return service.open(file,{maxBytes:524288}); } : null,
    chooseFile:async owner=>{assert.equal(owner,win);pickerCalls++;const item=choices.shift();return typeof item==='function'?item():item;}});
  manager.grant(win,frame.url);
  const call=payload=>manager.request(event,payload),snap=id=>call({operation:'snapshot',sessionId:id});
  const open=async file=>{choices.push({canceled:false,filePaths:[file]});return call({operation:'open-file'});};
  return {root,a,b,io,service,wc,win,frame,manager,event,choices,reads,writes,denied,call,snap,open,pickerCalls:()=>pickerCalls};
}
test('native-approved two-directory opens are separate read-only identities and preserve original bytes',async()=>{
  const f=fixture(),a0=fs.readFileSync(f.a),b0=fs.readFileSync(f.b),a=await f.open(f.a),b=await f.open(f.b);
  assert.equal(a.ok,true);assert.equal(b.ok,true);assert.notEqual(a.snapshot.sessionId,b.snapshot.sessionId);
  assert.equal(a.snapshot.readOnly,true);assert.equal(a.snapshot.label,'x.md');assert.equal(a.snapshot.location,path.dirname(f.a));
  assert.equal(a.snapshot.bom,true);assert.equal(a.snapshot.dirty,false);assert.equal(a.snapshot.revision,0);
  assert.equal(b.snapshot.source,'# B\n\nSecond directory.');assert.equal(f.snap(a.snapshot.sessionId).snapshot.source,a.snapshot.source);
  assert.deepEqual(f.reads,[f.a,f.b]);assert.deepEqual(f.writes,[]);
  assert.equal(f.call({operation:'close',sessionId:a.snapshot.sessionId,expectedRevision:0}).ok,true);
  assert.equal(f.snap(a.snapshot.sessionId).code,'unknown-session');
  f.win.emit('closed');assert.equal(f.snap(b.snapshot.sessionId).code,'unauthorized-sender');
  assert.deepEqual(fs.readFileSync(f.a),a0);assert.deepEqual(fs.readFileSync(f.b),b0);
});
test('read-only policy rejects edit, history, save and recheck at the main capability boundary',async()=>{
  const f=fixture(),s=(await f.open(f.a)).snapshot,span=projectSource(s.source).spans[0];
  for(const operation of ['edit','undo','redo','save','check']){
    const request={operation,sessionId:s.sessionId,...(operation==='check'?{}:{expectedRevision:0}),
      ...(operation==='edit'?{from:span.from,to:span.to,insert:'MUST NOT EDIT'}:{})};
    assert.equal(f.call(request).code,'read-only-document');assert.deepEqual(f.snap(s.sessionId).snapshot,s);
  }
  assert.equal(f.call({operation:'open-file',path:f.b}).code,'invalid-request');
  assert.equal(f.call({operation:'open-file',unsafeExperimentalRoot:f.root}).code,'invalid-request');
  assert.equal(f.pickerCalls(),1);assert.deepEqual(f.writes,[]);
});
test('cancel, missing, unreadable and unsupported files do not replace a live document',async()=>{
  const f=fixture(),s=(await f.open(f.a)).snapshot;
  f.choices.push({canceled:true,filePaths:[]});assert.equal((await f.call({operation:'open-file'})).code,'open-cancelled');
  assert.equal((await f.open(path.join(f.root,'missing.md'))).code,'file-unavailable');
  f.denied.add(f.b);assert.equal((await f.open(f.b)).code,'read-failed');f.denied.delete(f.b);
  const binary=path.join(f.root,'bad.md');fs.writeFileSync(binary,Buffer.from([0xff,0xfe,0x00]));
  assert.equal((await f.open(binary)).code,'unsupported-encoding');
  assert.deepEqual(f.snap(s.sessionId).snapshot,s);assert.equal(f.call({operation:'list'}).sessions.length,1);
});
test('unauthorized sender/frame/URL and renderer paths never reach the native chooser',async()=>{
  const f=fixture();
  for(const event of [{sender:{},senderFrame:f.frame},{sender:f.wc,senderFrame:{url:f.frame.url}}])
    assert.equal((await f.manager.request(event,{operation:'open-file'})).code,'unauthorized-sender');
  f.frame.url='https://invalid.example/';assert.equal((await f.call({operation:'open-file'})).code,'unauthorized-sender');
  assert.equal(f.pickerCalls(),0);assert.deepEqual(f.reads,[]);
});
test('dialog in flight is singular and a revoked/navigated window cannot read its late selection',async()=>{
  for(const revoke of [f=>f.win.emit('closed'),f=>{f.frame.url='https://invalid.example/';}]){
    const f=fixture();let release;f.choices.push(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.call({operation:'open-file'});assert.equal((await f.call({operation:'open-file'})).code,'open-busy');
    revoke(f);release({canceled:false,filePaths:[f.a]});assert.equal((await pending).code,'unauthorized-sender');assert.deepEqual(f.reads,[]);
  }
});
test('protected paths, symlinks and non-md inputs are rejected before file-body access',async()=>{
  const f=fixture(),secret=path.join(f.root,'secrets','private.md'),env=path.join(f.root,'.env.md'),link=path.join(f.root,'link.md');
  fs.symlinkSync(f.a,link);
  for(const file of [secret,env,path.join(f.root,'plain.txt'),link])assert.equal((await f.open(file)).ok,false);
  assert.deepEqual(f.reads,[]);
});
test('bounded open rejects oversize and source-limit input, while hostile markup stays inert text',async()=>{
  const f=fixture(),large=path.join(f.root,'large.md'),long=path.join(f.root,'long.md'),html=path.join(f.root,'html.md');
  fs.writeFileSync(large,'x'.repeat(524289));fs.writeFileSync(long,'x'.repeat(131073));
  assert.equal((await f.open(large)).code,'unsupported-size');assert.equal((await f.open(long)).code,'parse-failed');
  const raw='<script>synthetic()</script>\n\n![x](file:///not-authorized.png)\n\n[bad](javascript:synthetic())';fs.writeFileSync(html,raw);
  const result=await f.open(html);assert.equal(result.ok,true);assert.equal(result.snapshot.source,raw);
  assert.ok(projectSource(raw).doc.content.every(n=>n.type==='codeBlock'));
  assert.deepEqual(f.writes,[]);
});


test('temporary creation is main-owned, bounded and isolated from read-only documents', async()=>{
  const f=fixture(true), before=fs.readFileSync(f.a), real=(await f.open(f.a)).snapshot;
  assert.equal(f.manager.request({sender:{},senderFrame:f.frame},{operation:'new-temporary'}).code,'unauthorized-sender');
  for(const extra of [{path:f.a},{source:'private'},{unsafeExperimentalRoot:f.root},{sessionId:real.sessionId}])
    assert.equal(f.call({operation:'new-temporary',...extra}).code,'invalid-request');
  const created=f.call({operation:'new-temporary'});assert.equal(created.ok,true);
  const s=created.snapshot;assert.equal(s.temporary,true);assert.equal(s.readOnly,false);assert.equal(s.source,'');
  assert.equal(s.location,undefined);assert.equal(s.revision,0);
  assert.equal(f.call({operation:'save',sessionId:s.sessionId,expectedRevision:0}).code,'temporary-not-persistable');
  const edited=f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:0,from:1,to:1,insert:'First 中文😀'});
  assert.equal(edited.ok,true);assert.equal(edited.snapshot.dirty,true);
  assert.deepEqual(f.snap(real.sessionId).snapshot,real);
  const undo=f.call({operation:'undo',sessionId:s.sessionId,expectedRevision:1});assert.equal(undo.snapshot.source,'');
  const redo=f.call({operation:'redo',sessionId:s.sessionId,expectedRevision:2});assert.equal(redo.snapshot.source,'First 中文😀');
  assert.equal(f.call({operation:'save',sessionId:s.sessionId,expectedRevision:3}).code,'temporary-not-persistable');
  assert.equal(f.call({operation:'close',sessionId:s.sessionId,expectedRevision:3}).code,'unresolved-save-state');
  assert.deepEqual(fs.readFileSync(f.a),before);assert.deepEqual(f.writes,[]);
  assert.equal(fs.readFileSync(f.reads.at(-1),'utf8'),''); // seed stays empty, edits only in memory
  for(let i=0;i<6;i++)assert.equal(f.call({operation:'new-temporary'}).ok,true);
  const count=f.reads.length;assert.equal(f.call({operation:'new-temporary'}).code,'session-limit');assert.equal(f.reads.length,count);
  f.win.emit('closed');assert.equal(f.call({operation:'new-temporary'}).code,'unauthorized-sender');
});
test('temporary creation is unavailable unless explicitly enabled by trusted main',()=>{
  assert.equal(fixture().call({operation:'new-temporary'}).code,'temporary-unavailable');
});

const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
const forkRequest = s => ({ operation: 'edit-copy', sessionId: s.sessionId, expectedRevision: s.revision, expectedSha256: s.editCopySha256 });
test('editable copy preserves BOM/CRLF and independently edits, splits and replays history', async () => {
  const f = fixture(true), bytes = Buffer.from('\ufeff---\r\nkind: synthetic\r\n---\r\n\r\nFirst 中文😀\r\n\r\nSecond.');
  fs.writeFileSync(f.a, bytes); const original = (await f.open(f.a)).snapshot;
  assert.equal(original.editCopyEnabled, true); assert.equal(original.editCopySha256, digest(bytes));
  const made = f.call(forkRequest(original)); assert.equal(made.ok, true, JSON.stringify(made));
  let copy = made.snapshot;
  assert.notEqual(copy.sessionId, original.sessionId); assert.equal(copy.temporary, true); assert.equal(copy.readOnly, false);
  assert.equal(copy.source, original.source); assert.equal(copy.bom, true); assert.equal(copy.revision, 0); assert.equal(copy.canUndo, false);
  assert.deepEqual(fs.readFileSync(f.reads.at(-1)), bytes);
  const change = (operation, fields = {}) => {
    const result = f.call({ operation, sessionId: copy.sessionId, expectedRevision: copy.revision, ...fields });
    assert.equal(result.ok, true, JSON.stringify(result)); copy = result.snapshot;
  };
  const span = projectSource(copy.source).spans.find(s => s.text === 'First 中文😀');
  change('edit', { from: span.to, to: span.to, insert: ' added' });
  const beforeSplit = copy.source, at = span.from + 5;
  change('edit', { from: at, to: at, insert: '\n\n' });
  const split = copy.source;
  change('undo'); assert.equal(copy.source, beforeSplit); change('redo'); assert.equal(copy.source, split);
  change('edit', { from: at, to: at + 2, insert: '' }); assert.equal(copy.source, beforeSplit);
  change('undo'); assert.equal(copy.source, split); change('redo');
  change('edit', { from: span.from, to: span.from + 1, insert: '' });
  assert.equal(copy.dirty, true); assert.ok(copy.source.endsWith('Second.')); assert.ok(copy.source.startsWith('---\r\nkind: synthetic\r\n---'));
  assert.equal(f.call({ operation: 'save', sessionId: copy.sessionId, expectedRevision: copy.revision }).code, 'temporary-not-persistable');
  for (const operation of ['edit', 'save', 'undo', 'redo', 'create-persistent-copy'])
    assert.equal(f.call({ operation, sessionId: original.sessionId, expectedRevision: 0 }).code, 'read-only-document');
  assert.deepEqual(f.snap(original.sessionId).snapshot, original);
  assert.deepEqual(fs.readFileSync(f.a), bytes); assert.equal(digest(fs.readFileSync(f.a)), digest(bytes)); assert.deepEqual(f.writes, []);
});
test('copy authority rejects stale/hash/path/body/foreign frame requests before factory use', async () => {
  const f = fixture(true), s = (await f.open(f.a)).snapshot, q = forkRequest(s), count = f.reads.length;
  assert.equal(f.call({ ...q, expectedRevision: 1 }).code, 'stale-revision');
  assert.equal(f.call({ ...q, expectedSha256: '0'.repeat(64) }).code, 'source-hash-mismatch');
  for (const extra of [{ source: 'forged' }, { filePath: f.a }, { readOnly: false }]) assert.equal(f.call({ ...q, ...extra }).code, 'invalid-request');
  assert.equal(f.manager.request({ ...f.event, senderFrame: {} }, q).code, 'unauthorized-sender');
  assert.equal(f.call({ ...q, sessionId: 'other-window' }).code, 'unknown-session'); assert.equal(f.reads.length, count);
  const temporary = f.call({ operation: 'new-temporary' }).snapshot;
  assert.equal(f.call({ ...q, sessionId: temporary.sessionId }).code, 'read-only-source-required');
  assert.equal(f.call({ operation: 'close', sessionId: s.sessionId, expectedRevision: 0 }).ok, true);
  assert.equal(f.call(q).code, 'unknown-session');
});
test('copies use the opened snapshot, retain unsupported syntax and have separate histories', async () => {
  const f = fixture(true), source = 'Plain paragraph.\n\n<table>inert</table>\n\n::: unknown';
  fs.writeFileSync(f.a, source); const s = (await f.open(f.a)).snapshot;
  fs.writeFileSync(f.a, 'EXTERNAL synthetic');
  const a = f.call(forkRequest(s)), b = f.call(forkRequest(s)); assert.equal(a.ok, true); assert.equal(b.ok, true);
  const first = a.snapshot, second = b.snapshot;
  assert.equal(first.source, source); assert.equal(second.source, source);
  const from = source.indexOf('<table>');
  assert.equal(f.call({ operation: 'edit', sessionId: first.sessionId, expectedRevision: 0, from, to: from + 1, insert: 'X' }).code, 'unsafe-source-range');
  const span = projectSource(source).spans[0];
  const result = f.call({ operation: 'edit', sessionId: first.sessionId, expectedRevision: 0, from: span.from, to: span.from + 1, insert: 'p' });
  assert.equal(result.ok, true); assert.equal(result.snapshot.source.slice(from), source.slice(from));
  assert.equal(f.call({ operation: 'undo', sessionId: second.sessionId, expectedRevision: 0 }).code, 'history-empty');
  assert.deepEqual(f.snap(second.sessionId).snapshot, second); assert.equal(fs.readFileSync(f.a, 'utf8'), 'EXTERNAL synthetic');
});
test('copy refuses unavailable factory and capacity without reading a seed', async () => {
  const disabled = fixture(), s = (await disabled.open(disabled.a)).snapshot;
  assert.equal(disabled.call(forkRequest(s)).ok, false);
  const f = fixture(true), original = (await f.open(f.a)).snapshot;
  for (let i = 0; i < 7; ++i) assert.equal(f.call(forkRequest(original)).ok, true);
  const count = f.reads.length; assert.equal(f.call(forkRequest(original)).code, 'session-limit'); assert.equal(f.reads.length, count);
});


test('failed or invalidated trusted copy creation never publishes authority or changes the original', async () => {
  for (const fault of ['throw', 'same-document', 'wrong-bytes', 'revoked']) {
    const f = fixture(), loaded = f.service.open(f.a, { maxBytes: 524288 }), bytes = fs.readFileSync(f.a);
    assert.equal(loaded.ok, true); const original = loaded.document;
    let manager;
    manager = createDocumentSessions({ service: f.service, projectSource, mapTextEdit, windowFor: () => f.win,
      createTemporary: input => {
        if (fault === 'throw') throw Error('synthetic creation failure');
        if (fault === 'same-document') return { ok: true, document: original };
        const seed = path.join(f.root, 'copy-seed.md'); fs.writeFileSync(seed, fault === 'wrong-bytes' ? 'WRONG' : input, { flag: 'wx' });
        const opened = f.service.open(seed, { maxBytes: 524288 }); assert.equal(opened.ok, true);
        if (fault === 'revoked') manager.revoke(f.win);
        return opened;
      } });
    manager.grant(f.win, f.frame.url); const id = manager.provision(f.win, original, 'original', { readOnly: true });
    const before = manager.request(f.event, { operation: 'snapshot', sessionId: id }).snapshot;
    const result = manager.request(f.event, forkRequest(before)); assert.equal(result.ok, false); assert.equal(result.snapshot, undefined);
    if (fault !== 'revoked') {
      assert.deepEqual(manager.request(f.event, { operation: 'snapshot', sessionId: id }).snapshot, before);
      assert.equal(manager.request(f.event, { operation: 'list' }).sessions.length, 1);
    }
    assert.deepEqual(fs.readFileSync(f.a), bytes);
  }
});
