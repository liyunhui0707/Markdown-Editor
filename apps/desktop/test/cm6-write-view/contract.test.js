/* TDD: Cm6WriteView — production adapter contract tests.
   Run: node --test test/cm6-write-view/contract.test.js

   These tests target the BEHAVIOR of the adapter, not its CM6 internals.
   Real CodeMirror 6 needs a DOM, so we inject a minimal CM6 backend
   (`makeFakeCm6`) that mimics the small slice of API the adapter uses:

     EditorState.create({ doc, extensions })
     EditorView({ state, parent }), .dispatch(spec), .setState(state),
                                   .destroy(), .focus()
     EditorView.updateListener.of(fn)
     EditorView.lineWrapping
     Annotation.define()
     history()
     markdown()

   CM6's own storage semantics (LF normalization, byte-preservation) are
   already verified in test/spike-cm6/round-trip.test.js against the real
   library, so we do not duplicate that here. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { createCm6WriteView } = require('../../lib/cm6-write-view');

// ── Fake CM6 backend ──────────────────────────────────────────────────────────
// Implements only the API surface the adapter consumes. Tracks an _undoStack
// per state instance so tests can assert history isolation across note swaps.

function makeFakeCm6() {
  function defineAnnotation() {
    const sym = Symbol('annotation');
    function factory(value) { return { _sym: sym, value }; }
    factory._sym = sym;
    return factory;
  }

  function makeDoc(s) {
    return {
      _s: s,
      get length() { return this._s.length; },
      toString() { return this._s; },
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
    const sorted = [...list].sort((a, b) => (b.from ?? 0) - (a.from ?? 0));
    let out = s;
    for (const c of sorted) {
      const from = c.from ?? 0;
      const to = c.to ?? from;
      const insert = c.insert ?? '';
      out = out.slice(0, from) + insert + out.slice(to);
    }
    return out;
  }

  const EditorState = {
    create({ doc, extensions = [] }) {
      const flat = flatten(extensions);
      const listeners = flat.filter((e) => e && e._kind === 'updateListener').map((e) => e.fn);
      return {
        doc: makeDoc(typeof doc === 'string' ? doc : ''),
        _listeners: listeners,
        _historyMarker: flat.find((e) => e && e._kind === 'history') || null,
        _extensions: flat,
        _undoStack: [],
      };
    },
  };

  function collectAnnotations(a) {
    if (!a) return [];
    return Array.isArray(a) ? a : [a];
  }

  class EditorView {
    constructor({ state, parent }) {
      this.state = state;
      this.parent = parent;
      this._destroyed = false;
      this._focused = false;
    }
    dispatch(spec) {
      if (this._destroyed) return;
      const annotations = collectAnnotations(spec.annotations);
      const newDocStr = applyChanges(this.state.doc.toString(), spec.changes);
      const tr = {
        annotation(factory) {
          for (const a of annotations) if (a._sym === factory._sym) return a.value;
          return undefined;
        },
        _changes: spec.changes,
      };
      const docChanged = newDocStr !== this.state.doc.toString();
      const newState = {
        ...this.state,
        doc: makeDoc(newDocStr),
        _undoStack: docChanged ? [...this.state._undoStack, tr] : this.state._undoStack,
      };
      const update = {
        docChanged,
        state: newState,
        startState: this.state,
        transactions: [tr],
      };
      this.state = newState;
      for (const fn of this.state._listeners) {
        try { fn(update); } catch (_) { /* test fakes shouldn't crash on listener errors */ }
      }
    }
    setState(newState) { this.state = newState; }
    destroy() { this._destroyed = true; }
    focus() { this._focused = true; }
  }

  EditorView.updateListener = { of(fn) { return { _kind: 'updateListener', fn }; } };
  EditorView.lineWrapping = { _kind: 'lineWrapping' };

  return {
    EditorState,
    EditorView,
    Annotation: { define: defineAnnotation },
    history: () => ({ _kind: 'history' }),
    markdown: () => ({ _kind: 'markdown' }),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParent() { return { _isParent: true }; }

function simulateUserInsert(adapter, text, atOffset) {
  const at = atOffset == null ? adapter.view.state.doc.length : atOffset;
  adapter.view.dispatch({ changes: { from: at, to: at, insert: text } });
}

// ── Contract surface ──────────────────────────────────────────────────────────

test('adapter exposes getText, setText, exitWriteMode', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  assert.equal(typeof a.getText, 'function');
  assert.equal(typeof a.setText, 'function');
  assert.equal(typeof a.exitWriteMode, 'function');
});

