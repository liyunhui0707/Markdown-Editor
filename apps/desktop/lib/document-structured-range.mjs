import {inlineFrames,renderInlineParts} from './document-inline-tree.mjs';
import {splitArticleParts,articleNodes} from './document-article-source.mjs';
import {joinProseParts,canonicalDocument} from './document-prose-range.mjs';
import {listNodeAt,sameListParent} from './document-list-source.mjs';
import sourceEdits from './document-source-edit.js';
const reject=()=>({ok:false,code:'unsafe-source-range'});
const paragraph=parts=>({type:'paragraph',content:articleNodes(parts)});

// One explicit quote or same-parent leaf list selection. Lexical frames and
// source-owned row prefixes are retained; no general Markdown serialization.
export function mapStructuredRange(source,p,{from,to,insert},project){
 const index=p.blocks.findIndex(b=>b&&from>b.from&&to<b.to),block=p.blocks[index];
 if(!block?.items&&!block?.quoteRows)return null;
 const list=!!block.items,rows=block.items||block.quoteRows;
 const first=rows.findIndex(r=>from>=r.from&&from<=r.to),last=rows.findIndex(r=>to>=r.from&&to<=r.to),multiline=insert.includes('\n');
 if(first<0||last<first)return null;if(first===last&&!multiline)return null;
 const selected=rows.slice(first,last+1),spans=p.spans.filter(s=>s.blockIndex===index&&(list?s.itemIndex>=first&&s.itemIndex<=last:s.quoteIndex>=first&&s.quoteIndex<=last));
 // Existing plain/simple-mark list ranges keep their established path.
 if(list&&!multiline&&!spans.some(s=>s.link||s.frames))return null;
 if(list&&selected.some(r=>!sameListParent(rows[first],r)||r.subtreeTo!==r.sourceTo))return reject();
 if(!insert.isWellFormed()||/[\x00-\x09\x0b-\x1f\x7f\u2028\u2029]/u.test(insert))return reject();
 const values=insert.split('\n\n');if(values.length>32||values.some(v=>v.includes('\n'))||multiline&&values.some(v=>!v.trim())||rows.length-selected.length+values.length>32)return reject();
 const parts=selected.map((r,i)=>spans.filter(s=>list?s.itemIndex===first+i:s.quoteIndex===first+i).map(s=>({...s,frames:inlineFrames(s,source)})));
 if(parts.some((s,i)=>!s.length||s.some(t=>t.textOffset!==undefined)||renderInlineParts(s,source)!==source.slice(selected[i].bodyFrom,selected[i].sourceTo)))return reject();
 const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||'\n';
 for(let i=1;i<selected.length;i++){
  const row=selected[i],gap=list?nl+row.indent+source.slice(row.sourceFrom,row.bodyFrom):nl+'> '+nl+'> ';
  if(source.slice(selected[i-1].sourceTo,row.bodyFrom)!==gap)return reject();
 }
 const left=splitArticleParts(parts[0],from-rows[first].from),right=splitArticleParts(parts.at(-1),to-rows[last].from);if(!left||!right)return reject();
 const mark=parts[0].find(s=>from>=s.from&&from<s.to)||{frames:[]};
 const groups=values.map(text=>text?[multiline?{text,frames:[]}:{...mark,text}]:[]);
 groups[0]=joinProseParts(left[0],groups[0]);groups[groups.length-1]=joinProseParts(groups.at(-1),right[1]);
 const expected=structuredClone(p.doc),node=expected.content[index];let raw;
 if(list){
  const parent=listNodeAt(node,rows[first].path.slice(0,-1)),original=parent.content[rows[first].siblingIndex],ordered=parent.type==='orderedList',row=rows[first];
  const prefix=i=>row.indent+(ordered?`${Math.min(999999999,parseInt(row.marker,10)+i)}${row.marker.trim().at(-1)} `:row.marker)+(row.checked===null?'':'[ ] ');
  raw=groups.map((g,i)=>(i?nl+prefix(i):'')+renderInlineParts(g,source)).join('');
  const items=groups.map((g,i)=>i?{type:'listItem',...(row.checked===null?{}:{attrs:{checked:false}}),content:[paragraph(g)]}:{...original,content:[paragraph(g)]});
  parent.content.splice(row.siblingIndex,selected.length,...items);
 }else{
  raw=groups.map(g=>renderInlineParts(g,source)).join(nl+'> '+nl+'> ');node.content.splice(first,selected.length,...groups.map(paragraph));
 }
 const a=rows[first].bodyFrom,b=rows[last].sourceTo,next=source.slice(0,a)+raw+source.slice(b),patch=sourceEdits.sourceDifference(source,next);
 if(!patch.ok||patch.change.to-patch.change.from>4096||patch.change.insert.length>4096)return reject();
 const projection=project(next);if(JSON.stringify(canonicalDocument(expected))!==JSON.stringify(canonicalDocument(projection.doc)))return reject();
 const at=from+insert.length+(list?2*(values.length-1):0);
 return {ok:true,source:next,projection,change:patch.change,inverseSource:patch.inverse,structural:true,selection:{from:at,to:at}};
}
