/* Stage 24.5 — IPC bridge for shell.openExternal.
   Run focused: node --test test/open-external-link.test.js

   This stage ships the preload-mediated IPC the Stage 24 spike's renderer-side
   open-link path will route through once Stage 25 lifts the renderer onto
   stage11. Until Stage 25 lands, this IPC is unreachable from a Cmd-click but
   is callable directly via window.vaultApi.openExternalLink(url) in DevTools.

   Test groups (numbered Stage 24.5-N):
     Group A — validateExternalUrl (1..28), incl. degenerate-form rejections
                and the inline FIXTURES sanity check
     Group B — processOpenExternalLink handler shape (29..42)   [Step 3]
     Group C — preload export runtime (43)                       [Step 5]
     Group D — main.js wiring source-shape (44)                  [Step 7]

   Lazy-loading: the external-url module is required inside each test body
   via loadExternalUrlModule() so the missing-module RED state produces
   per-test failures rather than a single file-load failure.

   FIXTURES table: lives inline (not exported from lib/external-url.js per
   reviewer guardrail) as the canonical carry-forward for Stage 25, which
   will lift the renderer-side validator and assert agreement against this
   same set.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const MODULE_REL = '../lib/external-url.js';

function loadExternalUrlModule() {
  delete require.cache[require.resolve(MODULE_REL)];
  return require(MODULE_REL);
}

// makeMockShell returns a fake `shell` whose `openExternal(url)` records the
// call and either resolves, throws synchronously, or returns a rejected
// Promise — whichever the provided `impl` function dictates. When `impl` is
// omitted, openExternal resolves with undefined (matching Electron's
// `Promise<void>` type).
function makeMockShell(impl) {
  const calls = [];
  return {
    calls,
    openExternal: function (url) {
      calls.push(url);
      if (typeof impl === 'function') return impl(url);
      return Promise.resolve();
    },
  };
}

// ── FIXTURES ────────────────────────────────────────────────────────────────
// Canonical (url, valid) pairs. Carry-forward for Stage 25's cross-validator
// agreement test. Keep this list in sync with the validator algorithm.

const FIXTURES = [
  // positive — canonical
  { url: 'https://example.com',                       valid: true },
  { url: 'mailto:foo@bar.com',                        valid: true },
  // positive — case-insensitive scheme
  { url: 'HTTPS://EXAMPLE.COM',                       valid: true },
  { url: 'MailTo:foo@bar.com',                        valid: true },
  // positive — scheme + non-empty non-slash rest
  { url: 'https:foo',                                 valid: true },
  // negative — allowlist
  { url: 'http://example.com',                        valid: false },
  { url: 'ftp://example.com',                         valid: false },
  // negative — dangerous schemes
  { url: 'javascript:alert(1)',                       valid: false },
  { url: 'data:text/html,x',                          valid: false },
  { url: 'file:///etc/passwd',                        valid: false },
  // negative — percent-encoded scheme letter
  { url: '%6Aavascript:alert(1)',                     valid: false },
  // negative — relative / bare path
  { url: '/foo',                                      valid: false },
  { url: 'foo.html',                                  valid: false },
  // negative — whitespace anywhere
  { url: ' https://example.com',                      valid: false },
  { url: 'https://example.com ',                      valid: false },
  { url: 'https://exa mple.com',                      valid: false },
  { url: 'https://example.com\t',                     valid: false },
  // negative — control chars / null byte
  { url: 'https://example.com\x07',                   valid: false },
  { url: 'https://example.com\x00',                   valid: false },
  // negative — degenerate scheme-only (Stage 24.5 reviewer-pinned)
  { url: 'https:',                                    valid: false },
  { url: 'https://',                                  valid: false },
  { url: 'mailto:',                                   valid: false },
  // negative — empty string
  { url: '',                                          valid: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// Group A — validateExternalUrl (Stage 24.5-1 through 24.5-28)
// Pure function. No DOM. No Electron. Q3 allowlist: {https, mailto}
// case-insensitive; reject whitespace, control chars, percent-encoded scheme
// letters, relative URLs, degenerate scheme-only forms.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24.5-1: validateExternalUrl accepts "https://example.com"', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https://example.com'), true);
});

test('Stage 24.5-2: validateExternalUrl accepts "mailto:foo@bar.com"', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('mailto:foo@bar.com'), true);
});

test('Stage 24.5-3: validateExternalUrl accepts case-insensitive schemes "HTTPS://..." / "MailTo:..." / mixed case', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('HTTPS://example.com'), true);
  assert.equal(validateExternalUrl('MailTo:foo@bar.com'), true);
  assert.equal(validateExternalUrl('hTtPs://example.com'), true);
});

test('Stage 24.5-4: validateExternalUrl rejects "http://..." (not on allowlist)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('http://example.com'), false);
  assert.equal(validateExternalUrl('HTTP://example.com'), false);
});

test('Stage 24.5-5: validateExternalUrl rejects "javascript:alert(1)"', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('javascript:alert(1)'), false);
  assert.equal(validateExternalUrl('JavaScript:alert(1)'), false);
});

test('Stage 24.5-6: validateExternalUrl rejects "data:text/html,..."', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('data:text/html,<script>alert(1)</script>'), false);
});

test('Stage 24.5-7: validateExternalUrl rejects "file:///etc/passwd"', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('file:///etc/passwd'), false);
});

test('Stage 24.5-8: validateExternalUrl rejects other schemes (ftp:, ws:, wss:, vbscript:)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('ftp://example.com'),     false);
  assert.equal(validateExternalUrl('ws://example.com'),      false);
  assert.equal(validateExternalUrl('wss://example.com'),     false);
  assert.equal(validateExternalUrl('vbscript:msgbox("x")'),  false);
});

test('Stage 24.5-9: validateExternalUrl rejects percent-encoded scheme letter "%6Aavascript:..." and all-percent variants', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('%6Aavascript:alert(1)'), false);
  assert.equal(validateExternalUrl('%4A%41%56%41%53%43%52%49%50%54:alert(1)'), false);
});

test('Stage 24.5-10: validateExternalUrl rejects relative URLs ("/foo", "./foo", "../foo")', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('/foo'),       false);
  assert.equal(validateExternalUrl('/foo/bar'),   false);
  assert.equal(validateExternalUrl('./local'),    false);
  assert.equal(validateExternalUrl('../up'),      false);
});

test('Stage 24.5-11: validateExternalUrl rejects bare path "foo.html" / "example.com"', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('foo.html'),    false);
  assert.equal(validateExternalUrl('example.com'), false);
});

test('Stage 24.5-12: validateExternalUrl rejects empty string', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl(''), false);
});

test('Stage 24.5-13: validateExternalUrl rejects null and undefined', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl(null),      false);
  assert.equal(validateExternalUrl(undefined), false);
});

test('Stage 24.5-14: validateExternalUrl rejects non-string input (number, object, array, boolean, NaN, function)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl(0),                false);
  assert.equal(validateExternalUrl(123),              false);
  assert.equal(validateExternalUrl(NaN),              false);
  assert.equal(validateExternalUrl({}),               false);
  assert.equal(validateExternalUrl({ url: 'x' }),     false);
  assert.equal(validateExternalUrl([]),               false);
  assert.equal(validateExternalUrl(['https://x']),    false);
  assert.equal(validateExternalUrl(true),             false);
  assert.equal(validateExternalUrl(false),            false);
  assert.equal(validateExternalUrl(() => 'x'),        false);
});

test('Stage 24.5-15: validateExternalUrl rejects leading whitespace " https://..."', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl(' https://example.com'),  false);
  assert.equal(validateExternalUrl('  mailto:foo@bar.com'),  false);
});

test('Stage 24.5-16: validateExternalUrl rejects trailing whitespace "https://... "', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https://example.com '),   false);
  assert.equal(validateExternalUrl('mailto:foo@bar.com   '),  false);
});

test('Stage 24.5-17: validateExternalUrl rejects internal whitespace "https:// example.com" / "https://exa mple.com"', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https:// example.com'),   false);
  assert.equal(validateExternalUrl('https://exa mple.com'),   false);
  assert.equal(validateExternalUrl('mailto:foo @bar.com'),    false);
});

test('Stage 24.5-18: validateExternalUrl rejects URL containing tab (U+0009), CR (U+000D), LF (U+000A)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https://example.com\t'), false);
  assert.equal(validateExternalUrl('https://example.com\n'), false);
  assert.equal(validateExternalUrl('https://example.com\r'), false);
  assert.equal(validateExternalUrl('https://\texample.com'), false);
});

test('Stage 24.5-19: validateExternalUrl rejects URL containing control chars (U+0001, U+0007, U+001F, U+007F)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https://example.com\x01'), false);
  assert.equal(validateExternalUrl('https://exam\x07ple.com'), false);
  assert.equal(validateExternalUrl('https://example.com\x1F'), false);
  assert.equal(validateExternalUrl('https://example.com\x7F'), false);
});

test('Stage 24.5-20: validateExternalUrl rejects URL containing embedded null byte (U+0000)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https://example.com\x00'),  false);
  assert.equal(validateExternalUrl('https://\x00example.com'),  false);
  assert.equal(validateExternalUrl('https:\x00'),                false);
});

test('Stage 24.5-21: validateExternalUrl accepts URL containing shell-special chars (quote, dquote, backtick, &, $, ;) when otherwise valid', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  // The validator does not filter shell-quoting; shell.openExternal handles
  // OS-side escaping. Validator's job is scheme + whitespace + control only.
  assert.equal(validateExternalUrl('https://example.com/?q=a\'b'),    true);
  assert.equal(validateExternalUrl('https://example.com/?q=a"b'),     true);
  assert.equal(validateExternalUrl('https://example.com/?q=a`b'),     true);
  assert.equal(validateExternalUrl('https://example.com/?q=a&b=c'),   true);
  assert.equal(validateExternalUrl('https://example.com/?q=$d'),      true);
  assert.equal(validateExternalUrl('https://example.com/?q=a;b'),     true);
});

test('Stage 24.5-22: validateExternalUrl accepts very long URL (>= 4096 chars) when otherwise valid', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  const longTail = 'a'.repeat(4096);
  const url = 'https://example.com/' + longTail;
  assert.ok(url.length >= 4096, 'sanity: constructed URL is long enough');
  assert.equal(validateExternalUrl(url), true);
});

test('Stage 24.5-23: validateExternalUrl returns a stable boolean; does NOT normalize or rewrite input', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  const candidates = [
    'https://example.com',
    'mailto:foo@bar.com',
    'http://example.com',
    'javascript:alert(1)',
    '',
    null,
    undefined,
    'https:',
  ];
  for (const url of candidates) {
    const result = validateExternalUrl(url);
    assert.equal(typeof result, 'boolean',
      'validateExternalUrl must return a boolean for ' + JSON.stringify(url));
  }
});

test('Stage 24.5-24: validateExternalUrl rejects scheme-only "https:" (no host / path)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https:'), false);
  assert.equal(validateExternalUrl('HTTPS:'), false);
});

test('Stage 24.5-25: validateExternalUrl rejects "https://" (empty authority and path)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('https://'), false);
  assert.equal(validateExternalUrl('HTTPS://'), false);
  // Even with extra slashes, if everything after the colon is slash-only it
  // remains degenerate.
  assert.equal(validateExternalUrl('https:///'),   false);
  assert.equal(validateExternalUrl('https:////'),  false);
});

test('Stage 24.5-26: validateExternalUrl rejects scheme-only "mailto:" (no recipient)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  assert.equal(validateExternalUrl('mailto:'), false);
  assert.equal(validateExternalUrl('MAILTO:'), false);
});

test('Stage 24.5-27: validateExternalUrl accepts borderline "https:foo" (allowed scheme + non-empty non-slash rest)', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  // "https:foo" is a valid URI per RFC 3986 (scheme + opaque rest). The
  // validator does NOT enforce hier-part shape — it only enforces scheme,
  // safety, and non-empty rest. shell.openExternal will reject malformed
  // URIs at the OS level if they actually fail to resolve.
  assert.equal(validateExternalUrl('https:foo'),       true);
  assert.equal(validateExternalUrl('mailto:x'),        true);
  assert.equal(validateExternalUrl('https:example.com'), true);
});

test('Stage 24.5-28: FIXTURES table sanity — every (url, expected) entry agrees with validateExternalUrl', () => {
  const { validateExternalUrl } = loadExternalUrlModule();
  for (const fix of FIXTURES) {
    const got = validateExternalUrl(fix.url);
    assert.equal(got, fix.valid,
      'FIXTURES disagrees with implementation for ' + JSON.stringify(fix.url)
      + ' — expected ' + fix.valid + ', got ' + got);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — processOpenExternalLink handler shape (Stage 24.5-29..42)
//
// Handler signature: processOpenExternalLink(url, shellMod) → Promise<{ok, ...}>
// Contract (verbatim from the lib's top-of-file comment):
//   payload non-string                          → { ok: false, reason: 'invalid-payload' }
//   payload string but invalid URL              → { ok: false, reason: 'invalid-url' }    (shell NOT called)
//   shellMod missing / .openExternal not fn     → { ok: false, reason: 'shell-unavailable' }
//   shell.openExternal throws / rejects         → { ok: false, reason: 'shell-error', error: <message> } (shell called once)
//   success                                     → { ok: true } (shell called once with original URL)
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24.5-29: processOpenExternalLink("https://example.com", mockShell) → { ok: true }; mockShell.openExternal called once with the original URL', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink('https://example.com', shell);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(shell.calls, ['https://example.com']);
});

test('Stage 24.5-30: processOpenExternalLink("mailto:foo@bar.com", mockShell) → { ok: true }; mockShell.openExternal called once', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink('mailto:foo@bar.com', shell);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(shell.calls, ['mailto:foo@bar.com']);
});

test('Stage 24.5-31: processOpenExternalLink("HTTPS://EXAMPLE.COM", mockShell) → { ok: true }; mockShell called once with the ORIGINAL non-normalized URL', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink('HTTPS://EXAMPLE.COM', shell);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(shell.calls, ['HTTPS://EXAMPLE.COM'],
    'handler must pass the URL verbatim; no scheme lowercasing or rewriting');
});

test('Stage 24.5-32: processOpenExternalLink("javascript:alert(1)", mockShell) → { ok: false, reason: "invalid-url" }; mockShell NOT called', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink('javascript:alert(1)', shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-url' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-33: processOpenExternalLink("%6Aavascript:alert(1)", mockShell) → { ok: false, reason: "invalid-url" }; mockShell NOT called', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink('%6Aavascript:alert(1)', shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-url' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-34: processOpenExternalLink("/foo/bar", mockShell) → { ok: false, reason: "invalid-url" }; mockShell NOT called', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink('/foo/bar', shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-url' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-35: processOpenExternalLink("https:", mockShell) → { ok: false, reason: "invalid-url" }; mockShell NOT called (degenerate-form rejection)', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink('https:', shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-url' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-36: processOpenExternalLink(123, mockShell) → { ok: false, reason: "invalid-payload" }; mockShell NOT called', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink(123, shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-payload' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-37: processOpenExternalLink(null, mockShell) → { ok: false, reason: "invalid-payload" }; mockShell NOT called', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink(null, shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-payload' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-38: processOpenExternalLink(undefined, mockShell) → { ok: false, reason: "invalid-payload" }; mockShell NOT called', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink(undefined, shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-payload' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-39: processOpenExternalLink({ url: "https://example.com" }, mockShell) → { ok: false, reason: "invalid-payload" }; handler does NOT silently unwrap object payloads', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell();
  const result = await processOpenExternalLink({ url: 'https://example.com' }, shell);
  assert.deepEqual(result, { ok: false, reason: 'invalid-payload' });
  assert.equal(shell.calls.length, 0);
});

test('Stage 24.5-40: processOpenExternalLink("https://example.com", shellThrowingSync) → { ok: false, reason: "shell-error", error: <message> }; shell called once; no exception propagates', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell(function () { throw new Error('sync boom'); });
  let thrown = null;
  let result;
  try {
    result = await processOpenExternalLink('https://example.com', shell);
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown, null, 'handler must NOT propagate synchronous throws');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'shell-error');
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.includes('sync boom'),
    'error message must include the underlying message; got ' + JSON.stringify(result.error));
  assert.equal(shell.calls.length, 1);
});

test('Stage 24.5-41: processOpenExternalLink("https://example.com", shellRejectingPromise) → { ok: false, reason: "shell-error", error: <message> }; shell called once', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const shell = makeMockShell(function () { return Promise.reject(new Error('async boom')); });
  let thrown = null;
  let result;
  try {
    result = await processOpenExternalLink('https://example.com', shell);
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown, null, 'handler must NOT propagate Promise rejections');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'shell-error');
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.includes('async boom'),
    'error message must include the underlying rejection message; got ' + JSON.stringify(result.error));
  assert.equal(shell.calls.length, 1);
});

test('Stage 24.5-42: processOpenExternalLink("https://example.com", undefined) → { ok: false, reason: "shell-unavailable" }; nothing called (defensive)', async () => {
  const { processOpenExternalLink } = loadExternalUrlModule();
  const result = await processOpenExternalLink('https://example.com', undefined);
  assert.deepEqual(result, { ok: false, reason: 'shell-unavailable' });
  // Also test the shape where shellMod exists but lacks openExternal.
  const result2 = await processOpenExternalLink('https://example.com', { openExternal: 'not-a-function' });
  assert.deepEqual(result2, { ok: false, reason: 'shell-unavailable' });
  const result3 = await processOpenExternalLink('https://example.com', {});
  assert.deepEqual(result3, { ok: false, reason: 'shell-unavailable' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — preload export runtime test (Stage 24.5-43)
//
// Loads apps/desktop/preload.js with a mocked `electron` module injected via
// require.cache. The mock's contextBridge.exposeInMainWorld captures the
// vaultApi object; the mock's ipcRenderer.invoke records (channel, payload).
// Asserts that vaultApi.openExternalLink(url) routes the call to channel
// 'open-external-link' with the URL verbatim.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24.5-43: preload exposes vaultApi.openExternalLink which invokes ipcRenderer.invoke("open-external-link", url) once with the original URL', () => {
  const electronPath = require.resolve('electron');
  const preloadPath  = require.resolve('../preload.js');
  const savedElectronCache = require.cache[electronPath];
  const savedPreloadCache  = require.cache[preloadPath];

  try {
    const ipcCalls = [];
    let capturedVaultApi = null;
    const mockElectron = {
      contextBridge: {
        exposeInMainWorld(name, api) {
          if (name === 'vaultApi') capturedVaultApi = api;
        },
      },
      ipcRenderer: {
        invoke(channel, payload) {
          ipcCalls.push({ channel, payload });
          return Promise.resolve('mocked-invoke-result');
        },
        on()             { /* no-op for the one-shot load */ },
        send()           { /* no-op */ },
        removeListener() { /* no-op */ },
      },
    };

    require.cache[electronPath] = {
      id:       electronPath,
      filename: electronPath,
      loaded:   true,
      exports:  mockElectron,
      children: [],
      paths:    [],
    };

    delete require.cache[preloadPath];
    require(preloadPath);

    assert.ok(capturedVaultApi,
      'preload.js must call contextBridge.exposeInMainWorld("vaultApi", ...) at module load');
    assert.equal(typeof capturedVaultApi.openExternalLink, 'function',
      'vaultApi.openExternalLink must be a function (Stage 24.5 wiring missing)');

    const ret = capturedVaultApi.openExternalLink('https://example.com');
    assert.ok(ret && typeof ret.then === 'function',
      'openExternalLink must return the Promise from ipcRenderer.invoke');
    assert.deepEqual(ipcCalls, [{ channel: 'open-external-link', payload: 'https://example.com' }],
      'openExternalLink must invoke ipcRenderer.invoke with channel "open-external-link" and the original URL, exactly once');
  } finally {
    if (savedElectronCache !== undefined) require.cache[electronPath] = savedElectronCache;
    else delete require.cache[electronPath];
    if (savedPreloadCache !== undefined) require.cache[preloadPath] = savedPreloadCache;
    else delete require.cache[preloadPath];
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D — main.js wiring source-shape (Stage 24.5-44)
//
// Source-text assertions catching single-character typos in: the electron
// destructure (must include `shell`), the helper require, the IPC channel
// registration, and the handler-body delegation to processOpenExternalLink.
// We do NOT load main.js because main.js has heavy top-level side effects.
// ─────────────────────────────────────────────────────────────────────────────

test('Stage 24.5-44: main.js wiring source-shape — destructures shell from electron, requires ./lib/external-url, registers ipcMain.handle("open-external-link", ...) delegating to processOpenExternalLink(payload, shell)', () => {
  const path = require('node:path');
  const fs   = require('node:fs');
  const MAIN_PATH = path.join(__dirname, '..', 'main.js');
  const src = fs.readFileSync(MAIN_PATH, 'utf8');

  // 1. Destructure from require('electron') must include `shell`.
  const destructureMatch = src.match(/const\s*\{\s*([^}]*?)\s*\}\s*=\s*require\(['"]electron['"]\)/);
  assert.ok(destructureMatch,
    'main.js must contain `const { ... } = require("electron")`');
  const destructureContents = destructureMatch[1];
  assert.ok(/\bshell\b/.test(destructureContents),
    'main.js destructure of electron must include `shell`; current destructure: '
    + JSON.stringify(destructureContents));

  // 2. main.js must require the Stage 24.5 helper.
  assert.match(src, /require\(['"]\.\/lib\/external-url['"]\)/,
    'main.js must require("./lib/external-url")');

  // 3. main.js must register the new IPC channel.
  assert.match(src, /ipcMain\.handle\(\s*['"]open-external-link['"]/,
    'main.js must register ipcMain.handle("open-external-link", ...)');

  // 4. The new handler must delegate to processOpenExternalLink(payload, shell)
  //    — confirmed both globally (the call shape exists somewhere) AND
  //    locally (within the handler block, with limited intervening source).
  assert.match(src, /processOpenExternalLink\s*\(\s*payload\s*,\s*shell\s*\)/,
    'main.js must call processOpenExternalLink(payload, shell) somewhere');
  assert.match(src,
    /ipcMain\.handle\(\s*['"]open-external-link['"][\s\S]{0,500}?processOpenExternalLink\s*\(\s*payload\s*,\s*shell\s*\)/,
    'the open-external-link handler must delegate to processOpenExternalLink(payload, shell) directly');
});
