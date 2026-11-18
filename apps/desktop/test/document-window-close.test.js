'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installWindowClose}=require('../lib/document-window-close');
test('native window close cannot skip document closure; completion requires the authorized empty manager',()=>{
 const win=new EventEmitter(),sent=[],handlers=new Map();let allow=false,closed=0,prevented=0;
 win.webContents={send:(...args)=>sent.push(args)};win.close=()=>{const e={preventDefault(){prevented++;}};win.emit('close',e);closed++;};
 installWindowClose({win,ipcMain:{handle:(n,f)=>handlers.set(n,f)},manager:{flushDrafts(){},canFinishWindowClose:e=>e.authorized&&allow}});
 win.emit('close',{preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(sent.length,1);
 const finish=handlers.get('document-demo:finish-window-close');assert.equal(finish({authorized:true}).ok,false);assert.equal(closed,0);
 allow=true;assert.equal(finish({authorized:false}).ok,false);assert.equal(finish({authorized:true},'discard').ok,false);
 assert.equal(finish({authorized:true}).ok,true);assert.equal(closed,1);assert.equal(prevented,1);
});

test('a revoked renderer requires explicit native confirmation, never an automatic bypass',()=>{
 const win=new EventEmitter();let accepted=false,closed=0,asks=0;win.webContents={send(){assert.fail('Revoked renderer must not authorize closing');}};
 win.close=()=>{closed++;win.emit('close',{preventDefault(){}});};
 installWindowClose({win,ipcMain:{handle(){}},manager:{flushDrafts(){},isWindowRevoked:()=>true},confirmUnavailable:()=>{asks++;return accepted;}});
 win.emit('close',{preventDefault(){}});assert.equal(closed,0);accepted=true;win.emit('close',{preventDefault(){}});assert.equal(closed,1);assert.equal(asks,2);
});
