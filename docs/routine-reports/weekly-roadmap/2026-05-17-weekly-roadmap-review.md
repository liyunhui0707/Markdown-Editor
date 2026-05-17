# Weekly App Roadmap Review - 2026-05-17

> Review-only. No source files, tests, packages, or configuration were edited.
> Only this single Markdown report is committed and pushed.
> Repo HEAD: `144f62e` (Merge PR #70 — workflow-orchestrator `--size` + docs tightening).
> Window: `HEAD~7..HEAD` (7 commits: `4f8b287` → `144f62e`, spanning 2026-05-15 → 2026-05-17).
> Diff size in window: **119 files changed, 10,726 insertions(+), 201 deletions(-)** — almost all of it lives outside `apps/desktop/`.
> Last recorded test count (Stage 25 commit message): `npm test` **1035 / 1033 / 0 / 2 / 0**, `npm run test:perf` **5 / 5 / 0 / 0**.

---

## 1. Weekly progress

This was a **two-track** week. Track A (early window, Stages 23 → 24.5 → 25) finished the
hybrid-cm6 narrow-interactivity work the rendering-policy stages authorized. Track B
(late window) ships an external **plugin/MCP infrastructure layer** that lives entirely
outside the desktop app — `plugins/workflow-orchestrator/` and an expanded
`tools/mcp-note-ingest/`. Both tracks landed via reviewed PRs into `main`.

### Important commits (HEAD~7..HEAD, oldest → newest)

| SHA | Date | Subject |
|---|---|---|
| `4f8b287` | 2026-05-15 | feat: Stage 25 — link-click renderer lift (hybrid-cm6) |
| `23f0606` | 2026-05-15 | Merge PR #62 (Stage 25 into `main`) |
| `179ac9b` | 2026-05-16 | feat: add workflow-orchestrator plugin with bundled codex-bridge MCP |
| `223b787` | 2026-05-16 | audit: workflow-orchestrator self-audit + 3 fix patches |
| `d2a8d71` | 2026-05-16 | Merge PR #65 (workflow-orchestrator into `main`) |
| `9993a3d` | 2026-05-16 | test: refactor older redaction tests for runtime-fragment payloads |
| `10c4ce1` | 2026-05-16 | Merge PR #66 |
| `4034a32` | 2026-05-17 | feat(mcp-note-ingest): add 6 vault tools (list/read/search/info/update/append) |
| `fd71e84` | 2026-05-17 | Merge PR #69 |
| `5139fbd` | 2026-05-17 | feat(workflow): add `--size` flag + tighten 3 docs |
| `144f62e` | 2026-05-17 | Merge PR #70 |

### Changed files / areas — desktop app only

`git diff HEAD~7 HEAD --name-only -- apps/desktop/**` :

```
apps/desktop/index.html                                            (+2 lines, 1 <script> tag for cm6-link-click.js)
apps/desktop/lib/cm6-hybrid-view.js                                (+26 lines, optional Cm6LinkClick hook in buildState)
apps/desktop/lib/cm6-link-click.js                       NEW       (238 lines — UMD link-click module, Stage 25)
apps/desktop/lib/cm6-task-toggle.js                      NEW       (161 lines — already on stage11; surfaced into main this window)
apps/desktop/lib/external-url.js                         NEW       (114 lines — Stage 24.5 validator/handler; on main this window)
apps/desktop/main.js                                               (+13 lines, ipcMain.handle('open-external-link') wiring)
apps/desktop/preload.js                                            (+1 line, vaultApi.openExternalLink)
apps/desktop/test/cm6-write-view/cm6-link-click-invariants.test.js NEW (49)
apps/desktop/test/cm6-write-view/cm6-task-toggle-invariants.test.js NEW (49)
apps/desktop/test/cm6-write-view/link-click.test.js                NEW (1170 — 59 cases)
apps/desktop/test/cm6-write-view/task-toggle.test.js               NEW (697 — 21 cases)
apps/desktop/test/open-external-link.test.js                       NEW (575 — 44 cases)
```

Total **app-source net additions in this window: ≈ +555 lines** across 5 source files,
and **≈ +2,540 lines of new tests** across 5 test files. The walker file
(`cm6-hybrid-view.js`) grew by only ~26 lines — both new interactions enter through
named peer modules per the rendering-policy contract.

### Changed files / areas — outside desktop app

The remaining **~10,000 lines** of the window's diff land in:

- `plugins/workflow-orchestrator/` (new plugin): `bin/`, `servers/codex-bridge/` (Python
  MCP server with its own pytest suite), `skills/workflow/` (skill docs), `tests/`
  (Python pytest + grep guards). Includes `AUDIT.md` and `uv.lock` (817 lines).
- `tools/mcp-note-ingest/lib/handlers/` — 6 vault tools (`list-notes`,
  `get-vault-info`, `append-to-note`, `ingest-chat-markdown`, `ping`, plus
  `handler-registry.js`, `file-io.js`, `frontmatter.js`).
- Root: `.gitignore` (+13 lines), `.mcp.json` (1-line tweak), `README.md` (+7 lines for
  Stage 25 Cmd-click behavior).

### Tests added or updated

- Stage 25: `link-click.test.js` (59), `cm6-link-click-invariants.test.js` (1
  peer-contract test).
- Stage 23 (surfaced into main this window): `task-toggle.test.js` (21),
  `cm6-task-toggle-invariants.test.js` (1).
- Stage 24.5 (surfaced into main this window): `open-external-link.test.js` (44).
- workflow-orchestrator: full Python pytest suite under `plugins/workflow-orchestrator/tests/`
  including grep guards (`grep-no-abs-paths.sh`, `grep-no-codex-run-in-orch.sh`,
  `grep-no-merge.sh`, `grep-no-token-literals-in-tests.sh`), smoke (`smoke/smoke.sh`,
  `smoke/g3_typed_tools.py`), `test_workflow_state.py`, `test_workflow_select.py`,
  `test_audit_*.py`, plus `servers/codex-bridge/tests/` (≈ 18 pytest files).
- Redaction tests refactored to use runtime-fragment payloads (`9993a3d`) — no
  behavior change.

### Documentation changes

- `README.md`: Stage 25 live-styling inline-links bullet rewritten ("non-clickable"
  → Cmd-click + `Cmd-Shift-O` with allowlist + modifier-exclusion + IME + frontmatter
  caveats); autolinks bullet narrowed (`<https://…>` / `<mailto:…>` clickable, raw
  email no-ops); keyboard-shortcuts table gains a `Cmd + Shift + O` row.
- `docs/stage-history.md`: long Stage 25 entry with full file inventory and
  carry-forward Stage 26+ deferrals.
- `docs/test-manual.md`: +27 lines covering Stage 25 manual-QA (27-item checklist
  for Cmd-click flow, frontmatter no-op, modifier rejection).
- `plugins/workflow-orchestrator/`: README, AUDIT.md, SKILL.md, `gate-policy.md`,
  `step-catalog.md`, `gates.md`, `mcp-contract.md`, `selector.md`,
  `skill-routing.md`, `state.md` — full docs for the new plugin.

### User-visible behavior changes (desktop app)

1. **Link click in Write mode** (Stage 25): in `hybrid-cm6` (default engine), a
   plain `Cmd-click` on an `[text](https://…)` or `[text](mailto:…)` link, on
   a scheme-bearing autolink `<https://…>` / `<mailto:…>`, or on a bare scheme-bearing
   URL fragment inside a link node, opens the URL via the OS handler. `Cmd-Shift-O`
   opens the link at the caret. Cmd-Shift / Cmd-Alt / Cmd-Ctrl clicks no-op
   (reserved for editor-native gestures). Frontmatter regions no-op. Allowlist is
   `https:` and `mailto:` (case-insensitive); `http:`, `file:`, `javascript:`,
   `data:`, percent-encoded scheme letters, whitespace/control-char URLs, and
   degenerate forms (`https:`, `https://`, `mailto:`) all reject silently.
2. **Task-toggle in Write mode** (Stage 23, on main this window): primary-click on a
   `[ ]` / `[x]` / `[X]` marker toggles it; `Cmd-Shift-X` toggles the marker at
   caret. IME-safe on both paths. Caret/selection preserved via auto-mapped
   transactions.
3. **`shell.openExternal` IPC** (Stage 24.5, on main this window):
   `window.vaultApi.openExternalLink(url)` is now a real, validated bridge.

No change to save/load, note switching, sidebar, vault picker, dirty-state, or
Preview-mode rendering this window.

### Routine / Issue activity

GitHub open-issue snapshot (20 open, all are routine-tracking issues, none are
bugs):

- **Weekly roadmap**: #14 (2026-05-05) — the last weekly review.
- **Daily plans**: #34, #42, #44, #49, #54, #57, #61, #64, #68 (one per weekday
  this window).
