# Tiptap note-load undo boundary — 2026-09-08

## Approved task understood

Continue independent editor stabilization by fixing the immediate-load/edit/undo
data-loss defect identified in dependency QA. Work only in `markdown-vault-app`.
No sibling-project changes, commit, push, tags, new dependencies or user data.

## Minimal implementation scope

Reset note-local ProseMirror state after guarded Markdown loading in `setText`.
Keep the existing source of truth, fallback loading, source toggle, host adapter,
import boundaries and default engine. This is part of the unreleased 0.18.0
working patch; no further version change is made.

## Tests added or updated first

`test/tiptap-load-history.test.mjs` runs the actual entry factory, Markdown
bridge, Tiptap commands and ProseMirror history in Node. An in-memory esbuild
adapter replaces only DOM mounting and installs real history. It does not test
native plugin views or keyboard events; packaged QA covers the mounted editor.

RED: the first five tests all failed with the original behavior, including undo
returning an empty body instead of the loaded note. GREEN: all five passed
after the fix. Three further regressions cover independent redo isolation,
Source-mode save/preview flush and structured-note reload. No timeout workaround.

## Implementation changes made

Import public `EditorState` and create fresh state after `applyMarkdownToEditor`
in `setText`, retaining the loaded document, schema, selection and plugin list.
This reinitializes note-specific plugin state, including history. Merely setting
`emitUpdate: false` suppresses change notifications but does not clear history;
`addToHistory: false` alone would leave the previous note's undo/redo available.
Same-note Source/Rich commits do not use this load-only reset path.

## Tests run

Commands below ran in `apps/desktop`, using `mise exec --` and Node 24.20.0.

| Check | Result |
| --- | --- |
| `node --test test/tiptap-load-history.test.mjs test/tiptap-source-toggle.test.js test/note-switch-restore.test.js` | 23/23 pass after all additions |
| `npm run test:ci` | 2,321 tests; 2,319 pass; 2 existing opt-in perf skips |
| `npm run audit:prod`; `npm run audit:full` | Both pass; zero vulnerabilities |
| `npm run build:tiptap`, repeated | Pass; identical SHA-256 hashes |
| `npm run pack` | Unsigned macOS arm64 / Electron 43.4.1 succeeds after network-enabled retry; sandbox DNS initially failed |
| `npm run check:tiptap-readiness` | 44 corpus tests pass; promotion gate still fails on existing `math-currency-delimiter` |
| `npm run check:generated` | Fails: intentionally modified Tiptap/Toast UI outputs are uncommitted; clean-tree check unchanged |
| `git diff --check` | Pass |

The destructive `build:generated` wrapper was not run. No clean install was
repeated: this fix changes neither manifests nor installed dependencies.
Tiptap bundle SHA-256:
`19e5ca58a8390a97683fe2ec3cfc271538ed398e20eb7e15d1f2d44fa01c23fa`.

## Test results

Packaged Electron, isolated profile and synthetic vault at
`/private/tmp/editor-undo-qa.R2hlxs`; no real sessions or private vaults inspected.

- 13 scripted mounted-factory checks pass: immediate undo/redo, no load change
  notification, cross-note history isolation, Source flush/switch, table/task
  plugin rendering, structured-content undo and empty-note behavior.
- 10 scripted host checks pass on a saved, normalized table baseline: clean
  load, dirty edit, immediate undo preserving the incoming note, return to clean,
  no cross-note undo, Source save, Preview/Rich, other-note isolation, revisit
  and disk refresh persistence. Synthetic on-disk contents inspected.
- A screenshot was inspected: table alignment, task checkbox and ordinary body
  remain rendered after note-state reset.
- Initial host QA expecting a non-normalized table to stay clean failed:
  switching away flushed remark-normalized spacing into its body while
  `loadedBody` retained disk spacing. This formatting/dirty-state observation is
  not fixed here and is not counted as a clean-load pass for arbitrary Markdown.

## Files changed

Only this task's additions to the pre-existing working patch:

- `apps/desktop/lib/tiptap-entry.js` — seven added lines, load-only reset.
- `apps/desktop/lib/tiptap-bundle.js` — regenerated consumer.
- `apps/desktop/test/tiptap-load-history.test.mjs` — eight regressions.
- `apps/desktop/tools/check-test-baseline.mjs` — increase test minimum by eight.
- `README.md` — note-local undo contract.
- `docs/tiptap-load-undo-fix.md` — this report and acceptance checklist.
- `docs/roadmap.md`, `docs/stage-history.md`, `docs/test-manual.md`,
  `docs/dependency-security-followup.md` — implementation status and QA links.

