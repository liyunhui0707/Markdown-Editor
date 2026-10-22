# Dependency security remediation — 2026-09-09

## Approved task understood

Resolve the two audit findings reported during A6 using compatible patch
updates and TDD. Preserve the accumulated editor split/A6 work, all editor
engines, AI Imports, Local AI and existing data. No Git/GitHub mutation,
sibling-project change, feature work or application-version bump.

## Minimal implementation scope

| Dependency | Before | After | Scope |
| --- | --- | --- | --- |
| Tiptap family | 3.30.4 | 3.30.5 | 32 existing records; synchronize exact core/PM/extension peer requirements |
| js-yaml | 4.3.1 | 4.3.2 | Existing packaging dependency; no new direct dependency or override |

Sources: [Tiptap advisory](https://github.com/advisories/GHSA-j95f-988m-3j2f),
[3.30.5 release](https://github.com/ueberdosis/tiptap/releases/tag/v3.30.5),
[js-yaml advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh), and
[4.3.2 release](https://github.com/nodeca/js-yaml/releases/tag/4.3.2).

The Tiptap issue concerns its public block/inline Markdown-attribute helpers.
The editor uses its own remark/mdast bridge; a targeted source/bundle search
found no affected helper invocation or helper code in the generated Tiptap
bundle. Thus direct document-path reachability was not established; this is
not proof that every possible app/dependency path is safe. The installed
library's exposed helpers were vulnerable and were tested directly.
`npm ls` places js-yaml beneath electron-builder's packaging modules, not the
editor's main-process frontmatter parser. Neither finding justifies adding a
new YAML feature or weakening an audit gate.

## Tests added or updated first

`apps/desktop/test/dependency-security.test.js` now requires patched core and
YAML lockfile versions and adds six tests:

- Two public Tiptap tokenizer checks with bounded synthetic hostile inputs in
  child processes (three-second timeout; not a UI performance benchmark).
- Ordinary quoted block/inline attributes still parse correctly.
- Empty YAML mappings consume the configured merge budget.
- Ordinary packaging configuration and permitted merges still parse.
- All locked js-yaml copies use the reviewed patched 4.x line.

RED: **14 tests, 9 pass, 5 expected failures**. Both old Tiptap probes timed out,
the old YAML budget check failed, and both patched-version checks failed.
GREEN: **14/14 pass**, including the earlier attribute-injection/URI regressions.
The security test file is 173 lines; no new test dependency was added.

## Implementation changes made

Ten direct Tiptap ranges became `^3.30.5`; the family resolves to exactly
3.30.5 in the lockfile. A targeted compatible js-yaml update resolves to 4.3.2.
Comparison against the pre-task lock snapshot confirms **33 changed package
records**, no added/removed package names, and no unrelated resolution changes.
The app remains unreleased `0.18.0`; no application source code changed.

An installation check caught stale npm metadata: the hidden
`node_modules/.package-lock.json` claimed the patched versions while the actual
package files were still old. The first install's “up to date” message and
lockfile-only clean audits were **not** treated as a successful runtime update.
The proven-stale hidden lock was moved to the diagnostic directory (recoverable,
not deleted); reinstalling with lifecycle scripts disabled updated 33 packages.
All 33 installed versions were then compared with the reviewed lockfile.
No `npm audit fix`, broad update, force install or `node_modules` deletion.

## Tests run

Commands below run from `apps/desktop` using `mise exec --` (Node 24.20.0).

| Verification | Final result |
| --- | --- |
| `node --test test/dependency-security.test.js` | 14/14 pass |
| `npm run test:ci` | 2,366 tests / 2,364 pass / 2 existing skips / zero failures |
| `npm run check:tiptap-readiness` | 44/44 pass; zero corpus blockers |
| `npm ls --all` | Exit 0; no invalid required peers; non-host optional esbuild binaries absent as expected |
| `npm run audit:prod` / `npm run audit:full` | Both exit 0, **zero vulnerabilities** |
| `npm run build:tiptap` / `npm run build:editor`, repeated | Identical repeat-build hashes |
| Cached Electron 43.4.1 unsigned `npm run pack` | Pass |
| Packaged-source synthetic Electron checks | 16 A6 save/undo/metadata assertions and 9 currency/math rendering assertions pass |
| Package inspection | Core 3.30.5 present; runtime source/bundle bytes match; manifest identity/version/dependencies match |
| `git diff --check` | Pass |
| `npm run check:generated` | Expected existing dirty-tree failure: prior Tiptap/Toast UI outputs are uncommitted; not claimed as passing |

Packaging used `--config.electronDist` pointing to the cached 43.4.1 arm64 ZIP.
The recursive-deletion build wrapper was not used. electron-builder normally
omits `scripts`, `build` and `devDependencies` from the packaged manifest;
therefore raw manifest byte equality is not the correct package check.

Bundle SHA-256 values:

```text
tiptap:  4e966ddda91ec4fc42a3de8b29bd8f29b78218ad4ff466f87c5248994e8a2d8f
toastui: 515d8e89bddba952f64e370de81f1a74b75f9bb1ef22da119f2c9ccc7bafbb12
```

The Tiptap bundle remains identical to A6 because the affected helpers are not
included in this renderer build. The packaged dependency itself is patched.

## Test results

Both known audit blockers are resolved in the installed, locked and packaged
candidate. This supersedes the 31-production/32-full high-severity findings
recorded during A6. Those counts included affected dependents, not that many
independent advisories. Zero current advisories is not proof of general security.

Evidence lives in `/private/tmp/editor-security-sep9.KFpNco/`: `red.log`,
`green-final.log`, `ci-final.log`, `corpus-final.log`, final audit logs,
`pack-final.log`, `qa.log`, package snapshots and the recoverable stale hidden
lock. `qa.cjs` reused the synthetic A6 harness and a synthetic math probe,
with a fresh profile and blocked HTTP(S). It loaded packaged sources through
Electron; it was not physical-input or normal installed-app launch QA.

## Files changed

- `apps/desktop/package.json` and `package-lock.json`
- `apps/desktop/test/dependency-security.test.js`
- `apps/desktop/tools/check-test-baseline.mjs` (minimum increased by six)
- This report; status links/records in `docs/roadmap.md`, `stage-history.md`,
  `test-manual.md`, `a6-dirty-state-investigation.md`, and
  `dependency-security-followup.md`

Bundles were rebuilt and checked; their existing uncommitted changes still
belong to the accumulated patch. README needs no additional change for this
dependency-only step: no user behavior, setup command or feature changed.

## Remaining risks or notes

Next: A7 whole-patch review, followed by the pending native A1–A5/A6 acceptance
on disposable notes. In particular, physical IME/keyboard behavior and native
close/Save All remain unverified for this candidate. General YAML preservation
remains deferred; A6's explicit refusal policy is unchanged.

No fresh `npm ci` was run: this task reconciled the active install, checked all
changed installed versions, audited the resulting tree, rebuilt and packaged.
Clean-checkout CI and its generated-file gate remain later shipping gates.
No staging, commit, push, tag or data migration was performed.

## Ready for review: yes

The scoped security delta is ready for review. This is not acceptance of the
whole accumulated patch or authorization/readiness to commit or ship it.
