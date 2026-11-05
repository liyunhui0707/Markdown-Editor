import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema([StarterKit.configure({undoRedo:false,trailingNode:false})]);
const span=(source,text)=>{const s=projectSource(source).spans.find(s=>s.text===text);assert.ok(s,text);return s;};
const command=(source,action,text,start=0,end=start)=>{const s=span(source,text);return mapFormatEdit(source,{action,from:s.from+start,to:s.from+end});};
function exact(result,before,after) {
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.source,after);
  const c=result.inverseSource;assert.equal(after.slice(0,c.from)+c.insert+after.slice(c.to),before);
}
for(const nl of ['\n','\r\n','\r'])for(const prefix of ['', '## ', '- ', '7) '])test(`italic format round trip ${JSON.stringify([nl,prefix])}`,()=>{
  const before='---'+nl+'keep: yes'+nl+'---'+nl+nl+prefix+'A 中文😀 Z'+nl+nl+'```md'+nl+'keep []'+nl+'```'+nl;
  const result=command(before,'italic','A 中文😀 Z',2,6),after=before.replace('中文😀','*中文😀*');exact(result,before,after);
  assert.deepEqual(span(after,'中文😀').italic,true);
  exact(command(after,'italic','中文😀',0,4),after,before);
  assert.equal(mapTextEdit(after,{from:span(after,'中文😀').from+1,to:span(after,'中文😀').from+1,insert:'新'}).source,after.replace('中文','中新文'));
});
for(const marker of ['*','_'])test(`existing italic delimiter ${marker} edits and full deletion`,()=>{
  const before=`A ${marker}text${marker} Z`,p=span(before,'text');
  assert.equal(mapTextEdit(before,{from:p.from+1,to:p.from+3,insert:'新'}).source,`A ${marker}t新t${marker} Z`);
  exact(mapTextEdit(before,{from:p.from,to:p.to,insert:''}),before,'A  Z');
  exact(command(before,'italic','text',0,4),before,'A text Z');
  const first=mapTextEdit(before,{from:p.from,to:p.from+1,insert:''});assert.equal(first.ok,true);
  assert.equal(mapTextEdit(first.source,{from:p.from,to:p.from,insert:'t'},first.leaf).source,before);
});
test('italic mixed selection agrees with PM and leaves exact inverse',()=>{
  let accepted=0;
  for(const source of ['A *italic* **bold** Z','- A *italic* Z\n- B **bold** tail','A _italic_ Z']){
    const p=projectSource(source),doc=schema.nodeFromJSON(p.doc);
    for(const a of p.spans)for(const b of p.spans)for(let from=a.from;from<=a.to;from++)for(let to=b.from;to<=b.to;to++) {
      if(from>=to)continue;
      const r=mapTextEdit(source,{from,to,insert:'中'});if(!r.ok)continue;
      accepted++;const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
      assert.deepEqual(r.projection.doc,state.tr.insertText('中').doc.toJSON());
      if(r.inverseSource)exact(r,source,r.source);
    }
  }
  assert(accepted>150);
});
test('italic split/join preserves style and never conflates bold with italic',()=>{
  for(const marker of ['*','_'])for(const prefix of ['', '- ']){
    const before=prefix+`A ${marker}中文😀${marker} Z\r\n\r\nTail.`,action=prefix?'list':'paragraph';
    const after=prefix+`A ${marker}中文${marker}\r\n${prefix?'':'\r\n'}${prefix}${marker}😀${marker} Z\r\n\r\nTail.`;
    exact(command(before,'split-'+action,'中文😀',2),before,after);
    exact(command(after,'join-'+action,'😀'),after,before);
  }
  const before='**bold**\n\n*italic*';exact(command(before,'join-paragraph','italic'),before,'**bold***italic*');
});
test('italic refuses nested marks, partial removal, malformed payloads and protected syntax',()=>{
  for(const raw of ['A ***nested*** Z','A *nested **bold*** Z','- A *[link](x)*','A *soft\nwrap*','- [x] *task*','``*code*``'])assert.equal(projectSource(raw).spans.length,0,raw);
  for(const [s,a,t,f,e] of [['A **bold** Z','italic','bold',0,4],['A *italic* Z','bold','italic',0,6],['A *italic* Z','italic','italic',1,3],['A word Z','italic','A word Z',0,0],['A word Z','italic','A word Z',0,2],['A 😀 Z','italic','A 😀 Z',3,4]])assert.equal(command(s,a,t,f,e).ok,false);
  assert.equal(mapFormatEdit('Text',{action:'italic',from:1,to:5,path:'/tmp/forged'}).ok,false);
  assert.equal(mapTextEdit('A *italic* Z',{from:3,to:9,insert:'**nested**'}).ok,false);
});

test('italic toolbar state and shortcut keep composition and readonly guards',async()=>{
  const {createFormatView}=await import('../lib/document-format-view.mjs');
  const elements=new Map(),calls=[];const byId=id=>{if(!elements.has(id))elements.set(id,{setAttribute(k,v){this[k]=v;}});return elements.get(id);};
  let composing=false,readOnly=false;
  const doc=schema.nodeFromJSON(projectSource('A *word* Z').doc),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,3,7)});
  const controller={format:async c=>{calls.push(c);return true;},state:()=>({locked:false})};
  const editor={state,view:{focus(){}},isActive:m=>m==='italic'};
  const context=()=>({state:{confirmed:{temporary:true,readOnly},composing,recoveryRecords:[]},controller,editor});
  const view=createFormatView({byId,context,report(){}});view.sync();assert.equal(byId('format-italic')['aria-pressed'],'true');assert.equal(byId('format-italic').disabled,false);
  byId('format-italic').onclick();await Promise.resolve();assert.equal(calls.at(-1).action,'italic');
  let prevented=false;const e={key:'i',metaKey:true,preventDefault(){prevented=true;}};
  assert.equal(view.key({state,composing:false},e),true);await Promise.resolve();assert.equal(prevented,true);assert.equal(calls.length,2);
  composing=true;view.sync();assert.equal(byId('format-italic').disabled,true);assert.equal(view.key({state,composing:false},e),false);byId('format-italic').onclick();await Promise.resolve();assert.equal(calls.length,2);
  composing=false;readOnly=true;assert.equal(await view.run('italic'),false);view.sync();assert.equal(byId('format-toolbar').hidden,true);assert.equal(calls.length,2);
});
