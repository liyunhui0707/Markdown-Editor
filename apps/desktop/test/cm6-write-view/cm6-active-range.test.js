/* Stage 26 — selection-aware active-range tests (Groups A, B, C, D, F, G).
   Run focused:
     node --test test/cm6-write-view/cm6-active-range.test.js

   Module under test: apps/desktop/lib/cm6-active-range.js (created in
   Batch 2). Tests use lazy require() inside each test body so a missing
   module file surfaces as per-test MODULE_NOT_FOUND rather than a load-
   time crash.

   Test groups:
     A — resolveTouchedLines(selection, doc)        26-1 .. 26-6
     B — buildActiveRangeDecorations(state, cm6)    26-7 .. 26-10b
     C — createActiveRangeExtension(cm6)            26-11 .. 26-14
     D — walker hook integration                    26-15 .. 26-16
     F — end-to-end (decoration set on real-shaped state) 26-21 .. 26-23
     G — performance (10k-line corpus)              26-24 .. 26-25

   Group E (peer-contract invariants + CSS/script-tag source scans) lives
   in a sibling file: cm6-active-range-invariants.test.js (26-17..26-20).

   Helpers below define a precomputed fakeDoc (O(1) line, O(log n) lineAt
   — G3 contract), a fakeCm6 namespace (Decoration.line + Decoration.set
   + ViewPlugin.fromClass and the surface the walker needs), and the
   try/finally global-snapshot helper that covers all THREE optional
   walker-hook globals (H4: Cm6ActiveRange + Cm6TaskToggle + Cm6LinkClick). */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const ACTIVE_RANGE_REL = '../../lib/cm6-active-range.js';
const HYBRID_REL       = '../../lib/cm6-hybrid-view.js';

// ── Lazy loaders ──────────────────────────────────────────────────────────

function loadActiveRangeModule() {
  delete require.cache[require.resolve(ACTIVE_RANGE_REL)];
  return require(ACTIVE_RANGE_REL);
}

function loadHybridViewModule() {
  delete require.cache[require.resolve(HYBRID_REL)];
  return require(HYBRID_REL);
}

// ── fakeDoc — precomputed line metadata (G3) ──────────────────────────────
// Builds line records once in the constructor. line(n) is O(1) array index;
// lineAt(pos) is O(log n) binary search. No re-scanning per call.

function makeFakeDoc(text) {
  const str = String(text);
  const lines = [];
  let from = 0;
  for (let i = 0; i <= str.length; i++) {
    if (i === str.length || str.charCodeAt(i) === 10 /* \n */) {
      const lineText = str.slice(from, i);
      lines.push({ number: lines.length + 1, from, to: i, text: lineText });
      from = i + 1;
    }
  }
  if (lines.length === 0) {
    lines.push({ number: 1, from: 0, to: 0, text: '' });
  }
  const fromOffsets = lines.map((l) => l.from);

  return {
    _str: str,
    length: str.length,
    toString() { return str; },
    sliceString(f, t) { return str.slice(f, t); },
    get lines() { return lines.length; },
    line(n) {
      if (n < 1 || n > lines.length) {
        throw new RangeError('line ' + n + ' out of range (1..' + lines.length + ')');
      }
      return lines[n - 1];
    },
    lineAt(pos) {
      if (lines.length === 1) return lines[0];
      let lo = 0;
      let hi = fromOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (fromOffsets[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lines[lo];
    },
  };
}

// ── fakeCm6 — superset namespace with everything tests + walker need ──────

function makeFakeCm6(capture) {
  capture = capture || {};
  const calls = capture.calls = (capture.calls || { viewPluginFromClass: 0 });

  function makeDocFromString(s) { return makeFakeDoc(s); }

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
            get to()    { return i < items.length ? (items[i].to != null ? items[i].to : items[i].from) : -1; },
            next() { i++; },
          };
        },
        _sortedFlag: !!sorted,
      };
    },
    none: { _ranges: [], size: 0, iter() { return { value: null, from: -1, to: -1, next() {} }; } },
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
        doc: makeDocFromString(typeof doc === 'string' ? doc : ''),
        selection: { main: { head: 0, anchor: 0 }, ranges: [{ from: 0, to: 0 }] },
        _extensions: flat,
        _listeners:  flat.filter((e) => e && e._kind === 'updateListener').map((e) => e.fn),
      };
    },
  };

  class EditorView {
    constructor({ state, parent }) {
      this.state = state;
      this.parent = parent;
      this.composing = false;
    }
    dispatch() { /* no-op for these tests */ }
    setState(newState) { this.state = newState; }
    destroy() {}
    focus()   {}
  }
  EditorView.updateListener   = { of(fn) { return { _kind: 'updateListener', fn }; } };
  EditorView.lineWrapping     = { _kind: 'lineWrapping' };
  EditorView.domEventHandlers = function (handlers) { return { _kind: 'domEventHandlers', handlers }; };

  return {
    EditorState, EditorView,
    Decoration, ViewPlugin,
    history:  () => ({ _kind: 'history' }),
    markdown: () => ({ _kind: 'markdown' }),
    chrome:   null,
    RangeSetBuilder: class { constructor() { this._spans = []; } add(from, to, value) { this._spans.push({ from, to, value }); } finish() { return { _ranges: this._spans, size: this._spans.length }; } },
    Annotation: { define() { return () => {}; } },
    syntaxTree() { return null; },
    keymap:   { of(specs) { return { _kind: 'keymap', specs }; } },
  };
}

