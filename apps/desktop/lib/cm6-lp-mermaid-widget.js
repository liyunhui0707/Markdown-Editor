'use strict';

/* Stage G.2 — hybrid-cm6-lp engine: Mermaid diagram widget.

   A WidgetType subclass that renders a ```mermaid fenced-code block
   as an SVG diagram via Mermaid (vendored at lib/vendor/mermaid/).

   First lp stage with ASYNC rendering. Mermaid's API is:
       mermaid.render(id, source) → Promise<{svg: string}>
   The widget's toDOM() is sync (CM6 needs the element immediately), so
   the widget returns a container synchronously with a placeholder, then
   kicks off mermaid.render and patches the container's innerHTML when
   the promise resolves. Async safety via a `destroyed` flag set by CM6's
   destroy() lifecycle (same pattern Stage C's InlineImageWidget uses for
   vault-relative IPC).

   Mermaid is initialized once in lib/mermaid-entry.js with
   securityLevel: 'strict' — rejects user-provided HTML, sanitizes
   the SVG output. The widget does NOT override these defaults.

   Error handling: if mermaid is missing OR initialize never ran OR the
   render Promise rejects OR mermaid throws synchronously, the widget
   shows a styled cm-md-lp-mermaid-error placeholder containing the raw
   source + the error message (via textContent — XSS-safe).

   Public exports:
     getMermaidWidgetClass() -> class extends WidgetType
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const view = require('@codemirror/view');
    module.exports = factory(view.WidgetType);
  } else {
    const widgetType =
      (root.CM6Production && root.CM6Production.WidgetType) ||
      (root.codemirror && root.codemirror.WidgetType) || null;
    root.Cm6LpMermaidWidget = factory(widgetType);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WidgetType) {

  function getMermaid() {
    if (typeof globalThis !== 'undefined' && globalThis.mermaid) return globalThis.mermaid;
    return null;
  }

  // Monotonically increasing id for mermaid.render — Mermaid requires
  // unique element ids per render call. Module-scoped counter.
  let __mermaidIdCounter = 0;
  function nextMermaidId() {
    __mermaidIdCounter += 1;
    return 'cm-md-lp-mermaid-' + __mermaidIdCounter;
  }

  // Build the styled error placeholder. Uses textContent (XSS-safe) for
  // the raw source body + the optional error message.
  function buildErrorPlaceholder(container, source, errorMessage) {
    while (container.firstChild) container.removeChild(container.firstChild);
    container.className = 'cm-md-lp-mermaid cm-md-lp-mermaid-error';
    if (typeof container.setAttribute === 'function') {
      container.setAttribute('title',
        errorMessage
          ? ('Mermaid render failed: ' + String(errorMessage).slice(0, 200))
          : 'Mermaid render failed');
    }
    container.textContent = source;
  }

  // Kick off the async render. The `widget` argument carries the
  // destroyed flag — after CM6 destroys the widget, late-arriving
  // Promise callbacks become no-ops.
  function renderMermaidInto(container, source, widget) {
    const mermaid = getMermaid();
    if (!mermaid || typeof mermaid.render !== 'function') {
      // Fall back to raw source — used in Node tests where mermaid is
      // absent OR in the renderer if the vendored bundle failed to load.
      container.textContent = source;
      return;
    }
    let renderPromise;
    try {
      renderPromise = mermaid.render(nextMermaidId(), source);
    } catch (e) {
      // Synchronous throw (e.g., parse error in some Mermaid versions).
      buildErrorPlaceholder(container, source, e && e.message);
      return;
    }
    if (!renderPromise || typeof renderPromise.then !== 'function') {
      // Not a Promise — defensive.
      buildErrorPlaceholder(container, source, 'mermaid.render did not return a Promise');
      return;
    }
    renderPromise.then(function (result) {
      if (widget && widget._destroyed) return;
      if (!result || typeof result.svg !== 'string') {
        buildErrorPlaceholder(container, source, 'mermaid.render returned no svg');
        return;
      }
      // Mermaid's SVG output is sanitized when securityLevel is 'strict'.
      // Safe to assign to innerHTML — the SVG is fully self-contained.
      container.innerHTML = result.svg;
    }, function (err) {
      if (widget && widget._destroyed) return;
      buildErrorPlaceholder(container, source, err && err.message);
    });
  }

  // ── MermaidWidget ─────────────────────────────────────────────────────
  let MermaidWidget = null;

  function getMermaidWidgetClass() {
    if (MermaidWidget) return MermaidWidget;
    if (!WidgetType) return null;

    class _MermaidWidget extends WidgetType {
      constructor(source) {
        super();
        this.source = (source != null) ? String(source) : '';
        this._destroyed = false;
        // Stage G.10 — G.7's _lineBreaks removed (see cm6-lp-table-widget.js).
      }
      // Stage G.4 — block-widget contract (see cm6-lp-table-widget.js).
      get block() { return true; }
      eq(other) {
        return (other instanceof _MermaidWidget) && (other.source === this.source);
      }
      toDOM(view) {
        if (typeof document === 'undefined') return { nodeType: 1 };
        const container = document.createElement('div');
        container.className = 'cm-md-lp-mermaid';
        // Synchronous placeholder text — visible during the (typically
        // <100ms) async render. The async path either replaces with the
        // SVG, or swaps to the error placeholder.
        container.textContent = '';
        // Kick off async render. The widget reference lets the resolve
        // callback skip DOM updates after CM6 has destroyed the widget.
        renderMermaidInto(container, this.source, this);
        // Stage G.12 — route widget clicks to source line. Listener is
        // attached on the outer container; async-injected SVG inherits
        // via bubbling (capture-phase listener on container fires first).
        const router = (typeof globalThis !== 'undefined') ? globalThis.Cm6LpWidgetClickRouting : null;
        if (router && typeof router.attachSourceClickRouter === 'function') {
          router.attachSourceClickRouter(view, container);
        }
        return container;
      }
      destroy(_dom) {
        // Called by CM6 when the widget is removed from view. Setting
        // the destroyed flag prevents the in-flight render Promise from
        // mutating DOM after the container has been detached.
        this._destroyed = true;
      }
      ignoreEvent(event) {
        // Stage G.13 — see cm6-lp-table-widget.js for full rationale.
        if (!event) return true;
        const t = event.type;
        return t === 'mousedown' || t === 'mouseup' || t === 'click';
      }
    }

    MermaidWidget = _MermaidWidget;
    return MermaidWidget;
  }

  return {
    getMermaidWidgetClass:    getMermaidWidgetClass,
    _renderMermaidInto:       renderMermaidInto,
    _buildErrorPlaceholder:   buildErrorPlaceholder,
  };
});
