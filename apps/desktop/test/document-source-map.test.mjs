import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';

const source = '---\r\nprivate: synthetic\r\n---\r\n# 标题😀\r\n\r\nA **粗体中文** end.\r\n\r\n![pic](../assets/x.png)\r\n\r\n| x | y |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\n::: unknown\r\n';
test('headings, paragraphs and bold get exact UTF-16 source spans; unsupported blocks stay opaque', () => {
  const p = projectSource(source);
  assert.equal(p.spans.length, 4);
  assert.deepEqual(p.spans.map(s => source.slice(s.sourceFrom, s.sourceTo)), ['标题😀', 'A ', '粗体中文', ' end.']);
  assert(p.doc.content.some(n => n.type === 'codeBlock'));
  assert.equal(p.spans[0].sourceTo - p.spans[0].sourceFrom, 4);
});
for (const text of ['标题😀', 'A ', '粗体中文', ' end.']) {
  test(`range splice preserves every untouched source code unit: ${text}`, () => {
    const span = projectSource(source).spans.find(s => s.text === text);
    const r = mapTextEdit(source, { from: span.from, to: span.to, insert: '新文😀' });
    assert.equal(r.ok, true);
    assert.equal(r.source, source.slice(0, span.sourceFrom) + '新文😀' + source.slice(span.sourceTo));
    assert.equal(r.source.includes('../assets/x.png'), true);
    assert.equal(r.source.includes('private: synthetic\r\n'), true);
    assert.deepEqual(projectSource(r.source).doc, r.projection.doc);
  });
}
test('surrogate splitting, mark crossing, structural syntax and empty formatted text fail closed', () => {
  const spans = projectSource(source).spans;
  const h = spans[0], bold = spans[2];
  for (const change of [
    { from: h.to - 1, to: h.to, insert: 'x' },
    { from: spans[1].from, to: bold.to, insert: 'x' },
    { from: bold.from, to: bold.to, insert: '' },
    { from: bold.from, to: bold.to, insert: '**new**' },
    { from: h.from, to: h.to, insert: 'line\nbreak' },
    { from: bold.from, to: bold.from, insert: 'x' }, // ambiguous mark boundary
  ]) assert.equal(mapTextEdit(source, change).ok, false);
});
test('HTML, images, tables, unknown syntax, escaped/entities and multiline paragraphs are not editable', () => {
  for (const s of ['<script>synthetic</script>', '![p](../x.png)', '| a |\n| - |\n| b |', '::: unknown', 'a &amp; b', 'a\\*b', 'one\ntwo']) {
    assert.equal(projectSource(s).spans.length, 0, s);
    assert.equal(mapTextEdit(s, { from: 1, to: 2, insert: 'x' }).ok, false);
  }
});
test('invalid payloads and UTF-16 inserts are rejected without coercion', () => {
  for (const change of [null, {}, { from: 1, to: 2, insert: '\ud800' }, { from: 1, to: 2, insert: 'x', path: '/x.md' }]) {
    assert.equal(mapTextEdit('plain', change).ok, false);
  }
});
test('combining characters and ZWJ emoji keep UTF-16 source positions without normalization', () => {
  const s = '# e\u0301 👩‍💻 中文\r\n', p = projectSource(s).spans[0];
  const r = mapTextEdit(s, { from: p.from, to: p.to, insert: 'é 👨‍💻 新文' });
  assert.equal(r.ok, true); assert.equal(r.source, '# é 👨‍💻 新文\r\n');
});
test('source-size limit rejects expansion as an ordinary unsafe edit', () => {
  const s = 'a'.repeat(131070), p = projectSource(s).spans[0];
  assert.equal(mapTextEdit(s, { from: p.from + 1, to: p.from + 1, insert: 'xxxx' }).ok, false);
});

test('P1-2: only an explicit trusted leaf identity resolves an inverse mark-boundary insertion', () => {
  const bold = projectSource(source).spans.find(s => s.bold);
  const deleted = mapTextEdit(source, { from: bold.from, to: bold.from + 1, insert: '' });
  const point = { from: bold.from, to: bold.from, insert: '粗' };
  assert.equal(mapTextEdit(deleted.source, point).ok, false);
  const leaf = { blockIndex: bold.blockIndex, childIndex: bold.childIndex, bold: true };
  const restored = mapTextEdit(deleted.source, point, leaf);
  assert.equal(restored.ok, true); assert.equal(restored.source, source);
  assert.equal(mapTextEdit(deleted.source, point, { ...leaf, bold: false }).ok, false);
  assert.equal(mapTextEdit(deleted.source, { ...point, leaf }).ok, false);
  assert.equal(mapTextEdit(deleted.source, { ...point, insert: '\ud800' }, leaf).ok, false);
});
