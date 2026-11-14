'use strict';
// Explicit recovery offload. A durable verified copy precedes any source removal.
const nativeFs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {MAX_RECORD_BYTES}=require('./document-capacity');
const hash=b=>createHash('sha256').update(b).digest('hex');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const stamp=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
const fail=code=>{throw Object.assign(Error(code),{code});};
function createRecordArchive(root,{fs=nativeFs}={}){
 let identity=null;
 function verify(){
  if(!path.isAbsolute(root))fail('archive-unavailable');
  if(!fs.existsSync(root)){if(identity)fail('archive-changed');fs.mkdirSync(root,{mode:0o700});}
  const s=fs.lstatSync(root,{bigint:true});
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(s.mode&0o7777n)!==0o700n||fs.realpathSync(root)!==root)fail('archive-unavailable');
  const next=[s.dev,s.ino].join(':');if(identity&&identity!==next)fail('archive-changed');identity=next;
 }
 function folder(id){verify();if(!uuid.test(id))fail('invalid-archive');const p=path.join(root,id),s=fs.lstatSync(p,{bigint:true});
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==BigInt(process.getuid())||(s.mode&0o7777n)!==0o700n)fail('invalid-archive');return p;}
 function read(file,max=MAX_RECORD_BYTES){let fd;try{const before=fs.lstatSync(file,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.uid!==BigInt(process.getuid())||(before.mode&0o022n)||before.size>BigInt(max))fail('invalid-archive');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);if(stamp(fs.fstatSync(fd,{bigint:true}))!==stamp(before))fail('archive-changed');
  const bytes=Buffer.alloc(Number(before.size));let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)fail('archive-changed');offset+=n;}if(stamp(fs.fstatSync(fd,{bigint:true}))!==stamp(before)||stamp(fs.lstatSync(file,{bigint:true}))!==stamp(before))fail('archive-changed');
  return {bytes,identity:stamp(before)};
 }finally{if(fd!==undefined)fs.closeSync(fd);}}
 function sync(p){const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function write(p,bytes){const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function inspect(id,contents=false){const p=folder(id),m=read(path.join(p,'manifest.json'),65536),done=read(path.join(p,'complete.json'),1024);
  const manifest=JSON.parse(m.bytes),receipt=JSON.parse(done.bytes);
  if(manifest.version!==1||manifest.id!==id||receipt.sha256!==hash(m.bytes)||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>128)fail('invalid-archive');
  if(manifest.files.some(f=>!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_RECORD_BYTES||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))||manifest.files.reduce((n,f)=>n+f.size,0)>2*MAX_RECORD_BYTES)fail('archive-capacity');
  const names=manifest.files.map(f=>f.name);
  if(new Set(names).size!==names.length||names.some(n=>typeof n!=='string'||!n.match(/^[a-zA-Z0-9.-]+$/)||['manifest.json','complete.json'].includes(n)))fail('invalid-archive');
  const actual=fs.readdirSync(p).filter(n=>n!=='.DS_Store').sort();if(JSON.stringify(actual)!==JSON.stringify([...names,'manifest.json','complete.json'].sort()))fail('archive-changed');
  const files=contents?manifest.files.map(f=>{const r=read(path.join(p,f.name));if(r.bytes.length!==f.size||hash(r.bytes)!==f.sha256)fail('archive-changed');return {...f,...r};}):undefined;
  verify();return {...manifest,token:hash(m.identity+':'+done.identity),files:files||manifest.files,folder:p};
 }
 function list(){verify();return fs.readdirSync(root).filter(n=>n!=='.DS_Store').map(id=>{try{return inspect(id);}catch{return {id,warning:'archive-needs-attention',metadata:{label:'需要检查的归档'}};}});}
 function put({metadata,source,files,verifySource,expected}){
  verify();verifySource();if(!files.length||files.length>128||files.some(n=>typeof n!=='string'||!n.match(/^[a-zA-Z0-9.-]+$/)||['manifest.json','complete.json'].includes(n)))fail('invalid-archive');
  const original=[];let total=0;for(const name of files){const r=read(path.join(source,name));total+=r.bytes.length;if(total>2*MAX_RECORD_BYTES)fail('archive-capacity');if(r.identity!==expected?.[name])fail('archive-source-changed');original.push({name,...r});}
  const id=randomUUID(),p=path.join(root,id);fs.mkdirSync(p,{mode:0o700});
  const manifest={version:1,id,time:Date.now(),metadata,files:original.map(f=>({name:f.name,size:f.bytes.length,sha256:hash(f.bytes)}))};
  write(path.join(p,'manifest.json'),Buffer.from(JSON.stringify(manifest)));
  for(const f of original)write(path.join(p,f.name),f.bytes);
  sync(p);sync(root);write(path.join(p,'complete.json'),Buffer.from(JSON.stringify({sha256:hash(JSON.stringify(manifest))})));sync(p);sync(root);
  const confirmed=inspect(id,true);verifySource();
  // Recheck the complete source before touching it. Partial failures keep the archive.
  for(const f of original)if(read(path.join(source,f.name)).identity!==f.identity)fail('archive-source-changed');
  for(const f of original){verifySource();if(read(path.join(source,f.name)).identity!==f.identity)fail('archive-source-changed');fs.unlinkSync(path.join(source,f.name));}
  sync(source);verify();return confirmed;
 }
 return {put,list,inspect,folder};
}
module.exports={createRecordArchive};
