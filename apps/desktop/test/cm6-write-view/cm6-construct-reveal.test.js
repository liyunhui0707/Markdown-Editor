/* Stage 28 — multi-line construct expansion tests.
   Run focused:
     node --test test/cm6-write-view/cm6-construct-reveal.test.js

   Module under test: apps/desktop/lib/cm6-construct-reveal.js (created
   in Batch 2). Tests use lazy require() inside each test body so a
   missing module file surfaces per-test, not at load time.

   Test groups (per rev-3 plan):
     A — resolveTouchedLines parity                28-1, 28-2
     B — findActiveConstructs + builder dedup      28-3..28-6, 28-22,
                                                   28-23, 28-25, 28-26
     C — buildConstructActiveDecorations           28-7..28-10
     D — createConstructRevealExtension            28-11..28-13, 28-24
     E — walker hook integration                   28-14, 28-15
     G — performance                               28-19, 28-20

   Group F (peer-contract + CSS + script-tag invariants) lives in
   cm6-construct-reveal-invariants.test.js.

   Tests 28-22, 28-23, 28-25, 28-26 use the REAL Markdown parser per
   rev-3 plan: cm6.EditorState.create({doc, extensions: [cm6.markdown()]})
   + cm6.syntaxTree(state). Other Group B/C/D tests use a fake cm6 with
   a hand-built tree-like API to control inputs precisely. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const CONSTRUCT_REL = '../../lib/cm6-construct-reveal.js';
const HYBRID_REL    = '../../lib/cm6-hybrid-view.js';

// ── Lazy loaders ─────────────────────────────────────────────────────────

function loadConstructRevealModule() {
  delete require.cache[require.resolve(CONSTRUCT_REL)];
  return require(CONSTRUCT_REL);
}

function loadHybridViewModule() {
  delete require.cache[require.resolve(HYBRID_REL)];
  return require(HYBRID_REL);
}

// Loads the production cm6 bundle. Same shape as task-toggle.test.js.
function loadCm6Bundle() {
  if (!global.window) global.window = {};
  if (!global.window.CM6Production) {
    require('../../lib/cm6-bundle.js');
  }
  return global.window.CM6Production;
}

// Real state + tree from the production bundle. Used by 28-22, 28-23,
// 28-25, 28-26 + Group G perf.
function buildRealStateAndTree(doc) {
  const cm6 = loadCm6Bundle();
  const state = cm6.EditorState.create({ doc, extensions: [cm6.markdown()] });
  const tree = cm6.syntaxTree(state);
  return { cm6, state, tree };
}

// ── fakeDoc with precomputed line metadata (mirrors Stage 26's pattern) ──

function makeFakeDoc(text) {
  const str = String(text);
  const lines = [];
  let from = 0;
  for (let i = 0; i <= str.length; i++) {
    if (i === str.length || str.charCodeAt(i) === 10) {
      lines.push({ number: lines.length + 1, from, to: i, text: str.slice(from, i) });
      from = i + 1;
    }
  }
  if (lines.length === 0) lines.push({ number: 1, from: 0, to: 0, text: '' });
  const fromOffsets = lines.map((l) => l.from);
  return {
    length: str.length,
    toString() { return str; },
    sliceString(f, t) { return str.slice(f, t); },
    get lines() { return lines.length; },
    line(n) {
      if (n < 1 || n > lines.length) throw new RangeError('line ' + n + ' out of range');
      return lines[n - 1];
    },
    lineAt(pos) {
      if (lines.length === 1) return lines[0];
      let lo = 0, hi = fromOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (fromOffsets[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lines[lo];
    },
  };
}

// Hand-built tree iterator used for Group B tests 28-3..28-6 to control
// inputs precisely. Real-parser tests (28-22, 28-23, 28-25, 28-26) use
// the production parser via buildRealStateAndTree.
function makeFakeTree(nodes) {
  return {
    iterate(spec) {
      for (const n of nodes) {
        spec.enter({
          name: n.name,
          from: n.from,
          to: n.to,
          type: { name: n.name },
        });
      }
    },
  };
}

// ── fakeCm6 — Decoration.line + Decoration.set + ViewPlugin + EditorView ──

function makeFakeCm6(capture) {
  capture = capture || {};
  const calls = capture.calls = (capture.calls || { viewPluginFromClass: 0 });

  function flatten(arr) {
    const out = [];
    for (const e of (arr || [])) {
      if (Array.isArray(e)) out.push(...flatten(e));
      else if (e != null) out.push(e);
    }
    return out;
  }

  const Decoration = {
    line(spec) {
      const dec = { _kind: 'line', spec };
      dec.range = (pos) => ({ from: pos, value: dec });
      return dec;
    },
    mark(spec) {
      const dec = { _kind: 'mark', spec };
      dec.range = (from, to) => ({ from, to, value: dec });
      return dec;
    },
    set(arr, sorted) {
      const items = [...(arr || [])];
      return {
        _ranges: items,
        get size() { return items.length; },
        iter() {
          let i = 0;
          return {
            get value() { return i < items.length ? items[i].value : null; },
            get from()  { return i < items.length ? items[i].from  : -1; },
            next() { i++; },
          };
        },
        _sortedFlag: !!sorted,
      };
    },
  };

  const ViewPlugin = {
    fromClass(pluginClass, spec) {
      calls.viewPluginFromClass++;
      return { _kind: 'viewPlugin', _ref: { cls: pluginClass, spec } };
    },
  };

  const EditorState = {
    create({ doc, extensions = [] }) {
      const flat = flatten(extensions);
      capture.lastExtensions = flat;
      return {
        doc: makeFakeDoc(typeof doc === 'string' ? doc : ''),
        selection: { main: { head: 0, anchor: 0 }, ranges: [{ from: 0, to: 0 }] },
        _extensions: flat,
        _listeners:  flat.filter((e) => e && e._kind === 'updateListener').map((e) => e.fn),
      };
    },
  };

  class EditorView {
    constructor({ state, parent }) { this.state = state; this.parent = parent; this.composing = false; }
    dispatch() { /* no-op */ }
    setState(newState) { this.state = newState; }
    destroy() {}
    focus()   {}
  }
  EditorView.updateListener   = { of(fn) { return { _kind: 'updateListener', fn }; } };
  EditorView.lineWrapping     = { _kind: 'lineWrapping' };
  EditorView.domEventHandlers = function (h) { return { _kind: 'domEventHandlers', handlers: h }; };

  // Pluggable syntaxTree — tests override per-case.
  function syntaxTree(_state) { return null; }

  return {
    EditorState, EditorView,
    Decoration, ViewPlugin,
    history:  () => ({ _kind: 'history' }),
    markdown: () => ({ _kind: 'markdown' }),
    chrome:   null,
    RangeSetBuilder: class { constructor() { this._spans = []; } add(f, t, v) { this._spans.push({ from: f, to: t, value: v }); } finish() { return { _ranges: this._spans, size: this._spans.length }; } },
    Annotation: { define() { return () => {}; } },
    syntaxTree,
    keymap:   { of(specs) { return { _kind: 'keymap', specs }; } },
  };
}

