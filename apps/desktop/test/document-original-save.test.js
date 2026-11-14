'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {createDocumentService}=require('../lib/document-service');
const {createDocumentFileStore}=require('../lib/document-file-store');
const {createOriginalSave}=require('../lib/document-original-save');
const initialCwd=process.cwd(),hash=b=>createHash('sha256').update(b).digest('hex');
test.after(()=>process.chdir(initialCwd));
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-safe-create-')));process.chdir(root);
 const file=path.join(root,'original.md'),temp=path.join(root,'draft.md'),bytes=Buffer.from('\ufeff# 原文\r\n\nText\r');
 fs.writeFileSync(file,bytes,{mode:0o640});fs.writeFileSync(temp,bytes,{mode:0o600});
 const writer={calls:0,ack:0,async replace({expected,bytes,revision}){this.calls++;fs.writeFileSync(file,bytes);const snapshot=createDocumentFileStore().read(file);return {ok:true,state:'saved-confirmed',committed:true,revision,sha256:hash(bytes),identity:snapshot.identity,recordId:randomUUID()};},acknowledge(){this.ack++;},list(){return {ok:true,records:[]};}};
 const service=createDocumentService({isolatedCreateRoot:root,originalWriter:writer});
 const original=service.open(file).document,document=service.open(temp,{syntheticTemporary:true}).document;
 assert(service.bindOriginal(document,original));
 const edit=insert=>document.edit({from:0,to:0,insert,expectedRevision:document.revision});
 const save=()=>service.saveOriginal(document,{expectedRevision:document.revision,isAuthorized:()=>true});
 return {root,file,temp,bytes,writer,service,original,document,edit,save};
}
test('bound save updates only original baseline and dirty state; repeated save and undo semantics',async()=>{
 const f=fixture();f.edit('A');assert.equal((await f.save()).ok,true);assert.equal(f.document.dirty,false);assert.equal(f.writer.ack,1);
 assert.deepEqual(fs.readFileSync(f.file),f.document.bytesForSave());assert.deepEqual(fs.readFileSync(f.temp),f.bytes);
 const last=f.service.getOriginalState(f.document).lastConfirmed;assert.equal(last.revision,1);assert.equal(last.sha256,hash(fs.readFileSync(f.file)));
 f.edit('B');assert.equal(f.document.dirty,true);assert.equal((await f.save()).ok,true);
 f.document.edit({from:0,to:1,insert:'',expectedRevision:f.document.revision});assert.equal(f.document.dirty,true);
 assert.deepEqual(f.original.originalBytes,f.bytes);assert.equal(f.writer.calls,2);
});
test('external conflict preserves last confirmed receipt and refuses automatic retry',async()=>{
 const f=fixture();f.edit('A');await f.save();const last=f.service.getOriginalState(f.document).lastConfirmed;
 f.edit('B');fs.writeFileSync(f.file,'External');const r=await f.save();assert.equal(r.code,'external-change');assert.equal(f.writer.calls,1);assert.equal(f.document.dirty,true);
 assert.deepEqual(f.service.getOriginalState(f.document).lastConfirmed,last);assert.equal((await f.save()).code,'unresolved-save-state');assert.equal(fs.readFileSync(f.file,'utf8'),'External');
});
test('no authority for unbound/read-only models, stale revision or the legacy save route',async()=>{
 const f=fixture();assert.equal((await f.service.saveOriginal(f.original,{expectedRevision:0,isAuthorized:()=>true})).code,'original-save-unavailable');
 f.original.edit({from:0,to:0,insert:'X',expectedRevision:0});assert.equal(f.service.save(f.original,{expectedRevision:1}).code,'coordination-required');
 f.edit('A');assert.equal((await f.service.saveOriginal(f.document,{expectedRevision:0,isAuthorized:()=>true})).code,'save-authorization-expired');assert.equal(f.writer.calls,0);
});
test('ack failure, mismatch, timeout and late input never clear dirty or allow retry',async()=>{
 for(const kind of ['ack','mismatch','unknown','late','throw']){
  const f=fixture();f.edit('A');const real=f.writer.replace.bind(f.writer);
  f.writer.replace=async q=>{if(kind==='throw')throw Error();if(kind==='unknown')return {ok:false,state:'save-outcome-unknown',committed:null,code:'timeout'};
   const r=await real(q);if(kind==='mismatch')r.sha256='0'.repeat(64);if(kind==='late')f.edit('B');return r;};
  if(kind==='ack')f.writer.acknowledge=()=>{throw Error();};
  assert.equal((await f.save()).ok,false,kind);assert.equal(f.document.dirty,true,kind);assert.equal(f.service.getOriginalState(f.document).stopped,true,kind);assert.equal(f.service.getOriginalState(f.document).lastConfirmed,null,kind);assert.equal((await f.save()).code,'unresolved-save-state');
 }
});
test('recovery listing survives missing terminal records, does not trust bare native success, and rejects path traversal',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-save-records-'))),broker=createOriginalSave({root,binary:process.execPath});
 const ids=[];for(const outcome of [null,{ok:true,state:'saved-confirmed',sha256:'a',revision:1},{ok:false,state:'save-unverified',committed:true}]){
  const id=randomUUID(),p=path.join(root,id);ids.push(id);fs.mkdirSync(p,{mode:0o700});fs.writeFileSync(path.join(p,'request.json'),JSON.stringify({filePath:'/synthetic/example.md',revision:1,time:ids.length}),{mode:0o600});if(outcome)fs.writeFileSync(path.join(p,'outcome.json'),JSON.stringify(outcome));
 }
 assert.deepEqual(broker.list().records.map(r=>r.state),['save-unverified','save-outcome-unknown','save-outcome-unknown']);
 broker.acknowledge(ids[1],{sha256:'a',revision:1});assert.equal(broker.list().records[1].state,'saved-confirmed');assert.throws(()=>broker.locate('../outside'));
 const p=path.join(root,ids[0],'request.json');fs.renameSync(p,p+'.retained');fs.symlinkSync(p+'.retained',p);assert.equal(broker.list().records.find(r=>r.id===ids[0]).state,'save-outcome-unknown');
});
let projectSource,mapTextEdit;
test.before(async()=>({projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs')));
function sessionFixture(confirm){
 const f=fixture(),{EventEmitter}=require('node:events'),{createDocumentSessions}=require('../lib/document-session-ipc'),{createDraftStore}=require('../lib/document-draft-store');
 const win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/save.html'};Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send(){}});Object.assign(win,{webContents:wc,isDestroyed:()=>false});let count=0;
 const manager=createDocumentSessions({service:f.service,projectSource,mapTextEdit,draftStore:createDraftStore(path.join(f.root,'drafts')),confirmOriginalSave:confirm,windowFor:s=>s===wc?win:null,
  createTemporary:bytes=>{const file=path.join(f.root,`copy-${++count}.md`);fs.writeFileSync(file,bytes,{mode:0o600});return f.service.open(file,{syntheticTemporary:true});}});
 manager.grant(win,frame.url);const event={sender:wc,senderFrame:frame},call=payload=>manager.request(event,payload),id=manager.provision(win,f.original,'Original',{readOnly:true});
 const original=call({operation:'snapshot',sessionId:id}).snapshot,draft=call({operation:'edit-copy',sessionId:id,expectedRevision:0,expectedSha256:original.editCopySha256}).snapshot;manager.flushDrafts();
 return {...f,manager,win,wc,event,call,id,draft};
}
test('original-save IPC has no renderer path override, requires authorized revision and backup',async()=>{
 const f=sessionFixture(async()=>true),request={operation:'save-original',sessionId:f.draft.sessionId,expectedRevision:0};
 assert.equal((await f.call({...request,filePath:f.file})).code,'invalid-request');assert.equal((await f.call({...request,expectedRevision:9})).code,'stale-revision');
 assert.equal((await f.call({...request,sessionId:f.id})).code,'read-only-document');assert.equal(f.manager.request({sender:{},senderFrame:f.event.senderFrame},request).code,'unauthorized-sender');
 const record=fs.readdirSync(path.join(f.root,'drafts')).find(n=>n.endsWith('.json'));assert(record);fs.writeFileSync(path.join(f.root,'drafts',record),'corrupt');
 assert.equal((await f.call(request)).code,'save-backup-unverified');assert.equal(f.writer.calls,0);f.win.emit('closed');
});
test('native save consent freezes mutations; cancellation and revocation grant no write',async()=>{
 for(const revoke of [false,true]){let finish;const f=sessionFixture(()=>new Promise(resolve=>finish=resolve)),request={operation:'save-original',sessionId:f.draft.sessionId,expectedRevision:0};
  const pending=f.call(request);assert.equal(f.call({operation:'undo',sessionId:f.draft.sessionId,expectedRevision:0}).code,'copy-in-progress');
  if(revoke)f.wc.emit('did-start-loading');finish(revoke);const r=await pending;assert.equal(r.ok,false);assert.equal(f.writer.calls,0);assert.deepEqual(fs.readFileSync(f.file),f.bytes);f.win.emit('closed');
 }
});
test('preload original save fences input and rejects a mismatched success without retry',async()=>{
 const {EventEmitter}=require('node:events'),{runInNewContext}=require('node:vm');
 const events=new EventEmitter(),dom=new EventEmitter(),pending=[];let api;
 events.invoke=(_c,payload)=>new Promise((resolve,reject)=>pending.push({payload,resolve,reject}));
 runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/document-demo-preload.js'),'utf8'),{document:{addEventListener:(n,f)=>dom.on(n,f)},require:()=>({ipcRenderer:events,contextBridge:{exposeInMainWorld:(_n,value)=>api=value}})});
 const request={sessionId:'a',expectedRevision:3};dom.emit('compositionstart');assert.equal((await api.saveOriginal(request)).code,'composition-active');dom.emit('compositionend');
 const saving=api.saveOriginal(request);assert.equal((await api.saveOriginal(request)).code,'document-busy');assert.equal((await api.undo(request)).code,'copy-in-progress');
 pending[0].resolve({ok:true,snapshot:{sessionId:'a',revision:4,originalSave:{receipt:{state:'saved-confirmed'}}}});assert.equal((await saving).code,'save-outcome-unknown');assert.equal((await api.saveOriginal(request)).code,'save-outcome-unknown');assert.equal(pending.length,1);
 const reveal=api.revealSaveRecovery('id');assert.equal(pending[1].payload.recordId,'id');pending[1].resolve({ok:true});await reveal;
});
test('production helper rejects test-only protocol controls', {skip:!process.env.DOCUMENT_NATIVE_SAVE_PRODUCTION_BINARY},()=>{
 const r=require('node:child_process').spawnSync(process.env.DOCUMENT_NATIVE_SAVE_PRODUCTION_BINARY,[],{input:'{"testPoint":"before-swap"}\n',encoding:'utf8',timeout:2000});assert.equal(r.status,64);assert.equal(r.stdout,'');
});
test('linked disk check uses bound original rather than temp; keeps dirty/history baseline and stops conflict retry',async()=>{
 const f=fixture();f.edit('Local');assert(f.service.inspectLinkedFile(f.document).ok);assert.equal(f.service.getLinkedFile(f.document).checked.state,'unchanged');
 assert.equal(f.service.getLinkedFile(f.document).filePath,f.file);assert.equal(f.service.getLinkedFile(f.document).baselineSha256,hash(f.bytes));
 await f.save();assert.equal(f.service.getLinkedFile(f.document).checked,null);const saved=fs.readFileSync(f.file);f.edit('Unsaved');
 fs.writeFileSync(f.file,'Outside');assert(f.service.inspectLinkedFile(f.document).ok);assert.equal(f.service.getLinkedFile(f.document).checked.state,'changed');assert(f.service.getOriginalState(f.document).stopped);
 const local=f.document.text,opened=f.service.openLinkedFile(f.document);assert(opened.ok);assert.equal(opened.document.text,'Outside');assert.equal(f.document.text,local);assert(f.document.dirty);
 fs.writeFileSync(f.file,saved);f.service.inspectLinkedFile(f.document);assert(f.service.getOriginalState(f.document).stopped);assert.equal((await f.save()).code,'unresolved-save-state');assert.equal(f.writer.calls,1);
});
test('linked IPC is revision/window scoped, opens a separate read-only disk version and retains draft history',()=>{
 const f=sessionFixture(async()=>true),sid=f.draft.sessionId,request={sessionId:sid,expectedRevision:0};
 assert.equal(f.call({operation:'inspect-linked-file',...request,filePath:f.temp}).code,'invalid-request');
 assert.equal(f.call({operation:'open-linked-file',...request,expectedRevision:2}).code,'stale-revision');
 assert.equal(f.manager.request({sender:{},senderFrame:f.event.senderFrame},{operation:'inspect-linked-file',...request}).code,'unauthorized-sender');
 assert.equal(f.call({operation:'inspect-linked-file',...request}).snapshot.linkedFile.checked.state,'unchanged');
 const edit=f.call({operation:'source-edit',...request,from:0,to:0,insert:'Local'});assert(edit.ok);fs.writeFileSync(f.file,'External');
 const result=f.call({operation:'open-linked-file',sessionId:sid,expectedRevision:1});assert(result.ok);assert.equal(result.sessionId,sid);assert.equal(result.requestRevision,1);assert.equal(result.snapshot.source,'External');assert(result.snapshot.readOnly);assert.notEqual(result.snapshot.sessionId,sid);
 const retained=f.call({operation:'snapshot',sessionId:sid}).snapshot;assert.equal(retained.source,edit.snapshot.source);assert(retained.canUndo);assert(f.call({operation:'undo',sessionId:sid,expectedRevision:1}).ok);assert.deepEqual(fs.readFileSync(f.file),Buffer.from('External'));
 f.win.emit('closed');assert.equal(f.call({operation:'inspect-linked-file',...request}).code,'unauthorized-sender');
});
test('linked preload fences composition, pending edits, unknown outcomes and malformed result identity',async()=>{
 const {EventEmitter}=require('node:events'),{runInNewContext}=require('node:vm');
 for(const method of ['inspectLinkedFile','openLinkedFile','revealLinkedFile']){
  const events=new EventEmitter(),dom=new EventEmitter(),pending=[];let api;events.invoke=(_c,payload)=>new Promise((resolve,reject)=>pending.push({payload,resolve,reject}));
  runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/document-demo-preload.js'),'utf8'),{document:{addEventListener:(n,f)=>dom.on(n,f)},require:()=>({ipcRenderer:events,contextBridge:{exposeInMainWorld:(_n,v)=>api=v}})});
  const request={sessionId:'a',expectedRevision:3};dom.emit('compositionstart');assert.equal((await api[method](request)).code,'composition-active');dom.emit('compositionend');
  const action=api[method](request);assert.equal((await api.sourceEdit(request)).code,'document-busy');assert.equal((await api.undo(request)).code,'copy-in-progress');
  pending[0].resolve({ok:true,sessionId:'other',requestRevision:3,snapshot:{sessionId:'a',revision:4,readOnly:true}});assert.equal((await action).code,'linked-action-unknown');assert.equal((await api[method](request)).code,'linked-action-unknown');assert.equal(pending.length,1);
 }
});
test('unbound temporary documents have no linked path; opening at session capacity preserves all sessions',()=>{
 const f=sessionFixture(async()=>true),unbound=f.call({operation:'new-temporary'}).snapshot;
 assert.equal(unbound.linkedFile,null);assert.equal(f.call({operation:'inspect-linked-file',sessionId:unbound.sessionId,expectedRevision:0}).code,'linked-file-unavailable');
 assert.equal(f.call({operation:'open-linked-file',sessionId:unbound.sessionId,expectedRevision:0}).code,'linked-file-unavailable');
 while(f.call({operation:'list'}).sessions.length<8)f.manager.provision(f.win,f.original,'Extra',{readOnly:true});
 const ids=f.call({operation:'list'}).sessions.map(s=>s.sessionId);
 assert.equal(f.call({operation:'open-linked-file',sessionId:f.draft.sessionId,expectedRevision:0}).code,'session-limit');
 assert.deepEqual(f.call({operation:'list'}).sessions.map(s=>s.sessionId),ids);assert.equal(f.call({operation:'inspect-linked-file',sessionId:f.id,expectedRevision:0}).ok,true);f.win.emit('closed');
});
