import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
import { createEditController } from '../lib/document-edit-controller.mjs';
const require = createRequire(import.meta.url);
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');
const schema = getSchema([StarterKit.configure({ undoRedo: false, trailingNode: false })]);
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'document-interaction-')), file = path.join(root, 'a.md');
  fs.writeFileSync(file, '\ufeff---\r\nx: synthetic\r\n---\r\n# 标题😀\r\n\r\nPlain **粗体** tail.\r\n\r\n![x](../x.png)\r\n\r\n::: unknown\r\n');
  const disk = fs.readFileSync(file), service = createDocumentService(), document = service.open(file).document;
  const win = new EventEmitter(), wc = new EventEmitter(), frame = { url: 'file:///synthetic/demo.html' };
  Object.assign(wc, { isDestroyed: () => false, mainFrame: frame, getURL: () => frame.url });
  Object.assign(win, { isDestroyed: () => false, webContents: wc });
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit, windowFor: () => win });
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
      if (operation === 'edit' && h.dropReplyAfterCommit) throw Error('synthetic response loss after real main edit');
      if (operation === 'edit' && h.wrongAck) return { ...result, snapshot: { ...result.snapshot, source: '# WRONG ACK\n' } };
      if (operation === 'snapshot' && h.delaySnapshot) await new Promise(resolve => snapshotReplies.push(resolve));
      if (operation === 'edit' && h.delayed) await new Promise(resolve => replies.push(resolve));
      return result;
    },
    onReset: (source, selection) => {
      resets.push(source); const doc = schema.nodeFromJSON(projectSource(source).doc);
      state = EditorState.create({ schema, doc, ...(selection ? { selection: TextSelection.create(doc, selection.from, selection.to) } : {}) });
    },
  });
  Object.assign(h, { controller, state: () => state, span: text => projectSource(controller.state().source).spans.find(s => s.text === text),
    snapshotReplies,
    edit(from, to, insert) {
      const tr = state.tr.insertText(insert, from, to);
      if (!controller.prepare(tr)) return false;
      state = state.apply(tr); controller.accept(tr); return true;
    },
    select(from, to = from) { state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))); },
  });
  return h;
}

test('real PM transactions queue behind a pending IPC without acknowledgement caret resets', async () => {
  const h = harness(); h.delayed = true;
  let at = h.span('Plain ').from + 2;
  for (const insert of ['a', '中', '😀', 'b']) { assert.equal(h.edit(at, at, insert), true); at += insert.length; }
  h.select(at - 2, at); const selection = h.state().selection.toJSON();
  await tick(); assert.equal(h.controller.state().pending, 4); assert.equal(h.requests.length, 1);
  h.delayed = false; h.replies.shift()(); await h.controller.idle();
  assert.equal(h.document.text, h.controller.state().source);
  assert.equal(h.document.revision, 4); assert.equal(h.resets.length, 0);
  assert.deepEqual(h.state().selection.toJSON(), selection);
  assert.deepEqual(h.requests.map(r => r.expectedRevision), [0, 1, 2, 3]);
  assert.deepEqual(fs.readFileSync(h.file), h.disk);
});

test('composition preedit updates commit one source splice and one undo item', async () => {
  const h = harness(), original = h.document.text, from = h.span('Plain ').from + 2;
  assert.equal(h.controller.beginComposition(), true);
  assert.equal(h.edit(from, from, 'ni'), true);
  assert.equal(h.edit(from, from + 2, '你'), true);
  assert.equal(h.edit(from, from + 1, '你好😀'), true);
  await tick(); assert.equal(h.requests.length, 0); assert.equal(h.document.text, original);
  h.controller.endComposition(); await h.controller.idle();
  assert.equal(h.document.revision, 1); assert.equal(h.requests.filter(r => r.operation === 'edit').length, 1);
  const committed = h.requests.find(r => r.operation === 'edit');
  assert.deepEqual({ from: committed.from, to: committed.to, insert: committed.insert }, { from, to: from, insert: '你好😀' });
  assert.equal(h.document.text, original.replace('Plain ', 'Pl你好😀ain '));
  assert.equal(await h.controller.history('undo'), true);
  assert.equal(h.document.text, original); assert.equal(h.document.revision, 2);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.revision, 3);
  assert.equal(h.state().selection.from, from + '你好😀'.length);
});

