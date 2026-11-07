import { applyBlockShortcut, applyStructuredKey } from '../lib/document-block-input.mjs';
import { mapFormatEdit } from '../lib/document-format-edit.mjs';
import test from 'node:test';
import { syncNativeBackspaceSelection, syncNativeListSelection } from '../lib/document-native-selection.mjs';
import { pastePlainText } from '../lib/document-plain-paste.mjs';
import { replaceParagraphRangeInput } from '../lib/document-paragraph-input.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { getSchema } from '@tiptap/core';
import { documentEditorExtensions } from '../lib/document-editor-extensions.mjs';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { splitBlock, joinBackward } from '@tiptap/pm/commands';
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
      if (['edit','format'].includes(operation) && h.wrongAck) return { ...result, snapshot: { ...result.snapshot, source: '# WRONG ACK\n' } };
      if (operation === 'snapshot' && h.delaySnapshot) await new Promise(resolve => snapshotReplies.push(resolve));
      if (['edit','format'].includes(operation) && h.delayed) await new Promise(resolve => replies.push(resolve));
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
  assert.equal(h.edit(h.span('标题😀').from, s.to, ''), false);
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
  assert.equal(h.controller.retainCompositionCopy('x'.repeat(524289)).code, 'copy-too-large');
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


function paragraphCommand(h, command, at) {
  h.select(at); let accepted = false;
  command(h.state(), tr => {
    if (h.controller.prepare(tr)) { h.apply(tr); accepted = true; }
  });
  return accepted;
}

for (const nl of ['\n', '\r\n']) test(`writing V1: end Enter, empty input and exact history (${JSON.stringify(nl)})`, async () => {
  const input = '\ufeff---'+nl+'x: synthetic'+nl+'---'+nl+'# Heading'+nl+nl+'First 中文😀'+nl+nl+'::: unknown'+nl;
  const h = harness(input), original = h.document.text;
  const span = h.span('First 中文😀');
  assert.equal(paragraphCommand(h, splitBlock, span.to), true);
  await h.controller.idle();
  assert.equal(h.document.revision, 1);
  const blank = h.document.text; assert.equal(blank, original.replace('First 中文😀', 'First 中文😀'+nl+nl));
  const empty = projectSource(blank).spans.find(s => s.text === ''); assert.ok(empty);
  assert.equal(h.state().selection.from, empty.from);
  assert.equal(h.edit(empty.from, empty.from, 'Next English 中文😀'), true); await h.controller.idle();
  const written = h.document.text;
  assert.equal(written, original.replace('First 中文😀', 'First 中文😀'+nl+nl+'Next English 中文😀'));
  assert.equal(h.state().selection.from, empty.from+'Next English 中文😀'.length);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, blank);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, original);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, blank);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, written);
  assert.deepEqual(fs.readFileSync(h.file), h.disk);
  assert.equal(h.request('save', { expectedRevision: h.document.revision }).code, 'coordination-required');
});

test('writing V1: real PM middle split and Backspace preserve spaces and are reversible', async () => {
  const h = harness('first second😀\n'), original = h.document.text, from = h.span('first second😀').from+6;
  assert.equal(paragraphCommand(h, splitBlock, from), true); await h.controller.idle();
  assert.equal(h.document.text, 'first \n\nsecond😀\n');
  assert.equal(h.state().doc.child(0).textContent, 'first ');
  const second = projectSource(h.document.text).spans.find(s => s.text === 'second😀');
  assert.equal(paragraphCommand(h, joinBackward, second.from), true); await h.controller.idle();
  assert.equal(h.document.text, original);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, 'first \n\nsecond😀\n');
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, original);
});

test('writing V1: empty end paragraph accepts composition as one main revision and backspace removes it', async () => {
  const h = harness('first\n');
  assert.equal(paragraphCommand(h, splitBlock, h.span('first').to), true); await h.controller.idle();
  const blank = h.document.text, empty = projectSource(blank).spans.find(s => !s.text);
  h.controller.beginComposition(); assert.equal(h.edit(empty.from, empty.from, 'ni'), true);
  assert.equal(h.edit(empty.from, empty.from+2, '你好😀'), true);
  assert.equal(h.document.revision, 1); h.controller.endComposition(); await h.controller.idle();
  assert.equal(h.document.revision, 2); assert.equal(h.document.text, 'first\n\n你好😀\n');
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, blank);
  assert.equal(paragraphCommand(h, joinBackward, empty.from), true); await h.controller.idle();
  assert.equal(h.document.text, 'first\n');
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, blank);
});

test('writing V1: empty document, plain last-character deletion and empty refill are editable', async () => {
  for (const source of ['', 'X\n']) {
    const h = harness(source), span = projectSource(h.document.text).spans[0]; assert.ok(span);
    if (span.text) { assert.equal(h.edit(span.from, span.to, ''), true); await h.controller.idle(); }
    const empty = projectSource(h.document.text).spans[0];
    assert.equal(h.edit(empty.from, empty.from, '中文😀'), true); await h.controller.idle();
    assert.equal(h.document.text, '中文😀'+(source.endsWith('\n')?'\n':''));
    assert.equal(await h.controller.history('undo'), true);
  }
});

test('writing V1: no second consecutive empty, heading/marked split or broken Unicode; sessions isolated', async () => {
  const h = harness('first😀\n'), b = harness('second\n');
  assert.equal(paragraphCommand(h, splitBlock, h.span('first😀').to-1), false);
  assert.equal(paragraphCommand(h, splitBlock, h.span('first😀').to), true); await h.controller.idle();
  const blank = h.document.text, empty = projectSource(blank).spans.find(s=>!s.text);
  assert.equal(paragraphCommand(h, splitBlock, empty.from), false);
  assert.equal(h.document.text, blank); assert.equal(b.document.revision, 0);
  assert.equal(await b.controller.history('undo'), false);
  const complex = harness('# Heading\n\nA **bold** end.\n');
  assert.equal(paragraphCommand(complex, splitBlock, complex.span('Heading').to), false);
  assert.equal(paragraphCommand(complex, splitBlock, complex.span('bold').from+1), false);
});


test('writing V1: Enter and following input queue behind IPC without resetting the caret', async () => {
  const h=harness('first\r\n'); h.delayed=true;
  assert.equal(paragraphCommand(h,splitBlock,h.span('first').to),true);
  const empty=projectSource(h.controller.state().source).spans.find(s=>!s.text);
  assert.equal(h.edit(empty.from,empty.from,'中文😀'),true);
  const selection=h.state().selection.toJSON(); await tick();
  assert.equal(h.controller.state().pending,2); h.delayed=false; h.replies.shift()(); await h.controller.idle();
  assert.equal(h.document.text,'first\r\n\r\n中文😀\r\n'); assert.equal(h.document.revision,2);
  assert.deepEqual(h.requests.filter(r=>r.operation==='edit').map(r=>r.expectedRevision),[0,1]);
  assert.deepEqual(h.state().selection.toJSON(),selection); assert.equal(h.resets.length,0);
});

test('writing V1: directly injected structure during composition still fails closed and retains accepted preedit', () => {
  const h=harness('first\n'),from=h.span('first').to;
  h.controller.beginComposition(); assert.equal(h.edit(from,from,'未确认'),true);
  assert.equal(paragraphCommand(h,splitBlock,from+3),false);
  assert.equal(h.controller.state().compositionInvalid,true); h.controller.endComposition();
  assert.ok(h.controller.state().recoveryDraft.includes('未确认'));
  assert.equal(h.document.text,'first\n');assert.equal(h.document.revision,0);
});


for (const nl of ['\r\n', '\n']) test(`CRLF P1: true joinBackward without final newline and exact undo/redo (${JSON.stringify(nl)})`, async () => {
  const original='first'+nl+nl+'second',h=harness(original),second=h.span('second');
  assert.equal(h.document.text,original); assert.equal(h.document.text.endsWith('\n'),false);
  assert.equal(h.request('edit',{expectedRevision:0,from:h.span('first').to,to:second.from,insert:'',paragraphSeparator:nl+nl}).code,'invalid-request');
  assert.equal(paragraphCommand(h,joinBackward,second.from),true);
  await h.controller.idle(); assert.equal(h.document.text,'firstsecond');
  assert.equal(h.document.revision,1);assert.equal(h.state().selection.from,6);
  const joined=h.request('snapshot').snapshot;
  assert.equal(h.request('undo',{expectedRevision:0}).code,'stale-revision');
  assert.deepEqual(h.request('snapshot').snapshot,joined);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,original);
  assert.equal(h.document.revision,2);assert.equal(h.state().selection.from,second.from);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,'firstsecond');
  assert.equal(h.document.revision,3);assert.equal(h.state().selection.from,6);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('CRLF P1: a corrupted internal separator cannot bypass the history source hash or consume undo', async () => {
  let corrupt=false;
  const mapper=(source,change,leaf,separator)=>mapTextEdit(source,change,leaf,corrupt?'\n\n':separator);
  const h=harness('first\r\n\r\nsecond',mapper),second=h.span('second');
  assert.equal(paragraphCommand(h,joinBackward,second.from),true);await h.controller.idle();
  corrupt=true;
  const before=h.request('snapshot').snapshot;
  assert.equal(h.request('undo',{expectedRevision:before.revision}).code,'history-diverged');
  assert.deepEqual(h.request('snapshot').snapshot,before);
  corrupt=false;
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,'first\r\n\r\nsecond');
});


