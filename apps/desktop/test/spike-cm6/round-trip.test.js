/* CM6 spike — Markdown round-trip property test.
   The CodeMirror 6 document model treats the buffer as plain text, so a
   setText -> getText cycle must return byte-identical input for any
   Markdown string. This test runs in Node against @codemirror/state
   (no DOM required for state-only operations).

   Run: node --test test/spike-cm6/round-trip.test.js */
'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let EditorState;

before(async () => {
  ({ EditorState } = await import('@codemirror/state'));
});

const CORPUS = [
  '',
  'plain paragraph',
  '# h1\n\n## h2\n\n### h3',
  '- a\n- b\n  - nested\n- c',
  '1. one\n2. two\n3. three',
  '> quote line one\n> quote line two',
  '```js\nconst x = 1;\nconsole.log(x);\n```',
  '**bold** and *italic* and `code` and [link](https://x.test)',
  'paragraph one\n\nparagraph two\n\nparagraph three',
  'trailing newline at end\n',
  'no trailing newline',
  'mixed\n\n# heading mid-doc\n\n- list\n- after heading\n\n```\nfenced\n```\n\nend.',
  '中文段落 with **bold** 和 *italic* mixed.',
  '   leading whitespace and trailing   ',
  '\n\n\nleading blank lines',
  'tab\tinside\tline',
];

function roundTrip(input) {
  const state = EditorState.create({ doc: input });
  return state.doc.toString();
}

for (let i = 0; i < CORPUS.length; i++) {
  const item = CORPUS[i];
  test(`round-trip preserves bytes for corpus item ${i} (len=${item.length})`, () => {
    assert.equal(roundTrip(item), item);
  });
}

test('round-trip preserves a 5,000-line synthetic doc', () => {
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    if (i % 25 === 0) lines.push(`## Section ${i / 25 + 1}`);
    else if (i % 7 === 0) lines.push(`- list item ${i} with **bold** and *italic*`);
    else lines.push(`Line ${i}: the quick brown fox jumps over the lazy dog.`);
  }
  const doc = lines.join('\n');
  assert.equal(roundTrip(doc), doc);
});

test('replaceAll-style transaction also preserves bytes', async () => {
  const original = '# heading\n\nparagraph **bold** end.\n';
  const state = EditorState.create({ doc: 'placeholder' });
  const tr = state.update({
    changes: { from: 0, to: state.doc.length, insert: original },
  });
  assert.equal(tr.state.doc.toString(), original);
});

// ── CRLF line-ending behavior ──────────────────────────────────────────────
// CodeMirror 6 normalizes input line endings to its active line separator.
// Default separator is '\n', so CRLF input is silently converted to LF.
// These tests pin current behavior so a future CM6 bump that changes it
// would surface here. The vault file IO layer already enforces an LF-only
// on-disk policy (per HybridWriteView's existing comment), so for the
// production app this normalization is consistent — see
// docs/stage3-spike-codemirror6.md "Line-ending strategy" for the
// strategy documentation.

test('CRLF input is normalized to LF by default', () => {
  const input = 'a\r\nb\r\n';
  const state = EditorState.create({ doc: input });
  assert.equal(state.doc.toString(), 'a\nb\n');
});

test('mixed CR/LF/CRLF input is normalized to LF by default', () => {
  const input = 'one\r\ntwo\nthree\r\n';
  const state = EditorState.create({ doc: input });
  assert.equal(state.doc.toString(), 'one\ntwo\nthree\n');
});

test('lone CR is also normalized to LF by default', () => {
  // Some legacy editors used CR alone. CM6 normalizes this too.
  const input = 'a\rb\rc';
  const state = EditorState.create({ doc: input });
  assert.equal(state.doc.toString(), 'a\nb\nc');
});

test('explicit lineSeparator facet still normalizes CRLF to LF in storage', async () => {
  const { EditorState: ES } = await import('@codemirror/state');
  const input = 'a\r\nb\r\n';
  const state = ES.create({
    doc: input,
    extensions: [ES.lineSeparator.of('\r\n')],
  });
  // The lineSeparator facet controls how input is split into lines and
  // how the editor reports line breaks for cursor movement — it does NOT
  // change the in-memory storage, which is always LF. Byte preservation
  // of CRLF input is therefore impossible inside CM6's text model.
  // See docs/stage3-spike-codemirror6.md "Line-ending strategy".
  assert.equal(state.doc.toString(), 'a\nb\n');
});
