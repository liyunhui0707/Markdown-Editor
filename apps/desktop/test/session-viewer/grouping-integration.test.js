/* Stage S5 — static-source integration tests for index.html wiring.
   Mirrors the read-tab-integration / large-session-integration /
   search-integration pattern: parse index.html and assert the S5
   wiring is in place. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
function readIndex() { return fs.readFileSync(INDEX_HTML, 'utf8'); }

// ---------- T-S5-27: script tags ----------

test('T-S5-27a index.html loads favorites.js before the inline boot', () => {
  const src = readIndex();
  assert.match(src, /<script\s+src="\.\/lib\/session-viewer\/favorites\.js">/);
});

test('T-S5-27b index.html loads grouping.js', () => {
  const src = readIndex();
  assert.match(src, /<script\s+src="\.\/lib\/session-viewer\/grouping\.js">/);
});

test('T-S5-27c index.html loads grouped-list-renderer.js', () => {
  const src = readIndex();
  assert.match(src, /<script\s+src="\.\/lib\/session-viewer\/grouped-list-renderer\.js">/);
});

test('T-S5-27d the three S5 scripts appear AFTER S4 in-file-search-toolbar.js and BEFORE the boot marker', () => {
  const src = readIndex();
  const idxS4Last = src.indexOf('lib/session-viewer/in-file-search-toolbar.js');
  const idxFavorites = src.indexOf('lib/session-viewer/favorites.js');
  const idxGrouping = src.indexOf('lib/session-viewer/grouping.js');
  const idxRenderer = src.indexOf('lib/session-viewer/grouped-list-renderer.js');
  const idxBootMarker = src.indexOf('Boot the Markdown editor');
  assert.ok(idxS4Last > 0);
  assert.ok(idxFavorites > idxS4Last);
  assert.ok(idxGrouping > idxFavorites);
  assert.ok(idxRenderer > idxGrouping);
  assert.ok(idxBootMarker > idxRenderer);
});

// ---------- T-S5-28: CSS ----------

test('T-S5-28a .session-group-header CSS class declared', () => {
  const src = readIndex();
  assert.match(src, /\.session-group-header\s*\{/);
});

test('T-S5-28b .session-group-header--collapsed style declared', () => {
  const src = readIndex();
  // Either via a dedicated rule OR (more commonly here) via the
  // chevron flip in JS. We at minimum require .session-group-chevron
  // styled so the chevron is visible.
  assert.match(src, /\.session-group-chevron\s*\{/);
});

test('T-S5-28c .session-row + .session-row--active declared', () => {
  const src = readIndex();
  assert.match(src, /\.session-row\s*\{/);
  assert.match(src, /\.session-row--active\s*\{/);
});

test('T-S5-28d .session-star + .session-star--on declared', () => {
  const src = readIndex();
  assert.match(src, /\.session-star\s*\{/);
  assert.match(src, /\.session-star--on\s*\{/);
});

test('T-S5-28e .session-bucket-header declared', () => {
  const src = readIndex();
  assert.match(src, /\.session-bucket-header\s*\{/);
});

// ---------- T-S5-29: boot init ----------

test('T-S5-29a favoritesController init uses createFavoritesController + localStorage', () => {
  const src = readIndex();
  assert.match(
    src,
    /favoritesController\s*=\s*window\.SessionViewer\.createFavoritesController\(\s*\{[\s\S]*?storage:\s*window\.localStorage/,
  );
});

test('T-S5-29b groupedListRenderer init wires onRowClick/onStarClick/onHeaderToggle', () => {
  const src = readIndex();
  assert.match(
    src,
    /groupedListRenderer\s*=\s*window\.SessionViewer\.createGroupedListRenderer\(\s*\{[\s\S]*?onRowClick:\s*\(noteId\)\s*=>\s*selectNote\(noteId\)[\s\S]*?onStarClick:[\s\S]*?favoritesController\.toggle[\s\S]*?onHeaderToggle:[\s\S]*?renderApp\(\)/,
  );
});

test('T-S5-29c collapse-state restored from localStorage at boot', () => {
  const src = readIndex();
  assert.match(
    src,
    /localStorage\.getItem\(\s*['"]markdownVault\.aiSessions\.collapsed['"]\s*\)/,
  );
});

test('T-S5-29d collapse-state persisted on toggle', () => {
  const src = readIndex();
  assert.match(
    src,
    /localStorage\.setItem\(\s*['"]markdownVault\.aiSessions\.collapsed['"]/,
  );
});

// ---------- T-S5-30: renderNoteList branch ----------

test('T-S5-30a renderNoteList has an AI Sessions branch using groupedListRenderer', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+renderNoteList[\s\S]*?currentFilter\s*===\s*['"]sessions['"][\s\S]*?groupedListRenderer\.render\(tree,\s*selectedNoteId\)/,
  );
});

test('T-S5-30b renderNoteList AI Sessions branch passes isFavorite to groupAndSort', () => {
  const src = readIndex();
  assert.match(
    src,
    /groupAndSort\(items,\s*\{[\s\S]*?isFavorite:\s*\(it\)\s*=>\s*favoritesController\.isFavorite\(it\.relativePath\)/,
  );
});

test('T-S5-30c notesToSessionItems adapter derives agent from relPath prefix', () => {
  const src = readIndex();
  assert.match(src, /function\s+relPathToAgent\s*\([\s\S]*?Inbox\/AI Chats\/codex\/[\s\S]*?Inbox\/AI Chats\/claude-code\//);
  assert.match(src, /function\s+notesToSessionItems/);
});

// ---------- T-S5-30d: other filters keep flat list ----------

test('T-S5-30d existing flat-list visibleResults.forEach loop is still present (other filters)', () => {
  const src = readIndex();
  // After the grouped branch returns, the existing flat path
  // (visibleResults.forEach((result) => { ... noteList.appendChild(item); })) must still exist.
  assert.match(
    src,
    /visibleResults\.forEach\(\(result\)\s*=>\s*\{[\s\S]*?noteList\.appendChild\(item\)[\s\S]*?\}\)/,
  );
});

// ---------- T-S5-31: cross-session isFavorite wiring (AC-S5-9) ----------

test('T-S5-31 renderGlobalResults call site passes opts.isFavorite', () => {
  const src = readIndex();
  assert.match(
    src,
    /window\.SessionViewer\.renderGlobalResults\([\s\S]*?\(id\)\s*=>\s*selectNote\(id\)[\s\S]*?isFavorite:\s*\(id\)\s*=>[\s\S]*?favoritesController\.isFavorite\(note\.relativePath\)/,
  );
});

// ---------- T-S5-32: SC-S5-2 (no innerHTML in new modules) ----------

test('SC-S5-2 favorites.js source has no innerHTML write', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'session-viewer', 'favorites.js'),
    'utf8',
  );
  assert.ok(!/\.innerHTML\s*=/.test(src));
});

test('SC-S5-2 grouping.js source has no innerHTML write', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'session-viewer', 'grouping.js'),
    'utf8',
  );
  assert.ok(!/\.innerHTML\s*=/.test(src));
});

test('SC-S5-2 grouped-list-renderer.js source has no innerHTML write', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'session-viewer', 'grouped-list-renderer.js'),
    'utf8',
  );
  assert.ok(!/\.innerHTML\s*=/.test(src));
});

// ---------- Round-2 QA fixes (2026-05-26) ----------

test('T-S5-QA1 watcher does NOT auto-jump to AI Imports when changed file is a sessions import', () => {
  const src = readIndex();
  assert.match(
    src,
    /const\s+looksLikeSessionsImport\s*=[\s\S]*?Inbox\/AI Chats\/codex\/[\s\S]*?Inbox\/AI Chats\/claude-code\//,
  );
  assert.match(
    src,
    /if\s*\(\s*looksLikeAiImport\s*&&\s*!looksLikeSessionsImport\s*\)/,
  );
});

test('T-S5-QA2 AI Imports filter excludes session-imports (disjoint from AI Sessions)', () => {
  const src = readIndex();
  assert.match(
    src,
    /currentFilter\s*===\s*['"]ai['"][\s\S]*?notes\.filter\(\s*\(note\)\s*=>\s*note\.aiImported\s*===\s*true\s*&&\s*note\.sessionsImport\s*!==\s*true/,
  );
});

test('T-S5-QA2b AI Imports nav count predicate is the same disjoint filter', () => {
  const src = readIndex();
  assert.match(
    src,
    /filterAiMeta\.textContent[\s\S]*?note\.aiImported\s*===\s*true\s*&&\s*note\.sessionsImport\s*!==\s*true/,
  );
});

test('T-S5-QA3 main.js attaches mtime to vault notes via fs.statSync', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'main.js'),
    'utf8',
  );
  assert.match(src, /function\s+parseMarkdownFile\s*\(\s*relativePath\s*,\s*content\s*,\s*stat\s*\)/);
  assert.match(src, /mtime:\s*stat\s*&&\s*stat\.mtimeMs/);
  assert.match(src, /fs\.statSync\(fullPath\)/);
  assert.match(src, /parseMarkdownFile\(relativePath,\s*content,\s*stat\)/);
});

// ---------- Round-3 QA fixes (2026-05-26) ----------

test('T-S5-QA4 main.js parseFrontmatter extracts session-import frontmatter fields', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'main.js'),
    'utf8',
  );
  assert.match(src, /key === 'source_mtime'/);
  assert.match(src, /key === 'source_custom_title'/);
  assert.match(src, /key === 'source_ai_title'/);
});

test('T-S5-QA5 session-import notes prefer custom/ai title over UUID filename (issue C)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'main.js'),
    'utf8',
  );
  // For sessionsImport notes, prefer source_custom_title || source_ai_title.
  assert.match(
    src,
    /if\s*\(sessionsImport\)\s*\{[\s\S]*?source_custom_title[\s\S]*?source_ai_title[\s\S]*?title\s*=\s*preferred/,
  );
});

test('T-S5-QA6 notes carry sourceMtime parsed from frontmatter (issue D)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'main.js'),
    'utf8',
  );
  // sourceMtime is parsed from frontmatter.source_mtime via Date.parse.
  assert.match(
    src,
    /Date\.parse\(frontmatter\.source_mtime\)[\s\S]*?sourceMtime\s*=\s*parsed/,
  );
  // And the returned note exposes it as `sourceMtime: sourceMtime`.
  assert.match(src, /sourceMtime,\n/);
});

test('T-S5-QA7 notesToSessionItems prefers n.sourceMtime over n.mtime', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+notesToSessionItems[\s\S]*?n\.sourceMtime\s*\|\|\s*n\.mtime/,
  );
});

test('T-S5-QA8 bucket-collapse callbacks wired into createGroupedListRenderer (issue B)', () => {
  const src = readIndex();
  assert.match(
    src,
    /onBucketToggle:\s*\(groupKey,\s*layerId\)\s*=>[\s\S]*?bucketCollapsedState[\s\S]*?renderApp\(\)/,
  );
  assert.match(
    src,
    /isBucketCollapsed:\s*\(groupKey,\s*layerId\)\s*=>[\s\S]*?bucketCollapsedState\.has/,
  );
});

test('T-S5-QA8b bucket-collapse state persists under its own localStorage key', () => {
  const src = readIndex();
  assert.match(src, /'markdownVault\.aiSessions\.bucketCollapsed'/);
  // Verify both a getItem call (boot restore) and a setItem call exist.
  assert.match(
    src,
    /localStorage\.getItem\([\s\S]*?markdownVault\.aiSessions\.bucketCollapsed/,
  );
  assert.match(
    src,
    /localStorage\.setItem\([\s\S]*?markdownVault\.aiSessions\.bucketCollapsed/,
  );
});

// ---------- Round-4 QA fixes (2026-05-26) ----------

test('T-S5-QA9 restoreNoteViewState defaults AI Sessions to read mode + scrollRatio=1', () => {
  const src = readIndex();
  // Look for the new default-state branch keyed on isSession.
  assert.match(
    src,
    /function\s+restoreNoteViewState[\s\S]*?const\s+isSession\s*=[\s\S]*?sessionsImport[\s\S]*?const\s+defaultState\s*=\s*isSession[\s\S]*?mode:\s*['"]read['"][\s\S]*?scrollRatio:\s*1/,
  );
});

test('T-S5-QA10 deferred-large-session render applies scrollRatio=1 by default for AI Sessions', () => {
  const src = readIndex();
  // After forceReadModeWithBody in renderEditor's deferred branch, a
  // scroll apply runs with defaultScroll = isSession ? 1 : 0.
  assert.match(
    src,
    /forceReadModeWithBody\(note\)[\s\S]*?const\s+isSession\s*=\s*!!note\.sessionsImport[\s\S]*?const\s+defaultScroll\s*=\s*isSession\s*\?\s*1\s*:\s*0[\s\S]*?_applyScrollRatio\(readViewMount,\s*ratio\)/,
  );
});

test('T-S5-QA11 watcher preserves selection when changed file is a session import', () => {
  const src = readIndex();
  // preferredRelativePath only equals changedPath for non-session AI imports;
  // sessions fall through to selectedNote.relativePath.
  assert.match(
    src,
    /const\s+preferredRelativePath\s*=[\s\S]*?\(looksLikeAiImport\s*&&\s*!looksLikeSessionsImport\)\s*\?\s*changedPath[\s\S]*?selectedNote\.relativePath/,
  );
});

test('T-S5-QA12 watcher writes scrollRatio=1 when selected session got refreshed', () => {
  const src = readIndex();
  assert.match(
    src,
    /selectedSessionGotRefreshed\s*=[\s\S]*?looksLikeSessionsImport[\s\S]*?selectedNote\.sessionsImport[\s\S]*?selectedNote\.relativePath\s*===\s*changedPath/,
  );
  assert.match(
    src,
    /if\s*\(selectedSessionGotRefreshed\)[\s\S]*?noteViewStates\.set\([\s\S]*?scrollRatio:\s*1/,
  );
});

// ---------- Round-5 QA fixes (2026-05-26) ----------

test('T-S5-QA13 Refresh onComplete preserves current selection (issue 2)', () => {
  const src = readIndex();
  // Refresh button's onComplete must compute `preferred` from the
  // currently-selected note and call refreshVaultNotes(preferred),
  // NOT loadVaultNotes() (which falls through to notes[0]).
  assert.match(
    src,
    /onComplete:\s*\(\)\s*=>\s*\{[\s\S]*?getSelectedNote\(\)[\s\S]*?preferred\s*=[\s\S]*?selectedNote\.relativePath[\s\S]*?refreshVaultNotes\(preferred\)/,
  );
});

test('T-S5-QA14 Preview button disabled + showPreviewMode early-returns for large sessions (issue 1)', () => {
  const src = readIndex();
  assert.match(src, /function\s+previewIsUnsafeForSelectedNote/);
  assert.match(src, /function\s+applyPreviewButtonDisabledState/);
  // Must check sessionsImport AND isLargeSession.
  assert.match(
    src,
    /function\s+previewIsUnsafeForSelectedNote[\s\S]*?note\.sessionsImport[\s\S]*?isLargeSession\(note\)/,
  );
  // showPreviewMode must early-return when unsafe.
  assert.match(
    src,
    /function\s+showPreviewMode[\s\S]*?previewIsUnsafeForSelectedNote\(\)[\s\S]*?return;/,
  );
  // applyPreviewButtonDisabledState must run from renderApp.
  assert.match(
    src,
    /function\s+renderApp[\s\S]*?applyPreviewButtonDisabledState\(\)/,
  );
});

// ---------- Round-6 QA fix (2026-05-26): Write button parity ----------

test('T-S5-QA15 Write button disabled + showWriteMode early-returns for large sessions', () => {
  const src = readIndex();
  assert.match(src, /function\s+writeIsUnsafeForSelectedNote/);
  assert.match(src, /function\s+applyWriteButtonDisabledState/);
  // showWriteMode must early-return when unsafe.
  assert.match(
    src,
    /function\s+showWriteMode[\s\S]*?writeIsUnsafeForSelectedNote\(\)[\s\S]*?return;/,
  );
  // applyWriteButtonDisabledState must run from renderApp (both branches).
  assert.match(
    src,
    /function\s+renderApp[\s\S]*?applyWriteButtonDisabledState\(\)/,
  );
});
