'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectDirectoryLocation,directoryHelperPath}=require('../lib/document-directory-location');
test('native location probe is bounded and uses packaged resources outside asar',()=>{
 assert.equal(directoryHelperPath('/synthetic/Resources/app.asar'),'/synthetic/Resources/document-save');
 assert.equal(directoryHelperPath('/synthetic/desktop'),'/synthetic/desktop/build/document-save');
 const directory='/synthetic/Documents';let calls=0;
 assert.deepEqual(inspectDirectoryLocation(directory,{spawn:(binary,args,options)=>{
  calls++;assert(binary.endsWith('/build/document-save'));assert.deepEqual(args,['--inspect-directory',directory]);
  assert.equal(options.timeout,3000);assert.equal(options.maxBuffer,4096);
  return {status:0,stdout:JSON.stringify({ok:true,ubiquitous:false})};
 }}),{ubiquitous:false});assert.equal(calls,1);
});
test('cloud, timeout, missing helper and malformed location proofs cannot grant saving',()=>{
 for(const result of [{status:0,stdout:'{"ok":false,"code":"cloud-directory"}'},
  {status:0,stdout:'{"ok":true,"ubiquitous":true}'},{status:0,stdout:'null'},
  {status:0,stdout:'{"ok":true}'},{status:0,stdout:'{"ok":true,"ubiquitous":false,"unexpected":1}'},
  {status:0,stdout:'invalid'},{status:64,stdout:''},{error:Error('missing')},{signal:'SIGTERM'}]){
  let calls=0;assert.throws(()=>inspectDirectoryLocation('/synthetic/Desktop',{spawn:()=>{calls++;return result;}}),
   {code:result.stdout?.includes('cloud-directory')?'cloud-directory':'directory-location-unavailable'});
  assert.equal(calls,1); // No fallback or automatic retry.
 }
});
