'use strict';

/* Stage G.3 — hybrid-cm6-lp engine: block-widget StateField.

   Owns the FOUR multi-line block widgets that previously lived in
   cm6-lp-block.js:
     - Stage E table widget          (Decoration.replace({block:true}))
     - Stage F display math widget   (Decoration.replace({block:true}))
     - Stage G.1 fenced-code widget  (Decoration.replace({block:true}))
     - Stage G.2 mermaid widget      (Decoration.replace({block:true}))

   CodeMirror 6 forbids `block:true` decorations from a ViewPlugin —
   they must come from a `StateField`. The previous architecture put
   these emissions inside the lp-block.js ViewPlugin alongside Stage D's
   line-internal HeaderMark/ListMark/QuoteMark replaces. That worked
   in the pure-function test harness (which calls buildLpBlockDecorations
   directly without mounting an EditorView) but threw a flood of
   "Block decorations may not be specified via plugins" RangeErrors
   the moment a doc containing any block widget was loaded into a
   real view.

   Fix: extract the four block widgets into THIS new module backed by
   a `StateField`. The state field rebuilds on every transaction
   whose docChanged OR selection changed (matches the prior ViewPlugin
   rebuild policy). Decorations and atomic ranges are exposed via
   StateField.provide(facets), which CM6 accepts for block decorations.

   cm6-lp-block.js stays — trimmed to the Stage D markers ONLY
   (line-internal Decoration.replace without block:true).

   This module deliberately does NOT change the WidgetType subclasses,
   the active-line resolution, or any other observable behavior. The
   only change is which CM6 facet delivers the decorations.

   Public exports:
     buildBlockWidgetDecorations  — pure (state, cm6) → {all, replaced}|null.
                                    Used by tests + by the StateField.
     createLpBlockWidgetExtension — factory; (cm6) → Extension|null.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    require('./cm6-line-utils.js');
    const lpInline = require('./cm6-lp-inline.js');
    if (typeof globalThis !== 'undefined' && !globalThis.Cm6LpInline) {
      globalThis.Cm6LpInline = lpInline;
    }
    const lpTable = require('./cm6-lp-table-widget.js');
    if (typeof globalThis !== 'undefined' && !globalThis.Cm6LpTableWidget) {
      globalThis.Cm6LpTableWidget = lpTable;
    }
    const lpMathDetect = require('./cm6-lp-math-detect.js');
    const lpMathWidget = require('./cm6-lp-math-widget.js');
    if (typeof globalThis !== 'undefined') {
      if (!globalThis.Cm6LpMathDetect) globalThis.Cm6LpMathDetect = lpMathDetect;
      if (!globalThis.Cm6LpMathWidget) globalThis.Cm6LpMathWidget = lpMathWidget;
    }
    const lpCodeWidget = require('./cm6-lp-code-widget.js');
    if (typeof globalThis !== 'undefined' && !globalThis.Cm6LpCodeWidget) {
      globalThis.Cm6LpCodeWidget = lpCodeWidget;
    }
    const lpMermaidWidget = require('./cm6-lp-mermaid-widget.js');
    if (typeof globalThis !== 'undefined' && !globalThis.Cm6LpMermaidWidget) {
      globalThis.Cm6LpMermaidWidget = lpMermaidWidget;
    }
    module.exports = factory();
  } else {
    root.Cm6LpBlockWidgets = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Frontmatter helper (same shape as cm6-lp-block.js / cm6-lp-inline.js).
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

  // ── buildBlockWidgetDecorations(state, cm6) ────────────────────────────
  // Pure function. Walks the syntax tree for Table + FencedCode nodes,
  // walks parseMath() output for display math, and emits ONE
  // Decoration.replace({block:true, widget}) per off-active block.
  // Returns { all, replaced } RangeSets, or null on missing surfaces.
  function buildBlockWidgetDecorations(state, cm6) {
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

    function isWholeRangeOffActive(fromLine, toLine) {
      for (let n = fromLine; n <= toLine; n++) {
        if (touchedSet.has(n)) return false;
      }
      return true;
    }

    // Stage G.4 + G.6 — snap a [from, to) range to whole-line boundaries.
    // CM6's tile system requires block-replace decorations to start at
    // a Line.from and end at a Line.to. Returns null when the range
    // would extend to doc.length AND the doc has no trailing newline —
    // CM6 cannot position the cursor past a block widget that abuts
    // strict doc-end (no buffer), producing "No tile at position X"
    // errors at coordsAtPos(doc.length). Callers must skip emission
    // when this helper returns null and let the walker render the
    // source as a fallback.
    function snapToLineBoundaries(rawFrom, rawTo) {
      const docLen = state.doc.length;
      const safeFrom = Math.max(0, Math.min(rawFrom, docLen));
      const safeTo   = Math.max(safeFrom, Math.min(rawTo, docLen));
      const fromLine = state.doc.lineAt(safeFrom);
      const lastCharPos = (safeTo > safeFrom) ? safeTo - 1 : safeFrom;
      const toLine = state.doc.lineAt(Math.max(0, Math.min(lastCharPos, docLen - 1)));
      const snappedFrom = fromLine.from;
      const snappedTo   = toLine.to;
      // Doc-end guard: if the range ends at strict doc-end AND the doc
      // does NOT end with a newline (no buffer past the widget), skip
      // emission. The walker will render the raw source for this block.
      if (snappedTo >= docLen && docLen > 0) {
        const lastChar = state.doc.sliceString(docLen - 1, docLen);
        if (lastChar !== '\n') return null;
      }
      return { from: snappedFrom, to: snappedTo };
    }

    // ── Stage G.8 — emitBlockWidget helper ────────────────────────────
    // Pushes (widget + N line-hide decorations) into the `replacedRanges`
    // array for ONE block-widget candidate. Replaces the prior pattern
    // of a single multi-line Decoration.replace({block: true}) which
    // crashed CM6's tile-tracking on cursor interaction. The new pattern:
    //   1. Decoration.widget({widget, block: true, side: -1}) at the
    //      FIRST line's .from — CM6 inserts the widget as a block BEFORE
    //      that line.
    //   2. Decoration.line({class: 'cm-md-lp-block-hidden'}) on EACH
    //      line in the source range — CSS `display: none` (added in
    //      index.html alongside the existing cm-md-lp-* rules) hides the
    //      source visually.
    // Lines remain as real CM6 lines (cursor positions valid; tile map
    // unchanged). The widget is a POINT insertion at one position (no
    // multi-line decoration spans). Result: CM6's measure cycle doesn't
    // crash on cursor interactions near block widgets.
    function emitBlockWidget(snapped, widget) {
      const docLen = state.doc.length;
      if (!snapped || snapped.from < 0 || snapped.to > docLen) return false;
      const fromLineObj = state.doc.lineAt(snapped.from);
      const toLineObj   = state.doc.lineAt(Math.max(0, Math.min(snapped.to, docLen)));
      // Insert the widget as a block BEFORE the first line of the range.
      // Tracked separately so the StateField can expose a widget-only
      // RangeSet for tests + atomicRanges that don't want line decos.
      widgetRanges.push(
        cm6.Decoration.widget({ widget: widget, block: true, side: -1 })
          .range(fromLineObj.from)
      );
      // Mark each line in the range as hidden via class. CSS in
      // index.html applies `display: none` to .cm-md-lp-block-hidden.
      const fromLineNum = fromLineObj.number;
      const toLineNum   = toLineObj.number;
      for (let n = fromLineNum; n <= toLineNum; n++) {
        const line = state.doc.line(n);
        lineRanges.push(
          cm6.Decoration.line({ class: 'cm-md-lp-block-hidden' })
            .range(line.from)
        );
      }
      return true;
    }

    // Widget class lookups (same as cm6-lp-block.js had).
    const tableMod  = (typeof globalThis !== 'undefined') ? globalThis.Cm6LpTableWidget : null;
    const TableWidgetClass = (tableMod && typeof tableMod.getTableWidgetClass === 'function')
      ? tableMod.getTableWidgetClass()
      : null;

    const codeWidgetMod = (typeof globalThis !== 'undefined') ? globalThis.Cm6LpCodeWidget : null;
    const CodeBlockWidgetClass = (codeWidgetMod && typeof codeWidgetMod.getCodeBlockWidgetClass === 'function')
      ? codeWidgetMod.getCodeBlockWidgetClass()
      : null;

    const mermaidWidgetMod = (typeof globalThis !== 'undefined') ? globalThis.Cm6LpMermaidWidget : null;
    const MermaidWidgetClass = (mermaidWidgetMod && typeof mermaidWidgetMod.getMermaidWidgetClass === 'function')
      ? mermaidWidgetMod.getMermaidWidgetClass()
      : null;

    // Stage G.8 — separate buckets:
    //   widgetRanges — Decoration.widget({block:true,side:-1}) point
    //                  insertions, ONE per block. Goes to `widgets` in
    //                  the return value; preserves the old test contract
    //                  of "N widgets visible per N off-active blocks".
    //   lineRanges   — Decoration.line({class:'cm-md-lp-block-hidden'})
    //                  per source line. Goes to `all` only.
    // After iteration we combine into a single sorted-by-from RangeSet
    // for the decorations facet, and a widget-only RangeSet for tests/
    // atomicRanges.
    const widgetRanges = [];
    const lineRanges   = [];
    tree.iterate({
      enter(node) {
        // Stage G.1+G.2 — fenced code (CodeBlockWidget or MermaidWidget).
        if (node.name === 'FencedCode' && (CodeBlockWidgetClass || MermaidWidgetClass)) {
          if (node.from < fmEnd) return;
          const fromLine = state.doc.lineAt(node.from).number;
          const lastCharPos = Math.max(node.from, Math.min(node.to - 1, state.doc.length - 1));
          const toLine = state.doc.lineAt(Math.max(lastCharPos, 0)).number;
          if (!isWholeRangeOffActive(fromLine, toLine)) return;
          let lang = '';
          let code = '';
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'CodeInfo' && !lang) {
              lang = state.doc.sliceString(child.from, child.to).trim();
            } else if (child.name === 'CodeText' && !code) {
              code = state.doc.sliceString(child.from, child.to);
            }
          }
          // Stage G.4 + G.6 — snap range first so we know the actual
          // covered line span before constructing the widget.
          const snapped = snapToLineBoundaries(node.from, node.to);
          if (!snapped) return false;
          // Stage G.10 — Stage G.7's lineBreaks computation removed.
          // For the G.8 widget+line-hide architecture the widget is a
          // point insertion (not a multi-line replace), so its CM6
          // lineBreaks property is 0 (default) — the widget contains
          // no newlines INSIDE its rendered DOM.
          let chosenWidget = null;
          if (lang === 'mermaid' && MermaidWidgetClass) {
            chosenWidget = new MermaidWidgetClass(code);
          } else if (CodeBlockWidgetClass) {
            chosenWidget = new CodeBlockWidgetClass({ lang: lang, code: code });
          }
          if (!chosenWidget) return;
          // Stage G.8 — emit widget + line-hide decorations (replaces
          // the prior Decoration.replace({block:true}) which crashed
          // CM6's tile-tracking on cursor interaction).
          emitBlockWidget(snapped, chosenWidget);
          return false;
        }
        // Stage E — GFM table widget.
        if (node.name === 'Table' && TableWidgetClass && tableMod && typeof tableMod.parseTableNode === 'function') {
          if (node.from < fmEnd) return;
          const fromLine = state.doc.lineAt(node.from).number;
          const lastCharPos = Math.max(node.from, Math.min(node.to - 1, state.doc.length - 1));
          const toLine = state.doc.lineAt(Math.max(lastCharPos, 0)).number;
          if (!isWholeRangeOffActive(fromLine, toLine)) return;
          const parsed = tableMod.parseTableNode(node.node, state.doc);
          if (!parsed) return;
          // Stage G.4 + G.6 — snap range; skip if doc-end without newline.
          const snappedT = snapToLineBoundaries(node.from, node.to);
          if (!snappedT) return false;
          // Stage G.10 — Stage G.7's lineBreaks pass-through removed
          // (see FencedCode branch above for rationale).
          const tableWidget = new TableWidgetClass(parsed);
          // Stage G.8 — emit widget + line-hide decorations.
          emitBlockWidget(snappedT, tableWidget);
          return false;
        }
      },
    });

    // Stage F — display math `$$...$$`. Block-level multi-line widget.
    const mathDetect = (typeof globalThis !== 'undefined') ? globalThis.Cm6LpMathDetect : null;
    const mathWidget = (typeof globalThis !== 'undefined') ? globalThis.Cm6LpMathWidget : null;
    const DisplayMathCls = (mathWidget && typeof mathWidget.getDisplayMathWidgetClass === 'function')
      ? mathWidget.getDisplayMathWidgetClass()
      : null;
    if (mathDetect && typeof mathDetect.parseMath === 'function' && DisplayMathCls) {
      const docText = state.doc.toString();
      const mathRanges = mathDetect.parseMath(docText);
      for (let mi = 0; mi < mathRanges.length; mi++) {
        const mr = mathRanges[mi];
        if (mr.kind !== 'display') continue;
        if (mr.from < fmEnd) continue;
        const fromL = state.doc.lineAt(mr.from).number;
        const toPos = Math.max(mr.from, Math.min(mr.to - 1, state.doc.length - 1));
        const toL   = state.doc.lineAt(Math.max(toPos, 0)).number;
        if (!isWholeRangeOffActive(fromL, toL)) continue;
        // Skip if inside FencedCode / CodeBlock (display math inside code stays as raw text).
        const resolved = tree.resolveInner ? tree.resolveInner(mr.from, 1) : null;
        let parent = resolved;
        let insideCode = false;
        while (parent) {
          const pName = parent.name;
          if (pName === 'FencedCode' || pName === 'CodeBlock') {
            insideCode = true;
            break;
          }
          parent = parent.parent;
        }
        if (insideCode) continue;
        // Stage G.4 + G.6 — snap range; skip if doc-end without newline.
        const snappedM = snapToLineBoundaries(mr.from, mr.to);
        if (!snappedM) continue;
        // Stage G.10 — Stage G.7's lineBreaks pass-through removed.
        const w = new DisplayMathCls(mr.source);
        // Stage G.8 — emit widget + line-hide decorations.
        emitBlockWidget(snappedM, w);
      }
    }

    // Stage G.8 — combine widget + line buckets into a single sorted
    // RangeSet for the decorations facet; keep widget-only set for the
    // `replaced` return field (preserves old test contract: one entry
    // in `replaced` per off-active block).
    if (widgetRanges.length === 0 && lineRanges.length === 0) {
      return { all: empty, replaced: empty };
    }
    const combined = widgetRanges.concat(lineRanges);
    combined.sort(function (a, b) { return a.from - b.from; });
    const all      = cm6.Decoration.set(combined, true);
    // widgetRanges are naturally in document order (one per block,
    // emitted as the tree.iterate visits blocks in order; display math
    // appended after). Sort defensively in case ordering changes later.
    widgetRanges.sort(function (a, b) { return a.from - b.from; });
    const widgets  = cm6.Decoration.set(widgetRanges, true);
    return { all: all, replaced: widgets };
  }

  // ── createLpBlockWidgetExtension(cm6) ──────────────────────────────────
  // Factory returning a CodeMirror Extension (StateField + facet wiring).
  // The StateField is REQUIRED for block decorations — ViewPlugin sources
  // throw "Block decorations may not be specified via plugins" at runtime
  // (fixed in Stage G.3). Stage G.4 added widget.block:true getter + line-
  // aligned ranges. Stage G.6 added the "skip block widget when range ends
  // at doc.length without trailing newline" guard in buildBlockWidget-
  // Decorations (CM6 can't position past a widget that abuts doc-end).
  //
  // Stage G.6 also originally tried a transactionFilter to snap cursor
  // out of block ranges, but discovered CM6's atomicRanges facet ALREADY
  // handles this for block:true replaces (verified via diagnostic). The
  // filter was removed as redundant.
  function createLpBlockWidgetExtension(cm6) {
    if (!cm6) return null;
    if (!cm6.StateField || typeof cm6.StateField.define !== 'function') return null;
    if (!cm6.EditorView || !cm6.EditorView.decorations) return null;
    if (!cm6.EditorView.atomicRanges) return null;
    if (typeof cm6.EditorView.atomicRanges.of !== 'function') return null;
    if (!cm6.Decoration || !cm6.Decoration.none) return null;

    const field = cm6.StateField.define({
      create: function (state) {
        return buildBlockWidgetDecorations(state, cm6) || { all: cm6.Decoration.none, replaced: cm6.Decoration.none };
      },
      update: function (value, tr) {
        // Rebuild on doc change OR selection change. CM6's `Transaction`
        // exposes `docChanged` (boolean) and `selection` (truthy when the
        // selection was set this transaction).
        if (tr.docChanged || tr.selection) {
          return buildBlockWidgetDecorations(tr.state, cm6) || { all: cm6.Decoration.none, replaced: cm6.Decoration.none };
        }
        return value;
      },
      provide: function (f) {
        return [
          // Block decorations delivered via StateField facet — allowed by CM6.
          cm6.EditorView.decorations.from(f, function (v) {
            return v && v.all ? v.all : cm6.Decoration.none;
          }),
          // Atomic ranges read from the same field.
          cm6.EditorView.atomicRanges.of(function (view) {
            const v = view.state.field(field, false);
            return (v && v.replaced) || cm6.Decoration.none;
          }),
        ];
      },
    });

    return field;
  }

  return {
    buildBlockWidgetDecorations: buildBlockWidgetDecorations,
    createLpBlockWidgetExtension: createLpBlockWidgetExtension,
    _frontmatterEnd:              frontmatterEnd,
  };
});
