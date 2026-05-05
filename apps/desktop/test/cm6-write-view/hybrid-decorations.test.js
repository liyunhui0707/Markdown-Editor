/* TDD: Cm6HybridView adapter-contract tests (Stage 11.4).
   Run: node --test test/cm6-write-view/hybrid-decorations.test.js

   These tests exercise the surface contract of createCm6HybridView using a
   minimal fake CM6 backend (no DOM, no real syntax tree). Tests for the
   syntaxTree-driven heading marks live in heading-marks.test.js where a
   real markdown parser is available.

   Contract under test:
     - getText / setText / getState / setState / exitWriteMode exposed
     - getText returns raw Markdown verbatim
     - user edit fires onChange with raw Markdown
     - cursor-only movement does NOT fire onChange
     - setText does NOT fire onChange
     - setState round-trips the document */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { createCm6HybridView } = require('../../lib/cm6-hybrid-view');

// ── Fake CM6 backend — minimal surface for adapter-contract tests ───────────
// No syntaxTree: buildHeadingDecorations short-circuits to an empty set.
function makeFakeCm6() {
  function makeDoc(s) {
    return { _s: String(s), get length() { return this._s.length; }, toString() { return this._s; } };
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
      const to   = c.to   ?? from;
      const ins  = c.insert ?? '';
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
    set(arr) {
      return { _ranges: [...(arr || [])] };
    },
    none: { _ranges: [] },
  };

  const ViewPlugin = {
    fromClass(pluginClass, spec) {
      const ref = { pluginClass, spec, instance: null };
      return { _kind: 'viewPlugin', _ref: ref, _attach(view) { ref.instance = new pluginClass(view); return ref; } };
    },
  };

  const EditorState = {
    create({ doc, extensions = [] }) {
      const flat = flatten(extensions);
      const listeners = flat.filter((e) => e && e._kind === 'updateListener').map((e) => e.fn);
      const plugins   = flat.filter((e) => e && e._kind === 'viewPlugin');
      return {
        doc: makeDoc(typeof doc === 'string' ? doc : ''),
        _listeners: listeners,
        _plugins:   plugins,
        _extensions: flat,
        selection: { main: { head: 0, anchor: 0 } },
      };
    },
  };

  class EditorView {
    constructor({ state, parent }) {
      this.state      = state;
      this.parent     = parent;
      this._destroyed = false;
      this._initPlugins();
    }
    _initPlugins() {
      for (const p of (this.state._plugins || [])) {
        if (typeof p._attach === 'function') p._attach(this);
      }
    }
    dispatch(spec) {
      if (this._destroyed) return;
      const prev   = this.state.doc.toString();
      const newStr = spec.changes != null ? applyChanges(prev, spec.changes) : prev;
      const docChanged   = newStr !== prev;
      const newSel       = spec.selection !== undefined ? spec.selection : this.state.selection;
      const selectionSet = spec.selection !== undefined;
      const newState = {
        ...this.state,
        doc: makeDoc(newStr),
        selection: newSel,
      };
      this.state = newState;
      const update = { view: this, state: newState, docChanged, selectionSet, viewportChanged: false };
      for (const p of (this.state._plugins || [])) {
        if (p._ref && p._ref.instance && typeof p._ref.instance.update === 'function') {
          p._ref.instance.update(update);
        }
      }
      for (const fn of this.state._listeners) { try { fn(update); } catch (_) {} }
    }
    setState(newState) { this.state = newState; this._initPlugins(); }
    destroy() { this._destroyed = true; }
    focus()   { /* no-op */ }
  }
  EditorView.updateListener = { of(fn) { return { _kind: 'updateListener', fn }; } };
  EditorView.lineWrapping   = { _kind: 'lineWrapping' };

  return {
    EditorState, EditorView,
    Annotation: { define() { return () => {}; } },
    history:  () => ({ _kind: 'history' }),
    markdown: () => ({ _kind: 'markdown' }),
    chrome:   null,
    Decoration, ViewPlugin,
    // No syntaxTree — buildHeadingDecorations returns an empty set.
  };
}

function makeParent() { return { _isParent: true }; }
function moveHead(adapter, head) {
  adapter.view.dispatch({ selection: { main: { head, anchor: head } } });
}

// ── Adapter contract tests ──────────────────────────────────────────────────

test('adapter exposes getText, setText, getState, setState, exitWriteMode', () => {
  const cm6 = makeFakeCm6();
  const a   = createCm6HybridView(makeParent(), { cm6 });
  assert.equal(typeof a.getText,       'function');
  assert.equal(typeof a.setText,       'function');
  assert.equal(typeof a.getState,      'function');
  assert.equal(typeof a.setState,      'function');
  assert.equal(typeof a.exitWriteMode, 'function');
});

test('getText returns raw Markdown, not HTML', () => {
  const cm6 = makeFakeCm6();
  const doc = '# Hello & <World>\n\nsome text\n';
  const a   = createCm6HybridView(makeParent(), { cm6, initialDoc: doc });
  assert.equal(a.getText(), doc);
});

test('user edit fires onChange with raw Markdown', () => {
  const cm6 = makeFakeCm6();
  const received = [];
  const a = createCm6HybridView(makeParent(), { cm6, onChange: (t) => received.push(t) });
  a.view.dispatch({ changes: { from: 0, to: 0, insert: '# Hello\n' } });
  assert.equal(received.length, 1);
  assert.equal(received[0], '# Hello\n');
});

test('cursor-only movement does not fire onChange', () => {
  const cm6 = makeFakeCm6();
  const received = [];
  const a = createCm6HybridView(makeParent(), {
    cm6,
    initialDoc: '# Hello\nsome text',
    onChange: (t) => received.push(t),
  });
  moveHead(a, 8);
  assert.equal(received.length, 0);
});

test('setText does not fire onChange', () => {
  const cm6 = makeFakeCm6();
  const received = [];
  const a = createCm6HybridView(makeParent(), { cm6, onChange: (t) => received.push(t) });
  a.setText('# New heading\nsome text');
  assert.equal(received.length, 0);
});

test('setState / getState round-trip restores the document', () => {
  const cm6 = makeFakeCm6();
  const a   = createCm6HybridView(makeParent(), { cm6, initialDoc: '# Alpha\n' });
  const saved = a.getState();
  a.setText('# Beta\n');
  assert.equal(a.getText(), '# Beta\n');
  a.setState(saved);
  assert.equal(a.getText(), '# Alpha\n');
});

test('throws when cm6 backend is missing', () => {
  assert.throws(
    () => createCm6HybridView(makeParent(), {}),
    /cm6 backend missing/
  );
});

test('throws when ViewPlugin/Decoration primitives are missing', () => {
  const cm6 = makeFakeCm6();
  delete cm6.ViewPlugin;
  assert.throws(
    () => createCm6HybridView(makeParent(), { cm6 }),
    /missing required primitives/
  );
});
