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
 const request=(operation,data={})=>manager.request({sender:wc,senderFrame:frame},{operation,sessionId:id,...data});let state=EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(input).doc)}),lost=false;
 const controller=createEditController(request('snapshot').snapshot,{send:async(operation,data)=>{requests.push({operation,...data});const r=request(operation,data);if(lost&&operation==='edit')throw Error('synthetic lost committed response');return r;},onReset:(source,selection)=>{const doc=schema.nodeFromJSON(projectSource(source).doc);state=EditorState.create({schema,doc,...(selection?{selection:TextSelection.create(doc,selection.from,selection.to)}:{})});}});
 const a={},b={},dom={anchorNode:a,focusNode:b,rangeCount:1,isCollapsed:false};
 const view={get state(){return state;},editable:true,composing:false,hasFocus:()=>true,posAtDOM:(_,offset)=>offset,dom:{contains:()=>true,ownerDocument:{getSelection:()=>dom}},dispatch(tr){if(controller.prepare(tr)){state=state.apply(tr);controller.accept(tr);}}};
 return {view,controller,document,requests,reports,file,disk,dom,lose(){lost=true;},context:()=>({state:controller.state(),report:m=>reports.push(m)}),select(from,to=from,reverse=false){state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,from,to)));Object.assign(dom,{anchorOffset:reverse?to:from,focusOffset:reverse?from:to,isCollapsed:from===to});}};
}
const sources=['- [X] Before **word**\r\n  continued tail\r\n- [ ] End [**link** plain](target "keep")','4) Before **word**\n   continued tail\n7) End [**link** plain](target "keep")','> Before **word**\r\n> continued tail\r\n> \r\n> End [**link** plain](target "keep")'];
function range(h){const p=projectSource(h.controller.state().source),a=p.spans.find(s=>s.text==='word'),b=p.spans.find(s=>s.text==='link');return {from:a.from+1,to:b.from+2};}
for(const input of sources)for(const mode of ['insertText','Backspace','Delete','paste'])test('structured native range '+mode+' '+input.slice(0,4),async()=>{
 const h=harness(input),{from,to}=range(h);h.select(from,to,true);let reads=0;
 if(mode==='paste')pastePlainText(h.view,{preventDefault(){},clipboardData:{files:[],types:['text/plain','text/html'],getData(type){assert.equal(type,'text/plain');reads++;return 'One\r\nTwo😀';}}},h.context());
 else assert(replaceParagraphRangeInput(h.view,{cancelable:true,preventDefault(){},getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:from,endOffset:to}],...(mode==='insertText'?{inputType:mode,data:'新😀'}:{key:mode})},h.context()));
 await h.controller.idle();assert.equal(h.reports.length,0);assert.equal(h.document.revision,1);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);const changed=h.document.text;assert.notEqual(changed,input);assert(changed.includes('target "keep"'));
 if(mode==='paste'){assert.equal(reads,1);assert(changed.includes('Two😀'));if(input.startsWith('- [X]'))assert(changed.includes('\r\n- [ ] Two😀'));}
 assert(await h.controller.history('undo'));assert.equal(h.document.text,input);assert(await h.controller.history('redo'));assert.equal(h.document.text,changed);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const input of sources)test('structured composition, target mismatch and unavailable outcome stay fenced '+input.slice(0,4),async()=>{
 const h=harness(input),{from,to}=range(h);h.select(from,to);assert(h.controller.beginComposition());assert.equal(h.controller.prepare(h.view.state.tr.insertText('你')),false);h.controller.endComposition();await h.controller.idle();assert.equal(h.requests.length,0);
 h.select(from,to);let prevented=false;assert(replaceParagraphRangeInput(h.view,{cancelable:true,inputType:'insertText',data:'Wrong',preventDefault(){prevented=true;},getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:from+1,endOffset:to}]},h.context()));assert(prevented);assert.equal(h.document.text,input);assert.equal(h.requests.length,0);
 h.lose();h.view.dispatch(h.view.state.tr.insertText('New'));await h.controller.idle();assert.equal(h.document.revision,1);assert.equal(h.controller.state().source,h.document.text);assert(h.controller.state().recoveryRecords.some(r=>r.source===h.document.text));assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const input of sources)test('wrapped same-physical-leaf composition commits with exact history '+input.slice(0,4),async()=>{
 const h=harness(input),s=projectSource(input).spans.find(s=>s.text==='word');h.select(s.from+1);assert(h.controller.beginComposition());h.view.dispatch(h.view.state.tr.insertText('你'));h.controller.endComposition();await h.controller.idle();assert.equal(h.document.text,input.replace('word','w你ord'));assert(await h.controller.history('undo'));assert.equal(h.document.text,input);
});
for(const input of sources)test('wrapped format/split/join main-owned history '+input.slice(0,4),async()=>{
 const h=harness(input),s=projectSource(input).spans.find(s=>s.text==='word'),action=input.startsWith('>')?'quote':'list';
 assert(await h.controller.format({action:'split-'+action,from:s.from+2,to:s.from+2}));const split=h.document.text;assert.notEqual(split,input);assert(await h.controller.history('undo'));assert.equal(h.document.text,input);assert(await h.controller.history('redo'));assert.equal(h.document.text,split);
 const p=projectSource(split),rows=p.blocks[0].items||p.blocks[0].quoteRows,at=rows[1].from;assert(await h.controller.format({action:'join-'+action,from:at,to:at}));assert.equal(h.document.text,input);
});
