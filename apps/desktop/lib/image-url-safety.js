'use strict';

/* image-url-safety — pure image URL allowlist + render decision.

   Canonical, dependency-free version of the allowlist for the `tiptap` engine
   (bundled by esbuild; no CodeMirror dependency). Behavior is IDENTICAL to
   lib/cm6-lp-image-widget.js's isSafeImageUrl — a parity test
   (test/image-url-safety.test.js) asserts the two never drift. A security
   allowlist must not silently diverge between engines.

   isSafeImageUrl(url) -> { safe:true, kind:'https'|'data'|'vault-relative' }
                        | { safe:false, reason:<code> }
     Allowed:  https:, data:image/<allowlisted-mime>, vault-relative (no scheme,
               not absolute, no null byte).
     Rejected: any other scheme (http/file/javascript/blob/chrome-extension/…),
               absolute path, null byte, empty/non-string.
     Vault-relative containment (realpath) is the IPC layer's job; this only
     validates the SYNTACTIC shape.

   decideImageRender(src) -> { action:'direct'|'resolve'|'reject', kind?, reason? }
     direct  : safe https/data — set <img src> immediately.
     resolve : safe vault-relative — resolve via IPC before setting src.
     reject  : unsafe — render the alt-text placeholder, NEVER fetch.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ImageUrlSafety = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Image MIME types allowed inside `data:image/<mime>` URLs. MUST match
  // lib/cm6-lp-image-widget.js ALLOWED_DATA_MIMES (parity test enforces this).
  const ALLOWED_DATA_MIMES = new Set([
    'png', 'jpeg', 'jpg', 'gif', 'webp', 'svg+xml',
    'bmp', 'apng', 'avif', 'x-icon', 'vnd.microsoft.icon',
  ]);

  function isSafeImageUrl(url) {
    if (url == null) return { safe: false, reason: 'empty-url' };
    if (typeof url !== 'string') return { safe: false, reason: 'empty-url' };
    if (url.length === 0) return { safe: false, reason: 'empty-url' };

    // Null-byte rejection applies regardless of scheme.
    if (url.indexOf('\x00') !== -1) return { safe: false, reason: 'invalid-path' };

    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(url);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (scheme === 'https') return { safe: true, kind: 'https' };
      if (scheme === 'data') {
        const mimeMatch = /^data:image\/([a-zA-Z0-9+.\-]+)/i.exec(url);
        if (!mimeMatch) return { safe: false, reason: 'data-mime-not-allowed' };
        const mime = mimeMatch[1].toLowerCase();
        if (!ALLOWED_DATA_MIMES.has(mime)) return { safe: false, reason: 'data-mime-not-allowed' };
        return { safe: true, kind: 'data' };
      }
      // http, file, javascript, chrome-extension, blob, mailto, tel, ...
      return { safe: false, reason: 'scheme-not-allowed' };
    }

    // No scheme — must be a relative path. Reject absolute paths.
    if (url.charAt(0) === '/') return { safe: false, reason: 'absolute-path-not-allowed' };

    // Vault-relative path. IPC layer does the realpath containment check.
    return { safe: true, kind: 'vault-relative' };
  }

  function decideImageRender(src) {
    const verdict = isSafeImageUrl(src);
    if (!verdict.safe) return { action: 'reject', reason: verdict.reason };
    if (verdict.kind === 'vault-relative') return { action: 'resolve', kind: 'vault-relative' };
    return { action: 'direct', kind: verdict.kind };
  }

  return {
    isSafeImageUrl: isSafeImageUrl,
    decideImageRender: decideImageRender,
  };
});
