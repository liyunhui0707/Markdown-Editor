import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema(documentEditorExtensions());
const values=['价格 $100','集合 {a, b}','a | b','a < b > c','C:\\Users\\name','unmatched `tick','Emoji 😀 $20'];
const contexts=[['paragraph',s=>s],['heading',s=>'## '+s],['bold',s=>'Before **'+s+'** end.'],['italic',s=>'Before *'+s+'* end.'],['list',s=>'- '+s],['quote',s=>'> '+s],['link',s=>'['+s+'](https://example.invalid "keep")'],['soft',s=>'First\r\n'+s],['article',s=>'First **bold**  \r\n'+s]];
for(const [name,wrap] of contexts)test('literal prose stays editable in '+name,()=>{
 for(const value of values){const source=wrap(value),p=projectSource(source),span=p.spans.find(s=>s.text.includes(value));assert(span,source);assert.notEqual(p.doc.content[0].type,'codeBlock',source);schema.nodeFromJSON(p.doc).check();
  const from=span.from+span.text.indexOf(value),r=mapTextEdit(source,{from,to:from+value.length,insert:'中文 $200 {done} | a < b'});assert(r.ok,JSON.stringify({source,r}));assert.equal(r.source,source.replace(value,'中文 $200 {done} | a < b'));const state=EditorState.create({schema,doc:schema.nodeFromJSON(p.doc)});assert(state.tr.insertText('中文 $200 {done} | a < b',from,from+value.length).doc.eq(schema.nodeFromJSON(r.projection.doc)));
 }
});
test('literal punctuation typing follows native PM semantics without creating Markdown structures',()=>{
 for(const insert of ['$','{','}','|','<','>','\\','`',' {"key": "$20"} ','路径 C:\\Users\\name']){const source='Plain text.',p=projectSource(source),from=6,r=mapTextEdit(source,{from,to:from,insert});assert(r.ok,JSON.stringify({insert,r}));assert.equal(r.source,'Plain'+insert+' text.');assert(EditorState.create({schema,doc:schema.nodeFromJSON(p.doc)}).tr.insertText(insert,from).doc.eq(schema.nodeFromJSON(r.projection.doc)));}
});
test('literal cross-mark/soft-line selections retain native semantics and exact untouched/inverse bytes',()=>{
 let accepted=0;
 for(const nl of ['\n','\r\n','\r'])for(const text of ['Price $100 **bold {name}** and a | b.','First $100'+nl+'next {value} | a < b.','First **$100**  '+nl+'next {value} | a < b.']){
  const source=text+nl+nl+'```js'+nl+'keep <html> {json}'+nl+'```'+nl,p=projectSource(source),end=p.blocks[0]?.to-1,doc=schema.nodeFromJSON(p.doc);assert(end);
  for(let from=1;from<end;from+=4)for(let to=from;to<=Math.min(end,from+10);to+=3){const insert='$新 {x}',r=mapTextEdit(source,{from,to,insert});if(!r.ok)continue;accepted++;const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});assert(state.tr.insertText(insert).doc.eq(schema.nodeFromJSON(r.projection.doc)));assert(r.source.endsWith(nl+nl+'```js'+nl+'keep <html> {json}'+nl+'```'+nl));if(r.inverseSource){const v=r.inverseSource;assert.equal(r.source.slice(0,v.from)+v.insert+r.source.slice(v.to),source);}}
 }assert(accepted>100);
});
test('literal punctuation can be formatted and unformatted with exact history patches',()=>{
 const source='Price $100 {name} | a < b.',p=projectSource(source),s=p.spans[0],from=s.from+6,to=from+4;for(const action of ['bold','italic']){const r=mapFormatEdit(source,{action,from,to});assert(r.ok);assert(r.source.includes(action==='bold'?'**$100**':'*$100*'));const inv=r.inverseSource;assert.equal(r.source.slice(0,inv.from)+inv.insert+r.source.slice(inv.to),source);}
});
test('literal support keeps decoded text, HTML, references and newly introduced structure protected',()=>{
 for(const source of ['a &amp; b','a\\*b','<script>x</script>','a <span>x</span>','[ref][id]\n\n[id]: https://example.invalid'])assert.equal(projectSource(source).spans.length,0,source);
 for(const insert of ['<span>x</span>','&amp;','\\*','**bold**','[x](https://example.invalid)','x\nnext','\ud800'])assert.equal(mapTextEdit('Plain text.',{from:6,to:6,insert}).ok,false,insert);
});
