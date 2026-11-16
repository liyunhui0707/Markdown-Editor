'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID,createHash}=require('node:crypto'),{spawn}=require('node:child_process');
const {createOneDriveFixture}=require('./helpers/onedrive-fixture.cjs'),{persistentDirectory}=require('../lib/document-save-policy'),{createDocumentFileStore}=require('../lib/document-file-store');
const binary=process.env.DOCUMENT_NATIVE_SAVE_TEST_BINARY,enabled=process.env.GITHUB_ACTIONS==='true'&&!!binary&&process.platform==='darwin';
if(process.env.GITHUB_ACTIONS==='true'&&process.platform==='darwin'&&!binary)throw Error('CI requires the compiled native save fixture');
// Do not create simulated provider domains in a developer's real CloudStorage.
// Local acceptance uses the separately authorized actual OneDrive test folder.
const hash=b=>createHash('sha256').update(b).digest('hex'),native=(name,fn)=>{if(enabled)test(name,fn);};
function fixture(){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'document-onedrive-native-')),f=createOneDriveFixture(output),file=path.join(f.dir,'Original.md'),bytes=Buffer.from('# Synthetic baseline\n'),edited=Buffer.from('# Synthetic edited\n');
 fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});const recovery=path.join(output,randomUUID());fs.mkdirSync(recovery,{mode:0o700});
 const state=persistentDirectory(f.dir),snapshot=createDocumentFileStore().read(file),s=fs.statSync(recovery,{bigint:true});
 const request={filePath:file,recoveryPath:recovery,recoveryIdentity:{dev:String(s.dev),ino:String(s.ino),mode:448,uid:Number(s.uid),gid:Number(s.gid)},expectedIdentity:snapshot.identity,expectedSha256:snapshot.sha256,sha256:hash(edited),body:edited.toString('base64'),revision:1,ancestors:state.ancestors,oneDrive:state.oneDrive,volume:state.volume,assets:[]};
 return {...f,output,file,recovery,bytes,edited,request};
}
function run(request,hook){return new Promise((resolve,reject)=>{
 const child=spawn(binary,[],{stdio:['pipe','pipe','pipe']});let text='',result,stderr='',failure;
 const stop=e=>{failure||=e;child.kill('SIGKILL');};
 const timeout=setTimeout(()=>stop(Error('native provider timeout')),15000);
 child.on('error',e=>{failure=e;});child.stdin.on('error',()=>{});child.stderr.on('data',b=>{stderr+=b;});
 child.stdout.on('data',b=>{try{
  text+=b;let i;while((i=text.indexOf('\n'))>=0){const v=JSON.parse(text.slice(0,i));text=text.slice(i+1);
   if(v.testPoint){hook();child.stdin.write('!');}else result=v;
  }
 }catch(e){stop(e);}});
 // Always wait for owned-child close before archiving its fixture, including failures.
 child.once('close',code=>{clearTimeout(timeout);if(failure)reject(failure);else if(code===0&&result)resolve(result);else reject(Error('native provider exit '+code+' '+stderr));});
 child.stdin.write(JSON.stringify(request)+'\n');
});}
native('OneDrive native same-domain save retains plaintext local copies and actual displaced inode',async()=>{
 const f=fixture();try{const r=await run(f.request);assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(fs.readFileSync(f.file),f.edited);
  for(const name of ['baseline.md','previous.md'])assert.deepEqual(fs.readFileSync(path.join(f.recovery,name)),f.bytes);
  assert.deepEqual(fs.readFileSync(path.join(f.recovery,'draft.md')),f.edited);const stage=JSON.parse(fs.readFileSync(path.join(f.recovery,'staging.json')));assert(stage.path.startsWith(f.dir+'/'));assert.equal(String(fs.statSync(stage.path+'/exchanged.md').ino),f.request.expectedIdentity.ino);
 }finally{fs.writeFileSync(path.join(f.output,'fixture.json'),JSON.stringify(f.finish({quiescent:true})));}
});
native('OneDrive native final-boundary external replacement is retained without success or automatic rollback',async()=>{
 const f=fixture();let externalInode;try{const r=await run({...f.request,testPoint:'before-swap'},()=>{const p=path.join(f.dir,'External.md');fs.writeFileSync(p,'# External content\n',{flag:'wx',mode:0o600});externalInode=fs.statSync(p).ino;fs.renameSync(p,f.file);});
  assert.equal(r.ok,false);assert.equal(r.committed,true);assert.equal(r.code,'conflict-after-exchange');const stage=JSON.parse(fs.readFileSync(path.join(f.recovery,'staging.json')));assert.equal(fs.statSync(stage.path+'/exchanged.md').ino,externalInode);assert.equal(fs.readFileSync(stage.path+'/exchanged.md','utf8'),'# External content\n');assert.deepEqual(fs.readFileSync(f.file),f.edited);
 }finally{fs.writeFileSync(path.join(f.output,'fixture.json'),JSON.stringify(f.finish({quiescent:true})));}
});
native('OneDrive native exclusive creation refuses a racing target after coordination without overwriting it',async()=>{
 const f=fixture();try{const target=path.join(f.dir,'New.md'),q={operation:'create-onedrive-copy',filePath:target,ancestors:f.request.ancestors,oneDrive:f.request.oneDrive,volume:f.request.volume,body:f.request.body,sha256:f.request.sha256,assets:[],testPoint:'create-before-file'};
  const r=await run(q,()=>fs.writeFileSync(target,'# Racing creator\n',{flag:'wx',mode:0o600}));assert.equal(r.ok,false);assert.equal(r.created,false);assert.equal(r.code,'target-exists');assert.equal(fs.readFileSync(target,'utf8'),'# Racing creator\n');
 }finally{fs.writeFileSync(path.join(f.output,'fixture.json'),JSON.stringify(f.finish({quiescent:true})));}
});
native('OneDrive native refuses forged domain, roles and metadata before creating recovery or replacing content',async()=>{
 const f=fixture();try{
  const changes=[
   {oneDrive:[]},
   {oneDrive:{...f.request.oneDrive,root:os.homedir()}},
   {oneDrive:{...f.request.oneDrive,domainSha256:'0'.repeat(64)}},
   {ancestors:f.request.ancestors.map(a=>a.oneDriveRole==='domain'?{...a,oneDriveRole:'child'}:a)},
   {ancestors:f.request.ancestors.map(a=>a.oneDriveRole==='domain'?{...a,metadata:{...a.metadata,xattrs:{}}}:a)},
  ];
  for(const change of changes){const r=await run({...f.request,...change});assert.equal(r.ok,false,JSON.stringify(r));assert.equal(r.committed,false);assert.deepEqual(fs.readFileSync(f.file),f.bytes);assert.deepEqual(fs.readdirSync(f.recovery),[]);}
 }finally{fs.writeFileSync(path.join(f.output,'fixture.json'),JSON.stringify(f.finish({quiescent:true})));}
});
