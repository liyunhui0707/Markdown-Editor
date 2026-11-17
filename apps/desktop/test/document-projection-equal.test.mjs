import test from 'node:test';import assert from 'node:assert/strict';
import {equalProjection} from '../lib/document-projection-equal.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
test('full projection comparison agrees with JSON for actual source trees and altered distant nodes',()=>{
 const source='# Title\n\nText **bold** and [link](guide "title").\n\n- [x] task\n\n> quote\n\n| A | B |\n| --- | --- |\n| cell | other |\n\n```js\nopaque\n```';
 const doc=projectSource(source).doc,copy=structuredClone(doc),changes=[copy,...['First.','## Other','- next','> different'].map(s=>projectSource(s).doc)];
 const distant=structuredClone(doc);distant.content.at(-1).content[0].text='different';changes.push(distant);
 const link=structuredClone(doc);link.content[1].content.find(n=>n.marks?.some(m=>m.type==='link')).marks.find(m=>m.type==='link').attrs.href='other';changes.push(link);
 for(const other of changes)assert.equal(equalProjection(doc,other),JSON.stringify(doc)===JSON.stringify(other));
 assert.equal(equalProjection({a:1,b:2},{b:2,a:1}),false);assert.equal(equalProjection({a:1},{a:'1'}),false);
 assert.equal(equalProjection([1,2],[2,1]),false);assert.equal(equalProjection({x:null},{x:{}}),false);
});
test('near-capacity ordinary edit still compares the full expected document and keeps fresh projections',()=>{
 const source=Array.from({length:700},(_,i)=>`## ${i}\n\n${'Body **bold** text. '.repeat(24)}\n\n`).join('');
 const before=projectSource(source),span=before.spans.find(s=>s.text==='bold'),mapped=mapTextEdit(source,{from:span.to,to:span.to,insert:'x'});assert(mapped.ok);
 assert(equalProjection(mapped.projection.doc,projectSource(mapped.source).doc));
 assert(!equalProjection(before.doc,mapped.projection.doc));
 const fresh=projectSource(source);fresh.doc.content.findLast(n=>n.content?.length).content[0].text='mutated';assert(!equalProjection(before.doc,fresh.doc));
});
