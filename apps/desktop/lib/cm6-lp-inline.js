'use strict';

/* Stage A — hybrid-cm6-lp engine: emphasis-marker decoration plugin.

   This module owns the lp engine's only behavioral difference from
   hybrid-cm6: emphasis-marker (`*`, `_`, `**`, `__`) rendering.

     - Off-active-line: emit Decoration.replace with an empty widget AND
       register the replaced range with EditorView.atomicRanges so
       arrow-key cursor motion steps over the hidden marker as one unit.
       The hybrid walker's existing Decoration.mark with class
       'cm-md-syntax cm-md-emphasis-mark' still applies to the same range
       but is visually a no-op because the characters are replaced.
     - On-active-line: emit NOTHING from this plugin. The hybrid walker's
       existing Decoration.mark + the existing CSS rules
       (.cm-activeLine .cm-md-syntax, .cm-md-active-range .cm-md-syntax)
       handle the dimmed-reveal exactly as in hybrid-cm6.

   Active-line definition: identical to Stage 26's cm-md-active-range —
   every line touched by any selection range or cursor. Reuses
   globalThis.Cm6LineUtils.resolveTouchedLines for parity with the
   existing reveal mechanism.

   Stage A WAVE 2 skeleton: surface guards + UMD wrapper + factory wiring
   are in place. WAVE 4 fills in the real buildLpInlineDecorations
   body (currently a stub that returns empty RangeSets).

   The CommonJS path requires ./cm6-line-utils.js so Node tests don't
   depend on global script-load order (same pattern as
   cm6-active-range.js and cm6-construct-reveal.js, Stage 29 D5).

   Public exports:
     buildLpInlineDecorations  — pure (state, cm6) → {all, replaced}|null.
     createLpInlineExtension   — factory; (cm6) → Extension|null. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    require('./cm6-line-utils.js');
    module.exports = factory();
  } else {
    root.Cm6LpInline = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── isInlineLinkAncestor / isInlineImageAncestor ──────────────────────
  // Mirror the walker's isInlineLinkNode / isInlineImageNode predicates
  // (cm6-hybrid-view.js:31-37, 62-68). Used by the inline-link / inline-
  // image branch to skip reference-style links/images (which have no
  // direct URL child) and autolinks (parent name is 'Autolink', not
  // 'Link'). Takes a SyntaxNode (the LinkMark/URL/LinkTitle); checks
  // node.parent for the right shape.
  function isInlineLinkAncestor(synNode) {
    if (!synNode) return false;
    const parent = synNode.parent;
    if (!parent || parent.name !== 'Link') return false;
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.name === 'URL') return true;
    }
    return false;
  }
  function isInlineImageAncestor(synNode) {
    if (!synNode) return false;
    const parent = synNode.parent;
    if (!parent || parent.name !== 'Image') return false;
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.name === 'URL') return true;
    }
    return false;
  }

  // ── frontmatterEnd(doc) — defensive guard ──────────────────────────────
  // Mirrors cm6-construct-reveal.js's D8 helper. Returns the exclusive end
  // position of the strict '---'…'---' region, or 0 if absent. Strict
  // matching: both fence lines must be exactly '---' (no trailing
  // whitespace, no other content). Used to skip emphasis nodes inside YAML
  // frontmatter — those characters render as plain text per Stage 14.9.
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

  // ── EmptyMarkerWidget — replacement target for hidden emphasis markers ──
  // Lives at module scope so all Decoration.replace ranges share one
  // instance. The widget renders nothing (an empty <span>); the replace
  // call removes the underlying characters from the visible DOM.
  let _emptyMarkerWidget = null;
  function getEmptyMarkerWidget(cm6) {
    if (_emptyMarkerWidget) return _emptyMarkerWidget;
    if (!cm6 || !cm6.WidgetType) return null;
    class EmptyMarkerWidget extends cm6.WidgetType {
      toDOM() {
        if (typeof document === 'undefined') return { nodeType: 1 };
        const span = document.createElement('span');
        return span;
      }
      eq(other) {
        return other instanceof EmptyMarkerWidget;
      }
      ignoreEvent() { return false; }
    }
    _emptyMarkerWidget = new EmptyMarkerWidget();
    return _emptyMarkerWidget;
  }

  // ── buildLpInlineDecorations(state, cm6) ─────────────────────────────
  // Returns { all: RangeSet, replaced: RangeSet } | null.
  //   all       — full decoration set for ViewPlugin.decorations.
  //   replaced  — subset of `all` containing only Decoration.replace ranges,
  //               used by the EditorView.atomicRanges facet provider.
  // Returns null when cm6 / Decoration.set is missing (M1 sentinel pattern
  // from Stages 26/28). Returns empty RangeSets when no doc/selection.
  //
  // Algorithm (WAVE 4):
  //   1. Resolve the touched-line set from state.selection via
  //      globalThis.Cm6LineUtils.resolveTouchedLines (Stage 26 parity).
  //   2. Walk the syntax tree for EmphasisMark nodes.
  //   3. For each mark whose containing line is NOT touched:
  //        - emit cm6.Decoration.replace({widget: emptyMarkerWidget}).range(from, to)
  //        - add the range to the `replaced` set
  //   4. For each mark whose containing line IS touched:
  //        - emit NOTHING from this plugin. The hybrid walker's existing
  //          cm-md-syntax cm-md-emphasis-mark Decoration.mark + the
  //          existing CSS .cm-md-active-range .cm-md-syntax rule reveal
  //          the marker dimmed.
  //   5. Frontmatter guard: skip emphasis nodes inside the strict
  //      '---'…'---' frontmatter region (Stage 14.9 parity).
  function buildLpInlineDecorations(state, cm6) {
    if (!cm6 || !cm6.Decoration) return null;
    if (typeof cm6.Decoration.set !== 'function') return null;
    const empty = cm6.Decoration.set([], true);
    if (!state || !state.doc || !state.selection) {
      return { all: empty, replaced: empty };
    }

    // Active-line set. Uses the same helper as Stage 26 cm6-active-range
    // and Stage 28 cm6-construct-reveal so the reveal contract is
    // identical: every line touched by any selection range is "active".
    const lineUtils = (typeof globalThis !== 'undefined') ? globalThis.Cm6LineUtils : null;
    if (!lineUtils || typeof lineUtils.resolveTouchedLines !== 'function') {
      return { all: empty, replaced: empty };
    }
    const touchedLines = lineUtils.resolveTouchedLines(state.selection, state.doc);
    const touchedSet = new Set(touchedLines);

    // Syntax tree. Without it we cannot find EmphasisMark nodes.
    if (typeof cm6.syntaxTree !== 'function') {
      return { all: empty, replaced: empty };
    }
    const tree = cm6.syntaxTree(state);
    if (!tree || typeof tree.iterate !== 'function') {
      return { all: empty, replaced: empty };
    }

    // Frontmatter region: nodes whose from < fmEnd are skipped.
    const fmEnd = frontmatterEnd(state.doc);

    // Empty-widget instance for Decoration.replace targets.
    if (typeof cm6.Decoration.replace !== 'function') {
      return { all: empty, replaced: empty };
    }
    const widget = getEmptyMarkerWidget(cm6);
    if (!widget) {
      return { all: empty, replaced: empty };
    }

    // Per-node helper: returns true if this node should be replaced (off-active,
    // outside frontmatter). Caller decides emission based on node type.
    function shouldReplace(node) {
      if (node.from < fmEnd) return false;
      const lineNumber = state.doc.lineAt(node.from).number;
      return !touchedSet.has(lineNumber);
    }

    const replacedRanges = [];
    tree.iterate({
      enter(node) {
        // Stage A — emphasis markers (* / _ / ** / __).
        if (node.name === 'EmphasisMark') {
          if (!shouldReplace(node)) return;
          replacedRanges.push(
            cm6.Decoration.replace({ widget: widget, inclusive: false })
              .range(node.from, node.to)
          );
          return;
        }
        // Stage B — inline-code backticks. Parent must be InlineCode, NOT
        // FencedCode (Lezer reuses CodeMark for both; same disambiguation
        // the walker uses at cm6-hybrid-view.js:267-272).
        if (node.name === 'CodeMark') {
          const parent = node.node.parent;
          if (!parent || parent.name !== 'InlineCode') return;
          if (!shouldReplace(node)) return;
          replacedRanges.push(
            cm6.Decoration.replace({ widget: widget, inclusive: false })
              .range(node.from, node.to)
          );
          return;
        }
        // Stage B — strikethrough delimiters (~~). StrikethroughMark only
        // appears as a child of Strikethrough per the GFM @lezer/markdown
        // extension; no parent disambiguation needed.
        if (node.name === 'StrikethroughMark') {
          if (!shouldReplace(node)) return;
          replacedRanges.push(
            cm6.Decoration.replace({ widget: widget, inclusive: false })
              .range(node.from, node.to)
          );
          return;
        }
        // Stage B — inline link / image markers. LinkMark/URL/LinkTitle
        // appear in three contexts: inline Link (with URL child), inline
        // Image (with URL child), reference-style Link/Image (no URL
        // child), autolink (parent name is Autolink). Only the first two
        // are in scope for Stage B. The link TEXT range (between the two
        // bracket LinkMarks) is NOT replaced — it stays visible per the
        // existing cm-md-link-text / cm-md-image-alt walker styling.
        if (node.name === 'LinkMark' || node.name === 'URL' || node.name === 'LinkTitle') {
          const inLink  = isInlineLinkAncestor(node.node);
          const inImage = isInlineImageAncestor(node.node);
          if (!inLink && !inImage) return;
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
    // Decoration.set requires the second argument true to indicate ranges
    // are already sorted by `from`. Tree iteration is in-order, so the
    // ranges array is naturally sorted.
    const set = cm6.Decoration.set(replacedRanges, true);
    return { all: set, replaced: set };
  }

  // ── createLpInlineExtension(cm6) ──────────────────────────────────────
  // Factory returning a CodeMirror ViewPlugin extension, or null when any
  // required surface is missing (M1 sentinel from Stage 26 createActiveRange-
  // Extension). The lp engine needs four surfaces that hybrid-cm6 doesn't:
  // Decoration.replace, WidgetType, EditorView.atomicRanges, and
  // Decoration.none (atomicRanges fallback).
  function createLpInlineExtension(cm6) {
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
        const built = buildLpInlineDecorations(view.state, cm6);
        this.decorations    = built ? built.all      : cm6.Decoration.none;
        this.replacedRanges = built ? built.replaced : cm6.Decoration.none;
      }
      update(update) {
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
          const built = buildLpInlineDecorations(update.state, cm6);
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
    buildLpInlineDecorations: buildLpInlineDecorations,
    createLpInlineExtension:  createLpInlineExtension,
    // Exposed for WAVE 4 internal use; not part of the public lp surface.
    _frontmatterEnd:            frontmatterEnd,
    _getEmptyMarkerWidget:      getEmptyMarkerWidget,
  };
});
