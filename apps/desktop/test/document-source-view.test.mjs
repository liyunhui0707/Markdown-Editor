import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceView, sourceSummary } from '../lib/document-source-view.mjs';

function fixture(editable=false) {
  const nodes = new Map();
  const doc = { activeElement: null, querySelector: () => nodes.get('source-dialog')?.open ? {} : null,
    createRange: () => ({ selectNodeContents(n) { this.node = n; } }),
    getSelection: () => ({ removeAllRanges() {}, addRange(r) { doc.selected = r.node; } }) };
  const byId = id => {
    if (!nodes.has(id)) nodes.set(id, { ownerDocument: doc, dataset: {}, textContent: '', attrs: {},
      setAttribute(k,v) { this.attrs[k]=v; }, addEventListener(k,f) { this[k+'Event']=f; },
      showModal() { this.open=true; }, close() { this.open=false; this.closeEvent?.(); },
      focus() { doc.activeElement=this; } });
    return nodes.get(id);
  };
  const source = '# 中文\r\n\r\n<div>literal & unsafe</div>\rfinal\n';
  const c = { editor: { view: { composing: false } }, state: { source,
    confirmed: { source, label: 'Test.md', sessionId: 'a', revision: 4, bom: true } } };
  let buffer;
  if(editable)Object.assign(c.state.confirmed,{temporary:true,readOnly:false});
  const view = createSourceView({ byId, context: () => c,createEditor:({changed})=>buffer={notify:()=>changed(false),source:c.state.source,selection:0,composing:false,canUndo:true,canRedo:false,setWrap(){},setLocked(){},focus(){},destroy(){this.destroyed=true;}} }); view.configure();
  return { byId, c, doc, view, buffer:()=>buffer };
}
test('source summary distinguishes BOM and mixed line endings including empty text', () => {
  assert.match(sourceSummary({source:'a\r\nb\nc\rd', bom:true}), /CRLF.*LF.*CR/);
  assert.match(sourceSummary({source:'', bom:false}), /1 行.*无换行.*无 BOM/);
});
test('source view shows exact confirmed text as plain text, selects locally and never changes state', () => {
  const {byId,c,doc}=fixture(), before=structuredClone(c.state);
  byId('source-text').scrollTop=200;byId('source-text').scrollLeft=100;
  byId('show-source').onclick();
  assert.equal(byId('source-text').scrollTop,0);assert.equal(byId('source-text').scrollLeft,0);
  assert.equal(byId('source-dialog').open,true);
  assert.equal(byId('source-text').textContent,c.state.confirmed.source);
  byId('select-source').onclick(); assert.equal(doc.selected,byId('source-text'));
  byId('source-wrap').onclick(); assert.equal(byId('source-text').dataset.wrap,'false');
  byId('close-source').onclick(); assert.equal(byId('source-text').textContent,'');
  assert.equal(doc.activeElement,byId('show-source')); assert.deepEqual(c.state,before);
});
test('unconfirmed, native composition, invalid and busy states cannot open a snapshot', () => {
  for (const field of ['pending','historyPending','composing','compositionInvalid','locked']) {
    const {byId,c,view}=fixture(); c.state[field]=true; view.sync();
    byId('show-source').onclick(); assert.notEqual(byId('source-dialog').open,true,field);
  }
  for (const field of ['loading','invalid']) {
    const {byId,c,view}=fixture(); c[field]=true; view.sync();
    byId('show-source').onclick(); assert.notEqual(byId('source-dialog').open,true,field);
  }
  const {byId,c}=fixture(); c.editor.view.composing=true; byId('show-source').onclick();
  assert.notEqual(byId('source-dialog').open,true);
  c.editor.view.composing=false; c.state.source+='unconfirmed'; byId('show-source').onclick();
  assert.notEqual(byId('source-dialog').open,true);
});
test('a session, revision, text or lifecycle change closes and clears the old source snapshot', () => {
  for (const change of [c=>c.state.confirmed.sessionId='b', c=>c.state.confirmed.revision++,
    c=>c.state.confirmed.source+='new', c=>c.loading=true, c=>c.state=undefined]) {
    const {byId,c,view}=fixture(); byId('show-source').onclick(); change(c); view.sync();
    assert.equal(byId('source-dialog').open,false); assert.equal(byId('source-text').textContent,'');
  }
});

test('unapplied source requires explicit discard; cancellation retains buffer and original',()=>{
 const f=fixture(true),original=f.c.state.confirmed.source;f.byId('show-source').onclick();f.buffer().source='changed';
 f.byId('close-source').onclick();assert.equal(f.byId('source-dialog').open,true);assert.equal(f.byId('source-discard').hidden,false);
 f.buffer().notify();assert.equal(f.byId('source-discard').hidden,false,'focus-only update keeps the discard decision visible');
 f.byId('keep-source').onclick();assert.equal(f.buffer().source,'changed');assert.equal(f.byId('source-discard').hidden,true);
 f.byId('source-dialog').cancelEvent({preventDefault(){}});f.byId('discard-source').onclick();
 assert.equal(f.byId('source-dialog').open,false);assert.equal(f.c.state.confirmed.source,original);
});
test('stale/revoked source edit retains text for recovery rather than closing',()=>{
 const f=fixture(true);f.byId('show-source').onclick();f.buffer().source='retained';f.c.invalid=true;f.view.sync();
 assert.equal(f.byId('source-dialog').open,true);assert.equal(f.buffer().source,'retained');assert.equal(f.byId('apply-source').disabled,true);
});
test('composition blocks apply/cancel and failed apply retains source',async()=>{
 const f=fixture(true);let calls=0;f.c.controller={state:()=>f.c.state,applySource:async()=>{calls++;return false;}};
 f.byId('show-source').onclick();f.buffer().source='retained';f.buffer().composing=true;f.view.sync();
 await f.byId('apply-source').onclick();f.byId('close-source').onclick();assert.equal(calls,0);assert.equal(f.byId('source-dialog').open,true);
 f.buffer().composing=false;await f.byId('apply-source').onclick();assert.equal(calls,1);assert.equal(f.buffer().source,'retained');assert.equal(f.byId('source-dialog').open,true);
});