for (const nl of ['\n','\r\n']) test(`soft paragraph V1: real PM edits and service history preserve ${JSON.stringify(nl)}`, async () => {
  const raw = '\ufeff---'+nl+'kind: synthetic'+nl+'---'+nl+nl+'First 中文😀'+nl+'second line.'+nl+nl+'Last.';
  const h = harness(raw), initial = h.document.text, untouched = harness('Other session.');
  assert.equal(h.state().doc.child(1).type.name, 'paragraph');
  for (const [text, insert] of [['First 中文😀','中😀'],['second line.','NEXT']]) {
    const s=h.span(text); assert.ok(s);
    h.select(s.from+1,s.from+2); assert.equal(h.edit(s.from+1,s.from+2,insert),true); await h.controller.idle();
    assert.equal(h.state().selection.from,s.from+1+insert.length);
  }
  const edited=h.document.text, before=h.request('snapshot').snapshot;
  assert.equal(edited,initial.replace('First','F中😀rst').replace('second','sNEXTcond'));
  assert.equal(h.request('edit',{expectedRevision:0,from:1,to:1,insert:'stale'}).code,'stale-revision');
  assert.deepEqual(h.request('snapshot').snapshot,before);
  assert.equal(await h.controller.history('undo'),true);assert.equal(await h.controller.history('undo'),true);
  assert.equal(h.document.text,initial); assert.equal(await h.controller.history('redo'),true);assert.equal(await h.controller.history('redo'),true);
  assert.equal(h.document.text,edited); assert.deepEqual(h.document.bytesForSave(),Buffer.from('\ufeff'+edited));
  assert.equal(untouched.document.text,'Other session.');assert.equal(untouched.request('snapshot').snapshot.canUndo,false);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('soft paragraph V1: controlled composition and queued typing preserve one source range', async () => {
  const h=harness('First\r\nsecond.'); assert.ok(h.span('second.'));
  const s=h.span('second.'); assert.equal(h.controller.beginComposition(),true);
  assert.equal(h.edit(s.from,s.from+1,'zhong'),true);assert.equal(h.edit(s.from,s.from+5,'中😀'),true);
  h.controller.endComposition();await h.controller.idle();assert.equal(h.document.text,'First\r\n中😀econd.');
  assert.equal(h.document.revision,1);assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,'First\r\nsecond.');
  h.delayed=true;let at=h.span('second.').from+1;
  for(const text of ['A','B','中']) {assert.equal(h.edit(at,at,text),true);at+=text.length;}
  await tick();h.delayed=false;h.replies.shift()();await h.controller.idle();
  assert.equal(h.document.text,'First\r\nsAB中econd.');assert.equal(h.controller.state().pending,0);
});
test('soft paragraph V1: rejected break edits do not lock or contaminate history', async () => {
  const h=harness('First\nsecond.\n\nLast.'),a=h.span('First'),b=h.span('second.');assert.ok(a&&b);
  const before=h.request('snapshot').snapshot;
  assert.equal(h.edit(a.to,b.from,''),false);assert.equal(h.controller.state().code,'unsafe-source-range');
  h.select(a.from+1);let split;
  assert.equal(splitBlock(h.state(),tr=>{split=tr;}),true);assert.equal(h.controller.prepare(split),false);
  assert.deepEqual(h.request('snapshot').snapshot,before);assert.equal(h.controller.state().locked,false);
  assert.equal(h.edit(b.from,b.from+1,'S'),true);await h.controller.idle();
  assert.equal(h.document.text,'First\nSecond.\n\nLast.');assert.equal(await h.controller.history('undo'),true);
  assert.equal(h.document.text,'First\nsecond.\n\nLast.');assert.equal(h.request('snapshot').snapshot.canUndo,false);
  h.select(h.span('Last.').from+2);let accepted=false;
  splitBlock(h.state(),tr=>{accepted=h.controller.prepare(tr);if(accepted)h.apply(tr);});await h.controller.idle();
  assert.equal(accepted,true);assert.equal(h.document.text,'First\nsecond.\n\nLa\n\nst.');
});


function paste(h, text, options = {}) {
  const messages = [], formats = []; let prevented = false;
  const view = { get state() { return h.state(); }, editable: options.editable !== false, composing: !!options.composing,
    dispatch(tr) { if (h.controller.prepare(tr)) h.apply(tr); } };
  const event = { preventDefault() { prevented = true; }, clipboardData: options.data || {
    types: ['text/plain', 'text/html'], files: [], getData(type) { formats.push(type); return type === 'text/plain' ? text : '<img onerror="BAD">'; },
  } };
  const result = pastePlainText(view, event, { state: options.state || h.controller.state(), blocked: !!options.blocked,
    report: message => messages.push(message) });
  assert.equal(result, true); assert.equal(prevented, true);
  return { messages, formats };
}
test('plain paste: one source splice and one reversible history item; HTML is never read', async () => {
  const h = harness('\ufeff---\r\nx: keep\r\n---\r\n\r\nFirst line\r\nsecond line\r\n\r\nPlain **粗体** tail.');
  const before = h.document.text, at = h.span('First line').from + 1;
  h.select(at, at + 4); const result = paste(h, '中文😀');
  await h.controller.idle(); assert.deepEqual(result.formats, ['text/plain']); assert.deepEqual(result.messages, []);
  assert.equal(h.document.text, before.replace('irst', '中文😀'));
  assert.equal(h.requests.filter(r => r.operation === 'edit').length, 1);
  assert.equal(h.state().selection.from, at + '中文😀'.length);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, before);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, before.replace('irst', '中文😀'));
  assert.deepEqual(fs.readFileSync(h.file), h.disk);
});
test('plain paste: empty paragraph and bold leaf preserve projection, selection and other sessions', async () => {
  const empty = harness(''), other = harness('Independent.'); empty.select(1);
  paste(empty, '你好 English 😀'); await empty.controller.idle();
  assert.equal(empty.document.text, '你好 English 😀'); assert.equal(other.document.text, 'Independent.');
  const bold = harness('A **粗体** end.'); bold.select(bold.span('粗体').from, bold.span('粗体').to);
  paste(bold, '中文😀'); await bold.controller.idle(); assert.equal(bold.document.text, 'A **中文😀** end.');
  assert.equal(await bold.controller.history('undo'), true); assert.equal(bold.document.text, 'A **粗体** end.');
});
test('plain paste: multiline, control, oversized, unsafe syntax and source crossing are atomic refusals', async () => {
  const h = harness('First line\r\nsecond line\r\n\r\nTail.');
  h.select(h.span('First line').from + 2); const before = h.controller.state(), selection = h.state().selection.toJSON();
  for (const value of ['a\n\n\nb', '\na', 'a\n', 'a\tb', 'a\u0000b', 'a\u2028b', 'a'.repeat(4097), '[x](https://example.invalid)', '<script>x</script>', '\ud800']) {
    assert.equal(paste(h, value).messages.length, 1);
    assert.equal(h.document.text, before.source); assert.equal(h.document.revision, before.confirmed.revision);
    assert.deepEqual(h.state().selection.toJSON(), selection);
    assert.equal(h.controller.state().pending, 0); assert.equal(h.controller.state().recoveryRecords.length, 0);
  }
  h.select(h.span('First line').to - 1, h.span('second line').from + 1);
  assert.equal(paste(h, 'safe').messages.length, 1); assert.equal(h.document.text, before.source);
  assert.equal(h.requests.length, 0);
});
test('plain paste: composition, readonly, pending and unknown state cannot be bypassed', async () => {
  const h = harness('First.'); h.select(2); const original = h.document.text;
  h.controller.beginComposition(); assert.equal(paste(h, 'NO').messages.length, 1);
  assert.equal(h.controller.state().composing, true); h.controller.endComposition();
  for (const options of [{ composing: true }, { editable: false }, { blocked: true },
    { state: { ...h.controller.state(), locked: true } }, { state: { ...h.controller.state(), historyPending: true } },
    { state: { ...h.controller.state(), confirmed: { ...h.controller.state().confirmed, readOnly: true } } }]) {
    assert.equal(paste(h, 'NO', options).messages.length, 1);
  }
  assert.equal(h.document.text, original); assert.equal(h.requests.length, 0);
  h.delayed = true; h.edit(2, 2, 'X'); const pending = h.controller.state().source;
  assert.equal(paste(h, 'NO').messages.length, 1); assert.equal(h.controller.state().source, pending);
  h.delayed = false; h.replies.shift()(); await h.controller.idle();
  h.select(3); paste(h, 'OK'); await h.controller.idle(); assert.equal(h.document.text, 'FXOKirst.');
});
test('plain paste: empty or unreadable clipboard never erases selected text', () => {
  const h = harness('First.'); h.select(1, 6); const before = h.document.text;
  paste(h, '');
  for (const data of [{ types: ['text/html'], files: [] }, { types: ['text/plain'], files: [1] },
    { types: ['text/plain'], getData() { throw Error('clipboard unavailable'); } }]) {
    assert.equal(paste(h, 'NO', { data }).messages.length, 1);
  }
  assert.equal(h.document.text, before); assert.equal(h.requests.length, 0);
});


