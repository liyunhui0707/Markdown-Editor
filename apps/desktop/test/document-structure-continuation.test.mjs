import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema(documentEditorExtensions());
const labels=['[word](target "keep")','**[word](<../a.md> \'title\')**','[**`word`** plain](https://example.invalid "keep")'];
function inverse(r,old){assert(r.ok,JSON.stringify(r));const c=r.inverseSource;assert.equal(r.source.slice(0,c.from)+c.insert+r.source.slice(c.to),old);}
for(const nl of ['\n','\r\n','\r'])test('linked paragraph, heading and list continuation retain native split semantics '+JSON.stringify(nl),()=>{
 for(const raw of labels)for(const prefix of ['','# ','- ','- [x] ']){
  const tail=nl+nl+'```md'+nl+'keep bytes'+nl+'```'+nl,source=prefix+'A '+raw+' Z'+tail,p=projectSource(source),s=p.spans.find(s=>s.text==='word');assert(s);
  const from=s.from+2,action=prefix==='# '?'split-heading':prefix.startsWith('-')?'split-list':'split-paragraph';
  const r=mapFormatEdit(source,{action,from,to:from});inverse(r,source);assert(r.source.endsWith(tail));
  const state=EditorState.create({schema,doc:schema.nodeFromJSON(p.doc)});
  const tr=prefix.startsWith('-')?state.tr.split(from,2):prefix==='# '?state.tr.split(from,1,[{type:schema.nodes.paragraph}]):state.tr.split(from);
  // Splitting a task creates a fresh unchecked item; native split clones attrs.
  if(prefix==='- [x] ')tr.setNodeMarkup(tr.doc.resolve(r.selection.from).before(2),null,{checked:false});
  assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)),JSON.stringify({source,r}));
  assert(r.source.includes('"keep"')||r.source.includes("'title'"));
 }
});
test('different linked list items join without dropping either destination or title',()=>{
 for(const task of ['', '[x] ']){
  const source='- '+task+'[**one**](first "one title")\r\n- '+task+'[`two`](second \'two title\')',p=projectSource(source),row=p.blocks[0].items[1];
  const r=mapFormatEdit(source,{action:'join-list',from:row.from,to:row.from});inverse(r,source);
  assert.equal(r.source,'- '+task+'[**one**](first "one title")[`two`](second \'two title\')');
  const native=EditorState.create({schema,doc:schema.nodeFromJSON(p.doc)}).tr.join(row.from-2,2);
  assert(native.doc.eq(schema.nodeFromJSON(r.projection.doc)));
 }
});
test('rich quote join and first-row unwrap preserve exact link and emphasis source',()=>{
 for(const nl of ['\n','\r\n','\r']){
  const source='> **[one](first "keep")**'+nl+'> '+nl+'> *[`two`](second)*'+nl+nl+'After.',p=projectSource(source),row=p.blocks[0].quoteRows[1];
  const r=mapFormatEdit(source,{action:'join-quote',from:row.from,to:row.from});inverse(r,source);
  assert.equal(r.source,'> **[one](first "keep")***[`two`](second)*'+nl+nl+'After.');
  const native=EditorState.create({schema,doc:schema.nodeFromJSON(p.doc)}).tr.join(row.from-1);
  assert(native.doc.eq(schema.nodeFromJSON(r.projection.doc)));
  const first=p.blocks[0].quoteRows[0],unwrapped=mapFormatEdit(source,{action:'join-quote',from:first.from,to:first.from});inverse(unwrapped,source);
  assert.equal(unwrapped.source,'**[one](first "keep")**'+nl+nl+'> *[`two`](second)*'+nl+nl+'After.');
 }
});
const table='|A|B|\n|---|---|\n|c|d|';
test('table before/after creates one editable prose slot without rewriting table bytes',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const action of ['table-before','table-exit']){
  const source=table.replaceAll('\n',nl),p=projectSource(source),cell=p.blocks[0].cells[0][0];
  const r=mapFormatEdit(source,{action,from:cell.from,to:cell.from});inverse(r,source);
  assert.equal(r.source,action==='table-before'?nl+nl+source:source+nl+nl);
  const doc=schema.nodeFromJSON(r.projection.doc),pos=doc.resolve(r.selection.from);assert.equal(pos.parent.type.name,'paragraph');assert.equal(pos.depth,1);
 }
});
test('table and quote continuation reuses adjacent prose with no text/history patch',()=>{
 for(const block of [table,'> **[word](target "keep")**','```js\nconst x=1\n```']){
  const source='Before.\n\n'+block+'\n\nAfter.',p=projectSource(source),cell=p.blocks[1].cells?.[0][0],from=cell?.from??p.spans.find(s=>s.blockIndex===1).from;
  for(const action of cell?['table-before','table-exit']:['exit-block']){
   const r=mapFormatEdit(source,{action,from,to:from});inverse(r,source);assert.equal(r.source,source);assert.equal(r.change.insert,'');
   assert.equal(r.selection.from,action==='table-before'?p.blocks[0].to-1:p.blocks[2].from+1);
  }
 }
});
test('ambiguous structures, cross selections and malformed commands remain protected',()=>{
 for(const source of ['- [word][ref]\n\n[ref]: target','> [word &amp;](target)','- [**word &amp;**](target)'])
  assert.equal(mapFormatEdit(source,{action:'split-list',from:3,to:3}).ok,false);
 const p=projectSource(table),from=p.blocks[0].cells[0][0].from;
 for(const command of [{action:'table-before',from,to:from+1},{action:'table-before',from,to:from,path:'/tmp/forged'}])assert.equal(mapFormatEdit(table,command).ok,false);
 assert.equal(mapFormatEdit('[word](target)',{action:'split-paragraph',from:3,to:4}).ok,false);
});

