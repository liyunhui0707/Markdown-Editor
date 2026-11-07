'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {captureCopyDestination,suggestCopyPath,createSavePolicy}=require('../lib/document-save-policy');
const batch=require('./helpers/save-folder-fixture.cjs').createSaveFolderFixture();
const root=()=>fs.mkdtempSync(path.join(batch.dir,'case-'));
const directory=(parent,name)=>{const p=path.join(parent,name);fs.mkdirSync(p,{mode:0o700});return p;};
test.after(()=>console.log('save-folders-fixtures:'+JSON.stringify(batch.archive({quiescent:true}))));
test('nested Unicode destination is explicitly authorized, not inferred from the filename',()=>{
 const a=root(),b=directory(a,'文章 空格'),c=directory(b,'第三层'),file=path.join(c,'草稿.md');
 const target=captureCopyDestination(file);
 try {assert.equal(target.root,c);assert.equal(target.filePath,file);assert(target.state.ancestors.length>=4);target.verify();assert.equal(suggestCopyPath(c,'草稿.md'),file);}
 finally {target.close();}
 assert.equal(fs.existsSync(file),false);
 assert.throws(()=>createSavePolicy().capture(file),{code:'coordination-required'});
});
test('direct Home-child destinations remain supported',()=>{
 const target=captureCopyDestination(path.join(batch.dir,'direct.md'));try{target.verify();}finally{target.close();}
});
for(const change of ['replacement','mode','acl','xattr']) test('ancestor '+change+' invalidates authorization even with the same target inode',()=>{
 const a=root(),b=directory(a,'middle'),c=directory(b,'leaf');let target;
 try {
  target=captureCopyDestination(path.join(c,'new.md'));const ino=fs.statSync(c).ino;
  if(change==='replacement'){fs.renameSync(b,b+'-moved');fs.mkdirSync(b,{mode:0o700});fs.renameSync(path.join(b+'-moved','leaf'),c);}
  if(change==='mode')fs.chmodSync(b,0o777);
  if(change==='acl')assert.equal(spawnSync('/bin/chmod',['+a','group:everyone deny delete',b]).status,0);
  if(change==='xattr')assert.equal(spawnSync('/usr/bin/xattr',['-w','test.markdown.synthetic','changed',b]).status,0);
  assert.equal(fs.statSync(c).ino,ino);assert.throws(()=>target.verify());assert.deepEqual(fs.readdirSync(c),[]);
 }finally{target?.close();}
});
for(const kind of ['symlink','writable','readonly']) test('unsafe ancestor/target '+kind+' is rejected before file creation',()=>{
 const a=root(),b=directory(a,'parent');let c=directory(b,'leaf');
 if(kind==='symlink'){fs.symlinkSync(b,path.join(a,'alias'));c=path.join(a,'alias','leaf');}
 if(kind==='writable')fs.chmodSync(b,0o777);
 if(kind==='readonly')fs.chmodSync(c,0o500);
 assert.throws(()=>captureCopyDestination(path.join(c,'new.md')),{code:'unsupported-copy-directory'});
 assert.equal(fs.existsSync(path.join(c,'new.md')),false);
});
for(const component of ['.hidden','Library','OneDrive - Work','Dropbox']) test('excluded component stays blocked at any nesting depth: '+component,()=>{
 assert.throws(()=>captureCopyDestination(path.join(batch.dir,component,'nested','new.md')),{code:'unsupported-copy-directory'});
});
test('home itself, outside-home paths, dot traversal, oversized depth and target symlinks remain refused',()=>{
 for(const file of [path.join(os.homedir(),'new.md'),path.join(os.tmpdir(),'new.md'),batch.dir+'/x/../new.md',path.join(batch.dir,...Array(33).fill('deep'),'new.md')])assert.throws(()=>captureCopyDestination(file));
 const a=root(),file=path.join(a,'existing.md');fs.symlinkSync('missing.md',file);
 assert.throws(()=>captureCopyDestination(file),{code:'target-exists'});assert.equal(fs.readlinkSync(file),'missing.md');
});
