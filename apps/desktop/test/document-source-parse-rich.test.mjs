import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {createSourceParser} from '../lib/document-source-parse.mjs';
const full=unified().use(remarkParse).use(remarkGfm);
const padding=Array.from({length:90},(_,i)=>`## Part ${i}\n\n${'Unchanged 中文 😀. '.repeat(12)}\n\n`).join('');
const context='---\ntitle: synthetic\n---\n\n- item\n  - nested\n\n> quoted\n\n```md\n**unparsed**\n```\n\n| a | b |\n| - | - |\n| c | d |\n\n[ref]: /target\n\n[ref]\n\n';
function harness(){const calls=[];return {calls,parse:createSourceParser(s=>{calls.push(s);return full.parse(s);})};}
function document(text,position,nl){return (position===0?text+'\n\n'+context+padding:position===1?context+text+'\n\n'+padding:context+padding+text).replaceAll('\n',nl);}

test('isolated formatted paragraphs and ATX headings reuse parsing with exact cold-parser positions',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const position of [0,1,2])for(const text of [
  'Plain **bold 中文😀** and *italic* plus `code` target.',
  '### Heading **bold** _italic_ `code` target. ###',
  'Plain ~~strike~~ and **nested *emphasis*** target.',
 ]) {
  const {calls,parse}=harness();let current=text;parse(document(current,position,nl));
  for(const change of [s=>s.replace('target','new😀target'),s=>s.replace('bold','粗体'),s=>s.replace('**','*'),s=>s.replace('target','target中'),()=>text]) {
   const next=change(current);if(next===current)continue;
   const source=document(next,position,nl),tree=parse(source);assert.deepEqual(tree,full.parse(source));
   assert.equal(calls.at(-1),next,'only the changed single-line block should be parsed');
   assert(Object.isFrozen(tree));for(const node of tree.children)assert(Object.isFrozen(node));current=next;
  }
 }
});

test('unsafe syntax, reference context, type changes and trailing margins retain full parsing',()=>{
 const original='Plain **bold** target.';
 for(const next of ['# Heading','---','- list','> quote','```js','[ref]','[new]: /url','<div>text</div>',
  'Plain **x**\\*', 'Plain **x**  ','Plain **x**\nnext','Plain **x** | y','www.example.com','a@example.com','']) {
  const {calls,parse}=harness();parse(document(original,1,'\n'));const source=document(next,1,'\n');
  assert.deepEqual(parse(source),full.parse(source));assert.equal(calls.at(-1),source,JSON.stringify(next));
 }
 for(const text of ['[label][ref]','**[ref]**','<https://example.com>','![alt](image.png)','    **code**','Plain **bold**\nsoft continuation']){
  const {calls,parse}=harness();parse(document(text,1,'\n'));const source=document(text.replace(/label|ref|alt|code|bold/,'changed'),1,'\n');
  assert.deepEqual(parse(source),full.parse(source));assert.equal(calls.at(-1),source,text);
 }
});

test('sequential formatted edits, two distant edits and adjacent structures remain cold-parser equivalent',()=>{
 const changes=['中文','😀','*','**','_','`','~~','&amp;','[ref]','\\*','<span>','\nnext',' | b',' ',':'];
 for(const nl of ['\n','\r\n','\r']) {
  const {parse}=harness();let text='## 中文 **bold** *italic* `code` target.';
  let source=document(text,1,nl);parse(source);
  for(let i=0;i<100;i++){
   text=i%5===0?'## 中文 **bold** *italic* `code` target.':text+changes[i%changes.length];
   source=document(text,1,nl);assert.deepEqual(parse(source),full.parse(source),`revision ${i}`);
  }
  source=source.replace('nested','changed').replace('Part 80','Part eighty');assert.deepEqual(parse(source),full.parse(source));
 }
 for(const gap of ['\n','\r\n','\r'])for(const tail of ['- list','> quote','---','[ref]: /new','```','| a | b |']) {
  const {parse}=harness();const before=padding+'**old**'+gap+tail;parse(before);
  const after=before.replace('**old**','**new😀**');assert.deepEqual(parse(after),full.parse(after));
 }
});
