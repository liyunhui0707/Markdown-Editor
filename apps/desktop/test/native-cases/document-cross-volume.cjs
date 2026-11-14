'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto');
const volume=process.env.DOCUMENT_CROSS_VOLUME_ROOT,binary=process.env.DOCUMENT_NATIVE_SAVE_TEST_BINARY;
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=Buffer.from('\ufeff# 原文\r\n\n保留。\r'),edited=Buffer.from('\ufeff# 修改\r\n\n正文。\r');
const meta=p=>{const s=fs.statSync(p,{bigint:true});return Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(k=>[k,String(s[k])]).concat([['mode',Number(s.mode&0o7777n)],['uid',Number(s.uid)],['gid',Number(s.gid)]]));};
function fixture(){
 const local=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'document-cross-save-')),dir=fs.mkdtempSync(path.join(volume,'case-'));
 const recovery=path.join(local,randomUUID());fs.mkdirSync(recovery,{mode:0o700});const file=path.join(dir,'原文.md');fs.writeFileSync(file,original,{mode:0o640,flag:'wx'});
 assert.notEqual(meta(recovery).dev,meta(dir).dev);
 const state=require('../../lib/document-save-policy').persistentDirectory(dir);
 return {local,dir,recovery,file,request:{filePath:file,recoveryPath:recovery,recoveryIdentity:meta(recovery),expectedIdentity:meta(file),expectedSha256:hash(original),body:edited.toString('base64'),sha256:hash(edited),revision:4,ancestors:state.ancestors,volume:state.volume}};
}
function run(f,{point,fault,hook,kill}={}){return new Promise((resolve,reject)=>{
 const child=spawn(binary,[],{stdio:['pipe','pipe','pipe']});let text='',stderr='',result,hooked=false;
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('timeout'));},15000);
 child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
 child.stdout.on('data',d=>{text+=d;let n;while((n=text.indexOf('\n'))>=0){const v=JSON.parse(text.slice(0,n));text=text.slice(n+1);if(v.testPoint){hooked=true;try{hook?.(f);if(kill)child.kill('SIGKILL');else child.stdin.write('!');}catch(e){child.kill('SIGKILL');reject(e);}}else result=v;}});
 child.on('exit',(code,signal)=>{clearTimeout(timer);fs.writeFileSync(path.join(f.local,'result.json'),JSON.stringify({result,stderr,code,signal}));if(kill&&signal==='SIGKILL')resolve({hooked});else if(code||!result)reject(Error(stderr+' exit '+code));else resolve(result);});
 child.stdin.write(JSON.stringify({...f.request,...(point?{testPoint:point}:{}),...(fault?{testFault:fault}:{})})+'\n');
});}
const cross=(name,fn)=>test(name,{skip:!volume||!binary||process.platform!=='darwin'},fn);
const staging=f=>JSON.parse(fs.readFileSync(path.join(f.recovery,'staging.json'),'utf8'));
cross('cross-volume save retains exact local copies and actual displaced inode on target volume',async()=>{
 const f=fixture(),r=await run(f);assert.equal(r.ok,true,JSON.stringify(r));const stage=staging(f);
 assert.deepEqual(fs.readFileSync(f.file),edited);for(const name of ['baseline.md','previous.md'])assert.deepEqual(fs.readFileSync(path.join(f.recovery,name)),original);
 assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),edited);assert.equal(meta(path.join(stage.path,'exchanged.md')).ino,f.request.expectedIdentity.ino);
 assert.equal(meta(f.file).mode,0o640);assert.equal(meta(stage.path).mode,0o700);assert.equal(fs.existsSync(path.join(f.recovery,'exchanged.md')),false);
});
cross('cross-volume conflict at exchange boundary retains external replacement without rollback',async()=>{
 const f=fixture();let ino;const r=await run(f,{point:'before-swap',hook(){const other=path.join(f.dir,'other.md');fs.writeFileSync(other,'External',{mode:0o600});ino=meta(other).ino;fs.renameSync(other,f.file);}});
 assert.equal(r.ok,false);assert.equal(r.committed,true);assert.equal(r.code,'conflict-after-exchange');const p=path.join(staging(f).path,'exchanged.md');assert.equal(meta(p).ino,ino);assert.equal(fs.readFileSync(p,'utf8'),'External');assert.deepEqual(fs.readFileSync(f.file),edited);
});
cross('cross-volume kill after exchange preserves local versions and stage locator without a success receipt',async()=>{
 const f=fixture(),r=await run(f,{point:'after-swap',kill:true});assert.equal(r.hooked,true);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'baseline.md')),original);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),edited);assert.deepEqual(fs.readFileSync(path.join(staging(f).path,'exchanged.md')),original);assert.equal(fs.existsSync(path.join(f.recovery,'outcome.json')),false);
});
cross('cross-volume write and sync failures retain recoverable versions',async()=>{
 for(const fault of ['prepared','sync']){const f=fixture(),r=await run(f,{fault});assert.equal(r.ok,false);assert.equal(r.committed,fault==='sync');assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),edited);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'baseline.md')),original);assert.deepEqual(fs.readFileSync(f.file),fault==='sync'?edited:original);}
});
cross('cross-volume staging substitution is refused before exchange',async()=>{
 const f=fixture(),r=await run(f,{point:'prepared',hook(){const s=staging(f);fs.renameSync(s.path,s.path+'-retained');fs.mkdirSync(s.path,{mode:0o700});fs.writeFileSync(path.join(s.path,'sentinel'),'Keep');}});
 assert.equal(r.ok,false);assert.equal(r.committed,false);assert.deepEqual(fs.readFileSync(f.file),original);assert.equal(fs.readFileSync(path.join(staging(f).path,'sentinel'),'utf8'),'Keep');
});
cross('outside-home exclusive-create grant binds APFS volume and refuses unsafe ancestors',()=>{
 const dir=fs.mkdtempSync(path.join(volume,'grant-')),policy=require('../../lib/document-save-policy'),grant=policy.captureCopyDestination(path.join(dir,'新.md'));
 try{grant.verify();assert.equal(grant.state.volume.local,true);assert.equal(grant.state.volume.filesystem,'apfs');fs.chmodSync(dir,0o777);assert.throws(()=>grant.verify());}finally{grant.close();}
});