function makeFakeParent() { return { _isParent: true, appendChild() {}, remove() {} }; }

// ── Snapshot/restore ALL FOUR optional walker-hook globals ──

function snapshotWalkerHookGlobals() {
  return {
    Cm6ActiveRange:     globalThis.Cm6ActiveRange,
    Cm6TaskToggle:      globalThis.Cm6TaskToggle,
    Cm6LinkClick:       globalThis.Cm6LinkClick,
    Cm6ConstructReveal: globalThis.Cm6ConstructReveal,
  };
}

function restoreWalkerHookGlobals(snap) {
  for (const key of ['Cm6ActiveRange', 'Cm6TaskToggle', 'Cm6LinkClick', 'Cm6ConstructReveal']) {
    if (Object.prototype.hasOwnProperty.call(snap, key) && snap[key] !== undefined) {
      globalThis[key] = snap[key];
    } else {
      delete globalThis[key];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Group A — resolveTouchedLines parity (28-1, 28-2)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 28-1: resolveTouchedLines single-range selection over lines 2-3 → [2, 3]', () => {
  const { resolveTouchedLines } = loadConstructRevealModule();
  const doc = makeFakeDoc('a\nbb\nccc\ndddd\nee');
  const out = resolveTouchedLines({ ranges: [{ from: 2, to: 7 }] }, doc);
  assert.deepEqual(out, [2, 3]);
});

test('Stage 28-2: resolveTouchedLines multi-range produces sorted, deduplicated union', () => {
  const { resolveTouchedLines } = loadConstructRevealModule();
  const doc = makeFakeDoc('l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10');
  const out = resolveTouchedLines({ ranges: [{ from: 4, to: 7 }, { from: 16, to: 22 }] }, doc);
  assert.deepEqual(out, [2, 3, 6, 7, 8]);
});

// ─────────────────────────────────────────────────────────────────────────
// Group B — findActiveConstructs (28-3..28-6 fake tree; 28-22, 28-23,
// 28-25, 28-26 real parser; 28-26 also exercises builder dedup)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 28-3: findActiveConstructs returns 1 entry for fenced code when body line touched (fake tree)', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  // doc: lines 1-3 = ```js / body / ```
  const doc = makeFakeDoc('```js\nbody\n```\n');
  // Fenced code spans 0..14 inclusive of trailing newline; line 1 starts at 0, line 3 ends at 14.
  const tree = makeFakeTree([
    { name: 'FencedCode', from: 0, to: 14 },
  ]);
  const out = findActiveConstructs(tree, doc, new Set([2]));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'FencedCode');
  assert.equal(out[0].fromLine, 1);
  // toLine uses Math.max(from, to-1) — endPos=13 → line 3.
  assert.equal(out[0].toLine, 3);
});