function makeFakeParent() {
  return { _isParent: true, appendChild() {}, remove() {} };
}

// ── snapshot/restore ALL THREE optional walker-hook globals (H4) ──────────

function snapshotWalkerHookGlobals() {
  return {
    Cm6ActiveRange: globalThis.Cm6ActiveRange,
    Cm6TaskToggle:  globalThis.Cm6TaskToggle,
    Cm6LinkClick:   globalThis.Cm6LinkClick,
  };
}

function restoreWalkerHookGlobals(snap) {
  for (const key of ['Cm6ActiveRange', 'Cm6TaskToggle', 'Cm6LinkClick']) {
    if (Object.prototype.hasOwnProperty.call(snap, key) && snap[key] !== undefined) {
      globalThis[key] = snap[key];
    } else {
      delete globalThis[key];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A — resolveTouchedLines(selection, doc)        (Stage 26-1 .. 26-6)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 26-1: resolveTouchedLines with caret at pos 0 on a 5-line doc → [1]', () => {
  const { resolveTouchedLines } = loadActiveRangeModule();
  const doc = makeFakeDoc('a\nb\nc\nd\ne');
  const out = resolveTouchedLines({ ranges: [{ from: 0, to: 0 }] }, doc);
  assert.deepEqual(out, [1]);
});

test('Stage 26-2: resolveTouchedLines with selection within line 3 only → [3]', () => {
  const { resolveTouchedLines } = loadActiveRangeModule();
  const doc = makeFakeDoc('aa\nbb\nccc\ndd\nee');
  // line 3 spans positions 6..9
  const out = resolveTouchedLines({ ranges: [{ from: 7, to: 8 }] }, doc);
  assert.deepEqual(out, [3]);
});

test('Stage 26-3: resolveTouchedLines from line 2 col 4 to line 5 col 1 → [2,3,4,5]', () => {
  const { resolveTouchedLines } = loadActiveRangeModule();
  // line 1=aaaa[0,4]  line 2=bbbbb[5,10]  line 3=ccccc[11,16]
  // line 4=ddddd[17,22] line 5=eeeee[23,28]
  const doc = makeFakeDoc('aaaa\nbbbbb\nccccc\nddddd\neeeee');
  const from = 5 + 4; // line 2 col 4
  const to   = 23 + 1; // line 5 col 1
  const out = resolveTouchedLines({ ranges: [{ from, to }] }, doc);
  assert.deepEqual(out, [2, 3, 4, 5]);
});

test('Stage 26-4: selection ending at col 0 of line 6 includes line 6', () => {
  const { resolveTouchedLines } = loadActiveRangeModule();
  // 'aa\nbb\ncc\ndd\nee\nff'  line 6 starts at pos 15
  const doc = makeFakeDoc('aa\nbb\ncc\ndd\nee\nff');
  // selection from line 5 col 1 (pos 13) to col 0 of line 6 (pos 15)
  const out = resolveTouchedLines({ ranges: [{ from: 13, to: 15 }] }, doc);
  assert.deepEqual(out, [5, 6], 'col 0 of line 6 → include line 6 (lineAt(pos) semantics)');
});

test('Stage 26-5: multi-range selection produces sorted, deduplicated union', () => {
  const { resolveTouchedLines } = loadActiveRangeModule();
  // 10 lines, each 'lN'
  const doc = makeFakeDoc('l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10');
  // line offsets: l1[0,2] l2[3,5] l3[6,8] l4[9,11] l5[12,14]
  //               l6[15,17] l7[18,20] l8[21,23] l9[24,26] l10[27,30]
  // range A: lines 2..3 → {from:4,to:7}
  // range B: lines 6..8 → {from:16,to:22}
  const out = resolveTouchedLines({
    ranges: [{ from: 4, to: 7 }, { from: 16, to: 22 }],
  }, doc);
  assert.deepEqual(out, [2, 3, 6, 7, 8]);
});

test('Stage 26-6: empty doc + caret at 0 → [1]', () => {
  const { resolveTouchedLines } = loadActiveRangeModule();
  const doc = makeFakeDoc('');
  const out = resolveTouchedLines({ ranges: [{ from: 0, to: 0 }] }, doc);
  assert.deepEqual(out, [1]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — buildActiveRangeDecorations(state, cm6)    (Stage 26-7 .. 26-10b)
// ─────────────────────────────────────────────────────────────────────────────

function makeStateFor(text, ranges) {
  const doc = makeFakeDoc(text);
  return {
    doc,
    selection: {
      ranges,
      main: ranges[0] || { from: 0, to: 0 },
    },
  };
}

test('Stage 26-7: buildActiveRangeDecorations returns one entry per touched line for lines 2..4', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const state = makeStateFor('a\nb\nc\nd\ne', [{ from: 2, to: 7 }]); // lines 2..4
  const result = buildActiveRangeDecorations(state, cm6);
  assert.ok(result, 'returns a RangeSet-like object');
  assert.equal(result._ranges.length, 3, 'one entry per touched line');
});

test('Stage 26-8: each emitted decoration has spec.class === "cm-md-active-range"', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const state = makeStateFor('a\nb\nc\nd\ne', [{ from: 0, to: 7 }]);
  const result = buildActiveRangeDecorations(state, cm6);
  for (const entry of result._ranges) {
    assert.equal(entry.value.spec.class, 'cm-md-active-range');
  }
});

test('Stage 26-9: each entry from === state.doc.line(n).from', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const state = makeStateFor('a\nb\nc\nd\ne', [{ from: 0, to: 7 }]);
  const result = buildActiveRangeDecorations(state, cm6);
  // touched lines are 1..4 (caret-at-0 inclusive); each from matches line.from
  const expectedFroms = [];
  for (let n = 1; n <= 4; n++) expectedFroms.push(state.doc.line(n).from);
  const actualFroms = result._ranges.map((r) => r.from);
  assert.deepEqual(actualFroms, expectedFroms);
});

test('Stage 26-10a: multi-range selection produces exactly 5 entries, sorted, no duplicates', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const state = makeStateFor(
    'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10',
    [{ from: 4, to: 7 }, { from: 16, to: 22 }],
  );
  const result = buildActiveRangeDecorations(state, cm6);
  assert.equal(result._ranges.length, 5, '5 unique lines touched (2,3,6,7,8)');
  // sorted by `from`
  const froms = result._ranges.map((r) => r.from);
  const sorted = [...froms].sort((a, b) => a - b);
  assert.deepEqual(froms, sorted);
  // no duplicate from-offsets
  assert.equal(new Set(froms).size, froms.length);
});

