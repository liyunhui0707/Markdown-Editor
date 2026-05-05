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

// ── Stage 11.6: stabilization regression tests ──────────────────────────────

test('17. "***both***" emits both cm-md-italic and cm-md-bold marks', () => {
  // Parser nests Emphasis around StrongEmphasis: italic outer, bold inner.
  const doc = '***both***';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-italic').length, 1, 'one italic mark');
  assert.equal(marks.filter((m) => m.class === 'cm-md-bold').length,   1, 'one bold mark');
  // Four emphasis marker ranges: outer * pair + inner ** pair.
  const emMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-emphasis-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(emMarks.length, 4, 'four emphasis markers across nested italic + bold');
});

test('18. "`**not bold**`" emits inline-code marks but no bold/emphasis marks', () => {
  // Parser does NOT re-parse emphasis inside InlineCode — verify the walker
  // emits zero bold/emphasis decorations for content that looks like bold.
  const doc = '`**not bold**`';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-inline-code').length, 1);
  const codeMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-code-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(codeMarks.length, 2, 'two backtick markers');
  assert.equal(marks.filter((m) => m.class === 'cm-md-bold').length, 0,
    'no bold mark inside inline code');
  assert.equal(marks.filter((m) => hasClassToken(m.class, 'cm-md-emphasis-mark')).length, 0,
    'no emphasis markers inside inline code');
});

test('19. heading with bold + italic + inline code emits all expected marks', () => {
  const doc = '# **bold** *italic* `code`';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  // Heading-level marks (Stage 11.4 invariant).
  assert.ok(marks.some((m) => m.class === 'cm-md-h1'),           'cm-md-h1');
  assert.ok(marks.some((m) => m.class === 'cm-md-heading-mark'), 'cm-md-heading-mark');
  // Inline content marks (Stage 11.5 invariant when descending into headings).
  assert.equal(marks.filter((m) => m.class === 'cm-md-bold').length,        1);
  assert.equal(marks.filter((m) => m.class === 'cm-md-italic').length,      1);
  assert.equal(marks.filter((m) => m.class === 'cm-md-inline-code').length, 1);
  // Markers: 4 emphasis (** + *) and 2 code (` `).
  const emMarks   = marks.filter((m) => hasClassToken(m.class, 'cm-md-emphasis-mark'));
  const codeMarks = marks.filter((m) => hasClassToken(m.class, 'cm-md-code-mark'));
  assert.equal(emMarks.length,   4, 'four emphasis markers');
  assert.equal(codeMarks.length, 2, 'two code markers');
});

test('20. setext heading underline is not decorated as ATX heading marker', () => {
  // Lezer Markdown emits SetextHeading1/2 with a HeaderMark child for the
  // "=====" / "-----" underline. Our manual children loop is scoped to
  // ATXHeading parents, so setext underlines must remain raw.
  const doc = 'Title\n=====\n';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-heading-mark').length, 0,
    'no cm-md-heading-mark for setext underline');
});

test('21. fenced code delimiters do NOT get cm-md-code-mark / cm-md-syntax', () => {
  // Lezer reuses CodeMark for fenced code delimiters. The walker must scope
  // CodeMark decoration to InlineCode parents only — fenced code stays raw.
  const doc = '```\n**not bold**\n```';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const codeMarks = marks.filter((m) => hasClassToken(m.class, 'cm-md-code-mark'));
  assert.equal(codeMarks.length, 0, 'fence delimiters must remain raw');
  const syntaxMarks = marks.filter((m) => hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(syntaxMarks.length, 0, 'no cm-md-syntax inside the fenced code area');
});

test('22. fenced code content does not get bold/italic/inline-code marks', () => {
  // Parser-level guarantee — verify the walker doesn't accidentally re-emit.
  const doc = '```\n**not bold** *not italic* `not inline code`\n```';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-bold').length,        0);
  assert.equal(marks.filter((m) => m.class === 'cm-md-italic').length,      0);
  assert.equal(marks.filter((m) => m.class === 'cm-md-inline-code').length, 0);
});

test('23. long mixed document creates expected mark counts', () => {
  const doc = [
    '# First heading with **bold**',
    '',
    'Body paragraph with *italic* and `code`.',
    '',
    '## Second heading',
    '',
    'More text with **bolder** content.',
    '',
    '```',
    'fenced **not bold** content',
    '```',
    '',
    '### Third with `inline-code` here',
  ].join('\n');
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));

  // 3 ATX headings (h1, h2, h3).
  assert.equal(marks.filter((m) => /^cm-md-h\d$/.test(m.class)).length, 3);
  assert.equal(marks.filter((m) => m.class === 'cm-md-heading-mark').length, 3);

  // 2 bold runs (heading 1 + the second body paragraph).
  assert.equal(marks.filter((m) => m.class === 'cm-md-bold').length, 2);

  // 1 italic run (first body paragraph).
  assert.equal(marks.filter((m) => m.class === 'cm-md-italic').length, 1);

  // 2 inline-code runs (first body paragraph + heading 3).
  assert.equal(marks.filter((m) => m.class === 'cm-md-inline-code').length, 2);
});

