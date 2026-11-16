'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runNative}=require('../lib/document-onedrive-copy');
function fixture(){
 const child=new EventEmitter(),owner=new EventEmitter(),killed=[];let input,exit;
 Object.assign(child,{stdout:new EventEmitter(),stderr:new EventEmitter(),stdin:Object.assign(new EventEmitter(),{end:s=>{input=s;}}),kill:s=>{killed.push(s);queueMicrotask(()=>child.emit('close',null));}});
 owner.exit=code=>{exit=code;};
 return {child,owner,killed,start:()=>child,input:()=>input,exit:()=>exit};
}
test('native copy transport requires bounded one-shot JSON, successful close and no stderr',async()=>{
 for(const mode of ['valid','stderr','bad-json','nonzero','overflow']){
  const f=fixture(),p=runNative({operation:'synthetic'},{start:f.start,owner:f.owner});assert.equal(JSON.parse(f.input()).operation,'synthetic');
  f.child.stdout.emit('data',mode==='bad-json'?'bad':mode==='overflow'?'x'.repeat(16385):'{"ok":true}');
  if(mode==='stderr')f.child.stderr.emit('data','error');f.child.emit('close',mode==='nonzero'?1:0);
  assert.deepEqual(await p,mode==='valid'?{ok:true}:null);assert.equal(f.owner.listenerCount('SIGTERM'),0);
 }
});
test('copy timeout and owner termination kill only the owned native helper and preserve an unknown result',async()=>{
 const f=fixture(),p=runNative({},{start:f.start,owner:f.owner,timeoutMs:5});assert.equal(await p,null);assert.deepEqual(f.killed,['SIGKILL']);
 const g=fixture(),waiting=runNative({},{start:g.start,owner:g.owner});g.owner.emit('SIGTERM');await waiting;assert.deepEqual(g.killed,['SIGKILL']);assert.equal(g.exit(),1);
});
