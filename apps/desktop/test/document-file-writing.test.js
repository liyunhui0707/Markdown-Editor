'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{randomUUID,createHash}=require('node:crypto');
const {createDocumentService}=require('../lib/document-service'),{createDocumentFileStore}=require('../lib/document-file-store');
const {createDocumentSessions}=require('../lib/document-session-ipc'),{createDraftStore}=require('../lib/document-draft-store'),{createNativeOpenQueue}=require('../lib/document-native-open');
const hash=b=>createHash('sha256').update(b).digest('hex'),initial=process.cwd();let projectSource,mapTextEdit;
test.before(async()=>({projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs')));test.after(()=>process.chdir(initial));
function fixture({writing=true,writerAvailable=true}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-safe-create-writing-')));process.chdir(root);
 const file=path.join(root,'中文 文件.md'),bytes=Buffer.from('\ufefffirst.\r\n\r\nsecond.\r\n');fs.writeFileSync(file,bytes,{mode:0o600});
 const writer={calls:0,async replace({bytes,revision}){this.calls++;fs.writeFileSync(file,bytes);return {ok:true,state:'saved-confirmed',committed:true,revision,sha256:hash(bytes),identity:createDocumentFileStore().read(file).identity,recordId:randomUUID()};},acknowledge(){},list(){return {ok:true,records:[]};}};
 const service=createDocumentService({isolatedCreateRoot:root,...(writerAvailable?{originalWriter:writer}:{})}),win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/writing.html'},queue=createNativeOpenQueue(),recentFiles=require('../lib/document-recent-files').createRecentFiles(path.join(root,'recents'));let count=0,consent=true,chosen=file,closeRequests=0;
 Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send(){}});Object.assign(win,{webContents:wc,isDestroyed:()=>false});
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,windowFor:s=>s===wc?win:null,openForWriting:writing,draftStore:createDraftStore(path.join(root,'drafts')),nativeOpens:queue,recentFiles,
  confirmClose:async()=>{closeRequests++;return true;},chooseFile:async()=>({canceled:false,filePaths:[chosen]}),confirmOriginalSave:async()=>consent,createTemporary:bytes=>{const p=path.join(root,'temp-'+(++count)+'.md');fs.writeFileSync(p,bytes,{flag:'wx',mode:0o600});return service.open(p,{syntheticTemporary:true});}});
 manager.grant(win,frame.url);const event={sender:wc,senderFrame:frame},call=payload=>manager.request(event,payload);test.after(()=>win.emit('closed'));
 return {root,file,bytes,writer,manager,queue,win,wc,frame,call,consent:v=>consent=v,choose:v=>chosen=v,closeRequests:()=>closeRequests};
}
const snapshot=(f,id)=>f.call({operation:'snapshot',sessionId:id}).snapshot;
const edit=(f,s,text)=>f.call({operation:'edit',sessionId:s.sessionId,expectedRevision:s.revision,from:1,to:1,insert:text}).snapshot;
test('open for writing uses one editable session; exact source, history, consent and save stay coordinated',async()=>{
 const f=fixture(),r=await f.call({operation:'open-file'}),s=r.snapshot;assert.equal(r.openedForWriting,true);assert.equal(s.temporary,true);assert.equal(s.readOnly,false);assert.equal(s.label,path.basename(f.file));assert.equal(s.originalSave.filePath,f.file);assert.equal(f.call({operation:'list'}).sessions.length,1);assert.deepEqual(fs.readFileSync(f.file),f.bytes);
 const changed=edit(f,s,'Local ');assert(changed.canUndo);f.manager.flushDrafts();f.consent(false);assert.equal((await f.call({operation:'save-original',sessionId:s.sessionId,expectedRevision:changed.revision})).code,'save-cancelled');assert.deepEqual(fs.readFileSync(f.file),f.bytes);
 f.consent(true);assert.equal((await f.call({operation:'save-original',sessionId:s.sessionId,expectedRevision:changed.revision})).ok,true);assert.equal(f.writer.calls,1);assert.equal(snapshot(f,s.sessionId).dirty,false);assert.deepEqual(fs.readFileSync(f.file),Buffer.from('\ufeff'+changed.source));
 const recent=f.call({operation:'list-recents'}).entries[0];const reopened=f.call({operation:'open-recent',recentId:recent.id});assert.equal(reopened.ok,true);assert.equal(reopened.snapshot.sessionId,s.sessionId);assert(reopened.snapshot.canUndo);
});
test('reopening and Finder repeated opens reuse current writing/history, including at the session limit',async()=>{
 const f=fixture(),s=(await f.call({operation:'open-file'})).snapshot,changed=edit(f,s,'Keep ');
 const again=await f.call({operation:'open-file'});assert.equal(again.reused,true);assert.equal(again.snapshot.sessionId,s.sessionId);assert.equal(again.snapshot.source,changed.source);assert(again.snapshot.canUndo);
 for(let i=0;i<7;i++)assert(f.call({operation:'new-temporary'}).ok);assert.equal(f.call({operation:'list'}).sessions.length,8);
 f.queue.enqueue(f.file);const entry=f.queue.list().requests[0],native=f.call({operation:'open-native-file',requestId:entry.id});assert.equal(native.ok,true);assert.equal(native.openedForWriting,true);assert.equal(native.snapshot.sessionId,s.sessionId);assert.equal(native.snapshot.source,changed.source);
 const other=path.join(f.root,'other.md');fs.writeFileSync(other,'other');f.choose(other);assert.equal((await f.call({operation:'open-file'})).code,'session-limit');assert.deepEqual(fs.readFileSync(f.file),f.bytes);
});
test('comparison preserves local edits and opens a separately bound editable disk version after confirmation',async()=>{
 const f=fixture(),s=(await f.call({operation:'open-file'})).snapshot,local=edit(f,s,'Local '),disk='# 外部\n\nDisk version.';fs.writeFileSync(f.file,disk);
 const q={sessionId:s.sessionId,expectedRevision:local.revision},compared=f.call({operation:'compare-linked-file',...q});assert.equal(compared.ok,true);assert.equal(compared.comparison.source,disk);assert.equal(compared.snapshot.source,local.source);assert(compared.snapshot.canUndo);assert.equal(compared.snapshot.originalSave.stopped,true);
 const opened=f.call({operation:'edit-compared-file',...q,comparisonToken:compared.comparison.token});assert(opened.ok);assert.equal(opened.openedForWriting,true);assert.notEqual(opened.snapshot.sessionId,s.sessionId);assert.equal(opened.snapshot.source,disk);assert.equal(opened.snapshot.revision,0);assert.equal(opened.snapshot.canUndo,false);assert.equal(opened.snapshot.originalSave.stopped,false);assert.equal(opened.snapshot.originalSave.filePath,f.file);assert.equal(opened.snapshot.linkedFile.baselineSha256,hash(disk));
 assert.equal(snapshot(f,s.sessionId).source,local.source);assert(snapshot(f,s.sessionId).canUndo);assert.equal(fs.readFileSync(f.file,'utf8'),disk);assert.equal(f.call({operation:'edit-compared-file',...q,comparisonToken:compared.comparison.token}).ok,false);
});
test('comparison token is revision-bound and fresh-disk-bound; stale, forged and revoked requests create no sessions',async()=>{
 const f=fixture(),s=(await f.call({operation:'open-file'})).snapshot,q={sessionId:s.sessionId,expectedRevision:0};
 const first=f.call({operation:'compare-linked-file',...q});assert(first.ok);const second=f.call({operation:'compare-linked-file',...q});assert(second.ok);
 assert.equal(f.call({operation:'edit-compared-file',...q,comparisonToken:first.comparison.token}).ok,false);
 fs.writeFileSync(f.file,'changed again');assert.equal(f.call({operation:'edit-compared-file',...q,comparisonToken:second.comparison.token}).code,'comparison-stale');assert.equal(f.call({operation:'list'}).sessions.length,1);
 for(const extra of [{filePath:f.file},{source:'overwrite'},{comparisonToken:'../file'}])assert.equal(f.call({operation:'edit-compared-file',...q,comparisonToken:randomUUID(),...extra}).ok,false);
 const c=f.call({operation:'compare-linked-file',...q}),changed=edit(f,s,'pending ');assert.equal(f.call({operation:'edit-compared-file',sessionId:s.sessionId,expectedRevision:changed.revision,comparisonToken:c.comparison.token}).code,'comparison-stale');
 const latest=f.call({operation:'compare-linked-file',sessionId:s.sessionId,expectedRevision:changed.revision});f.wc.emit('did-start-loading');assert.equal(f.call({operation:'edit-compared-file',sessionId:s.sessionId,expectedRevision:changed.revision,comparisonToken:latest.comparison.token}).code,'unauthorized-sender');assert.equal(fs.readFileSync(f.file,'utf8'),'changed again');
});
test('explicit read-only configuration and unavailable binding retain a readable original without partial sessions',async()=>{
 for(const options of [{writing:false},{writerAvailable:false}]){const f=fixture(options),r=await f.call({operation:'open-file'});assert(r.ok);assert.equal(r.snapshot.readOnly,true);assert.equal(f.call({operation:'list'}).sessions.length,1);assert.deepEqual(fs.readFileSync(f.file),f.bytes);}
});