test('24. source-file invariant: no widget / no Decoration.replace in cm6-hybrid-view.js', () => {
  // Structural guard — keeps the architectural commitment from Stage 11.4
  // machine-checkable so future changes can't silently regress.
  const fs   = require('node:fs');
  const path = require('node:path');
  const src  = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'cm6-hybrid-view.js'),
    'utf8'
  );
  assert.ok(!src.includes('Decoration.replace'), 'must not contain Decoration.replace');
  assert.ok(!src.includes('WidgetType'),         'must not contain WidgetType');
  assert.ok(!src.includes('HeadingWidget'),      'must not contain HeadingWidget');
  assert.ok(!src.includes('ParagraphWidget'),    'must not contain ParagraphWidget');
});

// ── Stage 11.7: inline link live styling (non-clickable) ────────────────────

test('25. "[OpenAI](https://openai.com)" emits cm-md-link-text over the label', () => {
  const doc = '[OpenAI](https://openai.com)';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const linkText = marks.find((m) => m.class === 'cm-md-link-text');
  assert.ok(linkText, 'cm-md-link-text mark exists');
  assert.equal(linkText.from, 1, 'starts after the opening "["');
  assert.equal(linkText.to,   7, 'ends before the closing "]"');
});

test('26. inline link punctuation and URL get cm-md-syntax cm-md-link-mark', () => {
  const doc = '[OpenAI](https://openai.com)';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const linkMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-link-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  // Expected: "[", "]", "(", URL, ")" → 5 ranges total.
  assert.equal(linkMarks.length, 5, 'four LinkMarks plus the URL');
  // Verify the URL range is covered.
  const urlRange = linkMarks.find((m) => m.from === 9 && m.to === 27);
  assert.ok(urlRange, 'URL range [9,27] covered with link-mark');
});

test('27. link with title also hides the title as link syntax', () => {
  const doc = '[OpenAI](https://openai.com "the title")';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const linkMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-link-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  // Expected: "[", "]", "(", URL, LinkTitle, ")" → 6 ranges total.
  assert.equal(linkMarks.length, 6, 'five LinkMarks/URL plus the LinkTitle');
  const titleRange = linkMarks.find((m) => m.from === 28 && m.to === 39);
  assert.ok(titleRange, 'LinkTitle range covered with link-mark');
});

test('28. "[**bold link**](url)" emits both cm-md-link-text and cm-md-bold', () => {
  const doc = '[**bold link**](https://example.com)';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const linkText = marks.find((m) => m.class === 'cm-md-link-text');
  const bold     = marks.find((m) => m.class === 'cm-md-bold');
  assert.ok(linkText, 'cm-md-link-text exists');
  assert.ok(bold,     'cm-md-bold exists (nested formatting still applies)');
  // Link text covers the full label including the ** delimiters.
  assert.equal(linkText.from, 1);
  assert.equal(linkText.to,   14);
  // Bold covers the StrongEmphasis range inside.
  assert.equal(bold.from, 1);
  assert.equal(bold.to,   14);
});

