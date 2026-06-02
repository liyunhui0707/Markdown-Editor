/* lib/ai-result-panel.js
   Tiny DOM module for the AI Summarize result panel.

   F4 contract: index.html provides ONLY an empty <div id="aiSummaryPanel">.
   mount(root) creates the .ai-summary-status and .ai-summary-body children
   via document.createElement and appends them to root. The show* APIs
   operate on those children via textContent (never innerHTML).

   Works in both Node (tests inject globalThis.document) and the browser
   (loaded via <script src>; binds AiSummaryPanel onto window).
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { AiSummaryPanel: factory() };
  } else {
    root.AiSummaryPanel = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function getDocument() {
    if (typeof document !== 'undefined') return document;
    if (typeof globalThis !== 'undefined' && globalThis.document) return globalThis.document;
    throw new Error('AiSummaryPanel: document is unavailable');
  }

  let _root = null;
  let _status = null;
  let _body = null;

  function ensureChild(rootEl, className, tagName) {
    const existing = rootEl.querySelector ? rootEl.querySelector('.' + className) : null;
    if (existing) return existing;
    const el = getDocument().createElement(tagName || 'div');
    el.classList.add(className);
    rootEl.appendChild(el);
    return el;
  }

  function mount(rootEl, options) {
    if (!rootEl) throw new Error('AiSummaryPanel.mount: rootEl required');
    _root = rootEl;
    _status = ensureChild(rootEl, 'ai-summary-status');
    _body = ensureChild(rootEl, 'ai-summary-body');
    // Conditional close (×) button. Only created when the caller passes an
    // onClose callback; this preserves backwards compatibility for callers
    // (and existing tests) that don't pass options.
    if (options && typeof options.onClose === 'function') {
      const closeBtn = ensureChild(rootEl, 'ai-summary-close', 'button');
      closeBtn.textContent = '×';
      if (typeof closeBtn.setAttribute === 'function') {
        closeBtn.setAttribute('type', 'button');
        closeBtn.setAttribute('aria-label', 'Dismiss summary');
        closeBtn.setAttribute('title', 'Dismiss summary');
      }
      if (!closeBtn.__wired) {
        closeBtn.addEventListener('click', options.onClose);
        closeBtn.__wired = true;
      }
    }
  }

  function show() {
    if (!_root) return;
    _root.hidden = false;
  }

  function clearError() {
    if (_root && _root.classList) _root.classList.remove('error');
  }

  function showLoading(label) {
    if (!_root) return;
    show();
    clearError();
    // Stage A: optional label so callers (Summarize / Rewrite / future verbs)
    // can show the correct verb. Defaults to 'Summarizing…' to preserve v0.2.0
    // behavior for any caller that omits the argument.
    const text = typeof label === 'string' && label.length > 0 ? label : 'Summarizing…';
    if (_status) _status.textContent = text;
    if (_body) _body.textContent = '';
  }

  function showSummary(text) {
    if (!_root) return;
    show();
    clearError();
    if (_status) _status.textContent = '';
    if (_body) _body.textContent = typeof text === 'string' ? text : '';
  }

  function showError(message) {
    if (!_root) return;
    show();
    if (_root.classList) _root.classList.add('error');
    if (_status) _status.textContent = 'Error';
    if (_body) _body.textContent = typeof message === 'string' ? message : '';
  }

  function clear() {
    if (!_root) return;
    _root.hidden = true;
    clearError();
    if (_status) _status.textContent = '';
    if (_body) _body.textContent = '';
  }

  // Stage B D11: incremental render for the active stream. Appends to
  // body.textContent; flips status to 'Streaming…' only when status is
  // empty or one of the known loading labels (preserves any custom label
  // a caller may have set). XSS-safe via textContent.
  function appendChunk(text) {
    if (!_root) return;
    if (typeof text !== 'string') return;
    show();
    clearError();
    if (_status) {
      const cur = _status.textContent || '';
      if (cur === '' || cur === 'Summarizing…' || cur === 'Rewriting…') {
        _status.textContent = 'Streaming…';
      }
    }
    if (_body) _body.textContent = _body.textContent + text;
  }

  // Stage B D11: batch resync used when the user switches back to a note
  // whose stream is still in flight. Replaces body (not appends) with the
  // accumulator the renderer has been collecting in noteState. XSS-safe.
  function showStreamingText(text) {
    if (!_root) return;
    show();
    clearError();
    if (_status) _status.textContent = 'Streaming…';
    if (_body) _body.textContent = typeof text === 'string' ? text : '';
  }

  return { mount, showLoading, showSummary, showError, clear, appendChunk, showStreamingText };
});
