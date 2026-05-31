'use strict';

/* Stage C — hybrid-cm6-lp inline-image rendering widget.

   This module owns the lp engine's Stage C image-rendering surface:

     1. `isSafeImageUrl(url)` — pure URL/path allowlist check.
        Returns {safe: true, kind: 'https'|'data'|'vault-relative'} or
        {safe: false, reason: <code>}.
        Allowed: https:, data:image/<allowlisted-mime>, vault-relative paths.
        Vault-relative resolution (containment check) is the IPC layer's
        job — this pure function only RECOGNIZES the syntactic shape.

     2. `parseAltForSizing(alt)` — Obsidian-style |width / |WxH extraction.
        For `'name|400'` → {cleanedAlt: 'name', width: 400, height: null}.
        For `'name|400x300'` → {cleanedAlt: 'name', width: 400, height: 300}.
        For non-numeric or missing → {cleanedAlt: alt, width: null, height: null}.

     3. `InlineImageWidget` (Stage C WAVE 2) — extends cm6.WidgetType.
        toDOM() renders <span><img src=... alt=... loading=lazy ...></span>.
        onerror swaps to RejectedImageWidget DOM so broken images don't
        show the browser's broken-image icon.

     4. `RejectedImageWidget` (Stage C WAVE 2) — extends cm6.WidgetType.
        toDOM() renders <span> with the alt text styled italic+muted
        (matches existing cm-md-image-alt styling).

   The UMD wrapper mirrors cm6-lp-inline.js / cm6-active-range.js: CJS
   path sets both module.exports and root.Cm6LpImageWidget so Node tests
   work the same way as the browser script-tag path. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Stage C CJS path uses CM6's WidgetType from the npm @codemirror/view
    // package directly (the bundled window.CM6Production isn't available
    // in Node tests). The browser script-tag path reads WidgetType from
    // globalThis.CM6Production.WidgetType.
    const { WidgetType } = require('@codemirror/view');
    const exported = factory(WidgetType);
    module.exports = exported;
    if (typeof root !== 'undefined') root.Cm6LpImageWidget = exported;
  } else {
    const WidgetType =
      (typeof root !== 'undefined' && root.CM6Production && root.CM6Production.WidgetType) ||
      null;
    root.Cm6LpImageWidget = factory(WidgetType);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WidgetType) {

  // ── URL allowlist ───────────────────────────────────────────────────────

  // Image MIME types allowed inside `data:image/<mime>` URLs. Matches the
  // common browser-renderable image formats. SVG is included because GIMP
  // / Inkscape / Obsidian users routinely embed inline SVG as data URLs.
  // The risk of SVG (script-in-svg) is mitigated by rendering it as an
  // <img> element (not inline-SVG), which browsers run in a sandboxed
  // context for <img> src.
  const ALLOWED_DATA_MIMES = new Set([
    'png', 'jpeg', 'jpg', 'gif', 'webp', 'svg+xml',
    'bmp', 'apng', 'avif', 'x-icon', 'vnd.microsoft.icon',
  ]);

  function isSafeImageUrl(url) {
    if (url == null) return { safe: false, reason: 'empty-url' };
    if (typeof url !== 'string') return { safe: false, reason: 'empty-url' };
    if (url.length === 0) return { safe: false, reason: 'empty-url' };

    // Null-byte rejection applies regardless of scheme. URLs with null
    // bytes can confuse OS-level filesystem and network calls.
    if (url.indexOf('\x00') !== -1) return { safe: false, reason: 'invalid-path' };

    // Scheme detection — case-insensitive, anchored at start.
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(url);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (scheme === 'https') return { safe: true, kind: 'https' };
      if (scheme === 'data') {
        // data:image/<mime>...
        const mimeMatch = /^data:image\/([a-zA-Z0-9+.\-]+)/i.exec(url);
        if (!mimeMatch) return { safe: false, reason: 'data-mime-not-allowed' };
        const mime = mimeMatch[1].toLowerCase();
        if (!ALLOWED_DATA_MIMES.has(mime)) return { safe: false, reason: 'data-mime-not-allowed' };
        return { safe: true, kind: 'data' };
      }
      // Any other scheme (http, file, javascript, chrome-extension, blob,
      // mailto, tel, ...) is rejected.
      return { safe: false, reason: 'scheme-not-allowed' };
    }

    // No scheme — must be a relative path. Reject absolute paths.
    if (url.charAt(0) === '/') return { safe: false, reason: 'absolute-path-not-allowed' };

    // Otherwise the URL is a vault-relative path. The IPC layer
    // (resolve-image-path) is responsible for the realpath containment
    // check; this function only validates the SYNTACTIC shape.
    return { safe: true, kind: 'vault-relative' };
  }

  // ── parseAltForSizing(alt) ─────────────────────────────────────────────

  // Obsidian-style `![text|400](url)` or `![text|400x300](url)` syntax.
  // The width / height suffix lives INSIDE the alt text (the parser does
  // not have a separate token for it). This helper extracts the suffix
  // and returns the cleaned alt + width + height.
  function parseAltForSizing(alt) {
    if (alt == null) alt = '';
    alt = String(alt);
    const pipeIdx = alt.lastIndexOf('|');
    if (pipeIdx === -1) {
      return { cleanedAlt: alt, width: null, height: null };
    }
    const suffix = alt.slice(pipeIdx + 1);
    // suffix must be either /^\d+$/ (width only) or /^\d+x\d+$/ (width x height).
    let width = null, height = null;
    if (/^\d+$/.test(suffix)) {
      width = parseInt(suffix, 10);
    } else if (/^(\d+)x(\d+)$/.test(suffix)) {
      const m = /^(\d+)x(\d+)$/.exec(suffix);
      width  = parseInt(m[1], 10);
      height = parseInt(m[2], 10);
    } else {
      // Non-numeric suffix (e.g., `alt|abc`) — treat as plain alt text.
      return { cleanedAlt: alt, width: null, height: null };
    }
    const cleanedAlt = alt.slice(0, pipeIdx);
    return { cleanedAlt, width, height };
  }

  // ── Widget classes (Stage C WAVE 2) ─────────────────────────────────────

  // Sentinel returned by toDOM() when no document is available (Node
  // test environment without a DOM stub). Shaped enough that callers
  // that immediately wrap it in CM6's decoration pipeline don't crash
  // before the test's assertion runs.
  function noDocFallback() {
    return { nodeType: 1 };
  }

  // Create a child element via the active document, falling back to a
  // stub object so toDOM() never crashes in Node tests that don't install
  // a document stub.
  function createEl(tagName) {
    if (typeof document === 'undefined') return noDocFallback();
    return document.createElement(tagName);
  }

  // The rendered placeholder for an image that fails the URL allowlist OR
  // fails to load. Renders a single <span> containing the alt text styled
  // italic + muted, mirroring the existing cm-md-image-alt walker styling.
  function renderRejectedPlaceholder(alt) {
    const span = createEl('span');
    if (span && span.nodeType === 1 && typeof span.setAttribute === 'function') {
      span.setAttribute('class', 'cm-md-image-alt cm-md-lp-image-rejected');
      if (typeof span.appendChild === 'function' && typeof document !== 'undefined') {
        span.appendChild(document.createTextNode(String(alt == null ? '' : alt)));
      }
    }
    return span;
  }

  // Base class wrapper for WidgetType when none is available. Returns
  // null guards so the surface checks below can warn at construction
  // time instead of crashing inside CM6 internals.
  let InlineImageWidget = null;
  let RejectedImageWidget = null;

  if (WidgetType) {
    InlineImageWidget = class InlineImageWidget extends WidgetType {
      constructor(opts) {
        super();
        const o = opts || {};
        this.src    = String(o.src == null ? '' : o.src);
        this.alt    = String(o.alt == null ? '' : o.alt);
        this.width  = (o.width  != null) ? Number(o.width)  : null;
        this.height = (o.height != null) ? Number(o.height) : null;
        this.kind   = o.kind != null ? String(o.kind) : null;
        // Stage C — vault-relative context: when src is a vault-relative
        // path, the widget calls resolveImagePath(noteDir, relPath) at
        // toDOM time to convert it to a safe file:// URL before setting
        // <img src>. The context shape is {noteDir, resolveImagePath, relPath}.
        this.vaultRelativeContext = o.vaultRelativeContext || null;
        this.destroyed = false;
      }
      eq(other) {
        if (!(other instanceof InlineImageWidget)) return false;
        return other.src    === this.src
            && other.alt    === this.alt
            && other.width  === this.width
            && other.height === this.height;
      }
      destroy() { this.destroyed = true; }
      toDOM() {
        const wrapper = createEl('span');
        if (!wrapper || wrapper.nodeType !== 1 || typeof wrapper.setAttribute !== 'function') {
          return wrapper;
        }
        wrapper.setAttribute('class', 'cm-md-lp-image-wrapper');
        const img = createEl('img');
        if (!img || img.nodeType !== 1 || typeof img.setAttribute !== 'function') {
          // No DOM in this environment — return the wrapper as-is.
          return wrapper;
        }

        // Stage C — vault-relative: defer setting <img src> until IPC
        // returns the resolved file:// URL. Render the wrapper synchronously
        // with an empty <img> placeholder; replace src when IPC resolves.
        // If the IPC reject (outside-vault, not-a-file, etc.) → swap the
        // wrapper's contents to the rejected placeholder.
        const ctx = this.vaultRelativeContext;
        const isVaultRelative = !!(ctx && ctx.resolveImagePath && ctx.relPath);
        if (!isVaultRelative) {
          img.setAttribute('src', this.src);
        }
        // else: src will be set asynchronously below.

        img.setAttribute('alt',     this.alt);
        img.setAttribute('loading', 'lazy');
        // Inline sizing: max-width 100% to fit the container; max-height
        // 400px caps very tall images and prevents layout shift on load.
        // height: auto + width: auto preserves aspect ratio when no
        // explicit width/height is supplied.
        img.style.maxWidth  = '100%';
        img.style.maxHeight = '400px';
        img.style.height    = 'auto';
        img.style.width     = 'auto';
        if (this.width  != null) img.style.width  = this.width  + 'px';
        if (this.height != null) img.style.height = this.height + 'px';
        // On load failure, swap the wrapper's contents to the rejected
        // placeholder so users see the alt text rather than a broken-
        // image browser icon.
        if (typeof img.addEventListener === 'function') {
          const onError = () => {
            if (this.destroyed) return;
            const placeholder = renderRejectedPlaceholder(this.alt);
            // Replace img in the wrapper.
            if (typeof wrapper.removeChild === 'function' && img.parentNode === wrapper) {
              wrapper.removeChild(img);
            } else if (wrapper._children) {
              // Test-stub fallback: clear children and append the placeholder.
              wrapper._children = [];
            }
            wrapper.appendChild(placeholder);
          };
          img.addEventListener('error', onError);
        }
        wrapper.appendChild(img);

        // Stage C — kick off the vault-relative IPC if needed. The promise
        // resolves to {ok: true, fileUrl} or {ok: false, reason}. On ok,
        // set <img src=fileUrl>. On reject, swap to rejected placeholder.
        // The `destroyed` flag guards against mid-load navigation (note
        // switched away → widget destroyed → don't touch DOM).
        if (isVaultRelative) {
          try {
            const promise = ctx.resolveImagePath(ctx.noteDir, ctx.relPath);
            if (promise && typeof promise.then === 'function') {
              promise.then(
                (result) => {
                  if (this.destroyed) return;
                  if (result && result.ok && result.fileUrl) {
                    img.setAttribute('src', result.fileUrl);
                  } else {
                    // Rejected by IPC (outside-vault, not-a-file, etc.).
                    const placeholder = renderRejectedPlaceholder(this.alt);
                    if (typeof wrapper.removeChild === 'function' && img.parentNode === wrapper) {
                      wrapper.removeChild(img);
                    } else if (wrapper._children) {
                      wrapper._children = [];
                    }
                    wrapper.appendChild(placeholder);
                  }
                },
                (_err) => {
                  if (this.destroyed) return;
                  // Unexpected IPC error — degrade to rejected placeholder.
                  // Error message is not logged or surfaced (sanitization).
                  const placeholder = renderRejectedPlaceholder(this.alt);
                  if (typeof wrapper.removeChild === 'function' && img.parentNode === wrapper) {
                    wrapper.removeChild(img);
                  } else if (wrapper._children) {
                    wrapper._children = [];
                  }
                  wrapper.appendChild(placeholder);
                }
              );
            }
          } catch (_err) {
            // Synchronous throw from resolveImagePath — same handling.
            // Swallow; widget will keep the empty <img> until error fires.
          }
        }
        return wrapper;
      }
      ignoreEvent() {
        // Allow events (e.g., context menu) to propagate normally.
        return false;
      }
    };

    RejectedImageWidget = class RejectedImageWidget extends WidgetType {
      constructor(opts) {
        super();
        const o = opts || {};
        this.alt = String(o.alt == null ? '' : o.alt);
        this.destroyed = false;
      }
      eq(other) {
        return other instanceof RejectedImageWidget && other.alt === this.alt;
      }
      destroy() { this.destroyed = true; }
      toDOM() {
        return renderRejectedPlaceholder(this.alt);
      }
      ignoreEvent() { return false; }
    };
  }

  return {
    isSafeImageUrl:        isSafeImageUrl,
    parseAltForSizing:     parseAltForSizing,
    InlineImageWidget:     InlineImageWidget,
    RejectedImageWidget:   RejectedImageWidget,
  };
});
