import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {createSourceParser} from '../lib/document-source-parse.mjs';
const cold=unified().use(remarkParse).use(remarkGfm);
const padding=Array.from({length:100},(_,i)=>`## ${i}\n\nUnchanged **body** [link](guide "keep") ${'text '.repeat(20)}\n\n`).join('');
function frozen(value){
 if(!value||typeof value!=='object')return;
 assert(Object.isFrozen(value),'every cached node, position, point, array and metadata object must be immutable');
 for(const child of Object.values(value))frozen(child);
}
test('reused roots, translated suffixes and cold fallbacks remain deeply frozen and cold-parser equivalent',()=>{
 for(const nl of ['\n','\r\n','\r'])for(const head of ['Plain target.','**target** [label](guide "keep")','- [X] **target**\n  continued\n- Next','> **target**\n> continued']){
  const parse=createSourceParser(s=>cold.parse(s));
  const kept=[];
  for(const text of ['target','target中😀','target next','target','target\n\n> new structure','target']){
   const next=(head.replace('target',text)+'\n\n'+padding).replaceAll('\n',nl);
   const tree=parse(next);assert.deepEqual(tree,cold.parse(next));frozen(tree);
   kept.push({tree,copy:structuredClone(tree)});for(const previous of kept)assert.deepEqual(previous.tree,previous.copy);
   assert.throws(()=>{tree.children.at(-1).position.end.offset=0;},TypeError);
  }
 }
});
test('position-free metadata and own special keys retain exact values without prototype mutation',()=>{
 const full=s=>{const tree=cold.parse(s);for(const n of tree.children)n.data=JSON.parse('{"__proto__":{"safe":true},"constructor":"literal","rows":[null,{"value":1}]}');return tree;};
 const parse=createSourceParser(full),source='Plain target.\n\n'+padding;parse(source);
 const next=source.replace('target','target😀'),tree=parse(next);assert.deepEqual(tree,full(next));frozen(tree);
 for(const n of tree.children){assert.equal(Object.getPrototypeOf(n.data),Object.prototype);assert(Object.hasOwn(n.data,'__proto__'));assert.equal(n.data.__proto__.safe,true);}
 assert.equal(Object.prototype.safe,undefined);
});
