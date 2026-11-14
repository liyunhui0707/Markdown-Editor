'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {createDraftStore}=require('../lib/document-draft-store');
const {createOriginalSave}=require('../lib/document-original-save');
const hash=b=>createHash('sha256').update(b).digest('hex');
function temp(){return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-lifecycle-')));}
function save(store,body,previous){return store.save({id:previous?.id||store.newId(),token:previous?.token,fingerprint:previous?.fingerprint,label:'中文草稿',revision:(previous?.revision||0)+1,bytes:Buffer.from(body)});}
function row(store,id){return [...store.list().drafts,...store.list().archived].find(r=>r.id===id);}
test('full draft workspace offloads verified inactive generations and restores an independent exact draft after restart',()=>{
 const root=path.join(temp(),'drafts'),store=createDraftStore(root);let first;
 for(let i=0;i<64;i++){const a=save(store,'正文 '+i);if(!i)first=a;assert(a.ok);const r=row(store,a.id);assert(store.manage(a.id,'archive',r.manageToken).ok);}
 assert.equal(store.list().capacity.records,128);assert.equal(save(store,'overflow').code,'draft-record-capacity');
 const before=fs.readdirSync(root).filter(n=>n.startsWith(first.id)).map(n=>[n,fs.readFileSync(path.join(root,n))]);
 assert.equal(store.manage(first.id,'offload',row(store,first.id).manageToken).state,'offloaded');
 assert.equal(store.list().capacity.records,126);assert.equal(store.recover(first.id).code,'draft-offloaded');
 const fresh=createDraftStore(root),archived=fresh.list().archived.find(r=>r.offloaded);assert(archived);assert.equal(archived.label,'中文草稿');
 for(const [name,bytes] of before)assert.deepEqual(fs.readFileSync(path.join(root+'-archive',archived.id,name)),bytes);
 assert.equal(fresh.manage(archived.id,'unarchive',archived.manageToken).ok,true);
 const restored=fresh.list().drafts[0];assert.notEqual(restored.id,first.id);assert.equal(fresh.recover(restored.id).bytes.toString(),'正文 0');
 assert(fresh.list().archived.some(r=>r.id===archived.id));assert.equal(save(fresh,'new independent').ok,true);
});
test('offload rejects stale, corrupt and symlink draft evidence without moving any material',()=>{
 for(const fault of ['stale','corrupt','symlink']){const root=path.join(temp(),'drafts'),s=createDraftStore(root),a=save(s,'old'),r=row(s,a.id);
  if(fault==='stale')save(s,'new',a);
  if(fault==='corrupt')fs.writeFileSync(path.join(root,a.token),'{partial');
  if(fault==='symlink'){fs.renameSync(path.join(root,a.token),path.join(path.dirname(root),'held'));fs.symlinkSync(path.join(path.dirname(root),'held'),path.join(root,a.token));}
  const before=fs.readdirSync(root);assert.equal(s.manage(a.id,'offload',r.manageToken).ok,false);assert.deepEqual(fs.readdirSync(root),before);
 }
});
test('archive write, sync and source-removal failures never discard the last recovery bytes or report success',()=>{
 for(const fault of ['write','sync','unlink']){const root=path.join(temp(),'drafts'),io=Object.create(fs);let enabled=false;
  io.writeFileSync=(...a)=>{if(enabled&&fault==='write')throw Error('synthetic');return fs.writeFileSync(...a);};
  io.fsyncSync=(...a)=>{if(enabled&&fault==='sync')throw Error('synthetic');return fs.fsyncSync(...a);};
  io.unlinkSync=(...a)=>{if(enabled&&fault==='unlink')throw Error('synthetic');return fs.unlinkSync(...a);};
  const s=createDraftStore(root,{fs:io}),a=save(s,'retained'),r=row(s,a.id);enabled=true;
  assert.equal(s.manage(a.id,'offload',r.manageToken).ok,false);assert.equal(fs.readFileSync(path.join(root,a.token),'utf8').includes(Buffer.from('retained').toString('base64')),true);
 }
});
test('partial source offload keeps the complete archive but refuses stale fallback recovery',()=>{
 const root=path.join(temp(),'drafts'),io=Object.create(fs);let enabled=false,count=0;
 io.unlinkSync=(...a)=>{if(enabled&&++count===2)throw Error('synthetic');return fs.unlinkSync(...a);};
 const s=createDraftStore(root,{fs:io}),a=save(s,'old'),b=save(s,'new',a),r=row(s,a.id);enabled=true;
 assert.equal(s.manage(a.id,'offload',r.manageToken).ok,false);assert.equal(s.recover(a.id).code,'draft-offloaded');
 const fresh=createDraftStore(root),archive=fresh.list().archived.find(r=>r.offloaded);assert(archive);
 assert.equal(row(fresh,a.id).manageToken,null);assert.equal(fresh.manage(archive.id,'unarchive',archive.manageToken).ok,true);
 assert.equal(fresh.list().drafts.filter(r=>r.id!==a.id).map(r=>fresh.recover(r.id).bytes.toString()).includes('new'),true);
 assert(fs.existsSync(path.join(root+'-archive',archive.id,b.token)));
});
function version(root,time,{state='saved-confirmed',file='/synthetic/note.md'}={}){
 const id=randomUUID(),p=path.join(root,id);fs.mkdirSync(p,{mode:0o700});const sha256=hash('new'),revision=time;
 const data={'request.json':{filePath:file,revision,time,sha256,expectedSha256:hash('prior')},'outcome.json':{ok:state==='saved-confirmed',state,committed:state==='saved-confirmed',revision,sha256},'accepted.json':{revision,sha256}};
 data['confirmed.json']=data['outcome.json'];data['prepared.json']={sha256};
 for(const [n,r] of Object.entries(data))fs.writeFileSync(path.join(p,n),JSON.stringify(r),{mode:0o600});
 for(const n of ['previous.md','baseline.md','exchanged.md'])fs.writeFileSync(path.join(p,n),'prior',{mode:0o640});
 fs.writeFileSync(path.join(p,'draft.md'),'new',{mode:0o600});return id;
}
test('full save workspace archives only confirmed old versions, preserving inode, modes, content and latest/unknown records',()=>{
 const root=path.join(temp(),'versions'),b=createOriginalSave({root,binary:process.execPath});const ids=[];
 for(let i=1;i<=128;i++)ids.push(version(root,i,{state:i===2?'save-unverified':'saved-confirmed'}));
 const r=b.list();assert.equal(r.capacity.records,128);assert(r.records.find(r=>r.id===ids[0]).manageToken);
 assert.equal(r.records.find(r=>r.id===ids[1]).manageToken,undefined);assert.equal(r.records.find(r=>r.id===ids[127]).manageToken,undefined);
 fs.writeFileSync(path.join(root,ids[0],'.DS_Store'),'synthetic Finder metadata',{mode:0o600});
 const old=path.join(root,ids[0],'previous.md'),identity=fs.statSync(old),token=b.list().records.find(r=>r.id===ids[0]).manageToken;
 assert.equal(b.offload(ids[0],r.records.find(r=>r.id===ids[0]).manageToken).ok,false);
 assert.equal(b.offload(ids[0],token,[ids[0]]).ok,false);assert.equal(b.offload(ids[0],'0'.repeat(64)).ok,false);
 assert.equal(b.offload(ids[0],token).ok,true);assert.equal(b.list().capacity.records,127);assert.equal(b.list().archived.length,1);
 const fresh=createOriginalSave({root,binary:process.execPath}),archived=path.join(fresh.locate(ids[0]),'previous.md'),after=fs.statSync(archived);
 assert.equal(after.ino,identity.ino);assert.equal(after.mode,identity.mode);assert.equal(fs.readFileSync(archived,'utf8'),'prior');
 assert.equal(fresh.offload(ids[0],token).ok,false);assert.throws(()=>fresh.locate('../escape'));
});
test('changed save records and archive-root replacement refuse offload and retain material',()=>{
 const root=path.join(temp(),'versions'),b=createOriginalSave({root,binary:process.execPath}),id=version(root,1);version(root,2);
 const token=b.list().records.find(r=>r.id===id).manageToken;fs.writeFileSync(path.join(root,id,'previous.md'),'changed');
 assert.equal(b.offload(id,token).ok,false);const next=b.list().records.find(r=>r.id===id).manageToken;
 fs.renameSync(root+'-archive',root+'-archive-held');fs.mkdirSync(root+'-archive',{mode:0o700});
 assert.equal(b.offload(id,next).ok,false);assert(fs.existsSync(path.join(root,id,'previous.md')));
});

test('image attachments and archive bytes survive offload/independent restoration exactly',()=>{
 const root=path.join(temp(),'drafts'),s=createDraftStore(root),id=s.newId();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N8AAAAASUVORK5CYII=','base64');
 const attachment={name:'markdown-image-'+hash(png)+'.png',base64:png.toString('base64')};
 const data={id,label:'Image',revision:1,bytes:Buffer.from('![image]('+attachment.name+')'),attachments:[attachment]};
 const saved=s.save(data);assert.equal(saved.ok,true);assert.equal(s.manage(id,'offload',row(s,id).manageToken).ok,true);
 const a=s.list().archived.find(r=>r.offloaded);fs.writeFileSync(path.join(root+'-archive',a.id,'.DS_Store'),'synthetic Finder metadata',{mode:0o600});assert.equal(s.manage(a.id,'unarchive',a.manageToken).ok,true);
 assert.equal(fs.readFileSync(path.join(root+'-archive',a.id,'.DS_Store'),'utf8'),'synthetic Finder metadata');
 const restored=s.recover(s.list().drafts[0].id);assert.deepEqual(restored.attachments,[attachment]);assert.deepEqual(restored.bytes,data.bytes);
 const file=path.join(root+'-archive',a.id,saved.token);fs.writeFileSync(file,'{damaged');
 assert.equal(s.manage(a.id,'unarchive',a.manageToken).ok,false);assert.deepEqual(s.recover(restored.id).bytes,data.bytes);
});
test('latest confirmed save remains protected even if a newer unknown transaction exists',()=>{
 const root=path.join(temp(),'versions'),b=createOriginalSave({root,binary:process.execPath});const id=version(root,1);version(root,2,{state:'save-unverified'});
 assert.equal(b.list().records.find(r=>r.id===id).manageToken,undefined);assert.equal(b.offload(id,'a'.repeat(64)).ok,false);
});

test('production helper saves again after offloading at the 128-transaction ceiling',{skip:process.platform!=='darwin'||!process.env.DOCUMENT_NATIVE_SAVE_PRODUCTION_BINARY},async()=>{
 const {createSaveFolderFixture}=require('./helpers/save-folder-fixture.cjs'),{createDocumentFileStore}=require('../lib/document-file-store');
 const evidence=temp(),fixture=createSaveFolderFixture(evidence),file=path.join(fixture.dir,'Capacity.md'),root=path.join(temp(),'versions');
 fs.writeFileSync(file,'prior',{mode:0o600,flag:'wx'});const b=createOriginalSave({root,binary:process.env.DOCUMENT_NATIVE_SAVE_PRODUCTION_BINARY});let old;
 try{
  for(let i=1;i<=128;i++){const id=version(root,i,{file});if(i===1)old=id;}
  const expected=createDocumentFileStore().read(file),bytes=Buffer.from('new exact body');
  const full=await b.replace({expected,bytes,revision:129,isAuthorized:()=>true});assert.equal(full.code,'save-recovery-capacity');assert.equal(fs.readFileSync(file,'utf8'),'prior');
  const token=b.list().records.find(r=>r.id===old).manageToken;assert.equal(b.offload(old,token).ok,true);
  const saved=await b.replace({expected,bytes,revision:129,isAuthorized:()=>true});assert.equal(saved.ok,true,JSON.stringify(saved));b.acknowledge(saved.recordId,saved);
  assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(b.list().capacity.records,128);assert.equal(fs.readFileSync(path.join(b.locate(old),'previous.md'),'utf8'),'prior');
 }finally{fixture.archive({quiescent:true});}
});
