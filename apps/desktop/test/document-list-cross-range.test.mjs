import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
const schema=getSchema([StarterKit.configure({undoRedo:false,trailingNode:false})]);
function check(raw,from,to,insert,expected) {
  const r=mapTextEdit(raw,{from,to,insert});assert.equal(r.ok,true,JSON.stringify({from,to,insert}));
  assert.equal(r.source,expected);
  const doc=schema.nodeFromJSON(projectSource(raw).doc);
  for(const reverse of [false,true]) {
    const s=EditorState.create({schema,doc,selection:TextSelection.create(doc,reverse?to:from,reverse?from:to)});
    const tr=insert?s.tr.insertText(insert):s.tr.delete(from,to);
    assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));
    assert.equal(tr.selection.from,r.selection.from);assert.equal(tr.selection.to,r.selection.to);
  }
  const u=r.inverseSource;assert(u);assert.equal(r.source.slice(0,u.from)+u.insert+r.source.slice(u.to),raw);
  return r;
}
for(const marker of ['- ','+ ','* ','3. ','7) '])for(const nl of ['\n','\r\n','\r'])test(`cross-list range exact marker/format/neighbor preservation ${marker} ${JSON.stringify(nl)}`,()=>{
  const head='# Keep'+nl+nl+marker,tail=nl+marker+'Untouched'+nl+nl+'```md'+nl+'Keep []'+nl+'```';
  const raw=head+'Alpha **bold** tail'+nl+marker+'Middle'+nl+marker+'End **strong** finish'+tail;
  const p=projectSource(raw),sp=p.spans,first=sp.find(s=>s.text==='Alpha '),bold=sp.find(s=>s.text==='bold'),last=sp.find(s=>s.text==='strong'),end=sp.find(s=>s.text===' finish');
  check(raw,first.from+3,last.from+2,'新😀',head+'Alp新😀**rong** finish'+tail);
  check(raw,bold.from+2,end.from+3,'新😀',head+'Alpha **bo新😀**nish'+tail);
  check(raw,first.from,end.to,'',head+tail);
  check(raw,bold.from+2,last.from+2,'',head+'Alpha **borong** finish'+tail);
  const left=p.blocks.find(b=>b?.items).items[0],right=p.blocks.find(b=>b?.items).items[1];
  check(raw,left.to,right.from,'',raw.replace(' tail'+nl+marker+'Middle',' tailMiddle'));
});
test('cross-list empty edges and whole-list deletion keep one editable item',()=>{
  for(const bodies of [['A','B'],['**Bold**','__Last__'],['','B'],['A',''],['','','']]) {
    const raw=bodies.map(s=>'- '+s).join('\n'),p=projectSource(raw),rows=p.blocks[0].items;
    const r=check(raw,rows[0].from,rows.at(-1).to,'','- '),slot=r.projection.spans[0];
    assert.equal(mapTextEdit(r.source,{from:slot.from,to:slot.to,insert:'Again'}).source,'- Again');
  }
});
test('cross-list numbering is not normalized and 32 items are bounded',()=>{
  const raw='9) First\r\n12) Middle\r\n3) Last\r\n71) Keep',p=projectSource(raw),rows=p.blocks[0].items;
  check(raw,rows[0].from+2,rows[2].from+2,'X','9) FiXst\r\n71) Keep');
  const source=Array.from({length:32},(_,i)=>`${i+1}. Text`).join('\n'),all=projectSource(source).blocks[0].items;
  check(source,all[0].from,all.at(-1).to,'One','1. One');
  const tooMany=source+'\n33. Extra';assert.equal(projectSource(tooMany).blocks[0],null);
});
test('cross-list refusals: different lists, unsupported items, multiline, source size and forged fields',()=>{
  for(const raw of ['- First\n\n1. Last','- First\n\n# Heading\n\n- Last','- First\n- [x] Task\n  continuation\n- Last','- First\n  - Nested\n- Last','- First\n\n- Last','- First\n- ***nested***\n- Last']) {
    const p=projectSource(raw),a=p.spans[0],b=p.spans.at(-1);
    assert.equal(mapTextEdit(raw,{from:a?.from??3,to:b?.to??20,insert:'X'}).ok,false,raw);
  }
  const raw='- A中😀 **bold**\n- End',p=projectSource(raw),[left,right]=p.blocks[0].items;
  const change={from:left.from+1,to:right.to,insert:'X'};
  for(const insert of ['One\nTwo','One\n\nTwo','\ud800','[link](x)','**bold**','x'.repeat(4097)])assert.equal(mapTextEdit(raw,{...change,insert}).ok,false);
  assert.equal(mapTextEdit(raw,{...change,from:left.from+3}).ok,false);
  for(const extra of [{itemIndex:0},{inverseSource:{}},{path:'/other.md'},{leaf:null}])assert.equal(mapTextEdit(raw,{...change,...extra}).ok,false);
  const huge='- '+'A'.repeat(4096)+'\n- B',rows=projectSource(huge).blocks[0].items;
  assert.equal(mapTextEdit(huge,{from:rows[0].from,to:rows[1].to,insert:'X'}).ok,false);
  // Refusal cannot leave state behind: the next supported edit still succeeds.
  check(raw,left.from,right.to,'Safe','- Safe');
});
test('cross-list full offset matrix agrees with real PM for plain/bold/Unicode and exact inverse',()=>{
  let accepted=0;
  for(const raw of ['- A中😀 **B文** C\n- Middle\n- D **E😀** F','4) __AB__\n5) CD **EF**','- \n- B']) {
    const p=projectSource(raw),rows=p.blocks[0].items,a=rows[0],b=rows.at(-1);
    for(let from=a.from;from<=a.to;from++)for(let to=b.from;to<=b.to;to++)for(const insert of ['','新😀']) {
      const r=mapTextEdit(raw,{from,to,insert});if(!r.ok)continue;
      check(raw,from,to,insert,r.source);accepted++;
    }
  }
  assert(accepted>100,accepted);
});

test('cross-list plain positions accept every valid partial selection',()=>{
  const raw='- ABC\n- Middle\n- DEF',rows=projectSource(raw).blocks[0].items;
  for(let a=0;a<=3;a++)for(let b=0;b<=3;b++)for(const insert of ['','X'])
    check(raw,rows[0].from+a,rows[2].from+b,insert,'- '+'ABC'.slice(0,a)+insert+'DEF'.slice(b));
});
