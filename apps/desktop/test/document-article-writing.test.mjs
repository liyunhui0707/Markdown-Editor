import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {planDocumentReplace} from '../lib/document-replace.mjs';
const schema=getSchema(documentEditorExtensions());
test('formatted multiline articles project real text, soft spaces and hard breaks without changing source',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const source of ['First *bold'+nl+'second* tail.', 'First **bold'+nl+'second** tail.', 'First *emphasis*'+nl+'second `code` and [label](https://example.invalid "keep").','First **bold**  '+nl+'second *tail*.','First **bold**\\'+nl+'second.']){
  const p=projectSource(source),doc=schema.nodeFromJSON(p.doc);doc.check();assert.equal(doc.firstChild.type.name,'paragraph',source);assert(p.blocks[0].article);assert(!p.doc.content.some(n=>n.type==='codeBlock'));
  const s=p.spans.find(s=>s.text.includes('second'));assert(s);const edit=mapTextEdit(source,{from:s.from+1,to:s.from+2,insert:'中文😀'});assert(edit.ok,source);assert.equal(edit.source,source.replace('second','s中文😀cond'));
 }
});
test('article selected replacement crosses marks, soft and hard breaks with native PM equivalence and exact inverse',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const separator of [nl,'  '+nl,'\\'+nl]){
  const source='Before **bold**'+separator+'second *tail*.'+nl+nl+'Outside.';const p=projectSource(source),a=p.spans.find(s=>s.text==='bold'),b=p.spans.find(s=>s.text.startsWith('second'));
  assert(a&&b);const change={from:a.from+1,to:b.from+3,insert:'替换'},edit=mapTextEdit(source,change);assert(edit.ok,JSON.stringify({source,edit}));
  const doc=schema.nodeFromJSON(p.doc),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,change.from,change.to)});assert(state.tr.insertText(change.insert).doc.eq(schema.nodeFromJSON(edit.projection.doc)));
  assert.equal(edit.source.slice(0,edit.inverseSource.from)+edit.inverseSource.insert+edit.source.slice(edit.inverseSource.to),source);assert(edit.source.endsWith(nl+nl+'Outside.'));
 }
});
test('article find replacement and paragraph continuation retain marks, hard breaks and exact untouched bytes',()=>{
 const source='First **bold**\r\nsecond *tail*.\r\n\r\nOutside.';const p=projectSource(source),doc=schema.nodeFromJSON(p.doc),s=p.spans.find(s=>s.text.startsWith('second'));
 const r=planDocumentReplace(source,doc,[{from:s.from,to:s.from+6}],'下一行');assert(r.ok);assert.equal(r.source,source.replace('second','下一行'));
 const split=mapFormatEdit(source,{action:'split-paragraph',from:s.from+3,to:s.from+3});assert(split.ok);assert.equal(split.source,'First **bold**\r\nsec\r\n\r\nond *tail*.\r\n\r\nOutside.');
});
test('article projection refuses references, escaped normalization, inline HTML and ambiguous source changes',()=>{
 for(const source of ['**bold**\n[ref][id]\n\n[id]: https://example.invalid','**bold**\n<span>html</span>','**bold**\nline \\*escaped\\*'])assert(!projectSource(source).blocks[0]?.article,source);
 const source='**bold**\nplain tail',p=projectSource(source),s=p.spans.find(s=>s.text.includes('plain'));assert(s);assert.equal(mapTextEdit(source,{from:s.from,to:s.from+1,insert:'\ud800'}).ok,false);
});

test('article emphasis commands preserve physical soft lines and exact inverses',()=>{
 for(const action of ['bold','italic']){const source='First **bold**\r\nsecond tail',p=projectSource(source),s=p.spans.find(s=>s.text.startsWith('second')),r=mapFormatEdit(source,{action,from:s.from,to:s.from+6});assert(r.ok);assert.equal(r.source,source.replace('second',action==='bold'?'**second**':'*second*'));const inv=r.inverseSource;assert.equal(r.source.slice(0,inv.from)+inv.insert+r.source.slice(inv.to),source);}
});

test('article edit differential matrix agrees with native PM selection semantics and exact source inverses',()=>{
 let accepted=0;
 for(const source of ['Before **bold\nsecond** and *tail*.','Plain **bold**  \nnext `code` text.','***both***\r\nplain [link](https://example.invalid "keep") end.']){
  const p=projectSource(source),doc=schema.nodeFromJSON(p.doc),end=p.blocks[0].to-1;
  for(let from=1;from<end;from+=3)for(let to=from;to<=Math.min(end,from+14);to+=2){
   const r=mapTextEdit(source,{from,to,insert:'新'});if(!r.ok)continue;accepted++;const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});assert(state.tr.insertText('新').doc.eq(schema.nodeFromJSON(r.projection.doc)),JSON.stringify({source,from,to,result:r.source}));
   const inv=r.inverseSource;assert.equal(r.source.slice(0,inv.from)+inv.insert+r.source.slice(inv.to),source);
  }
 }
 assert(accepted>100);
});

test('article prose accepts a word-separating trailing Space before the next word',()=>{
 const source='First **bold**\r\nlast.',p=projectSource(source),from=p.blocks[0].to-1,space=mapTextEdit(source,{from,to:from,insert:' '});assert(space.ok);assert.equal(space.source,source+' ');assert(space.projection.blocks[0].article);
 const pos=space.projection.blocks[0].to-1,next=mapTextEdit(space.source,{from:pos,to:pos,insert:'More words'});assert(next.ok);assert.equal(next.source,source+' More words');
 for(const trailing of ['First **bold**\nplain ','First **bold**\nlast **word** ']){assert(projectSource(trailing).blocks[0].article);}
});
