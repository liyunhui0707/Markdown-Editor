# Editor / AI Session Manager split — Phase 2

> Follow-up: the [dependency security patch](dependency-security-followup.md)
> now passes both audits (zero findings), a clean install, and 2,313 tests
> (2,311 pass, 2 skips) on Node 24 and 25. Two bundles were rebuilt. Native QA
> remains open; packaged QA confirmed a pre-existing Tiptap immediate-load
> undo defect. The results below record the original split checkpoint, not
> the later remediation. Neither patch is committed or released.

Date: 2026-09-05. Working version: **0.18.0**, not released.
Branch: `refactor/editor-session-split`, based on cached `origin/main`
at `8926fd6f1101ed643d669074bbe4bccd3f29b7c4`.

## Scope and checkpoint

This patch completes the editor-side implementation after the standalone
application checkpoint. It does not modify the sibling `ai-session-manager`,
which is already under independent development. Its committed checkpoint
`18578f4` and QA report were inspected read-only; its current uncommitted work
was not audited or changed. That repository uses a fresh publication root;
this phase does not repair or change its history.

Kept: Markdown editing and all current engines, Source/Preview, AI Imports,
Local AI Summarize/Rewrite, dirty-state/close guards, ordinary vault I/O,
dictionary lookup, and image handling.

Removed from this editor: AI Sessions navigation, transcript Read view,
grouping, favorites, session searches, session refresh IPC and importer CLIs.
These capabilities belong to the independent application. No user transcript,
vault, preferences, or sibling-project file was moved, rewritten, or deleted.
The 90 removed tracked files are source code, documentation, and synthetic
session test fixtures; they remain recoverable from this repository's history.

Use the same existing `Inbox/AI Chats` directory in AI Session Manager. The
editor excludes the reserved `codex` and `claude-code` subdirectories before
reading bodies, even when an agent directory or a descendant is selected as
the vault. Ordinary AI-sourced notes, direct MCP notes, and legacy dated
AI Imports remain available and editable.

## Files changed

| Area | Files / effect |
|---|---|
| Product shell | `apps/desktop/index.html`: removes session-only UI, scripts, state and navigation; retains editor lifecycle and Local AI bridge |
| Main / preload | `apps/desktop/main.js`, `preload.js`: no session import capability; exclude reserved paths and ignore session watcher events |
| Data boundary | New `lib/editor-path-policy.js`; `lib/file-name.js` validates both resolved save/rename paths before mutation |
| Shared parsing | New `lib/frontmatter-scalar.js` retains the existing scalar decoder formerly in `session-title.js` |
| Tests | New `test/editor-session-boundary.test.js`, `test/frontmatter-scalar.test.js`; update `renderer-boot.test.js` and the Local AI wiring reset-site expectation |
| Metadata / CI | `package.json`, `package-lock.json`: version 0.18.0, remove importer commands/test globs; dependency resolutions and app ID unchanged. `tools/check-test-baseline.mjs`: explicit editor-only test floor |
| Deleted ownership | `lib/session-import-ipc.js`, `lib/session-title.js`, `lib/session-viewer/*`, `tools/session-import/*`, `test/session-viewer/*`, `test/session-import/*` |
| Documentation | README, roadmap, stage history, manual checklist, this report |

New production modules are 52 and 12 lines; the boundary test is 224 lines.
Existing `main.js` (~860 lines), inline renderer (~4,572 lines), and renderer
test harness (~7,524 lines) exceed the project guideline but shrink overall.
Splitting these longstanding monoliths would broaden this removal patch and
is deferred. No dependencies were added or updated.

## TDD and automated verification

- Initial boundary tests: **13 expected failures / 14 tests** before exclusion
  and mutation guards; then all passed with the existing save tests.
- Renderer tests added before session UI/global removal. Shared tests retained,
  including frontmatter decoding, layout, undo/redo, AI Imports and Local AI.