test('multiline paste V1: plain clipboard lines become paragraphs in one IPC and Undo/Redo item', async () => {
  const h = harness('\ufeff---\r\nx: keep\r\n---\r\n\r\nBefore OLD after.\r\n\r\nTail.'), before = h.document.text;
  const at = h.span('Before OLD after.').from + 7; h.select(at, at + 3);
  const result = paste(h, '第一😀\r\n\r\nSecond\n第三'); await h.controller.idle();
  assert.deepEqual(result.messages, []); assert.deepEqual(result.formats, ['text/plain']);
  const expected = before.replace('OLD', '第一😀\r\n\r\nSecond\r\n\r\n第三');
  assert.equal(h.document.text, expected); assert.equal(h.requests.filter(r => r.operation === 'edit').length, 1);
  assert.equal(h.state().selection.from, at + '第一😀\n\nSecond\n\n第三'.length);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, before);
  assert.equal(h.document.revision, 2); assert.equal(await h.controller.history('redo'), true);
  assert.equal(h.document.text, expected); assert.deepEqual(fs.readFileSync(h.file), h.disk);
});
test('multiline paste V1: empty document, later typing, paragraph joining and history stay coherent', async () => {
  const h = harness(''), other = harness('Other.'); h.select(1);
  assert.deepEqual(paste(h, 'One\nTwo😀').messages, []); await h.controller.idle();
  const beforeJoin = h.document.text; assert.equal(beforeJoin, 'One\n\nTwo😀');
  h.select(h.span('Two😀').from); let accepted;
  joinBackward(h.state(), tr => { accepted = h.controller.prepare(tr); if (accepted) h.apply(tr); });
  await h.controller.idle(); assert.equal(accepted, true); assert.equal(h.document.text, 'OneTwo😀');
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, beforeJoin);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, '');
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, beforeJoin);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, 'OneTwo😀');
  h.select(h.span('OneTwo😀').to); assert.equal(h.edit(h.state().selection.from, h.state().selection.to, '!'), true);
  await h.controller.idle(); assert.equal(h.document.text, 'OneTwo😀!'); assert.equal(other.document.text, 'Other.');
});
test('multiline paste V1: stale revision and lost response retain complete recovery text', async () => {
  for (const failure of ['stale', 'lost']) {
    const h = harness('Original.'); h.select(2);
    if (failure === 'stale') h.document.edit({ from: 0, to: 0, insert: 'External ', expectedRevision: 0 });
    else h.dropReplyAfterCommit = true;
    paste(h, '一\n二😀'); await h.controller.idle();
    const state = h.controller.state(); assert.equal(state.recoveryRecords.length, 1);
    assert.equal(state.recoveryRecords[0].source, 'O一\n\n二😀riginal.');
    assert.equal(state.source, h.document.text); assert.deepEqual(fs.readFileSync(h.file), h.disk);
    assert.equal(state.recoveryRecords[0].mainMatchesDraft, failure === 'lost');
  }
});
test('multiline paste V1: ambiguous lines, unsafe syntax and busy composition never partially apply', async () => {
  const h = harness('Before.'), before = h.document.text; h.select(2, 4);
  for (const text of ['a\n\n\nb', '\na', 'a\n', 'a\n \nb', 'a\n# Heading', 'a\n- list', 'a\n<script>', 'a\n\ud800', Array(34).fill('a').join('\n')]) {
    assert.equal(paste(h, text).messages.length, 1, JSON.stringify(text));
    assert.equal(h.document.text, before); assert.equal(h.requests.length, 0);
  }
  h.controller.beginComposition(); assert.equal(paste(h, 'a\nb').messages.length, 1);
  assert.equal(h.controller.state().composing, true); h.controller.endComposition();
  assert.equal(h.document.text, before);
  assert.equal(paste(h, 'a\nb', { state: { ...h.controller.state(), locked: true } }).messages.length, 1);
});


test('multiline paste V1: renderer cannot supply trusted cross-paragraph history metadata', async () => {
  const h = harness('First.'); h.select(2); paste(h, 'One\nTwo'); await h.controller.idle();
  const before = h.request('snapshot').snapshot, spans = projectSource(before.source).spans;
  const change = { from: spans[0].from + 1, to: spans[1].from + 3, insert: '' };
  for (const extra of [{ paragraphSeparator: '\n\n' }, { leaf: null }]) {
    const result = h.request('edit', { expectedRevision: before.revision, ...change, ...extra });
    assert.equal(result.ok, false); assert.deepEqual(h.request('snapshot').snapshot, before);
  }
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, 'First.');
});

// Simulate the observed browser-caret/PM-selection acknowledgement gap, while
// retaining real PM documents, transactions, source mapping and main history.
function nativeCaret(h, text) {
  const span = h.span(text); h.select(span.to);
  const paragraph = { textContent: text }, node = { nodeType: 3, parentElement: { closest: () => paragraph } };
  const selection = { rangeCount: 1, isCollapsed: true, anchorNode: node, anchorOffset: 0, focusNode: node, focusOffset: 0 };
  const view = { get state() { return h.state(); }, editable: true, composing: false, hasFocus: () => true,
    dom: { contains: n => n === node, ownerDocument: { getSelection: () => selection } },
    posAtDOM: (_node, offset) => span.from + offset, nodeDOM: () => paragraph, dispatch: tr => h.apply(tr) };
  return { view, selection, paragraph, node };
}
test('native caret: Backspace observes acknowledged browser paragraph start before joining', async () => {
  const h = harness('---\r\nx: keep\r\n---\r\n\r\nFirst.\r\n\r\nSecond.\r\n\r\n```js\r\nkeep()\r\n```');
  const original = h.document.text, c = nativeCaret(h, 'Second.'), revision = h.document.revision;
  assert.equal(syncNativeBackspaceSelection(c.view, { key: 'Backspace' }, { state: h.controller.state() }), true);
  assert.equal(h.state().selection.from, h.span('Second.').from);
  assert.equal(h.document.text, original); assert.equal(h.document.revision, revision); assert.equal(h.requests.length, 0);
  let accepted; joinBackward(h.state(), tr => { accepted = h.controller.prepare(tr); if (accepted) h.apply(tr); });
  await h.controller.idle(); assert.equal(accepted, true);
  assert.equal(h.document.text, original.replace('First.\r\n\r\nSecond.', 'First.Second.'));
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, original);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text.includes('First.Second.'), true);
  assert.deepEqual(fs.readFileSync(h.file), h.disk);
});
test('native caret: composition, pending, readonly and lifecycle guards leave selection untouched', () => {
  const h = harness('First.\n\nSecond.'), c = nativeCaret(h, 'Second.'), original = h.state().selection.toJSON();
  const state = h.controller.state();
  for (const options of [{ blocked: true, state }, { state: { ...state, composing: true } },
    { state: { ...state, compositionInvalid: true } }, { state: { ...state, pending: 1 } },
    { state: { ...state, locked: true } }, { state: { ...state, historyPending: true } },
    { state: { ...state, source: 'unconfirmed' } }, { state: { ...state, confirmed: { ...state.confirmed, readOnly: true } } }]) {
    assert.equal(syncNativeBackspaceSelection(c.view, { key: 'Backspace' }, options), false);
    assert.deepEqual(h.state().selection.toJSON(), original);
  }
  for (const event of [{ key: 'Enter' }, { key: 'Backspace', isComposing: true }, { key: 'Backspace', keyCode: 229 },
    { key: 'Backspace', metaKey: true }, { key: 'Backspace', altKey: true }, { key: 'Backspace', ctrlKey: true }]) {
    assert.equal(syncNativeBackspaceSelection(c.view, event, { state }), false);
  }
  c.view.composing = true; assert.equal(syncNativeBackspaceSelection(c.view, { key: 'Backspace' }, { state }), false);
  assert.equal(h.requests.length, 0);
});
test('native caret: outside, noncollapsed, changed DOM and unrelated block cannot redirect an edit', () => {
  const h = harness('First.\n\nSecond.'), state = h.controller.state();
  for (const alter of [c => { c.selection.anchorNode = {}; }, c => { c.selection.isCollapsed = false; },
    c => { c.selection.anchorOffset = 2; c.selection.focusOffset = 2; }, c => { c.paragraph.textContent = 'unconfirmed preedit'; },
    c => { c.view.hasFocus = () => false; }, c => { c.view.editable = false; },
    c => { c.view.posAtDOM = () => h.span('First.').from; }, c => { c.view.nodeDOM = () => ({}); }]) {
    const c = nativeCaret(h, 'Second.'); alter(c); const before = h.state().selection.toJSON();
    assert.equal(syncNativeBackspaceSelection(c.view, { key: 'Backspace' }, { state }), false);
    assert.deepEqual(h.state().selection.toJSON(), before);
  }
  assert.equal(h.requests.length, 0);
});


test('literal brackets: PM input and IPC history remain editable without changing original bytes', async () => {
  const h = harness('\ufeffFirst 中文😀.\r\n\r\nSecond.');
  const original = h.document.text;
  for (const insert of ['[', ' ', ']']) {
    const at = h.span(h.state().doc.firstChild.textContent).to;
    assert.equal(h.edit(at, at, insert), true, insert); await h.controller.idle();
  }
  const expected = original.replace('First 中文😀.', 'First 中文😀.[ ]');
  assert.equal(h.document.text, expected);
  const second = h.span('Second.'); assert.equal(h.edit(second.to, second.to, ' next'), true); await h.controller.idle();
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, expected);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, expected.replace('[ ]', '[ '));
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, expected);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, expected + ' next');
  assert.deepEqual(fs.readFileSync(h.file), h.disk);
});