cross('main-owned cross-volume writer supports repeated save, offline-safe listing and local archive',async()=>{
 const f=fixture(),root=path.join(f.local,'records'),{createOriginalSave}=require('../../lib/document-original-save'),{createDocumentFileStore}=require('../../lib/document-file-store');
 const broker=createOriginalSave({root,binary:path.resolve('build/document-save')});
 const save=async(bytes,revision)=>{const expected=createDocumentFileStore().read(f.file);expected.filePath=f.file;const r=await broker.replace({expected,bytes,revision,isAuthorized:()=>true});assert.equal(r.ok,true,JSON.stringify(r));broker.acknowledge(r.recordId,r);return r;};
 const first=await save(edited,1);assert(broker.locateStaging(first.recordId).startsWith(f.dir));
 const second=await save(original,2);assert.notEqual(first.recordId,second.recordId);const list=broker.list();assert.equal(list.records.length,2);const row=list.records.find(r=>r.id===first.recordId);assert(row.externalStaging);assert(row.manageToken);assert(!list.records.find(r=>r.id===second.recordId).manageToken);
 assert.equal(broker.offload(row.id,row.manageToken).ok,true);assert.deepEqual(fs.readFileSync(path.join(broker.locate(row.id),'previous.md')),original);assert(broker.locateStaging(row.id).startsWith(f.dir));
 fs.renameSync(f.dir,f.dir+'-offline');assert.equal(broker.list().ok,true);assert.throws(()=>broker.locateStaging(row.id));assert.deepEqual(fs.readFileSync(path.join(broker.locate(row.id),'draft.md')),edited);fs.renameSync(f.dir+'-offline',f.dir);assert(broker.locateStaging(row.id).startsWith(f.dir));
});
cross('cross-volume unexpected directory and symlink at exchange boundary remain intact',async()=>{
 for(const kind of ['directory','symlink']){const f=fixture(),r=await run(f,{point:'before-swap',hook(){fs.renameSync(f.file,f.file+'.retained');if(kind==='directory'){fs.mkdirSync(f.file);fs.writeFileSync(path.join(f.file,'sentinel'),'Keep');}else fs.symlinkSync('no-follow-target',f.file);}});assert.equal(r.ok,false);assert.equal(r.committed,true);const displaced=path.join(staging(f).path,'exchanged.md');if(kind==='directory')assert.equal(fs.readFileSync(path.join(displaced,'sentinel'),'utf8'),'Keep');else assert.equal(fs.readlinkSync(displaced),'no-follow-target');}
});

