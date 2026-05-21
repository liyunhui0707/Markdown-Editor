/* Stage 31 — GFM table walker class emissions.
   Run focused:
     node --test test/cm6-write-view/cm6-table-walker.test.js

   Scope: walker-layer additions for the Lezer @lezer/markdown Table
   extension. Stage 31 adds two new class strings:

     - cm-md-table-pipe          — emitted on TableDelimiter whose parent
                                   is TableRow or TableHeader (the "|"
                                   character separating cells).
     - cm-md-table-delimiter-row — emitted on TableDelimiter whose parent
                                   is Table (the "|---|---|" separator line).

   Stage 31 is walker-only. No reveal CSS yet (that arrives in Stage 32),
   so test 31-9 explicitly asserts apps/desktop/index.html does NOT
   contain a rule keyed on either new class.

   Tests use the npm @codemirror/state + @codemirror/lang-markdown +
   @lezer/markdown packages directly (NOT the production bundle) — same
   approach as heading-marks.test.js. The production bundle's runtime
   registration of Table is pinned separately by the Stage 31 amendment
   in cm6-bundle-parity.test.js. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { EditorState } = require('@codemirror/state');
const { Decoration }  = require('@codemirror/view');
const { syntaxTree }  = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { Strikethrough, Table }       = require('@lezer/markdown');

const { buildHeadingDecorations } = require('../../lib/cm6-hybrid-view');

// Canonical TABLE_FIXTURE — referenced by every test that needs a real
// GFM table. Defined ONCE; never re-typed with escapes inside test bodies.
const TABLE_FIXTURE = '| a | b |\n|---|---|\n| c | d |\n';

const cm6 = { Decoration, syntaxTree };

function makeState(doc, extraExtensions = []) {
  return EditorState.create({
    doc,
    extensions: [markdown({
      base: markdownLanguage,
      codeLanguages: [],
      extensions: [Strikethrough, Table, ...extraExtensions],
    })],
  });
}

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

function collectNodeNames(state) {
  const names = new Set();
  syntaxTree(state).iterate({
    enter: (node) => { names.add(node.name); },
  });
  return names;
}

// Build a fake syntax tree with explicit parent chains. The walker reads
// `node.node.parent` for parent inspection, so each entry exposes a `node`
// field whose `parent` field references the parent's iteration record.
function makeFakeCm6() {
  const decorations = [];
  return {
    decorations,
    Decoration: {
      mark(spec) {
        return {
          range(from, to) {
            decorations.push({ from, to, class: spec.class });
            return { from, to, value: { spec } };
          },
        };
      },
    },
    syntaxTree,
  };
}

function makeFakeState(doc, syntaxTreeFn) {
  return {
    doc: {
      length: doc.length,
      toString() { return doc; },
      sliceString(f, t) { return doc.slice(f, t); },
      lineAt: () => ({ from: 0, to: doc.length, number: 1 }),
      line:   () => ({ from: 0, to: doc.length, number: 1, text: doc }),
    },
    sliceDoc(f, t) { return doc.slice(f, t); },
    selection: { ranges: [{ from: 0, to: 0 }] },
    field: () => null,
  };
}

// Synthetic tree iterator: replays the provided node list with parent links.
function makeFakeTreeWithParents(nodes) {
  return {
    iterate(spec) {
      for (const n of nodes) {
        const parentNode = n.parentName
          ? { name: n.parentName, parent: null }
          : null;
        spec.enter({
          name: n.name,
          from: n.from,
          to: n.to,
          type: { name: n.name },
          node: { name: n.name, parent: parentNode },
        });
      }
    },
  };
}

// ── Group RED-real-parser (31-1) ────────────────────────────────────────────

test('Stage 31-1 (RED-real-parser): TABLE_FIXTURE produces all five Lezer GFM Table node names', () => {
  const state = makeState(TABLE_FIXTURE);
  const names = collectNodeNames(state);
  for (const expected of ['Table', 'TableHeader', 'TableRow', 'TableCell', 'TableDelimiter']) {
    assert.ok(
      names.has(expected),
      'parser must emit ' + expected + ' (got: ' + Array.from(names).sort().join(',') + ')'
    );
  }
});

// ── Group RED-walker (31-2, 31-3) ───────────────────────────────────────────

test('Stage 31-2 (RED-walker): TABLE_FIXTURE walker emits at least one cm-md-table-pipe', () => {
  const state = makeState(TABLE_FIXTURE);
  const marks = collectMarks(buildHeadingDecorations(state, cm6));
  const pipes = marks.filter((m) => m.class === 'cm-md-table-pipe');
  assert.ok(pipes.length >= 1,
    'walker must emit at least one cm-md-table-pipe (got: ' + pipes.length + ')');
});

test('Stage 31-3 (RED-walker): TABLE_FIXTURE walker emits exactly one cm-md-table-delimiter-row', () => {
  const state = makeState(TABLE_FIXTURE);
  const marks = collectMarks(buildHeadingDecorations(state, cm6));
  const rows = marks.filter((m) => m.class === 'cm-md-table-delimiter-row');
  assert.equal(rows.length, 1,
    'walker must emit exactly one cm-md-table-delimiter-row (got: ' + rows.length + ')');
});

// ── Group TYPE-pipe (31-4, 31-5) ────────────────────────────────────────────
// Fake-tree tests that drive the walker through known parent shapes. These
// exercise the parent.name === 'TableRow' / 'TableHeader' branch directly.

test('Stage 31-4 (TYPE-pipe): TableDelimiter parented by TableRow emits cm-md-table-pipe', () => {
  const fakeCm6 = makeFakeCm6();
  const fakeState = makeFakeState('| x |');
  const fakeTree  = makeFakeTreeWithParents([
    { name: 'TableDelimiter', from: 0, to: 1, parentName: 'TableRow' },
  ]);
  // The walker reads syntax tree via cm6.syntaxTree(state). Stub it.
  fakeCm6.syntaxTree = () => fakeTree;
  buildHeadingDecorations(fakeState, fakeCm6);
  const pipes = fakeCm6.decorations.filter((d) => d.class === 'cm-md-table-pipe');
  assert.equal(pipes.length, 1,
    'one cm-md-table-pipe expected (got: ' + pipes.length + ')');
});

test('Stage 31-5 (TYPE-pipe): TableDelimiter parented by TableHeader emits cm-md-table-pipe', () => {
  const fakeCm6 = makeFakeCm6();
  const fakeState = makeFakeState('| header |');
  const fakeTree  = makeFakeTreeWithParents([
    { name: 'TableDelimiter', from: 0, to: 1, parentName: 'TableHeader' },
  ]);
  fakeCm6.syntaxTree = () => fakeTree;
  buildHeadingDecorations(fakeState, fakeCm6);
  const pipes = fakeCm6.decorations.filter((d) => d.class === 'cm-md-table-pipe');
  assert.equal(pipes.length, 1);
});

// ── Group TYPE-row (31-6) ───────────────────────────────────────────────────

test('Stage 31-6 (TYPE-row): TableDelimiter parented by Table emits cm-md-table-delimiter-row', () => {
  const fakeCm6 = makeFakeCm6();
  const fakeState = makeFakeState('|---|---|');
  const fakeTree  = makeFakeTreeWithParents([
    { name: 'TableDelimiter', from: 0, to: 9, parentName: 'Table' },
  ]);
  fakeCm6.syntaxTree = () => fakeTree;
  buildHeadingDecorations(fakeState, fakeCm6);
  const rows = fakeCm6.decorations.filter((d) => d.class === 'cm-md-table-delimiter-row');
  assert.equal(rows.length, 1);
  const pipes = fakeCm6.decorations.filter((d) => d.class === 'cm-md-table-pipe');
  assert.equal(pipes.length, 0,
    'must NOT also emit cm-md-table-pipe for a Table-parented delimiter (got: ' + pipes.length + ')');
});

// ── Group NEG (31-7, 31-8) ──────────────────────────────────────────────────

test('Stage 31-7 (NEG): TableDelimiter with no parent emits NO table decoration', () => {
  const fakeCm6 = makeFakeCm6();
  const fakeState = makeFakeState('|');
  const fakeTree  = makeFakeTreeWithParents([
    { name: 'TableDelimiter', from: 0, to: 1, parentName: null },
  ]);
  fakeCm6.syntaxTree = () => fakeTree;
  buildHeadingDecorations(fakeState, fakeCm6);
  const tableMarks = fakeCm6.decorations.filter(
    (d) => d.class === 'cm-md-table-pipe' || d.class === 'cm-md-table-delimiter-row'
  );
  assert.equal(tableMarks.length, 0,
    'no table-class decoration emitted for parentless TableDelimiter (got: ' + tableMarks.length + ')');
});

test('Stage 31-8 (NEG): TableDelimiter parented by Paragraph emits NO table decoration', () => {
  const fakeCm6 = makeFakeCm6();
  const fakeState = makeFakeState('not a table');
  const fakeTree  = makeFakeTreeWithParents([
    { name: 'TableDelimiter', from: 0, to: 1, parentName: 'Paragraph' },
  ]);
  fakeCm6.syntaxTree = () => fakeTree;
  buildHeadingDecorations(fakeState, fakeCm6);
  const tableMarks = fakeCm6.decorations.filter(
    (d) => d.class === 'cm-md-table-pipe' || d.class === 'cm-md-table-delimiter-row'
  );
  assert.equal(tableMarks.length, 0,
    'no table-class decoration emitted for Paragraph-parented TableDelimiter');
});

// ── Group CSS-no-leak (31-9) — Stage 32 amendment ─────────────────────────────
//
// Stage 31 originally asserted that index.html contained NO CSS rule for
// either cm-md-table-pipe or cm-md-table-delimiter-row (walker-only stage;
// "Stage 32 adds the first reveal/hide rule"). Stage 32 has shipped those
// rules per its plan, so this test is now a documented contract amendment
// (precedent: Stage 28's amendment of Stage 27 test 27-5; Stage 29 and
// Stage 30 internal-amendments of frozen files). The Stage 32 CSS shape
// (hide off-active + reveal scoped to .cm-md-table-active) is pinned by
// cm6-table-reveal.test.js test 32-CSS-1; this test now serves as a
// regression guard that Stage 32's rules do NOT leak the reveal selector
// outside the scoped .cm-md-table-active context (i.e., no future stage
// silently widens hide/reveal to unscoped or other-construct-scoped CSS).

test('Stage 31-9 (CSS-no-leak, Stage 32 amendment): index.html cm-md-table-pipe / cm-md-table-delimiter-row rules ONLY appear via the Stage 32 hide rules and the .cm-md-table-active reveal scope', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.html'),
    'utf8'
  );
  // Extract CSS between <style>...</style> for selector-shape inspection.
  const cssMatch = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  const css = cssMatch ? cssMatch[1] : '';
  // Strip /* ... */ comments to avoid false matches inside policy comments.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Find every selector that mentions cm-md-table-pipe or
  // cm-md-table-delimiter-row; assert each one is either the bare hide
  // selector or the .cm-md-table-active descendant reveal selector.
  const selectorBlocks = [];
  let i = 0;
  while (i < stripped.length) {
    const brace = stripped.indexOf('{', i);
    if (brace < 0) break;
    const closeBrace = stripped.indexOf('}', brace);
    if (closeBrace < 0) break;
    const selectorText = stripped.slice(i, brace).trim();
    if (selectorText) {
      for (const sel of selectorText.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (sel.includes('cm-md-table-pipe') || sel.includes('cm-md-table-delimiter-row')) {
          selectorBlocks.push(sel);
        }
      }
    }
    i = closeBrace + 1;
  }
  const allowed = new Set([
    '.cm-md-table-pipe',
    '.cm-md-table-delimiter-row',
    '.cm-md-table-active .cm-md-table-pipe',
    '.cm-md-table-active .cm-md-table-delimiter-row',
  ]);
  for (const sel of selectorBlocks) {
    assert.ok(allowed.has(sel),
      'unexpected selector mentioning cm-md-table-* classes: "' + sel
      + '" (only ' + Array.from(allowed).sort().join(' / ') + ' are allowed per the Stage 32 contract)');
  }
});

