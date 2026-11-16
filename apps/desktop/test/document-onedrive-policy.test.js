'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {oneDriveLayout,oneDriveRole,oneDriveArtifact,normalizeProviderIdentity}=require('../lib/document-onedrive-policy');
test('OneDrive path recognition is canonical and provider-specific, not filesystem authority',()=>{
 const home='/Users/synthetic',base=home+'/Library/CloudStorage/OneDrive-个人';
 assert.equal(oneDriveLayout(base+'/Notes',home).root,base);
 assert.equal(oneDriveLayout(base,home).root,base);
 for(const p of [home+'/OneDrive',home+'/Library/CloudStorage/Dropbox-x/a',home+'/Library/CloudStorage/OneDrive-/a',base+'/../a',base+'//a',base+'/.private',base+'/secrets/a','/Volumes/OneDrive-x/a'])assert.equal(oneDriveLayout(p,home),null,p);
 assert.equal(oneDriveRole(home+'/Library',base,home),'library');assert.equal(oneDriveRole(base,base,home),'domain');assert.equal(oneDriveRole(base+'/Notes',base,home),'child');assert.equal(oneDriveRole(home,base,home),null);
});
test('only provider snapshots normalize between-read ctime; all content identity fields remain compared',()=>{
 const file=path.join(os.homedir(),'Library/CloudStorage/OneDrive-Test/Article.md'),value={dev:'1',ino:'2',ctimeNs:'3',mtimeNs:'4',size:'5',mode:384,uid:501,gid:20};
 assert.deepEqual(normalizeProviderIdentity(file,value),{...value,ctimeNs:'0'});assert.equal(value.ctimeNs,'3');
 assert.deepEqual(normalizeProviderIdentity('/Users/synthetic/ordinary.md',value),value);
 const a=normalizeProviderIdentity(file,value),b=normalizeProviderIdentity(file,{...value,ctimeNs:'9'});assert.deepEqual(a,b);
 for(const key of ['dev','ino','mtimeNs','size','mode','uid','gid'])assert.notDeepEqual(a,normalizeProviderIdentity(file,{...value,[key]:'different'}));
});
test('loss of materialized provider state pauses an existing binding as a conflict, not a retryable write failure',()=>{
 const io=Object.create(require('node:fs'));io.realpathSync=()=>{throw Object.assign(Error(),{code:'onedrive-file-not-local'});};
 const store=require('../lib/document-file-store').createDocumentFileStore({fs:io});
 assert.equal(store.check({requestedPath:'/synthetic/a.md'}).code,'external-change');
 io.realpathSync=()=>{throw Object.assign(Error(),{code:'EIO'});};assert.equal(store.check({requestedPath:'/synthetic/a.md'}).code,'read-failed');
});
test('read-only staging metadata exception covers only the proof-bound marker shape, not arbitrary hidden files',()=>{
 const root=path.join(os.homedir(),'Library/CloudStorage/OneDrive-Test');assert.equal(oneDriveArtifact(root+'/.markdown-recovery-'+'a'.repeat(24)+'/owner.json'),true);
 for(const p of [root+'/.hidden/owner.json',root+'/.markdown-recovery-'+'a'.repeat(24)+'/data.md','/tmp/.markdown-recovery-'+'a'.repeat(24)+'/owner.json'])assert.equal(oneDriveArtifact(p),false);
});
