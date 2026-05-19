'use strict';

/* Stage 28 — multi-line construct expansion.

   When the active range (the set of lines touched by any selection
   range; same computation as Stage 26's cm-md-active-range) touches
   any line inside a multi-line Markdown construct, this module emits
   a line-level `cm-md-construct-active` decoration on EVERY line of
   that construct. CSS in apps/desktop/index.html then reveals fenced-
   code delimiters, the fenced-code language info string, and (via a
   third reveal path) blockquote `>` markers on every line of the
   active construct — not just the line the caret/selection actually
   touches.

   Scope: FencedCode + Blockquote only (initial Stage 28 scope).
   Defer: list-item continuation, tables, Setext cross-line reveal.

   D1 — lifts Stage 11.9 / Stage 27 D2 exemption for fenced-code
   markers (the new CSS hides them off-construct-active and reveals
   them on-construct-active). Stage 27's per-line blockquote reveal
   stays; this module ADDS a construct-level reveal path.

   D4 — no view.composing short-circuit and no DOM event surface of
   any kind. The plugin recomputes on selectionSet / docChanged /
   viewportChanged transactions. Composition-end re-fires selection
   change naturally; viewport-driven parse advance is covered by the
   viewportChanged branch (per Codex rev-2 finding F4).

   D5 — resolveTouchedLines is an INTENTIONAL local duplicate of the
   helper at apps/desktop/lib/cm6-active-range.js. Two helpers MUST
   stay logically identical. Stop Condition S10 in the plan flags
   drift; a future stage may extract to a shared module.

   D8 — defensive frontmatter guard. A local frontmatterEnd(doc)
   helper mirrors the walker's detectFrontmatter at
   apps/desktop/lib/cm6-hybrid-view.js. Any construct whose
   node.from falls inside the strict frontmatter region is skipped
   (the walker already suppresses decorations inside frontmatter;
   this is belt-and-suspenders for the construct-reveal plugin).

   Public exports:
     resolveTouchedLines               — pure helper (mirror of Stage 26).
     findActiveConstructs              — pure; (tree, doc, touched) → [].
     buildConstructActiveDecorations   — pure; (state, cm6, tree) → RangeSet|null.
     createConstructRevealExtension    — factory; (cm6) → Extension|null.

   The peer-contract scanner reads this raw file. Production comments
   MUST NOT contain any forbidden literal substring — see the scan
   list in cm6-construct-reveal-invariants.test.js test 28-16.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6ConstructReveal = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── resolveTouchedLines(selection, doc) ─────────────────────────────
  // D5 — local duplicate of cm6-active-range.js. KEEP IDENTICAL.
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
      for (let n = fromLine; n <= toLine; n++) lineSet.add(n);
    }
    return Array.from(lineSet).sort(function (a, b) { return a - b; });
  }

  // ── frontmatterEnd(doc) — D8 defensive guard ─────────────────────────
  // Mirrors the walker's detectFrontmatter. Returns the exclusive end
  // position of the strict '---'...'---' region, or 0 if absent / no
  // closing fence. Strict matching: first line must be EXACTLY '---'
  // (no trailing whitespace, no other content); closing line must also
  // be EXACTLY '---'.
  function frontmatterEnd(doc) {
    if (!doc || doc.length === 0) return 0;
    if (typeof doc.lineAt !== 'function') return 0;
    const firstLine = doc.lineAt(0);
    if (!firstLine || firstLine.text !== '---') return 0;
    let pos = firstLine.to + 1;
    while (pos < doc.length) {
      const line = doc.lineAt(pos);
      if (line.text === '---') return line.to;
      pos = line.to + 1;
    }
    return 0;
  }

  // ── findActiveConstructs(syntaxTree, doc, touchedLineSet) ────────────
  // Walks the syntax tree for FencedCode and Blockquote nodes; returns
  // those that intersect touchedLineSet AND lie outside the frontmatter
  // region.
  //
  // F3 — endPos is Math.max(node.from, node.to - 1) because Lezer node
  // ranges are half-open: doc.lineAt(node.to).number would resolve to
  // the line AFTER the construct when the node ends at a line boundary.
  function findActiveConstructs(syntaxTree, doc, touchedLineSet) {
    if (!syntaxTree || !doc || !touchedLineSet) return [];
    if (typeof syntaxTree.iterate !== 'function') return [];
    if (touchedLineSet.size === 0) return [];

    const fmEnd = frontmatterEnd(doc);
    const TARGET_TYPES = { FencedCode: true, Blockquote: true };
    const constructs = [];

    syntaxTree.iterate({
      enter: function (node) {
        const name = node.name || (node.type && node.type.name);
        if (!TARGET_TYPES[name]) return;
        // D8 — skip constructs that begin inside frontmatter.
        if (node.from < fmEnd) return;
        const fromLine = doc.lineAt(node.from).number;
        const endPos = Math.max(node.from, node.to - 1);
        const toLine = doc.lineAt(endPos).number;
        // Intersect with the touched set.
        let touched = false;
        for (let n = fromLine; n <= toLine; n++) {
          if (touchedLineSet.has(n)) { touched = true; break; }
        }
        if (touched) {
          constructs.push({
            fromLine: fromLine,
            toLine:   toLine,
            type:     name,
            fromPos:  node.from,
            toPos:    node.to,
          });
        }
      },
    });
    return constructs;
  }

  // ── buildConstructActiveDecorations(state, cm6, syntaxTree) ──────────
  // Pure with cm6 + tree injected. Returns:
  //   - null when cm6 / Decoration.line / Decoration.set is missing
  //     (M1 sentinel pattern from Stage 26 / 28).
  //   - cm6.Decoration.set([], true) when there are no active constructs.
  //   - cm6.Decoration.set(ranges, true) — one Decoration.line entry per
  //     line of every active construct; lines deduplicated across
  //     overlapping constructs (e.g., fenced code inside a blockquote).
  function buildConstructActiveDecorations(state, cm6, syntaxTree) {
    if (!cm6 || !cm6.Decoration) return null;
    if (typeof cm6.Decoration.line !== 'function') return null;
    if (typeof cm6.Decoration.set !== 'function')  return null;
    if (!state || !state.doc || !state.selection)  return null;

    const lines = resolveTouchedLines(state.selection, state.doc);
    if (lines.length === 0) return cm6.Decoration.set([], true);
    const touchedSet = new Set(lines);

    const tree =
      syntaxTree ||
      (cm6.syntaxTree && cm6.syntaxTree(state)) ||
      null;
    if (!tree) return cm6.Decoration.set([], true);

    const constructs = findActiveConstructs(tree, state.doc, touchedSet);
    if (constructs.length === 0) return cm6.Decoration.set([], true);

    // Dedup line numbers across overlapping constructs.
    const allLineSet = new Set();
    for (let i = 0; i < constructs.length; i++) {
      const c = constructs[i];
      for (let n = c.fromLine; n <= c.toLine; n++) allLineSet.add(n);
    }
    const sortedLines = Array.from(allLineSet).sort(function (a, b) { return a - b; });
    const ranges = sortedLines.map(function (n) {
      return cm6.Decoration
        .line({ class: 'cm-md-construct-active' })
        .range(state.doc.line(n).from);
    });
    return cm6.Decoration.set(ranges, true);
  }

  // ── createConstructRevealExtension(cm6) ──────────────────────────────
  // Factory returning a CodeMirror ViewPlugin extension, or null when
  // the required cm6 surface is missing. F4 — recompute on
  // selectionSet OR docChanged OR viewportChanged (the viewport branch
  // covers parse-advance behind a scroll without explicit doc/selection
  // change).
  function createConstructRevealExtension(cm6) {
    if (!cm6 || !cm6.ViewPlugin) return null;
    if (typeof cm6.ViewPlugin.fromClass !== 'function') return null;
    if (!cm6.Decoration || typeof cm6.Decoration.line !== 'function') return null;
    if (typeof cm6.Decoration.set !== 'function') return null;

    return cm6.ViewPlugin.fromClass(class {
      constructor(view) {
        const tree = cm6.syntaxTree ? cm6.syntaxTree(view.state) : null;
        this.decorations = buildConstructActiveDecorations(view.state, cm6, tree);
      }
      update(update) {
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
          const tree = cm6.syntaxTree ? cm6.syntaxTree(update.state) : null;
          this.decorations = buildConstructActiveDecorations(update.state, cm6, tree);
        }
      }
    }, { decorations: function (v) { return v.decorations; } });
  }

  return {
    resolveTouchedLines:              resolveTouchedLines,
    findActiveConstructs:             findActiveConstructs,
    buildConstructActiveDecorations:  buildConstructActiveDecorations,
    createConstructRevealExtension:   createConstructRevealExtension,
  };
});