test('initial doc is empty string when not provided', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  assert.equal(a.getText(), '');
});

test('initialDoc is honored', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: '# hello\n' });
  assert.equal(a.getText(), '# hello\n');
});

test('setText then getText returns the same LF Markdown string', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  const md = '# h\n\n- a\n- b\n\n```js\nconst x = 1;\n```\n';
  a.setText(md);
  assert.equal(a.getText(), md);
});

test('setText handles null/undefined as empty string', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: 'seed' });
  a.setText(null);
  assert.equal(a.getText(), '');
  a.setText(undefined);
  assert.equal(a.getText(), '');
});

test('exitWriteMode is a no-op for CM6 and does not change content', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: '# alive\n' });
  const result = a.exitWriteMode();
  assert.equal(result, undefined);
  assert.equal(a.getText(), '# alive\n');
});

// ── Programmatic-update protection ────────────────────────────────────────────

test('programmatic setText does NOT trigger onChange', () => {
  const cm6 = makeFakeCm6();
  const calls = [];
  const a = createCm6WriteView(makeParent(), {
    cm6,
    initialDoc: 'before',
    onChange: (text) => calls.push(text),
  });
  a.setText('after');
  assert.equal(a.getText(), 'after');
  assert.deepEqual(calls, []);
});

test('multiple setText calls in sequence do NOT trigger onChange', () => {
  const cm6 = makeFakeCm6();
  const calls = [];
  const a = createCm6WriteView(makeParent(), { cm6, onChange: (t) => calls.push(t) });
  a.setText('A');
  a.setText('B');
  a.setText('C');
  assert.deepEqual(calls, []);
});

test('simulated user edit DOES trigger onChange with the new text', () => {
  const cm6 = makeFakeCm6();
  const calls = [];
  const a = createCm6WriteView(makeParent(), {
    cm6,
    initialDoc: 'hi',
    onChange: (text) => calls.push(text),
  });
  simulateUserInsert(a, '!');
  assert.equal(a.getText(), 'hi!');
  assert.deepEqual(calls, ['hi!']);
});

test('user edits after a setText fire onChange against the new doc', () => {
  const cm6 = makeFakeCm6();
  const calls = [];
  const a = createCm6WriteView(makeParent(), {
    cm6,
    initialDoc: 'old',
    onChange: (t) => calls.push(t),
  });
  a.setText('fresh');
  simulateUserInsert(a, '-edited');
  assert.deepEqual(calls, ['fresh-edited']);
});

test('adapter without onChange does not crash on edits', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: 'x' });
  simulateUserInsert(a, 'y');
  assert.equal(a.getText(), 'xy');
});

// ── Note-switch flow ──────────────────────────────────────────────────────────

test('note-switch: A → edit A → switch to B; getText returns B exactly', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('# Note A\n');
  simulateUserInsert(a, 'edit-in-A');
  assert.equal(a.getText(), '# Note A\nedit-in-A');
  a.setText('# Note B\n');
  assert.equal(a.getText(), '# Note B\n');
});

test('note-switch: A → edit → read back BEFORE switch reflects edit (host can flush)', () => {
  // The host (renderer) is responsible for calling getText() before switching
  // to capture in-flight edits. The adapter only guarantees that getText returns
  // the live doc at any moment. This test pins that contract.
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('A-orig');
  simulateUserInsert(a, '+edit');
  const flushed = a.getText();
  assert.equal(flushed, 'A-orig+edit');
  a.setText('B-orig');
  assert.equal(a.getText(), 'B-orig');
});

test('note-switch resets state instance (history isolation proxy)', () => {
  // Real CM6: view.setState(newState) replaces the state object entirely,
  // including the history extension instance. We verify the same shape
  // here with the fake — a fresh state object with an empty undo stack.
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('Note A');
  simulateUserInsert(a, ' edit-1');
  simulateUserInsert(a, ' edit-2');
  const stateBefore = a.view.state;
  assert.equal(stateBefore._undoStack.length, 2);

  a.setText('Note B');
  const stateAfter = a.view.state;
  assert.notEqual(stateAfter, stateBefore, 'state instance should be replaced');
  assert.equal(stateAfter._undoStack.length, 0, 'undo stack should be empty after note switch');
});

