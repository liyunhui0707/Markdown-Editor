/* TDD: write-engine resolver — pure, dependency-injected behavior tests.
   Run: node --test test/write-engine.test.js

   The resolver chooses which Write-mode editor implementation the renderer
   should construct: the legacy 'hybrid' (HybridWriteView), the fallback
   'cm6' (CodeMirror 6 single-document adapter), or the now-default
   'hybrid-cm6' (Stage 17 flip; CM6 with live Markdown styling).
   Selection layers, in priority order:
     1. URL query param  ?writeEngine=<value>
     2. localStorage     markdownVault.writeEngine = <value>
     3. default          'hybrid-cm6'  (Stage 17; previously 'cm6')
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

test('Stage 17: default engine is "hybrid-cm6" when no storage and no search', () => {
  // Stage 17 flipped this from 'cm6' to 'hybrid-cm6'. The resolver fallback
  // path with no inputs now returns the new default.
  assert.equal(resolveWriteEngine({ search: '', storage: makeStorage({}) }), 'hybrid-cm6');
});

test('Stage 17: default engine is "hybrid-cm6" when inputs are omitted entirely', () => {
  assert.equal(resolveWriteEngine({}), 'hybrid-cm6');
  assert.equal(resolveWriteEngine(), 'hybrid-cm6');
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

test('Stage 17: invalid URL value with no localStorage falls back to "hybrid-cm6"', () => {
  // Stage 17 flipped this from 'cm6' to 'hybrid-cm6'.
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=bogus', storage: makeStorage({}) }),
    'hybrid-cm6'
  );
});

test('Stage 17: invalid localStorage value falls back to "hybrid-cm6"', () => {
  // Stage 17 flipped this from 'cm6' to 'hybrid-cm6'.
  const storage = makeStorage({ 'markdownVault.writeEngine': 'lexical' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'hybrid-cm6');
});

test('empty URL value is treated as absent (falls back to localStorage)', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=', storage }),
    'cm6'
  );
});

test('Stage 17: empty localStorage value is treated as absent (falls back to "hybrid-cm6")', () => {
  // Stage 17 flipped the fallback from 'cm6' to 'hybrid-cm6'.
  const storage = makeStorage({ 'markdownVault.writeEngine': '' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'hybrid-cm6');
});

test('Stage 17: URL with unrelated params (no writeEngine) falls back to "hybrid-cm6"', () => {
  // Stage 17 flipped the fallback from 'cm6' to 'hybrid-cm6'.
  const search = '?other=1&another=foo';
  assert.equal(
    resolveWriteEngine({ search, storage: makeStorage({}) }),
    'hybrid-cm6'
  );
});

test('URL with unrelated params alongside writeEngine still resolves', () => {
  const search = '?other=1&writeEngine=cm6&another=foo';
  assert.equal(
    resolveWriteEngine({ search, storage: makeStorage({}) }),
    'cm6'
  );
});

test('Stage 17: null/undefined storage does not throw — resolver tolerates absence (default "hybrid-cm6")', () => {
  // Stage 17 flipped the no-storage default-fallback from 'cm6' to 'hybrid-cm6'.
  // Explicit ?writeEngine=hybrid still wins.
  assert.equal(resolveWriteEngine({ search: '', storage: null }), 'hybrid-cm6');
  assert.equal(resolveWriteEngine({ search: '', storage: undefined }), 'hybrid-cm6');
  assert.equal(resolveWriteEngine({ search: '?writeEngine=hybrid', storage: null }), 'hybrid');
});

test('null/undefined search does not throw', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(resolveWriteEngine({ search: null, storage }), 'cm6');
  assert.equal(resolveWriteEngine({ search: undefined, storage }), 'cm6');
});

test('Stage 17: storage that throws on getItem is treated as absent (default "hybrid-cm6")', () => {
  // Stage 17 flipped the no-storage default-fallback from 'cm6' to 'hybrid-cm6'.
  const storage = { getItem() { throw new Error('blocked'); } };
  assert.equal(resolveWriteEngine({ search: '', storage }), 'hybrid-cm6');
  assert.equal(resolveWriteEngine({ search: '?writeEngine=hybrid', storage }), 'hybrid');
});

test('Stage 17: case sensitivity — "CM6" is not accepted (only lowercase canonical values); falls back to "hybrid-cm6"', () => {
  // Pin current behavior: we accept exactly 'cm6' / 'hybrid' / 'hybrid-cm6', no case folding.
  // This keeps the contract simple and prevents accidental matches.
  // Stage 17 flipped the invalid-value fallback from 'cm6' to 'hybrid-cm6'.
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=CM6', storage: makeStorage({}) }),
    'hybrid-cm6'
  );
});

// ── Stage 11.2: hybrid-cm6 engine tests ──────────────────────────────────────

test('Stage 11.2: ?writeEngine=hybrid-cm6 resolves to "hybrid-cm6"', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid-cm6', storage: makeStorage({}) }),
    'hybrid-cm6'
  );
});

test('Stage 11.2: localStorage hybrid-cm6 resolves to "hybrid-cm6"', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'hybrid-cm6' });
  assert.equal(resolveWriteEngine({ search: '', storage }), 'hybrid-cm6');
});

test('Stage 17: hybrid-cm6 is now the default engine (previously cm6 per Stage 11.2)', () => {
  // Stage 17 flip: this test was previously the "hybrid-cm6 is experimental,
  // not the default" pin. After the default-engine flip, it pins the opposite
  // invariant — that hybrid-cm6 IS the default. cm6 remains selectable via
  // explicit ?writeEngine=cm6 or localStorage='cm6'.
  assert.equal(resolveWriteEngine({}), 'hybrid-cm6');
  assert.equal(resolveWriteEngine({ search: '', storage: makeStorage({}) }), 'hybrid-cm6');
});

test('Stage 11.2: URL hybrid-cm6 wins over localStorage cm6', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid-cm6', storage }),
    'hybrid-cm6'
  );
});

test('Stage 11.2: URL cm6 wins over localStorage hybrid-cm6', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'hybrid-cm6' });
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=cm6', storage }),
    'cm6'
  );
});

// ── Stage 17: hybrid-cm6 is the default engine ─────────────────────────────
//
// These anchor tests pin the post-flip contract: hybrid-cm6 is the default,
// while cm6 and hybrid remain fully selectable as fallbacks via URL or
// localStorage. They are intentionally redundant with some of the renamed
// fallback tests above so a future refactor can't silently drop both.

const { DEFAULT_ENGINE } = require('../lib/write-engine');

test('Stage 17: DEFAULT_ENGINE export equals "hybrid-cm6"', () => {
  assert.equal(DEFAULT_ENGINE, 'hybrid-cm6',
    'Stage 17 flipped the resolver default; DEFAULT_ENGINE must reflect that');
});

test('Stage 17: explicit ?writeEngine=cm6 still selects cm6 after default flip (fallback preserved)', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=cm6', storage: makeStorage({}) }),
    'cm6',
    'cm6 must remain selectable as a fallback via URL query'
  );
});

test('Stage 17: explicit ?writeEngine=hybrid still selects hybrid after default flip (legacy fallback preserved)', () => {
  assert.equal(
    resolveWriteEngine({ search: '?writeEngine=hybrid', storage: makeStorage({}) }),
    'hybrid',
    'legacy hybrid must remain selectable as a fallback via URL query'
  );
});

test('Stage 17: localStorage="cm6" is respected after default flip (existing user preference preserved)', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'cm6' });
  assert.equal(
    resolveWriteEngine({ search: '', storage }),
    'cm6',
    'existing users with localStorage="cm6" must continue to get cm6, not be silently migrated'
  );
});

test('Stage 17: localStorage="hybrid" is respected after default flip', () => {
  const storage = makeStorage({ 'markdownVault.writeEngine': 'hybrid' });
  assert.equal(
    resolveWriteEngine({ search: '', storage }),
    'hybrid',
    'existing users with localStorage="hybrid" must continue to get the legacy hybrid engine'
  );
});
