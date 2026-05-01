'use strict';

/* Production CodeMirror 6 Write-mode adapter.

   Exposes the same contract as the existing liveEditorInstance so the host
   can swap engines through write-engine.js without changing call sites:

     getText()        — returns the current document as a raw string
     setText(text)    — replaces the document; safe for note switches
     exitWriteMode()  — no-op for CM6 (the editor IS the write surface)

   Operational hooks:
     focus()          — focuses the underlying view
     destroy()        — tears down the view

   Note-switch / undo-history policy
   ─────────────────────────────────
   `setText` always replaces the EditorState entirely via `view.setState`.
   Per the CM6 docs, this "loses [the editor's] history" — exactly what we
   want when switching to a different note, so undo cannot accidentally
   bridge back into a previous note's content. The host is responsible for
   calling `getText` and persisting the outgoing note's content BEFORE the
   next `setText`. If a future workflow needs to update the document
   in-place while preserving history (e.g., autosave merge), add a separate
   method then; do not overload `setText`.

   Programmatic-update protection
   ──────────────────────────────
   `setText` calls `view.setState(...)` rather than dispatching a transaction,
   so the `updateListener` is not invoked and `onChange` is not called. Only
   user-driven transactions (or any future code path that calls
   `view.dispatch`) reach `onChange`. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6WriteView = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function createCm6WriteView(parent, opts) {
    const o = opts || {};
    const initialDoc = o.initialDoc != null ? String(o.initialDoc) : '';
    const onChange   = typeof o.onChange === 'function' ? o.onChange : null;
    const cm6        = o.cm6;
    if (!cm6 || !cm6.EditorState || !cm6.EditorView) {
      throw new Error('cm6 backend missing (pass opts.cm6 from the bundled namespace)');
    }

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
        // Production decorations carried by the bundle: keymaps (default,
        // history, search), syntax highlighting, line numbers, active-line
        // behavior, bracket matching, selection drawing. Optional so the
        // adapter stays usable in test backends that don't ship chrome.
        Array.isArray(cm6.chrome) ? cm6.chrome : null,
      ].filter(function (e) { return e != null; });
      return cm6.EditorState.create({ doc: doc, extensions: extensions });
    }

    const view = new cm6.EditorView({
      state: buildState(initialDoc),
      parent: parent,
    });

    return {
      view: view,
      getText: function () { return view.state.doc.toString(); },
      setText: function (text) {
        const value = text == null ? '' : String(text);
        view.setState(buildState(value));
      },
      exitWriteMode: function () { /* no-op: CM6 has no inactive-block mode to exit */ },
      focus: function () { view.focus(); },
      destroy: function () { view.destroy(); },
    };
  }

  return { createCm6WriteView: createCm6WriteView };
});