test('note-switch: edits to A are not present in B and cannot be reached via undo from B', () => {
  // Behavioral consequence of state replacement: B's editor has no knowledge
  // of A's edits. The fake's _undoStack is the proxy.
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('A');
  simulateUserInsert(a, '-A1');
  simulateUserInsert(a, '-A2');
  a.setText('B');
  // Any "undo" path on B's state would only see B's own (empty) stack.
  for (const tr of a.view.state._undoStack) {
    assert.notMatch(JSON.stringify(tr._changes || ''), /A1|A2/);
  }
  assert.equal(a.getText(), 'B');
});

// ── Raw Markdown preservation & edge cases ────────────────────────────────────

test('blank document is representable as empty string', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('');
  assert.equal(a.getText(), '');
});

test('large Markdown string (5000 lines) round-trips through setText/getText', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    if (i % 25 === 0) lines.push(`## Section ${i / 25 + 1}`);
    else if (i % 7 === 0) lines.push(`- list item ${i} **bold** *italic*`);
    else lines.push(`Line ${i}: the quick brown fox jumps over the lazy dog.`);
  }
  const doc = lines.join('\n');
  a.setText(doc);
  assert.equal(a.getText(), doc);
  assert.equal(a.getText().split('\n').length, 5000);
});

test('adapter does not produce or store HTML — getText returns raw Markdown bytes', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  const md = '# heading\n\n**bold** and <em>raw HTML</em> and `code`\n';
  a.setText(md);
  const out = a.getText();
  assert.equal(out, md);
  // No HTML escaping, no rendering — the literal string is preserved.
  assert.match(out, /<em>raw HTML<\/em>/);
  assert.match(out, /\*\*bold\*\*/);
});

// ── Operational hooks ─────────────────────────────────────────────────────────

test('focus() does not throw and forwards to the view', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.focus();
  assert.equal(a.view._focused, true);
});

test('destroy() does not throw and disables further dispatches', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: 'live' });
  a.destroy();
  assert.equal(a.view._destroyed, true);
  // Post-destroy dispatch is a no-op (mirrors real CM6 view behavior).
  simulateUserInsert(a, '!');
  assert.equal(a.getText(), 'live');
});

test('throws a clear error when no cm6 backend is provided', () => {
  assert.throws(
    () => createCm6WriteView(makeParent(), {}),
    /cm6/i
  );
});

// ── Chrome extensions (production decorations) ────────────────────────────────
// `cm6-entry.js` exports a `chrome` array containing the spike-proven
// production decorations: keymaps (default + history + search), syntax
// highlighting, line numbers, active-line behavior, bracket matching,
// selection drawing. The adapter must include them in the EditorState so
// the production editor actually has a usable UI.

test('cm6.chrome extensions are included on initial adapter creation', () => {
  const cm6 = makeFakeCm6();
  const chromeMarkerA = { _kind: 'chrome-keymap' };
  const chromeMarkerB = { _kind: 'chrome-line-numbers' };
  cm6.chrome = [chromeMarkerA, chromeMarkerB];
  const a = createCm6WriteView(makeParent(), { cm6 });
  assert.ok(a.view.state._extensions.includes(chromeMarkerA),
    'chrome-keymap extension should be present on initial state');
  assert.ok(a.view.state._extensions.includes(chromeMarkerB),
    'chrome-line-numbers extension should be present on initial state');
});

test('cm6.chrome extensions are still included after setText (note switch)', () => {
  const cm6 = makeFakeCm6();
  const chromeMarker = { _kind: 'chrome-syntax-highlighting' };
  cm6.chrome = [chromeMarker];
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: '# A\n' });
  assert.ok(a.view.state._extensions.includes(chromeMarker), 'present before setText');
  a.setText('# B\n');
  assert.ok(a.view.state._extensions.includes(chromeMarker),
    'chrome must be re-included on the freshly-built state after note switch');
});

test('cm6.chrome is optional — adapter works when chrome is absent', () => {
  const cm6 = makeFakeCm6();
  // makeFakeCm6 does not set cm6.chrome by default
  assert.equal(cm6.chrome, undefined);
  const a = createCm6WriteView(makeParent(), { cm6 });
  assert.equal(a.getText(), '');
  a.setText('hello');
  assert.equal(a.getText(), 'hello');
});

test('cm6.chrome that is not an array is ignored, not crashed', () => {
  const cm6 = makeFakeCm6();
  cm6.chrome = 'not-an-array';
  const a = createCm6WriteView(makeParent(), { cm6 });
  assert.equal(a.getText(), '');
  // Sanity: extensions list does not contain the bogus value as a member.
  assert.ok(!a.view.state._extensions.includes('not-an-array'));
});

