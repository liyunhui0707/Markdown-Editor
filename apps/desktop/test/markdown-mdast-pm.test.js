'use strict';

/* Remark bridge — pure mdast <-> ProseMirror converter tests (headless).

   Load-bearing cases:
   - GFM TASK LIST checkbox preserved both directions (tiptap-markdown lost it).
   - TOTALITY: unknown / raw-html nodes degrade to a VISIBLE paragraph, never a
     null-drop that empties the doc (a contributor to the blank-editor bug). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mdastToPm, pmToMdast } = require('../lib/markdown-mdast-pm.js');

function md(type, extra) { return Object.assign({ type }, extra); }
function text(v) { return { type: 'text', value: v }; }
function para(children) { return { type: 'paragraph', children }; }
function root(children) { return { type: 'root', children }; }

// ── mdast -> PM ─────────────────────────────────────────────────────────

test('mdastToPm: heading carries (and clamps) level', () => {
  const pm = mdastToPm(root([{ type: 'heading', depth: 2, children: [text('Hi')] }]));
  assert.equal(pm.content[0].type, 'heading');
  assert.equal(pm.content[0].attrs.level, 2);
  assert.equal(pm.content[0].content[0].text, 'Hi');
  assert.equal(mdastToPm(root([{ type: 'heading', depth: 9, children: [text('x')] }])).content[0].attrs.level, 6);
});

test('mdastToPm: emphasis/strong/inlineCode/strike/link become marks', () => {
  const pm = mdastToPm(root([para([
    { type: 'strong', children: [text('b')] },
    { type: 'emphasis', children: [text('i')] },
    { type: 'inlineCode', value: 'c' },
    { type: 'delete', children: [text('s')] },
    { type: 'link', url: 'https://x', title: null, children: [text('l')] },
  ])]));
  const inline = pm.content[0].content;
  assert.deepEqual(inline[0].marks, [{ type: 'bold' }]);
  assert.deepEqual(inline[1].marks, [{ type: 'italic' }]);
  assert.deepEqual(inline[2].marks, [{ type: 'code' }]);
  assert.deepEqual(inline[3].marks, [{ type: 'strike' }]);
  assert.equal(inline[4].marks[0].type, 'link');
  assert.equal(inline[4].marks[0].attrs.href, 'https://x');
});

test('mdastToPm: GFM task list -> taskList/taskItem with checked attr', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [
      { type: 'listItem', checked: false, children: [para([text('todo')])] },
      { type: 'listItem', checked: true, children: [para([text('done')])] },
    ] }),
  ]));
  assert.equal(pm.content[0].type, 'taskList');
  assert.equal(pm.content[0].content[0].attrs.checked, false);
  assert.equal(pm.content[0].content[1].attrs.checked, true);
});

test('mdastToPm: plain bullet list -> bulletList/listItem', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [{ type: 'listItem', checked: null, children: [para([text('x')])] }] }),
  ]));
  assert.equal(pm.content[0].type, 'bulletList');
  assert.equal(pm.content[0].content[0].type, 'listItem');
});

test('mdastToPm: table first row -> tableHeader, rest -> tableCell, cells wrap paragraphs', () => {
  const pm = mdastToPm(root([
    md('table', { align: [null, null], children: [
      { type: 'tableRow', children: [{ type: 'tableCell', children: [text('A')] }, { type: 'tableCell', children: [text('B')] }] },
      { type: 'tableRow', children: [{ type: 'tableCell', children: [text('1')] }, { type: 'tableCell', children: [text('2')] }] },
    ] }),
  ]));
  const table = pm.content[0];
  assert.equal(table.content[0].content[0].type, 'tableHeader');
  assert.equal(table.content[1].content[0].type, 'tableCell');
  assert.equal(table.content[0].content[0].content[0].type, 'paragraph');
  assert.equal(table.content[0].content[0].content[0].content[0].text, 'A');
});

test('mdastToPm: empty table cell still yields a valid paragraph', () => {
  const pm = mdastToPm(root([
    md('table', { children: [
      { type: 'tableRow', children: [{ type: 'tableCell', children: [text('a')] }, { type: 'tableCell', children: [] }] },
    ] }),
  ]));
  const emptyCell = pm.content[0].content[0].content[1];
  assert.equal(emptyCell.content[0].type, 'paragraph');
  assert.deepEqual(emptyCell.content[0].content, []);
});

test('math: inlineMath/math <-> inlineMath/mathBlock nodes carry verbatim latex', () => {
  // mdast (from remark-math) -> PM
  const pm = mdastToPm(root([
    para([{ type: 'inlineMath', value: 'a_b' }]),
    { type: 'math', value: '\\sum_{i=1}^n i' },
  ]));
  assert.equal(pm.content[0].content[0].type, 'inlineMath');
  assert.equal(pm.content[0].content[0].attrs.latex, 'a_b');
  assert.equal(pm.content[1].type, 'mathBlock');
  assert.equal(pm.content[1].attrs.latex, '\\sum_{i=1}^n i');
  // PM -> mdast (back)
  const back = pmToMdast(pm);
  assert.equal(back.children[0].children[0].type, 'inlineMath');
  assert.equal(back.children[0].children[0].value, 'a_b');
  assert.equal(back.children[1].type, 'math');
  assert.equal(back.children[1].value, '\\sum_{i=1}^n i');
});

test('mdastToPm: code block keeps language + value', () => {
  const pm = mdastToPm(root([{ type: 'code', lang: 'js', value: 'const x=1;' }]));
  assert.equal(pm.content[0].type, 'codeBlock');
  assert.equal(pm.content[0].attrs.language, 'js');
  assert.equal(pm.content[0].content[0].text, 'const x=1;');
});

test('mermaid: lang=mermaid code <-> mermaidBlock; other langs stay codeBlock', () => {
  const pm = mdastToPm(root([
    { type: 'code', lang: 'mermaid', value: 'graph TD; A-->B;' },
    { type: 'code', lang: 'js', value: 'x;' },
  ]));
  assert.equal(pm.content[0].type, 'mermaidBlock');
  assert.equal(pm.content[0].attrs.code, 'graph TD; A-->B;');
  assert.equal(pm.content[1].type, 'codeBlock');
  // back to mdast: mermaidBlock -> code with lang mermaid
  const back = pmToMdast(pm);
  assert.equal(back.children[0].type, 'code');
  assert.equal(back.children[0].lang, 'mermaid');
  assert.equal(back.children[0].value, 'graph TD; A-->B;');
});

test('TOTALITY: raw block html degrades to a visible paragraph (never dropped/blank)', () => {
  const pm = mdastToPm(root([{ type: 'html', value: '<script>alert(1)</script>' }]));
  assert.equal(pm.content[0].type, 'paragraph');
  assert.equal(pm.content[0].content[0].text, '<script>alert(1)</script>');
});

test('TOTALITY: unknown value-only node degrades to text; empty doc -> one paragraph', () => {
  const pm = mdastToPm(root([{ type: 'someFutureNode', value: 'keepme' }]));
  assert.equal(pm.content[0].content[0].text, 'keepme');
  assert.deepEqual(mdastToPm(root([])).content, [{ type: 'paragraph' }]);
});

// ── PM -> mdast ─────────────────────────────────────────────────────────

test('pmToMdast: taskList -> list with checked listItems', () => {
  const doc = { type: 'doc', content: [{ type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] },
    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] },
  ] }] };
  const list = pmToMdast(doc).children[0];
  assert.equal(list.children[0].checked, true);
  assert.equal(list.children[1].checked, false);
});

test('pmToMdast: marks -> nested emphasis/strong/inlineCode/link', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
    { type: 'text', text: 'c', marks: [{ type: 'code' }] },
    { type: 'text', text: 'l', marks: [{ type: 'link', attrs: { href: 'https://x', title: null } }] },
  ] }] };
  const p = pmToMdast(doc).children[0];
  assert.equal(p.children[0].type, 'strong');
  assert.equal(p.children[1].type, 'inlineCode');
  assert.equal(p.children[2].type, 'link');
  assert.equal(p.children[2].url, 'https://x');
});

test('round-trip mdast -> pm -> mdast preserves task checkbox state', () => {
  const original = root([
    md('list', { ordered: false, children: [
      { type: 'listItem', checked: false, children: [para([text('a')])] },
      { type: 'listItem', checked: true, children: [para([text('b')])] },
    ] }),
  ]);
  const li = pmToMdast(mdastToPm(original)).children[0].children;
  assert.equal(li[0].checked, false);
  assert.equal(li[1].checked, true);
});
