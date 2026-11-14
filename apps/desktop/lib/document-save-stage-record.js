// Main-only locators. Listing/archiving never probes a possibly offline volume.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {inspectLocalVolume}=require('./document-save-locations');
const {inspectMacMetadata}=require('./document-save-policy');
const fail=()=>{throw Object.assign(Error('staging unavailable'),{code:'staging-unavailable'});};
function validateStageRecord(proof,{root,recordId,filePath}){
 const rootName='.markdown-recovery-'+createHash('sha256').update(root).digest('hex').slice(0,24);
 if(proof?.version!==1||proof.record!==recordId||proof.rootName!==rootName||proof.path!==path.join(path.dirname(filePath),rootName,recordId)||proof.owner?.version!==1||proof.owner.localRecoveryRoot!==root||proof.owner.uid!==process.getuid()||typeof proof.volume?.uuid!=='string'||!/^[A-Fa-f0-9-]{36}$/.test(proof.volume.uuid))fail();
 for(const i of [proof.identity,proof.rootIdentity])if(!i||i.mode!==0o700||i.uid!==process.getuid()||typeof i.ino!=='string'||!/^\d+$/.test(i.ino)||i.dev!==proof.volume.dev)fail();
 return proof;
}
function locateStage(proof,options,json){
 validateStageRecord(proof,options);
 const parent=path.dirname(options.filePath),volume=inspectLocalVolume(parent);
 // dev changes on reconnect; a volume UUID plus inode and current metadata binds
 // this explicit read-only reveal to the original volume, not a reused mount name.
 if(volume.uuid!==proof.volume.uuid)fail();
 const root=path.dirname(proof.path),dirs=[[root,proof.rootIdentity],[proof.path,proof.identity]];
 function check(){for(const [p,wanted] of dirs){const s=fs.lstatSync(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||String(s.ino)!==wanted.ino||String(s.dev)!==volume.dev||Number(s.uid)!==wanted.uid||Number(s.gid)!==wanted.gid||Number(s.mode&0o7777n)!==0o700||fs.realpathSync(p)!==p)fail();const m=inspectMacMetadata(p,{newFileDirectory:true});if(m.acl)fail();}}
 check();const owner=json(path.join(root,'owner.json'));
 if(owner.version!==proof.owner.version||owner.localRecoveryRoot!==proof.owner.localRecoveryRoot||owner.uid!==proof.owner.uid||Object.keys(owner).length!==3)fail();check();
 if(inspectLocalVolume(parent).uuid!==volume.uuid)fail();return proof.path;
}
module.exports={validateStageRecord,locateStage};
