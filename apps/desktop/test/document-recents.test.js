const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createDocumentService}=require('../lib/document-service');
const {createDocumentSessions}=require('../lib/document-session-ipc');
const {createRecentFiles}=require('../lib/document-recent-files');
let projectSource,mapTextEdit;
test.before(async()=>{({projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs'));});
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-recents-'))),file=path.join(root,'Article.md'),catalog=path.join(root,'recents');
 fs.writeFileSync(file,'\ufeff# Article\r\n\r\nOriginal synthetic text.\r\n',{flag:'wx',mode:0o600});
 const service=createDocumentService(),recentFiles=createRecentFiles(catalog),wc=new EventEmitter(),win=new EventEmitter(),frame={url:'file:///synthetic/document.html'};
 Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send:()=>{}});Object.assign(win,{webContents:wc,isDestroyed:()=>false});
 let chosen=file,cancel=false;
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,recentFiles,windowFor:s=>s===wc?win:null,chooseFile:async()=>({canceled:cancel,filePaths:[chosen]})});
 manager.grant(win,frame.url);const event={sender:wc,senderFrame:frame},call=p=>manager.request(event,p);
 return {root,file,catalog,service,recentFiles,wc,frame,manager,event,call,choose:p=>chosen=p,cancel:()=>cancel=true};
}
test('recent catalog persists bounded metadata, deduplicates, and clearing does not touch originals',async()=>{
 const f=fixture(),bytes=fs.readFileSync(f.file);assert.deepEqual(f.recentFiles.list().entries,[]);
 const first=await f.call({operation:'open-file'});assert.equal(first.ok,true);
 let entries=createRecentFiles(f.catalog).list().entries;assert.equal(entries.length,1);assert.equal(entries[0].label,'Article.md');
 const id=entries[0].id;assert.equal(entries[0].location,f.root);assert.equal('sha256' in entries[0],false);
 assert.equal(JSON.stringify(fs.readdirSync(f.catalog).map(n=>fs.readFileSync(path.join(f.catalog,n),'utf8'))).includes('Original synthetic text'),false);
 f.recentFiles.remember(f.service.open(f.file).document);assert.equal(f.recentFiles.list().entries.length,1);assert.notEqual(f.recentFiles.list().entries[0].id,id);
 for(let i=0;i<15;i++){const p=path.join(f.root,`file-${i}.md`);fs.writeFileSync(p,'Synthetic.');f.recentFiles.remember(f.service.open(p).document);}
 entries=f.recentFiles.list().entries;assert.equal(entries.length,12);assert.equal(entries[0].label,'file-14.md');assert.equal(fs.readdirSync(f.catalog).length,2);
 assert.equal(f.call({operation:'clear-recents'}).ok,true);assert.deepEqual(createRecentFiles(f.catalog).list().entries,[]);assert.deepEqual(fs.readFileSync(f.file),bytes);
});
test('recent click reopens a fresh readonly session; arbitrary paths and senders cannot grant authority',async()=>{
 const f=fixture(),a=(await f.call({operation:'open-file'})).snapshot,id=f.call({operation:'list-recents'}).entries[0].id;
 const b=await f.call({operation:'open-recent',recentId:id});assert.equal(b.ok,true);assert.equal(b.snapshot.readOnly,true);assert.notEqual(b.snapshot.sessionId,a.sessionId);assert.equal(b.snapshot.source,a.source);
 assert.equal(f.call({operation:'save',sessionId:b.snapshot.sessionId,expectedRevision:0}).code,'read-only-document');
 assert.equal((await f.call({operation:'open-recent',recentId:id,filePath:f.file})).code,'invalid-request');
 assert.equal((await f.call({operation:'open-recent',recentId:f.file})).ok,false);
 assert.equal(f.manager.request({sender:{},senderFrame:f.frame},{operation:'list-recents'}).code,'unauthorized-sender');
 f.frame.url='https://invalid.example/';assert.equal((await f.call({operation:'open-recent',recentId:id})).code,'unauthorized-sender');
});
test('changed, replaced, symlinked and missing recent targets require a fresh native selection; live session retained',async()=>{
 for(const kind of ['changed','replaced','symlink','missing']){
  const f=fixture(),a=(await f.call({operation:'open-file'})).snapshot,id=f.call({operation:'list-recents'}).entries[0].id,old=fs.readFileSync(f.file);
  if(kind==='changed')fs.writeFileSync(f.file,'External synthetic edit.');
  else {fs.renameSync(f.file,f.file+'.retained');if(kind==='replaced')fs.writeFileSync(f.file,old);if(kind==='symlink')fs.symlinkSync(f.file+'.retained',f.file);}
  const r=await f.call({operation:'open-recent',recentId:id});assert.equal(r.ok,false,kind);assert.equal(r.code,'recent-file-unavailable');
  assert.equal(f.call({operation:'list'}).sessions.length,1);assert.deepEqual(f.call({operation:'snapshot',sessionId:a.sessionId}).snapshot,a);
  if(kind==='changed'){assert.equal((await f.call({operation:'open-file'})).ok,true);const updated=f.call({operation:'list-recents'}).entries[0].id;assert.equal((await f.call({operation:'open-recent',recentId:updated})).ok,true);}
 }
});
test('failed/cancelled opens and temporary sessions do not populate recent documents',async()=>{
 const f=fixture();f.choose(path.join(f.root,'absent.md'));assert.equal((await f.call({operation:'open-file'})).ok,false);
 f.cancel();assert.equal((await f.call({operation:'open-file'})).code,'open-cancelled');assert.deepEqual(f.recentFiles.list().entries,[]);
 const d=f.service.open(f.file).document;f.manager.provision({webContents:f.wc},d,'Synthetic temporary',{temporary:true});assert.deepEqual(f.recentFiles.list().entries,[]);
});
test('corrupt, replaced or symlink catalog preserves records and disables recent shortcuts without blocking normal opens',async()=>{
 for(const kind of ['corrupt','root-replaced','symlink']){
  const f=fixture();await f.call({operation:'open-file'});const name=fs.readdirSync(f.catalog)[0],p=path.join(f.catalog,name);
  if(kind==='corrupt')fs.writeFileSync(p,'broken evidence');
  if(kind==='root-replaced'){fs.renameSync(f.catalog,f.catalog+'.retained');fs.mkdirSync(f.catalog,{mode:0o700});}
  if(kind==='symlink'){fs.renameSync(p,p+'.retained');fs.symlinkSync(p+'.retained',p);}
  assert.equal(f.recentFiles.list().ok,false);assert.equal(f.recentFiles.clear().ok,false);
  assert.equal((await f.call({operation:'open-file'})).ok,true);assert(fs.existsSync(p)||kind==='root-replaced');
 }
});
