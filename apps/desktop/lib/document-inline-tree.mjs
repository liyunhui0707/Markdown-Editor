import {projectInlineLeaf,inlineTextNode} from './document-inline-leaf.mjs';
// Exact lexical frames; no serializer or normalization of arbitrary Markdown.
function linkFrame(node,source){
 const from=node.position.start.offset,to=node.position.end.offset;
 const labelFrom=node.children?.[0]?.position.start.offset,labelTo=node.children?.at(-1)?.position.end.offset;
 if(node.position.start.line!==node.position.end.line||labelFrom!==from+1
   ||source[from]!=='['||source.slice(labelTo,labelTo+2)!==']('||source[to-1]!==')')return null;
 const match=source.slice(labelTo+2,to-1).match(/^([ \t]*)(<[^<>\r\n]*>|[^ \t\r\n]*)([\s\S]*)$/);if(!match)return null;
 return {kind:'link',from,to,open:'[',close:source.slice(labelTo,to),link:{href:node.url,title:node.title??null},
  linkSource:{from,to,labelFrom,labelTo,destinationFrom:labelTo+2+match[1].length,destinationTo:labelTo+2+match[1].length+match[2].length}};
}
export function framedInlinePart(part,outer,source){
 const frames=[...outer,...inlineFrames(part,source)];
 if(frames.length>4||new Set(frames.map(f=>f.kind)).size!==frames.length)return null;
 const link=frames.find(f=>f.kind==='link');
 return {...part,frames,bold:frames.some(f=>f.kind==='bold'),italic:frames.some(f=>f.kind==='italic'),code:frames.some(f=>f.kind==='code'),
  ...(link?{link:link.link??part.link,linkSource:link.linkSource??part.linkSource}:{})};
}
export function projectInlineParts(child,source) {
 const simple=projectInlineLeaf(child,source);if(simple)return [simple];
 const parts=[];
 function walk(node,frames=[]){
  if(!['strong','emphasis','link'].includes(node.type)){
   const p=projectInlineLeaf(node,source),part=p&&framedInlinePart(p,frames,source);
   if(!part)return false;parts.push(part);return true;
  }
  const kind=node.type==='strong'?'bold':node.type==='emphasis'?'italic':'link';
  if(!node.children?.length||frames.length>=4||frames.some(f=>f.kind===kind))return false;
  let frame;
  if(kind==='link')frame=linkFrame(node,source);
  else{
   const from=node.position.start.offset,to=node.position.end.offset;
   const open=source.slice(from,node.children[0].position.start.offset),close=source.slice(node.children.at(-1).position.end.offset,to);
   if(!(kind==='bold'?['**','__']:['*','_']).includes(open)||close!==open)return false;
   frame={kind,from,to,open,close};
  }
  return !!frame&&node.children.every(n=>walk(n,[...frames,frame]));
 }
 if(!walk(child)||!parts.length||renderInlineParts(parts,source)!==source.slice(child.position.start.offset,child.position.end.offset))return null;
 return parts;
}
export function inlineFrames(part,source){
 if(part.frames)return part.frames;
 if(part.link){const {from,to}=part.linkSource||{};return [{kind:'link',from,to,open:source.slice(from,part.sourceFrom),close:source.slice(part.sourceTo,to),link:part.link,linkSource:part.linkSource}];}
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

// Code must stay innermost: emphasis inside backticks is literal code text.
export function toggleInlineFrames(part,action,source,remove=!!part[action]){
 const frames=inlineFrames(part,source);
 if(remove)return {...part,[action]:false,frames:frames.filter(f=>f.kind!==action)};
 if(part[action])return part;
 const marker=action==='bold'?'**':action==='italic'?(part.bold?'_':'*'):'`';
 const frame={kind:action,from:-1,to:-1,open:marker,close:marker};
 const at=action==='code'?frames.length:frames.findIndex(f=>f.kind==='code');
 return {...part,[action]:true,frames:at<0?[...frames,frame]:[...frames.slice(0,at),frame,...frames.slice(at)]};
}

// Structural joins may coalesce ordinary mark runs, but distinct source links
// retain their own destination/title bytes unless all lexical wrappers match.
export function mergeInlineParts(parts){
 const out=[],wrappers=p=>p.frames?.map(f=>[f.kind,f.open,f.close]);
 for(const value of parts){
  if(!value.text)continue;let part={...value};const last=out.at(-1);
  const sameLink=last&&JSON.stringify(last.link)===JSON.stringify(part.link);
  if(sameLink&&part.link){
   const at=part.frames.findIndex(f=>f.kind==='link'),previous=last.frames.findIndex(f=>f.kind==='link');
   if(at===previous&&at>=0&&JSON.stringify(wrappers(last).slice(0,at+1))===JSON.stringify(wrappers(part).slice(0,at+1)))
    part.frames=[...last.frames.slice(0,at+1),...part.frames.slice(at+1)];
  }
  const sameFrames=last&&JSON.stringify(last.frames?.map(f=>f.kind))===JSON.stringify(part.frames?.map(f=>f.kind));
  if(sameFrames&&sameLink&&(!part.link||JSON.stringify(wrappers(last))===JSON.stringify(wrappers(part))))last.text+=part.text;
  else out.push(part);
 }return out;
}
