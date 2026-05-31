/* Stage A WAVE 13 — documentation contract.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-doc-contract.test.js

   These tests pin that the four required doc updates per spec
   AC-13, AC-14, AC-15 actually landed:
     - CLAUDE.md scopes the "Decoration.mark only" invariant to hybrid-cm6
       and explicitly permits Decoration.replace + WidgetType for
       hybrid-cm6-lp. Raw-Markdown-as-source-of-truth applies to BOTH.
     - README.md engine table contains a row for hybrid-cm6-lp.
     - README.md "Live styling" section mentions the new engine.
     - docs/stage-history.md has a row mentioning Stage A.
     - docs/test-manual.md has a Stage A section. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const claudeMd     = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
const readmeMd     = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const stageHistory = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'stage-history.md'), 'utf8');
const testManual   = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'test-manual.md'), 'utf8');

// ── AC-13: CLAUDE.md invariant scoping ───────────────────────────────────

test('Stage A WAVE 13-T13a: CLAUDE.md mentions hybrid-cm6-lp', () => {
  assert.ok(claudeMd.indexOf('hybrid-cm6-lp') >= 0,
    'CLAUDE.md must mention the new hybrid-cm6-lp engine');
});

test('Stage A WAVE 13-T13b: CLAUDE.md scopes Decoration.mark-only to legacy hybrid-cm6', () => {
  // The invariant text must explicitly distinguish hybrid-cm6 from hybrid-cm6-lp.
  // Look for both "hybrid-cm6" + "Decoration.mark" + "hybrid-cm6-lp" within
  // the same architecture section context.
  assert.match(claudeMd, /hybrid-cm6\b[\s\S]{0,500}Decoration\.mark/i,
    'CLAUDE.md must say hybrid-cm6 uses Decoration.mark (only)');
  assert.match(claudeMd, /hybrid-cm6-lp[\s\S]{0,500}Decoration\.replace/i,
    'CLAUDE.md must say hybrid-cm6-lp permits Decoration.replace');
  assert.match(claudeMd, /hybrid-cm6-lp[\s\S]{0,500}WidgetType/i,
    'CLAUDE.md must say hybrid-cm6-lp permits WidgetType');
});

test('Stage A WAVE 13-T13c: CLAUDE.md restates raw-Markdown-as-source-of-truth for BOTH engines', () => {
  // The shared invariant phrasing must appear and clearly apply to both engines.
  // The actual phrasing in CLAUDE.md is "source of truth (applies to BOTH ... and ...)".
  assert.match(claudeMd, /source of truth[\s\S]{0,200}(BOTH|both)/i,
    'CLAUDE.md should explicitly say the source-of-truth invariant applies to BOTH engines');
  // And the two engine names should appear near the BOTH/both reference.
  assert.match(claudeMd, /(BOTH|both)[\s\S]{0,200}hybrid-cm6-lp/,
    'CLAUDE.md should mention hybrid-cm6-lp in the BOTH-engines clause');
});

// ── AC-14: README.md engine table ────────────────────────────────────────

test('Stage A WAVE 13-T14a: README.md engine table includes hybrid-cm6-lp', () => {
  assert.ok(readmeMd.indexOf('hybrid-cm6-lp') >= 0,
    'README.md must mention hybrid-cm6-lp');
  // The engine table row begins with `| hybrid-cm6-lp |`.
  assert.match(readmeMd, /\|\s*`?hybrid-cm6-lp`?\s*\|/,
    'README.md engine table must have a hybrid-cm6-lp row');
});

test('Stage A WAVE 13-T14b: README.md "Live styling" section mentions hybrid-cm6-lp', () => {
  // The Live styling section header should mention both engines.
  assert.match(readmeMd, /Live styling[\s\S]{0,200}hybrid-cm6-lp/,
    'README.md Live styling section must cover hybrid-cm6-lp');
});

test('Stage A WAVE 13-T14c: README.md "Four Write engines" replaces "Three Write engines"', () => {
  // After Stage A there are 4 engines, not 3.
  assert.match(readmeMd, /Four Write engines/i,
    'README.md must say "Four Write engines" after Stage A');
});

// ── AC-15: docs/stage-history.md + docs/test-manual.md ──────────────────

test('Stage A WAVE 13-T15a: docs/stage-history.md has a Stage A row', () => {
  // Look for "| A |" as the stage column or "Stage A" mention.
  assert.match(stageHistory, /\|\s*A\s*\|\s*Live-preview engine/,
    'docs/stage-history.md must have a Stage A table row mentioning the live-preview engine');
});

test('Stage A WAVE 13-T15b: docs/stage-history.md Stage A row references hybrid-cm6-lp', () => {
  // The row body should reference the engine name.
  assert.ok(stageHistory.indexOf('hybrid-cm6-lp') >= 0,
    'Stage A row must reference the hybrid-cm6-lp engine name');
});

test('Stage A WAVE 13-T15c: docs/test-manual.md has a Stage A section', () => {
  assert.match(testManual, /##\s+Stage A/,
    'docs/test-manual.md must have a "## Stage A" section header');
});

test('Stage A WAVE 13-T15d: docs/test-manual.md Stage A section includes the decoration-overlap manual gate', () => {
  // R2-MAJOR 3 mandated a manual QA gate verifying decoration overlap at DOM level.
  // Look for the load-bearing instruction.
  assert.match(testManual, /Stage A[\s\S]+Decoration[- ]overlap/,
    'docs/test-manual.md Stage A section must include the decoration-overlap manual gate (R2-MAJOR 3)');
});

test('Stage A WAVE 13-T15e: docs/test-manual.md Stage A section includes atomic-range cursor checks', () => {
  assert.match(testManual, /Stage A[\s\S]+atomic/i,
    'docs/test-manual.md Stage A section must cover atomic-range cursor motion');
});

test('Stage A WAVE 13-T15f: docs/test-manual.md Stage A section includes Chinese IME check', () => {
  assert.match(testManual, /Stage A[\s\S]+IME/,
    'docs/test-manual.md Stage A section must cover Chinese IME (CLAUDE.md focus area)');
});

// ── Stage B WAVE 7 — docs reflect Stage B coverage ──────────────────────

test('Stage B WAVE 7-T-D-1: CLAUDE.md mentions Stage B + four new marker types', () => {
  assert.match(claudeMd, /Stage B/,
    'CLAUDE.md must mention "Stage B"');
  // The four new categories should appear in the lp-engine description.
  assert.match(claudeMd, /inline.code/i,    'mentions inline code');
  assert.match(claudeMd, /strikethrough/i,  'mentions strikethrough');
  assert.match(claudeMd, /inline.link/i,    'mentions inline link');
  assert.match(claudeMd, /inline.image/i,   'mentions inline image');
});

test('Stage B WAVE 7-T-D-2: README.md hybrid-cm6-lp row mentions Stage B coverage', () => {
  // Find the engine table row and verify it covers Stage B.
  assert.match(readmeMd, /hybrid-cm6-lp[\s\S]{0,1000}Stage B/,
    'README.md engine table row for hybrid-cm6-lp must mention Stage B');
  assert.match(readmeMd, /hybrid-cm6-lp[\s\S]{0,1500}(inline.code|strikethrough|inline.link|inline.image)/i,
    'README.md hybrid-cm6-lp row must mention at least one Stage B marker category');
});

test('Stage B WAVE 7-T-D-3: README.md Live styling section mentions Stage B coverage', () => {
  // The Live styling section header or body should reference Stage B
  // either directly ("Stage B") or via the "Stages A + B" phrasing the
  // updated section header uses.
  assert.match(readmeMd, /Live styling[\s\S]{0,2000}Stages?\s+(A\s*\+\s*)?B/,
    'README.md "Live styling" subsection must mention Stage B (or Stages A + B)');
});

test('Stage B WAVE 7-T-D-4: docs/stage-history.md has a Stage B row', () => {
  assert.match(stageHistory, /\|\s*B\s*\|/,
    'docs/stage-history.md must have a "| B |" table row');
  assert.match(stageHistory, /\|\s*B\s*\|[\s\S]{0,500}hybrid-cm6-lp/,
    'Stage B row must reference hybrid-cm6-lp');
});

test('Stage B WAVE 7-T-D-5: docs/test-manual.md has a Stage B section', () => {
  assert.match(testManual, /##\s+Stage B/,
    'docs/test-manual.md must have a "## Stage B" section header');
});

test('Stage B WAVE 7-T-D-6: docs/test-manual.md Stage B section includes DOM-overlap gates for new marker types', () => {
  // MQ-B2..B5 are the per-construct load-bearing gates.
  assert.match(testManual, /MQ-B2/, 'inline-code DOM overlap gate');
  assert.match(testManual, /MQ-B3/, 'strikethrough DOM overlap gate');
  assert.match(testManual, /MQ-B4/, 'inline link DOM overlap gate');
  assert.match(testManual, /MQ-B5/, 'inline image DOM overlap gate');
});

test('Stage B WAVE 7-T-D-7: docs/test-manual.md Stage B section preserves Stage A regression check', () => {
  // MQ-B14 verifies Stage A emphasis still works.
  assert.match(testManual, /MQ-B14[\s\S]{0,500}Stage A emphasis/,
    'docs/test-manual.md Stage B section must include a Stage A regression gate');
});

// ── Stage C WAVE 7 — docs reflect Stage C coverage ──────────────────────

test('Stage C WAVE 7-T-DC-1: CLAUDE.md mentions Stage C + WidgetType image rendering + URL allowlist + IPC', () => {
  assert.match(claudeMd, /Stage C/,
    'CLAUDE.md must mention "Stage C"');
  // Stage C introduces actual WidgetType-based image rendering.
  assert.match(claudeMd, /InlineImageWidget|inline image[s]?[\s\S]{0,200}WidgetType|WidgetType[\s\S]{0,400}<img>/i,
    'CLAUDE.md must describe Stage C as rendering actual <img> via WidgetType');
  // URL allowlist surface.
  assert.match(claudeMd, /isSafeImageUrl|URL[ -]?allowlist|allowlist/i,
    'CLAUDE.md must describe the URL/path security allowlist');
  // IPC contract.
  assert.match(claudeMd, /resolve-image-path|resolveImagePath/,
    'CLAUDE.md must reference the resolve-image-path IPC contract');
});

test('Stage C WAVE 7-T-DC-2: README.md hybrid-cm6-lp row mentions Stage C coverage', () => {
  assert.match(readmeMd, /hybrid-cm6-lp[\s\S]{0,2000}Stage C/,
    'README.md engine table row for hybrid-cm6-lp must mention Stage C');
  assert.match(readmeMd, /hybrid-cm6-lp[\s\S]{0,2500}<img>/,
    'README.md hybrid-cm6-lp row must mention <img> rendering for Stage C');
});

test('Stage C WAVE 7-T-DC-3: README.md "Live styling" section mentions Stage C coverage', () => {
  assert.match(readmeMd, /Live styling[\s\S]{0,2000}Stages?\s+(A\s*\+\s*B\s*\+\s*)?C/,
    'README.md "Live styling" subsection must mention Stage C (or Stages A + B + C)');
});

test('Stage C WAVE 7-T-DC-4: docs/stage-history.md has a Stage C row referencing hybrid-cm6-lp + WidgetType', () => {
  assert.match(stageHistory, /\|\s*C\s*\|/,
    'docs/stage-history.md must have a "| C |" table row');
  assert.match(stageHistory, /\|\s*C\s*\|[\s\S]{0,500}hybrid-cm6-lp/,
    'Stage C row must reference hybrid-cm6-lp');
  assert.match(stageHistory, /\|\s*C\s*\|[\s\S]{0,2000}WidgetType/,
    'Stage C row must reference WidgetType (the new rendering surface)');
});

test('Stage C WAVE 7-T-DC-5: docs/test-manual.md has a Stage C section', () => {
  assert.match(testManual, /##\s+Stage C/,
    'docs/test-manual.md must have a "## Stage C" section header');
});

test('Stage C WAVE 7-T-DC-6: docs/test-manual.md Stage C section includes load-bearing gates for image rendering + security', () => {
  // MQ-C2 (https <img>), MQ-C4 (rejected URL security), MQ-C5 (vault-relative),
  // MQ-C6 (outside-vault rejection), MQ-C12 (on-active toggle) are the
  // load-bearing per-construct gates.
  assert.match(testManual, /MQ-C2/, 'https image rendering gate');
  assert.match(testManual, /MQ-C4/, 'rejected URL security gate');
  assert.match(testManual, /MQ-C5/, 'vault-relative resolution gate');
  assert.match(testManual, /MQ-C6/, 'outside-vault rejection gate');
  assert.match(testManual, /MQ-C12/, 'on-active toggle gate');
});

test('Stage C WAVE 7-T-DC-7: docs/test-manual.md Stage C section preserves Stage A + B regression check', () => {
  assert.match(testManual, /MQ-C17[\s\S]{0,500}Stage A \+ B/,
    'docs/test-manual.md Stage C section must include a Stage A + B regression gate (MQ-C17)');
});