test('failed comparison retires the previous token and marks a missing file without changing writing',async()=>{
 const f=fixture(),s=(await f.call({operation:'open-file'})).snapshot,q={sessionId:s.sessionId,expectedRevision:0};const first=f.call({operation:'compare-linked-file',...q});
 fs.renameSync(f.file,f.file+'.retained');const failed=f.call({operation:'compare-linked-file',...q});assert.equal(failed.code,'file-unavailable');assert.equal(failed.snapshot.linkedFile.checked.state,'missing');assert.equal(failed.snapshot.originalSave.stopped,true);
 fs.renameSync(f.file+'.retained',f.file);assert.equal(f.call({operation:'edit-compared-file',...q,comparisonToken:first.comparison.token}).code,'comparison-stale');assert.equal(f.call({operation:'list'}).sessions.length,1);assert.equal(snapshot(f,s.sessionId).source,s.source);
});

 test('viewing an unchanged file creates no recovery record and closes without a draft confirmation',async()=>{
  const f=fixture(),s=(await f.call({operation:'open-file'})).snapshot;f.manager.flushDrafts();assert.equal(f.call({operation:'list-drafts'}).drafts.length,0);
  assert.equal(s.draftBackup.state,'file-unmodified');const closed=await f.call({operation:'close-document',sessionId:s.sessionId,expectedRevision:0});assert.equal(closed.ok,true);assert.equal(f.closeRequests(),0);assert.deepEqual(fs.readFileSync(f.file),f.bytes);
  const next=(await f.call({operation:'open-file'})).snapshot,changed=edit(f,next,'Changed ');f.manager.flushDrafts();assert.equal(f.call({operation:'list-drafts'}).drafts.length,1);assert.equal((await f.call({operation:'close-document',sessionId:next.sessionId,expectedRevision:changed.revision})).ok,true);assert.equal(f.closeRequests(),1);
 });

test('Finder reuse checks all live versions before refusing a retained stale document',async()=>{
 const f=fixture(),old=(await f.call({operation:'open-file'})).snapshot;edit(f,old,'Local ');fs.writeFileSync(f.file,'New disk');
 const q={sessionId:old.sessionId,expectedRevision:snapshot(f,old.sessionId).revision},compared=f.call({operation:'compare-linked-file',...q});
 const latest=f.call({operation:'edit-compared-file',...q,comparisonToken:compared.comparison.token}).snapshot;assert(latest);
 f.queue.enqueue(f.file);const request=f.queue.list().requests[0],opened=f.call({operation:'open-native-file',requestId:request.id});
 assert.equal(opened.ok,true);assert.equal(opened.reused,true);assert.equal(opened.snapshot.sessionId,latest.sessionId);assert.equal(f.call({operation:'list'}).sessions.length,2);
 assert(snapshot(f,old.sessionId).source.startsWith('Local '));assert.equal(fs.readFileSync(f.file,'utf8'),'New disk');
});
