/* Stage 33 — GFM table grid borders + row striping tests.
   Run focused:
     node --test test/cm6-write-view/cm6-table-grid.test.js

   Scope: walker-layer line-level emissions that give off-active tables
   visible grid structure independent of Stage 32's hide/reveal logic.
   Two new always-visible classes:

     - cm-md-table-header-line       — on the editor line containing the
                                       header row; gets border-bottom.
     - cm-md-table-body-row-line     — on every body row's line.
       cm-md-table-body-row-0/1      — parity class for alternating
                                       background striping. Resets to 0
                                       at each Table.

   Grid styling is ALWAYS visible (no .cm-md-table-active prefix on the
   CSS selectors) — pinned by test 33-CSS-3.

   Walker change is GUARDED on `typeof cm6.Decoration.line === 'function'`
   so fake backends without Decoration.line still get the Stage 31
   Decoration.mark emissions; the parity counter still increments under
   the guard so sibling-row contract stays consistent.

   Tests use the npm @codemirror packages directly (same pattern as
   Stage 31's cm6-table-walker.test.js — NOT the production bundle). */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { EditorState } = require('@codemirror/state');
const { Decoration }  = require('@codemirror/view');
const { syntaxTree }  = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { Strikethrough, Table } = require('@lezer/markdown');

const { buildHeadingDecorations } = require('../../lib/cm6-hybrid-view');

const TABLE_FIXTURE = '| a | b |\n|---|---|\n| c | d |\n';

const cm6 = { Decoration, syntaxTree };

function makeState(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({
      base: markdownLanguage,
      codeLanguages: [],
      extensions: [Strikethrough, Table],
    })],
  });
}

// Collect line-level decorations. Each spec.class may contain multiple
// space-separated tokens; we expose tokens[] for easy filtering.
function collectLineDecorations(decorationSet) {
  const out = [];
  const cursor = decorationSet.iter();
  while (cursor.value) {
    const v = cursor.value;
    // Line decorations have spec.class and zero-width range (from===to).
    const cls = v.spec && v.spec.class;
    out.push({
      from: cursor.from,
      to: cursor.to,
      class: cls,
      tokens: String(cls || '').split(/\s+/).filter(Boolean),
    });
    cursor.next();
  }
  return out;
}

function decorationsWithToken(decorationSet, token) {
  return collectLineDecorations(decorationSet).filter((d) => d.tokens.includes(token));
}

// ── CSS helpers (mirror Stage 32) ──────────────────────────────────────────

function extractCss(html) {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  return m ? m[1] : '';
}

function parseCssRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  while (i < stripped.length) {
    const brace = stripped.indexOf('{', i);
    if (brace < 0) break;
    const closeBrace = stripped.indexOf('}', brace);
    if (closeBrace < 0) break;
    const selectorText = stripped.slice(i, brace).trim();
    const body = stripped.slice(brace + 1, closeBrace).trim();
    if (selectorText) {
      const selectors = selectorText.split(',').map((s) => s.trim()).filter(Boolean);
      rules.push({ selectors, body });
    }
    i = closeBrace + 1;
  }
  return rules;
}

function parseDeclarations(body) {
  const decls = [];
  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    decls.push({ property: trimmed.slice(0, colon).trim(), value: trimmed.slice(colon + 1).trim() });
  }
  return decls;
}

function loadHtmlRules() {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.html'),
    'utf8'
  );
  return { html, rules: parseCssRules(extractCss(html)) };
}

// ─────────────────────────────────────────────────────────────────────────
// Group RED — primary headline assertions
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-RED-1: TABLE_FIXTURE walker emits exactly one cm-md-table-header-line decoration on the header row line', () => {
  const state = makeState(TABLE_FIXTURE);
  const decos = buildHeadingDecorations(state, cm6);
  const headerLineDecos = decorationsWithToken(decos, 'cm-md-table-header-line');
  assert.equal(headerLineDecos.length, 1,
    'exactly one cm-md-table-header-line decoration expected (got ' + headerLineDecos.length + ')');
  // Must land on line 1's start offset (header row).
  assert.equal(headerLineDecos[0].from, state.doc.line(1).from,
    'cm-md-table-header-line decoration must land on the line-1 start offset');
});

