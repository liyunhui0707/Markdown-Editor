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
import { GatedImage } from './tiptap-image.js';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { InlineMath, MathBlock } from './tiptap-math.js';
import { MermaidBlock } from './tiptap-mermaid.js';

import MarkdownMdastPm from './markdown-mdast-pm.js';
const { mdastToPm, pmToMdast } = MarkdownMdastPm;

import MarkdownFrontmatter from './markdown-frontmatter.js';
const { splitFrontmatter, joinFrontmatter } = MarkdownFrontmatter;

const mdParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const mdStringifier = unified().use(remarkStringify, {
  bullet: '-', fences: true, listItemIndent: 'one', rule: '-',
}).use(remarkGfm).use(remarkMath);

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
  // Image safety: rendered <img> only loads allow-listed URLs; vault-relative
  // paths resolve via the resolve-image-path IPC. Both optional (degrade to the
  // rejected placeholder for vault-relative when absent).
  const getNoteDir = (typeof o.getNoteDir === 'function') ? o.getNoteDir : null;
  const resolveImagePath = (typeof o.resolveImagePath === 'function') ? o.resolveImagePath : null;

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
      // GatedImage routes every src through the allowlist + vault-relative IPC
      // (lib/tiptap-image.js); unsafe URLs render an alt-text placeholder and
      // are never fetched. inline:true matches the converter's inline image
      // nodes (without an image extension, strict setContent rejected the whole
      // note and fell back to plain text).
      GatedImage.configure({ inline: true, allowBase64: true, getNoteDir, resolveImagePath }),
      // KaTeX-rendered math: inline `$x$` and display `$$x$$`. Atoms carrying
      // verbatim LaTeX so remark-math round-trips it without escaping.
      InlineMath,
      MathBlock,
      // Mermaid diagrams: ```mermaid blocks render as SVG (async). Round-trips
      // back to a ```mermaid fenced block.
      MermaidBlock,
    ],
    content: '', // start empty; real content is applied via the guarded setText
  });

  // Leading YAML frontmatter is kept OUT of the WYSIWYG body (remark would
  // corrupt it) and stored verbatim per the loaded note, then reattached on
  // getText. Editing frontmatter is a future source-mode concern.
  let frontmatter = '';

  function getText() {
    let body;
    try {
      body = docToMarkdown(editor.getJSON());
    } catch (err) {
      body = '';
    }
    return joinFrontmatter(frontmatter, body);
  }

  // Never-blank setText: try the real Markdown->PM doc with strict content
  // checking; on any failure fall back to a plain-text doc. emitUpdate:false so
  // a load doesn't fire onChange (which would mark the note dirty).
  function setText(text) {
    const md = (text == null) ? '' : String(text);
    const split = splitFrontmatter(md);
    frontmatter = split.frontmatter;
    const body = split.body;
    let doc = null;
    try {
      doc = markdownToDoc(body);
    } catch (err) {
      doc = null;
      if (typeof console !== 'undefined') console.warn('[tiptap] markdownToDoc threw; plain-text fallback:', err);
    }
    if (doc) {
      // 1. Strict: the doc is fully schema-valid — render it exactly.
      try {
        editor.commands.setContent(doc, { emitUpdate: false, errorOnInvalidContent: true });
        return;
      } catch (err) {
        // 2. Lenient retry: let ProseMirror NORMALIZE the doc (drop an invalid
        // mark combo or stray node) and render the rest as WYSIWYG, rather than
        // dumping the whole note to raw text. Only a catastrophic failure falls
        // through to plain text.
        if (typeof console !== 'undefined') console.warn('[tiptap] strict setContent rejected; retrying lenient:', err);
        try {
          editor.commands.setContent(doc, { emitUpdate: false });
          return;
        } catch (err2) {
          if (typeof console !== 'undefined') console.warn('[tiptap] lenient setContent also failed; plain-text fallback:', err2);
        }
      }
    }
    try {
      editor.commands.setContent(plainTextDoc(body), { emitUpdate: false });
    } catch (err) {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false });
    }
  }

  if (initialDoc) setText(initialDoc);

  if (onChange) {
    editor.on('update', function () { onChange(getText()); });
  }

  // No getState/setState: Tiptap owns its in-session history and exposes no
  // restorable model-level snapshot. The host treats their absence as "reload
  // via setText on every note switch" (see lib/note-switch-restore.js). A no-op
  // setState here previously made the host skip setText on revisit, showing the
  // previous note's content.
  return {
    view:          editor,
    getText:       getText,
    setText:       setText,
    exitWriteMode: function () { /* no-op: no inactive-block mode */ },
    focus:         function () { editor.commands.focus(); },
    destroy:       function () { editor.destroy(); },
  };
}

if (typeof window !== 'undefined') {
  window.TiptapView = { createTiptapView: createTiptapView };
}

export { createTiptapView, markdownToDoc, docToMarkdown, plainTextDoc };
