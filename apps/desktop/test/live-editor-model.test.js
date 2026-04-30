/* TDD: buildHybridRenderModel.
   Run: node --test test/live-editor-model.test.js */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { buildHybridRenderModel } = require('../lib/live-editor');

// ── Helpers ───────────────────────────────────────────────────────────────────

function reconstruct(segments) {
  return segments.map(s => s.raw).join('');
}

function assertReconstructionInvariant(text) {
  const { segments } = buildHybridRenderModel(text, 0);
  assert.equal(reconstruct(segments), text,
    `reconstruction failed for ${JSON.stringify(text)}`);
}

function activeBlocks(segments) {
  return segments.filter(s => s.kind === 'block' && s.isActive);
}

// ── API ───────────────────────────────────────────────────────────────────────

test('buildHybridRenderModel is a function', () => {
  assert.equal(typeof buildHybridRenderModel, 'function');
});

test('returns an object with a segments array', () => {
  const result = buildHybridRenderModel('# Title', 0);
  assert.ok(result && Array.isArray(result.segments));
});

// ── Empty and whitespace ──────────────────────────────────────────────────────

test('empty string returns segments []', () => {
  const { segments } = buildHybridRenderModel('', 0);
  assert.deepEqual(segments, []);
});

test('whitespace-only string returns one gap segment covering the whole source', () => {
  const text = '   \n\n  ';
  const { segments } = buildHybridRenderModel(text, 0);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].kind, 'gap');
  assert.equal(segments[0].raw, text);
});

test('whitespace-only reconstruction equals input', () => {
  assertReconstructionInvariant('   \n\n  ');
});

// ── Reconstruction invariant ──────────────────────────────────────────────────

test('reconstruction invariant: single heading', () => {
  assertReconstructionInvariant('# Title');
});

test('reconstruction invariant: heading with trailing newline', () => {
  assertReconstructionInvariant('# Title\n');
});

test('reconstruction invariant: heading + blank + paragraph', () => {
  assertReconstructionInvariant('# Title\n\nParagraph text.');
});

test('reconstruction invariant: multiple blank lines between paragraphs', () => {
  assertReconstructionInvariant('Para one.\n\n\n\nPara two.');
});

test('reconstruction invariant: full multi-block document', () => {
  assertReconstructionInvariant(
    '# Title\n\nParagraph text.\n\n- item one\n- item two\n\n> quote\n\n```js\ncode();\n```'
  );
});

test('reconstruction invariant: CRLF document', () => {
  assertReconstructionInvariant('# Title\r\n\r\nParagraph.\r\n\r\n- item');
});

// ── Segment coverage ──────────────────────────────────────────────────────────

test('segments are ordered by start and non-overlapping', () => {
  const text = '# Title\n\nParagraph.\n\n- list item';
  const { segments } = buildHybridRenderModel(text, 0);
  for (let i = 1; i < segments.length; i++) {
    assert.ok(segments[i].start >= segments[i - 1].end,
      `segment ${i} overlaps segment ${i - 1}`);
  }
});

test('segments cover the full document without gaps', () => {
  const text = '# Title\n\nParagraph text.';
  const { segments } = buildHybridRenderModel(text, 0);
  let prev = 0;
  for (const s of segments) {
    assert.equal(s.start, prev, `gap before segment at ${s.start}`);
    prev = s.end;
  }
  assert.equal(prev, text.length, 'segments do not reach end of document');
});

// ── Slice invariant on segments ───────────────────────────────────────────────

test('every segment satisfies text.slice(start, end) === raw', () => {
  const text = '# Title\n\nParagraph.\n\n- item one\n- item two';
  const { segments } = buildHybridRenderModel(text, 5);
  for (const s of segments) {
    assert.equal(text.slice(s.start, s.end), s.raw,
      `slice invariant failed for segment at ${s.start}..${s.end}`);
  }
});

// ── isActive logic ────────────────────────────────────────────────────────────

test('cursor inside paragraph: only that paragraph isActive', () => {
  const text    = '# Title\n\nHello world.\n\n- item';
  const paraStart = text.indexOf('Hello');
  const { segments } = buildHybridRenderModel(text, paraStart + 3);
  const active = activeBlocks(segments);
  assert.equal(active.length, 1);
  assert.equal(active[0].type, 'paragraph');
});

