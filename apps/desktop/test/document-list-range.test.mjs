import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
const schema=getSchema([StarterKit.configure({undoRedo:false,trailingNode:false})]);
function check(raw,from,to,insert,expected) {
  const result=mapTextEdit(raw,{from,to,insert});assert.equal(result.ok,true);
  if(expected!==undefined)assert.equal(result.source,expected);
  const doc=schema.nodeFromJSON(projectSource(raw).doc);
  const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
  assert(state.tr.insertText(insert).doc.eq(schema.nodeFromJSON(result.projection.doc)));
  if(result.inverseSource) {
    const u=result.inverseSource;assert.equal(result.source.slice(0,u.from)+u.insert+result.source.slice(u.to),raw);
  }
  return result;
}
for(const marker of ['- ','+ ','* ','3. ','7) '])for(const nl of ['\n','\r\n','\r']) {
  test(`list item range preserves markers and other items ${marker} ${JSON.stringify(nl)}`,()=>{
    const prefix='# Keep'+nl+nl+marker+'Before'+nl+marker,body='Alpha **bold** tail.',suffix=nl+marker+'After'+nl+nl+'```md'+nl+'Keep []'+nl+'```'+nl;
    const raw=prefix+body+suffix,p=projectSource(raw),spans=p.spans.filter(s=>s.itemIndex===1);
    const [a,b,c]=spans;
    for(const [from,to,insert,expected] of [
      [a.from+3,b.from+2,'新😀','Alp新😀**ld** tail.'],
      [b.from+2,c.from+3,'新😀','Alpha **bo新😀**il.'],
      [b.from,b.to,'','Alpha  tail.'],[a.from,c.to,'',''],
      [a.to,a.to,'X','Alpha X**bold** tail.'],[b.to,b.to,'X','Alpha **boldX** tail.'],
    ])check(raw,from,to,insert,prefix+expected+suffix);
    const empty=check(raw,a.from,c.to,'').source,slot=projectSource(empty).spans.find(s=>s.itemIndex===1);
    check(empty,slot.from,slot.to,'Again',prefix+'Again'+suffix);
    const plain=prefix+'Plain'+suffix,row=projectSource(plain).spans.find(s=>s.itemIndex===1);
    check(plain,row.from,row.to,'',prefix+suffix);
    const bold=prefix+'__All__'+suffix,strong=projectSource(bold).spans.find(s=>s.itemIndex===1);
    check(bold,strong.from,strong.to,'',prefix+suffix);
  });
}
test('list range matrix agrees with PM marks and exact inverse including reversed selections',()=>{
  let accepted=0;
  for(const marker of ['**','__'])for(const prefix of ['- ','4) ']) {
    const raw=prefix+`A中😀 ${marker}B文😀${marker} C尾.`+'\n'+prefix+'Keep',p=projectSource(raw);
    const spans=p.spans.filter(s=>s.itemIndex===0),a=spans[0].from,b=spans.at(-1).to;
    for(let from=a;from<=b;from++)for(let to=from;to<=b;to++)for(const insert of ['','新😀']) {
      const r=mapTextEdit(raw,{from,to,insert});if(!r.ok)continue;
      check(raw,from,to,insert);assert(r.source.endsWith('\n'+prefix+'Keep'));
      const doc=schema.nodeFromJSON(p.doc),reverse=EditorState.create({schema,doc,selection:TextSelection.create(doc,to,from)});
      assert(reverse.tr.insertText(insert).doc.eq(schema.nodeFromJSON(r.projection.doc)));
      if(r.inverseSource)accepted++;
    }
  }
  assert(accepted>100);
});
test('list ranges refuse cross-block, multiline, protected syntax and excessive input atomically',()=>{
  const raw='- A **bold** tail\n- Next\n\nEnd',p=projectSource(raw),a=p.spans.find(s=>s.text==='A '),b=p.spans.find(s=>s.text==='Next');
  check(raw,a.from,b.to,'X','- X\n\nEnd');
  assert.equal(mapTextEdit(raw,{from:a.from,to:p.spans.at(-1).to,insert:'X'}).ok,false);
  for(const insert of ['One\nTwo','One\n\nTwo','\ud800','[x](url)','**new**','x'.repeat(4097)])
    assert.equal(mapTextEdit(raw,{from:a.from,to:a.to+2,insert}).ok,false);
  for(const source of ['- [x] Task\n  continuation','- A\n  - Nested\n    continuation','- A\n\n- Loose','- A ***nested***','- A [**link**](x)','- A\n  soft'])
    assert.equal(mapTextEdit(source,{from:3,to:4,insert:'X'}).ok,false,source);
  const pair='- A **😀bold** tail',point=projectSource(pair).spans.find(s=>s.bold).from;
  assert.equal(mapTextEdit(pair,{from:3,to:point+1,insert:'X'}).ok,false);
  const huge='- '+'A'.repeat(4100)+' **bold**',sp=projectSource(huge).spans;
  assert.equal(mapTextEdit(huge,{from:sp[0].from,to:sp[1].to,insert:'X'}).ok,false);
  assert.equal(mapTextEdit(raw,{from:a.from,to:a.to+2,insert:'X',itemIndex:0}).ok,false);
  check(raw,a.from,a.to+2,'X'); // Refusal must not poison the next safe operation.
});

test('list underscore delimiters retain their spelling when valid and refuse intraword ambiguity',()=>{
  const raw='- Alpha __bold__ tail',sp=projectSource(raw).spans;
  check(raw,sp[0].from,sp[1].from+2,'New ','- New __ld__ tail');
  assert.equal(mapTextEdit(raw,{from:sp[0].from+3,to:sp[1].from+2,insert:'X'}).ok,false);
});
