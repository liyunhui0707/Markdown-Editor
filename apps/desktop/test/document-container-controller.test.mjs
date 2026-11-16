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
const schema=getSchema(documentEditorExtensions());
function harness(input){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-container-controller-')),file=path.join(root,'Synthetic.md');fs.writeFileSync(file,'\ufeff'+input);
 const disk=fs.readFileSync(file),service=createDocumentService(),document=service.open(file).document;
 const win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/container.html'};Object.assign(wc,{isDestroyed:()=>false,mainFrame:frame,getURL:()=>frame.url});Object.assign(win,{isDestroyed:()=>false,webContents:wc});
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,mapFormatEdit,windowFor:()=>win});manager.grant(win,frame.url);const id=manager.provision(win,document,'Synthetic'),requests=[],reports=[];
 const request=(operation,data={})=>manager.request({sender:wc,senderFrame:frame},{operation,sessionId:id,...data});let state=EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(input).doc)}),lost=false;
 const controller=createEditController(request('snapshot').snapshot,{send:async(operation,data)=>{requests.push({operation,...data});const result=request(operation,data);if(lost&&operation==='edit')throw Error('synthetic lost committed response');return result;},onReset:(source,selection)=>{const doc=schema.nodeFromJSON(projectSource(source).doc);state=EditorState.create({schema,doc,...(selection?{selection:TextSelection.create(doc,selection.from,selection.to)}:{})});}});
 const dom={anchorNode:{},focusNode:{},rangeCount:1,isCollapsed:false};
 const view={get state(){return state;},editable:true,composing:false,hasFocus:()=>true,posAtDOM:(_,offset)=>offset,dom:{contains:()=>true,ownerDocument:{getSelection:()=>dom}},dispatch(tr){if(controller.prepare(tr)){state=state.apply(tr);controller.accept(tr);}}};
 return {view,controller,document,requests,reports,file,disk,dom,lose(){lost=true;},context:()=>({state:controller.state(),report:m=>reports.push(m)}),select(from,to=from,reverse=false){state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,from,to)));Object.assign(dom,{anchorOffset:reverse?to:from,focusOffset:reverse?from:to,isCollapsed:from===to});}};
}
const cases=['- [X] Before **word**\r\n\r\n  End [**link** plain](target "keep")\r\n- Untouched','> Outer\r\n> \r\n> > Before **word**\r\n> > \r\n> > End [**link** plain](target "keep")'];
for(const input of cases)for(const mode of ['insertText','Backspace','Delete','paste'])test('complex container native selection, exact history and unchanged file '+mode+' '+input[0],async()=>{
 const h=harness(input),p=projectSource(input),a=p.spans.find(s=>s.text==='word'),b=p.spans.find(s=>s.text==='link'),from=a.from+1,to=b.from+2;h.select(from,to,true);
 if(mode==='paste')pastePlainText(h.view,{preventDefault(){},clipboardData:{files:[],types:['text/plain'],getData:()=> 'One\r\nTwo😀'}},h.context());
 else assert(replaceParagraphRangeInput(h.view,{cancelable:true,preventDefault(){},getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:from,endOffset:to}],...(mode==='insertText'?{inputType:mode,data:'新😀'}:{key:mode})},h.context()));
 await h.controller.idle();assert.equal(h.reports.length,0);assert.equal(h.document.revision,1);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);const changed=h.document.text;assert(changed.includes('target "keep"'));assert.notEqual(changed,input);
 if(mode==='paste'){assert(changed.includes('Two😀'));assert.equal(projectSource(changed).doc.content[0].type,input[0]==='-'?'bulletList':'blockquote');}
 assert(await h.controller.history('undo'));assert.equal(h.document.text,input);assert(await h.controller.history('redo'));assert.equal(h.document.text,changed);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const input of cases)test('complex single-leaf composition commit and uncertain response '+input[0],async()=>{
 const h=harness(input),s=projectSource(input).spans.find(s=>s.text==='word');h.select(s.from+1);assert(h.controller.beginComposition());h.view.dispatch(h.view.state.tr.insertText('你'));h.controller.endComposition();await h.controller.idle();assert.equal(h.document.text,input.replace('word','w你ord'));assert(await h.controller.history('undo'));assert.equal(h.document.text,input);
 h.lose();h.select(s.from+1);h.view.dispatch(h.view.state.tr.insertText('新'));await h.controller.idle();assert(h.controller.state().recoveryRecords.length);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const input of cases)test('complex paragraph commands use main-owned history '+input[0],async()=>{
 const h=harness(input),s=projectSource(input).spans.find(s=>s.text==='word');assert(await h.controller.format({action:input[0]==='-'?'list-paragraph':'split-quote',from:s.from+2,to:s.from+2}));const split=h.document.text;assert.notEqual(split,input);assert(await h.controller.history('undo'));assert.equal(h.document.text,input);assert(await h.controller.history('redo'));assert.equal(h.document.text,split);
});
