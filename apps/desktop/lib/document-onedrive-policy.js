'use strict';
// Recognition is not a grant: capture pins metadata/owners and native verifies again.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const fail=code=>{throw Object.assign(Error(code),{code,status:'blocked'});};
const id=s=>({dev:String(s.dev),ino:String(s.ino),mode:Number(s.mode&0o7777n),uid:Number(s.uid),gid:Number(s.gid)});
function oneDriveLayout(directory,home=os.homedir()){
 const prefix=path.join(home,'Library/CloudStorage')+path.sep;
 if(typeof directory!=='string'||directory!==path.normalize(directory)||!directory.startsWith(prefix))return null;
 const parts=directory.slice(prefix.length).split('/');
 if(!/^OneDrive-[^/]+$/.test(parts[0])||parts.length>32||parts.some(p=>!p||p.startsWith('.')||/^secrets$/i.test(p)))return null;
 return {root:prefix+parts[0],home};
}
function oneDriveRole(p,root,home=os.homedir()){
 return p===path.join(home,'Library')?'library':p===path.join(home,'Library/CloudStorage')?'storage':p===root?'domain':p.startsWith(root+'/')?'child':null;
}
function normalizeProviderIdentity(file,identity){return oneDriveLayout(path.dirname(file))?{...identity,ctimeNs:'0'}:identity;}
function oneDriveArtifact(file){const dir=path.dirname(file);return path.basename(file)==='owner.json'&&/^\.markdown-recovery-[a-f0-9]{24}$/.test(path.basename(dir))&&!!oneDriveLayout(path.dirname(dir));}
function inspectProviderFile(file){
 if(!oneDriveLayout(path.dirname(file)))return;
 // Metadata-only checks precede opening the data fork. Faulting/compressed or
 // unknown storage metadata never becomes an implicit download/read grant.
 try{require('./document-save-policy').inspectMacMetadata(file,{oneDriveFile:true});}catch{fail('onedrive-file-not-local');}
}
function canonicalDestination(file){
 const home=fs.realpathSync(os.homedir()),parent=path.dirname(file),alias=path.join(home,'OneDrive');
 if(parent!==alias&&!parent.startsWith(alias+'/'))return file;
 const resolved=fs.realpathSync(parent),layout=oneDriveLayout(resolved,home);
 if(!layout||fs.realpathSync(alias)!==layout.root)fail('unsupported-copy-directory');
 return path.join(resolved,path.basename(file));
}
function captureOneDrive(directory,inspectMetadata,inspectVolume){
 const home=fs.realpathSync(os.homedir()),layout=oneDriveLayout(directory,home);
 if(!layout||fs.realpathSync(directory)!==directory)fail('unsupported-copy-directory');
 const homeStat=fs.lstatSync(home,{bigint:true}),parts=directory.slice(home.length+1).split('/'),locations=[home];
 for(const part of parts)locations.push(path.join(locations.at(-1),part));
 const ancestors=locations.map(p=>{
  const s=fs.lstatSync(p,{bigint:true}),role=oneDriveRole(p,layout.root,home);
  if(!s.isDirectory()||s.isSymbolicLink()||s.dev!==homeStat.dev||Number(s.uid)!==process.getuid()||(s.mode&0o7022n)!==0n||!(s.mode&0o100n)||(p===directory&&(s.mode&0o300n)!==0o300n))fail('unsupported-copy-directory');
  return {path:p,identity:id(s),...(role?{oneDriveRole:role}:{}),metadata:inspectMetadata(p,{newFileDirectory:true,...(role?{oneDriveRole:role}:{})})};
 });
 const domain=ancestors.find(a=>a.path===layout.root),marker=domain.metadata.xattrs['com.apple.file-provider-domain-id'];
 if(!/^[a-f0-9]{64}$/.test(marker||'')||typeof domain.metadata.acl!=='string'||domain.metadata.acl.split('\n').length!==2||!domain.metadata.acl.includes('writeextattr'))fail('onedrive-domain-unavailable');
 const volume=inspectVolume(directory,{oneDrive:true});if(volume.dev!==String(homeStat.dev))fail('unsupported-filesystem');
 if(ancestors.some(a=>JSON.stringify(id(fs.lstatSync(a.path,{bigint:true})))!==JSON.stringify(a.identity))||fs.realpathSync(directory)!==directory)fail('copy-directory-changed');
 const leaf=ancestors.at(-1);return {identity:leaf.identity,filesystem:fs.statfsSync(directory).type,metadata:leaf.metadata,ancestors,oneDrive:{root:layout.root,domainSha256:marker},volume};
}
module.exports={oneDriveLayout,oneDriveRole,oneDriveArtifact,normalizeProviderIdentity,inspectProviderFile,canonicalDestination,captureOneDrive};
