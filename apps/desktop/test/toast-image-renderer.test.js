'use strict';

/* toast-image-renderer — gated Toast UI Preview image renderer.

   Proves the customHTMLRenderer.image override never emits an <img> for unsafe
   or vault-relative URLs (so the Preview pane stops fetching them), and escapes
   img attribute values (Toast UI writes them raw). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { gatedImage, escapeXml } = require('../lib/toast-image-renderer.js');

function ctx(alt) {
  let skipped = 0;
  return {
    getChildrenText: () => (alt == null ? '' : alt),
    skipChildren: () => { skipped += 1; },
    skippedCount: () => skipped,
  };
}
const isImg = (t) => t && !Array.isArray(t) && t.type === 'openTag' && t.tagName === 'img';
const isPlaceholder = (t) => Array.isArray(t)
  && t[0].tagName === 'span' && t[0].attributes.class === 'toast-image-rejected'
  && t[1].type === 'text' && t[2].tagName === 'span';

test('escapeXml escapes the five HTML metacharacters', () => {
  assert.equal(escapeXml('a&b<c>"\''), 'a&amp;b&lt;c&gt;&quot;&#39;');
});

// ── safe https/data -> <img> with escaped attributes ────────────────────────
for (const good of ['https://example.com/x.png', 'data:image/png;base64,iVB']) {
  test(`safe ${JSON.stringify(good)} -> <img> token`, () => {
    const c = ctx('cat');
    const t = gatedImage({ destination: good }, c);
    assert.ok(isImg(t));
    assert.equal(t.attributes.src, good);
    assert.equal(t.attributes.alt, 'cat');
    assert.equal(c.skippedCount(), 1, 'skipChildren must be called');
  });
}

// ── unsafe -> placeholder, NO <img>, NO src ─────────────────────────────────
for (const bad of ['javascript:alert(1)', 'http://x/y.png', 'file:///etc/passwd',
                   'blob:https://x/abc', '/etc/passwd', 'foo\x00bar', 'data:text/html,<x>']) {
  test(`unsafe ${JSON.stringify(bad)} -> placeholder (no img)`, () => {
    const t = gatedImage({ destination: bad }, ctx('A'));
    assert.ok(isPlaceholder(t), 'must be a span placeholder');
    assert.equal(t[1].content, 'A', 'placeholder carries alt as a text token');
    assert.equal(JSON.stringify(t).includes('"tagName":"img"'), false, 'no img anywhere');
  });
}

// ── vault-relative -> placeholder (no sync resolution in preview) ────────────
for (const rel of ['./assets/x.png', '../sibling/x.png', 'assets/x.png']) {
  test(`vault-relative ${JSON.stringify(rel)} -> placeholder (no fetch)`, () => {
    const t = gatedImage({ destination: rel }, ctx('local'));
    assert.ok(isPlaceholder(t));
  });
}

// ── injection: attribute values must be escaped ─────────────────────────────
test('injection: crafted https src with a quote is escaped (no attribute break-out)', () => {
  const t = gatedImage({ destination: 'https://x/y.png" onerror="alert(1)' }, ctx('a'));
  assert.ok(isImg(t));
  assert.equal(t.attributes.src.includes('"'), false, 'raw double-quote must not survive in src');
  assert.ok(t.attributes.src.includes('&quot;'));
});

test('injection: malicious alt is escaped (no new attribute)', () => {
  const t = gatedImage({ destination: 'https://x/y.png' }, ctx('x" onerror="alert(1)'));
  assert.ok(isImg(t));
  assert.equal(t.attributes.alt.includes('"'), false, 'raw double-quote must not survive in alt');
  assert.ok(t.attributes.alt.includes('&quot;'));
});

test('injection: malicious title is escaped', () => {
  const t = gatedImage({ destination: 'https://x/y.png', title: 'a" onmouseover="x' }, ctx('a'));
  assert.ok(isImg(t));
  assert.equal(t.attributes.title.includes('"'), false);
  assert.ok(t.attributes.title.includes('&quot;'));
});

test('no title -> no title attribute', () => {
  const t = gatedImage({ destination: 'https://x/y.png' }, ctx('a'));
  assert.equal(Object.prototype.hasOwnProperty.call(t.attributes, 'title'), false);
});

test('totality: missing context is safe', () => {
  const t = gatedImage({ destination: 'javascript:alert(1)' }, undefined);
  assert.ok(isPlaceholder(t));
});
