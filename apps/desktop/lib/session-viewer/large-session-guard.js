// Stage S3.5 — guard against the CM6 / Toast UI perf cliff on multi-MB
// AI Session imports. Pure module: exposes a predicate
// `isLargeSession(note)` and a per-note hydration cache used by the
// renderer's deferred-load path. No DOM, no side effects.
//
// CJS-loadable + window-attached inside an IIFE so the const/function
// declarations don't collide with other browser-script globals
// (matches the IIFE pattern from S3's read-* modules).

'use strict';

(function () {

// Char count threshold (UTF-16 code units, matching String.length).
// The CM6 hybrid-cm6 decoration walk + Toast UI ProseMirror
// StepResult allocation chain scale with character count, not encoded
// bytes; a multi-byte body of the same encoded size has fewer chars
// and proportionally fewer per-line decoration costs.
const LARGE_SESSION_CHARS = 500 * 1024;

function isLargeSession(note) {
  if (!note || typeof note !== 'object') return false;
  if (note.sessionsImport !== true) return false;
  if (typeof note.body !== 'string') return false;
  return note.body.length >= LARGE_SESSION_CHARS;
}

// Per-note + per-surface hydration cache. Surfaces are `'cm6'` (the
// CodeMirror Write surface, which mirrors into Toast UI on setText)
// and `'toast'` (the Toast UI Preview surface, set independently via
// setMarkdown). The cache is created fresh per renderer boot and
// dropped per note when the user switches away.
function createHydrationCache() {
  const state = new Map();

  function entry(noteId) {
    let e = state.get(noteId);
    if (!e) {
      e = { cm6: false, toast: false };
      state.set(noteId, e);
    }
    return e;
  }

  return {
    isHydrated(noteId, surface) {
      const e = state.get(noteId);
      return !!(e && e[surface]);
    },
    markHydrated(noteId, surface) {
      entry(noteId)[surface] = true;
    },
    drop(noteId) {
      state.delete(noteId);
    },
    clear() {
      state.clear();
    },
  };
}

const api = {
  LARGE_SESSION_CHARS,
  isLargeSession,
  createHydrationCache,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.SessionViewer = Object.assign(window.SessionViewer || {}, api);
}

})();