- **Daily bug & risk reviews**: #32, #41, #43, #48, #53, #56, #60, #63, #67
  (matching cadence; all labeled `status:needs-triage`).
- **AI discovery**: #28 (single).
- No open issue labeled `bug`, `regression`, `data-loss`, or similar this window.
- **Merged PRs touching app source**: #62 (Stage 25). Merged PRs touching
  non-app trees: #65, #66, #69, #70.

---

## 2. Current project state

### Core writing / editing flow — verified facts

- Default Write engine is `hybrid-cm6` (CodeMirror 6 + live-styling decoration
  walker) — pinned by `cm6-write-view/hybrid-cm6-readiness.test.js` and
  `cross-engine-smoke.test.js`.
- Write mode is now **narrowly interactive**: marker text in task list lines is
  clickable / keyboard-toggleable (Stage 23); inline links in `hybrid-cm6` are
  Cmd-clickable and keyboard-openable (Stage 25). Both paths route through
  **named peer modules**, not the walker — the walker (`cm6-hybrid-view.js`,
  586 lines) only gained ~26 lines of optional hooks across the two stages.
- Preview mode is Toast UI; untouched this week and last.
- `getText()` still returns raw Markdown; rendering policy's Option A baseline
  (visual-only decorations) is preserved by the existing pinned tests, and
  Section H invariants on `hybrid-cm6-readiness.test.js` remain 7/7 per the
  Stage 25 commit message.

### Local note storage — verified facts

- Vault is a user-chosen folder; notes are `.md` files on disk; no
  proprietary format (README headline guarantee).
- `apps/desktop/main.js` (748 lines) owns IPC; gained one new handler this
  window (`open-external-link`).
- `apps/desktop/preload.js` (53 lines) gained one new exposed method.
- No changes to vault load, vault choose, save, delete, or rename this window.

### Save / load behavior — code-supported inference

- The Stage 23 dispatch contract (one-character change, `userEvent:
  'input.toggle.task'`, NO `selection` field) means task-toggle writes go
  through the normal onChange path and inherit dirty-state and save flows
  unchanged. No new save / load test gap was introduced this window.
- The Stage 25 link-click path does **not** mutate the document — it only
  invokes `vaultApi.openExternalLink` — so it does not interact with dirty-
  state or save at all.

### Note switching, keyboard shortcuts — verified facts

- ArrowUp / ArrowDown navigation continues to be exempted from text-surface
  contexts (Toast UI Preview pane fix from the prior window is intact).
- New keyboard shortcuts since the last roadmap review: `Cmd-Shift-X`
  (task-toggle), `Cmd + Shift + O` (open link at caret). Both are documented
  in `README.md` and `docs/test-manual.md`.

### Editor architecture — verified facts

- Five-layer architecture remains intact: bundle (`cm6-bundle.js`, frozen
  since Stage 22.5; 26,751 lines built once) → entry → walker
  (`cm6-hybrid-view.js`) → peer modules (`cm6-task-toggle.js`,
  `cm6-link-click.js`) → `index.html` script-tag wiring.
