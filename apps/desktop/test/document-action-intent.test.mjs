import test from 'node:test';import assert from 'node:assert/strict';
import {createActionIntent} from '../lib/document-action-intent.mjs';
function fixture(){let resolve,calls=0;const state={source:'optimistic',pending:1,recoveryRecords:[],confirmed:{source:'old',sessionId:'a'}};
 const controller={idle:()=>new Promise(r=>{resolve=r;})},c={controller,state};
 const messages=[],intent=createActionIntent({context:()=>c,report:m=>messages.push(m)});
 return {c,intent,messages,act:()=>{calls++;return true;},calls:()=>calls,settle(){state.pending=0;state.confirmed.source=state.source;resolve();}};
}
test('one user request waits for exact confirmed input and does not issue duplicate actions',async()=>{
 const f=fixture(),first=f.intent.run('保存',f.act);assert(f.intent.waiting());assert.equal(await f.intent.run('保存',f.act),false);assert.equal(f.calls(),0);
 f.settle();assert.equal(await first,true);assert.equal(f.calls(),1);assert.equal(f.intent.waiting(),false);
});
test('candidate input is never forced to finish or replayed automatically',async()=>{
 const f=fixture();f.c.state.composing=true;assert.equal(await f.intent.run('新建',f.act),false);f.c.state.composing=false;assert.equal(f.calls(),0);assert.match(f.messages[0],/完成当前选词/);
});
test('session changes, new input and unknown/recovery state cancel a waiting intent',async()=>{
 for(const change of [c=>c.controller={},c=>c.state.source='different',c=>c.state.locked=true,c=>c.state.recoveryRecords=[{}],c=>c.state.composing=true]){
  const f=fixture(),pending=f.intent.run('保存',f.act);change(f.c);f.settle();assert.equal(await pending,false);assert.equal(f.calls(),0);
 }
});
test('a timed-out intent releases the workspace and never replays on a late acknowledgement',async()=>{
 let finish,calls=0,aborted=false;const messages=[],state={source:'new',pending:1,confirmed:{source:'old'},recoveryRecords:[]};
 const controller={idle:({signal})=>new Promise(r=>{finish=r;signal.addEventListener('abort',()=>{aborted=true;});})};
 const intent=createActionIntent({context:()=>({controller,state}),report:m=>messages.push(m),timeoutMs:1});
 assert.equal(await intent.run('保存',()=>{calls++;}),false);assert.equal(intent.waiting(),false);assert.equal(aborted,true);assert.match(messages.at(-1),/尚未执行保存/);finish();await Promise.resolve();assert.equal(calls,0);
});

test('confirmed queue-pause navigation preserves recovery while Save and unknown state stay blocked',async()=>{
 const f=fixture();Object.assign(f.c.state,{pending:0,source:'safe',confirmed:{source:'safe'},inputPaused:true,syncLocked:false,locked:true,recoveryRecords:[{reason:'edit-queue-full'}]});
 f.c.controller.idle=async()=>{};
 assert.equal(await f.intent.run('保存',f.act),false);assert.equal(await f.intent.run('新建',f.act,{navigation:true}),true);assert.equal(f.c.state.recoveryRecords.length,1);
 f.c.state.syncLocked=true;assert.equal(await f.intent.run('新建',f.act,{navigation:true}),false);
});