// ── Group FROZEN (31-10) ────────────────────────────────────────────────────

test('Stage 31-10 (FROZEN): existing walker class emissions are unchanged on a non-table fixture', () => {
  // Fixture exercises ATX heading, list, blockquote, fenced code, task,
  // italic — covers the most fragile cm-md-* classes. None of these should
  // shift after adding the new Table walker branch.
  const fixture = [
    '# Title',
    '',
    '- bullet',
    '- [ ] task',
    '',
    '> quote',
    '',
    '```js',
    'code',
    '```',
    '',
    '*italic*',
    '',
  ].join('\n');
  const state = makeState(fixture);
  const marks = collectMarks(buildHeadingDecorations(state, cm6));
  // Walker emits some classes as combined strings (e.g.,
  // 'cm-md-syntax cm-md-emphasis-mark'). Tokenize before checking.
  const classTokens = new Set();
  for (const m of marks) {
    if (!m.class) continue;
    for (const t of m.class.split(/\s+/)) classTokens.add(t);
  }
  const expected = [
    'cm-md-h1',
    'cm-md-heading-mark',
    'cm-md-list-mark',
    'cm-md-task-marker',
    'cm-md-quote-mark',
    'cm-md-fenced-code-mark',
    'cm-md-fenced-code-info',
    'cm-md-italic',
    'cm-md-emphasis-mark',
  ];
  for (const cls of expected) {
    assert.ok(classTokens.has(cls),
      'expected walker class token ' + cls + ' to be emitted '
      + '(got: ' + Array.from(classTokens).sort().join(',') + ')');
  }
  // Defensive: no Stage 31 table classes on a fixture that has no table.
  assert.ok(!classTokens.has('cm-md-table-pipe'),
    'no cm-md-table-pipe on a fixture with no table');
  assert.ok(!classTokens.has('cm-md-table-delimiter-row'),
    'no cm-md-table-delimiter-row on a fixture with no table');
});

