/* TDD: Stage 11.4 + 11.5 — live-style mark decorations driven by syntaxTree.
   Run: node --test test/cm6-write-view/heading-marks.test.js

   These tests use the REAL CodeMirror state + lang-markdown + view
   packages so the syntax tree is actually built. They exercise the
   pure helper buildHeadingDecorations(state, cm6) — no DOM required.

   Stage 11.4 covers: ATX headings (h1–h6) + HeaderMark.
   Stage 11.5 adds:   StrongEmphasis / Emphasis / InlineCode and their marks. */
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

// ── Required tests 8–14: Stage 11.5 inline live styling ─────────────────────
// Each emphasis/code marker class includes the shared "cm-md-syntax" base so
// the same hide/reveal CSS rule covers all of them.
function hasClassToken(cls, token) {
  return typeof cls === 'string' && cls.split(/\s+/).includes(token);
}

test('8. "**bold**" produces cm-md-bold and two emphasis-mark ranges', () => {
  const doc = '**bold**';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const bold = marks.find((m) => m.class === 'cm-md-bold');
  assert.ok(bold, 'cm-md-bold mark exists');
  assert.equal(bold.from, 0);
  assert.equal(bold.to,   8);
  const emMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-emphasis-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(emMarks.length, 2, 'two emphasis markers — opening and closing **');
  assert.deepEqual(emMarks.map((m) => m.to - m.from), [2, 2], 'each marker covers "**"');
});

test('9. "*italic*" produces cm-md-italic and two emphasis-mark ranges', () => {
  const doc = '*italic*';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const italic = marks.find((m) => m.class === 'cm-md-italic');
  assert.ok(italic, 'cm-md-italic mark exists');
  assert.equal(italic.from, 0);
  assert.equal(italic.to,   8);
  const emMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-emphasis-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(emMarks.length, 2);
  assert.deepEqual(emMarks.map((m) => m.to - m.from), [1, 1], 'each marker covers "*"');
});

test('10. "_italic_" produces cm-md-italic and two emphasis-mark ranges', () => {
  // Parser unifies _italic_ and *italic* under the same Emphasis node.
  const doc = '_italic_';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const italic = marks.find((m) => m.class === 'cm-md-italic');
  assert.ok(italic, 'cm-md-italic mark exists for underscore form');
  assert.equal(italic.from, 0);
  assert.equal(italic.to,   8);
  const emMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-emphasis-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(emMarks.length, 2);
  assert.deepEqual(emMarks.map((m) => m.to - m.from), [1, 1], 'each marker covers "_"');
});

test('11. "`code`" produces cm-md-inline-code and two code-mark ranges', () => {
  const doc = '`code`';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const code = marks.find((m) => m.class === 'cm-md-inline-code');
  assert.ok(code, 'cm-md-inline-code mark exists');
  assert.equal(code.from, 0);
  assert.equal(code.to,   6);
  const codeMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-code-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(codeMarks.length, 2);
  assert.deepEqual(codeMarks.map((m) => m.to - m.from), [1, 1], 'each backtick is a 1-char marker');
});

test('12. plain text produces no inline-styling marks', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('just plain text here'), cm6));
  for (const m of marks) {
    assert.ok(!hasClassToken(m.class, 'cm-md-bold'),        'no cm-md-bold');
    assert.ok(!hasClassToken(m.class, 'cm-md-italic'),      'no cm-md-italic');
    assert.ok(!hasClassToken(m.class, 'cm-md-inline-code'), 'no cm-md-inline-code');
    assert.ok(!hasClassToken(m.class, 'cm-md-syntax'),      'no cm-md-syntax');
  }
});

test('13. raw document text is unchanged after building decorations', () => {
  const doc = '# Heading **bold** *italic* `code` end';
  const state = makeState(doc);
  // Build decorations as a side-effect-free observation.
  buildHeadingDecorations(state, cm6);
  assert.equal(state.doc.toString(), doc, 'doc text untouched — marks are styling only');
});

test('14. mixed doc creates expected marks for each construct', () => {
  const doc = 'plain **bold** more *italic* and `code` end';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  // Exactly one container per construct.
  assert.equal(marks.filter((m) => m.class === 'cm-md-bold').length,        1);
  assert.equal(marks.filter((m) => m.class === 'cm-md-italic').length,      1);
  assert.equal(marks.filter((m) => m.class === 'cm-md-inline-code').length, 1);
  // Two emphasis markers each for bold and italic — four total.
  const emMarks = marks.filter((m) => hasClassToken(m.class, 'cm-md-emphasis-mark'));
  assert.equal(emMarks.length, 4);
  // Two code markers (opening + closing backtick).
  const codeMarks = marks.filter((m) => hasClassToken(m.class, 'cm-md-code-mark'));
  assert.equal(codeMarks.length, 2);
  // Every marker also carries cm-md-syntax for the shared hide/reveal CSS hook.
  for (const m of [...emMarks, ...codeMarks]) {
    assert.ok(hasClassToken(m.class, 'cm-md-syntax'),
      'each marker carries the shared cm-md-syntax class');
  }
});

// ── Stage 11.5 revision: inline marks INSIDE headings ───────────────────────

test('15. "# **Bold** and `code`" emits heading + inline-bold + inline-code marks', () => {
  const doc = '# **Bold** and `code`';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));

  assert.ok(marks.some((m) => m.class === 'cm-md-h1'),
    'cm-md-h1 covers the heading line');
  assert.ok(marks.some((m) => m.class === 'cm-md-heading-mark'),
    'cm-md-heading-mark covers the "#"');

  assert.ok(marks.some((m) => m.class === 'cm-md-bold'),
    'inline cm-md-bold inside heading');
  assert.ok(marks.some((m) => m.class === 'cm-md-inline-code'),
    'inline cm-md-inline-code inside heading');

  // Two ** markers (bold) carrying the shared cm-md-syntax class.
  const emMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-emphasis-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(emMarks.length, 2, 'two emphasis markers around **Bold**');

  // Two backtick markers carrying the shared cm-md-syntax class.
  const codeMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-code-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(codeMarks.length, 2, 'two code markers around `code`');
});

test('16. "## *Italic* and _also italic_" emits heading + two italic + four emphasis markers', () => {
  const doc = '## *Italic* and _also italic_';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));

  assert.ok(marks.some((m) => m.class === 'cm-md-h2'),
    'cm-md-h2 covers the heading line');
  assert.ok(marks.some((m) => m.class === 'cm-md-heading-mark'),
    'cm-md-heading-mark covers the "##"');

  // Two italic spans inside the heading.
  const italicMarks = marks.filter((m) => m.class === 'cm-md-italic');
  assert.equal(italicMarks.length, 2,
    'two cm-md-italic ranges (one for *Italic*, one for _also italic_)');

  // Four emphasis markers total — two pairs of */_ delimiters.
  const emMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-emphasis-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(emMarks.length, 4, 'four emphasis markers across both italic spans');
});
