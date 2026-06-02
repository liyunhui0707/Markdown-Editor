'use strict';

/* Stage G.12 — hybrid-cm6-lp engine: widget click → source-line routing.

   Closes the after-G.11 residual: clicks ON the block widget DOM
   (table/display-math/code/mermaid) landed the cursor on the line
   ABOVE the widget instead of activating the widget's source range.
   Symptom: clicking the widget never revealed the source, forcing the
   user to click the line above and arrow-down.

   Root cause: `Decoration.widget({block: true, side: -1}).range(lineN.from)`
   inserts the widget BEFORE line N. CM6's default click-to-position
   resolver, when the click Y falls on the widget's own DOM (which is
   not a .cm-line), maps it to the nearest text position — that is
   `lineN.from - 1` (= the LF before line N, owned by line N-1). Result:
   line N-1 becomes active, lines N..N+k stay off-active, the widget
   stays mounted. The user is stuck.

   G.11 (height:0 + ResizeObserver) fixed the height-tree offset for
   hidden source lines, but DID NOT address widget-click routing —
   that's a separate code path. G.12 attacks the click-routing problem
   directly: install a capture-phase mousedown listener on every block
   widget DOM that:
     1. stopPropagation + preventDefault — CM6 never sees the event,
        so it can't do its lineN-1 fallback resolution.
     2. view.posAtDOM(widgetDom) → the widget's current anchor position
        (lineN.from). We use posAtDOM rather than capturing a closure-
        bound constructor field because the widget instance may persist
        across edits (eq returns true on identical content) while the
        anchor migrates as preceding text shifts.
     3. doc.lineAt(pos) → resolve to the line object.
     4. view.dispatch({selection: {anchor: line.from}}) — caret on lineN.
        That line becomes active, the StateField rebuilds, the widget
        disappears, the source reveals. Same path as the user clicking
        any other inline-marker construct.
     5. view.focus() — ensure typing works immediately.

   Architectural note: ignoreEvent stays false on the widgets. The
   capture-phase listener + stopPropagation means CM6 doesn't get a
   chance to consult ignoreEvent. Keeping the existing false value
   minimizes diff and preserves drag-into-widget behavior for any
   future stage that wants text-selection across widget boundaries
   (currently none — drag-selection starts a fresh cursor at lineN).

   Public exports:
     attachSourceClickRouter(view, dom) — install the listener; idempotent
                                          per-DOM-element via a Symbol
                                          marker so repeated mounts don't
                                          double-attach.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6LpWidgetClickRouting = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const ATTACHED = typeof Symbol === 'function'
    ? Symbol('cm6-lp-click-router-attached')
    : '__cm6LpClickRouterAttached__';

  function attachSourceClickRouter(view, dom) {
    if (!view || !dom) return;
    if (typeof view.posAtDOM !== 'function') return;
    if (typeof view.dispatch !== 'function') return;
    if (!view.state || !view.state.doc) return;
    if (dom[ATTACHED]) return;
    dom[ATTACHED] = true;

    dom.addEventListener('mousedown', function (e) {
      if (!e || e.button !== 0) return;
      let pos;
      try {
        pos = view.posAtDOM(dom);
      } catch (err) {
        return;
      }
      if (pos == null || pos < 0) return;
      const docLen = view.state.doc.length;
      const safePos = Math.max(0, Math.min(pos, docLen));
      let line;
      try {
        line = view.state.doc.lineAt(safePos);
      } catch (err) {
        return;
      }
      if (!line) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      try {
        view.dispatch({ selection: { anchor: line.from } });
      } catch (err) {
        return;
      }
      if (typeof view.focus === 'function') view.focus();
    }, true);
  }

  return {
    attachSourceClickRouter: attachSourceClickRouter,
  };
});
