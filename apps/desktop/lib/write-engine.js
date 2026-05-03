'use strict';

/* Write-mode editor engine resolver.

   Two engines exist in this codebase:
     - 'hybrid' — Stage 2 HybridWriteView (per-block textarea swap)
     - 'cm6'    — Stage 3 CodeMirror 6 production adapter (single document)

   Selection priority (highest first):
     1. URL query param  ?writeEngine=cm6
     2. localStorage     markdownVault.writeEngine = 'cm6'
     3. default          'hybrid'

   Invalid values at any layer are treated as absent and fall through to
   the next layer. Pure function; takes injected dependencies so it is
   testable without a browser. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WriteEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const STORAGE_KEY = 'markdownVault.writeEngine';
  const QUERY_KEY   = 'writeEngine';
  const DEFAULT     = 'hybrid';
  const VALID       = new Set(['hybrid', 'cm6']);

  function readQuery(search) {
    if (search == null) return null;
    const s = String(search);
    if (s.length === 0) return null;
    const stripped = s.charAt(0) === '?' ? s.slice(1) : s;
    if (stripped.length === 0) return null;
    const parts = stripped.split('&');
    for (let i = 0; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      const key = parts[i].slice(0, eq);
      if (key !== QUERY_KEY) continue;
      const raw = parts[i].slice(eq + 1);
      try {
        return decodeURIComponent(raw);
      } catch (_) {
        return raw;
      }
    }
    return null;
  }

  function readStorage(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      return storage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function normalize(value) {
    if (value == null) return null;
    if (value === '') return null;
    return VALID.has(value) ? value : null;
  }

  function resolveWriteEngine(opts) {
    const o = opts || {};
    const fromQuery = normalize(readQuery(o.search));
    if (fromQuery) return fromQuery;
    const fromStorage = normalize(readStorage(o.storage));
    if (fromStorage) return fromStorage;
    return DEFAULT;
  }

  return {
    resolveWriteEngine,
    STORAGE_KEY,
    QUERY_KEY,
    DEFAULT_ENGINE: DEFAULT,
  };
});
