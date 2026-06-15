'use strict';

/* tiptap-image-nodeview — security-gated ProseMirror NodeView for images.

   The render path that must never create an unsafe fetch surface. Kept in a
   pure UMD module (depends only on image-url-safety; NO Tiptap) so the whole
   security behavior is headlessly testable with an injected fake document —
   no real editor or browser DOM required.

   buildImageNodeView(node, options, deps) -> ProseMirror NodeView
     node    : the image ProseMirror node ({ attrs:{src,alt}, type }).
     options : { getNoteDir, resolveImagePath } (from the Tiptap extension).
     deps    : { document?, decide? } — injection seams for tests.

   Decision (via decideImageRender):
     direct  (https/data)      -> <img src> set synchronously.
     reject  (unsafe)          -> alt-text placeholder, NO <img>, NO fetch.
     resolve (vault-relative)  -> <img> with NO src; resolveImagePath(noteDir,src);
                                  set src ONLY on a strictly-valid file: URL,
                                  else placeholder. Late async after destroy() = no-op. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./image-url-safety.js'));
  } else {
    root.TiptapImageNodeView = factory(root.ImageUrlSafety);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ImageUrlSafety) {

  const decideImageRender = ImageUrlSafety.decideImageRender;

  // The IPC is trusted, but this is the final boundary before rendering a
  // fetched URL — re-validate the result shape strictly.
  function isValidResolved(r) {
    return !!r
      && r.ok === true
      && typeof r.fileUrl === 'string'
      && r.fileUrl.indexOf('\x00') === -1
      && /^file:/i.test(r.fileUrl);
  }

  function buildImageNodeView(node, options, deps) {
    const o = options || {};
    const d = deps || {};
    const doc = d.document || (typeof document !== 'undefined' ? document : null);
    const decide = d.decide || decideImageRender;

    let currentNode = node;
    const src = (node && node.attrs && node.attrs.src) || '';
    const alt = (node && node.attrs && node.attrs.alt) || '';
    let destroyed = false;

    const dom = doc ? doc.createElement('span') : null;
    if (dom && dom.setAttribute) dom.setAttribute('class', 'tiptap-image');

    function makeRejected() {
      const span = doc ? doc.createElement('span') : null;
      if (span) {
        if (span.setAttribute) span.setAttribute('class', 'tiptap-image-rejected');
        span.textContent = alt; // XSS-safe; never innerHTML
      }
      return span;
    }

    function makeImg(srcValue) {
      const img = doc ? doc.createElement('img') : null;
      if (img && img.setAttribute) {
        if (srcValue != null) img.setAttribute('src', srcValue);
        img.setAttribute('alt', alt);
        img.setAttribute('loading', 'lazy');
        if (img.style) img.style.maxWidth = '100%';
      }
      return img;
    }

    function swapToRejected(img) {
      if (dom && img && img.parentNode === dom && dom.removeChild) dom.removeChild(img);
      const ph = makeRejected();
      if (dom && ph && dom.appendChild) dom.appendChild(ph);
    }

    const decision = decide(src);
    const isVaultRelative = decision.action === 'resolve';
    // The note directory this view RESOLVED against. A vault-relative image's
    // file URL depends on it, so a note switch that changes the dir must rebuild
    // (update() returns false) to re-resolve against the new note's folder.
    let builtNoteDir = null;

    if (decision.action === 'reject') {
      const ph = makeRejected();
      if (dom && ph && dom.appendChild) dom.appendChild(ph);
    } else if (decision.action === 'direct') {
      const img = makeImg(src);
      if (dom && img && dom.appendChild) dom.appendChild(img);
    } else {
      // resolve (vault-relative): render <img> with NO src until IPC resolves.
      const img = makeImg(null);
      if (dom && img && dom.appendChild) dom.appendChild(img);
      const getNoteDir = typeof o.getNoteDir === 'function' ? o.getNoteDir : null;
      const resolveImagePath = typeof o.resolveImagePath === 'function' ? o.resolveImagePath : null;
      builtNoteDir = getNoteDir ? getNoteDir() : null;
      if (!getNoteDir || !resolveImagePath) {
        swapToRejected(img);
      } else {
        let promise = null;
        try {
          promise = Promise.resolve(resolveImagePath(builtNoteDir, src));
        } catch (_err) {
          swapToRejected(img);
        }
        if (promise) {
          promise.then(
            function (r) {
              if (destroyed) return;
              if (isValidResolved(r)) {
                if (img && img.setAttribute) img.setAttribute('src', r.fileUrl);
              } else {
                swapToRejected(img);
              }
            },
            function (_err) {
              if (destroyed) return;
              swapToRejected(img); // reason dropped — not surfaced
            }
          );
        }
      }
    }

    return {
      dom: dom,
      ignoreMutation: function () { return true; },
      update: function (newNode) {
        if (!newNode || newNode.type !== currentNode.type) return false;
        const newSrc = (newNode.attrs && newNode.attrs.src) || '';
        const newAlt = (newNode.attrs && newNode.attrs.alt) || '';
        // Any render-affecting attr change forces ProseMirror to rebuild the
        // view, so stale DOM (e.g. old alt/src) never persists.
        if (newSrc !== src || newAlt !== alt) return false;
        // Vault-relative resolution depends on the note directory. If a note
        // switch changed it, rebuild so the path re-resolves against the new
        // note's folder (else a reused view would show the previous note's image).
        if (isVaultRelative) {
          const getNoteDir = typeof o.getNoteDir === 'function' ? o.getNoteDir : null;
          const currentDir = getNoteDir ? getNoteDir() : null;
          if (currentDir !== builtNoteDir) return false;
        }
        currentNode = newNode;
        return true;
      },
      destroy: function () { destroyed = true; },
    };
  }

  return {
    buildImageNodeView: buildImageNodeView,
    isValidResolved: isValidResolved,
  };
});
