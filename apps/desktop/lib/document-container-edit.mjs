import {equalCanonicalProjection} from './document-canonical-equal.mjs';
import {containerRows,containerNodeAt,containerPosition} from './document-container-source.mjs';
import {renderRow} from './document-prefixed-paragraph.mjs';
import {splitArticleParts,articleNodes} from './document-article-source.mjs';
import {joinProseParts} from './document-prose-range.mjs';
import {toggleInlineFrames} from './document-inline-tree.mjs';
import {continueInProse} from './document-prose-continuation.mjs';
import sourceEdits from './document-source-edit.js';
const reject=()=>({ok:false,code:'unsafe-source-range'});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const para=parts=>({type:'paragraph',content:articleNodes(parts)});
const quote=content=>({type:'blockquote',content});
const parentPath=r=>r.path.slice(0,-1);
const prefix=r=>r.continuation??r.prefix;
function moveTail(raw,before,after){
 return raw.split(/(\r\n|\n|\r)/).map((s,i)=>i%2||!s?s:s.startsWith(before)?after+s.slice(before.length):s).join('');
}
function finish(source,p,index,expected,a,b,raw,targetPath,offset,project,selectionLength=0){
 const next=source.slice(0,a)+raw+source.slice(b),patch=sourceEdits.sourceDifference(source,next);
 if(!patch.ok||patch.change.to-patch.change.from>4096||patch.change.insert.length>4096)return reject();
 const projection=project(next);if(!equalCanonicalProjection(expected,projection.doc))return reject();
 const from=containerPosition(projection.doc.content[index],projection.blocks[index].from,targetPath)+offset;
 if(!Number.isSafeInteger(from)||from<1||from+selectionLength>=projection.blocks[index].to)return reject();
 return {ok:true,source:next,projection,change:patch.change,inverseSource:patch.inverse,structural:true,selection:{from,to:from+selectionLength}};
}
// One paragraph or adjacent paragraph siblings in one item / one quote level.
// Cross-item and cross-level selection are refused, never flattened implicitly.
export function mapContainerRange(source,p,{from,to,insert},project){
 const index=p.blocks.findIndex(b=>b?.containerRows&&from>b.from&&to<b.to);if(index<0)return null;
 const rows=p.blocks[index].containerRows,first=rows.find(r=>from>=r.from&&from<=r.to),last=rows.find(r=>to>=r.from&&to<=r.to);
 if(!first||!last||!same(parentPath(first),parentPath(last))||!insert.isWellFormed()||/[\x00-\x09\x0b-\x1f\x7f\u2028\u2029]/u.test(insert))return reject();
 const selected=rows.filter(r=>same(parentPath(first),parentPath(r))&&r.path.at(-1)>=first.path.at(-1)&&r.path.at(-1)<=last.path.at(-1));
 if(last.path.at(-1)<first.path.at(-1)||selected.length!==last.path.at(-1)-first.path.at(-1)+1)return reject();
 const a=splitArticleParts(first.parts,from-first.from),b=splitArticleParts(last.parts,to-last.from);if(!a||!b)return reject();
 const values=insert.split('\n\n'),multi=values.length>1;if(values.length>32||values.some(v=>v.includes('\n'))||multi&&values.some(v=>!v.trim()))return reject();
 const mark=(from===to?first.parts.find(s=>from>s.from&&from<=s.to):first.parts.find(s=>from>=s.from&&from<s.to))||{frames:[]};
 const groups=values.map(text=>text?[{...(multi?{frames:[]}:mark),text,raw:undefined,breakKind:undefined}]:[]);
 groups[0]=joinProseParts(a[0],groups[0]);groups[groups.length-1]=joinProseParts(groups.at(-1),b[1]);
 const expected=structuredClone(p.doc),node=containerNodeAt(expected.content[index],parentPath(first));
 if(selected.some(r=>renderRow(r.parts,source,prefix(r))!==source.slice(r.bodyFrom,r.sourceTo)))return reject();
 node.content.splice(first.path.at(-1),selected.length,...groups.map(para));
 const nl=source.slice(p.blocks[index].sourceFrom,p.blocks[index].sourceTo).match(/\r\n|\n|\r/)?.[0]||'\n';
 const gap=first.kind==='list'?nl+nl+prefix(first):nl+prefix(first)+nl+prefix(first);
 const raw=groups.map(g=>renderRow(g,source,prefix(first))).join(gap);
 const target=[...parentPath(first),first.path.at(-1)+groups.length-1],offset=articleNodes(groups.at(-1)).reduce((n,c)=>n+(c.type==='text'?c.text.length:1),0)-articleNodes(b[1]).reduce((n,c)=>n+(c.type==='text'?c.text.length:1),0);
 const result=finish(source,p,index,expected,first.bodyFrom,last.sourceTo,raw,target,offset,project);
 const leaf=p.spans.find(s=>s.blockIndex===index&&from>=s.from&&to<=s.to);
 if(result.ok&&leaf&&source.slice(0,leaf.sourceFrom+from-leaf.from)+insert+source.slice(leaf.sourceFrom+to-leaf.from)===result.source)result.structural=false;
 return result;
}

