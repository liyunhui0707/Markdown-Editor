import test from 'node:test';import assert from 'node:assert/strict';
import {createLinkedFileView} from '../lib/document-linked-file-view.mjs';
function harness(){
 const nodes=new Map(),calls=[];let loading=false,reply={ok:true,sessionId:'A',requestRevision:2};
 const s={confirmed:{sessionId:'A',revision:2,source:'local',linkedFile:{filePath:'/synthetic/原文.md',baselineSha256:'base',checked:null}},source:'local',recoveryRecords:[]};
 const byId=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const controller={state:()=>s,refresh:r=>{calls.push(['refresh']);s.confirmed=r.snapshot;}};
 const invoke=async q=>{calls.push(q);return reply;};
 const view=createLinkedFileView({api:{inspectLinkedFile:invoke,revealLinkedFile:invoke},byId,context:()=>({controller,selected:'A',loading}),busy:v=>{loading=v;},rerender:()=>view.render(),open:invoke});view.render();
 return {s,byId,calls,view,result:r=>{reply=r;}};
}
test('explicit check refreshes metadata only; open/reveal use a main session and revision without paths',async()=>{
 const h=harness(),source=h.s.source;
 h.result({ok:true,snapshot:{...h.s.confirmed,linkedFile:{...h.s.confirmed.linkedFile,checked:{state:'changed',checkedAt:1}}}});
 await h.byId('inspect-linked-file').onclick();assert.equal(h.s.source,source);assert.match(h.byId('linked-file-status').textContent,/撤销历史保留/);assert.match(h.byId('linked-file-checked').textContent,/不是实时监测/);
 h.result({ok:true,sessionId:'A',requestRevision:2});await h.byId('open-linked-file').onclick();await h.byId('reveal-linked-file').onclick();assert.deepEqual(h.calls.filter(c=>!Array.isArray(c)),Array(3).fill({sessionId:'A',expectedRevision:2}));
});
for(const patch of [{pending:1},{composing:true},{compositionInvalid:true},{historyPending:true},{locked:true},{source:'pending'},{recoveryRecords:[{}]}])test('linked action guard '+Object.keys(patch)[0],async()=>{
 const h=harness();Object.assign(h.s,patch);h.view.render();let prevented=false;h.byId('inspect-linked-file').onpointerdown({preventDefault(){prevented=true;}});assert(prevented);
 for(const id of ['inspect-linked-file','open-linked-file','reveal-linked-file']){assert(h.byId(id).disabled);await h.byId(id).onclick();}assert.deepEqual(h.calls,[]);
});
test('unknown or mismatched inspection results stop actions and release only on confirmed close',async()=>{
 const h=harness();h.result({ok:true,snapshot:{...h.s.confirmed,source:'different'}});await h.byId('inspect-linked-file').onclick();assert.match(h.byId('linked-file-status').textContent,/尚未确认/);assert(h.byId('open-linked-file').disabled);
 h.view.release('other');h.view.render();assert(h.byId('open-linked-file').disabled);h.view.release('A');h.view.render();assert.equal(h.byId('open-linked-file').disabled,false);assert.equal(h.s.source,'local');
});
