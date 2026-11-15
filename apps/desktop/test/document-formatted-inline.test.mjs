import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {linkSelection} from '../lib/document-link-edit.mjs';
const schema=getSchema(documentEditorExtensions());
const samples=[
 '**`code`**','*`code`*','***`both`***',
 '**[label](https://old.invalid "keep")**','*[label](../docs/a.md#part "keep")*',
 '[**bold** plain *tail*](https://old.invalid "keep")',
 '[`code`](https://old.invalid "keep")','[**`code`** plain](https://old.invalid "keep")',
];
const contexts=[
 ['paragraph',s=>'A '+s+' Z'],['heading',s=>'## A '+s+' Z'],
 ['list',s=>'- A '+s+' Z'],['task',s=>'- [ ] A '+s+' Z'],
 ['quote',s=>'> A '+s+' Z'],['article',s=>'First **line**\r\nA '+s+' Z'],
];
function undo(r,source){
 const x=r.inverseSource;assert(x);
 assert.equal(r.source.slice(0,x.from)+x.insert+r.source.slice(x.to),source);
}
function equalNative(source,change){
 const p=projectSource(source),doc=schema.nodeFromJSON(p.doc);
 const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,change.from,change.to)});
 const result=mapTextEdit(source,change);assert(result.ok,JSON.stringify({source,change,result}));
 assert(state.tr.insertText(change.insert).doc.eq(schema.nodeFromJSON(result.projection.doc)));
 return result;
}
test('Document code marks coexist with source-proven emphasis and links in canonical order',()=>{
 assert.equal(schema.marks.code.spec.excludes,'');
 assert.deepEqual(['link','bold','code','italic'].map(n=>schema.marks[n].rank),[0,1,2,3]);
 let marks=[];
 for(const name of ['italic','bold','link','code'])
  marks=schema.marks[name].create(name==='link'?{href:'https://example.invalid',title:null}:undefined).addToSet(marks);
 assert.deepEqual(marks.map(m=>m.type.name),['link','bold','code','italic']);
});
for(const [name,wrap] of contexts)test('source-proven combinations remain editable in '+name,()=>{
 for(const value of samples){
  const source=wrap(value),p=projectSource(source);assert(p.spans.length,source);
  assert.notEqual(p.doc.content[0].type,'codeBlock',source);
  const doc=schema.nodeFromJSON(p.doc);doc.check();
  for(const s of p.spans){
   assert.equal(doc.textBetween(s.from,s.to),s.text);
   assert.deepEqual(doc.nodeAt(s.from).marks.map(m=>m.type.name),['link','bold','code','italic'].filter(k=>s[k]));
  }
  for(const s of p.spans.filter(s=>s.code||s.link)){
   const from=s.from+Math.min(1,s.text.length),r=equalNative(source,{from,to:from,insert:'新'});
   assert.equal(r.source,source.slice(0,s.sourceFrom+from-s.from)+'新'+source.slice(s.sourceFrom+from-s.from));
  }
 }
});
test('cross-frame edits agree with native PM and retain exact source inverses',()=>{
 let accepted=0;
 for(const value of samples){
  const suffix='\r\n\r\n```js\r\nkeep bytes\r\n```\r\n';
  const source='Before '+value+' tail.'+suffix,p=projectSource(source),doc=schema.nodeFromJSON(p.doc),end=p.blocks[0]?.to-1;
  assert(end,source);
  for(let from=1;from<end;from++)for(let to=from+1;to<=Math.min(end,from+10);to++){
   const r=mapTextEdit(source,{from,to,insert:'新'});if(!r.ok)continue;accepted++;
   const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
   assert(state.tr.insertText('新').doc.eq(schema.nodeFromJSON(r.projection.doc)),JSON.stringify({source,from,to}));
   if(r.inverseSource)undo(r,source);assert(r.source.endsWith(suffix));
  }
 }
 assert(accepted>150);
});
test('emphasis and code commands preserve other marks in every supported textblock',()=>{
 for(const [,wrap] of contexts)for(const raw of ['**word**','*word*','**`word`**','[**word**](https://old.invalid "keep")','[`word`](https://old.invalid "keep")']){
  const source=wrap(raw);
  for(const action of ['bold','italic','code']){
   const p=projectSource(source),s=p.spans.find(s=>s.text==='word');assert(s,source);
   const {from,to}=s,r=mapFormatEdit(source,{action,from,to});assert(r.ok,JSON.stringify({source,action,r}));
   const state=EditorState.create({schema,doc:schema.nodeFromJSON(p.doc)}),mark=schema.marks[action];
   const tr=s[action]?state.tr.removeMark(from,to,mark):state.tr.addMark(from,to,mark.create());
   assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));undo(r,source);
  }
 }
});
test('formatted link creation and label editing retain selected marks and exact inverse',()=>{
 for(const [,wrap] of contexts)for(const raw of ['**word**','*word*','`word`','**`word`**']){
  const source=wrap(raw),p=projectSource(source),s=p.spans.find(s=>s.text==='word');
  const r=mapFormatEdit(source,{action:'set-link',from:s.from,to:s.to,label:'word',href:'https://new.invalid/a'});
  assert(r.ok,JSON.stringify({source,r}));
  const doc=schema.nodeFromJSON(p.doc),tr=EditorState.create({schema,doc}).tr.addMark(s.from,s.to,schema.marks.link.create({href:'https://new.invalid/a',title:null}));
  assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));undo(r,source);
 }
 const source='A **word** Z',s=projectSource(source).spans[1];
 const r=mapFormatEdit(source,{action:'set-link',from:s.from+1,to:s.to-1,label:'新😀',href:'#new'});
 assert.equal(r.source,'A **w[新😀](<#new>)d** Z');undo(r,source);
});
test('formatted link address and unlink preserve label wrappers and original title',()=>{
 for(const [,wrap] of contexts)for(const value of samples.filter(s=>s.includes('https://old.invalid'))){
  const source=wrap(value),p=projectSource(source),s=p.spans.find(s=>s.link);
  const c=linkSelection(source,{from:s.from,to:s.from});assert(c?.existing);assert(c.formattedLabel);
  const r=mapFormatEdit(source,{action:'set-link',from:s.from,to:s.from,label:c.label,href:'https://new.invalid/a'});
  assert(r.ok,JSON.stringify({source,r}));
  assert.equal(r.source,source.replace('https://old.invalid','<https://new.invalid/a>'));undo(r,source);
  const removed=mapFormatEdit(source,{action:'remove-link',from:s.from,to:s.from});assert(removed.ok);
  assert(!removed.projection.spans.some(s=>s.link));undo(removed,source);
  const doc=schema.nodeFromJSON(p.doc),tr=EditorState.create({schema,doc}).tr.removeMark(c.from,c.to,schema.marks.link);
  assert(tr.doc.eq(schema.nodeFromJSON(removed.projection.doc)));
  assert.equal(mapFormatEdit(source,{action:'set-link',from:s.from,to:s.from,label:'discard old styling',href:'https://new.invalid'}).ok,false);
 }
});
test('whole mixed link selection and internal caret boundaries select exactly one link',()=>{
 const source='[**one** two](first)[**three** four](second)',p=projectSource(source),spans=p.spans;
 const first=linkSelection(source,{from:spans[0].from,to:spans[1].to});assert.equal(first.label,'one two');
 assert.equal(linkSelection(source,{from:spans[0].to,to:spans[0].to}).label,'one two');
 assert.equal(linkSelection(source,{from:spans[1].to,to:spans[1].to}),null);
 assert.equal(linkSelection(source,{from:spans[0].from,to:spans[2].to}),null);
});
test('unsupported normalized code/labels, references and HTML remain protected',()=>{
 for(const source of ['A **``a`b``** Z','A [**a &amp; b**](url) Z','A **[ref][id]** Z\n\n[id]: https://example.invalid','A **<span>html</span>** Z','A **`one\ntwo`** Z'])
  assert.equal(projectSource(source).spans.length,0,source);
 for(const source of ['A **`word`** Z','A [**word😀**](x) Z']){
  const s=projectSource(source).spans.find(s=>s.bold);
  assert.equal(mapTextEdit(source,{from:s.from,to:s.to,insert:s.code?'`escape`':'[injected](https://evil.invalid)'}).ok,false);
  assert.equal(mapTextEdit(source,{from:s.from+1,to:s.from+1,insert:'\ud800'}).ok,false);
 }
 const s=projectSource('A **`word`** Z').spans.find(s=>s.code);
 assert.equal(linkSelection('A **`word`** Z',{from:s.from+1,to:s.to}),null);
});

test('inserting a new link at an emphasized leaf edge retains its emphasis',()=>{
 for(const raw of ['**word**','*word*','***word***']){
  const p=projectSource(raw),s=p.spans[0];
  for(const from of [s.from,s.to]){
   const r=mapFormatEdit(raw,{action:'set-link',from,to:from,label:'new',href:'#new'});
   assert(r.ok,JSON.stringify({raw,from,r}));undo(r,raw);
   const linked=r.projection.spans.find(s=>s.link);assert.equal(linked.bold,s.bold);assert.equal(!!linked.italic,!!s.italic);
   assert.equal(r.source,raw.slice(0,s.sourceFrom+from-s.from)+'[new](<#new>)'+raw.slice(s.sourceFrom+from-s.from));
  }
 }
});
