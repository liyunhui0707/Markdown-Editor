'use strict';
// Explicit reference collection only. Never scan a directory or resolve a URL.
const fs=require('node:fs'),path=require('node:path');
const fail=()=>{throw Object.assign(Error(),{code:'image-reference-unavailable'});};
function captureImageRoot(file){
 try{
  if(typeof file!=='string'||!path.isAbsolute(file))return null;
  const root=path.dirname(file),s=fs.lstatSync(root,{bigint:true});
  if(!s.isDirectory()||fs.realpathSync(root)!==root)return null;
  return {root,dev:s.dev,ino:s.ino};
 }catch{return null;}
}
function relativeImagePath(href){
 if(typeof href!=='string'||!href||href.length>2048||/[\\:#?\u0000-\u001f\u007f]/.test(href)||href.startsWith('/'))fail();
 let decoded;try{decoded=decodeURIComponent(href);}catch{fail();}
 // Encoded separators and a second encoding layer are not alternate authority.
 if(/%(?:2f|5c)/i.test(href)||/[\\:%#?\u0000-\u001f\u007f]/.test(decoded))fail();
 if(decoded.startsWith('./'))decoded=decoded.slice(2);
 const parts=decoded.split('/');
 if(parts.length>8||parts.some(p=>!p||p.startsWith('.')||/^secrets$/i.test(p))||!/\.(png|jpe?g)$/i.test(parts.at(-1)))fail();
 return parts;
}
function readRelativeImage(anchor,href,read){
 if(!anchor)fail();
 const parts=relativeImagePath(href),verify=()=>{
  const s=fs.lstatSync(anchor.root,{bigint:true});
  if(!s.isDirectory()||s.dev!==anchor.dev||s.ino!==anchor.ino||fs.realpathSync(anchor.root)!==anchor.root)fail();
 };
 verify();let current=anchor.root;const directories=[];
 for(const part of parts.slice(0,-1)){
  current=path.join(current,part);const s=fs.lstatSync(current,{bigint:true});
  if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(current)!==current)fail();
  directories.push({file:current,dev:s.dev,ino:s.ino});
 }
 const asset=read(path.join(current,parts.at(-1)));
 verify();for(const d of directories){const s=fs.lstatSync(d.file,{bigint:true});if(!s.isDirectory()||s.dev!==d.dev||s.ino!==d.ino||fs.realpathSync(d.file)!==d.file)fail();}
 return asset;
}
module.exports={captureImageRoot,relativeImagePath,readRelativeImage};
