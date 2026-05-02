/* TDD: editor config module must produce the correct Toast UI options.
   Run: node --test test/editor-config.test.js */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const makeEditorConfig = require('../lib/editor-config');

// ── Config shape tests ────────────────────────────────────────────────────────

test('makeEditorConfig is a function', () => {
  assert.equal(typeof makeEditorConfig, 'function');
});

test('el is passed through unchanged', () => {
  const sentinel = { tagName: 'DIV' };
  const config = makeEditorConfig(sentinel);
  assert.equal(config.el, sentinel);
});

test('initialEditType is markdown', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.initialEditType, 'markdown');
});

test('previewStyle is explicitly tab', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.previewStyle, 'tab');
});

test('hideModeSwitch is true', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.hideModeSwitch, true);
});

test('usageStatistics is false', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.usageStatistics, false);
});

test('height is 100%', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.height, '100%');
});

test('initialValue is empty string', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.initialValue, '');
});

test('toolbarItems has the expected three groups', () => {
  const config = makeEditorConfig(null);
  assert.deepEqual(config.toolbarItems, [
    ['heading', 'bold', 'italic'],
    ['ul', 'ol'],
    ['link'],
  ]);
});

// ── Static wiring tests ───────────────────────────────────────────────────────

test('index.html loads editor-config.js via script tag', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /<script src="\.\/lib\/editor-config\.js"><\/script>/);
});

test('index.html instantiates ToastuiEditor via window.makeEditorConfig on the preview mount', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // Toast UI now mounts into toastPreviewMount (HybridWriteView owns the Write pane).
  assert.match(html, /window\.makeEditorConfig\(toastPreviewMount\)/);
});

// ── Preview-renderer preservation (Toast UI must remain the renderer) ─────────

test('index.html loads the Toast UI bundle script', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /toastui-bundle\.js/);
});

test('index.html instantiates a ToastuiEditor (Preview is still Toast UI)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /new\s+window\.ToastuiEditor\s*\(/);
});

test('index.html getText() is wired to hybridWrite.getText() (HybridWriteView adapter)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /getText\s*\(\s*\)\s*\{[^}]*hybridWrite\.getText\s*\(/);
});

test('index.html setText() updates HybridWriteView (hybridWrite.setText)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /setText\s*\([^)]*\)\s*\{[\s\S]*?hybridWrite\.setText\s*\(/);
});

test('index.html setText() also updates Toast UI Preview source (_toastuiInstance.setMarkdown)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // setText body must call BOTH hybridWrite.setText AND _toastuiInstance.setMarkdown
  assert.match(
    html,
    /setText\s*\([^)]*\)\s*\{[\s\S]*?hybridWrite\.setText[\s\S]*?_toastuiInstance\.setMarkdown\s*\([\s\S]*?\}/
  );
});

test('index.html save call passes getText() as note body (raw Markdown is saved)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // save must read liveEditorInstance.getText(), not innerHTML or any rendered field
  assert.match(html, /liveEditorInstance\.getText\s*\(\s*\)/);
  // must not pass innerHTML into saveNote
  assert.doesNotMatch(html, /saveNote[^}]*innerHTML/);
});

// ── HybridWriteView wiring ────────────────────────────────────────────────────

test('index.html loads the marked UMD bundle script', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /<script src="[^"]*marked\.umd\.js"><\/script>/);
});

test('index.html loads lib/live-editor.js script', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /<script src="\.\/lib\/live-editor\.js"><\/script>/);
});

test('index.html loads lib/hybrid-write-view.js script', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /<script src="\.\/lib\/hybrid-write-view\.js"><\/script>/);
});

test('index.html instantiates HybridWriteView', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /new\s+(?:window\.)?HybridWriteView\s*\(/);
});

test('index.html mounts HybridWriteView on its own pane (not the same as Toast UI)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // HybridWriteView pane and Toast UI mount must be separate elements.
  assert.match(html, /id="hybridWritePane"/);
  assert.match(html, /id="toastPreviewMount"/);
});

test('HybridWriteView onChange mirrors text to _toastuiInstance.setMarkdown (preview sync)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // The HybridWriteView constructor must receive an onChange that calls
  // _toastuiInstance.setMarkdown so the Preview tab stays in sync.
  assert.match(
    html,
    /new\s+(?:window\.)?HybridWriteView\s*\([\s\S]*?onChange[\s\S]*?_toastuiInstance\.setMarkdown\s*\([\s\S]*?\)/
  );
});

test('saveCurrentNote calls exitWriteMode before reading the body', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // Within saveCurrentNote, exitWriteMode must happen before reading
  // liveEditorInstance.getText(); the saved body can then be reused so the
  // note state and save payload share the same raw Markdown source.
  assert.match(
    html,
    /saveCurrentNote\s*\([\s\S]*?exitWriteMode\s*\([\s\S]*?const\s+savedBody\s*=\s*liveEditorInstance\.getText\(\)[\s\S]*?body:\s*savedBody/
  );
});

// ── Write / Preview toggle ────────────────────────────────────────────────────

test('index.html exposes Write and Preview toggle buttons', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /id="writeModeButton"/);
  assert.match(html, /id="previewModeButton"/);
});

