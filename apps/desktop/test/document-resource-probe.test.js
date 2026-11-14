// This helper belongs to E2E verification; these checks protect evidence validity.
const test=require('node:test'),assert=require('node:assert/strict');
const {createResourceProbe,rendererFrames}=require('../e2e/helpers/document-resource-probe.cjs');
const vm=require('node:vm');
function fixture(){
 const calls=[],host={window:{visible:true,minimized:false,rendererPid:123},main:{usedHeapSize:12},processes:[{pid:123,type:'Tab',memory:{workingSetSize:1234}}]},presentation={visibility:'visible',hidden:false,frames:[10,20]};
 const probe=createResourceProbe({app:{evaluate:async()=>host},page:{evaluate:async()=>presentation},cdp:{send:async method=>{
  calls.push(method);return method==='Runtime.getHeapUsage'?{usedSize:2048}:{nodes:100,jsEventListeners:10};
 }}});return {probe,calls,host,presentation};
}
test('natural resource samples name different API units and never collect garbage',async()=>{
 const f=fixture(),r=await f.probe.sample();assert.equal(r.schema,2);assert.equal(r.collected,false);
 assert.deepEqual(r.units,{renderer:'bytes',main:'kilobytes',processes:'kilobytes'});
 assert.equal(r.renderer.usedSize,2048);assert.equal(r.main.usedHeapSize,12);assert.equal(r.processes[0].memory.workingSetSize,1234);
 assert.equal(r.presentation.rendererPid,123);assert(!f.calls.includes('HeapProfiler.collectGarbage'));
});
test('diagnostic collection is explicit and keeps the separate natural snapshot',async()=>{
 const f=fixture(),r=await f.probe.sample({collect:true});assert.equal(r.collected,true);assert.equal(r.beforeCollection.renderer.usedSize,2048);
 assert.deepEqual(f.calls,['Runtime.getHeapUsage','Memory.getDOMCounters','HeapProfiler.collectGarbage','Runtime.getHeapUsage','Memory.getDOMCounters']);
});
test('native hidden/minimized windows are refused even when the renderer says visible',async()=>{
 for(const change of [{visible:false},{minimized:true}]){
  const f=fixture();Object.assign(f.host.window,change);await assert.rejects(f.probe.sample({collect:true}),error=>{const state=JSON.parse(error.message.slice(error.message.indexOf(': ')+2));assert.equal(state.presentation.visibility,'visible');assert.deepEqual(state.nativeWindow,f.host.window);return true;});assert.deepEqual(f.calls,[]);
 }
});
test('hidden renderer or missing/invalid frame timestamps cannot become acceptance evidence',async()=>{
 for(const change of [{visibility:'hidden'},{hidden:true},{frames:[]},{frames:[20,10]},{frames:[10,NaN]}]){
  const f=fixture();Object.assign(f.presentation,change);await assert.rejects(f.probe.sample(),/visible native window/);assert.deepEqual(f.calls,[]);
 }
});
function frameHarness(){
 const queue=[];let timeout,cleared=false,delay;
 const result=vm.runInNewContext('('+rendererFrames.toString()+')()',{
  document:{visibilityState:'visible',hidden:false},requestAnimationFrame:callback=>queue.push(callback),
  setTimeout:(callback,ms)=>{timeout=callback;delay=ms;return 1;},clearTimeout:()=>{cleared=true;},
 });
 return {result,queue,step:time=>queue.shift()(time),expire:()=>timeout(),cleared:()=>cleared,delay:()=>delay};
}
test('duplicate frame timestamps wait for a distinct frame before returning a valid sample',async()=>{
 const f=frameHarness();let resolved=false;void f.result.then(()=>{resolved=true;});f.step(10);f.step(10);
 await Promise.resolve();assert.equal(resolved,false);assert.equal(f.queue.length,1);f.step(20);
 const r=await f.result;assert.deepEqual(Array.from(r.frames),[10,20]);assert.equal(r.frameCallbacks,3);assert(f.cleared());
});
test('a stationary frame clock stays bounded and cannot return acceptance after timeout',async()=>{
 const f=frameHarness();f.step(10);f.step(10);assert.equal(f.delay(),5000);
 const failed=assert.rejects(f.result,/two distinct frame timestamps/);f.expire();await failed;
 f.step(20);assert.equal(f.queue.length,0);assert.equal(f.cleared(),false);
});
