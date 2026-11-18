import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource} from '../lib/document-source-map.mjs';
import {matchesPMProjection} from '../lib/document-pm-projection.mjs';

const schema=getSchema(documentEditorExtensions());
test('complete PM comparison agrees with schema conversion including default attributes and marks',()=>{
 const sources=['# Title\n\nText **bold *both* tail** and [link](guide "keep").',
  '- [x] task\n  - child\n\n> quote\n\n| A | B |\n| --- | --- |\n| cell | next |',
  '```js\ncode\n```\n\n![x](image.png)\n\nline  \nbreak'];
 for(const source of sources){
  const json=projectSource(source).doc,pm=schema.nodeFromJSON(json);
  assert(matchesPMProjection(pm,json));
  for(const other of sources.map(s=>projectSource(s).doc))
   assert.equal(matchesPMProjection(pm,other),pm.eq(schema.nodeFromJSON(other)));
  const changed=structuredClone(json);changed.content[changed.content.length-1]={type:'paragraph',content:[{type:'text',text:'distant mutation'}]};
  assert(!matchesPMProjection(pm,changed));
 }
});
test('comparison rejects wrong text, nested attributes, marks, extra children and foreign schemas',()=>{
 const json=projectSource('# A\n\n[link](one "title")\n\nEnd.').doc,pm=schema.nodeFromJSON(json);
 for(const mutate of [j=>j.content[0].attrs.level=6,j=>j.content[1].content[0].marks[0].attrs.href='two',
  j=>j.content[1].content[0].marks[0].attrs.title='other',j=>j.content[2].content[0].text='end.',
  j=>j.content.push({type:'paragraph'}),j=>j.content[1].content[0].marks.push({type:'bold'})]){
  const next=structuredClone(json);mutate(next);assert(!matchesPMProjection(pm,next));
 }
 assert(!matchesPMProjection(pm,{type:'unknown'}));
 assert(!matchesPMProjection(pm,{...json,content:null}));
 assert(!matchesPMProjection(pm,json,getSchema(documentEditorExtensions())));
});
