import {projectInlineParts,inlineFrames,inlineNodes,renderInlineParts} from './document-inline-tree.mjs';
import {planTreeRange} from './document-tree-edit.mjs';
import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
export const TABLE_ROWS = 32, TABLE_COLUMNS = 8;
const inline = text => text ? [{type:'text',text}] : [];
export const tableCell = (text,header,align=null) => ({type:header?'tableHeader':'tableCell',attrs:{align},content:[{type:'paragraph',content:inline(text)}]});
const valid = text => typeof text==='string' && !/[\x00-\x1f\x7f|\\\u2028\u2029]/u.test(text)
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);

// Exact single-line cell frames, including visible source padding. Reference,
// decoded/escaped and non-text nodes are not normalized into editable content.
function cellParts(children,text,from,source){
 if(children.length<=1&&(!children.length?!text.trim():children[0].type==='text'&&children[0].value===text.trim()))
  return [{text,sourceFrom:from,sourceTo:from+text.length,bold:false,frames:[]}];
 const parts=[];let at=from;
 for(const child of children){
  const a=child.position.start.offset,b=child.position.end.offset,gap=source.slice(at,a);
  if(a<at||b>from+text.length||!/^ *$/.test(gap))return null;
  if(gap)parts.push({text:gap,sourceFrom:at,sourceTo:a,bold:false,frames:[]});
  const chunk=projectInlineParts(child,source);if(!chunk)return null;
  parts.push(...chunk.map(p=>({...p,frames:inlineFrames(p,source)})));at=b;
 }
 const gap=source.slice(at,from+text.length);if(!/^ *$/.test(gap))return null;
 if(gap)parts.push({text:gap,sourceFrom:at,sourceTo:from+text.length,bold:false,frames:[]});
 return parts.length&&renderInlineParts(parts,source)===text?parts:null;
}
// Rectangular, explicitly piped tables. Raw padding, delimiters, alignment and
// untouched cell markup stay exact; this projection is not a serializer.
export function projectTable(node,source,position,blockIndex) {
 if(node.type!=='table'||node.children.length>TABLE_ROWS||node.align.length>TABLE_COLUMNS)return null;
 const start=node.position.start.offset,end=node.position.end.offset,lines=[],raw=source.slice(start,end);
 for(const m of raw.matchAll(/([^\r\n]+)(\r\n|\n|\r|$)/g)){
  const text=m[1];if(!text.startsWith('|')||!text.endsWith('|'))return null;
  const values=text.slice(1,-1).split('|');
  if(values.length!==node.align.length||!values.length||values.some(t=>!valid(t)))return null;
  lines.push({text,values,from:start+m.index,to:start+m.index+text.length,eol:m[2]});
 }
 if(lines.length!==node.children.length+1||lines[1].values.some(s=>!/^ *:?-{3,}:? *$/.test(s)))return null;
 const content=[],spans=[],cells=[];let pos=position+1,childIndex=0;
 for(const [row,n] of node.children.entries()){
  const line=lines[row?row+1:0];if(n.children.length!==line.values.length)return null;
  const children=[],mapped=[];let at=line.from+1;pos++;
  for(const [col,rawText] of line.values.entries()){
   const parts=cellParts(n.children[col].children,rawText,at,source);if(!parts)return null;
   const text=parts.map(p=>p.text).join(''),cell={text,sourceFrom:at,sourceTo:at+rawText.length,from:pos+2,to:pos+2+text.length,tableRow:row,tableCol:col,blockIndex};
   let offset=cell.from;
   const leaves=parts.map(p=>{const s={...p,from:offset,to:offset+p.text.length,tableRow:row,tableCol:col,blockIndex,childIndex:childIndex++};offset=s.to;return s;});
   const pmCell=tableCell('',row===0,node.align[col]);pmCell.content[0].content=inlineNodes(parts);
   children.push(pmCell);mapped.push({...cell,parts:leaves});spans.push(...leaves);
   pos+=text.length+4;at+=rawText.length+1;
  }
  cells.push(mapped);content.push({type:'tableRow',content:children});pos++;
 }
 pos++;
 return {doc:{type:'table',content},spans,size:pos-position,block:{from:position,to:pos,sourceFrom:start,sourceTo:end,cells,tableLines:lines}};
}

// One table cell only. Same physical text-leaf edits retain the existing
// composition path; changing wrappers or crossing mark runs stays structural.
export function planTableText(source,projection,{from,to,insert}){
 const block=projection.blocks.find(b=>b?.cells&&((from>b.from&&from<b.to)||(to>b.from&&to<b.to)));
 if(!block)return null;
 const reject=()=>({ok:false,code:'unsafe-source-range'}),cell=block.cells.flat().find(c=>from>=c.from&&to<=c.to);
 if(!cell||!valid(insert))return reject();
 const plan=planTreeRange(source,projection,{from,to,insert},cell.parts);if(!plan?.ok)return plan||reject();
 const leaf=cell.parts.find(s=>from>=s.from&&to<=s.to);
 if(leaf){const a=leaf.sourceFrom+from-leaf.from,b=leaf.sourceFrom+to-leaf.from;
  if(source.slice(0,a)+insert+source.slice(b)===plan.source)plan.structural=false;
 }
 return plan;
}
export function mapTableText(source,projection,change,project){
 const plan=planTableText(source,projection,change);if(!plan?.ok)return plan;
 const {expected,...result}=plan,next=project(plan.source);
 return JSON.stringify(next.doc)===JSON.stringify(expected)?{...result,projection:next}:{ok:false,code:'unsafe-source-range'};
}
