/* T9 — renderer wiring source-shape tests.
   Run focused: cd apps/desktop && node --test test/ai-renderer-wiring.test.js

   Three blocks of source-shape regex assertions:
   - Block A: index.html (toolbar button, empty panel shell, two <script src> tags,
              window.markdownVault bridge using getSelectedNote(), NO new
              getElementById calls inside the inline boot script (H1))
   - Block B: lib/ai-boot.js (DOMContentLoaded handler that mounts the panel,
              captures startedId BEFORE await (H4), AiSummaryPanel.clear() on
              stale-result branch (I4), try/catch/finally with showError catch (G6),
              negative regexes for note mutation (A8))
   - Block C: main.js (one require + one AiIpc.register(ipcMain, { settingsPath })
              call — Stage C passes a settingsPath option for per-request settings) [I2]
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

// ---------------------------------------------------------------------------
// Block A — index.html source-shape
// ---------------------------------------------------------------------------

test('T9.0 lib/ai-boot.js exists', () => {
  assert.ok(fs.existsSync(AIBOOT), 'expected apps/desktop/lib/ai-boot.js to exist');
});

test('T9.1 Summarize button present in toolbar', () => {
  assert.match(readHtml(), /<button[^>]*id=["']summarizeButton["'][^>]*>\s*Summarize\s*<\/button>/);
});

test('T9.2 Result panel shell present (empty, hidden — F4)', () => {
  assert.match(readHtml(), /<div[^>]*id=["']aiSummaryPanel["'][^>]*hidden[^>]*>\s*<\/div>/);
});

test('T9.3 ai-result-panel script tag included exactly once', () => {
  const m = readHtml().match(/src=["'](?:\.\/)?lib\/ai-result-panel\.js["']/g);
  assert.equal(m && m.length, 1);
});

test('T9.3b ai-boot script tag included exactly once', () => {
  const m = readHtml().match(/src=["'](?:\.\/)?lib\/ai-boot\.js["']/g);
  assert.equal(m && m.length, 1);
});

function getInlineBootScript(html) {
  // Find the inline script that contains the "Boot the Markdown editor"
  // comment, matching renderer-boot.test.js's getBootScript() exactly.
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  return scripts.map((m) => m[1]).find((c) => c.includes('Boot the Markdown editor')) || '';
}

test('T9.3c [H1] inline boot script does NOT call getElementById for AI elements', () => {
  const boot = getInlineBootScript(readHtml());
  assert.doesNotMatch(boot, /getElementById\(\s*['"]summarizeButton['"]/);
  assert.doesNotMatch(boot, /getElementById\(\s*['"]aiSummaryPanel['"]/);
});

test('T9.3d [H1] inline boot script defines window.markdownVault with both getters', () => {
  const boot = getInlineBootScript(readHtml());
  assert.match(boot, /window\.markdownVault\s*=\s*\{[\s\S]{0,400}getActiveNoteBody[\s\S]{0,400}getActiveNoteId/);
});

test('T9.3e [H1 + I1] getActiveNoteBody uses bodyForRead(getSelectedNote())', () => {
  const boot = getInlineBootScript(readHtml());
  assert.match(boot, /getActiveNoteBody\s*:\s*\(\s*\)\s*=>\s*bodyForRead\(\s*getSelectedNote\(\s*\)\s*\)/);
});

test('T9.3f [H1 + I1] getActiveNoteId reads getSelectedNote().id', () => {
  const boot = getInlineBootScript(readHtml());
  assert.match(boot, /getActiveNoteId\s*:[\s\S]{0,200}getSelectedNote\(\s*\)[\s\S]{0,40}\.id/);
});

test('T9.3g [QA bug B] index.html provides a visible :disabled style for .action-button', () => {
  // The Summarize button toggles `button.disabled` while a request is in
  // flight. Without an explicit :disabled CSS rule the user sees no visual
  // change. This pins the styled-disabled invariant.
  const html = readHtml();
  assert.match(html, /\.action-button(?:[^,{]|,\s*\.action-button)*[:\[]disabled[\s\S]{0,300}opacity\s*:/);
});

test('T9.3h [QA loop 3] index.html provides CSS for .ai-summary-close', () => {
  // The dismiss button must have explicit styling so it is positioned
  // and looks like a button to the user.
  assert.match(readHtml(), /\.ai-summary-close\b/);
});

// ---------------------------------------------------------------------------
// Block B — lib/ai-boot.js source-shape
// ---------------------------------------------------------------------------

test('T9.4 boot module mounts on DOMContentLoaded (or load)', () => {
  const src = readBoot();
  const onDom = /document\.addEventListener\(\s*['"]DOMContentLoaded['"]/.test(src);
  const onLoad = /window\.addEventListener\(\s*['"]load['"]/.test(src);
  assert.ok(onDom || onLoad);
});

test('T9.4b boot module looks up button + panel via getElementById', () => {
  const src = readBoot();
  assert.match(src, /document\.getElementById\(\s*['"]summarizeButton['"]\s*\)/);
  assert.match(src, /document\.getElementById\(\s*['"]aiSummaryPanel['"]\s*\)/);
});

test('T9.4c panel is mounted', () => {
  assert.match(readBoot(), /AiSummaryPanel\.mount\(/);
});

test('T9.4d [QA loop 3] boot module passes onClose to mount()', () => {
  // The mount call must include an options object with an onClose handler
  // so the close (×) button is created and dismisses the active note's
  // stored summary on click.
  assert.match(
    readBoot(),
    /AiSummaryPanel\.mount\(\s*[A-Za-z_][A-Za-z_0-9]*\s*,\s*\{[\s\S]{0,400}onClose\s*:/,
    'mount() should receive { onClose: ... }',
  );
});

test('T9.4e [QA loop 3] onClose deletes the active note entry from the per-note map', () => {
  // The dismiss action must forget the note's summary so it does not
  // reappear when the user returns to the same note.
  assert.match(
    readBoot(),
    /onClose\b[\s\S]{0,400}\.delete\(\s*[A-Za-z_]/,
    'onClose handler should call .delete(<id>) on the per-note state map',
  );
});

test('T9.5 click handler attached', () => {
  assert.match(readBoot(), /\.addEventListener\(\s*['"]click['"]/);
});

test('T9.6 [H1] handler reads active note via the bridge', () => {
  assert.match(readBoot(), /window\.markdownVault\.getActiveNoteBody\(\s*\)/);
});

test('T9.6b [H4] handler captures startedId BEFORE await', () => {
  const src = readBoot();
  assert.match(
    src,
    /(const|let)\s+[A-Za-z_][A-Za-z_0-9]*\s*=\s*window\.markdownVault\.getActiveNoteId\(\s*\)[\s\S]{0,1500}await\s+window\.ai\.summarizeNote\(/,
  );
});

test('T9.6c [QA loop 2] per-note state is stored in a Map (or equivalent keyed structure)', () => {
  // Each note carries its own summary state — loading / summary / error.
  // The panel renders the active note's state. Without a per-note store,
  // switching notes loses state. Implementation: a Map keyed by note id.
  assert.match(readBoot(), /new Map\(/);
});

test('T9.6d [QA loop 2] success path stores result under startedId (not current id)', () => {
  // The await result is associated with the note the user clicked
  // Summarize on, not with whatever note is active at resolve time.
  // This is what makes "wait in B until A's summary returns, then go
  // back to A" work — A's result is keyed by A's id.
  const src = readBoot();
  // Anchor on the SUMMARIZE click handler specifically. ai-boot now has other
  // click handlers (Rewrite, the settings button), so we can't assume the first
  // click listener is Summarize — locate the handler that calls summarizeNote
  // and capture the pre-await identifier INSIDE it (not an outer watcher's id).
  const sumIdx = src.search(/window\.ai\.summarizeNote/);
  assert.ok(sumIdx > -1, 'expected the summarize handler to call window.ai.summarizeNote');
  const clickStart = src.lastIndexOf('addEventListener', sumIdx);
  assert.ok(clickStart > -1, 'expected a click handler around summarizeNote');
  const clickBlock = src.slice(clickStart);
  const captureMatch = clickBlock.match(/(?:const|let)\s+([A-Za-z_][A-Za-z_0-9]*)\s*=\s*window\.markdownVault\.getActiveNoteId\(\s*\)/);
  assert.ok(captureMatch, 'expected click handler to capture getActiveNoteId() into an identifier');
  const startedId = captureMatch[1];
  // The handler must store the result keyed by that captured identifier.
  const setRe = new RegExp('\\.set\\(\\s*' + startedId + '\\b', 'g');
  const setCalls = clickBlock.match(setRe) || [];
  assert.ok(setCalls.length >= 1, 'expected at least one .set(' + startedId + ', …) call inside the click handler');
});

test('T9.6e [QA bug C / QA loop 2] active-note watcher RENDERS the new note state (not just clear)', () => {
  // ai-boot.js polls getActiveNoteId() and on change must render the
  // new note's stored state — restoring a previously-settled summary
  // when the user returns to a note that already has one.
  const src = readBoot();
  assert.match(src, /setInterval\(/, 'note-change watcher should poll via setInterval');
  // The setInterval body must call a render helper that consults the
  // per-note state map (.get) — not just hard-clear the panel.
  assert.match(
    src,
    /setInterval\(\s*(?:function[^{]*|\(?[^)]*\)?\s*=>)\s*\{[\s\S]{0,800}\.get\(/,
    'setInterval body should look up the per-note state map via .get(...)',
  );
});

test('T9.7 handler calls window.ai.summarizeNote with the text', () => {
  // Stage B Option α-2: regex relaxed from `\)` to `[,)]` so the two-arg
  // streaming form `summarizeNote(text, { onChunk, signal })` matches too.
  // Intent unchanged: the call goes through with `text` as the first arg.
  assert.match(readBoot(), /window\.ai\.summarizeNote\(\s*[A-Za-z_][A-Za-z_0-9]*\s*[,)]/);
});

test('T9.8 handler routes ok branch to AiSummaryPanel.showSummary', () => {
  assert.match(readBoot(), /AiSummaryPanel\.showSummary\(/);
});

test('T9.9 handler routes failure branch to AiSummaryPanel.showError', () => {
  assert.match(readBoot(), /AiSummaryPanel\.showError\(/);
});

test('T9.10 [A8] handler does NOT mutate note state', () => {
  const src = readBoot();
  assert.doesNotMatch(src, /window\.vaultApi\.saveNote/);
  assert.doesNotMatch(src, /selectedNote\.body\s*=/);
  assert.doesNotMatch(src, /DirtyState\./);
  assert.doesNotMatch(src, /window\.markdownVault\.[a-zA-Z_]+\s*=/);
});

test('T9.11 in-flight guard present', () => {
  const src = readBoot();
  assert.match(src, /\.disabled\s*=\s*true/);
  assert.match(src, /\.disabled\s*=\s*false/);
});

test('T9.12 [G6] catch-path produces error display (direct showError OR stored error state rendered)', () => {
  // The catch must ensure the panel does not stay stuck on "Summarizing…".
  // Either form is acceptable:
  //   a) catch { ... AiSummaryPanel.showError(...) ... }
  //   b) catch { ... noteState.set(startedId, { kind: 'error', ... }) ... }
  //      followed by a render call in finally or directly inside catch.
  const src = readBoot();
  const directShowError = /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,500}AiSummaryPanel\.showError\(/.test(src);
  const chainedShowError = /\.catch\(\s*\(?[^)]*\)?\s*=>\s*[\s\S]{0,200}AiSummaryPanel\.showError\(/.test(src);
  const errorStateStored = /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,500}kind\s*:\s*['"]error['"]/.test(src);
  assert.ok(directShowError || chainedShowError || errorStateStored,
    'catch must either call showError directly or store an error entry that gets rendered');
});

// ---------------------------------------------------------------------------
// Block C — main.js source-shape [I2]
// ---------------------------------------------------------------------------

test('T9.13 main.js requires ./lib/ai-ipc', () => {
  assert.match(readMain(), /require\(\s*['"]\.\/lib\/ai-ipc['"]\s*\)/);
});

test('T9.14 main.js calls AiIpc.register(ipcMain, …) exactly once', () => {
  // Stage C: register now takes a { settingsPath } option so the summarize
  // handler re-reads settings per request (env > stored > default). Still
  // exactly one register call.
  const m = readMain().match(/AiIpc\.register\(\s*ipcMain\s*,/g);
  assert.equal(m && m.length, 1);
});

test('T9.15 main.js register passes a settingsPath option (Stage C)', () => {
  // Pre-Stage C this asserted NO options; Stage C intentionally wires a
  // persistent settings file shared by the handlers and the settings panel.
  assert.match(readMain(), /AiIpc\.register\(\s*ipcMain\s*,\s*\{\s*settingsPath/);
});
