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

   Scope: FencedCode + Blockquote (Stage 28) + SetextHeading1 +
   SetextHeading2 (Stage 29 — Setext lines additionally carry the
   cm-md-setext-active class so the Setext-scoped heading-mark CSS
   reveal does not leak to ATX `#` marks nested inside blockquotes) +
   ListItem (Stage 30 — list-item lines carry ONLY cm-md-list-item-
   active, NOT the generic cm-md-construct-active, so the Stage 28
   quote/fence reveal selectors do not leak onto nested constructs
   inside an active list item) + Table (Stage 32 — table lines carry
   ONLY cm-md-table-active, NOT the generic cm-md-construct-active,
   following the Stage 30 leakage-prevention precedent. Reveals the
   walker-emitted cm-md-table-pipe / cm-md-table-delimiter-row classes
   added by Stage 31).
   Defer: list continuation paragraphs nested inside other constructs.

   D1 — lifts Stage 11.9 / Stage 27 D2 exemption for fenced-code
   markers (the new CSS hides them off-construct-active and reveals
   them on-construct-active). Stage 27's per-line blockquote reveal
   stays; this module ADDS a construct-level reveal path.

   D4 — no view.composing short-circuit and no DOM event surface of
   any kind. The plugin recomputes on selectionSet / docChanged /
   viewportChanged transactions. Composition-end re-fires selection
   change naturally; viewport-driven parse advance is covered by the
   viewportChanged branch (per Codex rev-2 finding F4).

   D5 — resolveTouchedLines was extracted to a shared UMD module
   apps/desktop/lib/cm6-line-utils.js in Stage 29 (precedent: the
   Stage 28 amendment to Stage 27's test 27-5 — internal-only
   refactor of a frozen file). This file's resolveTouchedLines is
   now a THIN DELEGATOR that reads globalThis.Cm6LineUtils.resolve-
   TouchedLines at call time. The same delegator pattern lives in
   apps/desktop/lib/cm6-active-range.js. Drift between two
   in-tree copies is therefore no longer possible; Stop Condition
   S10 from the Stage 28 plan is retired by tests 29-8 + 29-9 + 29-10.

   D8 — defensive frontmatter guard. A local frontmatterEnd(doc)
   helper mirrors the walker's detectFrontmatter at
   apps/desktop/lib/cm6-hybrid-view.js. Any construct whose
   node.from falls inside the strict frontmatter region is skipped
   (the walker already suppresses decorations inside frontmatter;
   this is belt-and-suspenders for the construct-reveal plugin).

   Public exports:
     resolveTouchedLines               — thin delegator to cm6-line-utils.js (Stage 29 D5).
     findActiveConstructs              — pure; (tree, doc, touched) → [].
     buildConstructActiveDecorations   — pure; (state, cm6, tree) → RangeSet|null.
     createConstructRevealExtension    — factory; (cm6) → Extension|null.

   The peer-contract scanner reads this raw file. Production comments
   MUST NOT contain any forbidden literal substring — see the scan
   list in cm6-construct-reveal-invariants.test.js test 28-16.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Stage 29 — ensure the shared line-utils helper is loaded for
    // the CommonJS path (Node tests). Browser path relies on the
    // script-tag ordering invariant pinned by test 29-11.
    require('./cm6-line-utils.js');
    module.exports = factory();
  } else {
    root.Cm6ConstructReveal = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── resolveTouchedLines(selection, doc) ─────────────────────────────
  // Stage 29 delegation refactor — the line-set logic moved to
  // apps/desktop/lib/cm6-line-utils.js to retire Stop Condition S10
  // (manual drift check between this file and cm6-active-range.js).
  // Reads globalThis.Cm6LineUtils at call time; throws explicitly if
  // the shared module isn't loaded. Test 29-9 pins this delegation.
  function resolveTouchedLines(selection, doc) {
    return globalThis.Cm6LineUtils.resolveTouchedLines(selection, doc);
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
  // Walks the syntax tree for the construct types in TARGET_TYPES below
  // — currently FencedCode, Blockquote, SetextHeading1, SetextHeading2,
  // and ListItem — and returns those that intersect touchedLineSet AND
  // lie outside the frontmatter region.
  //
  // F3 — endPos is Math.max(node.from, node.to - 1) because Lezer node
  // ranges are half-open: doc.lineAt(node.to).number would resolve to
  // the line AFTER the construct when the node ends at a line boundary.
  function findActiveConstructs(syntaxTree, doc, touchedLineSet) {
    if (!syntaxTree || !doc || !touchedLineSet) return [];
    if (typeof syntaxTree.iterate !== 'function') return [];
    if (touchedLineSet.size === 0) return [];

    const fmEnd = frontmatterEnd(doc);
    // Stage 29 — SetextHeading1 / SetextHeading2 added so the construct
    // expansion covers Setext title + ===/--- underline lines together
    // (touching either reveals both via cm-md-construct-active CSS).
    // Stage 30 — ListItem added so a caret on a continuation line keeps
    // the first-line ListMark visible. ListItem lines are emitted with
    // the SCOPED cm-md-list-item-active class only (NOT the generic
    // cm-md-construct-active) to prevent cross-construct leakage; see
    // the per-line emit block below for the dedup logic.
    // Stage 32 — Table added so a caret anywhere in the table reveals
    // all cm-md-table-pipe + cm-md-table-delimiter-row marks across the
    // whole construct. Table lines, like ListItem lines, are emitted
    // with ONLY the SCOPED cm-md-table-active class (NOT the generic
    // cm-md-construct-active) to prevent cross-construct leakage in the
    // other direction (e.g., a Table nested inside a Blockquote must
    // not let Stage 28's .cm-md-construct-active .cm-md-quote-mark
    // selector fire on the table's interior).
    const TARGET_TYPES = {
      FencedCode:     true,
      Blockquote:     true,
      SetextHeading1: true,
      SetextHeading2: true,
      ListItem:       true,
      Table:          true,
    };
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

    // Dedup line numbers across overlapping constructs. Three line sets:
    //   - constructActiveLineSet — lines that get cm-md-construct-active
    //     (Stage 28 contract: every touched FencedCode / Blockquote /
    //     Setext line). Stage 30: ListItem-only lines do NOT join this
    //     set, because emitting the generic class on ListItem lines
    //     would let Stage 28's `.cm-md-construct-active .cm-md-quote-
    //     mark` / `.cm-md-fenced-code-mark` reveal selectors fire on
    //     nested constructs that are not themselves active (e.g., a
    //     Blockquote nested inside an active ListItem).
    //   - setextLineSet — lines that ALSO get cm-md-setext-active
    //     (Stage 29 rev-4: scopes the heading-mark reveal CSS to Setext
    //     lines only).
    //   - listItemLineSet — lines that get cm-md-list-item-active
    //     (Stage 30: scopes the new ListMark reveal CSS to list-item
    //     lines only).
    //   - tableLineSet — lines that get cm-md-table-active (Stage 32:
    //     scopes the table-pipe / delimiter-row reveal CSS to table
    //     lines only, matching the Stage 30 ListItem pattern).
    const allLineSet = new Set();
    const constructActiveLineSet = new Set();
    const setextLineSet = new Set();
    const listItemLineSet = new Set();
    const tableLineSet = new Set();
    for (let i = 0; i < constructs.length; i++) {
      const c = constructs[i];
      const isSetext   = c.type === 'SetextHeading1' || c.type === 'SetextHeading2';
      const isListItem = c.type === 'ListItem';
      const isTable    = c.type === 'Table';
      for (let n = c.fromLine; n <= c.toLine; n++) {
        allLineSet.add(n);
        // Stage 30 + 32 leakage-prevention guard: ListItem-only and
        // Table-only lines do NOT carry the generic class so Stage 28's
        // quote/fence reveal selectors stay confined to their own
        // constructs.
        if (!isListItem && !isTable) constructActiveLineSet.add(n);
        if (isSetext)   setextLineSet.add(n);
        if (isListItem) listItemLineSet.add(n);
        if (isTable)    tableLineSet.add(n);
      }
    }
    const sortedLines = Array.from(allLineSet).sort(function (a, b) { return a - b; });
    const ranges = sortedLines.map(function (n) {
      const tokens = [];
      if (constructActiveLineSet.has(n)) tokens.push('cm-md-construct-active');
      if (setextLineSet.has(n))          tokens.push('cm-md-setext-active');
      if (listItemLineSet.has(n))        tokens.push('cm-md-list-item-active');
      if (tableLineSet.has(n))           tokens.push('cm-md-table-active');
      return cm6.Decoration
        .line({ class: tokens.join(' ') })
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
