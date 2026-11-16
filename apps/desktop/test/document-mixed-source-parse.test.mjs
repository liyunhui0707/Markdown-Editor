import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {createSourceParser} from '../lib/document-source-parse.mjs';
const cold=unified().use(remarkParse).use(remarkGfm);
const padding=Array.from({length:100},(_,i)=>`## Section ${i}\n\nUnchanged **body** [link](guide "keep") ${'text '.repeat(20)}\n\n`).join('');
const wrap=(body,nl='\n')=>('# Start\n\n'+body+'\n\n'+padding+'[known]: /outside\n\n[known]\n').replaceAll('\n',nl);
function harness(){const calls=[];return {calls,parse:createSourceParser(s=>{calls.push(s);return cold.parse(s);})};}
const blocks=[
 'Paragraph **bold *both* tail** [label](../guide.md "keep") and `code` target.',
 '## Heading [label](../guide.md "keep") target.',
 '- [X] First **target**\n  continued [label](guide "keep")\n- [ ] Next',
 '3) First **target**\n   continued [label](guide "keep")\n4) Next',
 '- Parent\n  - Child **target** [label](guide "keep")\n  - Last',
 '> Quote **target**  \n> continued [label](guide "keep")',
 '> First [label](guide "keep")\n>\n> Second **target**',
];
for(const body of blocks)test('mixed inline edit reuses only its owned block: '+body.split('\n')[0],()=>{
 for(const nl of ['\n','\r\n','\r']){
  const h=harness();let text='target',source=wrap(body,nl);h.parse(source);
  for(const nextText of ['targetx','target中文😀','target next','target', 'ta**bold**rget']){
   const next=source.replace(text,nextText),before=h.calls.length,tree=h.parse(next);assert.deepEqual(tree,cold.parse(next));assert(Object.isFrozen(tree));
   const work=h.calls.slice(before);assert(work.length>0);assert(work.every(s=>s.length<2048),'a local edit must not parse the full long article');
   source=next;text=nextText;
  }
 }
});
test('link-label edits retain normalized URLs, titles, nested marks and exact cold positions',()=>{
 for(const body of ['[**target**](../a%20b.md "keep") end','A [target](<../a b.md> "title") end','A [target](guide "two words") and **tail**']){
  const h=harness();let source=wrap(body);h.parse(source);
  for(const text of ['targetx','target😀','target中']){const next=source.replace(/target(?:x|😀|中)?/,text);const n=h.calls.length;assert.deepEqual(h.parse(next),cold.parse(next));assert(h.calls.slice(n).every(x=>x.length<2048));source=next;}
 }
});
test('reference/definition, prefix, multiline and unsafe-container changes retain full parsing',()=>{
 const cases=[
  ['Plain target.','target','[known]'],['Plain target.','target','[known]: /changed'],
  ['- target','-','+'],['> target','>',''],['## target','##','###'],
  ['- target\n\n+ Neighbor','-','+'],['> target\n\nOutside','target','target\n> more'],
  ['Plain target.','target','www.example.com'],['Plain target.','target','a@example.com'],
  ['Plain target.','target','<span>unsafe</span>'],['Plain target.','target','a\\*b'],
  ['- ```text\n  target\n  ```','target','changed'],['> > target','target','changed'],
  ['| A | B |\n| - | - |\n| target | end |','target','changed'],
 ];
 for(const [body,from,to]of cases){const h=harness(),source=wrap(body),next=source.replace(from,to);h.parse(source);assert.deepEqual(h.parse(next),cold.parse(next),body);assert.equal(h.calls.at(-1),next,body);}
 // A new local-looking reference must resolve from the distant definition.
 for(const body of ['- target','> target','[label](guide) target']){const h=harness(),source=wrap(body);h.parse(source);const next=source.replace('target','[known]');assert.deepEqual(h.parse(next),cold.parse(next));assert.equal(h.calls.at(-1),next);}
});
test('context-dependent list spread, adjacent marker families and lazy lines match cold parsing',()=>{
 for(const body of ['- First\n\n  target\n\nOutside','- target\n\n+ Neighbor','3. target\n\n4) Neighbor','> target\ncontinued\n\nOutside','- target\n  continued\n\n    code']){
  const h=harness(),source=wrap(body);h.parse(source);for(const added of ['x',' 中','😀','**new**','[label](guide)']){const next=source.replace('target','target'+added);assert.deepEqual(h.parse(next),cold.parse(next),body+' '+added);}
 }
});
test('deterministic mixed edits preserve every AST field and two-revision immutability',()=>{
 let seed=29;const rand=n=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n;
 const changes=['x','中','😀',' ','*','_','`','[known]','[label](guide)','\\*','<b>','\nnext','\r\nnext','|'];
 for(const body of blocks){const h=harness();let source=wrap(body),tree=h.parse(source);for(let i=0;i<45;i++){
  const original=source,at=source.indexOf('target')+rand(7),text=changes[rand(changes.length)];const next=source.slice(0,at)+text+source.slice(at);const nextTree=h.parse(next);assert.deepEqual(nextTree,cold.parse(next),body+' step '+i);assert.deepEqual(tree,cold.parse(original));assert(Object.isFrozen(nextTree.children));
  if(i%3===0){source=next;tree=nextTree;}else{assert.equal(h.parse(original),tree);}
 }}
});

