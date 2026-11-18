import test from 'node:test';
import assert from 'node:assert/strict';
import {equalCanonicalProjection} from '../lib/document-canonical-equal.mjs';
import {canonicalDocument} from '../lib/document-prose-range.mjs';
import {projectSource} from '../lib/document-source-map.mjs';
const oracle=(a,b)=>JSON.stringify(canonicalDocument(a))===JSON.stringify(canonicalDocument(b));
const text=(value,marks)=>({type:'text',text:value,...(marks?{marks}:{} )});
const paragraph=content=>({type:'paragraph',content});
const doc=content=>({type:'doc',content});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
test('streaming comparison matches complete canonical JSON without mutating either tree',()=>{
 const marks=[{type:'bold'}],link=[{type:'link',attrs:{href:'guide',title:'keep'}}];
 const samples=[doc([]),doc([paragraph([])]),doc([paragraph([text('ab',marks),text('cd',marks),text('e'),text('f')])]),
  doc([paragraph([text('abcd',marks),text('ef')])]),doc([paragraph([text('ab',marks),text('cd',link)])]),
  projectSource('# Title\n\n**bold** *italic* [label](guide "keep")\n\n- [X] task\n  continuation\n- Next\n\n> quote\n\n| A | B |\n| --- | --- |\n| cell | other |').doc];
 for(const a of samples)for(const b of samples){freeze(a);freeze(b);assert.equal(equalCanonicalProjection(a,b),oracle(a,b));}
 assert.equal(equalCanonicalProjection({type:'doc',content:[]},{content:[],type:'doc'}),false);
});
test('all neighbors, mark attributes, text boundaries and nested content participate',()=>{
 const source='First **bold** [label](guide "title").\n\n- [X] task\n  continued\n- next\n\n> quote\n\n| A | B |\n| --- | --- |\n| cell | other |';
 const original=projectSource(source).doc;
 for(const altered of [source.replace('other','DIFFERENT'),source.replace('guide','elsewhere'),source.replace('title','new title'),source.replace('[X]','[ ]'),source.replace('quote','quoted')]){
  const other=projectSource(altered).doc;assert.equal(oracle(original,other),false);assert.equal(equalCanonicalProjection(original,other),false);
 }
 const marked=doc([paragraph([text('ab',[{type:'bold'}]),text('cd',[{type:'italic'}])])]);
 assert.equal(equalCanonicalProjection(marked,doc([paragraph([text('abcd',[{type:'bold'}])])])),false);
});
test('deterministic fragmented text matrix retains the previous normalization contract',()=>{
 for(let seed=0;seed<120;seed++){
  const marks=seed%3?[{type:seed%2?'bold':'italic'}]:undefined;
  const value='中文😀 '+seed+' text',parts=[text(value.slice(0,2),marks),text(value.slice(2,4),marks),text(value.slice(4),marks)];
  const a=doc([paragraph([text('before')]),{type:'blockquote',content:[paragraph(parts)]},paragraph([text('after')])]);
  const b=doc([paragraph([text('before')]),{type:'blockquote',content:[paragraph([text(value,marks)])]},paragraph([text('after')])]);
  freeze(a);freeze(b);assert(oracle(a,b));assert(equalCanonicalProjection(a,b));
  const changed=structuredClone(b);changed.content.at(-1).content[0].text+='x';assert.equal(equalCanonicalProjection(a,changed),oracle(a,changed));
 }
});
