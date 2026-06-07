'use strict';

/* WYSIWYG (ProseMirror/Tiptap) Write engine — bundle entry.

   Post-G.13 pivot (see memory project_wysiwyg_prosemirror_pivot): this engine
   edits a ProseMirror document directly via Tiptap instead of toggling CM6
   decorations (which hit an inherent reflow ceiling on tall blocks). Markdown
   stays the source of truth.

   MARKDOWN BRIDGE: a `remark` (unified) pipeline + the pure mdast<->ProseMirror
   converter in markdown-mdast-pm.js. Replaces tiptap-markdown, which lost GFM
   task-list checkboxes on Tiptap 3. Round-trip is remark-NORMALIZED, not
   byte-identical (accepted tradeoff).

   NEVER-BLANK GUARD (the regression fix): Tiptap 3's setContent silently drops
   content the schema rejects (enableContentCheck is off by default), which can
   empty the editor. So setText (and the initial load) call setContent with
   `errorOnInvalidContent: true` inside try/catch; on ANY failure they fall back
   to a plain-text doc built from the raw Markdown — the editor is never blank.
   `emitUpdate: false` keeps loading a note from marking it dirty.

   Bundled by `npm run build:tiptap` into lib/tiptap-bundle.js; loaded via a
   <script> tag in index.html. Exposes window.TiptapView.createTiptapView.

   SLICE SCOPE: paragraphs, headings, bold/italic/inline-code/strike, links,
   lists, task lists, blockquote, fenced code, hr, GFM tables. Math / mermaid
   degrade to fenced code / text; per-column table alignment is deferred. */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Image } from '@tiptap/extension-image';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';

import MarkdownMdastPm from './markdown-mdast-pm.js';
const { mdastToPm, pmToMdast } = MarkdownMdastPm;

const mdParser = unified().use(remarkParse).use(remarkGfm);
const mdStringifier = unified().use(remarkStringify, {
  bullet: '-', fences: true, listItemIndent: 'one', rule: '-',
}).use(remarkGfm);

function markdownToDoc(md) {
  const tree = mdParser.parse(md == null ? '' : String(md));
  return mdastToPm(tree);
}

function docToMarkdown(json) {
  return String(mdStringifier.stringify(pmToMdast(json)));
}

// Guaranteed-valid fallback: each blank-line-separated block becomes a
// paragraph of plain text. Used when remark/conversion/setContent fails so the
// editor renders the raw content rather than going blank.
function plainTextDoc(md) {
  const s = (md == null) ? '' : String(md);
  const blocks = s.split(/\n{2,}/);
  const content = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    content.push(b ? { type: 'paragraph', content: [{ type: 'text', text: b }] }
                   : { type: 'paragraph' });
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function createTiptapView(parent, opts) {
  const o = opts || {};
  const onChange = (typeof o.onChange === 'function') ? o.onChange : null;
  const initialDoc = (o.initialDoc != null) ? String(o.initialDoc) : '';

  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      // Inline images (the converter emits image nodes inside paragraphs).
      // inline:true matches that; without this extension, strict setContent
      // rejected the whole note and fell back to plain text (raw Markdown).
      Image.configure({ inline: true, allowBase64: true }),
    ],
    content: '', // start empty; real content is applied via the guarded setText
  });

  function getText() {
    try {
      return docToMarkdown(editor.getJSON());
    } catch (err) {
      return '';
    }
  }

  // Never-blank setText: try the real Markdown->PM doc with strict content
  // checking; on any failure fall back to a plain-text doc. emitUpdate:false so
  // a load doesn't fire onChange (which would mark the note dirty).
  function setText(text) {
    const md = (text == null) ? '' : String(text);
    let doc = null;
    try { doc = markdownToDoc(md); } catch (err) { doc = null; }
    if (doc) {
      try {
        editor.commands.setContent(doc, { emitUpdate: false, errorOnInvalidContent: true });
        return;
      } catch (err) {
        // Schema rejected the converted doc — fall through to plain text.
      }
    }
    try {
      editor.commands.setContent(plainTextDoc(md), { emitUpdate: false });
    } catch (err) {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false });
    }
  }

  if (initialDoc) setText(initialDoc);

  if (onChange) {
    editor.on('update', function () { onChange(getText()); });
  }

  return {
    view:          editor,
    getText:       getText,
    setText:       setText,
    getState:      function () { return editor.state; },
    setState:      function () { /* no-op: Tiptap owns its state */ },
    exitWriteMode: function () { /* no-op: no inactive-block mode */ },
    focus:         function () { editor.commands.focus(); },
    destroy:       function () { editor.destroy(); },
  };
}

if (typeof window !== 'undefined') {
  window.TiptapView = { createTiptapView: createTiptapView };
}

export { createTiptapView, markdownToDoc, docToMarkdown, plainTextDoc };
