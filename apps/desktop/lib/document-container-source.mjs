import {projectPrefixedParagraph,renderRow,rowParts} from './document-prefixed-paragraph.mjs';
import {projectInlineParts,inlineFrames} from './document-inline-tree.mjs';
import {inlineTextNode} from './document-inline-leaf.mjs';

export const containerNodeAt=(node,path)=>path.reduce((n,i)=>n.content[i],node);
export function containerPosition(node,at,path){
 for(const index of path){at++;for(let i=0;i<index;i++)at+=nodeSize(node.content[i]);node=node.content[index];}
 return at+1;
}
const nodeSize=n=>n.type==='text'?n.text.length:n.type==='hardBreak'?1:2+(n.content||[]).reduce((a,n)=>a+nodeSize(n),0);
export function containerRows(source,p,index){
 const b=p.blocks[index];if(b?.containerRows)return b.containerRows;
 if(b?.items)return b.items.map(r=>({...r,path:[...r.path,0],ownerPath:r.path,kind:'list',first:true,
  itemSource:r.sourceFrom,itemEnd:r.subtreeTo,taskFrom:r.sourceFrom+r.marker.length,
  prefix:source.slice(r.lineFrom,r.bodyFrom),parts:rowParts(source,p,index,r,true)}));
 if(b?.quoteRows)return b.quoteRows.map((r,i)=>({...r,path:[i],kind:'quote',depth:1,prefix:'> ',continuation:'> ',parts:rowParts(source,p,index,r,false)}));
 return [];
}
const complex=n=>n.type==='list'&&n.children.some(i=>i.children.filter(c=>c.type==='paragraph').length>1||i.children.some(complex))
 ||n.type==='blockquote'&&n.children.some(c=>c.type==='blockquote');

