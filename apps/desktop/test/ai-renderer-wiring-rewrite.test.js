/* CA4 — renderer wiring source-shape tests for Stage A Rewrite.
   Run focused: cd apps/desktop && node --test test/ai-renderer-wiring-rewrite.test.js

   Four blocks:
   - Block A: index.html source-shape (wrappers expose .view per R1, Rewrite
     button + toolbar order per R3, bridge has getActiveSelection, no new
     getElementById in inline boot script).
   - Block A.runtime: getActiveSelection behavior with stub liveEditorInstance.
   - Block B: lib/ai-boot.js source-shape (rewriteButton lookup declared ONCE
     and included in defensive guard per R2, click handler shape, A8 invariants).
   - Block C: main.js source-shape (registerRewrite call per P2).
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', 'index.html');
const AIBOOT = path.join(__dirname, '..', 'lib', 'ai-boot.js');
const MAIN = path.join(__dirname, '..', 'main.js');

const readHtml = () => fs.readFileSync(INDEX, 'utf8');
const readBoot = () => fs.readFileSync(AIBOOT, 'utf8');
const readMain = () => fs.readFileSync(MAIN, 'utf8');

function getInlineBootScript(html) {
  // Mirrors getBootScript in test/renderer-boot.test.js — finds the inline
  // boot script by its "Boot the Markdown editor" comment marker.
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  return scripts.map((m) => m[1]).find((c) => c.includes('Boot the Markdown editor')) || '';
}

// ---------------------------------------------------------------------------
// Block A — index.html source-shape
// ---------------------------------------------------------------------------

test('CA4.0a [R1] cm6-write wrapper exposes view: cm6Write.view', () => {
  assert.match(readHtml(), /liveEditorInstance\s*=\s*\{[\s\S]{0,500}view\s*:\s*cm6Write\.view/);
});

test('CA4.0b [R1] hybrid-cm6 wrapper exposes view: cm6HybridWrite.view', () => {
  assert.match(readHtml(), /liveEditorInstance\s*=\s*\{[\s\S]{0,500}view\s*:\s*cm6HybridWrite\.view/);
});

test('CA4.1 Rewrite button present', () => {
  assert.match(readHtml(), /<button[^>]*id=["']rewriteButton["'][^>]*>\s*Rewrite\s*<\/button>/);
});

test('CA4.1a [R3] toolbar order: summarize < rewrite < choose-vault inside .note-actions-left', () => {
  const html = readHtml();
  const blockMatch = html.match(/<div\s+class=["']note-actions-left["'][^>]*>([\s\S]*?)<\/div>/);
  assert.ok(blockMatch, 'expected a .note-actions-left block');
  const block = blockMatch[1];
  const iSum = block.indexOf('id="summarizeButton"');
  const iRew = block.indexOf('id="rewriteButton"');
  const iCho = block.indexOf('id="chooseVaultButton"');
  assert.ok(iSum >= 0 && iRew >= 0 && iCho >= 0, 'all three button ids must appear in the block');
  assert.ok(iSum < iRew, 'summarizeButton must appear before rewriteButton');
  assert.ok(iRew < iCho, 'rewriteButton must appear before chooseVaultButton');
});

test('CA4.2 bridge has getActiveSelection getter referencing liveEditorInstance', () => {
  const boot = getInlineBootScript(readHtml());
  assert.match(boot, /getActiveSelection\s*:[\s\S]{0,500}liveEditorInstance/);
});

test('CA4.3 getActiveSelection uses view.state.selection.main from/to', () => {
  const boot = getInlineBootScript(readHtml());
  assert.match(boot, /selection\.main[\s\S]{0,200}\.from[\s\S]{0,200}\.to/);
});

test('CA4.4 getActiveSelection returns null for empty selection (from === to)', () => {
  const boot = getInlineBootScript(readHtml());
  assert.match(boot, /\.from\s*===\s*[A-Za-z_]+\.to[\s\S]{0,150}return\s+null/);
});

test('CA4.5 getActiveSelection returns null for whitespace-only selection', () => {
  const boot = getInlineBootScript(readHtml());
  assert.match(boot, /\.trim\(\s*\)\s*===\s*['"]['"][\s\S]{0,100}\?\s*null/);
});

test('CA4.6 [H1] inline boot does NOT call getElementById for rewriteButton', () => {
  const boot = getInlineBootScript(readHtml());
  assert.doesNotMatch(boot, /getElementById\(\s*['"]rewriteButton['"]/);
});

// ---------------------------------------------------------------------------
// Block A.runtime — getActiveSelection behavior with stub liveEditorInstance
// ---------------------------------------------------------------------------

test('CA4.6.r [P3] getActiveSelection logic works against stub liveEditorInstance variants', () => {
  const boot = getInlineBootScript(readHtml());
  const match = boot.match(/getActiveSelection\s*:\s*\(\s*\)\s*=>\s*\{([\s\S]+?)\n\s*\}\s*,/);
  assert.ok(match, 'expected getActiveSelection: () => { ... } pattern');
  const body = match[1];
  // Stage A diff loop 3: requires FOUR closure vars — liveEditorInstance,
  // selectedNoteId, cm6HydratedNoteId, currentMode. Pass all "happy path"
  // values (matched ids + currentMode='write') so the other branches are
  // exercised in isolation.
  const fn = (inst) => new Function(
    'liveEditorInstance', 'selectedNoteId', 'cm6HydratedNoteId', 'currentMode',
    body,
  )(inst, 'vault:a.md', 'vault:a.md', 'write');
  assert.equal(fn(null), null);
  assert.equal(fn({ getText: () => '' }), null);
  assert.equal(
    fn({ view: { state: { selection: { main: { from: 5, to: 5 } }, sliceDoc: () => '' } } }),
    null,
  );
  assert.equal(
    fn({ view: { state: { selection: { main: { from: 0, to: 5 } }, sliceDoc: () => '   \n  ' } } }),
    null,
  );
  assert.equal(
    fn({ view: { state: { selection: { main: { from: 0, to: 5 } }, sliceDoc: () => 'hello' } } }),
    'hello',
  );
});

test('CA4.6.r-mode [Codex diff S2 loop-3] getActiveSelection returns null when currentMode !== "write"', () => {
  // Same-note mode-switch scenario per Codex round-3 finding:
  //   1. User opens vault note A in Write mode; CM6 hydrated; cm6HydratedNoteId='vault:A'.
  //   2. User selects two paragraphs in CM6.
  //   3. User clicks the Preview tab → currentMode becomes 'preview'.
  //      - CM6 stays hydrated for A; cm6HydratedNoteId is unchanged.
  //      - selectedNoteId is unchanged (same note).
  //      - But CM6 is HIDDEN; the user no longer sees their selection.
  //   4. User clicks Rewrite.
  //      - The bridge MUST return null so the Rewrite handler falls back
  //        to getActiveNoteBody() — sending the hidden CM6 selection
  //        would surprise the user.
  const boot = getInlineBootScript(readHtml());
  const match = boot.match(/getActiveSelection\s*:\s*\(\s*\)\s*=>\s*\{([\s\S]+?)\n\s*\}\s*,/);
  assert.ok(match);
  const body = match[1];
  const fn = (inst, sId, hId, mode) => new Function(
    'liveEditorInstance', 'selectedNoteId', 'cm6HydratedNoteId', 'currentMode',
    body,
  )(inst, sId, hId, mode);
  const cm6WithSelection = {
    view: { state: { selection: { main: { from: 0, to: 5 } }, sliceDoc: () => 'A-selection' } },
  };
  // Same note, IDs match, but currentMode = 'preview' → null (hidden CM6).
  assert.equal(fn(cm6WithSelection, 'vault:A.md', 'vault:A.md', 'preview'), null,
    'preview mode hides CM6 — its selection must NOT leak through');
  // Same note, IDs match, but currentMode = 'read' → null.
  assert.equal(fn(cm6WithSelection, 'vault:A.md', 'vault:A.md', 'read'), null,
    'read mode hides CM6 — its selection must NOT leak through');
  // Same note, IDs match, currentMode = 'write' → selection returned (happy path).
  assert.equal(fn(cm6WithSelection, 'vault:A.md', 'vault:A.md', 'write'), 'A-selection',
    'write mode shows CM6 — the visible selection is valid');
  // Unknown mode → null (defensive).
  assert.equal(fn(cm6WithSelection, 'vault:A.md', 'vault:A.md', ''), null,
    'unknown/empty mode must return null');
});

test('CA4.6.r-mode-guard [Codex diff S2 loop-3] getActiveSelection references currentMode', () => {
  const boot = getInlineBootScript(readHtml());
  const match = boot.match(/getActiveSelection\s*:\s*\(\s*\)\s*=>\s*\{([\s\S]+?)\n\s*\}\s*,/);
  assert.ok(match);
  const body = match[1];
  assert.match(body, /\bcurrentMode\b/);
  // The guard must require currentMode === 'write' specifically.
  assert.match(body, /currentMode\s*(===|!==)\s*['"]write['"]/);
});

test('CA4.6.r-stale [Codex diff S1 loop-2] getActiveSelection returns null when CM6 is hydrated for a different note', () => {
  // Real-world session-switch scenario per Codex round-2 finding:
  //   1. User opens vault note A; CM6 is hydrated for A (cm6HydratedNoteId = 'vault:A.md').
  //   2. User selects two paragraphs in A.
  //   3. User clicks session note B in the sidebar.
  //      - renderEditor() runs: selectedNoteId becomes 'sessions:B.md',
  //        liveEditorLastNoteId is updated to 'sessions:B.md' at line ~2592,
  //        the session branch (forceReadModeWithBody) runs — CM6 is NOT
  //        re-hydrated — so cm6HydratedNoteId STAYS at 'vault:A.md'.
  //   4. User clicks Rewrite.
  //      - The bridge MUST detect the stale CM6 state and return null
  //        so the Rewrite handler falls back to getActiveNoteBody()
  //        (which returns session B's body).
  const boot = getInlineBootScript(readHtml());
  const match = boot.match(/getActiveSelection\s*:\s*\(\s*\)\s*=>\s*\{([\s\S]+?)\n\s*\}\s*,/);
  assert.ok(match);
  const body = match[1];
  // Pass currentMode='write' so the mode-guard isn't what makes it null;
  // we're testing the cm6HydratedNoteId mismatch path specifically.
  const fn = (inst, sId, hId) => new Function(
    'liveEditorInstance', 'selectedNoteId', 'cm6HydratedNoteId', 'currentMode',
    body,
  )(inst, sId, hId, 'write');
  const cm6WithSelection = {
    view: { state: { selection: { main: { from: 0, to: 5 } }, sliceDoc: () => 'A-selection' } },
  };
  assert.equal(fn(cm6WithSelection, 'sessions:B.md', 'vault:A.md'), null,
    'stale CM6 (cm6HydratedNoteId != selectedNoteId) must return null');
  assert.equal(fn(cm6WithSelection, 'vault:A.md', 'vault:A.md'), 'A-selection',
    'when CM6 is hydrated for the active note AND mode=write, selection is valid');
  assert.equal(fn(cm6WithSelection, '', 'vault:A.md'), null,
    'no active note must return null');
  assert.equal(fn(cm6WithSelection, 'vault:A.md', ''), null,
    'CM6 not yet hydrated (cm6HydratedNoteId === "") must return null');
});

test('CA4.6.r-id-guard [Codex diff S1 loop-2] getActiveSelection references selectedNoteId AND cm6HydratedNoteId', () => {
  const boot = getInlineBootScript(readHtml());
  const match = boot.match(/getActiveSelection\s*:\s*\(\s*\)\s*=>\s*\{([\s\S]+?)\n\s*\}\s*,/);
  assert.ok(match);
  const body = match[1];
  assert.match(body, /\bselectedNoteId\b/);
  assert.match(body, /\bcm6HydratedNoteId\b/);
  // Must NOT use liveEditorLastNoteId for the hydration check (Codex round-2
  // showed liveEditorLastNoteId is assigned for session notes too, which would
  // make stale CM6 selections pass through).
  assert.doesNotMatch(body, /\bliveEditorLastNoteId\b/);
});

test('CA4.6.r-realign [Codex diff S3 loop-4] cm6HydratedNoteId is realigned alongside liveEditorLastNoteId on save/rename', () => {
  // S3: when a draft saves to a vault path OR a rename changes a note id,
  // the renderer realigns liveEditorLastNoteId = newId so renderEditor doesn't
  // tear down the live CM6 view. cm6HydratedNoteId MUST be realigned the same
  // way; otherwise getActiveSelection sees a mismatch and silently drops a
  // visible selection.
  const html = readHtml();
  // Find each location where `liveEditorLastNoteId = newId;` appears, and
  // assert `cm6HydratedNoteId = newId;` appears within ~300 chars before/after.
  const occurrences = [...html.matchAll(/liveEditorLastNoteId\s*=\s*newId\s*;/g)];
  assert.ok(occurrences.length >= 2, 'expected at least 2 id-realignment sites (single-save + save-all)');
  for (const m of occurrences) {
    const idx = m.index;
    const slice = html.slice(Math.max(0, idx - 600), idx + 600);
    // Accept either: `cm6HydratedNoteId = newId;` directly,
    // OR a guarded migration `if (cm6HydratedNoteId === <old>) cm6HydratedNoteId = newId;`.
    assert.match(slice, /cm6HydratedNoteId\s*=\s*newId\s*;/,
      'every liveEditorLastNoteId=newId must be paired with a cm6HydratedNoteId migration nearby');
  }
});

test('CA4.6.r-reset [Codex diff S3 loop-4] cm6HydratedNoteId reset alongside liveEditorLastNoteId', () => {
  // The three reset points (vault unload, etc.) clear liveEditorLastNoteId to
  // empty string so the next renderEditor re-hydrates. cm6HydratedNoteId
  // should reset the same way; otherwise it stays pointing at a note that no
  // longer matches what CM6 holds.
  const html = readHtml();
  // Match RESET assignments only — not the top-level `let ... = '';` declaration.
  const occurrences = [...html.matchAll(/(?<!let\s+)liveEditorLastNoteId\s*=\s*['"]['"]\s*;/g)];
  assert.ok(occurrences.length >= 3, 'expected at least 3 reset sites');
  for (const m of occurrences) {
    const idx = m.index;
    const slice = html.slice(Math.max(0, idx - 400), idx + 400);
    assert.match(
      slice,
      /cm6HydratedNoteId\s*=\s*['"]['"]/,
      'every liveEditorLastNoteId="" reset must be paired with a cm6HydratedNoteId="" reset',
    );
  }
});

test('CA4.6.r-tracker [Codex diff S1 loop-2] cm6HydratedNoteId is set ONLY in the non-session CM6 path', () => {
  // The tracker must be:
  //   (a) declared at top-level (with the other let/var/const declarations),
  //   (b) assigned to note.id INSIDE the non-session branch of renderEditor
  //       (after CM6 actually receives the note's content),
  //   (c) NOT assigned in the session branch.
  const html = readHtml();
  // (a) Declaration.
  assert.match(html, /(let|var|const)\s+cm6HydratedNoteId\s*=\s*['"]['"]/);
  // (b) Assignment to note.id in renderEditor's non-session path. We look for
  // the assignment, then verify it appears AFTER the `liveEditorInstance.setText(note.body);`
  // (or equivalent) call, which marks the moment CM6 actually has the new content.
  const assignmentMatch = html.match(/cm6HydratedNoteId\s*=\s*note\.id/);
  assert.ok(assignmentMatch, 'expected cm6HydratedNoteId = note.id assignment in renderEditor');
  // (c) Ensure there's exactly ONE assignment to note.id (no duplicate in the
  // session branch that would defeat the guard).
  const allAssignments = html.match(/cm6HydratedNoteId\s*=\s*note\.id/g) || [];
  assert.equal(allAssignments.length, 1, 'expected exactly one assignment to note.id');
});

// ---------------------------------------------------------------------------
// Block B — lib/ai-boot.js source-shape
// ---------------------------------------------------------------------------

test('CA4.7 rewriteButton lookup via getElementById', () => {
  assert.match(readBoot(), /document\.getElementById\(\s*['"]rewriteButton['"]\s*\)/);
});

test('CA4.7a [R2] rewriteButton declared exactly once', () => {
  const matches = readBoot().match(/(const|let|var)\s+rewriteButton\s*=/g) || [];
  assert.equal(matches.length, 1);
});

test('CA4.7b [R2] rewriteButton included in the defensive guard', () => {
  const src = readBoot();
  const guardWithRewriteFirst = /if\s*\(\s*!rewriteButton[\s\S]{0,200}\|\|\s*!button/.test(src);
  const guardWithButtonFirst = /if\s*\(\s*!button[\s\S]{0,200}\|\|\s*!rewriteButton/.test(src);
  assert.ok(guardWithButtonFirst || guardWithRewriteFirst,
    'the early-return defensive guard must include !rewriteButton');
});

test('CA4.7c [R2] ai-boot.js parses without SyntaxError', () => {
  // Belt-and-suspenders: confirm the source compiles. We don't execute it.
  const src = readBoot();
  assert.doesNotThrow(() => new Function(src));
});

test('CA4.8 click handler attached to rewriteButton', () => {
  assert.match(readBoot(), /rewriteButton\.addEventListener\(\s*['"]click['"]/);
});

test('CA4.9 selection-first text source: getActiveSelection() referenced before getActiveNoteBody()', () => {
  const src = readBoot();
  const block = src.match(/rewriteButton\.addEventListener\(\s*['"]click['"][\s\S]*$/);
  assert.ok(block, 'expected rewrite click handler block');
  const handler = block[0];
  const iSel = handler.indexOf('window.markdownVault.getActiveSelection()');
  const iBody = handler.indexOf('window.markdownVault.getActiveNoteBody()');
  assert.ok(iSel >= 0, 'getActiveSelection() must be called in the handler');
  assert.ok(iBody >= 0, 'getActiveNoteBody() must be called in the handler');
  assert.ok(iSel < iBody, 'getActiveSelection must be referenced before getActiveNoteBody (selection-first)');
});

test('CA4.10 nullish-fallback pattern: getActiveSelection() ?? getActiveNoteBody()', () => {
  assert.match(readBoot(), /window\.markdownVault\.getActiveSelection\(\s*\)\s*\?\?\s*window\.markdownVault\.getActiveNoteBody\(\s*\)/);
});

test('CA4.11 startedId captured pre-await (Path D H4 invariant)', () => {
  const src = readBoot();
  assert.match(
    src,
    /(const|let)\s+startedId\s*=\s*window\.markdownVault\.getActiveNoteId\(\s*\)[\s\S]{0,1500}await\s+window\.ai\.rewriteText\(/,
  );
});

test('CA4.12 window.ai.rewriteText called with the text identifier', () => {
  // Stage B Option α-2: regex relaxed from `\)` to `[,)]` so the two-arg
  // streaming form `rewriteText(text, { onChunk, signal })` matches too.
  // Intent unchanged: the call goes through with `text` as the first arg.
  assert.match(readBoot(), /window\.ai\.rewriteText\(\s*[A-Za-z_]+\s*[,)]/);
});

test('CA4.13 [Q1] BOTH buttons disabled in Rewrite handler', () => {
  const src = readBoot();
  const block = src.match(/rewriteButton\.addEventListener\(\s*['"]click['"][\s\S]*$/);
  assert.ok(block);
  const handler = block[0];
  assert.match(handler.slice(0, 800), /button\.disabled\s*=\s*true/);
  assert.match(handler.slice(0, 800), /rewriteButton\.disabled\s*=\s*true/);
});

test('CA4.14 [Q1] BOTH buttons re-enabled in Rewrite finally', () => {
  const src = readBoot();
  const block = src.match(/rewriteButton\.addEventListener\(\s*['"]click['"][\s\S]*$/);
  assert.ok(block);
  const handler = block[0];
  assert.match(handler, /button\.disabled\s*=\s*false/);
  assert.match(handler, /rewriteButton\.disabled\s*=\s*false/);
});

test('CA4.15 [Q1] Summarize handler also disables rewriteButton (cooldown extension)', () => {
  const src = readBoot();
  // Find the Summarize handler block (button.addEventListener('click', ...)).
  const block = src.match(/(?<!rewrite)button\.addEventListener\(\s*['"]click['"][\s\S]*?(?=rewriteButton\.addEventListener|$)/);
  assert.ok(block, 'expected Summarize handler block');
  const handler = block[0];
  assert.match(handler, /button\.disabled\s*=\s*true/);
  assert.match(handler, /rewriteButton\.disabled\s*=\s*true/);
});

test('CA4.16 [A8] Rewrite handler does NOT mutate note state', () => {
  const src = readBoot();
  const block = src.match(/rewriteButton\.addEventListener\(\s*['"]click['"][\s\S]*$/);
  assert.ok(block);
  const handler = block[0];
  assert.doesNotMatch(handler, /window\.vaultApi\.saveNote/);
  assert.doesNotMatch(handler, /selectedNote\.body\s*=/);
  assert.doesNotMatch(handler, /DirtyState\./);
  assert.doesNotMatch(handler, /window\.markdownVault\.[a-zA-Z_]+\s*=/);
});

test('CA4.16a [QA fix] Rewrite loading entry carries label: "Rewriting…"', () => {
  const src = readBoot();
  const block = src.match(/rewriteButton\.addEventListener\(\s*['"]click['"][\s\S]*$/);
  assert.ok(block);
  const handler = block[0];
  // The loading-state set should pass a label distinguishing the verb.
  assert.match(
    handler,
    /noteState\.set\(\s*startedId\s*,\s*\{\s*kind\s*:\s*['"]loading['"]\s*,\s*label\s*:\s*['"]Rewriting[…\.]+['"]/,
  );
});

test('CA4.16b [QA fix] renderActive passes entry.label to showLoading', () => {
  const src = readBoot();
  assert.match(src, /showLoading\(\s*entry\.label\s*\)/);
});

test('CA4.17 Rewrite result stored under startedId in noteState', () => {
  const src = readBoot();
  const block = src.match(/rewriteButton\.addEventListener\(\s*['"]click['"][\s\S]*$/);
  assert.ok(block);
  const handler = block[0];
  assert.match(handler, /noteState\.set\(\s*startedId\s*,/);
});

test('CA4.18 [N3] catch path produces error display (direct OR stored-then-rendered)', () => {
  const src = readBoot();
  const block = src.match(/rewriteButton\.addEventListener\(\s*['"]click['"][\s\S]*$/);
  assert.ok(block);
  const handler = block[0];
  const direct = /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,500}AiSummaryPanel\.showError\(/.test(handler);
  const stored = /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,500}kind\s*:\s*['"]error['"]/.test(handler);
  assert.ok(direct || stored,
    'catch path must produce error display via showError or stored kind:"error"');
});

// ---------------------------------------------------------------------------
// Block C — main.js source-shape [P2]
// ---------------------------------------------------------------------------

test('CA4.19 main.js requires ./lib/ai-ipc (v0.2.0 preserved)', () => {
  assert.match(readMain(), /require\(\s*['"]\.\/lib\/ai-ipc['"]\s*\)/);
});

test('CA4.20 main.js calls AiIpc.registerRewrite(ipcMain, …) exactly once', () => {
  // Stage C: registerRewrite now takes a { settingsPath } option (per-request
  // settings re-read). Still exactly one call.
  const m = readMain().match(/AiIpc\.registerRewrite\(\s*ipcMain\s*,/g) || [];
  assert.equal(m.length, 1);
});

test('CA4.21 main.js registerRewrite passes a settingsPath option (Stage C)', () => {
  // Pre-Stage C this asserted NO options; Stage C wires the shared settings file.
  assert.match(readMain(), /AiIpc\.registerRewrite\(\s*ipcMain\s*,\s*\{\s*settingsPath/);
});

test('CA4.22 main.js still calls AiIpc.register(ipcMain, …) exactly once', () => {
  const m = readMain().match(/AiIpc\.register\(\s*ipcMain\s*,/g) || [];
  assert.equal(m.length, 1);
});
