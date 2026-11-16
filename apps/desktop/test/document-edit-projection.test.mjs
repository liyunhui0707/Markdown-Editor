import test from 'node:test';
import assert from 'node:assert/strict';
import {copyEditedBlock} from '../lib/document-edit-projection.mjs';
import {projectSource,mapTextEdit,mapTransactionTextEdit} from '../lib/document-source-map.mjs';

test('expected-document copy owns the edited subtree and borrows untouched blocks read-only',()=>{
  const source={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'left'}]},
    {type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'target'}]}]},
    Object.freeze({type:'paragraph',content:Object.freeze([{type:'text',text:'right'}])})]};
  const copy=copyEditedBlock(source,1);copy.content[1].content[0].content[0].text='changed';
  assert.equal(source.content[1].content[0].content[0].text,'target');
  assert.notEqual(copy.content,source.content);assert.equal(copy.content[0],source.content[0]);
  assert.equal(copy.content[2],source.content[2]);
  for(const index of [-1,3,1.5,null])assert.throws(()=>copyEditedBlock(source,index),TypeError);
});

test('transaction planner reuses its own complete before projection without changing ordinary results',()=>{
  const padding=Array.from({length:50},(_,i)=>`## ${i}\n\nUnchanged **body** [link](guide).\n\n`).join('');
  for(const nl of ['\n','\r\n','\r'])for(const body of [
    'Plain target.', 'A **target** [label](guide "keep") and `code`.',
    '- [X] **target**\n  continued [label](guide)\n- [ ] Next',
    '> **target**  \n> continued [label](guide)',
    '| A | B |\n| --- | --- |\n| **target** | intact |',
  ]){
    const source=(padding+body).replaceAll('\n',nl),before=projectSource(source);
    const span=before.spans.find(s=>s.text.includes('target'));assert(span,body);
    const at=span.from+span.text.indexOf('target')+3,change={from:at,to:at,insert:'中😀'};
    const ordinary=mapTextEdit(source,change),planned=mapTransactionTextEdit(source,change);
    assert(ordinary.ok&&planned.ok,body);const {beforeDoc,...result}=planned;
    assert.deepEqual(result,ordinary);assert.deepEqual(beforeDoc,before.doc);
    assert.deepEqual(projectSource(source),before);
  }
});

test('transaction projection metadata never bypasses input, range or source guards',()=>{
  const source='Plain target.';
  for(const change of [null,{},Object.assign(Object.create(null),{from:1,to:1,insert:'x'}),
    {from:1,to:1,insert:'x',beforeDoc:{type:'doc',content:[]}},
    {from:1,to:1,insert:' ',beforeDoc:{type:'doc',content:[]}},
    {from:-1,to:999,insert:'x'},{from:1,to:1,insert:'\u0000'}]){
    const result=mapTransactionTextEdit(source,change);assert.equal(result.ok,false);
    assert.equal('beforeDoc' in result,false);
  }
});

test('format-edge Space fallback retains the exact full before-document proof',()=>{
  for(const source of ['**target** next','- **target**\n  continued','> **target**  \n> continued',
    '| A | B |\n| --- | --- |\n| **target** next | intact |']){
    const before=projectSource(source),span=before.spans.find(s=>s.text==='target');assert(span);
    const change={from:span.to,to:span.to,insert:' '},ordinary=mapTextEdit(source,change);
    const planned=mapTransactionTextEdit(source,change);assert(planned.ok,source);
    const {beforeDoc,...result}=planned;assert.deepEqual(beforeDoc,before.doc);
    assert.deepEqual(result,ordinary);assert.deepEqual(projectSource(source),before);
  }
});