// ── Group PEER-CONTRACT (31-11) ─────────────────────────────────────────────

test('Stage 31-11 (PEER-CONTRACT): cm6-hybrid-view.js source obeys Section H forbidden-token list', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'cm6-hybrid-view.js'),
    'utf8'
  );
  // Mirror EXACTLY the Section H readiness test list in
  // hybrid-cm6-readiness.test.js (Stage 11.11/H invariants). The walker is
  // permitted to MENTION certain tokens in policy comments (e.g., a
  // comment saying "NO <img>" is fine); only the literal forbidden set
  // below is banned. New Stage 31 walker branches must not introduce any
  // of these.
  assert.ok(!src.includes('Decoration.replace'), 'must not contain Decoration.replace');
  assert.ok(!src.includes('WidgetType'),         'must not contain WidgetType');
  assert.ok(!src.includes('HeadingWidget'),      'must not contain HeadingWidget');
  assert.ok(!src.includes('ParagraphWidget'),    'must not contain ParagraphWidget');
  assert.ok(!src.includes('<a'),                 'must not contain "<a" anywhere (no clickable links)');
  assert.ok(!src.includes('href'),               'must not contain "href" anywhere');
  assert.ok(!src.includes("addEventListener('click'"),
    'must not contain addEventListener click handler (single quote)');
  assert.ok(!src.includes('addEventListener("click"'),
    'must not contain addEventListener click handler (double quote)');
});

