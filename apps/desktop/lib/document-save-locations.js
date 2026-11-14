// Explicit non-Home directory grants. No scans, symlink traversal or chmod.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {directoryHelperPath,inspectDirectoryLocation}=require('./document-directory-location');
const fail=code=>{throw Object.assign(Error(code),{code,status:'blocked'});};
const identity=s=>({dev:String(s.dev),ino:String(s.ino),mode:Number(s.mode&0o7777n),uid:Number(s.uid),gid:Number(s.gid)});
function inspectLocalVolume(directory){
 const r=spawnSync(directoryHelperPath(),['--inspect-volume',directory],{encoding:'utf8',timeout:3000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 let v;try{if(r.error||r.signal||r.status!==0)throw Error();v=JSON.parse(r.stdout);}catch{fail('volume-inspection-unavailable');}
 if(v?.ok!==true||v.filesystem!=='apfs'||v.local!==true||v.writable!==true||v.ownership!==true||typeof v.uuid!=='string'||!/^[A-Fa-f0-9-]{36}$/.test(v.uuid)||typeof v.dev!=='string'||typeof v.mount!=='string'||!path.isAbsolute(v.mount)||Object.keys(v).length!==8)fail(v?.code==='cloud-directory'?'cloud-directory':'unsupported-filesystem');
 const {ok,...proof}=v;return proof;
}
function captureLocalDirectory(root,inspectMetadata){
 const parts=root.slice(1).split('/');
 if(parts.length>32||parts.some(n=>!n||n.startsWith('.')||/^(?:System|Library|Applications|bin|sbin|usr|etc|dev|proc)$/i.test(n)||/^(?:Dropbox|OneDrive|Google[ -]?Drive|iCloud|Box(?:[ -]|$)|Nextcloud|Syncthing)/i.test(n))||fs.realpathSync(root)!==root)fail('unsupported-copy-directory');
 const locations=['/'];for(const part of parts)locations.push(path.join(locations.at(-1),part));
 const ancestors=locations.map(location=>{
  const s=fs.lstatSync(location,{bigint:true}),mode=Number(s.mode&0o7777n),leaf=location===root;
  const sticky=['/Users/Shared','/private/tmp'].includes(location)&&mode===0o1777;
  const transit=!leaf&&Number(s.uid)===0&&(mode===0o755||mode===0o555||sticky);
  if(!s.isDirectory()||s.isSymbolicLink()||(!transit&&(Number(s.uid)!==process.getuid()||(mode&0o7022)!==0||!(mode&0o100)))||(leaf&&(mode&0o300)!==0o300))fail('unsupported-copy-directory');
  return {path:location,identity:identity(s),...(transit?{trustedTransit:true}:{}),...(leaf?{location:inspectDirectoryLocation(location)}:{}),metadata:inspectMetadata(location,{newFileDirectory:true,trustedTransit:transit})};
 });
 const volume=inspectLocalVolume(root),leaf=ancestors.at(-1);fs.accessSync(root,fs.constants.W_OK|fs.constants.X_OK);
 if(volume.dev!==leaf.identity.dev||fs.realpathSync(root)!==root||ancestors.some(a=>JSON.stringify(identity(fs.lstatSync(a.path,{bigint:true})))!==JSON.stringify(a.identity)))fail('copy-directory-changed');
 return {identity:leaf.identity,filesystem:fs.statfsSync(root).type,metadata:leaf.metadata,ancestors,volume};
}
module.exports={captureLocalDirectory,inspectLocalVolume};
