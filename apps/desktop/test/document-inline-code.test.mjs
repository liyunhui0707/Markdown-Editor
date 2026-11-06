import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema([StarterKit.configure({undoRedo:false,trailingNode:false})]);
const span=(s,t)=>{const p=projectSource(s).spans.find(p=>p.text===t);assert.ok(p,t);return p;};
const cmd=(s,a,t,f=0,to=f)=>{const p=span(s,t);return mapFormatEdit(s,{action:a,from:p.from+f,to:p.from+to});};
function exact(r,before,after){assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.source,after);const c=r.inverseSource;assert.equal(after.slice(0,c.from)+c.insert+after.slice(c.to),before);}
for(const nl of ['\n','\r\n','\r'])for(const prefix of ['', '## ', '- ', '7) '])test(`inline code round trip ${JSON.stringify([nl,prefix])}`,()=>{
 const before='---'+nl+'keep: yes'+nl+'---'+nl+nl+prefix+'A 中文😀 Z'+nl+nl+'```md'+nl+'keep []'+nl+'```'+nl;
 const after=before.replace('中文😀','`中文😀`');exact(cmd(before,'code','A 中文😀 Z',2,6),before,after);
 assert.equal(span(after,'中文😀').code,true);exact(cmd(after,'code','中文😀',0,4),after,before);
 const p=span(after,'中文😀');assert.equal(mapTextEdit(after,{from:p.from+1,to:p.from+1,insert:'新'}).source,after.replace('中文','中新文'));
});
test('single-backtick source is literal; normalized and nested constructs stay protected',()=>{
 for(const text of ['a<T> | $x \\ {}','*literal* [x](y)','a b',' x','x ']){
   const s='A `'+text+'` Z',p=span(s,text);assert.equal(p.code,true);assert.equal(mapTextEdit(s,{from:p.from+1,to:p.from+1,insert:'中'}).ok,true);
 }
 for(const s of ['` x `','``x``','`a\nb`','**`code`**','*`code`*','- [x] `task`','```md extra\nfenced\n```','A <html> Z'])assert.equal(projectSource(s).spans.length,0,s);
 for(const s of ['A **bold** Z','A *italic* Z']){const p=projectSource(s).spans.find(p=>p.bold||p.italic);assert.equal(mapFormatEdit(s,{action:'code',from:p.from,to:p.to}).ok,false);}
 const s='A `code` Z';for(const a of ['bold','italic'])assert.equal(cmd(s,a,'code',0,4).ok,false);
 assert.equal(cmd(s,'code','code',1,3).ok,false);assert.equal(mapTextEdit(s,{from:4,to:4,insert:'`'}).ok,false);
 assert.equal(mapFormatEdit('word',{action:'code',from:1,to:5,path:'/tmp/forged'}).ok,false);
});
test('code full deletion and split/join preserve exact source and separate mark kinds',()=>{
 for(const prefix of ['', '- ']){
   const s=prefix+'A `中文😀` Z\r\n\r\nTail.',a=prefix?'list':'paragraph';
   const next=prefix+'A `中文`\r\n'+(prefix?'':'\r\n')+prefix+'`😀` Z\r\n\r\nTail.';
   exact(cmd(s,'split-'+a,'中文😀',2),s,next);exact(cmd(next,'join-'+a,'😀'),next,s);
 }
 exact(cmd('*italic*\n\n`code`','join-paragraph','code'),'*italic*\n\n`code`','*italic*`code`');
 const s='A `code` Z',p=span(s,'code');exact(mapTextEdit(s,{from:p.from,to:p.to,insert:''}),s,'A  Z');
});
test('accepted code selections and typing agree with actual ProseMirror marks',()=>{
 let accepted=0;
 for(const source of ['A `code` *em* **bold** Z','- A `code` Z\n- B *em* tail','`all`']){
   const p=projectSource(source),doc=schema.nodeFromJSON(p.doc);
   for(const a of p.spans)for(const b of p.spans)for(let from=a.from;from<=a.to;from++)for(let to=b.from;to<=b.to;to++){
     if(from>to)continue;
     for(const insert of ['中','']){
       const r=mapTextEdit(source,{from,to,insert});if(!r.ok)continue;accepted++;
       const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
       assert.deepEqual(schema.nodeFromJSON(r.projection.doc).toJSON(),(insert===''&&a.itemIndex!==undefined?state.tr.delete(from,to):state.tr.insertText(insert)).doc.toJSON(),JSON.stringify({source,from,to,insert}));
       if(r.inverseSource)exact(r,source,r.source);
     }
   }
 }
 assert(accepted>200);
});

test('code toolbar state and shortcut keep composition and readonly guards',async()=>{
  const {createFormatView}=await import('../lib/document-format-view.mjs');
  const elements=new Map(),calls=[];const byId=id=>{if(!elements.has(id))elements.set(id,{setAttribute(k,v){this[k]=v;}});return elements.get(id);};
  let composing=false,readOnly=false;
  const doc=schema.nodeFromJSON(projectSource('A `word` Z').doc),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,3,7)});
  const controller={format:async c=>{calls.push(c);return true;},state:()=>({locked:false})};
  const editor={state,view:{focus(){}},isActive:m=>m==='code'};
  const context=()=>({state:{confirmed:{temporary:true,readOnly},composing,recoveryRecords:[]},controller,editor});
  const view=createFormatView({byId,context,report(){}});view.sync();assert.equal(byId('format-code')['aria-pressed'],'true');assert.equal(byId('format-code').disabled,false);
  byId('format-code').onclick();await Promise.resolve();assert.equal(calls.at(-1).action,'code');
  let prevented=false;const e={key:'e',metaKey:true,preventDefault(){prevented=true;}};
  assert.equal(view.key({state,composing:false},e),true);await Promise.resolve();assert.equal(prevented,true);assert.equal(calls.length,2);
  composing=true;view.sync();assert.equal(byId('format-code').disabled,true);assert.equal(view.key({state,composing:false},e),false);byId('format-code').onclick();await Promise.resolve();assert.equal(calls.length,2);
  composing=false;readOnly=true;assert.equal(await view.run('code'),false);view.sync();assert.equal(byId('format-toolbar').hidden,true);assert.equal(calls.length,2);
});
