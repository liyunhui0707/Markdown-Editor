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
import remarkMath from 'remark-math';

import MarkdownMdastPm from '../lib/markdown-mdast-pm.js';
const { mdastToPm, pmToMdast } = MarkdownMdastPm;

import MarkdownFrontmatter from '../lib/markdown-frontmatter.js';
const { splitFrontmatter, joinFrontmatter } = MarkdownFrontmatter;

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const stringifier = unified().use(remarkStringify, {
  bullet: '-', fences: true, listItemIndent: 'one', rule: '-',
}).use(remarkGfm).use(remarkMath);

// Pass the source so the converter can preserve verbatim the constructs it
// doesn't richly map (raw HTML, reference links/footnotes) — same as the app's
// markdownToDoc(md) -> mdastToPm(tree, md).
const toDoc = (md) => mdastToPm(parser.parse(md), md);
const toMd = (json) => String(stringifier.stringify(pmToMdast(json)));
const roundtrip = (md) => toMd(toDoc(md));

test('round-trip: GFM task list preserves checkbox state (the tiptap-markdown gap)', () => {
  const out = roundtrip('- [ ] todo\n- [x] done\n');
  assert.match(out, /- \[ \] todo/);
  assert.match(out, /- \[x\] done/);
});

// ── Mixed task/plain lists must NOT inject a checkbox into the plain bullets ──
// Assert on the PARSED output (the source-of-truth re-parse), which is robust to
// remark's marker/blank-line normalization, plus a line-anchored regex guard.
const flatListItems = (md) => {
  const out = [];
  const walk = (n) => { if (n.type === 'listItem') out.push(n); (n.children || []).forEach(walk); };
  parser.parse(md).children.forEach(walk);
  return out;
};
const itemText = (li) => {
  let s = '';
  // Own text only — do NOT descend into a nested list, or a parent item would also
  // "contain" its children's text and over-match.
  const walk = (n) => {
    if (n.type === 'list') return;
    if (n.type === 'text') s += n.value;
    (n.children || []).forEach(walk);
  };
  (li.children || []).forEach(walk);
  return s;
};
const checkedOf = (md, needle) => flatListItems(md).filter((li) => itemText(li).includes(needle)).map((li) => li.checked);

test('round-trip: a MIXED task/plain list does NOT inject a checkbox into the plain bullet', () => {
  const out = roundtrip('- [ ] task one\n- plain note\n- [x] task two\n');
  assert.deepEqual(checkedOf(out, 'plain note'), [null], 'plain item stays non-task (checked null)');
  assert.deepEqual(checkedOf(out, 'task one'), [false], 'task state preserved');
  assert.deepEqual(checkedOf(out, 'task two'), [true]);
  assert.doesNotMatch(out, /^[-*+] \[[ xX]\] plain note$/m, 'no checkbox marker injected');
  assert.equal(roundtrip(out), out, 'idempotent');
});

test('round-trip: ordered list with a task item keeps the plain item plain (no checkbox)', () => {
  const out = roundtrip('1. plain note\n2. [ ] task\n');
  assert.deepEqual(checkedOf(out, 'plain note'), [null]);
  assert.doesNotMatch(out, /^\d+\. \[[ xX]\] plain note$/m);
});

test('round-trip: ordered MIXED list with a non-1 start preserves numbering', () => {
  const out = roundtrip('3. plain alpha\n4. [ ] task\n5. plain beta\n');
  assert.deepEqual(checkedOf(out, 'plain alpha'), [null]);
  assert.deepEqual(checkedOf(out, 'plain beta'), [null]);
  assert.match(out, /^5\. plain beta$/m, 'numbering continues after the task run');
  assert.equal(roundtrip(out), out, 'idempotent');
});

