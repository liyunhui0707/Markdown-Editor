'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {captureCopyDestination,persistentDirectory}=require('../lib/document-save-policy');
test.before(()=>{if(process.platform==='darwin'&&!process.env.DOCUMENT_NATIVE_SAVE_PRODUCTION_BINARY)assert.equal(spawnSync(process.execPath,[path.join(__dirname,'../tools/build-document-save.cjs')],{encoding:'utf8'}).status,0);});
const native=(name,fn)=>test(name,{skip:process.platform!=='darwin'},fn);
const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-local-folders-'))),realHome=os.homedir;
os.homedir=()=>home;test.after(()=>{os.homedir=realHome;console.log('retained synthetic local-folders fixture: '+home);});
for(const name of ['Desktop','Documents'])native('ordinary local '+name+' supports a bound destination and revalidation',()=>{
 const folder=path.join(home,name);fs.mkdirSync(folder,{mode:0o700});
 const nested=path.join(folder,'文章 空格');fs.mkdirSync(nested,{mode:0o700});
 const grant=captureCopyDestination(path.join(nested,'新文档.md'));
 try{
  grant.verify();assert.equal(grant.state.ancestors.find(a=>a.path===folder).location.ubiquitous,false);
  assert.deepEqual(fs.readdirSync(nested),[]);const before=fs.statSync(folder).mode;
  fs.renameSync(nested,nested+'-moved');fs.mkdirSync(nested,{mode:0o700});
  assert.throws(()=>grant.verify(),{code:'copy-directory-changed'});assert.equal(fs.statSync(folder).mode,before);
 }finally{grant.close();}
});
native('metadata and system-location guards remain active for local folder names',()=>{
 const parent=path.join(home,'Local');fs.mkdirSync(parent,{mode:0o700});
 const folder=path.join(parent,'Documents');fs.mkdirSync(folder,{mode:0o700});
 fs.chmodSync(folder,0o777);assert.throws(()=>persistentDirectory(folder),{code:'unsupported-copy-directory'});
 fs.chmodSync(folder,0o700);
 const set=spawnSync('/usr/bin/xattr',['-w','test.markdown.synthetic','retain',folder]);assert.equal(set.status,0);
 assert.throws(()=>persistentDirectory(folder),{code:'unsupported-xattrs'});
 for(const name of ['Library','Applications','.hidden','OneDrive - Work','Dropbox'])
  assert.throws(()=>persistentDirectory(path.join(home,name)),{code:'unsupported-copy-directory'});
 assert.throws(()=>persistentDirectory(home),{code:'unsupported-copy-directory'});
});

native('native location inspection refuses symlinks, files and missing paths without changing them',()=>{
 const helper=path.join(__dirname,'../build/document-save'),target=path.join(home,'plain.md'),link=path.join(home,'alias');
 fs.writeFileSync(target,'Synthetic retained file',{flag:'wx'});fs.symlinkSync(path.join(home,'Desktop'),link);
 for(const p of [target,link,path.join(home,'absent')]){
  const result=spawnSync(helper,['--inspect-directory',p],{encoding:'utf8',timeout:3000});
  assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).ok,false);
 }
 assert.equal(fs.readFileSync(target,'utf8'),'Synthetic retained file');assert.equal(fs.readlinkSync(link),path.join(home,'Desktop'));
 assert.equal(spawnSync(helper,['--unknown'],{encoding:'utf8'}).status,64);
});
