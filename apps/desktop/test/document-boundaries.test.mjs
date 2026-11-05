import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFormatEdit } from '../lib/document-format-edit.mjs';
import { projectSource } from '../lib/document-source-map.mjs';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { splitBlock } from '@tiptap/pm/commands';
import { splitListItem } from '@tiptap/pm/schema-list';
import { createFormatView } from '../lib/document-format-view.mjs';
const schema=getSchema([StarterKit.configure({undoRedo:false,trailingNode:false})]);

function command(source, action, text, offset=0, occurrence=0) {
  const span=projectSource(source).spans.filter(s=>s.text===text)[occurrence];
  assert(span, JSON.stringify({source,text}));
  return mapFormatEdit(source,{action,from:span.from+offset,to:span.from+offset});
}
function check(result, source, expected) {
  assert.equal(result.ok,true);assert.equal(result.source,expected);
  const c=result.inverseSource;
  assert.equal(result.source.slice(0,c.from)+c.insert+result.source.slice(c.to),source);
  assert.deepEqual(projectSource(result.source).doc,result.projection.doc);
  assert(result.projection.spans.some(s=>result.selection.from>=s.from&&result.selection.to<=s.to));
}
for(const nl of ['\n','\r\n','\r']) for(const marker of ['**','__']) {
  test(`boundaries split/join mixed paragraph preserves source ${JSON.stringify(nl)} ${marker}`,()=>{
    const prefix='# Keep'+nl+nl,body=`A ${marker}中文😀bold${marker} Z`,suffix=nl+nl+'```md'+nl+'keep []'+nl+'```'+nl;
    const source=prefix+body+suffix;
    const split=command(source,'split-paragraph','中文😀bold',2);
    const expected=prefix+`A ${marker}中文${marker}`+nl+nl+`${marker}😀bold${marker} Z`+suffix;
    check(split,source,expected);
    const join=command(expected,'join-paragraph','😀bold');check(join,expected,source);
    assert.equal(join.selection.from,projectSource(source).spans.find(s=>s.bold).from+2);
  });
}
for(const marker of ['- ','+ ','* ','3. ','3) ']) test(`boundaries mixed list split/join and first-item exit ${marker}`,()=>{
  const source=marker+'A **bold** Z\r\n'+marker+'Next\r\n\r\nTail.\r\n';
  const nextMarker=/\d/.test(marker)?'4'+marker.trim().at(-1)+' ':marker;
  const expected=marker+'A **bo**\r\n'+nextMarker+'**ld** Z\r\n'+marker+'Next\r\n\r\nTail.\r\n';
  check(command(source,'split-list','bold',2),source,expected);
  check(command(expected,'join-list','ld'),expected,source);
  check(command(source,'join-list','A '),source,'A **bold** Z\r\n\r\n'+marker+'Next\r\n\r\nTail.\r\n');
});
test('boundaries enter a list from an empty paragraph and exit first/last empty items',()=>{
  for(const [source,action,text,expected] of [
    ['', 'bullet-list','','- '], ['', 'ordered-list','','1. '],
    ['- ', 'split-list','',''], ['- \n- B','split-list','','\n\n- B'],
    ['- A\n- ','split-list','','- A\n\n'],
    ['3) \n7) B','split-list','','\n\n7) B'],
    ['Before\n\n- \n- B','split-list','','Before\n\n\n\n- B'],
  ]) check(command(source,action,text),source,expected);
});
test('boundaries refuse ambiguous/unsupported structure, selections, surrogate cuts and injected fields',()=>{
  for(const source of ['A *italic* Z','A [link](x) Z','A\nsoft','- A\n  - nested','- [x] task']) {
    assert.equal(mapFormatEdit(source,{action:'split-paragraph',from:2,to:2}).ok,false,source);
  }
  assert.equal(command('- A\n- \n- B','split-list','').ok,false); // A blank paragraph cannot separate same-kind lists in Markdown.
  assert.equal(command('A **😀B** Z','split-paragraph','😀B',1).ok,false);
  assert.equal(command('A\n\n# Title','join-paragraph','Title').ok,false);
  assert.equal(command('A **B**\n\n\nC','join-paragraph','C').ok,false);
  assert.equal(mapFormatEdit('A **bold** Z',{action:'split-paragraph',from:1,to:3}).ok,false);
  assert.equal(mapFormatEdit('A **bold** Z',{action:'join-paragraph',from:1,to:1,path:'/tmp/x'}).ok,false);
});

