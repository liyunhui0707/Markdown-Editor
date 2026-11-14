import {projectInlineParts} from './document-inline-tree.mjs';
import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
import {inlineTextNode} from './document-inline-leaf.mjs';
const inline=text=>text?[{type:'text',text}]:[];
export const literalBlockPrefix=text=>/^(?:>|`{1,2}|```[A-Za-z0-9_+-]{0,32})$/.test(text);

// Only explicitly prefixed, single-level quote paragraphs and closed top-level
// fences. Unsupported/lazy/nested structures remain opaque in the caller.
export function projectStructuredBlock(node,source,position,blockIndex){
 const start=node.position.start.offset,end=node.position.end.offset,raw=source.slice(start,end);
 const endings=raw.match(/\r\n|\n|\r/g)||[],nl=endings[0]||'\n';
 if(endings.some(s=>s!==nl))return null;
 const lines=raw.split(/\r\n|\n|\r/);
 if(node.type==='code'){
  const open=lines[0].match(/^(`{3,16}|~{3,16})([A-Za-z0-9_+-]{0,32})$/);
  if(!open||lines.length<2||node.meta||!new RegExp('^'+open[1][0]+'{'+open[1].length+',16}[ \\t]*$').test(lines.at(-1)))return null;
  const text=lines.slice(1,-1).join('\n');if(node.value.replace(/\r\n|\r/g,'\n')!==text||text.includes('\0'))return null;
  const bodyFrom=start+lines[0].length+nl.length,bodyTo=end-lines.at(-1).length-(lines.length>2?nl.length:0);
  const size=text.length+2,span={text,from:position+1,to:position+1+text.length,sourceFrom:bodyFrom,sourceTo:bodyTo,blockIndex,childIndex:0,bold:false,codeBlock:true};
  return {doc:{type:'codeBlock',attrs:{language:node.lang||null,sourceEditable:true},content:inline(text)},size,spans:[span],
   block:{from:position,to:position+size,sourceFrom:start,sourceTo:end,codeBody:{from:bodyFrom,to:bodyTo,nl,separator:lines.length>2?nl:''}}};
 }
 if(node.type!=='blockquote'||lines.length%2!==1||lines.length>63||node.children.some(n=>n.type!=='paragraph'||n.position.start.line!==n.position.end.line))return null;
 const content=[],spans=[],quoteRows=[];let sourceAt=start,pm=position+2,used=0,childIndex=0;
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.startsWith('> ')||(i%2&&line!=='> '))return null;
  if(i%2){sourceAt+=line.length+nl.length;continue;}
  const body=line.slice(2),bodyFrom=sourceAt+2,parts=[];
  if(body){
   const paragraph=node.children.find(n=>n.position.start.offset===bodyFrom);if(!paragraph)return null;used++;
   for(const child of paragraph.children){const p=projectInlineParts(child,source);if(!p)return null;parts.push(...p);}
   if(parts.length===1&&!parts[0].bold&&!parts[0].italic&&!parts[0].code&&!parts[0].link){
    if(body.trimStart()!==body)return null;parts[0]={...parts[0],text:body,sourceFrom:bodyFrom,sourceTo:sourceAt+line.length};
   }else if(paragraph.position.end.offset!==sourceAt+line.length)return null;
  }else parts.push({text:'',sourceFrom:bodyFrom,sourceTo:bodyFrom,bold:false});
  const quoteIndex=content.length,nodes=[];let offset=0;
  for(const [inlineIndex,p] of parts.entries()){
   spans.push({...p,from:pm+offset,to:pm+offset+p.text.length,blockIndex,childIndex:childIndex++,quoteIndex,inlineIndex});
   if(p.text)nodes.push(inlineTextNode(p));offset+=p.text.length;
  }
  quoteRows.push({sourceFrom:sourceAt,sourceTo:sourceAt+line.length,bodyFrom,from:pm,to:pm+offset});
  content.push({type:'paragraph',content:nodes});pm+=offset+2;sourceAt+=line.length+nl.length;
 }
 if(used!==node.children.length)return null;
 const size=pm-position;
 return {doc:{type:'blockquote',content},spans,size,block:{from:position,to:position+size,sourceFrom:start,sourceTo:end,quoteRows}};
}
const splits=(s,n)=>/[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');
const validCode=s=>!/[\0\r\u0001-\u0008\u000b-\u001f\u007f]/.test(s)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
export function mapCodeText(source,p,{from,to,insert},project){
 const s=p.spans.find(s=>s.codeBlock&&from>=s.from&&to<=s.to);if(!s)return null;
 const reject=()=>({ok:false,code:'unsafe-source-range'}),block=p.blocks[s.blockIndex],body=block.codeBody;
 const a=from-s.from,b=to-s.from;
 if(!validCode(insert)||splits(s.text,a)||splits(s.text,b))return reject();
 const offset=n=>{let logical=0,raw=0;for(const part of source.slice(body.from,body.to).matchAll(/\r\n|[\s\S]/g)){if(logical===n)break;logical++;raw+=part[0].length;}return body.from+raw;};
 const start=offset(a),end=offset(b),text=insert.replace(/\n/g,body.nl)+(!body.separator&&insert?body.nl:'');
 if(text.length>4096||end-start>4096)return reject();
 const next=source.slice(0,start)+text+source.slice(end);if(next.length>MAX_SOURCE_UNITS)return reject();
 const expected=structuredClone(p.doc);expected.content[s.blockIndex].content=inline(s.text.slice(0,a)+insert+s.text.slice(b));
 const projection=project(next);if(JSON.stringify(expected)!==JSON.stringify(projection.doc))return reject();
 return {ok:true,source:next,projection,change:{from:start,to:end,insert:text},inverseSource:{from:start,to:start+text.length,insert:source.slice(start,end)},selection:{from:from+insert.length,to:from+insert.length}};
}
