/* Stage E WAVE 1 — parseTableNode pure function.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-table-parse.test.js

   Tests the pure parser that converts a Lezer Table node + doc into a
   structured {headers, alignments, rows} payload. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-table-widget.js')];
const tableMod = require('../../lib/cm6-lp-table-widget.js');

function makeState(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
}

function findTableNode(state) {
  const tree = syntaxTree(state);
  let found = null;
  tree.iterate({
    enter(n) {
      if (n.name === 'Table' && !found) {
        found = n.node;
      }
    }
  });
  return found;
}

test('Stage E WAVE 1-T-P-1: parses a simple 2-column 2-row table', () => {
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |\n';
  const state = makeState(doc);
  const table = findTableNode(state);
  assert.ok(table, 'Table node must exist');
  const parsed = tableMod.parseTableNode(table, state.doc);
  assert.deepEqual(parsed.headers, ['A', 'B']);
  assert.deepEqual(parsed.alignments, [null, null]);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], ['1', '2']);
});

test('Stage E WAVE 1-T-P-2: parses GFM alignment markers', () => {
  const doc = '| L | C | R |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n';
  const state = makeState(doc);
  const table = findTableNode(state);
  const parsed = tableMod.parseTableNode(table, state.doc);
  assert.deepEqual(parsed.headers, ['L', 'C', 'R']);
  assert.deepEqual(parsed.alignments, ['left', 'center', 'right']);
});

test('Stage E WAVE 1-T-P-3: handles single-column table', () => {
  const doc = '| only |\n|------|\n| a    |\n| b    |\n';
  const state = makeState(doc);
  const table = findTableNode(state);
  const parsed = tableMod.parseTableNode(table, state.doc);
  assert.deepEqual(parsed.headers, ['only']);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], ['a']);
  assert.deepEqual(parsed.rows[1], ['b']);
});

test('Stage E WAVE 1-T-P-4: handles empty cells (preserves empty strings)', () => {
  const doc = '| A | B | C |\n|---|---|---|\n| 1 |   | 3 |\n';
  const state = makeState(doc);
  const table = findTableNode(state);
  const parsed = tableMod.parseTableNode(table, state.doc);
  assert.deepEqual(parsed.rows[0], ['1', '', '3']);
});

test('Stage E WAVE 1-T-P-5: header-only table (no body rows)', () => {
  const doc = '| A | B |\n|---|---|\n';
  const state = makeState(doc);
  const table = findTableNode(state);
  const parsed = tableMod.parseTableNode(table, state.doc);
  assert.deepEqual(parsed.headers, ['A', 'B']);
  assert.equal(parsed.rows.length, 0);
});

test('Stage E WAVE 1-T-P-6: cell content preserved verbatim (no markdown rendering)', () => {
  const doc = '| **bold** | `code` | [link](url) |\n|---|---|---|\n| a | b | c |\n';
  const state = makeState(doc);
  const table = findTableNode(state);
  const parsed = tableMod.parseTableNode(table, state.doc);
  // Cells should contain the LITERAL source, not rendered.
  assert.equal(parsed.headers[0], '**bold**');
  assert.equal(parsed.headers[1], '`code`');
  assert.equal(parsed.headers[2], '[link](url)');
});

test('Stage E WAVE 1-T-P-7: HTML-special chars preserved (escaping happens at widget time)', () => {
  const doc = '| safe | unsafe |\n|---|---|\n| a | <script>alert(1)</script> |\n';
  const state = makeState(doc);
  const table = findTableNode(state);
  const parsed = tableMod.parseTableNode(table, state.doc);
  // Parser returns raw text; escaping is the widget's responsibility.
  assert.equal(parsed.rows[0][1], '<script>alert(1)</script>');
});

test('Stage E WAVE 1-T-P-8: returns null for null/wrong-type node', () => {
  assert.equal(tableMod.parseTableNode(null, null), null);
  assert.equal(tableMod.parseTableNode({ name: 'Paragraph' }, { sliceString: () => '' }), null);
});

test('Stage E WAVE 1-T-P-9: parseAlignmentCell behaviors', () => {
  const p = tableMod._parseAlignmentCell;
  assert.equal(p('---'),   null);
  assert.equal(p(':---'),  'left');
  assert.equal(p('---:'),  'right');
  assert.equal(p(':---:'), 'center');
  assert.equal(p(':--:'),  'center');
  assert.equal(p(''),      null);  // too short
  assert.equal(p('  ---  '), null); // trimmed, still no colons
  assert.equal(p('  :---  '), 'left'); // trimmed
});
