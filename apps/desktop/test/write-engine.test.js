/* TDD: write-engine resolver — pure, dependency-injected behavior tests.
   Run: node --test test/write-engine.test.js

   The resolver chooses which Write-mode editor implementation the renderer
   should construct: the legacy 'hybrid' (HybridWriteView) or the production
   'cm6' (CodeMirror 6). Selection layers, in priority order:
     1. URL query param  ?writeEngine=hybrid
     2. localStorage     markdownVault.writeEngine = 'hybrid'
     3. default          'cm6'
   Invalid values at any layer are ignored (treated as absent).
*/
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { resolveWriteEngine } = require('../lib/write-engine');

// Minimal Storage-like fake. Only getItem is consulted by the resolver.
function makeStorage(map) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
  };
}

test('default engine is "cm6" when no storage and no search', () => {
  assert.equal(resolveWriteEngine({ search: '', storage: makeStorage({}) }), 'cm6');
});

test('default engine is "cm6" when inputs are omitted entirely', () => {
  assert.equal(resolveWriteEngine({}), 'cm6');
  assert.equal(resolveWriteEngine(), 'cm6');
});

test('localStorage markdownVault.writeEngine="cm6" selects cm6', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'cm6');
});

test('localStorage markdownVault.writeEngine="hybrid" selects hybrid', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'hybrid' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'hybrid');
});

test('URL query ?writeEngine=cm6 selects cm6', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=cm6', storage: makeStorage({}) }),
    'cm6'
  );
});

test('URL query writeEngine=cm6 (no leading ?) also works', () => {
  assert.equal(
    resolveWriteEngine({ search: 'writeEngine=cm6', storage: makeStorage({}) }),
    'cm6'
  );
});

test('URL query ?writeEngine=hybrid selects hybrid', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid', storage: makeStorage({}) }),
    'hybrid'
  );
});

test('URL param wins over localStorage when both are set (URL=cm6, LS=hybrid)', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'hybrid' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=cm6', storage }),
    'cm6'
  );
});

test('URL param wins over localStorage when both are set (URL=hybrid, LS=cm6)', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid', storage }),
    'hybrid'
  );
});

test('invalid URL value falls back to localStorage', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=tiptap', storage }),
    'cm6'
  );
});

test('invalid URL value with no localStorage falls back to "cm6"', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=bogus', storage: makeStorage({}) }),
    'cm6'
  );
});

test('invalid localStorage value falls back to "cm6"', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'lexical' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'cm6');
});

test('empty URL value is treated as absent (falls back to localStorage)', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=', storage }),
    'cm6'
  );
});

test('empty localStorage value is treated as absent (falls back to default)', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': '' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'cm6');
});

test('URL with unrelated params is ignored', () => {
  const search = '?other=1&another=foo';
  assert.equal(
    resolveWriteEngine({ search, storage: makeStorage({}) }),
    'cm6'
  );
});

test('URL with unrelated params alongside writeEngine still resolves', () => {
  const search = '?other=1&writeEngine=cm6&another=foo';
  assert.equal(
    resolveWriteEngine({ search, storage: makeStorage({}) }),
    'cm6'
  );
});

test('null/undefined storage does not throw — resolver tolerates absence', () => {
  assert.equal(resolveWriteEngine({ search: '', storage: null }), 'cm6');
  assert.equal(resolveWriteEngine({ search: '', storage: undefined }), 'cm6');
  assert.equal(resolveWriteEngine({ search: '?writeEngine=hybrid', storage: null }), 'hybrid');
});

test('null/undefined search does not throw', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(resolveWriteEngine({ search: null, storage }), 'cm6');
  assert.equal(resolveWriteEngine({ search: undefined, storage }), 'cm6');
});

test('storage that throws on getItem is treated as absent', () => {
  const storage = { getItem() { throw new Error('blocked'); } };
  assert.equal(resolveWriteEngine({ search: '', storage }), 'cm6');
  assert.equal(resolveWriteEngine({ search: '?writeEngine=hybrid', storage }), 'hybrid');
});

test('case sensitivity: "CM6" is not accepted (only lowercase canonical values)', () => {
  // Pin current behavior: we accept exactly 'cm6' and 'hybrid', no case folding.
  // This keeps the contract simple and prevents accidental matches.
  // Invalid value falls through to the default ('cm6').
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=CM6', storage: makeStorage({}) }),
    'cm6'
  );
});
