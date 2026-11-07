'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDraftStore}=require('../lib/document-draft-store'),{imageAsset,decodeAttachments,createLocalImages}=require('../lib/document-local-images');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
const raster=(size=png.length,n=0,width=1,height=1)=>{const b=Buffer.alloc(size,n);png.copy(b);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);if(size>png.length)b[size-1]=n;return b;};
const attachment=b=>({name:imageAsset(b).name,base64:b.toString('base64')});
test('larger source projects, edits and backs up with exact BOM/mixed endings',async()=>{
 const {projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs');const {sourceChange}=require('../lib/document-source-edit');
 const source='# Large\r\n\r\n'+('长文 Text 🌿 '.repeat(25000))+'\r\n\r\nEnd\n';assert(source.length>131072);
 assert(projectSource(source).doc.content.length>1);const result=sourceChange(source,{from:source.length-1,to:source.length-1,insert:' changed'});assert(result.ok);
 const span=projectSource(source).spans[0];assert(mapTextEdit(source,{from:span.from,to:span.from,insert:'New '}).ok);
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-capacity-'))),store=createDraftStore(path.join(root,'drafts')),id=store.newId(),bytes=Buffer.from('\ufeff'+result.source);
 assert(store.save({id,label:'Large',revision:1,bytes}).ok);assert.deepEqual(store.recover(id).bytes,bytes);
});
test('sixteen images and a larger individual image survive one exact backup generation',()=>{
 const bytes=Array.from({length:16},(_,i)=>raster(i===0?3*1048576:128,i+1));const attachments=bytes.map(attachment);assert.equal(decodeAttachments(attachments).length,16);
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-capacity-images-'))),store=createDraftStore(path.join(root,'drafts')),id=store.newId();
 const source=Buffer.from(attachments.map(a=>'![synthetic]('+a.name+')').join('\n\n'));assert(store.save({id,label:'Images',revision:1,bytes:source,attachments}).ok);
 assert.deepEqual(store.recover(id).attachments,attachments);
});
test('aggregate image bytes, decoded pixels and count are refused before any mutation',async()=>{
 const payload=Array.from({length:5},(_,i)=>attachment(raster(4*1048576,i+1)));
 assert.throws(()=>decodeAttachments(payload),e=>e.code==='image-total-size-limit');
 const pixels=Array.from({length:3},(_,i)=>attachment(raster(128,i+1,4000,3000)));assert.throws(()=>decodeAttachments(pixels),e=>e.code==='image-total-pixel-limit');
 assert.throws(()=>decodeAttachments(Array.from({length:17},(_,i)=>attachment(raster(128,i+1)))),e=>e.code==='image-count-limit');
 const {projectSource}=await import('../lib/document-source-map.mjs');const images=createLocalImages({projectSource,validateRaster:()=>true}),doc={text:'Unchanged'};images.attach(doc);
 assert.throws(()=>images.attach(doc,null,{attachments:payload}));assert.equal(doc.text,'Unchanged');
});
test('exact text boundary is editable/recoverable; overflow leaves no draft or changed disk file',async()=>{
 const c=require('../lib/document-capacity'),{sourceChange}=require('../lib/document-source-edit');
 const {projectSource}=await import('../lib/document-source-map.mjs');
 const source='界'.repeat(c.MAX_SOURCE_UNITS);assert(projectSource(source));assert.equal(sourceChange(source,{from:0,to:1,insert:'文'}).ok,true);
 assert.equal(sourceChange(source,{from:0,to:0,insert:'x'}).ok,false);assert.throws(()=>projectSource(source+'x'));
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-capacity-boundary-'))),store=createDraftStore(path.join(root,'drafts')),id=store.newId();
 const bytes=Buffer.from('\ufeff'+source);assert(store.save({id,label:'Boundary',revision:1,bytes}).ok);assert.deepEqual(store.recover(id).bytes,bytes);
 const names=fs.readdirSync(path.join(root,'drafts'));const denied=store.save({id:store.newId(),label:'overflow',revision:1,bytes:Buffer.from(source+'x')});assert.equal(denied.ok,false);assert.deepEqual(fs.readdirSync(path.join(root,'drafts')),names);
 const file=path.join(root,'bounded.md'),files=require('../lib/document-file-store').createDocumentFileStore();fs.writeFileSync(file,'before');const baseline=files.read(file);
 fs.writeFileSync(file,Buffer.alloc(c.MAX_DOCUMENT_BYTES+1,120));assert.throws(()=>files.read(file),e=>e.code==='unsupported-size');assert.equal(files.check(baseline).code,'external-change');assert.equal(fs.statSync(file).size,c.MAX_DOCUMENT_BYTES+1);
});
test('image budgets include undo/cancel assets; preview caches names and cannot broaden authority',async()=>{
 const {projectSource}=await import('../lib/document-source-map.mjs');let parses=0;
 const images=createLocalImages({projectSource:s=>{parses++;return projectSource(s);},validateRaster:()=>true}),doc={text:''};images.attach(doc);
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-capacity-budget-'))),names=[];
 for(let i=1;i<=8;i++){const file=path.join(root,`image-${i}.png`);fs.writeFileSync(file,raster(4*1048576,i));names.push(images.importFile(doc,file));}
 const content=names.slice(0,4).map(n=>`![x](${n})`).join('\n\n');images.validateChange(doc,content);doc.text=content;
 assert.equal(images.attachments(doc).length,4);const count=parses;
 for(const name of names.slice(0,4))images.preview(doc,name);assert.equal(parses,count);
 assert.throws(()=>images.preview(doc,names[4]));assert.throws(()=>images.validateChange(doc,content+`\n\n![x](${names[4]})`),e=>e.code==='image-total-size-limit');assert.equal(doc.text,content);
 const extra=path.join(root,'extra.png');fs.writeFileSync(extra,raster(128,99));assert.throws(()=>images.importFile(doc,extra),e=>e.code==='image-session-capacity');
 assert.equal(images.attachments(doc).length,4);
});
test('large applied source history stays bounded and preserves the newest exact inverse chain',()=>{
 const {trimHistory}=require('../lib/document-history-budget'),{MAX_HISTORY_UNITS}=require('../lib/document-capacity');
 const stack=[];for(let i=0;i<20;i++){stack.push({undo:{insert:String(i).padEnd(524288,'x')},redo:{insert:String(i+1).padEnd(524288,'y')}});trimHistory(stack);}
 assert.equal(stack.length,4);assert.equal(stack[0].undo.insert.slice(0,2),'16');assert.equal(stack.at(-1).redo.insert.slice(0,2),'20');
 assert(stack.reduce((n,e)=>n+e.undo.insert.length+e.redo.insert.length,0)<=MAX_HISTORY_UNITS);
 const short=Array.from({length:100},()=>({undo:{insert:'a'},redo:{insert:'b'}}));trimHistory(short);assert.equal(short.length,64);
});
test('native helper and JS capacity contracts agree, including complete base64 request space',()=>{
 const c=require('../lib/document-capacity'),header=fs.readFileSync(path.join(__dirname,'../native/document-capacity.h'),'utf8');
 const map={DOCUMENT_MAX_BYTES:c.MAX_DOCUMENT_BYTES,DOCUMENT_MAX_IMAGE_BYTES:c.MAX_IMAGE_BYTES,DOCUMENT_MAX_IMAGES:c.MAX_IMAGES,DOCUMENT_MAX_ATTACHMENT_BYTES:c.MAX_ATTACHMENT_BYTES,DOCUMENT_MAX_REQUEST_BYTES:c.MAX_RECORD_BYTES};
 for(const [name,value]of Object.entries(map))assert.match(header,new RegExp(`#define ${name} ${value}UL`));
 assert(c.base64Limit(c.MAX_DOCUMENT_BYTES)+c.base64Limit(c.MAX_ATTACHMENT_BYTES)+65536<c.MAX_RECORD_BYTES);
 assert.throws(()=>imageAsset(raster(c.MAX_IMAGE_BYTES+1)),e=>e.code==='image-size-limit');
});
