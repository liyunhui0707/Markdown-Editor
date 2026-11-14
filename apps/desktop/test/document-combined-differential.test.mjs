import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {findDocumentText} from '../lib/document-find-view.mjs';
import {planDocumentReplace} from '../lib/document-replace.mjs';
const schema=getSchema(documentEditorExtensions());
function native(p,from,to,insert){const doc=schema.nodeFromJSON(p.doc);return EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)}).tr.insertText(insert).doc;}
function inverse(source,e){const u=e.inverseSource||{from:e.change.from,to:e.change.from+e.change.insert.length,insert:source.slice(e.change.from,e.change.to)};assert.equal(e.source.slice(0,u.from)+u.insert+e.source.slice(u.to),source);}
test('every accepted combined-format and soft-line edit agrees with native PM and restores exact bytes',()=>{
 let accepted=0;
 for(const source of ['A **bold *both* end** Z','A ___both___ Z','# A **bold *both* end** Z','- A **bold *both* end** Z','- [ ] A **bold *both* end** Z','> A **bold *both* end** Z','First 😀\r\nSecond line\nThird line']){
  const p=projectSource(source);assert(p.spans.length);
  for(let from=p.spans[0].from;from<=p.spans.at(-1).to;from++)for(let to=from;to<=p.spans.at(-1).to;to++)for(const insert of ['X','', '中😀']){
   const edit=mapTextEdit(source,{from,to,insert});if(!edit.ok)continue;accepted++;
   assert(native(p,from,to,insert).eq(schema.nodeFromJSON(edit.projection.doc)),JSON.stringify({source,from,to,insert}));inverse(source,edit);
  }
 }
 assert(accepted>1500);
});
test('accepted combined-emphasis toolbar changes preserve exactly the selected native marks',()=>{
 for(const source of ['**A *both* Z**','***both***','**word**','*word*']){
  const p=projectSource(source),doc=schema.nodeFromJSON(p.doc);
  for(const s of p.spans)for(let from=s.from;from<s.to;from++)for(let to=from+1;to<=s.to;to++)for(const action of ['bold','italic']){
   const result=mapFormatEdit(source,{action,from,to});if(!result.ok)continue;
   const tr=EditorState.create({schema,doc}).tr;
   if(s[action])tr.removeMark(from,to,schema.marks[action]);else tr.addMark(from,to,schema.marks[action].create());
   assert(tr.doc.eq(schema.nodeFromJSON(result.projection.doc)),JSON.stringify({source,action,from,to}));inverse(source,result);
  }
 }
});
test('find replacement uses the same safe combined-format and soft-line mappings atomically',()=>{
 for(const [source,query,text] of [['A **bold *both* end** Z','bold both','NEW'],['First\r\nSecond line','First Second','NEW']]){
  const p=projectSource(source),doc=schema.nodeFromJSON(p.doc),hits=findDocumentText(doc,query).matches;
  assert.equal(hits.length,1);const r=planDocumentReplace(source,doc,hits,text);assert(r.ok,source);
  assert(native(p,hits[0].from,hits[0].to,text).eq(schema.nodeFromJSON(projectSource(r.source).doc)));
 }
});