test('round-trip: a NESTED mixed list keeps its plain child plain', () => {
  const out = roundtrip('- parent\n\n  - [ ] sub task\n  - sub plain\n');
  assert.deepEqual(checkedOf(out, 'sub plain'), [null], 'nested plain child must not gain a checkbox');
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

test('mermaid: a ```mermaid block round-trips as a ```mermaid block (not mangled)', () => {
  const out = roundtrip('```mermaid\ngraph TD; A-->B;\n```\n');
  assert.match(out, /```mermaid/);
  assert.match(out, /graph TD; A-->B;/);
  // and a regular code block is NOT treated as mermaid
  assert.match(roundtrip('```js\nx;\n```\n'), /```js/);
});

test('round-trip: blockquote', () => {
  assert.match(roundtrip('> quoted\n'), /^> quoted$/m);
});

test('math: inline + display LaTeX round-trip WITHOUT escaping (the corruption fix)', () => {
  // Before remark-math, `$$\sum_{i=1}^n$$` round-tripped as `\sum\_{i=1}^n`
  // (remark escaped `_`), corrupting the LaTeX. Math nodes preserve it verbatim.
  const inline = roundtrip('Mass is $E = mc^2$ and $a_b$ here.\n');
  assert.match(inline, /\$E = mc\^2\$/);
  assert.match(inline, /\$a_b\$/);            // underscore NOT escaped
  assert.doesNotMatch(inline, /a\\_b/, 'inline math underscore must not be escaped');

  const display = roundtrip('$$\n\\sum_{i=1}^n i\n$$\n');
  assert.match(display, /\\sum_\{i=1\}\^n i/);  // subscript intact
  assert.doesNotMatch(display, /\\sum\\_/, 'display math underscore must not be escaped');
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

// Mirrors tiptap-entry.js getText/setText: frontmatter is split off, the body
// round-trips through remark, and the frontmatter is reattached verbatim.
const engineRoundtrip = (md) => {
  const { frontmatter, body } = splitFrontmatter(md);
  return joinFrontmatter(frontmatter, roundtrip(body));
};

test('frontmatter: YAML metadata is preserved byte-for-byte while the body round-trips', () => {
  const md = '---\ntitle: Kitchen Sink\ntags:\n  - qa\n  - wysiwyg\n---\n\n# Body\n\n- [ ] a\n- [x] b\n';
  const out = engineRoundtrip(md);
  assert.ok(
    out.startsWith('---\ntitle: Kitchen Sink\ntags:\n  - qa\n  - wysiwyg\n---'),
    'frontmatter YAML must be intact (not reflowed like remark would)',
  );
  assert.match(out, /- \[ \] a/, 'body task survives');
  assert.match(out, /- \[x\] b/);
});

test('frontmatter: a note without frontmatter is unaffected', () => {
  const md = '# Just a body\n\ntext\n';
  const out = engineRoundtrip(md);
  assert.doesNotMatch(out, /^---/, 'no spurious frontmatter added');
  assert.match(out, /# Just a body/);
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

// ── Data-loss fix: verbatim passthrough of constructs the bridge can't map ───
// Each asserts the construct (and its URL) SURVIVES the round-trip (not
// byte-identity — remark may normalize whitespace) AND the round-trip is
// idempotent. All four were lost/escaped before the verbatim-passthrough fix.

test('round-trip: inline raw HTML survives (not escaped)', () => {
  const out = roundtrip('Press <kbd>Cmd</kbd> now.\n');
  assert.match(out, /<kbd>Cmd<\/kbd>/, 'inline html preserved verbatim');
  assert.doesNotMatch(out, /\\</, 'must not be backslash-escaped');
  assert.equal(roundtrip(out), out, 'idempotent');
});

test('round-trip: block raw HTML survives (not escaped)', () => {
  const out = roundtrip('<div class="x">raw block</div>\n');
  assert.match(out, /<div class="x">raw block<\/div>/);
  assert.equal(roundtrip(out), out, 'idempotent');
});

test('round-trip: reference link keeps its URL (was lost entirely)', () => {
  const out = roundtrip('A [ref link][r] here.\n\n[r]: https://example.com\n');
  assert.match(out, /\[ref link\]\[r\]/, 'reference link syntax preserved');
  assert.match(out, /\[r\]:\s*https:\/\/example\.com/, 'definition + URL preserved');
  assert.equal(roundtrip(out), out, 'idempotent');
});

test('round-trip: footnote reference + definition survive (was dropped)', () => {
  const out = roundtrip('Text with a footnote.[^1]\n\n[^1]: the note.\n');
  assert.match(out, /\[\^1\]/, 'footnote marker preserved');
  assert.match(out, /\[\^1\]:\s*the note\./, 'footnote definition preserved');
  assert.equal(roundtrip(out), out, 'idempotent');
});

test('round-trip: bold-wrapped reference link keeps BOTH bold and URL', () => {
  const out = roundtrip('A **[x][r]** bold ref.\n\n[r]: https://e.com\n');
  assert.match(out, /\*\*\[x\]\[r\]\*\*/, 'bold mark preserved around the raw ref');
  assert.match(out, /https:\/\/e\.com/, 'URL preserved');
  assert.equal(roundtrip(out), out, 'idempotent');
});

test('round-trip: CJK reference link + CJK URL preserved', () => {
  const out = roundtrip('中文 [链接][r] 文字\n\n[r]: https://e.com/路径\n');
  assert.match(out, /\[链接\]\[r\]/);
  assert.match(out, /https:\/\/e\.com\/路径/);
  assert.equal(roundtrip(out), out, 'idempotent');
});
