/* Stage S2 — refresh-button controller (renderer-side, headless).
   Run focused: node --test test/session-viewer/refresh-button.test.js
   Tests T-S2-13..T-S2-17. The controller is bundled into a CJS-loadable
   shape via a `module.exports` fallback so it can be required directly
   from Node tests AND attached to `window.SessionViewer` in the renderer.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MODULE_REL = '../../lib/session-viewer/refresh-button.js';

function load() {
  delete require.cache[require.resolve(MODULE_REL)];
  return require(MODULE_REL);
}

// Minimal DOM stub: mimics document/createElement/appendChild + a click
// dispatcher for the button. Matches the existing test-only DOM stub
// pattern used elsewhere in the codebase (no jsdom dep).
function makeDom() {
  function elem(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      attributes: {},
      dataset: {},
      listeners: {},
      style: {},
      textContent: '',
      _disabled: false,
      get disabled() { return this._disabled; },
      set disabled(v) { this._disabled = !!v; },
      appendChild(child) { this.children.push(child); child.parent = this; return child; },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        return child;
      },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      addEventListener(evt, fn) {
        (this.listeners[evt] = this.listeners[evt] || []).push(fn);
      },
      removeEventListener(evt, fn) {
        const arr = this.listeners[evt];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatchEvent(evt) {
        const arr = this.listeners[evt.type] || [];
        for (const fn of arr) fn(evt);
      },
    };
    return el;
  }
  return {
    createElement: (tag) => elem(tag),
    body: elem('body'),
  };
}

function findButton(root) {
  for (const c of root.children) if (c.tagName === 'BUTTON') return c;
  for (const c of root.children) {
    const found = findButton(c);
    if (found) return found;
  }
  return null;
}

function findBanner(root) {
  for (const c of root.children) {
    if (c.tagName === 'DIV' && c.dataset && c.dataset.role === 'banner') return c;
    const found = findBanner(c);
    if (found) return found;
  }
  return null;
}

function makeVaultApi(impl) {
  const calls = [];
  return {
    calls,
    refreshSessions: (vaultPath) => {
      calls.push(vaultPath);
      return impl(vaultPath);
    },
  };
}

test('S2-13: button starts disabled (no vaultPath set)', () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  const vaultApi = makeVaultApi(async () => ({ ok: true, claude: { imported: 0, skipped: 0, errors: 0 }, codex: { imported: 0, skipped: 0, errors: 0 } }));
  createRefreshController({ root, vaultApi, document: dom });
  const btn = findButton(root);
  assert.ok(btn, 'button mounted');
  assert.equal(btn.disabled, true);
});

test('S2-13: setVaultPath enables / re-disables the button', () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  const vaultApi = makeVaultApi(async () => ({ ok: true, claude: {}, codex: {} }));
  const ctl = createRefreshController({ root, vaultApi, document: dom });
  const btn = findButton(root);
  ctl.setVaultPath('/some/vault');
  assert.equal(btn.disabled, false);
  ctl.setVaultPath('');
  assert.equal(btn.disabled, true);
  ctl.setVaultPath(null);
  assert.equal(btn.disabled, true);
});

test('S2-14: click invokes vaultApi.refreshSessions(vaultPath) exactly once', async () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  let resolved;
  const vaultApi = makeVaultApi(() => new Promise((res) => { resolved = res; }));
  const ctl = createRefreshController({ root, vaultApi, document: dom });
  ctl.setVaultPath('/v');
  const btn = findButton(root);
  btn.dispatchEvent({ type: 'click' });
  // Yield once to let the promise chain attach.
  await Promise.resolve();
  assert.equal(vaultApi.calls.length, 1);
  assert.equal(vaultApi.calls[0], '/v');
  resolved({ ok: true, claude: { imported: 1, skipped: 0, errors: 0 }, codex: { imported: 0, skipped: 0, errors: 0 } });
  await ctl.waitForIdle();
});

test('S2-15: second click while in-flight is a no-op; banner shows "Importing…"', async () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  let resolved;
  const vaultApi = makeVaultApi(() => new Promise((res) => { resolved = res; }));
  const ctl = createRefreshController({ root, vaultApi, document: dom });
  ctl.setVaultPath('/v');
  const btn = findButton(root);
  const banner = findBanner(root);
  btn.dispatchEvent({ type: 'click' });
  await Promise.resolve();
  assert.match(banner.textContent, /Import/i);
  btn.dispatchEvent({ type: 'click' });
  await Promise.resolve();
  assert.equal(vaultApi.calls.length, 1, 'second click ignored');
  resolved({ ok: true, claude: { imported: 0, skipped: 0, errors: 0 }, codex: { imported: 0, skipped: 0, errors: 0 } });
  await ctl.waitForIdle();
});

test('S2-16: success response — banner is cleared (no count summary), onComplete fires once', async () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  const vaultApi = makeVaultApi(async () => ({
    ok: true,
    claude: { imported: 3, skipped: 1, errors: 0 },
    codex: { imported: 2, skipped: 0, errors: 0 },
  }));
  const onComplete = (...args) => { onComplete.calls.push(args); };
  onComplete.calls = [];
  const ctl = createRefreshController({ root, vaultApi, document: dom, onComplete });
  ctl.setVaultPath('/v');
  const btn = findButton(root);
  const banner = findBanner(root);
  btn.dispatchEvent({ type: 'click' });
  await ctl.waitForIdle();
  // Stage 6.3D: the success summary banner ("claude: 3, skipped 1…")
  // was removed per user feedback ("有点多余"). The user gets implicit
  // feedback via the grouped tree update and the Read view refresh.
  assert.equal(banner.textContent, '');
  assert.equal(onComplete.calls.length, 1);
});

test("S2-17: error response — banner shows mapped reason string, button re-enabled, onComplete NOT called", async () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  // Retrofit #1: IPC now returns {ok:false, reason:<code>}, never {error:...}.
  const vaultApi = makeVaultApi(async () => ({ ok: false, reason: 'no-vault' }));
  const onComplete = (...args) => { onComplete.calls.push(args); };
  onComplete.calls = [];
  const ctl = createRefreshController({ root, vaultApi, document: dom, onComplete });
  ctl.setVaultPath('/v');
  const btn = findButton(root);
  const banner = findBanner(root);
  btn.dispatchEvent({ type: 'click' });
  await ctl.waitForIdle();
  assert.equal(banner.textContent, 'No vault selected.');
  assert.equal(btn.disabled, false, 'button re-enabled after error');
  assert.equal(onComplete.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Retrofit #1 — reason → banner mapping (REASON_TO_BANNER table)
// ---------------------------------------------------------------------------

const REASON_BANNER_EXPECTATIONS = [
  ['in-progress',          'Import already in progress.'],
  ['platform-unsupported', "This platform doesn't support symlink-safe imports."],
  ['no-vault',             'No vault selected.'],
  ['import-error',         'Import failed — see logs for details.'],
];

for (const [reason, expectedText] of REASON_BANNER_EXPECTATIONS) {
  test(`T-button-mapping: reason='${reason}' -> banner='${expectedText}'`, async () => {
    const { createRefreshController } = load();
    const dom = makeDom();
    const root = dom.createElement('div');
    const vaultApi = makeVaultApi(async () => ({ ok: false, reason }));
    const ctl = createRefreshController({ root, vaultApi, document: dom });
    ctl.setVaultPath('/v');
    const btn = findButton(root);
    const banner = findBanner(root);
    btn.dispatchEvent({ type: 'click' });
    await ctl.waitForIdle();
    assert.equal(banner.textContent, expectedText);
    assert.equal(btn.disabled, false);
  });
}

test('T-button-fallback: unknown reason -> default "Import failed." banner', async () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  const vaultApi = makeVaultApi(async () => ({ ok: false, reason: 'totally-unknown-code' }));
  const ctl = createRefreshController({ root, vaultApi, document: dom });
  ctl.setVaultPath('/v');
  const btn = findButton(root);
  const banner = findBanner(root);
  btn.dispatchEvent({ type: 'click' });
  await ctl.waitForIdle();
  assert.equal(banner.textContent, 'Import failed.');
  assert.equal(btn.disabled, false);
});

test('T-button-bridge-throws: rejected refreshSessions -> import-error banner; controller does not crash', async () => {
  const { createRefreshController } = load();
  const dom = makeDom();
  const root = dom.createElement('div');
  // Rejected Promise; the controller's `await + try/catch` collapses this
  // into the same path as a synchronous-throw bridge, so testing the
  // rejected-Promise shape alone covers both.
  const vaultApi = makeVaultApi(() => Promise.reject(new Error('bridge died: /Users/test/bad')));
  const ctl = createRefreshController({ root, vaultApi, document: dom });
  ctl.setVaultPath('/v');
  const btn = findButton(root);
  const banner = findBanner(root);
  btn.dispatchEvent({ type: 'click' });
  await ctl.waitForIdle();
  assert.equal(banner.textContent, 'Import failed — see logs for details.');
  assert.equal(btn.disabled, false);
  // Sanitization belt-and-suspenders: the abs-path embedded in the rejection
  // message must NEVER leak into the banner text.
  assert.equal(banner.textContent.includes('/Users/'), false);

  // Controller is still alive — a subsequent setVaultPath + click cycle works.
  ctl.setVaultPath('/v2');
  assert.equal(btn.disabled, false, 'controller did not crash');
});
