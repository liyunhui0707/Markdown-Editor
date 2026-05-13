'use strict';

/* Stage 23 — task-toggle production extension for hybrid-cm6.

   This is the only file in the project that owns an EditorView event
   surface. The walker file (cm6-hybrid-view.js) stays pure observation
   and Section H. A peer source-file contract test
   (cm6-task-toggle-invariants.test.js) pins the narrow exception this
   file represents: exactly one EditorView.domEventHandlers call and
   exactly one cm6.keymap.of call.

   Behavior contract:
     - Primary mouse button only (event.button === 0). Other buttons:
       no-op.
     - No modifier keys (meta / ctrl / alt / shift). Modifier-held
       primary clicks: no-op; reserved for future product decisions.
     - IME-safe: when view.composing is truthy, both the mouse and the
       keyboard paths short-circuit immediately.
     - The dispatched transaction replaces ONE character (the marker
       payload), is tagged userEvent: "input.toggle.task", and contains
       NO selection field. CodeMirror auto-maps the existing selection
       through the one-character change.
     - Keyboard binding: Mod-Shift-x. On macOS this surfaces as
       Cmd-Shift-X; on other platforms CodeMirror resolves Mod- to the
       platform-equivalent modifier. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6TaskToggle = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Pure helper: returns { from, to } for the TaskMarker syntax node that
  // contains pos, or null if pos does not lie inside any TaskMarker.
  // Uses tree.resolveInner(pos, 1) — side=1 means "rightward at a
  // boundary." That gives the intended semantics: clicking the "[" or
  // any inside character returns the range; one-past the closing "]"
  // returns null because the rightward node at that boundary is the
  // parent Task or Document, not the TaskMarker.
  function resolveTaskMarkerRange(state, pos, tree) {
    if (!state || !tree) return null;
    if (pos == null || typeof pos !== 'number' || pos < 0) return null;
    if (typeof tree.resolveInner !== 'function') return null;
    const node = tree.resolveInner(pos, 1);
    if (!node || node.name !== 'TaskMarker') return null;
    return { from: node.from, to: node.to };
  }

  // Pure helper: returns a transaction spec that flips the marker payload
  // character, or null if the range does not actually cover a 3-char
  // "[ ]" / "[x]" / "[X]" literal. Spec shape:
  //   changes:   single-char edit at range.from + 1 (the payload).
  //   userEvent: "input.toggle.task" — used by downstream plumbing.
  //   selection: intentionally absent — preserves caret and any active
  //              selection (CodeMirror auto-maps through the change).
  function buildToggleTransaction(state, range) {
    if (!state || !range) return null;
    if (typeof state.doc?.sliceString !== 'function') return null;
    if (typeof range.from !== 'number' || typeof range.to !== 'number') return null;
    if (range.to - range.from !== 3) return null;
    const current = state.doc.sliceString(range.from, range.to);
    if (current.length !== 3 || current[0] !== '[' || current[2] !== ']') return null;
    const payload = current[1];
    let next;
    if (payload === ' ') next = 'x';
    else if (payload === 'x' || payload === 'X') next = ' ';
    else return null;
    return {
      changes: { from: range.from + 1, to: range.from + 2, insert: next },
      userEvent: 'input.toggle.task',
    };
  }

  // Keyboard command bound by Mod-Shift-x. Takes (view, cm6) explicitly
  // so the syntax-tree access does NOT depend on an outer-scope cm6.
  // Scans only the line containing the primary caret for the first
  // TaskMarker node; ignores markers on other lines.
  function toggleTaskAtCaret(view, cm6) {
    if (!view || view.composing) return false;
    if (!cm6 || typeof cm6.syntaxTree !== 'function') return false;
    if (!view.state || !view.state.selection || !view.state.selection.main) return false;
    const pos  = view.state.selection.main.head;
    if (typeof pos !== 'number') return false;
    if (typeof view.state.doc?.lineAt !== 'function') return false;
    const line = view.state.doc.lineAt(pos);
    let tree;
    try { tree = cm6.syntaxTree(view.state); } catch (_) { return false; }
    if (!tree || typeof tree.iterate !== 'function') return false;
    let range = null;
    tree.iterate({
      from: line.from,
      to:   line.to,
      enter(node) {
        if (range) return false;
        if (node.name === 'TaskMarker') {
          range = { from: node.from, to: node.to };
          return false;
        }
      },
    });
    if (range == null) return false;
    const spec = buildToggleTransaction(view.state, range);
    if (spec == null) return false;
    view.dispatch(spec);
    return true;
  }

  // Extension factory. Returns an array of CodeMirror Extensions:
  //   - One EditorView.domEventHandlers entry carrying the mousedown
  //     handler.
  //   - One cm6.keymap.of entry binding Mod-Shift-x to toggleTaskAtCaret.
  // Both are wrapped from outside this file's pure helpers; cm6 is the
  // production bundle namespace (window.CM6Production) and must include
  // EditorView.domEventHandlers and keymap.of. Returns null if either is
  // missing.
  function createTaskToggleExtension(cm6) {
    if (!cm6 || !cm6.EditorView) return null;
    if (typeof cm6.EditorView.domEventHandlers !== 'function') return null;
    if (!cm6.keymap || typeof cm6.keymap.of !== 'function') return null;

    const mousedownExt = cm6.EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event || event.button !== 0) return false;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
        if (!view || view.composing) return false;
        if (typeof view.posAtCoords !== 'function') return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        let tree;
        try {
          tree = (typeof cm6.syntaxTree === 'function') ? cm6.syntaxTree(view.state) : null;
        } catch (_) {
          return false;
        }
        if (!tree) return false;
        const range = resolveTaskMarkerRange(view.state, pos, tree);
        if (range == null) return false;
        const spec = buildToggleTransaction(view.state, range);
        if (spec == null) return false;
        view.dispatch(spec);
        if (typeof event.preventDefault === 'function') event.preventDefault();
        return true;
      },
    });

    const keymapExt = cm6.keymap.of([
      { key: 'Mod-Shift-x', run: (view) => toggleTaskAtCaret(view, cm6) },
    ]);

    return [mousedownExt, keymapExt];
  }

  return {
    resolveTaskMarkerRange,
    buildToggleTransaction,
    toggleTaskAtCaret,
    createTaskToggleExtension,
  };
});