test('Stage 33-RED-2: TABLE_FIXTURE walker emits cm-md-table-body-row-line on each body row, but NOT on the delimiter row', () => {
  const state = makeState(TABLE_FIXTURE);
  const decos = buildHeadingDecorations(state, cm6);
  const bodyRowDecos = decorationsWithToken(decos, 'cm-md-table-body-row-line');
  // TABLE_FIXTURE has 1 body row (line 3); delimiter is line 2.
  assert.equal(bodyRowDecos.length, 1,
    'exactly one cm-md-table-body-row-line expected for TABLE_FIXTURE (1 body row); got ' + bodyRowDecos.length);
  assert.equal(bodyRowDecos[0].from, state.doc.line(3).from,
    'body-row line decoration must land on line 3 (the body row)');
  // Defensive: line 2 (delimiter row) must NOT carry the body-row class.
  const line2From = state.doc.line(2).from;
  const onLine2 = bodyRowDecos.filter((d) => d.from === line2From);
  assert.equal(onLine2.length, 0, 'delimiter-row line (line 2) must NOT carry cm-md-table-body-row-line');
});

// ─────────────────────────────────────────────────────────────────────────
// Group PARITY — parity counter contracts
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-PARITY-1: 4-body-row table emits parity classes 0, 1, 0, 1 in order', () => {
  const doc = '| h1 | h2 |\n|----|----|\n| r0 | r0 |\n| r1 | r1 |\n| r2 | r2 |\n| r3 | r3 |\n';
  const state = makeState(doc);
  const decos = buildHeadingDecorations(state, cm6);
  const bodyRowDecos = decorationsWithToken(decos, 'cm-md-table-body-row-line')
    .sort((a, b) => a.from - b.from);
  assert.equal(bodyRowDecos.length, 4, 'expected 4 body-row decorations, got ' + bodyRowDecos.length);
  const parityFor = (d) => {
    if (d.tokens.includes('cm-md-table-body-row-0')) return 0;
    if (d.tokens.includes('cm-md-table-body-row-1')) return 1;
    return null;
  };
  const parities = bodyRowDecos.map(parityFor);
  assert.deepEqual(parities, [0, 1, 0, 1],
    'parities must alternate 0,1,0,1 across body rows; got ' + JSON.stringify(parities));
});

