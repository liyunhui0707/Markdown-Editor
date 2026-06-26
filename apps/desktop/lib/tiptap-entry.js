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
import { Slice, Fragment } from '@tiptap/pm/model';
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
import { RawInline, RawBlock } from './tiptap-raw.js';

import MarkdownMdastPm from './markdown-mdast-pm.js';
const { mdastToPm, pmToMdast } = MarkdownMdastPm;

import MarkdownFrontmatter from './markdown-frontmatter.js';
const { splitFrontmatter, joinFrontmatter } = MarkdownFrontmatter;

import TiptapSourceToggle from './tiptap-source-toggle.js';
const { createSourceToggle } = TiptapSourceToggle;

import TiptapImagePaste from './tiptap-image-paste.js';
const { detectImageTransfer, handleImageDataTransfer, isDataUriSrc } = TiptapImagePaste;

// Drop image nodes whose resolved src is a data: URI from a parsed paste slice.
// Operates on the PARSED slice (not raw HTML) so entity-encoded / mixed-case data
// URIs can't slip a base64 image into the doc on a non-pure (HTML) paste/drop.
function dropDataImageFragment(fragment) {
  const kept = [];
  fragment.forEach(function (node) {
    if (node.type && node.type.name === 'image' && node.attrs && isDataUriSrc(node.attrs.src)) return; // drop
    if (node.content && node.content.size) node = node.copy(dropDataImageFragment(node.content));
    kept.push(node);
  });
  return Fragment.fromArray(kept);
}
function dropDataImageSlice(slice) {
  try {
    return new Slice(dropDataImageFragment(slice.content), slice.openStart, slice.openEnd);
  } catch (_e) {
    return slice; // never break a paste — worst case ProseMirror handles it
  }
}

const mdParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const mdStringifier = unified().use(remarkStringify, {
  bullet: '-', fences: true, listItemIndent: 'one', rule: '-',
}).use(remarkGfm).use(remarkMath);

