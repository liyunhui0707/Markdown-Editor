/* Stage 23 — task-toggle production tests.
   Run focused: node --test test/cm6-write-view/task-toggle.test.js

   These tests promote the Stage 22 spike's R1-R12 click-path coverage
   to production naming (Stage 23-1 through 23-12) and add Stage 23-13
   through 23-21 for the keyboard command, programmatic undo/redo
   (Stage 22.5 prerequisite), the integrated onChange wiring, and
   caret-line specificity.

   Implementation contract:
     - cm6-task-toggle.js exposes resolveTaskMarkerRange,
       buildToggleTransaction, toggleTaskAtCaret, createTaskToggleExtension.
     - The mousedown handler and the keymap entry both live INSIDE
       createTaskToggleExtension(cm6) — toggleTaskAtCaret takes (view, cm6)
       so cm6 is passed explicitly rather than captured from an outer scope.

   Lazy-loading: the toggle module is required inside each test that needs
   it, not at module top-level, so the missing-module RED state produces
   per-test failures rather than a single file-load failure. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('node:path');

const TOGGLE_REL = '../../lib/cm6-task-toggle.js';
const HYBRID_REL = '../../lib/cm6-hybrid-view.js';

// ── Lazy loaders ────────────────────────────────────────────────────────────

function loadTaskToggleModule() {
  delete require.cache[require.resolve(TOGGLE_REL)];
  return require(TOGGLE_REL);
}

function loadHybridViewModule() {
  delete require.cache[require.resolve(HYBRID_REL)];
  return require(HYBRID_REL);
}

function loadCm6Bundle() {
  if (!global.window) global.window = {};
  if (!global.window.CM6Production) {
    require('../../lib/cm6-bundle.js');
  }
  return global.window.CM6Production;
}

// ── Real-bundle state + tree builder (used by resolver / transaction tests) ─
// The lezer-based Markdown parser runs in pure Node — no DOM required for
// EditorState construction, syntaxTree(state), or doc.sliceString.

function buildStateAndTree(doc) {
  const cm6   = loadCm6Bundle();
  const state = cm6.EditorState.create({ doc, extensions: [cm6.markdown()] });
  const tree  = cm6.syntaxTree(state);
  return { cm6, state, tree };
}

// Build a state that ALSO has history(), for programmatic undo/redo tests.
function buildStateWithHistory(doc) {
  const cm6   = loadCm6Bundle();
  const state = cm6.EditorState.create({
    doc,
    extensions: [cm6.markdown(), cm6.history()],
  });
  const tree  = cm6.syntaxTree(state);
  return { cm6, state, tree };
}

// Dispatch-shape-tolerant state harness for undo/redo:
// - cm6.undo / cm6.redo pass a Transaction object (with tr.state).
// - buildToggleTransaction returns a transaction spec (with .changes).
function makeStateHarness(initial) {
  let state = initial;
  return {
    get state() { return state; },
    dispatch(arg) {
      if (arg && arg.state && typeof arg.state.update === 'function') {
        state = arg.state;            // Transaction
      } else {
        state = state.update(arg).state;  // transaction spec
      }
    },
  };
}

// ── Stub view + event for mousedown handler tests ──────────────────────────

function makeStubView(opts = {}) {
  const composing = !!opts.composing;
  const posResult = opts.posResult != null ? opts.posResult : 3;
  const dispatched = [];
  const cm6 = loadCm6Bundle();
  const state = cm6.EditorState.create({
    doc: opts.doc || '- [ ] alpha\n',
    extensions: [cm6.markdown()],
  });
  return {
    composing,
    state,
    posAtCoords: () => posResult,
    dispatch: (spec) => { dispatched.push(spec); },
    _dispatched: dispatched,
  };
}

function makeStubEvent(opts = {}) {
  const mods = opts.mods || {};
  const e = {
    button:   opts.button != null ? opts.button : 0,
    clientX:  50,
    clientY:  20,
    metaKey:  !!mods.metaKey,
    ctrlKey:  !!mods.ctrlKey,
    altKey:   !!mods.altKey,
    shiftKey: !!mods.shiftKey,
    _prevented: false,
    preventDefault() { this._prevented = true; },
  };
  return e;
}

// Extract the mousedown handler from the array returned by
// createTaskToggleExtension(cm6). The bundle's
// EditorView.domEventHandlers({...}) returns a value whose shape isn't
// inspectable here; under the fake backend used elsewhere in this file
// (and during the integration test for Stage 23-20), the extension
// surfaces as { _kind: 'domEventHandlers', handlers: { mousedown } }.
// Under the production bundle, the extension is an opaque facet value,
// so we use a fake-backend probe by passing a controlled cm6 to
// createTaskToggleExtension.
function extractMousedownHandler() {
  const mod = loadTaskToggleModule();
  const realCm6 = loadCm6Bundle();
  // Recording fake exposes the introspectable extension shape, but its
  // syntaxTree must delegate to the real bundle so the mousedown handler
  // can resolve states constructed by makeStubView (which uses the real
  // bundle's EditorState + markdown parser).
  const recordingCm6 = makeFakeCm6BackendCapturing({});
  recordingCm6.syntaxTree = realCm6.syntaxTree;
  const ext = mod.createTaskToggleExtension(recordingCm6);
  const handlerEntry = (Array.isArray(ext) ? ext : [ext]).find(
    (e) => e && e._kind === 'domEventHandlers' && e.handlers && typeof e.handlers.mousedown === 'function'
  );
  assert.ok(handlerEntry, 'createTaskToggleExtension must include a domEventHandlers entry with a mousedown handler');
  return handlerEntry.handlers.mousedown;
}

// Extract the keymap entry from the array returned by
// createTaskToggleExtension(cm6).
function extractKeymapSpecs() {
  const mod = loadTaskToggleModule();
  const recordingCm6 = makeFakeCm6BackendCapturing({});
  const ext = mod.createTaskToggleExtension(recordingCm6);
  const keymapEntry = (Array.isArray(ext) ? ext : [ext]).find(
    (e) => e && e._kind === 'keymap' && Array.isArray(e.specs)
  );
  assert.ok(keymapEntry, 'createTaskToggleExtension must include a keymap.of entry');
  return keymapEntry.specs;
}

// ── Fake CM6 backend for walker-integration + onChange tests ───────────────
// Captures the extensions array passed to EditorState.create so we can
// inspect whether the optional task-toggle extension was appended. The
// EditorView's dispatch fires updateListener callbacks (the same wiring
// cm6-hybrid-view.js relies on for its onChange).

function makeFakeCm6BackendCapturing(capture) {
  function makeDoc(s) {
    const str = String(s);
    return {
      _s: str,
      get length() { return str.length; },
      toString() { return str; },
      sliceString(from, to) { return str.slice(from, to); },
      get lines() {
        if (str.length === 0) return 1;
        const nl = (str.match(/\n/g) || []).length;
        return nl + (str.endsWith('\n') ? 0 : 1);
      },
      line(n) {
        const lines = str.split('\n');
        let from = 0;
        for (let i = 0; i < n - 1; i++) from += lines[i].length + 1;
        const text = lines[n - 1] != null ? lines[n - 1] : '';
        return { number: n, from, to: from + text.length, text };
      },
      lineAt(pos) {
        let lineStart = 0;
        let lineNumber = 1;
        for (let i = 0; i < pos && i < str.length; i++) {
          if (str[i] === '\n') {
            lineStart = i + 1;
            lineNumber += 1;
          }
        }
        let lineEnd = str.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = str.length;
        return {
          number: lineNumber,
          from: lineStart,
          to: lineEnd,
          text: str.slice(lineStart, lineEnd),
        };
      },
    };
  }
  function flatten(arr) {
    const out = [];
    for (const e of (arr || [])) {
      if (Array.isArray(e)) out.push(...flatten(e));
      else if (e != null) out.push(e);
    }
    return out;
  }
  function applyChanges(s, changes) {
    if (!changes) return s;
    const list = Array.isArray(changes) ? changes : [changes];
    const sorted = [...list].sort((a, b) => (b.from || 0) - (a.from || 0));
    let out = s;
    for (const c of sorted) {
      const from = c.from || 0;
      const to   = c.to != null ? c.to : from;
      const ins  = c.insert != null ? c.insert : '';
      out = out.slice(0, from) + ins + out.slice(to);
    }
    return out;
  }

  const Decoration = {
    mark(spec) {
      const dec = { _kind: 'mark', spec };
      dec.range = (from, to) => ({ from, to, value: dec });
      return dec;
    },
    set(arr) { return { _ranges: [...(arr || [])] }; },
    none: { _ranges: [] },
  };
  const ViewPlugin = {
    fromClass(pluginClass, spec) {
      return { _kind: 'viewPlugin', _ref: { pluginClass, spec, instance: null } };
    },
  };
  const EditorState = {
    create({ doc, extensions = [] }) {
      const flat = flatten(extensions);
      capture.lastExtensions = flat;
      return {
        doc: makeDoc(typeof doc === 'string' ? doc : ''),
        selection: { main: { head: 0, anchor: 0 } },
        _extensions: flat,
        _listeners: flat.filter((e) => e && e._kind === 'updateListener').map((e) => e.fn),
      };
    },
  };
  class EditorView {
    constructor({ state, parent }) {
      this.state    = state;
      this.parent   = parent;
      this.composing = false;
    }
    dispatch(spec) {
      const prev = this.state.doc.toString();
      const newStr = spec && spec.changes != null ? applyChanges(prev, spec.changes) : prev;
      const docChanged = newStr !== prev;
      const newSel = spec && spec.selection !== undefined
        ? spec.selection
        : this.state.selection;
      const newState = {
        doc: makeDoc(newStr),
        selection: newSel,
        _extensions: this.state._extensions,
        _listeners:  this.state._listeners,
      };
      this.state = newState;
      const update = {
        view: this,
        state: newState,
        docChanged,
        viewportChanged: false,
      };
      for (const fn of (this.state._listeners || [])) {
        try { fn(update); } catch (_) {}
      }
    }
    setState(newState) { this.state = newState; }
    destroy() {}
    focus()   {}
    posAtCoords() { return 3; } // stub for handler-via-real-view tests
  }
  EditorView.updateListener  = { of(fn) { return { _kind: 'updateListener', fn }; } };
  EditorView.lineWrapping    = { _kind: 'lineWrapping' };
  EditorView.domEventHandlers = function (handlers) {
    return { _kind: 'domEventHandlers', handlers };
  };

  return {
    EditorState, EditorView,
    Decoration, ViewPlugin,
    history:  () => ({ _kind: 'history' }),
    markdown: () => ({ _kind: 'markdown' }),
    chrome:   null,
    RangeSetBuilder: class { constructor() { this._spans = []; } add(from, to, value) { this._spans.push({ from, to, value }); } finish() { return { _ranges: this._spans }; } },
    Annotation: { define() { return () => {}; } },
    syntaxTree() { return null; }, // walker handles null gracefully
    keymap:   { of(specs) { return { _kind: 'keymap', specs }; } },
  };
}

function makeFakeParent() {
  return { _isParent: true, appendChild() {}, remove() {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A — resolver and transaction (Stage 23-1 through 23-6)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 23-1: resolveTaskMarkerRange returns the marker range for a positive case', () => {
  const { state, tree } = buildStateAndTree('- [ ] alpha\n- [x] beta\n');
  const { resolveTaskMarkerRange } = loadTaskToggleModule();
  const range = resolveTaskMarkerRange(state, 3, tree);
  assert.ok(range, 'expected a range');
  assert.equal(state.doc.sliceString(range.from, range.to), '[ ]');
  assert.equal(range.from, 2);
  assert.equal(range.to,   5);
});

test('Stage 23-2: resolveTaskMarkerRange returns null for positions outside any TaskMarker', () => {
  const { state, tree } = buildStateAndTree('- [ ] alpha\n- not task\n\nplain paragraph\n');
  const { resolveTaskMarkerRange } = loadTaskToggleModule();
  assert.equal(resolveTaskMarkerRange(state, 0, tree), null, 'bullet must not match');
  assert.equal(resolveTaskMarkerRange(state, 1, tree), null, 'space after bullet must not match');
  assert.equal(resolveTaskMarkerRange(state, 6, tree), null, 'label text must not match');
  assert.equal(resolveTaskMarkerRange(state, 14, tree), null, 'non-task list item must not match');
  const para = state.doc.toString().indexOf('plain');
  assert.equal(resolveTaskMarkerRange(state, para, tree), null, 'plain paragraph must not match');
});

test('Stage 23-3: resolveTaskMarkerRange handles boundary positions correctly', () => {
  const { state, tree } = buildStateAndTree('- [ ] alpha\n');
  const { resolveTaskMarkerRange } = loadTaskToggleModule();
  assert.deepEqual(resolveTaskMarkerRange(state, 2, tree), { from: 2, to: 5 });
  assert.deepEqual(resolveTaskMarkerRange(state, 4, tree), { from: 2, to: 5 });
  assert.equal(resolveTaskMarkerRange(state, 5, tree), null);
});

test('Stage 23-4: resolveTaskMarkerRange resolves the inner marker in a nested task list', () => {
  const doc = '- [ ] outer\n  - [x] inner\n';
  const { state, tree } = buildStateAndTree(doc);
  const { resolveTaskMarkerRange } = loadTaskToggleModule();
  const outerStart = doc.indexOf('[ ]');
  const innerStart = doc.indexOf('[x]');
  const innerRange = resolveTaskMarkerRange(state, innerStart + 1, tree);
  assert.ok(innerRange);
  assert.equal(state.doc.sliceString(innerRange.from, innerRange.to), '[x]');
  assert.equal(innerRange.from, innerStart);
  assert.notEqual(innerRange.from, outerStart);
});

test('Stage 23-5: buildToggleTransaction flips "[ ]" to "[x]" as a one-char change', () => {
  const { state } = buildStateAndTree('- [ ] alpha\n');
  const { buildToggleTransaction } = loadTaskToggleModule();
  const spec = buildToggleTransaction(state, { from: 2, to: 5 });
  assert.ok(spec);
  assert.ok(spec.changes);
  assert.equal(spec.changes.from,   3);
  assert.equal(spec.changes.to,     4);
  assert.equal(spec.changes.insert, 'x');
  assert.equal(spec.userEvent, 'input.toggle.task');
  assert.equal('selection' in spec, false);
});

test('Stage 23-6: buildToggleTransaction flips "[x]" and "[X]" to "[ ]"', () => {
  const lower = buildStateAndTree('- [x] one\n');
  const upper = buildStateAndTree('- [X] two\n');
  const { buildToggleTransaction } = loadTaskToggleModule();
  const lowerSpec = buildToggleTransaction(lower.state, { from: 2, to: 5 });
  const upperSpec = buildToggleTransaction(upper.state, { from: 2, to: 5 });
  assert.equal(lowerSpec.changes.insert, ' ');
  assert.equal(upperSpec.changes.insert, ' ');
  assert.equal('selection' in lowerSpec, false);
  assert.equal('selection' in upperSpec, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — mousedown handler (Stage 23-7 through 23-10)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 23-7: handler short-circuits when view.composing === true (IME safety)', () => {
  const mousedown = extractMousedownHandler();
  const view = makeStubView({ composing: true });
  const result = mousedown(makeStubEvent(), view);
  assert.equal(view._dispatched.length, 0);
  assert.equal(result, false);
});

test('Stage 23-8: handler dispatches on primary click (and calls preventDefault) and ignores middle/right clicks', () => {
  const mousedown = extractMousedownHandler();

  const v0 = makeStubView();
  const e0 = makeStubEvent({ button: 0 });
  const r0 = mousedown(e0, v0);
  assert.equal(v0._dispatched.length, 1, 'primary click must dispatch');
  assert.equal(e0._prevented, true,
    'primary click on a TaskMarker must call event.preventDefault() so '
    + 'caret-placement does not fight the toggle');
  assert.equal(r0, true,
    'primary click on a TaskMarker must return true so CodeMirror consumes the event');

  const v1 = makeStubView();
  mousedown(makeStubEvent({ button: 1 }), v1);
  assert.equal(v1._dispatched.length, 0, 'middle click must not dispatch');

  const v2 = makeStubView();
  mousedown(makeStubEvent({ button: 2 }), v2);
  assert.equal(v2._dispatched.length, 0, 'right click must not dispatch');
});

test('Stage 23-9: handler ignores primary clicks held with any modifier key', () => {
  const mousedown = extractMousedownHandler();
  for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
    const v = makeStubView();
    const e = makeStubEvent({ button: 0, mods: { [mod]: true } });
    mousedown(e, v);
    assert.equal(v._dispatched.length, 0, mod + ' must not dispatch');
    assert.equal(e._prevented,         false);
  }
});

test('Stage 23-10: the dispatched transaction omits a selection field', () => {
  const mousedown = extractMousedownHandler();
  const view = makeStubView({ composing: false, posResult: 3 });
  mousedown(makeStubEvent(), view);
  assert.equal(view._dispatched.length, 1);
  const spec = view._dispatched[0];
  assert.ok(spec.changes);
  assert.equal('selection' in spec, false);
  assert.equal(spec.userEvent, 'input.toggle.task');
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — walker integration absent / present (Stage 23-11, 23-12)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 23-11: cm6-hybrid-view.js builds extensions without globalThis.Cm6TaskToggle', () => {
  const before = globalThis.Cm6TaskToggle;
  try {
    delete globalThis.Cm6TaskToggle;
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6BackendCapturing(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions));
    const taskExtensions = capture.lastExtensions.filter(
      (e) => e && e._kind === 'domEventHandlers'
    );
    assert.equal(taskExtensions.length, 0,
      'no task-toggle extension when globalThis.Cm6TaskToggle is absent');
  } finally {
    if (before !== undefined) globalThis.Cm6TaskToggle = before;
    else delete globalThis.Cm6TaskToggle;
  }
});

test('Stage 23-12: cm6-hybrid-view.js appends the task-toggle extension exactly once when globalThis.Cm6TaskToggle is present', () => {
  const before = globalThis.Cm6TaskToggle;
  try {
    const sentinelMousedown = { _kind: 'domEventHandlers', __taskToggleSentinel: true };
    const sentinelKeymap    = { _kind: 'keymap', __taskToggleSentinel: true };
    globalThis.Cm6TaskToggle = {
      createTaskToggleExtension: function () { return [sentinelMousedown, sentinelKeymap]; },
    };
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6BackendCapturing(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions));
    const matches = capture.lastExtensions.filter((e) => e && e.__taskToggleSentinel);
    assert.equal(matches.length, 2,
      'expected exactly 2 sentinel entries (mousedown + keymap) appended once');
  } finally {
    if (before !== undefined) globalThis.Cm6TaskToggle = before;
    else delete globalThis.Cm6TaskToggle;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D — keyboard command (Stage 23-13 through 23-16)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 23-13: toggleTaskAtCaret returns true and dispatches when caret line has a TaskMarker', () => {
  const { cm6, state } = buildStateAndTree('- [ ] alpha\n- [x] beta\n');
  const { toggleTaskAtCaret } = loadTaskToggleModule();
  const dispatched = [];
  const caretPosInsideFirstMarker = 3;
  const stateWithCaret = state.update({
    selection: { anchor: caretPosInsideFirstMarker, head: caretPosInsideFirstMarker },
  }).state;
  const view = {
    composing: false,
    state: stateWithCaret,
    dispatch: (spec) => { dispatched.push(spec); },
  };
  const result = toggleTaskAtCaret(view, cm6);
  assert.equal(result, true, 'returns true on successful toggle');
  assert.equal(dispatched.length, 1, 'dispatches exactly one transaction');
  const spec = dispatched[0];
  assert.equal(spec.changes.from,   3);
  assert.equal(spec.changes.to,     4);
  assert.equal(spec.changes.insert, 'x');
  assert.equal(spec.userEvent, 'input.toggle.task');
  assert.equal('selection' in spec, false);
});

test('Stage 23-14: toggleTaskAtCaret returns false and does not dispatch when caret line has no TaskMarker', () => {
  const { cm6, state } = buildStateAndTree('plain paragraph line\n- [ ] task line\n');
  const { toggleTaskAtCaret } = loadTaskToggleModule();
  const dispatched = [];
  const caretInParagraph = 5; // inside "plain"
  const stateWithCaret = state.update({
    selection: { anchor: caretInParagraph, head: caretInParagraph },
  }).state;
  const view = {
    composing: false,
    state: stateWithCaret,
    dispatch: (spec) => { dispatched.push(spec); },
  };
  const result = toggleTaskAtCaret(view, cm6);
  assert.equal(result, false);
  assert.equal(dispatched.length, 0);
});

test('Stage 23-15: toggleTaskAtCaret returns false and does not dispatch when view.composing === true', () => {
  const { cm6, state } = buildStateAndTree('- [ ] alpha\n');
  const { toggleTaskAtCaret } = loadTaskToggleModule();
  const dispatched = [];
  const view = {
    composing: true,
    state,
    dispatch: (spec) => { dispatched.push(spec); },
  };
  const result = toggleTaskAtCaret(view, cm6);
  assert.equal(result, false);
  assert.equal(dispatched.length, 0);
});

test('Stage 23-16: createTaskToggleExtension(cm6) returns both a domEventHandlers entry and a keymap entry with chord Mod-Shift-x', () => {
  const mod = loadTaskToggleModule();
  const recordingCm6 = makeFakeCm6BackendCapturing({});
  const ext = mod.createTaskToggleExtension(recordingCm6);
  assert.ok(Array.isArray(ext) || ext == null, 'extension factory returns an array or null');
  const arr = Array.isArray(ext) ? ext : [];
  const mousedownEntry = arr.find(
    (e) => e && e._kind === 'domEventHandlers' && e.handlers && typeof e.handlers.mousedown === 'function'
  );
  const keymapEntry = arr.find(
    (e) => e && e._kind === 'keymap' && Array.isArray(e.specs)
  );
  assert.ok(mousedownEntry, 'extension must include a domEventHandlers entry with mousedown');
  assert.ok(keymapEntry,    'extension must include a keymap entry');
  const hasModShiftX = keymapEntry.specs.some(
    (s) => s && s.key === 'Mod-Shift-x' && typeof s.run === 'function'
  );
  assert.ok(hasModShiftX, 'keymap must include a Mod-Shift-x binding with a run function');
});

// ─────────────────────────────────────────────────────────────────────────────
// Group E — programmatic undo / redo via cm6.undo / cm6.redo
// (Stage 23-17, 23-18 — require Stage 22.5 exports)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 23-17: programmatic cm6.undo reverts the toggle in one step', () => {
  const { cm6, state, tree } = buildStateWithHistory('- [ ] alpha\n');
  const { resolveTaskMarkerRange, buildToggleTransaction } = loadTaskToggleModule();
  const range = resolveTaskMarkerRange(state, 3, tree);
  const spec  = buildToggleTransaction(state, range);
  const harness = makeStateHarness(state);
  harness.dispatch(spec);
  assert.equal(harness.state.doc.toString(), '- [x] alpha\n', 'toggle applied');
  const undid = cm6.undo({ state: harness.state, dispatch: harness.dispatch });
  assert.equal(undid, true, 'cm6.undo returned true');
  assert.equal(harness.state.doc.toString(), '- [ ] alpha\n',
    'document reverted to pre-toggle text in one undo step');
});

test('Stage 23-18: programmatic cm6.redo reapplies the toggle in one step', () => {
  const { cm6, state, tree } = buildStateWithHistory('- [ ] alpha\n');
  const { resolveTaskMarkerRange, buildToggleTransaction } = loadTaskToggleModule();
  const range = resolveTaskMarkerRange(state, 3, tree);
  const spec  = buildToggleTransaction(state, range);
  const harness = makeStateHarness(state);
  harness.dispatch(spec);
  cm6.undo({ state: harness.state, dispatch: harness.dispatch });
  assert.equal(harness.state.doc.toString(), '- [ ] alpha\n');
  const redid = cm6.redo({ state: harness.state, dispatch: harness.dispatch });
  assert.equal(redid, true, 'cm6.redo returned true');
  assert.equal(harness.state.doc.toString(), '- [x] alpha\n',
    'document returned to post-toggle text in one redo step');
});

// ─────────────────────────────────────────────────────────────────────────────
// Group F — peer source-file contract for cm6-task-toggle.js
// Stage 23-19 lives in its own file (cm6-task-toggle-invariants.test.js).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Group G — integrated onChange wiring (Stage 23-20)
// Per the Stage 23 v2 execution guardrail: direct-dispatch variant.
// Verifies the updateListener-onChange wiring only; the walker's task-toggle
// hook coverage is provided by Stage 23-11 (absent) and Stage 23-12 (present
// exactly once).
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 23-20: createCm6HybridView wires onChange so a toggle-shaped dispatch fires it', () => {
  const before = globalThis.Cm6TaskToggle;
  try {
    globalThis.Cm6TaskToggle = loadTaskToggleModule();
    const { createCm6HybridView } = loadHybridViewModule();
    const cm6 = makeFakeCm6BackendCapturing({});
    const onChangeCalls = [];
    const adapter = createCm6HybridView(makeFakeParent(), {
      cm6,
      initialDoc: '- [ ] x\n',
      onChange: (text) => onChangeCalls.push(text),
    });
    const { buildToggleTransaction } = globalThis.Cm6TaskToggle;
    const spec = buildToggleTransaction(adapter.view.state, { from: 2, to: 5 });
    assert.ok(spec, 'buildToggleTransaction must return a valid spec for the initial doc');
    adapter.view.dispatch(spec);
    assert.equal(onChangeCalls.length, 1,
      'onChange must fire exactly once when a toggle-shaped transaction dispatches');
    assert.equal(onChangeCalls[0], '- [x] x\n',
      'onChange must receive the post-toggle text');
  } finally {
    if (before !== undefined) globalThis.Cm6TaskToggle = before;
    else delete globalThis.Cm6TaskToggle;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group H — caret-line specificity (Stage 23-21)
// Multiple task lines in one document; toggleTaskAtCaret must touch only
// the line containing the caret, never an off-by-one neighbor.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 23-21: toggleTaskAtCaret toggles only the line containing the caret in a multi-task-line document', () => {
  const doc = '- [ ] one\n- [x] two\n- [ ] three\n';
  const { cm6, state } = buildStateAndTree(doc);
  const { toggleTaskAtCaret } = loadTaskToggleModule();

  function caretPosOnLine(n) {
    // Position the caret just past the bullet on line n.
    let pos = 0;
    for (let i = 1; i < n; i++) pos = doc.indexOf('\n', pos) + 1;
    return pos + 3; // inside the marker brackets
  }

  function runToggle(linePosition) {
    const dispatched = [];
    const carriedState = state.update({
      selection: { anchor: linePosition, head: linePosition },
    }).state;
    const view = {
      composing: false,
      state: carriedState,
      dispatch: (spec) => { dispatched.push(spec); },
    };
    const result = toggleTaskAtCaret(view, cm6);
    return { result, dispatched };
  }

  // Caret on line 1 ("- [ ] one"): toggle should target the line-1 marker.
  const r1 = runToggle(caretPosOnLine(1));
  assert.equal(r1.result, true);
  assert.equal(r1.dispatched.length, 1);
  assert.equal(r1.dispatched[0].changes.from, doc.indexOf('[ ]') + 1,
    'line 1 toggle hits line-1 marker payload');

  // Caret on line 2 ("- [x] two"): toggle should target the line-2 marker.
  const r2 = runToggle(caretPosOnLine(2));
  assert.equal(r2.result, true);
  assert.equal(r2.dispatched.length, 1);
  assert.equal(r2.dispatched[0].changes.from, doc.indexOf('[x]') + 1,
    'line 2 toggle hits line-2 marker payload');
  assert.equal(r2.dispatched[0].changes.insert, ' ',
    'line 2 toggle flips [x] to [ ]');

  // Caret on line 3 ("- [ ] three"): toggle should target the line-3 marker.
  const r3 = runToggle(caretPosOnLine(3));
  assert.equal(r3.result, true);
  assert.equal(r3.dispatched.length, 1);
  const thirdMarkerStart = doc.indexOf('[ ]', doc.indexOf('[x]'));
  assert.equal(r3.dispatched[0].changes.from, thirdMarkerStart + 1,
    'line 3 toggle hits line-3 marker payload');
});