test('cancelled composition is a no-op and multi-span composition is refused with a draft', async () => {
  const h = harness(), original = h.document.text, span = h.span('Plain ');
  h.controller.beginComposition(); h.edit(span.from + 1, span.from + 1, 'ni'); h.edit(span.from + 1, span.from + 3, '');
  h.controller.endComposition(); await h.controller.idle();
  assert.equal(h.document.text, original); assert.equal(h.document.revision, 0);
  h.controller.beginComposition(); h.edit(span.from + 1, span.from + 1, '文');
  const bold = h.span('粗体'); h.edit(bold.from + 1, bold.from + 1, '字');
  h.controller.endComposition(); await h.controller.idle();
  assert.equal(h.document.text, original); assert.equal(h.controller.state().source, original);
  assert.equal(h.controller.state().code, 'unsafe-composition');
  assert.ok(h.controller.state().recoveryDraft.includes('文'));
});

test('stale revision restores authoritative PM source and retains rejected optimistic draft', async () => {
  const h = harness(), span = h.span('Plain ');
  h.request('edit', { expectedRevision: 0, from: span.from, to: span.from + 1, insert: 'X' });
  h.edit(span.from + 2, span.from + 2, 'LOCAL'); await h.controller.idle();
  assert.equal(h.controller.state().code, 'stale-revision');
  assert.equal(h.controller.state().source, h.document.text);
  assert.equal(h.controller.state().confirmed.revision, 1);
  assert.ok(h.controller.state().recoveryDraft.includes('LOCAL'));
  assert.equal(h.state().doc.textContent.includes('LOCAL'), false);
  await h.controller.history('undo'); assert.equal(h.document.revision, 2);
  assert.equal(h.document.text.includes('LOCAL'), false);
});

test('unknown IPC outcome stays locked with a draft until explicit snapshot recovery', async () => {
  const h = harness(), span = h.span('Plain '); h.throwEdit = true; h.failSnapshot = true;
  h.edit(span.from + 1, span.from + 1, 'DRAFT'); await h.controller.idle();
  assert.equal(h.controller.state().locked, true); assert.ok(h.controller.state().recoveryDraft.includes('DRAFT'));
  assert.equal(h.edit(span.from + 1, span.from + 1, 'bad'), false);
  h.failSnapshot = false; await h.controller.reload();
  assert.equal(h.controller.state().locked, false); assert.equal(h.controller.state().source, h.document.text);
  assert.ok(h.controller.state().recoveryDraft.includes('DRAFT'));
});

test('unsafe structural edits and broken UTF-16 are rejected without history or source changes', async () => {
  const h = harness(), original = h.document.text, s = h.span('Plain ');
  assert.equal(h.edit(s.from + 1, s.from + 1, '\n'), false);
  assert.equal(h.edit(s.from + 1, s.from + 1, '\uD800'), false);
  assert.equal(h.edit(s.from, s.to, ''), false);
  await h.controller.idle(); assert.equal(h.document.text, original); assert.equal(h.document.revision, 0);
});

test('disposing a controller prevents late acknowledgements from touching a replacement view', async () => {
  const h = harness(); h.delayed = true; const s = h.span('Plain ');
  h.edit(s.from + 1, s.from + 1, 'old'); await tick(); h.controller.dispose();
  h.replies.shift()(); await tick(); assert.equal(h.resets.length, 0);
  assert.equal(h.controller.state().locked, true);
});

test('a malformed success acknowledgement is independently reconciled before editing resumes', async () => {
  const h = harness(); h.wrongAck = true; const s = h.span('Plain ');
  h.edit(s.from + 1, s.from + 1, 'REAL'); await h.controller.idle();
  assert.equal(h.document.revision, 1);
  assert.equal(h.controller.state().source, h.document.text);
  assert.equal(h.state().doc.textContent.includes('WRONG ACK'), false);
  assert.equal(h.controller.state().code, 'ack-mismatch');
});

test('a lost reply after actual main commit recovers the real revision and does not resend', async () => {
  const h = harness(); h.dropReplyAfterCommit = true; const s = h.span('Plain ');
  h.edit(s.from + 1, s.from + 1, 'ONCE'); await h.controller.idle();
  assert.equal(h.document.revision, 1); assert.equal(h.controller.state().confirmed.revision, 1);
  assert.equal(h.controller.state().source, h.document.text);
  assert.equal(h.requests.filter(r => r.operation === 'edit').length, 1);
  assert.equal(h.controller.state().code, 'ipc-failed');
});

