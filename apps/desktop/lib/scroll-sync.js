'use strict';

/* Scroll-position sync helper for the Write↔Preview mode toggle.

   Two pure functions, intentionally framework-free:

   - captureScrollRatio(el): reads el.scrollTop / scrollHeight / clientHeight
     and returns a clamped [0, 1] ratio. Returns 0 for null/missing/short
     containers (no scroll position to capture).

   - applyScrollRatio(el, ratio): writes el.scrollTop based on the target's
     own scrollHeight/clientHeight so the ratio maps to the *target's*
     scrollable range, not the source's. No-ops on null/short containers.

   Both layers use only document-level scroll metrics: no cursor, selection,
   line, heading, AST, or paragraph awareness. Ratio-based by design so the
   two surfaces can have different heights and the user-visible position
   stays consistent. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ScrollSync = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function clamp01(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function maxScrollTop(el) {
    if (!el) return 0;
    const scrollHeight = Number(el.scrollHeight) || 0;
    const clientHeight = Number(el.clientHeight) || 0;
    const max = scrollHeight - clientHeight;
    return max > 0 ? max : 0;
  }

  function captureScrollRatio(el) {
    if (!el) return 0;
    const max = maxScrollTop(el);
    if (max <= 0) return 0;
    const scrollTop = Number(el.scrollTop) || 0;
    return clamp01(scrollTop / max);
  }

  function applyScrollRatio(el, ratio) {
    if (!el) return;
    const max = maxScrollTop(el);
    if (max <= 0) return; // short target: nothing to scroll
    el.scrollTop = clamp01(ratio) * max;
  }

  return {
    captureScrollRatio,
    applyScrollRatio,
  };
});
