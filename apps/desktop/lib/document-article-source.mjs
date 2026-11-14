import capacity from './document-capacity.js';
import {projectInlineLeaf,inlineTextNode} from './document-inline-leaf.mjs';
import {inlineFrames,renderInlineParts} from './document-inline-tree.mjs';
const reject=()=>({ok:false,code:'unsafe-source-range'});
const cut=(s,n)=>n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]);
const render=(parts,source)=>renderInlineParts(parts.map(p=>({...p,text:p.raw??p.text})),source);
const paragraph=content=>({type:'paragraph',content});
function nodes(parts){
 const out=[];
 for(const p of parts){
  if(!p.text&&p.breakKind!=='hard')continue;
  const n=inlineTextNode(p);
  if(p.breakKind==='hard'){delete n.text;n.type='hardBreak';out.push(n);continue;}
  const last=out.at(-1);
  if(last?.type==='text'&&JSON.stringify(last.marks)===JSON.stringify(n.marks))last.text+=n.text;else out.push(n);
 }
 return out;
}
// A lexical projection for top-level formatted multiline paragraphs. No file
// serialization: each newline/delimiter retains its exact original source bytes.
export function projectArticle(node,source,position,blockIndex){
 if(node.type!=='paragraph'||node.position.start.line===node.position.end.line||!node.children?.some(n=>n.type!=='text'))return null;
 const parts=[];
 function walk(n,frames=[]){
  const a=n.position.start.offset,b=n.position.end.offset,raw=source.slice(a,b);
  if(['strong','emphasis'].includes(n.type)){
   const kind=n.type==='strong'?'bold':'italic';if(!n.children?.length||frames.length>=4||frames.some(f=>f.kind===kind))return false;
   const open=source.slice(a,n.children[0].position.start.offset),close=source.slice(n.children.at(-1).position.end.offset,b);
   if(!(kind==='bold'?['**','__']:['*','_']).includes(open)||open!==close)return false;
   return n.children.every(c=>walk(c,[...frames,{kind,from:a,to:b,open,close}]));
  }
  const flags={bold:frames.some(f=>f.kind==='bold'),italic:frames.some(f=>f.kind==='italic'),frames};
  if(n.type==='break'){
   if(!/^(?: {2,}|\\)(?:\r\n|\n|\r)$/.test(raw))return false;
   parts.push({...flags,text:'',raw,breakKind:'hard',sourceFrom:a,sourceTo:b});return true;
  }
  if(n.type!=='text'){
   const leaf=projectInlineLeaf(n,source);if(frames.length||!leaf||(!leaf.code&&!leaf.link))return false;
   parts.push({...leaf,frames:inlineFrames(leaf,source)});return true;
  }
  if(typeof n.value!=='string'||raw.replace(/\r\n|\r/g,'\n')!==n.value.replace(/\r\n|\r/g,'\n')||/[\0<>{}\\`$|]/.test(raw)||!raw.isWellFormed())return false;
  for(const m of raw.matchAll(/\r\n|\n|\r|[^\r\n]+/g)){
   const soft=/^[\r\n]/.test(m[0]);parts.push({...flags,text:soft?' ':m[0],...(soft?{raw:m[0],breakKind:'soft'}:{}),sourceFrom:a+m.index,sourceTo:a+m.index+m[0].length});
  }
  return true;
 }
 if(!node.children.every(n=>walk(n))||!parts.length)return null;
 // remark omits final margin spaces. Keep a word-separating Space visible and
 // editable before the next character, just as the single-line projection does.
 const tail=node.children.at(-1).position.end.offset,end=node.position.end.offset,suffix=source.slice(tail,end);
 if(/^ +$/.test(suffix))parts.push({text:suffix,sourceFrom:tail,sourceTo:end,bold:false,italic:false,frames:[]});
 if(render(parts,source)!==source.slice(node.position.start.offset,node.position.end.offset))return null;
 let at=position+1;const spans=[];
 for(const p of parts){p.from=at;p.to=at+(p.breakKind==='hard'?1:p.text.length);at=p.to;if(!p.breakKind)spans.push({...p,blockIndex,childIndex:spans.length,article:true});}
 const size=at-position+1;
 return {doc:paragraph(nodes(parts)),spans,size,block:{from:position,to:position+size,sourceFrom:node.position.start.offset,sourceTo:node.position.end.offset,article:true,parts}};
}
function split(parts,at){
 const left=[],right=[];
 for(const p of parts){
  const size=p.breakKind==='hard'?1:p.text.length;
  if(at>=size)left.push(p);else if(at<=0)right.push(p);
  else {if(p.breakKind||cut(p.text,at))return null;left.push({...p,text:p.text.slice(0,at)});right.push({...p,text:p.text.slice(at)});}
  at-=size;
 }
 return [left,right];
}
function patch(source,p,index,parts,expected,selection){
 const block=p.blocks[index],raw=render(parts,source),old=source.slice(block.sourceFrom,block.sourceTo);
 let start=0,end=old.length,nextEnd=raw.length;
 while(start<end&&start<nextEnd&&old[start]===raw[start])start++;
 if(cut(old,start)||cut(raw,start))start--;
 while(end>start&&nextEnd>start&&old[end-1]===raw[nextEnd-1]){end--;nextEnd--;}
 if(cut(old,end)||cut(raw,nextEnd)){end++;nextEnd++;}
 const a=block.sourceFrom+start,b=block.sourceFrom+end,text=raw.slice(start,nextEnd),next=source.slice(0,a)+text+source.slice(b);
 if(b-a>4096||text.length>4096||next.length>capacity.MAX_SOURCE_UNITS)return reject();
 return {ok:true,source:next,expected,change:{from:a,to:b,insert:text},inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},structural:true,selection};
}
export function planArticleRange(source,p,{from,to,insert}){
 const i=p.blocks.findIndex(b=>b?.article&&from>b.from&&to<b.to);if(i<0)return null;
 if(typeof insert!=='string'||!insert.isWellFormed()||/[\0\r\n]/.test(insert)||insert.length>4096)return reject();
 const block=p.blocks[i],a=split(block.parts,from-block.from-1),b=split(block.parts,to-block.from-1);if(!a||!b)return reject();
 const first=from===to?(block.parts.find(t=>from>t.from&&from<=t.to)||block.parts[0]):(block.parts.find(t=>from>=t.from&&from<t.to)||block.parts.at(-1));
 const added={...first,text:insert};delete added.raw;delete added.breakKind;
 const parts=[...a[0],added,...b[1]],expected=structuredClone(p.doc);expected.content[i]=paragraph(nodes(parts));
 return patch(source,p,i,parts,expected,{from:from+insert.length,to:from+insert.length});
}
export function mapArticleRange(source,p,change,project){
 const plan=change.insert==='\n\n'&&change.from===change.to?planArticleSplit(source,p,change.from):planArticleRange(source,p,change);
 return verify(plan,project);
}
function verify(plan,project){if(!plan?.ok)return plan;const {expected,...r}=plan,projection=project(r.source);return JSON.stringify(expected)===JSON.stringify(projection.doc)?{...r,projection}:reject();}
function planArticleSplit(source,p,from){
 const i=p.blocks.findIndex(b=>b?.article&&from>b.from&&from<b.to);if(i<0)return null;
 const block=p.blocks[i],s=split(block.parts,from-block.from-1);if(!s)return reject();
 const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||'\n',expected=structuredClone(p.doc);
 expected.content.splice(i,1,paragraph(nodes(s[0])),paragraph(nodes(s[1])));
 // The separator is a source-only token outside inline frames.
 const middle={text:nl+nl,frames:[]};return patch(source,p,i,[...s[0],middle,...s[1]],expected,{from:from+2,to:from+2});
}
export function mapArticleFormat(source,p,{action,from,to},project){
 if(action==='split-paragraph'&&from===to)return verify(planArticleSplit(source,p,from),project);
 if(!['bold','italic'].includes(action))return null;
 const i=p.blocks.findIndex(b=>b?.article&&from>b.from&&to<b.to);if(i<0)return null;
 if(from===to)return reject();const block=p.blocks[i],a=split(block.parts,from-block.from-1),b=split(block.parts,to-block.from-1);if(!a||!b)return reject();
 const chosen=split(a[1],to-from)?.[0];if(!chosen?.length||chosen.some(t=>t.code||t.link))return reject();
 const value=chosen.map(t=>t.breakKind==='hard'?' ':t.text).join('');if(!value.trim()||value.trim()!==value)return reject();
 const remove=chosen.every(t=>t[action]),marker=action==='bold'?'**':chosen.some(t=>t.bold)?'_':'*';
 const frame={kind:action,from:-1,to:-1,open:marker,close:marker};
 const middle=chosen.map(t=>({...t,[action]:!remove,frames:remove?t.frames.filter(f=>f.kind!==action):t[action]?t.frames:[...t.frames,frame]}));
 const parts=[...a[0],...middle,...b[1]],expected=structuredClone(p.doc);expected.content[i]=paragraph(nodes(parts));
 return verify(patch(source,p,i,parts,expected,{from,to}),project);
}
