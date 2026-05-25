// Stage S2 — Refresh button controller for the AI Sessions filter.
// Renderer-side module loaded via <script>. Also CJS-loadable so the
// Node test harness can require() it without a bundler.
//
// Usage (renderer, after the script tag in index.html):
//   const ctl = window.SessionViewer.createRefreshController({
//     root: document.getElementById('sessionsRefreshMount'),
//     vaultApi: window.vaultApi,
//     onComplete: () => reloadVault(),
//   });
//   // Whenever the active vault changes:
//   ctl.setVaultPath(currentVaultPath);
//
// The controller owns:
//   - a <button> labeled "Refresh"
//   - a <div data-role="banner"> status line below the button
//   - a single-flight inFlight flag
//   - a captured vault path that the click handler reads at call time
//
// Contract:
//   - Button is disabled whenever vaultPath is falsy OR inFlight is true.
//   - Click invokes vaultApi.refreshSessions(capturedVaultPath).
//   - On {ok: true, claude, codex}: banner reports counts, onComplete()
//     fires once. On {ok: false, error}: banner shows error,
//     onComplete is NOT called. In both cases the lock releases.
//   - waitForIdle() resolves when the current in-flight import settles
//     (test-only convenience; production code uses onComplete).

'use strict';

function createRefreshController(opts) {
  const root = opts && opts.root;
  const vaultApi = opts && opts.vaultApi;
  const onComplete = (opts && opts.onComplete) || null;
  const doc =
    (opts && opts.document) ||
    (typeof document !== 'undefined' ? document : null);
  if (!root || !vaultApi || !doc) {
    throw new Error('refresh-button: root, vaultApi, document are required');
  }

  const button = doc.createElement('button');
  button.textContent = 'Refresh';
  button.disabled = true;
  root.appendChild(button);

  const banner = doc.createElement('div');
  if (banner.dataset) {
    banner.dataset.role = 'banner';
  } else if (typeof banner.setAttribute === 'function') {
    banner.setAttribute('data-role', 'banner');
  }
  banner.textContent = '';
  root.appendChild(banner);

  let vaultPath = '';
  let inFlight = false;
  let pending = null;

  function applyDisabled() {
    button.disabled = !vaultPath || inFlight;
  }

  function setVaultPath(p) {
    vaultPath = typeof p === 'string' ? p : '';
    applyDisabled();
  }

  async function handleClick() {
    if (!vaultPath || inFlight) return;
    inFlight = true;
    applyDisabled();
    banner.textContent = 'Importing…';
    let result;
    try {
      result = await vaultApi.refreshSessions(vaultPath);
    } catch (err) {
      result = { ok: false, error: (err && err.message) || String(err) };
    }
    if (result && result.ok) {
      // Stage 6.3D: hide the success summary banner. The user gets
      // implicit feedback via the grouped tree updating + the Read
      // view refreshing for the open session. Errors still surface
      // below so silent failures can't slip through.
      banner.textContent = '';
      if (typeof onComplete === 'function') {
        try {
          onComplete(result);
        } catch {
          // Swallow callback errors so the controller never crashes the
          // renderer; production code should not throw from onComplete.
        }
      }
    } else {
      const msg = (result && result.error) || 'Import failed';
      banner.textContent = msg;
    }
    inFlight = false;
    applyDisabled();
    if (pending) {
      const p = pending;
      pending = null;
      p.resolve();
    }
  }

  button.addEventListener('click', () => {
    handleClick();
  });

  function waitForIdle() {
    if (!inFlight) return Promise.resolve();
    if (!pending) {
      pending = {};
      pending.promise = new Promise((resolve) => {
        pending.resolve = resolve;
      });
    }
    return pending.promise;
  }

  return { setVaultPath, waitForIdle };
}

const api = { createRefreshController };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.SessionViewer = Object.assign(window.SessionViewer || {}, api);
}
