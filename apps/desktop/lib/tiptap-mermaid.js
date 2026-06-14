'use strict';

/* Tiptap Mermaid node — renders ```mermaid fenced blocks as SVG diagrams.

   Bundled into tiptap-bundle.js (imported by tiptap-entry.js). The converter
   (markdown-mdast-pm.js) maps a fenced code block whose lang is `mermaid` to a
   `mermaidBlock` ProseMirror node (block atom carrying the verbatim source in a
   `code` attr). It round-trips back to ```mermaid via the converter +
   remark-stringify, so the Markdown is unchanged.

   Rendering uses the GLOBAL window.mermaid (the vendored lib/vendor/mermaid/
   mermaid.min.js already loaded + initialized with securityLevel:'strict' in
   index.html for the CM6 engine). mermaid.render is ASYNC, so the node view
   returns its container synchronously and patches in the SVG when the Promise
   resolves; a `destroyed` flag (set in the node view's destroy lifecycle)
   makes a late callback a no-op. On any failure (mermaid missing, parse error,
   reject) it falls back to showing the raw ```mermaid source — never blank.

   Leaf ATOM node; editing the source is a future concern (source mode). */

import { Node, mergeAttributes } from '@tiptap/core';

let mermaidIdCounter = 0;
function nextId() { mermaidIdCounter += 1; return 'tiptap-mermaid-' + mermaidIdCounter; }

function showSource(dom, code) {
  if (typeof document === 'undefined') return;
  const pre = document.createElement('pre');
  pre.className = 'tiptap-mermaid-source';
  pre.textContent = '```mermaid\n' + (code || '') + '\n```';
  while (dom.firstChild) dom.removeChild(dom.firstChild);
  dom.appendChild(pre);
}

function makeMermaidView(code) {
  const dom = document.createElement('div');
  dom.className = 'tiptap-mermaid';
  dom.setAttribute('data-code', code || '');
  dom.setAttribute('contenteditable', 'false');

  let destroyed = false;
  const mermaid = (typeof window !== 'undefined') ? window.mermaid : null;

  if (mermaid && typeof mermaid.render === 'function' && String(code || '').trim()) {
    // Wrap in Promise.resolve so a SYNCHRONOUS throw from mermaid.render lands
    // in .catch rather than escaping the node view.
    Promise.resolve()
      .then(function () { return mermaid.render(nextId(), code); })
      .then(function (result) {
        if (destroyed) return;
        if (result && typeof result.svg === 'string') dom.innerHTML = result.svg;
        else showSource(dom, code);
      })
      .catch(function () { if (!destroyed) showSource(dom, code); });
  } else {
    showSource(dom, code);
  }

  return {
    dom: dom,
    destroy: function () { destroyed = true; },
  };
}

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: function () {
    return {
      code: {
        default: '',
        parseHTML: function (el) { return el.getAttribute('data-code') || ''; },
        renderHTML: function (attrs) { return { 'data-code': attrs.code || '' }; },
      },
    };
  },
  parseHTML: function () { return [{ tag: 'div[data-type="mermaid-block"]' }]; },
  renderHTML: function (props) {
    return ['div', mergeAttributes(props.HTMLAttributes, { 'data-type': 'mermaid-block' })];
  },
  addNodeView: function () {
    return function (props) {
      if (typeof document === 'undefined') return { dom: { nodeType: 1 } };
      return makeMermaidView(props.node.attrs.code);
    };
  },
});
