/* Stage 25 — link-click renderer (production lift onto stage11).
   Run focused: node --test test/cm6-write-view/link-click.test.js

   These tests validate the renderer-side Cmd-click "open external link"
   interaction for hybrid-cm6 Write mode, wired to the Stage 24.5
   preload + main IPC bridge (vaultApi.openExternalLink). The real
   shell.openExternal call lives in main; the renderer is purely the
   click-routing layer.

   Lazy-loading: the link-click module is required inside each test
   body (via loadLinkClickModule()) — never at module top level — so a
   missing-module state produces per-test failures rather than a single
   file-load failure.

   Test groups:
     Group A  — validator (Stage 24-1..15)               [lifted]
     Group B  — resolver  (Stage 24-16..23)              [lifted]
     Group C  — IPC wrapper + click handler (24-24..38)  [lifted]
     Group D  — keyboard command (24-39..45)             [lifted]
     Group E  — walker hook integration (24-46..48)      [lifted]
     Group F2 — Stage 25 rule-6 degenerate-form (25-1..3)
     Group G  — Stage 25 frontmatter no-op (25-4..5)
     Group H  — Stage 25 modifier-exclusion (25-6..8)
     Group I  — Stage 25 autolink (25-11..12)
     Group J  — Stage 25 paired validator agreement (25-9)  [Batch 4] */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const MODULE_REL = '../../lib/cm6-link-click.js';

// ── Lazy loader ─────────────────────────────────────────────────────────────
// Each test body calls loadLinkClickModule() so the missing-module RED state
// surfaces as a per-test MODULE_NOT_FOUND failure rather than crashing the
// file at top-level require. After the spike's Step 2 GREEN lands, the
// loader returns the module's public exports.

function loadLinkClickModule() {
  delete require.cache[require.resolve(MODULE_REL)];
  return require(MODULE_REL);
}

// ── Real-bundle state + tree builder (used by resolver tests) ──────────────
// The lezer-based Markdown parser runs in pure Node — no DOM required for
// EditorState construction, syntaxTree(state), or doc.sliceString. Mirrors
// the helper of the same name in task-toggle.test.js.

function loadCm6Bundle() {
  if (!global.window) global.window = {};
  if (!global.window.CM6Production) {
    require('../../lib/cm6-bundle.js');
  }
  return global.window.CM6Production;
}

function buildStateAndTree(doc) {
  const cm6   = loadCm6Bundle();
  const state = cm6.EditorState.create({ doc, extensions: [cm6.markdown()] });
  const tree  = cm6.syntaxTree(state);
  return { cm6, state, tree };
}

// ── vaultApi spy ────────────────────────────────────────────────────────────
// installVaultApiSpy returns a calls[] array and an optional fn override for
// return-value tests (undefined, Promise, throw). Tests must call
// uninstallVaultApi() in a finally block to prevent cross-test leakage.

function installVaultApiSpy(impl) {
  const calls = [];
  globalThis.vaultApi = {
    openExternalLink: function (url) {
      calls.push(url);
      if (typeof impl === 'function') return impl(url);
      return undefined;
    },
  };
  return calls;
}

function uninstallVaultApi() {
  delete globalThis.vaultApi;
}

// ── Recording fake CM6 backend ──────────────────────────────────────────────
// Exposes EditorView.domEventHandlers and keymap.of as introspectable shapes
// so we can extract the mousedown handler and keymap specs from
// createLinkClickExtension(cm6). syntaxTree is swapped to the real bundle's
// implementation in extractMousedownHandler() so state-aware resolver calls
// against EditorStates built from buildStateAndTree work end-to-end.

function makeFakeCm6Recording() {
  return {
    EditorView: {
      domEventHandlers: function (handlers) {
        return { _kind: 'domEventHandlers', handlers: handlers };
      },
    },
    keymap: {
      of: function (specs) {
        return { _kind: 'keymap', specs: specs };
      },
    },
    syntaxTree: function () { return null; },
  };
}

function extractMousedownHandler() {
  const real = loadCm6Bundle();
  const fake = makeFakeCm6Recording();
  fake.syntaxTree = real.syntaxTree;
  const ext = loadLinkClickModule().createLinkClickExtension(fake);
  if (!Array.isArray(ext)) return null;
  const entry = ext.find(function (e) {
    return e && e._kind === 'domEventHandlers'
        && e.handlers && typeof e.handlers.mousedown === 'function';
  });
  return entry ? entry.handlers.mousedown : null;
}

function extractKeymapSpecs() {
  const fake = makeFakeCm6Recording();
  const ext = loadLinkClickModule().createLinkClickExtension(fake);
  if (!Array.isArray(ext)) return null;
  const entry = ext.find(function (e) {
    return e && e._kind === 'keymap' && Array.isArray(e.specs);
  });
  return entry ? entry.specs : null;
}

// ── Stub view + event for click handler tests ──────────────────────────────