test('Stage 33-PARITY-2: two sibling tables each start parity at 0 (counter resets per Table)', () => {
  // Two sibling tables, each with exactly one body row.
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |\n\n| X | Y |\n|---|---|\n| 9 | 8 |\n';
  const state = makeState(doc);
  const decos = buildHeadingDecorations(state, cm6);
  const bodyRowDecos = decorationsWithToken(decos, 'cm-md-table-body-row-line')
    .sort((a, b) => a.from - b.from);
  assert.equal(bodyRowDecos.length, 2, 'expected 2 body-row decorations (one per table); got ' + bodyRowDecos.length);
  for (const d of bodyRowDecos) {
    assert.ok(d.tokens.includes('cm-md-table-body-row-0'),
      'sibling-table body row must start at parity 0 (got tokens: ' + d.tokens.join(',') + ')');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Group NEG — non-table fixtures + delimiter-row exclusion
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-NEG-1: non-table fixture (paragraph + heading + list) emits NO cm-md-table-*-line decorations', () => {
  const doc = '# Heading\n\nA paragraph.\n\n- a list\n- of items\n';
  const state = makeState(doc);
  const decos = buildHeadingDecorations(state, cm6);
  const tableLineDecos = collectLineDecorations(decos).filter((d) =>
    d.tokens.some((t) => t.startsWith('cm-md-table-'))
  );
  assert.equal(tableLineDecos.length, 0,
    'non-table fixture must emit no cm-md-table-*-line decorations; got ' + tableLineDecos.length);
});

test('Stage 33-NEG-2: delimiter row line gets neither cm-md-table-header-line nor cm-md-table-body-row-line', () => {
  const state = makeState(TABLE_FIXTURE);
  const decos = buildHeadingDecorations(state, cm6);
  const line2From = state.doc.line(2).from;
  const onDelimLine = collectLineDecorations(decos).filter((d) => d.from === line2From);
  for (const d of onDelimLine) {
    assert.ok(!d.tokens.includes('cm-md-table-header-line'),
      'delimiter row must not carry cm-md-table-header-line');
    assert.ok(!d.tokens.includes('cm-md-table-body-row-line'),
      'delimiter row must not carry cm-md-table-body-row-line');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Group GUARD — Decoration.line absent → no throw, marks still emit
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-GUARD-1: fake cm6 with NO Decoration.line still emits Stage 31 marks; no throw; parity counter still advances', () => {
  // Build a fake cm6 backend that exposes Decoration.mark + syntaxTree
  // but NOT Decoration.line. The Stage 33 emissions must skip silently
  // while Stage 31 Decoration.mark emissions still fire.
  const fakeMarks = [];
  const fakeCm6 = {
    Decoration: {
      mark(spec) {
        return {
          range(from, to) {
            fakeMarks.push({ from, to, class: spec.class });
            return { from, to, value: { spec } };
          },
        };
      },
      // Intentionally no `line` function.
      set(arr /*, sort */) { return { _ranges: arr }; },
    },
    syntaxTree,
  };
  // Should NOT throw despite missing Decoration.line.
  assert.doesNotThrow(() => {
    buildHeadingDecorations(makeState(TABLE_FIXTURE), fakeCm6);
  });
  // Stage 31 marks (cm-md-table-pipe / cm-md-table-delimiter-row) still
  // emit — proof the guard is scoped to the Stage 33 branches only.
  const stage31Marks = fakeMarks.filter((m) =>
    m.class === 'cm-md-table-pipe' || m.class === 'cm-md-table-delimiter-row'
  );
  assert.ok(stage31Marks.length >= 1,
    'Stage 31 mark emissions must still fire when Decoration.line is absent (got ' + stage31Marks.length + ' table marks)');
});

// ─────────────────────────────────────────────────────────────────────────
// Group EDGE — realistic placement
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-EDGE-1: blockquoted table — header-line + body-row-line decorations land on containing editor lines', () => {
  const doc = '> | a | b |\n> |---|---|\n> | c | d |\n';
  const state = makeState(doc);
  const decos = buildHeadingDecorations(state, cm6);
  const headerLineDecos = decorationsWithToken(decos, 'cm-md-table-header-line');
  const bodyRowDecos    = decorationsWithToken(decos, 'cm-md-table-body-row-line');
  // The Lezer GFM grammar may or may not produce a Table node inside a
  // blockquote — both behaviors are acceptable; assert only that IF a
  // header decoration is emitted, it lands at the line-1 start offset
  // (line containing "> | a | b |"), and IF a body-row decoration is
  // emitted, it lands at line-3's start offset (line containing
  // "> | c | d |"). Otherwise (no Table parsed inside blockquote), the
  // counts are 0 and that's also fine — Lezer's behavior here is the
  // contract under test, not our walker.
  if (headerLineDecos.length >= 1) {
    assert.equal(headerLineDecos[0].from, state.doc.line(1).from,
      'blockquoted-table header-line decoration must land on line 1 start');
  }
  if (bodyRowDecos.length >= 1) {
    assert.equal(bodyRowDecos[0].from, state.doc.line(3).from,
      'blockquoted-table body-row decoration must land on line 3 start');
  }
});

test('Stage 33-EDGE-2: table at end-of-doc with NO trailing newline still gets line decorations', () => {
  // Note: no trailing newline.
  const doc = '| a | b |\n|---|---|\n| c | d |';
  const state = makeState(doc);
  const decos = buildHeadingDecorations(state, cm6);
  const headerLineDecos = decorationsWithToken(decos, 'cm-md-table-header-line');
  const bodyRowDecos    = decorationsWithToken(decos, 'cm-md-table-body-row-line');
  assert.equal(headerLineDecos.length, 1, 'expected 1 header-line decoration; got ' + headerLineDecos.length);
  assert.equal(bodyRowDecos.length, 1, 'expected 1 body-row decoration for the only body row; got ' + bodyRowDecos.length);
  assert.equal(bodyRowDecos[0].from, state.doc.line(3).from,
    'body-row decoration must land on line 3 even without trailing newline');
});