test('setText with chrome still preserves note-switch undo isolation', () => {
  // Regression guard: adding chrome must NOT change the state-replacement
  // semantics of setText. Re-asserts the history-isolation behavior.
  const cm6 = makeFakeCm6();
  cm6.chrome = [{ _kind: 'chrome' }];
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('Note A');
  simulateUserInsert(a, ' edit-1');
  simulateUserInsert(a, ' edit-2');
  const stateBefore = a.view.state;
  assert.equal(stateBefore._undoStack.length, 2);

  a.setText('Note B');
  const stateAfter = a.view.state;
  assert.notEqual(stateAfter, stateBefore, 'state instance should be replaced');
  assert.equal(stateAfter._undoStack.length, 0, 'undo stack empty after note switch');
  assert.equal(a.getText(), 'Note B');
});

test('setText with chrome still does NOT trigger onChange', () => {
  // Regression guard: chrome inclusion must not introduce a path that
  // routes programmatic state replacement through the update listener.
  const cm6 = makeFakeCm6();
  cm6.chrome = [{ _kind: 'chrome' }];
  const calls = [];
  const a = createCm6WriteView(makeParent(), {
    cm6,
    initialDoc: 'before',
    onChange: (text) => calls.push(text),
  });
  a.setText('after');
  assert.equal(a.getText(), 'after');
  assert.deepEqual(calls, []);
});

// ── Note-local undo: opaque state save/restore ────────────────────────────────
// These tests pin the contract used by the renderer host to keep undo history
// note-local across A → B → A switches in CM6. The host caches `getState()`
// for the outgoing note and calls `setState()` to restore it when re-entering
// the same note, instead of `setText()` (which always rebuilds history).

test('getState() returns the current CM6 state', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: 'hello' });
  assert.equal(typeof a.getState, 'function');
  const state = a.getState();
  assert.ok(state, 'getState should return a non-null state');
  assert.equal(state.doc.toString(), 'hello');
  assert.equal(state, a.view.state, 'getState should return the live view state');
});

test('setState(state) replaces the current state with the provided state', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6, initialDoc: 'A' });
  const savedA = a.getState();
  a.setText('B');
  assert.equal(a.getText(), 'B');
  a.setState(savedA);
  assert.equal(a.getText(), 'A');
  assert.equal(a.view.state, savedA, 'view.state should be the restored state instance');
});

test('setState(state) does not trigger onChange', () => {
  const cm6 = makeFakeCm6();
  const calls = [];
  const a = createCm6WriteView(makeParent(), {
    cm6,
    initialDoc: 'first',
    onChange: (text) => calls.push(text),
  });
  const saved = a.getState();
  // A real user edit DOES fire onChange — this is just to populate the call log
  // so we can assert setState afterwards adds nothing.
  simulateUserInsert(a, '!');
  assert.deepEqual(calls, ['first!']);
  a.setState(saved);
  assert.equal(a.getText(), 'first');
  assert.deepEqual(calls, ['first!'], 'setState must not fire onChange');
});

test('getState → setText("other") → setState(saved) restores original doc and undo history', () => {
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('Note A body');
  simulateUserInsert(a, ' edit-1');
  simulateUserInsert(a, ' edit-2');
  const saved = a.getState();
  assert.equal(saved._undoStack.length, 2, 'saved state retains its history');

  a.setText('Note B body');
  assert.equal(a.getText(), 'Note B body');
  assert.equal(a.view.state._undoStack.length, 0, 'fresh state after setText has empty history');

  a.setState(saved);
  assert.equal(a.getText(), 'Note A body edit-1 edit-2');
  assert.equal(a.view.state._undoStack.length, 2,
    'restoring the saved state must preserve its undo history');
});

test('setText after setState resets history again (no leak)', () => {
  // setText is the "fresh load" path — it must always rebuild state, even
  // when the prior state came from a setState restore.
  const cm6 = makeFakeCm6();
  const a = createCm6WriteView(makeParent(), { cm6 });
  a.setText('A');
  simulateUserInsert(a, ' edit');
  const saved = a.getState();
  a.setState(saved);
  assert.equal(a.view.state._undoStack.length, 1);

  a.setText('fresh');
  assert.equal(a.getText(), 'fresh');
  assert.equal(a.view.state._undoStack.length, 0,
    'setText after setState must still reset history');
});
