import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {Slice,Fragment} from '@tiptap/pm/model';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema(documentEditorExtensions());
const paragraph=text=>schema.nodes.paragraph.create(null,schema.text(text));
test('heading/prose selections and multiline paste preserve the first block type with exact history',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const body of ['# Title **bold**'+nl+nl+'Last *word*',
  'First plain'+nl+nl+'## Other title', '# First'+nl+nl+'Middle'+nl+nl+'### Last']){
  const source='Before'+nl+nl+body+nl+nl+'After',p=projectSource(source),a=p.blocks[1],b=p.blocks.at(-2);
  for(const insert of ['', '新😀','One\n\nTwo']){
   const from=a.from+3,to=b.to-2,r=mapTextEdit(source,{from,to,insert});inverse(r,source);
   assert(native(source,from,to,insert).doc.eq(schema.nodeFromJSON(r.projection.doc)),r.source);
   assert(r.source.startsWith('Before'+nl+nl));assert(r.source.endsWith(nl+nl+'After'));
  }
 }
});
function inverse(r,source){assert(r.ok,JSON.stringify(r));const x=r.inverseSource;assert(x);assert.equal(r.source.slice(0,x.from)+x.insert+r.source.slice(x.to),source);}
function native(source,from,to,insert){const p=projectSource(source),doc=schema.nodeFromJSON(p.doc),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
 return insert.includes('\n')?state.tr.replaceSelection(new Slice(Fragment.fromArray(insert.split('\n\n').map(paragraph)),1,1)):state.tr.insertText(insert);
}
for(const nl of ['\n','\r\n','\r'])test('formatted prose cross-paragraph replacement, deletion and paste retain lexical neighbors '+JSON.stringify(nl),()=>{
 const source='# Keep'+nl+nl+'Before **bold** tail'+nl+nl+'Middle *italic*'+nl+nl+'Last [link](../guide.md \'keep title\') end'+nl+nl+'| A | B |'+nl+'| --- | --- |'+nl+'| C | D |'+nl;
 const p=projectSource(source),a=p.spans.find(s=>s.bold),b=p.spans.find(s=>s.link);
 for(const insert of ['新😀','','One\n\nTwo']){const from=a.from+1,to=b.from+2,r=mapTextEdit(source,{from,to,insert});inverse(r,source);
  assert(native(source,from,to,insert).doc.eq(schema.nodeFromJSON(r.projection.doc)));
  assert(r.source.startsWith('# Keep'+nl+nl+'Before **b'));assert(r.source.endsWith('nk](../guide.md \'keep title\') end'+nl+nl+'| A | B |'+nl+'| --- | --- |'+nl+'| C | D |'+nl));
  assert.deepEqual(r.selection,{from:from+insert.length,to:from+insert.length});
 }
});
test('multiline plain paste in formatted prose clears pasted marks while retaining both surviving sides',()=>{
 for(const source of ['Before **bold** tail','[**word** plain](target "keep") end','First **bold**  \nsecond *tail*','First **bold**\r\nsecond *tail*']){
  const p=projectSource(source),s=p.spans.find(s=>s.bold),from=s.from+1,r=mapTextEdit(source,{from,to:from,insert:'One\n\nTwo'});inverse(r,source);
  assert(native(source,from,from,'One\n\nTwo').doc.eq(schema.nodeFromJSON(r.projection.doc))),r.source;
 }
});
test('soft and hard article breaks survive outside cross-paragraph selections and Backspace joins',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const gap of [nl,'  '+nl,'\\'+nl]){
  const source='First **bold**'+gap+'next tail'+nl+nl+'Other [link](target "keep")'+gap+'last *italic*',p=projectSource(source),left=p.blocks[0],right=p.blocks[1];
  const from=left.to-1,to=right.from+1,r=mapTextEdit(source,{from,to,insert:''});inverse(r,source);assert(native(source,from,to,'').doc.eq(schema.nodeFromJSON(r.projection.doc)));
  assert.equal(r.source,source.replace('tail'+nl+nl+'Other','tailOther'));
  const join=mapFormatEdit(source,{action:'join-paragraph',from:to,to});inverse(join,source);assert.equal(join.source,r.source);
 }
});
test('prose range matrix agrees with native PM and exact source inverse including marks/emoji boundaries',()=>{
 let accepted=0;
 for(const source of ['A **bold** Z\n\nB *italic* C','[**word** plain](target "title") tail\n\nOther `code` end','First **bold**\nsecond tail\n\nOther *word*  \nlast','soft\nwrapped\n\nOther **word**']){
  const p=projectSource(source),a=p.blocks[0],b=p.blocks[1];
  for(let from=a.from+1;from<a.to;from+=3)for(let to=b.from+1;to<b.to;to+=3)for(const insert of ['', '新😀','One\n\nTwo']){
   const r=mapTextEdit(source,{from,to,insert});if(!r.ok)continue;accepted++;inverse(r,source);assert(native(source,from,to,insert).doc.eq(schema.nodeFromJSON(r.projection.doc)),JSON.stringify({source,from,to,insert,result:r.source}));
  }
 }
 assert(accepted>150,accepted);
});
test('prose range retains protected blocks, ambiguous gaps, Unicode, paragraph and source budgets',()=>{
 for(const middle of ['- list','> quote','```js\ncode\n```','![image](asset.png)','<b>html</b>']){
  const source='First **bold**\n\n'+middle+'\n\nLast *italic*',p=projectSource(source);assert.equal(mapTextEdit(source,{from:p.blocks[0].from+2,to:p.blocks.at(-1).to-2,insert:'No'}).ok,false,middle);
 }
 for(const source of ['First **bold**\n \nLast *italic*','First **bold**\n\n\nLast *italic*',Array(33).fill('**word**').join('\n\n'),'**'+ 'x'.repeat(4100)+'**\n\nLast *word*']){
  const p=projectSource(source);assert.equal(mapTextEdit(source,{from:p.blocks[0].from+1,to:p.blocks.at(-1).to-1,insert:'No'}).ok,false);
 }
 const source='😀 **word**\n\nLast *word*',p=projectSource(source),a=p.blocks[0],b=p.blocks[1];
 for(const insert of ['\ud800','a\tb','One\nTwo','\n\nOne','One\n\n','x'.repeat(4097),'# Heading'])assert.equal(mapTextEdit(source,{from:a.from+1,to:b.to-1,insert}).ok,false,JSON.stringify(insert.slice(0,20)));
 assert.equal(mapTextEdit(source,{from:a.from+2,to:b.to-1,insert:'x'}).ok,false);
});
test('paragraph joins preserve unrelated delimiter spelling and distinguish lexical link destinations',()=>{
 for(const source of ['A **one**__two__ tail\n\nOther *three*','**first**\n\n__second__','[**first**](target "keep")\n\n[second](target "keep")','[first](target "one")\n\n[second](other "two")']){
  const p=projectSource(source),from=p.blocks[0].to-1,to=p.blocks[1].from+1,r=mapTextEdit(source,{from,to,insert:''});inverse(r,source);assert(native(source,from,to,'').doc.eq(schema.nodeFromJSON(r.projection.doc)));
  if(source.startsWith('A '))assert.equal(r.source,source.replace('tail\n\nOther','tailOther'));
  if(source.startsWith('[first]'))assert.equal(r.source,source.replace('\n\n',''));
 }
});
