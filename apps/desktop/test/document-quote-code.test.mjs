import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const command=(source,action,from,to=from)=>mapFormatEdit(source,{action,from,to});
const inverse=r=>r.source.slice(0,r.inverseSource.from)+r.inverseSource.insert+r.source.slice(r.inverseSource.to);
const schema=getSchema(documentEditorExtensions());
for(const nl of ['\n','\r\n','\r']) {
 test(`quote projection and editing preserve syntax ${JSON.stringify(nl)}`,()=>{
  const source=['Before.','','> First **bold** tail','> ','> Second','','After.'].join(nl),p=projectSource(source);
  assert.equal(p.doc.content[1].type,'blockquote');assert.equal(p.doc.content[1].content.length,2);
  const span=p.spans.find(s=>s.text==='Second');assert.ok(span);
  const r=mapTextEdit(source,{from:span.from,to:span.to,insert:'第二😀'});assert.equal(r.ok,true);assert.equal(r.source,source.replace('Second','第二😀'));
  const b=p.spans.find(s=>s.bold),marked=command(source,'italic',span.from,span.to);assert.equal(marked.ok,true);assert.equal(inverse(marked),source);
  const edit=mapTextEdit(source,{from:b.from,to:b.to,insert:'新的'});assert.equal(edit.ok,true);assert.equal(edit.source,source.replace('bold','新的'));
  assert.doesNotThrow(()=>schema.nodeFromJSON(r.projection.doc).check());
 });
 test(`quote create split join exit exact inverse ${JSON.stringify(nl)}`,()=>{
  let source='First second'+nl+nl+'Tail.';
  let r=command(source,'blockquote',1);assert.equal(r.ok,true);assert.equal(inverse(r),source);source=r.source;
  r=command(source,'split-quote',8);assert.equal(r.ok,true);assert.equal(r.source,'> First '+nl+'> '+nl+'> second'+nl+nl+'Tail.');assert.equal(inverse(r),source);source=r.source;
  let last=r.projection.spans.find(s=>s.text==='second');r=command(source,'join-quote',last.from);assert.equal(r.ok,true);assert.equal(r.source,'> First second'+nl+nl+'Tail.');source=r.source;
  r=command(source,'split-quote',14);assert.equal(r.ok,true);source=r.source;last=r.projection.spans.find(s=>s.quoteIndex===1);
  assert.equal(last.text,'');r=command(source,'split-quote',last.from);assert.equal(r.ok,true);assert.equal(r.source,'> First second'+nl+nl+nl+nl+'Tail.');assert.equal(inverse(r),source);
  assert.equal(r.projection.doc.content[1].type,'paragraph');assert.deepEqual(r.projection.doc.content[1].content,[]);
 });
 test(`fenced code text, multiline paste and empty body ${JSON.stringify(nl)}`,()=>{
  const source=['Before.','','```js','const x = {n: 1};','console.log(x);','```','','After.'].join(nl),p=projectSource(source),span=p.spans.find(s=>s.codeBlock);
  assert.ok(span);assert.equal(span.text,'const x = {n: 1};\nconsole.log(x);');assert.equal(p.doc.content[1].attrs.sourceEditable,true);
  const at=span.from+span.text.indexOf('console'),r=mapTextEdit(source,{from:at,to:span.to,insert:'\t// 中文\n\nreturn x;'});
  assert.equal(r.ok,true);assert.equal(r.source,source.replace('console.log(x);',['\t// 中文','','return x;'].join(nl)));assert.equal(inverse(r),source);
  const cleared=mapTextEdit(source,{from:span.from,to:span.to,insert:''});assert.equal(cleared.ok,true);assert.equal(cleared.projection.spans.find(s=>s.codeBlock).text,'');assert.equal(inverse(cleared),source);
  const empty='```'+nl+'```',e=projectSource(empty).spans[0],typed=mapTextEdit(empty,{from:e.from,to:e.to,insert:'x\ny'});
  assert.equal(typed.ok,true);assert.equal(typed.source,['```','x','y','```'].join(nl));assert.equal(inverse(typed),empty);
  assert.doesNotThrow(()=>schema.nodeFromJSON(r.projection.doc).check());
 });
}
test('natural quote/fence prefixes and block conversion/exit',()=>{
 for(const s of ['>','`','``','```','```js'])assert.equal(projectSource(s).doc.content[0].type,'paragraph',s);
 let r=command('>','block-shortcut',2);assert.equal(r.ok,true);assert.equal(r.source,'> ');assert.equal(r.selection.from,2);
 r=command('```js','fence-shortcut',6);assert.equal(r.ok,true);assert.equal(r.source,'```js\n```');assert.equal(r.projection.doc.content[0].attrs.language,'js');
 r=command('code','code-block',3);assert.equal(r.ok,true);assert.equal(r.source,'```\ncode\n```');
 const exit=command(r.source,'exit-block',3);assert.equal(exit.ok,true);assert.equal(exit.source,r.source+'\n\n');assert.equal(exit.projection.doc.content[1].type,'paragraph');
 assert.equal(command('```\ncode\n```','paragraph',1).source,'code');
 assert.equal(command('> a\n> \n> b','paragraph',2).source,'a\n\nb');
});
test('nested/lazy quote and unclosed/metadata/indented fences stay protected',()=>{
 for(const source of ['> > nested','> # Heading','> - list','> lazy\ncontinuation','> line\n> wrapped','```js\nunfinished','```js extra\nx\n```','    code'])assert.equal(projectSource(source).spans.length,0,source);
 const source='```\ntext\n```',span=projectSource(source).spans[0];
 assert.equal(mapTextEdit(source,{from:span.from,to:span.to,insert:'```\n# escape'}).ok,false);
 assert.equal(command(source,'bold',span.from,span.to).ok,false);
 assert.equal(command('> one\n> \n> two','blockquote',2,10).ok,false);
 assert.equal(command('x','exit-block',1).ok,false);
 assert.equal(mapFormatEdit('x',{action:'code-block',from:1,to:1,path:'/tmp/forbidden'}).ok,false);
 const emoji='```\n😀\n```';assert.equal(mapTextEdit(emoji,{from:2,to:2,insert:'x'}).ok,false);
});

for(const nl of ['\n','\r\n','\r']) test(`typing a fence before the original terminal newline preserves it ${JSON.stringify(nl)}`,()=>{
  let source='Before'+nl+nl+nl;
  for(const char of '```js'){
    const at=projectSource(source).spans.at(-1).to;
    const r=mapTextEdit(source,{from:at,to:at,insert:char});assert.equal(r.ok,true,JSON.stringify(source+char));source=r.source;
  }
  assert.equal(source,'Before'+nl+nl+'```js'+nl);
  const at=projectSource(source).spans.at(-1).to,r=command(source,'fence-shortcut',at);
  assert.equal(r.ok,true);assert.equal(r.source,'Before'+nl+nl+'```js'+nl+'```'+nl);assert.equal(inverse(r),source);
  assert.equal(projectSource('```js'+nl+'unfinished'+nl).spans.length,0);
});
