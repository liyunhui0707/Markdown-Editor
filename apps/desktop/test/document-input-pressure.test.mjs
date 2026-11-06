import { mapFormatEdit } from '../lib/document-format-edit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { getSchema } from '@tiptap/core';
import { documentEditorExtensions } from '../lib/document-editor-extensions.mjs';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
import { createEditController } from '../lib/document-edit-controller.mjs';
const require = createRequire(import.meta.url);
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
const schema = getSchema([...documentEditorExtensions()]);
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(input = null, mapper = mapTextEdit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'document-interaction-')), file = path.join(root, 'a.md');
  fs.writeFileSync(file, input ?? '\ufeff---\r\nx: synthetic\r\n---\r\n# 标题😀\r\n\r\nPlain **粗体** tail.\r\n\r\n![x](../x.png)\r\n\r\n::: unknown\r\n');
  const disk = fs.readFileSync(file), service = createDocumentService(), document = service.open(file).document;
  const win = new EventEmitter(), wc = new EventEmitter(), frame = { url: 'file:///synthetic/demo.html' };
  Object.assign(wc, { isDestroyed: () => false, mainFrame: frame, getURL: () => frame.url });
  Object.assign(win, { isDestroyed: () => false, webContents: wc });
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit: mapper, mapFormatEdit, windowFor: () => win });
  manager.grant(win, frame.url); const id = manager.provision(win, document, 'A');
  const request = (operation, payload = {}) => manager.request({ sender: wc, senderFrame: frame }, { operation, sessionId: id, ...payload });
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(projectSource(document.text).doc) });
  const requests = [], replies = [], resets = [], snapshotReplies = [];
  const h = { file, disk, document, request, requests, replies, resets, delayed: false, failSnapshot: false, throwEdit: false };
  const controller = createEditController(request('snapshot').snapshot, {
    send: async (operation, payload) => {
      requests.push({ operation, ...payload });
      if (operation === 'snapshot' && h.failSnapshot) throw Error('synthetic snapshot transport failure');
      if (operation === 'edit' && h.throwEdit) throw Error('synthetic edit transport failure');
      const result = request(operation, payload);
      if (['edit','format'].includes(operation) && h.dropReplyAfterCommit) throw Error('synthetic response loss after real main edit');
      if (operation === 'snapshot' && h.delaySnapshot) await new Promise(resolve => snapshotReplies.push(resolve));
      if (['edit','format'].includes(operation) && h.delayed) await new Promise(resolve => replies.push(resolve));
      if (['edit','format'].includes(operation) && h.wrongAck) return { ...result, snapshot: { ...result.snapshot, source: '# WRONG ACK\n' } };
      return result;
    },
    onReset: (source, selection) => {
      resets.push(source); const doc = schema.nodeFromJSON(projectSource(source).doc);
      state = EditorState.create({ schema, doc, ...(selection ? { selection: TextSelection.create(doc, selection.from, selection.to) } : {}) });
    },
  });
  Object.assign(h, { controller, state: () => state, span: text => projectSource(controller.state().source).spans.find(s => s.text === text),
    snapshotReplies,
    apply(tr) { state = state.apply(tr); controller.accept(tr); },
    edit(from, to, insert) {
      const tr = state.tr.insertText(insert, from, to);
      if (!controller.prepare(tr)) return false;
      state = state.apply(tr); controller.accept(tr); return true;
    },
    select(from, to = from) { state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))); },
  });
  return h;
}

async function fillQueue(h) {
 h.delayed=true; const at=h.span('Plain ').from+1;
 for(let i=0;i<64;i++)assert.equal(h.edit(at+i,at+i,'a'),true);
 return at+64;
}
async function drain(h){h.delayed=false;await tick();h.replies.shift()();await h.controller.idle();}

