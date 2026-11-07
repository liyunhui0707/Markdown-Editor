import test from 'node:test';
import assert from 'node:assert/strict';
import {undo,redo,isolateHistory} from '@codemirror/commands';
import {sourceState,rawSource,displaySource,rawOffset,displayOffset} from '../lib/document-source-buffer.mjs';
import edits from '../lib/document-source-edit.js';
test('source state preserves mixed endings across disjoint changes and local undo/redo',()=>{
 const raw='---\r\nx: 1\r\n---\n\n<html>😀</html>\rfinal\n';let state=sourceState(raw);
 const dispatch=tr=>{state=tr.state;};
 dispatch(state.update({changes:[{from:0,insert:'a\nb\n'},{from:state.doc.length-1,to:state.doc.length,insert:'\ntail'}],annotations:isolateHistory.of('full')}));
 const result=state.field(rawSource);assert.equal(result,'a\r\nb\r\n'+raw+'tail');
 assert(undo({state,dispatch}));assert.equal(state.field(rawSource),raw);
 assert(redo({state,dispatch}));assert.equal(state.field(rawSource),result);
});
test('raw/display offsets round trip at all display boundaries including CRLF and emoji',()=>{
 const source='a\r\n😀b\rc\nd';
 for(let i=0;i<=displaySource(source).length;i++)assert.equal(displayOffset(source,rawOffset(source,i)),i);
 assert.equal(displaySource(source),'a\n😀b\nc\nd');
});
test('ordinary newline insertion follows the local line ending; untouched bytes survive',()=>{
 const before='a\r\nb\nc\r',s=sourceState(before);
 const tr=s.update({changes:{from:3,insert:'x\ny'}});
 assert.equal(tr.state.field(rawSource),'a\r\nbx\ny\nc\r');
});
test('invalid or oversized input leaves source/history unchanged and reports refusal',()=>{
 let rejected=0,state=sourceState('Text😀\r\n',[],()=>rejected++);
 for(const changes of [{from:0,insert:'\0'},{from:0,insert:'x'.repeat(524289)},{from:5,to:5,insert:'a'}]) {
  state=state.update({changes}).state;assert.equal(state.field(rawSource),'Text😀\r\n');
 }
 assert.equal(rejected,3);assert.equal(undo({state,dispatch:()=>{}}),false);
});
test('single raw patch is Unicode safe and leaves everything outside its range exact',()=>{
 for(const [a,b] of [['a😀\r\nb','a😃\r\nb'],['','x\n'],['one',''],['same','same']]) {
  const result=edits.sourceDifference(a,b);assert(result.ok);assert.equal(result.source,b);
  assert.equal(edits.sourceChange(b,result.inverse).source,a);
 }
});
test('grouped typing and newline deletion undo/redo keep display and exact mixed raw source together',()=>{
 for(const changes of [[{from:0,insert:'a'},{from:1,insert:'b'},{from:2,insert:'c'}],[{from:1,to:2,insert:''},{from:1,to:2,insert:''}]]){
  const before='x\r\ny\nz\r';let state=sourceState(before);const dispatch=tr=>{state=tr.state;};
  for(const change of changes)dispatch(state.update({changes:change,userEvent:change.insert?'input.type':'delete.backward'}));
  const after=state.field(rawSource);assert.equal(displaySource(after),state.doc.toString());
  assert(undo({state,dispatch}));assert.equal(state.field(rawSource),before);assert.equal(displaySource(state.field(rawSource)),state.doc.toString());
  assert(redo({state,dispatch}));assert.equal(state.field(rawSource),after);assert.equal(displaySource(state.field(rawSource)),state.doc.toString());
 }
});