// Additional grammar only: explicit multi-paragraph items and paragraph-only
// nested quotes. Simple containers retain their established projection/planners.
// Every row owns one exact lexical paragraph and its full PM path; no serializer.
export function projectComplexContainer(node,source,position,blockIndex){
 const lineStart=at=>Math.max(source.lastIndexOf('\n',at-1),source.lastIndexOf('\r',at-1))+1,tails=new Map();let looseChild=false;
 function pendingList(n,depth=0){
  if(n.type!=='list'||depth>=6)return;
  for(const item of n.children){
   const a=item.position.start.offset,indent=source.slice(lineStart(a),a),marker=source.slice(a).match(n.ordered?/^\d{1,9}[.)] /:/^[-+*] /)?.[0];
   const pending=marker&&item.children.at(-1)?.type==='paragraph'?source.slice(item.position.end.offset).match(/^(\r\n|\n|\r)\1( +)(?=$|\r|\n)/):null;
   if(pending&&pending[2]===indent+' '.repeat(marker.length))tails.set(item,pending[0]);
   const child=item.children.at(-1),previous=item.children.at(-2);
   if(child?.type==='list'&&previous&&(source.slice(previous.position.end.offset,child.position.start.offset).match(/\r\n|\n|\r/g)||[]).length>=2)looseChild=true;
   for(const c of item.children)pendingList(c,depth+1);
  }
 }
 pendingList(node);if(!complex(node)&&!tails.size&&!looseChild)return null;
 function logicalEnd(n){const last=n.children?.at(-1);return Math.max(n.position.end.offset+(tails.get(n)?.length||0),last&&['list','listItem'].includes(last.type)?logicalEnd(last):0);}
 const rows=[],spans=[];let items=0;
 const start=node.position.start.offset,end=logicalEnd(node),raw=source.slice(start,end);
 const endings=raw.match(/\r\n|\n|\r/g)||[],nl=endings[0]||'\n';
 if(endings.some(n=>n!==nl))return null;
 function paragraph(n,from,to,prefix,path,at,extra={}){
  if(rows.length>=32||source.slice(from-prefix.length,from)!==prefix)return null;
  let parts,doc,size;const continuation=extra.continuation??prefix;
  if(n&&n.position.start.line!==n.position.end.line){
   const p=projectPrefixedParagraph(source,from,to,continuation,at,blockIndex);if(!p)return null;
   parts=p.parts;doc=p.doc;size=p.size;
  }else{
   parts=[];
   for(const c of n?.children||[]){const p=projectInlineParts(c,source);if(!p)return null;parts.push(...p);}
   const tail=n?.children?.at(-1)?.position.end.offset??from,suffix=source.slice(tail,to);
   if(suffix){if(!/^ +$/.test(suffix))return null;parts.push({text:suffix,sourceFrom:tail,sourceTo:to,bold:false});}
   if(!parts.length)parts.push({text:'',sourceFrom:from,sourceTo:from,bold:false});
   let pm=at+1;parts=parts.map(p=>{const v={...p,frames:inlineFrames(p,source),from:pm,to:pm+p.text.length};pm=v.to;return v;});
   doc={type:'paragraph',content:parts.filter(p=>p.text).map(inlineTextNode)};size=pm-at+1;
  }
  if(renderRow(parts,source,continuation)!==source.slice(from,to))return null;
  const row={path,from:at+1,to:at+size-1,bodyFrom:from,sourceTo:to,sourceFrom:from-prefix.length,prefix,parts,...extra};
  rows.push(row);
  for(const [inlineIndex,p]of parts.filter(p=>!p.breakKind).entries())spans.push({...p,blockIndex,childIndex:spans.length,inlineIndex,containerPath:path});
  return {doc,size};
 }
 function list(n,at,path=[],depth=0){
  if(n.type!=='list'||depth>=6)return null;
  const content=[];let pm=at+1,prev=null;
  for(const [i,item]of n.children.entries()){
   if(++items>32)return null;
   const a=item.position.start.offset,b=logicalEnd(item),physical=lineStart(a),indent=source.slice(physical,a);
   if(!/^ *$/.test(indent)||prev!==null&&!/^(?:\r\n|\n|\r){1,2} *$/.test(source.slice(prev,a)))return null;
   const first=source.slice(a,b).split(/\r\n|\n|\r/)[0],marker=first.match(n.ordered?/^\d{1,9}[.)] /:/^[-+*] /)?.[0];if(!marker)return null;
   const task=first.slice(marker.length).match(/^\[([ xX])\] /),checked=task?task[1]!==' ':null,body=a+marker.length+(task?4:0);
   if(item.checked!==null&&!task)return null;
   const prefix=indent+' '.repeat(marker.length),ownerPath=[...path,i],children=[],meta={kind:'list',ownerPath,marker,indent,checked,itemSource:a,itemEnd:b,taskFrom:a+marker.length};
   let childPM=pm+1,last=null,slot=0;
   function gapTo(to,nested=false){
    const bits=source.slice(last,to).split(nl);
    if(bits[0]!==''||!(nested?bits.at(-1).startsWith(prefix):bits.at(-1)===prefix)||bits.slice(1,-1).some(s=>s!==''&&s!==prefix))return false;
    if(bits.length===2&&nested)return true;
    if(bits.length%2!==1)return false;
    let offset=last;
    for(let k=0;k<bits.length-1;k++){
     if(k>0&&k%2===0){if(bits[k]!==prefix)return false;const body=offset+prefix.length;
      const p=paragraph(null,body,body,prefix,[...ownerPath,slot++],childPM,{...meta,first:false,continuation:prefix});if(!p)return false;children.push(p.doc);childPM+=p.size;}
     offset+=bits[k].length+nl.length;
    }return true;
   }
   if(item.children[0]?.position.start.offset!==body){
    if(body!==a+first.length)return null;
    const p=paragraph(null,body,body,source.slice(physical,body),[...ownerPath,slot++],childPM,{...meta,first:true,continuation:prefix});if(!p)return null;
    children.push(p.doc);childPM+=p.size;last=body;
   }
   for(const c of item.children){
    if(c.type==='paragraph'){
     const from=c.position.start.offset,to=c.position.end.offset,isFirst=slot===0;
     if(isFirst&&from!==body||!isFirst&&source.slice(lineStart(from),from)!==prefix)return null;
     if(last!==null&&!gapTo(from))return null;
     const p=paragraph(c,from,to,isFirst?source.slice(physical,body):prefix,[...ownerPath,slot++],childPM,{...meta,first:isFirst,continuation:prefix});if(!p)return null;
     children.push(p.doc);childPM+=p.size;last=to;
    }else if(c.type==='list'&&c===item.children.at(-1)){
     if(last===null||!gapTo(c.position.start.offset,true))return null;
     const p=list(c,childPM,[...ownerPath,slot++],depth+1);if(!p)return null;children.push(p.doc);childPM+=p.size;
    }else return null;
   }
   if(tails.has(item)){
    const p=paragraph(null,b,b,prefix,[...ownerPath,slot++],childPM,{...meta,first:false,continuation:prefix});if(!p)return null;children.push(p.doc);childPM+=p.size;
   }
   if(!children.length||children[0].type!=='paragraph')return null;
   content.push({type:'listItem',...(checked===null?{}:{attrs:{checked}}),content:children});pm=childPM+1;prev=b;
  }
  return {doc:{type:n.ordered?'orderedList':'bulletList',...(n.ordered?{attrs:{start:n.start}}:{}),content},size:pm-at+1};
 }
 function quote(n,at,path=[],depth=1){
  if(depth>6||n.children.some(c=>!['paragraph','blockquote'].includes(c.type)))return null;
  const prefix='> '.repeat(depth),content=[];let pm=at+1,previous=null;
  const physical=lineStart(n.position.start.offset);
  function empties(a,b,initial=false,trailing=false){
   if(a===b)return true;
   const bits=source.slice(a,b).split(nl);let blanks;
   if(initial){if(bits.at(-1)!=='')return false;blanks=bits.slice(0,-1);}
   else {if(bits[0]!=='')return false;blanks=bits.slice(1,trailing?undefined:-1);if(!trailing&&bits.at(-1)!=='')return false;}
   if(blanks.some(s=>s!==prefix))return false;
   const count=initial||trailing?blanks.length:blanks.length-1;
   if(!initial&&!trailing&&blanks.length===0)return true;
   if(count<0||count%2)return false;
   let offsets=[],pos=a;
   for(const bit of source.slice(a,b).split(nl)){offsets.push(pos);pos+=bit.length+nl.length;}
   for(let j=0;j<count/2;j++){
    const line=offsets[initial?j*2:2+j*2],body=line+prefix.length;
    const p=paragraph(null,body,body,prefix,[...path,content.length],pm,{kind:'quote',depth});if(!p)return false;
    content.push(p.doc);pm+=p.size;
   }return true;
  }
  for(const c of n.children){
   const physicalChild=lineStart(c.position.start.offset);
   if(previous===null){if(!empties(physical,physicalChild,true))return null;}
   else if(!empties(previous,physicalChild))return null;
   const pathChild=[...path,content.length];
   const p=c.type==='blockquote'?quote(c,pm,pathChild,depth+1):paragraph(c,c.position.start.offset,c.position.end.offset,prefix,pathChild,pm,{kind:'quote',depth});
   if(!p)return null;content.push(p.doc);pm+=p.size;previous=c.position.end.offset;
  }
  if(previous===null){const body=physical+prefix.length;if(source.slice(physical,n.position.end.offset)!==prefix)return null;const p=paragraph(null,body,body,prefix,[...path,0],pm,{kind:'quote',depth});if(!p)return null;content.push(p.doc);pm+=p.size;}
  else if(!empties(previous,n.position.end.offset,false,true))return null;
  return {doc:{type:'blockquote',content},size:pm-at+1};
 }
 const p=node.type==='list'?list(node,position):quote(node,position);
 return p?{...p,spans,block:{from:position,to:position+p.size,sourceFrom:start,sourceTo:end,containerRows:rows}}:null;
}
