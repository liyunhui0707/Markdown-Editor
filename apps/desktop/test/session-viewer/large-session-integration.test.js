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

test('index.html declares the sessionsLargeBanner DOM element', () => {
  const src = readIndex();
  assert.match(
    src,
    /<div\s+id="sessionsLargeBanner"[^>]*hidden[^>]*>/,
  );
});

test('index.html declares the .sessions-large-banner CSS class', () => {
  const src = readIndex();
  assert.match(src, /\.sessions-large-banner\s*\{/);
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

test('bodyForRead returns note.body when isLargeSession AND !cm6-hydrated', () => {
  const src = readIndex();
  // The helper must check isLargeSession AND hydrationCache.isHydrated
  // before falling back to note.body.
  assert.match(
    src,
    /function\s+bodyForRead\s*\([^)]*\)\s*\{[\s\S]*?isLargeSession[\s\S]*?hydrationCache\.isHydrated\s*\([^)]*'cm6'[^)]*\)[\s\S]*?note\.body/,
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

test('renderEditor deferred branch checks isLargeSession AND skips eager setText', () => {
  const src = readIndex();
  // Look for the pattern inside renderEditor: if (isLarge && !cm6Hydrated)
  // then forceReadModeWithBody, else (existing) liveEditorInstance.setText.
  assert.match(
    src,
    /isLargeSession[\s\S]*?hydrationCache\.isHydrated[\s\S]*?'cm6'[\s\S]*?forceReadModeWithBody/,
  );
});

test('renderEditor non-deferred branch (eager) marks hydrated for already-large notes', () => {
  const src = readIndex();
  // After the eager setText, isLarge notes mark both surfaces hydrated.
  assert.match(
    src,
    /liveEditorInstance\.setText\(note\.body\)[\s\S]*?hydrationCache\.markHydrated\([^,]*,\s*'cm6'\)[\s\S]*?hydrationCache\.markHydrated\([^,]*,\s*'toast'\)/,
  );
});

test('showWriteMode deferred branch uses double-rAF before setText', () => {
  const src = readIndex();
  // Inside showWriteMode, deferred path: showLargeBanner then nested
  // requestAnimationFrame calls, then setText, then mark both surfaces hydrated.
  assert.match(
    src,
    /function\s+showWriteMode[\s\S]*?showLargeBanner\([^)]*\)[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame[\s\S]*?liveEditorInstance\.setText\(note\.body\)[\s\S]*?markHydrated[^)]*'cm6'[^)]*\)[\s\S]*?markHydrated[^)]*'toast'/,
  );
});

test('showPreviewMode deferred branch chooses source by cm6 hydration', () => {
  const src = readIndex();
  // Deferred Preview picks getCurrentEditorText when cm6 hydrated, else note.body.
  assert.match(
    src,
    /function\s+showPreviewMode[\s\S]*?hydrationCache\.isHydrated\s*\([^)]*'cm6'[^)]*\)[\s\S]*?\?\s*getCurrentEditorText\(\)[\s\S]*?:\s*note\.body/,
  );
  // And uses double-rAF + setMarkdown(previewSource).
  assert.match(
    src,
    /function\s+showPreviewMode[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame[\s\S]*?_toastuiInstance\.setMarkdown\(previewSource\)/,
  );
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
  assert.match(src, /sessionsLargeBanner/);
});