export function mapContainerFormat(source,p,{action,from,to},project){
 const index=p.blocks.findIndex(b=>b&&from>b.from&&to<b.to);if(index<0)return null;
 const block=p.blocks[index],special=action==='list-paragraph'||action==='blockquote'&&block.quoteRows;
 if(!block.containerRows&&!special)return null;
 const rows=containerRows(source,p,index),row=rows.find(r=>from>=r.from&&to<=r.to);if(!row)return reject();
 const a=splitArticleParts(row.parts,from-row.from),b=splitArticleParts(row.parts,to-row.from);if(!a||!b)return reject();
 const expected=structuredClone(p.doc),root=expected.content[index],parent=containerNodeAt(root,parentPath(row)),slot=row.path.at(-1);
 const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||'\n';
 let start=row.bodyFrom,end=row.sourceTo,raw,target=row.path,offset=from-row.from,selectionLength=0;
 if(['bold','italic','code'].includes(action)){
  if(from===to)return reject();const chosen=splitArticleParts(a[1],to-from)?.[0];if(!chosen?.length)return reject();
  const value=chosen.map(p=>p.breakKind==='hard'?' ':p.text).join('');if(!value.trim()||value.trim()!==value||action==='code'&&(chosen.length!==1||chosen[0].breakKind||value.includes('`')))return reject();
  const remove=chosen.every(s=>s[action]),allNew=chosen.every(s=>!s[action]),frame={kind:action,from:-1,to:-1,open:action==='bold'?'**':'*',close:action==='bold'?'**':'*'};
  const middle=chosen.map(s=>allNew&&action!=='code'?{...s,[action]:true,frames:[frame,...s.frames]}:toggleInlineFrames(s,action,source,remove));
  const parts=[...a[0],...middle,...b[1]];parent.content[slot]=para(parts);raw=renderRow(parts,source,prefix(row));selectionLength=to-from;
 }else{
  if(from!==to)return reject();
  if(action==='exit-block'&&row.kind==='quote')return continueInProse(source,p,index,false,project);
  if(['indent-list','outdent-list'].includes(action)&&row.kind==='list')return moveList();
  if(action==='toggle-task'&&row.kind==='list'){
   if(row.checked===null)return reject();containerNodeAt(root,row.ownerPath).attrs={checked:!row.checked};
   start=row.taskFrom+1;end=start+1;raw=row.checked?' ':'x';
  }else if(action==='list-paragraph'&&row.kind==='list'||action==='split-quote'&&row.kind==='quote'){
   if(row.kind==='quote'&&row.from===row.to&&slot===parent.content.length-1)return row.depth>1?liftQuote():continueInProse(source,p,index,false,project);
   if(rows.length>=32)return reject();const gap=row.kind==='list'?nl+nl+prefix(row):nl+prefix(row)+nl+prefix(row);
   raw=renderRow(a[0],source,prefix(row))+gap+renderRow(a[1],source,prefix(row));
   parent.content.splice(slot,1,para(a[0]),para(a[1]));target=[...parentPath(row),slot+1];offset=0;
  }else if(action==='split-list'&&row.kind==='list'){
   if(rows.length>=32)return reject();const owner=containerNodeAt(root,row.ownerPath),listPath=row.ownerPath.slice(0,-1),list=containerNodeAt(root,listPath),i=row.ownerPath.at(-1);
   const marker=list.type==='orderedList'?`${Math.min(999999999,parseInt(row.marker,10)+1)}${row.marker.trim().at(-1)} `:row.marker,newPrefix=row.indent+' '.repeat(marker.length);
   let tail=source.slice(row.sourceTo,row.itemEnd);
   if(newPrefix!==prefix(row))tail=moveTail(tail,prefix(row),newPrefix);
   end=row.itemEnd;raw=renderRow(a[0],source,prefix(row))+nl+nl+row.indent+marker+(row.checked===null?'':'[ ] ')+renderRow(a[1],source,newPrefix)+tail;
   list.content.splice(i,1,{...owner,content:[...owner.content.slice(0,slot),para(a[0])]},
    {...owner,...(row.checked===null?{}:{attrs:{checked:false}}),content:[para(a[1]),...owner.content.slice(slot+1)]});
   target=[...listPath,i+1,0];offset=0;
  }else if(['join-list','join-quote'].includes(action)&&from===row.from){
   const prev=rows.find(r=>same(parentPath(row),parentPath(r))&&r.path.at(-1)===slot-1);
   if(prev){
    const joined=joinProseParts(prev.parts,row.parts);start=prev.bodyFrom;raw=renderRow(joined,source,prefix(prev));parent.content.splice(slot-1,2,para(joined));target=prev.path;offset=prev.to-prev.from;
   }else if(row.kind==='list'){
    const listPath=row.ownerPath.slice(0,-1),list=containerNodeAt(root,listPath),i=row.ownerPath.at(-1),owner=containerNodeAt(root,row.ownerPath),before=list.content[i-1];
    if(slot!==0||!before||before.content.at(-1).type!=='paragraph')return reject();
    const previousPath=[...listPath,i-1,before.content.length-1],previous=rows.find(r=>same(r.path,previousPath));if(!previous)return reject();
    const joined=joinProseParts(previous.parts,row.parts);start=previous.bodyFrom;end=row.itemEnd;raw=renderRow(joined,source,prefix(previous))+moveTail(source.slice(row.sourceTo,row.itemEnd),prefix(row),prefix(previous));
    before.content.splice(before.content.length-1,1,para(joined),...owner.content.slice(1));list.content.splice(i,1);target=previous.path;offset=previous.to-previous.from;
   }else return liftQuote();
  }else if(action==='blockquote'&&row.kind==='quote'){
   if(row.depth>=6)return reject();start=row.sourceFrom;raw=row.prefix+'> '+renderRow(row.parts,source,row.prefix+'> ');parent.content[slot]=quote([parent.content[slot]]);target=[...row.path,0];
  }else if(action==='paragraph'&&row.kind==='quote')return liftQuote();
  else return reject();
 }
 return finish(source,p,index,expected,start,end,raw,target,offset,project,selectionLength);
 function moveList(){
  const ownerPath=row.ownerPath,listPath=ownerPath.slice(0,-1),list=containerNodeAt(root,listPath),i=ownerPath.at(-1),selected=list.content[i];
  const first=path=>rows.find(r=>r.kind==='list'&&r.first&&same(r.ownerPath,path));
  const owner=first(ownerPath);if(!owner)return reject();
  function rewritten(r,indent,marker=r.marker){
   const oldPrefix=r.indent+' '.repeat(r.marker.length),newPrefix=indent+' '.repeat(marker.length);
   const lines=source.slice(r.itemSource-r.indent.length,r.itemEnd).split(nl);
   if(!lines[0].startsWith(r.indent+r.marker))return null;
   const result=[indent+marker+lines[0].slice(r.indent.length+r.marker.length)];
   for(const line of lines.slice(1)){if(!line){result.push(line);continue;}if(!line.startsWith(oldPrefix))return null;result.push(newPrefix+line.slice(oldPrefix.length));}
   return result.join(nl);
  }
  let raw,target,start=owner.itemSource-owner.indent.length,end=owner.itemEnd;
  if(action==='indent-list'){
   const before=list.content[i-1],previous=first([...listPath,i-1]);if(!before||!previous||ownerPath.length/2>=5.5)return reject();
   let child=before.content.at(-1),childSlot=before.content.length-1;
   if(!['bulletList','orderedList'].includes(child.type)){child=null;childSlot=before.content.length;}
   if(child&&child.type!==list.type)return reject();
   const marker=!child&&list.type==='orderedList'?'1'+owner.marker.trim().at(-1)+' ':owner.marker;
   const childRow=child?first([...listPath,i-1,childSlot,0]):null,indent=childRow?.indent??previous.indent+' '.repeat(previous.marker.length);
   if(childRow&&childRow.marker.trim().at(-1)!==marker.trim().at(-1))return reject();
   raw=rewritten(owner,indent,marker);if(raw===null)return reject();
   list.content.splice(i,1);
   if(!child){child={type:list.type,...(list.type==='orderedList'?{attrs:{start:1}}:{}),content:[]};before.content.push(child);}
   target=[...listPath,i-1,childSlot,child.content.length,...row.path.slice(ownerPath.length)];child.content.push(selected);
  }else{
   if(listPath.length<2)return reject();
   const parentOwnerPath=listPath.slice(0,-1),parentOwner=containerNodeAt(root,parentOwnerPath),grandPath=parentOwnerPath.slice(0,-1),grand=containerNodeAt(root,grandPath),parentIndex=parentOwnerPath.at(-1),parentRow=first(parentOwnerPath);
   if(!parentRow)return reject();const following=list.content.slice(i+1),followRows=following.map((_,n)=>first([...listPath,i+1+n]));if(followRows.some(r=>!r))return reject();
   const marker=grand.type===list.type?owner.marker:parentRow.marker,indent=parentRow.indent;raw=rewritten(owner,indent,marker);if(raw===null)return reject();
   let child=selected.content.at(-1);if(!['bulletList','orderedList'].includes(child.type))child=null;
   if(following.length){
    if(child&&child.type!==list.type)return reject();
    const childRow=child?first([...ownerPath,selected.content.length-1,0]):null;
    const childIndent=childRow?indent+' '.repeat(marker.length)+childRow.indent.slice(owner.indent.length+owner.marker.length):indent+' '.repeat(marker.length);
    let previous=owner;
    for(const r of followRows){const next=rewritten(r,childIndent);if(next===null)return reject();raw+=source.slice(previous.itemEnd,r.itemSource-r.indent.length)+next;previous=r;}
    end=followRows.at(-1).itemEnd;
    if(!child){child={type:list.type,...(list.type==='orderedList'?{attrs:{start:parseInt(followRows[0].marker,10)}}:{}),content:[]};selected.content.push(child);}
    child.content.push(...following);
   }
   list.content.splice(i);if(!list.content.length)parentOwner.content.splice(listPath.at(-1),1);
   grand.content.splice(parentIndex+1,0,selected);target=[...grandPath,parentIndex+1,...row.path.slice(ownerPath.length)];
  }
  return finish(source,p,index,expected,start,end,raw,target,offset,project);
 }
 function liftQuote(){
  if(row.depth<2)return reject();const ownerPath=parentPath(row),outerPath=ownerPath.slice(0,-1),outer=containerNodeAt(root,outerPath),ownerSlot=ownerPath.at(-1);
  const before=parent.content.slice(0,slot),after=parent.content.slice(slot+1),lifted=parent.content[slot],pieces=[...(before.length?[quote(before)]:[]),lifted,...(after.length?[quote(after)]:[])];
  outer.content.splice(ownerSlot,1,...pieces);
  const shorter=row.prefix.slice(2);let start=row.sourceFrom,end=row.sourceTo,raw=shorter+renderRow(row.parts,source,shorter);
  const gap=nl+row.prefix+nl;
  if(source.slice(start-gap.length,start)===gap){start-=gap.length;raw=nl+shorter+nl+raw;}
  if(source.slice(end,end+gap.length)===gap){end+=gap.length;raw+=nl+shorter+nl;}
  return finish(source,p,index,expected,start,end,raw,[...outerPath,ownerSlot+(before.length?1:0)],offset,project);
 }
}