- Follow-up tests exposed missing-directory creation and session watcher
  notifications; both fixed. Packaged visual QA exposed a stale `Filter:
  sessions` status; its regression test failed before the one-line fix.
- Test accounting: original 2,673 tests minus 379 session-module/importer tests
  minus 11 session-only renderer tests plus 23 boundary/renderer/scalar tests
  = **2,306**. The new floor is not a blanket relaxation for failing tests.

| Check | Result |
|---|---|
| `npm run test:ci` | **PASS:** 2,306 tests; 2,304 pass; 0 fail/cancel/todo; 2 existing opt-in performance skips |
| All seven individual asset build commands + `npm run check:generated` | **PASS:** tracked generated outputs identical |
| `npm run pack` | **PASS:** unsigned macOS arm64 application, version 0.18.0 |
| Packaged ASAR inspection | **PASS:** no session viewer/importer JavaScript; independent editor metadata retained |
| `npm run audit:prod` | **FAIL:** 30 moderate findings in the unchanged Tiptap dependency tree |
| `npm run audit:full` | **FAIL:** 30 moderate findings plus 1 high `fast-uri` finding in the development tree |
| `npm run check:tiptap-readiness` | 44 corpus/readiness tests pass; promotion gate correctly **FAILS** on existing `math-currency-delimiter` blocker |
| `git diff --check` on task files | **PASS** |

The existing `verify:generated` wrapper includes recursive shell deletion of
vendor outputs. QA instead ran its individual build steps without that deletion,
then the same generated-output checker. No fresh `npm ci` was performed;
verification used the installed locked dependencies. GitHub CI was not triggered.

Audit findings are inherited: the lockfile diff changes only the root version.
The Tiptap finding is [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh).
The `fast-uri` audit includes [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8),
[GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc),
[GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), and
[GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp).
Exploitability in this application has not been established. Do not waive the
audit thresholds or treat successful packaging as release approval.

## Manual QA checklist

### 1. Manual QA goal

Verify the narrower product surface without losing ordinary editor behavior
or touching session data.

### 2. Test environment

macOS arm64, Electron 43.4.1, Node 25.6.1; unsigned packaged application.
Isolated temporary user-data profile and synthetic vault only. GUI runtime
checks were scripted through a loopback debugger, with a rendered-window
screenshot inspected. This is not a complete human/native-input QA pass.

### 3. Changed behavior to verify

Only Drafts, My Notes and AI Imports appear. There is no session refresh,
Read tab, transcript toolbar, favorites tree or cross-session search.
Sessions remain in their original folders for the independent application.

### 4. High-risk areas

Filtering before reads, stale mutation requests, shared save/selection/mode
lifecycle, Local AI source selection, and dirty-state preservation.

### 5. Test cases

Start each case with an isolated profile and a synthetic vault containing an
ordinary note, an AI-sourced dated import, and one sentinel transcript in each
reserved agent directory. Record result and notes separately.

| Test | Steps | Expected result | Result / notes |
|---|---|---|---|
| Product surface | Open the synthetic vault; inspect sidebar and tabs | Two editable notes; transcripts absent; three filters; Write/Preview remain | Scripted PASS; screenshot inspected |
| Shared save lifecycle | Edit ordinary note; Preview → Write; switch to import and back; save | Text and selection context retained; import initially clean; saved note clean | Scripted PASS, including Unicode text |
| Undo/redo | Insert text, undo, redo; switch notes and save | Correct body restored, no unrelated note mutation | Scripted PASS for CM6 commands; broader automated harness retained |
| AI Imports | Open dated import; filter/search by its title/source | Import visible and editable; no automatic dirty state on selection | Scripted filter/selection PASS; search covered by automated suite |
| Local AI | Use a loopback synthetic provider; click Summarize and Rewrite | Per-note panel receives response; original body and dirty state unchanged | Scripted PASS for both verbs; no real provider contacted |
| Tiptap | Opt isolated profile into Tiptap; Source → Rich → Preview → Write; save | Modes work and synthetic edited text persists | Scripted PASS |
| Reserved paths | Open agent root; attempt stale save/rename/delete/image/seed requests | No transcript reads or mutation; missing protected root not created | Main-process integration PASS; sentinel bodies unchanged after packaged QA |
| Native input | Type Chinese with an actual IME; commit with Enter; switch and undo | No dropped/duplicate characters, correct caret and undo | PENDING human test; Unicode insertion is not native IME evidence |
| Native lifecycle | Edit two notes; close; Cancel; close again; Save All & Quit; reopen | Cancel retains work, save-all persists both notes, reopening reads saved text | PENDING native dialog/restart test; automated close/save-all coverage passes |
| Long notes / resize | Open a synthetic 10k-line ordinary note, edit at end; resize; switch modes | No unexpected scroll jump or lost text | Automated long-document coverage passes; native interaction PENDING |

