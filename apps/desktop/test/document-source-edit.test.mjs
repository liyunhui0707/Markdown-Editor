import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {createEditController} from '../lib/document-edit-controller.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
const require=createRequire(import.meta.url);
const {createDocumentService}=require('../lib/document-service');
const {createDocumentSessions}=require('../lib/document-session-ipc');
function fixture({readOnly=false,temporary=!readOnly,parse=projectSource}={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-source-edit-')),file=path.join(root,'original.md');
 const bytes=Buffer.from('\ufeff---\r\nname: synthetic\r\n---\n\n<div>inert</div>\r\n\nText😀\rfinal\n');
 fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});const service=createDocumentService(),document=service.open(file).document;
 const win=new EventEmitter(),wc=new EventEmitter(),frame={url:'file:///synthetic/demo.html'};
 Object.assign(wc,{mainFrame:frame,isDestroyed:()=>false,getURL:()=>frame.url,send:()=>{}});
 Object.assign(win,{webContents:wc,isDestroyed:()=>false});
 const manager=createDocumentSessions({service,projectSource:parse,mapTextEdit,windowFor:sender=>sender===wc?win:null});manager.grant(win,frame.url);
 const id=manager.provision(win,document,'Synthetic',{temporary,readOnly}),event={sender:wc,senderFrame:frame};
 const call=(operation,extra={})=>manager.request(event,{operation,sessionId:id,...(operation==='snapshot'?{}:{expectedRevision:document.revision}),...extra});
 return {file,bytes,document,id,call,manager,event,win};
}
test('source editing changes protected YAML/HTML exactly, joins main history and leaves original bytes alone',()=>{
 const f=fixture(),before=f.document.text,from=before.indexOf('inert');
 const r=f.call('source-edit',{from,to:from+5,insert:'changed **raw**'});
 assert.equal(r.ok,true);assert.equal(r.snapshot.source,before.replace('inert','changed **raw**'));assert.equal(r.snapshot.bom,true);
 assert.equal(r.snapshot.revision,1);assert.equal(r.snapshot.canUndo,true);
 assert.equal(f.call('undo').snapshot.source,before);assert.equal(f.call('redo').snapshot.source,r.snapshot.source);
 assert.equal(f.call('save').code,'temporary-not-persistable');assert.deepEqual(fs.readFileSync(f.file),f.bytes);
});
test('source edits require independent draft, exact revision and trusted caller; extra authority is refused',()=>{
 for(const options of [{readOnly:true},{temporary:false}]){const f=fixture(options);assert.equal(f.call('source-edit',{from:0,to:0,insert:'# '}).ok,false);assert.equal(f.document.revision,0);}
 const f=fixture(),req={from:0,to:0,insert:'# '};
 assert.equal(f.call('source-edit',{...req,expectedRevision:9}).code,'stale-revision');
 assert.equal(f.call('source-edit',{...req,path:f.file}).code,'invalid-request');
 assert.equal(f.manager.request({sender:{},senderFrame:f.event.senderFrame},{operation:'source-edit',sessionId:f.id,expectedRevision:0,...req}).code,'unauthorized-sender');
 f.win.emit('closed');assert.equal(f.call('source-edit',req).ok,false);
});
test('invalid source, oversized edits and parse refusal are atomic and preserve redo',()=>{
 const f=fixture({parse:s=>{if(s.includes('REJECT_ME'))throw Error('synthetic parser rejection');return projectSource(s);}}),before=f.document.text;
 assert.equal(f.call('source-edit',{from:0,to:0,insert:'ok'}).ok,true);f.call('undo');
 const split=before.indexOf('😀')+1;
 for(const change of [{from:0,to:0,insert:'\0'},{from:0,to:0,insert:'\ud800'},{from:split,to:split,insert:'x'},{from:0,to:0,insert:'x'.repeat(524289)},{from:0,to:0,insert:'REJECT_ME'},{from:-1,to:0,insert:''}]){
  assert.equal(f.call('source-edit',change).ok,false);assert.equal(f.document.text,before);assert.equal(f.document.revision,2);
 }
 assert.equal(f.call('source-edit',{from:0,to:0,insert:''}).snapshot.canRedo,true);
 assert.equal(f.call('redo').snapshot.source,'ok'+before);
});
test('a complete source replacement including empty document is reversible without Markdown normalization',()=>{
 const f=fixture(),before=f.document.text,next='[ref]: https://example.invalid\r\n\n| A | B |\n| - | - |\n| **raw** | <x> |\n';
 assert.equal(f.call('source-edit',{from:0,to:before.length,insert:next}).snapshot.source,next);
 assert.equal(f.call('source-edit',{from:0,to:next.length,insert:''}).snapshot.source,'');
 assert.equal(f.call('undo').snapshot.source,next);assert.equal(f.call('undo').snapshot.source,before);
});

for(const fault of ['none','lost','wrong','refusal'])test('source controller '+fault+' preserves confirmation and submits at most once',async()=>{
 const f=fixture(),initial=f.call('snapshot').snapshot,before=initial.source,next=before.replace('synthetic','edited');let calls=0;
 const controller=createEditController(initial,{send:async(op,data)=>{
  if(op==='source-edit'){calls++;if(fault==='refusal')return {ok:false,code:'refused',snapshot:initial};}
  const r=f.call(op,data);
  if(op==='source-edit'&&fault==='lost')throw Error('lost acknowledgement');
  if(op==='source-edit'&&fault==='wrong')return {...r,snapshot:{...r.snapshot,source:'wrong'}};
  return r;
 }});
 assert.equal(await controller.applySource(next),fault==='none');assert.equal(calls,1);
 assert.equal(controller.state().confirmed.source,fault==='refusal'?before:next);
 assert.equal(controller.state().historyPending,false);assert.deepEqual(fs.readFileSync(f.file),f.bytes);
 if(fault==='none'){assert.equal(await controller.history('undo'),true);assert.equal(controller.state().source,before);assert.equal(await controller.history('redo'),true);assert.equal(controller.state().source,next);}
});
test('source apply is fenced during composition and pending acknowledgement',async()=>{
 const f=fixture(),initial=f.call('snapshot').snapshot;let release,calls=0;
 const c=createEditController(initial,{send:async(op,p)=>{calls++;const r=f.call(op,p);await new Promise(resolve=>release=resolve);return r;}});
 c.beginComposition();assert.equal(await c.applySource('source'),false);c.endComposition();
 const first=c.applySource('source');assert.equal(await c.applySource('different'),false);assert.equal(calls,1);release();assert.equal(await first,true);
});
test('main history prunes old large source replacements while keeping four exact undo/redo steps',()=>{
 const f=fixture(),{MAX_SOURCE_UNITS}=require('../lib/document-capacity');
 for(let i=0;i<6;i++)assert.equal(f.call('source-edit',{from:0,to:f.document.text.length,insert:String(i).repeat(MAX_SOURCE_UNITS)}).ok,true);
 for(let i=4;i>=1;i--){const r=f.call('undo');assert.equal(r.ok,true);assert.equal(r.snapshot.source,String(i).repeat(MAX_SOURCE_UNITS));}
 assert.equal(f.call('undo').code,'history-empty');
 for(let i=2;i<=5;i++){const r=f.call('redo');assert.equal(r.ok,true);assert.equal(r.snapshot.source,String(i).repeat(MAX_SOURCE_UNITS));}
 assert.deepEqual(fs.readFileSync(f.file),f.bytes);
});