test('a delayed metadata reply cannot roll back an already acknowledged revision', async () => {
  const h = harness(), stale = h.request('check'), s = h.span('Plain ');
  h.edit(s.from + 1, s.from + 1, 'NEW'); await h.controller.idle();
  h.controller.refresh(stale); await tick();
  assert.equal(h.controller.state().confirmed.revision, h.document.revision);
  assert.equal(h.controller.state().source, h.document.text);
});

test('explicit reload locks input until the authoritative snapshot is received', async () => {
  const h = harness(); h.delaySnapshot = true; const s = h.span('Plain ');
  const loading = h.controller.reload();
  assert.equal(h.edit(s.from + 1, s.from + 1, 'MUST REFUSE'), false);
  h.snapshotReplies.shift()(); await loading;
  assert.equal(h.document.revision, 0); assert.equal(h.controller.state().source, h.document.text);
});

test('composition replacement widens a shared surrogate prefix instead of splitting emoji', async () => {
  const h = harness(), heading = h.span('标题😀'), from = heading.to - 2;
  h.controller.beginComposition(); h.edit(from, heading.to, '😃'); h.controller.endComposition();
  await h.controller.idle(); assert.equal(h.document.text.includes('标题😃'), true);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text.includes('标题😀'), true);
});

test('composition behind an outstanding edit uses the acknowledged revision in order', async () => {
  const h = harness(); h.delayed = true; const s = h.span('Plain ');
  h.edit(s.from + 1, s.from + 1, 'A'); await tick();
  h.controller.beginComposition(); h.edit(s.from + 2, s.from + 2, 'ni');
  h.edit(s.from + 2, s.from + 4, '你'); h.controller.endComposition();
  h.delayed = false; h.replies.shift()(); await h.controller.idle();
  assert.equal(h.document.text.includes('PA你lain '), true); assert.equal(h.document.revision, 2);
  assert.deepEqual(h.requests.filter(r => r.operation === 'edit').map(r => r.expectedRevision), [0, 1]);
  assert.equal(h.resets.length, 0);
});

test('unknown transport failure during preedit retains the draft and refuses further commits', async () => {
  const h = harness(); h.throwEdit = true; h.failSnapshot = true; const s = h.span('Plain ');
  h.edit(s.from + 1, s.from + 1, 'A');
  h.controller.beginComposition(); h.edit(s.from + 2, s.from + 2, '未提交');
  await h.controller.idle(); h.controller.endComposition();
  assert.equal(h.controller.state().locked, true); assert.equal(h.document.revision, 0);
  assert.ok(h.controller.state().recoveryDraft.includes('未提交'));
  assert.equal(h.requests.filter(r => r.operation === 'edit').length, 1);
});

test('history requested during a keyboard burst drains the queue and undoes only its last item', async () => {
  const h = harness(); h.delayed = true; const s = h.span('Plain ');
  h.edit(s.from + 1, s.from + 1, 'A'); h.edit(s.from + 2, s.from + 2, 'B'); await tick();
  const undo = h.controller.history('undo');
  assert.equal(h.edit(s.from + 3, s.from + 3, 'REFUSED'), false);
  h.delayed = false; h.replies.shift()(); assert.equal(await undo, true);
  assert.equal(h.document.text.includes('PAlain '), true); assert.equal(h.document.revision, 3);
  assert.equal(h.controller.state().source, h.document.text);
});

test('the pending queue rejects its 65th edit without altering accepted source', async () => {
  const h = harness(); h.delayed = true; const from = h.span('Plain ').from + 1;
  for (let i = 0; i < 64; i++) assert.equal(h.edit(from + i, from + i, 'a'), true);
  const accepted = h.controller.state().source;
  assert.equal(h.edit(from + 64, from + 64, 'REJECT'), false);
  assert.equal(h.controller.state().code, 'edit-queue-full');
  h.delayed = false; await tick(); h.replies.shift()(); await h.controller.idle();
  assert.equal(h.document.text, accepted); assert.equal(h.document.revision, 64);
});

for (const count of [2, 3]) test(`P1-1: ${count} consecutive refusals retain every unresolved input`, async () => {
  const h = harness(), markers = ['FIRST-UNACCEPTED', 'SECOND-UNACCEPTED', 'THIRD-UNACCEPTED'].slice(0, count);
  for (const [i, marker] of markers.entries()) {
    const heading = projectSource(h.document.text).spans[0];
    h.request('edit', { expectedRevision: h.document.revision, from: heading.from, to: heading.from + 1, insert: String(i) });
    const s = h.span('Plain '); h.edit(s.from + 1, s.from + 1, marker); await h.controller.idle();
    assert.equal(h.controller.state().source, h.document.text);
  }
  for (const marker of markers) assert.ok(JSON.stringify(h.controller.state()).includes(marker), marker + ' must remain recoverable');
  assert.equal(h.controller.state().recoveryRecords.length, count);
  assert.equal(h.document.text.includes('UNACCEPTED'), false);
});

