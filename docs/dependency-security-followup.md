# Dependency security follow-up — 2026-09-05

Update 2026-09-09: [the second security follow-up](dependency-security-sep9.md)
updates Tiptap to 3.30.5 and js-yaml to 4.3.2 after the A6 audit findings.
Both audits now pass; the versions and test results below remain historical.

Update 2026-09-08: the undo defect recorded below is addressed by the separate
[Tiptap load-history fix](tiptap-load-undo-fix.md). Keep the original reproduction
and dependency-only QA evidence below as history; native acceptance remains open.

## Approved task understood

Resolve the dependency-audit blockers found after the editor split, using
minimal TDD changes. Preserve Markdown editing, AI Imports, Local AI, the
session-directory boundary and the independent `ai-session-manager` project.
No commit, push, tag, repository mutation or user-data migration is authorized
by this implementation step.

## Minimal implementation scope

This is dependency maintenance, not a feature or architecture change. The
unreleased combined patch stays at 0.18.0; default Write engine remains
`hybrid-cm6`, and Tiptap remains opt-in.

Plan: reproduce the reported unsafe public helper behavior, update only the
affected existing dependency family/resolver, rebuild its consumers, run a
clean install, both audit gates, full tests, corpus and packaged synthetic QA.
Stop if application refactoring or a major dependency upgrade is required.
Plan self-review: accepted with those boundaries; no independent agent review.

## Tests added or updated first

`apps/desktop/test/dependency-security.test.js` gained seven tests:

- Lockfile copies use the reviewed major and patched minimum versions.
- JSON-origin `__proto__` cannot introduce inherited attributes through
  Tiptap `mergeAttributes()` and ProseMirror `DOMSerializer`.
- Ordinary class/style/image-attribute merging remains correct.
- Scheme-relative Unicode hosts canonicalize consistently.
- Malformed IPv6 produces an error, not a different valid private address.
- Nested host percent-encoding does not normalize into `localhost`.
- Encoded scheme characters do not become authority delimiters or CR/LF.

RED: **8 tests, 2 pass, 6 expected failures** on the old dependencies.
GREEN: **8/8 pass** after the dependency update. No application workaround
or weakening of audit thresholds was necessary.

## Implementation changes made

| Dependency | Before | Locked after | Reason |
|---|---|---|---|
| Tiptap family (32 existing packages) | 3.26.0 | 3.30.4 | First patched core release; family synchronized for exact peer requirements |
| `fast-uri` | 3.1.5 | 3.1.7 | Targeted compatible transitive update; patched minimum is 3.1.6 |
| `prosemirror-model` | 1.25.7 | 1.25.11 | New `@tiptap/pm` requires `^1.25.11` |
| `prosemirror-view` | 1.41.8 | 1.42.3 | New `@tiptap/pm` requires `^1.41.9`; compatible resolution |

The lockfile changed 35 existing package records plus root manifest metadata.
No package names were added/removed. Other dependency resolutions, including
Electron, esbuild, CodeMirror, Mermaid and DOMPurify, are unchanged. Direct
Tiptap ranges are now `^3.30.4`; no `fast-uri` direct dependency or override
was added. `npm audit fix` was not used.

