import {renderArticleParts,articleNodes,splitArticleParts} from './document-article-source.mjs';
import {inlineFrames} from './document-inline-tree.mjs';
import sourceEdits from './document-source-edit.js';
const reject=()=>({ok:false,code:'unsafe-source-range'});
const paragraph=parts=>({type:'paragraph',content:articleNodes(parts)});

// Only already-projected top-level prose. Reuse lexical article parts; for plain
// soft wrapping retain the exact physical newline as a source-only space token.
function proseParts(source,p,index){
 const block=p.blocks[index],node=p.doc.content[index];if(!block||!['paragraph','heading'].includes(node?.type))return null;
 if(block.article)return block.parts;
 const spans=p.spans.filter(s=>s.blockIndex===index),parts=[];let at=block.sourceFrom;
 if(!spans.length||spans.some(s=>s.itemIndex!==undefined||s.quoteIndex!==undefined||s.tableRow!==undefined||s.codeBlock))return null;
 for(const span of spans){
  const frames=inlineFrames(span,source),start=frames[0]?.from??span.sourceFrom;
  if(span.textOffset!==undefined&&start!==at){const raw=source.slice(at,start);if(!/^(?:\r\n|\n|\r)$/.test(raw))return null;
   parts.push({text:' ',raw,breakKind:'soft',frames:[],from:span.from-1,to:span.from});
  }
  parts.push({...span,frames});at=frames[0]?.to??span.sourceTo;
 }
 const raw=source.slice(block.sourceFrom,block.sourceTo),prefix=node.type==='heading'?raw.match(/^#{1,6}[ \t]+/)?.[0]:'';
 if(prefix===undefined)return null;
 return renderArticleParts(parts,source)===raw.slice(prefix.length)?parts:null;
}
// Coalesce only wrappers at the newly joined edge. Never normalize unrelated
// adjacent emphasis/link runs elsewhere in either surviving paragraph.
function join(left,right){
 const a=left.at(-1),b=right[0];if(!a||!b||a.breakKind||b.breakKind)return [...left,...right];
 const x=a.frames,y=b.frames;let common=0;
 while(common<x.length&&common<y.length&&x[common].kind===y[common].kind){
  if(x[common].kind==='link'&&(JSON.stringify(a.link)!==JSON.stringify(b.link)||x[common].open!==y[common].open||x[common].close!==y[common].close))break;
  common++;
 }
 return [...left,...right.map(p=>({...p,frames:p.frames.map((f,i)=>i<common&&f.kind===y[i].kind&&f.from===y[i].from&&f.to===y[i].to?x[i]:f)}))];
}
// PM canonicalizes adjacent identical text marks on load. Compare that complete
// semantic tree without changing the raw spelling of unaffected source runs.
function canonical(node){
 if(!node.content)return node;const content=[];
 for(const value of node.content){const child=canonical(value),last=content.at(-1);
  if(child.type==='text'&&last?.type==='text'&&JSON.stringify(child.marks)===JSON.stringify(last.marks))last.text+=child.text;else content.push({...child});
 }
 return {...node,content};
}
export {join as joinProseParts,canonical as canonicalDocument};

// Explicit cross-paragraph selection or multi-paragraph plain paste. Existing
// simple-prose operations keep their history protocol. No caller source offsets,
// whole-file serialization, protected-block traversal or composition relaxation.
export function mapProseRange(source,p,{from,to,insert},project){
 const first=p.blocks.findIndex(b=>b&&from>b.from&&from<b.to),last=p.blocks.findIndex(b=>b&&to>b.from&&to<b.to);
 const multiline=insert.includes('\n');
 if(first<0||last<first||first===last&&!multiline||insert==='\n\n'&&from===to)return null;
 const blocks=p.blocks.slice(first,last+1),parts=blocks.map((_,i)=>proseParts(source,p,first+i));
 if(parts.some(p=>!p))return null;
 if(!blocks.some((b,i)=>p.doc.content[first+i].type==='heading'||b.article||parts[i].some(s=>s.textOffset!==undefined||s.frames.length)))return null;
 if(blocks.length>32||!insert.isWellFormed()||/[\x00-\x09\x0b-\x1f\x7f\u2028\u2029]/u.test(insert))return reject();
 const values=insert.split('\n\n');
 if(values.length>32||values.some(v=>v.includes('\n'))||multiline&&values.some(v=>!v.trim()))return reject();
 const nl=source.match(/\r\n|\n|\r/)?.[0]||'\n',delimiter=nl+nl;
 if(blocks.some((b,i)=>i&&source.slice(blocks[i-1].sourceTo,b.sourceFrom)!==delimiter))return reject();
 const left=splitArticleParts(parts[0],from-blocks[0].from-1),right=splitArticleParts(parts.at(-1),to-blocks.at(-1).from-1);
 if(!left||!right)return reject();
 const selected=parts[0].find(s=>from>=s.from&&from<s.to)||{frames:[]};
 const groups=values.map(text=>text?[multiline?{text,frames:[]}:{...selected,text,raw:undefined,breakKind:undefined}]:[]);
 groups[0]=join(left[0],groups[0]);groups[groups.length-1]=join(groups.at(-1),right[1]);
 const firstNode=p.doc.content[first],prefix=firstNode.type==='heading'?source.slice(blocks[0].sourceFrom,blocks[0].sourceTo).match(/^#{1,6}[ \t]+/)[0]:'';
 const raw=prefix+groups.map(v=>renderArticleParts(v,source)).join(delimiter);
 const expected=structuredClone(p.doc);expected.content.splice(first,blocks.length,...groups.map((parts,i)=>
  i===0&&firstNode.type==='heading'?{type:'heading',attrs:{...firstNode.attrs},content:articleNodes(parts)}:paragraph(parts)));
 const next=source.slice(0,blocks[0].sourceFrom)+raw+source.slice(blocks.at(-1).sourceTo),patch=sourceEdits.sourceDifference(source,next);
 if(!patch.ok||patch.change.to-patch.change.from>4096||patch.change.insert.length>4096)return reject();
 const projection=project(next);if(JSON.stringify(canonical(expected))!==JSON.stringify(canonical(projection.doc)))return reject();
 return {ok:true,source:next,projection,change:patch.change,inverseSource:patch.inverse,structural:true,selection:{from:from+insert.length,to:from+insert.length}};
}
