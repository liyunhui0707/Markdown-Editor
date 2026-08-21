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

test('mdastToPm: code mark is exclusive — bold+code text keeps only code', () => {
  // `**`x`**` -> strong(inlineCode) in mdast. The Tiptap `code` mark excludes
  // all others, so the text must carry ONLY the code mark (else setContent
  // rejects the whole doc -> raw fallback).
  const pm = mdastToPm(root([para([
    { type: 'strong', children: [{ type: 'inlineCode', value: 'x' }] },
  ])]));
  const inline = pm.content[0].content[0];
  assert.equal(inline.text, 'x');
  assert.deepEqual(inline.marks, [{ type: 'code' }], 'bold dropped; only code kept');
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

// ── Mixed task/plain lists: split into adjacent runs (Option A) ───────────────
// A list that mixes GFM task items and plain bullets must NOT become a single
// taskList (which injected `[ ]` into the plain bullets on save). It splits into
// contiguous taskList / bulletList(orderedList) runs so each item keeps its kind.

const li = (checked, t) => ({ type: 'listItem', checked, children: [para([text(t)])] });

test('mdastToPm: a MIXED task/plain list splits into adjacent taskList + bulletList runs', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [li(false, 'a'), li(null, 'plain'), li(true, 'b')] }),
  ]));
  assert.deepEqual(pm.content.map((n) => n.type), ['taskList', 'bulletList', 'taskList']);
  assert.equal(pm.content[1].content[0].type, 'listItem', 'plain item is a listItem, not taskItem');
  assert.equal(pm.content[1].content[0].attrs, undefined, 'plain item carries no checked attr');
  assert.equal(pm.content[0].content[0].attrs.checked, false);
  assert.equal(pm.content[2].content[0].attrs.checked, true);
});

test('mdastToPm: a MIXED list starting with a plain item splits plain-first', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [li(null, 'p'), li(false, 't')] }),
  ]));
  assert.deepEqual(pm.content.map((n) => n.type), ['bulletList', 'taskList']);
});

test('mdastToPm: contiguous task items group into ONE taskList run', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [li(false, 't1'), li(true, 't2'), li(null, 'p')] }),
  ]));
  assert.deepEqual(pm.content.map((n) => n.type), ['taskList', 'bulletList']);
  assert.equal(pm.content[0].content.length, 2, 'both task items in one run');
});

test('mdastToPm: a pure task list stays ONE taskList (regression)', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [li(false, 'a'), li(true, 'b')] }),
  ]));
  assert.equal(pm.content.length, 1);
  assert.equal(pm.content[0].type, 'taskList');
});

test('mdastToPm: a pure bullet list stays ONE bulletList (regression)', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [li(null, 'a'), li(null, 'b')] }),
  ]));
  assert.equal(pm.content.length, 1);
  assert.equal(pm.content[0].type, 'bulletList');
});

test('mdastToPm: ordered MIXED list — plain runs continue the numbering (start = base + index)', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: true, start: 3, children: [li(null, 'p1'), li(false, 't'), li(null, 'p2')] }),
  ]));
  assert.deepEqual(pm.content.map((n) => n.type), ['orderedList', 'taskList', 'orderedList']);
  assert.equal(pm.content[0].attrs.start, 3, 'first plain run keeps the list start');
  assert.equal(pm.content[2].attrs.start, 5, 'plain run after the task continues at 5');
});