test('cursor on blank separator: zero blocks are isActive', () => {
  const text = '# Title\n\nParagraph.';
  // '\n' after heading is offset 8
  const { segments } = buildHybridRenderModel(text, 8);
  assert.equal(activeBlocks(segments).length, 0);
});

test('cursor inside fenced code: only that code_fence is isActive', () => {
  const text = '```\ncode here\n```';
  const { segments } = buildHybridRenderModel(text, 6);
  const active = activeBlocks(segments);
  assert.equal(active.length, 1);
  assert.equal(active[0].type, 'code_fence');
});

test('cursor inside a list item: entire list block isActive', () => {
  const text = '- item one\n- item two';
  const { segments } = buildHybridRenderModel(text, 3);
  const active = activeBlocks(segments);
  assert.equal(active.length, 1);
  assert.equal(active[0].type, 'list');
  assert.equal(active[0].raw, text);
});

test('other blocks are isActive false when one is active', () => {
  const text = '# Title\n\nParagraph.\n\n- item';
  const paraStart = text.indexOf('Paragraph');
  const { segments } = buildHybridRenderModel(text, paraStart + 2);
  const blockSegs = segments.filter(s => s.kind === 'block');
  const inactive = blockSegs.filter(s => !s.isActive);
  assert.ok(inactive.length > 0);
  for (const s of inactive) {
    assert.equal(s.isActive, false);
  }
});

test('cursor at EOF without trailing newline: last block isActive', () => {
  const text = '# Title\n\nParagraph.';
  const { segments } = buildHybridRenderModel(text, text.length);
  const active = activeBlocks(segments);
  assert.equal(active.length, 1);
  assert.equal(active[0].type, 'paragraph');
});

test('cursor at EOF with trailing whitespace gap: zero blocks isActive (bug regression)', () => {
  // "# T\n\n  ": cursor at EOF is inside the trailing gap, not the heading block.
  const text = '# T\n\n  ';
  const { segments } = buildHybridRenderModel(text, text.length);
  assert.equal(activeBlocks(segments).length, 0);
});

test('cursor at EOF with CRLF trailing whitespace gap: zero blocks isActive', () => {
  const text = '# T\r\n\r\n  ';
  const { segments } = buildHybridRenderModel(text, text.length);
  assert.equal(activeBlocks(segments).length, 0);
});

// ── Schema closure — no derived/generated HTML ────────────────────────────────

test('block segments have exactly the documented keys (no more, no less)', () => {
  const expected = ['end', 'isActive', 'kind', 'raw', 'start', 'type'];
  const text = '# Title\n\nParagraph.';
  const { segments } = buildHybridRenderModel(text, 0);
  for (const s of segments.filter(s => s.kind === 'block')) {
    assert.deepEqual(Object.keys(s).sort(), expected,
      `block segment at ${s.start} has wrong keys`);
  }
});

test('gap segments have exactly the documented keys (no more, no less)', () => {
  const expected = ['end', 'kind', 'raw', 'start'];
  const text = '# Title\n\nParagraph.';
  const { segments } = buildHybridRenderModel(text, 0);
  for (const s of segments.filter(s => s.kind === 'gap')) {
    assert.deepEqual(Object.keys(s).sort(), expected,
      `gap segment at ${s.start} has wrong keys`);
  }
});

test('no segment contains a generated HTML field', () => {
  const text = '# Title\n\nParagraph.';
  const { segments } = buildHybridRenderModel(text, 0);
  for (const s of segments) {
    assert.ok(!('html' in s), 'segment has unexpected html field');
    assert.ok(!('rendered' in s), 'segment has unexpected rendered field');
    assert.ok(!('dom' in s), 'segment has unexpected dom field');
  }
});

test('raw HTML in source passes through segment raw unchanged', () => {
  const text = 'Hello <div>world</div> there.';
  const { segments } = buildHybridRenderModel(text, 0);
  const blockSeg = segments.find(s => s.kind === 'block');
  assert.ok(blockSeg, 'expected at least one block segment');
  assert.ok(blockSeg.raw.includes('<div>'), 'raw HTML should pass through');
  assert.ok(!blockSeg.raw.includes('&lt;'), 'raw should not be HTML-escaped');
});
