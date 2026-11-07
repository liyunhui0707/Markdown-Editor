const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createDocumentService}=require('../lib/document-service');
const {createDocumentSessions}=require('../lib/document-session-ipc');
const {createDraftStore}=require('../lib/document-draft-store');
const {normalizeDraftName,draftFileName}=require('../lib/document-draft-name');
const {suggestCopyPath}=require('../lib/document-save-policy');
let projectSource,mapTextEdit;
test.before(async()=>({projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs')));
function fixture({store,dir}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-names-')));
 dir ||= path.join(root,'drafts');store ||= createDraftStore(dir);
 const service=createDocumentService(),wc=new EventEmitter(),win=new EventEmitter(),frame={url:'file:///synthetic/document.html'};
 Object.assign(wc,{mainFrame:frame,getURL:()=>frame.url,isDestroyed:()=>false,send:()=>{}});Object.assign(win,{webContents:wc,isDestroyed:()=>false});
 let n=0,selection;
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,draftStore:store,windowFor:s=>s===wc?win:null,allowTestCopies:true,
  chooseCopy:async(_win,options)=>{selection=options;return {canceled:true};},
  createTemporary:bytes=>{const file=path.join(root,`synthetic-${++n}.md`);fs.writeFileSync(file,bytes,{flag:'wx'});return service.open(file);}});
 manager.grant(win,frame.url);const event={sender:wc,senderFrame:frame},call=p=>manager.request(event,p);
 const snapshot=id=>call({operation:'snapshot',sessionId:id}).snapshot;
 return {root,dir,store,service,wc,win,frame,manager,event,call,snapshot,selection:()=>selection};
}
test('draft names normalize optional extension and never become a path',()=>{
 for(const [input,name] of [[' 旅行计划.md ','旅行计划'],['Notes.MD','Notes'],['研究 😀','研究 😀']])assert.equal(normalizeDraftName(input),name);
 for(const input of ['', ' ','.md','../file','/tmp/file','a/b','a\\b','a:b','a\nname','\ud800','a'.repeat(253),'.env','a\u202ename'])assert.equal(normalizeDraftName(input),null,input);
 assert.equal(draftFileName('旅行计划'),'旅行计划.md');assert.equal(draftFileName('Notes.md'),'Notes.md');assert.equal(draftFileName('../bad'),'Untitled.md');
 assert.equal(suggestCopyPath('/not-supported','旅行计划.md'),'旅行计划.md');assert.equal(suggestCopyPath('/not-supported','../bad.md'),'Untitled.md');
});
test('rename persists exact name without changing source, revision, history or original; recovery keeps the name',()=>{
 const f=fixture(),first=f.call({operation:'new-temporary'}).snapshot,id=first.sessionId;
 f.call({operation:'edit',sessionId:id,expectedRevision:0,from:1,to:1,insert:'Synthetic 中文'});f.manager.flushDrafts();const before=f.snapshot(id);
 const r=f.call({operation:'rename-draft',sessionId:id,expectedRevision:1,expectedLabel:before.label,label:'旅行计划.md'});
 assert.equal(r.ok,true);assert.equal(r.snapshot.label,'旅行计划');
 for(const key of ['source','revision','dirty','canUndo','canRedo','confirmedCopy','copyState'])assert.deepEqual(r.snapshot[key],before[key],key);
 const draft=f.store.list().drafts[0];assert.equal(draft.label,'旅行计划');assert.equal(f.store.recover(draft.id).bytes.toString(),'Synthetic 中文');
 assert.equal(fs.readFileSync(path.join(f.root,'synthetic-1.md'),'utf8'),'');
 assert.equal(f.call({operation:'undo',sessionId:id,expectedRevision:1}).snapshot.source,'');
 assert.equal(f.call({operation:'redo',sessionId:id,expectedRevision:2}).snapshot.source,'Synthetic 中文');f.win.emit('closed');
 const g=fixture({dir:f.dir}),restored=g.call({operation:'restore-draft',draftId:draft.id});assert.equal(restored.snapshot.label,'旅行计划');assert.equal(restored.snapshot.canUndo,false);g.win.emit('closed');
});
test('named empty draft is recoverable; stale name/revision and foreign requests cannot rename',()=>{
 const f=fixture(),s=f.call({operation:'new-temporary'}).snapshot,q={operation:'rename-draft',sessionId:s.sessionId,expectedRevision:0,expectedLabel:s.label,label:'Empty'};
 assert.equal(f.call({...q,filePath:'/tmp/forged.md'}).code,'invalid-request');
 assert.equal(f.manager.request({sender:{},senderFrame:f.frame},q).code,'unauthorized-sender');
 assert.equal(f.call({...q,expectedRevision:1}).code,'stale-revision');assert.equal(f.call({...q,label:'../NO'}).code,'invalid-draft-name');
 assert.equal(f.call(q).ok,true);assert.equal(f.call({...q,label:'Stale'}).code,'stale-draft-name');assert.equal(f.store.list().drafts[0].label,'Empty');
 const file=path.join(f.root,'original.md');fs.writeFileSync(file,'Original');const d=f.service.open(file).document,id=f.manager.provision(f.win,d,'original.md',{readOnly:true});
 assert.equal(f.call({...q,sessionId:id,expectedLabel:'original.md'}).code,'read-only-document');assert.equal(fs.readFileSync(file,'utf8'),'Original');f.win.emit('closed');
});
for(const fault of ['backup-failed','draft-unverified'])test('failed name backup retains the live name and body: '+fault,()=>{
 const f=fixture(),s=f.call({operation:'new-temporary'}).snapshot;f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:0,from:1,to:1,insert:'Keep'});f.manager.flushDrafts();
 const before=f.snapshot(s.sessionId),prior=f.store.list().drafts[0],save=f.store.save;let writes=0;
 f.store.save=()=>{writes++;return {ok:false,state:fault,code:'synthetic-failure'};};
 const q={operation:'rename-draft',sessionId:s.sessionId,expectedRevision:1,expectedLabel:before.label,label:'New name'};
 const r=f.call(q);assert.equal(r.ok,false);assert.equal(r.snapshot.label,before.label);assert.equal(r.snapshot.source,'Keep');assert.equal(f.store.recover(prior.id).label,before.label);
 if(fault==='draft-unverified'){assert.equal(f.call(q).ok,false);assert.equal(writes,1);}
 f.store.save=save;f.win.emit('closed');
});
test('save dialog receives only the current main-owned name; cancellation retains draft/history',async()=>{
 const f=fixture(),s=f.call({operation:'new-temporary'}).snapshot;
 const r=f.call({operation:'rename-draft',sessionId:s.sessionId,expectedRevision:0,expectedLabel:s.label,label:'旅行计划'});assert.equal(r.ok,true);
 const before=f.snapshot(s.sessionId),saved=await f.call({operation:'create-persistent-copy',sessionId:s.sessionId,expectedRevision:0,expectedSha256:before.copySha256});
 assert.equal(saved.code,'create-cancelled');assert.deepEqual(f.selection(),{suggestedName:'旅行计划.md'});assert.equal(saved.snapshot.label,'旅行计划');assert.equal(saved.snapshot.source,'');f.win.emit('closed');
});
test('pending body backup failure prevents a second write in the same rename operation',()=>{
 const f=fixture(),s=f.call({operation:'new-temporary'}).snapshot;
 f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:0,from:1,to:1,insert:'Pending body'});
 const save=f.store.save;let writes=0;f.store.save=()=>{writes++;return {ok:false,state:'backup-failed',code:'EACCES'};};
 const r=f.call({operation:'rename-draft',sessionId:s.sessionId,expectedRevision:1,expectedLabel:s.label,label:'New name'});
 assert.equal(r.ok,false);assert.equal(writes,1);assert.equal(r.snapshot.label,s.label);assert.equal(r.snapshot.source,'Pending body');
 f.store.save=save;f.win.emit('closed');
});
