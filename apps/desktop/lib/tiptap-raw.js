'use strict';

/* Tiptap raw passthrough nodes — verbatim preservation of Markdown the bridge
   does not richly map (raw HTML, reference-style links/images, footnotes, any
   unknown construct).

   Without these, the converter (markdown-mdast-pm.js) degraded such constructs
   to plain text or dropped them, and since the tiptap save path writes the
   round-trip back to disk, opening + editing a note SILENTLY corrupted it
   (escaped HTML, LOST reference-link URLs, dropped footnotes).

   The converter now captures the verbatim source of those nodes into these
   atoms; on save they re-emit as an mdast `html` node, which remark-stringify
   passes through verbatim (probe-confirmed) — so the constructs survive
   byte-stable and round-trip idempotently.

   DISPLAY: the verbatim text is shown as literal source (monospace, muted) via
   textContent — NEVER executed as HTML (no XSS surface; honest about raw source).
   Editing raw constructs in-place is a future concern (source mode). */

import { Node, mergeAttributes } from '@tiptap/core';

function renderRaw(raw, block) {
  const tag = block ? 'div' : 'span';
  const el = (typeof document !== 'undefined') ? document.createElement(tag) : { nodeType: 1 };
  if (typeof document === 'undefined') return el;
  el.className = block ? 'tiptap-raw-block' : 'tiptap-raw-inline';
  el.setAttribute('contenteditable', 'false');
  el.textContent = (raw == null) ? '' : String(raw); // XSS-safe: never innerHTML
  return el;
}

const rawAttr = {
  raw: {
    default: '',
    parseHTML: function (el) { return el.getAttribute('data-raw') || ''; },
    renderHTML: function (attrs) { return { 'data-raw': attrs.raw || '' }; },
  },
};

// Inline atom. Marks are NOT restricted, so it can carry bold/italic/strike/link
// when a raw construct sits inside emphasis (e.g. `**[x][r]**`) — those marks are
// re-wrapped around the emitted html node on save.
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  // Explicitly allow all marks so a raw inline inside emphasis (e.g. `**[x][r]**`)
  // keeps its bold/italic/strike/link on save. (Inline nodes already default to
  // allowing all marks; this makes the contract explicit and robust.)
  marks: '_',
  addAttributes: function () { return rawAttr; },
  parseHTML: function () { return [{ tag: 'span[data-type="raw-inline"]' }]; },
  renderHTML: function (props) {
    return ['span', mergeAttributes(props.HTMLAttributes, { 'data-type': 'raw-inline' })];
  },
  addNodeView: function () {
    return function (props) { return { dom: renderRaw(props.node.attrs.raw, false) }; };
  },
});

export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: function () { return rawAttr; },
  parseHTML: function () { return [{ tag: 'div[data-type="raw-block"]' }]; },
  renderHTML: function (props) {
    return ['div', mergeAttributes(props.HTMLAttributes, { 'data-type': 'raw-block' })];
  },
  addNodeView: function () {
    return function (props) { return { dom: renderRaw(props.node.attrs.raw, true) }; };
  },
});

export default { RawInline: RawInline, RawBlock: RawBlock };
