'use strict';

/* tiptap-image — security-gated Image extension for the tiptap WYSIWYG engine.

   Wraps @tiptap/extension-image with a custom node-view that routes every image
   src through the allowlist (lib/image-url-safety.js) + vault-relative IPC
   resolution. The security logic lives in lib/tiptap-image-nodeview.js (pure,
   headlessly tested); this file is the thin Tiptap binding.

   Options threaded from createTiptapView:
     getNoteDir       : () => string   — selected note's dir relative to vault.
     resolveImagePath : (noteDir, relPath) => Promise<{ok,fileUrl}|{ok:false,reason}>
                                          — window.vaultApi.resolveImagePath. */

import { Image } from '@tiptap/extension-image';

import TiptapImageNodeView from './tiptap-image-nodeview.js';
const { buildImageNodeView } = TiptapImageNodeView;

export const GatedImage = Image.extend({
  addOptions() {
    const parent = this.parent ? this.parent() : {};
    return {
      ...parent,
      getNoteDir: null,
      resolveImagePath: null,
    };
  },
  addNodeView() {
    const options = this.options;
    return (props) => buildImageNodeView(props.node, options, {});
  },
});

export default { GatedImage };