function makeStubView(opts) {
  opts = opts || {};
  const cm6 = loadCm6Bundle();
  const doc = opts.doc != null ? opts.doc : '[t](https://example.com)';
  const state = cm6.EditorState.create({ doc, extensions: [cm6.markdown()] });
  const dispatched = [];
  return {
    composing: !!opts.composing,
    state: state,
    posAtCoords: function () { return 'posResult' in opts ? opts.posResult : 1; },
    dispatch: function (spec) { dispatched.push(spec); },
    _dispatched: dispatched,
  };
}

// View-with-caret for keyboard command tests. Builds a real EditorState
// with the markdown extension and sets the primary selection to a single
// caret at caretPos (anchor === head).

function makeViewWithCaret(doc, caretPos, opts) {
  opts = opts || {};
  const cm6 = loadCm6Bundle();
  const base = cm6.EditorState.create({ doc, extensions: [cm6.markdown()] });
  const state = base.update({
    selection: { anchor: caretPos, head: caretPos },
  }).state;
  const dispatched = [];
  return {
    composing: !!opts.composing,
    state: state,
    dispatch: function (spec) { dispatched.push(spec); },
    _dispatched: dispatched,
  };
}

function makeStubEvent(opts) {
  opts = opts || {};
  const mods = opts.mods || {};
  const e = {
    button:   opts.button != null ? opts.button : 0,
    clientX:  10,
    clientY:  20,
    metaKey:  !!mods.metaKey,
    ctrlKey:  !!mods.ctrlKey,
    altKey:   !!mods.altKey,
    shiftKey: !!mods.shiftKey,
    _prevented: false,
    preventDefault: function () { this._prevented = true; },
  };
  return e;
}

// ── Hybrid-view walker loader + fake CM6 backend (for walker hook tests) ───
// Mirrors task-toggle.test.js. The fake captures the extensions array passed
// to EditorState.create so we can inspect whether the optional link-click
// extension was appended. EditorView.domEventHandlers returns an introspect-
// able shape so we can extract and invoke the mousedown handler directly.

function loadHybridViewModule() {
  const REL = '../../lib/cm6-hybrid-view.js';
  delete require.cache[require.resolve(REL)];
  return require(REL);
}

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
        return { number: lineNumber, from: lineStart, to: lineEnd, text: str.slice(lineStart, lineEnd) };
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
  const Decoration = {
    mark(spec) { const d = { _kind: 'mark', spec }; d.range = (from, to) => ({ from, to, value: d }); return d; },
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
      this.state = state;
      this.parent = parent;
      this.composing = false;
    }
    dispatch() { /* no-op for walker integration tests */ }
    setState(newState) { this.state = newState; }
    destroy() {}
    focus()   {}
    posAtCoords() { return 1; }
  }
  EditorView.updateListener   = { of(fn) { return { _kind: 'updateListener', fn }; } };
  EditorView.lineWrapping     = { _kind: 'lineWrapping' };
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
    syntaxTree() { return null; },
    keymap: { of(specs) { return { _kind: 'keymap', specs }; } },
  };
}

function makeFakeParent() {
  return { _isParent: true, appendChild() {}, remove() {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A — validateExternalUrl (Stage 24-1 through 24-15)
// Pure function, no DOM, no CodeMirror. Q3 allowlist: {https, mailto},
// case-insensitive; reject whitespace, control chars, percent-encoded
// scheme letters, relative URLs.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24-1: validateExternalUrl accepts canonical "https://example.com"', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('https://example.com'), true);
});

test('Stage 24-2: validateExternalUrl accepts canonical "mailto:foo@bar.com"', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('mailto:foo@bar.com'), true);
});

test('Stage 24-3: validateExternalUrl accepts case-insensitive schemes "HTTPS://..." and "MailTo:..."', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('HTTPS://example.com'), true);
  assert.equal(validateExternalUrl('MailTo:foo@bar.com'), true);
  assert.equal(validateExternalUrl('hTtPs://example.com'), true);
});

test('Stage 24-4: validateExternalUrl rejects "http://..." (not on allowlist)', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('http://example.com'), false);
  assert.equal(validateExternalUrl('HTTP://example.com'), false);
});

test('Stage 24-5: validateExternalUrl rejects "javascript:alert(1)"', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('javascript:alert(1)'), false);
  assert.equal(validateExternalUrl('JavaScript:alert(1)'), false);
});

test('Stage 24-6: validateExternalUrl rejects "data:text/html,..."', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('data:text/html,<script>alert(1)</script>'), false);
});

test('Stage 24-7: validateExternalUrl rejects "file:///etc/passwd"', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('file:///etc/passwd'), false);
});

test('Stage 24-8: validateExternalUrl rejects percent-encoded scheme letter "%6Aavascript:alert(1)"', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('%6Aavascript:alert(1)'), false);
  assert.equal(validateExternalUrl('%4A%41%56%41%53%43%52%49%50%54:alert(1)'), false);
});

