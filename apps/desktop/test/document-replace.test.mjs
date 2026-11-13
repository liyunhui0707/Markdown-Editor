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
test('protected or cross-mark matches refuse the entire batch without partial source',()=>{
 for(const source of ['alpha **al**pha','alpha\n\n<div>alpha</div>']) {
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
