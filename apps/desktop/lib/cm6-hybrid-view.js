'use strict';

/* Experimental CM6 hybrid-render Write-mode adapter (Stage 11.2).
   Feature-flagged as ?writeEngine=hybrid-cm6 — NOT the default.

   Contract (same as cm6-write-view.js):
     getText()        — returns the current document as raw Markdown string
     setText(text)    — replaces the document; safe for note switches
     getState()       — returns opaque EditorState for note-local undo cache
     setState(state)  — restores a cached EditorState
     exitWriteMode()  — no-op (CM6 has no inactive-block mode)
     focus()          — focuses the underlying view
     destroy()        — tears down the view

   Rendering behaviour:
     - Inactive heading blocks (h1–h6) are replaced with a styled widget via
       Decoration.replace so the user sees a rendered heading.
     - The heading block that contains the cursor stays as raw Markdown source.
     - All other blocks remain raw Markdown source at all times.
     - getText() always returns the raw document text; no HTML is ever saved.

   Raw-Markdown safety:
     HeadingWidget.toDOM() sets el.textContent (never innerHTML), so the
     browser handles & → &amp;, < → &lt;, > → &gt; escaping automatically. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6HybridView = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Parse heading lines and their positions in the document.
  // Returns [{ from, to, text, level, isActive }].
  // from/to are byte offsets in docText (to is exclusive: the \n position).
  // isActive is true if cursorHead falls on this line (inclusive of lineEnd).
  function buildHybridRenderModel(docText, cursorHead) {
    if (!docText) return [];
    const lines = docText.split('\n');
    const result = [];
    let pos = 0;

    for (let i = 0; i < lines.length; i++) {
      const line      = lines[i];
      const lineStart = pos;
      const lineEnd   = pos + line.length;

      const m = line.match(/^(#{1,6}) /);
      if (m) {
        result.push({
          from:     lineStart,
          to:       lineEnd,
          text:     line,
          level:    m[1].length,
          isActive: cursorHead >= lineStart && cursorHead <= lineEnd,
        });
      }

      // advance past the newline separator (absent on the last line)
      pos = lineEnd + (i < lines.length - 1 ? 1 : 0);
    }

    return result;
  }

  function createCm6HybridView(parent, opts) {
    const o         = opts || {};
    const initialDoc = o.initialDoc != null ? String(o.initialDoc) : '';
    const onChange   = typeof o.onChange === 'function' ? o.onChange : null;
    const cm6        = o.cm6;

    if (!cm6 || !cm6.EditorState || !cm6.EditorView) {
      throw new Error('cm6 backend missing (pass opts.cm6 from the bundled namespace)');
    }
    if (!cm6.ViewPlugin || !cm6.Decoration || !cm6.WidgetType || !cm6.RangeSetBuilder) {
      throw new Error(
        'cm6 hybrid decorations missing (ViewPlugin, Decoration, WidgetType, RangeSetBuilder required)'
      );
    }

    // HeadingWidget renders one inactive heading block.
    // textContent is used (not innerHTML) so & < > are escaped by the DOM.
    class HeadingWidget extends cm6.WidgetType {
      constructor(text, level) {
        super();
        this._text  = text;
        this._level = level;
      }

      toDOM() {
        const el = document.createElement('div');
        el.className  = 'cm6-heading-widget cm6-h' + this._level;
        el.textContent = this._text.replace(/^#{1,6} /, '');
        return el;
      }

      eq(other) {
        return other instanceof HeadingWidget
          && other._text  === this._text
          && other._level === this._level;
      }

      ignoreEvent() { return false; }
    }

    function buildDecorations(view) {
      const docText    = view.state.doc.toString();
      const cursorHead = view.state.selection.main.head;
      const headings   = buildHybridRenderModel(docText, cursorHead);

      const builder = new cm6.RangeSetBuilder();
      for (const h of headings) {
        if (!h.isActive) {
          builder.add(
            h.from, h.to,
            cm6.Decoration.replace({
              widget: new HeadingWidget(h.text, h.level),
              block:  false,
            })
          );
        }
      }
      return builder.finish();
    }

    // ViewPlugin is registered once; its class re-runs on every state transition.
    const headingPlugin = cm6.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = buildDecorations(view);
        }
        update(update) {
          if (update.docChanged || update.selectionSet) {
            this.decorations = buildDecorations(update.view);
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
        headingPlugin,
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
      getText:      function ()       { return view.state.doc.toString(); },
      setText:      function (text)   { view.setState(buildState(text == null ? '' : String(text))); },
      getState:     function ()       { return view.state; },
      setState:     function (state)  { view.setState(state); },
      exitWriteMode: function ()      { /* no-op: CM6 has no inactive-block mode */ },
      focus:        function ()       { view.focus(); },
      destroy:      function ()       { view.destroy(); },
    };
  }

  return { createCm6HybridView, buildHybridRenderModel };
});
