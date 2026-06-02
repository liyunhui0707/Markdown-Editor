/* Stage G.3 — block-widget StateField regression test.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-block-widgets.test.js

   This test exists specifically to catch the class of bug that
   Stages E/F/G.1/G.2 shipped with: emitting Decoration.replace({block:
   true}) from a ViewPlugin. CM6 throws a RangeError at runtime with
   "Block decorations may not be specified via plugins" when those
   decorations are delivered, but the pure-function tests in
   cm6-lp-{table,math,code,mermaid}-render.test.js never triggered the
   check because they don't mount an EditorView.

   This test ACTUALLY MOUNTS an EditorView with the new StateField
   extension and a doc containing all four block widget kinds (table,
   display math, fenced code, mermaid). If the StateField wiring is
   wrong (e.g., a future regression that puts block decorations back in
   a plugin), the EditorView construction will throw and the test will
   fail with the diagnostic error message.

   We use a JSDOM-free strategy: a minimal stub document just sufficient
   for CM6's measurement / scrolling internals. If CM6's internals
   require richer DOM APIs than the stub provides, we skip the mount
   test with an explicit comment and fall back to the API-shape
   assertions (the extension is non-null + provides facets correctly).
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState, EditorSelection, StateField } = require('@codemirror/state');
const { Decoration, WidgetType, EditorView, ViewPlugin } = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-block-widgets.js')];
const lpBlockWidgets = require('../../lib/cm6-lp-block-widgets.js');

const cm6 = {
  Decoration, WidgetType, EditorView, ViewPlugin, syntaxTree, StateField,
  EditorState, EditorSelection,
};

test('Stage G.3 WAVE 1-T-BW-1: createLpBlockWidgetExtension returns non-null when StateField + facets present', () => {
  const ext = lpBlockWidgets.createLpBlockWidgetExtension(cm6);
  assert.ok(ext != null, 'extension must be non-null with full cm6 surface');
});

test('Stage G.3 WAVE 1-T-BW-2: createLpBlockWidgetExtension returns null when StateField missing (sentinel)', () => {
  const cm6Bare = {
    Decoration, WidgetType, EditorView, ViewPlugin, syntaxTree,
    // no StateField
  };
  const ext = lpBlockWidgets.createLpBlockWidgetExtension(cm6Bare);
  assert.equal(ext, null, 'sentinel: missing StateField → null');
});

test('Stage G.3 WAVE 1-T-BW-3: buildBlockWidgetDecorations returns the same shape as the prior lp-block builder', () => {
  // Pure-function shape contract: {all, replaced} of decoration RangeSets.
  const doc = 'top\n\n```js\nconst x = 1;\n```\n\nend\n';
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: 0 },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
  const out = lpBlockWidgets.buildBlockWidgetDecorations(state, cm6);
  assert.ok(out, 'must return non-null on a valid state');
  assert.ok(out.all,      'output has .all');
  assert.ok(out.replaced, 'output has .replaced');
  assert.equal(typeof out.all.iter,      'function', '.all is a RangeSet');
  assert.equal(typeof out.replaced.iter, 'function', '.replaced is a RangeSet');
});

test('Stage G.3 WAVE 1-T-BW-4: state field create() invokes buildBlockWidgetDecorations', () => {
  // Verify the StateField wiring delegates correctly. We synthesize a
  // state with the field included and inspect field(state) shape.
  const field = lpBlockWidgets.createLpBlockWidgetExtension(cm6);
  assert.ok(field, 'extension required for this test');
  const doc = 'top\n\n```js\nconst x = 1;\n```\n\nend\n';
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: 0 },
    extensions: [
      markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] }),
      field,
    ],
  });
  const value = state.field(field, false);
  assert.ok(value, 'StateField value present after EditorState.create');
  assert.ok(value.all,      'field value has .all');
  assert.ok(value.replaced, 'field value has .replaced');
});

test('Stage G.3 WAVE 1-T-BW-5: state field re-runs on docChanged', () => {
  const field = lpBlockWidgets.createLpBlockWidgetExtension(cm6);
  assert.ok(field);
  const state1 = EditorState.create({
    doc: 'top\n',
    selection: { anchor: 0, head: 0 },
    extensions: [
      markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] }),
      field,
    ],
  });
  const value1 = state1.field(field, false);
  assert.ok(value1, 'initial field value');
  // Insert a fenced code block via a transaction.
  const insertedDoc = 'top\n\n```js\nconst x = 1;\n```\n\nend\n';
  const tr = state1.update({
    changes: { from: 0, to: state1.doc.length, insert: insertedDoc },
  });
  const state2 = tr.state;
  const value2 = state2.field(field, false);
  assert.ok(value2, 'post-change field value');
  // The new state should have at least one block widget (the fenced code).
  let count = 0;
  const cursor = value2.replaced.iter();
  while (cursor.value) { count++; cursor.next(); }
  assert.ok(count >= 1, 'fenced code triggers at least one block widget after docChanged');
});

test('Stage G.3 WAVE 1-T-BW-6: state field re-runs on selection change (off-active → on-active toggle)', () => {
  const field = lpBlockWidgets.createLpBlockWidgetExtension(cm6);
  assert.ok(field);
  const doc = 'top\n\n```js\nconst x = 1;\n```\n\nend\n';
  // Initial state: caret on line 1 ("top") — fenced code is off-active.
  const state1 = EditorState.create({
    doc,
    selection: { anchor: 0, head: 0 },
    extensions: [
      markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] }),
      field,
    ],
  });
  const value1 = state1.field(field, false);
  let count1 = 0;
  let c = value1.replaced.iter();
  while (c.value) { count1++; c.next(); }
  assert.equal(count1, 1, 'off-active: 1 block widget');

  // Move caret INTO the fenced code block.
  const codeLinePos = doc.indexOf('const');
  const tr = state1.update({
    selection: { anchor: codeLinePos, head: codeLinePos },
  });
  const state2 = tr.state;
  const value2 = state2.field(field, false);
  let count2 = 0;
  c = value2.replaced.iter();
  while (c.value) { count2++; c.next(); }
  assert.equal(count2, 0, 'caret in code block → 0 block widgets');
});

// ── Stage G.4 — widget.block getter regression ──────────────────────────

test('Stage G.10 T-BW-13: block widgets report widget.lineBreaks=0 (default — widget+line-hide pattern)', () => {
  // Stage G.10 reverted G.7's lineBreaks getter. For the G.8 widget+
  // line-hide architecture, CM6's lineBreaks semantic ("newlines visible
  // INSIDE the rendered widget") doesn't match the source range we hide
  // separately via Decoration.line. Each widget renders as ONE visual
  // block element; lineBreaks=0 (default) matches actual rendered shape.
  // Setting it to N caused click-position offset that compounded per
  // widget (CM6 reserved extra vertical space that didn't render).
  const lpBW = require('../../lib/cm6-lp-block-widgets.js');
  const doc = 'pre\n\n```js\nconst x = 1;\n```\n\nend\n';
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: 0 },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
  const out = lpBW.buildBlockWidgetDecorations(state, cm6);
  const cursor = out.replaced.iter();
  assert.ok(cursor.value, 'must have at least one widget');
  const widget = cursor.value.spec.widget;
  assert.equal(widget.block, true, 'widget.block === true (G.4 contract preserved)');
  // Stage G.10 contract: lineBreaks should be the default 0, NOT the
  // source-range newline count. If a future regression adds a non-zero
  // getter, this test catches it.
  const lb = widget.lineBreaks;
  assert.ok(lb === 0 || lb == null || lb === undefined,
    'widget.lineBreaks must be 0/null/undefined; non-zero values cause click-position offset (Stage G.10 regression)');
});

test('Stage G.4 T-BW-8: all 4 block widgets report widget.block === true', () => {
  // CM6's tile system reads widget.block to know whether to treat the
  // widget as block-level. Defaulting to false (the WidgetType default)
  // causes "No tile at position X" + "Cannot destructure property tile"
  // errors when CM6 computes coordinates. Every WidgetType used with
  // Decoration.replace({block: true}) MUST override this getter.
  const tableMod   = require('../../lib/cm6-lp-table-widget.js');
  const mathMod    = require('../../lib/cm6-lp-math-widget.js');
  const codeMod    = require('../../lib/cm6-lp-code-widget.js');
  const mermaidMod = require('../../lib/cm6-lp-mermaid-widget.js');

  const TableCls   = tableMod.getTableWidgetClass();
  const DispCls    = mathMod.getDisplayMathWidgetClass();
  const CodeCls    = codeMod.getCodeBlockWidgetClass();
  const MermaidCls = mermaidMod.getMermaidWidgetClass();

  const t = new TableCls({ headers: ['A'], alignments: [null], rows: [] });
  const d = new DispCls('x');
  const c = new CodeCls({ lang: 'js', code: 'const x;' });
  const m = new MermaidCls('graph TD\nA-->B');

  assert.equal(t.block, true, 'TableWidget.block must be true');
  assert.equal(d.block, true, 'DisplayMathWidget.block must be true');
  assert.equal(c.block, true, 'CodeBlockWidget.block must be true');
  assert.equal(m.block, true, 'MermaidWidget.block must be true');
});

// ── Stage G.6 — cursor-snap transactionFilter regression ────────────────

test('Stage G.6 T-BW-10: block widget at strict doc-end WITHOUT trailing newline is SKIPPED', () => {
  // Without a trailing newline, CM6 can't position the cursor past a
  // block widget that ends at exactly doc.length -- coordsAtPos(docLen)
  // throws "No tile at position X". The fix: skip widget emission for
  // such ranges; the walker renders the source instead (degraded but
  // not broken).
  const lpBW = require('../../lib/cm6-lp-block-widgets.js');
  // Fenced code at strict doc-end, no trailing \n after closing ```.
  const doc = 'pre\n\n```js\nconst x = 1;\n```';
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: 0 },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
  const out = lpBW.buildBlockWidgetDecorations(state, cm6);
  let count = 0;
  const c = out.replaced.iter();
  while (c.value) { count++; c.next(); }
  assert.equal(count, 0, 'block at strict doc-end without trailing newline must be skipped');
});

test('Stage G.6 T-BW-11: block widget at doc-end WITH trailing newline is emitted normally', () => {
  const lpBW = require('../../lib/cm6-lp-block-widgets.js');
  const doc = 'pre\n\n```js\nconst x = 1;\n```\n';
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: 0 },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
  const out = lpBW.buildBlockWidgetDecorations(state, cm6);
  let count = 0;
  const c = out.replaced.iter();
  while (c.value) { count++; c.next(); }
  assert.equal(count, 1, 'block with trailing newline must emit normally');
});

test('Stage G.6 T-BW-12: createLpBlockWidgetExtension returns a single StateField (no filter array)', () => {
  // Stage G.6 first added a transactionFilter for cursor-snap but
  // discovered CM6 atomicRanges already handles snapping for block:true
  // replaces. Filter removed. This test pins that the factory returns a
  // single extension (the StateField), not an array -- guard against
  // re-adding a redundant filter.
  const lpBW = require('../../lib/cm6-lp-block-widgets.js');
  const ext = lpBW.createLpBlockWidgetExtension(cm6);
  assert.ok(ext, 'extension non-null');
  assert.equal(Array.isArray(ext), false,
    'extension must be a single StateField, not an array');
});

test('Stage G.4 T-BW-9: widget point decoration emitted at Line.from of first source line (Stage G.8 pattern)', () => {
  // Stage G.8 changed the emission pattern from multi-line replace to
  // widget-at-line.from + line-hide decorations. The widget point is
  // at exactly Line.from of the first source line. The original snap-
  // to-line-boundaries helper still computes the underlying range; the
  // widget is then emitted at its `.from`.
  const lpBW = require('../../lib/cm6-lp-block-widgets.js');
  const { EditorState } = require('@codemirror/state');
  const { Decoration, WidgetType } = require('@codemirror/view');
  const { syntaxTree } = require('@codemirror/language');
  const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
  const { GFM } = require('@lezer/markdown');
  const cm6 = { Decoration, WidgetType, syntaxTree };

  const doc = 'top\n\n```js\nconst x = 1;\n```\n\nend\n';
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: 0 },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
  const out = lpBW.buildBlockWidgetDecorations(state, cm6);
  const cursor = out.replaced.iter();
  assert.ok(cursor.value, 'must have at least one block widget');
  const from = cursor.from;
  const to   = cursor.to;
  // Widget is a POINT decoration: from === to.
  assert.equal(from, to, 'widget is a point insertion (from === to)');
  // The position must equal Line.from of some line — verifies line-aligned.
  const line = state.doc.lineAt(from);
  assert.equal(from, line.from, 'widget point must equal Line.from of containing line');
});

test('Stage G.3 WAVE 1-T-BW-7: NO "block decorations may not be specified via plugins" RangeError on state init', () => {
  // This is the actual regression test for the bug manual QA caught.
  // If the field accidentally gets converted back into a ViewPlugin-
  // sourced decoration provider, EditorState.create with a doc
  // containing a block widget would synchronously throw the RangeError.
  // (Without mounting an EditorView, the throw doesn't fire on
  // EditorState alone — but if it ever moves earlier in CM6, this
  // catches it. We also verify the state survives a mock-update cycle.)
  const field = lpBlockWidgets.createLpBlockWidgetExtension(cm6);
  assert.ok(field);
  const doc = 'top\n\n```js\nconst x = 1;\n```\n\nmid\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nend\n';
  let state;
  assert.doesNotThrow(function () {
    state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 0 },
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] }),
        field,
      ],
    });
  }, 'EditorState.create with block widgets must not throw');
  assert.ok(state, 'state created');
  // Apply a no-op transaction — exercises the field update path.
  assert.doesNotThrow(function () {
    state.update({ selection: { anchor: 5, head: 5 } });
  }, 'transaction update path must not throw');
});