test('Stage 26-10b: sentinel — null return for three missing-surface sub-cases', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const baseState = makeStateFor('a\nb\nc', [{ from: 0, to: 0 }]);

  // (i) cm6 === null
  assert.equal(buildActiveRangeDecorations(baseState, null), null, '(i) cm6 null → null');

  // (ii) cm6.Decoration.line missing (set still present)
  const cm6NoLine = makeFakeCm6();
  delete cm6NoLine.Decoration.line;
  assert.equal(
    buildActiveRangeDecorations(baseState, cm6NoLine), null,
    '(ii) cm6.Decoration.line missing → null',
  );

  // (iii) cm6.Decoration.set missing (line still present)
  const cm6NoSet = makeFakeCm6();
  delete cm6NoSet.Decoration.set;
  assert.equal(
    buildActiveRangeDecorations(baseState, cm6NoSet), null,
    '(iii) cm6.Decoration.set missing → null',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — createActiveRangeExtension(cm6)            (Stage 26-11 .. 26-14)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 26-11: surface guard — null in four sub-cases, ViewPlugin.fromClass NOT called', () => {
  const { createActiveRangeExtension } = loadActiveRangeModule();

  // (a) ViewPlugin missing
  const cm6NoVP = makeFakeCm6();
  cm6NoVP._calls = cm6NoVP._calls || { viewPluginFromClass: 0 };
  delete cm6NoVP.ViewPlugin;
  // capture wrapper for counting
  const capA = { calls: { viewPluginFromClass: 0 } };
  const cm6A = makeFakeCm6(capA);
  delete cm6A.ViewPlugin;
  assert.equal(createActiveRangeExtension(cm6A), null, '(a) ViewPlugin missing → null');
  assert.equal(capA.calls.viewPluginFromClass, 0, '(a) fromClass NOT called');

  // (b) Decoration.line missing
  const capB = { calls: { viewPluginFromClass: 0 } };
  const cm6B = makeFakeCm6(capB);
  delete cm6B.Decoration.line;
  assert.equal(createActiveRangeExtension(cm6B), null, '(b) Decoration.line missing → null');
  assert.equal(capB.calls.viewPluginFromClass, 0, '(b) fromClass NOT called');

  // (c) Decoration.set missing
  const capC = { calls: { viewPluginFromClass: 0 } };
  const cm6C = makeFakeCm6(capC);
  delete cm6C.Decoration.set;
  assert.equal(createActiveRangeExtension(cm6C), null, '(c) Decoration.set missing → null');
  assert.equal(capC.calls.viewPluginFromClass, 0, '(c) fromClass NOT called');

  // (d) cm6 === null
  assert.equal(createActiveRangeExtension(null), null, '(d) cm6 null → null');

  // Sanity: full cm6 returns non-null and calls fromClass once
  const capOk = { calls: { viewPluginFromClass: 0 } };
  const cm6Ok = makeFakeCm6(capOk);
  const ext = createActiveRangeExtension(cm6Ok);
  assert.ok(ext != null, 'valid cm6 → non-null extension');
  assert.equal(capOk.calls.viewPluginFromClass, 1, 'valid cm6 → fromClass called once');
});

