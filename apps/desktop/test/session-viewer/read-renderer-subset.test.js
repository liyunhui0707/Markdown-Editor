/* Stage S3 — Read renderer: markdown subset.
   Run focused: node --test test/session-viewer/read-renderer-subset.test.js
   Covers H1/H2/H3 boundaries, paragraphs, fenced code, inline code,
   bold/italic, lists, tables, and the literal-link-text invariant
   (round-2 m1: markdown link syntax must NOT create <a>/href/src).
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown } = require('../../lib/session-viewer/read-renderer.js');
const {
  makeFakeDocument,
  flattenText,
  findByTag,
  findAllByTag,
} = require('./read-fake-document.js');

function render(text) {
  const doc = makeFakeDocument();
  const frag = renderMarkdown(text, { document: doc });
  return { frag, doc };
}

function assertNoUnsafe(doc) {
  assert.equal(doc.unsafeApiWrites, 0, 'no innerHTML / outerHTML / insertAdjacentHTML writes');
}

function userSection(body) {
  return `## User — 2026-01-01T00:00:00.000Z\n\n${body}`;
}

function assistantSection(body) {
  return `## Assistant — 2026-01-01T00:00:01.000Z\n\n${body}`;
}

test('empty input yields an empty fragment', () => {
  const { frag, doc } = render('');
  assert.equal(frag.children.length, 0);
  assertNoUnsafe(doc);
});

test('null/undefined input yields an empty fragment', () => {
  const { frag } = render(null);
  assert.equal(frag.children.length, 0);
  const { frag: f2 } = render(undefined);
  assert.equal(f2.children.length, 0);
});

test('content outside any User/Assistant section is dropped', () => {
  const { frag } = render('Just a paragraph with no section heading.');
  assert.equal(frag.children.length, 0);
});

test('User section H2 creates a <section> with read-section user-turn class', () => {
  const { frag, doc } = render(userSection('hello'));
  assert.equal(frag.children.length, 1);
  const section = frag.children[0];
  assert.equal(section.tag, 'section');
  assert.equal(section.attrs.class, 'read-section user-turn');
  assert.ok(findByTag(section, 'h2'), 'h2 inside section');
  assertNoUnsafe(doc);
});

test('Assistant section H2 creates a section with assistant-turn class', () => {
  const { frag } = render(assistantSection('hi'));
  assert.equal(frag.children[0].attrs.class, 'read-section assistant-turn');
});

test('paragraph inside user section is wrapped in <p class="user-typed">', () => {
  const { frag } = render(userSection('hello there'));
  const p = findByTag(frag, 'p');
  assert.ok(p);
  assert.equal(p.attrs.class, 'user-typed');
  assert.equal(flattenText(p), 'hello there');
});

test('paragraph inside assistant section is plain <p>', () => {
  const { frag } = render(assistantSection('greetings'));
  const p = findByTag(frag, 'p');
  assert.ok(p);
  assert.equal(p.attrs.class, undefined);
  assert.equal(flattenText(p), 'greetings');
});

test('multi-line paragraph joined with \\n', () => {
  const { frag } = render(userSection('line one\nline two'));
  const p = findByTag(frag, 'p');
  assert.equal(flattenText(p), 'line one\nline two');
});

test('blank line separates paragraphs', () => {
  const { frag } = render(userSection('para one\n\npara two'));
  const ps = findAllByTag(frag, 'p');
  assert.equal(ps.length, 2);
  assert.equal(flattenText(ps[0]), 'para one');
  assert.equal(flattenText(ps[1]), 'para two');
});

test('H1 inside a section creates an <h1>', () => {
  const { frag } = render(userSection('# Heading One\n\nbody'));
  const h1 = findByTag(frag, 'h1');
  assert.ok(h1);
  assert.equal(flattenText(h1), 'Heading One');
});

test('non-role H2 inside an active section attaches as plain <h2>', () => {
  const src = `${userSection('intro')}\n\n## Sub heading\n\nmore`;
  const { frag } = render(src);
  const h2s = findAllByTag(frag, 'h2');
  // First H2 is the role heading, second is the sub-heading.
  assert.equal(h2s.length, 2);
  assert.equal(flattenText(h2s[1]), 'Sub heading');
});

test('H3 (non-tool) inside a section creates an <h3>', () => {
  const { frag } = render(userSection('### Inner\n\nfoo'));
  const h3 = findByTag(frag, 'h3');
  assert.ok(h3);
  assert.equal(flattenText(h3), 'Inner');
});

test('fenced code creates <pre><code> with verbatim contents', () => {
  const src = userSection('```\nline one\nline two\n```');
  const { frag } = render(src);
  const pre = findByTag(frag, 'pre');
  const code = findByTag(pre, 'code');
  assert.equal(flattenText(code), 'line one\nline two');
  assert.equal(pre.attrs.class, 'user-typed');
});

test('fenced code with language info on the open fence is dropped', () => {
  const src = assistantSection('```js\nconst x = 1;\n```');
  const { frag } = render(src);
  const code = findByTag(frag, 'code');
  assert.equal(flattenText(code), 'const x = 1;');
});

test('inline `code` becomes <code>', () => {
  const { frag } = render(userSection('the `value` is set'));
  const codes = findAllByTag(frag, 'code');
  assert.equal(codes.length, 1);
  assert.equal(flattenText(codes[0]), 'value');
});

test('inline **bold** becomes <strong>', () => {
  const { frag } = render(userSection('this is **bold** text'));
  const s = findByTag(frag, 'strong');
  assert.ok(s);
  assert.equal(flattenText(s), 'bold');
});

test('inline _italic_ becomes <em>', () => {
  const { frag } = render(userSection('this is _italic_ text'));
  const em = findByTag(frag, 'em');
  assert.ok(em);
  assert.equal(flattenText(em), 'italic');
});

test('unordered list `-` becomes <ul><li>', () => {
  const src = userSection('- one\n- two\n- three');
  const { frag } = render(src);
  const ul = findByTag(frag, 'ul');
  assert.ok(ul);
  const lis = findAllByTag(ul, 'li');
  assert.equal(lis.length, 3);
  assert.equal(flattenText(lis[0]), 'one');
  assert.equal(flattenText(lis[2]), 'three');
});

test('ordered list `1.` becomes <ol><li>', () => {
  const src = userSection('1. alpha\n2. beta');
  const { frag } = render(src);
  const ol = findByTag(frag, 'ol');
  assert.ok(ol);
  const lis = findAllByTag(ol, 'li');
  assert.equal(lis.length, 2);
});

test('Stage 6.11: non-list prefix followed by `-` items splits into <p> + <ul>', () => {
  // Source: a header line, then list items WITHOUT a blank line between
  // them. Previously the renderer fell back to a single <p> joining the
  // lines with "\n", which renders as one continuous line — visible to
  // the user as "Header: - item1 - item2 - item3".
  const src = userSection('Workflow status:\n- step 1\n- step 2\n- step 3');
  const { frag } = render(src);
  const p = findByTag(frag, 'p');
  const ul = findByTag(frag, 'ul');
  assert.ok(p, 'must emit a <p> for the non-list prefix');
  assert.equal(flattenText(p).trim(), 'Workflow status:');
  assert.ok(ul, 'must emit a <ul> for the list lines that follow');
  const lis = findAllByTag(ul, 'li');
  assert.equal(lis.length, 3);
  assert.equal(flattenText(lis[0]), 'step 1');
  assert.equal(flattenText(lis[2]), 'step 3');
});

test('Stage 6.11: non-list prefix followed by `1.` items splits into <p> + <ol>', () => {
  const src = userSection('Steps to take:\n1. first\n2. second');
  const { frag } = render(src);
  const p = findByTag(frag, 'p');
  const ol = findByTag(frag, 'ol');
  assert.ok(p);
  assert.equal(flattenText(p).trim(), 'Steps to take:');
  assert.ok(ol);
  const lis = findAllByTag(ol, 'li');
  assert.equal(lis.length, 2);
  assert.equal(flattenText(lis[0]), 'first');
});

test('GFM table becomes <table><thead><tr><th>… plus <tbody>', () => {
  const src = assistantSection(
    '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |'
  );
  const { frag } = render(src);
  const table = findByTag(frag, 'table');
  assert.ok(table);
  const ths = findAllByTag(table, 'th');
  const tds = findAllByTag(table, 'td');
  assert.equal(ths.length, 2);
  assert.equal(tds.length, 4);
  assert.equal(flattenText(ths[1]), 'b');
  assert.equal(flattenText(tds[3]), '4');
});

test('Stage 6.11: GFM table is wrapped in a .table-scroller div for horizontal-scroll containment', () => {
  // The wrapper lets the table render at its natural max-content width
  // (so single-word columns like "Severity" never break mid-word) while
  // confining any horizontal overflow to the wrapper instead of the
  // whole read-view.
  const src = assistantSection(
    '| Severity | Where | What |\n| - | - | - |\n| minor | index.html:413 | scrollbar-gutter stacking |'
  );
  const { frag } = render(src);
  // The fake DOM stores element attributes in `.attrs` (set via
  // setAttribute), not as a `.className` property. Match the wrapper by
  // its attribute value.
  const wrappers = findAllByTag(frag, 'div').filter((d) => {
    const cls = (d.attrs && d.attrs.class) || '';
    return cls.split(' ').includes('table-scroller');
  });
  assert.equal(wrappers.length, 1, 'expected exactly one .table-scroller wrapper');
  const innerTable = findByTag(wrappers[0], 'table');
  assert.ok(innerTable, '.table-scroller must contain a <table>');
  const ths = findAllByTag(innerTable, 'th');
  assert.equal(ths.length, 3, 'wrapped table must still carry 3 headers');
  assert.equal(flattenText(ths[0]), 'Severity');
});

test('round-2 m1: markdown link syntax never creates <a>, href, or src', () => {
  const { frag, doc } = render(userSection(
    'Visit [Example](https://example.com) for [more](mailto:a@b.c).'
  ));
  // No <a> anywhere
  assert.equal(findAllByTag(frag, 'a').length, 0);
  // The literal text is preserved (just not parsed as a link)
  const p = findByTag(frag, 'p');
  assert.match(flattenText(p), /\[Example\]\(https:\/\/example\.com\)/);
  // No href or src attribute on any element
  function walk(n) {
    if (!n) return;
    if (n.attrs && (n.attrs.href !== undefined || n.attrs.src !== undefined)) {
      throw new Error(`unexpected href/src on <${n.tag}>`);
    }
    if (n.children) n.children.forEach(walk);
  }
  walk(frag);
  assertNoUnsafe(doc);
});

test('round-2 m1: image syntax never creates <img>', () => {
  const { frag } = render(userSection('Look: ![alt](https://example.com/a.png)'));
  assert.equal(findAllByTag(frag, 'img').length, 0);
});

test('no unsafe API writes across a mixed document', () => {
  const mixed = [
    userSection('first user **bold** turn with `code`'),
    assistantSection('```js\nlet a = 1;\n```'),
    userSection('- a\n- b\n- c'),
    assistantSection('| a | b |\n| - | - |\n| 1 | 2 |'),
  ].join('\n\n');
  const { doc } = render(mixed);
  assertNoUnsafe(doc);
});
