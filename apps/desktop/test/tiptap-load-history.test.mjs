import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import DirtyState from '../lib/dirty-state.js';

// Exercise the real factory, Markdown bridge, Tiptap commands and PM history.
// Only mounting is replaced: Node has no DOM. Browser/plugin-view behavior is
// covered separately by packaged Electron QA, not by this headless adapter.
const entry = new URL('../lib/tiptap-entry.js', import.meta.url);
const source = await readFile(entry, 'utf8');
assert.ok(source.includes("import { Editor } from '@tiptap/core';"));
const adapted = source.replace("import { Editor } from '@tiptap/core';", `
import { Editor as RealEditor } from '@tiptap/core';
import { history } from '@tiptap/pm/history';
class Editor extends RealEditor {
  constructor(options) {
    super({ ...options, element: null,
      content: { type: 'doc', content: [{ type: 'paragraph' }] } });
    this.richDom = { style: {} };
    this.view.updateState(this.state.reconfigure({ plugins: [history()] }));
  }
  get view() {
    const view = super.view;
    return new Proxy(view, { get: (target, key) =>
      key === 'dom' ? this.richDom : Reflect.get(target, key) });
  }
}
`);
const built = await build({
  stdin: { contents: adapted, resolveDir: fileURLToPath(new URL('../lib/', import.meta.url)) },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
function createView(initialDoc = 'First note.', onChange = () => {}) {
  const elements = [];
  const context = {
    exports: {}, console, setTimeout, clearTimeout, URL, process,
    require: createRequire(import.meta.url),
  };
  context.module = { exports: context.exports };
  vm.runInNewContext(built.outputFiles[0].text, context);
  context.document = { createElement: () => ({
    value: '', style: {}, focus() {}, addEventListener() {},
  }) };
  const api = context.module.exports.createTiptapView({
    appendChild: el => elements.push(el),
  }, { initialDoc, onChange });
  return { api, textarea: elements[0] };
}
function edit(api, text = 'EDIT') {
  // Real transaction, synchronous with loading (no history grouping timeout).
  const { state } = api.view;
  api.view.view.dispatch(state.tr.insertText(text, state.doc.content.size - 1));
}

test('initial load followed immediately by edit/undo retains the loaded note', () => {
  const { api } = createView();
  const loaded = api.getText();
  edit(api);
  const edited = api.getText();
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
  assert.equal(api.view.commands.redo(), true);
  assert.equal(api.getText(), edited);
});

test('note switching discards outgoing undo and redo without marking a load dirty', () => {
  const changes = [];
  const { api } = createView('First note.', text => changes.push(text));
  edit(api);
  api.view.commands.undo();
  changes.length = 0;
  api.setText('Second note.');
  const loaded = api.getText();
  assert.equal(changes.length, 0);
  assert.equal(api.view.commands.undo(), false);
  assert.equal(api.view.commands.redo(), false);
  assert.equal(api.getText(), loaded);
  edit(api);
  assert.equal(changes.length, 1);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
  assert.equal(changes.at(-1), loaded);
  assert.equal(api.view.commands.undo(), false);
});

test('empty note loading also starts a fresh undo boundary', () => {
  const { api } = createView();
  edit(api);
  api.setText('');
  const empty = api.getText();
  assert.equal(api.view.commands.undo(), false);
  edit(api);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), empty);
});

test('same-note Source/Rich edits remain undoable', () => {
  const { api, textarea } = createView();
  const loaded = api.getText();
  api.setSourceMode(true);
  textarea.value = 'Edited in source.';
  api.setSourceMode(false);
  const edited = api.getText();
  assert.match(edited, /Edited in source/);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
  assert.equal(api.view.commands.redo(), true);
  assert.equal(api.getText(), edited);
});

test('switching from Source cannot restore outgoing content or frontmatter', () => {
  const { api, textarea } = createView('---\ntitle: First\n---\nFirst note.');
  api.setSourceMode(true);
  textarea.value = 'Outgoing source changes.';
  api.setText('---\ntitle: Second\n---\nSecond note.');
  const loaded = api.getText();
  assert.equal(api.isSourceMode(), false);
  edit(api);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
  assert.match(loaded, /title: Second/);
  assert.doesNotMatch(loaded, /First|Outgoing/);
  assert.equal(api.view.commands.undo(), false);
});

test('redo cannot revive a previous note after switching', () => {
  const { api } = createView();
  edit(api);
  api.view.commands.undo();
  api.setText('Second note.');
  assert.equal(api.view.commands.redo(), false);
  assert.equal(api.getText(), 'Second note.');
});

test('source save/preview flush retains same-note undo history', () => {
  const { api, textarea } = createView();
  const loaded = api.getText();
  api.setSourceMode(true);
  textarea.value = 'Source saved content.';
  api.exitWriteMode();
  assert.equal(api.isSourceMode(), true);
  assert.equal(api.getText(), textarea.value);
  api.setSourceMode(false);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
});

