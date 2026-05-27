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
//   - On {ok: true, claude, codex}: banner is cleared (Stage 6.3D),
//     onComplete() fires once.
//   - On {ok: false, reason}: banner shows the user-facing string mapped
//     from REASON_TO_BANNER below (or DEFAULT_BANNER for an unknown
//     reason); onComplete is NOT called. The enum is defined by the IPC
//     handler — see apps/desktop/lib/session-import-ipc.js.
//   - In both cases the lock releases.
//   - waitForIdle() resolves when the current in-flight import settles
//     (test-only convenience; production code uses onComplete).

'use strict';

// Retrofit #1 — reason → banner mapping. Enum is owned by
// apps/desktop/lib/session-import-ipc.js; this is the renderer-side
// localization layer. Unknown reasons fall back to DEFAULT_BANNER so a
// future enum addition can't blank the banner.
const REASON_TO_BANNER = Object.freeze({
  'in-progress':          'Import already in progress.',
  'platform-unsupported': "This platform doesn't support symlink-safe imports.",
  'no-vault':             'No vault selected.',
  'import-error':         'Import failed — see logs for details.',
});
const DEFAULT_BANNER = 'Import failed.';

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
      // Bridge-level failure (e.g. preload not reachable). Funnel into the
      // same typed shape as IPC failures — err.message is intentionally
      // dropped here too so abs-paths can't leak. Uses 'import-error'
      // because this is structurally an importer-side failure from the
      // renderer's POV; the banner-mapping table renders the generic
      // "Import failed — see logs for details." string.
      void err;
      result = { ok: false, reason: 'import-error' };
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
      const reason = result && result.reason;
      banner.textContent = REASON_TO_BANNER[reason] || DEFAULT_BANNER;
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