test('format commands use main-owned history, exact bytes and the same sender/revision fence', async()=>{
  const h=harness('\ufeff---\r\nx: keep\r\n---\r\n\r\nPlain 中文😀.\r\n\r\n```\r\nopaque\r\n```\r\n');
  const original=h.document.text;
  const apply=async(action,text,offset=0,end=offset)=>{const s=h.span(text);assert.ok(s);return h.controller.format({action,from:s.from+offset,to:s.from+end});};
  assert.equal(await apply('heading-2','Plain 中文😀.'),true);assert.equal(h.document.text,original.replace('Plain','## Plain'));
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,original);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,original.replace('Plain','## Plain'));
  assert.equal(await apply('paragraph','Plain 中文😀.'),true);
  assert.equal(await apply('bold','Plain 中文😀.',6,10),true);
  assert.equal(await apply('bullet-list','Plain '),true);
  let span=h.span('中文😀');assert.equal(h.edit(span.from,span.to,'新字'),true);await h.controller.idle();
  assert.ok(h.document.text.includes('- Plain **新字**.'));
  assert.equal(await h.controller.history('undo'),true);assert.ok(h.document.text.includes('- Plain **中文😀**.'));
  assert.equal(await h.controller.history('undo'),true);assert.ok(h.document.text.includes('Plain **中文😀**.'));
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,original);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
  assert.equal(h.request('save',{expectedRevision:h.document.revision}).status,'unchanged');
  assert.equal(await h.controller.history('redo'),true);
  assert.equal(h.request('save',{expectedRevision:h.document.revision}).code,'coordination-required');
  const before=h.document.text,revision=h.document.revision;
  for(const payload of [{action:'heading-1',from:1,to:1,expectedRevision:revision-1},{action:'heading-1',from:1,to:1,expectedRevision:revision,source:'arbitrary'},{action:'heading-1',from:1,to:1,expectedRevision:revision,path:'/tmp/x'}])assert.equal(h.request('format',payload).ok,false);
  assert.equal(h.document.text,before);assert.equal(h.document.revision,revision);
});
test('format command during composition is refused without retiring the native input context',async()=>{
  const h=harness('First.\n\nSecond.');h.controller.beginComposition();
  assert.equal(await h.controller.format({action:'heading-1',from:1,to:1}),false);
  assert.equal(h.controller.state().composing,true);assert.equal(h.requests.length,0);assert.equal(h.document.text,'First.\n\nSecond.');
  h.controller.endComposition();assert.equal(await h.controller.format({action:'heading-1',from:1,to:1}),true);
});
test('lost formatting acknowledgement reconciles without replay or false success',async()=>{
  const h=harness('Keep.');h.dropReplyAfterCommit=true;
  assert.equal(await h.controller.format({action:'heading-1',from:1,to:1}),false);
  assert.equal(h.requests.filter(r=>r.operation==='format').length,1);
  assert.equal(h.document.text,'# Keep.');assert.equal(h.controller.state().source,'# Keep.');
  assert.equal(h.controller.state().code,'ipc-failed');assert.equal(h.controller.state().historyPending,false);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('list item typing and IME group remain editable and exactly undoable',async()=>{
  const h=harness('- First.\r\n- 中文😀\r\n'),original=h.document.text;
  const span=h.span('中文😀');h.controller.beginComposition();
  assert.equal(h.edit(span.from,span.to,'组合'),true);h.controller.endComposition();await h.controller.idle();
  assert.equal(h.document.text,'- First.\r\n- 组合\r\n');assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,original);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,'- First.\r\n- 组合\r\n');
});


for (const insert of ['中文😀', '', '一\n二😀']) test(`paragraph range: real PM replacement, history and continuous writing ${JSON.stringify(insert)}`, async () => {
  const h = harness('\ufeff---\r\nx: keep\r\n---\r\n\r\nFirst.\r\n\r\nMiddle.\r\n\r\nLast.\r\n\r\n```md\r\nkeep()\r\n```\r\n');
  const before = h.document.text, other = harness('Independent.');
  const from = h.span('First.').from + 1, to = h.span('Last.').from + 1;
  h.select(from, to);
  if (insert.includes('\n')) assert.deepEqual(paste(h, insert).messages, []);
  else assert.equal(h.edit(from, to, insert), true);
  await h.controller.idle();
  const expected = before.replace('irst.\r\n\r\nMiddle.\r\n\r\nL', insert.replaceAll('\n', '\r\n\r\n'));
  assert.equal(h.document.text, expected); assert.equal(h.requests.filter(r => r.operation === 'edit').length, 1);
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, before);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, expected);
  let at = h.state().selection.from; assert.equal(h.edit(at, at, ' next'), true); await h.controller.idle();
  const typed = h.document.text;
  at = h.state().selection.from; paragraphCommand(h, splitBlock, at); await h.controller.idle();
  assert.notEqual(h.document.text, typed);
  paragraphCommand(h, joinBackward, h.state().selection.from); await h.controller.idle(); assert.equal(h.document.text, typed);
  assert.equal(other.document.text, 'Independent.'); assert.deepEqual(fs.readFileSync(h.file), h.disk);
});

test('paragraph range: empty selection edges restore and renderer metadata remains main-owned', async () => {
  const h = harness('First.\r\n\r\nMiddle.\r\n\r\nLast.');
  const before = h.document.text;
  assert.equal(h.edit(h.span('First.').to, h.span('Last.').from, 'X'), true); await h.controller.idle();
  assert.equal(h.document.text, 'First.XLast.');
  assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, before);
  assert.equal(await h.controller.history('redo'), true); assert.equal(h.document.text, 'First.XLast.');
});

test('paragraph range: unsupported selection and active composition do not lock later edits', async () => {
  const h = harness('First.\n\nA **bold** tail.\n\nLast.'), before = h.document.text;
  assert.equal(h.edit(h.span('First.').from + 1, h.span('Last.').from + 1, 'X'), false);
  assert.equal(h.requests.length, 0); assert.equal(h.document.text, before);
  const plain = harness('First.\n\nLast.'); plain.controller.beginComposition();
  assert.equal(plain.edit(plain.span('First.').from + 1, plain.span('Last.').from + 1, '组合'), false);
  assert.equal(plain.document.text, 'First.\n\nLast.'); assert.equal(plain.requests.length, 0);
  plain.controller.endComposition(); await plain.controller.idle();
  assert.equal(plain.controller.state().composing, false);
  for (const target of [h, plain]) {
    const at = target.span('Last.').from; assert.equal(target.edit(at, at, 'Safe '), true); await target.controller.idle();
    assert.equal(target.document.text.endsWith('Safe Last.'), true);
  }
});

for (const failure of ['stale', 'lost']) test(`paragraph range: ${failure} response retains full attempted text`, async () => {
  const h = harness('First.\n\nMiddle.\n\nLast.');
  const from = h.span('First.').from + 1, to = h.span('Last.').from + 1;
  if (failure === 'stale') h.document.edit({ from: 0, to: 0, insert: 'External ', expectedRevision: 0 });
  else h.dropReplyAfterCommit = true;
  assert.equal(h.edit(from, to, '新😀'), true); await h.controller.idle();
  const state = h.controller.state();
  assert.equal(state.recoveryRecords.length, 1); assert.equal(state.recoveryRecords[0].source, 'F新😀ast.');
  assert.equal(state.recoveryRecords[0].mainMatchesDraft, failure === 'lost');
  assert.equal(state.source, h.document.text); assert.deepEqual(fs.readFileSync(h.file), h.disk);
});


function rangeInput(h, type = 'insertText', options = {}) {
  const a = {}, b = {}, selection = h.state().selection;
  const dom = { rangeCount: 1, isCollapsed: false, anchorNode: b, anchorOffset: selection.to,
    focusNode: a, focusOffset: selection.from + (options.mismatch ? 1 : 0) };
  const view = { get state() { return h.state(); }, editable: true, composing: false, hasFocus: () => true,
    dom: { ownerDocument: { getSelection: () => dom }, contains: n => n === a || n === b }, posAtDOM: (_, at) => at,
    dispatch: tr => { if (h.controller.prepare(tr)) h.apply(tr); }, ...options.view };
  let prevented = false;
  const event = { inputType: type, data: '新😀', cancelable: true, preventDefault() { prevented = true; }, ...options.event };
  const handled = replaceParagraphRangeInput(view, event, { state: options.state || h.controller.state(), blocked: !!options.blocked, report: options.report });
  return { handled, prevented };
}

for (const type of ['insertText', 'deleteContentBackward', 'deleteContentForward']) test(`paragraph range: native beforeinput ${type} uses one verified edit`, async () => {
  const h = harness('First.\r\n\r\nLast.\r\n\r\n```md\r\nkeep [x]\r\n```'), before = h.document.text;
  h.select(h.span('First.').from + 1, h.span('Last.').from + 1);
  assert.deepEqual(rangeInput(h, type), { handled: true, prevented: true }); await h.controller.idle();
  assert.equal(h.document.text, before.replace('irst.\r\n\r\nL', type === 'insertText' ? '新😀' : ''));
  assert.equal(h.requests.length, 1); assert.equal(await h.controller.history('undo'), true); assert.equal(h.document.text, before);
});