test('Stage 26-12: extension built via ViewPlugin.fromClass; no DOM-event APIs touched', () => {
  const mod = loadActiveRangeModule();
  const cap = { calls: { viewPluginFromClass: 0 } };
  const cm6 = makeFakeCm6(cap);

  // Spy on the dangerous surfaces — they MUST NOT be invoked.
  let domEventHandlersCalled = false;
  let keymapOfCalled = false;
  const origDEH = cm6.EditorView.domEventHandlers;
  cm6.EditorView.domEventHandlers = function () { domEventHandlersCalled = true; return origDEH.apply(this, arguments); };
  const origKO = cm6.keymap.of;
  cm6.keymap.of = function () { keymapOfCalled = true; return origKO.apply(this, arguments); };

  const ext = mod.createActiveRangeExtension(cm6);
  assert.ok(ext, 'extension non-null');
  assert.equal(ext._kind, 'viewPlugin', 'extension came from ViewPlugin.fromClass');
  assert.equal(cap.calls.viewPluginFromClass, 1, 'ViewPlugin.fromClass called exactly once');
  assert.equal(domEventHandlersCalled, false, 'EditorView.domEventHandlers NOT called');
  assert.equal(keymapOfCalled, false, 'cm6.keymap.of NOT called');
});

test('Stage 26-13: plugin update fires on selection-change with selectionSet=true', () => {
  const { createActiveRangeExtension } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const ext = createActiveRangeExtension(cm6);
  const PluginClass = ext._ref.cls;

  const state1 = makeStateFor('a\nb\nc', [{ from: 0, to: 0 }]); // caret on line 1
  const view1 = { state: state1 };
  const instance = new PluginClass(view1);
  assert.equal(instance.decorations._ranges.length, 1, 'initial: line 1');
  assert.equal(instance.decorations._ranges[0].from, 0);

  const state2 = makeStateFor('a\nb\nc', [{ from: 2, to: 2 }]); // caret on line 2
  instance.update({ state: state2, selectionSet: true, docChanged: false });
  assert.equal(instance.decorations._ranges.length, 1, 'post-update: line 2');
  assert.equal(instance.decorations._ranges[0].from, 2);
});

