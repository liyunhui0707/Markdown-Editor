import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';

for (const nl of ['\n', '\r\n', '\r']) test(`paragraph range: exact splice, caret and inverse boundary matrix ${JSON.stringify(nl)}`, () => {
  const texts = ['A中😀B', 'Middle.', 'C文😀D'];
  const source = ['---', 'kind: synthetic', '---', '', ...texts.flatMap((s, i) => i ? ['', s] : [s]), '', '```md', 'keep [x]', '```', ''].join(nl);
  const [left, , right] = projectSource(source).spans;
  let accepted = 0;
  for (const a of [0, 1, 2, 4, 5]) for (const b of [0, 1, 2, 4, 5]) for (const insert of ['', '新😀', 'One\n\nTwo']) {
    const change = { from: left.from + a, to: right.from + b, insert };
    const result = mapTextEdit(source, change);
    assert.equal(result.ok, true, JSON.stringify(change)); accepted++;
    assert.equal(result.source, source.slice(0, left.sourceFrom + a) + insert.replaceAll('\n', nl) + source.slice(right.sourceFrom + b));
    assert.deepEqual(result.selection, { from: change.from + insert.length, to: change.from + insert.length });
    const undo = mapTextEdit(result.source, result.inverse, result.leaf, result.paragraphSeparator);
    assert.equal(undo.ok, true); assert.equal(undo.source, source);
    assert.equal(mapTextEdit(undo.source, change, result.leaf, result.paragraphSeparator).source, result.source);
  }
  assert.equal(accepted, 75);
  assert.equal(mapTextEdit(source, { from: left.from + 3, to: right.from, insert: 'x' }).ok, false);
  assert.equal(mapTextEdit(source, { from: left.to, to: right.from + 3, insert: 'x' }).ok, false);
});

test('paragraph range: protected intermediate blocks, soft breaks and ambiguous separators stay atomic refusals', () => {
  for (const middle of ['# Heading', 'A **bold** tail.', '- item', '> quote', '```js\nkeep()\n```', 'soft\nwrapped', '![x](image.png)']) {
    const source = `First.\n\n${middle}\n\nLast.`, spans = projectSource(source).spans;
    const left = spans[0], right = spans.at(-1);
    for (const insert of ['', 'X', 'One\n\nTwo']) assert.equal(mapTextEdit(source, { from: left.from + 1, to: right.from + 1, insert }).ok, false, middle);
    assert.equal(mapTextEdit(source, { from: left.from, to: left.from, insert: 'Safe ' }).ok, true);
  }
  for (const source of ['First.\n \nLast.', 'First.\n\n\nLast.', '# Keep\r\n\r\nFirst.\n\nLast.']) {
    const spans = projectSource(source).spans, left = spans.at(-2), right = spans.at(-1);
    assert.equal(mapTextEdit(source, { from: left.from + 1, to: right.from + 1, insert: 'x' }).ok, false);
  }
});

test('paragraph range: size, paragraph count, syntax and renderer metadata bounds remain enforced', () => {
  for (const source of [Array(33).fill('Text').join('\n\n'), 'A'.repeat(4096) + '\n\nLast.']) {
    const spans = projectSource(source).spans;
    assert.equal(mapTextEdit(source, { from: spans[0].from, to: spans.at(-1).to - 1, insert: 'X' }).ok, false);
  }
  const source = 'First.\n\nLast.', [a, b] = projectSource(source).spans;
  const change = { from: a.from, to: b.to, insert: 'New' };
  for (const insert of ['# Heading', 'A\n\n- list', 'A\n\n', '\n\nA', 'A\n\n\nB', '\ud800', 'X'.repeat(4097)]) {
    assert.equal(mapTextEdit(source, { ...change, insert }).ok, false, JSON.stringify(insert.slice(0, 15)));
  }
  for (const extra of [{ paragraphSeparator: '\n\n' }, { leaf: null }, { path: '/other.md' }]) {
    assert.equal(mapTextEdit(source, { ...change, ...extra }).ok, false);
  }
});
