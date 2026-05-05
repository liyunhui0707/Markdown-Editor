/* TDD: Cm6HybridView — hybrid-cm6 adapter + decoration model tests.
   Run: node --test test/cm6-write-view/hybrid-decorations.test.js

   Tests are split into two groups:
     A. buildHybridRenderModel  — pure function, no CM6 required
     B. Adapter contract        — uses a fake CM6 backend that supports
                                  ViewPlugin, Decoration, WidgetType, RangeSetBuilder */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { createCm6HybridView, buildHybridRenderModel } = require('../../lib/cm6-hybrid-view');

// ── A. buildHybridRenderModel — pure-function tests ──────────────────────────

test('buildHybridRenderModel: empty doc produces no headings', () => {
  assert.deepEqual(buildHybridRenderModel('', 0), []);
});

test('buildHybridRenderModel: non-heading lines produce no headings', () => {
  assert.deepEqual(buildHybridRenderModel('just text\n', 0), []);
  assert.deepEqual(buildHybridRenderModel('plain\ntext\nmore', 5), []);
});

test('buildHybridRenderModel: heading with cursor off-line is inactive', () => {
  // "# Hello" = 7 chars (0-6), newline at 7, "some text" starts at 8
  const doc = '# Hello\nsome text';
  const result = buildHybridRenderModel(doc, 8); // cursor on "some text"
  assert.equal(result.length, 1);
  assert.equal(result[0].isActive, false);
  assert.equal(result[0].level, 1);
  assert.equal(result[0].text, '# Hello');
  assert.equal(result[0].from, 0);
  assert.equal(result[0].to, 7);
});

test('buildHybridRenderModel: heading with cursor on-line is active', () => {
  const doc = '# Hello\nsome text';
  const result = buildHybridRenderModel(doc, 2); // cursor inside "# Hello"
  assert.equal(result.length, 1);
  assert.equal(result[0].isActive, true);
});

test('buildHybridRenderModel: two headings, cursor on first — second is inactive', () => {
  const doc = '# First\n## Second\ntext';
  const result = buildHybridRenderModel(doc, 2); // cursor in "# First"
  assert.equal(result.length, 2);
  assert.equal(result[0].isActive, true);
  assert.equal(result[0].text, '# First');
  assert.equal(result[1].isActive, false);
  assert.equal(result[1].level, 2);
  assert.equal(result[1].text, '## Second');
});

test('buildHybridRenderModel: cursor at lineEnd boundary is active (inclusive)', () => {
  // "# Hello" = 7 chars; lineEnd = 7; cursor AT 7 (the \\n position) = still on this line
  const doc = '# Hello\n# World';
  const result = buildHybridRenderModel(doc, 7);
  assert.equal(result[0].isActive, true);  // cursor at lineEnd — active
  assert.equal(result[1].isActive, false);
});

test('buildHybridRenderModel: h2–h6 headings are detected', () => {
  const doc = '## Two\n### Three\n#### Four\n##### Five\n###### Six\n';
  const result = buildHybridRenderModel(doc, 999); // cursor far away
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((h) => h.level), [2, 3, 4, 5, 6]);
  result.forEach((h) => assert.equal(h.isActive, false));
});

test('buildHybridRenderModel: "#nospace" (no space after hashes) is not a heading', () => {
  const doc = '#notaheading\ntext';
  assert.deepEqual(buildHybridRenderModel(doc, 999), []);
});

// ── Fake CM6 backend (ViewPlugin + Decoration support) ────────────────────────

