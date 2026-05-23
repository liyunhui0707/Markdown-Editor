/* Phase A — single-flight lock tests.
   Run focused: node --test test/session-import-lock.test.js */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

// Lock module state is module-level. Each test must release whatever it
// acquires so the next test starts clean. Tests fail loudly if cleanup
// is missed.

/* ─────────────────────── Stage A-LOCK-1 ─────────────────────── */
test('Stage A-LOCK-1 — acquire("claude") returns a token; second concurrent acquire returns null; release re-enables', () => {
  const lock = require('../lib/session-import-lock');
  const t1 = lock.acquire('claude');
  try {
    assert.notStrictEqual(t1, null, 'first acquire returns a token');
    assert.strictEqual(typeof t1, 'symbol', 'token is a Symbol');

    const t2 = lock.acquire('claude');
    assert.strictEqual(t2, null, 'second concurrent acquire returns null');
  } finally {
    lock.release(t1);
  }

  const t3 = lock.acquire('claude');
  try {
    assert.notStrictEqual(t3, null, 'after release, acquire works again');
  } finally {
    lock.release(t3);
  }
});

/* ─────────────────────── Stage A-LOCK-2 ─────────────────────── */
test('Stage A-LOCK-2 — release is safe on null, undefined, non-symbol, and stale tokens', () => {
  const lock = require('../lib/session-import-lock');
  // None of these should throw:
  lock.release(null);
  lock.release(undefined);
  lock.release('not-a-symbol');
  lock.release(42);
  lock.release(Symbol('foreign'));

  const t = lock.acquire('claude');
  try {
    lock.release(t);
    lock.release(t); // double-release: silent no-op
    // After release we should be able to acquire again.
    const t2 = lock.acquire('claude');
    assert.notStrictEqual(t2, null);
    lock.release(t2);
  } catch (err) {
    lock.release(t);
    throw err;
  }
});

/* ─────────────────────── Stage A-LOCK-3 ─────────────────────── */
test('Stage A-LOCK-3 — claude lock does not affect codex lock (per-kind isolation)', () => {
  const lock = require('../lib/session-import-lock');
  const claudeT = lock.acquire('claude');
  const codexT  = lock.acquire('codex');
  try {
    assert.notStrictEqual(claudeT, null);
    assert.notStrictEqual(codexT, null);
    assert.notStrictEqual(claudeT, codexT, 'distinct tokens');
  } finally {
    lock.release(claudeT);
    lock.release(codexT);
  }
});

/* ─────────────────────── Stage A-LOCK-4 ─────────────────────── */
test('Stage A-LOCK-4 — acquire("garbage") throws on invalid kind', () => {
  const lock = require('../lib/session-import-lock');
  assert.throws(() => lock.acquire('garbage'), /invalid kind/);
  assert.throws(() => lock.acquire(''), /invalid kind/);
  assert.throws(() => lock.acquire(null), /invalid kind/);
  assert.throws(() => lock.acquire(undefined), /invalid kind/);
});