- Rendering-policy contract (Option A baseline + narrow Option B exceptions)
  is now exercised twice: task-toggle (Stage 23) and link-click (Stage 25).
  Each lives in its **own peer module** behind its own invariants test, per
  the policy.
- The peer-module pattern has now scaled to **two** features without
  modifying the walker beyond optional `globalThis.Cm6*` hooks. This is good
  evidence the policy works.

### Known fragile areas — code-supported inferences and stated risks

- `apps/desktop/lib/cm6-link-click.js:isInsideFrontmatter` is an **intentional
  duplicate** of `cm6-hybrid-view.js:detectFrontmatter`. The Stage 25 entry
  in `stage-history.md` explicitly flags: "the two helpers MUST stay
  logically identical — Stop Condition 14 in the plan". This is the single
  most fragile coupling in the current write-path code, and it is not
  enforced by any test (no paired test asserts they return the same value
  on the same input). **Severity: medium** — silent drift here would cause
  Cmd-click to open links inside YAML frontmatter, which the policy forbids.
- `apps/desktop/test/cm6-write-view/link-click.test.js` is 1,170 lines —
  well over the project's ~300-line file-size guideline. The Stage 25 entry
  acknowledges this: "splitting was not pursued because the test file lifts
  the spike's helper scaffolding wholesale." This is a maintainability risk
  for future link-click work, not a correctness risk.
- `apps/desktop/index.html` is **3,473 lines** (up from 3,393 at the prior
  review). This file is now ~11× the project's 300-line guideline. It still
  carries renderer markup, styling, and most note-switching JavaScript.
  **Severity: medium-high** — every renderer change must thread through
  this single file.
- `plugins/workflow-orchestrator/` and `tools/mcp-note-ingest/` have grown
  rapidly outside the desktop app's test runner. These trees use their own
  pytest / Node test commands; a single regression there is not caught by
  `npm test` in `apps/desktop`. **Severity: low** — they do not affect the
  user-facing app at runtime, but they do affect the AI workflow that feeds
  the app.

### Test coverage — verified facts

- Last recorded full count (Stage 25 commit message): `npm test` **1035 /
  1033 / 0 / 2 / 0**, `npm run test:perf` **5 / 5 / 0 / 0**, focused
  link-click + invariants 60/60/0/0, `hybrid-cm6-readiness` 7/7/0/0 (Section
  H still green), `cm6-task-toggle-invariants` 1/1/0/0, `cm6-bundle-parity`
  8/8/0/0.
- Net test additions in this window: ≈ 125 new app-source tests on top of
  the prior baseline.

### Documentation quality — verified facts

- `README.md` is current with Stage 25 behavior.
- `docs/stage-history.md` is current through Stage 25 (16 stage rows in the
  "deferred" tail; the rest of the file is the full completed-stages table).
- `docs/test-manual.md` is current with Stage 25 manual-QA.
- `docs/rendering-policy.md` is current — Stage 21.1 resolved Q1 / Q2 / Q3,
  and Stage 23 + Stage 25 both consumed those answers.
- `docs/roadmap.md` is **out of date** — it still ends at Phase 7
  (packaging). It does not reference Stages 18 → 25, the rendering policy,
  the plugin layer, or the MCP vault tools. This is the biggest doc gap.

### Uncertainty

