import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {createEditController} from '../lib/document-edit-controller.mjs';
import {replaceParagraphRangeInput} from '../lib/document-paragraph-input.mjs';
import {pastePlainText} from '../lib/document-plain-paste.mjs';
const require=createRequire(import.meta.url),{createDocumentService}=require('../lib/document-service'),{createDocumentSessions}=require('../lib/document-session-ipc');
const schema=getSchema(documentEditorExtensions()),source='First **bold** tail\r\n\r\nNext [link](target "keep") end';
function harness(input=source){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-prose-controller-')),file=path.join(root,'Prose.md');fs.writeFileSync(file,'\ufeff'+input);const disk=fs.readFileSync(file),service=createDocumentService(),document=service.open(file).document;
 const win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/prose.html'};Object.assign(wc,{isDestroyed:()=>false,mainFrame:frame,getURL:()=>frame.url});Object.assign(win,{isDestroyed:()=>false,webContents:wc});
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,mapFormatEdit,windowFor:()=>win});manager.grant(win,frame.url);const id=manager.provision(win,document,'Prose'),requests=[],reports=[];
 const request=(operation,data={})=>manager.request({sender:wc,senderFrame:frame},{operation,sessionId:id,...data});let state=EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(input).doc)}),lost=false;
 const controller=createEditController(request('snapshot').snapshot,{send:async(operation,data)=>{requests.push({operation,...data});const r=request(operation,data);if(lost&&operation==='edit')throw Error('synthetic lost committed response');return r;},onReset:(source,selection)=>{const doc=schema.nodeFromJSON(projectSource(source).doc);state=EditorState.create({schema,doc,...(selection?{selection:TextSelection.create(doc,selection.from,selection.to)}:{})});}});
 const a={},b={},dom={anchorNode:a,focusNode:b,rangeCount:1,isCollapsed:false};
 const view={get state(){return state;},editable:true,composing:false,hasFocus:()=>true,posAtDOM:(_,offset)=>offset,dom:{contains:()=>true,ownerDocument:{getSelection:()=>dom}},dispatch(tr){if(controller.prepare(tr)){state=state.apply(tr);controller.accept(tr);}}};
 return {view,controller,document,requests,reports,file,disk,dom,lose(){lost=true;},context:()=>({state:controller.state(),report:m=>reports.push(m)}),select(from,to=from,reverse=false){state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,from,to)));Object.assign(dom,{anchorOffset:reverse?to:from,focusOffset:reverse?from:to,isCollapsed:from===to});}};
}
function range(h){const p=projectSource(h.controller.state().source),a=p.spans.find(s=>s.bold),b=p.spans.find(s=>s.link);return {from:a.from+1,to:b.from+2};}
for(const mode of ['insertText','deleteContentBackward','deleteContentForward','Backspace','Delete'])test('formatted prose native '+mode+' uses exact DOM/PM range and one main history item',async()=>{
 const h=harness(),{from,to}=range(h);h.select(from,to,true);let prevented=false;
 const event={cancelable:true,preventDefault(){prevented=true;},getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:from,endOffset:to}],...(mode.length<10?{key:mode}:{inputType:mode,data:mode==='insertText'?'新😀':null})};
 assert(replaceParagraphRangeInput(h.view,event,h.context()));assert(prevented);await h.controller.idle();assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);assert.equal(h.document.revision,1);
 const changed=h.document.text;assert.notEqual(changed,source);assert.equal(h.controller.state().source,changed);assert(h.document.text.includes('[nk](target "keep")'));
 assert(await h.controller.history('undo'));assert.equal(h.document.text,source);assert(await h.controller.history('redo'));assert.equal(h.document.text,changed);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('formatted prose plain clipboard event spans paragraphs and remains one exact history item',async()=>{
 const h=harness(),{from,to}=range(h);h.select(from,to);let reads=0;
 pastePlainText(h.view,{preventDefault(){},clipboardData:{files:[],types:['text/plain','text/html'],getData(type){assert.equal(type,'text/plain');reads++;return 'One\r\nTwo😀';}}},h.context());await h.controller.idle();
 assert.equal(reads,1);assert.equal(h.reports.length,0);assert.equal(h.document.revision,1);const changed=h.document.text;assert(changed.includes('One\r\n\r\nTwo😀'));assert(changed.includes('[nk](target "keep")'));
 assert(await h.controller.history('undo'));assert.equal(h.document.text,source);assert(await h.controller.history('redo'));assert.equal(h.document.text,changed);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('formatted prose input retains target-range, pending and composition guards',async()=>{
 const h=harness(),{from,to}=range(h);h.select(from,to);let prevented=false;
 const event={cancelable:true,inputType:'insertText',data:'Wrong',preventDefault(){prevented=true;},getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:from+1,endOffset:to}]};
 assert(replaceParagraphRangeInput(h.view,event,h.context()));assert(prevented);assert.equal(h.document.text,source);assert.equal(h.requests.length,0);
 assert(h.controller.beginComposition());const tr=h.view.state.tr.insertText('你');assert.equal(h.controller.prepare(tr),false);h.controller.endComposition();await h.controller.idle();assert.equal(h.requests.length,0);assert.equal(h.document.text,source);
 pastePlainText(h.view,{preventDefault(){},clipboardData:{getData(){throw Error('pending must not read');}}},{...h.context(),state:{...h.controller.state(),pending:1}});assert.equal(h.document.text,source);
});
test('lost cross-paragraph response retains the full attempted source and exact main history',async()=>{
 const h=harness(),{from,to}=range(h);h.select(from,to);h.lose();const tr=h.view.state.tr.insertText('New');h.view.dispatch(tr);await h.controller.idle();assert.equal(h.document.revision,1);assert.equal(h.controller.state().source,h.document.text);assert(h.controller.state().recoveryRecords.some(r=>r.source===h.document.text));assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
