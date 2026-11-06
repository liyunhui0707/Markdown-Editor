import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {getSchema} from '@tiptap/core';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {createEditController} from '../lib/document-edit-controller.mjs';
const set=(s,from,to,label='图示😀',href='assets/diagram.png')=>mapFormatEdit(s,{action:'set-image',from,to,label,href});
const image=p=>p.blocks.find(b=>b?.image);
const inverse=(before,r)=>{assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.source.slice(0,r.inverseSource.from)+r.inverseSource.insert+r.source.slice(r.inverseSource.to),before);};

test('standalone images project as inert atoms, preserving source/title and mixed line endings',()=>{
 const source='# Keep\r\n\r\n![图示😀](<assets/my picture.png> "title")\r\n\r\nAfter';
 const p=projectSource(source),b=image(p);assert.ok(b);assert.equal(p.doc.content[1].type,'documentImage');
 assert.deepEqual(p.doc.content[1].attrs,{alt:'图示😀',src:'assets/my picture.png',title:'title'});
 assert.equal(b.to-b.from,1);assert.equal(source.slice(b.sourceFrom,b.sourceTo),'![图示😀](<assets/my picture.png> "title")');
 assert.equal(p.spans.some(s=>s.blockIndex===1),false);
 const schema=getSchema(documentEditorExtensions()),node=schema.nodeFromJSON(p.doc).child(1);assert.equal(node.nodeSize,1);
 const html=JSON.stringify(schema.nodes.documentImage.spec.toDOM(node));assert.doesNotMatch(html,/\["img"|"(?:src|href)":/);assert.match(html,/未加载预览/);
});
test('insert and edit an image through exact bounded patches, including empty alt and preserved title',()=>{
 for(const nl of ['\n','\r\n','\r']){
  const source='Before'+nl+nl+'After',r=set(source,3,3);inverse(source,r);
  assert.equal(r.source,'Before'+nl+nl+'![图示😀](<assets/diagram.png>)'+nl+nl+'After');
  const b=image(r.projection);assert.deepEqual(r.selection,{from:b.from,to:b.to});
  const changed=set(r.source,b.from,b.to,'','https://example.test/picture.png');inverse(r.source,changed);assert.ok(changed.source.includes('![](<https://example.test/picture.png>)'));
 }
 const original='![old](picture.png "keep title")',p=image(projectSource(original));
 const renamed=set(original,p.from,p.to,'new','picture.png');assert.equal(renamed.source,'![new](picture.png "keep title")');inverse(original,renamed);
 const replaced=set(original,p.from,p.to,'new','other.png');assert.equal(replaced.source,'![new](<other.png> "keep title")');inverse(original,replaced);
 const empty=set('',1,1);assert.equal(empty.source,'![图示😀](<assets/diagram.png>)');assert.deepEqual(empty.selection,{from:0,to:1});
});
test('image exit and removal keep ordinary writing possible without removing neighbors',()=>{
 let r=set('',1,1),b=image(r.projection);const only=r.source;
 r=mapFormatEdit(only,{action:'image-exit',from:b.from,to:b.to});inverse(only,r);assert.equal(r.source,only+'\n\n');
 const typed=mapTextEdit(r.source,{from:r.selection.from,to:r.selection.to,insert:'After'});assert.equal(typed.ok,true);
 b=image(typed.projection);const exit=mapFormatEdit(typed.source,{action:'image-exit',from:b.from,to:b.to});assert.equal(exit.source,typed.source);assert.equal(exit.selection.from,typed.projection.spans[0].from);
 const removed=mapFormatEdit(only,{action:'remove-image',from:0,to:1});inverse(only,removed);assert.equal(removed.source,'');
 const middle='Before\n\n'+only+'\n\nAfter',m=image(projectSource(middle));r=mapFormatEdit(middle,{action:'remove-image',from:m.from,to:m.to});inverse(middle,r);assert.equal(r.source,'Before\n\n\n\nAfter');
});
test('unsupported or unsafe image references remain protected and commands reject additional authority',()=>{
 for(const href of ['javascript:alert(1)','file:///tmp/a.png','data:image/svg+xml;base64,AA','//example.test/a','/tmp/a.png','https://u:p@example.test/a','x\n.png','a\\b.png','https://example.test/%0aevil'])assert.equal(set('',1,1,'alt',href).ok,false,href);
 for(const label of ['a]b','[x]','a\\b','a\nb','a'.repeat(513),'\ud800'])assert.equal(set('',1,1,label).ok,false);
 for(const source of ['text ![alt](a.png)','![alt][ref]\n\n[ref]: a.png','![a](javascript:foo)','![a](x.png) ![b](y.png)','> ![a](x.png)','![a&amp;b](x.png)'])assert.equal(image(projectSource(source)),undefined,source);
 assert.equal(mapFormatEdit('',{action:'set-image',from:1,to:1,label:'a',href:'a.png',path:'/tmp/evil'}).ok,false);
 assert.equal(set('words',1,3).ok,false);assert.equal(set('words',0,0).ok,false);
 const source='![a](a.png)';assert.equal(mapTextEdit(source,{from:0,to:1,insert:''}).ok,false);
});
test('text around images stays editable and leaves image spelling untouched',()=>{
 const s='Before\r\n\r\n![a](a.png \'title\')\r\n\r\nAfter',p=projectSource(s),tail=p.spans.at(-1);
 const r=mapTextEdit(s,{from:tail.to,to:tail.to,insert:' more'});assert.equal(r.ok,true);assert.equal(r.source,s+' more');
});
const require=createRequire(import.meta.url),{createDocumentService}=require('../lib/document-service'),{createDocumentSessions}=require('../lib/document-session-ipc');
function harness(readOnly=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-images-unit-')),file=path.join(root,'Original.md');fs.writeFileSync(file,'');
 const service=createDocumentService(),document=service.open(file).document,win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/image.html'};
 Object.assign(wc,{isDestroyed:()=>false,mainFrame:frame,getURL:()=>frame.url});Object.assign(win,{isDestroyed:()=>false,webContents:wc});
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,mapFormatEdit,windowFor:()=>win});manager.grant(win,frame.url);
 const id=manager.provision(win,document,'Synthetic',{readOnly}),event={sender:wc,senderFrame:frame};
 const call=(op,data={})=>manager.request(event,{operation:op,sessionId:id,...data});
 const h={document,file,call,event,manager};
 h.controller=createEditController(call('snapshot').snapshot,{send:async(op,data)=>{const r=call(op,data);return h.wrongAck?{...r,snapshot:{...r.snapshot,revision:999}}:r;}});return h;
}
test('image commands reuse main history, readonly/revision/sender fences and leave original bytes intact',async()=>{
 const h=harness(),q={action:'set-image',from:1,to:1,label:'图片',href:'assets/p.png'};
 assert.equal(await h.controller.format(q),true);const created=h.document.text;
 assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,'');assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,created);
 assert.equal(h.call('format',{...q,expectedRevision:0}).code,'stale-revision');
 assert.equal(h.call('format',{...q,expectedRevision:h.document.revision,path:'/tmp/p.png'}).ok,false);
 assert.equal(h.manager.request({...h.event,senderFrame:{}},{operation:'format',sessionId:'forged',...q}).code,'unauthorized-sender');
 assert.equal(fs.readFileSync(h.file,'utf8'),'');const ro=harness(true);assert.equal(await ro.controller.format(q),false);assert.equal(ro.call('format',{...q,expectedRevision:0}).code,'read-only-document');
});
test('composition and acknowledgement mismatch cannot falsely confirm an image edit',async()=>{
 const h=harness(),q={action:'set-image',from:1,to:1,label:'a',href:'a.png'};
 h.controller.beginComposition();assert.equal(await h.controller.format(q),false);assert.equal(h.document.text,'');h.controller.endComposition();
 h.wrongAck=true;assert.equal(await h.controller.format(q),false);assert.notEqual(h.controller.state().code,'formatted');assert.equal(fs.readFileSync(h.file,'utf8'),'');
});
