'use strict';

/* toast-image-renderer — security-gated image renderer for the Toast UI Preview.

   The Toast UI Preview pane renders markdown images with its own un-gated
   renderer (it fetches whatever `src` the markdown contains). This module is a
   `customHTMLRenderer.image` override that routes the URL through the same
   allowlist as the tiptap engine (lib/image-url-safety.js):

     - https: / data:image/<mime>  -> <img> (renders as before)
     - vault-relative (./x.png)    -> alt-text placeholder (NO <img>, NO fetch).
                                       Toast UI's renderer is SYNCHRONOUS so it
                                       can't await the resolve-image-path IPC; the
                                       WYSIWYG editor already resolves these.
     - unsafe (javascript:/http:/file:/blob:/absolute/null-byte) -> placeholder.

   Toast UI emits openTag ATTRIBUTE values RAW (toastui-bundle.js
   generateOpenTagString), so this escapes src/alt/title to prevent attribute
   injection. The placeholder's alt goes in a `text` token, which Toast UI
   escapes itself (renderTextNode) — so it is passed raw (no double-escape). */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./image-url-safety.js'));
  } else {
    root.ToastImageRenderer = factory(root.ImageUrlSafety);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ImageUrlSafety) {

  const isSafeImageUrl = ImageUrlSafety.isSafeImageUrl;

  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function gatedImage(node, context) {
    const dest = (node && node.destination) || '';
    const title = (node && node.title) || '';
    const getChildrenText = context && context.getChildrenText;
    const alt = (typeof getChildrenText === 'function') ? getChildrenText(node) : '';
    if (context && typeof context.skipChildren === 'function') context.skipChildren();

    const verdict = isSafeImageUrl(dest);
    // Only emit an <img> (which fetches) for directly-safe URLs. Attribute
    // values are written raw by Toast UI, so escape src/alt/title.
    if (verdict.safe && (verdict.kind === 'https' || verdict.kind === 'data')) {
      const attributes = { src: escapeXml(dest), alt: escapeXml(alt) };
      if (title) attributes.title = escapeXml(title);
      return { type: 'openTag', tagName: 'img', selfClose: true, attributes: attributes };
    }

    // vault-relative (no sync resolution in preview) OR unsafe -> placeholder.
    // alt is RAW here: Toast UI escapes `text` token content (renderTextNode).
    return [
      { type: 'openTag', tagName: 'span', attributes: { class: 'toast-image-rejected' } },
      { type: 'text', content: alt },
      { type: 'closeTag', tagName: 'span' },
    ];
  }

  return {
    gatedImage: gatedImage,
    escapeXml: escapeXml,
  };
});