test('Stage 28-4: findActiveConstructs returns 1 Blockquote entry spanning 2 touched lines', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  const doc = makeFakeDoc('> first\n> second\n\nplain\n');
  const tree = makeFakeTree([
    { name: 'Blockquote', from: 0, to: 16 },
  ]);
  const out = findActiveConstructs(tree, doc, new Set([1]));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'Blockquote');
  assert.equal(out[0].fromLine, 1);
  assert.equal(out[0].toLine, 2);
});

test('Stage 28-5: findActiveConstructs returns empty array when touched line outside any construct', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  const doc = makeFakeDoc('plain one\nplain two\n');
  const tree = makeFakeTree([]);
  const out = findActiveConstructs(tree, doc, new Set([1, 2]));
  assert.deepEqual(out, []);
});

test('Stage 28-6: findActiveConstructs returns both entries when two fenced code blocks are touched', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  // line 1: ```\n line 2: a\n line 3: ```\n line 4: \n line 5: ```\n line 6: b\n line 7: ```\n
  const doc = makeFakeDoc('```\na\n```\n\n```\nb\n```\n');
  const tree = makeFakeTree([
    { name: 'FencedCode', from: 0, to: 10 },
    { name: 'FencedCode', from: 11, to: 21 },
  ]);
  const out = findActiveConstructs(tree, doc, new Set([2, 6]));
  assert.equal(out.length, 2);
  assert.equal(out[0].fromLine, 1);
  assert.equal(out[1].fromLine, 5);
});

