/* TDD: scroll-position sync helper for the Write↔Preview mode toggle.
   Run: node --test test/scroll-sync.test.js

   The renderer captures a scroll ratio from the source surface (Write or
   Preview), then re-applies that ratio to the target surface after the mode
   switch + a frame for layout to commit. Ratios are independent of the two
   surfaces' heights, so a long Write surface scrolled to 40% lands at 40%
   of the (potentially shorter) Preview surface. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { captureScrollRatio, applyScrollRatio } = require('../lib/scroll-sync');

function makeScrollableEl({ scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  return { scrollTop, scrollHeight, clientHeight };
}

// ── captureScrollRatio ─────────────────────────────────────────────────────
test('captureScrollRatio: top of document → 0', () => {
  const el = makeScrollableEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(captureScrollRatio(el), 0);
});

test('captureScrollRatio: middle of document → 0.5', () => {
  // scrollHeight 1000, clientHeight 400 → max scrollTop = 600. 300/600 = 0.5.
  const el = makeScrollableEl({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(captureScrollRatio(el), 0.5);
});

test('captureScrollRatio: bottom of document → 1', () => {
  const el = makeScrollableEl({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(captureScrollRatio(el), 1);
});

test('captureScrollRatio: clamps negative scrollTop to 0', () => {
  const el = makeScrollableEl({ scrollTop: -50, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(captureScrollRatio(el), 0);
});

test('captureScrollRatio: clamps over-scroll to 1', () => {
  // Some browsers report scrollTop > scrollHeight - clientHeight during
  // overscroll/elastic-bounce; clamp to 1.
  const el = makeScrollableEl({ scrollTop: 5000, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(captureScrollRatio(el), 1);
});

test('captureScrollRatio: short document (scrollHeight ≤ clientHeight) → 0', () => {
  const a = makeScrollableEl({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 });
  assert.equal(captureScrollRatio(a), 0);
  const b = makeScrollableEl({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 });
  assert.equal(captureScrollRatio(b), 0);
});

test('captureScrollRatio: zero-height container → 0 (defensive, no NaN)', () => {
  const el = makeScrollableEl({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const ratio = captureScrollRatio(el);
  assert.equal(ratio, 0);
  assert.ok(!Number.isNaN(ratio), 'must never return NaN');
});

test('captureScrollRatio: null/undefined element → 0', () => {
  assert.equal(captureScrollRatio(null),      0);
  assert.equal(captureScrollRatio(undefined), 0);
});

// ── applyScrollRatio ───────────────────────────────────────────────────────
test('applyScrollRatio: ratio 0 sets scrollTop to 0', () => {
  const el = makeScrollableEl({ scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });
  applyScrollRatio(el, 0);
  assert.equal(el.scrollTop, 0);
});

test('applyScrollRatio: ratio 1 sets scrollTop to scrollHeight - clientHeight', () => {
  const el = makeScrollableEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
  applyScrollRatio(el, 1);
  assert.equal(el.scrollTop, 600);
});

test('applyScrollRatio: ratio 0.5 sets scrollTop to midpoint', () => {
  const el = makeScrollableEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
  applyScrollRatio(el, 0.5);
  assert.equal(el.scrollTop, 300);
});

test('applyScrollRatio: ratio outside [0,1] is clamped', () => {
  const el = makeScrollableEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
  applyScrollRatio(el, -1);
  assert.equal(el.scrollTop, 0, 'negative ratio clamps to 0');
  applyScrollRatio(el, 5);
  assert.equal(el.scrollTop, 600, 'oversize ratio clamps to 1');
});

test('applyScrollRatio: short target document is a no-op (no scroll possible)', () => {
  const el = makeScrollableEl({ scrollTop: 7, scrollHeight: 200, clientHeight: 400 });
  applyScrollRatio(el, 0.5);
  assert.equal(el.scrollTop, 7,
    'short target must not be touched — no scroll position to assign');
});

test('applyScrollRatio: equal scrollHeight/clientHeight → no-op', () => {
  const el = makeScrollableEl({ scrollTop: 7, scrollHeight: 400, clientHeight: 400 });
  applyScrollRatio(el, 0.7);
  assert.equal(el.scrollTop, 7);
});

test('applyScrollRatio: null/undefined target does not throw', () => {
  // Defensive: querySelector can return null when Toast UI hasn't mounted.
  // The helper must absorb that gracefully.
  applyScrollRatio(null,      0.5);
  applyScrollRatio(undefined, 0.5);
});

// ── Round-trip: capture then apply between differently-sized surfaces ──────
test('round-trip: 40% on tall Write pane lands at 40% of shorter Preview pane', () => {
  const writePane = makeScrollableEl({ scrollTop: 720, scrollHeight: 2200, clientHeight: 400 });
  // ratio = 720 / (2200-400) = 720 / 1800 = 0.4
  const ratio = captureScrollRatio(writePane);
  assert.equal(ratio, 0.4);

  const previewPane = makeScrollableEl({ scrollTop: 0, scrollHeight: 1100, clientHeight: 400 });
  applyScrollRatio(previewPane, ratio);
  // 0.4 * (1100 - 400) = 0.4 * 700 = 280
  assert.equal(previewPane.scrollTop, 280);
});

test('round-trip: 70% on short Preview pane lands at 70% of taller Write pane', () => {
  const previewPane = makeScrollableEl({ scrollTop: 280, scrollHeight: 800, clientHeight: 400 });
  // ratio = 280 / 400 = 0.7
  const ratio = captureScrollRatio(previewPane);
  assert.equal(ratio, 0.7);

  const writePane = makeScrollableEl({ scrollTop: 0, scrollHeight: 2400, clientHeight: 400 });
  applyScrollRatio(writePane, ratio);
  // 0.7 * (2400 - 400) = 0.7 * 2000 = 1400
  assert.equal(writePane.scrollTop, 1400);
});

test('round-trip: capture then re-apply on same element preserves position', () => {
  const el = makeScrollableEl({ scrollTop: 137, scrollHeight: 999, clientHeight: 411 });
  const ratio = captureScrollRatio(el);
  const target = makeScrollableEl({ scrollTop: 0, scrollHeight: 999, clientHeight: 411 });
  applyScrollRatio(target, ratio);
  // Same dimensions on capture and apply → exact same scrollTop.
  assert.equal(target.scrollTop, 137);
});
