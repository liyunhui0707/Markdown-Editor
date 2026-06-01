'use strict';

/* Stage G.1 — hybrid-cm6-lp engine: fenced code-block widget (highlight.js).

   A WidgetType subclass that renders a fenced code block off-active
   with syntax highlighting via highlight.js. The widget is emitted by
   cm6-lp-block.js's FencedCode branch as a multi-line block
   Decoration.replace.

   The widget receives (lang, code) extracted by the caller from Lezer's
   FencedCode > CodeInfo + CodeText children. If `lang` is present AND
   highlight.js recognizes it, the widget calls `hljs.highlight(code,
   {language: lang, ignoreIllegals: true})` and inserts the resulting
   HTML (hljs returns sanitized, structured spans — XSS-safe). Otherwise
   the widget falls back to plain `textContent` (also XSS-safe).

   Both paths wrap in `<pre class="cm-md-lp-code-block">` + `<code
   class="hljs language-{lang}">` so the vendored hljs CSS theme styles
   render. On any hljs exception, the catch path falls back to
   `textContent`.

   No new dependencies beyond highlight.js (already vendored).

   Public exports:
     getCodeBlockWidgetClass() -> class extends WidgetType
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const view = require('@codemirror/view');
    module.exports = factory(view.WidgetType);
  } else {
    const widgetType =
      (root.CM6Production && root.CM6Production.WidgetType) ||
      (root.codemirror && root.codemirror.WidgetType) || null;
    root.Cm6LpCodeWidget = factory(widgetType);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WidgetType) {

  function getHljs() {
    if (typeof globalThis !== 'undefined' && globalThis.hljs) return globalThis.hljs;
    return null;
  }

  // Try to apply hljs highlighting to a <code> element. Returns true on
  // success. On failure (no hljs, unknown language, hljs throws), falls
  // back to plain textContent and returns false.
  function applyHljs(codeEl, lang, source) {
    const hljs = getHljs();
    if (!hljs || typeof hljs.highlight !== 'function' || typeof hljs.getLanguage !== 'function') {
      codeEl.textContent = source;
      return false;
    }
    if (!lang) {
      codeEl.textContent = source;
      return false;
    }
    if (!hljs.getLanguage(lang)) {
      codeEl.textContent = source;
      return false;
    }
    try {
      const result = hljs.highlight(source, { language: lang, ignoreIllegals: true });
      // hljs.highlight returns {value: htmlString}. The value is sanitized
      // HTML composed of <span class="hljs-*"> tokens around escaped text.
      // Safe to assign via innerHTML.
      codeEl.innerHTML = result.value;
      return true;
    } catch (e) {
      codeEl.textContent = source;
      return false;
    }
  }

  // ── CodeBlockWidget ───────────────────────────────────────────────────
  let CodeBlockWidget = null;

  function getCodeBlockWidgetClass() {
    if (CodeBlockWidget) return CodeBlockWidget;
    if (!WidgetType) return null;

    class _CodeBlockWidget extends WidgetType {
      constructor(payload) {
        super();
        this.lang = (payload && payload.lang) ? String(payload.lang) : '';
        this.code = (payload && payload.code != null) ? String(payload.code) : '';
        // Stage G.7 — CM6 layout-space reservation (see cm6-lp-table-widget.js).
        this._lineBreaks = (payload && typeof payload.lineBreaks === 'number')
          ? payload.lineBreaks
          : 0;
      }
      // Stage G.4 — block-widget contract (see cm6-lp-table-widget.js).
      get block() { return true; }
      // Stage G.7 — see constructor.
      get lineBreaks() { return this._lineBreaks; }
      eq(other) {
        return (other instanceof _CodeBlockWidget)
          && other.lang === this.lang
          && other.code === this.code;
      }
      toDOM() {
        if (typeof document === 'undefined') return { nodeType: 1 };
        const pre = document.createElement('pre');
        pre.className = 'cm-md-lp-code-block';
        const code = document.createElement('code');
        code.className = 'hljs' + (this.lang ? (' language-' + this.lang) : '');
        applyHljs(code, this.lang, this.code);
        pre.appendChild(code);
        return pre;
      }
      ignoreEvent() { return false; }
    }

    CodeBlockWidget = _CodeBlockWidget;
    return CodeBlockWidget;
  }

  return {
    getCodeBlockWidgetClass: getCodeBlockWidgetClass,
    _applyHljs:              applyHljs,
  };
});
