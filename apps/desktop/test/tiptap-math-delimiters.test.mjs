import test from 'node:test';
import assert from 'node:assert/strict';
import { toBodyDoc, toBodyMarkdown, engineRoundtrip, assertReopenSafe } from './helpers/tiptap-roundtrip-harness.mjs';

function mathValues(doc, type = 'inlineMath') {
  const values = [];
  function visit(node) {
    if (node.type === type) values.push(node.attrs.latex);
    for (const child of node.content || []) visit(child);
  }
  visit(doc);
  return values;
}
function check(source, expected) {
  assert.deepEqual(mathValues(toBodyDoc(source)), expected);
  const saved = engineRoundtrip(source);
  assert.deepEqual(mathValues(toBodyDoc(saved)), expected, 'save/reopen preserves math meaning');
  assert.equal(engineRoundtrip(saved), saved, 'normalization is stable');
  assertReopenSafe(saved);
  return saved;
}

test('currency before math stays text and leaves the intended formula intact', () => {
  const saved = check('The price is $5, while inline math is $a_b + c^2$.', ['a_b + c^2']);
  assert.equal(saved, 'The price is \\$5, while inline math is $a_b + c^2$.\n');
});

test('two prices do not become a formula', () => {
  const saved = check('Prices are $5 and $10.', []);
  assert.equal(saved, 'Prices are \\$5 and \\$10.\n');
});

test('numeric formulas, internal spaces and punctuation remain supported', () => {
  check('Value $5$, equation $2x + 1$, and ($a_b + c^2$).', ['5', '2x + 1', 'a_b + c^2']);
});

for (const source of ['$ x$', '$x $', '$ x $', '$\tx$', '$x\t$', '$\nx$', '$x\n$', '$\u00a0x$', '$x\u00a0$', '$x$2']) {
  test(`invalid single-dollar boundary stays literal: ${JSON.stringify(source)}`, () => check(source, []));
}

test('rejected pair does not swallow a later valid formula', () => {
  check('Prices $5 and $10; formula $x + 1$.', ['x + 1']);
  check('Literal $ x $; formula $y$.', ['y']);
});

test('escaped dollars, code, links and raw HTML are not scanned as prose math', () => {
  const source = String.raw`Price \$5 and $x$; code \`$not_math$\`; [link](https://example.com/$5).

\`\`\`text
$not_math$
\`\`\`

<div data-price="$5">$literal$</div>`;
  // Use real Markdown backticks rather than template-literal escaping artifacts.
  const markdown = source.replaceAll('\\`', '`');
  const saved = check(markdown, ['x']);
  const link = toBodyDoc(saved).content[0].content.find(node => node.text === 'link');
  assert.equal(link.marks[0].attrs.href, 'https://example.com/$5');
  assert.ok(saved.includes('<div data-price="$5">$literal$</div>'));
  assert.ok(saved.includes('$not_math$'));
});

test('display math and multiple-dollar inline delimiters keep existing behavior', () => {
  const source = 'Inline $$ x $$, $$ x$$, and $$x $$.\n\n$$\n\\sum_{i=1}^n i\n$$';
  const saved = check(source, ['x', ' x', 'x ']);
  assert.deepEqual(mathValues(toBodyDoc(saved), 'mathBlock'), ['\\sum_{i=1}^n i']);
});

test('formula followed by a digit serializes with a safe fence', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'inlineMath', attrs: { latex: 'x' } }, { type: 'text', text: '2' },
  ] }] };
  const saved = toBodyMarkdown(doc);
  assert.match(saved, /^\$\$x\$\$2/);
  assert.deepEqual(mathValues(toBodyDoc(saved)), ['x']);
  assert.equal(engineRoundtrip(saved), saved);
});

test('tables, emphasis and frontmatter retain the same math boundary', () => {
  check('**Price $5 and formula $x$.**\n\n| Price | Math |\n| - | - |\n| $5 | $y$ |', ['x', 'y']);
  const fm = '---\ntitle: "$5 and $x$"\n---\n';
  assert.ok(engineRoundtrip(fm + '\nPrice $5 and formula $x$.').startsWith(fm));
});

test('safe serialization preserves whitespace and embedded dollar runs in math atoms', () => {
  for (const latex of ['x', '5', ' x', 'x ', ' x ', '$x', 'x$', 'a$$b', ' $x$ ']) {
    for (const following of ['2', '.']) {
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Formula: ' },
        { type: 'inlineMath', attrs: { latex } }, { type: 'text', text: following },
      ] }] };
      const saved = toBodyMarkdown(doc);
      assert.deepEqual(mathValues(toBodyDoc(saved)), [latex], JSON.stringify({ latex, following, saved }));
      assert.equal(engineRoundtrip(saved), saved);
    }
  }
});
