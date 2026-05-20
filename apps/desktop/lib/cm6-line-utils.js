'use strict';

/* Stage 29 — shared line-range helper for hybrid-cm6 selection-driven
   features.

   Exports a single pure function `resolveTouchedLines(selection, doc)`
   that returns the sorted, deduplicated set of line numbers touched by
   any range in a CodeMirror EditorState selection. This helper was
   originally duplicated in apps/desktop/lib/cm6-active-range.js
   (Stage 26) and apps/desktop/lib/cm6-construct-reveal.js (Stage 28);
   Stage 29 consolidates the two copies here and the consumer modules
   become thin delegators that read `globalThis.Cm6LineUtils
   .resolveTouchedLines` at call time. Stop Condition S10 from the
   Stage 28 plan (manual drift check between the two duplicates) is
   retired by this consolidation plus the parity / delegation tests
   in cm6-line-utils.test.js.

   The UMD wrapper sets `root.Cm6LineUtils` in BOTH the CommonJS path
   (Node tests) AND the browser <script src> path so consumers can
   look up the helper from `globalThis.Cm6LineUtils` in either
   environment. This is the cross-environment shim test 29-15 verifies
   via a synthetic browser context (no module / exports / require).

   Public exports:
     resolveTouchedLines — pure function (selection, doc) -> number[].

   The peer-contract scanner reads this raw file. Production comments
   MUST NOT contain any forbidden literal substring — see the scan
   list in cm6-line-utils.test.js test 29-12 (same pattern as Stage
   26 / 27 / 28 invariants).
*/

(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
    // Also set on globalThis so consumer modules that read it via
    // globalThis.Cm6LineUtils work uniformly in Node + browser.
    if (typeof root !== 'undefined') root.Cm6LineUtils = exported;
  } else {
    root.Cm6LineUtils = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Pure: returns the sorted union of line numbers covered by every
  // range in `selection.ranges`. Each range contributes the closed
  // interval [doc.lineAt(range.from).number, doc.lineAt(range.to)
  // .number]. Collapsed caret (from === to) contributes one line.
  function resolveTouchedLines(selection, doc) {
    if (!selection || !doc) return [];
    const ranges = selection.ranges || [];
    if (ranges.length === 0) return [];
    const lineSet = new Set();
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!r) continue;
      const fromLine = doc.lineAt(r.from).number;
      const toLine = doc.lineAt(r.to).number;
      for (let n = fromLine; n <= toLine; n++) lineSet.add(n);
    }
    return Array.from(lineSet).sort(function (a, b) { return a - b; });
  }

  return {
    resolveTouchedLines: resolveTouchedLines,
  };
});
