'use strict';

/* tiptap-source-toggle — the Source <-> WYSIWYG state contract, headless.

   DOM-injectable (fake textarea/richDom + spy deps) so the state machine is
   tested without a real Tiptap editor: no lost edits, no stale apply on reset,
   button-sync via onModeChange, and full-markdown (frontmatter) edits surviving
   the round to rich. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSourceToggle } = require('../lib/tiptap-source-toggle.js');
const { splitFrontmatter, joinFrontmatter } = require('../lib/markdown-frontmatter.js');

function fakeEl() { return { value: '', style: { display: '' }, focus() { this._focused = true; } }; }

function harness(richMarkdown) {
  const textarea = fakeEl();
  const richDom = fakeEl();
  const calls = { applyMarkdown: [], onChange: [], onModeChange: [] };
  let rich = richMarkdown || '';
  const toggle = createSourceToggle({
    textarea,
    richDom,
    getRichMarkdown: () => rich,
    applyMarkdown: (md) => { calls.applyMarkdown.push(md); rich = md; },
    onChange: (t) => calls.onChange.push(t),
    onModeChange: (on) => calls.onModeChange.push(on),
  });
  return { toggle, textarea, richDom, calls, setRich: (m) => { rich = m; } };
}

test('enter source: textarea = rich markdown; richDom hidden; textarea shown; onModeChange(true)', () => {
  const h = harness('# Hello\n');
  h.toggle.setSourceMode(true);
  assert.equal(h.toggle.isSourceMode(), true);
  assert.equal(h.textarea.value, '# Hello\n');
  assert.equal(h.richDom.style.display, 'none');
  assert.notEqual(h.textarea.style.display, 'none');
  assert.deepEqual(h.calls.onModeChange, [true]);
});

test('getText reflects the active surface', () => {
  const h = harness('# Rich\n');
  assert.equal(h.toggle.getText(), '# Rich\n');     // rich
  h.toggle.setSourceMode(true);
  h.textarea.value = '# Edited in source\n';
  assert.equal(h.toggle.getText(), '# Edited in source\n'); // source = textarea
});

test('exit source applies the EDITED textarea value (no lost edits); richDom shown; onModeChange(false)', () => {
  const h = harness('# Rich\n');
  h.toggle.setSourceMode(true);
  h.textarea.value = '# Edited\n';
  h.toggle.setSourceMode(false);
  assert.deepEqual(h.calls.applyMarkdown, ['# Edited\n']);
  assert.equal(h.toggle.isSourceMode(), false);
  assert.equal(h.richDom.style.display, '');
  assert.equal(h.textarea.style.display, 'none');
  assert.deepEqual(h.calls.onModeChange, [true, false]);
});

test('resetToRich (programmatic setText path): rich WITHOUT applying stale source', () => {
  const h = harness('# Rich\n');
  h.toggle.setSourceMode(true);
  h.textarea.value = '# stale from outgoing note\n';
  h.calls.applyMarkdown.length = 0;
  h.calls.onChange.length = 0;
  h.toggle.resetToRich();
  assert.equal(h.toggle.isSourceMode(), false);
  assert.equal(h.richDom.style.display, '');
  assert.equal(h.textarea.style.display, 'none');
  assert.deepEqual(h.calls.applyMarkdown, [], 'must NOT apply the stale textarea value');
  assert.deepEqual(h.calls.onChange, [], 'must NOT fire onChange');
  assert.equal(h.calls.onModeChange.at(-1), false, 'onModeChange(false) so the button syncs');
});

test('handleInput fires onChange with the current source text (dirty parity)', () => {
  const h = harness('x');
  h.toggle.setSourceMode(true);
  h.textarea.value = '# typed\n';
  h.toggle.handleInput();
  assert.deepEqual(h.calls.onChange, ['# typed\n']);
});

test('idempotent: setSourceMode to the current mode is a no-op', () => {
  const h = harness('x');
  h.toggle.setSourceMode(false); // already rich
  assert.deepEqual(h.calls.onModeChange, []);
  h.toggle.setSourceMode(true);
  h.toggle.setSourceMode(true);  // already source
  assert.deepEqual(h.calls.onModeChange, [true]);
});

test('commitSource: in source mode, parses textarea into rich (applyMarkdown) WITHOUT changing mode or firing onChange', () => {
  const h = harness('# Rich\n');
  h.toggle.setSourceMode(true);
  h.textarea.value = '# Edited in source\n';
  h.calls.applyMarkdown.length = 0;
  h.calls.onModeChange.length = 0;
  h.calls.onChange.length = 0;
  h.toggle.commitSource();
  assert.deepEqual(h.calls.applyMarkdown, ['# Edited in source\n'], 'rich doc synced to source');
  assert.equal(h.toggle.isSourceMode(), true, 'stays in source mode');
  assert.deepEqual(h.calls.onChange, [], 'no onChange');
  assert.deepEqual(h.calls.onModeChange, [], 'no mode change');
});

test('commitSource: no-op when already in rich mode', () => {
  const h = harness('# Rich\n');
  h.toggle.commitSource();
  assert.deepEqual(h.calls.applyMarkdown, []);
});

test('full-markdown source edit (frontmatter + body) survives the round to rich', () => {
  // Fakes mirror the real engine: applyMarkdown splits frontmatter; getRichMarkdown
  // rejoins. Uses the REAL markdown-frontmatter module.
  const textarea = fakeEl();
  const richDom = fakeEl();
  let fm = '';
  let body = '';
  const set = (md) => { const s = splitFrontmatter(md); fm = s.frontmatter; body = s.body; };
  set('---\ntitle: Old\n---\n\n# Body\n');
  const toggle = createSourceToggle({
    textarea, richDom,
    getRichMarkdown: () => joinFrontmatter(fm, body),
    applyMarkdown: set,
    onChange: () => {},
    onModeChange: () => {},
  });
  toggle.setSourceMode(true);
  assert.match(textarea.value, /title: Old/);
  // edit BOTH the frontmatter and the body in source
  textarea.value = '---\ntitle: New\n---\n\n# Body edited\n';
  toggle.handleInput();
  toggle.setSourceMode(false); // exit -> applyMarkdown splits the edited full md
  const out = toggle.getText(); // rich -> joinFrontmatter(fm, body)
  assert.match(out, /title: New/, 'edited frontmatter survives');
  assert.match(out, /# Body edited/, 'edited body survives');
});
