'use strict';
// A real-provider run is explicitly provisioned by its calling project session.
// CI's layout fixture is synthetic: it is not proof of Microsoft/cloud sync.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
function createOneDriveFixture(output){
 const real=process.env.MARKDOWN_ONEDRIVE_TEST_ROOT;let domain,created=false;
 if(real){
  domain=fs.realpathSync(real);assert.equal(domain,real);assert.match(path.basename(domain),/^Markdown-Compatibility-20261116-[a-f0-9]{6}$/);assert(domain.startsWith(path.join(os.homedir(),'Library/CloudStorage/OneDrive-')));
 }else{
  assert.equal(process.env.GITHUB_ACTIONS,'true','Real OneDrive test root or isolated CI required');
  const parent=path.join(os.homedir(),'Library/CloudStorage');if(!fs.existsSync(parent))fs.mkdirSync(parent,{mode:0o700});assert.equal(fs.realpathSync(parent),parent);
  domain=path.join(parent,'OneDrive-Markdown-Test-'+randomUUID());fs.mkdirSync(domain,{mode:0o700});created=true;
  execFileSync('/usr/bin/xattr',['-w','com.apple.file-provider-domain-id','markdown-synthetic-domain',domain]);
  execFileSync('/bin/chmod',['+a#','0','everyone deny writeextattr',domain]);execFileSync('/bin/chmod',['+a#','1','everyone deny delete',domain]);
 }
 const proof=fs.statSync(domain),dir=path.join(domain,'Workflow-'+randomUUID());assert.equal(proof.uid,process.getuid());fs.mkdirSync(dir,{mode:0o700});let archived=false;
 function finish({quiescent}){
  assert(quiescent);assert.equal(fs.statSync(domain).ino,proof.ino);assert.equal(fs.statSync(domain).dev,proof.dev);
  if(!created)return {state:'retained-authorized-real-provider-evidence',path:dir};
  assert(!archived);const target=path.join(output,path.basename(domain));assert(!fs.existsSync(target));
  // Only the freshly created CI namespace has its simulated ACL removed for
  // recoverable relocation. Real OneDrive/Library permissions are never changed.
  execFileSync('/bin/chmod',['-N',domain]);fs.renameSync(domain,target);archived=true;
  return {state:'archived-synthetic-layout',from:domain,to:target,rootACL:'synthetic fixture only; removed to relocate',cloudSync:'not tested'};
 }
 return {dir,kind:created?'synthetic-layout':'real-onedrive',finish};
}
module.exports={createOneDriveFixture};
