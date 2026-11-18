import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const schema=getSchema(documentEditorExtensions());
const lists='- [X] First **one**\n\n  Second [label](guide "keep")\n  wrapped\n\n  - Child\n- Next';
const quotes='> Outer\n> \n> > Inner **bold**\n> > \n> > Second\n> \n> Tail';
const row=(p,text)=>p.blocks.flatMap(b=>b?.containerRows||[]).find(r=>r.parts.map(p=>p.text).join('')===text);
function exact(source,result){assert.equal(result.ok,true,JSON.stringify(result));const u=result.inverseSource;assert.equal(result.source.slice(0,u.from)+u.insert+result.source.slice(u.to),source);schema.nodeFromJSON(result.projection.doc).check();return result;}
for(const nl of ['\n','\r\n','\r'])test('multi-paragraph list and nested quote project real paragraphs '+JSON.stringify(nl),()=>{
 for(const raw of [lists,quotes]){
  const source=raw.replaceAll('\n',nl),p=projectSource(source);assert.notEqual(p.doc.content[0].type,'codeBlock');schema.nodeFromJSON(p.doc).check();
  assert(p.blocks[0].containerRows.length>=4);for(const r of p.blocks[0].containerRows)assert(r.path.length>0);
  const s=p.spans.find(s=>s.text==='Second '||s.text==='Second');assert(s);
  const result=exact(source,mapTextEdit(source,{from:s.from,to:s.from+3,insert:'中文😀'}));
  assert.equal(result.source,source.replace('Second','中文😀ond'));
 }
});
test('whole unsupported child structures remain protected',()=>{
 for(const source of ['- A\n\n  ```js\n  code\n  ```','> > &amp;','> > First\nlazy',Array.from({length:7},(_,i)=>'> '.repeat(i+1)+'Deep').join('\n')]){
  const p=projectSource(source);assert.equal(p.doc.content[0].type,'documentPreview');
  assert.equal(p.spans.length,0);assert.equal(mapTextEdit(source,{from:0,to:1,insert:'x'}).ok,false);
 }
});

