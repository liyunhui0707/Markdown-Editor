'use strict';

/* Stage 24.5 — server-side validator + IPC handler for the
   open-external-link channel. Pure CommonJS so apps/desktop/main.js can
   require() it, and apps/desktop/test/open-external-link.test.js can test it
   directly without spinning up Electron.

   Mirrors the renderer-side validator that Stage 25 will lift from the
   Stage 24 spike branch onto stage11. Stage 25 must adopt the same rule 6
   (degenerate-form rejection) so the two implementations agree on every
   FIXTURES entry in test/open-external-link.test.js.

   Q3 URL allowlist (docs/rendering-policy.md):
     - scheme is exactly "https" or "mailto", case-insensitive
     - reject whitespace anywhere (space, tab, CR, LF)
     - reject any control char (U+0000..U+001F or U+007F)
     - reject percent-encoded scheme letters (e.g. "%6Aavascript:")
     - reject relative URLs (no scheme prefix)
     - reject non-string / null / undefined / empty input
     - reject degenerate scheme-only forms ("https:", "https://", "mailto:")

   IPC handler shape (open-external-link channel):
     payload non-string                          → { ok: false, reason: 'invalid-payload' }
     payload string but invalid URL              → { ok: false, reason: 'invalid-url' }    (shell NOT called)
     shellMod missing / .openExternal not fn     → { ok: false, reason: 'shell-unavailable' }
     shell.openExternal throws / rejects         → { ok: false, reason: 'shell-error', error: <message> } (shell called once)
     success                                     → { ok: true } (shell called once with original URL)
*/

// Character-class regex: whitespace OR any control char U+0000..U+001F OR
// DEL U+007F. Built with new RegExp so the source contains no raw control
// bytes (which some tooling treats as binary).
const FORBIDDEN_CHAR = new RegExp('[\\s\\u0000-\\u001F\\u007F]');

/**
 * Validate a URL against the Q3 allowlist.
 *
 * Returns a stable boolean. Never normalizes or rewrites the input —
 * the original string is passed verbatim downstream to shell.openExternal
 * when this returns true.
 *
 * @param {*} url
 * @returns {boolean}
 */
function validateExternalUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (FORBIDDEN_CHAR.test(url)) return false;
  const colon = url.indexOf(':');
  if (colon < 1) return false;
  const scheme = url.slice(0, colon);
  if (scheme.indexOf('%') !== -1) return false;
  const lower = scheme.toLowerCase();
  if (lower !== 'https' && lower !== 'mailto') return false;
  // Rule 6: reject degenerate scheme-only forms. The rest after the colon,
  // with any leading "/" stripped, must contain at least one character.
  // Rejects: "https:", "https://", "https:///", "mailto:", etc.
  // Accepts:  "https://example.com", "mailto:foo@bar.com", "https:foo".
  const rest = url.slice(colon + 1).replace(/^\/+/, '');
  if (rest.length === 0) return false;
  return true;
}

/**
 * Process an open-external-link IPC payload.
 *
 * Pure async function — no Electron import, no top-level side effects. Takes
 * the URL payload and an injected shell module so tests can call it directly
 * with a mock shell. main.js wires this to the real Electron shell:
 *
 *   const { shell } = require('electron');
 *   const { processOpenExternalLink } = require('./lib/external-url');
 *   ipcMain.handle('open-external-link', (_event, payload) =>
 *     processOpenExternalLink(payload, shell)
 *   );
 *
 * Resolution shapes (verbatim from this file's top-of-file comment):
 *   payload non-string                          → { ok: false, reason: 'invalid-payload' }
 *   payload string but invalid URL              → { ok: false, reason: 'invalid-url' }
 *   shellMod missing / .openExternal not fn     → { ok: false, reason: 'shell-unavailable' }
 *   shell.openExternal throws / rejects         → { ok: false, reason: 'shell-error', error: <message> }
 *   success                                     → { ok: true }
 *
 * The handler awaits shell.openExternal so both sync throws and async
 * rejections are caught by the same try/catch and mapped to shell-error.
 * The original URL string is passed verbatim to shell.openExternal; no
 * normalization or rewriting.
 *
 * @param {*}   url
 * @param {*}   shellMod   should expose .openExternal(url) returning Promise<void>
 * @returns {Promise<{ok: boolean, reason?: string, error?: string}>}
 */
async function processOpenExternalLink(url, shellMod) {
  if (typeof url !== 'string') {
    return { ok: false, reason: 'invalid-payload' };
  }
  if (!validateExternalUrl(url)) {
    return { ok: false, reason: 'invalid-url' };
  }
  if (!shellMod || typeof shellMod.openExternal !== 'function') {
    return { ok: false, reason: 'shell-unavailable' };
  }
  try {
    await shellMod.openExternal(url);
    return { ok: true };
  } catch (e) {
    const message = (e && typeof e.message === 'string') ? e.message : String(e);
    return { ok: false, reason: 'shell-error', error: message };
  }
}

module.exports = {
  validateExternalUrl:      validateExternalUrl,
  processOpenExternalLink:  processOpenExternalLink,
};
