'use strict';

/* Stage F — hybrid-cm6-lp engine: math widgets (KaTeX).

   Exports two WidgetType subclasses for inline `$x$` and display
   `$$x$$` math, plus a small helper to build an error placeholder.

   Both widgets call KaTeX via `globalThis.katex.render` (set by the
   vendored katex.min.js script tag in index.html). KaTeX is invoked
   with `throwOnError: false` AND wrapped in a try/catch so any
   rendering failure produces a styled error placeholder rather than
   crashing the editor.

   Security: KaTeX's default `trust: false` is preserved — it rejects
   `\href{javascript:...}{...}` and other URL-bearing commands when
   the URL is not in a safe scheme set. Stage F does NOT override this.

   No new dependencies (KaTeX is loaded via the vendored script tag).

   Public exports:
     getInlineMathWidgetClass()  -> class extends WidgetType
     getDisplayMathWidgetClass() -> class extends WidgetType
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const view = require('@codemirror/view');
    module.exports = factory(view.WidgetType);
  } else {
    const widgetType =
      (root.CM6Production && root.CM6Production.WidgetType) ||
      (root.codemirror && root.codemirror.WidgetType) || null;
    root.Cm6LpMathWidget = factory(widgetType);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WidgetType) {

  function getKatex() {
    if (typeof globalThis !== 'undefined' && globalThis.katex) return globalThis.katex;
    return null;
  }

  // Build an error placeholder element. Visible cue: a span with the
  // `cm-md-lp-math-error` class containing the raw source. Renders the
  // text via textContent (XSS-safe). The caller decides whether to use
  // inline (<span>) or display (<div>) wrapper.
  function buildErrorElement(tagName, source) {
    if (typeof document === 'undefined') return { nodeType: 1 };
    const el = document.createElement(tagName);
    el.className = 'cm-md-lp-math-error';
    el.setAttribute('title', 'KaTeX failed to render this math');
    // Show the raw source so the user can see what went wrong.
    el.textContent = source;
    return el;
  }

  // Render math source into a DOM element via KaTeX. On any error
  // (KaTeX not loaded, parse failure, etc.), replace the element with
  // the error placeholder.
  function renderInto(el, source, displayMode) {
    const katex = getKatex();
    if (!katex || typeof katex.render !== 'function') {
      // Fall back: show raw source. This path also fires in Node tests
      // where window.katex is stubbed but doesn't render.
      el.textContent = source;
      return false;
    }
    try {
      katex.render(source, el, {
        displayMode:   displayMode,
        throwOnError:  false,
        errorColor:    '#cc0000',
        trust:         false,
        // Stage G.5 — silence KaTeX strict-mode console warnings (e.g.,
        // "In LaTeX, \\ or \newline does nothing in display mode" for
        // Obsidian-style notes that use \\ informally inside $$...$$).
        // KaTeX still renders the input correctly — only the warn-level
        // diagnostic is suppressed. The throwOnError:false above already
        // ensures parse failures fall through to our error placeholder.
        strict:        'ignore',
      });
      return true;
    } catch (e) {
      // Defensive: KaTeX 0.16+ shouldn't throw with throwOnError:false,
      // but wrap anyway. Replace el's content with raw source.
      while (el.firstChild) el.removeChild(el.firstChild);
      el.className = 'cm-md-lp-math-error';
      el.setAttribute('title', 'KaTeX failed: ' + (e && e.message ? String(e.message).slice(0, 200) : 'unknown error'));
      el.textContent = source;
      return false;
    }
  }

  // ── InlineMathWidget ──────────────────────────────────────────────────
  let InlineMathWidget = null;

  function getInlineMathWidgetClass() {
    if (InlineMathWidget) return InlineMathWidget;
    if (!WidgetType) return null;

    class _InlineMathWidget extends WidgetType {
      constructor(source) {
        super();
        this.source = source;
      }
      eq(other) {
        return (other instanceof _InlineMathWidget) && (other.source === this.source);
      }
      toDOM() {
        if (typeof document === 'undefined') return { nodeType: 1 };
        const span = document.createElement('span');
        span.className = 'cm-md-lp-math-inline';
        renderInto(span, this.source, false);
        return span;
      }
      ignoreEvent() { return false; }
    }

    InlineMathWidget = _InlineMathWidget;
    return InlineMathWidget;
  }

  // ── DisplayMathWidget ─────────────────────────────────────────────────
  let DisplayMathWidget = null;

  function getDisplayMathWidgetClass() {
    if (DisplayMathWidget) return DisplayMathWidget;
    if (!WidgetType) return null;

    class _DisplayMathWidget extends WidgetType {
      constructor(source) {
        super();
        this.source = source;
        // Stage G.10 — G.7's _lineBreaks removed (see cm6-lp-table-widget.js).
      }
      // Stage G.4 — block-widget contract (see cm6-lp-table-widget.js).
      get block() { return true; }
      eq(other) {
        return (other instanceof _DisplayMathWidget) && (other.source === this.source);
      }
      toDOM() {
        if (typeof document === 'undefined') return { nodeType: 1 };
        const div = document.createElement('div');
        div.className = 'cm-md-lp-math-display';
        renderInto(div, this.source, true);
        return div;
      }
      ignoreEvent() { return false; }
    }

    DisplayMathWidget = _DisplayMathWidget;
    return DisplayMathWidget;
  }

  return {
    getInlineMathWidgetClass:  getInlineMathWidgetClass,
    getDisplayMathWidgetClass: getDisplayMathWidgetClass,
    _buildErrorElement:        buildErrorElement,
    _renderInto:               renderInto,
  };
});
