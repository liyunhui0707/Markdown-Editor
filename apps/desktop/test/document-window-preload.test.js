'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
function fixture(){
 const dom=new EventEmitter(),ipc=new EventEmitter(),calls=[],timers=[];let api;
 ipc.invoke=(channel,data)=>{calls.push({channel,data});return Promise.resolve({ok:true});};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/document-demo-preload.js'),'utf8'),{
  document:{addEventListener:(n,f)=>dom.on(n,f)},setTimeout:f=>{timers.push(f);return f;},clearTimeout:()=>{},
  require:()=>({ipcRenderer:ipc,contextBridge:{exposeInMainWorld:(_n,v)=>api=v}}),
 });return {api,dom,ipc,calls,timers};
}
test('native finish waits for background catalog IPC to settle instead of losing a single close request',async()=>{
 const h=fixture();let release;h.ipc.invoke=(channel,data)=>{h.calls.push({channel,data});return data?.operation==='list-recents'?new Promise(r=>release=r):Promise.resolve({ok:true});};
 const recent=h.api.listRecents(),finish=h.api.finishWindowClose();
 await Promise.resolve();assert.equal(h.calls.length,1);release({ok:true,entries:[]});await recent;
 assert.equal((await finish).ok,true);assert.equal(h.calls.at(-1).channel,'document-demo:finish-window-close');assert.equal(h.calls.at(-1).data,undefined);
});
test('a composition or unknown result arriving during the wait still forbids native finish',async()=>{
 for(const kind of ['composition','unknown']){
  const h=fixture();let release;h.ipc.invoke=(_channel,data)=>data?.operation==='list-recents'?new Promise(r=>release=r):assert.fail('No native close after a protected result');
  const recent=h.api.listRecents(),finish=h.api.finishWindowClose();
  if(kind==='composition')h.dom.emit('compositionstart');release(kind==='unknown'?null:{ok:true,entries:[]});await recent;
  assert.equal((await finish).ok,false);
 }
});
test('catalog timeout leaves the window open and a late response never replays closing',async()=>{
 const h=fixture();let release;h.ipc.invoke=(_channel,data)=>data?.operation==='list-recents'?new Promise(r=>release=r):assert.fail('No late close');
 const recent=h.api.listRecents(),finish=h.api.finishWindowClose();
 assert.equal(h.timers.length,1);h.timers[0]();assert.equal((await finish).ok,false);release({ok:true,entries:[]});await recent;
});

test('the next document close waits for catalog refresh started by closing the previous document',async()=>{
 const h=fixture();let release;
 h.ipc.invoke=(channel,data)=>{h.calls.push({channel,data});return data?.operation==='list-recents'?new Promise(r=>release=r):Promise.resolve({ok:true,sessionId:data.sessionId,requestRevision:data.expectedRevision,closed:true});};
 const recent=h.api.listRecents(),close=h.api.closeDocument({sessionId:'second-read-only-document',expectedRevision:0});
 await Promise.resolve();assert.equal(h.calls.length,1);release({ok:true,entries:[]});await recent;
 const r=await close;assert.equal(r.ok,true);assert.equal(r.closed,true);assert.equal(h.calls.at(-1).data.operation,'close-document');
});

test('waiting document close rechecks composition, unknown replies and invalidation before fencing the session',async()=>{
 for(const kind of ['composition','unknown','invalidated']){
  const h=fixture();let release;h.ipc.invoke=(_channel,data)=>data?.operation==='list-recents'?new Promise(r=>release=r):assert.fail('A protected close must not reach main');
  const recent=h.api.listRecents(),close=h.api.closeDocument({sessionId:'second',expectedRevision:0});
  if(kind==='composition')h.dom.emit('compositionstart');
  if(kind==='invalidated')h.ipc.emit('document-demo:invalidated',{}, {sessionId:'second'});
  release(kind==='unknown'?null:{ok:true,entries:[]});await recent;assert.equal((await close).ok,false);
 }
});
test('timed-out document close stays open and never replays after a late catalog reply',async()=>{
 const h=fixture();let release;h.ipc.invoke=(_channel,data)=>data?.operation==='list-recents'?new Promise(r=>release=r):assert.fail('No late document close');
 const recent=h.api.listRecents(),close=h.api.closeDocument({sessionId:'second',expectedRevision:0});h.timers[0]();assert.equal((await close).code,'document-busy');release({ok:true,entries:[]});await recent;
});
