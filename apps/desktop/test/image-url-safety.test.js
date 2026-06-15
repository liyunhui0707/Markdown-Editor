'use strict';

/* image-url-safety — allowlist + render-decision + drift parity with CM6.

   The corpus is seeded from test/cm6-write-view/cm6-lp-image-url-allowlist.test.js
   so the tiptap engine's canonical allowlist documents (and is pinned to) the
   exact same security contract as the CM6-LP engine. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isSafeImageUrl, decideImageRender } = require('../lib/image-url-safety.js');
const cm6 = require('../lib/cm6-lp-image-widget.js');

// [url, expected isSafeImageUrl result, expected decideImageRender result]
const CASES = [
  ['https://example.com/x.png',                 { safe: true,  kind: 'https' },               { action: 'direct',  kind: 'https' }],
  ['HTTPS://example.com/x.png',                 { safe: true,  kind: 'https' },               { action: 'direct',  kind: 'https' }],
  ['data:image/png;base64,iVBORw0KGgo',         { safe: true,  kind: 'data' },                { action: 'direct',  kind: 'data' }],
  ['data:image/svg+xml;charset=utf-8,<svg></svg>', { safe: true, kind: 'data' },              { action: 'direct',  kind: 'data' }],
  ['data:image/jpeg;base64,xxx',                { safe: true,  kind: 'data' },                { action: 'direct',  kind: 'data' }],
  ['data:image/webp;base64,xxx',                { safe: true,  kind: 'data' },                { action: 'direct',  kind: 'data' }],
  ['./assets/foo.png',                          { safe: true,  kind: 'vault-relative' },      { action: 'resolve', kind: 'vault-relative' }],
  ['assets/foo.png',                            { safe: true,  kind: 'vault-relative' },      { action: 'resolve', kind: 'vault-relative' }],
  ['../sibling/foo.png',                        { safe: true,  kind: 'vault-relative' },      { action: 'resolve', kind: 'vault-relative' }],
  ['http://example.com/x.png',                  { safe: false, reason: 'scheme-not-allowed' },{ action: 'reject', reason: 'scheme-not-allowed' }],
  ['javascript:alert(1)',                       { safe: false, reason: 'scheme-not-allowed' },{ action: 'reject', reason: 'scheme-not-allowed' }],
  ['file:///etc/passwd',                        { safe: false, reason: 'scheme-not-allowed' },{ action: 'reject', reason: 'scheme-not-allowed' }],
  ['chrome-extension://abc/x.png',              { safe: false, reason: 'scheme-not-allowed' },{ action: 'reject', reason: 'scheme-not-allowed' }],
  ['blob:https://x.test/abc',                   { safe: false, reason: 'scheme-not-allowed' },{ action: 'reject', reason: 'scheme-not-allowed' }],
  ['mailto:foo@bar',                            { safe: false, reason: 'scheme-not-allowed' },{ action: 'reject', reason: 'scheme-not-allowed' }],
  ['data:text/html,<script>',                   { safe: false, reason: 'data-mime-not-allowed' }, { action: 'reject', reason: 'data-mime-not-allowed' }],
  ['data:application/json,{}',                  { safe: false, reason: 'data-mime-not-allowed' }, { action: 'reject', reason: 'data-mime-not-allowed' }],
  ['data:image/exotic-format,xxx',              { safe: false, reason: 'data-mime-not-allowed' }, { action: 'reject', reason: 'data-mime-not-allowed' }],
  ['data:',                                     { safe: false, reason: 'data-mime-not-allowed' }, { action: 'reject', reason: 'data-mime-not-allowed' }],
  ['/etc/passwd',                               { safe: false, reason: 'absolute-path-not-allowed' }, { action: 'reject', reason: 'absolute-path-not-allowed' }],
  ['',                                          { safe: false, reason: 'empty-url' },         { action: 'reject', reason: 'empty-url' }],
  [null,                                        { safe: false, reason: 'empty-url' },         { action: 'reject', reason: 'empty-url' }],
  [undefined,                                   { safe: false, reason: 'empty-url' },         { action: 'reject', reason: 'empty-url' }],
  ['foo\x00bar',                                { safe: false, reason: 'invalid-path' },      { action: 'reject', reason: 'invalid-path' }],
  ['https://example.com/x\x00.png',             { safe: false, reason: 'invalid-path' },      { action: 'reject', reason: 'invalid-path' }],
];

test('isSafeImageUrl: allowlist matrix matches the documented contract', () => {
  for (const [url, expected] of CASES) {
    assert.deepEqual(isSafeImageUrl(url), expected, `isSafeImageUrl(${JSON.stringify(url)})`);
  }
});

test('decideImageRender: direct/resolve/reject per class', () => {
  for (const [url, , expectedDecision] of CASES) {
    assert.deepEqual(decideImageRender(url), expectedDecision, `decideImageRender(${JSON.stringify(url)})`);
  }
});

test('PARITY: image-url-safety.isSafeImageUrl === Cm6LpImageWidget.isSafeImageUrl across the corpus', () => {
  for (const [url] of CASES) {
    assert.deepEqual(
      isSafeImageUrl(url),
      cm6.isSafeImageUrl(url),
      `parity drift for ${JSON.stringify(url)} — the two allowlists must stay identical`,
    );
  }
});