test('paragraph range: native input respects composition, focus/selection and operation guards', () => {
  const h = harness('First.\n\nLast.'); h.select(h.span('First.').from + 1, h.span('Last.').from + 1);
  for (const options of [{ mismatch: true }, { blocked: true }, { view: { composing: true } },
    { view: { editable: false } }, { view: { hasFocus: () => false } }, { event: { isComposing: true } },
    { event: { data: null } }, { event: { cancelable: false } }, { event: { defaultPrevented: true } },
    ...['locked', 'historyPending', 'composing', 'compositionInvalid'].map(key => ({ state: { ...h.controller.state(), [key]: true } })),
    { state: { ...h.controller.state(), confirmed: { ...h.controller.state().confirmed, readOnly: true } } }]) {
    assert.deepEqual(rangeInput(h, 'insertText', options), { handled: false, prevented: false });
  }
  for (const type of ['insertCompositionText', 'insertReplacementText', 'insertParagraph', 'insertFromPaste']) {
    assert.deepEqual(rangeInput(h, type), { handled: false, prevented: false });
  }
  assert.equal(h.requests.length, 0); assert.equal(h.document.text, 'First.\n\nLast.');
  h.select(h.span('First.').from, h.span('First.').to);
  assert.deepEqual(rangeInput(h), { handled: false, prevented: false });
});

for (const mode of ['type','delete','paste']) test(`inline range ${mode}: real PM, main history and continued boundary typing preserve exact bytes`, async()=>{
  const h=harness('\ufeff# Keep\r\n\r\nAlpha **bold** omega.\r\n\r\n```md\r\nkeep **bytes**\r\n```\r\n');
  const before=h.document.text,from=h.span('Alpha ').from+3,to=h.span('bold').from+2;
  h.select(from,to);
  if(mode==='paste')assert.deepEqual(paste(h,'新😀').messages,[]);
  else assert.equal(h.edit(from,to,mode==='delete'?'':'新😀'),true);
  await h.controller.idle(); const after=before.replace('ha **bo',mode==='delete'?'**':'新😀**');
  assert.equal(h.document.text,after);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,before);
  assert.equal(h.state().selection.from,from);assert.equal(h.state().selection.to,to);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,after);
  const at=h.state().selection.from;assert.equal(h.edit(at,at,'続'),true);await h.controller.idle();
  assert.equal(h.document.text,after.replace('**ld**','続**ld**'));
  await h.controller.history('undo');await h.controller.history('undo');assert.equal(h.document.text,before);
  for(const extra of [{sourcePatch:true},{inverseSource:{from:0,to:1,insert:'x'}},{leaf:{blockIndex:1,childIndex:0,bold:false}}]) {
    assert.equal(h.request('edit',{expectedRevision:h.document.revision,from,to,insert:'x',...extra}).code,'invalid-request');
  }
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('inline range beforeinput follows marks, refuses composition, and resumes safely',async()=>{
  const h=harness('Alpha **bold** omega.');
  const from=h.span('bold').from+2,to=h.span(' omega.').from+3;
  h.select(from,to);assert.deepEqual(rangeInput(h),{handled:true,prevented:true});await h.controller.idle();
  assert.equal(h.document.text,'Alpha **bo新😀**ega.');
  assert.equal(await h.controller.history('undo'),true);h.select(from,to);
  h.controller.beginComposition();assert.equal(h.edit(from,to,'组合'),false);
  assert.equal(h.document.text,'Alpha **bold** omega.');
  h.controller.endComposition();await h.controller.idle();assert.equal(h.controller.state().composing,false);
  assert.equal(h.edit(2,2,'safe'),true);await h.controller.idle();
  assert.equal(h.document.text,'Asafelpha **bold** omega.');
});

for(const lost of [false,true])test(`inline range ${lost?'lost acknowledgement':'stale revision'} preserves draft without replay`,async()=>{
  const h=harness('Alpha **bold** omega.');
  const from=h.span('Alpha ').from+3,to=h.span('bold').from+2;
  if(lost)h.dropReplyAfterCommit=true;
  else h.document.edit({from:0,to:0,insert:'External ',expectedRevision:0});
  assert.equal(h.edit(from,to,'X'),true);await h.controller.idle();
  const s=h.controller.state();assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
  assert.equal(s.recoveryRecords[0].source,'AlpX**ld** omega.');
  assert.equal(s.recoveryRecords[0].mainMatchesDraft,lost);assert.equal(s.source,h.document.text);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

for(const list of [false,true])test(`boundaries ${list?'list':'paragraph'} split/type/join has exact main history and unchanged original`,async()=>{
  const original=(list?'- ':'')+'A **中文😀bold** Z\r\n\r\nTail.\r\n',h=harness(original);
  const at=h.span('中文😀bold').from+2;
  h.select(at);assert.equal(await h.controller.format({action:list?'split-list':'split-paragraph',from:at,to:at}),true);
  const split=h.document.text,caret=h.state().selection.from;
  assert.equal(h.edit(caret,caret,'新'),true);await h.controller.idle();assert(h.document.text.includes('**新😀bold**'));
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,split);
  h.select(caret);assert.equal(await h.controller.format({action:list?'join-list':'join-paragraph',from:caret,to:caret}),true);
  assert.equal(h.document.text,original);assert.equal(h.state().selection.from,at);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,split);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,original);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,split);
  const revision=h.document.revision;h.document.edit({from:0,to:0,insert:'External ',expectedRevision:revision});
  assert.equal(h.request('undo',{expectedRevision:h.document.revision}).code,'history-diverged');
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('boundaries composition/invalid range cannot send a command; a safe command still works',async()=>{
  const h=harness('- A\n- \n- B');const empty=h.span('');
  assert.equal(await h.controller.format({action:'split-list',from:empty.from,to:empty.from}),false);
  const first=h.span('A');h.controller.beginComposition();
  assert.equal(await h.controller.format({action:'join-list',from:first.from,to:first.from}),false);
  assert.equal(h.requests.length,0);assert.equal(h.document.text,'- A\n- \n- B');
  h.controller.endComposition();await h.controller.idle();
  assert.equal(await h.controller.format({action:'join-list',from:first.from,to:first.from}),true);
  assert.equal(h.document.text,'A\n\n- \n- B');
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,'- A\n- \n- B');
});

for(const lost of [false,true])test(`boundaries ${lost?'lost acknowledgment':'stale revision'} never replays a split`,async()=>{
  const h=harness('A **bold** Z'),at=h.span('bold').from+2;
  if(lost)h.dropReplyAfterCommit=true;
  else h.document.edit({from:0,to:0,insert:'External ',expectedRevision:0});
  assert.equal(await h.controller.format({action:'split-paragraph',from:at,to:at}),false);
  assert.equal(h.requests.filter(r=>r.operation==='format').length,1);
  assert.equal(h.controller.state().source,h.document.text);
  assert.equal(h.document.text,lost?'A **bo**\n\n**ld** Z':'External A **bold** Z');
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});


