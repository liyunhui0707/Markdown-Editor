import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema(documentEditorExtensions());
const basic='|Name|State|\n|:---|---:|\n|Alpha|Ready|\n|Beta||';
const cell=(s,row=0,col=0)=>projectSource(s).spans.find(x=>x.tableRow===row&&x.tableCol===col);
const command=(s,action,row=0,col=0)=>{const c=cell(s,row,col);assert.ok(c,'editable cell');return mapFormatEdit(s,{action,from:c.from,to:c.from});};
function inverse(result,source){assert.equal(result.ok,true,JSON.stringify(result));const c=result.inverseSource;assert.equal(result.source.slice(0,c.from)+c.insert+result.source.slice(c.to),source);schema.nodeFromJSON(result.projection.doc).check();}
for(const nl of ['\n','\r\n','\r'])test('table projection and cell edits preserve exact neighbors/padding/alignment '+JSON.stringify(nl),()=>{
 const table=basic.replaceAll('\n',nl),s=['---','id: keep','---','','# Before','',''+table,'','After',''].join(nl),p=projectSource(s);
 assert.equal(p.doc.content[2].type,'table');assert.equal(p.doc.content[2].content[0].content[1].attrs.align,'right');
 for(const span of p.spans.filter(x=>x.tableRow!==undefined))assert.equal(s.slice(span.sourceFrom,span.sourceTo),span.text);
 const c=cell(s,1,0),r=mapTextEdit(s,{from:c.from,to:c.to,insert:' 中文😀 '});inverse(r,s);assert.equal(r.source,s.replace('Alpha',' 中文😀 '));
 const empty=mapTextEdit(s,{from:c.from,to:c.to,insert:''});inverse(empty,s);assert.equal(cell(empty.source,1,0).text,'');
 const padded='| A | B |'+nl+'| --- | --- |'+nl+'|   | X |';assert.equal(cell(padded,1,0).text,'   ');
});
test('toolbar creates a table in empty prose or after an existing paragraph, not inside protected blocks',()=>{
 for(const s of ['', 'Before\r\n\r\nAfter']){const r=mapFormatEdit(s,{action:'insert-table',from:1,to:1});inverse(r,s);assert.ok(r.projection.doc.content.some(n=>n.type==='table'));}
 for(const s of ['# Heading','- List','```\nx\n```'])assert.equal(mapFormatEdit(s,{action:'insert-table',from:1,to:1}).ok,false);
});
test('row/column operations preserve unaffected source spelling and exact undo patches',()=>{
 let r=command(basic,'table-add-row',1);inverse(r,basic);assert.equal(r.source,basic.replace('|Beta||','|||\n|Beta||'));
 r=command(basic,'table-delete-row',1);inverse(r,basic);assert.equal(r.source,basic.replace('|Alpha|Ready|\n',''));
 r=command(basic,'table-add-column',1,0);inverse(r,basic);assert.equal(r.source,'|Name||State|\n|:---|---|---:|\n|Alpha||Ready|\n|Beta|||');
 r=command(basic,'table-delete-column',1,0);inverse(r,basic);assert.equal(r.source,'|State|\n|---:|\n|Ready|\n||');
 assert.equal(command(basic,'table-delete-row',0).ok,false);
 assert.equal(command('|H|\n|---|\n|B|','table-delete-column',1).ok,false);
 const headerOnly=command('|H|\n|---|\n|B|','table-delete-row',1);inverse(headerOnly,'|H|\n|---|\n|B|');assert.equal(headerOnly.source,'|H|\n|---|');
});
test('exit table creates a prose slot and keeps following content untouched',()=>{
 for(const s of [basic,basic+'\n\nTail']){const r=command(s,'table-exit');inverse(r,s);assert.equal(r.projection.doc.content[1].type,'paragraph');if(s===basic)assert.deepEqual(r.projection.doc.content[1].content,[]);else assert.equal(r.source,s);}
});
test('nonrectangular, escaped, formatted, oversized and nested tables stay protected',()=>{
 for(const s of ['|A|B|\n|---|---|\n|one|','|A|\n|---|\n|**bold**|','|A|\n|---|\n|a\\|b|','> |A|\n> |---|\n> |B|', '|'+Array(9).fill('A').join('|')+'|\n|'+Array(9).fill('---').join('|')+'|'])assert.equal(projectSource(s).spans.some(x=>x.tableRow!==undefined),false,s);
 const s='|A|\n|---|\n'+Array(31).fill('|X|').join('\n');assert.equal(command(s,'table-add-row').ok,false);
 const p=projectSource(basic),a=cell(basic,1,0),b=cell(basic,1,1);
 for(const insert of ['a|b','x\ny','**bold**','[x](https://example.com)','<b>x</b>','x\t'])assert.equal(mapTextEdit(basic,{from:a.from,to:a.to,insert}).ok,false,insert);
 assert.equal(mapTextEdit(basic,{from:a.from,to:b.to,insert:'No'}).ok,false);
 assert.equal(mapFormatEdit(basic,{action:'table-add-row',from:a.from,to:b.to}).ok,false);
 assert.equal(mapFormatEdit(basic,{action:'table-add-row',from:a.from,to:a.from,path:'/tmp/x'}).ok,false);
 assert.equal(mapFormatEdit(basic,{action:'bold',from:a.from,to:a.to}).ok,false);
 const emoji=basic.replace('Alpha','😀'),c=cell(emoji,1);assert.equal(mapTextEdit(emoji,{from:c.from+1,to:c.from+1,insert:'x'}).ok,false);
 assert.equal(p.blocks[0].cells.length,3);
});

for(const nl of ['\n','\r\n','\r'])test('all row/column positions retain rectangular shape, untouched neighbors and exact inverse '+JSON.stringify(nl),()=>{
 const table=['| H1 | H2 | H3 |','| :--- | :---: | ---: |','| A | B | C |','| D | E | F |'].join(nl);
 const base='Before'+nl+nl+table+nl+nl+'After'+nl;
 for(const action of ['table-add-row','table-delete-row','table-add-column','table-delete-column'])for(let row=0;row<3;row++)for(let col=0;col<3;col++){
  const r=command(base,action,row,col);if(action==='table-delete-row'&&row===0){assert.equal(r.ok,false);continue;}
  inverse(r,base);assert.ok(r.source.startsWith('Before'+nl+nl));assert.ok(r.source.endsWith(nl+nl+'After'+nl));
  const b=r.projection.blocks[1];assert.equal(b.cells.length,3+(action==='table-add-row'?1:action==='table-delete-row'?-1:0));
  assert.ok(b.cells.every(c=>c.length===3+(action==='table-add-column'?1:action==='table-delete-column'?-1:0)));
 }
});
test('column cap, source patch cap, invalid text and table-wide ranges reject without throwing',()=>{
 const wide='|'+Array(8).fill('H').join('|')+'|\n|'+Array(8).fill('---').join('|')+'|';assert.equal(command(wide,'table-add-column').ok,false);
 const big='|H|\n|---|\n|'+('x'.repeat(5000))+'|';assert.equal(command(big,'table-delete-row',1).ok,false);
 const c=cell(basic,1);for(const insert of ['\0','\ud800','a\u2028b'])assert.equal(mapTextEdit(basic,{from:c.from,to:c.to,insert}).ok,false);
 const b=projectSource(basic).blocks[0];assert.equal(mapTextEdit(basic,{from:0,to:b.to,insert:''}).ok,false);
 const s='Before\n\n'+basic+'\n\nAfter',p=projectSource(s);assert.equal(mapTextEdit(s,{from:1,to:p.spans.at(-1).to,insert:''}).ok,false);
});