Sources: [Tiptap advisory](https://github.com/advisories/GHSA-cp6q-959q-f8rh)
and [3.30.4 release](https://github.com/ueberdosis/tiptap/releases/tag/v3.30.4);
fast-uri advisories for [Unicode hosts](https://github.com/advisories/GHSA-5jgf-p345-68v8),
[IPv6](https://github.com/advisories/GHSA-f65p-4m7j-42xc),
[host decoding](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), and
[scheme decoding](https://github.com/advisories/GHSA-jqff-g426-hqxp).

## Tests run

| Verification | Result |
|---|---|
| Clean `npm ci` on local Node 25.6.1 | PASS, 542 installed packages; audit reported zero vulnerabilities |
| `node --test test/dependency-security.test.js` | PASS, 8/8 |
| `npm run test:ci`, local Node 25.6.1 | PASS, 2,313 tests / 2,311 pass / 2 existing opt-in skips |
| `npm run test:ci`, temporary Node 24.20.0 runtime | Same PASS result on the CI major; runtime not added to project dependencies |
| `npm run audit:prod` | PASS, zero vulnerabilities |
| `npm run audit:full` | PASS, zero vulnerabilities |
| Seven individual renderer/vendor builds | PASS; only Tiptap and Toast UI bundles changed |
| Second Tiptap / Toast UI rebuild | PASS, identical SHA-256 hashes |
| `npm run pack` | PASS, unsigned macOS arm64 / Electron 43.4.1 |
| ASAR inspection | Patched core 3.30.4 present; packaged bundles/main/renderer match source |
| `npm run check:tiptap-readiness` | 44 tests pass; promotion gate still fails on existing `math-currency-delimiter` |
| `git diff --check` | PASS |

`npm run check:generated` exits 1 because its existing implementation requires
generated files to be clean against Git, and the two intentionally rebuilt
bundles are not committed. This is not claimed as a passing CI gate. Keep the
checker unchanged; commit the matching generated outputs only after separate
authorization, then run the clean-tree check. No staging was used to disguise
the changed outputs. The recursive-deletion build wrapper was not executed;
the individual build steps were used instead.

Reproducible bundle hashes:

```text
toastui-bundle.js 515d8e89bddba952f64e370de81f1a74b75f9bb1ef22da119f2c9ccc7bafbb12
tiptap-bundle.js  f9dfd1e9734a104460e3accd560cb4c5ba1ca6e99e55a38d0c4a2be35cb40ddb
```

## Test results / packaged QA

Scripted through loopback debugging of an isolated packaged-app profile with
synthetic notes only; a window screenshot was inspected.

- PASS: default CM6 editing, rebuilt Toast UI Preview, and saving.
- PASS: Tiptap Source/Rich/Preview, save and note switching, left/center/right
  table-column alignment, task/plain lists and Unicode rendering.
- PASS: AI Import initially clean; Local AI active-body bridge matches the
  editor text; reserved session sentinel excluded. Local AI network requests
  were not repeated in this follow-up; its full automated suite passes.
- PASS: Tiptap delayed edit/undo/redo; redo after immediate edit.
- **FAIL, pre-existing:** immediate edit/undo after programmatic note loading.
  See the controlled comparison below. Do not call this a full undo QA pass.
- NOT RUN: actual Chinese IME, native close-dialog/Save All/restart interaction,
  and long-document native caret/scroll checks. Prior checklist remains open.

### Pre-existing Tiptap load/undo issue

The production shell's immediate-edit smoke test did not undo to the loaded
note. A controlled comparison then used the original bundle from split-point
Git HEAD and the upgraded bundle in separate synthetic editor instances.
Both versions produced exactly the same behavior:

```text
createTiptapView(..., { initialDoc: 'Synthetic first note.' })
setText('Synthetic second note.')
insertContent('EDIT ') immediately, then undo:
  expected: 'Synthetic second note.\n'
  actual:   ''
redo: edited second note is restored

Same sequence with a 650 ms delay before insertContent:
  undo correctly restores 'Synthetic second note.\n'
```

This is not introduced by the dependency upgrade. It suggests note-load
transactions participate in history and can group with the next edit; that
mechanism still needs a focused implementation investigation. The observed
failure empties the editor buffer; saving that state could lose note content.
No real note was used or damaged. No fix is included in this dependency patch.

Next fix should begin with an integration regression that loads/switches notes,
edits immediately, then undoes without losing the loaded document or reviving
another note. Preserve note-local undo, Source/Rich, dirty-state and serialization
contracts; do not merely add a delay to the UI or change the expected result to
accept an empty document.

## Files changed

This follow-up changes only:

- `apps/desktop/package.json` and `package-lock.json`.
- `apps/desktop/test/dependency-security.test.js` (114 lines).
- `apps/desktop/tools/check-test-baseline.mjs`: raise floor by seven tests.
- Generated `lib/tiptap-bundle.js` and `lib/toastui-bundle.js`.
- This report, plus current-status notes in the split report, roadmap and
  stage history. The previous split implementation remains intact.

The generated bundles exceed normal source-size guidelines because they are
vendor builds, not manually maintained modules. No new application source
module or architectural refactor was needed.

## Remaining risks or notes

- Dependency upgrades can affect editing even with green tests; finish native
  QA before release. The confirmed pre-existing load/undo issue merits its own
  data-safety fix before Tiptap promotion, ahead of the math/currency blocker.
- Security audit results reflect this date and registry data, not a guarantee
  against all vulnerabilities. Existing deprecated-package install warnings
  remain; remediation outside the reported audit findings was not attempted.
- README-sync decision: no additional README change required; commands and
  product behavior are unchanged. Its existing split edits were preserved.
- User-owned `.codex/config.toml` deletion and untracked `AGENTS.md` untouched;
  no secret/environment files or real transcripts inspected; sibling repository
  untouched. No commit, push, tag, PR, or repository cleanup performed.

## Ready for review: yes — dependency patch only

Strict diff self-review (not independent review):

1. Verdict: **accept the scoped dependency remediation for code review**;
   this is not shipping or merge approval.
2. Summary: patched existing dependencies, behavior regressions and regenerated
   consumers; no app logic changes.
3. What looks good: red/green evidence, zero audits, clean install, Node 24/25
   tests, reproducible builds, actual packaged-source parity.
4. Problems found: existing immediate-load undo defect, confirmed unchanged
   by old/new bundle comparison; deferred with exact reproduction.
5. Missing tests/edge cases: native IME and lifecycle acceptance remain open.
6. Regression risks: upstream ProseMirror changes require continued UI QA;
   generated-cleanliness gate awaits authorized commit.
7. Specific request: do not ship or promote Tiptap until the open data-safety
   and native acceptance items are resolved; do not weaken existing gates.
8. Follow-up prompt: “Investigate and minimally fix the confirmed Tiptap
   note-load/undo data-loss behavior with a failing integration test first.
   Preserve the dependency-security patch and editor split. Cover rapid
   note switching, immediate edit/undo/redo, Source/Rich and persistence.
   Do not use artificial delays, refactor unrelated code, alter transcripts,
   modify AI Session Manager, commit, push, or tag without authorization.”