for(const mode of ['type','delete','paste'])for(const reverse of [false,true])test(`list item range ${mode}, reverse=${reverse}: one main edit and exact history`,async()=>{
  const raw='\ufeff# Keep\r\n\r\n7) Alpha **bold** tail.\r\n8) After\r\n',h=harness(raw),before=h.document.text;
  const from=h.span('Alpha ').from+3,to=h.span('bold').from+2;
  h.select(reverse?to:from,reverse?from:to);
  if(mode==='paste')assert.deepEqual(paste(h,'新😀').messages,[]);
  else assert.deepEqual(rangeInput(h,mode==='delete'?'deleteContentBackward':'insertText'),{handled:true,prevented:true});
  await h.controller.idle();const after=before.replace('ha **bo',mode==='delete'?'**':'新😀**');
  assert.equal(h.document.text,after);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,before);
  assert.equal(h.state().selection.from,from);assert.equal(h.state().selection.to,to);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,after);
  const at=h.state().selection.from;assert.equal(h.edit(at,at,'続'),true);await h.controller.idle();
  assert.equal(h.document.text,after.replace('**ld**','続**ld**'));
  const splitAt=h.span('ld').from+1;h.select(splitAt);
  assert.equal(await h.controller.format({action:'split-list',from:splitAt,to:splitAt}),true);
  const joinAt=h.state().selection.from;
  assert.equal(await h.controller.format({action:'join-list',from:joinAt,to:joinAt}),true);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const body of ['Plain','**Bold**','A **bold** tail'])test(`list full-text deletion retains item and can undo after retyping ${body}`,async()=>{
  const h=harness('- '+body+'\n- Keep'),before=h.document.text,sp=projectSource(before).spans.filter(s=>s.itemIndex===0);
  h.select(sp[0].from,sp.at(-1).to);
  assert.deepEqual(rangeInput(h,'deleteContentForward'),{handled:true,prevented:true});await h.controller.idle();
  assert.equal(h.document.text,'- \n- Keep');
  const empty=h.span('');assert.equal(h.edit(empty.from,empty.to,'Again'),true);await h.controller.idle();
  assert.equal(h.document.text,'- Again\n- Keep');
  await h.controller.history('undo');await h.controller.history('undo');assert.equal(h.document.text,before);
  await h.controller.history('redo');assert.equal(h.document.text,'- \n- Keep');
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('list selection refuses cross-block/multiline/composition safely and resumes',async()=>{
  const h=harness('- A **bold** tail\n\nNext'),before=h.document.text,from=h.span('A ').from,to=h.span('bold').from+2;
  h.select(from,h.span('Next').to);assert.deepEqual(rangeInput(h),{handled:true,prevented:true});
  assert.equal(h.document.text,before);assert.equal(h.requests.length,0);
  h.select(from,to);assert.equal(paste(h,'One\nTwo').messages.length,1);assert.equal(h.document.text,before);
  assert.equal(paste(h,'').messages.length,0);assert.equal(h.document.text,before);
  h.controller.beginComposition();assert.equal(h.edit(from,to,'组合'),false);
  assert.equal(paste(h,'组合').messages.length,1);h.controller.endComposition();await h.controller.idle();
  h.select(from,to);assert.equal(paste(h,'Safe').messages.length,0);await h.controller.idle();
  assert.equal(h.document.text,'- Safe**ld** tail\n\nNext');assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const lost of [false,true])test(`list range ${lost?'lost acknowledgment':'stale revision'} retains draft without replay`,async()=>{
  const h=harness('- A **bold** tail\n- Next'),from=h.span('A ').from,to=h.span('bold').from+2;
  if(lost)h.dropReplyAfterCommit=true;else h.document.edit({from:0,to:0,insert:'External\n\n',expectedRevision:0});
  assert.equal(h.edit(from,to,'X'),true);await h.controller.idle();
  const s=h.controller.state();assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
  assert.equal(s.recoveryRecords[0].source,'- X**ld** tail\n- Next');assert.equal(s.recoveryRecords[0].mainMatchesDraft,lost);
  assert.equal(s.source,h.document.text);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

for(const mode of ['type','delete','paste'])for(const reverse of [false,true])test(`cross-list ${mode}, reverse=${reverse}: one main edit with exact history and continuation`,async()=>{
  const h=harness('\ufeff# Keep\r\n\r\n3) Alpha **bold** tail\r\n7) Middle\r\n12) End **strong** finish\r\n99) Keep\r\n'),before=h.document.text;
  const from=h.span('bold').from+2,to=h.span('strong').from+2,insert=mode==='delete'?'':'新😀';
  h.select(reverse?to:from,reverse?from:to);
  if(mode==='paste')assert.deepEqual(paste(h,insert).messages,[]);
  else assert.deepEqual(rangeInput(h,mode==='delete'?'deleteContentBackward':'insertText'),{handled:true,prevented:true});
  await h.controller.idle();const after='# Keep\r\n\r\n3) Alpha **bo'+insert+'rong** finish\r\n99) Keep\r\n';
  assert.equal(h.document.text,after);assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,before);
  assert.equal(h.state().selection.from,from);assert.equal(h.state().selection.to,to);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,after);
  const at=h.state().selection.from;assert.equal(h.edit(at,at,'Q'),true);await h.controller.idle();
  assert.equal(h.document.text,after.replace('rong','Qrong'));
  assert.equal(await h.controller.format({action:'split-list',from:at,to:at}),true);
  const caret=h.state().selection.from;assert.equal(await h.controller.format({action:'join-list',from:caret,to:caret}),true);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const key of ['Backspace','Delete'])for(const body of ['**Bold**\n- __Last__','A\n- '])test(`cross-list ${key} fully selected text retains an item and can retype ${body}`,async()=>{
  const h=harness('- '+body),before=h.document.text,rows=projectSource(before).blocks[0].items;
  h.select(rows.at(-1).to,rows[0].from);
  assert.deepEqual(rangeInput(h,'keydown',{event:{key}}),{handled:true,prevented:true});await h.controller.idle();
  assert.equal(h.document.text,'- ');assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
  assert.equal(h.edit(3,3,'Again'),true);await h.controller.idle();assert.equal(h.document.text,'- Again');
  await h.controller.history('undo');await h.controller.history('undo');assert.equal(h.document.text,before);
  await h.controller.history('redo');assert.equal(h.document.text,'- ');assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('cross-list key input keeps DOM selection, focus, IME and permission guards',async()=>{
  const h=harness('- A **bold**\n- Last'),before=h.document.text;
  h.select(h.span('A ').from,h.span('Last').to);
  for(const options of [{mismatch:true},{blocked:true},{view:{composing:true}},{view:{editable:false}},{view:{hasFocus:()=>false}},
    ...[{isComposing:true},{keyCode:229},{metaKey:true},{ctrlKey:true},{altKey:true},{shiftKey:true},{defaultPrevented:true},{cancelable:false}].map(event=>({event})),
    ...['locked','historyPending','composing','compositionInvalid'].map(k=>({state:{...h.controller.state(),[k]:true}})),
    {state:{...h.controller.state(),confirmed:{...h.controller.state().confirmed,readOnly:true}}}])
    assert.deepEqual(rangeInput(h,'keydown',{...options,event:{key:'Backspace',...options.event}}),{handled:false,prevented:false});
  assert.equal(h.requests.length,0);
  h.controller.beginComposition();assert.equal(h.edit(h.span('A ').from,h.span('Last').to,'组合'),false);
  h.controller.endComposition();await h.controller.idle();assert.equal(h.document.text,before);
  assert.equal(paste(h,'One\nTwo').messages.length,1);assert.equal(h.document.text,before);
  h.select(h.span('A ').from,h.span('Last').to);assert.equal(paste(h,'Safe').messages.length,0);await h.controller.idle();
  assert.equal(h.document.text,'- Safe');assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
for(const lost of [false,true])test(`cross-list ${lost?'lost acknowledgment':'stale revision'} retains attempted draft without retry`,async()=>{
  const h=harness('- Alpha **bold** tail\n- Last'),from=h.span('Alpha ').from+2,to=h.span('Last').from+2;
  if(lost)h.dropReplyAfterCommit=true;else h.document.edit({from:0,to:0,insert:'External\n\n',expectedRevision:0});
  assert.equal(h.edit(from,to,'X'),true);await h.controller.idle();
  const s=h.controller.state();assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);
  assert.equal(s.recoveryRecords[0].source,'- AlXst');assert.equal(s.recoveryRecords[0].mainMatchesDraft,lost);
  assert.equal(s.source,h.document.text);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});


test('native shortened or unreadable target range is refused atomically with feedback, then a safe list edit works',async()=>{
  const h=harness('- First\n- Last\n\n```md\nProtected\n```'),before=h.document.text;
  h.select(h.span('First').from+1,h.span('Last').to);
  const messages=[];
  for(const getTargetRanges of [()=>[{startOffset:4,endOffset:5}],()=>[{},{}],()=>{throw Error('synthetic target failure');}]) {
    assert.deepEqual(rangeInput(h,'insertText',{event:{getTargetRanges},report:m=>messages.push(m)}),{handled:true,prevented:true});
    assert.equal(h.document.text,before);assert.equal(h.document.revision,0);assert.equal(h.requests.length,0);
  }
  assert.equal(messages.length,3);assert(messages.every(m=>m.includes('输入范围与当前选区不一致')));
  assert.deepEqual(rangeInput(h),{handled:true,prevented:true});await h.controller.idle();
  assert.equal(h.document.text,'- F新😀\n\n```md\nProtected\n```');assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

for(const prefix of ['', '- '])test(`italic controller format/type/history and full deletion ${prefix}`,async()=>{
  const raw='\ufeff'+prefix+'A 中文😀 Z\r\n\r\nTail.\r\n',h=harness(raw),before=h.document.text;
  const at=h.span('A 中文😀 Z').from+2;
  assert.equal(await h.controller.format({action:'italic',from:at,to:at+4}),true);
  const formatted=before.replace('中文😀','*中文😀*');assert.equal(h.document.text,formatted);
  assert.equal(h.edit(at+1,at+1,'新'),true);await h.controller.idle();assert.equal(h.document.text,formatted.replace('中文','中新文'));
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,formatted);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,before);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,formatted);
  h.controller.beginComposition();assert.equal(await h.controller.format({action:'italic',from:at,to:at+4}),false);
  await h.controller.endComposition();assert.equal(h.document.text,formatted);
  assert.equal(await h.controller.format({action:'italic',from:at,to:at+4}),true);assert.equal(h.document.text,before);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
  const all=harness(prefix+'*All*'),b=all.span('All');all.select(b.to,b.from);
  const tr=all.state().tr.insertText('');assert.equal(all.controller.prepare(tr),true);all.apply(tr);await all.controller.idle();
  assert.equal(all.document.text,prefix);assert.equal(all.edit(all.state().selection.from,all.state().selection.to,'Again'),true);
  await all.controller.idle();assert.equal(all.document.text,prefix+'Again');
  assert.equal(await all.controller.history('undo'),true);assert.equal(await all.controller.history('undo'),true);assert.equal(all.document.text,prefix+'*All*');
});
for(const lost of [false,true])test(`italic IPC failure reconciles without replay or false success ${lost}`,async()=>{
  const h=harness('A word Z'),s=h.span('A word Z'),before=h.document.text;
  if(lost)h.dropReplyAfterCommit=true;else h.request('edit',{expectedRevision:0,from:s.from,to:s.from,insert:'External '});
  assert.equal(await h.controller.format({action:'italic',from:s.from+2,to:s.from+6}),false);
  assert.equal(h.requests.filter(r=>r.operation==='format').length,1);
  assert.equal(h.controller.state().source,h.document.text);
  assert.equal(h.controller.state().code,lost?'ipc-failed':'stale-revision');
  assert.equal(h.document.text,lost?'A *word* Z':'External '+before);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('inline code uses main history and preserves drafts after lost format acknowledgement',async()=>{
  const h=harness('A word tail.\n\n- A `code` Z\n- B end.\n'),before=h.document.text,p=h.span('A word tail.');
  assert.equal(await h.controller.format({action:'code',from:p.from+2,to:p.from+6}),true);
  const formatted=before.replace('word','`word`');assert.equal(h.document.text,formatted);
  const c=h.span('word');assert.equal(h.edit(c.from+2,c.from+2,'新'),true);await h.controller.idle();
  const typed=formatted.replace('word','wo新rd');assert.equal(h.document.text,typed);
  assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,formatted);
  assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,typed);
  const current=h.span('wo新rd');h.dropReplyAfterCommit=true;
  assert.equal(await h.controller.format({action:'code',from:current.from,to:current.to}),false);
  await h.controller.idle();assert.equal(h.document.text,typed.replace('`wo新rd`','wo新rd'));
  assert.equal(h.controller.state().source,h.document.text);assert.equal(h.controller.state().locked,false);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

for(const prefix of ['', '## ', '- '])test(`link label history, controlled composition and rejected ranges ${prefix}`,async()=>{
 const h=harness(prefix+'A [label](<https://example.test/a> "Title") Z\r\n\r\nTail.'),before=h.document.text,p=h.span('label');
 assert.equal(h.edit(p.from,p.to,'中文😀'),true);await h.controller.idle();const typed=before.replace('[label]','[中文😀]');
 assert.equal(h.document.text,typed);assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,before);
 assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,typed);
 const q=h.span('中文😀');h.controller.beginComposition();assert.equal(h.edit(q.from+1,q.from+1,'ni'),true);assert.equal(h.edit(q.from+1,q.from+3,'你'),true);
 h.controller.endComposition();await h.controller.idle();assert.equal(h.document.text,typed.replace('中文','中你文'));
 const r=h.span('中你文😀');assert.equal(h.edit(r.from,r.to,''),false);assert.equal(h.controller.state().locked,false);
 const t=h.span('Tail.');assert.equal(h.edit(t.to,t.to,' End'),true);await h.controller.idle();assert.equal(h.document.text.endsWith('Tail. End'),true);
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('lost link edit acknowledgement preserves draft and reconciles without replay',async()=>{
 const h=harness('[label](target)'),p=h.span('label');h.dropReplyAfterCommit=true;
 assert.equal(h.edit(p.from+1,p.from+1,'新'),true);await h.controller.idle();
 assert.equal(h.document.text,'[l新abel](target)');assert.equal(h.controller.state().source,h.document.text);
 assert.equal(h.controller.state().locked,false);assert.equal(h.controller.state().code,'ipc-failed');
 assert.equal(h.requests.filter(r=>r.operation==='edit').length,1);assert.equal(h.controller.state().recoveryRecords.length,1);
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});


test('block input queues prefix, conversion and fast typing; main owns history and source bytes', async()=>{
  const h=harness('');h.delayed=true;
  const view={editable:true,composing:false,get state(){return h.state();},dispatch(tr){assert.equal(h.controller.prepare(tr),true);h.apply(tr);}};
  assert.equal(h.edit(1,1,'#'),true);h.select(2);
  let prevented=false;
  assert.equal(applyBlockShortcut(view,{key:' ',preventDefault(){prevented=true;}},{controller:h.controller}),true);
  assert.equal(prevented,true);assert.equal(h.edit(1,1,'Title'),true);
  assert.equal(h.controller.state().source,'# Title');assert.equal(h.controller.state().pending,3);
  h.delayed=false;h.replies.shift()();await h.controller.idle();
  assert.equal(h.document.text,'# Title');assert.equal(h.resets.length,0);
  assert.deepEqual(h.requests.map(r=>[r.operation,r.expectedRevision]),[['edit',0],['format',1],['edit',2]]);
  for(const expected of ['# ','#','']) {assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,expected);}
  for(const expected of ['#','# ','# Title']) {assert.equal(await h.controller.history('redo'),true);assert.equal(h.document.text,expected);}
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('block input respects composition and readonly; lost format acknowledgement retains draft without replay',async()=>{
  const h=harness('#');h.select(2);
  const view={editable:true,composing:false,get state(){return h.state();},dispatch(tr){assert.equal(h.controller.prepare(tr),true);h.apply(tr);}};
  const event={key:' ',preventDefault(){}};
  h.controller.beginComposition();assert.equal(applyBlockShortcut(view,event,{controller:h.controller}),false);h.controller.endComposition();
  assert.equal(applyBlockShortcut({...view,editable:false},event,{controller:h.controller}),false);
  assert.equal(applyBlockShortcut(view,{...event,isComposing:true},{controller:h.controller}),false);
  h.dropReplyAfterCommit=true;assert.equal(applyBlockShortcut(view,event,{controller:h.controller}),true);await h.controller.idle();
  assert.equal(h.document.text,'# ');assert.equal(h.controller.state().recoveryRecords.length,1);
  assert.equal(h.requests.filter(r=>r.operation==='format').length,1);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('link panel format lost acknowledgement reconciles without replay or file writes',async()=>{
 const h=harness('Plain text.');h.dropReplyAfterCommit=true;
 const q={action:'set-link',from:1,to:6,label:'Label',href:'https://example.test'};
 assert.equal(await h.controller.format(q),false);
 assert.equal(h.document.text,'[Label](<https://example.test>) text.');
 assert.equal(h.controller.state().confirmed.source,h.document.text);assert.equal(h.requests.filter(r=>r.operation==='format').length,1);
 h.dropReplyAfterCommit=false;assert.equal(await h.controller.history('undo'),true);assert.equal(h.document.text,'Plain text.');
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});


function structuredKeys(h) {
  const view={editable:true,composing:false,get state(){return h.state()},dispatch(tr){if(h.controller.prepare(tr))h.apply(tr)}};
  return {view,key(key,extra={}){let prevented=false;const event={key,preventDefault(){prevented=true},...extra};
    const handled=applyStructuredKey(view,event,{controller:h.controller})||applyBlockShortcut(view,event,{controller:h.controller});
    assert.equal(handled,true,key);assert.equal(prevented,true,key);}};
}
test('structured block queue creates quote paragraphs, exits and preserves main history behind delayed IPC',async()=>{
  const h=harness('>');h.select(2);const k=structuredKeys(h);h.delayed=true;k.key(' ');
  let at=h.state().selection.from;assert(h.edit(at,at,'First'));k.key('Enter');at=h.state().selection.from;assert(h.edit(at,at,'Second'));
  k.key('Enter');k.key('Enter');at=h.state().selection.from;assert(h.edit(at,at,'After'));
  await tick();assert.equal(h.requests.length,1);h.delayed=false;h.replies.shift()();await h.controller.idle();
  assert.equal(h.document.text,'> First\n> \n> Second\n\nAfter');assert.equal(h.resets.length,0);
  const final=h.document.text;while(h.controller.state().confirmed.canUndo)assert(await h.controller.history('undo'));
  assert.equal(h.document.text,'>');while(h.controller.state().confirmed.canRedo)assert(await h.controller.history('redo'));
  assert.equal(h.document.text,final);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('structured code supports literal Enter Tab multiline paste and composition with exact undo',async()=>{
  const h=harness('```js');h.select(6);const k=structuredKeys(h);k.key('Enter');await h.controller.idle();
  let at=h.state().selection.from;assert(h.edit(at,at,'const x = []'));k.key('Enter');k.key('Tab');await h.controller.idle();
  const before=h.document.text;let report='';pastePlainText(k.view,{preventDefault(){},clipboardData:{types:['text/plain'],files:[],getData(){return 'one\r\n\r\n\ttwo';}}},{state:h.controller.state(),report:m=>report=m});
  await h.controller.idle();assert.equal(report,'');assert.equal(h.document.text,'```js\nconst x = []\n\tone\n\n\ttwo\n```');
  assert(await h.controller.history('undo'));assert.equal(h.document.text,before);assert(await h.controller.history('redo'));
  at=h.state().selection.from;h.controller.beginComposition();assert(h.edit(at,at,'ni'));assert(h.edit(at,at+2,'你'));h.controller.endComposition();await h.controller.idle();assert(h.document.text.includes('你'));
  k.key('Enter',{metaKey:true});await h.controller.idle();assert.equal(h.state().selection.$from.parent.type.name,'paragraph');
  at=h.state().selection.from;assert(h.edit(at,at,'Tail'));await h.controller.idle();assert(h.document.text.endsWith('\n\nTail'));assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('structured code rejects fence escape and forged opaque edit, then permits continued text',async()=>{
  const h=harness('```js\nA\n```\n\n```js meta\nProtected\n```');const s=h.span('A');
  assert.equal(h.edit(s.from,s.to,'A\n```\nEscaped'),false);assert.equal(h.document.text,h.disk.toString());
  const doc=h.state().doc;let opaque;doc.descendants((n,p)=>{if(n.type.name==='codeBlock'&&!n.attrs.sourceEditable)opaque=p;});
  assert.equal(h.controller.prepare(h.state().tr.setNodeMarkup(opaque,null,{language:'js',sourceEditable:true})),false);
  assert(h.edit(s.from,s.to,'Safe'));await h.controller.idle();assert(h.document.text.startsWith('```js\nSafe\n```'));assert.deepEqual(fs.readFileSync(h.file),h.disk);
});


test('CRLF code history restores exact source and valid projected caret',async()=>{
 const raw='Before.\r\n\r\n~~~js\r\nA\r\nB\r\n~~~\r\n',h=harness(raw),s=h.span('A\nB');
 assert(h.edit(s.from,s.to,'one\n\n\ttwo'));await h.controller.idle();const after=h.document.text;
 assert.equal(after,raw.replace('A\r\nB','one\r\n\r\n\ttwo'));assert(await h.controller.history('undo'));assert.equal(h.document.text,raw);
 assert.equal(h.state().selection.from,s.from);assert.equal(h.state().selection.to,s.to);
 assert(await h.controller.history('redo'));assert.equal(h.document.text,after);assert.equal(h.state().selection.from,s.from+'one\n\n\ttwo'.length);
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('structured command respects composition and lost acknowledgement never replays the format',async()=>{
 const h=harness('>');h.select(2);const k=structuredKeys(h);h.dropReplyAfterCommit=true;k.key(' ');await h.controller.idle();
 assert.equal(h.document.text,'> ');assert.equal(h.controller.state().recoveryRecords.length,1);assert.equal(h.requests.filter(r=>r.operation==='format').length,1);
 const other=harness('```\na\n```');other.select(2);const v=structuredKeys(other).view,event={key:'Enter',preventDefault(){throw Error('composition consumed')}};
 other.controller.beginComposition();assert.equal(applyStructuredKey(v,event,{controller:other.controller}),false);other.controller.endComposition();
 assert.equal(applyStructuredKey({...v,editable:false},event,{controller:other.controller}),false);
 assert.deepEqual(fs.readFileSync(h.file),h.disk);assert.deepEqual(fs.readFileSync(other.file),other.disk);
});

test('heading word spaces survive queued input, undo/redo and leave original bytes untouched',async()=>{
  const h=harness('# Field\r\n\r\nUntouched **body**.\r\n');h.delayed=true;
  let at=h.span('Field').to;
  for(const char of ' notes'){assert.equal(h.edit(at,at,char),true,JSON.stringify(char));at+=char.length;}
  await tick();h.delayed=false;h.replies.shift()();await h.controller.idle();
  assert.equal(h.document.text,'# Field notes\r\n\r\nUntouched **body**.\r\n');
  for(let n=0;n<6;n++)assert.equal(await h.controller.history('undo'),true);
  assert.equal(h.document.text,'# Field\r\n\r\nUntouched **body**.\r\n');
  for(let n=0;n<6;n++)assert.equal(await h.controller.history('redo'),true);
  assert.equal(h.document.text,'# Field notes\r\n\r\nUntouched **body**.\r\n');
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('Enter after a linked paragraph supports continued typing and exact main-owned history',async()=>{
  const h=harness('[label](<../guide.md> "keep title")\r\n'),original=h.document.text,at=h.span('label').to;
  assert.equal(await h.controller.format({action:'split-paragraph',from:at,to:at}),true);
  const empty=h.span('');assert.equal(h.edit(empty.from,empty.to,'Next words'),true);await h.controller.idle();
  assert.equal(h.document.text,'[label](<../guide.md> "keep title")\r\n\r\nNext words\r\n');
  assert.equal(await h.controller.history('undo'),true);assert.equal(await h.controller.history('undo'),true);
  assert.equal(h.document.text,original);
  assert.equal(await h.controller.history('redo'),true);assert.equal(await h.controller.history('redo'),true);
  assert.equal(h.document.text.endsWith('Next words\r\n'),true);assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

for(const original of ['# Heading','- First','3) First','A **marked** tail','[Label](target) tail']) test(`boundary key queues behind text and accepts following typing: ${original}`,async()=>{
  const h=harness(original),last=projectSource(original).spans.at(-1);h.select(last.to);h.delayed=true;
  assert(h.edit(last.to,last.to,'s'));structuredKeys(h).key('Enter');
  const at=h.state().selection.from;assert(h.edit(at,at,'Next'));
  await tick();assert.equal(h.requests.length,1);h.delayed=false;h.replies.shift()();await h.controller.idle();
  const expected=original+'s'+(original.startsWith('-')?'\n- ':original.startsWith('3)')?'\n4) ':'\n\n')+'Next';
  assert.equal(h.document.text,expected);assert.equal(h.resets.length,0);
  assert.deepEqual(h.requests.map(r=>[r.operation,r.expectedRevision]),[['edit',0],['format',1],['edit',2]]);
  for(let i=0;i<3;i++)assert(await h.controller.history('undo'));assert.equal(h.document.text,original);
  for(let i=0;i<3;i++)assert(await h.controller.history('redo'));assert.equal(h.document.text,expected);
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('queued list Enter with lost acknowledgement retains following text without retry',async()=>{
  const h=harness('- First');h.select(h.span('First').to);h.dropReplyAfterCommit=true;
  structuredKeys(h).key('Enter');const at=h.state().selection.from;assert(h.edit(at,at,'Retained'));
  await h.controller.idle();
  assert.equal(h.requests.filter(r=>r.operation==='format').length,1);
  assert.equal(h.document.text,'- First\n- ');assert(h.controller.state().recoveryDraft.includes('Retained'));
  assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('structured keys leave ordinary empty-paragraph Backspace to the existing editor command',()=>{
  const h=harness('Before\n\n');h.select(projectSource(h.document.text).spans.at(-1).from);
  const view=structuredKeys(h).view;
  assert.equal(applyStructuredKey(view,{key:'Backspace',preventDefault(){throw Error('plain key consumed')}},{controller:h.controller}),false);
  assert.equal(h.requests.length,0);
});

test('structured lists use main history and queued keyboard commands without writing original',async()=>{
 const h=harness('- [ ] Alpha\n- [x] Beta');
 const key=key=>{const event={key,preventDefault(){},isComposing:false};const view={get state(){return h.state();},editable:true,composing:false,dispatch:tr=>{if(h.controller.prepare(tr))h.apply(tr);}};return applyStructuredKey(view,event,{controller:h.controller});};
 h.select(h.span('Beta').from+2);h.delayed=true;assert.equal(key('Tab'),true);
 assert.equal(h.controller.state().source,'- [ ] Alpha\n  - [x] Beta');
 assert.equal(h.edit(h.state().selection.from,h.state().selection.to,'中'),true);
 await tick();h.delayed=false;h.replies.shift()();await h.controller.idle();
 assert.equal(h.controller.state().confirmed.source,'- [ ] Alpha\n  - [x] Be中ta');
 await h.controller.history('undo');assert.equal(h.controller.state().source,'- [ ] Alpha\n  - [x] Beta');
 await h.controller.history('undo');assert.equal(h.controller.state().source,'- [ ] Alpha\n- [x] Beta');
 await h.controller.history('redo');assert.equal(h.controller.state().source,'- [ ] Alpha\n  - [x] Beta');
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
test('task toggle is refused during composition and accepted as main-owned exact history',async()=>{
 const h=harness('- [ ] Alpha'),at=h.span('Alpha').from;
 assert.equal(await h.controller.format({action:'toggle-task',from:at,to:at}),true);
 assert.equal(h.controller.state().source,'- [x] Alpha');await h.controller.history('undo');
 assert.equal(h.controller.state().source,'- [ ] Alpha');
 h.controller.beginComposition();assert.equal(await h.controller.format({action:'toggle-task',from:at,to:at}),false);
 assert.equal(h.controller.state().source,'- [ ] Alpha');assert.deepEqual(fs.readFileSync(h.file),h.disk);
});


test('list Enter sees a native line-end caret before the delayed PM selectionchange',async()=>{
 const h=harness('- [x] Plan'),c=nativeCaret(h,'Plan');h.select(h.span('Plan').from);
 c.selection.anchorOffset=c.selection.focusOffset=4;
 assert.equal(syncNativeListSelection(c.view,{key:'Enter'},{state:h.controller.state()}),true);
 assert.equal(h.state().selection.from,h.span('Plan').to);
 c.view.dispatch=tr=>{if(h.controller.prepare(tr))h.apply(tr);};
 assert.equal(applyStructuredKey(c.view,{key:'Enter',preventDefault(){}},{controller:h.controller}),true);
 await h.controller.idle();assert.equal(h.document.text,'- [x] Plan\n- [ ] ');
 for(const extra of [{composing:true},{pending:1},{locked:true}]){
  h.select(h.span('Plan').from);assert.equal(syncNativeListSelection(c.view,{key:'Enter'},{state:{...h.controller.state(),...extra}}),false);
 }
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});

test('list Tab follows a verified native caret moved from another paragraph',async()=>{
 const h=harness('- [x] Parent\n- [ ] Child\n\nTail'),c=nativeCaret(h,'Child');
 h.select(h.span('Tail').to);c.selection.anchorOffset=c.selection.focusOffset=5;
 for(const alter of [()=>{c.paragraph.textContent='preedit';},()=>{c.view.nodeDOM=()=>({});}]){
  const nodeDOM=c.view.nodeDOM;alter();
  assert.equal(syncNativeListSelection(c.view,{key:'Tab'},{state:h.controller.state()}),false);
  assert.equal(h.state().selection.from,h.span('Tail').to);c.paragraph.textContent='Child';c.view.nodeDOM=nodeDOM;
 }
 assert.equal(syncNativeListSelection(c.view,{key:'Tab'},{state:h.controller.state()}),true);
 assert.equal(h.state().selection.from,h.span('Child').to);
 c.view.dispatch=tr=>{if(h.controller.prepare(tr))h.apply(tr);};
 assert.equal(applyStructuredKey(c.view,{key:'Tab',preventDefault(){}},{controller:h.controller}),true);
 await h.controller.idle();assert.equal(h.document.text,'- [x] Parent\n  - [ ] Child\n\nTail');
 assert.deepEqual(fs.readFileSync(h.file),h.disk);
});
