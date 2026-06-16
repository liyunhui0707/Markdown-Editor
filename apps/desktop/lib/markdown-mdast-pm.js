'use strict';

/* Markdown bridge — pure mdast <-> ProseMirror(JSON) converters.

   Part of the remark bridge that replaces tiptap-markdown (which lost GFM
   task-list checkboxes on Tiptap 3 — see memory project_wysiwyg_prosemirror_
   pivot). Pipeline:

     load:  markdown --remark-parse+gfm--> mdast --mdastToPm--> PM doc JSON
     save:  PM doc JSON --pmToMdast--> mdast --remark-stringify+gfm--> markdown

   This module owns ONLY the middle (mdast <-> PM JSON) conversion. It is a
   PURE object transform with NO dependency on remark or the DOM, so it is
   testable with the plain Node test runner.

   TOTALITY (the blank-editor fix): the converter NEVER throws and NEVER emits
   a doc that empties the editor. Every mdast block maps to a valid PM node;
   unknown / value-only nodes (e.g. raw `html`, `yaml`) degrade to a VISIBLE
   paragraph of their text rather than being silently dropped. The doc always
   has at least one block. (A second guard — try/catch around setContent —
   lives in tiptap-entry.js.)

   Coverage (CommonMark + GFM): paragraph, heading, blockquote, bulletList,
   orderedList, taskList, listItem, taskItem, codeBlock, horizontalRule, table;
   marks bold/italic/code/strike/link; inline image + hardBreak. Raw HTML and
   any unknown node degrade to text. Known limitation: per-column table
   ALIGNMENT is not preserved (cells default to left). */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkdownMdastPm = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── mdast -> ProseMirror JSON ─────────────────────────────────────────

  function addMark(marks, mark) { return marks.concat([mark]); }

  function cloneMark(m) {
    return m.attrs ? { type: m.type, attrs: Object.assign({}, m.attrs) } : { type: m.type };
  }

  // The markdown the current mdast tree was parsed from. Set at the start of
  // mdastToPm and read by verbatim() to slice the source of nodes that have no
  // `.value` (linkReference, definition, footnotes). Synchronous, non-reentrant.
  let currentSource = null;

  // Returns the VERBATIM markdown source for a node the converter does not
  // richly map, or null when it cannot be captured safely. Prefers node.value
  // (raw HTML carries it); else slices the original source by position offsets,
  // with strict bounds so a malformed position can never capture the whole doc.
  function verbatim(node) {
    if (node && typeof node.value === 'string') return node.value;
    const src = currentSource;
    if (typeof src !== 'string') return null;
    const pos = node && node.position;
    if (!pos || !pos.start || !pos.end) return null;
    const a = pos.start.offset, b = pos.end.offset;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a < 0 || b < a || b > src.length) return null;
    return src.slice(a, b);
  }

  // An inline raw atom carrying verbatim source. Marks (bold/italic/...) are
  // preserved so e.g. `**[x][r]**` keeps its emphasis on save.
  function rawInlineNode(raw, marks) {
    const n = { type: 'rawInline', attrs: { raw: raw } };
    if (marks && marks.length) n.marks = marks.map(cloneMark);
    return n;
  }

  function textNode(text, marks) {
    const t = { type: 'text', text: text };
    let ms = marks;
    if (ms && ms.length) {
      // The Tiptap `code` mark is EXCLUSIVE (excludes all other marks), so
      // `**`x`**` (bold+code) is not representable in the schema and would make
      // setContent reject the whole doc. When code is present, keep only code.
      if (ms.some(function (m) { return m.type === 'code'; })) {
        ms = ms.filter(function (m) { return m.type === 'code'; });
      }
      t.marks = ms.map(cloneMark);
    }
    return t;
  }

  function inlineToPm(node, marks) {
    if (!node) return [];
    switch (node.type) {
      case 'text':
        return node.value ? [textNode(node.value, marks)] : [];
      case 'emphasis':
        return inlineChildren(node, addMark(marks, { type: 'italic' }));
      case 'strong':
        return inlineChildren(node, addMark(marks, { type: 'bold' }));
      case 'delete':
        return inlineChildren(node, addMark(marks, { type: 'strike' }));
      case 'inlineCode':
        return [textNode(node.value || '', addMark(marks, { type: 'code' }))];
      case 'link':
        return inlineChildren(node, addMark(marks, {
          type: 'link', attrs: { href: node.url || '', title: node.title || null },
        }));
      case 'image':
        return [{ type: 'image', attrs: { src: node.url || '', alt: node.alt || null, title: node.title || null } }];
      case 'inlineMath':
        // remark-math node; an atom carrying verbatim LaTeX so it round-trips
        // WITHOUT remark escaping `_`/`*` (which corrupts LaTeX subscripts etc.).
        return [{ type: 'inlineMath', attrs: { latex: node.value || '' } }];
      case 'break':
        return [{ type: 'hardBreak' }];
      case 'html': {
        // Inline raw HTML (e.g. `<kbd>`): preserve verbatim so it isn't escaped.
        const raw = verbatim(node);
        return raw ? [rawInlineNode(raw, marks)]
                   : (typeof node.value === 'string' && node.value ? [textNode(node.value, marks)] : []);
      }
      case 'linkReference':
      case 'imageReference':
      case 'footnoteReference': {
        // Reference-style link/image + footnote marker: preserve the VERBATIM
        // `[..][r]` / `[^1]` source (do NOT recurse children — that loses the
        // reference + URL). Falls back to text only when source is unavailable.
        const raw = verbatim(node);
        if (raw) return [rawInlineNode(raw, marks)];
        return Array.isArray(node.children) ? inlineChildren(node, marks) : [];
      }
      default:
        // Unknown inline: recurse children, else emit its raw text — never drop.
        if (Array.isArray(node.children)) return inlineChildren(node, marks);
        if (typeof node.value === 'string' && node.value) return [textNode(node.value, marks)];
        return [];
    }
  }

  function inlineChildren(node, marks) {
    const out = [];
    const kids = node.children || [];
    for (let i = 0; i < kids.length; i++) {
      const pm = inlineToPm(kids[i], marks);
      for (let j = 0; j < pm.length; j++) out.push(pm[j]);
    }
    return out;
  }

  function blockChildren(node) {
    const out = [];
    const kids = node.children || [];
    for (let i = 0; i < kids.length; i++) {
      const pm = blockToPm(kids[i]);
      if (pm) out.push(pm);
    }
    return out;
  }

  function itemContent(item) {
    const blocks = blockChildren(item);
    return blocks.length ? blocks : [{ type: 'paragraph' }];
  }

  function listToPm(node) {
    const items = node.children || [];
    const isTask = items.some(function (it) { return it.checked === true || it.checked === false; });
    if (isTask) {
      return {
        type: 'taskList',
        content: items.map(function (it) {
          return { type: 'taskItem', attrs: { checked: it.checked === true }, content: itemContent(it) };
        }),
      };
    }
    const out = {
      type: node.ordered ? 'orderedList' : 'bulletList',
      content: items.map(function (it) { return { type: 'listItem', content: itemContent(it) }; }),
    };
    if (node.ordered && node.start != null && node.start !== 1) out.attrs = { start: node.start };
    return out;
  }

  function tableToPm(node) {
    const rows = node.children || [];
    return {
      type: 'table',
      content: rows.map(function (row, ri) {
        const cells = row.children || [];
        return {
          type: 'tableRow',
          content: cells.map(function (cell) {
            return {
              type: ri === 0 ? 'tableHeader' : 'tableCell',
              content: [{ type: 'paragraph', content: inlineChildren(cell, []) }],
            };
          }),
        };
      }),
    };
  }

  function blockToPm(node) {
    if (!node) return null;
    switch (node.type) {
      case 'paragraph':
        return { type: 'paragraph', content: inlineChildren(node, []) };
      case 'heading':
        return { type: 'heading', attrs: { level: clampLevel(node.depth) }, content: inlineChildren(node, []) };
      case 'blockquote':
        return { type: 'blockquote', content: blockChildrenOrEmpty(node) };
      case 'thematicBreak':
        return { type: 'horizontalRule' };
      case 'code':
        // A ```mermaid fenced block becomes a rendered mermaidBlock node;
        // every other fenced block stays a codeBlock.
        if (String(node.lang || '').toLowerCase() === 'mermaid') {
          return { type: 'mermaidBlock', attrs: { code: node.value || '' } };
        }
        return {
          type: 'codeBlock',
          attrs: { language: node.lang || null },
          content: node.value ? [{ type: 'text', text: node.value }] : [],
        };
      case 'list':
        return listToPm(node);
      case 'table':
        return tableToPm(node);
      case 'math':
        // remark-math display block; atom carrying verbatim LaTeX (see inlineMath).
        return { type: 'mathBlock', attrs: { latex: node.value || '' } };
      case 'html': {
        // Raw block HTML: preserve verbatim (round-trips as an mdast html node,
        // not escaped text). Falls back to visible text if value is missing.
        const raw = verbatim(node);
        return raw ? { type: 'rawBlock', attrs: { raw: raw } }
                   : (node.value ? { type: 'paragraph', content: [textNode(node.value, [])] } : null);
      }
      case 'definition':
      case 'footnoteDefinition': {
        // Link/footnote definitions (`[r]: url`, `[^1]: …`): preserve verbatim
        // so the URL / footnote body survives (was dropped/flattened before).
        const raw = verbatim(node);
        if (raw) return { type: 'rawBlock', attrs: { raw: raw } };
        // No source (compat path): a footnoteDefinition holds BLOCK children
        // (paragraphs/lists); convert them through the block path (wrapped in a
        // blockquote) so the body content is not dropped. `definition` has no
        // children, so its URL is unrecoverable without source -> null.
        if (Array.isArray(node.children) && node.children.length) {
          return { type: 'blockquote', content: blockChildrenOrEmpty(node) };
        }
        return null;
      }
      default:
        // Unknown block: keep the existing visible-text fallback (the confirmed
        // lossy nodes — html, definition, footnoteDefinition — are handled above).
        if (Array.isArray(node.children)) return { type: 'paragraph', content: inlineChildren(node, []) };
        if (typeof node.value === 'string' && node.value) {
          return { type: 'paragraph', content: [textNode(node.value, [])] };
        }
        return null;
    }
  }

  function clampLevel(depth) {
    const n = depth || 1;
    return n < 1 ? 1 : (n > 6 ? 6 : n);
  }

  function blockChildrenOrEmpty(node) {
    const blocks = blockChildren(node);
    return blocks.length ? blocks : [{ type: 'paragraph' }];
  }

  function mdastToPm(root, source) {
    // `source` (optional) is the markdown `root` was parsed from; it lets
    // verbatim() slice the original text for nodes with no `.value`. Without it,
    // value-bearing nodes (raw HTML) still round-trip; offset-only nodes degrade
    // to the text fallback (back-compat for the pure unit tests).
    currentSource = (typeof source === 'string') ? source : null;
    try {
      const content = (root && root.children) ? blockChildren(root) : [];
      return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
    } finally {
      currentSource = null;
    }
  }

  // ── ProseMirror JSON -> mdast ─────────────────────────────────────────

  const WRAP_ORDER = ['italic', 'bold', 'strike', 'link'];

  // Wrap a base mdast node in emphasis/strong/delete/link per the PM marks.
  function wrapMarks(base, marks) {
    let node = base;
    for (let i = 0; i < WRAP_ORDER.length; i++) {
      const type = WRAP_ORDER[i];
      const mark = (marks || []).find(function (m) { return m.type === type; });
      if (!mark) continue;
      if (type === 'italic')      node = { type: 'emphasis', children: [node] };
      else if (type === 'bold')   node = { type: 'strong', children: [node] };
      else if (type === 'strike') node = { type: 'delete', children: [node] };
      else if (type === 'link')   node = {
        type: 'link', url: (mark.attrs && mark.attrs.href) || '',
        title: (mark.attrs && mark.attrs.title) || null, children: [node],
      };
    }
    return node;
  }

  function wrapInline(textValue, marks) {
    marks = marks || [];
    const hasCode = marks.some(function (m) { return m.type === 'code'; });
    const base = hasCode ? { type: 'inlineCode', value: textValue }
                         : { type: 'text', value: textValue };
    return wrapMarks(base, marks);
  }

  function pmInlineToMdast(content) {
    const out = [];
    const nodes = content || [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === 'text') {
        if (n.text == null || n.text === '') continue;
        out.push(wrapInline(n.text, n.marks));
      } else if (n.type === 'rawInline') {
        // Verbatim source re-emitted as an inline html node (remark passes it
        // through raw), re-wrapped in any marks it carried (e.g. `**[x][r]**`).
        out.push(wrapMarks({ type: 'html', value: (n.attrs && n.attrs.raw) || '' }, n.marks));
      } else if (n.type === 'image') {
        out.push({ type: 'image', url: (n.attrs && n.attrs.src) || '', alt: (n.attrs && n.attrs.alt) || null, title: (n.attrs && n.attrs.title) || null });
      } else if (n.type === 'inlineMath') {
        out.push({ type: 'inlineMath', value: (n.attrs && n.attrs.latex) || '' });
      } else if (n.type === 'hardBreak') {
        out.push({ type: 'break' });
      }
    }
    return out;
  }

  function textOf(content) {
    let s = '';
    const nodes = content || [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].type === 'text' && nodes[i].text) s += nodes[i].text;
    }
    return s;
  }

  function pmBlocksToMdast(content) {
    const out = [];
    const nodes = content || [];
    for (let i = 0; i < nodes.length; i++) {
      const m = pmBlockToMdast(nodes[i]);
      if (m) out.push(m);
    }
    return out;
  }

  function listItemsToMdast(node, asTask) {
    const items = node.content || [];
    return items.map(function (it) {
      return {
        type: 'listItem', spread: false,
        checked: asTask ? !!(it.attrs && it.attrs.checked) : null,
        children: pmBlocksToMdast(it.content),
      };
    });
  }

  function pmTableToMdast(node) {
    const rows = node.content || [];
    return {
      type: 'table', align: [],
      children: rows.map(function (row) {
        const cells = row.content || [];
        return {
          type: 'tableRow',
          children: cells.map(function (cell) {
            const firstPara = (cell.content && cell.content[0]) ? cell.content[0].content : [];
            return { type: 'tableCell', children: pmInlineToMdast(firstPara) };
          }),
        };
      }),
    };
  }

  function pmBlockToMdast(node) {
    if (!node) return null;
    switch (node.type) {
      case 'paragraph':
        return { type: 'paragraph', children: pmInlineToMdast(node.content) };
      case 'heading':
        return { type: 'heading', depth: (node.attrs && node.attrs.level) || 1, children: pmInlineToMdast(node.content) };
      case 'blockquote':
        return { type: 'blockquote', children: pmBlocksToMdast(node.content) };
      case 'horizontalRule':
        return { type: 'thematicBreak' };
      case 'codeBlock':
        return { type: 'code', lang: (node.attrs && node.attrs.language) || null, value: textOf(node.content) };
      case 'bulletList':
        return { type: 'list', ordered: false, spread: false, children: listItemsToMdast(node, false) };
      case 'orderedList':
        return { type: 'list', ordered: true, start: (node.attrs && node.attrs.start) || 1, spread: false, children: listItemsToMdast(node, false) };
      case 'taskList':
        return { type: 'list', ordered: false, spread: false, children: listItemsToMdast(node, true) };
      case 'table':
        return pmTableToMdast(node);
      case 'mathBlock':
        return { type: 'math', value: (node.attrs && node.attrs.latex) || '' };
      case 'mermaidBlock':
        return { type: 'code', lang: 'mermaid', value: (node.attrs && node.attrs.code) || '' };
      case 'rawBlock':
        // Verbatim source re-emitted as a block html node (remark raw passthrough).
        return { type: 'html', value: (node.attrs && node.attrs.raw) || '' };
      default:
        if (Array.isArray(node.content)) return { type: 'paragraph', children: pmInlineToMdast(node.content) };
        return null;
    }
  }

  function pmToMdast(doc) {
    return { type: 'root', children: pmBlocksToMdast(doc && doc.content) };
  }

  return { mdastToPm: mdastToPm, pmToMdast: pmToMdast };
});
