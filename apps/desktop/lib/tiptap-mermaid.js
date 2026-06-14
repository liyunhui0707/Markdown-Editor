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

// PERF: cache rendered SVG by source. mermaid.render is CPU-heavy and runs on
// the main thread; without a cache, every note switch (ProseMirror re-renders
// the whole doc) re-renders all diagrams, which is the dominant switch lag.
// Switching back to a note now reuses the cached SVG instantly. (Bounded-ish:
// keyed by distinct diagram source seen this session.)
const svgCache = new Map();

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

  const src = String(code || '');
  let destroyed = false;

  // Cache hit -> render instantly, no mermaid.render cost (the switch-lag fix).
  if (svgCache.has(src)) {
    dom.innerHTML = svgCache.get(src);
    return { dom: dom, destroy: function () { destroyed = true; } };
  }

  const mermaid = (typeof window !== 'undefined') ? window.mermaid : null;
  if (mermaid && typeof mermaid.render === 'function' && src.trim()) {
    showSource(dom, src); // brief placeholder until the deferred render lands
    // DEFER to a macrotask so the note switch PAINTS first; the heavy render
    // then fills the diagram in progressively instead of blocking the switch.
    setTimeout(function () {
      if (destroyed) return;
      Promise.resolve()
        .then(function () { return mermaid.render(nextId(), src); })
        .then(function (result) {
          if (destroyed) return;
          if (result && typeof result.svg === 'string') {
            svgCache.set(src, result.svg);
            dom.innerHTML = result.svg;
          } else {
            showSource(dom, src);
          }
        })
        .catch(function () { if (!destroyed) showSource(dom, src); });
    }, 0);
  } else {
    showSource(dom, src);
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