test('P1-1: recovery records stay session-scoped and require explicit discard', async () => {
  const a = harness(), b = harness();
  for (const [h, marker] of [[a, 'A-UNACCEPTED'], [b, 'B-UNACCEPTED']]) {
    const heading = projectSource(h.document.text).spans[0];
    h.request('edit', { expectedRevision: 0, from: heading.from, to: heading.from + 1, insert: 'X' });
    const s = h.span('Plain '); h.edit(s.from + 1, s.from + 1, marker); await h.controller.idle();
  }
  const records = a.controller.state().recoveryRecords;
  assert.equal(records.length, 1); assert.equal(records[0].sessionId, a.controller.state().confirmed.sessionId);
  assert.equal(JSON.stringify(records).includes('B-UNACCEPTED'), false);
  const revision = a.document.revision, text = a.document.text, requests = a.requests.length;
  assert.equal(a.controller.discardRecovery(records[0].id), true);
  assert.equal(a.controller.state().recoveryRecords.length, 0);
  assert.equal(a.document.revision, revision); assert.equal(a.document.text, text); assert.equal(a.requests.length, requests);
  assert.ok(JSON.stringify(b.controller.state()).includes('B-UNACCEPTED'));
  assert.equal(a.controller.discardRecovery(records[0].id), false);
  assert.throws(() => createEditController(a.request('snapshot').snapshot, {
    send: async () => {}, recoveryRecords: b.controller.state().recoveryRecords,
  }), /Invalid recovery record/);
});

test('P1-1: recovery capacity blocks later input rather than evicting old drafts', async () => {
  const h = harness();
  for (let i = 0; i < 16; i++) {
    const heading = projectSource(h.document.text).spans[0];
    h.request('edit', { expectedRevision: h.document.revision, from: heading.from, to: heading.from + 1, insert: String.fromCharCode(65 + i) });
    const s = h.span('Plain '); assert.equal(h.edit(s.from + 1, s.from + 1, `DRAFT-${i}-KEPT`), true);
    await h.controller.idle();
  }
  assert.equal(h.controller.state().recoveryRecords.length, 16); assert.equal(h.controller.state().locked, true);
  const s = h.span('Plain '); assert.equal(h.edit(s.from + 1, s.from + 1, 'OVERFLOW'), false);
  for (let i = 0; i < 16; i++) assert.ok(JSON.stringify(h.controller.state()).includes(`DRAFT-${i}-KEPT`));
  assert.equal(h.controller.discardRecovery(h.controller.state().recoveryRecords[0].id), true);
  assert.equal(h.controller.state().locked, false); assert.equal(h.document.text.includes('DRAFT'), false);
});


function invalidComposition(h, insert = '未确认😀') {
  const from = projectSource(h.controller.state().source).spans.find(s => !s.bold && s.text.includes('Plain ')).from + 1;
  assert.equal(h.controller.beginComposition(), true);
  if (insert) assert.equal(h.edit(from, from, insert), true);
  assert.equal(h.edit(from, from, '\n'), false);
  return from;
}

test('1B-3R invalid composition at pending=0 reports its real reason and stays blocked', async () => {
  const h = harness(), before = h.request('snapshot').snapshot, from = invalidComposition(h);
  assert.equal(h.edit(from, from, 'REFUSED'), false);
  assert.equal(h.controller.state().code, 'composition-invalid');
  assert.equal(h.controller.state().compositionInvalid, true);
  assert.equal(h.controller.state().pending, 0);
  assert.equal(h.controller.state().composing, true);
  assert.equal(await h.controller.reload(), false);
  assert.equal(await h.controller.history('undo'), false);
  assert.deepEqual(h.request('snapshot').snapshot, before);
  assert.equal(h.requests.length, 0);
});

