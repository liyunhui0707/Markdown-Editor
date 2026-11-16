import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),{createLocalImages}=require('../lib/document-local-images');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
function harness(href='images/图 示.png'){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-relative-images-')));
 fs.mkdirSync(path.join(root,'images'));fs.writeFileSync(path.join(root,'images','图 示.png'),png);
 const original={text:`![图示](<${href}> "keep title")`,filePath:path.join(root,'original.md')};
 fs.writeFileSync(original.filePath,original.text);
 const images=createLocalImages({projectSource,validateRaster:()=>true});images.open(original);
 const draft={text:original.text,filePath:path.join(root,'temporary.md')};images.attach(draft,original);
 return {root,images,original,draft};
}
test('explicit referenced-image collection preserves source, stages exact bytes and survives ordinary attachment recovery',()=>{
 for(const href of ['images/图 示.png','./images/图%20示.png','images/%E5%9B%BE%20%E7%A4%BA.png']){
  const h=harness(href),before=h.draft.text,name=h.images.importReference(h.draft,href);
  assert.equal(h.draft.text,before);assert.deepEqual(h.images.attachments(h.draft),[]);
  h.draft.text=`![图示](<${name}> "keep title")`;
  const attachments=h.images.attachments(h.draft);assert.equal(attachments.length,1);assert.equal(attachments[0].base64,png.toString('base64'));
  assert.match(h.images.preview(h.draft,name),/^data:image\/png/);
  const recovered={text:h.draft.text};h.images.attach(recovered,null,{attachments});
  assert.equal(h.images.preview(recovered,name),h.images.preview(h.draft,name));
  assert.throws(()=>h.images.importReference(recovered,href));
  assert.equal(fs.readFileSync(h.original.filePath,'utf8'),before);
 }
});
test('reference collection cannot adopt arbitrary paths, remote URLs, hidden files, traversal or unprojected references',()=>{
 for(const href of ['../image.png','images/../image.png','images/%2e%2e/image.png','images/%2fetc.png','images/%5cetc.png','images/%00.png','images/%ZZ.png','images/x.png?q=1','images/x.png#part','https://example.test/x.png','/tmp/a.png','.env/x.png','secrets/a.png','images/.private.png','images/a.svg','images/%252e%252e/x.png']){
  const h=harness(href);assert.throws(()=>h.images.importReference(h.draft,href),href);assert.deepEqual(h.images.attachments(h.draft),[]);
 }
 const h=harness();assert.throws(()=>h.images.importReference(h.draft,'images/missing.png'));
 h.draft.text='text ![inline](<images/图 示.png>)';assert.throws(()=>h.images.importReference(h.draft,'images/图 示.png'));
 const blank={text:h.original.text,filePath:h.original.filePath};h.images.attach(blank);assert.throws(()=>h.images.importReference(blank,'images/图 示.png'));
});
test('relative roots are inherited explicitly and directory/file symlinks or replaced roots never grant image reads',()=>{
 for(const kind of ['file-link','directory-link','root-replaced']){
  const h=harness(),directory=path.join(h.root,'images');
  if(kind==='file-link'){fs.renameSync(path.join(directory,'图 示.png'),path.join(h.root,'held.png'));fs.symlinkSync(path.join(h.root,'held.png'),path.join(directory,'图 示.png'));}
  if(kind==='directory-link'){fs.renameSync(directory,path.join(h.root,'held'));fs.symlinkSync(path.join(h.root,'held'),directory);}
  if(kind==='root-replaced'){fs.renameSync(h.root,h.root+'-held');fs.mkdirSync(h.root);fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'图 示.png'),png);}
  assert.throws(()=>h.images.importReference(h.draft,'images/图 示.png'),kind);
 }
 const h=harness();h.original.text='![other](<images/图 示.png>)';h.draft.text='![unchanged](<images/图 示.png>)';
 assert.match(h.images.importReference(h.draft,'images/图 示.png'),/^markdown-image-/);
 const rejected=createLocalImages({projectSource,validateRaster:()=>false});rejected.open(h.original);rejected.attach(h.draft,h.original);
 assert.throws(()=>rejected.importReference(h.draft,'images/图 示.png'));assert.deepEqual(rejected.attachments(h.draft),[]);
});
test('reference IPC validates sender, revision, payload, writable session and exact main-owned source before reading',()=>{
 const {createDocumentService}=require('../lib/document-service'),{createDocumentSessions}=require('../lib/document-session-ipc');
 const h=harness(),service=createDocumentService(),original=service.open(h.original.filePath).document;
 h.images.open(original);
 const wc=new EventEmitter(),win=new EventEmitter(),frame={url:'file:///synthetic/reference.html'};
 Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send(){}});Object.assign(win,{webContents:wc,isDestroyed:()=>false});
 const manager=createDocumentSessions({service,images:h.images,projectSource,mapTextEdit,mapFormatEdit,windowFor:()=>win,
  createTemporary:bytes=>{const file=path.join(h.root,'seed.md');fs.writeFileSync(file,bytes);return service.open(file);}});
 manager.grant(win,frame.url);const originalId=manager.provision(win,original,'Original',{readOnly:true}),event={sender:wc,senderFrame:frame};
 const ro={operation:'import-referenced-image',sessionId:originalId,expectedRevision:0,href:'images/图 示.png'};
 assert.equal(manager.request(event,ro).code,'read-only-document');
 const opened=manager.request(event,{operation:'snapshot',sessionId:originalId}).snapshot;
 const copied=manager.request(event,{operation:'edit-copy',sessionId:originalId,expectedRevision:0,expectedSha256:opened.editCopySha256});assert.equal(copied.ok,true,JSON.stringify(copied));
 const q={...ro,sessionId:copied.snapshot.sessionId};
 assert.equal(manager.request({...event,senderFrame:{}},q).code,'unauthorized-sender');
 assert.equal(manager.request(event,{...q,expectedRevision:1}).code,'stale-revision');
 assert.equal(manager.request(event,{...q,filePath:path.join(h.root,'images','图 示.png')}).code,'invalid-request');
 assert.equal(manager.request(event,{...q,href:'images/other.png'}).ok,false);
 const result=manager.request(event,q);assert.equal(result.ok,true);assert.equal(result.revision,0);assert.equal(result.sessionId,q.sessionId);
 assert.equal(manager.request(event,{operation:'snapshot',sessionId:q.sessionId}).snapshot.source,h.original.text);
 const b=projectSource(h.original.text).blocks.find(b=>b.image);
 assert.equal(manager.request(event,{operation:'format',sessionId:q.sessionId,expectedRevision:0,action:'set-image',from:b.from,to:b.to,label:'图示',href:result.href}).ok,true);
 const after=manager.request(event,{operation:'snapshot',sessionId:q.sessionId}).snapshot.source;
 assert.equal(after,`![图示](<${result.href}> "keep title")`);
 assert.equal(manager.request(event,{operation:'undo',sessionId:q.sessionId,expectedRevision:1}).snapshot.source,h.original.text);
 assert.equal(fs.readFileSync(h.original.filePath,'utf8'),h.original.text);
});
test('preload reference import fences IME/pending work and tombstones forged or lost receipts',async()=>{
 function fixture(){
  let api,resolve;const dom=new EventEmitter(),ipc=new EventEmitter();
  ipc.invoke=()=>new Promise(r=>{resolve=r;});
  runInNewContext(fs.readFileSync(new URL('../lib/document-demo-preload.js',import.meta.url),'utf8'),{document:{addEventListener:(n,f)=>dom.on(n,f)},require:()=>({ipcRenderer:ipc,contextBridge:{exposeInMainWorld:(_n,v)=>{api=v;}}})});
  return {api,dom,resolve:v=>resolve(v)};
 }
 const q={sessionId:'s',expectedRevision:0,href:'images/x.png'};
 const f=fixture();f.dom.emit('compositionstart');assert.equal((await f.api.importReferencedImage(q)).code,'composition-active');f.dom.emit('compositionend');
 const pending=f.api.importReferencedImage(q);assert.equal((await f.api.importReferencedImage(q)).code,'document-busy');
 f.resolve({ok:true,sessionId:'other',revision:0,href:'markdown-image-'+'a'.repeat(64)+'.png'});
 assert.equal((await pending).code,'image-import-unknown');assert.equal((await f.api.importReferencedImage(q)).code,'image-import-unknown');
});
