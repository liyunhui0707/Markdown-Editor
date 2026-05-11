/* Stage 16 — cross-engine smoke for cm6 (default) and hybrid-cm6 (experimental).
   Run focused: node --test test/cm6-write-view/cross-engine-smoke.test.js

   These are SAFEGUARD tests, not bug-fix tests. They pass on the current
   repository state. They prove a fixed contract before any future Stage 17
   default-engine flip.

   Why a local fake CM6 backend (not real EditorView):
     Real EditorView requires a DOM ("document is not defined" in plain Node).
     The hybrid-decorations.test.js fake-backend pattern is proven over many
     stages for adapter-contract testing. We re-implement that pattern here
     locally (NOT a shared module) so a future tweak in one place cannot
     ripple unintentionally to the other.

   Legacy hybrid (`?writeEngine=hybrid`, textarea-swap) is NOT in this file:
     it requires DOM (textareas). Its boot-path coverage stays with
     renderer-boot.test.js Stage 11.2 + Save All & Quit tests. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { createCm6WriteView }  = require('../../lib/cm6-write-view');
const { createCm6HybridView } = require('../../lib/cm6-hybrid-view');

// ── Local fake CM6 backend — pattern adapted from hybrid-decorations.test.js ─

function makeFakeCm6Backend() {
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
    set(arr) { return { _ranges: [...(arr || [])] }; },
    none: { _ranges: [] },
  };

  const ViewPlugin = {
    fromClass(pluginClass, spec) {
      const ref = { pluginClass, spec, instance: null };
      return {
        _kind: 'viewPlugin', _ref: ref,
        _attach(view) { ref.instance = new pluginClass(view); return ref; },
      };
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
      const docChanged = newStr !== prev;
      const newSel     = spec.selection !== undefined ? spec.selection : this.state.selection;
      const newState = { ...this.state, doc: makeDoc(newStr), selection: newSel };
      this.state = newState;
      const update = { view: this, state: newState, docChanged, viewportChanged: false };
      for (const p of (this.state._plugins || [])) {
        if (p._ref && p._ref.instance && typeof p._ref.instance.update === 'function') {
          p._ref.instance.update(update);
        }
      }
      for (const fn of this.state._listeners) { try { fn(update); } catch (_) {} }
    }
    setState(newState) { this.state = newState; this._initPlugins(); }
    destroy() { this._destroyed = true; }
    focus()   { /* no-op in fake */ }
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
    RangeSetBuilder: class { constructor() { this._spans = []; } add(from, to, value) { this._spans.push({ from, to, value }); } finish() { return { _ranges: this._spans }; } },
    // No syntaxTree — buildHeadingDecorations short-circuits to an empty set,
    // which is fine here: this file tests the adapter CONTRACT, not the walker.
  };
}

function makeFakeParent() {
  return { _isParent: true, appendChild() {}, remove() {} };
}

// ── Stage 14-rich fixture covering every styled construct ──────────────────

function stage14Fixture() {
  return [
    '---',
    'title: Stage 16 cross-engine smoke fixture',
    'tags: [stage-16, smoke]',
    'generated: true',
    '---',
    '',
    '# ATX H1 heading',
    '## ATX H2 heading',
    '### ATX H3 heading',
    '',
    'Setext H1 heading',
    '=================',
    '',
    'Setext H2 heading',
    '-----------------',
    '',
    'Paragraph with **bold**, *italic*, `code`, ~~strike~~, '
      + 'plus an angle-bracket autolink <https://example.test/16> '
      + 'and a bare URL https://example.test/raw/16 in the same line.',
    '',
    'See [inline link](https://example.test/inline) and [reference link][ref-16].',
    '',
    '[ref-16]: https://example.test/ref "stage 16 ref title"',
    '',
    '![image alt text](https://example.test/pic-16.png)',
    '',
    '- bullet one',
    '- bullet two',
    '',
    '- [ ] open task item',
    '- [x] done task item',
    '',
    '> a blockquote line',
    '',
    '```js',
    'let stage = 16;',
    '```',
    '',
    '---',
    '',
    'trailing paragraph',
    '',
  ].join('\n');
}