const command=(source,text,action,offset=0,end=offset)=>{
 const p=projectSource(source),r=row(p,text)||p.blocks[0].items?.find(r=>source.slice(r.bodyFrom,r.sourceTo)===text)||p.blocks[0].quoteRows?.find(r=>source.slice(r.bodyFrom,r.sourceTo)===text);assert(r,text);
 return exact(source,mapFormatEdit(source,{action,from:r.from+offset,to:r.from+end}));
};
for(const nl of ['\n','\r\n','\r'])test('paragraph and item split/join preserve task, child list and byte spelling '+JSON.stringify(nl),()=>{
 const s=lists.replaceAll('\n',nl),p=projectSource(s),r=row(p,'Second label wrapped');assert(r);
 const split=exact(s,mapFormatEdit(s,{action:'split-list',from:r.from+3,to:r.from+3}));
 assert.equal(split.source,s.replace('Second','Sec'+nl+nl+'- [ ] ond'));
 const q=projectSource(split.source),next=q.blocks[0].containerRows.find(r=>r.parts.map(p=>p.text).join('')==='ond label wrapped');assert(next);
 const joined=exact(split.source,mapFormatEdit(split.source,{action:'join-list',from:next.from,to:next.from}));assert.equal(joined.source,s);
 const toggle=command(s,'Second label wrapped','toggle-task',2);assert.equal(toggle.source,s.replace('[X]','[ ]'));
 const simple='- [X] Alpha'+nl+'- Tail';
 const added=command(simple,'Alpha','list-paragraph',2);assert.equal(added.source,'- [X] Al'+nl+nl+'  pha'+nl+'- Tail');
 const back=command(added.source,'pha','join-list');assert.equal(back.source,simple);
});
test('same-item and same-level selected replacement/paste preserve wrappers and reject cross-parent loss',()=>{
 for(const s of [lists,quotes]){
  const p=projectSource(s),rows=p.blocks[0].containerRows,r=rows[1];
  const paste=exact(s,mapTextEdit(s,{from:r.from+1,to:r.from+3,insert:'中文\n\n新段'}));assert(paste.source.includes('中文'));
  const p2=projectSource(paste.source),same=p2.blocks[0].containerRows.filter(n=>JSON.stringify(n.path.slice(0,-1))===JSON.stringify(r.path.slice(0,-1)));
  assert.equal(same.length,3);
  assert.equal(mapTextEdit(s,{from:rows[0].from,to:rows.at(-1).to,insert:'LOST'}).ok,false);
 }
});
test('nested quote split, join, nesting, lifting and exit retain outer siblings',()=>{
 const s=quotes,split=command(s,'Second','split-quote',3);assert.equal(split.source,s.replace('Second','Sec\n> > \n> > ond'));
 const joined=command(split.source,'ond','join-quote');assert.equal(joined.source,s);
 const nested=command(s,'Second','blockquote',2);assert.equal(nested.source,s.replace('> > Second','> > > Second'));
 const lifted=command(nested.source,'Second','paragraph',2);assert.equal(lifted.source,s);
 const first=command(s,'Inner bold','join-quote');assert.equal(first.source,s.replace('> > Inner **bold**\n> > \n','> Inner **bold**\n> \n'));
 const exit=command(s,'Second','exit-block',1);assert.equal(exit.source,s+'\n\n');
});
test('container inline marks, link address and emphasis-boundary Space use complete proof',()=>{
 const s=lists,p=projectSource(s),r=row(p,'Second label wrapped');
 const formatted=exact(s,mapFormatEdit(s,{action:'italic',from:r.from,to:r.from+6}));assert.equal(formatted.source,s.replace('Second','*Second*'));
 const linked=p.spans.find(n=>n.text==='label');const link=exact(s,mapFormatEdit(s,{action:'set-link',from:linked.from,to:linked.to,label:'label',href:'../new.md'}));assert(link.source.includes('[label](<../new.md> "keep")'));
 const q=projectSource(quotes),b=q.spans.find(n=>n.text==='bold');const space=exact(quotes,mapTextEdit(quotes,{from:b.to,to:b.to,insert:' '}));assert(space.boundarySpace);assert(space.source.includes('**bold** '));
});
test('creation at paragraph edges retains an editable empty paragraph',()=>{
 // An empty first item paragraph followed by text is not representable in
 // CommonMark: it becomes a separate outer paragraph, so retain the refusal.
 assert.equal(mapFormatEdit('- Alpha',{action:'list-paragraph',from:3,to:3}).ok,false);
 for(const offset of [5]){
  const r=command('- Alpha','Alpha','list-paragraph',offset),p=projectSource(r.source),empty=p.blocks[0].containerRows.find(r=>r.from===r.to);assert(empty);
  const typed=exact(r.source,mapTextEdit(r.source,{from:empty.from,to:empty.to,insert:'新'}));assert(typed.source.includes('新'));
 }
 for(const offset of [0,6]){
  const split=command(quotes,'Second','split-quote',offset),p=projectSource(split.source),empty=p.blocks[0].containerRows.find(r=>r.from===r.to);assert(empty);
  exact(split.source,mapTextEdit(split.source,{from:empty.from,to:empty.to,insert:'新'}));
 }
 assert.equal(projectSource('> Outer\n> > Inner').doc.content[0].type,'blockquote');
});
test('list empty paragraph slots remain owned before siblings and child lists',()=>{
 for(const source of ['- Alpha\n- Tail','- Alpha\n\n  - Child','- Parent\n  - Alpha']){
  const p=projectSource(source),span=p.spans.find(s=>s.text==='Alpha'),result=exact(source,mapFormatEdit(source,{action:'list-paragraph',from:span.to,to:span.to}));
  const next=projectSource(result.source),empty=next.blocks[0].containerRows.find(r=>r.from===r.to);assert(empty,source);
  exact(result.source,mapTextEdit(result.source,{from:empty.from,to:empty.to,insert:'New'}));
 }
});
test('ordered width changes keep following paragraphs and children during split/join',()=>{
 const source='9) Alpha\n\n   Second\n\n   - Child\n12) Tail',p=projectSource(source),first=row(p,'Alpha');
 const split=exact(source,mapFormatEdit(source,{action:'split-list',from:first.from+2,to:first.from+2}));
 assert.equal(split.source,'9) Al\n\n10) pha\n\n    Second\n\n    - Child\n12) Tail');
 assert.equal(command(split.source,'pha','join-list').source,source);
});
test('indent/outdent move a complete multi-paragraph task subtree without flattening',()=>{
 const source='- Before\n- [X] Alpha\n\n  Second\n\n  - Child\n- Tail';
 const indented=command(source,'Second','indent-list',2);assert.equal(indented.source,'- Before\n  - [X] Alpha\n\n    Second\n\n    - Child\n- Tail');
 assert.equal(command(indented.source,'Second','outdent-list',2).source,source);
});
test('bounded container range matrix agrees with complete PM edits and exact inverses',()=>{
 let accepted=0;
 for(const source of ['- A **中😀**\n\n  B *tail*','> > A **中😀**\n> > \n> > B *tail*']){
  const p=projectSource(source),doc=schema.nodeFromJSON(p.doc),rows=p.blocks[0].containerRows;
  for(let from=rows[0].from;from<=rows.at(-1).to;from++)for(let to=from;to<=rows.at(-1).to;to++)for(const insert of ['','新😀',' ']){
   const r=mapTextEdit(source,{from,to,insert});if(!r.ok)continue;exact(source,r);
   const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,to,from)});
   const tr=r.boundarySpace?state.tr.replaceWith(from,to,schema.text(insert,r.spaceMarks.map(m=>schema.markFromJSON(m)))):state.tr.insertText(insert);
   assert(tr.doc.eq(schema.nodeFromJSON(r.projection.doc)));accepted++;
  }
 }
 assert(accepted>100);
});
test('row/depth budgets and unsafe payloads never produce partial edits',()=>{
 const source='- A\n\n'+Array.from({length:31},(_,i)=>'  Row'+i).join('\n\n'),p=projectSource(source),r=p.blocks[0].containerRows[0];
 assert.equal(p.blocks[0].containerRows.length,32);assert.equal(mapFormatEdit(source,{action:'list-paragraph',from:r.to,to:r.to}).ok,false);
 const depth='> '.repeat(6)+'Deep',q=projectSource(depth),s=q.spans[0];assert.equal(mapFormatEdit(depth,{action:'blockquote',from:s.from,to:s.from}).ok,false);
 for(const insert of ['\ud800','x'.repeat(4097),'a\tb','a\rb'])assert.equal(mapTextEdit(quotes,{from:row(projectSource(quotes),'Second').from,to:row(projectSource(quotes),'Second').to,insert}).ok,false);
 const simple='> > First',split=command(simple,'First','split-quote',5),empty=projectSource(split.source).blocks[0].containerRows.find(r=>r.from===r.to);assert(empty);
 exact(split.source,mapFormatEdit(split.source,{action:'split-quote',from:empty.from,to:empty.to}));
});
