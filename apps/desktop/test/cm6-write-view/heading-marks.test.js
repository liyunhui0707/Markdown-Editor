/* TDD: Stage 11.4 — heading mark decorations driven by syntaxTree.
   Run: node --test test/cm6-write-view/heading-marks.test.js

   These tests use the REAL CodeMirror state + lang-markdown + view
   packages so the syntax tree is actually built. They exercise the
   pure helper buildHeadingDecorations(state, cm6) — no DOM required. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }       = require('@codemirror/state');
const { Decoration }        = require('@codemirror/view');
const { syntaxTree }        = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');

const { buildHeadingDecorations } = require('../../lib/cm6-hybrid-view');

// Minimal cm6 backend object — only what buildHeadingDecorations consumes.
const cm6 = { Decoration, syntaxTree };

function makeState(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
  });
}

// Collect every mark range from a DecorationSet as { from, to, class }.
function collectMarks(decorationSet) {
  const out = [];
  const cursor = decorationSet.iter();
  while (cursor.value) {
    const cls = cursor.value.spec && cursor.value.spec.class;
    out.push({ from: cursor.from, to: cursor.to, class: cls });
    cursor.next();
  }
  return out;
}

// ── Required tests 1–7: syntaxTree-driven heading marks ─────────────────────

test('1. empty doc produces no heading marks', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState(''), cm6));
  assert.equal(marks.length, 0);
});

test('2. plain text produces no heading marks', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('just some text\nmore text'), cm6));
  assert.equal(marks.length, 0);
});

test('3. "# Hello" produces cm-md-h1 and cm-md-heading-mark', () => {
  // "# Hello" — HeaderMark covers the "#" at [0,1]; heading node spans [0,7].
  const marks = collectMarks(buildHeadingDecorations(makeState('# Hello'), cm6));
  const h1   = marks.find((r) => r.class === 'cm-md-h1');
  const mark = marks.find((r) => r.class === 'cm-md-heading-mark');
  assert.ok(h1,   'cm-md-h1 mark exists');
  assert.ok(mark, 'cm-md-heading-mark exists');
  assert.equal(h1.from,   0);
  assert.equal(h1.to,     7);
  assert.equal(mark.from, 0);
  assert.equal(mark.to,   1, 'HeaderMark covers only the "#" character');
});

test('4. "## Hello" produces cm-md-h2 and cm-md-heading-mark', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('## Hello'), cm6));
  const h2   = marks.find((r) => r.class === 'cm-md-h2');
  const mark = marks.find((r) => r.class === 'cm-md-heading-mark');
  assert.ok(h2,   'cm-md-h2 mark exists');
  assert.ok(mark, 'cm-md-heading-mark exists');
  assert.equal(h2.from, 0);
  assert.equal(h2.to,   8);
  assert.equal(mark.to - mark.from, 2, 'HeaderMark covers the "##" run');
});

test('5. h1–h6 are all detected', () => {
  const doc = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  for (let n = 1; n <= 6; n++) {
    assert.ok(marks.some((m) => m.class === 'cm-md-h' + n), 'cm-md-h' + n + ' present');
  }
  // One HeaderMark per heading.
  const headerMarks = marks.filter((m) => m.class === 'cm-md-heading-mark');
  assert.equal(headerMarks.length, 6, 'six HeaderMark ranges, one per heading');
});

test('6. "#nospace" is NOT a heading (parser, not regex)', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('#nospace\nbody'), cm6));
  assert.equal(marks.length, 0, 'no heading marks emitted for "#nospace"');
});

test('7. heading + paragraph + subheading marks only the headings', () => {
  const doc = '# Heading\n\nsome paragraph\n\n## Sub';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const headingClasses = marks.map((m) => m.class).filter((c) => /^cm-md-h\d$/.test(c));
  assert.deepEqual(headingClasses, ['cm-md-h1', 'cm-md-h2'], 'two heading-level marks');
  // Paragraph text gets no marks at all.
  assert.ok(!marks.some((m) => m.from >= 11 && m.to <= 25),
    'no marks emitted within the paragraph range');
});
