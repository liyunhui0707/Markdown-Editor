import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { findDocumentText, createFindPlugin, createFindView, FIND_LIMIT } from '../lib/document-find-view.mjs';
const schema = new Schema({ nodes: { doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*' }, hardBreak: { inline: true, group: 'inline' },
  codeBlock: { group: 'block', content: 'text*' } }, marks: { bold: {} } });
const para = text => schema.node('paragraph', null, text ? schema.text(text) : null);
const document = (...texts) => schema.node('doc', null, texts.map(para));
test('literal search maps Chinese, emoji and marked inline text to exact PM positions', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('中文😀['),
    schema.text('Bold', [schema.mark('bold')]), schema.text('] .* a+b?')]), schema.node('codeBlock', null, schema.text('readonly 中文'))]);
  const before = doc.toJSON();
  for (const query of ['中文', '😀', '[Bold]', '.*', 'a+b?']) {
    const found = findDocumentText(doc, query);
    assert.ok(found.matches.length);
    for (const m of found.matches) assert.equal(doc.textBetween(m.from, m.to), query);
  }
  assert.equal(findDocumentText(doc, '中文').total, 2);
  assert.deepEqual(doc.toJSON(), before);
});
test('search respects block/inline boundaries, empty query and case option without lowercasing offsets', () => {
  const doc = schema.node('doc', null, [para('ALPHA alpha İ😀'), para('next'),
    schema.node('paragraph', null, [schema.text('ab'), schema.node('hardBreak'), schema.text('cd')])]);
  assert.equal(findDocumentText(doc, 'alpha').total, 2);
  assert.equal(findDocumentText(doc, 'alpha', true).total, 1);
  for (const query of ['', '😀next', 'abcd', 'a'.repeat(257)]) assert.equal(findDocumentText(doc, query).total, 0);
  const emoji = findDocumentText(doc, '😀').matches[0]; assert.equal(doc.textBetween(emoji.from, emoji.to), '😀');
});
test('large result sets retain an accurate total with bounded decorations', () => {
  const found = findDocumentText(document('a'.repeat(5000)), 'a');
  assert.equal(found.total, 5000); assert.equal(found.matches.length, FIND_LIMIT);
});
function fixture() {
  const nodes = new Map(), handlers = {};
  const doc = { activeElement: null, querySelector: () => null, addEventListener(k, fn) { handlers[k] = fn; } };
  const byId = id => {
    if (!nodes.has(id)) nodes.set(id, { ownerDocument: doc, value: '', checked: false, dataset: {}, attrs: {}, disabled: false,
      setAttribute(k, v) { this.attrs[k] = v; }, focus() { doc.activeElement = this; }, select() {},
      contains(n) { return n === this || n === byId('find-query'); }, addEventListener(k, fn) { this[k] = fn; },
      getBoundingClientRect: () => ({ top: 0 }), scrollTop: 0, clientHeight: 300,
      scrollTo({ top }) { this.scrollTop = top; this.calls = (this.calls || 0) + 1; } });
    return nodes.get(id);
  };
  const plugin = createFindPlugin();
  const editor = { state: EditorState.create({ schema, doc: document('alpha 中文', 'alpha'), plugins: [plugin] }),
    view: { editable: true, composing: false, dom: { focus() { doc.activeElement = byId('editor'); } }, focus() { doc.activeElement = byId('editor'); },
      coordsAtPos: () => ({ top: 500 }), dispatch(tr) { assert.equal(tr.docChanged, false); assert.equal(tr.selectionSet, false); editor.state = editor.state.apply(tr); } } };
  const c = { editor, state: { source: 'alpha 中文\n\nalpha', confirmed: { sessionId: 'a', source: 'alpha 中文\n\nalpha', revision: 0 }, pending: 0 } };
  const view = createFindView({ byId, context: () => c }); view.configure();
  const key = (key, extra = {}) => { const e = { key, target: doc.activeElement, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra }; handlers.keydown(e); return e; };
  const search = query => { byId('find-query').value = query; byId('find-query').oninput({}); };
  return { c, view, byId, plugin, doc, key, search };
}
test('open, highlight, wrap navigation and Escape preserve document, selection and revision', () => {
  const { c, view, byId, plugin, doc, key, search } = fixture();
  c.editor.state = c.editor.state.apply(c.editor.state.tr.setSelection(TextSelection.create(c.editor.state.doc, 3)));
  const before = JSON.stringify(c.state), original = c.editor.state.doc, selection = c.editor.state.selection;
  key('f', { metaKey: true }); assert.equal(doc.activeElement, byId('find-query'));
  search('alpha'); assert.equal(byId('find-count').textContent, '1 / 2'); assert.equal(plugin.getState(c.editor.state).find().length, 2);
  key('Enter'); assert.equal(byId('find-count').textContent, '2 / 2');
  key('Enter'); assert.equal(byId('find-count').textContent, '1 / 2');
  key('Enter', { shiftKey: true }); assert.equal(byId('find-count').textContent, '2 / 2');
  key('Escape'); assert.equal(byId('document-find').hidden, true); assert.equal(doc.activeElement, byId('editor'));
  assert.equal(plugin.getState(c.editor.state).find().length, 0);
  assert.equal(c.editor.state.doc, original); assert.equal(c.editor.state.selection, selection); assert.equal(JSON.stringify(c.state), before);
  view.sync();
});
test('busy editor or composition cannot steal focus, dispatch highlights or navigate; recovery resumes search', () => {
  const { c, view, byId, key, search } = fixture(); key('f', { metaKey: true }); search('alpha');
  const calls = byId('document-scroll').calls, state = c.editor.state;
  for (const field of ['pending', 'historyPending', 'composing', 'compositionInvalid', 'locked']) {
    c.state[field] = true; view.sync(); byId('find-next').onclick(); key('Escape');
    assert.equal(byId('document-find').hidden, false); assert.equal(byId('document-scroll').calls, calls); assert.equal(c.editor.state, state);
    c.state[field] = false;
  }
  for (const field of ['loading', 'invalid']) { c[field] = true; view.sync(); byId('find-next').onclick(); assert.equal(byId('document-scroll').calls, calls); c[field] = false; }
  c.editor.view.composing = true; view.sync(); key('f', { metaKey: true }); assert.equal(byId('find-query').disabled, true);
  c.editor.view.composing = false; view.sync(); byId('find-next').onclick(); assert.equal(byId('find-count').textContent, '2 / 2');
});
test('search-field IME does not submit preedit or consume candidate Enter/Escape', () => {
  const { c, byId, key, search } = fixture(); key('f', { metaKey: true }); search('alpha');
  byId('find-query').compositionstart(); const before = c.editor.state;
  byId('find-query').value = '中'; byId('find-query').oninput({ isComposing: true });
  assert.equal(key('Enter', { isComposing: true }).prevented, undefined);
  assert.equal(key('Escape').prevented, undefined); assert.equal(c.editor.state, before);
  byId('find-query').value = '中文'; byId('find-query').compositionend();
  assert.equal(byId('find-count').textContent, '1 / 1'); assert.equal(byId('document-find').hidden, false);
});
test('edits, Undo and A/B/A recompute current document matches; no stale navigation during pending switch', () => {
  const { c, view, byId, key, search, plugin } = fixture(); key('f', { metaKey: true }); search('alpha');
  const original = c.editor.state;
  c.loading = true; c.state.confirmed = { ...c.state.confirmed, sessionId: 'b' };
  const calls = byId('document-scroll').calls; byId('find-next').onclick(); assert.equal(byId('document-scroll').calls, calls);
  c.editor.state = EditorState.create({ schema, doc: document('Other'), plugins: [plugin] });
  c.loading = false; view.sync(); assert.equal(byId('find-count').textContent, '无匹配');
  c.state.confirmed = { ...c.state.confirmed, sessionId: 'a' }; c.editor.state = original; view.sync();
  assert.equal(byId('find-count').textContent, '1 / 2');
  c.editor.state = c.editor.state.apply(c.editor.state.tr.insertText('alpha ', 1)); view.sync(); assert.equal(byId('find-count').textContent, '1 / 3');
  c.editor.state = original; view.sync(); assert.equal(byId('find-count').textContent, '1 / 2');
  search('absent'); assert.equal(plugin.getState(c.editor.state).find().length, 0); assert.equal(byId('find-next').disabled, true);
  search(''); assert.equal(byId('find-count').textContent, '');
});
test('a modal owns keyboard events and focus while search remains open underneath', () => {
  const { byId, doc, key, search } = fixture(); key('f', { metaKey: true }); search('alpha');
  doc.querySelector = () => ({}); const active = doc.activeElement;
  assert.equal(key('Escape').prevented, undefined); assert.equal(key('f', { metaKey: true }).prevented, undefined);
  assert.equal(byId('document-find').hidden, false); assert.equal(doc.activeElement, active);
});

test('readonly focus return restores the current PM range, never a cached session range', () => {
  const { c, doc, key, search } = fixture();
  key('f', { metaKey: true }); search('alpha');
  c.editor.view.editable = false;
  c.editor.state = c.editor.state.apply(c.editor.state.tr.setSelection(TextSelection.create(c.editor.state.doc, 2, 5)));
  c.editor.view.domAtPos = offset => ({ node: 'synthetic-text-node', offset });
  let range = null; doc.getSelection = () => ({ setBaseAndExtent: (...args) => { range = args; } });
  key('Escape'); assert.deepEqual(range, ['synthetic-text-node', 2, 'synthetic-text-node', 5]);
  assert.equal(c.editor.state.selection.from, 2); assert.equal(c.editor.state.selection.to, 5);
});
