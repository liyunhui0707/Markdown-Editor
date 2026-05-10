/* Stage 15 — hybrid-cm6 performance baseline.
   Run focused:        node --test test/cm6-write-view/hybrid-cm6-perf.test.js
   Run with bench:     PERF_BENCH=1 node --test test/cm6-write-view/...
   Run via npm script: npm run test:perf

   This file establishes a performance baseline for the experimental
   ?writeEngine=hybrid-cm6 Write engine after Stages 11.4–11.9 and 14.1–14.9.
   It is additive: the existing Stage 11.11/G long-document smoke in
   hybrid-cm6-readiness.test.js remains the 11.x regression guard; this file
   adds Stage-14 coverage at scale plus a production-incremental typing loop.

   Default-suite policy:
     - Tests 15-1, 15-4, 15-5 run in every `npm test`. They are bounded by
       loose anti-flake CI thresholds (5–10× a healthy machine's expected
       time), not user-perceived perf budgets.
     - Tests 15-2 (50k-line) and 15-3 (typing loop) are opt-in via
       PERF_BENCH=1 to keep default `npm test` duration small. The npm
       script `test:perf` sets the env automatically.

   Stage 16 (incremental decoration rebuild) is opened only if reported
   numbers cross the softer engineering thresholds documented in the
   approved plan, NOT if these CI-guard thresholds are tripped. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                  = require('@codemirror/state');
const { Decoration }                   = require('@codemirror/view');
const { syntaxTree, ensureSyntaxTree } = require('@codemirror/language');
const { markdown, markdownLanguage }   = require('@codemirror/lang-markdown');
const { Strikethrough }                = require('@lezer/markdown');
const { buildHeadingDecorations }      = require('../../lib/cm6-hybrid-view');
const { performance }                  = require('node:perf_hooks');

const PERF_BENCH = process.env.PERF_BENCH === '1';
const SKIP_OPT_IN = !PERF_BENCH ? 'opt-in: PERF_BENCH=1' : false;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMarkdownState(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({
      base: markdownLanguage,
      codeLanguages: [],
      extensions: [Strikethrough],
    })],
  });
}

function collectMarks(decorationSet) {
  const out = [];
  const cursor = decorationSet.iter();
  while (cursor.value) {
    out.push({
      from: cursor.from,
      to: cursor.to,
      class: cursor.value.spec && cursor.value.spec.class,
    });
    cursor.next();
  }
  return out;
}

// Matches the pattern from heading-marks.test.js so combined-class checks
// (e.g., 'cm-md-syntax cm-md-link-mark') can be probed for any single token.
function hasClassToken(cls, token) {
  return typeof cls === 'string' && cls.split(/\s+/).includes(token);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

// 22-line block exercising every Stage 11.x–14.x styled construct.
// CRITICAL invariants:
//   - The Setext underline alternates by block parity so the corpus produces
//     BOTH SetextHeading1 (even → 20 '=') and SetextHeading2 (odd → 20 '-').
//     Neither underline value is exactly '---' (they are length-20), so the
//     Stage 15-5 fixture-shape assertion (no later '---' line) holds when
//     this block is combined with opts.hr === '***'.
//   - opts.hr defaults to '---'. It controls ONLY the standalone HR line at
//     the end of the block, independent of the Setext underline.
function buildStage14Block(i, opts) {
  opts = opts || {};
  const hr = opts.hr || '---';
  const setextUnderline = (i % 2 === 0)
    ? '===================='
    : '--------------------';
  return [
    '# ATX Heading ' + i,
    '',
    'Setext heading ' + i,
    setextUnderline,
    '',
    'Paragraph ' + i + ' has **bold-' + i + '**, *italic-' + i + '*, `code-' + i + '`, '
      + '~~strike-' + i + '~~, https://example.com/' + i + ', <https://example.com/' + i + '>.',
    '',
    'See [link-' + i + '](https://example.com/' + i + ') and [ref-' + i + '][ref' + i + '].',
    '',
    '[ref' + i + ']: https://example.com/ref' + i + ' "title ' + i + '"',
    '',
    '![image-' + i + '](https://example.com/pic-' + i + '.png)',
    '',
    '- bullet-' + i + '.a',
    '- [ ] task-' + i + '.a',
    '- [x] done-' + i + '.a',
    '',
    '> quoted ' + i,
    '',
    '```js',
    'let x' + i + ' = ' + i + ';',
    '```',
    '',
    hr,
    '',
  ].join('\n');
}

const FRONTMATTER_PREFIX = [
  '---',
  'title: Stage 15 perf corpus',
  'tags: [perf, hybrid-cm6]',
  'generated: true',
  '---',
  '',
].join('\n');

function buildStage14Corpus(blockCount, withFrontmatter) {
  const parts = [];
  if (withFrontmatter) parts.push(FRONTMATTER_PREFIX);
  for (let i = 0; i < blockCount; i++) parts.push(buildStage14Block(i));
  return parts.join('');
}

// detectFrontmatter worst case: leading "---" line plus blocks that contain
// NO later line exactly equal to "---". The block helper uses '***' for its
// standalone HR line; the Setext underline (length 20) is never exactly '---'.
function buildCorpusLeadingDashNoClosing(blockCount) {
  const parts = ['---\n'];
  for (let i = 0; i < blockCount; i++) {
    parts.push(buildStage14Block(i, { hr: '***' }));
  }
  return parts.join('');
}

// Force a full parse outside the timed window, discard a warm-up build, then
// time only buildHeadingDecorations. Returns { parseMs, buildMs, marks }.
// parseMs is reported so a reviewer can attribute time correctly.
function measureFullParseAndBuild(state) {
  const parseStart = performance.now();
  const fullTree = ensureSyntaxTree(state, state.doc.length, 30_000);
  const parseMs = performance.now() - parseStart;
  if (!fullTree || fullTree.length !== state.doc.length) {
    throw new Error('ensureSyntaxTree did not complete within budget');
  }
  const cm6Forced = { Decoration, syntaxTree: () => fullTree };
  // Warm-up — discarded.
  buildHeadingDecorations(state, cm6Forced);
  // Timed.
  const buildStart = performance.now();
  const set = buildHeadingDecorations(state, cm6Forced);
  const buildMs = performance.now() - buildStart;
  return { parseMs, buildMs, marks: collectMarks(set) };
}

// ── Stage 15-1: 10k-line Stage-14 corpus, default suite ────────────────────

test('Stage 15-1: decoration build after forced full parse, 10k-line Stage-14 corpus', () => {
  // 455 blocks × ~22 lines + 6-line frontmatter prefix ≈ 10 016 lines.
  // Forced full parse via ensureSyntaxTree; only buildHeadingDecorations is
  // timed. The 8000 ms threshold is an anti-flake CI guard, NOT a perf
  // budget — Stage 16 escalation thresholds are softer (see approved plan).
  const blockCount = 455;
  const doc = buildStage14Corpus(blockCount, true);
  const lineCount = doc.split('\n').length;
  assert.ok(lineCount >= 10000,
    'corpus must be ≥10 000 lines (got ' + lineCount + ')');

  const state = makeMarkdownState(doc);
  const { parseMs, buildMs, marks } = measureFullParseAndBuild(state);

  assert.ok(buildMs < 8000,
    'build_after_full_parse_ms must be < 8000 (got ' + buildMs.toFixed(1) + ' ms, parse_ms=' + parseMs.toFixed(1) + ')');

  // Container-class coverage: every styled Markdown family must fire on the
  // corpus. The cm-md-h2 entry specifically depends on the Setext underline
  // alternation in buildStage14Block — if it fails, fix the generator, do
  // NOT relax the assertion.
  const containerClasses = [
    'cm-md-h1', 'cm-md-h2', 'cm-md-heading-mark',
    'cm-md-bold', 'cm-md-italic', 'cm-md-inline-code',
    'cm-md-link-text', 'cm-md-reflink-text', 'cm-md-link-def',
    'cm-md-image-alt',
    'cm-md-list-mark', 'cm-md-quote-mark',
    'cm-md-fenced-code-mark', 'cm-md-fenced-code-info',
    'cm-md-hr', 'cm-md-strikethrough', 'cm-md-task-marker',
    'cm-md-autolink-url',
  ];
  for (const cls of containerClasses) {
    const n = marks.filter((m) => m.class === cls).length;
    assert.ok(n > 0, 'container class ' + cls + ' must fire on the corpus (got 0)');
  }

  // Marker-token coverage: combined-class marks must include each token.
  const markerTokens = [
    'cm-md-emphasis-mark', 'cm-md-code-mark', 'cm-md-link-mark',
    'cm-md-reflink-mark', 'cm-md-image-mark', 'cm-md-autolink-mark',
    'cm-md-strikethrough-mark', 'cm-md-syntax',
  ];
  for (const token of markerTokens) {
    const n = marks.filter((m) => hasClassToken(m.class, token)).length;
    assert.ok(n > 0, 'marker token ' + token + ' must fire on the corpus (got 0)');
  }

  // Source-of-truth invariant.
  assert.equal(state.doc.toString(), doc,
    'state.doc must equal the input verbatim after buildHeadingDecorations');

  console.log('Stage 15-1: build_after_full_parse_ms=' + buildMs.toFixed(1)
    + ' parse_ms=' + parseMs.toFixed(1)
    + ' total_marks=' + marks.length
    + ' lines=' + lineCount);
});

// ── Stage 15-2: 50k-line Stage-14 corpus, opt-in ───────────────────────────

test('Stage 15-2: decoration build after forced full parse, 50k-line Stage-14 corpus', { skip: SKIP_OPT_IN }, () => {
  // 2 273 blocks × ~22 lines + 6-line frontmatter ≈ 50 012 lines.
  const blockCount = 2273;
  const doc = buildStage14Corpus(blockCount, true);
  const lineCount = doc.split('\n').length;
  assert.ok(lineCount >= 50000,
    'corpus must be ≥50 000 lines (got ' + lineCount + ')');

  const state = makeMarkdownState(doc);
  const { parseMs, buildMs, marks } = measureFullParseAndBuild(state);

  assert.ok(buildMs < 40000,
    'build_after_full_parse_ms must be < 40000 (got ' + buildMs.toFixed(1) + ' ms, parse_ms=' + parseMs.toFixed(1) + ')');
  assert.ok(marks.length > 0, 'corpus must produce non-zero decorations at 50k scale');
  assert.equal(state.doc.toString(), doc, 'state.doc must be unchanged after the 50k build');

  console.log('Stage 15-2: build_after_full_parse_ms=' + buildMs.toFixed(1)
    + ' parse_ms=' + parseMs.toFixed(1)
    + ' total_marks=' + marks.length
    + ' lines=' + lineCount);
});

// ── Stage 15-3: typing-loop production-incremental smoke, opt-in ───────────

test('Stage 15-3: production-incremental typing smoke, mid-document inserts, 10k-line corpus', { skip: SKIP_OPT_IN }, () => {
  // PRODUCTION-INCREMENTAL SEMANTICS. Each insert is applied via
  // state.update({ changes }); after each update, buildHeadingDecorations
  // runs against a NON-FORCED cm6 namespace, meaning syntaxTree(state)
  // returns whatever Lezer has incrementally produced so far. This is the
  // same path the production ViewPlugin's update() callback exercises per
  // keystroke. The metric below is the user-visible "is typing slow" cost
  // on a long note under partial-parse conditions; it does NOT bound
  // worst-case full-tree edit cost.
  const blockCount = 455;
  let state = makeMarkdownState(buildStage14Corpus(blockCount, false));
  const insertPos = Math.floor(state.doc.length / 2);
  const cm6 = { Decoration, syntaxTree };

  // Warm-up: one insert + build, discarded.
  state = state.update({ changes: { from: insertPos, insert: 'x' } }).state;
  buildHeadingDecorations(state, cm6);

  const N = 100;
  const perEditMs = [];
  for (let k = 0; k < N; k++) {
    const t0 = performance.now();
    state = state.update({ changes: { from: insertPos, insert: 'x' } }).state;
    buildHeadingDecorations(state, cm6);
    perEditMs.push(performance.now() - t0);
  }

  const total = perEditMs.reduce((a, b) => a + b, 0);
  const sorted = perEditMs.slice().sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);

  assert.ok(total < 30000,
    'typing_loop_total_ms must be < 30000 (got ' + total.toFixed(1) + ' ms over ' + N + ' inserts)');
  assert.ok(p95 < 500,
    'typing_loop_p95_ms must be < 500 (got ' + p95.toFixed(1) + ' ms; total=' + total.toFixed(1) + ' p50=' + p50.toFixed(1) + ')');

  console.log('Stage 15-3: typing_loop_incremental_inserts=' + N
    + ' total_ms=' + total.toFixed(1)
    + ' p50_ms=' + p50.toFixed(1)
    + ' p95_ms=' + p95.toFixed(1));
});

// ── Stage 15-4: 10k-line Stage-14 corpus WITHOUT frontmatter, default suite ─

test('Stage 15-4: decoration build, 10k-line corpus WITHOUT frontmatter', () => {
  // Absolute threshold, NOT a delta against Stage 15-1 — wall-clock deltas
  // across separate heavy builds are too noisy to assert on.
  const blockCount = 455;
  const doc = buildStage14Corpus(blockCount, false);
  const lineCount = doc.split('\n').length;
  assert.ok(lineCount >= 10000,
    'corpus must be ≥10 000 lines (got ' + lineCount + ')');

  const state = makeMarkdownState(doc);
  const { parseMs, buildMs, marks } = measureFullParseAndBuild(state);

  assert.ok(buildMs < 8000,
    'build_after_full_parse_ms must be < 8000 (got ' + buildMs.toFixed(1) + ' ms, parse_ms=' + parseMs.toFixed(1) + ')');
  assert.ok(marks.length > 0, 'no-frontmatter corpus must still produce decorations');

  console.log('Stage 15-4: no_frontmatter build_after_full_parse_ms=' + buildMs.toFixed(1)
    + ' parse_ms=' + parseMs.toFixed(1)
    + ' (compare manually with 15-1)');
});

// ── Stage 15-5: detectFrontmatter worst case — leading "---", no closing ───

test('Stage 15-5: decoration build, 10k-line corpus with leading "---" but NO closing fence', () => {
  // Worst case for detectFrontmatter: line 1 is "---" so the helper enters
  // its scan loop, and no later line is "---" so it scans every line and
  // returns null. The walker then proceeds normally; the leading "---" is
  // emitted as a real HorizontalRule.
  const blockCount = 455;
  const doc = buildCorpusLeadingDashNoClosing(blockCount);
  const lines = doc.split('\n');

  // Fixture-shape sanity assertions — load-bearing. If either fails, the
  // corpus has drifted into accidental frontmatter and the test no longer
  // exercises the intended worst case. Fix the generator, NOT the asserts.
  assert.equal(lines[0], '---',
    'leading fence must be exactly --- for the worst-case test');
  assert.equal(lines.slice(1).filter((line) => line === '---').length, 0,
    'no line after line 1 may be exactly "---", or detectFrontmatter will '
    + 'return a valid range and the test no longer exercises the worst case '
    + '(alternating Setext underlines must remain "====" / "----" length 20, '
    + 'never exactly "---")');
  assert.ok(lines.length >= 10001,
    'corpus must be ≥10 000 lines (got ' + lines.length + ')');

  const state = makeMarkdownState(doc);
  const { parseMs, buildMs, marks } = measureFullParseAndBuild(state);

  assert.ok(buildMs < 8000,
    'build_after_full_parse_ms must be < 8000 (got ' + buildMs.toFixed(1) + ' ms, parse_ms=' + parseMs.toFixed(1) + ')');

  // HR-emission proof: the leading "---" is NOT suppressed by detectFrontmatter
  // (no closing fence → null → suppression guard never fires), so the walker
  // emits it as a normal HorizontalRule decoration.
  const hrs = marks.filter((m) => m.class === 'cm-md-hr');
  assert.ok(hrs.length >= 1,
    'leading "---" must emit at least one cm-md-hr mark (got 0)');
  assert.ok(hrs.some((m) => m.from === 0 && m.to === 3),
    'one cm-md-hr mark must cover the leading [0, 3] range');

  console.log('Stage 15-5: leading_dash_no_closing build_after_full_parse_ms=' + buildMs.toFixed(1)
    + ' parse_ms=' + parseMs.toFixed(1)
    + ' hr_count=' + hrs.length
    + ' (detectFrontmatter scans every line, leading "---" stays an HR)');
});
