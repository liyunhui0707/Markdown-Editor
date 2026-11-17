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
