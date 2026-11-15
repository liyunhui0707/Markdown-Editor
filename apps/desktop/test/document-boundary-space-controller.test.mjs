import {applyBoundarySpace} from '../lib/document-boundary-space-input.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {Slice,Fragment} from '@tiptap/pm/model';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {createEditController} from '../lib/document-edit-controller.mjs';
import {replaceParagraphRangeInput} from '../lib/document-paragraph-input.mjs';
import {pastePlainText} from '../lib/document-plain-paste.mjs';
const require=createRequire(import.meta.url),{createDocumentService}=require('../lib/document-service'),{createDocumentSessions}=require('../lib/document-session-ipc');
const schema=getSchema(documentEditorExtensions()),source='First **bold** tail\r\n\r\nNext [link](target "keep") end';
function harness(input=source){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-structured-controller-')),file=path.join(root,'Prose.md');fs.writeFileSync(file,'\ufeff'+input);const disk=fs.readFileSync(file),service=createDocumentService(),document=service.open(file).document;
 const win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/prose.html'};Object.assign(wc,{isDestroyed:()=>false,mainFrame:frame,getURL:()=>frame.url});Object.assign(win,{isDestroyed:()=>false,webContents:wc});
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,mapFormatEdit,windowFor:()=>win});manager.grant(win,frame.url);const id=manager.provision(win,document,'Prose'),requests=[],reports=[];
 const request=(operation,data={})=>manager.request({sender:wc,senderFrame:frame},{operation,sessionId:id,...data});let state=EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(input).doc)}),lost=false,corrupt=null;
 const controller=createEditController(request('snapshot').snapshot,{send:async(operation,data)=>{requests.push({operation,...data});const r=request(operation,data);if(lost&&operation==='edit')throw Error('synthetic lost committed response');return operation==='edit'&&corrupt?corrupt(r):r;},onReset:(source,selection)=>{const doc=schema.nodeFromJSON(projectSource(source).doc);state=EditorState.create({schema,doc,...(selection?{selection:TextSelection.create(doc,selection.from,selection.to)}:{})});}});
 const a={},b={},dom={anchorNode:a,focusNode:b,rangeCount:1,isCollapsed:false};
 const view={get state(){return state;},editable:true,composing:false,hasFocus:()=>true,posAtDOM:(_,offset)=>offset,dom:{contains:()=>true,ownerDocument:{getSelection:()=>dom}},dispatch(tr){if(controller.prepare(tr)){state=state.apply(tr);controller.accept(tr);}}};
 return {view,controller,document,requests,reports,file,disk,dom,corrupt(fn){corrupt=fn;},lose(){lost=true;},context:()=>({state:controller.state(),report:m=>reports.push(m)}),select(from,to=from,reverse=false){state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,from,to)));Object.assign(dom,{anchorOffset:reverse?to:from,focusOffset:reverse?from:to,isCollapsed:from===to});}};
}
const sources=['A **word** tail','A *word* tail','## A **word**','A **outer *word* tail** end','A [**word**](target "keep") end','- [X] A **word**\n  continued','> A **word**  \r\n> continued','| A | B |\n| --- | --- |\n| **word** | End |'];
for(const input of sources)test('boundary Space native/main/history and continued words '+input.slice(0,18),async()=>{
 const h=harness(input),s=projectSource(input).spans.find(s=>s.text==='word');h.select(s.to);const at=s.to;let prevented=false;
 const plan=mapTextEdit(input,{from:at,to:at,insert:' '});assert(plan.ok&&plan.boundarySpace);
 assert(applyBoundarySpace(h.view,{inputType:'insertText',data:' ',cancelable:true,preventDefault(){prevented=true;},getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:at,endOffset:at}]},h.context()));assert(prevented);await h.controller.idle();assert.equal(h.document.text,plan.source);assert.equal(h.document.revision,1);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
 h.view.dispatch(h.view.state.tr.insertText('next'));await h.controller.idle();const final=h.document.text;assert.notEqual(final,plan.source);assert(h.view.state.doc.textContent.includes('word next'));
 assert(await h.controller.history('undo'));assert.equal(h.document.text,plan.source);assert(await h.controller.history('undo'));assert.equal(h.document.text,input);assert(await h.controller.history('redo'));assert.equal(h.document.text,plan.source);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('Space input preserves composition, readonly, queue and exact native target fences',async()=>{
 const h=harness('A **word** tail'),s=projectSource(h.document.text).spans.find(s=>s.text==='word');h.select(s.to);const event={inputType:'insertText',data:' ',cancelable:true,preventDefault(){},getTargetRanges:()=>[]};
 for(const extra of [{isComposing:true},{keyCode:229},{cancelable:false},{defaultPrevented:true},{data:'x'},{inputType:'insertCompositionText'}])assert.equal(applyBoundarySpace(h.view,{...event,...extra},h.context()),false);
 for(const extra of [{blocked:true},{state:{...h.controller.state(),locked:true}},{state:{...h.controller.state(),confirmed:{...h.controller.state().confirmed,readOnly:true}}}])assert.equal(applyBoundarySpace(h.view,event,{...h.context(),...extra}),false);
 assert(h.controller.beginComposition());assert.equal(applyBoundarySpace(h.view,event,h.context()),false);h.controller.endComposition();await h.controller.idle();
 let prevented=false;assert(applyBoundarySpace(h.view,{...event,preventDefault(){prevented=true;},getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:s.to+1,endOffset:s.to+1}]},h.context()));assert(prevented);assert.equal(h.document.text,'A **word** tail');assert.equal(h.requests.length,0);
});

test('queued source proof cannot authorize forged acknowledgement identity, content or metadata',async()=>{
 for(const change of [{source:'not the proven source'},{sessionId:'another-session'},{revision:99},{dirty:'yes'}]){
  const h=harness('Plain word');h.select(7);h.corrupt(r=>({...r,snapshot:{...r.snapshot,...change}}));h.view.dispatch(h.view.state.tr.insertText('x'));await h.controller.idle();
  const state=h.controller.state();assert.equal(state.code,'ack-mismatch');assert.equal(state.recoveryRecords.length,1);assert.equal(state.recoveryRecords[0].source,'Plain xword');assert.equal(h.document.text,'Plain xword');assert.equal(state.confirmed.source,h.document.text);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);assert.deepEqual(fs.readFileSync(h.file),h.disk);
 }
});