test('mdastToPm: a nested MIXED list inside a list item flattens into sibling lists', () => {
  const pm = mdastToPm(root([
    md('list', { ordered: false, children: [
      { type: 'listItem', checked: null, children: [
        para([text('parent')]),
        md('list', { ordered: false, children: [li(false, 'sub task'), li(null, 'sub plain')] }),
      ] },
    ] }),
  ]));
  assert.equal(pm.content.length, 1);
  assert.equal(pm.content[0].type, 'bulletList');
  const inner = pm.content[0].content[0].content; // the listItem's block children
  assert.equal(inner[0].type, 'paragraph');
  assert.deepEqual(inner.slice(1).map((n) => n.type), ['taskList', 'bulletList'], 'nested mixed list split');
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

test('raw block html is preserved verbatim as a rawBlock (not escaped; rendered as text, not executed)', () => {
  // Was previously flattened to a paragraph of TEXT, which remark then escaped on
  // save (data corruption). Now preserved verbatim as a rawBlock that round-trips
  // as an mdast html node. The node view renders via textContent (never innerHTML)
  // so `<script>` is shown as literal source, never executed (see lib/tiptap-raw.js).
  const pm = mdastToPm(root([{ type: 'html', value: '<script>alert(1)</script>' }]));
  assert.equal(pm.content[0].type, 'rawBlock');
  assert.equal(pm.content[0].attrs.raw, '<script>alert(1)</script>');
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

// ── Verbatim passthrough (the data-loss fix) ────────────────────────────────

test('raw block html -> rawBlock (verbatim), not escaped paragraph text', () => {
  const pm = mdastToPm(root([{ type: 'html', value: '<div class="x">raw</div>' }]));
  assert.equal(pm.content[0].type, 'rawBlock');
  assert.equal(pm.content[0].attrs.raw, '<div class="x">raw</div>');
});

test('inline raw html -> rawInline (verbatim)', () => {
  const pm = mdastToPm(root([para([
    text('Press '), { type: 'html', value: '<kbd>Cmd</kbd>' }, text(' now'),
  ])]));
  const inline = pm.content[0].content;
  assert.equal(inline[1].type, 'rawInline');
  assert.equal(inline[1].attrs.raw, '<kbd>Cmd</kbd>');
});

test('offset-only node (linkReference) -> rawInline sliced from source', () => {
  const source = 'A [x][r] b';
  const tree = root([{ type: 'paragraph', children: [
    text('A '),
    { type: 'linkReference', identifier: 'r', position: { start: { offset: 2 }, end: { offset: 8 } }, children: [text('x')] },
    text(' b'),
  ] }]);
  const inline = mdastToPm(tree, source).content[0].content;
  assert.equal(inline[1].type, 'rawInline');
  assert.equal(inline[1].attrs.raw, '[x][r]');
});

test('verbatim guard: positioned node with non-integer offsets does NOT capture the whole doc', () => {
  const source = 'A [x][r] b';
  const tree = root([{ type: 'paragraph', children: [
    { type: 'linkReference', identifier: 'r', position: { start: { offset: null }, end: { offset: undefined } }, children: [text('x')] },
  ] }]);
  const inline = mdastToPm(tree, source).content[0].content;
  // Falls back to the link text (recurse children), NOT a rawInline of the whole source.
  assert.notEqual(inline[0] && inline[0].type, 'rawInline');
  if (inline[0] && inline[0].attrs) assert.notEqual(inline[0].attrs.raw, source);
});

test('pmToMdast: rawBlock + rawInline -> mdast html nodes (remark raw passthrough)', () => {
  const doc = { type: 'doc', content: [
    { type: 'rawBlock', attrs: { raw: '[r]: https://e.com' } },
    { type: 'paragraph', content: [{ type: 'rawInline', attrs: { raw: '[x][r]' } }] },
  ] };
  const mdast = pmToMdast(doc);
  assert.equal(mdast.children[0].type, 'html');
  assert.equal(mdast.children[0].value, '[r]: https://e.com');
  assert.equal(mdast.children[1].children[0].type, 'html');
  assert.equal(mdast.children[1].children[0].value, '[x][r]');
});

test('pmToMdast: rawInline carrying a bold mark -> strong > html (mark preserved)', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'rawInline', attrs: { raw: '[x][r]' }, marks: [{ type: 'bold' }] },
  ] }] };
  const para = pmToMdast(doc).children[0];
  assert.equal(para.children[0].type, 'strong');
  assert.equal(para.children[0].children[0].type, 'html');
  assert.equal(para.children[0].children[0].value, '[x][r]');
});

test('footnoteDefinition WITHOUT source: block body is preserved (not dropped)', () => {
  // The compat path (no source string). A footnote definition holds BLOCK
  // children; the fallback must convert them block-aware so the body survives.
  const tree = root([
    { type: 'footnoteDefinition', identifier: '1', children: [
      para([text('the footnote body')]),
    ] },
  ]);
  const pm = mdastToPm(tree); // no source
  const flat = JSON.stringify(pm.content);
  assert.match(flat, /the footnote body/, 'footnote body content must not be dropped');
});
