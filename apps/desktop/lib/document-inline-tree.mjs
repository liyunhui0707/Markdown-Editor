import {projectInlineLeaf,inlineTextNode} from './document-inline-leaf.mjs';
// Preserve lexical emphasis wrappers. Do not normalize arbitrary inline Markdown.
export function projectInlineParts(child,source) {
 const simple=projectInlineLeaf(child,source);if(simple)return [simple];
 const parts=[];
 function walk(node,frames=[]){
  if(!['strong','emphasis'].includes(node.type)){
   const p=projectInlineLeaf(node,source);
   if(!p||p.bold||p.italic||p.code||p.link)return false;
   parts.push({...p,bold:frames.some(f=>f.kind==='bold'),italic:frames.some(f=>f.kind==='italic'),frames});return true;
  }
  const kind=node.type==='strong'?'bold':'italic';
  if(!node.children?.length||frames.length>=4||frames.some(f=>f.kind===kind))return false;
  const from=node.position.start.offset,to=node.position.end.offset;
  const open=source.slice(from,node.children[0].position.start.offset),close=source.slice(node.children.at(-1).position.end.offset,to);
  if(!(kind==='bold'?['**','__']:['*','_']).includes(open)||close!==open)return false;
  const next=[...frames,{kind,from,to,open,close}];
  return node.children.every(n=>walk(n,next));
 }
 if(!walk(child)||!parts.length||renderInlineParts(parts,source)!==source.slice(child.position.start.offset,child.position.end.offset))return null;
 return parts;
}
export function inlineFrames(part,source){
 if(part.frames)return part.frames;
 if(part.link){const {from,to}=part.linkSource||{};return [{kind:'link',from,to,open:source.slice(from,part.sourceFrom),close:source.slice(part.sourceTo,to)}];}
 const kind=part.bold?'bold':part.italic?'italic':part.code?'code':null;
 if(!kind)return [];
 const size=kind==='bold'?2:1,from=part.sourceFrom-size,to=part.sourceTo+size;
 return [{kind,from,to,open:source.slice(from,part.sourceFrom),close:source.slice(part.sourceTo,to)}];
}
export function renderInlineParts(parts,source){
 let stack=[],out='';
 for(const p of parts){
  if(!p.text)continue;
  const frames=inlineFrames(p,source);let common=0;
  while(common<stack.length&&common<frames.length&&stack[common].kind===frames[common].kind&&stack[common].from===frames[common].from&&stack[common].to===frames[common].to)common++;
  for(const f of stack.slice(common).toReversed())out+=f.close;
  for(const f of frames.slice(common))out+=f.open;
  out+=p.text;stack=frames;
 }
 for(const f of stack.toReversed())out+=f.close;
 return out;
}
export function inlineNodes(parts){
 const nodes=[];
 for(const p of parts){if(!p.text)continue;const n=inlineTextNode(p),last=nodes.at(-1);
  if(last&&JSON.stringify(last.marks)===JSON.stringify(n.marks))last.text+=n.text;else nodes.push(n);
 }
 return nodes;
}