cross('cross-volume managed assets save alongside text and reject an existing conflicting image',async()=>{
 for(const conflict of [false,true]){const f=fixture(),bytes=Buffer.from('Synthetic asset'),sha256=hash(bytes),name=`markdown-image-${sha256}.png`;f.request.assets=[{name,body:bytes.toString('base64'),sha256}];const image=path.join(f.dir,name);if(conflict)fs.writeFileSync(image,'Keep',{mode:0o600});const r=await run(f);assert.equal(r.ok,!conflict);assert.deepEqual(fs.readFileSync(f.file),conflict?original:edited);assert.deepEqual(fs.readFileSync(image),conflict?Buffer.from('Keep'):bytes);}
});
cross('staging owner marker changes never grant an exchange or a Finder locator',async()=>{
 const f=fixture(),r=await run(f,{point:'prepared',hook(){const s=staging(f);fs.writeFileSync(path.join(path.dirname(s.path),'owner.json'),'{}');}});assert.equal(r.ok,false);assert.equal(r.committed,false);assert.deepEqual(fs.readFileSync(f.file),original);
});
cross('full target volume refuses before exchange while exact local original and draft remain available',async()=>{
 const f=fixture();assert.equal(process.env.DOCUMENT_SYNTHETIC_CAPACITY_VOLUME,volume);const capacity=fs.statfsSync(volume);assert(capacity.bsize*capacity.blocks<=160*1024*1024,'capacity test only accepts bounded synthetic image');
 const body=Buffer.alloc(1536*1024,97);f.request.body=body.toString('base64');f.request.sha256=hash(body);
 const fill=path.join(volume,'capacity-'+randomUUID()),fd=fs.openSync(fill,'wx',0o600),block=require('node:crypto').randomBytes(1024*1024);let full=false;
 try{for(let i=0;i<256;i++){try{fs.writeSync(fd,block);}catch(e){if(e.code!=='ENOSPC')throw e;full=true;break;}}assert(full,'bounded synthetic image must reach ENOSPC');fs.fsyncSync(fd);
  const r=await run(f);assert.equal(r.ok,false);assert.equal(r.committed,false);assert.deepEqual(fs.readFileSync(f.file),original);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'baseline.md')),original);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),body);
 }finally{fs.ftruncateSync(fd,0);fs.fsyncSync(fd);fs.closeSync(fd);}
});

cross('post-exchange staging relocation cannot produce a confirmed save receipt',async()=>{
 const f=fixture(),r=await run(f,{point:'sync',hook(){const s=staging(f);fs.renameSync(s.path,s.path+'-retained');}});assert.equal(r.ok,false);assert.equal(r.committed,true);assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),edited);assert.deepEqual(fs.readFileSync(f.file),edited);assert.equal(fs.existsSync(path.join(f.recovery,'confirmed.json')),false);assert.deepEqual(fs.readFileSync(path.join(staging(f).path+'-retained','exchanged.md')),original);
});
