/* TDD: Stage 11.11 — hybrid-cm6 default-readiness coverage with the REAL CM6
   backend (no DOM, no EditorView). Run:
     node --test test/cm6-write-view/hybrid-cm6-readiness.test.js

   Host-integration coverage (engine selection, save payload, dirty / close
   guard / Save All parity, A→B→A note switching) lives next to the renderer
   harness in test/renderer-boot.test.js as the Stage 11.11 section. This file
   covers what the renderer harness can't:
     F.2 — getState/setState round-trip with real CM6 EditorState
     F.3 — selection-only updates do not change the document
     F.4 — building decorations is side-effect free across many edits
     G   — long-document smoke (≥10k lines, mixed constructs)
     H   — architecture invariants on cm6-hybrid-view.js

   Stage 11.11 is tests-only: nothing in this file edits product code paths. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { EditorState }                       = require('@codemirror/state');
const { Decoration }                        = require('@codemirror/view');
const { syntaxTree, ensureSyntaxTree }      = require('@codemirror/language');
const { markdown, markdownLanguage }        = require('@codemirror/lang-markdown');

const { buildHeadingDecorations } = require('../../lib/cm6-hybrid-view');

const cm6 = { Decoration, syntaxTree };

function makeMarkdownState(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
  });
}

function collectMarks(decorationSet) {
  const out = [];
  const cursor = decorationSet.iter();
  while (cursor.value) {
    out.push({ from: cursor.from, to: cursor.to, class: cursor.value.spec && cursor.value.spec.class });
    cursor.next();
  }
  return out;
}

// ── Section F.2: getState/setState round-trip with real CM6 EditorState ────
//
// EditorState.toJSON / fromJSON is the canonical serialization contract. If
// it round-trips a doc that has been live-styled by buildHeadingDecorations,
// any future plugin that holds per-state cached decoration data will survive
// the same round trip the host uses for note-local undo restore.

test('Stage 11.11/F.2: EditorState round-trips through toJSON/fromJSON with markdown extensions', () => {
  const original = '# Hello\n\n**bold** and `code` and [text](https://x.test)\n\n- a\n- b\n\n> quote';
  const state = makeMarkdownState(original);

  const json = state.toJSON();
  const restored = EditorState.fromJSON(
    json,
    { extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })] }
  );

  assert.equal(restored.doc.toString(), original,
    'toJSON/fromJSON must round-trip the document verbatim');

  // Decoration build remains stable across the round trip — same shape, same
  // ranges. This is the proof that note-local state caching is safe.
  const before = collectMarks(buildHeadingDecorations(state, cm6));
  const after  = collectMarks(buildHeadingDecorations(restored, cm6));
  assert.equal(after.length, before.length,
    'decoration count must match before and after EditorState round-trip');
  assert.deepEqual(after.map((m) => ({ from: m.from, to: m.to, c: m.class })),
                   before.map((m) => ({ from: m.from, to: m.to, c: m.class })),
                   'decoration ranges and classes match before and after round-trip');
});

test('Stage 11.11/F.2: state.update() applied edits flow through buildHeadingDecorations cleanly', () => {
  // Use the real CM6 transaction API to apply an edit, then build decorations
  // against the resulting state. This exercises the same code path the
  // ViewPlugin's update() callback runs in production.
  const state0 = makeMarkdownState('plain paragraph');
  const tr     = state0.update({ changes: { from: 0, to: 0, insert: '# ' } });
  const state1 = tr.state;

  assert.equal(state1.doc.toString(), '# plain paragraph',
    'transaction must produce the expected document');

  const marks = collectMarks(buildHeadingDecorations(state1, cm6));
  assert.ok(marks.some((m) => m.class === 'cm-md-h1'),
    'after typing "# " the paragraph must be decorated as h1');
  assert.ok(marks.some((m) => m.class === 'cm-md-heading-mark'),
    'HeaderMark decoration must follow');
});

// ── Section F.3: selection-only changes never alter the document ───────────
//
// The hybrid-cm6 ViewPlugin only rebuilds decorations when docChanged or
// viewportChanged. Selection-only updates pass through unmolested. This test
// pins the underlying invariant — selection updates produce the same doc,
// and decoration build is therefore selection-independent.

test('Stage 11.11/F.3: selection-only state updates do not change the document', () => {
  const state0 = makeMarkdownState('# Heading\n\nbody');
  const tr     = state0.update({ selection: { anchor: 5, head: 5 } });
  const state1 = tr.state;

  assert.equal(state1.doc.toString(), state0.doc.toString(),
    'selection-only update must not modify the document');
  assert.ok(!tr.docChanged, 'transaction must report docChanged=false for selection-only');

  const marks0 = collectMarks(buildHeadingDecorations(state0, cm6));
  const marks1 = collectMarks(buildHeadingDecorations(state1, cm6));
  assert.deepEqual(marks1.map((m) => ({ from: m.from, to: m.to, c: m.class })),
                   marks0.map((m) => ({ from: m.from, to: m.to, c: m.class })),
                   'decoration set must be identical for selection-only updates');
});

// ── Section F.4: many edits in a row leave the doc consistent ─────────────
//
// Cursor-only does-not-fire-onChange is already proved at the adapter layer
// in hybrid-decorations.test.js with a fake backend. Here we use the real CM6
// state machinery to confirm a sequence of small edits keeps the document
// and the decoration set consistent — i.e., decorations are pure observation
// over (state.doc, syntaxTree) and never stash mutable data into the state.

test('Stage 11.11/F.4: repeated edits keep the document and decorations consistent', () => {
  let state = makeMarkdownState('');
  const inserts = ['# ', 'Heading', '\n\n', '**', 'bold', '**', '\n\n', '- ', 'one'];
  let pos = 0;
  for (const ins of inserts) {
    state = state.update({ changes: { from: pos, insert: ins } }).state;
    pos += ins.length;
  }
  const expected = '# Heading\n\n**bold**\n\n- one';
  assert.equal(state.doc.toString(), expected,
    'sequenced inserts must produce the expected document');

  const marks = collectMarks(buildHeadingDecorations(state, cm6));
  assert.ok(marks.some((m) => m.class === 'cm-md-h1'),       'h1 decoration present');
  assert.ok(marks.some((m) => m.class === 'cm-md-bold'),     'bold decoration present');
  assert.ok(marks.some((m) => m.class === 'cm-md-list-mark'),'list-mark decoration present');

  // Re-build twice on the same state and prove the second build matches the
  // first byte-for-byte — guards against any accidental memoization mutating
  // the state under the hood.
  const a = collectMarks(buildHeadingDecorations(state, cm6));
  const b = collectMarks(buildHeadingDecorations(state, cm6));
  assert.deepEqual(b.map((m) => [m.from, m.to, m.class]),
                   a.map((m) => [m.from, m.to, m.class]),
                   'building decorations twice must be deterministic');
});

// ── Section G: long-document smoke ────────────────────────────────────────
//
// We optimize for stability over wall-clock guarantees: assert plausible
// non-empty mark counts AND assert the build returns within a generous
// 5000 ms budget. The budget is large enough to not be flaky on a slow
// CI runner but small enough to catch a catastrophic regression
// (e.g., O(n²) tree walks).

function buildLongMixedDoc(blockCount) {
  const lines = [];
  for (let i = 0; i < blockCount; i++) {
    const level = (i % 6) + 1;
    lines.push('#'.repeat(level) + ' Heading ' + i);
    lines.push('');
    lines.push('Body ' + i + ' has **bold-' + i + '**, *italic-' + i +
               '*, `code-' + i + '`, and [link-' + i + '](https://example.test/' + i + ').');
    lines.push('');
    lines.push('- item-' + i + '.a');
    lines.push('- item-' + i + '.b');
    lines.push('');
    lines.push('> quoted ' + i);
    lines.push('');
    lines.push('```js');
    lines.push('let x' + i + ' = ' + i + ';');
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

test('Stage 11.11/G: long-document smoke — ≥10k lines builds without crashing and produces sane mark counts', () => {
  // 900 blocks × 12 lines ≈ 10 800 lines; mixes every Stage 11.4–11.9 construct.
  const blockCount = 900;
  const doc = buildLongMixedDoc(blockCount);
  const lineCount = doc.split('\n').length;
  assert.ok(lineCount >= 10000,
    'smoke document must be ≥10 000 lines (got ' + lineCount + ')');

  const state = makeMarkdownState(doc);

  // Force a complete parse — Lezer's incremental parser would otherwise yield
  // after a small upfront slice (production fills the rest as the user
  // scrolls, viewport-driven). For a deterministic smoke test we want the
  // full tree so we can assert on stable, shape-of-document mark counts.
  // ensureSyntaxTree returns a fresh full tree but does NOT write it back
  // into state.field, so a plain syntaxTree(state) call would still see a
  // partial tree. We inject a cm6 namespace whose syntaxTree returns the
  // fully-parsed result.
  const fullTree = ensureSyntaxTree(state, doc.length, 30_000);
  assert.ok(fullTree, 'ensureSyntaxTree must complete a full parse within the timeout');
  assert.equal(fullTree.length, doc.length,
    'full tree must span the entire document');
  const cm6Forced = { Decoration, syntaxTree: () => fullTree };

  const t0 = Date.now();
  const set = buildHeadingDecorations(state, cm6Forced);
  const elapsed = Date.now() - t0;

  // Generous budget — not a perf assertion, just a regression guard against
  // a catastrophic O(n²) walk over the now fully-parsed tree. 5000 ms is
  // far more headroom than a healthy implementation needs on CI.
  assert.ok(elapsed < 5000,
    'buildHeadingDecorations on a ~10k-line fully-parsed doc must finish under 5000 ms (got ' + elapsed + ' ms)');

  const marks = collectMarks(set);
  // Each block contributes a stable, predictable mark count once the full
  // parse is in place. The counts below are tight on purpose — they catch a
  // future change that silently drops a construct from the walker.
  assert.equal(marks.filter((m) => /^cm-md-h\d$/.test(m.class)).length, blockCount,
    'one heading container per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-heading-mark').length, blockCount,
    'one HeaderMark per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-bold').length, blockCount,
    'one bold span per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-italic').length, blockCount,
    'one italic span per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-inline-code').length, blockCount,
    'one inline-code span per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-link-text').length, blockCount,
    'one inline link label per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-list-mark').length, 2 * blockCount,
    'two list markers per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-quote-mark').length, blockCount,
    'one quote marker per block');
  assert.equal(marks.filter((m) => m.class === 'cm-md-fenced-code-mark').length, 2 * blockCount,
    'two fence delimiters per block (open + close)');
  assert.equal(marks.filter((m) => m.class === 'cm-md-fenced-code-info').length, blockCount,
    'one code-info range per block');

  // Document text must be byte-identical after decoration build (decorations
  // are pure observation; never rewrite the doc).
  assert.equal(state.doc.toString(), doc,
    'state.doc must be untouched after building decorations on a long doc');
});

test('Stage 11.11/G: long-document smoke — no crash without forcing a full parse', () => {
  // Companion test: under production-like incremental parsing (no
  // ensureSyntaxTree), the call must still return a valid set without
  // throwing. We don't pin counts — partial parses yield partial results,
  // which is exactly the production contract.
  const doc = buildLongMixedDoc(400);
  const state = makeMarkdownState(doc);
  const set = buildHeadingDecorations(state, cm6);
  const marks = collectMarks(set);
  assert.ok(marks.length >= 0, 'must return a valid decoration set without throwing');
  assert.equal(state.doc.toString(), doc,
    'state.doc must be untouched after the partial-parse build');
});

// ── Section H: architecture invariants on cm6-hybrid-view.js ──────────────
//
// heading-marks.test.js #24 already asserts no Decoration.replace / WidgetType
// / HeadingWidget / ParagraphWidget, and #34 asserts no '<a' / 'href'. We add
// a single consolidated guard here so a future Stage that touches the file
// can't drop coverage by removing one of the older tests, and we extend it
// with a "no clickable handler" scan to back up the non-clickable contract.

test('Stage 11.11/H: cm6-hybrid-view.js architecture invariants are intact', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'cm6-hybrid-view.js'),
    'utf8'
  );

  // H.1–H.3: no widgets, no replacement decorations.
  assert.ok(!src.includes('Decoration.replace'), 'must not contain Decoration.replace');
  assert.ok(!src.includes('WidgetType'),         'must not contain WidgetType');
  assert.ok(!src.includes('HeadingWidget'),      'must not contain HeadingWidget');
  assert.ok(!src.includes('ParagraphWidget'),    'must not contain ParagraphWidget');

  // H.4: no anchor tags, no href, no inline-link clickability.
  assert.ok(!src.includes('<a'),    'must not contain "<a" anywhere (no clickable links)');
  assert.ok(!src.includes('href'),  'must not contain "href" anywhere');

  // H.5: no click-handler wiring on link decorations.
  assert.ok(!src.includes("addEventListener('click'"),
    'must not register a click handler');
  assert.ok(!src.includes('addEventListener("click"'),
    'must not register a click handler');
  assert.ok(!/onclick\s*[:=]/.test(src),
    'must not assign an onclick property/handler');

  // Sanity: the file is still meaningfully populated (not accidentally blank).
  assert.ok(src.length > 1000, 'cm6-hybrid-view.js source must still be present');
});