test('Stage 26-14: plugin update fires on doc-change with docChanged=true (line indices shift)', () => {
  const { createActiveRangeExtension } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const ext = createActiveRangeExtension(cm6);
  const PluginClass = ext._ref.cls;

  const state1 = makeStateFor('a\nb\nc', [{ from: 2, to: 2 }]); // caret on line 2 (pos 2)
  const view1 = { state: state1 };
  const instance = new PluginClass(view1);
  const initialFrom = instance.decorations._ranges[0].from;
  assert.equal(initialFrom, 2);

  // Simulate inserting a character at pos 0 — line 2 now starts at pos 3.
  const state2 = makeStateFor('xa\nb\nc', [{ from: 3, to: 3 }]);
  instance.update({ state: state2, selectionSet: false, docChanged: true });
  assert.equal(instance.decorations._ranges.length, 1);
  assert.equal(instance.decorations._ranges[0].from, 3, 'line 2 from shifted to 3');
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D — walker hook integration                    (Stage 26-15 .. 26-16)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 26-15: createCm6HybridView appends the active-range extension exactly once when globalThis.Cm6ActiveRange is present', () => {
  const snap = snapshotWalkerHookGlobals();
  try {
    const sentinel = { _kind: 'viewPlugin', __activeRangeSentinel: true };
    globalThis.Cm6ActiveRange = {
      createActiveRangeExtension: function () { return sentinel; },
    };
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions), 'state extensions captured');
    const matches = capture.lastExtensions.filter((e) => e && e.__activeRangeSentinel);
    assert.equal(matches.length, 1, 'exactly one active-range sentinel in the extensions list');
  } finally {
    restoreWalkerHookGlobals(snap);
  }
});

