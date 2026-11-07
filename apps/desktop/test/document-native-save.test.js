'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const binary=process.env.DOCUMENT_NATIVE_SAVE_TEST_BINARY;
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=Buffer.from('\ufeff# Original\r\n\nBaseline 中文.\r');
const edited=Buffer.from('\ufeff# Changed\r\n\nDraft 中文.\r');
const metadata=p=>{const s=fs.statSync(p,{bigint:true});return {dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),mode:Number(s.mode&0o7777n),uid:Number(s.uid),gid:Number(s.gid)};};
function fixture(){
 const root=fs.mkdtempSync(path.join(process.env.DOCUMENT_NATIVE_SAVE_TEST_ROOT||os.tmpdir(),'document-native-save-'));
 const dir=path.join(root,'files'),recovery=path.join(root,'recovery');fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(recovery,{mode:0o700});
 const file=path.join(dir,'原文.md');fs.writeFileSync(file,original,{flag:'wx',mode:0o640});
 const request={filePath:file,recoveryPath:recovery,recoveryIdentity:metadata(recovery),body:edited.toString('base64'),sha256:hash(edited),expectedIdentity:metadata(file),expectedSha256:hash(original),ancestors:[{path:dir,identity:metadata(dir),metadata:require('../lib/document-save-policy').inspectMacMetadata(dir,{newFileDirectory:true})}],revision:7};
 return {root,dir,file,recovery,request};
}
function run(f,{point,fault,hook,kill=false}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,[],{stdio:['pipe','pipe','pipe']});let text='',stderr='',result,hooked=false;
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Native transaction timed out'));},12000);
  child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
  child.stdout.on('data',data=>{text+=data;let line;
   while((line=text.indexOf('\n'))>=0){const value=JSON.parse(text.slice(0,line));text=text.slice(line+1);
    if(value.testPoint){hooked=true;try{hook?.(f);if(kill)child.kill('SIGKILL');else child.stdin.write('!');}catch(e){child.kill('SIGKILL');reject(e);}}
    else result=value;
   }
  });
  child.on('exit',(code,signal)=>{clearTimeout(timer);fs.writeFileSync(path.join(f.root,'test-result.json'),JSON.stringify({code,signal,result,stderr,hooked},null,2));
   if(kill&&signal==='SIGKILL')resolve({state:'process-killed',hooked});
   else if(code!==0||!result)reject(Error('Native exit '+code+' '+stderr));else resolve(result);
  });
  child.stdin.write(JSON.stringify({...f.request,...(point?{testPoint:point}:{}),...(fault?{testFault:fault}:{})})+'\n');
 });
}
const native=(name,fn)=>test(name,{skip:!binary||process.platform!=='darwin'},fn);
native('coordinated normal save retains exact baseline, draft and displaced inode; repeated save',async()=>{
 const f=fixture(),old=f.request.expectedIdentity;let r=await run(f);assert.equal(r.ok,true,JSON.stringify(r));
 assert.deepEqual(fs.readFileSync(f.file),edited);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'baseline.md')),original);
 assert.deepEqual(fs.readFileSync(path.join(f.recovery,'previous.md')),original);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),edited);
 assert.equal(metadata(path.join(f.recovery,'exchanged.md')).ino,old.ino);assert.equal(metadata(f.file).mode,0o640);
 const second=path.join(f.root,'second');fs.mkdirSync(second,{mode:0o700});f.recovery=second;
 f.request={...f.request,recoveryPath:second,recoveryIdentity:metadata(second),expectedIdentity:metadata(f.file),expectedSha256:hash(edited),body:original.toString('base64'),sha256:hash(original),revision:8};
 r=await run(f);assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(fs.readFileSync(f.file),original);
});
native('preexisting conflict never changes the target',async()=>{
 const f=fixture();fs.writeFileSync(f.file,'External before save');const r=await run(f);
 assert.equal(r.ok,false);assert.equal(r.committed,false);assert.equal(r.code,'external-change');assert.equal(fs.readFileSync(f.file,'utf8'),'External before save');
});
native('external replacement at final boundary is retained and never confirmed',async()=>{
 const f=fixture();let inode;const r=await run(f,{point:'before-swap',hook(){const p=path.join(f.dir,'external.md');fs.writeFileSync(p,'External replacement',{mode:0o600});inode=metadata(p).ino;fs.renameSync(p,f.file);}});
 assert.equal(r.ok,false);assert.equal(r.committed,true);assert.equal(r.code,'conflict-after-exchange');
 assert.equal(metadata(path.join(f.recovery,'exchanged.md')).ino,inode);assert.equal(fs.readFileSync(path.join(f.recovery,'exchanged.md'),'utf8'),'External replacement');assert.deepEqual(fs.readFileSync(f.file),edited);
});
native('same-inode external edit at final boundary remains recoverable',async()=>{
 const f=fixture();const r=await run(f,{point:'before-swap',hook(){fs.writeFileSync(f.file,'Same inode external write');}});
 assert.equal(r.ok,false);assert.equal(r.committed,true);assert.equal(fs.readFileSync(path.join(f.recovery,'exchanged.md'),'utf8'),'Same inode external write');
 assert.deepEqual(fs.readFileSync(path.join(f.recovery,'baseline.md')),original);
});
native('target deletion does not create a replacement or delete the draft',async()=>{
 const f=fixture();const r=await run(f,{point:'before-swap',hook(){fs.renameSync(f.file,path.join(f.dir,'moved.md'));}});
 assert.equal(r.ok,false);assert.equal(fs.existsSync(f.file),false);assert.deepEqual(fs.readFileSync(path.join(f.dir,'moved.md')),original);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'exchanged.md')),edited);
});
native('symlink replacement never follows the link',async()=>{
 const f=fixture(),other=path.join(f.dir,'other.md');fs.writeFileSync(other,'Do not touch');
 const r=await run(f,{point:'before-swap',hook(){fs.renameSync(f.file,path.join(f.dir,'moved.md'));fs.symlinkSync(other,f.file);}});
 assert.equal(r.ok,false);assert.equal(fs.readFileSync(other,'utf8'),'Do not touch');assert.ok(fs.lstatSync(path.join(f.recovery,'exchanged.md')).isSymbolicLink());assert.equal(fs.readlinkSync(path.join(f.recovery,'exchanged.md')),other); // The link entry is retained, never followed.
});
native('directory substitution is retained without traversal or destructive rollback',async()=>{
 const f=fixture();const r=await run(f,{point:'before-swap',hook(){fs.renameSync(f.file,path.join(f.dir,'moved.md'));fs.mkdirSync(f.file);fs.writeFileSync(path.join(f.file,'sentinel'),'Retain folder');}});
 assert.equal(r.ok,false);assert.equal(r.committed,true);assert.ok(fs.statSync(path.join(f.recovery,'exchanged.md')).isDirectory());assert.equal(fs.readFileSync(path.join(f.recovery,'exchanged.md','sentinel'),'utf8'),'Retain folder');
});
native('ancestor replacement cannot redirect the pinned final write',async()=>{
 const f=fixture(),moved=f.dir+'-moved';const r=await run(f,{point:'before-swap',hook(){fs.renameSync(f.dir,moved);fs.mkdirSync(f.dir);fs.writeFileSync(f.file,'New parent sentinel');}});
 assert.equal(r.ok,false);assert.equal(fs.readFileSync(f.file,'utf8'),'New parent sentinel');assert.deepEqual(fs.readFileSync(path.join(moved,'原文.md')),edited);
});
native('post-exchange outside edit and retained-fd writes cannot produce success',async()=>{
 for(const displaced of [false,true]){const f=fixture(),fd=fs.openSync(f.file,'r+');try{
  const r=await run(f,{point:'after-swap',hook(){if(displaced){fs.writeSync(fd,Buffer.from('outside'),0,7,0);}else fs.writeFileSync(f.file,'Outside new target');}});
  assert.equal(r.ok,false);assert.equal(r.committed,true);
 }finally{fs.closeSync(fd);}}
});
native('sync failure retains all versions and has no success receipt',async()=>{
 const f=fixture();const r=await run(f,{fault:'sync'});assert.equal(r.ok,false);assert.equal(r.committed,true);assert.equal(fs.existsSync(path.join(f.recovery,'confirmed.json')),false);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),edited);
});
native('termination after exchange preserves a prepared journal and both versions',async()=>{
 const f=fixture();const r=await run(f,{point:'after-swap',kill:true});assert.equal(r.hooked,true);assert.ok(fs.existsSync(path.join(f.recovery,'prepared.json')));assert.equal(fs.existsSync(path.join(f.recovery,'outcome.json')),false);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'exchanged.md')),original);assert.deepEqual(fs.readFileSync(f.file),edited);
});
native('pre-commit write failure leaves original and retained draft unchanged',async()=>{
 const f=fixture();const r=await run(f,{fault:'prepared'});assert.equal(r.committed,false);assert.deepEqual(fs.readFileSync(f.file),original);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),edited);
});
native('image assets are created or reused exactly; conflicting bytes stop before Markdown replacement',async()=>{
 for(const mode of ['new','reuse','conflict']){const f=fixture(),bytes=Buffer.from('Synthetic native asset bytes'),sha256=hash(bytes),name=`markdown-image-${sha256}.png`;
  f.request.assets=[{name,body:bytes.toString('base64'),sha256}];const image=path.join(f.dir,name);
  if(mode!=='new')fs.writeFileSync(image,mode==='reuse'?bytes:'Keep existing',{mode:0o600});
  const r=await run(f);assert.equal(r.ok,mode!=='conflict');
  if(mode==='conflict'){assert.equal(r.committed,false);assert.deepEqual(fs.readFileSync(f.file),original);assert.equal(fs.readFileSync(image,'utf8'),'Keep existing');}
  else assert.deepEqual(fs.readFileSync(image),bytes);
 }
});
native('unknown extended attributes and ACL are refused without changing original',async()=>{
 const {spawnSync}=require('node:child_process');
 for(const kind of ['xattr','acl']){const f=fixture();const r=kind==='xattr'?spawnSync('/usr/bin/xattr',['-w','synthetic.unapproved','fixture',f.file]):spawnSync('/bin/chmod',['+a','everyone deny delete',f.file]);assert.equal(r.status,0);
  f.request.expectedIdentity=metadata(f.file);const result=await run(f);assert.equal(result.ok,false);assert.equal(result.committed,false);assert.equal(result.code,kind==='xattr'?'unsupported-xattrs':'unsupported-acl');assert.deepEqual(fs.readFileSync(f.file),original);
 }
});
native('allowed native attributes are retained by the replacement',async()=>{
 const {spawnSync}=require('node:child_process'),f=fixture();assert.equal(spawnSync('/usr/bin/xattr',['-wx','com.apple.lastuseddate#PS','01000000000000000000000000000000',f.file]).status,0);
 f.request.expectedIdentity=metadata(f.file);const r=await run(f);assert.equal(r.ok,true,JSON.stringify(r));const hex=spawnSync('/usr/bin/xattr',['-px','com.apple.lastuseddate#PS',f.file],{encoding:'utf8'});assert.equal(hex.status,0);assert.equal(hex.stdout.replace(/\s/g,''),'01000000000000000000000000000000');
});
native('a second cooperating save observes the first completed version and refuses its stale baseline',async()=>{
 const f=fixture(),second=path.join(f.root,'second');fs.mkdirSync(second,{mode:0o700});
 // Both requests carry the same initial baseline; at most one can confirm.
 const g={...f,recovery:second,request:{...f.request,recoveryPath:second,recoveryIdentity:metadata(second)}};
 const results=await Promise.all([run(f),run(g)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).committed,false);assert.equal(results.find(r=>!r.ok).code,'external-change');assert.deepEqual(fs.readFileSync(f.file),edited);
});
native('ancestor attribute mutation is detected before committing',async()=>{
 const f=fixture();const r=await run(f,{point:'prepared',hook(){assert.equal(require('node:child_process').spawnSync('/usr/bin/xattr',['-w','synthetic.unapproved','fixture',f.dir]).status,0);}});
 assert.equal(r.ok,false);assert.equal(r.committed,false);assert.deepEqual(fs.readFileSync(f.file),original);
});
native('capacity boundary saves large text and sixteen assets through the bounded native request',async()=>{
 const c=require('../lib/document-capacity'),f=fixture(),body=Buffer.from('界'.repeat(c.MAX_SOURCE_UNITS));
 f.request.body=body.toString('base64');f.request.sha256=hash(body);
 const assets=Array.from({length:16},(_,i)=>{const bytes=Buffer.alloc(i<4?c.MAX_IMAGE_BYTES-512:128,i+1),sha256=hash(bytes);return {name:`markdown-image-${sha256}.png`,body:bytes.toString('base64'),sha256};});
 f.request.assets=assets;assert(Buffer.byteLength(JSON.stringify(f.request))>8000000);
 const r=await run(f);assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(fs.readFileSync(f.file),body);
 assert.deepEqual(fs.readFileSync(path.join(f.recovery,'baseline.md')),original);
 for(const a of assets)assert.equal(hash(fs.readFileSync(path.join(f.dir,a.name))),a.sha256);
});
native('aggregate overflow rejects assets before creating any sidecar or changing Markdown',async()=>{
 const c=require('../lib/document-capacity'),f=fixture();f.request.assets=Array.from({length:5},(_,i)=>{const bytes=Buffer.alloc(c.MAX_IMAGE_BYTES,i+1),sha256=hash(bytes);return {name:`markdown-image-${sha256}.png`,body:bytes.toString('base64'),sha256};});
 // This request exceeds the envelope budget too. Use 4 full assets + 1 byte
 // to exercise aggregate validation within the request envelope.
 const bytes=Buffer.from('x'),sha256=hash(bytes);f.request.assets[4]={name:`markdown-image-${sha256}.png`,body:bytes.toString('base64'),sha256};
 const r=await run(f);assert.equal(r.ok,false);assert.equal(r.committed,false);assert.equal(r.code,'invalid-assets');assert.deepEqual(fs.readdirSync(f.dir),['原文.md']);assert.deepEqual(fs.readFileSync(f.file),original);
});

native('coordinated save rechecks the local-directory proof and rejects malformed authority',async()=>{
 for(const ubiquitous of [false,true]){
  const f=fixture();f.request.ancestors[0].location={ubiquitous};const result=await run(f);
  assert.equal(result.ok,!ubiquitous,JSON.stringify(result));
  assert.deepEqual(fs.readFileSync(f.file),ubiquitous?original:edited);
  if(ubiquitous){assert.equal(result.committed,false);assert.equal(result.code,'invalid-directory-location');}
 }
});
