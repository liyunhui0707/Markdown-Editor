import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {createSourceParser} from '../lib/document-source-parse.mjs';
const cold=unified().use(remarkParse).use(remarkGfm);
const padding=Array.from({length:100},(_,i)=>`## ${i}\n\nUnchanged **body** [link](guide) ${'text '.repeat(20)}\n\n`).join('');
test('literal trailing-space transitions in bounded isolated paragraphs remain local and cold-equivalent',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const where of [0,1,2])for(const prefix of ['Plain target.','**bold** [label](guide "keep") target.']){
  const wrap=text=>(where===0?text+'\n\n'+padding:where===1?padding+text+'\n\n## Tail\n\nIntact.':padding+text+'\n').replaceAll('\n',nl);
  const calls=[],parse=createSourceParser(s=>{calls.push(s);return cold.parse(s);});parse(wrap(prefix));
  for(const suffix of [' ','  ',' a',' a中😀',' ','']){
   const source=wrap(prefix+suffix),before=calls.length,tree=parse(source);
   assert.deepEqual(tree,cold.parse(source));assert(Object.isFrozen(tree));
   assert(calls.slice(before).every(s=>s.length<=4096),'one Space or first word letter must not reparse the complete article');
  }
 }
});
test('tabs, syntax, long blocks and non-paragraph margin transitions retain full parsing',()=>{
 const cases=[['Plain target. ','Plain target.\t'],['Plain target.\t','Plain target.\ta'],
  ['Plain target. ','Plain target. *x*'],['## target','## target '],['- target','- target '],
  ['> target','> target '],['first\nlast','first\nlast '],['x'.repeat(9000),'x'.repeat(9000)+' ']];
 for(const [before,after]of cases){
  const calls=[],parse=createSourceParser(s=>{calls.push(s);return cold.parse(s);});parse(padding+before);
  const source=padding+after;assert.deepEqual(parse(source),cold.parse(source));assert.equal(calls.at(-1),source);
 }
});