// Tokens whose presence in adapter getText() output would indicate the adapter
// has crossed the raw-Markdown contract boundary. Used by Stage 16-10 against
// adapter output AND once at module-load as a fixture self-sanity check.
const forbiddenHtmlTokens = [
  '<a',
  'href',
  '<img',
  '<div',
  'innerHTML',
  'document.write',
  'eval(',
  '</',
];

// Fixture self-sanity: it MUST include the angle-bracket autolink (cross-
// engine round-trip must preserve it) and MUST NOT include any explicit
// forbidden token. Using token comparison rather than /<[a-z]/ because the
// autolink (<https://...>) would falsely match a generic regex.
const FIXTURE_SANITY = (function () {
  const fixture = stage14Fixture();
  assert.ok(fixture.includes('<https://example.test'),
    'fixture must include an angle-bracket autolink');
  for (const token of forbiddenHtmlTokens) {
    assert.ok(!fixture.includes(token),
      'fixture must not contain forbidden HTML token: ' + token);
  }
  return true;
})();

// Source-file invariants — same token set as
// hybrid-cm6-readiness.test.js:280–295 (Section H). We do NOT add <img / <div
// / </ / innerHTML to this scan because they appear in safety comments;
// runtime absence is enforced separately by Stage 16-10 against getText().

function assertSourceFileInvariants(relativePath) {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', relativePath),
    'utf8'
  );
  assert.ok(!src.includes('Decoration.replace'),
    relativePath + ' must not contain Decoration.replace');
  assert.ok(!src.includes('WidgetType'),
    relativePath + ' must not contain WidgetType');
  assert.ok(!src.includes('<a'),
    relativePath + ' must not contain "<a" anywhere (no clickable links)');
  assert.ok(!src.includes('href'),
    relativePath + ' must not contain "href" anywhere');
  assert.ok(!src.includes("addEventListener('click'"),
    relativePath + ' must not register a click handler');
  assert.ok(!src.includes('addEventListener("click"'),
    relativePath + ' must not register a click handler');
  assert.ok(!/onclick\s*[:=]/.test(src),
    relativePath + ' must not assign an onclick property/handler');
}

// ── Stage 16-6: contract surface parity ────────────────────────────────────

test('Stage 16-6: cm6 and hybrid-cm6 adapters expose the same public contract surface', () => {
  const cm6 = makeFakeCm6Backend();
  const a = createCm6WriteView(makeFakeParent(),  { cm6, initialDoc: '' });
  const b = createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });

  for (const adapter of [a, b]) {
    assert.equal(typeof adapter.getText,       'function');
    assert.equal(typeof adapter.setText,       'function');
    assert.equal(typeof adapter.getState,      'function');
    assert.equal(typeof adapter.setState,      'function');
    assert.equal(typeof adapter.exitWriteMode, 'function');
    assert.equal(typeof adapter.focus,         'function');
    assert.equal(typeof adapter.destroy,       'function');
    assert.ok(adapter.view != null, 'adapter must expose a .view property');
  }

  assert.deepEqual(
    Object.keys(a).sort(),
    Object.keys(b).sort(),
    'cm6 and hybrid-cm6 adapters must expose identical key sets — '
    + 'cm6 keys=' + Object.keys(a).sort().join(',') + ' '
    + 'hybrid-cm6 keys=' + Object.keys(b).sort().join(',')
  );
});

// ── Stage 16-7: initialDoc round-trips byte-identically on both adapters ───