test('Stage 28-22: findActiveConstructs (real parser) skips fence inside YAML frontmatter; returns only real fence after closing ---', () => {
  // Top-of-file strict frontmatter containing fence-shaped text; then a real fence below.
  const fixture =
    '---\n' +
    '> not a quote\n' +
    '```\n' +
    'not a real fence\n' +
    '```\n' +
    '---\n' +
    '\n' +
    '```js\n' +
    'real body\n' +
    '```\n';
  const { state, tree } = buildRealStateAndTree(fixture);
  const { findActiveConstructs, resolveTouchedLines } = loadConstructRevealModule();
  // Caret on the real-fence body line (line 9).
  const realBodyLine = state.doc.line(9);
  const touched = new Set(resolveTouchedLines({ ranges: [{ from: realBodyLine.from, to: realBodyLine.from }] }, state.doc));
  const constructs = findActiveConstructs(tree, state.doc, touched);
  assert.equal(constructs.length, 1, 'exactly one construct returned — the real fence, not the frontmatter-internal one');
  assert.equal(constructs[0].type, 'FencedCode');
  // Real fence spans lines 8..10.
  assert.equal(constructs[0].fromLine, 8);
  assert.equal(constructs[0].toLine, 10);
});

test('Stage 28-23: findActiveConstructs (real parser) — fenced code followed by a paragraph does NOT bleed into the paragraph line (F3 half-open fix)', () => {
  // Lines 1-3 = ```\n body \n```  ;  line 4 = plain paragraph.
  const fixture = '```\nbody\n```\nplain after\n';
  const { state, tree } = buildRealStateAndTree(fixture);
  const { findActiveConstructs, resolveTouchedLines } = loadConstructRevealModule();
  const bodyLine = state.doc.line(2);
  const touched = new Set(resolveTouchedLines({ ranges: [{ from: bodyLine.from, to: bodyLine.from }] }, state.doc));
  const constructs = findActiveConstructs(tree, state.doc, touched);
  assert.equal(constructs.length, 1);
  assert.equal(constructs[0].type, 'FencedCode');
  assert.equal(constructs[0].fromLine, 1, 'fence opens at line 1');
  assert.equal(constructs[0].toLine, 3, 'fence ends at line 3 (NOT line 4 — Math.max(node.from, node.to-1) clamp prevents bleed)');
});

test('Stage 28-25: findActiveConstructs (real parser) — leading --- with no closing --- means NO frontmatter region; constructs after the lone --- are NOT suppressed', () => {
  // Leading --- but no later ---. Constructs after should NOT be skipped.
  const fixture =
    '---\n' +
    'still part of body\n' +
    '\n' +
    '```js\n' +
    'real body\n' +
    '```\n';
  const { state, tree } = buildRealStateAndTree(fixture);
  const { findActiveConstructs, resolveTouchedLines } = loadConstructRevealModule();
  // Caret on the fence body — line 5.
  const fenceBody = state.doc.line(5);
  const touched = new Set(resolveTouchedLines({ ranges: [{ from: fenceBody.from, to: fenceBody.from }] }, state.doc));
  const constructs = findActiveConstructs(tree, state.doc, touched);
  assert.ok(constructs.length >= 1, 'at least one construct returned — the real fence is NOT suppressed by a non-frontmatter leading ---');
  const fence = constructs.find((c) => c.type === 'FencedCode');
  assert.ok(fence, 'expected a FencedCode entry');
});

