# Tiptap currency/math delimiter fix — 2026-09-08

## Approved task understood

The user explicitly approved Pandoc-style dollar-delimiter rules after review
of the compatibility tradeoff. In Tiptap, `$x$` and `$5$` remain math; `$ x $`
and `$x$2` become literal text. Currency before a valid formula must not swallow
that formula. No default-engine change, sibling-project change or Git shipping.

## Minimal implementation scope

One 51-line adapter wraps `remark-math` at the tokenizer/serializer boundary.
The existing Markdown converter, math nodes, KaTeX, IPC, importers and fallback
engines are unchanged. No dependencies, lockfile or version edits in this task;
the combined working patch remains unreleased 0.18.0.

The approved boundary rule comes from the
[Pandoc manual](https://pandoc.org/MANUAL.html#math): non-whitespace just inside
single-dollar delimiters and no following digit. This is not a full Pandoc
parser port: existing remark display and multi-dollar inline behavior is retained.

## Tests added or updated first

The initial 18 tests ran before implementation: 2 passed and 16 failed. Fifteen
failures captured the new semantics/serialization requirements; one was an
over-strict assertion expecting an unescaped dollar in a serialized link URL.
That assertion was corrected to check the reopened URL's actual value, without
changing production URL behavior. After implementation all 18 passed.

Added a further serialization matrix (18 atom/suffix combinations in one test)
and an actual-entry factory regression for Source/Rich and undo. Final additions:
19 delimiter tests plus one factory test; 20 new tests in total.

Coverage includes currency before math, two prices, numeric formulas, spaces,
tabs, newlines, Unicode whitespace, digit-following closers, later valid math,
escaped dollars, code, links, raw HTML, tables, marks, frontmatter, display math,
multi-dollar inline math, embedded dollar runs, save/reopen and normalization.

## Implementation changes made

- Delegate tokenization to remark and reject single-dollar candidates with
  invalid boundaries through micromark's normal rollback path. No raw-source
  preprocessing, source-offset changes or formula-content guessing.
- Keep remark's existing writer except when a single-dollar formula would be
  rejected on reopen: use a sufficiently long multi-dollar fence for edge
  whitespace or a following digit. Numeric formulas are never classified as
  currency solely because they begin with a digit.
- Use the same adapter in the editor and existing bridge/schema/corpus harnesses.
- Reclassify the currency corpus case only after semantic tests pass. The input
  fixture is unchanged. New normalized output escapes the literal currency
  dollar (`\$5`) and preserves the intended LaTeX. Original lossy/desired files
  remain as historical evidence, no longer active expectations.
- Preserve the checker's fail-closed behavior and its synthetic blocker tests.
  Zero known corpus blockers is not a default-promotion or release approval.

## Tests run

All Node/npm commands used `mise exec --` from `apps/desktop` (Node 24.20.0).

| Check | Result |
| --- | --- |
| `node --test test/tiptap-math-delimiters.test.mjs test/tiptap-load-history.test.mjs` | 28/28 pass |
| Delimiter, bridge-roundtrip, schema-validity and load-history focused run | 54/54 pass before the final two additions |
| `npm run test:ci` | 2,341 tests; 2,339 pass; 2 existing opt-in perf skips |
| `npm run check:tiptap-readiness` | 44/44 tests pass; `READY: 0 blockers` |
| `npm run audit:prod`; `npm run audit:full` | Pass; zero vulnerabilities |
| `npm run build:tiptap`, twice | Pass; identical SHA-256 hashes |
| `npm run check:generated` | Fails because intended Tiptap/Toast UI bundles remain uncommitted; checker unchanged |
| Synthetic 1,000-paragraph math/currency probe | All 1,000 formulas retained; stable normalization; 143 ms observed, not a performance guarantee |
| Unsigned macOS arm64 packaging | Pass using cached Electron 43.4.1 archive; see qualification below |
| ASAR comparison | Adapter and generated bundle match the working files |
| `git diff --check` | Pass |

Bundle SHA-256:
`24ed13b943059805fe490352a26f590395c90bbdef33cb0ea9ccfa1bf17b682d`.

The ordinary pack command failed sandbox DNS, and its network-enabled retry
stalled downloading Electron. That packaging process was stopped. A local-runtime
attempt found the package metadata but no `node_modules/electron/dist`. Packaging
then succeeded with `npm run pack -- --config.electronDist=<cached-archive>` using
the existing `electron-v43.4.1-darwin-arm64.zip`; its internal version was checked.
No persistent build configuration changed. Ordinary download-backed packaging
is not claimed as passing this turn. No fresh install or destructive generated
build wrapper was run.

## Test results

Packaged Electron with isolated profile and synthetic vault at
`/private/tmp/editor-math-qa.Sx4q8k`; no real transcripts or private vault reads.

- Nine mounted checks pass: correct math node, inline/display KaTeX, literal
  currency, immediate undo, Source/Rich, literal spaced math, stable reload,
  digit-adjacent safe serialization and formula preservation on reopen.
- Host save, other-note isolation, note switching, Preview/Write and disk
  refresh preserve expected Markdown. The saved synthetic files were inspected.
- Screenshot inspected: `$5` and `$10` display as prices; `a_b + c^2` and numeric
  `5` render as formulas; `$ x $` and `$x$2` display literally; display sum renders.
- Native physical keyboard, Chinese IME, long-document caret/scroll and native
  close/Save All acceptance were not run. Existing checklist remains open.

## Files changed

This task's changes, on top of the existing split/security/undo working patch:

- `apps/desktop/lib/remark-math-delimiters.js` (new adapter).
- `apps/desktop/lib/tiptap-entry.js` (one import); `lib/tiptap-bundle.js` (rebuild).
- `apps/desktop/test/tiptap-math-delimiters.test.mjs` (new).
- `apps/desktop/test/tiptap-load-history.test.mjs` (one factory regression).
- `apps/desktop/test/helpers/tiptap-roundtrip-harness.mjs`,
  `test/markdown-bridge-roundtrip.test.mjs`, `test/tiptap-schema-validity.test.mjs`
  (production-adapter imports).
- `apps/desktop/test/fixtures/tiptap-roundtrip/13-math-currency.expected.md` (new)
  and `manifest.mjs` (safe normalized classification).
- `apps/desktop/test/tiptap-roundtrip-corpus.test.mjs`,
  `test/tiptap-readiness.test.mjs` (updated known-blocker expectations).
- `apps/desktop/tools/check-test-baseline.mjs` (20-test increase).
- `README.md`, `docs/roadmap.md`, `docs/stage-history.md`, `docs/test-manual.md`
  and this report (syntax contract and evidence).

Paths abbreviated with `test/` or `lib/` above are relative to `apps/desktop`.
The existing 333-line entry gains no length; unrelated extraction is deferred.
New adapter/tests are below the project size guideline; bundle size is generated.

## Remaining risks or notes

The adapter depends on remark's extension shape and math token names; retain
these behavioral tests when updating that dependency. The approved syntax change
can reinterpret previously accepted padded or digit-adjacent single-dollar math;
use `$x$` without inner edge spaces, or multi-dollar inline syntax where needed.
It cannot infer every author's intent; explicitly escape literal dollars when
ambiguity remains. Markdown stays remark-normalized, not byte-identical.

The earlier formatting-only dirty-state observation is not addressed. Tiptap
stays opt-in until native acceptance and clean-tree CI pass. No commit/push/tag.

## Ready for review: yes

Scoped implementation is ready for code review, not release approval.

## Diff review (self-review, not independent review)

1. **Verdict: accept** for the scoped code change.
2. **Summary of what changed:** adapter, safe serialization, corpus/tests, bundle.
3. **What looks good:** no dependency or parser rewrite; source offsets and
   structural contexts remain parser-owned; tests assert formulas, not just text.
4. **Problems found:** corrected the URL assertion; used reduction rather than
   spreading dollar runs into `Math.max`, avoiding an argument-count limit.
5. **Missing tests or edge cases:** native input acceptance remains manual;
   this is not exhaustive Pandoc grammar conformance.
6. **Regression risks:** intentionally changed syntax and upstream token contract.
7. **Specific changes requested:** no further blocking code change identified.
8. **Follow-up prompt:** Review this adapter and its serializer against the
   approved boundary contract. Preserve the existing split/undo patch. Complete
   native acceptance before shipping; use minimal TDD fixes for confirmed issues.

## README sync

Required: the approved parsing compatibility change belongs under Write engines.
The added paragraph states exact rules, escaped literal dollars, retained
display/multi-dollar syntax and Tiptap-only scope. It does not promise full
Pandoc compatibility or default promotion. Other docs are updated as task
implementation records under project rules, outside the README-only skill.