test('queue overflow retains the first refused edit and stays paused after acknowledgements',async()=>{
 const h=harness(),at=await fillQueue(h),queued=h.controller.state().source;
 assert.equal(h.edit(at,at,'未确认😀'),false);
 const paused=h.controller.state();assert.equal(paused.inputPaused,true);assert.equal(paused.locked,true);
 assert.equal(paused.pending,64);assert.equal(paused.recoveryRecords.length,1);
 const copy=paused.recoveryRecords[0];assert.equal(copy.reason,'edit-queue-full');assert.equal(copy.queuedSource,queued);
 assert.equal(copy.source,queued.replace('lain ','未确认😀lain '));
 assert.equal(h.edit(at,at,'later'),false);assert.equal(h.controller.beginComposition(),false);
 assert.equal(h.controller.discardRecovery(copy.id),false);
 await drain(h);assert.equal(h.document.text,queued);assert.equal(h.document.revision,64);
 assert.equal(h.controller.state().inputPaused,true);assert.equal(h.controller.state().locked,true);
 assert.deepEqual(h.controller.state().recoveryRecords,[copy]);
 assert.equal(await h.controller.history('undo'),false);
 h.controller.refresh(h.request('check'));assert.equal(h.controller.state().inputPaused,true);
 await h.controller.reload();assert.equal(h.controller.state().inputPaused,true);
 const restored=createEditController(h.controller.state().confirmed,{send:async()=>h.request('snapshot'),recoveryRecords:h.controller.state().recoveryRecords});
 assert.equal(restored.state().inputPaused,true);
 assert.equal(h.controller.discardRecovery(copy.id),true);assert.equal(h.controller.state().locked,false);
 assert.equal(h.edit(at,at,'explicit'),true);await h.controller.idle();assert.equal(h.document.text.includes('explicit'),true);
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('lost acknowledgement after overflow retains queued and refused snapshots without retry',async()=>{
 const h=harness();h.wrongAck=true;const at=await fillQueue(h),queued=h.controller.state().source;
 assert.equal(h.edit(at-4,at,'replacement'),false);const retained=h.controller.state().recoveryRecords;
 await drain(h);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
 assert.equal(h.document.revision,1);assert.equal(h.controller.state().inputPaused,true);
 assert.deepEqual(h.controller.state().recoveryRecords,retained);assert.equal(retained[0].queuedSource,queued);
 assert(retained[0].source.includes('replacement'));assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('composition at queue capacity finishes before retaining its unsubmitted result',async()=>{
 const h=harness(),at=await fillQueue(h),queued=h.controller.state().source;
 assert.equal(h.controller.beginComposition(),true);assert.equal(h.edit(at,at,'ni'),true);
 assert.equal(h.edit(at,at+2,'你😀'),true);assert.equal(h.controller.state().inputPaused,false);
 h.controller.endComposition();const s=h.controller.state();assert.equal(s.composing,false);assert.equal(s.pending,64);
 assert.equal(s.inputPaused,true);assert.equal(s.source,queued);assert(s.recoveryDraft.includes('你😀'));
 await drain(h);assert.equal(h.document.text,queued);assert.equal(h.document.revision,64);
 assert.equal(h.controller.state().recoveryRecords[0].queuedSource,queued);
});

test('overflow recovery never converts unsupported or malformed transactions into approved Markdown',async()=>{
 const h=harness(),at=await fillQueue(h);
 assert.equal(h.edit(at,at,'\uD800'),false);assert.equal(h.controller.state().recoveryRecords.length,0);
 assert.equal(h.edit(at,at,'valid'),false);await drain(h);
 assert.equal(h.controller.state().recoveryRecords.length,1);assert(h.controller.state().recoveryDraft.includes('valid'));
});

test('unknown main outcome cannot remove the pause through later status refresh',async()=>{
 const h=harness();h.wrongAck=true;h.failSnapshot=true;
 const at=await fillQueue(h);assert.equal(h.edit(at,at,'kept'),false);
 await drain(h);const s=h.controller.state();assert.equal(s.code,'sync-unknown');assert.equal(s.locked,true);
 assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
 assert.equal(await h.controller.reload(),false);assert.equal(h.controller.state().inputPaused,true);
 assert.equal(h.controller.state().recoveryRecords[0].source,s.recoveryRecords[0].source);
});

import { createInputPressureView } from '../lib/document-input-pressure-view.mjs';
function pressureViewFixture(){
 const nodes=new Map();let focused=0;
 const byId=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',checked:false});return nodes.get(id);};
 const record={id:1,sessionId:'a',reason:'edit-queue-full',source:'queued + refused',queuedSource:'queued'};
 const state={confirmed:{source:'queued'},source:'queued',recoveryRecords:[record],pending:64};
 const c={state,controller:{discardRecovery(id){state.recoveryRecords=state.recoveryRecords.filter(r=>r.id!==id);return true;},state:()=>state}};
 const view=createInputPressureView({byId,context:()=>c,focus:()=>focused++});view.sync();
 return {byId,c,state,view,focused:()=>focused};
}
test('pressure acknowledgement is explicit, idle-bound and reset for another session',()=>{
 const {byId,state,view,focused}=pressureViewFixture();byId('input-pressure-ack').checked=true;view.sync();
 byId('input-pressure-resume').onclick();assert.equal(state.recoveryRecords.length,1);
 state.pending=0;state.code='memory-edited';view.sync();assert.equal(byId('input-pressure-panel').hidden,false);
 assert.equal(byId('input-pressure-resume').disabled,false);
 state.recoveryRecords[0]={...state.recoveryRecords[0],sessionId:'b'};view.sync();
 assert.equal(byId('input-pressure-ack').checked,false);assert.equal(byId('input-pressure-resume').disabled,true);
 byId('input-pressure-ack').checked=true;byId('input-pressure-resume').onclick();assert.equal(state.recoveryRecords.length,0);assert.equal(focused(),1);
});
test('pressure recovery remains readable without enabling resume for unconfirmed or invalid state',()=>{
 for(const change of [s=>s.code='sync-unknown',s=>s.composing=true,s=>s.historyPending=true,s=>s.source='unconfirmed']){
   const {byId,state,view}=pressureViewFixture();state.pending=0;byId('input-pressure-ack').checked=true;change(state);view.sync();
   byId('input-pressure-resume').onclick();assert.equal(state.recoveryRecords.length,1);
   assert.equal(byId('input-pressure-source').textContent,'queued + refused');
 }
 for(const key of ['loading','invalid']){
   const {byId,c,state,view}=pressureViewFixture();state.pending=0;byId('input-pressure-ack').checked=true;c[key]=true;view.sync();
   byId('input-pressure-resume').onclick();assert.equal(state.recoveryRecords.length,1);
 }
});