function makeFakeHybridCm6() {
  let _pluginRef = null;

  function makeFakeDomEl(tag) {
    const el = { _tag: tag, className: '', _textContent: '', _innerHTML: null };
    Object.defineProperty(el, 'textContent', {
      get() { return this._textContent; },
      set(v) { this._textContent = String(v); },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._innerHTML; },
      set(v) { this._innerHTML = String(v); },
      enumerable: true, configurable: true,
    });
    return el;
  }

  const fakeDocument = { createElement(tag) { return makeFakeDomEl(tag); } };

  class WidgetType {
    eq() { return false; }
    toDOM() { return makeFakeDomEl('span'); }
    ignoreEvent() { return false; }
  }

  class RangeSetBuilder {
    constructor() { this._ranges = []; }
    add(from, to, decoration) { this._ranges.push({ from, to, decoration }); }
    finish() { return { _ranges: [...this._ranges] }; }
  }

  const Decoration = {
    replace(spec) { return { _kind: 'replace', ...spec }; },
  };

  const ViewPlugin = {
    fromClass(pluginClass, spec) {
      _pluginRef = { pluginClass, spec, instance: null };
      return { _kind: 'viewPlugin', _ref: _pluginRef };
    },
  };

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

  const EditorState = {
    create({ doc, extensions = [] }) {
      const flat = flatten(extensions);
      const listeners = flat.filter((e) => e && e._kind === 'updateListener').map((e) => e.fn);
      return {
        doc: makeDoc(typeof doc === 'string' ? doc : ''),
        _listeners: listeners,
        _extensions: flat,
        selection: { main: { head: 0, anchor: 0 } },
        _undoStack: [],
      };
    },
  };

  class EditorView {
    constructor({ state, parent }) {
      this.state      = state;
      this.parent     = parent;
      this._destroyed = false;
      this._focused   = false;
      this._initPlugin();
    }

    _initPlugin() {
      if (_pluginRef) {
        _pluginRef.instance = new _pluginRef.pluginClass(this);
      }
    }

    dispatch(spec) {
      if (this._destroyed) return;
      const prevDoc   = this.state.doc.toString();
      const newDocStr = spec.changes != null ? applyChanges(prevDoc, spec.changes) : prevDoc;
      const docChanged   = newDocStr !== prevDoc;
      const newSel       = spec.selection !== undefined ? spec.selection : this.state.selection;
      const selectionSet = spec.selection !== undefined;
      const newState = {
        ...this.state,
        doc: makeDoc(newDocStr),
        selection: newSel,
        _undoStack: docChanged
          ? [...this.state._undoStack, { text: newDocStr }]
          : this.state._undoStack,
      };
      this.state = newState;
      const update = { view: this, state: newState, docChanged, selectionSet };
      if (_pluginRef && _pluginRef.instance) _pluginRef.instance.update(update);
      for (const fn of this.state._listeners) { try { fn(update); } catch (_) {} }
    }

    setState(newState) { this.state = newState; this._initPlugin(); }
    destroy() { this._destroyed = true; }
    focus()   { this._focused   = true; }
  }

  EditorView.updateListener = { of(fn) { return { _kind: 'updateListener', fn }; } };
  EditorView.lineWrapping   = { _kind: 'lineWrapping' };

  return {
    EditorState, EditorView,
    Annotation: { define() { return () => {}; } },
    history:  () => ({ _kind: 'history' }),
    markdown: () => ({ _kind: 'markdown' }),
    chrome: null,
    WidgetType, RangeSetBuilder, Decoration, ViewPlugin,
    fakeDocument,
    getPluginRef() { return _pluginRef; },
  };
}

function makeParent() { return { _isParent: true }; }

function moveHead(adapter, head) {
  adapter.view.dispatch({ selection: { main: { head, anchor: head } } });
}

// ── B. Adapter contract tests ─────────────────────────────────────────────────

test('adapter exposes getText, setText, getState, setState, exitWriteMode', () => {
  const cm6 = makeFakeHybridCm6();
  const a = createCm6HybridView(makeParent(), { cm6 });
  assert.equal(typeof a.getText,       'function');
  assert.equal(typeof a.setText,       'function');
  assert.equal(typeof a.getState,      'function');
  assert.equal(typeof a.setState,      'function');
  assert.equal(typeof a.exitWriteMode, 'function');
});

test('getText returns raw Markdown, not HTML', () => {
  const cm6  = makeFakeHybridCm6();
  const doc  = '# Hello & <World>\n\nsome text\n';
  const a    = createCm6HybridView(makeParent(), { cm6, initialDoc: doc });
  assert.equal(a.getText(), doc);
});

test('inactive heading produces a replacement widget decoration', () => {
  const cm6 = makeFakeHybridCm6();
  // cursor starts at 0 (heading is ACTIVE — no deco yet)
  const a = createCm6HybridView(makeParent(), { cm6, initialDoc: '# Hello\nsome text' });

  // Move to "some text" (pos 8) — heading becomes inactive
  moveHead(a, 8);

  const ranges = cm6.getPluginRef().instance.decorations._ranges;
  assert.equal(ranges.length, 1, 'one deco for the inactive heading');
  assert.equal(ranges[0].from, 0);
  assert.equal(ranges[0].to,   7);
  assert.equal(ranges[0].decoration._kind, 'replace');
  assert.ok(ranges[0].decoration.widget, 'replace decoration should carry a widget');
});

test('active heading produces no replacement widget for its range', () => {
  const cm6 = makeFakeHybridCm6();
  // cursor at 0 (on the heading) — heading is ACTIVE
  const a = createCm6HybridView(makeParent(), { cm6, initialDoc: '# Hello\nsome text' });
  const ranges = cm6.getPluginRef().instance.decorations._ranges;
  assert.equal(ranges.length, 0, 'no decos when cursor is on the heading');
});

test('moving cursor away from heading renders heading widget', () => {
  const cm6 = makeFakeHybridCm6();
  const a = createCm6HybridView(makeParent(), { cm6, initialDoc: '# Hello\nsome text' });

  assert.equal(cm6.getPluginRef().instance.decorations._ranges.length, 0, 'no deco initially');
  moveHead(a, 8);
  assert.equal(cm6.getPluginRef().instance.decorations._ranges.length, 1,
    'widget appears after cursor leaves heading');
});