test('Preview toggle flushes before mirroring text to Toast UI', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // showPreviewMode body must call exitWriteMode BEFORE _toastuiInstance.setMarkdown.
  assert.match(
    html,
    /function\s+showPreviewMode\s*\([\s\S]*?exitWriteMode\s*\([\s\S]*?_toastuiInstance\.setMarkdown\s*\(/
  );
});

test('Preview toggle activates Toast UI preview pane (not just mounts it)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // Toast UI's preview pane must be explicitly activated. We use the canonical
  // internal event 'changePreviewTabPreview' for tab-style preview mode.
  assert.match(
    html,
    /function\s+showPreviewMode\s*\([\s\S]*?changePreviewTabPreview/
  );
});

test('Preview toggle hides hybridWritePane and shows toastPreviewMount', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(
    html,
    /function\s+showPreviewMode\s*\([\s\S]*?hybridWritePane\.classList\.add\(\s*['"]is-hidden['"]\s*\)[\s\S]*?toastPreviewMount\.classList\.add\(\s*['"]is-visible['"]\s*\)/
  );
});

test('Write toggle shows hybridWritePane and hides toastPreviewMount', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(
    html,
    /function\s+showWriteMode\s*\([\s\S]*?hybridWritePane\.classList\.remove\(\s*['"]is-hidden['"]\s*\)[\s\S]*?toastPreviewMount\.classList\.remove\(\s*['"]is-visible['"]\s*\)/
  );
});

test('toggle buttons have click handlers wired to mode functions', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /writeModeButton\.addEventListener\(\s*['"]click['"]\s*,\s*showWriteMode\s*\)/);
  assert.match(html, /previewModeButton\.addEventListener\(\s*['"]click['"]\s*,\s*showPreviewMode\s*\)/);
});

test('note-list click flushes the editor before changing selectedNoteId', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // The note-list item click handler must call exitWriteMode BEFORE setting
  // selectedNoteId, so uncommitted edits on the outgoing note are preserved.
  assert.match(
    html,
    /noteList[\s\S]*?addEventListener\(\s*['"]click['"][\s\S]*?exitWriteMode\s*\([\s\S]*?selectedNoteId\s*=\s*note\.id/
  );
});

test('toast-preview-mount CSS does not hide the markdown container (preview lives there)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // Regression: an earlier revision hid .toastui-editor-md-container which
  // also contains the preview pane, making preview unreachable.
  assert.doesNotMatch(
    html,
    /\.toast-preview-mount[\s\S]{0,400}\.toastui-editor-md-container[\s\S]{0,80}display\s*:\s*none/
  );
});

test('toast-preview-mount CSS does not hide .toastui-editor-md-tab-style (preview wrapper)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // Regression: an earlier revision hid .toastui-editor-md-tab-style which
  // wraps Toast UI's preview pane in tab-style mode.
  assert.doesNotMatch(
    html,
    /\.toast-preview-mount[\s\S]{0,400}\.toastui-editor-md-tab-style[\s\S]{0,80}display\s*:\s*none/
  );
});

test('index.html defines .hybrid-write-inner CSS as a full-height flex column', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  const ruleMatch = html.match(/\.hybrid-write-inner\s*\{([\s\S]*?)\}/);
  assert.ok(ruleMatch, 'expected a .hybrid-write-inner CSS rule');
  const body = ruleMatch[1];
  assert.match(body, /min-height\s*:\s*100%/,        'wrapper must stretch to fill the Write pane');
  assert.match(body, /display\s*:\s*flex\b/,         'wrapper must use flex layout');
  assert.match(body, /flex-direction\s*:\s*column\b/,'wrapper must lay out children vertically');
});

test('index.html defines .hybrid-tail-affordance CSS that fills remaining vertical space', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  const ruleMatch = html.match(/\.hybrid-tail-affordance\s*\{([\s\S]*?)\}/);
  assert.ok(ruleMatch, 'expected a .hybrid-tail-affordance CSS rule');
  const body = ruleMatch[1];
  assert.match(body, /flex\s*:\s*1\b/,        'affordance must absorb remaining vertical space');
  assert.match(body, /min-height\s*:\s*2em\b/,'affordance must keep a minimum click height');
  assert.match(body, /cursor\s*:\s*text\b/,   'affordance must show a text cursor on hover');
});

test('index.html defines .hybrid-active-textarea CSS that strips native chrome', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // Capture the .hybrid-active-textarea rule body and assert it removes
  // each piece of native chrome the reviewer called out.
  const ruleMatch = html.match(/\.hybrid-active-textarea\s*\{([\s\S]*?)\}/);
  assert.ok(ruleMatch, 'expected a .hybrid-active-textarea CSS rule');
  const body = ruleMatch[1];
  assert.match(body, /border\s*:\s*(?:0|none)\b/,        'border must be removed');
  assert.match(body, /outline\s*:\s*none\b/,             'outline must be removed');
  assert.match(body, /box-shadow\s*:\s*none\b/,          'box-shadow must be removed');
  assert.match(body, /resize\s*:\s*none\b/,              'resize handle must be disabled');
  // Autoresize sets style.height to fit content, so the textarea must not
  // show its own scrollbar (otherwise the inner scroll trap returns).
  assert.match(body, /overflow-y\s*:\s*hidden\b/,        'overflow-y must be hidden so autoresize controls full height');
});

test('comments do not promise unimplemented blur-to-render behavior', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // HybridWriteView does not implement blur-driven re-rendering; no comment
  // in index.html should claim it does.
  assert.doesNotMatch(html, /blur to return to the rendered view/i);
});

// ── Explicit DOM id lookups (do not rely on implicit window globals) ──────────

test('index.html resolves hybridWritePane via document.getElementById', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(
    html,
    /const\s+hybridWritePane\s*=\s*document\.getElementById\(\s*['"]hybridWritePane['"]\s*\)/
  );
});

test('index.html resolves toastPreviewMount via document.getElementById', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(
    html,
    /const\s+toastPreviewMount\s*=\s*document\.getElementById\(\s*['"]toastPreviewMount['"]\s*\)/
  );
});

test('index.html resolves writeModeButton via document.getElementById', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(
    html,
    /const\s+writeModeButton\s*=\s*document\.getElementById\(\s*['"]writeModeButton['"]\s*\)/
  );
});

test('index.html resolves previewModeButton via document.getElementById', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(
    html,
    /const\s+previewModeButton\s*=\s*document\.getElementById\(\s*['"]previewModeButton['"]\s*\)/
  );
});

// ── Outgoing-note flush on note-list click ────────────────────────────────────

test('note-list click writes flushed text back to the outgoing note before changing selection', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  // Inside the note-list click handler, the outgoing note's body must be
  // updated from liveEditorInstance.getText() BEFORE selectedNoteId mutates.
  assert.match(
    html,
    /noteList[\s\S]*?addEventListener\(\s*['"]click['"][\s\S]*?const\s+outgoingNote\s*=\s*getSelectedNote\(\)[\s\S]*?exitWriteMode\s*\([\s\S]*?outgoingNote\.body\s*=\s*liveEditorInstance\.getText\(\)[\s\S]*?selectedNoteId\s*=\s*note\.id/
  );
});

// ── Bug #2: scroll-position sync between Write and Preview ─────────────────
// The mode toggle now captures a scroll ratio from the source surface and
// re-applies it to the target surface inside requestAnimationFrame. The
// pure helpers (captureScrollRatio / applyScrollRatio) live in
// lib/scroll-sync.js and are unit-tested separately. These regex tests
// pin the wiring inside index.html.

function readIndexHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
}

test('index.html loads scroll-sync lib before the inline boot script', () => {
  const html = readIndexHtml();
  const tag = '<script src="./lib/scroll-sync.js"></script>';
  const bootMarker = 'Boot the Markdown editor';
  assert.ok(html.includes(tag), 'scroll-sync.js script tag must be present');
  assert.ok(
    html.indexOf(tag) < html.indexOf(bootMarker),
    'scroll-sync.js must load before the inline boot script'
  );
});

test('showPreviewMode captures from hybridWritePane BEFORE setMarkdown', () => {
  const html = readIndexHtml();
  // Inside showPreviewMode, the scroll capture must reference hybridWritePane
  // and must come earlier in the function body than the setMarkdown call.
  assert.match(
    html,
    /function\s+showPreviewMode\s*\([\s\S]*?captureScrollRatio\s*\(\s*hybridWritePane\s*\)[\s\S]*?_toastuiInstance\.setMarkdown\s*\(/
  );
});

test('showPreviewMode applies the ratio to .toastui-editor-md-preview inside requestAnimationFrame', () => {
  const html = readIndexHtml();
  // After the body switches visibility, defer the apply to a frame so the
  // newly-shown Preview pane has its scrollHeight/clientHeight committed.
  assert.match(
    html,
    /function\s+showPreviewMode\s*\([\s\S]*?requestAnimationFrame\s*\([\s\S]*?applyScrollRatio\s*\([\s\S]*?toastPreviewMount\.querySelector\(\s*['"]\.toastui-editor-md-preview['"]\s*\)/
  );
});

test('showWriteMode captures from .toastui-editor-md-preview', () => {
  const html = readIndexHtml();
  assert.match(
    html,
    /function\s+showWriteMode\s*\([\s\S]*?captureScrollRatio\s*\(\s*toastPreviewMount\.querySelector\(\s*['"]\.toastui-editor-md-preview['"]\s*\)\s*\)/
  );
});

test('showWriteMode applies the ratio to hybridWritePane inside requestAnimationFrame', () => {
  const html = readIndexHtml();
  assert.match(
    html,
    /function\s+showWriteMode\s*\([\s\S]*?requestAnimationFrame\s*\([\s\S]*?applyScrollRatio\s*\(\s*hybridWritePane\s*,/
  );
});
