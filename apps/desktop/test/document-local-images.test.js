const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {imageAsset,decodeAttachments,readImageFile}=require('../lib/document-local-images');
const {createDraftStore}=require('../lib/document-draft-store');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
test('local image names bind exact PNG bytes; rejects SVG, oversize and unreasonable dimensions',()=>{
 const a=imageAsset(png);assert.match(a.name,/^markdown-image-[a-f0-9]{64}\.png$/);assert.equal(a.mime,'image/png');
 assert.throws(()=>imageAsset(Buffer.from('<svg/>')));assert.throws(()=>imageAsset(Buffer.alloc(1048577)));
 const huge=Buffer.from(png);huge.writeUInt32BE(50000,16);assert.throws(()=>imageAsset(huge));
 assert.throws(()=>decodeAttachments([{name:a.name,base64:Buffer.from('changed').toString('base64')}]));
 assert.throws(()=>decodeAttachments(Array(5).fill({name:a.name,base64:png.toString('base64')})));
 assert.throws(()=>decodeAttachments([{name:'../escape.png',base64:png.toString('base64')}]));
});
test('selected image reads are bounded, no-follow and preserve source bytes',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-image-read-'))),file=path.join(root,'selected.png');
 fs.writeFileSync(file,png,{mode:0o600});assert.deepEqual(readImageFile(file).bytes,png);
 fs.symlinkSync(file,path.join(root,'link.png'));assert.throws(()=>readImageFile(path.join(root,'link.png')));
 fs.writeFileSync(path.join(root,'large.png'),Buffer.alloc(1048577));assert.throws(()=>readImageFile(path.join(root,'large.png')));
});
test('draft generations retain exact attachment bytes, management and old plain snapshots stay compatible',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-image-draft-'))),store=createDraftStore(path.join(root,'drafts'));
 const a=imageAsset(png),attachments=[{name:a.name,base64:png.toString('base64')}],id=store.newId();
 const first=store.save({id,label:'Pictures',revision:1,bytes:Buffer.from('![p]('+a.name+')'),attachments});
 assert.equal(first.ok,true);assert.equal(store.recover(id).version,2);assert.deepEqual(store.recover(id).attachments,attachments);
 const token=store.list().drafts[0].manageToken;assert.equal(store.manage(id,'archive',token).ok,true);
 assert.equal(store.manage(id,'unarchive',store.list().archived[0].manageToken).ok,true);assert.deepEqual(store.recover(id).attachments,attachments);
 const plain=store.newId();assert.equal(store.save({id:plain,label:'plain',revision:0,bytes:Buffer.from('text')}).ok,true);
 assert.deepEqual(store.recover(plain).attachments,[]);
 const bad=store.save({id:store.newId(),label:'bad',revision:0,bytes:Buffer.from('text'),attachments:[{name:a.name,base64:'bad'}]});assert.equal(bad.ok,false);assert.equal(bad.state,'backup-failed');
});
test('main owns image capabilities: import does not mutate text; copies/recovery retain assets; forged references cannot read them',async()=>{
 const {projectSource}=await import('../lib/document-source-map.mjs');
 const {createLocalImages}=require('../lib/document-local-images');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-image-caps-'))),file=path.join(root,'p.png');fs.writeFileSync(file,png);
 const images=createLocalImages({projectSource,validateRaster:()=>true}),doc={text:'',filePath:path.join(root,'original.md')};images.attach(doc);
 const name=images.importFile(doc,file);assert.equal(doc.text,'');assert.throws(()=>images.preview(doc,name));
 doc.text='![diagram](<'+name+'>)';assert.match(images.preview(doc,name),/^data:image\/png;base64,/);
 const foreign={...doc};images.attach(foreign);assert.throws(()=>images.preview(foreign,name));assert.throws(()=>images.attachments(foreign));
 const copy={...doc};images.attach(copy,doc);assert.deepEqual(images.attachments(copy),images.attachments(doc));
 const recovered={...doc};images.attach(recovered,null,{attachments:images.attachments(doc)});assert.equal(images.preview(recovered,name),images.preview(doc,name));
 fs.writeFileSync(path.join(root,name),png);const opened={...doc};images.open(opened);assert.equal(images.preview(opened,name),images.preview(doc,name));
 fs.writeFileSync(path.join(root,name),'changed');images.open(opened);assert.throws(()=>images.preview(opened,name));
 assert.throws(()=>images.preview(doc,'../../secret.png'));
 assert.throws(()=>images.validateChange(foreign,'![x](markdown-image-'+ 'f'.repeat(64)+'.png)'));
 const names=Array.from({length:5},(_,i)=>'markdown-image-'+String(i).repeat(64)+'.png');
 assert.throws(()=>images.validateChange(doc,names.map(n=>'![x]('+n+')').join('\n\n')));
});
test('aggregate export keeps partial/unknown states and never reports success for missing attachment proof',()=>{
 const {createWithAttachments}=require('../lib/document-image-export');const a=imageAsset(png),attachments=[{name:a.name,base64:png.toString('base64')}];
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-image-export-'))),destination={root,state:{identity:{uid:process.getuid(),gid:process.getgid()}}};
 const args={name:'new.md',bytes:Buffer.from('body'),attachments,destination};let mdCalls=0;
 const failed=createWithAttachments({...args,store:{createImageCopy:()=>({ok:false,state:'created-partial',created:true,code:'write-failed'}),createCopy:()=>{mdCalls++;}}});
 const denied=createWithAttachments({...args,store:{createImageCopy:()=>({ok:false,state:'not-created',created:false,code:'EACCES'}),createCopy:()=>{mdCalls++;}}});assert.equal(denied.created,false);assert.equal(denied.code,'EACCES');
 assert.equal(failed.ok,false);assert.equal(failed.created,true);assert.equal(mdCalls,0);assert.deepEqual(failed.attachmentPaths,[path.join(root,a.name)]);
 const conflict=createWithAttachments({...args,store:{createImageCopy:()=>({ok:true}),createCopy:()=>({ok:false,state:'target-exists',created:false,code:'target-exists'})}});
 assert.equal(conflict.state,'created-partial');assert.equal(conflict.created,true);
 const unknown=createWithAttachments({...args,store:{createImageCopy:()=>{throw Error('lost');}}});assert.equal(unknown.state,'create-outcome-unknown');assert.equal(unknown.created,null);
 const finalFailure=createWithAttachments({...args,store:{createImageCopy:()=>({ok:true}),createCopy:()=>({ok:true,state:'created-confirmed',created:true})}},()=>{throw Error('changed');});assert.equal(finalFailure.ok,false);assert.equal(finalFailure.state,'created-unverified');
 fs.symlinkSync(path.join(root,'missing'),path.join(root,a.name));
 const symlink=createWithAttachments({...args,store:{createImageCopy:()=>{throw Error('must not write');}}});assert.equal(symlink.created,false);
});
test('image IPC pins sender/session/revision and a native selection cannot race edits or close',async()=>{
 const {EventEmitter}=require('node:events');const {projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs');const {mapFormatEdit}=await import('../lib/document-format-edit.mjs');
 const {createDocumentSessions}=require('../lib/document-session-ipc'),{createDocumentService}=require('../lib/document-service'),{createLocalImages}=require('../lib/document-local-images');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-image-ipc-'))),file=path.join(root,'p.png');fs.writeFileSync(file,png);
 const service=createDocumentService(),images=createLocalImages({projectSource,validateRaster:()=>true}),wc=new EventEmitter(),win=new EventEmitter(),frame={url:'file:///synthetic/app.html'};let finish;
 Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send(){}});Object.assign(win,{webContents:wc,isDestroyed:()=>false});
 const manager=createDocumentSessions({service,images,projectSource,mapTextEdit,mapFormatEdit,windowFor:()=>win,chooseImage:()=>new Promise(r=>{finish=r;}),createTemporary:bytes=>{const file=path.join(root,'seed.md');fs.writeFileSync(file,bytes);return service.open(file);}});
 manager.grant(win,frame.url);const event={sender:wc,senderFrame:frame},made=manager.request(event,{operation:'new-temporary'}),sessionId=made.snapshot.sessionId;
 const call=(operation,data={})=>manager.request(event,{operation,sessionId,...data});
 assert.equal(call('import-image',{expectedRevision:0,filePath:file}).ok,false);
 assert.equal(call('import-image',{expectedRevision:1}).code,'stale-revision');
 const selecting=call('import-image',{expectedRevision:0});assert.equal(call('edit',{expectedRevision:0,from:1,to:1,insert:'x'}).code,'copy-in-progress');
 finish({canceled:false,filePaths:[file]});const selected=await selecting;assert.equal(selected.ok,true);assert.equal(call('snapshot').snapshot.source,'');
 assert.equal(call('image-preview',{expectedRevision:0,href:selected.href}).ok,false);
 assert.equal(call('format',{expectedRevision:0,action:'set-image',from:1,to:1,label:'Image',href:selected.href}).ok,true);
 const preview=call('image-preview',{expectedRevision:1,href:selected.href});assert.equal(preview.ok,true);assert.equal(preview.sessionId,sessionId);
 assert.equal(manager.request({...event,senderFrame:{}},{operation:'image-preview',sessionId,expectedRevision:1,href:selected.href}).code,'unauthorized-sender');
 const revoked=call('import-image',{expectedRevision:1});manager.revoke(win);finish({canceled:false,filePaths:[file]});assert.equal((await revoked).ok,false);
});
test('draft backup cannot confirm an envelope with substituted attachment bytes',()=>{
 const {createHash}=require('node:crypto'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-image-backup-proof-')));
 const a=imageAsset(png),other=Buffer.from(png);other[other.length-1]^=1;const b=imageAsset(other);
 const io=Object.create(fs);io.writeSync=(fd,buffer,offset,length,position)=>{
  const envelope=JSON.parse(buffer.toString());envelope.record.attachments=[{name:b.name,base64:other.toString('base64')}];envelope.sha256=createHash('sha256').update(JSON.stringify(envelope.record)).digest('hex');
  const encoded=Buffer.from(JSON.stringify(envelope));assert.equal(encoded.length,buffer.length);return fs.writeSync(fd,encoded,offset,length,position);
 };
 const store=createDraftStore(path.join(root,'drafts'),{fs:io}),r=store.save({id:store.newId(),label:'proof',revision:1,bytes:Buffer.from('body'),attachments:[{name:a.name,base64:png.toString('base64')}]});
 assert.equal(r.ok,false);assert.equal(r.state,'draft-unverified');assert.equal(fs.readdirSync(path.join(root,'drafts')).length,1);
});


test('opaque protected blocks do not break attachment lookup or read-only opening', async () => {
  const {projectSource}=await import('../lib/document-source-map.mjs');
  const {createLocalImages}=require('../lib/document-local-images');
  const images=createLocalImages({projectSource,validateRaster:()=>true});
  const document={text:'# Heading\n\n<div>Keep literal HTML</div>\n\n::: unknown\n',filePath:'/synthetic/original.md'};
  assert.ok(projectSource(document.text).blocks.includes(null));
  assert.doesNotThrow(()=>images.open(document));
  assert.deepEqual(images.attachments(document),[]);
  assert.doesNotThrow(()=>images.validateChange(document,document.text+'\nMore text.'));
});