test('Stage 26-16: createCm6HybridView builds normally when globalThis.Cm6ActiveRange is undefined', () => {
  const snap = snapshotWalkerHookGlobals();
  try {
    delete globalThis.Cm6ActiveRange;
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions), 'state extensions captured');
    const matches = capture.lastExtensions.filter((e) => e && e.__activeRangeSentinel);
    assert.equal(matches.length, 0, 'no active-range sentinel when hook is absent');
  } finally {
    restoreWalkerHookGlobals(snap);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group F — end-to-end behavior                        (Stage 26-21 .. 26-23)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 26-21: Primary RED — two-line **bold** selection spans both lines, both lines get cm-md-active-range', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const text = '**bold one**\n**bold two**';
  const doc = makeFakeDoc(text);
  // Selection from pos 0 to end of line 2 (== doc.length)
  const state = {
    doc,
    selection: { ranges: [{ from: 0, to: text.length }], main: { from: 0, to: text.length } },
  };
  const result = buildActiveRangeDecorations(state, cm6);
  assert.ok(result, 'decoration set returned');
  assert.equal(result._ranges.length, 2, 'two lines touched');
  assert.deepEqual(
    result._ranges.map((r) => r.value.spec.class),
    ['cm-md-active-range', 'cm-md-active-range'],
    'both lines get the class',
  );
  assert.deepEqual(
    result._ranges.map((r) => r.from),
    [doc.line(1).from, doc.line(2).from],
    'froms align with line starts',
  );
});

test('Stage 26-22: single-caret on line 1 → only line 1 has the class; line 2 does not', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const doc = makeFakeDoc('**bold one**\n**bold two**');
  const state = { doc, selection: { ranges: [{ from: 0, to: 0 }] } };
  const result = buildActiveRangeDecorations(state, cm6);
  assert.equal(result._ranges.length, 1);
  assert.equal(result._ranges[0].from, doc.line(1).from);
});

test('Stage 26-23: multi-cursor on line 1 and line 3 → only those two lines have the class', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const doc = makeFakeDoc('first\nsecond\nthird');
  const line1From = doc.line(1).from; // 0
  const line3From = doc.line(3).from; // 13
  const state = {
    doc,
    selection: { ranges: [
      { from: line1From, to: line1From },
      { from: line3From, to: line3From },
    ] },
  };
  const result = buildActiveRangeDecorations(state, cm6);
  assert.equal(result._ranges.length, 2);
  assert.deepEqual(
    result._ranges.map((r) => r.from),
    [line1From, line3From],
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Group G — performance (10k-line corpus)              (Stage 26-24 .. 26-25)
// Always-on default-suite tests (run via `npm test`, not `npm run test:perf`).
// fakeDoc precomputes line metadata, so these tests measure the active-range
// algorithm — NOT the helper.
// ─────────────────────────────────────────────────────────────────────────────

function build10kCorpus() {
  const lines = [];
  for (let i = 0; i < 10000; i++) {
    lines.push('line ' + i + ' with **bold** marker');
  }
  return lines.join('\n');
}

test('Stage 26-24: 10k-line corpus, full-document selection → builder wall-clock < 500 ms', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const corpus = build10kCorpus();
  const doc = makeFakeDoc(corpus);
  const state = {
    doc,
    selection: { ranges: [{ from: 0, to: corpus.length }] },
  };
  const t0 = Date.now();
  const result = buildActiveRangeDecorations(state, cm6);
  const dt = Date.now() - t0;
  console.log('  [Stage 26-24] full-doc build wall-clock:', dt, 'ms (', result._ranges.length, 'lines)');
  assert.ok(result._ranges.length === 10000, 'all 10k lines touched');
  assert.ok(dt < 500, 'full-document build under 500 ms (measured: ' + dt + ' ms)');
});

test('Stage 26-25: 10k-line corpus, 100 successive selection updates → p95 per-update < 10 ms', () => {
  const { buildActiveRangeDecorations } = loadActiveRangeModule();
  const cm6 = makeFakeCm6();
  const corpus = build10kCorpus();
  const doc = makeFakeDoc(corpus);
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const line = doc.line(i + 1);
    const state = {
      doc,
      selection: { ranges: [{ from: line.from, to: line.from }] },
    };
    const t0 = Date.now();
    buildActiveRangeDecorations(state, cm6);
    samples.push(Date.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log('  [Stage 26-25] selection-update timings: p50=', p50, 'ms, p95=', p95, 'ms');
  assert.ok(p95 < 10, 'p95 selection-update under 10 ms (measured: ' + p95 + ' ms)');
});
