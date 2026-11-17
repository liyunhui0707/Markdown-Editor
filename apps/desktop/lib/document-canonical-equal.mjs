import {equalProjection} from './document-projection-equal.mjs';
// Compare the complete canonical JSON tree, merging only adjacent text with the
// same marks as canonicalDocument does. No whole-tree clones/strings or caches;
// planners keep owning their mutable projections, including every distant node.
function runEnd(content,start){
 const node=content[start];let end=start+1;
 if(node.type==='text'&&content[end]?.type==='text'){
  const marks=JSON.stringify(node.marks);
  while(end<content.length&&content[end].type==='text'&&JSON.stringify(content[end].marks)===marks)end++;
 }
 return end;
}
function merged(content,start,end){
 if(end===start+1)return content[start];
 let text=content[start].text;for(let i=start+1;i<end;i++)text+=content[i].text;
 return {...content[start],text};
}
export function equalCanonicalProjection(a,b){
 if(a===b)return true;
 if(!a?.content||!b?.content)return equalProjection(a,b);
 if(!Array.isArray(a.content)||!Array.isArray(b.content))return false;
 const keys=Object.keys(a),other=Object.keys(b);
 if(keys.length!==other.length)return false;
 for(let i=0;i<keys.length;i++)if(keys[i]!==other[i]||(keys[i]!=='content'&&!equalProjection(a[keys[i]],b[keys[i]])))return false;
 let x=0,y=0;
 while(x<a.content.length&&y<b.content.length){
  const endX=runEnd(a.content,x),endY=runEnd(b.content,y);
  if(!equalCanonicalProjection(merged(a.content,x,endX),merged(b.content,y,endY)))return false;
  x=endX;y=endY;
 }
 return x===a.content.length&&y===b.content.length;
}
