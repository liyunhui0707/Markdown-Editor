'use strict';

/* Experimental CM6 hybrid live-styling Write-mode adapter (Stage 11.4).
   Feature-flagged as ?writeEngine=hybrid-cm6 — NOT the default.

   Live-styling approach:
     - syntaxTree(state) provides Markdown structure (no custom regex parsing).
     - Decoration.mark applies CSS classes to heading nodes and HeaderMark ranges.
     - Hidden / dimmed visibility of `#` markers is controlled by CSS keyed off
       the .cm-activeLine class added by the bundled highlightActiveLine.
     - Underlying text is never replaced; the cursor traverses real characters,
       and getText() returns raw Markdown verbatim.

   Adapter contract (same shape as cm6-write-view.js):
     getText() / setText(text) / getState() / setState(state) / exitWriteMode()
     focus()  / destroy()  /  view (the underlying CM6 EditorView) */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6HybridView = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Walk the Markdown syntax tree and emit Decoration.mark ranges for ATX
  // headings. Returns a DecorationSet (or an equivalent shape from the fake
  // backend used by adapter-contract tests). Returns an empty set when no
  // syntaxTree is available (e.g., the fake backend used in adapter tests).
  function buildHeadingDecorations(state, cm6) {
    const decorations = [];

    if (cm6 && typeof cm6.syntaxTree === 'function') {
      const tree = cm6.syntaxTree(state);
      if (tree && typeof tree.iterate === 'function') {
        tree.iterate({
          enter(node) {
            const m = node.name && node.name.match(/^ATXHeading([1-6])$/);
            if (!m) return;
            const level = m[1];

            // Whole-line styling for this heading level.
            decorations.push(
              cm6.Decoration.mark({ class: 'cm-md-h' + level }).range(node.from, node.to)
            );

            // HeaderMark child = the "#"…"######" run at the start of the line.
            // Iterate the heading's direct children to find it; do not rely on
            // child position, and skip descending after we've handled this node.
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'HeaderMark') {
                decorations.push(
                  cm6.Decoration.mark({ class: 'cm-md-heading-mark' }).range(child.from, child.to)
                );
              }
            }

            return false;
          },
        });
      }
    }

    // Decoration.set(arr, true) sorts internally so callers don't have to
    // worry about parent-vs-child ordering coming out of tree iteration.
    if (cm6 && cm6.Decoration && typeof cm6.Decoration.set === 'function') {
      return cm6.Decoration.set(decorations, true);
    }
    // Fake-backend fallback: tests that don't supply syntaxTree never read
    // these ranges, so the shape is irrelevant beyond "not crashing".
    return { _ranges: decorations };
  }

  function createCm6HybridView(parent, opts) {
    const o          = opts || {};
    const initialDoc = o.initialDoc != null ? String(o.initialDoc) : '';
    const onChange   = typeof o.onChange === 'function' ? o.onChange : null;
    const cm6        = o.cm6;

    if (!cm6 || !cm6.EditorState || !cm6.EditorView) {
      throw new Error('cm6 backend missing (pass opts.cm6 from the bundled namespace)');
    }
    if (!cm6.ViewPlugin || !cm6.Decoration) {
      throw new Error('cm6 hybrid live-styling missing required primitives (ViewPlugin, Decoration)');
    }

    // ViewPlugin: rebuild heading decorations whenever the doc or viewport
    // changes. Selection-only updates do NOT rebuild — the active/inactive
    // visibility flip is driven by CSS (.cm-activeLine), so the decoration
    // set itself is selection-independent.
    const headingMarkPlugin = cm6.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = buildHeadingDecorations(view.state, cm6);
        }
        update(update) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildHeadingDecorations(update.state, cm6);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );

    function buildState(doc) {
      const extensions = [
        cm6.history(),
        cm6.markdown ? cm6.markdown() : null,
        cm6.EditorView.lineWrapping,
        cm6.EditorView.updateListener.of(function (update) {
          if (!update.docChanged) return;
          if (!onChange) return;
          onChange(update.state.doc.toString());
        }),
        headingMarkPlugin,
        Array.isArray(cm6.chrome) ? cm6.chrome : null,
      ].filter(function (e) { return e != null; });
      return cm6.EditorState.create({ doc: doc, extensions: extensions });
    }

    const view = new cm6.EditorView({
      state:  buildState(initialDoc),
      parent: parent,
    });

    return {
      view: view,
      getText:       function ()       { return view.state.doc.toString(); },
      setText:       function (text)   { view.setState(buildState(text == null ? '' : String(text))); },
      getState:      function ()       { return view.state; },
      setState:      function (state)  { view.setState(state); },
      exitWriteMode: function ()       { /* no-op: CM6 has no inactive-block mode */ },
      focus:         function ()       { view.focus(); },
      destroy:       function ()       { view.destroy(); },
    };
  }

  return { createCm6HybridView, buildHeadingDecorations };
});
