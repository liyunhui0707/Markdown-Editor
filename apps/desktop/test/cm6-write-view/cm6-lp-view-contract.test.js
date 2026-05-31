/* Stage A WAVE 2 — Cm6LpView adapter contract + extension parity.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-view-contract.test.js

   Three test groups:
     A — adapter key parity with Cm6HybridView (mirrors Stage 16-6).
     B — extension parity: lp extensions == hybrid extensions + 1 lp-emphasis slot.
     C — round-trip: initialDoc round-trips byte-identically (mirrors Stage 16-7).

   The lp adapter is required to bundle the SAME extensions as hybrid
   (history, markdown, wrapping, update listener, heading walker, chrome,
   plus the four optional global hooks) PLUS the new lp-emphasis plugin.
   Round-2 Codex review (R2-MAJOR 2) explicitly required this parity to
   be pinned by a test rather than implied by code review. */

'use strict';

const { test }   = require('node:test');
const assert     = require('node:assert/strict');

const HYBRID_REL = '../../lib/cm6-hybrid-view.js';
const LP_REL     = '../../lib/cm6-lp-view.js';

function loadHybridView() {
  delete require.cache[require.resolve(HYBRID_REL)];
  return require(HYBRID_REL);
}
function loadLpView() {
  delete require.cache[require.resolve(LP_REL)];
  return require(LP_REL);
}

// ── Capturing cm6 stub ────────────────────────────────────────────────────
// Records the extensions array passed to EditorState.create so the parity
// test can compare hybrid vs lp invocations.

function makeCapturingCm6() {
  const capture = { lastExtensions: null };

  function makeDecorationSet() {
    return { _kind: 'decoration-set', size: 0 };
  }

  const Decoration = {
    line(spec)  { return { _kind: 'line',    spec, range: (p)   => ({ from: p,  value: this }) }; },
    mark(spec)  { return { _kind: 'mark',    spec, range: (f,t) => ({ from: f,  to: t, value: this }) }; },
    replace(spec){ return { _kind: 'replace',spec, range: (f,t) => ({ from: f,  to: t, value: this }) }; },
    set: () => makeDecorationSet(),
    none: { _kind: 'decoration-none', size: 0 },
  };

  function EditorView(opts) {
    this.state    = opts.state;
    this.dom      = (typeof document !== 'undefined') ? document.createElement('div') : { nodeType: 1 };
    this.setState = (s) => { this.state = s; };
    this.focus    = () => {};
    this.destroy  = () => {};
    this.plugin   = () => null;
  }
  EditorView.lineWrapping   = { _ext: 'lineWrapping' };
  EditorView.updateListener = { of: (fn) => ({ _ext: 'updateListener', fn }) };
  EditorView.atomicRanges   = { of: (fn) => ({ _ext: 'atomicRanges',   fn }) };

  const cm6 = {
    EditorState: {
      create(spec) {
        capture.lastExtensions = (spec.extensions || []).slice();
        return {
          doc: { toString: () => spec.doc || '', length: (spec.doc || '').length },
          selection: null,
        };
      },
    },
    EditorView: EditorView,
    ViewPlugin: {
      fromClass(cls, spec) { return { _ext: 'view-plugin', cls, spec }; },
    },
    Decoration: Decoration,
    WidgetType: class {},
    Annotation: { define: () => ({}) },
    RangeSetBuilder: class {},
    syntaxTree: () => null,
    history:    () => ({ _ext: 'history' }),
    markdown:   () => ({ _ext: 'markdown' }),
    chrome:     [{ _ext: 'chrome-item' }],
    keymap:     { of: () => ({ _ext: 'keymap' }) },
    undo: () => true,
    redo: () => true,
  };

  return { cm6, capture };
}