test('last multiline block changes an earlier row without shifting EOF column; CRLF tokenization stays exact',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const block of ['- target\n  last line','> target\n> last line']){
  const h=harness(),source=(padding+block).replaceAll('\n',nl);h.parse(source);const next=source.replace('target','longer target');assert.deepEqual(h.parse(next),cold.parse(next));
 }
 const h=harness(),source=wrap('> first\r\n> target');h.parse(source);
 const at=source.indexOf('\r\n')+1,next=source.slice(0,at)+'x'+source.slice(at);assert.deepEqual(h.parse(next),cold.parse(next));assert.equal(h.calls.at(-1),next);
});

test('unchanged pre-existing trailing margins do not force a full long-article parse',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const margin of [' ','  ','\t']){
  const h=harness(),source=wrap('A target [label](guide "keep").'+margin,nl);h.parse(source);const next=source.replace('target','target中');const before=h.calls.length;assert.deepEqual(h.parse(next),cold.parse(next));assert(h.calls.slice(before).every(x=>x.length<2048));
  const changed=next.replace('"keep").'+margin,'"keep").'+margin+' '),count=h.calls.length;assert.deepEqual(h.parse(changed),cold.parse(changed));
  if(margin.includes('\t'))assert.equal(h.calls.at(-1),changed);
  else assert(h.calls.slice(count).every(x=>x.length<2048),'bounded literal paragraph margins have their separate proof');
 }
});

test('failed local proof falls back to a cold parse; a full-parser failure is never cached',()=>{
 const source=wrap('A target [label](guide).');let failFull=false;const parse=createSourceParser(s=>{if(s.length<8192||failFull)throw Error('synthetic parser failure');return cold.parse(s);});
 parse(source);const next=source.replace('target','targetx');assert.deepEqual(parse(next),cold.parse(next));
 failFull=true;const third=next.replace('targetx','targety');assert.throws(()=>parse(third),/synthetic parser failure/);failFull=false;assert.deepEqual(parse(third),cold.parse(third));
});


test('adjacent paragraph/list/quote roots without blank gaps cannot reuse their neighbours',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const body of [
  'Earlier paragraph.\n- target\n- next', 'Earlier paragraph.\n> target',
  '- target\n# Following heading', '> target\n# Following heading',
  'Earlier paragraph.\n2. target',
 ]){
  const h=harness(),source=wrap(body,nl),next=source.replace('target','target中');h.parse(source);
  assert.deepEqual(h.parse(next),cold.parse(next));assert.equal(h.calls.at(-1),next,body);
 }
});
test('bare CR/LF insertions and deletions in CRLF/CR articles retain exact cold parsing',()=>{
 for(const nl of ['\r\n','\r'])for(const body of ['A **target** [link](guide).','- **target**\n  tail','> **target**\n> tail']){
  const source=wrap(body,nl),at=source.indexOf('target')+3;
  for(const inserted of ['\r','\n','\r\n'])for(const removed of [0,1]){
   const h=harness();h.parse(source);const next=source.slice(0,at)+inserted+source.slice(at+removed);
   assert.deepEqual(h.parse(next),cold.parse(next));assert.equal(h.calls.at(-1),next);
  }
 }
});
