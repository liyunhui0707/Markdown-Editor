/* Stage S3.5 — integration tests (static-source style).
   Mirrors the pattern from read-tab-integration.test.js: parse
   index.html and renderer-boot harness as text and assert the S3.5
   wiring is in place. The deeper behavioral integration (actual
   spy-on-setText calls) requires a vm-harness extension that's
   out of scope for this stage; the unit tests in
   large-session-guard.test.js + the bodyForRead migration in
   index.html together cover the data-integrity contract.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
const RENDERER_BOOT = path.join(__dirname, '..', 'renderer-boot.test.js');

function readIndex() {
  return fs.readFileSync(INDEX_HTML, 'utf8');
}
function readRendererBoot() {
  return fs.readFileSync(RENDERER_BOOT, 'utf8');
}

test('index.html loads large-session-guard.js script', () => {
  const src = readIndex();
  assert.match(
    src,
    /<script\s+src="\.\/lib\/session-viewer\/large-session-guard\.js">/,
  );
});

// Stage S6 removed the sessionsLargeBanner DOM + CSS and the
// showLargeBanner / hideLargeBanner helpers. AI Sessions are now
// read-only; there's no Write/Preview surface to load and therefore
// no "may be slow" message to display. Tests for those literals
// were deleted.

test('Stage S6: sessionsLargeBanner DOM and CSS are gone', () => {
  const src = readIndex();
  assert.doesNotMatch(src, /<div\s+id="sessionsLargeBanner"/);
  assert.doesNotMatch(src, /\.sessions-large-banner\s*\{/);
  assert.doesNotMatch(src, /showLargeBanner\s*\(/);
  assert.doesNotMatch(src, /hideLargeBanner\s*\(/);
});

test('index.html boots a hydrationCache from window.SessionViewer.createHydrationCache', () => {
  const src = readIndex();
  assert.match(
    src,
    /window\.SessionViewer\.createHydrationCache\s*\(\s*\)/,
  );
});

test('index.html defines a bodyForRead helper', () => {
  const src = readIndex();
  assert.match(src, /function\s+bodyForRead\s*\(/);
});

test('bodyForRead returns note.body for sessions OR large notes when CM6 unhydrated', () => {
  const src = readIndex();
  // Stage S6: predicate broadened from isLargeSession-only to
  // (isSession || isLarge). Sessions never hydrate CM6 anymore, so
  // they always fall through to note.body for save / outgoing-capture
  // paths.
  assert.match(
    src,
    /function\s+bodyForRead\s*\([^)]*\)\s*\{[\s\S]*?isSession[\s\S]*?isLarge[\s\S]*?hydrationCache\.isHydrated\s*\([^)]*'cm6'[^)]*\)[\s\S]*?note\.body/,
  );
});

test('index.html defines forceReadModeWithBody that calls renderInto with note.body', () => {
  const src = readIndex();
  assert.match(src, /function\s+forceReadModeWithBody\s*\(/);
  assert.match(
    src,
    /function\s+forceReadModeWithBody[\s\S]*?readTabController\.renderInto\s*\(\s*note\.body\s*\)/,
  );
});

test('Stage S6: renderEditor session branch goes straight to forceReadModeWithBody', () => {
  const src = readIndex();
  // The session branch now checks sessionsImport, not isLargeSession,
  // and uses forceReadModeWithBody for ALL sessions (small + large).
  assert.match(
    src,
    /const\s+isSession\s*=\s*note\.sessionsImport\s*===\s*true[\s\S]*?if\s*\(isSession\)[\s\S]*?forceReadModeWithBody\(note\)/,
  );
});

test('Stage S6: showWriteMode early-returns for sessions; the deferred-write banner branch is gone', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+showWriteMode[\s\S]*?note\.sessionsImport\s*===\s*true[\s\S]*?return/,
  );
  // The old `showLargeBanner('loading-write'...)` deferred Write path
  // is gone.
  assert.doesNotMatch(src, /showLargeBanner\(\s*['"]loading-write['"]/);
});

test('Stage S6: showPreviewMode early-returns for sessions; the deferred-preview banner branch is gone', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+showPreviewMode[\s\S]*?note\.sessionsImport\s*===\s*true[\s\S]*?return/,
  );
  assert.doesNotMatch(src, /showLargeBanner\(\s*['"]loading-preview['"]/);
});

test('outgoing capture in note-row click uses bodyForRead', () => {
  const src = readIndex();
  assert.match(
    src,
    /outgoingNote\.body\s*=\s*bodyForRead\(outgoingNote\)/,
  );
});

test('saveCurrentNote uses bodyForRead', () => {
  const src = readIndex();
  // The savedBody read in saveCurrentNote goes through bodyForRead.
  assert.match(
    src,
    /const\s+savedBody\s*=\s*bodyForRead\(selectedNote\)/,
  );
});

test('save-all (beforeFlush) uses bodyForRead', () => {
  const src = readIndex();
  assert.match(
    src,
    /beforeFlush\.body\s*=\s*bodyForRead\(beforeFlush\)/,
  );
});

test('keyboard-nav outgoing capture uses bodyForRead', () => {
  const src = readIndex();
  assert.match(
    src,
    /outgoing\.body\s*=\s*bodyForRead\(outgoing\)/,
  );
});

test('updateSelectedNoteFromInputs uses bodyForRead for fullText', () => {
  const src = readIndex();
  assert.match(
    src,
    /function\s+updateSelectedNoteFromInputs[\s\S]*?const\s+fullText\s*=\s*bodyForRead\(selectedNote\)/,
  );
});

test('hydrationCache.drop is called on outgoing-note switch', () => {
  const src = readIndex();
  assert.match(src, /hydrationCache\.drop\(liveEditorLastNoteId\)/);
});

test('renderer-boot harness imports LargeSessionGuard and assembles SessionViewer', () => {
  const src = readRendererBoot();
  assert.match(
    src,
    /require\(['"]\.\.\/lib\/session-viewer\/large-session-guard['"]\)/,
  );
  assert.match(src, /LargeSessionGuard/);
});
