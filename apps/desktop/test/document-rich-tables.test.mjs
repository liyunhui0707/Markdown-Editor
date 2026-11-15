import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {linkSelection} from '../lib/document-link-edit.mjs';
import {findDocumentText} from '../lib/document-find-view.mjs';
import {planDocumentReplace} from '../lib/document-replace.mjs';
const schema=getSchema(documentEditorExtensions());
const values=['**bold**','*italic*','`code`','[link](https://old.invalid "keep")','[**`word`** plain](../guide.md \'title\')','**[link](target "keep")**'];
const table=(value,nl='\n')=>'| Name | **Status** |'+nl+'| :--- | ---: |'+nl+'| Before '+value+' tail | Other |';
function undo(r,source){assert(r.ok,JSON.stringify(r));const x=r.inverseSource;assert.equal(r.source.slice(0,x.from)+x.insert+r.source.slice(x.to),source);}
for(const nl of ['\n','\r\n','\r'])test('formatted table projection and text edits retain padding/alignment and native marks '+JSON.stringify(nl),()=>{
 for(const value of values){
  const source=table(value,nl)+nl+nl+'```md'+nl+'keep bytes'+nl+'```'+nl,p=projectSource(source);assert.equal(p.doc.content[0].type,'table',source);
  const doc=schema.nodeFromJSON(p.doc);doc.check();assert.equal(p.doc.content[0].content[0].content[1].attrs.align,'right');
  for(const s of p.spans.filter(s=>s.tableRow!==undefined))assert.equal(doc.textBetween(s.from,s.to),s.text);
  for(const s of p.spans.filter(s=>s.tableRow===1&&(s.bold||s.italic||s.code||s.link))){
   const from=s.from+1,r=mapTextEdit(source,{from,to:from,insert:'新😀'});undo(r,source);
   assert.equal(r.source,source.slice(0,s.sourceFrom+1)+'新😀'+source.slice(s.sourceFrom+1));assert.equal(r.structural,false);
   assert(EditorState.create({schema,doc}).tr.insertText('新😀',from).doc.eq(schema.nodeFromJSON(r.projection.doc)));
  }
 }
});
test('every accepted same-cell replacement agrees with native PM; cross-cell ranges are refused',()=>{
 let accepted=0;
 for(const value of values){const source=table(value),p=projectSource(source),b=p.blocks[0];assert(b?.cells,source);
  const cell=b.cells[1][0],doc=schema.nodeFromJSON(p.doc);
  for(let from=cell.from;from<cell.to;from+=2)for(let to=from+1;to<=Math.min(cell.to,from+8);to+=2){
   const r=mapTextEdit(source,{from,to,insert:'新'});if(!r.ok)continue;accepted++;undo(r,source);
   const tr=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)}).tr.insertText('新');assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));
  }
  assert.equal(mapTextEdit(source,{from:cell.from,to:b.cells[1][1].to,insert:'No'}).ok,false);
 }
 assert(accepted>100);
});
test('format and link commands act within one table leaf and preserve the rest of the table',()=>{
 for(const value of ['word','**word**','**`word`**','[word](https://old.invalid "keep")']){
  const source=table(value),p=projectSource(source),s=p.spans.find(s=>s.tableRow===1&&s.text.includes('word'));
  const from=s.from+s.text.indexOf('word'),to=from+4,doc=schema.nodeFromJSON(p.doc);
  for(const action of ['bold','italic','code']){
   const r=mapFormatEdit(source,{action,from,to});undo(r,source);const state=EditorState.create({schema,doc}),m=schema.marks[action];
   const tr=s[action]?state.tr.removeMark(from,to,m):state.tr.addMark(from,to,m.create());assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));
  }
  if(!s.link){const r=mapFormatEdit(source,{action:'set-link',from,to,label:'word',href:'#word'});undo(r,source);assert(r.projection.spans.find(s=>s.link));}
 }
});
test('formatted table link URL edits and unlink preserve original label wrappers/title bytes',()=>{
 const source=table('[**`word`** plain](https://old.invalid "keep title")'),p=projectSource(source),s=p.spans.find(s=>s.tableRow===1&&s.link);
 const c=linkSelection(source,{from:s.from,to:s.from});assert(c?.formattedLabel);assert.equal(c.label,'word plain');
 const changed=mapFormatEdit(source,{action:'set-link',from:s.from,to:s.from,label:c.label,href:'https://new.invalid'});undo(changed,source);
 assert.equal(changed.source,source.replace('https://old.invalid','<https://new.invalid>'));
 const removed=mapFormatEdit(source,{action:'remove-link',from:s.from,to:s.from});undo(removed,source);
 assert.equal(removed.source,table('**`word`** plain'));
 assert.equal(mapFormatEdit(source,{action:'set-link',from:s.from,to:s.from,label:'discard',href:'#new'}).ok,false);
});
test('row/column operations preserve rich cell spelling and return a valid cell caret',()=>{
 const source=table('[**`word`** plain](../guide.md \'keep\')','\r\n'),p=projectSource(source);assert(p.blocks[0]?.cells);
 const c=p.blocks[0].cells[1][1];
 for(const action of ['table-add-row','table-add-column','table-delete-column']){
  const r=mapFormatEdit(source,{action,from:c.from,to:c.from});undo(r,source);assert(r.source.includes('[**`word`** plain](../guide.md \'keep\')'));
  const pos=schema.nodeFromJSON(r.projection.doc).resolve(r.selection.from);assert.equal(pos.parent.type.name,'paragraph');assert.equal(pos.depth,4);
 }
});
test('find/replace across rich runs remains cell-scoped and matches native replacement',()=>{
 const source=table('**word** plain *tail*'),p=projectSource(source),doc=schema.nodeFromJSON(p.doc);
 const matches=findDocumentText(doc,'word plain tail').matches;assert.equal(matches.length,1);
 const r=planDocumentReplace(source,doc,matches,'新😀');assert(r.ok,JSON.stringify(r));assert.equal(r.source,table('**新😀**'));
 assert.equal(findDocumentText(doc,'tail Other').total,0);
});
test('normalized, reference, HTML, escaped-pipe and malformed edits stay protected',()=>{
 for(const value of ['a &amp; b','[label][ref]','<b>html</b>','``code``','a\\|b','![img](asset.png)']){
  const p=projectSource(table(value)+(value==='[label][ref]'?'\n\n[ref]: target':''));assert.equal(p.spans.some(s=>s.tableRow!==undefined),false,value);
 }
 const source=table('**word**'),p=projectSource(source);assert(p.blocks[0]?.cells);const c=p.blocks[0].cells[1][0];
 for(const insert of ['a|b','x\ny','a\tb','\ud800','**new**'])assert.equal(mapTextEdit(source,{from:c.from,to:c.to,insert}).ok,false,insert);
 assert.equal(mapFormatEdit(source,{action:'bold',from:c.from,to:p.blocks[0].cells[1][1].to}).ok,false);
});