test('1B-3R copies preserve local Markdown and partial DOM evidence without main IPC or composition reset', () => {
  const h = harness(), before = h.request('snapshot').snapshot;
  invalidComposition(h); const local = h.controller.state().source;
  const first = h.controller.retainCompositionCopy('DOM-only 未提交😀');
  assert.equal(first.ok, true);
  const second = h.controller.retainCompositionCopy('Later DOM-only 输入');
  assert.equal(second.ok, true); assert.notEqual(second.record.id, first.record.id);
  assert.equal(h.controller.retainCompositionCopy('Later DOM-only 输入').record.id, second.record.id);
  const records = h.controller.state().recoveryRecords;
  assert.equal(records.length, 2);
  assert.equal(records[0].source, local); assert.equal(records[0].visibleText, 'DOM-only 未提交😀');
  assert.equal(records[0].confirmedSource, before.source); assert.equal(records[0].baseRevision, before.revision);
  assert.equal(records[0].visibleTextIncomplete, true);
  first.record.source = 'cannot mutate retained input';
  assert.equal(h.controller.state().recoveryRecords[0].source, local);
  assert.equal(h.controller.state().composing, true); assert.equal(h.controller.state().source, local);
  assert.deepEqual(h.request('snapshot').snapshot, before); assert.equal(h.requests.length, 0);
  h.controller.endComposition();
  assert.equal(h.controller.state().composing, false);
  assert.equal(h.controller.state().source, before.source);
  assert.deepEqual(h.controller.state().recoveryRecords, records);
  assert.deepEqual(h.request('snapshot').snapshot, before);
});

test('1B-3R DOM-only evidence is retained even when local Markdown equals main; unavailable DOM is explicit', () => {
  const h = harness(); invalidComposition(h, '');
  const original = h.document.text;
  assert.equal(h.controller.state().source, original);
  assert.equal(h.controller.retainCompositionCopy('preedit only outside controller').ok, true);
  assert.equal(h.controller.retainCompositionCopy(null).ok, true);
  const records = h.controller.state().recoveryRecords;
  assert.equal(records.length, 2); assert.equal(records[0].source, original);
  assert.equal(records[1].visibleText, null); assert.equal(records[1].visibleTextIncomplete, true);
  h.controller.endComposition();
  assert.deepEqual(h.controller.state().recoveryRecords, records);
});

test('1B-3R normal composition and invalid copy requests are not recovery commands', async () => {
  const h = harness(), from = h.span('Plain ').from;
  h.controller.beginComposition(); h.edit(from, from, '正常');
  assert.equal(h.controller.retainCompositionCopy('not an anomaly').code, 'composition-copy-unavailable');
  h.controller.endComposition(); await h.controller.idle();
  assert.equal(h.document.revision, 1); assert.equal(h.controller.state().recoveryRecords.length, 0);
  invalidComposition(h);
  assert.equal(h.controller.retainCompositionCopy({ text: 'bad' }).code, 'invalid-copy-input');
  assert.equal(h.controller.retainCompositionCopy('x'.repeat(131073)).code, 'copy-too-large');
  assert.equal(h.controller.state().recoveryRecords.length, 0);
  h.controller.dispose();
  assert.equal(h.controller.retainCompositionCopy('late').code, 'controller-disposed');
});

test('1B-3R capacity refuses new copies without eviction, truncation, unlock or silent end', () => {
  const h = harness(); invalidComposition(h);
  for (let i = 0; i < 16; i++) assert.equal(h.controller.retainCompositionCopy(`COPY-${i}`).ok, true);
  const records = h.controller.state().recoveryRecords;
  assert.equal(h.controller.retainCompositionCopy('COPY-15').ok, true);
  assert.equal(h.controller.retainCompositionCopy('OVERFLOW').code, 'recovery-capacity');
  assert.deepEqual(h.controller.state().recoveryRecords, records);
  assert.equal(h.controller.state().locked, true); assert.equal(h.controller.state().composing, true);
  assert.equal(h.controller.state().recoveryCopyCapacity, true);
});

test('1B-3R copies survive controller reinstall in the same session and cannot cross sessions', () => {
  const a = harness(), b = harness(); invalidComposition(a); invalidComposition(b);
  a.controller.retainCompositionCopy('A-DOM'); b.controller.retainCompositionCopy('B-DOM');
  const records = a.controller.state().recoveryRecords;
  const next = createEditController(a.request('snapshot').snapshot, { send: async () => {}, recoveryRecords: records });
  assert.deepEqual(next.state().recoveryRecords, records);
  assert.throws(() => createEditController(b.request('snapshot').snapshot, {
    send: async () => {}, recoveryRecords: records,
  }), /Invalid recovery record/);
  assert.equal(b.controller.state().recoveryRecords[0].visibleText, 'B-DOM');
  assert.equal(a.requests.length + b.requests.length, 0);
});
