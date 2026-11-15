import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {Slice,Fragment} from '@tiptap/pm/model';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema(documentEditorExtensions());
function native(source,from,to,insert){const p=projectSource(source),doc=schema.nodeFromJSON(p.doc),s=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
 if(!insert.includes('\n'))return insert?s.tr.insertText(insert):s.tr.delete(from,to);
 const quoted=s.selection.$from.depth===2,list=quoted?null:s.selection.$from.node(s.selection.$from.depth-2),paragraph=t=>schema.nodes.paragraph.create(null,schema.text(t));
 const nodes=insert.split('\n\n').map(t=>quoted?paragraph(t):schema.nodes.listItem.create({checked:s.selection.$from.node(s.selection.$from.depth-1).attrs.checked===null?null:false},paragraph(t)));
 return s.tr.replaceSelection(new Slice(Fragment.fromArray(nodes),quoted?1:2,quoted?1:2));
}
function check(source,from,to,insert){const r=mapTextEdit(source,{from,to,insert});assert(r.ok,JSON.stringify({source,from,to,insert,result:r}));const tr=native(source,from,to,insert);assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)),JSON.stringify({source,result:r.source}));assert.deepEqual(r.selection,{from:tr.selection.from,to:tr.selection.to});const u=r.inverseSource;assert(u);assert.equal(r.source.slice(0,u.from)+u.insert+r.source.slice(u.to),source);return r;}
for(const nl of ['\n','\r\n','\r'])for(const prefix of ['- ','+ ','7) ','- [X] ','> '])test('structured range exact replacement, deletion and sibling paste '+prefix+JSON.stringify(nl),()=>{
 const gap=prefix==='> '?nl+'> '+nl:nl,second=prefix==='- [X] '?'- [ ] ':prefix;
 const source='# Keep'+nl+nl+prefix+'Before **word** tail'+gap+second+'Middle *text*'+gap+second+'Last [**link** plain](../guide.md \'keep title\') end'+nl+nl+'| A | B |'+nl+'| --- | --- |'+nl+'| C | D |';
 const p=projectSource(source),a=p.spans.find(s=>s.text==='word'),b=p.spans.find(s=>s.text==='link');assert(a&&b);
 for(const insert of ['新😀','','One\n\nTwo']){const r=check(source,a.from+1,b.from+2,insert);assert(r.source.startsWith('# Keep'+nl+nl+prefix+'Before **w'));assert(r.source.endsWith(' end'+nl+nl+'| A | B |'+nl+'| --- | --- |'+nl+'| C | D |'));assert(r.source.includes("../guide.md 'keep title'"));}
 const r=check(source,a.from+1,a.from+1,'One\n\nTwo');if(prefix==='- [X] ')assert(r.source.includes(nl+'- [ ] Two'));
});
test('nested sibling leaf items preserve parent, siblings, original numbering and task spelling',()=>{
 const source='3) Parent\r\n   1) Before [**word**](target "keep") tail\r\n   12) End *last*\r\n   20) Keep **one**__two__\r\n8) Outside',p=projectSource(source),a=p.spans.find(s=>s.text==='word'),b=p.spans.find(s=>s.text==='last');assert(a&&b);
 for(const insert of ['新','','One\n\nTwo']){const r=check(source,a.from+1,b.from+2,insert);assert(r.source.startsWith('3) Parent\r\n   1) '));assert(r.source.endsWith('\r\n   20) Keep **one**__two__\r\n8) Outside'));if(insert.includes('\n'))assert(r.source.includes('\r\n   2) Two'));}
});
test('structured differential matrix covers combined marks, distinct links and exact inverses',()=>{
 let accepted=0;
 for(const source of ['- **A中😀**\n- [B *word*](target "keep")\n- **`C`** tail','> **A中😀**\n> \n> [B *word*](target "keep")\n> \n> **`C`** tail','- [X] [one](target "one")\n- [ ] [two](other "two")']){
  const p=projectSource(source),rows=p.blocks[0].items||p.blocks[0].quoteRows,a=rows[0],b=rows.at(-1);
  for(let from=a.from;from<=a.to;from++)for(let to=b.from;to<=b.to;to++)for(const insert of ['新😀','','One\n\nTwo']){const r=mapTextEdit(source,{from,to,insert});if(!r.ok)continue;check(source,from,to,insert);accepted++;}
 }
 assert(accepted>100,accepted);
});
test('structured ranges retain parent/subtree, malformed Unicode, scope, capacity and payload fences',()=>{
 for(const source of ['- **First**\n  - Child\n- Last [link](target)','- Parent\n  - **First**\n- Last [link](target)','- **First**\n\n1. Last [link](target)','> **First**\n> \n> - list\n> \n> Last','- **First**\n- &amp;\n- Last']){
  const p=projectSource(source),a=p.spans[0],b=p.spans.at(-1);assert.equal(mapTextEdit(source,{from:a?.from??3,to:b?.to??30,insert:'X'}).ok,false,source);
 }
 const source='- **First😀**\n- [last](target)',p=projectSource(source),a=p.blocks[0].items[0],b=p.blocks[0].items[1];
 for(const insert of ['One\nTwo','One\n\n','\n\nOne','One\n\n\nTwo','\ud800','a\tb','x'.repeat(4097),Array(33).fill('Text').join('\n\n')])assert.equal(mapTextEdit(source,{from:a.from+1,to:b.to-1,insert}).ok,false);
 for(const extra of [{itemIndex:0},{sourceFrom:0},{path:'/other.md'},{leaf:null}])assert.equal(mapTextEdit(source,{from:a.from,to:b.to,insert:'X',...extra}).ok,false);
 assert.equal(mapTextEdit(source,{from:a.to-1,to:b.to,insert:'X'}).ok,false);
});
test('list and quote Backspace joins preserve unrelated adjacent delimiter spelling',()=>{
 for(const prefix of ['- ','> ']){
  const gap=prefix==='> '?'\r\n> \r\n> ':'\r\n- ',source=prefix+'**one**__two__ tail'+gap+'[**last**](target "keep")',p=projectSource(source),rows=p.blocks[0].items||p.blocks[0].quoteRows;
  const r=mapFormatEdit(source,{action:prefix==='> '?'join-quote':'join-list',from:rows[1].from,to:rows[1].from});assert(r.ok);assert.equal(r.source,source.replace(gap,''));
  const u=r.inverseSource;assert.equal(r.source.slice(0,u.from)+u.insert+r.source.slice(u.to),source);assert(native(source,rows[0].to,rows[1].from,'').doc.eq(schema.nodeFromJSON(r.projection.doc)));
 }
});