test('structured note survives immediate edit/undo and reload resets history', () => {
  const { api } = createView();
  api.setText('# Heading\n\n- [x] Done\n\n| A | B |\n| :- | -: |\n| 1 | 2 |\n\nTail.');
  const loaded = api.getText();
  const json = JSON.stringify(api.view.getJSON());
  edit(api);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
  assert.equal(JSON.stringify(api.view.getJSON()), json);
  api.setText(loaded);
  assert.equal(api.view.commands.undo(), false);
  assert.equal(api.view.commands.redo(), false);
});

test('actual entry factory preserves currency/math across Source, Rich and undo', () => {
  const { api, textarea } = createView('Price $5 and formula $a_b + c^2$.');
  const loaded = api.getText();
  // A6: no rich edit means original source, not eagerly normalized output.
  assert.equal(loaded, 'Price $5 and formula $a_b + c^2$.');
  assert.deepEqual(Array.from(api.view.state.doc.firstChild.content.content)
    .filter(node => node.type.name === 'inlineMath').map(node => node.attrs.latex), ['a_b + c^2']);
  edit(api);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
  api.setSourceMode(true);
  textarea.value = 'Prices $5 and $10; literal $ x $; formula $5$.';
  api.setSourceMode(false);
  const changed = api.getText();
  assert.equal(changed, 'Prices $5 and $10; literal $ x $; formula $5$.');
  assert.deepEqual(Array.from(api.view.state.doc.firstChild.content.content)
    .filter(node => node.type.name === 'inlineMath').map(node => node.attrs.latex), ['5']);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), loaded);
  assert.equal(api.view.commands.redo(), true);
  assert.equal(api.getText(), changed);
});

const rawTable = '| Left | Right |\n| :--- | ---: |\n| a | b |\n\n- [x] Done\n';

test('A6: untouched table stays byte-identical and clean across flush and note switch', () => {
  const { api } = createView(rawTable);
  const note = { source: 'vault', title: 'Table', loadedTitle: 'Table',
    body: rawTable, loadedBody: rawTable };
  // Same read/flush contract used by navigation and Save All in the renderer.
  api.exitWriteMode();
  note.body = api.getText();
  assert.equal(DirtyState.isNoteDirty(note), false);
  api.setText('Second note.');
  assert.equal(api.getText(), 'Second note.');
  api.setText(note.body);
  assert.equal(api.getText(), rawTable);
  assert.equal(api.view.commands.undo(), false);
  note.title = 'Renamed';
  assert.equal(DirtyState.isNoteDirty(note), true, 'title changes are still dirty');
});

test('A6: real rich edit is dirty, undo restores raw baseline, redo restores edit', () => {
  const changes = [];
  const { api } = createView(rawTable, text => changes.push(text));
  const note = { source: 'vault', title: 'Table', loadedTitle: 'Table',
    body: rawTable, loadedBody: rawTable };
  edit(api, 'ONLY-A');
  const edited = api.getText();
  note.body = edited;
  assert.equal(DirtyState.isNoteDirty(note), true);
  assert.match(edited, /ONLY-A/);
  assert.equal(api.view.commands.undo(), true);
  note.body = api.getText();
  assert.equal(note.body, rawTable);
  assert.equal(DirtyState.isNoteDirty(note), false);
  assert.equal(changes.at(-1), rawTable);
  assert.equal(api.view.commands.redo(), true);
  assert.equal(api.getText(), edited);
});

test('A6: Source/Rich no-op stays clean; deliberate source formatting survives rich mode', () => {
  const { api, textarea } = createView(rawTable);
  api.setSourceMode(true);
  assert.equal(textarea.value, rawTable);
  api.exitWriteMode();
  api.setSourceMode(false);
  assert.equal(api.getText(), rawTable);
  api.setSourceMode(true);
  const sourceEdit = rawTable.replace('| a | b |', '| a  | b |');
  textarea.value = sourceEdit;
  api.exitWriteMode();
  api.setSourceMode(false);
  assert.equal(api.getText(), sourceEdit, 'same rich tree must not hide a real Source edit');
  edit(api);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), sourceEdit);
});

test('A6: source content edits can undo to loaded raw text and cannot leak into next note', () => {
  const { api, textarea } = createView(rawTable);
  api.setSourceMode(true);
  textarea.value = 'ONLY-A source edit.\n';
  api.setSourceMode(false);
  assert.equal(api.getText(), textarea.value);
  assert.equal(api.view.commands.undo(), true);
  assert.equal(api.getText(), rawTable);
  assert.equal(api.view.commands.redo(), true);
  assert.equal(api.getText(), textarea.value);
  api.setText('ONLY-B');
  assert.equal(api.getText(), 'ONLY-B');
  assert.equal(api.view.commands.undo(), false);
});
