import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
for(const nl of ['\n','\r\n','\r'])for(const prefix of ['- ','7) ','- [X] ','> '])test('wrapped paragraph projection and exact typing '+prefix+JSON.stringify(nl),()=>{
 const cont=prefix==='> '?'> ':' '.repeat(prefix==='7) '?3:2),source=prefix+'First **bold**'+nl+cont+'next [link](target "keep") tail';
 const p=projectSource(source);assert.equal(p.doc.content[0].type,prefix==='> '?'blockquote':prefix==='7) '?'orderedList':'bulletList');
 const rows=p.blocks[0].items||p.blocks[0].quoteRows;assert.equal(rows.length,1);
 const s=p.spans.find(s=>s.text.includes('next '));assert(s);const r=mapTextEdit(source,{from:s.from,to:s.from,insert:'新😀'});assert(r.ok);assert.equal(r.source,source.replace('next ','新😀next '));
 const u=r.inverseSource;assert(u);assert.equal(r.source.slice(0,u.from)+u.insert+r.source.slice(u.to),source);
});
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {Slice,Fragment} from '@tiptap/pm/model';
import {splitBlock} from '@tiptap/pm/commands';
import {splitListItem} from '@tiptap/pm/schema-list';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
const schema=getSchema(documentEditorExtensions());
function state(source,from,to=from){const doc=schema.nodeFromJSON(projectSource(source).doc);return EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});}
function inverse(source,r){assert(r.ok,JSON.stringify(r));const u=r.inverseSource;assert(u);assert.equal(r.source.slice(0,u.from)+u.insert+r.source.slice(u.to),source);return r;}
function range(source,from,to,insert){const r=inverse(source,mapTextEdit(source,{from,to,insert})),s=state(source,from,to);let tr;
 if(!insert.includes('\n'))tr=insert?s.tr.insertText(insert):s.tr.delete(from,to);
 else{const list=s.selection.$from.depth>2,paragraph=t=>schema.nodes.paragraph.create(null,schema.text(t));const nodes=insert.split('\n\n').map(t=>list?schema.nodes.listItem.create({checked:s.selection.$from.node(s.selection.$from.depth-1).attrs.checked===null?null:false},paragraph(t)):paragraph(t));tr=s.tr.replaceSelection(new Slice(Fragment.fromArray(nodes),list?2:1,list?2:1));}
 assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)),JSON.stringify({source,from,to,insert,actual:r.source}));assert.deepEqual(r.selection,{from:tr.selection.from,to:tr.selection.to});return r;
}
for(const nl of ['\n','\r\n','\r'])for(const prefix of ['- ','9) ','- [X] ','> '])for(const hard of ['', '  ','\\'])test('wrapped formatted range/sibling paste/split/join '+prefix+JSON.stringify([nl,hard]),()=>{
 const list=prefix!=='> ',continuation=list?' '.repeat(prefix==='9) '?3:2):'> ',gap=list?nl+prefix:nl+'> '+nl+'> ';
 const source='# Keep'+nl+nl+prefix+'Before **one**__two__'+hard+nl+continuation+'middle [**link**](target "keep") tail'+gap+'Last *end*'+nl+nl+'Outside.';
 const p=projectSource(source),rows=p.blocks[1].items||p.blocks[1].quoteRows,a=p.spans.find(s=>s.text==='one'),b=p.spans.find(s=>s.text==='link'),end=p.spans.find(s=>s.text==='end');assert(a&&b&&end);
 for(const insert of ['新😀','','A\n\nB']){
  range(source,a.from+1,b.from+2,insert);const r=range(source,b.from+1,end.to-1,insert);assert(r.source.startsWith('# Keep'+nl+nl+prefix+'Before **one**__two__'+hard+nl+continuation));assert(r.source.endsWith(nl+nl+'Outside.'));
 }
 const at=b.from+2,r=inverse(source,mapFormatEdit(source,{action:list?'split-list':'split-quote',from:at,to:at}));
 let tr;assert((list?splitListItem(schema.nodes.listItem):splitBlock)(state(source,at),v=>{tr=v;}));
 // PM's stock split copies checked state; the application's deliberate new-task
 // policy starts unchecked. Every other node and mark must agree.
 if(prefix==='- [X] '){const actual=tr.doc.toJSON();actual.content[1].content[1].attrs={checked:false};assert(schema.nodeFromJSON(actual).eq(schema.nodeFromJSON(r.projection.doc)));}
 else assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));
 const joined=inverse(r.source,mapFormatEdit(r.source,{action:list?'join-list':'join-quote',from:r.selection.from,to:r.selection.from}));assert.equal(joined.source,source);
 const marked=inverse(source,mapFormatEdit(source,{action:'italic',from:a.from,to:b.to}));assert(marked.source.includes('target "keep"'));assert(marked.source.endsWith(nl+nl+'Outside.'));
});
test('loose sibling gaps, tasks and nested wrapped leaves retain source ownership',()=>{
 for(const source of ['- First\n  next\n\n- Second\n  last','3) Parent\n   - [X] First **word**\n     next\n   - [ ] Last [link](target "keep")\n8) Outside']){
  const p=projectSource(source),block=p.blocks[0],rows=block.items;assert(rows);const a=p.spans.find(s=>s.text==='word')||p.spans.find(s=>s.text==='First'),b=p.spans.find(s=>s.text==='link')||p.spans.find(s=>s.text==='last');range(source,a.from+1,b.to-1,'One\n\nTwo');
  if(source.startsWith('- First')){const r=inverse(source,mapFormatEdit(source,{action:'split-list',from:a.from+2,to:a.from+2}));assert(r.source.includes('\n\n- rst'));}
  else{const r=inverse(source,mapFormatEdit(source,{action:'toggle-task',from:a.from,to:a.from}));assert.equal(r.source,source.replace('[X]','[ ]'));}
 }
});
test('wrapped quote unwrap and conversion remove only owned prefixes',()=>{
 const source='> **First**\r\n> next [link](target "keep")\r\n> \r\n> Last',p=projectSource(source),row=p.blocks[0].quoteRows[0];
 const r=inverse(source,mapFormatEdit(source,{action:'join-quote',from:row.from,to:row.from}));assert.equal(r.source,'**First**\r\nnext [link](target "keep")\r\n\r\n> Last');
 const all=inverse(source,mapFormatEdit(source,{action:'paragraph',from:row.from,to:row.from}));assert.equal(all.source,'**First**\r\nnext [link](target "keep")\r\n\r\nLast');
});
test('wrapped unsafe syntax, child blocks, lazy prefixes and budgets stay protected',()=>{
 for(const source of ['- First\nnext','> First\nnext','> First\n> > Nested','- First\n\n  Second paragraph','> First\n> \n> - Child','- First\n  &amp;','> First\n> <b>HTML</b>'])assert.equal(projectSource(source).blocks[0],null,source);
 const source='- First😀\n  next\n- Last',p=projectSource(source),rows=p.blocks[0].items;
 for(const insert of ['a\tb','a\nb','\ud800','x'.repeat(4097)])assert.equal(mapTextEdit(source,{from:rows[0].from,to:rows[1].to,insert}).ok,false);
 assert.equal(mapTextEdit(source,{from:rows[0].from+6,to:rows[0].from+7,insert:'X'}).ok,false);
 const full=Array.from({length:32},(_,i)=>'- Row'+i+'\n  tail').join('\n'),q=projectSource(full),at=q.blocks[0].items[0].from+2;assert.equal(mapFormatEdit(full,{action:'split-list',from:at,to:at}).ok,false);
});
test('first wrapped root list item Backspace unwrap retains following numbering',()=>{
 for(const prefix of ['- ','- [X] ','7) ']){const continuation=prefix==='7) '?'   ':'  ',source=prefix+'First **word**\n'+continuation+'next\n'+(prefix==='7) '?'12) ':prefix)+'Last',p=projectSource(source),at=p.blocks[0].items[0].from;
 const r=inverse(source,mapFormatEdit(source,{action:'join-list',from:at,to:at}));assert.equal(r.source,'First **word**\nnext\n\n'+(prefix==='7) '?'12) ':prefix)+'Last');}
});
test('wrapped parent typing retains its child subtree; cross-subtree paste refuses',()=>{
 const source='- Parent **word**\n  continued\n  - Child\n- Last',p=projectSource(source),s=p.spans.find(s=>s.text==='word');range(source,s.from+1,s.from+2,'新');
 assert.equal(mapTextEdit(source,{from:s.from+1,to:s.from+1,insert:'One\n\nTwo'}).ok,false);
});
test('wrapped offset differential covers soft/hard breaks, links and UTF16',()=>{
 let accepted=0;
 for(const source of ['- **中😀**\n  [link](target "title") end','> **中😀**  \r\n> [link](target "title") end']){const p=projectSource(source),r=(p.blocks[0].items||p.blocks[0].quoteRows)[0];
 for(let from=r.from;from<=r.to;from++)for(let to=from;to<=r.to;to++)for(const insert of ['新😀','']){const result=mapTextEdit(source,{from,to,insert});if(result.ok){range(source,from,to,insert);accepted++;}}}
 assert(accepted>100);
});