The entry was already over 300 lines (now 333); keep the seven-line safety fix
local instead of unrelated module extraction. Generated bundle size is expected.
Existing split/dependency changes and user-owned development files are preserved.

## Remaining risks or notes

Tiptap remains opt-in. Full native acceptance is not claimed: physical shortcuts,
Chinese IME, native close/Save All dialogs and long-document caret/scroll need
human testing. Frontmatter is stored outside the rich body and is not made
undoable by this patch. Plugin states reset on each host `setText`, including
same-note reload; per-note history restoration is deliberately not introduced.
The broader uncommitted patch still needs review and clean-tree CI before shipping.

## Ready for review: yes

The scoped fix is ready for code review, not a release/commit approval. Tests
pass and mounted synthetic QA confirms the original defect no longer reproduces.

## Diff review (self-review, not independent review)

1. **Verdict: accept** for this narrow code fix; native release QA remains open.
2. **Summary of what changed:** note-load state reset, generated bundle, tests.
3. **What looks good:** public API, no delays/private history fields, no change to
   ordinary source commits or dependencies, behavioral RED evidence.
4. **Problems found:** test harness initially used URL pathname as a filesystem
   path; changed to `fileURLToPath` for spaces/platform correctness.
5. **Missing tests or edge cases:** native input and plugin-view interactions are
   not covered by the Node harness; mounted table/task checks were run separately.
6. **Regression risks:** all plugin state is note-local and resets; native input
   still needs acceptance. Existing formatting normalization can affect dirty state.
7. **Specific changes requested:** no further blocking code changes identified.
8. **Follow-up prompt:** Review only the load-history fix against this report;
   preserve the existing split work. Complete the native checklist before shipping.
   Request minimal regression tests for any confirmed issue; no unrelated refactor.

## Manual QA goal

Verify physical input and persistence around the load boundary before release.

## Test environment

Unsigned macOS app; isolated profile; synthetic copies only. Select opt-in Tiptap.
Use one normalized plain note, one table/task note and one long synthetic note.

## Changed behavior to verify

Loading cannot become an undoable edit; a later edit undoes to the loaded body.

## High-risk areas

Native shortcuts, IME composition, Source flush, note switching, close/save and
note-local plugin state. Do not equate scripted commands with physical input QA.

## Manual QA checklist

| Test / starting state | Steps | Expected result | Pass/fail | Notes |
| --- | --- | --- | --- | --- |
| Fresh plain note | Open; immediately type `EDIT`; Cmd-Z; Cmd-Shift-Z | Undo retains original body; redo restores edit | Pending | Scripted equivalent passed |
| Two saved notes | Edit A; switch B; Cmd-Z and redo; edit B and undo | No A content enters B; undo only removes B edit | Pending | Scripted equivalent passed |
| Source mode | Change body; save; Preview; Write; switch away/back | Saved source body persists; no other note changes | Pending | Scripted equivalent passed |
| Chinese IME | On new load compose Chinese, commit with Space/Enter; undo/redo; switch | No empty note, dropped/duplicated characters or stale composition | Pending | Requires real IME |
| Long note with table/tasks | Load; move near end; edit/undo; toggle checkbox; switch/revisit | Content intact, controls usable, caret visible, no unexpected scroll jump | Pending | Rendering only checked by script |
| Dirty notes / close | Edit two synthetic notes; close; Cancel; close and Save All; restart | Cancel retains edits; Save All persists each correct note | Pending | Requires native dialogs |

## Regression checklist

Keep default CM6 and AI Imports/Local AI unchanged (full automated suite passes).
Check note title/body separation and plain/structured saves using synthetic data.

## Edge cases

Empty notes, repeated same-note loads and Source-to-another-note are automated.
Record formatting-only dirty changes separately from actual content loss.

## Pass/fail recording template

Record test name, app build, result (pass/fail/not run), actual content/behavior,
and reproduction steps. Do not paste real private note contents into reports.

## Final acceptance decision template

Native QA: pending / pass / fail. Decision: accept / revise / block. List failures
and unresolved promotion gates before authorizing any shipping actions.

## README sync decision

Required: document Tiptap's note-local history under Write engines. Only that
paragraph changed this turn. It describes the eight tests and mounted QA, not
full IME acceptance or default promotion. Frontmatter undo and future features
are intentionally not promised. Related docs are updated as implementation
records under project documentation rules, not as part of the README-only skill.