// Snapshot / clear / restore the optional walker-hook globals so the
// parity comparison is deterministic regardless of test load order.
const HOOK_GLOBALS = ['Cm6TaskToggle', 'Cm6LinkClick', 'Cm6ActiveRange', 'Cm6ConstructReveal'];
function withClearedHooks(fn) {
  const saved = {};
  for (const k of HOOK_GLOBALS) {
    saved[k] = globalThis[k];
    delete globalThis[k];
  }
  try { return fn(); }
  finally {
    for (const k of HOOK_GLOBALS) {
      if (saved[k] === undefined) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
  }
}

// ── Group A — adapter key parity ─────────────────────────────────────────

test('Stage A WAVE 2-A1: Cm6LpView exports createCm6LpView factory', () => {
  const lp = loadLpView();
  assert.equal(typeof lp.createCm6LpView, 'function');
});

test('Stage A WAVE 2-A2: Cm6LpView adapter exposes the same key set as Cm6HybridView (Stage 16-6 parity)', () => {
  withClearedHooks(() => {
    const Hybrid = loadHybridView();
    const Lp     = loadLpView();
    const { cm6: cm6A } = makeCapturingCm6();
    const { cm6: cm6B } = makeCapturingCm6();
    const a = Hybrid.createCm6HybridView({}, { initialDoc: '', cm6: cm6A });
    const b = Lp.createCm6LpView({},        { initialDoc: '', cm6: cm6B });
    const ka = Object.keys(a).sort().join(',');
    const kb = Object.keys(b).sort().join(',');
    assert.equal(kb, ka, 'lp adapter must expose identical key set to hybrid (' + ka + ' vs ' + kb + ')');
  });
});

// ── Group B — extension parity (R2-MAJOR 2) ──────────────────────────────

test('Stage A WAVE 2-B1: lp extensions array length === hybrid extensions array length + 1', () => {
  withClearedHooks(() => {
    const Hybrid = loadHybridView();
    const Lp     = loadLpView();
    const { cm6: cm6A, capture: capA } = makeCapturingCm6();
    const { cm6: cm6B, capture: capB } = makeCapturingCm6();
    Hybrid.createCm6HybridView({}, { initialDoc: '', cm6: cm6A });
    Lp.createCm6LpView({},        { initialDoc: '', cm6: cm6B });
    const hybridLen = capA.lastExtensions.length;
    const lpLen     = capB.lastExtensions.length;
    assert.equal(lpLen, hybridLen + 1,
      'lp must add exactly one extension on top of hybrid (lp-emphasis); hybrid=' + hybridLen + ' lp=' + lpLen);
  });
});

test('Stage A WAVE 2-B2: lp extensions include the heading walker plugin (parity with hybrid)', () => {
  withClearedHooks(() => {
    const Lp = loadLpView();
    const { cm6, capture } = makeCapturingCm6();
    Lp.createCm6LpView({}, { initialDoc: '', cm6 });
    const exts = capture.lastExtensions;
    // The lp adapter creates the heading-walker plugin via cm6.ViewPlugin.fromClass.
    // Our stub returns { _ext: 'view-plugin', cls, spec } for every fromClass call.
    // The lp adapter also creates the lp-emphasis plugin via fromClass.
    const viewPluginExts = exts.filter(e => e && e._ext === 'view-plugin');
    assert.ok(viewPluginExts.length >= 2,
      'lp adapter must include at least 2 ViewPlugin extensions: heading walker + lp-emphasis');
  });
});

test('Stage A WAVE 2-B3: lp extensions include the lineWrapping, history, markdown, updateListener slots', () => {
  withClearedHooks(() => {
    const Lp = loadLpView();
    const { cm6, capture } = makeCapturingCm6();
    Lp.createCm6LpView({}, { initialDoc: '', cm6 });
    const exts = capture.lastExtensions;
    const tags = new Set(exts.filter(e => e && e._ext).map(e => e._ext));
    assert.ok(tags.has('history'),         'lp must include history()');
    assert.ok(tags.has('markdown'),        'lp must include markdown()');
    assert.ok(tags.has('lineWrapping'),    'lp must include EditorView.lineWrapping');
    assert.ok(tags.has('updateListener'),  'lp must include EditorView.updateListener for onChange');
  });
});

test('Stage A WAVE 2-B4: lp extensions include the optional chrome array when present', () => {
  withClearedHooks(() => {
    const Lp = loadLpView();
    const { cm6, capture } = makeCapturingCm6();
    Lp.createCm6LpView({}, { initialDoc: '', cm6 });
    const exts = capture.lastExtensions;
    // chrome is an array of items; the adapter pushes the array itself.
    const hasChrome = exts.some(e => Array.isArray(e) && e.length > 0 && e[0] && e[0]._ext === 'chrome-item');
    assert.ok(hasChrome, 'lp must include cm6.chrome array when it is provided');
  });
});

// ── Group C — round-trip ──────────────────────────────────────────────────

test('Stage A WAVE 2-C1: Cm6LpView round-trips initialDoc via getText() (Stage 16-7 parity)', () => {
  withClearedHooks(() => {
    const Lp = loadLpView();
    const { cm6 } = makeCapturingCm6();
    const fixture = '# Heading\n\n**bold** and *italic* line.\n\n- item\n';
    const adapter = Lp.createCm6LpView({}, { initialDoc: fixture, cm6 });
    assert.equal(adapter.getText(), fixture, 'lp: initialDoc must round-trip verbatim via getText()');
  });
});

test('Stage A WAVE 2-C2: Cm6LpView setText round-trips byte-identically (Stage 16-8 parity)', () => {
  withClearedHooks(() => {
    const Lp = loadLpView();
    const { cm6 } = makeCapturingCm6();
    const fixture = '# H\n\n**boldA** and *italicB*\n';
    const adapter = Lp.createCm6LpView({}, { initialDoc: '', cm6 });
    adapter.setText(fixture);
    assert.equal(adapter.getText(), fixture, 'lp: setText must round-trip verbatim');
  });
});

test('Stage A WAVE 2-C3: Cm6LpView handles setText("") / setText(null) / setText(undefined) gracefully', () => {
  withClearedHooks(() => {
    const Lp = loadLpView();
    const { cm6 } = makeCapturingCm6();
    const adapter = Lp.createCm6LpView({}, { initialDoc: 'seed', cm6 });
    adapter.setText('');         assert.equal(adapter.getText(), '');
    adapter.setText(null);       assert.equal(adapter.getText(), '');
    adapter.setText(undefined);  assert.equal(adapter.getText(), '');
  });
});

test('Stage A WAVE 2-C4: Cm6LpView throws if cm6 backend is missing', () => {
  const Lp = loadLpView();
  assert.throws(() => Lp.createCm6LpView({}, { initialDoc: '', cm6: null }),
    /cm6 backend missing/);
});

test('Stage A WAVE 2-C5: Cm6LpView throws if Cm6HybridView module is not loaded', () => {
  const Lp = loadLpView();
  const saved = globalThis.Cm6HybridView;
  delete globalThis.Cm6HybridView;
  try {
    const { cm6 } = makeCapturingCm6();
    assert.throws(() => Lp.createCm6LpView({}, { initialDoc: '', cm6 }),
      /Cm6HybridView\.buildHeadingDecorations missing/);
  } finally {
    if (saved !== undefined) globalThis.Cm6HybridView = saved;
  }
});
