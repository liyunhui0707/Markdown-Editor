'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {MAX_SOURCE_UNITS,MAX_DOCUMENT_BYTES}=require('./document-capacity.cjs');
class BridgeError extends Error{
 constructor(code,message=code,details={}){super(message);this.code=code;this.details=details;}
}
const fail=(code,message,details)=>{throw new BridgeError(code,message,details);};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const hash=b=>createHash('sha256').update(b).digest('hex');
function fields(value,allowed,required=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('invalid-arguments');
}
function filename(value){
 if(typeof value!=='string'||!value.isWellFormed()||value!==value.trim()||value.startsWith('.')||!(/^[^/\\\x00-\x1f\x7f]+\.md$/i).test(value)||Buffer.byteLength(value)>240)fail('invalid-filename');
 return value;
}
function sourceBytes(value){
 if(typeof value!=='string'||!value.isWellFormed()||value.includes('\0'))fail('invalid-markdown');
 const units=value.charCodeAt(0)===0xfeff?value.length-1:value.length;
 if(units>MAX_SOURCE_UNITS||Buffer.byteLength(value)>MAX_DOCUMENT_BYTES)fail('document-too-large');
 return Buffer.from(value,'utf8');
}
function nativeHost(config){
 function info(){
  if(process.platform!=='darwin')return {installed:false,running:null,reason:'macos-required'};
  try{
   const root=fs.lstatSync(config.app),plist=path.join(config.app,'Contents/Info.plist');
   if(!root.isDirectory()||root.isSymbolicLink()||![0,process.getuid()].includes(root.uid)||!fs.lstatSync(plist).isFile())throw Error();
   const read=k=>execFileSync('/usr/bin/plutil',['-extract',k,'raw','-o','-',plist],{encoding:'utf8',timeout:5000,maxBuffer:4096}).trim();
   if(read('CFBundleIdentifier')!=='com.markdownvault.document.dev')throw Error();
   const version=read('CFBundleShortVersionString');let running=null;
   try{const names=execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8',timeout:5000,maxBuffer:4*1024*1024}).split('\n');running=names.includes(path.join(config.app,'Contents/MacOS',read('CFBundleExecutable')));}catch{/* Unknown, never report false from a denied process query. */}
   return {installed:true,version,running,app_path:config.app};
  }catch{return {installed:false,running:null,app_path:config.app,reason:'app-unavailable'};}
 }
 return {status:info,open:file=>execFileSync('/usr/bin/open',['-a',config.app,'--',file],{stdio:['ignore','ignore','pipe'],timeout:15000,maxBuffer:16384})};
}
function createBridge(config,host=nativeHost(config)){
 const home=fs.realpathSync(config.home||os.homedir()),inbox=path.resolve(config.inbox);let pinned;
 function inboxProof(){
  const rel=path.relative(home,inbox);
  if(!rel||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||rel.split(path.sep).some(c=>c.startsWith('.')||['secrets','Library','Applications','node_modules'].includes(c)))fail('unsupported-inbox');
  const chain=[];let current=home;
  for(const part of ['',...rel.split(path.sep)]){
   if(part)current=path.join(current,part);let s;
   try{s=fs.lstatSync(current);}catch{fail('inbox-unavailable');}
   if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o022))fail('unsupported-inbox');
   chain.push({path:current,dev:s.dev,ino:s.ino});
  }
  if(fs.realpathSync(inbox)!==inbox)fail('unsupported-inbox');
  if(pinned&&chain.some((s,i)=>!same(s,pinned[i])))fail('inbox-changed');
  pinned??=chain;return chain.at(-1);
 }
 function installed(){if(!host.status().installed)fail('app-unavailable');}
 function checkFile(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))fail('unsupported-file');
  file=path.resolve(file);filename(path.basename(file));
  if(file.split(path.sep).some(c=>c.startsWith('.')||c==='secrets'))fail('unsupported-file');
  let s;try{s=fs.lstatSync(file);}catch{fail('file-unavailable');}
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>MAX_DOCUMENT_BYTES||fs.realpathSync(file)!==file)fail('unsupported-file');
  return file;
 }
 function deliver(file,extra={}){
  installed();
  try{host.open(file);}catch{fail('open-request-failed','文件已保留，但系统未确认接受打开请求。',{...extra,file_path:file,open_requested:false,display_verified:false,retry_create:false});}
  return {ok:true,...extra,file_path:file,open_requested:true,display_verified:false};
 }
 return {
  status(){let available=true,code=null;try{inboxProof();}catch(e){available=false;code=e.code;}
   return {ok:true,...host.status(),inbox,creation_available:available,...(code?{inbox_code:code}:{}),capabilities:['status','open','create'],document_state:'not-exposed'};
  },
  openExplicit(file){return deliver(checkFile(file));},
  openInInbox(args){fields(args,['filename'],['filename']);inboxProof();const file=checkFile(path.join(inbox,filename(args.filename)));inboxProof();return deliver(file);},
  create(args){
   fields(args,['filename','markdown','open'],['filename','markdown']);if(args.open!==undefined&&typeof args.open!=='boolean')fail('invalid-arguments');
   const name=filename(args.filename),bytes=sourceBytes(args.markdown),file=path.join(inbox,name),opening=args.open!==false;
   if(opening)installed();inboxProof();let fd,created=false;
   try{
    fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);created=true;
    const first=fs.fstatSync(fd);inboxProof();
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
    const read=Buffer.alloc(bytes.length);let offset=0;
    while(offset<read.length){const n=fs.readSync(fd,read,offset,read.length-offset,offset);if(!n)throw Error('short-read');offset+=n;}
    const last=fs.fstatSync(fd);inboxProof();const entry=fs.lstatSync(file);
    if(!same(first,last)||!same(last,entry)||last.nlink!==1||last.size!==bytes.length||!read.equals(bytes))throw Error('identity-or-content-changed');
    const dir=fs.openSync(inbox,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{if(!same(fs.fstatSync(dir),inboxProof()))throw Error('directory-changed');fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
   }catch(e){
    if(!created&&e.code==='EEXIST')fail('already-exists','目标已存在，没有覆盖。',{file_path:file,created:false});
    if(!created&&e instanceof BridgeError)throw e;
    fail('creation-unconfirmed','创建未确认；保留现场，不自动重试或删除。',{created,file_path:file,retry_create:false});
   }finally{if(fd!==undefined)fs.closeSync(fd);}
   const receipt={created:true,bytes:bytes.length,sha256:hash(bytes)};
   return opening?deliver(file,receipt):{ok:true,...receipt,file_path:file,open_requested:false,display_verified:false};
  },
 };
}
module.exports={createBridge,BridgeError,sourceBytes,filename,MAX_DOCUMENT_BYTES};
