/* Remark bridge — full Markdown round-trip integration test (headless).

   Exercises the whole bridge: markdown --remark+gfm--> mdast --mdastToPm--> PM
   JSON --pmToMdast--> mdast --remark+gfm--> markdown. Mirrors the
   markdownToDoc/docToMarkdown wiring in tiptap-entry.js (which can't be imported
   in Node — it pulls in Tiptap/DOM — so the thin remark wiring is duplicated).

   Load-bearing assertions:
   - GFM TASK LIST checkbox state survives (tiptap-markdown dropped it).
   - A COMPLEX doc (math + mermaid + raw html + table + tasks) does NOT throw and
     yields a NON-EMPTY doc — the converter half of the blank-editor fix. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';

import MarkdownMdastPm from '../lib/markdown-mdast-pm.js';
const { mdastToPm, pmToMdast } = MarkdownMdastPm;

const parser = unified().use(remarkParse).use(remarkGfm);
const stringifier = unified().use(remarkStringify, {
  bullet: '-', fences: true, listItemIndent: 'one', rule: '-',
}).use(remarkGfm);

const toDoc = (md) => mdastToPm(parser.parse(md));
const toMd = (json) => String(stringifier.stringify(pmToMdast(json)));
const roundtrip = (md) => toMd(toDoc(md));

test('round-trip: GFM task list preserves checkbox state (the tiptap-markdown gap)', () => {
  const out = roundtrip('- [ ] todo\n- [x] done\n');
  assert.match(out, /- \[ \] todo/);
  assert.match(out, /- \[x\] done/);
});

test('round-trip: GFM table survives as a pipe table', () => {
  const out = roundtrip('| Feature | Status |\n| --- | --- |\n| Tables | ok |\n');
  assert.match(out, /\| Feature \| Status \|/);
  assert.match(out, /\| Tables {2}\| ok {5}\|/);
});

test('round-trip: headings keep their level', () => {
  assert.match(roundtrip('## Section\n'), /^## Section$/m);
  assert.match(roundtrip('#### Deep\n'), /^#### Deep$/m);
});

test('round-trip: inline marks (bold/italic/code/strike/link)', () => {
  assert.match(roundtrip('**b**\n'), /\*\*b\*\*/);
  assert.match(roundtrip('*i*\n'), /\*i\*/);
  assert.match(roundtrip('`c`\n'), /`c`/);
  assert.match(roundtrip('~~s~~\n'), /~~s~~/);
  assert.match(roundtrip('[l](https://x)\n'), /\[l\]\(https:\/\/x\)/);
});

test('round-trip: ordered + bullet lists', () => {
  assert.match(roundtrip('- a\n- b\n'), /- a\n- b/);
  assert.match(roundtrip('1. a\n2. b\n'), /1\. a\n2\. b/);
});

test('round-trip: fenced code keeps language + body', () => {
  const out = roundtrip('```js\nconst x = 1;\n```\n');
  assert.match(out, /```js/);
  assert.match(out, /const x = 1;/);
});

test('round-trip: blockquote', () => {
  assert.match(roundtrip('> quoted\n'), /^> quoted$/m);
});

test('blank-fix: a complex doc (math + mermaid + raw html + table + tasks) does NOT throw and yields a non-empty doc', () => {
  const md = [
    '# Title',
    '',
    'Inline math $x^2$ and display:',
    '',
    '$$',
    '\\sum_{i=1}^n i',
    '$$',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
    '',
    '<div class="raw">hello</div>',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
  ].join('\n');
  let doc;
  assert.doesNotThrow(() => { doc = toDoc(md); }, 'conversion must not throw on complex content');
  assert.equal(doc.type, 'doc');
  assert.ok(Array.isArray(doc.content) && doc.content.length > 0, 'doc must be non-empty (never blank)');
  // The raw HTML must be preserved as visible content somewhere, not dropped.
  const flat = JSON.stringify(doc);
  assert.match(flat, /class=\\"raw\\"|class="raw"/, 'raw HTML preserved as visible text');
  // And serializing back must not throw either.
  assert.doesNotThrow(() => toMd(doc));
});

test('blank-fix: empty / whitespace input yields a single-paragraph doc', () => {
  assert.deepEqual(toDoc('').content, [{ type: 'paragraph' }]);
  assert.deepEqual(toDoc('   \n  \n').content, [{ type: 'paragraph' }]);
});

test('round-trip: a mixed document is idempotent on a second pass', () => {
  const md = [
    '# Title', '', 'Para with **bold** and `code`.', '',
    '- [ ] task one', '- [x] task two', '',
    '| A | B |', '| --- | --- |', '| 1 | 2 |', '',
    '> note', '', '```py', 'print(1)', '```', '',
  ].join('\n');
  const first = roundtrip(md);
  assert.equal(roundtrip(first), first, 'round-trip stable after first normalization');
});