test('joins preserve distinct target/title identities and refuse ambiguous equal-mark wrapper normalization',()=>{
 const source='- [one](x "same")\n- [two](<x> \'same\')',p=projectSource(source),row=p.blocks[0].items[1];
 assert.equal(mapFormatEdit(source,{action:'join-list',from:row.from,to:row.from}).ok,false);
 const unicode='> **😀first**\n> \n> [second](target "keep")',q=projectSource(unicode),s=q.spans.find(s=>s.text==='😀first');
 assert.equal(mapFormatEdit(unicode,{action:'split-quote',from:s.from+1,to:s.from+1}).ok,false);
 for(const before of ['![picture](assets/image.png)','<div>protected</div>']){
  const table='|A|\n|---|\n|B|',source=before+'\n\n'+table,p=projectSource(source),cell=p.blocks.at(-1).cells[0][0];
  const r=mapFormatEdit(source,{action:'table-before',from:cell.from,to:cell.from});inverse(r,source);assert.equal(r.source,before+'\n\n\n\n'+table);
 }
});

test('Enter then Backspace rejoins identical link wrappers with exact source round trip',()=>{
 for(const prefix of ['', '# ', '- ', '- [ ] ', '> '])for(const raw of labels){
  const source=prefix+'A '+raw+' Z',p=projectSource(source),s=p.spans.find(s=>s.text==='word');
  const split=prefix==='# '?'split-heading':prefix.startsWith('-')?'split-list':prefix==='> '?'split-quote':'split-paragraph';
  const r=mapFormatEdit(source,{action:split,from:s.from+2,to:s.from+2});inverse(r,source);
  // Heading Enter creates a paragraph; its Backspace conversion differs from a
  // same-kind paragraph/list/quote join and is not included in this inverse pair.
  if(prefix==='# ')continue;
  const action=prefix.startsWith('-')?'join-list':prefix==='> '?'join-quote':'join-paragraph';
  const back=mapFormatEdit(r.source,{action,from:r.selection.from,to:r.selection.from});inverse(back,r.source);assert.equal(back.source,source);
 }
});
