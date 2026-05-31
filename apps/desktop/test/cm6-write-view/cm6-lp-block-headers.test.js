/* Stage D WAVE 1 — lp ATX HeaderMark branch.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-block-headers.test.js

   Off-active ATX heading marks (`#` … `######`) get Decoration.replace;
   on-active no-op. Setext underlines (parsed as SetextHeading{1,2} >
   HeaderMark) are NOT replaced (parent guard). Pattern mirrors
   cm6-lp-inline-code.test.js. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-block.js')];
const lpBlock = require('../../lib/cm6-lp-block.js');

const cm6 = { Decoration, syntaxTree, WidgetType };

function makeState(doc, cursorPos) {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos == null ? 0 : cursorPos, head: cursorPos == null ? 0 : cursorPos },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
  });
}

function collectRanges(rangeSet) {
  const out = [];
  if (!rangeSet || typeof rangeSet.iter !== 'function') return out;
  const cursor = rangeSet.iter();
  while (cursor.value) {
    out.push({ from: cursor.from, to: cursor.to });
    cursor.next();
  }
  return out;
}

// "alpha\n# Heading\nbeta\n"
//  0     6 7        16    21
// HeaderMark range for "#": [7, 8). Walker includes trailing space.
const FIXTURE_H1 = 'alpha\n# Heading\nbeta\n';

test('Stage D WAVE 1-T-H-1: off-active ATX H1 HeaderMark is replaced', () => {
  const state = makeState(FIXTURE_H1, 0); // caret on line 1 (alpha)
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'expected 1 replaced range for the # HeaderMark');
  assert.equal(replaced[0].from, 6, 'HeaderMark starts after the preceding newline');
  // The walker's HeaderMark range is [6,7) or [6,8) depending on whether the
  // space is included. Accept either; just confirm it covers the `#`.
  assert.ok(replaced[0].to >= 7 && replaced[0].to <= 8, 'HeaderMark range ends at 7 or 8');
});

test('Stage D WAVE 1-T-H-2: ATX H2..H6 HeaderMark widths', () => {
  for (let level = 2; level <= 6; level++) {
    const prefix = '#'.repeat(level);
    const fixture = 'alpha\n' + prefix + ' Heading\nbeta\n';
    const state = makeState(fixture, 0); // caret on line 1
    const out = lpBlock.buildLpBlockDecorations(state, cm6);
    const replaced = collectRanges(out.replaced);
    assert.equal(replaced.length, 1, 'level ' + level + ': expected 1 replaced range');
    assert.equal(replaced[0].from, 6, 'level ' + level + ': starts after newline');
    // Width covers the `#` run: at least `level` chars.
    assert.ok(replaced[0].to - replaced[0].from >= level,
      'level ' + level + ': range covers at least ' + level + ' chars');
  }
});

test('Stage D WAVE 1-T-H-3: ATX with trailing # produces 2 HeaderMark replaces', () => {
  // "# H1 #\nbeta\n"
  //  0      7
  const fixture = '# H1 #\nbeta\n';
  const state = makeState(fixture, 8); // caret on line 2 (beta), heading line is off-active
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 replaced ranges: leading "#" and trailing "#"');
  // Sorted by from
  replaced.sort((a, b) => a.from - b.from);
  assert.equal(replaced[0].from, 0, 'leading # starts at 0');
  assert.ok(replaced[1].from >= 4, 'trailing # appears after the heading text');
});

test('Stage D WAVE 1-T-H-4: on-active ATX HeaderMark is NOT replaced (walker handles reveal)', () => {
  const state = makeState(FIXTURE_H1, 10); // caret inside the heading line
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'on-active line: lp emits 0 replaces; walker emits cm-md-heading-mark for reveal');
});

test('Stage D WAVE 1-T-H-5: Setext H1 underline (===) HeaderMark is NOT replaced (parent guard)', () => {
  // Setext H1: title text followed by a line of `=` characters.
  // The parser emits SetextHeading1 > HeaderMark for the `===` underline.
  // Stage 29 handles its reveal; lp must NOT replace it.
  // "title\n=====\nbeta\n"
  //  0     6     12
  const fixture = 'title\n=====\nbeta\n';
  const state = makeState(fixture, 14); // caret on line 3 (beta), heading is off-active
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // The Setext underline's HeaderMark must be excluded by the ATX-only
  // parent guard. There may be 0 replaced ranges total (no ATX heading
  // exists in this fixture).
  assert.equal(replaced.length, 0,
    'Setext H1 underline must NOT produce a HeaderMark replace');
});

test('Stage D WAVE 1-T-H-6: Setext H2 underline (---) HeaderMark is NOT replaced (parent guard)', () => {
  // Setext H2: title text followed by `---` line. The parser disambiguates
  // this as SetextHeading2 > HeaderMark (NOT HorizontalRule, NOT ATX).
  // "title\n---\nbeta\n"
  //  0     6   10
  const fixture = 'title\n---\nbeta\n';
  const state = makeState(fixture, 12); // caret on line 3 (beta)
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'Setext H2 underline must NOT produce a HeaderMark replace');
});

test('Stage D WAVE 1-T-H-7: multiple ATX headings get replaced independently', () => {
  const fixture = '# A\n## B\n### C\nbody\n';
  const state = makeState(fixture, 18); // caret on the body line
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 3, 'expected 3 ATX HeaderMark replaces');
  replaced.sort((a, b) => a.from - b.from);
  // Widths
  assert.ok(replaced[0].to - replaced[0].from >= 1, 'first heading: at least 1 char');
  assert.ok(replaced[1].to - replaced[1].from >= 2, 'second heading: at least 2 chars');
  assert.ok(replaced[2].to - replaced[2].from >= 3, 'third heading: at least 3 chars');
});

test('Stage D WAVE 1-T-H-8: caret on second heading line reveals second only', () => {
  const fixture = '# A\n## B\n### C\nbody\n';
  const state = makeState(fixture, 6); // caret inside "## B"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'caret on second heading line: first and third headings still replaced');
});
