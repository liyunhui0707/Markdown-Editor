import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
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
test('HTML, images, tables, unknown syntax, escaped/entities and unsupported multiline syntax are not editable', () => {
  for (const s of ['<script>synthetic</script>', '![p](../x.png)', '| a |\n| - |\n| b |', '::: unknown', 'a &amp; b', 'a\\*b', 'one  \ntwo']) {
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


test('writing V1: one whitespace cursor slot is explicit and standard Markdown reparsing does not invent empty nodes', () => {
  for (const nl of ['\n','\r\n']) {
    const source='first'+nl+nl+nl+nl+'second'+nl;
    const p=projectSource(source),empty=p.spans.find(s=>!s.text);
    assert.ok(empty); assert.equal(p.doc.content.length,3);
    assert.equal(unified().use(remarkParse).parse(source).children.length,2); // Markdown has no semantic empty paragraph here.
    assert.equal(source.slice(empty.sourceFrom,empty.sourceTo),'');
    const typed=mapTextEdit(source,{from:empty.from,to:empty.from,insert:'新😀'});
    assert.equal(typed.ok,true);assert.equal(typed.source,'first'+nl+nl+'新😀'+nl+nl+'second'+nl);
    assert.equal(unified().use(remarkParse).parse(typed.source).children.length,3);
    assert.equal(mapTextEdit(source,{from:empty.from,to:empty.from,insert:'\n\n'}).ok,false);
  }
  assert.equal(projectSource('\n\n').spans.length,0); // ambiguous blank-only files are not silently rewritten
});

test('writing V1: split/join inverses protect mixed line endings and unsupported Markdown structures', () => {
  const source='# Heading\r\n\r\none\n\ntwo\n',p=projectSource(source),one=p.spans.find(s=>s.text==='one'),two=p.spans.find(s=>s.text==='two');
  assert.equal(mapTextEdit(source,{from:one.to,to:two.from,insert:''}).ok,false); // inverse would use a different delimiter
  const split=mapTextEdit(source,{from:one.from+1,to:one.from+1,insert:'\n\n'});
  assert.equal(split.ok,true);
  const back=mapTextEdit(split.source,split.inverse);assert.equal(back.ok,true);assert.equal(back.source,source);
  for(const text of ['# heading','- list','> quote','```\ncode\n```','A **bold** end.']){
    const q=projectSource(text),s=q.spans.find(s=>s.text);
    assert.equal(mapTextEdit(text,{from:s?.from||1,to:s?.from||1,insert:'\n\n'}).ok,false);
  }
});


for (const nl of ['\r\n','\n']) test(`CRLF P1: inverse uses the exact removed separator after the last newline is gone (${JSON.stringify(nl)})`, () => {
  const source='first'+nl+nl+'second',p=projectSource(source),left=p.spans[0],right=p.spans[1];
  const joined=mapTextEdit(source,{from:left.to,to:right.from,insert:''});
  assert.equal(joined.ok,true);assert.equal(joined.source,'firstsecond');
  assert.equal(joined.paragraphSeparator,nl+nl);
  for(const invalid of ['\r\n','unsafe',{},'\n\n\n']) assert.equal(mapTextEdit(joined.source,joined.inverse,null,invalid).ok,false);
  const undo=mapTextEdit(joined.source,joined.inverse,joined.leaf,joined.paragraphSeparator);
  assert.equal(undo.ok,true);assert.equal(undo.source,source);
  const redo=mapTextEdit(undo.source,undo.inverse,undo.leaf,undo.paragraphSeparator);
  assert.equal(redo.ok,true);assert.equal(redo.source,'firstsecond');
});


for (const breaks of [['\n', '\n'], ['\r\n', '\r\n'], ['\r\n', '\n']]) {
  test(`soft paragraph V1: rendered spaces retain exact source ranges ${JSON.stringify(breaks)}`, () => {
    const raw = 'First 中文😀' + breaks[0] + 'second e\u0301 👩‍💻' + breaks[1] + 'third.';
    const source = '---\r\nkind: synthetic\r\n---\r\n\r\n' + raw + '\r\n\r\n![x](../x.png)';
    const p = projectSource(source), [first, second, third] = p.spans;
    assert.equal(p.spans.length, 3);
    assert.deepEqual(p.doc.content[1], { type: 'paragraph', content: [{ type: 'text', text: 'First 中文😀 second e\u0301 👩‍💻 third.' }] });
    for (const span of [first, second, third]) {
      assert.equal(source.slice(span.sourceFrom, span.sourceTo), span.text);
      const change = { from: span.from + 1, to: span.from + 2, insert: '新😀' };
      const edited = mapTextEdit(source, change);
      assert.equal(edited.ok, true);
      assert.equal(edited.source, source.slice(0, span.sourceFrom + 1) + '新😀' + source.slice(span.sourceFrom + 2));
      const undo = mapTextEdit(edited.source, { from: change.from, to: change.from + 3, insert: span.text.slice(1, 2) }, edited.leaf);
      assert.equal(undo.ok, true); assert.equal(undo.source, source);
      assert.equal(mapTextEdit(undo.source, change, edited.leaf).source, edited.source);
    }
    assert.equal(second.from - first.to, 1); assert.equal(third.from - second.to, 1);
  });
}
test('soft paragraph V1: soft-break deletion, crossing, structural edits and UTF-16 splits fail closed', () => {
  const source = 'First 😀\r\nsecond.\n\nLast.', p = projectSource(source), [a,b,last] = p.spans;
  assert.equal(p.spans.length, 3);
  for (const edit of [
    { from:a.to,to:b.from,insert:'' }, { from:a.to-1,to:b.from+1,insert:'X' },
    { from:a.from,to:a.from,insert:'\n\n' }, { from:b.to,to:last.from,insert:'' },
    { from:b.from,to:b.to,insert:'' }, { from:a.to-1,to:a.to,insert:'X' },
    { from:b.from,to:b.from,insert:'\ud800' }, { from:b.from,to:b.from,insert:'- ' },
  ]) assert.equal(mapTextEdit(source, edit).ok, false, JSON.stringify(edit));
  for (const at of [a.from,a.to,b.from,b.to]) assert.equal(mapTextEdit(source,{from:at,to:at,insert:'字'}).ok,true);
});
test('soft paragraph V1: no new support for hard breaks, indents, markup or transformed entities', () => {
  for (const source of ['one  \ntwo','one\\\ntwo','one\n two','one\n\ttwo','one\n**two**','one\n*two*','one\n&amp;','one\n<script>x</script>']) {
    assert.equal(projectSource(source).spans.some(s => s.text.includes('one') && s.textOffset !== undefined), false, source);
  }
});


for (const nl of ['\n', '\r\n', '\r']) test(`multiline paste V1: atomic source splice and exact history (${JSON.stringify(nl)})`, () => {
  const source = ['---', 'x: keep', '---', '', 'Before OLD after.', '', '```js', 'opaque()', '```'].join(nl);
  const span = projectSource(source).spans.find(s => s.text === 'Before OLD after.');
  const change = { from: span.from + 7, to: span.from + 10, insert: '第一😀\n\nSecond\n\n第三' };
  const r = mapTextEdit(source, change);
  assert.equal(r.ok, true); assert.equal(r.source, source.replace('OLD', change.insert.replaceAll('\n', nl)));
  assert.equal(r.selection.from, change.from + change.insert.length);
  assert.equal(r.paragraphSeparator, nl + nl);
  const back = mapTextEdit(r.source, r.inverse, r.leaf, r.paragraphSeparator);
  assert.equal(back.ok, true); assert.equal(back.source, source);
  const redo = mapTextEdit(back.source, change, r.leaf, r.paragraphSeparator);
  assert.equal(redo.source, r.source);
  assert.equal(mapTextEdit(r.source, r.inverse).ok, false, 'cross-paragraph inverse is history-only');
});
test('multiline paste V1: empty slots preserve terminal newline and surrounding source', () => {
  for (const source of ['', '\n', '\n\nTail.', 'Before.\r\n\r\n']) {
    const slot = projectSource(source).spans.find(s => s.text === ''); assert.ok(slot);
    const r = mapTextEdit(source, { from: slot.from, to: slot.to, insert: 'One\n\nTwo😀' });
    assert.equal(r.ok, true, JSON.stringify(source));
    assert.equal(mapTextEdit(r.source, r.inverse, r.leaf, r.paragraphSeparator).source, source);
  }
});
test('multiline paste V1: forbidden structure, ambiguous whitespace and untrusted cross-block edits reject atomically', () => {
  for (const source of ['# Heading', 'A **bold** tail.', 'soft\nwrapped', '```\ncode\n```']) {
    const span = projectSource(source).spans[0];
    assert.equal(mapTextEdit(source, { from: span?.from || 1, to: span?.from || 1, insert: 'One\n\nTwo' }).ok, false);
  }
  for (const insert of ['One\nTwo', 'One\n\n\nTwo', '\n\nOne', 'One\n\n', 'One\n\n# Heading', 'One\n\n- list', 'One\n\n<iframe>', 'One\n\n\ud800']) {
    assert.equal(mapTextEdit('Normal.', { from: 2, to: 2, insert }).ok, false, JSON.stringify(insert));
  }
  const source = 'First.\n\nSecond.', spans = projectSource(source).spans;
  assert.equal(mapTextEdit(source, { from: spans[0].from + 1, to: spans[1].from + 1, insert: 'One\n\nTwo' }).ok, false);
});


test('multiline paste V1: boundary matrix preserves bytes and UTF-16 with reversible range replacement', () => {
  let accepted = 0;
  for (const nl of ['\n', '\r\n', '\r']) for (const text of ['abcd', '中😀文', 'é text']) {
    const source = ['# Keep', '', text, '', 'tail.'].join(nl), span = projectSource(source).spans.find(s => s.text === text);
    for (let a = 0; a <= text.length; a++) for (let b = a; b <= text.length; b++) {
      const change = { from: span.from + a, to: span.from + b, insert: '新😀\n\nnext' }, r = mapTextEdit(source, change);
      if (!r.ok) continue;
      accepted++;
      assert.equal(r.source, source.slice(0, span.sourceFrom + a) + '新😀' + nl + nl + 'next' + source.slice(span.sourceFrom + b));
      const undo = mapTextEdit(r.source, r.inverse, r.leaf, r.paragraphSeparator);
      assert.equal(undo.ok, true); assert.equal(undo.source, source);
      assert.equal(mapTextEdit(undo.source, change, r.leaf, r.paragraphSeparator).source, r.source);
    }
  }
  assert.ok(accepted > 100);
});


for (const nl of ['\n', '\r\n']) test(`literal brackets: exact text editing and structural refusal (${JSON.stringify(nl)})`, () => {
  const original = ['---', 'kind: synthetic', '---', '', 'First 中文😀.', 'second line.', '', '```md', '[opaque](target)', '```'].join(nl);
  let current = original;
  const changes = [];
  for (const insert of ['[', ' ', ']']) {
    const span = projectSource(current).spans.find(s => s.text.startsWith('First'));
    assert.ok(span);
    const at = span.to - 1; // Keep the soft line's final punctuation; trailing-space edits are a separate restriction.
    const r = mapTextEdit(current, { from: at, to: at, insert });
    assert.equal(r.ok, true, insert);
    changes.push({ from: at, to: at + insert.length, insert: '', leaf: r.leaf });
    current = r.source;
  }
  assert.equal(current, original.replace('First 中文😀.', 'First 中文😀[ ].'));
  for (const { leaf, ...change } of changes.reverse()) current = mapTextEdit(current, change, leaf).source;
  assert.equal(current, original);
  for (const text of ['[ ]', '[label]', 'before ] after', '# [title]']) assert.ok(projectSource(text).spans.length, text);
  for (const text of ['[label](https://example.invalid)', '[label]\n\n[label]: /target', '![x](file.png)', '- [ ] task']) {
    assert.equal(projectSource(text).spans.length, 0, text);
  }
  assert.equal(mapTextEdit('[label]', { from: 8, to: 8, insert: '(target)' }).ok, false);
  // A definition elsewhere must not silently turn text into a reference link.
  const referenced = '[label\n\n[label]: /target';
  assert.equal(mapTextEdit(referenced, { from: 7, to: 7, insert: ']' }).ok, false);
});