test('Stage 28-26: buildConstructActiveDecorations (real parser) — nested fence inside blockquote dedups line decorations (each active line gets exactly one cm-md-construct-active)', () => {
  // Blockquote with fenced code inside: 3 lines, all `>` prefixed.
  const fixture = '> ```\n> code\n> ```\n';
  const { state, tree, cm6 } = buildRealStateAndTree(fixture);
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  // Caret on middle line.
  const middle = state.doc.line(2);
  const stateWithSel = Object.assign({}, state, {
    selection: { ranges: [{ from: middle.from, to: middle.from }] },
  });
  const decorations = buildConstructActiveDecorations(stateWithSel, cm6, tree);
  assert.ok(decorations, 'returns decoration set, not null');
  // Iterate the decoration set; collect line numbers.
  const seenFroms = [];
  const iter = decorations.iter ? decorations.iter() : null;
  if (iter) {
    while (iter.value) {
      seenFroms.push(iter.from);
      iter.next();
    }
  } else if (decorations._ranges) {
    for (const r of decorations._ranges) seenFroms.push(r.from);
  }
  // Should be exactly 3 entries (lines 1, 2, 3), no duplicates, sorted ascending.
  assert.equal(seenFroms.length, 3, 'exactly 3 line decorations (one per line of the overlapping range)');
  const sorted = [...seenFroms].sort((a, b) => a - b);
  assert.deepEqual(seenFroms, sorted, 'froms are sorted ascending');
  assert.equal(new Set(seenFroms).size, seenFroms.length, 'froms are unique');
});

// ─────────────────────────────────────────────────────────────────────────
// Group C — buildConstructActiveDecorations (28-7..28-10)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 28-7: buildConstructActiveDecorations yields one entry per line of each active construct', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const cm6 = makeFakeCm6();
  // 3-line fenced code: lines 1..3.
  const doc = makeFakeDoc('```\nbody\n```\n');
  const tree = makeFakeTree([{ name: 'FencedCode', from: 0, to: 12 }]);
  const state = {
    doc,
    selection: { ranges: [{ from: doc.line(2).from, to: doc.line(2).from }] },
  };
  const result = buildConstructActiveDecorations(state, cm6, tree);
  assert.ok(result, 'returns decoration set');
  assert.equal(result._ranges.length, 3, 'one decoration per line of the active construct');
});

test('Stage 28-8: every emitted decoration has class === "cm-md-construct-active"', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const cm6 = makeFakeCm6();
  const doc = makeFakeDoc('```\nbody\n```\n');
  const tree = makeFakeTree([{ name: 'FencedCode', from: 0, to: 12 }]);
  const state = { doc, selection: { ranges: [{ from: doc.line(2).from, to: doc.line(2).from }] } };
  const result = buildConstructActiveDecorations(state, cm6, tree);
  for (const entry of result._ranges) {
    assert.equal(entry.value.spec.class, 'cm-md-construct-active');
  }
});

test('Stage 28-9: each entry from === state.doc.line(n).from for the corresponding line n', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const cm6 = makeFakeCm6();
  const doc = makeFakeDoc('```\nbody\n```\n');
  const tree = makeFakeTree([{ name: 'FencedCode', from: 0, to: 12 }]);
  const state = { doc, selection: { ranges: [{ from: doc.line(2).from, to: doc.line(2).from }] } };
  const result = buildConstructActiveDecorations(state, cm6, tree);
  const expectedFroms = [doc.line(1).from, doc.line(2).from, doc.line(3).from];
  const actualFroms = result._ranges.map((r) => r.from);
  assert.deepEqual(actualFroms, expectedFroms);
});

test('Stage 28-10: buildConstructActiveDecorations returns null when cm6.Decoration.line OR Decoration.set is missing', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const doc = makeFakeDoc('```\nbody\n```\n');
  const state = { doc, selection: { ranges: [{ from: 0, to: 0 }] } };
  // (i) cm6 null
  assert.equal(buildConstructActiveDecorations(state, null, null), null);
  // (ii) Decoration.line missing
  const cm6NoLine = makeFakeCm6();
  delete cm6NoLine.Decoration.line;
  assert.equal(buildConstructActiveDecorations(state, cm6NoLine, null), null);
  // (iii) Decoration.set missing
  const cm6NoSet = makeFakeCm6();
  delete cm6NoSet.Decoration.set;
  assert.equal(buildConstructActiveDecorations(state, cm6NoSet, null), null);
});

