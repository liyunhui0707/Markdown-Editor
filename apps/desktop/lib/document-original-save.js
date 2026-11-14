'use strict';
const {MAX_DOCUMENT_BYTES} = require('./document-capacity');
// Main-owned bridge for the File Store's coordinated, version-preserving replace.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const {persistentDirectory}=require('./document-save-policy');
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const id=s=>({dev:String(s.dev),ino:String(s.ino),mode:Number(s.mode&0o7777n),uid:Number(s.uid),gid:Number(s.gid)});
const same=require('node:util').isDeepStrictEqual;
const unknown=code=>({ok:false,state:'save-outcome-unknown',committed:null,code});
function createOriginalSave({root,binary,timeoutMs=15000}) {
 if(!path.isAbsolute(root)||!path.isAbsolute(binary))fail('invalid-save-configuration');
 try{fs.mkdirSync(root,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 const executable=fs.lstatSync(binary);if(!executable.isFile()||executable.isSymbolicLink()||(executable.mode&0o022))fail('save-helper-unavailable');fs.accessSync(binary,fs.constants.X_OK);
 const archiveRoot=root+'-archive';let archiveIdentity=null;
 function verifyArchive(){try{fs.mkdirSync(archiveRoot,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(archiveRoot,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(s.mode&0o7777n)!==0o700n||fs.realpathSync(archiveRoot)!==archiveRoot)fail('archive-unavailable');if(archiveIdentity&&!same(id(s),archiveIdentity))fail('archive-changed');archiveIdentity=id(s);}
 const initial=id(fs.lstatSync(root,{bigint:true}));const active=new Set(),children=new Set();
 function verify(){const s=fs.lstatSync(root,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(s.mode&0o7777n)!==0o700n||fs.realpathSync(root)!==root||!same(id(s),initial))fail('save-recovery-unavailable');}
 verify();
 function directory(recordId,base=root){verify();if(base!==root)verifyArchive();if(typeof recordId!=='string'||!/^[a-f0-9-]{36}$/.test(recordId))fail('invalid-save-record');
  const p=path.join(base,recordId),s=fs.lstatSync(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(s.mode&0o7777n)!==0o700n)fail('invalid-save-record');return p;}
 function json(p){let fd;try{const before=fs.lstatSync(p,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid())||before.size>65536n)fail('invalid-save-record');
  fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const opened=fs.fstatSync(fd,{bigint:true});if(opened.ino!==before.ino||opened.dev!==before.dev)fail('save-record-changed');
  const buffer=Buffer.alloc(Number(before.size));let offset=0;while(offset<buffer.length){const n=fs.readSync(fd,buffer,offset,buffer.length-offset,offset);if(!n)fail('save-record-changed');offset+=n;}
  const text=buffer.toString('utf8'),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(p,{bigint:true});if(named.ino!==before.ino||named.dev!==before.dev)fail('save-record-changed');if(after.ctimeNs!==before.ctimeNs||after.mtimeNs!==before.mtimeNs||after.size!==before.size)fail('save-record-changed');return JSON.parse(text);
 }finally{if(fd!==undefined)fs.closeSync(fd);}}
 function list(){try{verify();const names=fs.readdirSync(root);if(names.length>128)fail('save-recovery-capacity');
  const records=names.map(recordId=>{try{const p=directory(recordId),request=json(path.join(p,'request.json'));let outcome;
   let accepted=false;try{outcome=json(path.join(p,'outcome.json'));const ack=json(path.join(p,'accepted.json'));accepted=ack.sha256===outcome.sha256&&ack.revision===outcome.revision;}catch{/* Missing/partial outcome remains unknown. */}
   return {id:recordId,label:path.basename(request.filePath||''),filePath:request.filePath,revision:request.revision,time:request.time,
    state:outcome?.ok===true?(accepted?'saved-confirmed':'save-outcome-unknown'):outcome?.state||'save-outcome-unknown',code:outcome?.code||null};
  }catch{return {id:recordId,label:'无法验证的保存记录',state:'save-outcome-unknown'};}}).sort((a,b)=>(b.time||0)-(a.time||0));
  let archived=[],archiveWarning=null;try{verifyArchive();archived=fs.readdirSync(archiveRoot).map(recordId=>{try{const request=json(path.join(directory(recordId,archiveRoot),'request.json'));return {id:recordId,label:path.basename(request.filePath),revision:request.revision,time:request.time,archived:true};}catch{return {id:recordId,label:'需要检查的归档',archived:true,warning:'archive-needs-attention'};}});}catch{archiveWarning='archive-unavailable';}
  const newest=new Map();for(const r of records)if(r.state==='saved-confirmed')newest.set(r.filePath,Math.max(newest.get(r.filePath)||0,r.time||0));for(const r of records){const first=(r.time||0)>=newest.get(r.filePath);
   if(!first&&r.state==='saved-confirmed'&&!active.has(r.filePath)&&!archived.some(a=>a.id===r.id)){
    try{r.manageToken=recordToken(r.id);}catch{/* Unsafe material stays visible, never movable. */}
   }
  }
  return {ok:true,records,archived,archiveWarning,capacity:{records:names.length,maxRecords:128}};
 }catch{return {ok:false,code:'save-recovery-unavailable',records:[]};}}
 function locate(recordId){try{return directory(recordId);}catch{return directory(recordId,archiveRoot);}}
 function recordToken(recordId){const p=directory(recordId),names=fs.readdirSync(p).sort();
  const allowed=new Set(['request.json','outcome.json','accepted.json','baseline.md','draft.md','exchanged.md','previous.md','prepared.json','confirmed.json']);
  if(names.some(n=>!allowed.has(n)))fail('invalid-save-record');
  const sum=createHash('sha256');for(const n of names){const f=path.join(p,n),s=fs.lstatSync(f,{bigint:true});
   if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.uid!==BigInt(process.getuid())||(s.mode&0o022n))fail('invalid-save-record');
   sum.update(n+':'+[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':'));}return sum.digest('hex');
 }
 function offload(recordId,expectedToken,protectedIds=[]){try{
  const row=list().records.find(r=>r.id===recordId);
  if(!row?.manageToken||row.manageToken!==expectedToken||protectedIds.includes(recordId))fail('save-record-protected');
  const p=directory(recordId),before=id(fs.lstatSync(p,{bigint:true}));
  const check=()=>{verify();if(!same(id(fs.lstatSync(p,{bigint:true})),before)||active.has(row.filePath))fail('save-record-changed');};
  if(recordToken(recordId)!==expectedToken)fail('save-record-changed');
  const request=json(path.join(p,'request.json')),outcome=json(path.join(p,'outcome.json')),ack=json(path.join(p,'accepted.json'));
  if(!outcome.ok||outcome.committed!==true||outcome.state!=='saved-confirmed'||!/^[a-f0-9]{64}$/.test(request.sha256)||outcome.sha256!==request.sha256||ack.sha256!==request.sha256||outcome.revision!==request.revision||ack.revision!==request.revision)fail('invalid-save-record');
  const expected=request.expectedSha256;
  if(!/^[a-f0-9]{64}$/.test(expected)||!same(json(path.join(p,'confirmed.json')),outcome))fail('invalid-save-record');
  for(const [name,wanted] of [['draft.md',request.sha256],['baseline.md',expected],['previous.md',expected],['exchanged.md',expected]]){
   const file=path.join(p,name),before=recordToken(recordId),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{const stat=fs.fstatSync(fd);if(stat.size>MAX_DOCUMENT_BYTES)fail('save-record-changed');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)fail('save-record-changed');offset+=n;}if(hash(bytes)!==wanted)fail('save-record-changed');}finally{fs.closeSync(fd);}
   if(recordToken(recordId)!==before)fail('save-record-changed');
  }
  verifyArchive();if(fs.existsSync(path.join(archiveRoot,recordId)))fail('archive-conflict');
  check();if(recordToken(recordId)!==expectedToken)fail('save-record-changed');
  // Rename the whole transaction: retain inode/permissions/xattrs and displaced-object evidence.
  fs.renameSync(p,path.join(archiveRoot,recordId));
  for(const dir of [root,archiveRoot]){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  verify();verifyArchive();directory(recordId,archiveRoot);
  return {ok:true,state:'offloaded'};
 }catch(e){return {ok:false,state:'archive-unconfirmed',code:e.code||'archive-unconfirmed'};}}

 async function replace({expected,bytes,revision,isAuthorized,attachments=[]}){
  let recordId,tx,child,started=false;const key=expected.filePath;
  if(active.has(key))return {ok:false,state:'not-saved',committed:false,code:'save-in-progress'};
  active.add(key);
  try{
   if(!Buffer.isBuffer(bytes)||bytes.length>MAX_DOCUMENT_BYTES||!Number.isSafeInteger(revision)||!isAuthorized())fail('save-authorization-expired');
   verify();if(fs.readdirSync(root).length>=128)fail('save-recovery-capacity');
   const state=persistentDirectory(path.dirname(key));
   if(state.identity.dev!==initial.dev)fail('unsupported-filesystem');
   // Decode and verify with the existing image contract before granting the helper bytes.
   const assets=require('./document-local-images').decodeAttachments(attachments).map(a=>({name:a.name,body:a.bytes.toString('base64'),sha256:a.sha256}));
   recordId=randomUUID();tx=path.join(root,recordId);fs.mkdirSync(tx,{mode:0o700});
   const request={filePath:key,recoveryPath:tx,recoveryIdentity:id(fs.lstatSync(tx,{bigint:true})),
    expectedIdentity:expected.identity,expectedSha256:expected.sha256,body:bytes.toString('base64'),sha256:hash(bytes),revision,ancestors:state.ancestors,assets};
   const file=path.join(tx,'request.json');const fd=fs.openSync(file,'wx',0o600);
   try{fs.writeFileSync(fd,JSON.stringify({version:1,filePath:key,revision,time:Date.now(),expectedSha256:expected.sha256,sha256:request.sha256}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   for(const p of [tx,root]){const d=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
   if(!isAuthorized()||!same(persistentDirectory(path.dirname(key)),state))fail('save-authorization-expired');
   started=true;
   const result=await new Promise(resolve=>{
    let stdout='',stderr='',done=false,expired=false;const finish=r=>{if(done)return;done=true;clearTimeout(timer);resolve(r);};
    child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}});
    children.add(child);child.once('close',()=>children.delete(child));
    const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},timeoutMs);
    child.stdout.on('data',d=>{stdout+=d;if(stdout.length>16384){expired=true;child.kill('SIGKILL');}});
    child.stderr.on('data',d=>{stderr+=d;if(stderr.length>4096){expired=true;child.kill('SIGKILL');}});
    child.on('error',()=>finish(unknown('save-helper-unavailable')));
    child.once('close',code=>{if(expired||code!==0||stderr){finish(unknown(expired?'save-helper-timeout':'save-helper-unconfirmed'));return;}
     try{const result=JSON.parse(stdout);if(typeof result.ok!=='boolean'||![true,false,null].includes(result.committed))throw Error();
      if(!same(result,json(path.join(tx,'outcome.json'))))throw Error();finish(result);
     }catch{finish(unknown('save-result-unconfirmed'));}
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request)+'\n');
   });
   verify();if(!same(persistentDirectory(path.dirname(key)),state))return {...unknown('save-directory-changed'),recordId,recoveryPath:tx,filePath:key};
   if(!isAuthorized())return {...unknown('save-authorization-expired'),recordId,recoveryPath:tx};
   return {...result,recordId,recoveryPath:tx,filePath:key};
  }catch(e){return {...(started?unknown(e.code||'save-unconfirmed'):{ok:false,state:'not-saved',committed:false,code:e.code||'save-refused'}),...(recordId?{recordId,recoveryPath:tx}:{} )};}
  finally{active.delete(key);}
 }
 function acknowledge(recordId,receipt){const p=directory(recordId),native=json(path.join(p,'outcome.json'));
  if(!native.ok||native.sha256!==receipt.sha256||native.revision!==receipt.revision)fail('save-result-unconfirmed');
  const fd=fs.openSync(path.join(p,'accepted.json'),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({sha256:receipt.sha256,revision:receipt.revision}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }
 return {replace,list,locate,offload,acknowledge,cancelAll(){for(const child of children)child.kill('SIGKILL');}};
}
module.exports={createOriginalSave};
