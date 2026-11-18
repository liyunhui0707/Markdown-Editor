import test from 'node:test';import assert from 'node:assert/strict';
import {createPresentationScheduler} from '../lib/document-presentation-scheduler.mjs';
test('optimistic presentation coalesces one frame, settled and protected states update immediately',()=>{
 const rendered=[],fast=[],frames=new Map();let seq=0;
 const scheduler=createPresentationScheduler({render:s=>rendered.push(s),fast:s=>fast.push(s),schedule:fn=>{frames.set(++seq,fn);return seq;},cancel:id=>frames.delete(id)});
 const first={pending:1,recoveryRecords:[]},second={pending:2,recoveryRecords:[]};scheduler.update(first);scheduler.update(second);assert.equal(frames.size,1);assert.deepEqual(fast,[first,second]);assert.equal(rendered.length,0);
 const callback=frames.values().next().value;frames.clear();callback();assert.deepEqual(rendered,[second]);
 for(const protectedState of [{pending:0},{pending:2,locked:true},{pending:1,composing:true},{pending:1,historyPending:true},{pending:1,recoveryRecords:[{}]}]){
  scheduler.update(first);const s={recoveryRecords:[],...protectedState};scheduler.update(s);assert.equal(rendered.at(-1),s);assert.equal(frames.size,0);
 }
 scheduler.update(first);scheduler.clear();assert.equal(frames.size,0);
});