// ─────────────────────────────────────────────────────────────────────────
// Group D — createConstructRevealExtension (28-11..28-13, 28-24)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 28-11: createConstructRevealExtension returns a ViewPlugin extension when given valid cm6', () => {
  const { createConstructRevealExtension } = loadConstructRevealModule();
  const cap = { calls: { viewPluginFromClass: 0 } };
  const cm6 = makeFakeCm6(cap);
  const ext = createConstructRevealExtension(cm6);
  assert.ok(ext, 'returns non-null extension');
  assert.equal(ext._kind, 'viewPlugin');
  assert.equal(cap.calls.viewPluginFromClass, 1, 'ViewPlugin.fromClass called exactly once');
});

test('Stage 28-12: createConstructRevealExtension returns null and does NOT call ViewPlugin.fromClass when surface guards trip (4 sub-cases)', () => {
  const { createConstructRevealExtension } = loadConstructRevealModule();
  // (a) cm6 null
  assert.equal(createConstructRevealExtension(null), null);
  // (b) ViewPlugin missing
  const capB = { calls: { viewPluginFromClass: 0 } };
  const cm6B = makeFakeCm6(capB);
  delete cm6B.ViewPlugin;
  assert.equal(createConstructRevealExtension(cm6B), null);
  assert.equal(capB.calls.viewPluginFromClass, 0);
  // (c) Decoration.line missing
  const capC = { calls: { viewPluginFromClass: 0 } };
  const cm6C = makeFakeCm6(capC);
  delete cm6C.Decoration.line;
  assert.equal(createConstructRevealExtension(cm6C), null);
  assert.equal(capC.calls.viewPluginFromClass, 0);
  // (d) Decoration.set missing
  const capD = { calls: { viewPluginFromClass: 0 } };
  const cm6D = makeFakeCm6(capD);
  delete cm6D.Decoration.set;
  assert.equal(createConstructRevealExtension(cm6D), null);
  assert.equal(capD.calls.viewPluginFromClass, 0);
});

test('Stage 28-13: plugin update fires on selectionSet=true; recomputes decorations', () => {
  const { createConstructRevealExtension } = loadConstructRevealModule();
  const cm6 = makeFakeCm6();
  cm6.syntaxTree = () => makeFakeTree([{ name: 'FencedCode', from: 0, to: 12 }]);
  const ext = createConstructRevealExtension(cm6);
  const PluginClass = ext._ref.cls;
  const doc = makeFakeDoc('```\nbody\n```\n');
  // Caret on line 1 initially (fence open line — inside construct).
  const state1 = { doc, selection: { ranges: [{ from: 0, to: 0 }] } };
  const view = { state: state1 };
  const instance = new PluginClass(view);
  const initialCount = instance.decorations._ranges.length;
  // Caret moves OUT of the fence (to a position beyond the fence — fabricate line 4 outside).
  const doc2 = makeFakeDoc('```\nbody\n```\noutside\n');
  const state2 = { doc: doc2, selection: { ranges: [{ from: doc2.line(4).from, to: doc2.line(4).from }] } };
  instance.update({ state: state2, selectionSet: true, docChanged: false, viewportChanged: false });
  // Outside the fence — no construct active.
  assert.equal(instance.decorations._ranges.length, 0, 'decorations recomputed; outside fence yields 0');
  assert.notEqual(initialCount, 0, 'initial decoration count was non-zero (caret was inside fence)');
});

test('Stage 28-24: plugin update fires on viewportChanged=true when selectionSet+docChanged are false (F4)', () => {
  const { createConstructRevealExtension } = loadConstructRevealModule();
  const cm6 = makeFakeCm6();
  let treeCallCount = 0;
  cm6.syntaxTree = () => { treeCallCount++; return makeFakeTree([{ name: 'FencedCode', from: 0, to: 12 }]); };
  const ext = createConstructRevealExtension(cm6);
  const PluginClass = ext._ref.cls;
  const doc = makeFakeDoc('```\nbody\n```\n');
  const state = { doc, selection: { ranges: [{ from: 0, to: 0 }] } };
  const view = { state };
  const instance = new PluginClass(view);
  const callsAfterConstruct = treeCallCount;
  // viewportChanged event with no selection/doc change.
  instance.update({ state, selectionSet: false, docChanged: false, viewportChanged: true });
  assert.ok(treeCallCount > callsAfterConstruct, 'plugin.update recomputed (called syntaxTree again) on viewportChanged');
});