test('29. "![alt](image.png)" gets no cm-md-link-text and no cm-md-link-mark', () => {
  const doc = '![alt text](image.png)';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-link-text').length, 0,
    'image alt text must not be styled as link text');
  assert.equal(marks.filter((m) => hasClassToken(m.class, 'cm-md-link-mark')).length, 0,
    'image syntax must not be styled as link syntax');
});

test('30. "[OpenAI][1]" reference-style link is not styled (no URL child)', () => {
  const doc = '[OpenAI][1]\n\n[1]: https://openai.com';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-link-text').length, 0,
    'reference-style link must not get cm-md-link-text');
  assert.equal(marks.filter((m) => hasClassToken(m.class, 'cm-md-link-mark')).length, 0,
    'reference-style link must not get cm-md-link-mark');
});

test('31. "<https://openai.com>" autolink gets no cm-md-link-mark', () => {
  const doc = '<https://openai.com>';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-link-text').length, 0);
  assert.equal(marks.filter((m) => hasClassToken(m.class, 'cm-md-link-mark')).length, 0,
    'autolink must not be styled as Markdown link');
});

test('32. bare "https://openai.com" gets no cm-md-link-mark', () => {
  const doc = 'go to https://openai.com today';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-link-text').length, 0);
  assert.equal(marks.filter((m) => hasClassToken(m.class, 'cm-md-link-mark')).length, 0,
    'bare URL must not be styled');
});

test('33. "# See [OpenAI](https://openai.com)" composes heading and link marks', () => {
  const doc = '# See [OpenAI](https://openai.com)';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  // Heading marks (Stage 11.4 invariant).
  assert.ok(marks.some((m) => m.class === 'cm-md-h1'),           'cm-md-h1 present');
  assert.ok(marks.some((m) => m.class === 'cm-md-heading-mark'), 'cm-md-heading-mark present');
  // Link marks (Stage 11.7).
  const linkText = marks.find((m) => m.class === 'cm-md-link-text');
  assert.ok(linkText, 'cm-md-link-text present inside heading');
  assert.equal(linkText.from, 7,  'after the "[" at position 6');
  assert.equal(linkText.to,   13, 'before the "]" at position 13');
  const linkMarks = marks.filter((m) =>
    hasClassToken(m.class, 'cm-md-link-mark') && hasClassToken(m.class, 'cm-md-syntax'));
  assert.equal(linkMarks.length, 5, 'four LinkMarks plus URL');
});

test('34. source-file invariant: no <a / no href in cm6-hybrid-view.js', () => {
  // Stage 11.7 must remain non-clickable. No <a> tag and no href anywhere
  // in the hybrid view source — including comments and string literals.
  const fs   = require('node:fs');
  const path = require('node:path');
  const src  = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'cm6-hybrid-view.js'),
    'utf8'
  );
  assert.ok(!src.includes('<a'),    'must not contain "<a" anywhere');
  assert.ok(!src.includes('href'),  'must not contain "href" anywhere');
});

// ── Stage 11.8: list and blockquote marker dimming ──────────────────────────

test('35. "- one" emits one cm-md-list-mark over the dash', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('- one'), cm6));
  const listMarks = marks.filter((m) => m.class === 'cm-md-list-mark');
  assert.equal(listMarks.length, 1);
  assert.equal(listMarks[0].from, 0);
  assert.equal(listMarks[0].to,   1);
});

test('36. "* one" emits one cm-md-list-mark over the asterisk', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('* one'), cm6));
  const listMarks = marks.filter((m) => m.class === 'cm-md-list-mark');
  assert.equal(listMarks.length, 1);
  assert.equal(listMarks[0].from, 0);
  assert.equal(listMarks[0].to,   1);
});

test('37. "+ one" emits one cm-md-list-mark over the plus', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('+ one'), cm6));
  const listMarks = marks.filter((m) => m.class === 'cm-md-list-mark');
  assert.equal(listMarks.length, 1);
  assert.equal(listMarks[0].from, 0);
  assert.equal(listMarks[0].to,   1);
});

