import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema(documentEditorExtensions());
test('common combined emphasis projects and edits as real text in articles',()=>{
 for(const source of ['Before **bold *both* tail** after.','# **bold *both* tail**','- **bold *both* tail**','> **bold *both* tail**','***both***']){
  const p=projectSource(source),span=p.spans.find(s=>s.text==='both');assert(span,source);
  const n=schema.nodeFromJSON(p.doc);n.check();assert(n.rangeHasMark(span.from,span.to,schema.marks.bold));assert(n.rangeHasMark(span.from,span.to,schema.marks.italic));
  const edit=mapTextEdit(source,{from:span.from+1,to:span.from+2,insert:'中文😀'});assert(edit.ok,source);assert.equal(edit.source,source.replace('both','b中文😀th'));
 }
});
test('toolbar combines and removes emphasis while preserving the other mark',()=>{
 for(const [source,action,expected] of [['**word**','italic','**_word_**'],['*word*','bold','***word***'],['**_word_**','italic','**word**'],['**_word_**','bold','_word_']]){
  const p=projectSource(source),s=p.spans[0],edit=mapFormatEdit(source,{action,from:s.from,to:s.to});assert(edit.ok,source+action);assert.equal(edit.source,expected);
 }
});
test('soft source-line selections replace/join/split with exact native PM semantics and inverse bytes',()=>{
 for(const nl of ['\n','\r\n','\r']){
  const source='First line'+nl+'Second 中文😀 line'+nl+'Third line'+nl+nl+'Outside.';
  const p=projectSource(source),a=p.spans[0],b=p.spans[1];
  for(const c of [{from:a.to-3,to:b.from+6,insert:'X'},{from:a.to,to:b.from,insert:''},{from:a.from+3,to:a.from+3,insert:'\n\n'}]){
   const edit=mapTextEdit(source,c);assert(edit.ok,JSON.stringify(c));
   const state=EditorState.create({schema,doc:schema.nodeFromJSON(p.doc),selection:TextSelection.create(schema.nodeFromJSON(p.doc),c.from,c.to)});
   const tr=c.insert==='\n\n'?state.tr.split(c.from):state.tr.insertText(c.insert);
   assert(tr.doc.eq(schema.nodeFromJSON(edit.projection.doc)));
   assert.equal(edit.source.slice(0,edit.inverseSource.from)+edit.inverseSource.insert+edit.source.slice(edit.inverseSource.to),source);
  }
 }
});
test('combined formatting supports paragraph, heading, quote and list continuation',()=>{
 assert.equal(mapFormatEdit('Paragraph',{action:'split-heading',from:3,to:3}).ok,false);
 for(const [source,action,expected] of [
  ['**bold *both* tail**','split-paragraph','**bold *bo***\n\n***th* tail**'],
  ['# **bold *both* tail**','split-heading','# **bold *bo***\n\n***th* tail**'],
  ['- **bold *both* tail**','split-list','- **bold *bo***\n- ***th* tail**'],
  ['- [ ] **bold *both* tail**','split-list','- [ ] **bold *bo***\n- [ ] ***th* tail**'],
  ['> **bold *both* tail**','split-quote','> **bold *bo***\n> \n> ***th* tail**'],
 ]){
  const p=projectSource(source),s=p.spans.find(s=>s.text==='both');assert(s,source);
  const edit=mapFormatEdit(source,{action,from:s.from+2,to:s.from+2});assert(edit.ok,source+action);assert.equal(edit.source,expected);
  assert.equal(edit.source.slice(0,edit.inverseSource.from)+edit.inverseSource.insert+edit.source.slice(edit.inverseSource.to),source);
 }
});
test('paragraph joins retain combined marks alongside ordinary and bold next paragraphs',()=>{
 for(const tail of ['plain','**next**','*next*']){
  const source='**A *both* Z**\n\n'+tail,p=projectSource(source),s=p.spans.at(-1),doc=schema.nodeFromJSON(p.doc);
  const result=mapFormatEdit(source,{action:'join-paragraph',from:s.from,to:s.from});assert(result.ok,tail);
  const native=EditorState.create({schema,doc}).tr.join(p.blocks[1].from);
  assert(native.doc.eq(schema.nodeFromJSON(result.projection.doc)));
 }
});
