import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
const require = createRequire(import.meta.url);
const { createDocumentService } = require('../lib/document-service');
const { createDocumentSessions } = require('../lib/document-session-ipc');

function fixture(mapper = mapTextEdit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'document-history-'));
  const file = path.join(root, 'a.md');
  const bytes = Buffer.from('\ufeff---\r\nx: synthetic\r\n---\r\n# Title😀\r\n\r\nA **粗体中文** end.\r\n\r\n![x](../a.png)\r\n\r\n::: unknown\r\n');
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o640 });
  const service = createDocumentService(), doc = service.open(file).document;
  const win = new EventEmitter(), wc = new EventEmitter(), frame = { url: 'file:///synthetic/demo.html' };
  Object.assign(wc, { isDestroyed: () => false, mainFrame: frame, getURL: () => frame.url });
  Object.assign(win, { isDestroyed: () => false, webContents: wc });
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit: mapper, windowFor: sender => sender === wc ? win : null });
  manager.grant(win, frame.url);
  const id = manager.provision(win, doc, 'A'), event = { sender: wc, senderFrame: frame };
  const call = (operation, extra = {}) => manager.request(event, { operation, sessionId: id, ...extra });
  const edit = text => {
    const s = projectSource(doc.text).spans[0];
    return call('edit', { expectedRevision: doc.revision, from: s.from, to: s.to, insert: text });
  };
  return { root, file, bytes, service, doc, win, wc, frame, manager, id, event, call, edit };
}

test('main-owned undo/redo replays exact source and advances revisions without disk writes', () => {
  const f = fixture(), original = f.doc.text;
  assert.equal(f.call('snapshot').snapshot.canUndo, false);
  const edited = f.edit('新标题😀'); assert.equal(edited.ok, true);
  assert.equal(edited.snapshot.canUndo, true);
  const undo = f.call('undo', { expectedRevision: 1 });
  assert.equal(undo.ok, true); assert.equal(undo.snapshot.source, original);
  assert.equal(undo.snapshot.revision, 2); assert.equal(undo.snapshot.dirty, false);
  assert.equal(undo.snapshot.canRedo, true);
  const redo = f.call('redo', { expectedRevision: 2 });
  assert.equal(redo.ok, true); assert.equal(redo.snapshot.source, edited.snapshot.source);
  assert.equal(redo.snapshot.revision, 3); assert.equal(redo.snapshot.bom, true);
  assert.deepEqual(fs.readFileSync(f.file), f.bytes);
  assert.equal(f.call('save', { expectedRevision: 3 }).code, 'coordination-required');
});

test('rejected, stale and no-op edits do not pollute history or clear redo', () => {
  const f = fixture(), original = f.doc.text;
  f.edit('Changed');
  assert.equal(f.call('undo', { expectedRevision: 0 }).code, 'stale-revision');
  assert.equal(f.call('edit', { expectedRevision: 1, from: 0, to: 9999, insert: 'bad' }).code, 'unsafe-source-range');
  assert.equal(f.call('undo', { expectedRevision: 1 }).snapshot.source, original);
  const noOp = f.edit('Title😀'); assert.equal(noOp.snapshot.revision, 2);
  assert.equal(noOp.snapshot.canRedo, true);
  assert.equal(f.call('undo', { expectedRevision: 2 }).code, 'history-empty');
  assert.equal(f.call('redo', { expectedRevision: 2 }).snapshot.source, original.replace('Title😀', 'Changed'));
  f.call('undo', { expectedRevision: 3 }); f.edit('Branch');
  assert.equal(f.call('redo', { expectedRevision: 5 }).code, 'history-empty');
});

test('different document sessions cannot undo each other and revoked grants cannot replay', () => {
  const f = fixture();
  const second = f.manager.provision(f.win, f.service.open(f.file).document, 'B');
  f.edit('A only');
  const request = { operation: 'undo', sessionId: second, expectedRevision: 0 };
  assert.equal(f.manager.request(f.event, request).code, 'history-empty');
  assert.equal(f.doc.text.includes('A only'), true);
  f.win.emit('closed');
  assert.equal(f.call('undo', { expectedRevision: 1 }).code, 'unauthorized-sender');
});

test('history is bounded and multi-step Unicode edits undo in order with fresh source maps', () => {
  const f = fixture();
  for (let i = 1; i <= 70; i++) assert.equal(f.edit('Title😀' + '文'.repeat(i)).ok, true);
  for (let i = 0; i < 64; i++) assert.equal(f.call('undo', { expectedRevision: f.doc.revision }).ok, true);
  assert.equal(f.doc.text.includes('Title😀' + '文'.repeat(6) + '\r\n'), true);
  assert.equal(f.call('undo', { expectedRevision: f.doc.revision }).code, 'history-empty');
  assert.deepEqual(fs.readFileSync(f.file), f.bytes);
});