test('38. "1. one" emits one cm-md-list-mark over "1."', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('1. one'), cm6));
  const listMarks = marks.filter((m) => m.class === 'cm-md-list-mark');
  assert.equal(listMarks.length, 1);
  assert.equal(listMarks[0].from, 0);
  assert.equal(listMarks[0].to,   2, 'covers both "1" and "."');
});

test('39. "1) one" emits one cm-md-list-mark over "1)"', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('1) one'), cm6));
  const listMarks = marks.filter((m) => m.class === 'cm-md-list-mark');
  assert.equal(listMarks.length, 1);
  assert.equal(listMarks[0].from, 0);
  assert.equal(listMarks[0].to,   2, 'covers both "1" and ")"');
});

test('40. "> quote" emits one cm-md-quote-mark over ">"', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('> a quote'), cm6));
  const quoteMarks = marks.filter((m) => m.class === 'cm-md-quote-mark');
  assert.equal(quoteMarks.length, 1);
  assert.equal(quoteMarks[0].from, 0);
  assert.equal(quoteMarks[0].to,   1);
});

test('41. multi-line bullet list emits one cm-md-list-mark per item', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('- one\n- two\n- three'), cm6));
  const listMarks = marks.filter((m) => m.class === 'cm-md-list-mark');
  assert.equal(listMarks.length, 3, 'three list items, three markers');
});

test('42. multi-line blockquote emits one cm-md-quote-mark per line', () => {
  // Lezer quirk: lines 2+ markers live inside the spanning Paragraph node,
  // not as direct children of Blockquote. The iterator still reaches them.
  const marks = collectMarks(buildHeadingDecorations(makeState('> first\n> second\n> third'), cm6));
  const quoteMarks = marks.filter((m) => m.class === 'cm-md-quote-mark');
  assert.equal(quoteMarks.length, 3);
});

test('43. nested bullet list emits cm-md-list-mark at each level', () => {
  const doc = '- outer\n  - inner\n  - inner2\n- another';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const listMarks = marks.filter((m) => m.class === 'cm-md-list-mark');
  assert.equal(listMarks.length, 4, 'one outer, two inner, one second outer');
});

test('44. nested blockquote emits cm-md-quote-mark at each level', () => {
  // Per the parser diagnostic, "> outer\n>> inner\n> back" emits FOUR
  // QuoteMark ranges: outer ">", first ">" of ">>", second ">" of ">>",
  // and the ">" of "> back".
  const doc = '> outer\n>> inner\n> back';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  const quoteMarks = marks.filter((m) => m.class === 'cm-md-quote-mark');
  assert.equal(quoteMarks.length, 4);
});

test('45. "- item with **bold**" emits both cm-md-list-mark and cm-md-bold', () => {
  const marks = collectMarks(buildHeadingDecorations(makeState('- item with **bold** text'), cm6));
  assert.ok(marks.some((m) => m.class === 'cm-md-list-mark'),  'cm-md-list-mark present');
  assert.ok(marks.some((m) => m.class === 'cm-md-bold'),       'cm-md-bold present (nested inline still works)');
});

test('46. "> see [OpenAI](url)" emits both cm-md-quote-mark and cm-md-link-text', () => {
  const doc = '> see [OpenAI](https://openai.com)';
  const marks = collectMarks(buildHeadingDecorations(makeState(doc), cm6));
  assert.ok(marks.some((m) => m.class === 'cm-md-quote-mark'), 'cm-md-quote-mark present');
  assert.ok(marks.some((m) => m.class === 'cm-md-link-text'),  'cm-md-link-text present (nested inline link)');
});

test('47. "- [ ] todo" emits cm-md-list-mark only — task checkbox stays raw', () => {
  // Stage 11.8 dims the bullet "-" but does NOT style the TaskMarker "[ ]".
  // Interactive checkboxes are explicitly deferred.
  const marks = collectMarks(buildHeadingDecorations(makeState('- [ ] todo'), cm6));
  assert.equal(marks.filter((m) => m.class === 'cm-md-list-mark').length, 1,
    'list mark for the dash');
  // Verify no class names ending with "-task" / containing "task" exist.
  for (const m of marks) {
    assert.ok(typeof m.class !== 'string' || !/task/i.test(m.class),
      'no task-checkbox class should be emitted');
  }
});