### 6. Regression checklist

- Keep Tiptap opt-in and CM6 fallback unchanged.
- Do not revive the superseded CM6-decoration WYSIWYG work.
- Retain MCP import notifications and ordinary file watcher updates.
- Do not migrate or erase old session preferences or transcript files.

### 7. Edge cases

Automated coverage includes canonical/nested agent roots, case variants,
normalized dot paths, symlink aliases, prefix lookalikes, ordinary AI-source
notes, and a missing protected directory. The boundary is a product path policy,
not a new adversarial filesystem sandbox: arbitrary renamed/copied/hardlinked
transcripts or concurrent filesystem substitution are not comprehensively
identified or protected by this change.

### 8. Pass/fail recording template

```text
Tester / date / OS / build:
Test name:
Result: pass / fail / not run
Notes and synthetic reproduction:
Failures remaining:
```

### 9. Final acceptance decision template

```text
Decision: accept / revise / block
Automated tests:
Native QA:
Security audits:
Unresolved blockers:
```

## Strict diff review

Self-review using the strict diff review checklist; not an independent review.

1. **Verdict: revise (before release).** Split implementation verified; audit
   remediation and native acceptance evidence are still outstanding.
2. **Summary:** session-only ownership removed; shared editing and Local AI
   preserved; reserved directories excluded at main-process read/write boundaries.
3. **What looks good:** behavior-focused boundary tests, unchanged dependency
   resolutions/generated assets, actual packaged smoke checks, no data migration.
4. **Problems found:** fixed missing-folder writes, unnecessary watcher refreshes,
   and stale status label. Inherited dependency audits remain failing.
5. **Missing tests / edge cases:** native IME, interactive close/save-all/restart,
   long-note caret/scroll check; fresh Node 24 install/CI run remains to be done.
6. **Regression risks:** main and renderer remain large shared surfaces; path
   policy does not classify arbitrary transcript copies or prove race immunity.
7. **Specific changes requested:** separately remediate the reported dependency
   findings, rebuild/retest/package, then record native QA before shipping.
8. **Follow-up prompt:** “Keep the editor split intact. Investigate the Tiptap
   and fast-uri audit findings and propose the smallest compatible dependency
   remediation. Preserve all editor and AI Imports/Local AI behavior. Add focused
   regressions as appropriate; run both audits, clean-install CI checks, generated
   checks, and packaging. Record native IME and close/save-all/restart QA. Do not
   commit, push, tag, or change AI Session Manager without fresh authorization.”

## Handoff / next development direction

1. Resolve the audit failures and finish native acceptance QA; keep this split
   patch reviewable and leave the independent session-manager work alone.
2. Address `math-currency-delimiter` with its own failing regression and minimal
   Tiptap/remark fix, then rerun the corpus/promotion gate.
3. Complete daily-use editor QA before considering Tiptap default promotion.
   Avoid new engines, broad UI expansion, or removing fallbacks in this cycle.

No commit, push, tag, PR, repository creation, branch deletion, or worktree
deletion was performed. The pre-existing deletion of `.codex/config.toml` and
untracked `AGENTS.md` remain user-owned and untouched. No environment/secret
files or real session contents were inspected.