test('moving cursor into heading removes the widget', () => {
  const cm6 = makeFakeHybridCm6();
  const a = createCm6HybridView(makeParent(), { cm6, initialDoc: '# Hello\nsome text' });

  moveHead(a, 8);
  assert.equal(cm6.getPluginRef().instance.decorations._ranges.length, 1);

  moveHead(a, 2);
  assert.equal(cm6.getPluginRef().instance.decorations._ranges.length, 0,
    'widget disappears when cursor re-enters heading');
});

test('user edit fires onChange with raw Markdown, not HTML', () => {
  const cm6 = makeFakeHybridCm6();
  const received = [];
  const a = createCm6HybridView(makeParent(), { cm6, onChange: (t) => received.push(t) });

  a.view.dispatch({ changes: { from: 0, to: 0, insert: '# Hello\n' } });

  assert.equal(received.length, 1);
  assert.equal(received[0], '# Hello\n');
});

test('cursor-only movement does not fire onChange', () => {
  const cm6 = makeFakeHybridCm6();
  const received = [];
  const a = createCm6HybridView(makeParent(), {
    cm6,
    initialDoc: '# Hello\nsome text',
    onChange: (t) => received.push(t),
  });

  moveHead(a, 8);
  assert.equal(received.length, 0, 'cursor move must not fire onChange');
});

test('setText does not fire onChange', () => {
  const cm6 = makeFakeHybridCm6();
  const received = [];
  const a = createCm6HybridView(makeParent(), { cm6, onChange: (t) => received.push(t) });
  a.setText('# New heading\nsome text');
  assert.equal(received.length, 0, 'setText must not fire onChange');
});

test('non-heading blocks produce no heading widget', () => {
  const cm6 = makeFakeHybridCm6();
  const a = createCm6HybridView(makeParent(), {
    cm6,
    initialDoc: 'plain text\n> blockquote\n- list item\n',
  });
  moveHead(a, 999);
  const ranges = cm6.getPluginRef().instance.decorations._ranges;
  assert.equal(ranges.length, 0, 'no heading widgets for non-heading content');
});

test('widget escaping: toDOM uses textContent (auto-escapes &, <, >), not innerHTML', () => {
  const cm6 = makeFakeHybridCm6();
  const a = createCm6HybridView(makeParent(), {
    cm6,
    initialDoc: '# Hello & <World>\nsome text',
  });
  // Move cursor off the heading so the widget is created
  moveHead(a, 20);

  const ranges = cm6.getPluginRef().instance.decorations._ranges;
  assert.equal(ranges.length, 1, 'heading should be decorated');

  const widget = ranges[0].decoration.widget;
  assert.ok(widget, 'widget should exist');

  // Call toDOM() with fake document as global
  const savedDoc = (typeof global !== 'undefined') ? global.document : undefined;
  global.document = cm6.fakeDocument;
  let dom;
  try {
    dom = widget.toDOM();
  } finally {
    if (savedDoc === undefined) delete global.document;
    else global.document = savedDoc;
  }

  assert.ok(dom, 'toDOM should return an element');
  assert.equal(dom._textContent, 'Hello & <World>',
    'widget uses textContent — DOM auto-escapes &, <, >');
  assert.equal(dom._innerHTML, null,
    'innerHTML must not be set directly');
});

test('setState / getState round-trip restores the document', () => {
  const cm6 = makeFakeHybridCm6();
  const a   = createCm6HybridView(makeParent(), { cm6, initialDoc: '# Alpha\n' });
  const saved = a.getState();
  a.setText('# Beta\n');
  assert.equal(a.getText(), '# Beta\n');
  a.setState(saved);
  assert.equal(a.getText(), '# Alpha\n', 'setState restores saved document');
});

test('widget DOM carries styling classes cm6-heading-widget and cm6-hN', () => {
  const cm6 = makeFakeHybridCm6();
  const a = createCm6HybridView(makeParent(), {
    cm6,
    initialDoc: '# H1\n## H2\n### H3\ntext',
  });
  // Move cursor to "text" so all three headings are inactive
  moveHead(a, 20);

  const savedDoc = (typeof global !== 'undefined') ? global.document : undefined;
  global.document = cm6.fakeDocument;
  try {
    const ranges = cm6.getPluginRef().instance.decorations._ranges;
    assert.equal(ranges.length, 3, 'three heading decorations');

    for (const { decoration } of ranges) {
      const dom = decoration.widget.toDOM();
      assert.ok(
        dom.className.includes('cm6-heading-widget'),
        'element must have cm6-heading-widget class'
      );
    }

    // Level-specific classes
    const cls = (i) => ranges[i].decoration.widget.toDOM().className;
    assert.ok(cls(0).includes('cm6-h1'), 'h1 widget must have cm6-h1 class');
    assert.ok(cls(1).includes('cm6-h2'), 'h2 widget must have cm6-h2 class');
    assert.ok(cls(2).includes('cm6-h3'), 'h3 widget must have cm6-h3 class');
  } finally {
    if (savedDoc === undefined) delete global.document;
    else global.document = savedDoc;
  }
});
