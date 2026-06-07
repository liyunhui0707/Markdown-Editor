'use strict';

/* WYSIWYG (ProseMirror/Tiptap) Write engine — bundle entry.

   First slice of the post-G.13 pivot (see memory project_wysiwyg_prosemirror_
   pivot): instead of CM6 decorations toggling render↔source inline (which hit
   an inherent reflow ceiling on tall blocks), this engine edits a ProseMirror
   document directly via Tiptap. Markdown stays the source of truth: content
   loads from a Markdown string and `getText()` serializes back to Markdown
   (round-trip is remark/markdown-it-NORMALIZED, not byte-identical — a
   deliberate, accepted tradeoff of this model).

   This entry is bundled by `npm run build:tiptap` into lib/tiptap-bundle.js
   (esbuild IIFE) and loaded via a <script> tag in index.html, mirroring how
   cm6-entry.js → cm6-bundle.js works. It exposes:

     window.TiptapView.createTiptapView(parent, opts) -> {
       view, getText, setText, getState, setState, exitWriteMode, focus, destroy
     }

   The return shape matches the CM6 engine factories so the renderer can mount
   it through the same engine-selection path.

   SLICE SCOPE: paragraphs, headings, bold/italic/inline-code, lists,
   blockquote, fenced code, hr (StarterKit defaults). Tables / math / mermaid
   are deferred to later slices. */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

function createTiptapView(parent, opts) {
  const o = opts || {};
  const onChange = (typeof o.onChange === 'function') ? o.onChange : null;
  const initialDoc = (o.initialDoc != null) ? String(o.initialDoc) : '';

  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit,
      // tiptap-markdown: parse string `content` as Markdown on load, and
      // expose editor.storage.markdown.getMarkdown() for serialization.
      Markdown.configure({
        html: false,            // do not pass raw HTML through
        tightLists: true,
        bulletListMarker: '-',
        linkify: false,
        breaks: false,
      }),
    ],
    content: initialDoc,
  });

  function getText() {
    try {
      return editor.storage.markdown.getMarkdown();
    } catch (err) {
      return '';
    }
  }

  function setText(text) {
    const md = (text == null) ? '' : String(text);
    // setContent with a Markdown string; the Markdown extension parses it.
    editor.commands.setContent(md, false);
  }

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

export { createTiptapView };