// ─────────────────────────────────────────────────────────────────────────
// Group E — walker hook integration (28-14, 28-15)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 28-14: createCm6HybridView appends the construct-reveal extension when globalThis.Cm6ConstructReveal is present', () => {
  const snap = snapshotWalkerHookGlobals();
  try {
    const sentinel = { _kind: 'viewPlugin', __constructRevealSentinel: true };
    globalThis.Cm6ConstructReveal = {
      createConstructRevealExtension: function () { return sentinel; },
    };
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions));
    const matches = capture.lastExtensions.filter((e) => e && e.__constructRevealSentinel);
    assert.equal(matches.length, 1, 'exactly one construct-reveal sentinel in the extensions list');
  } finally {
    restoreWalkerHookGlobals(snap);
  }
});

test('Stage 28-15: createCm6HybridView builds normally when globalThis.Cm6ConstructReveal is undefined', () => {
  const snap = snapshotWalkerHookGlobals();
  try {
    delete globalThis.Cm6ConstructReveal;
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions));
    const matches = capture.lastExtensions.filter((e) => e && e.__constructRevealSentinel);
    assert.equal(matches.length, 0, 'no construct-reveal sentinel when hook is absent');
  } finally {
    restoreWalkerHookGlobals(snap);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Group G — performance (28-19, 28-20)
// ─────────────────────────────────────────────────────────────────────────

function build10kCorpusWithConstructs() {
  // 10k lines with ~100 scattered fenced code blocks (every ~100 lines).
  const lines = [];
  for (let i = 0; i < 10000; i++) {
    if (i % 100 === 0 && i > 0) {
      lines.push('```js');
      lines.push('var x = ' + i + ';');
      lines.push('```');
    } else {
      lines.push('paragraph line ' + i);
    }
  }
  return lines.join('\n');
}

test('Stage 28-19: 10k-line corpus full-document selection → buildConstructActiveDecorations wall-clock < 1500 ms (real parser)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const corpus = build10kCorpusWithConstructs();
  const { state, tree, cm6 } = buildRealStateAndTree(corpus);
  const fullSelState = Object.assign({}, state, {
    selection: { ranges: [{ from: 0, to: corpus.length }] },
  });
  const t0 = Date.now();
  const result = buildConstructActiveDecorations(fullSelState, cm6, tree);
  const dt = Date.now() - t0;
  console.log('  [Stage 28-19] 10k-line full-doc build wall-clock:', dt, 'ms (', result._ranges ? result._ranges.length : 0, 'line decorations)');
  assert.ok(dt < 1500, 'full-document construct-active build under 1500 ms (measured ' + dt + ' ms)');
});

test('Stage 28-20: 10k-line corpus 50 successive selection updates → p95 per-update < 50 ms', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const corpus = build10kCorpusWithConstructs();
  const { state, tree, cm6 } = buildRealStateAndTree(corpus);
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const line = state.doc.line(50 + i * 10);
    const stateWithSel = Object.assign({}, state, {
      selection: { ranges: [{ from: line.from, to: line.from }] },
    });
    const t0 = Date.now();
    buildConstructActiveDecorations(stateWithSel, cm6, tree);
    samples.push(Date.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log('  [Stage 28-20] selection-update timings: p50=', p50, 'ms, p95=', p95, 'ms');
  assert.ok(p95 < 50, 'p95 per-update under 50 ms (measured ' + p95 + ' ms)');
});
