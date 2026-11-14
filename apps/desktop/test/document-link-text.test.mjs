import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const span=s=>{const p=projectSource(s).spans.find(p=>p.link);assert.ok(p,s);return p;};
for(const nl of ['\n','\r\n','\r'])for(const prefix of ['', '## ', '- ', '7) '])test(`link label preserves target/title and untouched bytes ${JSON.stringify([nl,prefix])}`,()=>{
 const before='---'+nl+'keep: yes'+nl+'---'+nl+nl+prefix+'A [中文😀](<https://example.test/a?q=1&b=2> "原始 title") Z'+nl+nl+'```md'+nl+'Keep []'+nl+'```'+nl;
 const p=span(before);assert.equal(p.text,'中文😀');assert.deepEqual(p.link,{href:'https://example.test/a?q=1&b=2',title:'原始 title'});
 for(const [a,b,insert] of [[1,1,'新'],[0,4,'New'],[0,1,''],[2,4,'🙂']]){
  const r=mapTextEdit(before,{from:p.from+a,to:p.from+b,insert});assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.source,before.slice(0,p.sourceFrom+a)+insert+before.slice(p.sourceFrom+b));
  assert.equal(mapTextEdit(r.source,{from:p.from+a,to:p.from+a+insert.length,insert:p.text.slice(a,b)},r.leaf).source,before);
 }
 assert.equal(mapTextEdit(before,{from:p.from+3,to:p.from+3,insert:'x'}).ok,false);
});
test('only exact single-line text labels project; references/nesting/autolinks remain protected',()=>{
 for(const s of ['[label](../other.md#section)','[label](a(b))',"[label](target 'title')",'[label](javascript:alert(1))','[label](data:text/html,test)'])assert.equal(span(s).text,'label');
 for(const s of ['[**label**](x)','*[label](x)*','[a &amp; b](x)','[a\\[b](x)','[a\nb](x)','[label][ref]\n\n[ref]: target','<https://example.test>','https://example.test','![label](x)','[]()'])assert.equal(projectSource(s).spans.length,0,s);
});
test('link structural edits refuse safely; surrounding text and selected label deletion remain editable',()=>{
 const s='A [label](target "title") **bold** Z',p=span(s);
 for(const c of [{from:p.from+1,to:p.from+1,insert:'](other)'},{from:p.from+1,to:p.from+1,insert:'\n'}])assert.equal(mapTextEdit(s,c).ok,false,JSON.stringify(c));
 for(const action of ['bold','italic','code','split-paragraph'])assert.equal(mapFormatEdit(s,{action,from:p.from+1,to:action==='split-paragraph'?p.from+1:p.to-1}).ok,false,action);
 const plain=projectSource(s).spans[0];assert.equal(mapTextEdit(s,{from:plain.from+1,to:plain.from+1,insert:'new'}).source,'Anew [label](target "title") **bold** Z');
 const all=span('[label](x)');assert.equal(mapTextEdit('[label](x)',{from:all.from,to:all.to,insert:''}).source,'');
 const item=span('- [label](x)');assert.equal(mapTextEdit('- [label](x)',{from:item.from,to:item.to,insert:''}).ok,false);
});

test('every accepted link edit agrees with the product ProseMirror schema',async()=>{
 const {getSchema}=await import('@tiptap/core'),{EditorState,TextSelection}=await import('@tiptap/pm/state');
 const {documentEditorExtensions}=await import('../lib/document-editor-extensions.mjs');
 const schema=getSchema(documentEditorExtensions());let accepted=0;
 for(const source of ['A [label](target "title") Z','- [one](../one) **bold**\n- [two](https://example.test)', '[all](javascript:alert(1))']){
  const p=projectSource(source),doc=schema.nodeFromJSON(p.doc);
  for(const a of p.spans)for(const b of p.spans)for(let from=a.from;from<=a.to;from++)for(let to=b.from;to<=b.to;to++){
   if(from>to)continue;
   for(const insert of ['文','']){
    const r=mapTextEdit(source,{from,to,insert});if(!r.ok)continue;accepted++;
    const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
    assert.deepEqual(schema.nodeFromJSON(r.projection.doc).toJSON(),state.tr.insertText(insert).doc.toJSON(),JSON.stringify({source,from,to,insert}));
   }
  }
 }
 assert(accepted>100);
});

test('existing block conversions preserve link syntax and exact inverse',()=>{
 for(const prefix of ['', '## ', '- '])for(const action of ['paragraph','heading-2','bullet-list','ordered-list']){
  if(prefix==='- '&&action==='heading-2')continue;
  const source=prefix+'A [label](<../other.md> "title") Z',p=span(source),r=mapFormatEdit(source,{action,from:p.from+1,to:p.from+1});
  assert.equal(r.ok,true,JSON.stringify({prefix,action,r}));assert.ok(r.source.includes('[label](<../other.md> "title")'));
  const c=r.inverseSource;assert.equal(r.source.slice(0,c.from)+c.insert+r.source.slice(c.to),source);
 }
});
