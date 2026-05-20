/* Stage 29 Part A — Setext cross-line reveal tests.
   Run focused:
     node --test test/cm6-write-view/cm6-stage29-setext.test.js

   Tests (5, REAL Markdown parser):
     29-1   SetextHeading1 detected when caret on title line
     29-2   SetextHeading1 detected when caret on === underline line
     29-3   SetextHeading2 detected when caret on title line (--- underline)
     29-4   Outside Setext (caret on body line) — no SetextHeading entry
     29-5   buildConstructActiveDecorations emits class on both title + underline

   Per Codex rev-1 finding B1: fixtures use REAL Setext syntax
   (Title\n===\n... — no leading `#`/`##`). ATX-prefixed syntax like
   `# Title\n===` parses as ATXHeading + (paragraph or HorizontalRule),
   NOT SetextHeading.

   Per the spec: all 5 tests use the production Markdown parser via
   loadCm6Bundle() + cm6.EditorState.create({extensions:[cm6.markdown()]})
   + cm6.syntaxTree(state). Hand-built fake trees would not catch the
   real parser's node naming.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const CONSTRUCT_REL = '../../lib/cm6-construct-reveal.js';

function loadConstructRevealModule() {
  // Codex rev-2 M1 fix: do NOT pre-require cm6-line-utils.js. The
  // consumer module's CommonJS UMD branch (added in Batch 2) loads
  // it transitively. At Batch 1 (before the refactor), the consumer
  // still has its local copy — these Setext tests do NOT exercise
  // resolveTouchedLines directly, so the absence of cm6-line-utils
  // doesn't matter for the RED→GREEN signal of 29-1..29-5.
  delete require.cache[require.resolve(CONSTRUCT_REL)];
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

// ── Group A — Setext cross-line reveal (5 real-parser tests) ──

test('Stage 29-1: findActiveConstructs returns SetextHeading1 entry when caret on title line (real parser)', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  // Real Setext H1: title followed by ====
  const { state, tree } = buildRealStateAndTree('Title\n====\nbody\n');
  // Line 1 = 'Title'
  const titleLine = state.doc.line(1);
  const touched = new Set([titleLine.number]);
  const constructs = findActiveConstructs(tree, state.doc, touched);
  const setext1 = constructs.find((c) => c.type === 'SetextHeading1');
  assert.ok(setext1, 'expected a SetextHeading1 entry');
  assert.equal(setext1.fromLine, 1);
  assert.equal(setext1.toLine, 2);
});

test('Stage 29-2: findActiveConstructs returns SetextHeading1 entry when caret on === underline line', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  const { state, tree } = buildRealStateAndTree('Title\n====\nbody\n');
  const underlineLine = state.doc.line(2);
  const touched = new Set([underlineLine.number]);
  const constructs = findActiveConstructs(tree, state.doc, touched);
  const setext1 = constructs.find((c) => c.type === 'SetextHeading1');
  assert.ok(setext1, 'expected a SetextHeading1 entry');
  assert.equal(setext1.fromLine, 1);
  assert.equal(setext1.toLine, 2);
});

test('Stage 29-3: findActiveConstructs returns SetextHeading2 entry when caret on title line (real parser, 3-dash underline)', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  // Codex rev-2 m2 fix: use the canonical 3-dash Setext H2 syntax
  // (`---`), the ambiguous/common case that historically overlaps with
  // HorizontalRule and YAML frontmatter logic. 4-dash `----` works too
  // but doesn't exercise the disambiguation edge.
  const { state, tree } = buildRealStateAndTree('Title\n---\nbody\n');
  const titleLine = state.doc.line(1);
  const touched = new Set([titleLine.number]);
  const constructs = findActiveConstructs(tree, state.doc, touched);
  const setext2 = constructs.find((c) => c.type === 'SetextHeading2');
  assert.ok(setext2, 'expected a SetextHeading2 entry');
  assert.equal(setext2.fromLine, 1);
  assert.equal(setext2.toLine, 2);
});

test('Stage 29-4: findActiveConstructs returns no SetextHeading entry when caret outside the heading construct', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  const { state, tree } = buildRealStateAndTree('Title\n====\nbody paragraph\n');
  // Line 3 = 'body paragraph' (outside Setext)
  const bodyLine = state.doc.line(3);
  const touched = new Set([bodyLine.number]);
  const constructs = findActiveConstructs(tree, state.doc, touched);
  const setext = constructs.find(
    (c) => c.type === 'SetextHeading1' || c.type === 'SetextHeading2',
  );
  assert.equal(setext, undefined, 'no SetextHeading construct should match when caret is on the body line');
});

test('Stage 29-5: buildConstructActiveDecorations emits cm-md-construct-active on both Setext lines (title + ===)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('Title\n====\nbody\n');
  const titleLine = state.doc.line(1);
  const stateWithSel = Object.assign({}, state, {
    selection: { ranges: [{ from: titleLine.from, to: titleLine.from }] },
  });
  const decorations = buildConstructActiveDecorations(stateWithSel, cm6, tree);
  assert.ok(decorations, 'decoration set returned');

  // Iterate the RangeSet via _ranges or iter().
  const seen = [];
  if (decorations._ranges) {
    for (const r of decorations._ranges) seen.push({ from: r.from, cls: r.value && r.value.spec && r.value.spec.class });
  } else if (typeof decorations.iter === 'function') {
    const it = decorations.iter();
    while (it.value) {
      seen.push({ from: it.from, cls: it.value.spec && it.value.spec.class });
      it.next();
    }
  } else {
    throw new Error('decoration set has neither _ranges nor iter()');
  }

  // Filter to only the Setext lines (in case other constructs slipped in).
  const setextLineFroms = [state.doc.line(1).from, state.doc.line(2).from];
  const setextDecorations = seen.filter((s) => setextLineFroms.includes(s.from));
  assert.equal(setextDecorations.length, 2, 'exactly 2 decorations on the Setext title + underline lines');
  // Rev-4 fix: Setext lines carry BOTH cm-md-construct-active (for
  // Stage 28 contract) AND cm-md-setext-active (for the Stage 29
  // Setext-scoped heading-mark reveal CSS). Tokenize class string.
  for (const d of setextDecorations) {
    const tokens = String(d.cls || '').split(/\s+/);
    assert.ok(tokens.includes('cm-md-construct-active'),
      'Setext-line decoration must include cm-md-construct-active token');
    assert.ok(tokens.includes('cm-md-setext-active'),
      'Setext-line decoration must include cm-md-setext-active token (rev-4 fix)');
  }
});

// ── Group A regression — Stage 14.7 / cross-construct heading-mark leakage ──

test('Stage 29-16 (rev-4 leakage regression): blockquote containing an ATX heading does NOT reveal the ATX # marker when caret is on a non-heading blockquote line', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree(
    '> # ATX inside blockquote\n> body line\n'
  );
  // Caret on line 2 (body of the blockquote — NOT the heading line).
  const bodyLine = state.doc.line(2);
  const stateWithSel = Object.assign({}, state, {
    selection: { ranges: [{ from: bodyLine.from, to: bodyLine.from }] },
  });
  const decorations = buildConstructActiveDecorations(stateWithSel, cm6, tree);
  assert.ok(decorations, 'decoration set returned');

  // Collect emitted line decorations.
  const seen = [];
  if (decorations._ranges) {
    for (const r of decorations._ranges) {
      seen.push({ from: r.from, cls: r.value && r.value.spec && r.value.spec.class });
    }
  } else if (typeof decorations.iter === 'function') {
    const it = decorations.iter();
    while (it.value) {
      seen.push({ from: it.from, cls: it.value.spec && it.value.spec.class });
      it.next();
    }
  }

  // Critical: NO decoration on any line carries cm-md-setext-active —
  // because there are no Setext constructs in the doc (only a Blockquote
  // containing an ATX heading).
  for (const d of seen) {
    const tokens = String(d.cls || '').split(/\s+/);
    assert.ok(!tokens.includes('cm-md-setext-active'),
      'no line decoration may carry cm-md-setext-active when only Blockquote+ATX are active — this is the cross-construct leakage fix (Codex Stage 29 diff-review finding)');
  }
});
