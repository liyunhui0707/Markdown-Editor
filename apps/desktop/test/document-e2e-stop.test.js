const test=require('node:test'),assert=require('node:assert/strict');
const {stopOwnedElectron}=require('../e2e/helpers/document-owned-stop.cjs');
test('owned test shutdown records normal exit without a forced termination',async()=>{
 let killed=false;const app={close:async()=>{},process:()=>({pid:123,kill(){killed=true;}})};
 assert.deepEqual(await stopOwnedElectron({app,exit:Promise.resolve({code:0,signal:null}),timeoutMs:10}),{code:0,signal:null,forced:false});
 assert(!killed);
});
test('a blocked synthetic test cannot stall teardown or be reported as a clean pass',async()=>{
 let finish;const exit=new Promise(r=>finish=r),signals=[];
 const app={close:()=>new Promise(()=>{}),process:()=>({pid:123,kill(signal){signals.push(signal);finish({code:null,signal});}})};
 const result=await stopOwnedElectron({app,exit,timeoutMs:10});
 assert.equal(result.forced,true);assert.deepEqual(signals,['SIGTERM']);assert.equal(result.signal,'SIGTERM');
});
