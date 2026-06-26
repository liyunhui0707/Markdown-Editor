'use strict';

/* tiptap-image-paste — detect a PURE-image transfer (files/items, no text) and route
   each blob to the vault, inserting a REFERENCE (never base64). Oversized/rejected
   images still mark the transfer `pure` so the caller consumes the event (no base64
   fallthrough). Mixed image+text and pure-text pastes are NOT intercepted. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectImageTransfer, handleImageDataTransfer, isDataUriSrc } = require('../lib/tiptap-image-paste.js');

function fakeFile(type, name, bytes, size) {
  const arr = new Uint8Array(bytes || [1, 2, 3]);
  return { type, name: name || 'x', size: (size != null ? size : arr.length), arrayBuffer: () => Promise.resolve(arr.buffer) };
}
function dt({ files, items, types, html, text }) {
  const t = types || (files || items ? ['Files'] : (html ? ['text/html'] : (text ? ['text/plain'] : [])));
  return {
    files: files || null,
    items: items || null,
    types: t,
    getData: (k) => (k === 'text/html' ? (html || '') : (k === 'text/plain' ? (text || '') : '')),
  };
}

// ── detectImageTransfer ─────────────────────────────────────────────────────

test('pure raster file (no text) -> pure=true, only the image blob', () => {
  const r = detectImageTransfer(dt({ files: [fakeFile('image/png'), fakeFile('text/plain')] }));
  assert.equal(r.pure, true);
  assert.equal(r.blobs.length, 1);
  assert.equal(r.blobs[0].mime, 'image/png');
});

test('items.getAsFile() (screenshots arrive here) -> pure=true', () => {
  const f = fakeFile('image/png', 'shot');
  const items = [{ kind: 'file', type: 'image/png', getAsFile: () => f }, { kind: 'string', type: 'text/plain', getAsFile: () => null }];
  const r = detectImageTransfer(dt({ items }));
  assert.equal(r.pure, true);
  assert.equal(r.blobs.length, 1);
});

test('same File in .items and .files -> not double-counted (items preferred)', () => {
  const f = fakeFile('image/png', 'same', [9, 9]);
  const r = detectImageTransfer(dt({ files: [f], items: [{ kind: 'file', type: 'image/png', getAsFile: () => f }] }));
  assert.equal(r.blobs.length, 1);
});

test('distinct images with the SAME name/size/mime are both kept (identity dedup)', () => {
  const a = fakeFile('image/png', 'shot', [1], 100);
  const b = fakeFile('image/png', 'shot', [2], 100); // same metadata, different object
  const r = detectImageTransfer(dt({ files: [a, b] }));
  assert.equal(r.blobs.length, 2, 'distinct objects must not be collapsed');
});

test('image + accompanying text -> pure=false (do not consume; no text loss)', () => {
  const r = detectImageTransfer(dt({ files: [fakeFile('image/png')], types: ['Files', 'text/plain'], text: 'hello' }));
  assert.equal(r.pure, false);
});

test('data:image in HTML alongside text (DEFERRED) -> pure=false (falls through)', () => {
  const b64 = Buffer.from([1, 2, 3]).toString('base64');
  const r = detectImageTransfer(dt({ html: '<p>hi</p><img src="data:image/png;base64,' + b64 + '">' }));
  assert.equal(r.pure, false);
  assert.deepEqual(r.blobs, []);
});

test('plain text / empty -> pure=false', () => {
  assert.equal(detectImageTransfer(dt({ text: 'x' })).pure, false);
  assert.equal(detectImageTransfer(dt({})).pure, false);
});

test('oversized File -> pure=true (image present) but blobs=[] (so the event is consumed, NOT inlined)', () => {
  const r = detectImageTransfer(dt({ files: [fakeFile('image/png', 'big', [1], 21 * 1024 * 1024)] }));
  assert.equal(r.pure, true, 'still pure so the caller consumes the event -> no base64');
  assert.deepEqual(r.blobs, [], 'oversized image dropped');
});

test('caps accepted images per paste at 20', () => {
  const files = [];
  for (let i = 0; i < 30; i++) files.push(fakeFile('image/png', 'f' + i, [i], 10));
  const r = detectImageTransfer(dt({ files }));
  assert.equal(r.blobs.length, 20);
});

// ── handleImageDataTransfer ─────────────────────────────────────────────────

test('handleImageDataTransfer: saves each blob + inserts a REFERENCE (never base64), advancing positions', async () => {
  const saved = [];
  const inserts = [];
  const blobs = [
    { mime: 'image/png', getBytes: () => Promise.resolve(new Uint8Array([1])) },
    { mime: 'image/jpeg', getBytes: () => Promise.resolve(new Uint8Array([2])) },
  ];
  const handled = await handleImageDataTransfer({
    blobs,
    getNoteDir: () => 'notes/sub',
    saveImageToVault: (noteDir, bytes, mime) => { saved.push([noteDir, Array.from(bytes), mime]); return Promise.resolve({ ok: true, relPath: './assets/' + mime.split('/')[1] + '.x' }); },
    insertImageAt: (relPath, pos) => inserts.push([relPath, pos]),
  }, { pos: 5 });

  assert.equal(handled, 2);
  assert.deepEqual(saved, [['notes/sub', [1], 'image/png'], ['notes/sub', [2], 'image/jpeg']]);
  assert.deepEqual(inserts, [['./assets/png.x', 5], ['./assets/jpeg.x', 6]]);
  assert.equal(JSON.stringify(inserts).includes('data:'), false);
});

test('handleImageDataTransfer: save reject -> no insert', async () => {
  const inserts = [];
  await handleImageDataTransfer({
    blobs: [{ mime: 'image/png', getBytes: () => Promise.resolve(new Uint8Array([1])) }],
    getNoteDir: () => '',
    saveImageToVault: () => Promise.resolve({ ok: false, reason: 'too-large' }),
    insertImageAt: (relPath, pos) => inserts.push([relPath, pos]),
  }, { pos: 0 });
  assert.deepEqual(inserts, []);
});

test('handleImageDataTransfer: note switched (SAME dir) mid-save -> aborts via getNoteId, no wrong-note insert', async () => {
  const inserts = [];
  let noteId = 'notes/a.md';
  await handleImageDataTransfer({
    blobs: [{ mime: 'image/png', getBytes: () => Promise.resolve(new Uint8Array([1])) }],
    getNoteDir: () => 'notes',        // unchanged — both notes live in notes/
    getNoteId: () => noteId,          // the FULL path is what changes on switch
    // The save "resolves" after the user navigated to a sibling note in the same dir.
    saveImageToVault: () => { noteId = 'notes/b.md'; return Promise.resolve({ ok: true, relPath: './assets/x.png' }); },
    insertImageAt: (relPath, pos) => inserts.push([relPath, pos]),
  }, { pos: 3 });
  assert.deepEqual(inserts, [], 'getNoteDir alone is equal; getNoteId must catch the switch');
});

test('handleImageDataTransfer: getNoteId falls back to getNoteDir when not supplied', async () => {
  const inserts = [];
  let dir = 'notes/a';
  await handleImageDataTransfer({
    blobs: [{ mime: 'image/png', getBytes: () => Promise.resolve(new Uint8Array([1])) }],
    getNoteDir: () => dir,
    saveImageToVault: () => { dir = 'notes/b'; return Promise.resolve({ ok: true, relPath: './assets/x.png' }); },
    insertImageAt: (relPath, pos) => inserts.push([relPath, pos]),
  }, { pos: 0 });
  assert.deepEqual(inserts, [], 'no getNoteId -> still guards on getNoteDir');
});

// ── isDataUriSrc (transformPasted slice defense) ────────────────────────────

test('isDataUriSrc flags data: URIs incl. mixed-case + leading whitespace; rejects safe srcs', () => {
  // The HTML parser has ALREADY decoded entities by the time the slice is walked,
  // so `data&#58;image...` arrives here as `data:image...`.
  assert.equal(isDataUriSrc('data:image/png;base64,AAAA'), true);
  assert.equal(isDataUriSrc('DATA:image/png;base64,AAAA'), true);   // mixed case
  assert.equal(isDataUriSrc('  data:image/gif;base64,AAAA'), true); // leading whitespace
  assert.equal(isDataUriSrc('./assets/x.png'), false);
  assert.equal(isDataUriSrc('https://x/y.png'), false);
  assert.equal(isDataUriSrc(''), false);
  assert.equal(isDataUriSrc(null), false);
  assert.equal(isDataUriSrc(undefined), false);
});

test('handleImageDataTransfer: getBytes throw -> skipped, others still handled', async () => {
  const inserts = [];
  const handled = await handleImageDataTransfer({
    blobs: [
      { mime: 'image/png', getBytes: () => Promise.reject(new Error('boom')) },
      { mime: 'image/png', getBytes: () => Promise.resolve(new Uint8Array([2])) },
    ],
    getNoteDir: () => '',
    saveImageToVault: () => Promise.resolve({ ok: true, relPath: './assets/a.png' }),
    insertImageAt: (relPath, pos) => inserts.push([relPath, pos]),
  }, { pos: 0 });
  assert.equal(handled, 1);
  assert.deepEqual(inserts, [['./assets/a.png', 0]]);
});