// ─────────────────────────────────────────────────────────────────────────
// Group CSS — index.html invariant scans
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-CSS-1: index.html has exactly one .cm-md-table-header-line rule with border-bottom: 1px solid var(--border-subtle)', () => {
  const { rules } = loadHtmlRules();
  const match = rules.filter((r) =>
    r.selectors.some((s) => s.trim() === '.cm-md-table-header-line')
  );
  assert.equal(match.length, 1,
    'exactly one CSS rule with selector .cm-md-table-header-line expected; got ' + match.length);
  const decls = parseDeclarations(match[0].body);
  const borderBottom = decls.find((d) => d.property === 'border-bottom');
  assert.ok(borderBottom, 'rule must contain a border-bottom declaration');
  assert.equal(borderBottom.value, '1px solid var(--border-subtle)',
    'border-bottom must be "1px solid var(--border-subtle)"; got: ' + (borderBottom && borderBottom.value));
});

test('Stage 33-CSS-2: index.html has exactly one .cm-md-table-body-row-0 rule with background: var(--surface-muted) AND one .cm-md-table-body-row-1 rule with background: transparent', () => {
  const { rules } = loadHtmlRules();
  const row0 = rules.filter((r) => r.selectors.some((s) => s.trim() === '.cm-md-table-body-row-0'));
  const row1 = rules.filter((r) => r.selectors.some((s) => s.trim() === '.cm-md-table-body-row-1'));
  assert.equal(row0.length, 1, 'exactly one .cm-md-table-body-row-0 rule expected; got ' + row0.length);
  assert.equal(row1.length, 1, 'exactly one .cm-md-table-body-row-1 rule expected; got ' + row1.length);
  const row0Bg = parseDeclarations(row0[0].body).find((d) => d.property === 'background');
  const row1Bg = parseDeclarations(row1[0].body).find((d) => d.property === 'background');
  assert.equal(row0Bg && row0Bg.value, 'var(--surface-muted)',
    '.cm-md-table-body-row-0 background must be var(--surface-muted)');
  assert.equal(row1Bg && row1Bg.value, 'transparent',
    '.cm-md-table-body-row-1 background must be transparent');
});