function markdownToDoc(md) {
  const src = (md == null) ? '' : String(md);
  const tree = mdParser.parse(src);
  // Pass the source so the converter can preserve verbatim the constructs it
  // doesn't richly map (raw HTML, reference links/footnotes) instead of losing them.
  return mdastToPm(tree, src);
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
  // Note IDENTITY (full path) for the paste note-switch guard; distinguishes two
  // notes in the same directory. Falls back to getNoteDir inside the paste helper.
  const getNoteId = (typeof o.getNoteId === 'function') ? o.getNoteId : null;
  const resolveImagePath = (typeof o.resolveImagePath === 'function') ? o.resolveImagePath : null;
  // Image paste/drop: save the blob to the vault + insert a `./assets/...` reference
  // instead of inlining a ~1.5MB base64 data URI (which bloated the editor + .md file).
  const saveImageToVault = (typeof o.saveImageToVault === 'function') ? o.saveImageToVault : null;

  // Insert a gated image node referencing the saved file, at a clamped position.
  // Never inlines base64 — on any failure the paste is simply dropped.
  function insertImageAt(relPath, pos) {
    try {
      const size = editor.state.doc.content.size;
      const at = Math.max(0, Math.min(typeof pos === 'number' ? pos : size, size));
      editor.chain().insertContentAt(at, { type: 'image', attrs: { src: relPath } }).run();
    } catch (err) { /* swallow — never fall back to base64 */ }
  }

  function handleImagePasteOrDrop(dataTransfer, pos) {
    if (!saveImageToVault) return false;
    const det = detectImageTransfer(dataTransfer);
    // Only intercept a PURE-image transfer (images + no text). Consume the event
    // whenever it is pure — even if every image was rejected for size — so an
    // oversized image is dropped, NEVER inlined as base64. Mixed image+text and
    // pure-text pastes fall through to ProseMirror (no text loss).
    if (!det.pure) return false;
    handleImageDataTransfer({
      blobs: det.blobs,
      getNoteDir: getNoteDir || function () { return ''; },
      getNoteId: getNoteId || getNoteDir || function () { return ''; },
      saveImageToVault: saveImageToVault,
      insertImageAt: insertImageAt,
    }, { pos: pos });
    return true;
  }

  const editor = new Editor({
    element: parent,
    // Intercept image paste/drop BEFORE ProseMirror inlines it as base64.
    editorProps: {
      handlePaste: function (view, event) {
        const pos = view.state.selection.from;
        if (handleImagePasteOrDrop(event.clipboardData, pos)) { event.preventDefault(); return true; }
        return false;
      },
      handleDrop: function (view, event) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const pos = coords ? coords.pos : view.state.selection.from;
        if (handleImagePasteOrDrop(event.dataTransfer, pos)) { event.preventDefault(); return true; }
        return false;
      },
      // Non-pure pastes/drops (HTML with text) fall through to ProseMirror — drop
      // any data: image node from the PARSED slice so a web-copied image can't be
      // inlined as base64 (robust vs. entity-encoded / mixed-case bypasses).
      transformPasted: function (slice) { return dropDataImageSlice(slice); },
    },
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
      // Verbatim passthrough for constructs the bridge doesn't richly map (raw
      // HTML, reference links/images, footnotes). Shown as literal source; they
      // survive load->save instead of being escaped/flattened/dropped.
      RawInline,
      RawBlock,
    ],
    content: '', // start empty; real content is applied via the guarded setText
  });

  // Leading YAML frontmatter is kept OUT of the WYSIWYG body (remark would
  // corrupt it) and stored verbatim per the loaded note, then reattached on
  // getText. Editing frontmatter is a future source-mode concern.
  let frontmatter = '';

  // Full markdown of the rich (ProseMirror) document, frontmatter reattached.
  function getRichMarkdown() {
    let body;
    try {
      body = docToMarkdown(editor.getJSON());
    } catch (err) {
      body = '';
    }
    return joinFrontmatter(frontmatter, body);
  }

  // Never-blank: try the real Markdown->PM doc with strict content checking; on
  // any failure fall back to a plain-text doc. emitUpdate:false so a load doesn't
  // fire onChange (which would mark the note dirty).
  function applyMarkdownToEditor(text) {
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

  // Source <-> WYSIWYG toggle. An editable raw-markdown <textarea> sits beside the
  // rich editor; the toggle swaps which is visible, sharing the same markdown.
  const sourceTextarea = (typeof document !== 'undefined') ? document.createElement('textarea') : null;
  if (sourceTextarea) {
    sourceTextarea.className = 'tiptap-source';
    sourceTextarea.style.display = 'none';
    parent.appendChild(sourceTextarea);
  }
  const onModeChange = (typeof o.onModeChange === 'function') ? o.onModeChange : null;
  const toggle = createSourceToggle({
    textarea: sourceTextarea,
    richDom: editor.view.dom,
    getRichMarkdown: getRichMarkdown,
    applyMarkdown: applyMarkdownToEditor,
    onChange: onChange,
    onModeChange: onModeChange,
  });
  if (sourceTextarea) {
    sourceTextarea.addEventListener('input', function () { toggle.handleInput(); });
  }

  // Active surface is the source of truth.
  function getText() { return toggle.getText(); }

  // Note load/switch: reset to rich WITHOUT applying the (outgoing note's) source
  // textarea, then load the incoming markdown.
  function setText(text) {
    toggle.resetToRich();
    applyMarkdownToEditor(text);
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
    setSourceMode: toggle.setSourceMode,
    isSourceMode:  toggle.isSourceMode,
    // Flush hook: commit any source-mode textarea edits into the rich document so
    // rich-model serialization paths (called before save/switch/preview) are current.
    exitWriteMode: function () { toggle.commitSource(); },
    focus:         function () { editor.commands.focus(); },
    destroy:       function () { editor.destroy(); },
  };
}

if (typeof window !== 'undefined') {
  window.TiptapView = { createTiptapView: createTiptapView };
}

export { createTiptapView, markdownToDoc, docToMarkdown, plainTextDoc };