test('header row zero supports formatting and links with the same exact parent/range checks',()=>{
 const source='| word | B |\r\n| :--- | ---: |\r\n| body | C |',p=projectSource(source),s=p.spans.find(s=>s.tableRow===0&&s.tableCol===0),from=s.from+1,to=from+4;
 const bold=mapFormatEdit(source,{action:'bold',from,to});undo(bold,source);assert.equal(bold.source,source.replace(' word ',' **word** '));
 const linked=mapFormatEdit(source,{action:'set-link',from,to,label:'word',href:'#header'});undo(linked,source);assert.equal(linked.source,source.replace(' word ',' [word](<#header>) '));
 const c=linked.projection.spans.find(s=>s.tableRow===0&&s.link),removed=mapFormatEdit(linked.source,{action:'remove-link',from:c.from,to:c.to});undo(removed,linked.source);assert.equal(removed.source,source);
});

test('clear a whole formatted cell and create a link in the empty slot without changing adjacent cells',()=>{
 for(const value of values){
  const source=table(value),p=projectSource(source),cell=p.blocks[0].cells[1][0],doc=schema.nodeFromJSON(p.doc);
  const cleared=mapTextEdit(source,{from:cell.from,to:cell.to,insert:''});undo(cleared,source);
  assert(EditorState.create({schema,doc}).tr.delete(cell.from,cell.to).doc.eq(schema.nodeFromJSON(cleared.projection.doc)));
  const empty=cleared.projection.blocks[0].cells[1][0];assert.equal(empty.text,'');
  const linked=mapFormatEdit(cleared.source,{action:'set-link',from:empty.from,to:empty.from,label:'New',href:'#new'});undo(linked,cleared.source);
  assert.equal(linked.projection.blocks[0].cells[1][0].text,'New');assert(linked.source.includes('[New](<#new>)'));assert(linked.source.endsWith('| Other |'));
 }
});