test('Stage 16-7: cm6 + hybrid-cm6 round-trip initialDoc byte-identically', () => {
  const fixture = stage14Fixture();
  const cm6 = makeFakeCm6Backend();
  const a = createCm6WriteView(makeFakeParent(),  { cm6, initialDoc: fixture });
  const b = createCm6HybridView(makeFakeParent(), { cm6, initialDoc: fixture });
  assert.equal(a.getText(), fixture, 'cm6: initialDoc must round-trip verbatim');
  assert.equal(b.getText(), fixture, 'hybrid-cm6: initialDoc must round-trip verbatim');
});

// ── Stage 16-8: setText(fixture) round-trips byte-identically ──────────────

test('Stage 16-8: cm6 + hybrid-cm6 round-trip setText(fixture) byte-identically', () => {
  const fixture = stage14Fixture();
  const cm6 = makeFakeCm6Backend();
  const a = createCm6WriteView(makeFakeParent(),  { cm6, initialDoc: '' });
  const b = createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
  a.setText(fixture);
  b.setText(fixture);
  assert.equal(a.getText(), fixture, 'cm6: setText must round-trip verbatim');
  assert.equal(b.getText(), fixture, 'hybrid-cm6: setText must round-trip verbatim');
});

// ── Stage 16-9: empty + null + undefined input handled gracefully ──────────

test('Stage 16-9: cm6 + hybrid-cm6 handle setText("") / setText(null) / setText(undefined) gracefully', () => {
  const cm6 = makeFakeCm6Backend();
  const a = createCm6WriteView(makeFakeParent(),  { cm6, initialDoc: 'some text' });
  const b = createCm6HybridView(makeFakeParent(), { cm6, initialDoc: 'some text' });
  for (const adapter of [a, b]) {
    adapter.setText('');
    assert.equal(adapter.getText(), '', 'setText("") yields empty doc');
    adapter.setText('some text');
    adapter.setText(null);
    assert.equal(adapter.getText(), '', 'setText(null) yields empty doc');
    adapter.setText('some text');
    adapter.setText(undefined);
    assert.equal(adapter.getText(), '', 'setText(undefined) yields empty doc');
  }
});

// ── Stage 16-10: getText() never contains HTML-like tokens; doc byte-identical

test('Stage 16-10: cm6 + hybrid-cm6 never produce HTML tokens in getText() output', () => {
  const fixture = stage14Fixture();
  const cm6 = makeFakeCm6Backend();
  const a = createCm6WriteView(makeFakeParent(),  { cm6, initialDoc: '' });
  const b = createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
  a.setText(fixture);
  b.setText(fixture);
  for (const [label, adapter] of [['cm6', a], ['hybrid-cm6', b]]) {
    const text = adapter.getText();
    for (const token of forbiddenHtmlTokens) {
      assert.ok(!text.includes(token),
        label + ' getText() output must not contain forbidden HTML token: ' + token);
    }
    assert.equal(text, fixture,
      label + ': getText() output must equal the input fixture byte-for-byte');
  }
});

// ── Stage 16-11: byte-identical cross-engine output ────────────────────────

test('Stage 16-11: cm6 and hybrid-cm6 produce byte-identical getText() output for the same fixture', () => {
  const fixture = stage14Fixture();
  const cm6 = makeFakeCm6Backend();
  const a = createCm6WriteView(makeFakeParent(),  { cm6, initialDoc: '' });
  const b = createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
  a.setText(fixture);
  b.setText(fixture);
  const ta = a.getText();
  const tb = b.getText();
  assert.equal(ta, tb,
    'cm6.getText() must equal hybrid-cm6.getText() for the same fixture');
  assert.equal(ta, fixture, 'and both must equal the original fixture');
});

// ── Stage 16-12: source-file invariants extend to cm6-write-view.js ────────

test('Stage 16-12: cm6-write-view.js and cm6-hybrid-view.js have no HTML/click-handler primitives', () => {
  assertSourceFileInvariants('cm6-write-view.js');
  assertSourceFileInvariants('cm6-hybrid-view.js');
});
