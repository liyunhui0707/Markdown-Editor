import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {projectArticle,renderArticleParts} from './document-article-source.mjs';
import {inlineFrames,renderInlineParts} from './document-inline-tree.mjs';
const parser=unified().use(remarkParse).use(remarkGfm);
// Remove only the independently proven physical continuation prefix. Project
// one virtual paragraph, then map every lexical offset back to the original.
// A newline and its prefix remain one source-only soft/hard-break token.
export function projectPrefixedParagraph(source,from,to,prefix,position,blockIndex){
 const raw=source.slice(from,to),map=[],pieces=[];let at=from,logical=0;
 for(const [i,line] of raw.split(/(?<=\n)|(?<=\r)(?!\n)/).entries()){
  const skip=i?prefix.length:0;if(i&&!line.startsWith(prefix))return null;
  const value=line.slice(skip);pieces.push(value);
  for(let n=0;n<value.length;n++)map[logical+n]=at+skip+n;
  logical+=value.length;at+=line.length;
 }
 map[logical]=to;const text=pieces.join(''),tree=parser.parse(text),node=tree.children[0];
 if(tree.children.length!==1||node?.type!=='paragraph'||node.position.start.offset!==0||node.position.end.offset!==text.length)return null;
 const result=projectArticle(node,text,position,blockIndex,true);if(!result)return null;
 const remap=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='number'&&['from','to','labelFrom','labelTo','destinationFrom','destinationTo'].includes(k)?map[v]:v]));
 const parts=result.block.parts.map(part=>({...part,sourceFrom:map[part.sourceFrom],sourceTo:map[part.sourceTo],
  ...(part.breakKind?{raw:source.slice(map[part.sourceFrom],map[part.sourceTo])}:{}),
  frames:part.frames.map(f=>({...remap(f),...(f.linkSource?{linkSource:remap(f.linkSource)}:{})})),
  ...(part.linkSource?{linkSource:remap(part.linkSource)}:{})}));
 if(renderArticleParts(parts,source)!==raw)return null;
 return {...result,parts,spans:parts.filter(s=>!s.breakKind).map((s,i)=>({...s,blockIndex,childIndex:i,inlineIndex:i}))};
}
export function rowParts(source,p,index,row,list){
 if(row.parts)return row.parts;
 return p.spans.filter(s=>s.blockIndex===index&&(list?s.itemIndex===p.blocks[index].items.indexOf(row):s.quoteIndex===p.blocks[index].quoteRows.indexOf(row))).map(s=>({...s,frames:inlineFrames(s,source)}));
}
// Translate retained physical break prefixes only when their owning paragraph
// moves to another list marker width, quote or prose. Delimiters stay untouched.
export function renderRow(parts,source,prefix){
 return renderArticleParts(parts.map(p=>p.breakKind?{...p,raw:p.raw.replace(/(\r\n|\n|\r)[^\r\n]*$/,(_,nl)=>nl+prefix)}:p),source);
}
export function projectWrappedQuote(node,source,position,blockIndex){
 if(node.type!=='blockquote'||!node.children.length||node.children.length>32||node.children.some(n=>n.type!=='paragraph')||!node.children.some(n=>n.position.start.line!==n.position.end.line))return null;
 const spans=[],quoteRows=[],content=[];let pm=position+2,previous=null;
 for(const [quoteIndex,paragraph] of node.children.entries()){
  const bodyFrom=paragraph.position.start.offset,sourceFrom=bodyFrom-2,sourceTo=paragraph.position.end.offset;
  if(source.slice(sourceFrom,bodyFrom)!=='> ')return null;
  const gap=previous===null?'':source.slice(previous,bodyFrom);
  if(previous!==null&&!/^(\r\n|\n|\r)> \1> $/.test(gap))return null;
  let projected;
  if(paragraph.position.start.line!==paragraph.position.end.line)projected=projectPrefixedParagraph(source,bodyFrom,sourceTo,'> ',pm-1,blockIndex);
  else{
   // Use the same exact paragraph projection, with one harmless virtual newline
   // avoided: single-line neighbours are supplied by the existing inline bridge.
   const parts=[];for(const child of paragraph.children){const c=projectInlineParts(child,source);if(!c)return null;parts.push(...c);}
   if(renderInlineParts(parts,source)!==source.slice(bodyFrom,sourceTo))return null;
   let at=pm;projected={doc:{type:'paragraph',content:parts.map(inlineTextNode)},spans:parts.map((p,i)=>{const s={...p,from:at,to:at+p.text.length,inlineIndex:i};at=s.to;return s;}),size:at-pm+2};
  }
  if(!projected)return null;
  const row={sourceFrom,sourceTo,bodyFrom,from:pm,to:pm+projected.size-2,continuation:'> ',gap,...(projected.parts?{parts:projected.parts}:{})};
  quoteRows.push(row);for(const s of projected.spans)spans.push({...s,blockIndex,quoteIndex,childIndex:spans.length});content.push(projected.doc);pm+=projected.size;previous=sourceTo;
 }
 if(quoteRows[0].sourceFrom!==node.position.start.offset||quoteRows.at(-1).sourceTo!==node.position.end.offset)return null;
 return {doc:{type:'blockquote',content},spans,size:pm-position,block:{from:position,to:pm,sourceFrom:node.position.start.offset,sourceTo:node.position.end.offset,quoteRows}};
}
import {projectInlineParts} from './document-inline-tree.mjs';
import {inlineTextNode} from './document-inline-leaf.mjs';