test('Stage 24-9: validateExternalUrl rejects relative URL "/foo/bar"', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('/foo/bar'), false);
  assert.equal(validateExternalUrl('./local'), false);
  assert.equal(validateExternalUrl('../up'), false);
});

test('Stage 24-10: validateExternalUrl rejects bare path "foo.html" (no scheme)', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('foo.html'), false);
  assert.equal(validateExternalUrl('example.com'), false);
});

test('Stage 24-11: validateExternalUrl rejects URL containing whitespace (leading, trailing, internal)', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl(' https://example.com'),  false);
  assert.equal(validateExternalUrl('https://example.com '),  false);
  assert.equal(validateExternalUrl('https:// example.com'),  false);
  assert.equal(validateExternalUrl('https://exam ple.com'),  false);
});

test('Stage 24-12: validateExternalUrl rejects URL containing tab/newline/CR', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('https://example.com\t'), false);
  assert.equal(validateExternalUrl('https://example.com\n'), false);
  assert.equal(validateExternalUrl('https://example.com\r'), false);
  assert.equal(validateExternalUrl('https://\texample.com'), false);
});

test('Stage 24-13: validateExternalUrl rejects URL containing control char (e.g. "\\x07")', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('https://example.com\x07'), false);
  assert.equal(validateExternalUrl('https://exam\x01ple.com'), false);
  assert.equal(validateExternalUrl('https://example.com\x7F'), false);
});

test('Stage 24-14: validateExternalUrl rejects empty string, null, undefined, non-string', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl(''),         false);
  assert.equal(validateExternalUrl(null),       false);
  assert.equal(validateExternalUrl(undefined),  false);
  assert.equal(validateExternalUrl(123),        false);
  assert.equal(validateExternalUrl({}),         false);
  assert.equal(validateExternalUrl([]),         false);
  assert.equal(validateExternalUrl(true),       false);
});

test('Stage 24-15: validateExternalUrl returns a stable boolean; does NOT normalize or rewrite input', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  // The validator's job is yes/no only. It must never return the URL,
  // a normalized form, or mutate its input. Pure boolean return.
  const candidates = [
    'https://example.com',
    'mailto:foo@bar.com',
    'http://example.com',
    'javascript:alert(1)',
    '',
  ];
  for (const url of candidates) {
    const result = validateExternalUrl(url);
    assert.equal(typeof result, 'boolean',
      'validateExternalUrl must return a boolean for ' + JSON.stringify(url));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — resolveLinkAtPos (Stage 24-16 through 24-23)
// Pinned grammar decisions per the v2 plan:
//   inline link   YES (Link node containing URL child)
//   autolink      YES (Autolink node containing URL child)
//   angle-bracket destination "[a](<...>)"  YES (URL child includes outer < >;
//                                                resolver strips them)
//   image link    NO  (Image node — return null)
//   reference link with definition           NO  (Link node has no URL child;
//                                                Stage 25 deferral)
//   bare URL "https://example.com"           NO  (no enclosing Link/Autolink;
//                                                Stage 25 deferral)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24-16: resolveLinkAtPos returns { from, to, url } for a position inside "[text](https://example.com)" inline link', () => {
  const { state, tree } = buildStateAndTree('[text](https://example.com)');
  const { resolveLinkAtPos } = loadLinkClickModule();
  // pos=3 lies inside the link's text portion ("[t-e-x-t]")
  const hit = resolveLinkAtPos(state, 3, tree);
  assert.ok(hit, 'expected a hit object');
  assert.equal(hit.from, 0);
  assert.equal(hit.to,   27);
  assert.equal(hit.url,  'https://example.com');
});

test('Stage 24-17: resolveLinkAtPos returns null when position lies outside any Link/Autolink node', () => {
  const { state, tree } = buildStateAndTree('plain text without any link here\n');
  const { resolveLinkAtPos } = loadLinkClickModule();
  assert.equal(resolveLinkAtPos(state, 0,  tree), null);
  assert.equal(resolveLinkAtPos(state, 5,  tree), null);
  assert.equal(resolveLinkAtPos(state, 15, tree), null);
});

test('Stage 24-18: resolveLinkAtPos returns the URL child contents verbatim (no decoding, no rewriting)', () => {
  // Non-canonical-but-valid URL with characters that a naive normalizer might
  // touch. The resolver must return the exact substring from doc.sliceString.
  const doc = '[t](https://example.com/Foo?x=1&y=2%20z)';
  const { state, tree } = buildStateAndTree(doc);
  const { resolveLinkAtPos } = loadLinkClickModule();
  const hit = resolveLinkAtPos(state, 2, tree);
  assert.ok(hit);
  assert.equal(hit.url, 'https://example.com/Foo?x=1&y=2%20z',
    'url must be the verbatim substring; no decoding of %20');
});

