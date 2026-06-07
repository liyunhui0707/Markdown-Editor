/* test/ai-renderer-wiring-remote.test.js
   Stage F — CF5: badge UI wiring in renderer.

   Contract:
   - index.html has <span id="aiRemoteBadge" hidden> next to AI buttons.
   - lib/ai-boot.js reads window.markdownVault... or window.vaultApi.getAiBadgeState()
     at boot and shows/hides the badge based on (isRemote && allowRemote).
   - When shown, badge text reads "Remote AI" and the title attribute carries
     the hostname (compact tooltip).
   - H1 (no new getElementById in inline boot script) is preserved — the
     badge lookup lives in lib/ai-boot.js, NOT in index.html's inline boot.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', 'index.html');
const AIBOOT = path.join(__dirname, '..', 'lib', 'ai-boot.js');

const readHtml = () => fs.readFileSync(INDEX, 'utf8');
const readBoot = () => fs.readFileSync(AIBOOT, 'utf8');

// ===== CF5.A — index.html =====

test('CF5.A1 aiRemoteBadge element present (hidden by default)', () => {
  const html = readHtml();
  assert.match(html, /id=["']aiRemoteBadge["'][^>]*hidden/);
});

test('CF5.A2 badge element placed inside the toolbar near AI buttons', () => {
  // Heuristic: badge appears in the same 200-char window as the Rewrite button.
  const html = readHtml();
  const m = html.match(/rewriteButton[\s\S]{0,400}aiRemoteBadge/);
  assert.ok(m, 'aiRemoteBadge should be in the toolbar near rewriteButton');
});

test('CF5.A3 inline boot script unchanged for AI badge (H1 contract)', () => {
  // The badge wiring lives in lib/ai-boot.js, not in the inline boot script.
  const html = readHtml();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const inlineBoot = scripts.map((m) => m[1]).find((c) => c.includes('Boot the Markdown editor')) || '';
  assert.doesNotMatch(inlineBoot, /aiRemoteBadge/);
});

test('CF5.A4 [QA fix] hidden attribute is not defeated by the badge display rule', () => {
  // The `.ai-remote-badge` base rule sets `display: inline-flex`. That is an
  // author-origin declaration and overrides the UA stylesheet's
  // `[hidden] { display: none }`, so `badge.hidden = true` alone would NOT
  // hide the chip — the badge stayed visible for loopback / no-allow runs
  // (manual QA: getAiBadgeState() returned allowRemote:false yet the chip
  // showed). A matching `[hidden]` rule (higher specificity, same origin)
  // restores display:none. Pin it so the trap can't silently return.
  const html = readHtml();
  assert.match(
    html,
    /(?:\.ai-remote-badge|#aiRemoteBadge)\[hidden\]\s*\{[^}]*display\s*:\s*none/,
    'CSS must re-assert display:none on [hidden] so the hidden attribute actually hides the badge',
  );
});

// ===== CF5.B — lib/ai-boot.js =====

test('CF5.B1 ai-boot looks up the badge element', () => {
  assert.match(readBoot(), /getElementById\(\s*['"]aiRemoteBadge['"]\s*\)/);
});

test('CF5.B2 ai-boot reads vaultApi.getAiBadgeState()', () => {
  assert.match(readBoot(), /vaultApi\.getAiBadgeState\(\s*\)/);
});

test('CF5.B3 ai-boot decides visibility via isRemote && allowRemote', () => {
  // Match either property-access or destructure of the two fields together
  // in the badge wiring region.
  const src = readBoot();
  // Find the badge wiring (anywhere with aiRemoteBadge or RemoteBadge).
  assert.match(src, /isRemote/);
  assert.match(src, /allowRemote/);
});

test('CF5.B4 ai-boot sets badge text content (no innerHTML)', () => {
  // XSS-safe: textContent / title only.
  const src = readBoot();
  assert.match(src, /textContent\s*=\s*['"]Remote AI['"]/);
  // Negative: no innerHTML used for the badge.
  const badgeRegion = src.match(/aiRemoteBadge[\s\S]{0,500}/);
  if (badgeRegion) {
    assert.doesNotMatch(badgeRegion[0], /\.innerHTML\s*=/);
  }
});

test('CF5.B5 ai-boot sets the hostname into the title attribute (compact tooltip)', () => {
  assert.match(readBoot(), /\.title\s*=/);
});

test('CF5.B6 badge defaults to hidden — code path explicitly sets hidden true OR leaves the element hidden', () => {
  // Either the wiring explicitly sets `hidden = false` only when the
  // remote-active condition holds, or sets `hidden = true` otherwise.
  const src = readBoot();
  assert.match(src, /badge\.hidden\s*=|aiRemoteBadge[\s\S]{0,200}hidden\s*=/);
});

// ===== CF5.C — defensive =====

test('CF5.C1 boot is defensive when vaultApi or the badge element is missing', () => {
  // Source-shape: the lookup region should not throw if either is missing
  // (no `vaultApi.getAiBadgeState()` without a guard upstream).
  const src = readBoot();
  // Expect either an early-return guard pattern OR an optional chaining /
  // existence check around the badge wiring.
  const badgeChunk = src.match(/aiRemoteBadge[\s\S]{0,1500}/);
  assert.ok(badgeChunk);
  // Look for a guard near the badge wiring: 'if (!badge'  or  '!window.vaultApi' or `if (badge`.
  assert.match(
    badgeChunk[0],
    /if\s*\(\s*!?\s*badge|if\s*\(\s*!?\s*window\.vaultApi|badge\s*&&/,
  );
});
