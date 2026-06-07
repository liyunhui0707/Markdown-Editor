'use strict';

/* Stage D — hybrid-cm6-lp engine: block-marker decoration plugin.

   This module extends the lp engine's Decoration.replace + atomicRanges
   pattern from inline markers (Stages A + B) to three block-level marker
   node types:

     - HeaderMark (ATX heading prefix `#` … `######` and optional trailing `#`).
       Parent guard: only replace when parent is ATXHeading1..6, NOT
       SetextHeading1/2 (the Setext underline `===`/`---` is parsed as
       a HeaderMark child of SetextHeadingN; Stage 29 handles reveal).
     - ListMark (`-`, `*`, `+`, `1.`, `1)`). No parent guard needed
       (ListMark appears only inside ListItem per the parser). Sibling
       TaskMarker is NOT affected — we only touch ListMark ranges.
     - QuoteMark (`>`). No parent guard needed (QuoteMark appears only
       inside Blockquote or its spanning Paragraph). Each line's
       QuoteMark gets its own per-line active-line determination so
       multi-line blockquote reveals only the touched line's `>`.

   Off-active-line behavior: emit Decoration.replace with an empty widget
   AND register the replaced range with EditorView.atomicRanges so
   arrow-key cursor motion steps over the hidden marker as one unit.
   On-active-line: emit NOTHING; the hybrid walker's existing
   Decoration.mark with class `cm-md-heading-mark` / `cm-md-list-mark` /
   `cm-md-quote-mark` + the existing CSS rules
   (`.cm-activeLine .cm-md-heading-mark { display: inline }`, etc.)
   handle the dimmed-reveal exactly as in hybrid-cm6.

   Excluded by design (Stage D non-goals):
     - HorizontalRule (`---`/`***`/`___` on a blank line). Currently
       displayed as dimmed text by .cm-md-hr; replacing with an empty
       widget would leave a completely blank line. Defer to a focused
       widget stage that renders an actual <hr>.
     - SetextHeading1/2's HeaderMark (the underline) — covered by the
       ATX-only parent guard.
     - TaskMarker (`[ ]`, `[x]`) — Stage 23 toggle behavior. ListMark
       siblings of TaskMarker are still replaced; only TaskMarker itself
       is exempt.
     - Fenced code fence delimiters — Stage 28 reveal. These are
       CodeMark with parent FencedCode and ARE NOT HeaderMark/ListMark/
       QuoteMark, so they're naturally excluded.

   Reuses the EmptyMarkerWidget instance from cm6-lp-inline.js via the
   public _getEmptyMarkerWidget export, so all hidden markers in the lp
   engine share one widget instance.

   The CommonJS path requires ./cm6-line-utils.js and ./cm6-lp-inline.js
   so Node tests don't depend on global script-load order (same pattern
   as cm6-active-range.js / cm6-construct-reveal.js Stage 29 D5).

   Public exports:
     buildLpBlockDecorations  — pure (state, cm6) → {all, replaced}|null.
     createLpBlockExtension   — factory; (cm6) → Extension|null. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // cm6-line-utils.js sets globalThis.Cm6LineUtils on its CJS path; bridging
    // is automatic. cm6-lp-inline.js's CJS path sets only module.exports, so
    // bridge it onto globalThis here for the shared EmptyMarkerWidget lookup
    // (same pattern cm6-lp-view.js uses at lines 41-46).
    require('./cm6-line-utils.js');
    const lpInline = require('./cm6-lp-inline.js');
    if (typeof globalThis !== 'undefined' && !globalThis.Cm6LpInline) {
      globalThis.Cm6LpInline = lpInline;
    }
    // Stage G.3 — Stage E/F/G.1/G.2 block widgets moved to the new
    // cm6-lp-block-widgets.js StateField module (block:true Decoration.
    // replace from a ViewPlugin throws at runtime). lp-block.js retains
    // ONLY Stage D's line-internal HeaderMark/ListMark/QuoteMark
    // replaces, which are inline decorations and remain ViewPlugin-safe.
    module.exports = factory();
  } else {
    root.Cm6LpBlock = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── ATX parent-name predicate ──────────────────────────────────────────
  // Returns true when the HeaderMark's parent is an ATX heading
  // (ATXHeading1..ATXHeading6). False for SetextHeading1/2 (whose
  // HeaderMark child is the `===` or `---` underline — Stage 29 handles
  // that reveal). The parser's node names are documented at
  // @lezer/markdown / commonMark spec.
  function isAtxHeaderMark(headerMarkNode) {
    if (!headerMarkNode) return false;
    const parent = headerMarkNode.parent;
    if (!parent) return false;
    const name = parent.name;
    return name === 'ATXHeading1' || name === 'ATXHeading2' ||
           name === 'ATXHeading3' || name === 'ATXHeading4' ||
           name === 'ATXHeading5' || name === 'ATXHeading6';
  }

  // ── frontmatterEnd(doc) — defensive guard ──────────────────────────────
  // Same shape as cm6-lp-inline.js's frontmatterEnd. Returns the exclusive
  // end position of the strict '---'…'---' region, or 0 if absent. Used to
  // skip block markers inside YAML frontmatter (Stage 14.9 parity).
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

  // ── buildLpBlockDecorations(state, cm6) ────────────────────────────────
  // Returns { all: RangeSet, replaced: RangeSet } | null.
  // Same shape as cm6-lp-inline.js's buildLpInlineDecorations.
  function buildLpBlockDecorations(state, cm6) {
    if (!cm6 || !cm6.Decoration) return null;
    if (typeof cm6.Decoration.set !== 'function') return null;
    const empty = cm6.Decoration.set([], true);
    if (!state || !state.doc || !state.selection) {
      return { all: empty, replaced: empty };
    }

    const lineUtils = (typeof globalThis !== 'undefined') ? globalThis.Cm6LineUtils : null;
    if (!lineUtils || typeof lineUtils.resolveTouchedLines !== 'function') {
      return { all: empty, replaced: empty };
    }
    const touchedLines = lineUtils.resolveTouchedLines(state.selection, state.doc);
    const touchedSet = new Set(touchedLines);

    if (typeof cm6.syntaxTree !== 'function') {
      return { all: empty, replaced: empty };
    }
    const tree = cm6.syntaxTree(state);
    if (!tree || typeof tree.iterate !== 'function') {
      return { all: empty, replaced: empty };
    }

    const fmEnd = frontmatterEnd(state.doc);

    if (typeof cm6.Decoration.replace !== 'function') {
      return { all: empty, replaced: empty };
    }

    // Shared empty-widget instance. Borrow from cm6-lp-inline.js so all
    // hidden markers in the lp engine share one widget instance (consistent
    // memory profile, single WidgetType subclass).
    const lpInline = (typeof globalThis !== 'undefined') ? globalThis.Cm6LpInline : null;
    if (!lpInline || typeof lpInline._getEmptyMarkerWidget !== 'function') {
      return { all: empty, replaced: empty };
    }
    const widget = lpInline._getEmptyMarkerWidget(cm6);
    if (!widget) {
      return { all: empty, replaced: empty };
    }

    function shouldReplace(node) {
      if (node.from < fmEnd) return false;
      const lineNumber = state.doc.lineAt(node.from).number;
      return !touchedSet.has(lineNumber);
    }

    // Stage G.3 — block widgets (Stage E table, Stage F display math,
    // Stage G.1+G.2 fenced code) moved to cm6-lp-block-widgets.js
    // StateField. Only the line-internal Stage D markers remain in
    // this ViewPlugin.

    const replacedRanges = [];
    tree.iterate({
      enter(node) {
        // Stage D — ATX HeaderMark (`#` … `######` and optional trailing `#`).
        // Parent guard excludes SetextHeading1/2 underlines.
        if (node.name === 'HeaderMark') {
          if (!isAtxHeaderMark(node.node)) return;
          if (!shouldReplace(node)) return;
          replacedRanges.push(
            cm6.Decoration.replace({ widget: widget, inclusive: false })
              .range(node.from, node.to)
          );
          return;
        }
        // Stage D — ListMark (`-`, `*`, `+`, `1.`, `1)`). Sibling TaskMarker
        // is a separate Lezer node and is not affected. ListMark appears
        // only inside ListItem per the parser.
        if (node.name === 'ListMark') {
          if (!shouldReplace(node)) return;
          replacedRanges.push(
            cm6.Decoration.replace({ widget: widget, inclusive: false })
              .range(node.from, node.to)
          );
          return;
        }
        // Stage D — QuoteMark (`>`). Multi-line blockquote: each line's
        // QuoteMark is its own node, so the per-line shouldReplace check
        // already gives correct per-line active-line resolution.
        if (node.name === 'QuoteMark') {
          if (!shouldReplace(node)) return;
          replacedRanges.push(
            cm6.Decoration.replace({ widget: widget, inclusive: false })
              .range(node.from, node.to)
          );
          return;
        }
      },
    });

    if (replacedRanges.length === 0) {
      return { all: empty, replaced: empty };
    }
    // Tree iteration is in-order so the ranges array is naturally sorted.
    const set = cm6.Decoration.set(replacedRanges, true);
    return { all: set, replaced: set };
  }

  // ── createLpBlockExtension(cm6) ────────────────────────────────────────
  // Factory returning a CodeMirror ViewPlugin extension, or null when any
  // required cm6 surface is missing. Same shape as createLpInlineExtension.
  function createLpBlockExtension(cm6) {
    if (!cm6 || !cm6.ViewPlugin) return null;
    if (typeof cm6.ViewPlugin.fromClass !== 'function') return null;
    if (!cm6.Decoration) return null;
    if (typeof cm6.Decoration.replace !== 'function') return null;
    if (typeof cm6.Decoration.set !== 'function') return null;
    if (!cm6.Decoration.none) return null;
    if (!cm6.WidgetType) return null;
    if (!cm6.EditorView || !cm6.EditorView.atomicRanges) return null;
    if (typeof cm6.EditorView.atomicRanges.of !== 'function') return null;

    return cm6.ViewPlugin.fromClass(class {
      constructor(view) {
        const built = buildLpBlockDecorations(view.state, cm6);
        this.decorations    = built ? built.all      : cm6.Decoration.none;
        this.replacedRanges = built ? built.replaced : cm6.Decoration.none;
      }
      update(update) {
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
          const built = buildLpBlockDecorations(update.state, cm6);
          this.decorations    = built ? built.all      : cm6.Decoration.none;
          this.replacedRanges = built ? built.replaced : cm6.Decoration.none;
        }
      }
    }, {
      decorations: v => v.decorations,
      provide: plugin => cm6.EditorView.atomicRanges.of(
        view => (view.plugin(plugin) && view.plugin(plugin).replacedRanges) || cm6.Decoration.none
      ),
    });
  }

  return {
    buildLpBlockDecorations: buildLpBlockDecorations,
    createLpBlockExtension:  createLpBlockExtension,
    _isAtxHeaderMark:        isAtxHeaderMark,
    _frontmatterEnd:         frontmatterEnd,
  };
});
