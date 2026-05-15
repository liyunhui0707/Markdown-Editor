'use strict';

/* Stage 25 — link-click renderer (production lift onto stage11).

   Renderer-side click-routing layer for the Cmd-click "open external
   link" interaction in hybrid-cm6 Write mode. Routes valid clicks
   through globalThis.vaultApi.openExternalLink, which is wired by the
   Stage 24.5 preload bridge to ipcMain "open-external-link", which in
   turn calls shell.openExternal in the main process. The renderer
   never imports Electron and never touches shell directly.

   Public exports:
     validateExternalUrl       — pure boolean, Q3 allowlist + rule 6.
     resolveLinkAtPos          — pure helper, syntax-tree resolution.
     isPrimaryModifier         — pure boolean, macOS Cmd-only.
     isInsideFrontmatter       — pure helper, frontmatter-region check.
     openExternalLinkViaIpc    — production IPC wrapper.
     openLinkAtCaret           — keyboard command.
     createLinkClickExtension  — CodeMirror extension factory.

   URL allowlist (Q3 from docs/rendering-policy.md):
     1. reject non-string / empty
     2. reject whitespace or any control char U+0000..U+001F / U+007F
     3. reject inputs without ":" or starting with ":"
     4. reject percent-encoded scheme letters
     5. reject schemes outside { https, mailto } case-insensitive
     6. strip leading "/" from rest-after-colon; require non-empty rest
        (rejects "https:", "https://", "https:///", "mailto:")
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6LinkClick = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Character-class regex: whitespace OR any control char U+0000..U+001F OR DEL U+007F.
  // Built with new RegExp so the source file does not need raw control bytes
  // or unicode escape source-text that downstream tooling may misinterpret.
  const FORBIDDEN_CHAR = new RegExp('[\\s\\u0000-\\u001F\\u007F]');

  // Pure: returns true iff url is a string whose scheme is an exact
  // case-insensitive match for one of {https, mailto}, and which contains
  // no whitespace, no control chars, and no percent-encoded scheme letters,
  // and whose rest-after-colon is non-empty after stripping leading slashes
  // (Stage 25 rule 6 — mirrors apps/desktop/lib/external-url.js).
  // Never normalizes or rewrites the input — yes/no only.
  function validateExternalUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    if (FORBIDDEN_CHAR.test(url)) return false;
    const colon = url.indexOf(':');
    if (colon < 1) return false;
    const scheme = url.slice(0, colon);
    if (scheme.indexOf('%') !== -1) return false;
    const lower = scheme.toLowerCase();
    if (lower !== 'https' && lower !== 'mailto') return false;
    const rest = url.slice(colon + 1).replace(/^\/+/, '');
    return rest.length > 0;
  }

  // Pure helper: resolves the syntax tree at pos and walks parents looking
  // for an enclosing inline-link node. Returns { from, to, url } when the
  // position lies inside a Link or Autolink node that owns a URL child,
  // else null. Image nodes early-return null (image is not a click-to-open
  // target). Reference-style links (Link with LinkLabel but no URL child)
  // and bare URLs (URL node with no Link/Autolink parent) return null —
  // Stage 25 deferral. The outer angle brackets around an angle-bracket
  // inline destination "[a](<url>)" are stripped from the returned url so
  // downstream callers always receive a clean scheme:rest string.
  function resolveLinkAtPos(state, pos, tree) {
    if (!state || !tree) return null;
    if (typeof pos !== 'number' || pos < 0) return null;
    if (typeof tree.resolveInner !== 'function') return null;
    if (typeof state.doc?.sliceString !== 'function') return null;

    let node = tree.resolveInner(pos, 1);
    let matched = null;
    let depth = 0;
    while (node && depth < 16) {
      if (node.name === 'Image') return null;
      if (node.name === 'Link' || node.name === 'Autolink') {
        matched = node;
        break;
      }
      node = node.parent;
      depth++;
    }
    if (matched == null) return null;

    let urlFrom = -1;
    let urlTo   = -1;
    let child = matched.firstChild;
    while (child) {
      if (child.name === 'URL') {
        urlFrom = child.from;
        urlTo   = child.to;
        break;
      }
      child = child.nextSibling;
    }
    if (urlFrom < 0) return null;

    let url = state.doc.sliceString(urlFrom, urlTo);
    if (url.length >= 2 && url[0] === '<' && url[url.length - 1] === '>') {
      url = url.slice(1, url.length - 1);
    }
    return { from: matched.from, to: matched.to, url: url };
  }

  // Pure: macOS primary modifier = metaKey (Cmd) and nothing else. Cmd-Shift,
  // Cmd-Alt, and Cmd-Ctrl combinations are reserved for editor-native
  // gestures (selection-shaping, etc.) and must not open links. Cross-
  // platform Ctrl/Cmd semantics are deferred to a future cross-platform
  // stage; this predicate is the single line a future stage must change.
  function isPrimaryModifier(event) {
    return !!(event && event.metaKey
      && !event.shiftKey && !event.altKey && !event.ctrlKey);
  }

  // Pure: detect a strict top-of-file YAML frontmatter region and return
  // true iff pos lies within it. Minimal local duplicate of
  // detectFrontmatter in apps/desktop/lib/cm6-hybrid-view.js (Stage 14.9);
  // the two helpers must stay logically identical. Strict equality on
  // "---" matches the walker's contract — no "+++", no trailing whitespace.
  function isInsideFrontmatter(state, pos) {
    if (!state || typeof pos !== 'number' || pos < 0) return false;
    const doc = state.doc;
    if (!doc || typeof doc.lines !== 'number' || doc.lines < 2) return false;
    const first = doc.line(1);
    if (!first || first.text !== '---') return false;
    for (let n = 2; n <= doc.lines; n++) {
      const ln = doc.line(n);
      if (ln && ln.text === '---') {
        return pos < ln.to;
      }
    }
    return false;
  }

  // IPC wrapper: routes the URL through the Stage 24.5 preload-mediated
  // bridge globalThis.vaultApi.openExternalLink, which contextBridge
  // installs in the renderer. The bridge calls ipcRenderer.invoke(
  // "open-external-link", url); main.js dispatches to shell.openExternal.
  //
  // Contract:
  //   absent / not-a-function       → return false (no IPC available)
  //   callable, ANY return value    → return true, called exactly once
  //   callable, synchronous throw   → return false, called once, exception
  //                                    swallowed (no propagation)
  function openExternalLinkViaIpc(url) {
    const api = (typeof globalThis !== 'undefined') ? globalThis.vaultApi : null;
    if (api && typeof api.openExternalLink === 'function') {
      try {
        api.openExternalLink(url);
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  // Keyboard command. Opens ONLY the link whose Link or Autolink node
  // contains the primary caret head. Does NOT scan the caret line for the
  // first link (that earlier-rejected design would open the wrong URL when
  // a line has multiple links). No transaction is dispatched; caret and
  // selection are preserved.
  function openLinkAtCaret(view, cm6) {
    if (!view || view.composing) return false;
    if (!cm6 || typeof cm6.syntaxTree !== 'function') return false;
    if (!view.state || !view.state.selection || !view.state.selection.main) return false;
    const pos = view.state.selection.main.head;
    if (typeof pos !== 'number' || pos < 0) return false;
    if (isInsideFrontmatter(view.state, pos)) return false;
    let tree;
    try { tree = cm6.syntaxTree(view.state); } catch (_) { return false; }
    if (!tree) return false;
    const hit = resolveLinkAtPos(view.state, pos, tree);
    if (hit == null) return false;
    if (!validateExternalUrl(hit.url)) return false;
    return openExternalLinkViaIpc(hit.url);
  }

  // Extension factory. Returns a [mousedownExt, keymapExt] array, or null
  // when the bundle is missing required surface (EditorView.domEventHandlers
  // or keymap.of). The peer contract test cm6-link-click-invariants.test.js
  // pins this file at exactly one EditorView.domEventHandlers call and
  // exactly one cm6.keymap.of call — both live below.
  function createLinkClickExtension(cm6) {
    if (!cm6 || !cm6.EditorView) return null;
    if (typeof cm6.EditorView.domEventHandlers !== 'function') return null;
    if (!cm6.keymap || typeof cm6.keymap.of !== 'function') return null;

    const mousedownExt = cm6.EditorView.domEventHandlers({
      mousedown: function (event, view) {
        if (!event || event.button !== 0) return false;
        if (!isPrimaryModifier(event)) return false;
        if (!view || view.composing) return false;
        if (typeof view.posAtCoords !== 'function') return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        if (isInsideFrontmatter(view.state, pos)) return false;
        let tree;
        try {
          tree = (typeof cm6.syntaxTree === 'function') ? cm6.syntaxTree(view.state) : null;
        } catch (_) {
          return false;
        }
        if (!tree) return false;
        const hit = resolveLinkAtPos(view.state, pos, tree);
        if (hit == null) return false;
        if (!validateExternalUrl(hit.url)) return false;
        const ok = openExternalLinkViaIpc(hit.url);
        if (!ok) return false;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        return true;
      },
    });

    const keymapExt = cm6.keymap.of([
      { key: 'Mod-Shift-o', run: function (view) { return openLinkAtCaret(view, cm6); } },
    ]);

    return [mousedownExt, keymapExt];
  }

  return {
    validateExternalUrl:      validateExternalUrl,
    resolveLinkAtPos:         resolveLinkAtPos,
    isPrimaryModifier:        isPrimaryModifier,
    isInsideFrontmatter:      isInsideFrontmatter,
    openExternalLinkViaIpc:   openExternalLinkViaIpc,
    openLinkAtCaret:          openLinkAtCaret,
    createLinkClickExtension: createLinkClickExtension,
  };
});