test('boundaries refuse item/source/patch overflow without truncating content',()=>{
  const full=Array.from({length:32},(_,i)=>'- Row'+i).join('\n');
  assert.equal(command(full,'split-list','Row0',2).ok,false);
  const large='**A**\n\n__'+'B'.repeat(4100)+'__';
  assert.equal(command(large,'join-paragraph','B'.repeat(4100)).ok,false);
  const exact='A'.repeat(131064)+' **B**';
  assert.equal(command(exact,'split-paragraph','B',1).source.length,131072);
  const maximum='A'.repeat(131066)+' **B**';
  assert.equal(command(maximum,'split-paragraph','B',1).ok,false);
});

test('boundary matrix agrees with actual PM splitting and exact inverse bytes',()=>{
  let accepted=0;
  for(const marker of ['**','__'])for(const nl of ['\n','\r\n','\r'])for(const prefix of ['','- ','5) ']) {
    const source='# Keep'+nl+nl+prefix+`A ${marker}中文😀B${marker} C`+nl+nl+'```md'+nl+'KEEP'+nl+'```'+nl;
    const p=projectSource(source),spans=p.spans.filter(s=>s.blockIndex===1);
    const doc=schema.nodeFromJSON(p.doc);
    for(let at=spans[0].from;at<=spans.at(-1).to;at++) {
      const result=mapFormatEdit(source,{action:prefix?'split-list':'split-paragraph',from:at,to:at});
      if(!result.ok)continue;
      const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,at)});
      let actual;const split=prefix?splitListItem(schema.nodes.listItem):splitBlock;
      assert.equal(split(state,tr=>actual=tr.doc),true);assert(actual.eq(schema.nodeFromJSON(result.projection.doc)));
      check(result,source,result.source);assert(result.source.startsWith('# Keep'+nl+nl));
      assert(result.source.endsWith(nl+nl+'```md'+nl+'KEEP'+nl+'```'+nl));accepted++;
    }
  }
  assert(accepted>100);
});

test('boundary key routing respects marks, selections and composition without taking over plain paragraph keys',async()=>{
  const elements=new Map(),calls=[];
  const byId=id=>{if(!elements.has(id))elements.set(id,{setAttribute(){}});return elements.get(id);};
  let state,composing=false;
  const context=()=>({state:{confirmed:{temporary:true,canUndo:false},composing,recoveryRecords:[]},
    controller:{format:async cmd=>{calls.push(cmd);return true;}},
    editor:{state,view:{focus(){}},isActive:()=>false}});
  const view=createFormatView({byId,context,report(){}});
  function key(source,text,offset,key,extra={}) {
    const p=projectSource(source),doc=schema.nodeFromJSON(p.doc),span=p.spans.find(s=>s.text===text),at=span.from+offset;
    state=EditorState.create({schema,doc,selection:TextSelection.create(doc,at)});
    return view.key({state,composing:false},{key,preventDefault(){},...extra});
  }
  assert.equal(key('A **bold** Z','bold',2,'Enter'),true);await Promise.resolve();assert.equal(calls.at(-1).action,'split-paragraph');
  assert.equal(key('A **bold**\n\nTail','Tail',0,'Backspace'),true);await Promise.resolve();assert.equal(calls.at(-1).action,'join-paragraph');
  assert.equal(key('- A **bold**','A ',0,'Backspace'),true);await Promise.resolve();assert.equal(calls.at(-1).action,'join-list');
  for(const extra of [{isComposing:true},{keyCode:229},{shiftKey:true},{altKey:true}]) assert.equal(key('A **bold** Z','bold',2,'Enter',extra),false);
  composing=true;assert.equal(key('A **bold** Z','bold',2,'Enter'),false);composing=false;
  assert.equal(key('Plain','Plain',2,'Enter'),false);
  assert.equal(key('**First**','First',0,'Backspace'),false);
  assert.equal(calls.length,3);
});