- Full local `npm test` was not re-run for this review (review-only
  routine). The 1035 / 1033 / 0 / 2 / 0 count is from the Stage 25 commit
  message; subsequent commits in the window (#65, #66, #69, #70) did not
  modify `apps/desktop/` source or tests, so the count should still hold,
  but this has not been independently verified in this report.
- The two "skipped" tests in the count (the `/ 2 /` in `1035 / 1033 / 0 / 2
  / 0`) have not been audited in this review.
- Whether the Stage 25 manual-QA checklist (27 items) has been fully
  executed against a real `npm run dev` build is not visible from git
  history. The commit was merged via PR #62, so presumably yes, but this
  review cannot confirm.

---

## 3. What became more important this week

1. **`isInsideFrontmatter` ↔ `detectFrontmatter` paired contract.** Stage 25
   introduced an explicit logical-duplicate guard. Until there is a test
   that pins both helpers to the same fixture table, every walker change
   that touches frontmatter detection is a silent risk to Cmd-click
   behavior in frontmatter regions.
2. **Maintaining the rendering-policy invariants under feature pressure.**
   Two Option B features have now landed (Stage 23 task-toggle, Stage 25
   link-click). Each was clean; each added a peer-contract test pinning
   `Decoration.replace` / `Decoration.widget` / `<a` / `href` / `<img` /
   `addEventListener` / `innerHTML` / `eval(` are absent from the peer
   module's source. This pattern needs to **stay disciplined** as more
   interactive features are proposed.
3. **`apps/desktop/index.html` growth.** Now 3,473 lines. Every renderer
   stage touches it. Splitting strategy is overdue for a written design
   note (not a refactor yet — just a documented plan).
4. **Roadmap/documentation drift.** `docs/roadmap.md` does not yet describe
   Phase-8-equivalent work (live-styled interactive Markdown surface). This
   undermines the project's own claim that "when user-facing behavior
   changes, update docs" (`CLAUDE.md`).
5. **Plugin/MCP test runner divergence.** Two new test ecosystems (pytest
   for `plugins/workflow-orchestrator/`, plus its own Node `npm run smoke`
   for `tools/mcp-note-ingest/`) now exist alongside `apps/desktop`'s
   `node --test`. There is no single "is the repo green?" command. This
   raises the bar for CI hygiene.
6. **Cross-platform open-link parity.** Stage 25 deliberately chose `Cmd`
   not `Cmd/Ctrl`. If any real user uses the app on Linux/Windows, the
   Cmd-click feature is invisible to them. This was a known carry-forward,
   but with the feature now live on `main`, it is no longer "future" — it
   is "present, broken on non-macOS."

---

## 4. What should be postponed

For each, the principle is the project's stated workflow (`CLAUDE.md`):
small reviewable changes, no refactor during bug fixes, no broad rewrites.

### 4.1 Splitting `apps/desktop/index.html` (postpone)

- **Why postpone:** It is 3,473 lines but it is **stable**. Net change this
  window was +2 lines. Splitting would touch every renderer-boot test and
  every CM6-write-view test by accident.
- **Risk if attempted now:** High. The renderer-boot test
  (`apps/desktop/test/renderer-boot.test.js`) is ~1,500 lines of selector-
  dependent assertions; a script-tag reorder breaks dozens at once. Stage 23
  + Stage 25 each added one `<script>` tag without trouble, which proves
  the *current* shape works.
- **Before returning:** First write a 1-page split-design note describing
  which extracted modules survive the existing tests; then propose it as a
  stage with its own pre-write baseline and post-write parity assertion.

### 4.2 Reference-style links, bare-URL clickability, raw-email autolinks (postpone)

- **Why postpone:** Stage 25 explicitly carry-forwards these as Stage 26+
  deferrals. The Cmd-click MVP is one week old and has not had a stabilizing
  user session yet. Adding more click surfaces now risks a regression
  before the current one is proven.
- **Risk if attempted:** Medium. Reference-style links would touch the
  Lezer-tree resolver (`resolveLinkAtPos`); raw-email autolinks would touch
  the validator (`validateExternalUrl`) AND its main-process twin in
  `external-url.js`. Two-edge changes are exactly what the policy warns
  against.
- **Before returning:** Have at least one Stage 25 stabilization week
  (manual QA replays, perf snapshot, edge-case bug-bash). Then propose
  one click surface per stage, with a paired-agreement test for both
  validators.

### 4.3 Cross-platform `Ctrl-click` (postpone)

- **Why postpone:** It is a one-line change in `isPrimaryModifier`, but it
  also reshapes the entire manual-QA matrix (need Linux + Windows passes).
  No user has yet asked for it.
- **Risk if attempted:** Low code risk; medium QA-burden risk.
- **Before returning:** Wait for the first real non-macOS user request, or
  bundle it with a broader cross-platform stage (e.g., packaging Linux
  builds).

### 4.4 Splitting `link-click.test.js` (postpone)

- **Why postpone:** It is 1,170 lines but it is also new and currently
  pinning a freshly-merged feature. Splitting before the feature has had
  one stabilization week introduces accidental coverage gaps.
- **Risk if attempted:** Medium. Some of those tests rely on shared
  scaffolding (`uninstallVaultApi`, `installSpikeHookSpy` removed, fixture
  table) that would have to be extracted carefully.
- **Before returning:** Same trigger as 4.2 — after a Stage 25 stabilization
  week, propose a test-file split as its own stage.

### 4.5 New plugin / MCP work in `plugins/` or `tools/` (postpone)

- **Why postpone:** Two ~5,000-line trees just landed in two days. Neither
  has had a "do they actually work end-to-end with the desktop app's vault"
  bake-in. Adding a third plugin or a fourth ingest tool before exercising
  what's already there is the broad-rewrite anti-pattern.
- **Risk if attempted:** Low to medium — the trees are isolated — but each
  adds doc-and-test surface that competes with desktop-app work.
- **Before returning:** Manually run `tools/mcp-note-ingest/`'s
  `npm run smoke`, end-to-end ingest one chat into a real vault, and review
  the resulting note in the desktop app. Then triage what's actually used.

### 4.6 Auto-save, multi-window, Claude Design prototype (postpone)

- These are already listed as "Deferred" at the tail of
  `docs/stage-history.md`. No change to that judgement.

---

## 5. Top 3 next-week priorities

### Priority 1: Pin the frontmatter-helper paired contract (Stage 26)

- **Priority name:** Frontmatter-helper paired-agreement test.
- **Why it matters:** Stage 25 introduced two helpers (`isInsideFrontmatter`
  in `cm6-link-click.js`, `detectFrontmatter` in `cm6-hybrid-view.js`) that
  are required to be logically identical, with **no test enforcing it**.
  Silent drift here breaks the rendering-policy contract that "frontmatter
  renders plain" — links inside YAML would open on Cmd-click.
- **Expected outcome:** One new test file (or one new `describe` block in
  an existing CM6 test file) that iterates a shared fixture table of
  frontmatter shapes (no FM, strict `---…---` FM, FM with `---` inside a
  code fence, FM with windows line endings if the helpers normalize, FM
  immediately followed by a link, FM that is malformed and should fall
  back to "not in FM"). It asserts both helpers return the same boolean
  for every (text, position) pair.
- **Likely files or areas:**
  - new test: `apps/desktop/test/cm6-write-view/frontmatter-helpers-agree.test.js`
  - read-only callers: `apps/desktop/lib/cm6-link-click.js`,
    `apps/desktop/lib/cm6-hybrid-view.js`
  - no source change unless the new test reveals real drift.
- **TDD angle:** Write the fixture table first; assert both helpers agree;
  watch all assertions pass on `main`. The test is the deliverable. If a
  fixture *does* surface drift, the priority becomes "fix the drift," and
  the human decides whether to extract a shared module (Stage 25 explicitly
  defers that to "a future stage if a third caller emerges").
- **Suggested first failing test:** A fixture with leading BOM-then-`---`:
  if either helper handles BOM differently, the test fails and surfaces it.
- **Manual QA needed:** None for the test-only path. If drift is found,
  re-run the Stage 25 27-item manual checklist after the fix.
- **Risk level:** **Low.** Test-only change unless drift is found.
- **Why safe enough for next week:** The change is additive, scoped to one
  test file, can't regress production, and directly protects the most
  fragile coupling in the current write path.

### Priority 2: Update `docs/roadmap.md` to reflect the post-Stage-25 reality

- **Priority name:** Roadmap-doc refresh.
- **Why it matters:** `docs/roadmap.md` ends at Phase 7 (packaging) and
  pre-dates the rendering policy, the peer-module pattern, the plugin
  layer, and the MCP vault tools. The project's own `CLAUDE.md` rule is
  "when user-facing behavior changes, update docs." Two user-visible
  behavior changes (task-toggle, link-click) landed without a roadmap
  edit. This drift makes the roadmap unreliable as a planning artifact.
- **Expected outcome:** A revised `docs/roadmap.md` with new Phase 8
  ("Live-styled interactive Markdown surface — task-toggle and link-click
  done, future Option-B candidates gated") and Phase 9 ("AI workflow
  infrastructure — workflow-orchestrator and MCP vault tools") sections.
  Each new phase lists what is done, what is deferred (with one-line
  reasons), and what triggers a return to it.
- **Likely files or areas:** `docs/roadmap.md` only. No code, no tests.
- **TDD angle:** Documentation, so not classical TDD. The "test" is a
  read-aloud check: every Stage 18 → 25 entry in `stage-history.md` should
  be findable in the new roadmap; every open routine-issue label
  (`daily-plan`, `routine:bug-risk-review`, `weekly-roadmap`,
  `ai-discovery`) should map to a phase.
- **Suggested first verification:** `grep -c 'Stage 2' docs/roadmap.md`
  should be **> 0** after the change (it is 0 now).
- **Manual QA needed:** None.
- **Risk level:** **Low.** Doc-only.
- **Why safe enough for next week:** No code path is touched; reviewer load
  is small; resolves an explicit project rule violation.

### Priority 3: Stage-25 stabilization session (manual QA replay + perf snapshot)

- **Priority name:** Stage 25 stabilization.
- **Why it matters:** Stage 25 introduced 60 new tests but it also widened
  the write-path interactive surface for the second time in two weeks. The
  Cmd-click feature is currently one merge old. Before the next interactive
  feature ships, the human needs to manually validate the live behavior
  against the 27-item checklist on a real `npm run dev` build, and confirm
  no perf regression.
- **Expected outcome:** A short report appended to `docs/test-manual.md` (or
  to a new `docs/routine-reports/manual-qa/2026-05-XX-stage-25-stabilization.md`)
  recording: 27/27 checklist outcome; perf-baseline numbers from `npm run
  test:perf` (should still be 5/5/0/0); any unexpected behavior. **No code
  changes.** If bugs are found, file them as Issues — do not fix them in the
  same stage.
- **Likely files or areas:** read-only against
  `apps/desktop/lib/cm6-link-click.js`, `cm6-hybrid-view.js`, the manual
  vault. Write-only against the stabilization report.
- **TDD angle:** Verification, not implementation. The stabilization
  report is the deliverable.
- **Suggested first verification:** Open a note containing
  `[link](https://example.com)` and Cmd-click it on a real Electron build.
  Confirm the system browser opens. This is the single most important
  manual check this week.
- **Manual QA needed:** Yes — the full 27-item Stage 25 checklist, plus the
  task-toggle smoke (8 items from `test-manual.md`).
- **Risk level:** **Low.** Read + manual only.
- **Why safe enough for next week:** It is the **opposite** of a risky
  change. It is the discipline step the project's workflow asks for.

---

## 6. One recommended milestone

**Milestone: "Stage 26 — Frontmatter-helper paired-agreement guard."**

- **Small enough for one week:** Yes. One new test file, ~80–150 lines,
  fixture-driven, no production source change unless drift is found.
- **Testable:** The test *is* the milestone.
- **Useful to the product:** It pins the only known fragile coupling in the
  current Write-mode interactive surface. It directly protects the
  rendering-policy invariant "frontmatter renders plain."
- **Architecture-preserving:** Yes — it adds *one* test, does not introduce
  a shared module (per the Stage 25 explicit deferral), and does not edit
  the walker.
- **Connected to the current state of the app:** Directly. Stage 25 created
  the duplicate. Stage 26 protects it.

This milestone is the smallest unit of work that closes the highest open
risk introduced in this window.

---

## 7. Technical debt

### 7.1 `isInsideFrontmatter` ↔ `detectFrontmatter` logical duplication

- **Description:** Two helpers in two files required to be identical, no
  enforcement.
- **Why it matters:** Silent drift breaks rendering-policy contract.
- **Fix now or later:** **Now** (Priority 1 / Milestone above).
- **Recommended timing:** This week.
- **Risk if ignored:** Medium. Bug surfaces only when someone touches one
  helper.

### 7.2 `apps/desktop/index.html` size (3,473 lines)

- **Description:** Single file hosts renderer markup, CSS, and note-
  switching JS.
- **Why it matters:** Every renderer change must thread through it. Pairs
  poorly with the project's 300-line guideline.
- **Fix now or later:** **Later**, with a written design note first.
- **Recommended timing:** After Stage 25 stabilization and after at least
  one more interactive feature has landed, so the extraction boundaries are
  clearer.
- **Risk if ignored:** Medium. Code-review burden grows linearly; no direct
  user impact.

### 7.3 `link-click.test.js` size (1,170 lines)

- **Description:** New test file ~4× the file-size guideline.
- **Why it matters:** Future link-click work has a high merge-friction cost.
- **Fix now or later:** **Later**, after Stage 25 stabilization.
- **Recommended timing:** Pair with Stage 26 or Stage 27 as a follow-on,
  not before.
- **Risk if ignored:** Low. Tests still run; risk is maintainer ergonomics.

### 7.4 Multiple test runners with no aggregator

- **Description:** `apps/desktop` uses `node --test`,
  `tools/mcp-note-ingest/` uses its own `npm run smoke`,
  `plugins/workflow-orchestrator/` uses `pytest` and `bash` greps.
- **Why it matters:** No single command answers "is the repo green?". CI
  green could mask a regression in any one tree.
- **Fix now or later:** **Later**, but write down the *current* per-tree
  commands in a single README block now.
- **Recommended timing:** When the second non-desktop tree gets a real
  user-visible role.
- **Risk if ignored:** Low for the desktop app; medium for the AI workflow.

### 7.5 `docs/roadmap.md` drift

- **Description:** Roadmap ends at Phase 7, pre-dates Stages 18 → 25.
- **Why it matters:** Project rule violation; planning artifact unreliable.
- **Fix now or later:** **Now** (Priority 2).
- **Recommended timing:** This week.
- **Risk if ignored:** Low for code; medium for project memory.

### 7.6 Cross-platform Cmd vs Ctrl

- **Description:** Link-click is macOS-only by design (`Cmd` not
  `Cmd/Ctrl`).
- **Why it matters:** Non-macOS users have an invisible feature.
- **Fix now or later:** **Later**, bundled with a broader cross-platform
  stage.
- **Recommended timing:** When the first non-macOS user surfaces, or when
  packaging Linux/Windows builds.
- **Risk if ignored:** Low (no current non-macOS user).

### 7.7 Skipped tests (the "2" in `1035 / 1033 / 0 / 2 / 0`)

- **Description:** Two tests have been skipped for an unknown number of
  weeks.
- **Why it matters:** Skipped tests rot; we don't know what they were
  protecting.
- **Fix now or later:** **Later**, but audit them within two weeks.
- **Recommended timing:** Stage 26.x or Stage 27.x, after Priority 1 lands.
- **Risk if ignored:** Low-to-medium depending on what they cover.

---

## 8. Test gaps

### 8.1 Save/load tests

- **Existing coverage:** `save-note.test.js`,
  `choose-vault-auto-load.test.js`, plus dirty-state tests.
- **Gap:** No test covers "task-toggle dispatch → dirty flag set → Cmd-S
  → file on disk reflects the toggled marker." That full chain has been
  validated only by Stage 23's manual QA.
- **Protects:** That the click-to-toggle path actually persists through the
  normal save flow.

### 8.2 Note-switching tests

- **Existing coverage:** Note-row tests, sidebar tests, ArrowUp/Down
  navigation.
- **Gap:** No test covers "Cmd-click a link in note A, system browser opens,
  then return to app and the active note is still A with caret intact."
  Stage 25 changed the focus model implicitly.
- **Protects:** That an external-link opening does not silently re-mount
  the editor or move the caret.

### 8.3 Write-mode tests

- **Existing coverage:** Strong (Section H, peer invariants, walker, bundle
  parity).
- **Gap:** No paired-agreement test for the two frontmatter helpers
  (Priority 1 above). No regression test that pins "Cmd-click inside a code
  fence that contains a `[link](https://…)` line **does not** open the
  link." That is the closest analogue to the frontmatter no-op and should
  be added.
- **Protects:** Rendering-policy invariants under feature pressure.

### 8.4 Preview-mode tests

- **Existing coverage:** Toast UI Preview pane is exempt from doc-level
  ArrowUp/Down nav (covered last window).
- **Gap:** No regression test that pins "Stage 25 did **not** wire link
  interactivity into Preview mode." Preview mode already has its own
  click-to-open behavior via Toast UI; we should pin that the new code path
  did not double-fire.
- **Protects:** That Preview-mode link behavior is unchanged.

### 8.5 Markdown round-trip tests

- **Existing coverage:** Implicit in `cm6-write-view` decoration tests.
- **Gap:** No explicit "load → display → save → reload" round-trip for a
  note containing a task list with mixed `[ ]` / `[x]` / `[X]` after a
  toggle. The `[X]` (uppercase) branch is parser-supported but I cannot
  see a save-round-trip test for it.
- **Protects:** That `[X]` survives load → toggle → save → reload
  byte-identical apart from the toggled character.

### 8.6 Keyboard-shortcut tests

- **Existing coverage:** `Cmd-Shift-X` (Stage 23), `Cmd + Shift + O`
  (Stage 25), Cmd/Ctrl+= / - / 0 (Stage 13).
- **Gap:** No conflict test that pins "`Cmd-Shift-X` is **not also** bound
  by any other CM6 extension or by the main-process accelerator." Same for
  `Cmd-Shift-O`.
- **Protects:** That a future extension does not silently steal a binding.

### 8.7 Dirty-state tests

- **Existing coverage:** `dirty-state.test.js`.
- **Gap:** No test for "Cmd-click on a link does **not** set dirty." The
  link-click path does not mutate the doc by design, so it shouldn't, but
  this is the kind of invariant that is easy to break silently.
- **Protects:** That viewing/clicking links is a read-only operation.

### 8.8 Regression tests

- **Gap:** No automated test pins "two peer modules can be loaded in any
  order without re-entrancy bugs in the walker hook." If a future stage
  reorders the `<script>` tags in `index.html`, we want a test to catch it.
- **Protects:** Walker-hook layering as the policy scales to a third peer
  module.

### 8.9 Manual QA scenarios still owed

- Full 27-item Stage 25 checklist on a real Electron build (Priority 3).
- Task-toggle (Stage 23) on a long document (1,000+ task items) — Stage 23
  pinned perf for the bundle but not for many-task documents.
- Chinese IME composition with task-toggle keyboard binding — IME-safety
  is asserted by `view.composing` checks but the manual replay is owed.
- Cmd-click while a save IPC is in flight (race scenario) — neither
  documented nor tested.

---

## 9. Documentation gaps

### 9.1 `docs/roadmap.md`

- **Status:** Out of date (stops at Phase 7, pre-rendering-policy,
  pre-plugin-layer).
- **Action:** Refresh under Priority 2 above. Add Phase 8 and Phase 9
  scaffolding.

### 9.2 README

- **Status:** Current with Stage 25.
- **Action:** None this week, except cross-link the (planned) new Phase 8
  section once Priority 2 lands.

### 9.3 Architecture notes

- **Status:** `docs/rendering-policy.md` is excellent. `docs/stage-history.md`
  is exhaustive. There is **no single page** that says "here are the five
  layers; this is how a peer module plugs in; here is the walker contract."
- **Action:** *Not* this week. After Stage 26, when there are *two*
  peer-module reference implementations, distill the pattern into one short
  page (`docs/architecture/peer-module-pattern.md`). Until then, the
  stage-history rows for Stages 23 and 25 are the de-facto reference.

### 9.4 Manual QA checklist

- **Status:** `docs/test-manual.md` has Stage 23 and Stage 25 sections.
- **Action:** Append a Stage 25 stabilization report under Priority 3.

### 9.5 Known bugs list

- **Status:** No dedicated `docs/known-bugs.md`. Open Issues serve this
  role today, but all 20 open Issues are routine-tracking, not bug
  reports.
- **Action:** *Not* this week. If a bug is found during Stage 25
  stabilization, file it as an Issue with a clear repro and link from
  `test-manual.md`.

### 9.6 Changelog

- **Status:** No `CHANGELOG.md`. Recent behavior changes are reachable only
  by reading `docs/stage-history.md`.
- **Action:** *Not* this week. Consider after Phase 9 work in
  `docs/roadmap.md` stabilizes — then add a user-facing changelog for the
  desktop app as a separate one-week stage.

### 9.7 Routine workflow notes

- **Status:** `plugins/workflow-orchestrator/skills/workflow/SKILL.md`
  documents the workflow plugin internally. There is no top-level page
  that explains "the daily-plan / daily-bug-risk-review / weekly-roadmap /
  ai-discovery loop and how it interacts with the codebase."
- **Action:** *Not* this week. A 1-page summary in `docs/` is owed once
  the plugin has been used end-to-end at least once.

---

## 10. Ready-to-copy Claude Code prompt

```
You are Claude Code working on the Markdown Vault App (Electron, hybrid-cm6
write engine, raw-Markdown-as-source-of-truth). The active project rules
in CLAUDE.md and docs/rendering-policy.md are binding.

Goal: implement Stage 26 — a paired-agreement guard test for the two
frontmatter detection helpers introduced by Stage 25.

Helpers (do not edit them; they are the subject under test):
- apps/desktop/lib/cm6-link-click.js  → isInsideFrontmatter(state, pos)
- apps/desktop/lib/cm6-hybrid-view.js → detectFrontmatter (see ~line 118)

Stage 25's stage-history row explicitly says these two helpers MUST stay
logically identical. There is currently NO test enforcing that. This stage
adds one.

Required workflow:

1. PLAN FIRST. Before any file write, post a plan that contains:
   - the exact new test file path you propose
     (apps/desktop/test/cm6-write-view/frontmatter-helpers-agree.test.js
     is the recommended path; argue if you disagree)
   - the fixture table you propose, as a flat list of objects
     { name, text, positions: number[], expectedAllAgree: boolean }
   - how you will load both helpers (require paths and any DOM shims)
   - what the test asserts: for every (text, pos) pair, both helpers
     return the same boolean
   - pre-write baseline command set you will run before any edit
   - post-write verification command set you will run before any commit

2. TDD-FIRST. Write the test before any production change. The expected
   outcome is the test passes against current main; if it fails, that is
   a real bug — STOP and report it, do not fix it in this stage.

3. MINIMAL CHANGES. No new shared module. No edits to cm6-link-click.js,
   cm6-hybrid-view.js, index.html, the walker, the bundle, the entry,
   any other peer module, package.json, or any existing test. The stage
   touches one new test file and one stage-history row only.

4. NO BROAD REWRITE. Do not refactor the existing helpers, do not extract
   them into a shared module, do not "tidy up" anything you encounter.

5. ARCHITECTURE PRESERVATION. The rendering policy is unchanged. Option A
   baseline + narrow Option B exceptions per stage. This stage adds zero
   primitives, zero event handlers, zero decorations. It is a test-only
   stage with one stage-history row.

6. TEST PLAN. The fixture table must include at least:
   - no frontmatter at all
   - strict `---…---` frontmatter at position 0
   - frontmatter followed immediately by a heading
   - frontmatter followed immediately by a link
   - `---` inside a fenced code block (not real frontmatter)
   - malformed frontmatter (no closing `---`)
   - BOM-prefixed file
   - CRLF line endings if either helper normalizes line endings
   - empty document
   - positions just before, just inside, and just after each `---` line
   For every (text, pos), assert
     isInsideFrontmatter(state, pos) === detectFrontmatter(state, pos)
   (or whatever the existing return-shape is — record the actual signature
   in the plan).

7. RISK ANALYSIS. If the test passes everywhere on main, the stage is
   complete and the risk is zero. If the test fails on any fixture, STOP,
   do not modify production code, post the failing fixture and the two
   return values, and hand off to the human for a decision on whether
   Stage 26 becomes a fix stage or a separate bug stage.

8. MANUAL VERIFICATION CHECKLIST.
   - `cd apps/desktop && npm test` count rises by N_new tests and
     baseline-count-on-main+N matches exactly; 0 failures, no new skips.
   - `npm run test:perf` unchanged (5/5/0/0).
   - Focused: `node --test test/cm6-write-view/frontmatter-helpers-agree.test.js`
     passes in isolation.
   - Focused: `node --test test/cm6-write-view/hybrid-cm6-readiness.test.js`
     still 7/7 (Section H green).
   - Focused: `node --test test/cm6-write-view/link-click.test.js` still
     59/59 (Stage 25 regression check).
   - `git diff` touches at most: the new test file, docs/stage-history.md
     row. Nothing else.

9. STOP CONDITIONS.
   - Stop if any helper signature differs from what the plan assumed.
   - Stop if any fixture surfaces real drift between the two helpers.
   - Stop if test count math does not match the formula
     baseline + N_new = post.
   - Stop if any unrelated test newly fails.
   - Stop if the diff touches any file outside the two listed above.

Commit message:
   test: Stage 26 — frontmatter-helpers paired-agreement guard

Do not open a PR; the human will review the local diff first.
```

---

## 11. Ready-to-copy Codex review prompt

```
You are Codex acting as a strict reviewer of the Stage 26 plan AND the
current weekly roadmap (docs/routine-reports/weekly-roadmap/
2026-05-17-weekly-roadmap-review.md). Project rules:
- CLAUDE.md: small reviewable changes, no refactor during bug fixes,
  files under ~300 lines, TDD-first, update docs when user-facing
  behavior changes.
- docs/rendering-policy.md: Option A baseline + narrow Option B
  exceptions only; Option C rejected; prohibited primitives are
  pinned by tests.
- docs/stage-history.md: every stage is one row; Stage 25 explicitly
  records that the two frontmatter helpers MUST stay identical and
  that extracting a shared module is deferred "if a third caller
  emerges."

Review the roadmap and the planned Stage 26 against this evaluation
checklist. For each item, answer "PASS", "PASS WITH NOTE", or "FAIL"
and explain in one or two sentences.

1. REALISM. Is the roadmap realistic for one week, given that the prior
   week added ~10,000 lines of plugin/MCP code in addition to Stage 25?
   Are the three priorities truly one-week-sized when summed?

2. PRIORITY CORRECTNESS. Is "frontmatter-helpers paired-agreement guard"
   genuinely the highest-value next step, or is there a higher-risk item
   (Stage 25 stabilization, roadmap doc refresh, skipped-test audit,
   `apps/desktop/index.html` size) that should jump ahead?

3. MINIMAL-CHANGE DISCIPLINE. Does the Stage 26 plan strictly avoid
   editing cm6-link-click.js, cm6-hybrid-view.js, the walker, the
   bundle, the entry, index.html, package.json, or any existing test?
   Flag any place where the plan implicitly invites broader change.

4. ARCHITECTURE PRESERVATION. Does the plan honor the rendering policy:
   no new decoration primitives, no new event handlers, no shared
   module extraction (Stage 25 deferred that)? Does it preserve
   Section H invariants on hybrid-cm6-readiness.test.js? Does it
   preserve the peer-contract test on cm6-link-click-invariants.test.js?

5. TDD PLAN STRENGTH. Is the fixture table complete enough to surface
   real drift (BOM, CRLF, code-fence `---`, empty doc, malformed FM,
   FM-then-link, FM-then-heading, positions on both `---` lines and
   inside the body)? Are there fixture categories missing? Is the
   assertion shape (both helpers return the same value) strong enough,
   or should it also assert specific expected values per fixture?

6. HIDDEN RISKS. What hidden risks does the roadmap miss? Specifically
   check:
   - Has the Stage 25 27-item manual QA actually been executed against
     a real Electron build? If not, Priority 3 is mandatory, not
     optional.
   - The two skipped tests (the "2" in `1035 / 1033 / 0 / 2 / 0`) —
     should they be audited this week or deferred?
   - The Stage 25 link-click + Stage 23 task-toggle on Linux/Windows —
     is "later" defensible, or is there a packaging implication that
     pulls it forward?
   - The plugin-layer / MCP-tools growth — does it warrant a "freeze
     non-desktop trees for a week" rule before Stage 26?
   - Save-IPC-in-flight + Cmd-click race scenario — should this be
     pinned by a test in Stage 26 itself, or split out?

7. POSTPONEMENTS. For each item in section 4 of the roadmap, judge
   whether the postponement is sound or whether one of them actually
   needs to ship next week instead of Stage 26.

8. STOP-CONDITION COMPLETENESS. Are the Claude Code prompt's stop
   conditions exhaustive? Suggest any missing stop conditions.

9. FINAL VERDICT. One of:
   - APPROVE roadmap and Stage 26 plan as written.
   - APPROVE with explicit modifications (list them).
   - REJECT — explain what must change before next week begins.

Do not implement anything. Do not edit any file. Return your review
as a single Markdown comment.
```

---

## 12. Markdown summary

```
# Weekly Roadmap Summary - 2026-05-17

## Main progress
- Stage 25 lifted the link-click renderer onto main: Cmd-click + `Cmd-Shift-O`
  open `https:` / `mailto:` links via the Stage 24.5 IPC bridge; frontmatter
  no-op; allowlist + modifier exclusion; rendering policy preserved.
- Stage 23 task-toggle and Stage 24.5 IPC bridge also reached main this week.
- Two large non-desktop trees landed: `plugins/workflow-orchestrator/` and an
  expanded `tools/mcp-note-ingest/` (6 vault tools).
- Test counts after Stage 25: `npm test` 1035 / 1033 / 0 / 2 / 0;
  `npm run test:perf` 5 / 5 / 0 / 0.

## Main risk
`isInsideFrontmatter` in `cm6-link-click.js` and `detectFrontmatter` in
`cm6-hybrid-view.js` are required to be logically identical but have no test
enforcing it. Silent drift would let Cmd-click open links inside YAML
frontmatter — a rendering-policy violation.

## Next milestone
Stage 26 — frontmatter-helpers paired-agreement guard. One new test file,
no production change, test-only stage.

## Top 3 priorities
1. Pin the frontmatter-helper paired contract (Stage 26).
2. Refresh `docs/roadmap.md` to cover Stages 18 → 25 + plugin/MCP layer.
3. Run the Stage 25 27-item manual QA on a real Electron build and record
   the result as a stabilization report.

## Tests to add
- Paired-agreement test for the two frontmatter helpers (Stage 26).
- "Cmd-click inside a fenced code block does not open the link" regression.
- "Cmd-click does not set dirty-state" invariant.
- Round-trip test for `[X]` (uppercase) task markers through toggle + save.
- Conflict test that `Cmd-Shift-X` and `Cmd-Shift-O` are bound only once.

## Documentation to update
- `docs/roadmap.md` (highest priority — currently ends at Phase 7).
- Append Stage 25 stabilization report to `docs/test-manual.md` (or a new
  manual-QA report file).
- Skip new architecture/changelog pages this week.

## My decision
TBD by human. Default recommendation: approve Stage 26 (Priority 1) as the
one-week milestone, do Priority 2 alongside it as a small parallel doc
edit, schedule Priority 3 as the gating manual session before any further
write-path interactive feature is proposed.

## Tags
#weekly-roadmap #stage-25 #stage-26-plan #rendering-policy
#frontmatter-helpers #peer-module-pattern #manual-qa-owed
#docs-roadmap-drift #plugin-layer #mcp-vault-tools
```
