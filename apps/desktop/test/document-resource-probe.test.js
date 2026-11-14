// This helper belongs to E2E verification; these checks protect evidence validity.
const test=require('node:test'),assert=require('node:assert/strict');
const {createResourceProbe}=require('../e2e/helpers/document-resource-probe.cjs');
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
  const f=fixture();Object.assign(f.host.window,change);await assert.rejects(f.probe.sample({collect:true}),/visible native window/);assert.deepEqual(f.calls,[]);
 }
});
test('hidden renderer or missing/invalid frame timestamps cannot become acceptance evidence',async()=>{
 for(const change of [{visibility:'hidden'},{hidden:true},{frames:[]},{frames:[20,10]},{frames:[10,NaN]}]){
  const f=fixture();Object.assign(f.presentation,change);await assert.rejects(f.probe.sample(),/visible native window/);assert.deepEqual(f.calls,[]);
 }
});
