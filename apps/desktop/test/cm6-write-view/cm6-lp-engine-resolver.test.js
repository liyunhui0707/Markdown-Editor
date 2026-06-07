/* Stage A WAVE 1 — engine resolver accepts 'hybrid-cm6-lp'.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-engine-resolver.test.js

   The hybrid-cm6-lp engine is the fourth Write engine. It must be
   reachable via the same two override layers as the existing three:
     1. URL query  ?writeEngine=hybrid-cm6-lp
     2. localStorage  markdownVault.writeEngine = 'hybrid-cm6-lp'
   With no overrides the default remains 'hybrid-cm6' (Stage 17).
   Invalid values still fall through to the default.

   Pattern mirrors test/write-engine.test.js. Tests for the existing
   three engines stay in that file; this file pins only the lp-specific
   resolver behavior + regression coverage that ALL four named values
   resolve to themselves (the round-2 review explicitly required behavior
   tests rather than a VALID.size === 4 set-size assertion). */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { resolveWriteEngine } = require('../../lib/write-engine');

function makeStorage(map) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
  };
}

// ── Behavior tests for every named valid engine (regression pin) ─────────

test('Stage A WAVE 1-T1: URL ?writeEngine=hybrid resolves to "hybrid"', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid', storage: makeStorage({}) }),
    'hybrid'
  );
});

test('Stage A WAVE 1-T2: URL ?writeEngine=cm6 resolves to "cm6"', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=cm6', storage: makeStorage({}) }),
    'cm6'
  );
});

test('Stage A WAVE 1-T3: URL ?writeEngine=hybrid-cm6 resolves to "hybrid-cm6"', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid-cm6', storage: makeStorage({}) }),
    'hybrid-cm6'
  );
});

// ── The NEW Stage A engine name ──────────────────────────────────────────

test('Stage A WAVE 1-T4: URL ?writeEngine=hybrid-cm6-lp resolves to "hybrid-cm6-lp"', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid-cm6-lp', storage: makeStorage({}) }),
    'hybrid-cm6-lp'
  );
});

test('Stage A WAVE 1-T6: localStorage markdownVault.writeEngine="hybrid-cm6-lp" selects it', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'hybrid-cm6-lp' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'hybrid-cm6-lp');
});

// ── Invalid fallback and default both remain 'hybrid-cm6' ─────────────────

test('Stage A WAVE 1-T5: URL ?writeEngine=bogus falls through to default "hybrid-cm6"', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=bogus', storage: makeStorage({}) }),
    'hybrid-cm6'
  );
});

test('Stage A WAVE 1-T7: no overrides → default remains "hybrid-cm6" (Stage 17 default unchanged)', () => {
  assert.equal(resolveWriteEngine({}), 'hybrid-cm6');
  assert.equal(
    resolveWriteEngine({ search: '', storage: makeStorage({}) }),
    'hybrid-cm6'
  );
});

// ── Cross-cutting: lp engine doesn't accidentally clobber the others ─────

test('Stage A WAVE 1-T8: lp engine in localStorage does not override URL ?writeEngine=cm6 (URL wins)', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'hybrid-cm6-lp' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=cm6', storage }),
    'cm6'
  );
});
