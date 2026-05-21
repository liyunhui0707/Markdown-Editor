/* Stage 32 — GFM table reveal tests.
   Run focused:
     node --test test/cm6-write-view/cm6-table-reveal.test.js

   Stage 32 extends Stage 28's construct-reveal mechanism to Table so
   the cm-md-table-pipe and cm-md-table-delimiter-row marks emitted by
   the Stage 31 walker hide off-table-active and reveal on-table-active.
   The reveal is SCOPED to a new class cm-md-table-active (mirrors the
   Stage 30 cm-md-list-item-active pattern) — Table lines do NOT carry
   the generic cm-md-construct-active class. This prevents cross-
   construct leakage. The two LEAK regression tests in this file pin:
     - 32-LEAK-1: caret on a Blockquote intro line that contains a
       nested Table does NOT emit cm-md-table-active on the nested
       table lines (the Stage 32 reveal selector cannot fire because
       the table interior never receives the scoped class when the
       caret is outside the table itself).
     - 32-LEAK-2: caret on an outer ListItem's mark line that contains
       a nested Table does NOT emit cm-md-table-active on the nested
       table lines (same scoped-class mechanism, list direction).
   The reverse direction (caret inside an active Table preventing
   Stage 28's .cm-md-construct-active .cm-md-quote-mark selector from
   leaking onto a nested blockquote interior) is enforced
   architecturally — Table lines never carry cm-md-construct-active —
   but is NOT pinned by a dedicated regression test in this stage;
   deferred to a Stage 33+ broader LEAK matrix.

   Tests are grouped:
     RED  — primary headline assertions       (32-RED-1..2)
     TYPE — findActiveConstructs entry type   (32-TYPE-1)
     NEG  — generic-class leakage guard       (32-NEG-1..2)
     EDGE — empty cells / single row          (32-EDGE-1)
     FM   — frontmatter suppression           (32-FM-1)
     CSS  — index.html invariant scan         (32-CSS-1)
     LEAK — cross-construct leakage guards    (32-LEAK-1..2)
     PERF — large-table corpus                (32-PERF-1)

   Helpers mirror the Stage 30 test scaffolding (intentional local
   duplication; out of scope to share). Real parser via loadCm6Bundle. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const CONSTRUCT_REL    = '../../lib/cm6-construct-reveal.js';
const LINE_UTILS_REL   = '../../lib/cm6-line-utils.js';
const INDEX_HTML_PATH  = path.join(__dirname, '..', '..', 'index.html');

// Canonical fixture — reuses the Stage 31 walker-prep TABLE_FIXTURE so
// both stages refer to the same three-line GFM table.
const TABLE_FIXTURE = '| a | b |\n|---|---|\n| c | d |\n';

// ── Lazy loaders ────────────────────────────────────────────────────────────

function loadConstructRevealModule() {
  delete require.cache[require.resolve(CONSTRUCT_REL)];
  require(LINE_UTILS_REL);
  return require(CONSTRUCT_REL);
}

function loadCm6Bundle() {
  if (!global.window) global.window = {};
  if (!global.window.CM6Production) {
    require('../../lib/cm6-bundle.js');
  }
  return global.window.CM6Production;
}

function buildRealStateAndTree(doc) {
  const cm6 = loadCm6Bundle();
  const state = cm6.EditorState.create({ doc, extensions: [cm6.markdown()] });
  const tree = cm6.syntaxTree(state);
  return { cm6, state, tree };
}

function collectLineDecorations(decorations) {
  const seen = [];
  if (!decorations) return seen;
  if (decorations._ranges) {
    for (const r of decorations._ranges) {
      const cls = r.value && r.value.spec && r.value.spec.class;
      seen.push({ from: r.from, tokens: String(cls || '').split(/\s+/).filter(Boolean) });
    }
    return seen;
  }
  if (typeof decorations.iter === 'function') {
    const it = decorations.iter();
    while (it.value) {
      const cls = it.value.spec && it.value.spec.class;
      seen.push({ from: it.from, tokens: String(cls || '').split(/\s+/).filter(Boolean) });
      it.next();
    }
  }
  return seen;
}

function decoratedFromsWithToken(decorations, token) {
  return collectLineDecorations(decorations)
    .filter((d) => d.tokens.includes(token))
    .map((d) => d.from);
}

// ── CSS helpers (mirror Stage 30's pattern) ────────────────────────────────

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

function tokensOf(selector) {
  return selector.split(/\s+/).filter(Boolean);
}

function parseDeclarations(body) {
  const decls = [];
  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const property = trimmed.slice(0, colon).trim();
    const value    = trimmed.slice(colon + 1).trim();
    if (property && value) decls.push({ property, value });
  }
  return decls;
}

function hasExactSelectorTokens(selectors, expectedTokens) {
  return selectors.some((sel) => {
    const t = tokensOf(sel);
    if (t.length !== expectedTokens.length) return false;
    for (let i = 0; i < t.length; i++) if (t[i] !== expectedTokens[i]) return false;
    return true;
  });
}

function loadHtmlRules() {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  return { html, rules: parseCssRules(extractCss(html)) };
}

// ─────────────────────────────────────────────────────────────────────────
// Group RED — primary headline assertions
// ─────────────────────────────────────────────────────────────────────────

test('Stage 32-RED-1: caret on table body row decorates ALL three table lines with cm-md-table-active (real parser)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree(TABLE_FIXTURE);
  const bodyLine = state.doc.line(3);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: bodyLine.from + 2, to: bodyLine.from + 2 }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  assert.ok(decos, 'decoration set returned');
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  const expected = [state.doc.line(1).from, state.doc.line(2).from, state.doc.line(3).from];
  for (const f of expected) {
    assert.ok(tableActiveFroms.includes(f),
      'line at from=' + f + ' must carry cm-md-table-active (got: ' + tableActiveFroms.join(',') + ')');
  }
  assert.equal(tableActiveFroms.length, 3,
    'exactly 3 lines should carry cm-md-table-active (got ' + tableActiveFroms.length + ')');
});

test('Stage 32-RED-2: caret OUTSIDE the table emits NO cm-md-table-active', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const doc = TABLE_FIXTURE + '\nnot a table\n';
  const { state, tree, cm6 } = buildRealStateAndTree(doc);
  const offLine = state.doc.line(5);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: offLine.from + 2, to: offLine.from + 2 }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  assert.equal(tableActiveFroms.length, 0,
    'no line should carry cm-md-table-active when caret is off the table (got ' + tableActiveFroms.length + ')');
});

// ─────────────────────────────────────────────────────────────────────────
// Group TYPE — findActiveConstructs entry type
// ─────────────────────────────────────────────────────────────────────────

test('Stage 32-TYPE-1: findActiveConstructs returns construct type=Table (not TableRow/TableHeader)', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  const { state, tree } = buildRealStateAndTree(TABLE_FIXTURE);
  const headerLine = state.doc.line(1);
  const touched = new Set([headerLine.number]);
  const constructs = findActiveConstructs(tree, state.doc, touched);
  const types = constructs.map((c) => c.type);
  assert.ok(types.includes('Table'),
    'findActiveConstructs must return a Table entry (got types: [' + types.join(',') + '])');
  assert.equal(types.filter((t) => t === 'TableRow').length, 0,
    'must NOT return TableRow entries directly (Table is the container)');
  assert.equal(types.filter((t) => t === 'TableHeader').length, 0,
    'must NOT return TableHeader entries directly');
});

// ─────────────────────────────────────────────────────────────────────────
// Group NEG — generic-class leakage guard (Stage 30 parity)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 32-NEG-1: Table lines do NOT carry cm-md-construct-active token', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree(TABLE_FIXTURE);
  const bodyLine = state.doc.line(3);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: bodyLine.from + 2, to: bodyLine.from + 2 }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const constructActiveFroms = decoratedFromsWithToken(decos, 'cm-md-construct-active');
  // If the table is the only active construct, NO line should have the
  // generic class — same leakage-prevention contract as Stage 30 ListItem.
  assert.equal(constructActiveFroms.length, 0,
    'no Table line should carry cm-md-construct-active (got ' + constructActiveFroms.length + ' lines with that token)');
});

test('Stage 32-NEG-2: caret in fenced code emits cm-md-construct-active but NO cm-md-table-active', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('```js\ncode\n```\n');
  const codeLine = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: codeLine.from, to: codeLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  assert.equal(tableActiveFroms.length, 0,
    'fenced-code-active lines must not carry cm-md-table-active');
  const constructActiveFroms = decoratedFromsWithToken(decos, 'cm-md-construct-active');
  assert.ok(constructActiveFroms.length >= 3,
    'fenced code should still emit cm-md-construct-active on its lines (Stage 28 preserved); got ' + constructActiveFroms.length);
});

// ─────────────────────────────────────────────────────────────────────────
// Group EDGE — empty cells / minimal table shape
// ─────────────────────────────────────────────────────────────────────────

test('Stage 32-EDGE-1: empty-cell table still emits a Table construct with cm-md-table-active on all lines', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const empty = '|  |  |\n|--|--|\n|  |  |\n';
  const { state, tree, cm6 } = buildRealStateAndTree(empty);
  const headerLine = state.doc.line(1);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: headerLine.from, to: headerLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  assert.equal(tableActiveFroms.length, 3,
    'empty-cell table should still get cm-md-table-active on all 3 lines (got ' + tableActiveFroms.length + ')');
});

// ─────────────────────────────────────────────────────────────────────────
// Group FM — frontmatter suppression (D8 guard)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 32-FM-1: table inside frontmatter region is skipped by the D8 frontmatter guard', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  // Frontmatter region '---\n...\n---\n' encloses what looks like a
  // table; the D8 guard must skip any construct whose node.from is
  // inside the frontmatter, so no cm-md-table-active emission.
  const docText = '---\n| a | b |\n|---|---|\n---\nbody\n';
  const { state, tree, cm6 } = buildRealStateAndTree(docText);
  const line2 = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: line2.from, to: line2.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  assert.equal(tableActiveFroms.length, 0,
    'no cm-md-table-active should be emitted for a table inside the frontmatter region (got ' + tableActiveFroms.length + ')');
});

// ─────────────────────────────────────────────────────────────────────────
// Group CSS — index.html invariant scan
// ─────────────────────────────────────────────────────────────────────────

test('Stage 32-CSS-1: index.html has hide + reveal CSS for cm-md-table-pipe + cm-md-table-delimiter-row scoped to cm-md-table-active', () => {
  const { rules } = loadHtmlRules();

  // Hide off-active: at least one rule whose selector set INCLUDES
  // exactly the .cm-md-table-pipe single-token selector with display:
  // none, AND a similar one for .cm-md-table-delimiter-row. Both may
  // be in a single grouped rule (selectors: ['.cm-md-table-pipe',
  // '.cm-md-table-delimiter-row']) or two separate rules.
  const hidePipe = rules.filter((r) =>
    hasExactSelectorTokens(r.selectors, ['.cm-md-table-pipe'])
    && parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'none')
  );
  const hideRow = rules.filter((r) =>
    hasExactSelectorTokens(r.selectors, ['.cm-md-table-delimiter-row'])
    && parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'none')
  );
  assert.ok(hidePipe.length >= 1, 'hide rule for .cm-md-table-pipe must exist');
  assert.ok(hideRow.length >= 1,  'hide rule for .cm-md-table-delimiter-row must exist');

  // Reveal on-active: at least one rule whose selectors INCLUDE the
  // ['.cm-md-table-active', '.cm-md-table-pipe'] descendant pair with
  // display: inline + opacity: 0.5, and similarly for delimiter-row.
  const revealPipe = rules.filter((r) =>
    hasExactSelectorTokens(r.selectors, ['.cm-md-table-active', '.cm-md-table-pipe'])
    && parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'inline')
    && parseDeclarations(r.body).some((d) => d.property === 'opacity' && d.value === '0.5')
  );
  const revealRow = rules.filter((r) =>
    hasExactSelectorTokens(r.selectors, ['.cm-md-table-active', '.cm-md-table-delimiter-row'])
    && parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'inline')
    && parseDeclarations(r.body).some((d) => d.property === 'opacity' && d.value === '0.5')
  );
  assert.ok(revealPipe.length >= 1, 'reveal rule for .cm-md-table-active .cm-md-table-pipe must exist with display: inline + opacity: 0.5');
  assert.ok(revealRow.length >= 1,  'reveal rule for .cm-md-table-active .cm-md-table-delimiter-row must exist with display: inline + opacity: 0.5');
});

// ─────────────────────────────────────────────────────────────────────────
// Group LEAK — cross-construct leakage guards
// ─────────────────────────────────────────────────────────────────────────

test('Stage 32-LEAK-1: blockquote containing nested table — caret on the blockquote intro emits no cm-md-table-active', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  // Blockquote with table interior. Caret on the intro line emits
  // cm-md-construct-active on the blockquote lines (Stage 28); the
  // table interior must NOT carry cm-md-table-active because the
  // caret never touches it.
  const docText = '> intro\n> | a | b |\n> |---|---|\n> | c | d |\n> closing\n';
  const { state, tree, cm6 } = buildRealStateAndTree(docText);
  const intro = state.doc.line(1);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: intro.from + 2, to: intro.from + 2 }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  assert.equal(tableActiveFroms.length, 0,
    'no cm-md-table-active should leak from a Blockquote-intro caret to a nested table');
});

test('Stage 32-LEAK-2: list item containing nested table — caret on outer ListMark emits no cm-md-table-active', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  // List item with table interior. Caret on outer "- outer" line; the
  // nested table lines (if Lezer parses them as Table here) must NOT
  // carry cm-md-table-active.
  const docText = '- outer\n  | a | b |\n  |---|---|\n  | c | d |\n- second\n';
  const { state, tree, cm6 } = buildRealStateAndTree(docText);
  const outer = state.doc.line(1);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: outer.from + 2, to: outer.from + 2 }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  assert.equal(tableActiveFroms.length, 0,
    'no cm-md-table-active should leak from outer ListMark caret to a nested table');
});

// ─────────────────────────────────────────────────────────────────────────
// Group PERF — large-table corpus
// ─────────────────────────────────────────────────────────────────────────

function build100RowTable() {
  const out = ['| h1 | h2 | h3 |', '|----|----|----|'];
  for (let i = 0; i < 100; i++) {
    out.push('| r' + i + 'a | r' + i + 'b | r' + i + 'c |');
  }
  return out.join('\n') + '\n';
}

test('Stage 32-PERF-1: 100-row table corpus — buildConstructActiveDecorations wall-clock under 1500 ms (caret on middle row)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const corpus = build100RowTable();
  const { state, tree, cm6 } = buildRealStateAndTree(corpus);
  // Caret on a middle data row.
  const middle = state.doc.line(50);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: middle.from + 2, to: middle.from + 2 }] },
  });
  const t0 = Date.now();
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const dt = Date.now() - t0;
  console.log('  [Stage 32-PERF-1] 100-row table middle-row build wall-clock:', dt, 'ms');
  const tableActiveFroms = decoratedFromsWithToken(decos, 'cm-md-table-active');
  assert.ok(tableActiveFroms.length >= 100,
    '100-row table should emit cm-md-table-active on at least 100 lines (got ' + tableActiveFroms.length + ')');
  assert.ok(dt < 1500,
    '100-row table walker pass under 1500 ms (measured ' + dt + ' ms)');
});
