import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,NodeSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource} from '../lib/document-source-map.mjs';
import {createImageView} from '../lib/document-image-view.mjs';
function harness(){
 const elements=new Map(),calls=[],reports=[],byId=id=>{
  if(!elements.has(id))elements.set(id,{value:'',textContent:'',open:false,hidden:false,disabled:false,listeners:{},attrs:{},
   addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(k,v){this.attrs[k]=v;},focus(){},showModal(){this.open=true;},close(){this.open=false;}});
  return elements.get(id);
 };
 const source='![alt](image.png)',schema=getSchema(documentEditorExtensions()),doc=schema.nodeFromJSON(projectSource(source).doc);
 const editor={state:EditorState.create({schema,doc,selection:NodeSelection.create(doc,0)}),view:{composing:false,focus(){},dispatch(tr){editor.state=editor.state.apply(tr);}}};
 let resolve,mode='ok';const controller={format:q=>{calls.push(q);if(mode==='throw')return Promise.reject(Error('transport'));if(mode==='pending')return new Promise(r=>{resolve=r;});return Promise.resolve(mode==='ok');}};
 const c={editor,controller,state:{source,confirmed:{revision:2,readOnly:false},recoveryRecords:[],pending:0}};
 const view=createImageView({byId,context:()=>c,report:(...args)=>reports.push(args)});
 const event={preventDefault(){},stopPropagation(){}};
 return {view,c,byId,calls,reports,mode:m=>{mode=m;},resolve:v=>resolve(v),submit:()=>byId('image-form').listeners.submit(event),tick:()=>new Promise(r=>setImmediate(r))};
}
test('image panel refuses readonly, pending, composing and revoked contexts',()=>{
 const h=harness();for(const flag of ['loading','invalid']){h.c[flag]=true;assert.equal(h.view.open(),false);h.c[flag]=false;}
 for(const flag of ['locked','pending','historyPending','composing','compositionInvalid']){h.c.state[flag]=true;assert.equal(h.view.open(),false);h.c.state[flag]=false;}
 h.c.state.confirmed.readOnly=true;assert.equal(h.view.open(),false);h.c.state.confirmed.readOnly=false;
 h.c.editor.view.composing=true;assert.equal(h.view.open(),false);h.c.editor.view.composing=false;
 h.c.state.recoveryRecords.push({});assert.equal(h.view.open(),false);assert.deepEqual(h.calls,[]);
});
test('cancel restores the image atom selection and never edits the source',()=>{
 const h=harness();assert.equal(h.view.open(),true);h.byId('image-label').value='discard';h.byId('image-cancel').onclick();
 assert.equal(h.view.isOpen(),false);assert.ok(h.c.editor.state.selection instanceof NodeSelection);assert.equal(h.c.editor.state.selection.from,0);assert.deepEqual(h.calls,[]);
});
test('stale revision or session leaves panel text intact and sends no format request',async()=>{
 for(const changed of ['revision','controller']){const h=harness();h.view.open();h.byId('image-label').value='retained';
  if(changed==='revision')h.c.state.confirmed.revision++;else h.c.controller={};
  h.submit();await h.tick();assert.equal(h.view.isOpen(),true);assert.equal(h.byId('image-label').value,'retained');assert.match(h.byId('image-error').textContent,/状态已变化/);assert.deepEqual(h.calls,[]);
 }
});
test('composition and busy requests cannot be submitted twice or dismissed; failure retains fields',async()=>{
 const h=harness();h.view.open();h.byId('image-form').listeners.compositionstart();assert.equal(h.byId('image-apply').disabled,true);h.submit();await h.tick();assert.deepEqual(h.calls,[]);
 h.byId('image-form').listeners.compositionend();h.byId('image-label').value='retain';h.mode('pending');h.submit();h.submit();assert.equal(h.calls.length,1);h.byId('image-cancel').onclick();assert.equal(h.view.isOpen(),true);assert.equal(h.byId('image-cancel').disabled,true);
 h.resolve(false);await h.tick();assert.equal(h.view.isOpen(),true);assert.equal(h.byId('image-label').value,'retain');assert.match(h.byId('image-error').textContent,/未确认/);assert.equal(h.byId('image-apply').disabled,false);
 h.mode('throw');h.submit();await h.tick();assert.equal(h.view.isOpen(),true);assert.equal(h.byId('image-label').value,'retain');
});
test('successful panel command is bounded and keyboard transport errors are handled',async()=>{
 const h=harness();h.view.open();h.byId('image-label').value='next';h.byId('image-href').value='assets/next.png';h.submit();await h.tick();
 assert.equal(h.view.isOpen(),false);assert.deepEqual(h.calls,[{action:'set-image',from:0,to:1,label:'next',href:'assets/next.png'}]);
 h.mode('throw');assert.equal(h.view.key({state:h.c.editor.state},{key:'Enter',preventDefault(){}}),true);await h.tick();assert.match(h.reports.at(-1)[0],/操作未确认/);
});