test('history operations require the same revision/allowlist authority as edits', () => {
  const f = fixture();
  assert.equal(f.call('undo').code, 'invalid-revision');
  assert.equal(f.call('redo', { expectedRevision: 0, unsafeExperimentalRoot: f.root }).code, 'invalid-request');
  assert.equal(f.call('undo', { expectedRevision: 0, leaf: { blockIndex: 0, childIndex: 0, bold: true } }).code, 'invalid-request');
  assert.equal(f.manager.request({ sender: {}, senderFrame: f.frame }, { operation: 'undo', sessionId: f.id, expectedRevision: 0 }).code, 'unauthorized-sender');
});

for (const [text, from, to] of [['粗体中文', 0, 1], ['粗体中文', 3, 4], ['😀中文😃', 0, 2], ['😀中文😃', 4, 6]]) {
  test(`P1-2: bold boundary deletion ${text} ${from}:${to} remains exactly undoable`, () => {
    const f = fixture(); let bold = projectSource(f.doc.text).spans.find(s => s.bold);
    f.call('edit', { expectedRevision: f.doc.revision, from: bold.from, to: bold.to, insert: text });
    const original = f.doc.text; bold = projectSource(original).spans.find(s => s.bold);
    if (text.startsWith('😀')) {
      const revision = f.doc.revision;
      assert.equal(f.call('edit', { expectedRevision: revision, from: bold.from, to: bold.from + 1, insert: '' }).code, 'unsafe-source-range');
      assert.equal(f.doc.revision, revision); assert.equal(f.doc.text, original);
    }
    const removed = f.call('edit', { expectedRevision: f.doc.revision, from: bold.from + from, to: bold.from + to, insert: '' });
    assert.equal(removed.ok, true); const edited = f.doc.text;
    const undo = f.call('undo', { expectedRevision: f.doc.revision });
    assert.equal(undo.ok, true); assert.equal(f.doc.text, original);
    assert.equal(f.call('redo', { expectedRevision: f.doc.revision }).ok, true); assert.equal(f.doc.text, edited);
    assert.equal(f.call('undo', { expectedRevision: f.doc.revision - 1 }).code, 'stale-revision');
    assert.equal(f.doc.text, edited); assert.equal(f.call('undo', { expectedRevision: f.doc.revision }).ok, true);
    assert.equal(f.doc.text, original); assert.deepEqual(fs.readFileSync(f.file), f.bytes);
  });
}

test('P1-2: invalid inverse and unexpected source hash leave history intact', () => {
  let corrupt = false;
  const f = fixture((source, change, leaf) => {
    const result = mapTextEdit(source, change, leaf);
    return corrupt && leaf && result.ok ? { ...result, source: result.source + 'CORRUPTED' } : result;
  });
  const bold = projectSource(f.doc.text).spans.find(s => s.bold);
  f.call('edit', { expectedRevision: 0, from: bold.from, to: bold.from + 1, insert: '' });
  const edited = f.doc.text, revision = f.doc.revision; corrupt = true;
  assert.equal(f.call('undo', { expectedRevision: revision }).code, 'history-diverged');
  assert.equal(f.doc.text, edited); assert.equal(f.doc.revision, revision);
  assert.equal(f.call('snapshot').snapshot.canUndo, true); assert.equal(f.call('snapshot').snapshot.canRedo, false);
  corrupt = false; assert.equal(f.call('undo', { expectedRevision: revision }).ok, true);
  const restored = f.doc.text, undoRevision = f.doc.revision; corrupt = true;
  assert.equal(f.call('redo', { expectedRevision: undoRevision }).code, 'history-diverged');
  assert.equal(f.doc.text, restored); assert.equal(f.doc.revision, undoRevision);
  assert.equal(f.call('snapshot').snapshot.canRedo, true);
  corrupt = false; assert.equal(f.call('redo', { expectedRevision: undoRevision }).ok, true);
  f.doc.edit({ from: 0, to: 0, insert: 'Trusted mutation\r\n', expectedRevision: f.doc.revision });
  const changed = f.doc.text;
  assert.equal(f.call('undo', { expectedRevision: f.doc.revision }).code, 'history-diverged');
  assert.equal(f.doc.text, changed); assert.equal(f.call('snapshot').snapshot.canUndo, true);
});

for (const label of ['A ', ' end.']) test(`P1-2: plain text adjacent to bold restores only its own leaf: ${label}`, () => {
  const f = fixture(), original = f.doc.text, span = projectSource(original).spans.find(s => s.text === label);
  const from = label === 'A ' ? span.to - 1 : span.from;
  assert.equal(f.call('edit', { expectedRevision: 0, from, to: from + 1, insert: '' }).ok, true);
  const edited = f.doc.text;
  assert.equal(f.call('undo', { expectedRevision: 1 }).ok, true); assert.equal(f.doc.text, original);
  assert.equal(f.call('redo', { expectedRevision: 2 }).ok, true); assert.equal(f.doc.text, edited);
  assert.equal(projectSource(f.doc.text).spans.find(s => s.bold).text, '粗体中文');
});
