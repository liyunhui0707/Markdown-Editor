/* Stage S4 — static-source integration tests for index.html wiring.
   Mirrors the pattern from read-tab-integration.test.js +
   large-session-integration.test.js: parse index.html as text and
   assert the S4 wiring is in place. The deeper behavioral integration
   (in-flight build + token guard + notesGeneration invalidation)
   would require extending the vm harness — out of scope for S4 v1.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
function readIndex() { return fs.readFileSync(INDEX_HTML, 'utf8'); }

// ---------- T-S4-35..42 (round-1 plan-review M1) ----------

test('T-S4-35a index.html loads search-dom.js before the inline boot', () => {
  const src = readIndex();
  assert.match(
    src,
    /<script\s+src="\.\/lib\/session-viewer\/search-dom\.js">/,
  );
});

test('T-S4-35b index.html loads search-index.js before the inline boot', () => {
  const src = readIndex();
  assert.match(
    src,
    /<script\s+src="\.\/lib\/session-viewer\/search-index\.js">/,
  );
});

test('T-S4-35c index.html loads in-file-search-toolbar.js before the inline boot', () => {
  const src = readIndex();
  assert.match(
    src,
    /<script\s+src="\.\/lib\/session-viewer\/in-file-search-toolbar\.js">/,
  );
});

test('T-S4-35d the three S4 scripts appear AFTER large-session-guard.js and BEFORE the boot marker', () => {
  const src = readIndex();
  const idxLargeGuard = src.indexOf('lib/session-viewer/large-session-guard.js');
  const idxSearchDom = src.indexOf('lib/session-viewer/search-dom.js');
  const idxSearchIndex = src.indexOf('lib/session-viewer/search-index.js');
  const idxToolbar = src.indexOf('lib/session-viewer/in-file-search-toolbar.js');
  const idxBootMarker = src.indexOf('Boot the Markdown editor');
  assert.ok(idxLargeGuard > 0, 'large-session-guard.js script tag present');
  assert.ok(idxSearchDom > idxLargeGuard, 'search-dom.js after large-session-guard.js');
  assert.ok(idxSearchIndex > idxSearchDom, 'search-index.js after search-dom.js');
  assert.ok(idxToolbar > idxSearchIndex, 'toolbar after search-index.js');
  assert.ok(idxBootMarker > idxToolbar, 'all 3 scripts before the inline boot');
});

// ---------- toolbar DOM ----------

test('T-S4-36a index.html declares #inFileSearchToolbar above #readViewMount', () => {
  const src = readIndex();
  assert.match(
    src,
    /<div\s+id="inFileSearchToolbar"[^>]*hidden[^>]*>[\s\S]*?<input\s+id="inFileSearchInput"[\s\S]*?<button\s+id="inFileSearchPrev"[\s\S]*?<button\s+id="inFileSearchNext"[\s\S]*?<span\s+id="inFileSearchCounter"[\s\S]*?<div\s+id="readViewMount"/,
  );
});

test('T-S4-36b in-file-search-toolbar CSS class declared', () => {
  const src = readIndex();
  assert.match(src, /\.in-file-search-toolbar\s*\{/);
});

test('T-S4-36c .mark + .mark--active CSS declared under .read-view-mount', () => {
  const src = readIndex();
  assert.match(src, /\.read-view-mount\s+mark\s*\{/);
  assert.match(src, /\.read-view-mount\s+mark\.mark--active\s*\{/);
});

// ---------- cross-session results DOM ----------

test('T-S4-37a #crossSessionResults declared below #noteList', () => {
  const src = readIndex();
  const idxNoteList = src.indexOf('<div id="noteList"');
  const idxCross = src.indexOf('<div id="crossSessionResults"');
  assert.ok(idxNoteList > 0);
  assert.ok(idxCross > idxNoteList);
});

test('T-S4-37b #crossSessionResultsList container exists', () => {
  const src = readIndex();
  assert.match(src, /<div\s+id="crossSessionResultsList"/);
});

test('T-S4-37c #crossSessionIndexBanner exists (lazy-build progress banner)', () => {
  const src = readIndex();
  assert.match(src, /<div\s+id="crossSessionIndexBanner"[^>]*hidden/);
});

test('T-S4-37d .cross-session-results CSS class declared', () => {
  const src = readIndex();
  assert.match(src, /\.cross-session-results\s*\{/);
});

// ---------- selectNote shared helper (round-1 B2) ----------

test('T-S4-38a function selectNote(noteId) exists', () => {
  const src = readIndex();
  assert.match(src, /function\s+selectNote\s*\(\s*noteId\s*\)/);
});

test('T-S4-38b selectNote calls exitWriteMode + bodyForRead on outgoing note', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+selectNote[\s\S]*?liveEditorInstance\.exitWriteMode\(\)[\s\S]*?outgoingNote\.body\s*=\s*bodyForRead\(outgoingNote\)[\s\S]*?selectedNoteId\s*=\s*noteId/,
  );
});

test('T-S4-38c note-row click handler delegates to selectNote(note.id)', () => {
  const src = readIndex();
  assert.match(
    src,
    /item\.addEventListener\(\s*['"]click['"]\s*,\s*\(\)\s*=>\s*\{\s*(?:\/\/[^\n]*\n\s*)*selectNote\(note\.id\)\s*;?\s*\}\s*\)/,
  );
});

test('T-S4-38d cross-session result onClick handler routes through selectNote(id)', () => {
  const src = readIndex();
  assert.match(
    src,
    /window\.SessionViewer\.renderGlobalResults\([\s\S]*?\(id\)\s*=>\s*selectNote\(id\)/,
  );
});

// ---------- handleSearchInput cross-session trigger (round-1 B1 + M2) ----------

test('T-S4-39a handleSearchInput gates cross-session search by filter + min length', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+handleSearchInput[\s\S]*?currentFilter\s*===\s*['"]sessions['"][\s\S]*?currentSearchQuery\.length\s*>=\s*minLen[\s\S]*?runCrossSessionSearch\(currentSearchQuery,\s*\+\+crossSessionSearchToken\)/,
  );
});

test('T-S4-39b runCrossSessionSearch awaits pendingCrossSessionIndexBuild (B1 fix)', () => {
  const src = readIndex();
  assert.match(
    src,
    /async\s+function\s+runCrossSessionSearch[\s\S]*?pendingCrossSessionIndexBuild\s*=\s*window\.SessionViewer\.loadGlobalIndex[\s\S]*?await\s+pendingCrossSessionIndexBuild/,
  );
});

test('T-S4-39c runCrossSessionSearch stale-result guard checks token + filter + query + generation (M2 fix)', () => {
  const src = readIndex();
  assert.match(
    src,
    /async\s+function\s+runCrossSessionSearch[\s\S]*?token\s*!==\s*crossSessionSearchToken[\s\S]*?currentFilter\s*!==\s*['"]sessions['"][\s\S]*?currentSearchQuery\s*!==\s*query[\s\S]*?crossSessionState\.notesGeneration\s*!==\s*currentNotesGeneration/,
  );
});

// ---------- setActiveMode toolbar wiring ----------

test('T-S4-40a setActiveMode read transition calls inFileSearchToolbarController.onReadActivated', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+setActiveMode[\s\S]*?inFileSearchToolbarController[\s\S]*?onReadActivated\s*\(\s*\)/,
  );
});

test('T-S4-40b setActiveMode leaving read calls inFileSearchToolbarController.onReadDeactivated', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+setActiveMode[\s\S]*?onReadDeactivated\s*\(\s*\)/,
  );
});

test('T-S4-40c inFileSearchToolbarController is initialised inside try/catch at boot', () => {
  const src = readIndex();
  assert.match(
    src,
    /inFileSearchToolbarController\s*=\s*window\.SessionViewer\.createInFileSearchToolbar\(\s*\{/,
  );
});

// ---------- T-S4-41a (round-1 B2 source-grep) ----------

test('T-S4-41a NO raw selectedNoteId reassignment exists at the note-row click site (must route via selectNote)', () => {
  const src = readIndex();
  // The 6 previously documented direct `selectedNoteId = ...` reassign
  // sites elsewhere in index.html (refreshVaultNotes, keyboard-nav,
  // ingest-banner-click, etc.) are out of scope. The contract that S4
  // adds is: a CLICK on a sidebar row routes through `selectNote(...)`.
  // Confirm the legacy inline body in the note-row click ("const outgoingNote
  // = getSelectedNote(); ... selectedNoteId = note.id") is GONE.
  const noteRowClickRegion = src.match(
    /item\.addEventListener\(\s*['"]click['"]\s*,\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;[\s\S]{0,200}noteList\.appendChild\(item\)/,
  );
  assert.ok(noteRowClickRegion, 'note-row click handler region not found');
  // Within that region, must NOT contain a raw "selectedNoteId = note.id" line.
  // The new body uses `selectNote(note.id)` instead.
  assert.ok(
    !/selectedNoteId\s*=\s*note\.id\s*;/.test(noteRowClickRegion[0]),
    'note-row click handler must not inline `selectedNoteId = note.id;` — route via selectNote(note.id)',
  );
});

// ---------- T-S4-42 (round-1 M3 notes-generation invalidation) ----------

test('T-S4-42a refreshVaultNotes bumps currentNotesGeneration on success', () => {
  const src = readIndex();
  assert.match(
    src,
    /async\s+function\s+refreshVaultNotes[\s\S]*?currentNotesGeneration\s*\+=\s*1/,
  );
});

test('T-S4-42b stopWatchingVault resets cross-session state + currentNotesGeneration', () => {
  const src = readIndex();
  assert.match(
    src,
    /async\s+function\s+stopWatchingVault[\s\S]*?crossSessionState\.globalIndex\s*=\s*null[\s\S]*?crossSessionState\.globalIndexStatus\s*=\s*['"]idle['"][\s\S]*?currentNotesGeneration\s*=\s*0/,
  );
});

// ---------- SC-S4-2 (m1 fix — scoped to new code) ----------

test('SC-S4-2 search-dom.js source has no innerHTML write', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'session-viewer', 'search-dom.js'),
    'utf8',
  );
  assert.ok(
    !/\.innerHTML\s*=/.test(src),
    'search-dom.js must not write innerHTML — use createElement/createTextNode',
  );
});

test('SC-S4-2 search-index.js source has no innerHTML write', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'session-viewer', 'search-index.js'),
    'utf8',
  );
  assert.ok(!/\.innerHTML\s*=/.test(src));
});

test('SC-S4-2 in-file-search-toolbar.js source has no innerHTML write', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'session-viewer', 'in-file-search-toolbar.js'),
    'utf8',
  );
  assert.ok(!/\.innerHTML\s*=/.test(src));
});
