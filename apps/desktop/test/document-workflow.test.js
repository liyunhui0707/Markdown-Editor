'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {createDocumentService}=require('../lib/document-service');
const {closeDocumentSession}=require('../lib/document-close');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const initialCwd=process.cwd();test.after(()=>process.chdir(initialCwd));
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-safe-create-workflow-')));
 process.chdir(root);const seed=path.join(root,'seed.md');fs.writeFileSync(seed,'Initial',{mode:0o600,flag:'wx'});
 const writer={async replace({expected,bytes,revision}){fs.writeFileSync(expected.filePath,bytes);const fresh=require('../lib/document-file-store').createDocumentFileStore().read(expected.filePath);return {ok:true,state:'saved-confirmed',committed:true,revision,sha256:hash(bytes),identity:fresh.identity,recordId:randomUUID()};},acknowledge(){}};
 const service=createDocumentService({isolatedCreateRoot:root,originalWriter:writer,persistentWriter:async({filePath,bytes,revision})=>{fs.writeFileSync(filePath,bytes,{mode:0o600,flag:'wx'});const s=require('../lib/document-file-store').createDocumentFileStore().read(filePath);return {ok:true,state:'created-confirmed',created:true,filePath,revision,sha256:hash(bytes),byteLength:bytes.length,fileIdentity:`${s.identity.dev}:${s.identity.ino}`};}});
 const document=service.open(seed,{syntheticTemporary:true}).document;
 document.edit({from:0,to:0,insert:'Edited ',expectedRevision:0});
 const copy=(name,mode)=>service.createPersistentCopy(document,{filePath:path.join(root,name),expectedRevision:document.revision,expectedSha256:hash(document.bytesForSave()),isAuthorized:()=>true,mode});
 return {root,service,document,copy};
}
test('Save As binds the verified new file and clears dirty without changing revision',async()=>{
 const f=fixture(),revision=f.document.revision;
 assert.equal((await f.copy('Saved.md','save-as')).ok,true);
 assert.equal(f.service.getOriginalState(f.document).filePath,path.join(f.root,'Saved.md'));
 assert.equal(f.document.dirty,false);assert.equal(f.document.revision,revision);
 f.document.edit({from:0,to:0,insert:'Next ',expectedRevision:revision});
 assert.equal((await f.service.saveOriginal(f.document,{expectedRevision:f.document.revision,isAuthorized:()=>true})).ok,true);
 assert.equal(fs.readFileSync(path.join(f.root,'Saved.md'),'utf8'),f.document.text);
});
test('export preserves binding and unsaved state; subsequent Save updates the original target',async()=>{
 const f=fixture();await f.copy('Current.md','save-as');
 f.document.edit({from:0,to:0,insert:'Later ',expectedRevision:f.document.revision});
 const before=f.service.getOriginalState(f.document),revision=f.document.revision;
 assert.equal((await f.copy('Export.md','export')).ok,true);
 assert.deepEqual(f.service.getOriginalState(f.document),before);assert.equal(f.document.dirty,true);assert.equal(f.document.revision,revision);
 const exported=fs.readFileSync(path.join(f.root,'Export.md'),'utf8');
 f.document.edit({from:0,to:0,insert:'Final ',expectedRevision:revision});
 assert.equal((await f.service.saveOriginal(f.document,{expectedRevision:f.document.revision,isAuthorized:()=>true})).ok,true);
 assert.equal(fs.readFileSync(path.join(f.root,'Current.md'),'utf8'),f.document.text);
 assert.equal(fs.readFileSync(path.join(f.root,'Export.md'),'utf8'),exported);
});
async function closing({bound=false,revision=0,text='',decision=true,saveResult={ok:true}}={}){
 let confirmations=0,saves=0,invalidated=false;
 const doc={revision,dirty:!bound,text};
 const result=await closeDocumentSession({id:'a',session:{document:doc,temporary:true,fileDocument:bound},revision,authorized:()=>true,
 service:{getSaveState:()=>({ok:true}),getCopyState:()=>({ok:true,created:false}),getOriginalState:()=>bound?{available:true,stopped:false}:null,inspectLinkedFile(){},getLinkedFile:()=>bound?{checked:{state:'unchanged'}}:null,close:()=>({ok:true})},
 backups:{status:()=>({state:bound?'backed-up':'not-backed-up'}),verifyForClose:()=>true},confirm:async()=>{confirmations++;return decision;},save:async()=>{saves++;return saveResult;},invalidate:()=>{invalidated=true;},snapshot:()=>({})});
 return {result,confirmations,saves,invalidated};
}
test('already-saved edited file and untouched empty draft close without a dialog',async()=>{
 for(const item of [{bound:true,revision:4,text:'Saved'},{text:''}]){const r=await closing(item);assert.equal(r.result.ok,true);assert.equal(r.confirmations,0);}
});
test('Save and Close never closes after cancelled or failed Save',async()=>{
 for(const saveResult of [{ok:false,code:'create-cancelled'},{ok:false,code:'metadata-copy-failed'}]){
  const r=await closing({revision:1,text:'Unsaved',decision:'save',saveResult});assert.equal(r.saves,1);assert.equal(r.result.ok,false);assert.equal(r.invalidated,false);
 }
 const r=await closing({revision:1,text:'Unsaved',decision:'save'});assert.equal(r.saves,1);assert.equal(r.result.ok,true);
});