test('Stage 24-19: resolveLinkAtPos supports autolink "<https://example.com>" — url has no surrounding angle brackets', () => {
  const { state, tree } = buildStateAndTree('<https://example.com>');
  const { resolveLinkAtPos } = loadLinkClickModule();
  const hit = resolveLinkAtPos(state, 5, tree);
  assert.ok(hit, 'expected a hit for autolink');
  assert.equal(hit.from, 0);
  assert.equal(hit.to,   21);
  assert.equal(hit.url, 'https://example.com',
    'autolink URL child does not include the surrounding angle brackets');
});

test('Stage 24-20: resolveLinkAtPos supports angle-bracket inline destination "[a](<https://example.com>)" — url has outer <> stripped', () => {
  const doc = '[a](<https://example.com>)';
  const { state, tree } = buildStateAndTree(doc);
  const { resolveLinkAtPos } = loadLinkClickModule();
  // pos=1 lies inside the link text "[a]"
  const hit = resolveLinkAtPos(state, 1, tree);
  assert.ok(hit, 'expected a hit for angle-bracket-destination inline link');
  assert.equal(hit.from, 0);
  assert.equal(hit.to,   26);
  assert.equal(hit.url, 'https://example.com',
    'resolver must strip the outer < > from the URL child');
});

test('Stage 24-21: resolveLinkAtPos returns null for an image link "![alt](https://example.com)"', () => {
  const { state, tree } = buildStateAndTree('![alt](https://example.com)');
  const { resolveLinkAtPos } = loadLinkClickModule();
  // pos=3 lies inside the image's alt text
  assert.equal(resolveLinkAtPos(state, 3, tree), null,
    'image is NOT a click-to-open link target; image must return null');
  // pos=10 lies inside the image URL
  assert.equal(resolveLinkAtPos(state, 10, tree), null,
    'position inside an Image URL child must also return null');
});

test('Stage 24-22: resolveLinkAtPos returns null for a reference link "[text][ref]" with definition present (Stage 25 deferral)', () => {
  const doc = '[text][ref]\n\n[ref]: https://example.com';
  const { state, tree } = buildStateAndTree(doc);
  const { resolveLinkAtPos } = loadLinkClickModule();
  // pos=3 lies inside the reference link's display text
  assert.equal(resolveLinkAtPos(state, 3, tree), null,
    'reference link without an inline URL child must return null in Stage 24; '
    + 'cross-reference resolution is deferred to Stage 25');
});

