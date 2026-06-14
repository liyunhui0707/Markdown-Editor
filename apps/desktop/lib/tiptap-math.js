'use strict';

/* Tiptap math nodes — KaTeX-rendered inline `$x$` and display `$$x$$`.

   Bundled into tiptap-bundle.js (imported by tiptap-entry.js). The remark
   bridge parses math via remark-math into mdast inlineMath/math nodes, and the
   converter (markdown-mdast-pm.js) maps them to these `inlineMath` / `mathBlock`
   ProseMirror nodes (atoms carrying the verbatim LaTeX in a `latex` attr). They
   exist primarily so math round-trips WITHOUT remark escaping LaTeX specials
   (`_`, `*`) — which corrupts subscripts/etc. when math is treated as text.

   Rendering uses the GLOBAL window.katex (the vendored lib/vendor/katex/
   katex.min.js + katex.min.css already loaded in index.html for the CM6 engine).
   If KaTeX is unavailable or throws, the node view falls back to showing the raw
   `$…$` source — never blank, never crash.

   These are leaf ATOM nodes (not inline-editable in v1); editing the LaTeX is a
   future concern (source mode / click-to-edit). The `latex` attr round-trips. */

import { Node, mergeAttributes } from '@tiptap/core';

function renderMath(latex, displayMode) {
  const tag = displayMode ? 'div' : 'span';
  const el = (typeof document !== 'undefined') ? document.createElement(tag) : { nodeType: 1 };
  if (typeof document === 'undefined') return el;
  el.className = displayMode ? 'tiptap-math-block' : 'tiptap-math-inline';
  el.setAttribute('data-latex', latex || '');
  el.setAttribute('contenteditable', 'false');
  const katex = (typeof window !== 'undefined') ? window.katex : null;
  if (katex && typeof katex.renderToString === 'function') {
    try {
      el.innerHTML = katex.renderToString(latex || '', {
        throwOnError: false,
        displayMode: !!displayMode,
        errorColor: '#cc0000',
        strict: 'ignore',
      });
      return el;
    } catch (err) { /* fall through to raw source */ }
  }
  const fence = displayMode ? '$$' : '$';
  el.textContent = fence + (latex || '') + fence;
  return el;
}

const latexAttr = {
  latex: {
    default: '',
    parseHTML: function (el) { return el.getAttribute('data-latex') || ''; },
    renderHTML: function (attrs) { return { 'data-latex': attrs.latex || '' }; },
  },
};

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: function () { return latexAttr; },
  parseHTML: function () { return [{ tag: 'span[data-type="inline-math"]' }]; },
  renderHTML: function (props) {
    return ['span', mergeAttributes(props.HTMLAttributes, { 'data-type': 'inline-math' })];
  },
  addNodeView: function () {
    return function (props) { return { dom: renderMath(props.node.attrs.latex, false) }; };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: function () { return latexAttr; },
  parseHTML: function () { return [{ tag: 'div[data-type="math-block"]' }]; },
  renderHTML: function (props) {
    return ['div', mergeAttributes(props.HTMLAttributes, { 'data-type': 'math-block' })];
  },
  addNodeView: function () {
    return function (props) { return { dom: renderMath(props.node.attrs.latex, true) }; };
  },
});
