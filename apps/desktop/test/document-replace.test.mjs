import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource} from '../lib/document-source-map.mjs';
import {findDocumentText} from '../lib/document-find-view.mjs';
import {planDocumentReplace} from '../lib/document-replace.mjs';
const schema=getSchema(documentEditorExtensions());
function plan(source,query,insert,all=true) {
 const doc=schema.nodeFromJSON(projectSource(source).doc),hits=findDocumentText(doc,query).matches;
 return planDocumentReplace(source,doc,all?hits:hits.slice(0,1),insert,{from:1,to:1});
}
test('batch preserves mixed newlines, Markdown marks, URLs and frontmatter exactly',()=>{
 const source='---\r\nprivate: hidden\r\n---\n# alpha\r\n\r\nalpha **alpha** *alpha* [alpha](https://alpha.invalid)\n\n> alpha\n\n- alpha\n\n```js\nalpha\n```\n\n| alpha | b |\n| --- | --- |\n| alpha | c |\n';
 const result=plan(source,'alpha','中文😀');assert.equal(result.ok,true);assert.equal(result.count,10);
 assert(result.source.includes('private: hidden\r\n'));assert(result.source.includes('https://alpha.invalid'));
 assert.equal(result.source,source.replace(/alpha/g,(s,at)=>source.slice(at-8,at)==='https://'?s:'中文😀'));
});
test('single replacement, deletion, literal syntax and same-text no-op',()=>{
 assert.equal(plan('alpha alpha','alpha','beta',false).source,'beta alpha');
 assert.equal(plan('x alpha y alpha z','alpha','').source,'x  y  z');
 assert.equal(plan('alpha','alpha','alpha').source,'alpha');
 assert.equal(plan('a.b a.b','a.b','x.y').source,'x.y x.y');
 assert.equal(plan('alpha','alpha','# ').ok,false);
 assert.equal(plan('alpha','alpha','**bold**').ok,false);
});
test('protected or soft-line matches refuse the entire batch without partial source',()=>{
 for(const source of ['alpha\n\n<div>alpha</div>']) {
  const result=plan(source,'alpha','beta');assert.equal(result.ok,false);assert.equal(result.source,undefined);
 }
});
test('invalid replacement, stale projection, oversized and split-surrogate ranges are refused',()=>{
 for(const insert of ['\0','a\nb','a\rb','\ud800','x'.repeat(4097)])assert.equal(plan('alpha','alpha',insert).ok,false);
 const doc=schema.nodeFromJSON(projectSource('😀 alpha').doc);
 assert.equal(planDocumentReplace('other',doc,[{from:4,to:9}],'beta').ok,false);
 assert.equal(planDocumentReplace('😀 alpha',doc,[{from:1,to:2}],'x').ok,false);
 assert.equal(planDocumentReplace('😀 alpha',doc,Array(1001).fill({from:4,to:9}),'x').ok,false);
});
test('capacity and Markdown structural effects are checked on the complete candidate',()=>{
 assert.equal(plan('a'.repeat(524280),'aaa','x'.repeat(4096)).ok,false);
 const r=plan('alpha **alpha**','alpha','');assert.equal(r.ok,false);
});

test('cross-format replacements inherit the first selected text style and preserve outside destinations',()=>{
 const cases=[
  ['before **alpha** beta after','alpha beta','new','before **new** after'],
  ['# before *alpha* beta after','alpha beta','new','# before *new* after'],
  ['before [alpha](https://example.invalid "title") beta after','alpha beta','new','before [new](https://example.invalid "title") after'],
  ['before alpha [beta](https://example.invalid) after','alpha beta','new','before new after'],
  ['> before **alpha** beta after','alpha beta','new','> before **new** after'],
  ['- before **alpha** beta after','alpha beta','new','- before **new** after'],
 ];
 for(const [source,query,insert,expected] of cases){const result=plan(source,query,insert);assert.equal(result.ok,true,source);assert.equal(result.source,expected);}
 const source='a **al**pha z\r\n\r\na **al**pha z\n';
 assert.equal(plan(source,'alpha','中😀').source,'a **中😀** z\r\n\r\na **中😀** z\n');
});

test('cross-format edits agree with native PM replacement and preserve exact source inverses',async()=>{
 const {mapTextEdit}=await import('../lib/document-source-map.mjs');
 const {EditorState,TextSelection}=await import('@tiptap/pm/state');
 let accepted=0;
 for(const prefix of ['','# ','> ','- ']){
  const source=prefix+'A **粗体** *italic* `code` [link](<https://example.invalid> "title") Z\r\n';
  const projection=projectSource(source),doc=schema.nodeFromJSON(projection.doc);
  const first=projection.spans[0],last=projection.spans.at(-1);
  for(let from=first.from;from<last.to;from++)for(let to=from+1;to<=last.to;to++)for(const insert of ['X','']){
   const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,from,to)});
   const intended=state.tr.insertText(insert),mapped=mapTextEdit(source,{from,to,insert});
   if(!mapped.ok)continue;
   accepted++;
   assert(intended.doc.eq(schema.nodeFromJSON(mapped.projection.doc)),`${prefix}:${from}-${to}`);
   const inverse=mapped.inverseSource||{from:mapped.change.from,to:mapped.change.from+mapped.change.insert.length,insert:source.slice(mapped.change.from,mapped.change.to)};
   assert.equal(mapped.source.slice(0,inverse.from)+inverse.insert+mapped.source.slice(inverse.to),source);
  }
 }
 assert(accepted>500);
});

test('two cross-mark hits sharing a delimiter pair are replanned atomically',()=>{
 const result=plan('a**bcqab**c','abc','X');assert.equal(result.ok,true);assert.equal(result.source,'X**qX**');assert.equal(result.count,2);
});

test('large cross-format batches stop at the planning budget without partial output',()=>{
 const source=('**a**b '.repeat(80)).padEnd(500000,'z');
 const result=plan(source,'ab','X');
 assert.equal(result.ok,false);assert.equal(result.code,'replacement-budget');assert.equal(result.source,undefined);
});
