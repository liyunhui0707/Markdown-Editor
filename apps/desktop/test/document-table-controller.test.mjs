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
import {createTableView} from '../lib/document-table-view.mjs';
const require=createRequire(import.meta.url);
const {createDocumentService}=require('../lib/document-service');
const {createDocumentSessions}=require('../lib/document-session-ipc');
const schema=getSchema(documentEditorExtensions());
function harness(source='',readOnly=false) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-table-unit-')),file=path.join(root,'Synthetic.md');fs.writeFileSync(file,source);
 const service=createDocumentService(),document=service.open(file).document,win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/table.html'};
 Object.assign(wc,{isDestroyed:()=>false,mainFrame:frame,getURL:()=>frame.url});Object.assign(win,{isDestroyed:()=>false,webContents:wc});
 const manager=createDocumentSessions({service,projectSource,mapTextEdit,mapFormatEdit,windowFor:()=>win});manager.grant(win,frame.url);
 const id=manager.provision(win,document,'Synthetic',{readOnly}),event={sender:wc,senderFrame:frame};
 const request=(operation,data={})=>manager.request(event,{operation,sessionId:id,...data});
 const h={document,request,file,wrongAck:false,requests:[],delayed:false,replies:[]};
 let state=EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(source).doc)});
 const controller=createEditController(request('snapshot').snapshot,{send:async(op,data)=>{
  h.requests.push(op);const r=await request(op,data);
  if(h.delayed&&['format','edit'].includes(op))await new Promise(resolve=>h.replies.push(resolve));
  return h.wrongAck&&op==='format'?{...r,snapshot:{...r.snapshot,source:'wrong'}}:r;
 },onReset:(source,selection)=>{const doc=schema.nodeFromJSON(projectSource(source).doc);state=EditorState.create({schema,doc,...(selection?{selection:TextSelection.create(doc,selection.from,selection.to)}:{})});}});
 const view={get state(){return state;},editable:true,composing:false,focus(){},dispatch(tr){if(controller.prepare(tr)){state=state.apply(tr);controller.accept(tr);}}};
 const editor={view,get state(){return state;}},nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const table=createTableView({byId,context:()=>({state:controller.state(),controller,editor,loading:false,invalid:false}),report:()=>{}});
 return Object.assign(h,{controller,view,table,byId,select(from,to=from){state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,from,to)));},
  cells:()=>projectSource(controller.state().source).spans.filter(s=>s.tableRow!==undefined),
  key(key,extra={}){const e={key,preventDefault(){this.prevented=true;},...extra};return table.key(view,e);}});
}
test('table commands, text revisions and main-owned undo/redo keep the original file intact',async()=>{
 const h=harness('');assert.equal(await h.table.run('insert-table'),true);
 const created=h.document.text,c=h.cells()[2];h.select(c.from);h.view.dispatch(h.view.state.tr.insertText('中文😀'));
 await h.controller.idle();assert.ok(h.document.text.includes('中文😀'));const edited=h.document.text;
 assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,created);
 assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,edited);
 assert.equal(await h.table.run('table-add-column'),true);const column=h.document.text;
 assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,edited);
 assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,column);
 assert.equal(fs.readFileSync(h.file,'utf8'),'');
 assert.equal(h.request('format',{expectedRevision:0,action:'table-add-row',from:4,to:4}).ok,false);
 assert.equal(h.request('format',{expectedRevision:h.document.revision,action:'table-add-row',from:4,to:4,path:'/tmp/injected'}).ok,false);
});
test('Tab/Shift+Tab, Enter, final-cell append and exit retain valid caret positions',async()=>{
 const h=harness('|A|B|\n|---|---|\n|||');h.select(h.cells()[0].from);
 assert.equal(h.key('Tab'),true);assert.equal(h.view.state.selection.from,h.cells()[1].from);
 assert.equal(h.key('Tab',{shiftKey:true}),true);assert.equal(h.view.state.selection.from,h.cells()[0].from);
 h.key('Enter');assert.equal(h.view.state.selection.from,h.cells()[2].from);
 h.select(h.cells().at(-1).from);h.key('Tab');await h.controller.idle();assert.equal(h.cells().length,6);assert.equal(h.view.state.selection.from,h.cells()[4].from);
 h.key('Enter',{metaKey:true});await h.controller.idle();assert.equal(h.view.state.selection.$from.parent.type.name,'paragraph');assert.equal(h.view.state.selection.$from.depth,1);
});
test('composition, selection and read-only gates prevent structural mutation; cell preedit commits as one history item',async()=>{
 const h=harness('|A|B|\n|---|---|\n|||'),c=h.cells()[2];h.select(c.from);
 assert.equal(h.controller.beginComposition(),true);assert.equal(h.key('Tab'),false);assert.equal(await h.table.run('table-add-row'),false);
 h.view.dispatch(h.view.state.tr.insertText('ni'));h.view.dispatch(h.view.state.tr.insertText('你',c.from,c.from+2));
 assert.equal(h.document.text,'|A|B|\n|---|---|\n|||');h.controller.endComposition();await h.controller.idle();
 assert.equal(h.document.text,'|A|B|\n|---|---|\n|你||');await h.controller.history('undo');assert.equal(h.document.text,'|A|B|\n|---|---|\n|||');
 h.select(h.cells()[0].from,h.cells()[1].to);assert.equal(await h.table.run('table-add-row'),false);
 const ro=harness('|A|\n|---|\n|B|',true);ro.select(ro.cells()[0].from);assert.equal(await ro.table.run('table-add-row'),false);assert.equal(ro.key('Tab'),false);
 assert.equal(ro.request('format',{expectedRevision:0,action:'table-add-row',from:4,to:4}).code,'read-only-document');
 assert.equal(ro.request('edit',{expectedRevision:0,from:4,to:5,insert:'No'}).code,'read-only-document');
});
test('keyboard row append queues after pending cell text; mismatched acknowledgements reconcile without losing confirmed text',async()=>{
 const h=harness('|A|\n|---|\n||');const c=h.cells().at(-1);h.select(c.from);h.delayed=true;
 h.view.dispatch(h.view.state.tr.insertText('Last'));assert.equal(h.key('Tab'),true);
 await new Promise(r=>setImmediate(r));assert.equal(h.controller.state().pending,2);
 h.delayed=false;h.replies.shift()();await h.controller.idle();assert.equal(h.document.text,'|A|\n|---|\n|Last|\n||');
 h.wrongAck=true;const before=h.document.text;assert.equal(await h.table.run('table-add-column'),false);
 assert.equal(h.controller.state().source,h.document.text);assert.notEqual(h.document.text,before);
 assert.ok(h.document.text.includes('Last'));assert.equal(fs.readFileSync(h.file,'utf8'),'|A|\n|---|\n||');
});


test('ordinary typing and paragraph selection do not request a whole-source table projection',()=>{
 const doc=schema.nodeFromJSON(projectSource('Plain paragraph.').doc),state=EditorState.create({schema,doc});
 const c={editor:{state,view:{composing:false}},state:{confirmed:{readOnly:false},recoveryRecords:[],get source(){throw Error('unneeded full-source projection');}}};
 const nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const table=createTableView({byId,context:()=>c,report(){}});
 table.sync();assert.equal(byId('table-tools').hidden,true);
 for(const key of ['a','ArrowLeft','Tab','Enter','Backspace','Delete'])assert.equal(table.key(c.editor.view,{key}),false);
});
