import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {getSchema} from '@tiptap/core';
import {EditorState} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {createEditController} from '../lib/document-edit-controller.mjs';
const require=createRequire(import.meta.url),{createDocumentService}=require('../lib/document-service'),{createDocumentSessions}=require('../lib/document-session-ipc');
const schema=getSchema(documentEditorExtensions());
function harness(source){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-article-ime-')),file=path.join(root,'Article.md');fs.writeFileSync(file,source);const disk=fs.readFileSync(file),service=createDocumentService(),document=service.open(file).document;
 const win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/article.html'};Object.assign(wc,{isDestroyed:()=>false,mainFrame:frame,getURL:()=>frame.url});Object.assign(win,{isDestroyed:()=>false,webContents:wc});
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,windowFor:()=>win});manager.grant(win,frame.url);const id=manager.provision(win,document,'Article'),requests=[];
 const request=(operation,data={})=>manager.request({sender:wc,senderFrame:frame},{operation,sessionId:id,...data});let state=EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(source).doc)});
 const controller=createEditController(request('snapshot').snapshot,{send:async(operation,data)=>{requests.push({operation,...data});return request(operation,data);},onReset:source=>{state=EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(source).doc)});}});
 return {controller,document,requests,file,disk,edit(from,to,insert){const tr=state.tr.insertText(insert,from,to);if(!controller.prepare(tr))return false;state=state.apply(tr);controller.accept(tr);return true;}};
}

test('article IME composition commits one physical text leaf once and keeps exact main history',async()=>{
 for(const source of ['First **bold\r\nsecond** tail.','First **bold**  \r\nsecond tail.','First **$100**\r\nsecond {price} | a < b.','First **line**\r\n[**second** plain](https://example.invalid "keep")','First **line**\r\n**`second`**']){
  const h=harness(source),s=projectSource(source).spans.find(s=>s.text.startsWith('second')),at=s.from+1;assert(s);
  assert(h.controller.beginComposition());assert(h.edit(at,at,'n'));assert(h.edit(at,at+1,'ni'));assert(h.edit(at,at+2,'你'));assert.equal(h.requests.length,0);assert.equal(h.document.text,source);
  h.controller.endComposition();await h.controller.idle();const expected=source.replace('second','s你econd');assert.equal(h.document.text,expected);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);assert.equal(h.controller.state().recoveryRecords.length,0);
  assert(await h.controller.history('undo'));assert.equal(h.document.text,source);assert(await h.controller.history('redo'));assert.equal(h.document.text,expected);assert.deepEqual(fs.readFileSync(h.file),h.disk);
 }
});
test('article cross-break composition stays protected while same-leaf cancellation sends no edit',async()=>{
 const source='First **bold**\nsecond tail.',h=harness(source),p=projectSource(source),a=p.spans.find(s=>s.text==='bold'),b=p.spans.find(s=>s.text.startsWith('second'));
 assert(h.controller.beginComposition());assert.equal(h.edit(a.to-1,b.from+1,'你'),false);h.controller.endComposition();await h.controller.idle();assert.equal(h.document.text,source);assert.equal(h.requests.filter(r=>r.operation==='edit').length,0);
 const at=b.from+1;assert(h.controller.beginComposition());assert(h.edit(at,at,'n'));assert(h.edit(at,at+1,''));h.controller.endComposition();await h.controller.idle();assert.equal(h.document.text,source);assert.equal(h.requests.filter(r=>r.operation==='edit').length,0);
});
