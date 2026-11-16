import {inlineFrames} from './document-inline-tree.mjs';
import {inlineTextNode} from './document-inline-leaf.mjs';
import {splitArticleParts,articleNodes,renderArticleParts} from './document-article-source.mjs';
import {inlineTarget} from './document-tree-edit.mjs';
import {canonicalDocument} from './document-prose-range.mjs';
import sourceEdits from './document-source-edit.js';
// Fallback only after ordinary typing cannot represent a Space at an emphasis
// edge. Retain the word's raw delimiters; the separating Space leaves only the
// marks ending/starting here. No arbitrary caller-supplied mark/source authority.
export function mapBoundarySpace(source,p,change,project){
 if(!change||Object.getPrototypeOf(change)!==Object.prototype||Object.keys(change).length!==3||Object.keys(change).some(k=>!['from','to','insert'].includes(k)))return null;
 const {from,to,insert}=change;if(!Number.isSafeInteger(from)||from!==to||typeof insert!=='string'||!/^ +$/.test(insert)||insert.length>4096)return null;
 const s=p.spans.find(s=>from>s.from&&from<=s.to)||p.spans.find(s=>from===s.from);if(!s||s.codeBlock)return null;
 const block=p.blocks[s.blockIndex];if(!block)return null;
 const spans=p.spans.filter(n=>n.blockIndex===s.blockIndex&&n.itemIndex===s.itemIndex&&n.quoteIndex===s.quoteIndex&&n.tableRow===s.tableRow&&n.tableCol===s.tableCol);
 const parts=block.article?block.parts:s.itemIndex!==undefined&&block.items[s.itemIndex].parts?block.items[s.itemIndex].parts:s.quoteIndex!==undefined&&block.quoteRows[s.quoteIndex].parts?block.quoteRows[s.quoteIndex].parts:spans.map(s=>({...s,frames:inlineFrames(s,source)}));
 if(!parts.length||parts.some(s=>s.textOffset!==undefined))return null;
 const selected=parts.find(s=>from>s.from&&from<=s.to)||parts[0],frames=inlineFrames(selected,source);
 const edge=f=>{const group=parts.filter(p=>inlineFrames(p,source).some(x=>x.kind===f.kind&&x.from===f.from&&x.to===f.to));return from===group[0]?.from||from===group.at(-1)?.to;};
 if(!frames.some(f=>['bold','italic'].includes(f.kind)&&edge(f)))return null;
 const kept=frames.filter(f=>!['bold','italic','code'].includes(f.kind)||!edge(f));
 const added={...selected,text:insert,raw:undefined,breakKind:undefined,frames:kept,bold:kept.some(f=>f.kind==='bold'),italic:kept.some(f=>f.kind==='italic'),code:kept.some(f=>f.kind==='code')};
 const split=splitArticleParts(parts,from-parts[0].from);if(!split)return null;
 const start=parts[0].frames?.[0]?.from??parts[0].sourceFrom,last=parts.at(-1),end=last.frames?.[0]?.to??last.sourceTo;
 if(renderArticleParts(parts,source)!==source.slice(start,end))return null;
 // A physical soft newline already projects as a Space. Materialize only the
 // immediately adjacent token if trailing whitespace would otherwise be trimmed.
 // For a two-space hard break, use its explicit backslash spelling so the new
 // Space remains visible without creating/removing a hard break. Exact undo
 // retains the original prefix, newline and hard-break spelling.
 const left=[...split[0]],right=[...split[1]],materialize=p=>p.breakKind==='soft'?{...p,raw:undefined,breakKind:undefined}:p.breakKind==='hard'?{...p,raw:p.raw.replace(/^(?: {2,}|\\)/,'\\')}:p;
 if(right[0]?.breakKind)right[0]=materialize(right[0]);
 if(left.at(-1)?.breakKind)left[left.length-1]=materialize(left.at(-1));
 const nextParts=[...left,added,...right],raw=renderArticleParts(nextParts,source),next=source.slice(0,start)+raw+source.slice(end),patch=sourceEdits.sourceDifference(source,next);
 if(!patch.ok||patch.change.to-patch.change.from>4096||patch.change.insert.length>4096)return null;
 const expected=copyEditedBlock(p.doc,s.blockIndex);inlineTarget(expected,s).content=articleNodes(nextParts);
 const projection=project(next);if(JSON.stringify(canonicalDocument(expected))!==JSON.stringify(canonicalDocument(projection.doc)))return null;
 return {ok:true,source:next,projection,change:patch.change,inverseSource:patch.inverse,structural:true,boundarySpace:true,spaceMarks:inlineTextNode(added).marks||[],selection:{from:from+insert.length,to:from+insert.length}};
}
import {copyEditedBlock} from './document-edit-projection.mjs';
