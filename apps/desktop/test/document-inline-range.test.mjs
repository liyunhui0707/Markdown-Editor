import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
const schema = getSchema([StarterKit.configure({ undoRedo:false, trailingNode:false })]);
const source = 'Alpha **bold** omega.';
const edit = (raw, from, to, insert) => mapTextEdit(raw, {from,to,insert});

test('inline range replaces/deletes plain and bold text with starting marks, preserving untouched bytes', () => {
  const [a,b,c]=projectSource(source).spans;
  for (const [from,to,insert,expected] of [
    [a.from+3,b.from+2,'X','AlpX**ld** omega.'],
    [b.from+2,c.from+3,'X','Alpha **boX**ega.'],
    [b.from,b.to,'','Alpha  omega.'],
    [a.from,a.to,'','**bold** omega.'],
    [c.from,c.to,'','Alpha **bold**'],
    [a.from,c.to,'',''],
    [a.to,a.to,'X','Alpha X**bold** omega.'],
    [b.to,b.to,'X','Alpha **boldX** omega.'],
  ]) assert.equal(edit(source,from,to,insert).source,expected);
});

for (const marker of ['**','__']) test(`inline range projection and exact source inverse matrix ${marker}`, () => {
  const prefix='---\r\nkind: synthetic\r\n---\r\n\r\n';
  const body=`A中😀 ${marker}B文😀${marker} C尾😀.`;
  const suffix='\r\n\r\n```md\r\nkeep **bytes**\r\n```\r\n';
  const raw=prefix+body+suffix, p=projectSource(raw), spans=p.spans, left=spans[0],right=spans.at(-1);
  const doc=schema.nodeFromJSON(p.doc);let accepted=0;
  for(let from=left.from;from<=right.to;from++) for(let to=from;to<=right.to;to++) {
    for(const insert of ['','新😀']) {
      const m=edit(raw,from,to,insert);
      if(!m.ok) continue;
      const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
      assert(state.tr.insertText(insert).doc.eq(schema.nodeFromJSON(m.projection.doc)),`${from}:${to}:${insert}`);
      assert(m.source.startsWith(prefix));assert(m.source.endsWith(suffix));
      if(m.inverseSource) {
        const u=m.inverseSource;
        assert.equal(m.source.slice(0,u.from)+u.insert+m.source.slice(u.to),raw);accepted++;
      }
    }
  }
  assert(accepted>40,'must support actual cross-mark ranges, not only old single-leaf edits');
});

test('inline range preserves delimiter style and merges surviving bold text across a removed plain gap', () => {
  const raw='A **bold** middle __tail__ Z',p=projectSource(raw),a=p.spans[1],b=p.spans[3];
  const result=edit(raw,a.from+2,b.from+2,'X');
  assert.equal(result.source,'A **boXil** Z');
  const u=result.inverseSource;assert.equal(result.source.slice(0,u.from)+u.insert+result.source.slice(u.to),raw);
});

test('inline range rejects structural syntax, surrogate cuts, protected blocks and excessive ranges atomically', () => {
  for (const raw of ['# A **bold** Z','- A **bold** Z','A *italic* Z','A [link](https://example.invalid) Z','A **bold**\nsoft wrap','A **bold**\n\nZ']) {
    const p=projectSource(raw),a=p.spans[0],b=p.spans.at(-1);
    if(a&&b) assert.equal(edit(raw,a.from+1,b.to-1,'X').ok,false,raw);
  }
  const [a,b]=projectSource('A **😀bold** tail').spans;
  assert.equal(edit('A **😀bold** tail',a.from,b.from+1,'X').ok,false);
  for(const insert of ['\ud800','line\nline','[x](url)','**nested**','x'.repeat(4097)]) assert.equal(edit(source,2,10,insert).ok,false);
  const huge='A'.repeat(4100)+' **bold** end',p=projectSource(huge);
  assert.equal(edit(huge,p.spans[0].from,p.spans[1].to,'X').ok,false);
  assert.equal(mapTextEdit(source,{from:2,to:10,insert:'x',inverseSource:{from:0,to:1,insert:'bad'}}).ok,false);
});