test('Stage 24-23: resolveLinkAtPos returns null for a bare URL "https://example.com" not wrapped in "[]()" (Stage 25 deferral)', () => {
  const { state, tree } = buildStateAndTree('https://example.com');
  const { resolveLinkAtPos } = loadLinkClickModule();
  // pos=5 lies inside the URL
  assert.equal(resolveLinkAtPos(state, 5, tree), null,
    'bare URL without enclosing Link/Autolink must return null in Stage 24; '
    + 'bare-URL support is deferred to Stage 25');
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — IPC wrapper, modifier predicate, click handler (24-24..38)
//
// Contract for openExternalLinkViaIpc(url):
//   absent globalThis.vaultApi              → returns false, no call
//   vaultApi.openExternalLink not a fn      → returns false, no call
//   bridge callable, returns undefined      → returns true,  called once
//   bridge callable, returns Promise        → returns true,  called once
//   bridge throws synchronously             → returns false, called once,
//                                             exception NOT propagated
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24-24: openExternalLinkViaIpc returns false when globalThis.vaultApi is undefined', () => {
  uninstallVaultApi();
  const { openExternalLinkViaIpc } = loadLinkClickModule();
  try {
    assert.equal(openExternalLinkViaIpc('https://example.com'), false);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-25: openExternalLinkViaIpc returns false when globalThis.vaultApi.openExternalLink is not a function', () => {
  globalThis.vaultApi = { openExternalLink: 'not-a-function' };
  const { openExternalLinkViaIpc } = loadLinkClickModule();
  try {
    assert.equal(openExternalLinkViaIpc('https://example.com'), false);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-26: openExternalLinkViaIpc returns true and invokes bridge once with original URL when bridge returns undefined', () => {
  const calls = installVaultApiSpy(function () { return undefined; });
  const { openExternalLinkViaIpc } = loadLinkClickModule();
  try {
    const result = openExternalLinkViaIpc('https://example.com');
    assert.equal(result, true, 'returns true when bridge invoked');
    assert.deepEqual(calls, ['https://example.com'], 'bridge called once with original URL');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-27: openExternalLinkViaIpc returns true and invokes bridge once with original URL when bridge returns a Promise', () => {
  const calls = installVaultApiSpy(function () { return new Promise(function () {}); });
  const { openExternalLinkViaIpc } = loadLinkClickModule();
  try {
    const result = openExternalLinkViaIpc('mailto:foo@bar.com');
    assert.equal(result, true,
      'returns true regardless of bridge return value (Promise here)');
    assert.deepEqual(calls, ['mailto:foo@bar.com']);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-28: openExternalLinkViaIpc returns false and swallows sync throw; bridge still recorded as called exactly once', () => {
  const calls = installVaultApiSpy(function () { throw new Error('boom'); });
  const { openExternalLinkViaIpc } = loadLinkClickModule();
  try {
    let propagated = null;
    let result;
    try { result = openExternalLinkViaIpc('https://example.com'); }
    catch (e) { propagated = e; }
    assert.equal(propagated, null, 'wrapper must NOT propagate synchronous throws');
    assert.equal(result, false, 'wrapper returns false on sync throw');
    assert.equal(calls.length, 1, 'bridge still invoked exactly once before the throw');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-29: isPrimaryModifier returns true for { metaKey: true }; false otherwise', () => {
  const { isPrimaryModifier } = loadLinkClickModule();
  assert.equal(isPrimaryModifier({ metaKey: true }),  true);
  assert.equal(isPrimaryModifier({ metaKey: false }), false);
  assert.equal(isPrimaryModifier({ ctrlKey: true }),  false);
  assert.equal(isPrimaryModifier({}),                  false);
  assert.equal(isPrimaryModifier(null),                false);
  assert.equal(isPrimaryModifier(undefined),           false);
});

test('Stage 24-30: handler ignores click without primary modifier (no metaKey); returns false, does NOT call preventDefault', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView();
    const event = makeStubEvent();
    const result = mousedown(event, view);
    assert.equal(result, false);
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
    assert.equal(view._dispatched.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-31: handler ignores middle/right clicks even when metaKey is held; returns false, does NOT call preventDefault', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    for (const btn of [1, 2]) {
      const view = makeStubView();
      const event = makeStubEvent({ button: btn, mods: { metaKey: true } });
      const result = mousedown(event, view);
      assert.equal(result, false, 'button=' + btn + ' must return false');
      assert.equal(event._prevented, false, 'button=' + btn + ' must NOT preventDefault');
    }
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-32: handler short-circuits when view.composing === true (IME safety); returns false, does NOT call preventDefault', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView({ composing: true });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false);
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-33: handler ignores click when posAtCoords returns null; returns false', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView({ posResult: null });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false);
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-34: handler ignores click when target pos is not inside any Link/Autolink; returns false', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView({ doc: 'plain text no link here\n', posResult: 5 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false);
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-35: handler ignores Cmd-click on image link "![alt](https://...)"; returns false, no IPC call, no preventDefault', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    // doc: ![alt](https://example.com)  — pos=3 inside the alt text region
    const view = makeStubView({ doc: '![alt](https://example.com)', posResult: 3 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false, 'image link is not a click-to-open target');
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-36: combined positive Cmd-click — handler returns true, calls openExternalLink exactly once with original URL, calls preventDefault exactly once, dispatches zero transactions', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    // doc: [t](https://example.com) — pos=1 inside the link text
    const view = makeStubView({ doc: '[t](https://example.com)', posResult: 1 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, true, 'positive Cmd-click must return true');
    assert.equal(event._prevented, true, 'preventDefault must be called exactly once');
    assert.deepEqual(calls, ['https://example.com'],
      'openExternalLink must be called exactly once with the literal original URL');
    assert.equal(view._dispatched.length, 0,
      'handler must NOT dispatch any transaction; caret/selection preserved');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-37: handler does NOT call openExternalLink when validateExternalUrl rejects the URL (e.g. javascript:); returns false, no preventDefault', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    // doc: [bad](javascript:alert(1)) — pos=2 inside the link text
    const view = makeStubView({ doc: '[bad](javascript:alert(1))', posResult: 2 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false);
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0,
      'invalid URL must not reach the IPC bridge');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-38: handler returns false (and does NOT call preventDefault) when globalThis.vaultApi is undefined — pins Stage 24.5-not-yet-shipped fallback', () => {
  uninstallVaultApi();
  const mousedown = extractMousedownHandler();
  const view = makeStubView({ doc: '[t](https://example.com)', posResult: 1 });
  const event = makeStubEvent({ mods: { metaKey: true } });
  const result = mousedown(event, view);
  assert.equal(result, false,
    'no IPC bridge means the handler is a quiet no-op; Stage 24.5 will provide the bridge');
  assert.equal(event._prevented, false,
    'without a bridge, preventDefault must NOT fire — let the default mousedown win');
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D — openLinkAtCaret(view, cm6) keyboard command (24-39..45)
//
// CRITICAL DESIGN (v2 fix): the command opens ONLY the link whose Link or
// Autolink node CONTAINS selection.main.head. It does NOT scan the caret
// line for the first link.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24-39: openLinkAtCaret returns true and calls openExternalLink exactly once with the URL of the Link node containing the caret head', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    // doc: [t](https://example.com)  — caret at pos=1 inside the link text
    const view = makeViewWithCaret('[t](https://example.com)', 1);
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, true);
    assert.deepEqual(calls, ['https://example.com']);
    assert.equal(view._dispatched.length, 0,
      'keyboard command must NOT dispatch any transaction; caret preserved');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-40: openLinkAtCaret with caret inside the SECOND of two links on one line opens the SECOND URL (not the first)', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    // doc:  [a](https://A.com) and [b](https://B.com)
    //       0123456789012345678901234567890123456789012
    //                                ^ Link 2 starts at 23 ("[")
    // Caret at 24 lies inside the second link's text "[b]".
    const doc = '[a](https://A.com) and [b](https://B.com)';
    const view = makeViewWithCaret(doc, 24);
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, true, 'must open the second link');
    assert.deepEqual(calls, ['https://B.com'],
      'must call openExternalLink with the SECOND URL, not the first');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-41: openLinkAtCaret with caret on plain text on a line that ALSO contains a link returns false and does NOT call openExternalLink', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    // doc:  [a](https://A.com) and [b](https://B.com)
    // Caret at 20 lies inside " and " between the two links — plain text.
    const doc = '[a](https://A.com) and [b](https://B.com)';
    const view = makeViewWithCaret(doc, 20);
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, false,
      'plain-text caret on a link-containing line must NOT trigger open');
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-42: openLinkAtCaret returns false and does NOT call openExternalLink when caret line has no Link node at all', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    const view = makeViewWithCaret('plain text without any link here\n', 5);
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-43: openLinkAtCaret returns false when view.composing === true (IME safety)', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    const view = makeViewWithCaret('[t](https://example.com)', 1, { composing: true });
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-44: openLinkAtCaret returns false when the containing Link\'s URL fails validation (e.g. javascript:)', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    const view = makeViewWithCaret('[bad](javascript:alert(1))', 2);
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, false);
    assert.equal(calls.length, 0,
      'invalid URL must not reach the IPC bridge from the keyboard path');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 24-45: openLinkAtCaret returns false and does NOT call openExternalLink when caret is inside an image link "![alt](https://...)"', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    // Caret at 3 lies inside the image alt text "![alt]"
    const view = makeViewWithCaret('![alt](https://example.com)', 3);
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, false, 'image is not a click-to-open target');
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group E — walker hook integration (24-46..48)
// Mirrors the Stage 23-11 / 23-12 idiom — sentinel-tagged extensions plus
// capture.lastExtensions inspection. The end-to-end test (24-48) extracts
// the link-click mousedown handler from the captured extensions and verifies
// it routes to globalThis.vaultApi.openExternalLink end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24-46: cm6-hybrid-view.js builds extensions without globalThis.Cm6LinkClick (absent); no link-click sentinel appears', () => {
  const before = globalThis.Cm6LinkClick;
  try {
    delete globalThis.Cm6LinkClick;
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6BackendCapturing(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions));
    const linkSentinels = capture.lastExtensions.filter(
      (e) => e && e.__linkClickSentinel
    );
    assert.equal(linkSentinels.length, 0,
      'no link-click sentinel when globalThis.Cm6LinkClick is absent');
  } finally {
    if (before !== undefined) globalThis.Cm6LinkClick = before;
    else delete globalThis.Cm6LinkClick;
  }
});

test('Stage 24-47: cm6-hybrid-view.js appends the link-click extension exactly once when globalThis.Cm6LinkClick is present', () => {
  const before = globalThis.Cm6LinkClick;
  try {
    const sentinelMousedown = { _kind: 'domEventHandlers', __linkClickSentinel: true };
    const sentinelKeymap    = { _kind: 'keymap',            __linkClickSentinel: true };
    globalThis.Cm6LinkClick = {
      createLinkClickExtension: function () { return [sentinelMousedown, sentinelKeymap]; },
    };
    const { createCm6HybridView } = loadHybridViewModule();
    const capture = {};
    const cm6 = makeFakeCm6BackendCapturing(capture);
    createCm6HybridView(makeFakeParent(), { cm6, initialDoc: '' });
    assert.ok(Array.isArray(capture.lastExtensions));
    const matches = capture.lastExtensions.filter((e) => e && e.__linkClickSentinel);
    assert.equal(matches.length, 2,
      'expected exactly 2 sentinel entries (mousedown + keymap) appended once');
  } finally {
    if (before !== undefined) globalThis.Cm6LinkClick = before;
    else delete globalThis.Cm6LinkClick;
  }
});

test('Stage 24-48: end-to-end — programmatic Cmd-click on "[a](https://example.com)" through the walker routes to globalThis.vaultApi.openExternalLink exactly once with the URL', () => {
  const beforeLink   = globalThis.Cm6LinkClick;
  const calls = installVaultApiSpy();
  try {
    globalThis.Cm6LinkClick = loadLinkClickModule();

    // Inject real syntaxTree into the fake cm6 backend so that the link-click
    // mousedown handler (which closes over this cm6) can resolve a real
    // syntax tree from a real EditorState constructed via the real bundle.
    const realCm6 = loadCm6Bundle();
    const capture = {};
    const fakeCm6 = makeFakeCm6BackendCapturing(capture);
    fakeCm6.syntaxTree = realCm6.syntaxTree;

    const { createCm6HybridView } = loadHybridViewModule();
    createCm6HybridView(makeFakeParent(), { cm6: fakeCm6, initialDoc: '' });

    // The link-click extension is appended AFTER the existing Stage 23
    // task-toggle hook, so it is the LAST domEventHandlers entry in the
    // captured extensions when both hooks are wired.
    const allDom = capture.lastExtensions.filter(
      (e) => e && e._kind === 'domEventHandlers' && e.handlers && typeof e.handlers.mousedown === 'function'
    );
    assert.ok(allDom.length >= 1,
      'walker must include at least one domEventHandlers entry; '
      + 'when Cm6LinkClick is present, the link-click one is appended last');
    const linkClickMousedown = allDom[allDom.length - 1].handlers.mousedown;

    // Build a real-state view at pos=1 inside "[t](https://example.com)"
    const view = makeStubView({ doc: '[t](https://example.com)', posResult: 1 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = linkClickMousedown(event, view);

    assert.equal(result, true);
    assert.equal(event._prevented, true);
    assert.deepEqual(calls, ['https://example.com'],
      'walker-integrated handler routes Cmd-click to vaultApi.openExternalLink with the URL');
    assert.equal(view._dispatched.length, 0);
  } finally {
    if (beforeLink !== undefined) globalThis.Cm6LinkClick = beforeLink;
    else delete globalThis.Cm6LinkClick;
    uninstallVaultApi();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group F2 — Stage 25 rule-6 degenerate-form rejection (25-1..3)
// Mirrors the new rule 6 already shipped in apps/desktop/lib/external-url.js
// at Stage 24.5: after the scheme passes the allowlist check, strip leading
// "/" from the rest-after-colon and require non-empty rest. Rejects scheme-
// only inputs that would otherwise have slipped through the spike validator.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 25-1: validateExternalUrl rejects "https:" (scheme-only, no rest)', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('https:'), false);
});

test('Stage 25-2: validateExternalUrl rejects "https://" and "https:///" (scheme + slashes only, no rest)', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('https://'), false);
  assert.equal(validateExternalUrl('https:///'), false);
});

test('Stage 25-3: validateExternalUrl rejects "mailto:" (scheme-only)', () => {
  const { validateExternalUrl } = loadLinkClickModule();
  assert.equal(validateExternalUrl('mailto:'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group G — Stage 25 frontmatter no-op (25-4..5)
// Links whose URL sits inside a strict top-of-file YAML frontmatter region
// (matched "---" fences) must NOT open. Stage 14.9 already suppresses decor-
// ation emission for frontmatter so metadata renders as plain text; click
// behavior must match. cm6-link-click.js duplicates a minimal isInside-
// Frontmatter helper from cm6-hybrid-view.js:detectFrontmatter for this.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 25-4: handler Cmd-click on a frontmatter link "[a](https://example.com)" between strict --- fences returns false; openExternalLink not called; preventDefault not called', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    // doc:
    //   ---
    //   homepage: [a](https://example.com)
    //   ---
    //   body
    // The "[a](https://...)" link's URL lies inside the frontmatter region.
    const doc = '---\nhomepage: [a](https://example.com)\n---\n\nbody\n';
    // pos lands inside the link text "[a]" on line 2.
    const view = makeStubView({ doc, posResult: 15 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false, 'frontmatter link must not open');
    assert.equal(event._prevented, false, 'frontmatter link must NOT preventDefault');
    assert.equal(calls.length, 0, 'frontmatter link must not reach the IPC bridge');
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 25-5: openLinkAtCaret with caret inside a frontmatter link returns false; openExternalLink not called', () => {
  const calls = installVaultApiSpy();
  try {
    const cm6 = loadCm6Bundle();
    const { openLinkAtCaret } = loadLinkClickModule();
    const doc = '---\nhomepage: [a](https://example.com)\n---\n\nbody\n';
    // Caret at pos=15 inside the link text "[a]" on line 2 (inside frontmatter).
    const view = makeViewWithCaret(doc, 15);
    const result = openLinkAtCaret(view, cm6);
    assert.equal(result, false, 'keyboard command on frontmatter link must no-op');
    assert.equal(calls.length, 0);
    assert.equal(view._dispatched.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group H — Stage 25 modifier-exclusion (25-6..8)
// Only plain Cmd-click opens. Cmd-Shift, Cmd-Alt, and Cmd-Ctrl combinations
// are reserved for editor-native gestures and must no-op even though they
// carry metaKey=true. This tightens the spike's isPrimaryModifier (which
// accepted any-metaKey-true) to metaKey-and-nothing-else.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 25-6: handler Cmd-Shift-click on a valid link returns false; openExternalLink not called; preventDefault not called', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView({ doc: '[t](https://example.com)', posResult: 1 });
    const event = makeStubEvent({ mods: { metaKey: true, shiftKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false, 'Cmd-Shift-click must not open');
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 25-7: handler Cmd-Alt-click on a valid link returns false; openExternalLink not called; preventDefault not called', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView({ doc: '[t](https://example.com)', posResult: 1 });
    const event = makeStubEvent({ mods: { metaKey: true, altKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false, 'Cmd-Alt-click must not open');
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 25-8: handler Cmd-Ctrl-click on a valid link returns false; openExternalLink not called; preventDefault not called', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView({ doc: '[t](https://example.com)', posResult: 1 });
    const event = makeStubEvent({ mods: { metaKey: true, ctrlKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false, 'Cmd-Ctrl-click must not open');
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group I — Stage 25 autolink (25-11, 25-12)
// Scheme-bearing autolinks "<https://...>" and "<mailto:...>" are clickable
// (resolver strips outer angle brackets, validator accepts the inner URL).
// Raw email autolinks "<foo@host>" expose a no-scheme URL and Q3 rejects them.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 25-11: handler Cmd-click on scheme-bearing autolink "<https://example.com>" opens once with the URL (angle brackets stripped); preventDefault called once', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    // doc: <https://example.com>  — pos=5 inside the URL
    const view = makeStubView({ doc: '<https://example.com>', posResult: 5 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, true, 'scheme-bearing autolink must open');
    assert.equal(event._prevented, true, 'preventDefault must fire exactly once');
    assert.deepEqual(calls, ['https://example.com'],
      'openExternalLink receives the URL with outer angle brackets stripped');
    assert.equal(view._dispatched.length, 0);
  } finally {
    uninstallVaultApi();
  }
});

test('Stage 25-12: handler Cmd-click on raw email autolink "<foo@example.com>" returns false (Q3 rejects no-scheme URL); openExternalLink not called; preventDefault not called', () => {
  const calls = installVaultApiSpy();
  try {
    const mousedown = extractMousedownHandler();
    const view = makeStubView({ doc: '<foo@example.com>', posResult: 5 });
    const event = makeStubEvent({ mods: { metaKey: true } });
    const result = mousedown(event, view);
    assert.equal(result, false, 'raw email autolink must not open without a scheme');
    assert.equal(event._prevented, false);
    assert.equal(calls.length, 0,
      'raw email autolink: validator rejects no-scheme URL; IPC bridge not reached');
  } finally {
    uninstallVaultApi();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group J — Stage 25 paired validator agreement (25-9)
// Asserts the renderer-side validateExternalUrl in cm6-link-click.js
// agrees with the Stage 24.5 main-process validateExternalUrl in
// lib/external-url.js on every entry of the canonical FIXTURES table.
// Compares two live functions rather than function-vs-table so drift in
// either validator surfaces immediately.
//
// FIXTURES mirror of apps/desktop/test/open-external-link.test.js:59-94
// (canonical). If you change one, change both — Stop Condition 14.
// ─────────────────────────────────────────────────────────────────────────────

const PAIRED_FIXTURES = [
  { url: 'https://example.com',                       valid: true },
  { url: 'mailto:foo@bar.com',                        valid: true },
  { url: 'HTTPS://EXAMPLE.COM',                       valid: true },
  { url: 'MailTo:foo@bar.com',                        valid: true },
  { url: 'https:foo',                                 valid: true },
  { url: 'http://example.com',                        valid: false },
  { url: 'ftp://example.com',                         valid: false },
  { url: 'javascript:alert(1)',                       valid: false },
  { url: 'data:text/html,x',                          valid: false },
  { url: 'file:///etc/passwd',                        valid: false },
  { url: '%6Aavascript:alert(1)',                     valid: false },
  { url: '/foo',                                      valid: false },
  { url: 'foo.html',                                  valid: false },
  { url: ' https://example.com',                      valid: false },
  { url: 'https://example.com ',                      valid: false },
  { url: 'https://exa mple.com',                      valid: false },
  { url: 'https://example.com\t',                     valid: false },
  { url: 'https://example.com\x07',                   valid: false },
  { url: 'https://example.com\x00',                   valid: false },
  { url: 'https:',                                    valid: false },
  { url: 'https://',                                  valid: false },
  { url: 'mailto:',                                   valid: false },
  { url: '',                                          valid: false },
];

test('Stage 25-9: renderer validateExternalUrl agrees with Stage 24.5 main validateExternalUrl on every FIXTURES entry', () => {
  const { validateExternalUrl: rendererValidate } = loadLinkClickModule();
  const { validateExternalUrl: mainValidate }     = require('../../lib/external-url.js');
  for (const { url, valid } of PAIRED_FIXTURES) {
    const r = rendererValidate(url);
    const m = mainValidate(url);
    assert.equal(r, m,
      `renderer/main disagreement on ${JSON.stringify(url)}: renderer=${r}, main=${m}`);
    assert.equal(r, valid,
      `expected-value drift on ${JSON.stringify(url)}: got ${r}, expected ${valid}`);
  }
});
