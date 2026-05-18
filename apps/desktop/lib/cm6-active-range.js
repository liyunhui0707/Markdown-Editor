'use strict';

/* Stage 26 — selection-aware active-range line decoration.

   Renderer-side per-update decoration emitter that applies the line-level
   class `cm-md-active-range` to every line touched by any range in the
   current EditorState.selection. The Stage 11.4-14.7 visual-reveal CSS
   chain already reveals `.cm-md-syntax` markers off the line-level
   `.cm-activeLine` class; this module augments that mechanism with a
   parallel `.cm-md-active-range` class so the reveal extends to every
   line in a multi-line selection or multi-range (multi-cursor) selection,
   not just the single line CodeMirror's built-in highlightActiveLine
   marks.

   D1 — Augment, do not replace. `.cm-activeLine` continues to be set by
   CodeMirror's highlightActiveLine. This module ADDS a parallel class.
   The existing `.cm-activeLine .cm-md-syntax` rule is untouched; a sibling
   CSS rule `.cm-md-active-range .cm-md-syntax` (added in apps/desktop/
   index.html adjacent to the existing block) carries the same declarations.

   D4 — No view.composing short-circuit. This module installs no DOM
   event surface of any kind — it is pure decoration emission driven by
   selection-change / doc-change transactions. The compositionend tick
   re-fires the selection-change pathway, which recomputes decorations
   naturally. Pinning IME safety would be defensive but would add an
   unreachable branch.

   M1 — Sentinel contract for buildActiveRangeDecorations(state, cm6).
   Returns `null` when `cm6` is null, when `cm6.Decoration.line` is missing,
   or when `cm6.Decoration.set` is missing. Otherwise always returns
   `cm6.Decoration.set(ranges, true)` (an empty RangeSet is also a valid
   return when no lines are touched, but the resolver guarantees at least
   one touched line for any real selection).

   F1 — No plugin fallback. `createActiveRangeExtension(cm6)` guards the
   same surfaces the builder guards, so the builder cannot return `null`
   inside the plugin's constructor or update method. Assigning the builder
   result directly (without a `|| cm6.Decoration.set([], true)` fallback)
   is therefore safe.

   Public exports:
     resolveTouchedLines         — pure helper; (selection, doc) -> number[].
     buildActiveRangeDecorations — pure; (state, cm6) -> RangeSet|null.
     createActiveRangeExtension  — factory; (cm6) -> Extension|null.

   This module is loaded as a separate <script src> tag in
   apps/desktop/index.html between cm6-link-click.js and cm6-hybrid-view.js,
   and exposes itself globally as globalThis.Cm6ActiveRange. The walker's
   buildState() at apps/desktop/lib/cm6-hybrid-view.js inspects that hook
   and, when present, includes the returned extension in its extensions
   array. No bundle change. No cm6-entry.js change.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6ActiveRange = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── resolveTouchedLines(selection, doc) ───────────────────────────────
  // Pure. Iterates selection.ranges; for each range, resolves the line
  // number of range.from and range.to via doc.lineAt(pos).number, then
  // unions every line number in that closed interval into a set. Returns
  // the set as a sorted, ascending array.
  //
  // Inclusive of range.to even when range.to is at column 0 of the next
  // line — doc.lineAt(pos) semantics treat that position as belonging to
  // the next line (Stage 26 edge-case spec §9 case 6).
  function resolveTouchedLines(selection, doc) {
    if (!selection || !doc) return [];
    const ranges = selection.ranges || [];
    if (ranges.length === 0) return [];

    const lineSet = new Set();
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!r) continue;
      const fromLine = doc.lineAt(r.from).number;
      const toLine   = doc.lineAt(r.to).number;
      for (let n = fromLine; n <= toLine; n++) {
        lineSet.add(n);
      }
    }
    return Array.from(lineSet).sort(function (a, b) { return a - b; });
  }

  // ── buildActiveRangeDecorations(state, cm6) ───────────────────────────
  // Pure with cm6 injected (mirrors the buildHeadingDecorations(state, cm6)
  // precedent at apps/desktop/lib/cm6-hybrid-view.js:146).
  //
  // Returns:
  //   - null when cm6, cm6.Decoration.line, or cm6.Decoration.set is missing
  //     (the M1 sentinel contract — verifiable by 26-10b).
  //   - cm6.Decoration.set(ranges, true) otherwise — a sorted RangeSet of
  //     Decoration.line entries, one per touched line, each carrying the
  //     spec.class 'cm-md-active-range'.
  function buildActiveRangeDecorations(state, cm6) {
    if (!cm6 || !cm6.Decoration) return null;
    if (typeof cm6.Decoration.line !== 'function') return null;
    if (typeof cm6.Decoration.set !== 'function')  return null;
    if (!state || !state.doc || !state.selection)  return null;

    const lines = resolveTouchedLines(state.selection, state.doc);
    const ranges = lines.map(function (n) {
      return cm6.Decoration
        .line({ class: 'cm-md-active-range' })
        .range(state.doc.line(n).from);
    });
    return cm6.Decoration.set(ranges, true);
  }

  // ── createActiveRangeExtension(cm6) ────────────────────────────────────
  // Factory returning a CodeMirror ViewPlugin extension, or null when the
  // required cm6 surface is missing. F1 — no plugin-level fallback to
  // cm6.Decoration.set([], true); the create-time guards below ensure the
  // builder always returns a valid RangeSet inside the plugin.
  function createActiveRangeExtension(cm6) {
    if (!cm6 || !cm6.ViewPlugin) return null;
    if (typeof cm6.ViewPlugin.fromClass !== 'function') return null;
    if (!cm6.Decoration || typeof cm6.Decoration.line !== 'function') return null;
    if (typeof cm6.Decoration.set !== 'function') return null;

    return cm6.ViewPlugin.fromClass(class {
      constructor(view) {
        this.decorations = buildActiveRangeDecorations(view.state, cm6);
      }
      update(update) {
        if (update.selectionSet || update.docChanged) {
          this.decorations = buildActiveRangeDecorations(update.state, cm6);
        }
      }
    }, { decorations: function (v) { return v.decorations; } });
  }

  return {
    resolveTouchedLines:         resolveTouchedLines,
    buildActiveRangeDecorations: buildActiveRangeDecorations,
    createActiveRangeExtension:  createActiveRangeExtension,
  };
});