// ── Group PERF (31-12) ──────────────────────────────────────────────────────

function buildLargeTableCorpus(rows) {
  const out = ['| h1 | h2 | h3 |', '|----|----|----|'];
  for (let i = 0; i < rows; i++) {
    out.push('| r' + i + 'a | r' + i + 'b | r' + i + 'c |');
  }
  return out.join('\n') + '\n';
}

test('Stage 31-12 (PERF): 200-row table walker pass under 1500 ms (parse outside timed block)', () => {
  const corpus = buildLargeTableCorpus(200);
  const state = makeState(corpus);
  // Force parse outside the timed block so we measure only the walker pass.
  syntaxTree(state);
  const t0 = Date.now();
  const decorationSet = buildHeadingDecorations(state, cm6);
  const dt = Date.now() - t0;
  console.log('  [Stage 31-12] 200-row table walker pass:', dt, 'ms');
  // Sanity: walker did emit something.
  const marks = collectMarks(decorationSet);
  const tableMarks = marks.filter(
    (m) => m.class === 'cm-md-table-pipe' || m.class === 'cm-md-table-delimiter-row'
  );
  assert.ok(tableMarks.length > 0,
    'walker must emit at least one table decoration for a 200-row table');
  assert.ok(dt < 1500,
    '200-row table walker pass under 1500 ms (measured ' + dt + ' ms)');
});
