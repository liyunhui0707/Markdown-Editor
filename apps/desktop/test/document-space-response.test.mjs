import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {ordinarySpaceChangesEmphasis} from '../lib/document-boundary-space.mjs';

const schema=getSchema(documentEditorExtensions());
const bodies=['A **word** tail','A __word__ tail','A *word* tail','A _word_ tail',
 'A ***word*** tail','A **outer *word* tail** end','A [**word**](target "keep") end',
 '- [X] A **word**\n  continued','> A **word**  \n> continued',
 '| A | B |\n| --- | --- |\n| **word** | End |'];
test('cheap trailing-Space refusal is justified by the complete ordinary PM edit',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const body of bodies){
  const source=body.replaceAll('\n',nl),p=projectSource(source),s=p.spans.find(s=>s.text==='word');assert(s,body);
  const change={from:s.to,to:s.to,insert:' '};assert.equal(ordinarySpaceChangesEmphasis(source,p,change),true,body);
  const doc=schema.nodeFromJSON(p.doc),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,s.to)});
  const ordinary=state.tr.insertText(' '),raw=source.slice(0,s.sourceTo)+' '+source.slice(s.sourceTo);
  assert(!ordinary.doc.eq(schema.nodeFromJSON(projectSource(raw).doc)),'ordinary delimiter spelling must actually change semantics');
  const mapped=mapTextEdit(source,change);assert(mapped.ok&&mapped.boundarySpace,body);
  const tr=state.tr.replaceWith(s.to,s.to,schema.text(' ',mapped.spaceMarks.map(m=>schema.markFromJSON(m))));
  assert(tr.doc.eq(schema.nodeFromJSON(mapped.projection.doc)));const u=mapped.inverseSource;
  assert.equal(mapped.source.slice(0,u.from)+u.insert+mapped.source.slice(u.to),source);
 }
});
test('valid interior, code, link and plain Spaces never take the cheap refusal',()=>{
 for(const [source,word,offset]of [['A **word** tail','word',2],['A *word* tail','word',2],
  ['A **`word`** end','word',4],['A `word` end','word',4],['A [word](url) end','word',4],
  ['A **[word](url)** end','word',4],['Plain word','Plain word',10]]){
  const p=projectSource(source),s=p.spans.find(s=>s.text===word);assert(s,source);
  const change={from:s.from+offset,to:s.from+offset,insert:' '};
  assert.equal(ordinarySpaceChangesEmphasis(source,p,change),false,source);
  const mapped=mapTextEdit(source,change);assert(mapped.ok&&!mapped.boundarySpace,source);
 }
});
test('non-Space edits, selected ranges and forged fields do not enter the shortcut',()=>{
 const source='A **word** tail',p=projectSource(source),s=p.spans.find(s=>s.text==='word');
 for(const change of [null,{},Object.assign(Object.create(null),{from:s.to,to:s.to,insert:' '}),
  {from:s.to,to:s.to,insert:' ',proof:true},{from:s.from,to:s.to,insert:' '},
  {from:s.to,to:s.to,insert:'x'},{from:s.to,to:s.to,insert:'\t'},
  {from:s.to,to:s.to,insert:' '.repeat(4097)}])assert.equal(ordinarySpaceChangesEmphasis(source,p,change),false);
});
