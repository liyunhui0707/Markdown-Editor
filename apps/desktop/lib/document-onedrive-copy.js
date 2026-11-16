'use strict';
// Runs in the isolated copy utility, never on Electron's UI/main thread.
const path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const {decodeAttachments}=require('./document-local-images'),{verifyAttachment}=require('./document-image-export');
const {inspectMacMetadata}=require('./document-save-policy'),{directoryHelperPath}=require('./document-directory-location');
const hash=b=>createHash('sha256').update(b).digest('hex');
function runNative(request,{start=spawn,owner=process,timeoutMs=8000}={}){
 return new Promise(resolve=>{
  let child,out='',err='',done=false,unconfirmed=false,timer;
  const stop=()=>{try{child?.kill('SIGKILL');}catch{/* Unknown result retained. */}};
  const dying=()=>{stop();owner.exit(1);};
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);owner.removeListener('SIGTERM',dying);owner.removeListener('exit',stop);resolve(value);};
  try{
   child=start(directoryHelperPath(),[],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}});
   owner.once('SIGTERM',dying);owner.once('exit',stop);
   timer=setTimeout(()=>{unconfirmed=true;stop();},timeoutMs);
   child.on('error',()=>finish(null));
   child.stdout.on('data',b=>{out+=b;if(out.length>16384){unconfirmed=true;stop();}});child.stderr.on('data',b=>{err+=b;if(err.length>4096){unconfirmed=true;stop();}});
   child.once('close',code=>{try{finish(!unconfirmed&&code===0&&!err?JSON.parse(out):null);}catch{finish(null);}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request)+'\n');
  }catch{stop();finish(null);}
 });
}
async function createOneDriveCopy({name,bytes,attachments,destination},store){
 const filePath=path.join(destination.root,name),assets=decodeAttachments(attachments);
 const unknown=code=>({ok:false,created:null,state:'create-outcome-unknown',code,filePath});
 const request={operation:'create-onedrive-copy',filePath,ancestors:destination.state.ancestors,oneDrive:destination.state.oneDrive,volume:destination.state.volume,body:bytes.toString('base64'),sha256:hash(bytes),assets:assets.map(a=>({name:a.name,body:a.bytes.toString('base64'),sha256:a.sha256}))};
 const result=await runNative(request);if(!result)return unknown('onedrive-create-unconfirmed');
 if(!result?.ok)return result&&result.ok===false?{...result,filePath}:unknown('onedrive-create-unconfirmed');
 try{
  if(result.state!=='created-confirmed'||result.created!==true||result.filePath!==filePath||result.sha256!==request.sha256||result.byteLength!==bytes.length)throw Error();
  const read=store.read(filePath),metadata=inspectMacMetadata(filePath,{newlyCreatedFile:true,oneDriveFile:true});
  if(!read.bytes.equals(bytes)||read.identity.mode!==0o600||read.identity.uid!==destination.state.identity.uid||read.identity.gid!==destination.state.identity.gid)throw Error();
  const proofs=assets.map(a=>verifyAttachment(destination.root,a,{...destination.state.identity,oneDrive:true}));
  return {...result,fileIdentity:`${read.identity.dev}:${read.identity.ino}`,fileMetadataSha256:hash(JSON.stringify(metadata)),attachments:proofs};
 }catch{return {...result,ok:false,state:'created-unverified',code:'onedrive-create-post-verification-failed'};}
}
module.exports={createOneDriveCopy,runNative};
