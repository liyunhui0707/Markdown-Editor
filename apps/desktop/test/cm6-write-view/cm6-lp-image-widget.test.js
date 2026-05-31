/* Stage C WAVE 2 — InlineImageWidget + RejectedImageWidget + parseAltForSizing.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-image-widget.test.js

   The widget classes wrap CM6's WidgetType. toDOM() renders DOM. Node
   has no document by default; the widget guards `typeof document` and
   the tests install a minimal document stub that records attribute
   assignments and child elements for verification. No jsdom dependency
   per Hard Rule 4. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { WidgetType } = require('@codemirror/view');

// ── Minimal document stub ───────────────────────────────────────────────
// Each created element records its tagName, attributes, inline styles,
// child elements, and event listeners. Enough surface for the widget's
// toDOM() to construct a wrapper span + img and for tests to inspect.

function makeStubElement(tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    nodeType: 1,
    _attrs: {},
    _children: [],
    _listeners: {},
    _styleObj: {},
    appendChild(child) { this._children.push(child); return child; },
    setAttribute(name, value) { this._attrs[name] = String(value); },
    getAttribute(name) { return this._attrs[name]; },
    addEventListener(name, handler) {
      if (!this._listeners[name]) this._listeners[name] = [];
      this._listeners[name].push(handler);
    },
    removeEventListener(name, handler) {
      if (!this._listeners[name]) return;
      const idx = this._listeners[name].indexOf(handler);
      if (idx >= 0) this._listeners[name].splice(idx, 1);
    },
    triggerEvent(name) {
      (this._listeners[name] || []).forEach(h => h({ target: this }));
    },
    set className(v)  { this._attrs.class = String(v); },
    get className()   { return this._attrs.class || ''; },
    set textContent(v) { this._textContent = String(v); this._children = []; },
    get textContent() { return this._textContent || ''; },
    get firstChild()  { return this._children[0] || null; },
    get childNodes()  { return this._children.slice(); },
  };
  // The style proxy receives `el.style.maxWidth = '100%'` etc.
  el.style = el._styleObj;
  return el;
}

function installDocumentStub() {
  const created = [];
  const stub = {
    createElement(tagName) {
      const el = makeStubElement(tagName);
      created.push(el);
      return el;
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    _created: created,
  };
  globalThis.document = stub;
  return stub;
}

function uninstallDocumentStub() {
  delete globalThis.document;
}

// ── Load the widget module ──────────────────────────────────────────────

delete require.cache[require.resolve('../../lib/cm6-lp-image-widget.js')];
const widgetModule = require('../../lib/cm6-lp-image-widget.js');

const cm6 = { WidgetType };

// ── parseAltForSizing ───────────────────────────────────────────────────

test('Stage C WAVE 2-T-SIZING-1: parseAltForSizing("alt") returns {cleanedAlt: "alt", width: null, height: null}', () => {
  assert.deepEqual(widgetModule.parseAltForSizing('alt'), { cleanedAlt: 'alt', width: null, height: null });
});

test('Stage C WAVE 2-T-SIZING-2: parseAltForSizing("alt|400") returns width 400', () => {
  assert.deepEqual(widgetModule.parseAltForSizing('alt|400'), { cleanedAlt: 'alt', width: 400, height: null });
});

test('Stage C WAVE 2-T-SIZING-3: parseAltForSizing("alt|400x300") returns width 400 + height 300', () => {
  assert.deepEqual(widgetModule.parseAltForSizing('alt|400x300'), { cleanedAlt: 'alt', width: 400, height: 300 });
});

test('Stage C WAVE 2-T-SIZING-4: parseAltForSizing("alt|abc") ignores non-numeric suffix', () => {
  assert.deepEqual(widgetModule.parseAltForSizing('alt|abc'), { cleanedAlt: 'alt|abc', width: null, height: null });
});

test('Stage C WAVE 2-T-SIZING-5: parseAltForSizing("") returns empty alt + no sizing', () => {
  assert.deepEqual(widgetModule.parseAltForSizing(''), { cleanedAlt: '', width: null, height: null });
});

test('Stage C WAVE 2-T-SIZING-6: parseAltForSizing(null) returns empty alt + no sizing', () => {
  assert.deepEqual(widgetModule.parseAltForSizing(null), { cleanedAlt: '', width: null, height: null });
});

// ── InlineImageWidget ───────────────────────────────────────────────────

test('Stage C WAVE 2-T-WIDGET-1: InlineImageWidget is exported and extends WidgetType', () => {
  assert.ok(widgetModule.InlineImageWidget, 'class exported');
  assert.ok(widgetModule.InlineImageWidget.prototype instanceof WidgetType, 'extends WidgetType');
});

test('Stage C WAVE 2-T-WIDGET-2: InlineImageWidget constructor + toDOM() returns wrapper with <img> child', () => {
  installDocumentStub();
  try {
    const w = new widgetModule.InlineImageWidget({
      src: 'https://example.com/x.png',
      alt: 'alt',
    });
    const wrapper = w.toDOM();
    assert.equal(wrapper.tagName, 'SPAN', 'wrapper is a <span>');
    const img = wrapper.firstChild;
    assert.ok(img, '<img> child exists');
    assert.equal(img.tagName, 'IMG', 'child is an <img>');
    assert.equal(img.getAttribute('src'), 'https://example.com/x.png');
    assert.equal(img.getAttribute('alt'), 'alt');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 2-T-WIDGET-3: <img> has loading="lazy" attribute', () => {
  installDocumentStub();
  try {
    const w = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'a' });
    const img = w.toDOM().firstChild;
    assert.equal(img.getAttribute('loading'), 'lazy');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 2-T-WIDGET-4: <img> has sizing inline styles (max-width 100%, max-height 400px, height/width auto)', () => {
  installDocumentStub();
  try {
    const w = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'a' });
    const img = w.toDOM().firstChild;
    assert.equal(img.style.maxWidth,  '100%',  'max-width: 100%');
    assert.equal(img.style.maxHeight, '400px', 'max-height: 400px');
    assert.equal(img.style.height,    'auto',  'height: auto');
    assert.equal(img.style.width,     'auto',  'width: auto');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 2-T-WIDGET-5: explicit width overrides auto', () => {
  installDocumentStub();
  try {
    const w = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'a', width: 400 });
    const img = w.toDOM().firstChild;
    assert.equal(img.style.width, '400px', 'explicit width applied');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 2-T-WIDGET-6: explicit height overrides auto when provided', () => {
  installDocumentStub();
  try {
    const w = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'a', width: 400, height: 300 });
    const img = w.toDOM().firstChild;
    assert.equal(img.style.width,  '400px');
    assert.equal(img.style.height, '300px');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 2-T-WIDGET-7: eq() returns true for same src + alt + width + height', () => {
  const a = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'A' });
  const b = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'A' });
  assert.equal(a.eq(b), true);
});

test('Stage C WAVE 2-T-WIDGET-8: eq() returns false for different src', () => {
  const a = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'A' });
  const b = new widgetModule.InlineImageWidget({ src: 'https://x.test/z.png', alt: 'A' });
  assert.equal(a.eq(b), false);
});

test('Stage C WAVE 2-T-WIDGET-9: eq() returns false against RejectedImageWidget', () => {
  const a = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'A' });
  const b = new widgetModule.RejectedImageWidget({ alt: 'A' });
  assert.equal(a.eq(b), false);
});

test('Stage C WAVE 2-T-WIDGET-10: onerror handler swaps wrapper to rejected placeholder', () => {
  installDocumentStub();
  try {
    const w = new widgetModule.InlineImageWidget({ src: 'https://x.test/broken.png', alt: 'a' });
    const wrapper = w.toDOM();
    const img = wrapper.firstChild;
    // Initially wrapper has 1 child (the img).
    assert.equal(wrapper._children.length, 1);
    // Trigger the error event.
    img.triggerEvent('error');
    // After error, wrapper child should be replaced by the rejected placeholder.
    // The rejected placeholder is a <span> containing the alt text.
    const newChild = wrapper.firstChild;
    assert.ok(newChild, 'wrapper still has a child after error');
    assert.notEqual(newChild, img, 'child has been replaced (not the same node)');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 2-T-WIDGET-11: destroyed flag prevents post-destroy DOM mutation (smoke test)', () => {
  const w = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'a' });
  assert.equal(w.destroyed, false);
  w.destroy();
  assert.equal(w.destroyed, true);
});

// ── RejectedImageWidget ─────────────────────────────────────────────────

test('Stage C WAVE 2-T-REJECTED-1: RejectedImageWidget extends WidgetType', () => {
  assert.ok(widgetModule.RejectedImageWidget.prototype instanceof WidgetType);
});

test('Stage C WAVE 2-T-REJECTED-2: RejectedImageWidget toDOM() returns <span> with alt text styled', () => {
  installDocumentStub();
  try {
    const w = new widgetModule.RejectedImageWidget({ alt: 'my image' });
    const el = w.toDOM();
    assert.equal(el.tagName, 'SPAN');
    // Text content includes the alt text.
    const text = el.firstChild;
    assert.ok(text, 'rejected widget has child content');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 2-T-REJECTED-3: RejectedImageWidget eq() compares alt text', () => {
  const a = new widgetModule.RejectedImageWidget({ alt: 'X' });
  const b = new widgetModule.RejectedImageWidget({ alt: 'X' });
  const c = new widgetModule.RejectedImageWidget({ alt: 'Y' });
  assert.equal(a.eq(b), true);
  assert.equal(a.eq(c), false);
});

// ── Graceful-no-DOM fallback (Node test environment) ────────────────────

test('Stage C WAVE 2-T-NO-DOM-1: toDOM() returns a stub object when document is unavailable', () => {
  // No document stub installed for this test.
  if (typeof globalThis.document !== 'undefined') delete globalThis.document;
  const w = new widgetModule.InlineImageWidget({ src: 'https://x.test/y.png', alt: 'a' });
  const result = w.toDOM();
  assert.ok(result, 'returns SOMETHING (not undefined)');
  assert.equal(result.nodeType, 1, 'looks like a DOM-shaped object');
});

// ── Stage C WAVE 5: vault-relative IPC integration ──────────────────────

test('Stage C WAVE 5-T-VAULT-1: vault-relative widget kicks off resolveImagePath at toDOM time', async () => {
  installDocumentStub();
  let calledWith = null;
  const resolveImagePath = (noteDir, relPath) => {
    calledWith = { noteDir, relPath };
    return Promise.resolve({ ok: true, fileUrl: 'file:///vault/assets/foo.png' });
  };
  try {
    const w = new widgetModule.InlineImageWidget({
      src: './assets/foo.png',
      alt: 'a',
      kind: 'vault-relative',
      vaultRelativeContext: {
        noteDir: 'notes',
        relPath: './assets/foo.png',
        resolveImagePath,
      },
    });
    const wrapper = w.toDOM();
    // Sync: wrapper created, img child appended (with empty src for now).
    assert.equal(wrapper.tagName, 'SPAN');
    const img = wrapper.firstChild;
    assert.equal(img.tagName, 'IMG');
    // Initially src is NOT set (awaiting IPC).
    assert.ok(!img.getAttribute('src'), 'src not set until IPC resolves');
    // Wait for the promise to resolve.
    await new Promise(r => setImmediate(r));
    // After resolution, img src is the resolved fileUrl.
    assert.equal(img.getAttribute('src'), 'file:///vault/assets/foo.png');
    assert.deepEqual(calledWith, { noteDir: 'notes', relPath: './assets/foo.png' });
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 5-T-VAULT-2: vault-relative IPC rejection swaps to rejected placeholder', async () => {
  installDocumentStub();
  const resolveImagePath = () => Promise.resolve({ ok: false, reason: 'outside-vault' });
  try {
    const w = new widgetModule.InlineImageWidget({
      src: '../escape.png',
      alt: 'escape attempt',
      kind: 'vault-relative',
      vaultRelativeContext: {
        noteDir: 'notes',
        relPath: '../escape.png',
        resolveImagePath,
      },
    });
    const wrapper = w.toDOM();
    await new Promise(r => setImmediate(r));
    // After rejection, wrapper's child should be the rejected placeholder
    // (a styled span), NOT the original <img>.
    const child = wrapper.firstChild;
    assert.ok(child, 'wrapper still has a child after rejection');
    assert.equal(child.tagName, 'SPAN', 'rejected placeholder is a <span>, not <img>');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 5-T-VAULT-3: destroyed flag prevents post-destroy DOM mutation from async IPC', async () => {
  installDocumentStub();
  let resolve;
  const resolveImagePath = () => new Promise(r => { resolve = r; });
  try {
    const w = new widgetModule.InlineImageWidget({
      src: './foo.png',
      alt: 'a',
      kind: 'vault-relative',
      vaultRelativeContext: { noteDir: 'notes', relPath: './foo.png', resolveImagePath },
    });
    const wrapper = w.toDOM();
    const img = wrapper.firstChild;
    // Destroy the widget BEFORE the IPC resolves (mid-navigation case).
    w.destroy();
    // Now resolve the IPC.
    resolve({ ok: true, fileUrl: 'file:///vault/foo.png' });
    await new Promise(r => setImmediate(r));
    // The widget's destroyed flag prevented the DOM update.
    assert.ok(!img.getAttribute('src'), 'src not set after destroy (widget already torn down)');
  } finally {
    uninstallDocumentStub();
  }
});

test('Stage C WAVE 5-T-VAULT-4: vault-relative widget without resolveImagePath gracefully degrades (no crash)', () => {
  // When the resolveImagePath IPC client is missing (test harness, or
  // pre-Stage-C renderer wiring), the widget falls back to using the raw
  // vault-relative URL as <img src>. The browser will fail to load it
  // from the file://index.html base, fire onerror, and the existing
  // onerror handler will swap to the rejected placeholder. Test here
  // only verifies graceful degradation (no crash) — the onerror swap
  // is covered by T-WIDGET-10.
  installDocumentStub();
  try {
    const w = new widgetModule.InlineImageWidget({
      src: './foo.png',
      alt: 'a',
      kind: 'vault-relative',
      vaultRelativeContext: { noteDir: 'notes', relPath: './foo.png', resolveImagePath: null },
    });
    assert.doesNotThrow(() => w.toDOM());
    const wrapper = w.toDOM();
    const img = wrapper.firstChild;
    assert.ok(img, 'wrapper has img child');
    // Fallback: src set to the raw URL (browser will fail to load,
    // onerror handler will swap to placeholder).
    assert.equal(img.getAttribute('src'), './foo.png');
  } finally {
    uninstallDocumentStub();
  }
});
