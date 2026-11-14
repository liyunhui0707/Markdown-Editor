import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {createSourceParser} from '../lib/document-source-parse.mjs';

const full = unified().use(remarkParse).use(remarkGfm);
const padding = Array.from({length:100},(_,i)=>`## Section ${i}\n\n${'Unchanged text. '.repeat(10)}\n\n`).join('');
function fixture(text,nl='\n') { return ('# Heading\n\n'+text+'\n\n'+padding+'[ref]: /target\n\n[ref]\n').replaceAll('\n',nl); }
function harness() { const calls=[];return {calls,parse:createSourceParser(s=>{calls.push(s);return full.parse(s);})}; }

test('long ordinary paragraph edits parse only that paragraph and match the complete parser',()=>{
 for(const nl of ['\n','\r\n','\r']) for(const text of ['Hello world.','中文 😀 e\u0301 ordinary.','See example.','Contact person.']) {
  const {parse,calls}=harness();let source=fixture(text,nl);parse(source);
  for(const nextText of [text+'x',text+'xyz',text.slice(0,2)+'新😀'+text.slice(3),text]) {
   const next=source.replace(source.split(nl+nl)[1],nextText);
   const tree=parse(next);assert.deepEqual(tree,full.parse(next));
   assert.equal(calls.at(-1),nextText,'the cold next revision parses a local paragraph');
   assert(Object.isFrozen(tree));assert(Object.isFrozen(tree.children));
   source=next;
  }
 }
});

test('document beginning and EOF offsets stay identical, including surrogate pairs and mixed newlines',()=>{
 for(const source of [padding+'Tail 😀', 'First 😀\r\n\r\n'+padding, padding+'Tail 😀\n']) {
  const {parse}=harness();parse(source);
  const next=source.replace(source.startsWith('First')?'First 😀':'Tail 😀','Changed 中文😀!');
  assert.deepEqual(parse(next),full.parse(next));
 }
});

test('structure, references, ambiguous boundaries and nonlocal changes use the complete parser',()=>{
 const replacements=['# Heading','---','[ref]','[new]: /other','<div>html</div>','www.example.com','a@example.com',
  'one\ntwo','    code','**bold**','x\\y','`code`','- item','> quote','hello  ',''];
 for(const replacement of replacements) {
  const {parse,calls}=harness(),source=fixture('Plain text.');parse(source);
  const next=source.replace('Plain text.',replacement);assert.deepEqual(parse(next),full.parse(next));
  assert.equal(calls.at(-1),['**bold**','`code`'].includes(replacement)?replacement:next,replacement);
 }
 for(const source of [padding+'- item\n\n    continuation',padding+'First\nsecond',padding+'Plain\n---',padding+'[ref]\n\n[ref]: /url']) {
  const {parse,calls}=harness();parse(source);const next=source.replace(/item|First|Plain|url/,'changed');
  assert.deepEqual(parse(next),full.parse(next));assert.equal(calls.at(-1),next);
 }
});

test('cache entries are immutable, bounded to two and cannot taint other source revisions',()=>{
 const {parse,calls}=harness(),source=fixture('Original.');const first=parse(source);
 assert.throws(()=>{first.children[0].depth=6;},TypeError);
 assert.equal(parse(source),first);assert.equal(calls.length,1);
 const next=source.replace('Original.','Changed.');assert.deepEqual(parse(next),full.parse(next));
 assert.equal(parse(source),first);
 parse('different source');parse('another source');const before=calls.length;
 assert.deepEqual(parse(source),full.parse(source));assert.equal(calls.length,before+1);
});

test('mixed Markdown context and sequential typing/deleting stay byte-position equivalent to cold parsing',()=>{
 const context='---\ntitle: synthetic\n---\n\n- item\n  - nested\n\n> quote\n\n```md\n[ref]\n```\n\n'
  +'| a | b |\n| - | - |\n| c | d |\n\n![alt](image.png)\n\n[label][ref]\n\n[ref]: /target\n\n';
 for(const nl of ['\n','\r\n','\r']) {
  const {parse}=harness();let text='Plain 中文😀 text.',source=(context+'MARKER\n\n'+padding).replace('MARKER',text).replaceAll('\n',nl);parse(source);
  const additions=['a','中','😀',' ','.','!','[ref]','\\*','**x**','<span>','\nline',':','@','www.example.com'];
  for(let i=0;i<80;i++) {
   const nextText=i%3===0?'Plain 中文😀 text.':text+additions[i%additions.length];
   const next=(context+'MARKER\n\n'+padding).replace('MARKER',nextText).replaceAll('\n',nl);
   assert.deepEqual(parse(next),full.parse(next),`newline ${JSON.stringify(nl)}, revision ${i}`);
   text=nextText;source=next;
  }
  // Two distant changes must not be mistaken for one isolated paragraph.
  const next=source.replace('nested','different').replace('Section 90','Section changed');
  assert.deepEqual(parse(next),full.parse(next));
 }
});