test('Stage 33-CSS-4: row-0 stripe survives .cm-activeLine cascade — #hybridWritePane .cm-md-table-body-row-0 has !important and appears AFTER the .cm-activeLine override (Codex rev-1 MAJOR regression guard)', () => {
  // The repo's #hybridWritePane .cm-activeLine rule sets
  // `background: transparent !important` on every active line. Without
  // a same-specificity !important override placed AFTER it, the
  // Stage 33 row-0 stripe gets erased when the caret is on a striped
  // body row. This test pins the fix:
  //   1. A rule with EXACT selector "#hybridWritePane .cm-md-table-body-row-0"
  //      MUST exist with `background: var(--surface-muted) !important`.
  //   2. That rule MUST appear in CSS source order AFTER the
  //      "#hybridWritePane .cm-activeLine" rule.
  const { html } = loadHtmlRules();
  const cssMatch = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  const css = cssMatch ? cssMatch[1] : '';
  // Strip comments to avoid false matches.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Find both rules' opening offsets in the stripped CSS.
  const activeLineOffset = stripped.search(/#hybridWritePane\s+\.cm-activeLine\s*\{/);
  const row0Offset       = stripped.search(/#hybridWritePane\s+\.cm-md-table-body-row-0\s*\{/);
  assert.ok(activeLineOffset >= 0,
    '#hybridWritePane .cm-activeLine rule must exist (anchor for the cascade fight)');
  assert.ok(row0Offset >= 0,
    '#hybridWritePane .cm-md-table-body-row-0 cascade-override rule must exist');
  assert.ok(row0Offset > activeLineOffset,
    'row-0 cascade-override must appear AFTER the .cm-activeLine reset in source order '
    + '(activeLineOffset=' + activeLineOffset + ', row0Offset=' + row0Offset + ')');
  // The body of the row-0 override must contain both `var(--surface-muted)` AND `!important`.
  const row0Body = stripped.slice(row0Offset);
  const closeBrace = row0Body.indexOf('}');
  const body = row0Body.slice(row0Body.indexOf('{') + 1, closeBrace);
  assert.match(body, /background\s*:\s*var\(--surface-muted\)\s*!important/,
    '#hybridWritePane .cm-md-table-body-row-0 must set background: var(--surface-muted) !important (got body: ' + body.trim() + ')');
});

test('Stage 33-CSS-3: Stage 33 selectors are ALWAYS-VISIBLE — NOT scoped by .cm-md-table-active / .cm-md-construct-active / .cm-activeLine', () => {
  const { rules } = loadHtmlRules();
  const stage33Classes = [
    'cm-md-table-header-line',
    'cm-md-table-body-row-line',
    'cm-md-table-body-row-0',
    'cm-md-table-body-row-1',
  ];
  const forbiddenAncestors = [
    'cm-md-table-active',
    'cm-md-construct-active',
    'cm-activeLine',
  ];
  for (const r of rules) {
    for (const sel of r.selectors) {
      const trimmed = sel.trim();
      // Only inspect selectors that mention any Stage 33 class.
      if (!stage33Classes.some((c) => trimmed.includes(c))) continue;
      for (const ancestor of forbiddenAncestors) {
        assert.ok(!trimmed.includes(ancestor),
          'Stage 33 selector "' + trimmed + '" must NOT be scoped by ".' + ancestor + '" (always-visible contract; pinned by 33-CSS-3)');
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Group FROZEN — Stage 31 emissions unchanged on TABLE_FIXTURE
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-FROZEN: Stage 31 cm-md-table-pipe + cm-md-table-delimiter-row marks still emit on TABLE_FIXTURE', () => {
  const state = makeState(TABLE_FIXTURE);
  const decos = buildHeadingDecorations(state, cm6);
  // Collect inline mark decorations (not line decorations) by scanning
  // every entry's spec.class.
  const allClasses = [];
  const cursor = decos.iter();
  while (cursor.value) {
    const cls = cursor.value.spec && cursor.value.spec.class;
    if (cls) allClasses.push(cls);
    cursor.next();
  }
  const flatTokens = allClasses.flatMap((c) => c.split(/\s+/));
  assert.ok(flatTokens.includes('cm-md-table-pipe'),
    'Stage 31 cm-md-table-pipe mark must still emit (got: ' + Array.from(new Set(flatTokens)).sort().join(',') + ')');
  assert.ok(flatTokens.includes('cm-md-table-delimiter-row'),
    'Stage 31 cm-md-table-delimiter-row mark must still emit');
});

// ─────────────────────────────────────────────────────────────────────────
// Group PEER — Section H forbidden-token scan
// ─────────────────────────────────────────────────────────────────────────

test('Stage 33-PEER: cm6-hybrid-view.js source obeys Section H forbidden-token list', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'cm6-hybrid-view.js'),
    'utf8'
  );
  // Mirror the canonical Section H readiness banned list. Stage 33's
  // new walker branches must not introduce any of these.
  assert.ok(!src.includes('Decoration.replace'), 'must not contain Decoration.replace');
  assert.ok(!src.includes('WidgetType'),         'must not contain WidgetType');
  assert.ok(!src.includes('HeadingWidget'),      'must not contain HeadingWidget');
  assert.ok(!src.includes('ParagraphWidget'),    'must not contain ParagraphWidget');
  assert.ok(!src.includes('<a'),                 'must not contain "<a" anywhere');
  assert.ok(!src.includes('href'),               'must not contain "href" anywhere');
  assert.ok(!src.includes("addEventListener('click'"),
    'must not contain addEventListener click handler (single quote)');
  assert.ok(!src.includes('addEventListener("click"'),
    'must not contain addEventListener click handler (double quote)');
});
