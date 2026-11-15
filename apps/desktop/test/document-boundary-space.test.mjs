import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
for(const [source,word] of [['A **word** tail','word'],['A *word* tail','word'],['- [X] A **word**\n  continued','word'],['> A **word**  \n> continued','word'],['| A | B |\n| --- | --- |\n| **word** | End |','word']])test('native boundary space is retained '+source.split('\n')[0],()=>{
 const s=projectSource(source).spans.find(s=>s.text===word),r=mapTextEdit(source,{from:s.to,to:s.to,insert:' '});assert(r.ok,JSON.stringify(r));assert(r.boundarySpace);assert.equal(r.source,source.startsWith('-')?'- [X] A **word**  continued':source.startsWith('>')?'> A **word** \\\n> continued':source.replace(word+(source.includes('**word**')?'**':'*'),word+(source.includes('**word**')?'**':'*')+' '));
 const u=r.inverseSource;assert.equal(r.source.slice(0,u.from)+u.insert+r.source.slice(u.to),source);
});
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
const schema=getSchema(documentEditorExtensions());
test('boundary Space proof retains unrelated frames, link title, CRLF and exact source inverse',()=>{
 for(const source of ['# Keep\r\n\r\nA **one**__word__ end\r\n\r\nTail.','A **outer *word* tail** end','A [**word**](target "keep") end','## A **word**']){
  const p=projectSource(source),s=p.spans.find(s=>s.text==='word'),r=mapTextEdit(source,{from:s.to,to:s.to,insert:' '});assert(r.ok&&r.boundarySpace,source);const doc=schema.nodeFromJSON(p.doc),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,s.to)}),marks=r.spaceMarks.map(m=>schema.markFromJSON(m));
  const tr=state.tr.replaceWith(s.to,s.to,schema.text(' ',marks));assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));assert.equal(r.source.slice(0,r.inverseSource.from)+r.inverseSource.insert+r.source.slice(r.inverseSource.to),source);if(source.includes('**one**__word__'))assert(r.source.includes('**one**__word__ '));
 }
});
test('interior Spaces keep ordinary formatting; malformed, large and forged payloads refuse',()=>{
 const source='A **word** tail',s=projectSource(source).spans.find(s=>s.text==='word');const r=mapTextEdit(source,{from:s.from+2,to:s.from+2,insert:' '});assert(r.ok&&!r.boundarySpace);assert.equal(r.source,'A **wo rd** tail');
 for(const change of [{from:s.to,to:s.to,insert:' ',marks:[]},{from:s.to,to:s.to,insert:' '.repeat(4097)},{from:s.to,to:s.to,insert:'\ud800'},{from:s.to,to:s.to,insert:'\t'}])assert.equal(mapTextEdit(source,change).ok,false);
 for(const source of ['A **word** &amp;','A [word][ref]\n\n[ref]: target','A <b>word</b>'])assert.equal(projectSource(source).spans.length,0);
});

test('representable code Spaces keep their existing marks and normal input path',()=>{
 const source='A **`word`** end',s=projectSource(source).spans.find(s=>s.text==='word'),r=mapTextEdit(source,{from:s.to,to:s.to,insert:' '});assert(r.ok&&!r.boundarySpace);assert.equal(r.source,'A **`word `** end');
});
