import {rowParts,renderRow} from './document-prefixed-paragraph.mjs';
import {splitArticleParts,articleNodes} from './document-article-source.mjs';
import {toggleInlineFrames} from './document-inline-tree.mjs';
import {joinProseParts,canonicalDocument} from './document-prose-range.mjs';
import {listNodeAt,sameListParent} from './document-list-source.mjs';
import sourceEdits from './document-source-edit.js';
const reject=()=>({ok:false,code:'unsafe-format-range'});
const paragraph=parts=>({type:'paragraph',content:articleNodes(parts)});
// Complete structural commands over the same lexical rows as typing/paste.
// This planner owns only wrapped rows (or their join neighbour); old commands
// remain responsible for ordinary one-line and subtree movement workflows.
export function mapWrappedFormat(source,p,{action,from,to},project){
 const index=p.blocks.findIndex(b=>b&&from>b.from&&to<b.to),block=p.blocks[index];
 const list=!!block?.items,rows=block?.items||block?.quoteRows;if(!rows?.some(r=>r.parts))return null;
 const i=rows.findIndex(r=>from>=r.from&&to<=r.to),row=rows[i];if(!row)return null;
 const mark=['bold','italic','code'].includes(action),split=action===(list?'split-list':'split-quote'),join=action===(list?'join-list':'join-quote');
 if(!mark&&!split&&!join&&!(action==='paragraph'&&!list))return null;
 if(!mark&&from!==to)return reject();
 const parts=rowParts(source,p,index,row,list),a=splitArticleParts(parts,from-row.from),b=splitArticleParts(parts,to-row.from);if(!a||!b)return reject();
 const expected=structuredClone(p.doc),node=expected.content[index],nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||'\n';
 const prefix=row.continuation??(list?row.indent+' '.repeat(row.marker.length):'> ');
 let start=row.bodyFrom,end=row.sourceTo,raw,target=i,offset=from-row.from,targetIndex=index,selectedRange=false,prose=false;
 const parent=list?listNodeAt(node,row.path.slice(0,-1)):node,slot=list?row.siblingIndex:i;
 if(mark){
  if(from===to)return reject();const chosen=splitArticleParts(a[1],to-from)?.[0];if(!chosen?.length)return reject();
  if(action==='code'&&(chosen.length!==1||chosen[0].breakKind||chosen[0].text.includes('`')))return reject();
  const value=chosen.map(s=>s.breakKind==='hard'?' ':s.text).join('');if(!value.trim()||value.trim()!==value)return reject();
  const remove=chosen.every(s=>s[action]),allNew=chosen.every(s=>!s[action]),frame={kind:action,from:-1,to:-1,open:action==='bold'?'**':'*',close:action==='bold'?'**':'*'};
  const middle=chosen.map(s=>allNew&&action!=='code'?{...s,[action]:true,frames:[frame,...s.frames]}:toggleInlineFrames(s,action,source,remove));
  const result=[...a[0],...middle,...b[1]];raw=renderRow(result,source,prefix);
  if(list)parent.content[slot].content[0]=paragraph(result);else parent.content[slot]=paragraph(result);selectedRange=true;
 }else if(action==='paragraph'){
  start=block.sourceFrom;end=block.sourceTo;raw=rows.map(r=>renderRow(rowParts(source,p,index,r,false),source,'')).join(nl+nl);
  expected.content.splice(index,1,...node.content);targetIndex+=i;prose=true;
 }else if(split){
  if(from===row.from&&from===row.to)return null; // existing empty-row exit/lift
  if(rows.length>=32)return reject();
  if(list){
   const old=parent.content[slot],marker=parent.type==='orderedList'?`${Math.min(999999999,parseInt(row.marker,10)+1)}${row.marker.trim().at(-1)} `:row.marker;
   const rightPrefix=row.indent+' '.repeat(marker.length),task=row.checked===null?'':'[ ] ';
   raw=renderRow(a[0],source,prefix)+(row.separator??rows.find(r=>r.separator)?.separator??nl)+row.indent+marker+task+renderRow(a[1],source,rightPrefix);
   parent.content.splice(slot,1,{...old,content:[paragraph(a[0])]},{...old,...(row.checked===null?{}:{attrs:{checked:false}}),content:[paragraph(a[1]),...old.content.slice(1)]});
  }else{
   raw=renderRow(a[0],source,'> ')+nl+'> '+nl+'> '+renderRow(a[1],source,'> ');
   parent.content.splice(slot,1,paragraph(a[0]),paragraph(a[1]));
  }target=i+1;offset=0;
 }else{
  if(from!==row.from)return reject();
  if(i===0){
   if(list&&(row.path.length>1||row.subtreeTo!==row.sourceTo))return null;
   start=row.sourceFrom;end=rows[1]?.sourceFrom??block.sourceTo;
   raw=renderRow(parts,source,'')+(rows.length>1?nl+nl:'');
   const remainder=list?{...node,...(node.type==='orderedList'?{attrs:{start:parseInt(rows[1]?.marker,10)}}:{}),content:node.content.slice(1)}:{type:'blockquote',content:node.content.slice(1)};
   expected.content.splice(index,1,paragraph(parts),...(rows.length>1?[remainder]:[]));prose=true;offset=0;
  }else{
   const prev=rows[i-1];if(list&&(!sameListParent(prev,row)||prev.subtreeTo!==prev.sourceTo))return reject();
   const left=rowParts(source,p,index,prev,list),result=joinProseParts(left,parts);
   start=prev.bodyFrom;raw=renderRow(result,source,prev.continuation??(list?prev.indent+' '.repeat(prev.marker.length):'> '));
   if(list)parent.content.splice(slot-1,2,{...parent.content[slot-1],content:[paragraph(result),...parent.content[slot].content.slice(1)]});
   else parent.content.splice(slot-1,2,paragraph(result));
   target=i-1;offset=prev.to-prev.from;
  }
 }
 const next=source.slice(0,start)+raw+source.slice(end),patch=sourceEdits.sourceDifference(source,next);if(!patch.ok||patch.change.to-patch.change.from>4096||patch.change.insert.length>4096)return reject();
 const projection=project(next);if(JSON.stringify(canonicalDocument(expected))!==JSON.stringify(canonicalDocument(projection.doc)))return reject();
 const dest=projection.blocks[targetIndex],at=(prose?dest?.from+1:(list?dest?.items:dest?.quoteRows)?.[target]?.from)+offset;
 if(!Number.isSafeInteger(at))return reject();
 return {ok:true,source:next,projection,change:patch.change,inverseSource:patch.inverse,selection:{from:at,to:selectedRange?at+to-from:at}};
}
