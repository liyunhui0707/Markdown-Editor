# Weekly App Roadmap Review - 2026-05-08

> Review-only. No source files were edited; no commits or PRs created beyond
> this single Markdown report.
> Repo HEAD: `7bcdf59` (Merge PR #31 — Stage 13 + Stage 13.1).
> Window: HEAD~7..HEAD (7 commits, 5 merged PRs: #25, #26, #27, #29, #30, #31).
> Tests at HEAD: **801 / 801 passing** per Stage 13 commit message.

---

## 1. Weekly progress

A focused, low-risk polish week. Almost every diff is renderer-local; the
adapter layer (`lib/cm6-write-view.js`, `lib/hybrid-write-view.js`,
`lib/cm6-hybrid-view.js`) was untouched, and `lib/cm6-bundle.js` was not
rebuilt.

### Important commits (HEAD~7..HEAD)

| SHA | Subject |
|---|---|
| `b4bfbde` | fix: sync pending title and add per-note save latch (#25) |
| `ebe9072` | test: add hybrid-cm6 default-readiness coverage (Stage 11.11) |
| `635f443` | feat: add bottom scroll padding to CM6 editor (Stage 12.1) (#27) |
| `ba0432b` | feat: hide CM6 line-number gutter and active-line background (Stage 12.2) |
| `f0cbbb3` | fix: exempt Toast UI Preview pane from ArrowUp/ArrowDown note nav (#23-C) |
| `5811bd6` | feat: add editor text-size adjust and Preview heading spacing fix (Stage 13 + Stage 13.1) |
| `7bcdf59` | Merge PR #31 (Stage 13 head into main) |

### Changed files / areas

`git diff HEAD~7 HEAD --stat`:

```
 apps/desktop/index.html                                  |  507 +++++---
 apps/desktop/test/cm6-write-view/hybrid-cm6-readiness.test.js |  299 +++++ (new)
 apps/desktop/test/renderer-boot.test.js                  | 1278 +++++++++++++++++++-
 3 files changed, 1933 insertions(+), 151 deletions(-)
```

- **Renderer (`apps/desktop/index.html`):** now **3393 lines** (was ~3162
  last week, ~3228 mid-week — +231 lines net for the week). All growth is
  CSS rules (Stage 12.1 padding, Stage 12.2 gutter / active-line, Stage
  13 / 13.1 font-size variable + Preview heading scaling) plus a small
  keydown branch for Cmd/Ctrl+= / - / 0 and a Preview-pane exemption.
- **Tests:** `renderer-boot.test.js` grew by ~1278 lines (Stage 13 added
  ~403, Stage 12.2 added 52, Stage 12.1 added 19, #23-C added 89, plus
  PR #25's title-sync / save-latch tests). New file
  `test/cm6-write-view/hybrid-cm6-readiness.test.js` (299 lines, Stage 11.11)
  pins the contract for the experimental `?writeEngine=hybrid-cm6` engine.
- **Adapter layer:** unchanged (`lib/cm6-*.js`, `lib/hybrid-write-view.js`,
  `lib/file-name.js`, `lib/dirty-state.js`, `lib/close-guard.js`).
- **Main process:** unchanged (`apps/desktop/main.js`, `preload.js`).
- **Bundles:** `lib/cm6-bundle.js` was **not rebuilt** this week — none of
  the merged work changed `lib/cm6-entry.js` content, so this is correct.

### Completed work

- **PR #25 / #22 (carry-over hardening):** `syncSelectedTitleFromInput`
  runs before save predicates, and a per-note in-flight save latch
  (`savePerNoteInProgress`) prevents IPC double-dispatch on rapid Cmd+S.
- **Stage 11.11:** test-only coverage of the `hybrid-cm6` engine's default
  readiness — keeps the experimental path under contract without flipping
  it on for users.
- **Stage 12.1:** `#hybridWritePane .cm-content { padding-bottom: 50vh }`
  — long notes can scroll past their last line. Layout only; no doc / save
  / Preview impact.
- **Stage 12.2:** hides line-number gutter and the active-line background
  via `display: none` and `background: transparent !important`. The CM6
  chrome stays registered (lineNumbers, highlightActiveLine,
  highlightActiveLineGutter) so the `.cm-activeLine` class is still
  emitted, which is load-bearing for the Stage 11.4 / 11.5 marker-reveal
  rules used by `?writeEngine=hybrid-cm6`.
- **#23-C fix:** Toast UI Preview pane is now in the `inTextSurface`
  exemption list for the document-level ArrowUp/ArrowDown note-nav handler.
  Test harness `contains()` was made recursive to mirror real
  `Node.contains` semantics.
- **Stage 13:** Editor text-size keymap — `Cmd/Ctrl+=` / `Cmd/Ctrl+Shift+=`
  zoom in, `Cmd/Ctrl+-` zoom out, `Cmd/Ctrl+0` reset. Discrete step list
  `[12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36]`, default 15. Persisted
  to `localStorage.markdownVault.editorFontSize` with strict numeric
  parsing on read; boot restores without persisting; only keyboard actions
  write back. `Cmd+Alt+=` deliberately does NOT zoom or consume the key.
  IME composition (`e.isComposing`) suppresses the shortcut.
- **Stage 13.1:** Preview heading margins, line-heights, and H1/H2
  padding-bottom made em-relative under
  `.toast-preview-mount .toastui-editor-contents`. Toast UI's bundled
  border-bottom values are deliberately NOT redeclared (a regex test
  asserts the new H1/H2 rules contain no `border-bottom`).

### Tests added or updated

- `test/cm6-write-view/hybrid-cm6-readiness.test.js` — **new**, 299 lines.
- `test/renderer-boot.test.js` — +1278 lines across all five merged
  features. Includes harness extensions for multi-key `localStorage` with
  `setItem` recording, `documentElement`, and
  `style.setProperty/getPropertyValue`; recursive `contains()`; and
  block-bound CSS source regexes for Stage 12.1, 12.2, 13, 13.1 contracts.

### Documentation changes

- **None merged this week.** README and `docs/test-manual.md` do not yet
  reflect the new font-size shortcuts (Stage 13) or the Preview-pane arrow
  exemption (#23-C). This is the largest doc-lag in the repo today and is
  called out in §3 and §9.

### User-visible behaviour changes

1. Saves no longer race or double-dispatch when Cmd+S is pressed twice
   quickly on the same note.
2. Long notes can scroll past their last line (mid-viewport landing).
3. Line-number gutter and active-line background no longer render in CM6.
4. ArrowUp / ArrowDown inside the Toast UI Preview pane scrolls the
   preview instead of switching notes.
5. Cmd/Ctrl+= / Cmd/Ctrl+- / Cmd/Ctrl+0 adjust editor font size
   (12 → 36 px discrete steps), persisted across launches; Preview text
   and headings scale together; Cmd+Alt+= remains free for the OS.

### Issue / routine activity

- Closed: daily plans #18 (2026-05-05), #24 (2026-05-06).
- Open: #28 (AI discovery 2026-05-07), #14 (last weekly roadmap),
  #21 (older AI discovery), #23 (today's bug review — R1 still relevant
  for the empty-title vault save), #11 (CM6 Markdown formatting shortcuts —
  still not shipped, still on the queue).

---

## 2. Current project state

### Verified facts (read directly from HEAD)

- CM6 is the production write engine. `?writeEngine=hybrid` is the legacy
  fallback. `?writeEngine=hybrid-cm6` is an experimental engine now under
  test contract (Stage 11.11).
- `apps/desktop/index.html` is **3393 lines**.
- `apps/desktop/main.js` is **737 lines**.
- `apps/desktop/preload.js` is 52 lines.
- `apps/desktop/lib/cm6-entry.js` is unchanged from prior weeks; registers
  only `defaultKeymap`, `historyKeymap`, `searchKeymap` (still **no
  Markdown formatting keymap** — Cmd/Ctrl+B / Cmd/Ctrl+I / Cmd/Ctrl+K
  remain unbound in CM6).
- `apps/desktop/lib/cm6-bundle.js` is **1 059 058 bytes**, mtime aligned
  with this week's renderer changes but not actually rebuilt; there is
  still **no freshness check** in `npm test`.
- Empty-title save guard: still asymmetric. The widening flagged by
  daily plan #24 / bug review #23 R1 (vault note with cleared title) is
  **not in this week's diff**.
- Test counts: 772 (post-Stage 12.2) → 775 (post-#23-C) → 801 (post-Stage
  13 + 13.1). All green.
- `tools/mcp-note-ingest/` ships and the smoke test still exists.
- LICENSE file at repo root: present (`LICENSE`, MIT).

### Code-supported inferences

- **Save / load flow** is materially complete for v1: dirty tracking,
  draft preservation across navigation and vault switch, close-guard,
  Save-All-&-Quit, duplicate-filename guard, file-rename on title change,
  per-note save latch, and (as of PR #22 / #25) up-to-date title sync
  before predicate evaluation.
- **Note switching** is healthy: arrow-key nav has a clean `inTextSurface`
  exemption list (title input, search input, `hybridWritePane`, and now
  the Toast UI Preview mount). The same handler still does NOT scope by
  modifier-key combinations (a future concern, not a current bug).
- **Editor architecture** continues to honour the adapter boundary —
  every Stage 12 / 13 change landed as renderer-local CSS or DOM-level
  keydown logic, not as CM6 extension changes. This is good architectural
  hygiene.
- **Test architecture** is becoming heavier than the production code it
  protects. `renderer-boot.test.js` is now well over 5 000 lines (started
  the week at ~4 850 + 1 278 added = ~6 100+). The harness is gaining
  capabilities (`localStorage` shim with `setItem` recording,
  `documentElement` shim, `style.setProperty`/`getPropertyValue` shim,
  recursive `contains()`) that increasingly resemble a re-implementation
  of the DOM. This is a long-term maintainability risk.
- **Documentation quality** has fallen behind shipped behaviour for the
  first time in a while: Stage 13 ships an entire keyboard surface (three
  shortcuts + persisted setting) with **no README mention and no
  test-manual checks**. #23-C ships a UX fix the manual checklist cannot
  catch a regression of.

### Uncertainty

- **Manual QA on Stage 13 / 13.1.** The commit messages assert "Manual QA:
  passed", but the manual checklist itself was not updated, so future
  regressions cannot be caught by following `docs/test-manual.md`. A
  human who reads the checklist today will not even know font-size
  shortcuts exist.
- **`hybrid-cm6` engine readiness.** Stage 11.11 added contract tests but
  did not flip the default. It's unclear from this week's diffs whether
  the engine is being prepared for promotion or simply being protected
  during incidental edits. Worth a project-memory note before more
  CM6-hybrid-only CSS (e.g. Stage 11.4 / 11.5 marker-reveal) accretes.
- **Bundle freshness assumption.** `lib/cm6-bundle.js` was not rebuilt
  this week, which is correct because `lib/cm6-entry.js` is unchanged.
  But this is the second week in a row the bundle has been *manually*
  verified rather than enforced. The next CM6 keymap change (e.g. issue
  #11) will hit this exposure first.

### Known fragile areas (carryover)

- `apps/desktop/index.html` monolith — now 3393 lines (+231 this week).
- `apps/desktop/main.js` — 737 lines, mixes window lifecycle / IPC /
  vault watcher / save flow / close-guard wiring.
- `lib/cm6-bundle.js` — 1 MB committed artifact, no freshness check.
- `renderer-boot.test.js` — single test file holding most renderer
  behaviour pinning.
- Empty-title save guard for vault notes (silent rename risk; still open
  per #23 R1).
- `Cmd/Ctrl+N` / `Cmd/Ctrl+S` `document.activeElement` scoping for text
  inputs (#23 R2; partially addressed by the title-sync fix in #25 but
  not by activeElement scoping itself).

---

## 3. What became more important this week

1. **Documentation lag is now a real gap, not a theoretical one.**
   Stage 13 ships three new keyboard shortcuts and a persisted
   user-preference, with **zero** README or `docs/test-manual.md`
   updates. CLAUDE.md says "When user-facing behavior changes, update
   docs." This week breaks that contract. Risk: regressions to the
   font-size shortcuts will not be caught by manual QA, and a new user
   will not discover the feature exists.

2. **The vault-note empty-title save bug (#23 R1 / carry-over from
   #17 R1, #18) is now the oldest unfixed data-safety issue in the repo.**
   Two daily plans (#18, #24) targeted it; neither shipped. PR #22 / #25
   *strengthened* the predicate path (titles are now sync'd from the DOM
   before evaluation), so the only thing standing between a user clearing
   a title and a silent rename to `untitled-note.md` is the missing
   `vault` branch. The longer this sits, the more confusing it becomes
   that the codebase already does most of the work.

3. **The `index.html` monolith grew another 231 lines.** Stage 12 / 13
   diffs were architecturally clean (renderer-local, no adapter touch),
   but `index.html` is now 11× the CLAUDE.md ~300-line guideline. The
   class of bugs we'll start to see is "rule X added in Stage N
   accidentally fights rule Y added in Stage M": Stage 13.1 itself was
   exactly this story (Stage 13's em-relative font-size collided with
   Toast UI's px-fixed heading margins). Each new feature week makes the
   *next* fight more likely.

4. **`renderer-boot.test.js` is now reimplementing the DOM.** This week
   alone added: multi-key `localStorage` with `setItem` recording,
   `documentElement`, `style.setProperty` / `getPropertyValue`, recursive
   `contains()`. Each is a defensible local fix; collectively they mean
   the test harness is becoming its own product. A regression in the
   harness would be hard to attribute.

5. **Markdown formatting shortcuts (#11) are now overdue.** The CM6
   editor surface has gained gutter polish, scroll padding, font-size
   adjust, and Preview heading scaling, but Cmd/Ctrl+B / Cmd/Ctrl+I /
   Cmd/Ctrl+K are still unbound. This is the most-named missing feature
   on the focus list, and the editor is otherwise in a good state to
   accept it.

---

## 4. What should be postponed

| Item | Why postpone | Risk if pulled forward | What should happen first |
|---|---|---|---|
| **Hybrid editor removal** | CM6 is stable but not the only safety net; Hybrid was used to triangulate Stage 13's font-size cascade. | Loss of triangulation tool while we are *adding* CSS variable surfaces. | Wait until at least one full week passes with no Hybrid-specific bug or comparison referenced in commits. |
| **CM6 spike code cleanup** (`lib/spike-cm6-*`, `spike/codemirror6/`) | Still untouched at runtime. | Touching it would force a bundle / build path discussion mid-feature work. | Defer until after the renderer split (debt #1). |
| **`?writeEngine=hybrid-cm6` as default** | Stage 11.11 is contract scaffolding, not a promotion signal. Marker-reveal CSS rules from Stages 11.4 / 11.5 still need broader manual exercise. | Promoting now risks regressing IME / undo / dirty-state on a path that has only had test-level coverage. | Run a deliberate manual QA pass against the experimental engine; only then schedule promotion. |
| **Renderer monolith split** (`index.html` → `lib/renderer.js`) | Tempting after this week's +231 LOC, but a split during CM6 keymap work (P1) would fight the diff. | Mass-rename in renderer would make Codex review of the keymap PR much harder. | Land Markdown shortcuts (P1) and bundle-freshness (P2) first; split in a dedicated PR with no behaviour change. |
| **Auto-save** | Close-guard + Save-All-&-Quit + per-note latch already absorb most data-loss surface. | New transaction source on the dirty-state path during an active feature week. | Defer until after renderer split. |
| **Multi-window, plugin system, graph view, backlinks UI, cloud sync** | Per `docs/mvp.md` non-goals. | Architectural blast radius. | Do not pull forward. |
| **Cmd/Ctrl+K (link), heading shortcuts, list shortcuts** | Out of scope for the next-week bold/italic surface. | Bigger PR, more conflict surface with Stage 13's keydown branch. | Land bold/italic first; revisit in a follow-up daily plan. |

---

## 5. Top 3 next-week priorities

> Constraint reminder: these are **next-week** priorities. They do NOT
> include a renderer split. They do NOT include hybrid-cm6 promotion.
> Each is small, reviewable, and architecture-preserving.

### P1 — Doc catch-up: Stage 13 + Stage 12 + #23-C in README and test-manual

- **Why it matters.** CLAUDE.md mandates docs updates when user-visible
  behaviour changes. This week shipped four user-visible changes with no
  doc updates. Without P1, both manual QA and onboarding silently degrade.
- **Expected outcome.**
  - `README.md` "Editor" or new "Keyboard shortcuts" subsection: lists
    Cmd/Ctrl+= / - / 0 (font size), Cmd/Ctrl+N / S (file ops), and the
    persisted-step list at a high level. Mentions that ArrowUp / ArrowDown
    in the note list does NOT trigger inside the title input, search,
    editor, or Preview pane.
  - `docs/test-manual.md`: under "Editor mode (CM6 / Hybrid)" add three
    rows for font-size in / out / reset (verify persistence across
    relaunch, verify Cmd+Alt+= does not zoom, verify IME does not zoom).
    Under "Visual appearance" add one row for the hidden line-number
    gutter and absent active-line background. Add a row under a new
    "Note navigation" subsection for ArrowDown inside Preview not
    switching notes.
- **Likely files / areas.** `README.md`, `docs/test-manual.md`,
  optionally a one-line entry in `docs/stage-history.md` for Stages 12.1
  / 12.2 / 13 / 13.1.
- **TDD angle.** Docs-only, so no production TDD. The verification is
  manual: each new manual-QA row must be performable by a human reading
  only the doc.
- **Suggested first verification.** Open `docs/test-manual.md` on a
  fresh terminal session. For each new row, perform the action from the
  doc text alone (no glance at code). If the row is performable and the
  expected outcome is unambiguous, the row passes review.
- **Manual QA needed.** Walk the new test-manual rows on a packaged build.
- **Risk.** **Low.** No code, no tests, no bundle, no IPC.
- **Why safe enough for next week.** Documentation-only PR is the
  ideal "wedge" change to ship while priorities P2 / P3 are under
  development.

### P2 — Markdown formatting shortcuts in CM6 (Cmd/Ctrl+B, Cmd/Ctrl+I)

- **Why it matters.** Issue #11 has been open the longest of any
  product-relevant issue. The CM6 surface has matured around it for three
  weeks. CLAUDE.md flags Markdown shortcuts as a focus area. The editor
  is otherwise in a good state to accept it.
- **Expected outcome.** Cmd/Ctrl+B toggles `**bold**`, Cmd/Ctrl+I toggles
  `*italic*` on the CM6 surface; one transaction per toggle (one undo
  step); empty selection inserts paired markers with cursor between;
  multi-line selection wraps the full range; idempotent under repeated
  toggle; suppressed during IME composition; bundle regenerated and
  committed.
- **Likely files / areas.**
  - New: `apps/desktop/lib/markdown-shortcuts.js` (pure
    `toggleSurround(view, marker)` helper, < 150 lines).
  - Edited: `apps/desktop/lib/cm6-entry.js` (append `keymap.of([{ key:
    'Mod-b', run: toggleBold }, { key: 'Mod-i', run: toggleItalic }])` to
    `chrome`).
  - Regenerated: `apps/desktop/lib/cm6-bundle.js` (committed in the same
    PR).
  - New: `apps/desktop/test/markdown-shortcuts.test.js`.
  - Untouched: `lib/cm6-write-view.js` adapter, `lib/hybrid-write-view.js`,
    `index.html`, `main.js`, `preload.js`.
- **TDD angle.** RED — write `toggleSurround` against pure
  `EditorState`-shaped fixtures: wrap non-empty, strip wrapped, empty
  selection inserts + positions cursor, multi-line, idempotence, bold +
  italic. GREEN — implement helper + wire keymap. REFACTOR — extract
  shared marker-toggle.
- **Suggested first failing test.**
  `test/markdown-shortcuts.test.js`:
  ```
  it("toggleBold wraps a non-empty selection", () => {
    const result = toggleSurround({ doc: "hi", from: 0, to: 2 }, "**");
    assert.equal(result.doc, "**hi**");
    assert.deepEqual(result.selection, { from: 2, to: 4 });
  });
  ```
- **Manual QA.** In CM6: select word, Cmd+B, verify `**word**`. With
  empty selection, Cmd+I, verify cursor is between the markers. Type a
  Chinese character mid-composition with Cmd+B held — verify no toggle.
  Cmd+Z reverses each toggle in one step. Note switch then Cmd+B —
  verify keymap survives `view.setState`.
- **Risk.** **Low.** Pure transformation on EditorState; no IO; CM6
  suppresses keymaps mid-IME.
- **Why safe enough for next week.** Adapter boundary preserved.
  Bundle change is mandatory but small. P3 (below) lands the safety net
  for forgetting bundle rebuild.

### P3 — Bundle-freshness check for `cm6-bundle.js`

- **Why it matters.** P2 is the first weekly priority that ships a CM6
  keymap change in three weeks. The single highest "green tests, broken
  app" failure mode in this repo is forgetting `npm run build:cm6` after
  editing `cm6-entry.js`. P3 makes that class of failure impossible.
- **Expected outcome.** `npm test` runs (or invokes) a script that
  rebuilds `cm6-bundle.js` to a temp file and asserts byte / hash
  equality with the committed `lib/cm6-bundle.js`. Failing the assertion
  fails CI and the local pre-commit run.
- **Likely files / areas.** New `tools/check-bundle-fresh.js` (~50 LOC),
  `apps/desktop/package.json` (extend `test` script), optional
  `tools/check-bundle-fresh.test.js` for the helper.
- **TDD angle.** RED — write the assertion script and deliberately stage
  a stale `cm6-bundle.js` locally; confirm the script fails. GREEN —
  wire it into `npm test` after the existing test glob; running with the
  freshly-rebuilt bundle passes. REFACTOR — extract a shared helper if
  the toastui bundle gets the same treatment later (out of scope this
  week).
- **Suggested first failing verification.** Locally: `git stash` after a
  legitimate `npm run build:cm6`, hand-edit `lib/cm6-bundle.js` to
  insert a single byte, run `npm test` — assert it fails on the
  freshness check, not on a behaviour test.
- **Manual QA.** Run `npm test` on a clean tree; should pass. Edit
  `lib/cm6-entry.js` (append a no-op comment), do NOT rebuild, run
  `npm test`; should fail. Run `npm run build:cm6`, run `npm test`;
  should pass.
- **Risk.** **Low–Medium.** esbuild output is deterministic across the
  same `esbuild` version, but the version pin must be respected. Avoid
  bumping `esbuild` in the same PR.
- **Why safe enough for next week.** Defensive infrastructure;
  quarantined to `tools/`; does not touch product code.

---

## 6. One recommended milestone

**M9 — "Editor surface honest and protected": ship Markdown formatting
shortcuts behind a bundle-freshness gate, with documentation that
matches the app a user actually sees.**

Definition of done:

1. P1 — README and `docs/test-manual.md` cover Stage 12.1, 12.2, 13,
   13.1, and #23-C.
2. P2 — Cmd/Ctrl+B and Cmd/Ctrl+I work in CM6. `markdown-shortcuts.js`
   exists with unit tests; `cm6-entry.js` registers the keymap;
   `cm6-bundle.js` is regenerated and committed.
3. P3 — `npm test` enforces freshness for `lib/cm6-bundle.js`; a stale
   bundle is a test failure.
4. `docs/stage-history.md` adds rows for 12.1, 12.2, 13, 13.1, and a new
   stage entry for the bold/italic shortcut work.
5. Issue #11 is closed with a "delivered in PR …" comment.

Ship target: end of next week. This milestone deliberately does **not**
split the renderer monolith and does **not** promote `hybrid-cm6`. It
fits the week, it is testable, it is useful (one user-facing feature,
two safety / documentation lines of defence), and it preserves the
current architecture.

---

## 7. Technical debt

| # | Description | Why it matters | Fix now or later? | Recommended timing | Risk if ignored |
|---|---|---|---|---|---|
| 1 | `apps/desktop/index.html` is 3 393 lines (+231 this week). | Every new shortcut, CSS rule, or selector concentrates here. Stage 13.1 was already an "earlier rule fights newer rule" bug. | Later (not next week). | Dedicated split PR after M9; extract `lib/renderer.js` and a `lib/renderer-styles.css`. | Increasing rate of cross-feature collisions; PR diffs become harder to review. |
| 2 | `apps/desktop/main.js` is 737 lines, mixed concerns. | Same monolith pattern in main process. | Later. | After renderer split. | Harder onboarding; close-guard / IPC drift risk. |
| 3 | No bundle-freshness check for `lib/cm6-bundle.js`. | Silent feature breakage class. | **Now (P3)**. | Next week. | First real CM6 keymap change (P2) ships green tests + broken keymap. |
| 4 | Vault-note empty-title save guard still missing. | Data-safety regression. Silent rename to `untitled-note.md`. | Soon. | Week after M9. | Ongoing user data confusion when titles are cleared. |
| 5 | Cmd/Ctrl+N / Cmd/Ctrl+S have no `document.activeElement` scoping for text inputs. | Cmd+S in title input partially mitigated by the title-sync fix; Cmd+N in search input still silently switches drafts. | Later. | Week after M9. | Subtle UX regression that surfaces only under specific focus states. |
| 6 | Spike code (`lib/spike-cm6-*`, `spike/codemirror6/`) is dead at runtime but still tested and shipped (~27 K LOC bundle). | Dead weight in the repo and the bundle audit surface. | Later. | After Hybrid removal becomes a real plan. | Confusion about which engine is "real". |
| 7 | `editor-config.js` ships a `['heading','bold','italic']` toolbar list that only Hybrid consumes; CM6 path silently ignores it. | When P2 lands, the disconnect becomes more visible. | Later. | Same PR as Hybrid removal. | Reviewers confused why the array is there. |
| 8 | `renderer-boot.test.js` is well over 5 000 lines and now contains a partial DOM re-implementation. | Maintainability and attribution risk. | Later, but watch closely. | When test growth slows, or when one feature's tests cleanly factor out. | A harness regression would be hard to localise. |
| 9 | No CI workflow. All tests are local. | Bundle-freshness (debt #3) and the 801-test suite both depend on the contributor remembering to run them. | Later. | After P3 lands; a `.github/workflows/test.yml` is then a 1-file PR. | Local-only enforcement is brittle as more contributors join. |
| 10 | `docs/test-manual.md` does not cover Stages 12.x / 13.x or #23-C. | Manual QA blind spot. | **Now (P1)**. | Next week. | Future regressions slip past human review. |
| 11 | `?writeEngine=hybrid-cm6` is contract-covered (Stage 11.11) but undocumented for users / contributors. | Engine flag with three valid values is now a real config surface. | Later. | When (or if) `hybrid-cm6` is promoted. | Confusion in `write-engine.js` hand-offs. |

---

## 8. Test gaps

For each gap: the user-visible behaviour it would protect.

| # | Test gap | What it protects |
|---|---|---|
| 1 | **Markdown round-trip after font-size change.** No test asserts that toggling Cmd+= → save → reload yields byte-identical Markdown. (It should — font-size is a CSS variable, not a doc transform — but no test pins it.) | Stage 13 cannot accidentally introduce a layout-driven change that leaks into save payloads. |
| 2 | **Vault-note empty-title save** (carry-over from #23 R1). | Clearing a vault note's title does not silently rename to `untitled-note.md`. |
| 3 | **Cmd/Ctrl+N inside the search input is a no-op (or returns focus correctly).** | New-note shortcut does not silently fire while user is typing in search. |
| 4 | **Cmd/Ctrl+S inside the title input flushes the just-typed character before save.** PR #25 added the title-sync; a unit test that pins it (vs. the integration tests in renderer-boot) would make the contract explicit. | Save never persists a stale title. |
| 5 | **Markdown formatting toggle is suppressed during IME composition.** Required by P2 before merge. | Chinese IME users do not lose input mid-composition to a stray Cmd+B. |
| 6 | **Markdown formatting toggle survives `view.setState` after a note switch.** Required by P2 before merge. | Switching notes does not silently break the keymap. |
| 7 | **`cm6-bundle.js` freshness.** P3. | `cm6-entry.js` edits cannot ship green tests + a stale bundle. |
| 8 | **Per-note save latch under three-stroke Cmd+S.** PR #25 covered two strokes; three+ rapid strokes might still race against the IPC reply path (low likelihood, but uncovered). | Save IPC remains single-flight per note under user impatience. |
| 9 | **Save All & Quit on a vault note with cleared title.** Pair test for #2 above. | Close-guard correctly aborts and keeps the app open. |
| 10 | **Preview-pane scroll on PageDown / Home / End.** #23-C only covered Arrow keys. | Other scroll shortcuts inside Preview do not trigger note nav. |
| 11 | **Font-size persistence across vault switch.** (Stage 13 persists per-app, not per-vault, but the test surface does not assert that vault switch leaves the value untouched.) | User does not see font reset when changing vaults. |
| 12 | **Manual QA scenarios:** font-size shortcuts (in / out / reset / Cmd+Alt+= no-op / IME no-op), gutter hidden, Preview ArrowDown scroll, Preview heading spacing at max zoom. All belong in `docs/test-manual.md` (P1). | Future regressions caught by humans following the checklist. |

---

## 9. Documentation gaps

| Doc | Gap | Recommended action |
|---|---|---|
| `README.md` | No mention of font-size shortcuts (Cmd/Ctrl+= / - / 0). No mention of the persisted step list. No mention of the Preview-pane arrow exemption. The "Editor" paragraph does not enumerate the shortcut surface. | P1: add a "Keyboard shortcuts" subsection (or expand "Editor"). One short paragraph + a 5-row table is enough. |
| `docs/test-manual.md` | Missing rows for Stage 12.1 (scroll past end), Stage 12.2 (gutter hidden, no active-line background), Stage 13 (font-size in / out / reset / Cmd+Alt+= no-op / IME no-op / persistence across relaunch), Stage 13.1 (Preview heading spacing at max zoom does not overrun the underline), #23-C (Preview ArrowDown does not switch notes). | P1: add ~8 rows across "Editor mode" and "Visual appearance"; add a new "Note navigation" subsection. |
| `docs/stage-history.md` | Last entry is Stage 7.2. Missing 11.x, 12.1, 12.2, 13, 13.1. | P1: append 5–6 rows. Keep each row to one line. |
| `docs/roadmap.md` | Roadmap is still framed in Phase 0–7 (concept → packaging). The app is past Phase 7. | Out of scope for next week. Consider a successor doc after M9 lands. |
| Architecture notes | No file documents the renderer monolith, the `write-engine.js` flag system, or the adapter boundary. | After renderer split (debt #1). Premature now. |
| Manual QA checklist for `?writeEngine=hybrid-cm6` | None exists. Stage 11.11 added contract tests, not manual checks. | When (or if) hybrid-cm6 is promoted. |
| Known bugs list | Vault-note empty-title save (#23 R1) is not enumerated anywhere a user / contributor would find. | Add a one-line entry under README "Current Limitations" until the fix lands. |
| Changelog | None. Stage commit messages are doing this work today. | Optional. A `CHANGELOG.md` mirrored against stage-history would help once stage-history hits double-digit row count. |
| Routine workflow notes (this report's own home) | The folder `docs/routine-reports/weekly-roadmap/` did not exist before this report. | Add a short README inside the folder once two or three reviews accumulate. Not urgent. |

---

## 10. Ready-to-copy Claude Code prompt

```
You are implementing Milestone M9 — "Editor surface honest and
protected" — over next week. Repo HEAD: 7bcdf59. Tests at HEAD:
801 / 801 green. Project rules in CLAUDE.md must be honoured: TDD
first, small reviewable changes, no broad rewrites, no unrelated
refactors, preserve adapter boundaries, do not modify configuration
or package files unless strictly required by the task, prefer files
under ~300 lines.

Plan first. Do not start implementation until you have produced a
written plan covering all three priorities (P1 docs, P2 Markdown
shortcuts in CM6, P3 cm6-bundle freshness check), the order, and an
explicit risk analysis per priority. Wait for a human "go" before
moving to RED.

Implementation order:

P1 — Documentation catch-up (lowest risk; ship first)
- Update README.md with a Keyboard shortcuts subsection covering
  Cmd/Ctrl+= / - / 0 (font size; persisted per app), Cmd/Ctrl+N / S
  (file ops), and a one-line note that ArrowUp / ArrowDown in the
  note list is exempted inside title input, search, editor, and
  Toast UI Preview pane.
- Update docs/test-manual.md with the rows listed in section §9 of
  the 2026-05-08 weekly roadmap. Add a "Note navigation" subsection.
- Append rows to docs/stage-history.md for Stages 11.11, 12.1, 12.2,
  13, 13.1.
- Stop after P1. Run `cd apps/desktop && npm test`. Inspect
  `git diff`. Commit with message:
    docs: cover Stages 11.11–13.1 and #23-C in README and test-manual

P2 — Markdown formatting shortcuts in CM6 (Cmd/Ctrl+B, Cmd/Ctrl+I)
- RED. Create apps/desktop/test/markdown-shortcuts.test.js
  (node --test). Cover toggleSurround for `**` and `*`:
    * wrap non-empty selection
    * strip already-wrapped selection
    * empty selection inserts paired markers, cursor between
    * multi-line selection wraps the full range
    * idempotence under double toggle on empty selection
    * the keymap is suppressed mid-IME composition
    * the keymap survives view.setState (note switch)
    * the toggle is exactly one transaction (one undo step) and
      fires onChange exactly once (dirty-state contract)
  Confirm tests fail at HEAD for the documented reason.
- GREEN. Create apps/desktop/lib/markdown-shortcuts.js (< 150 LOC)
  exporting toggleBold(view) and toggleItalic(view) sharing a
  toggleSurround(view, marker) helper. Pure transaction-spec
  builders where possible.
- Wire into apps/desktop/lib/cm6-entry.js: append
    keymap.of([
      { key: 'Mod-b', run: toggleBold, preventDefault: true },
      { key: 'Mod-i', run: toggleItalic, preventDefault: true },
    ])
  to the existing `chrome` array. Do NOT touch lib/cm6-write-view.js
  (adapter stays a pass-through).
- Rebuild bundle: `cd apps/desktop && npm run build:cm6`. Commit
  the regenerated lib/cm6-bundle.js in the same PR.
- REFACTOR only if tests still pass and the diff stays small.
- Run `cd apps/desktop && npm test`. Inspect `git diff`. Commit:
    feat: add Cmd/Ctrl+B and Cmd/Ctrl+I markdown shortcuts in CM6 (#11)

P3 — cm6-bundle.js freshness check
- RED. Write tools/check-bundle-fresh.js (~50 LOC) that runs
  `npm run build:cm6` to /tmp, hashes the output, and asserts
  byte / sha256 equality with the committed lib/cm6-bundle.js.
  Stage a stale bundle locally; confirm the script exits non-zero.
- GREEN. Extend apps/desktop/package.json `test` script to invoke
  the checker after the existing test glob. With a freshly-rebuilt
  bundle the script passes.
- Document the new gate in docs/test-manual.md under "Editor mode"
  with a one-line "Run npm test from a clean tree".
- Run `cd apps/desktop && npm test`. Commit:
    test: enforce cm6-bundle.js freshness in npm test

Stop conditions:
- Any test fails at GREEN for an unexpected reason → stop, report
  the failure mode, and wait for human review.
- Any required edit falls outside the files listed above → stop and
  ask before proceeding.
- The bundle rebuild produces a non-deterministic diff (e.g. esbuild
  version drift) → stop, do not bump esbuild in this PR; report the
  drift.
- index.html grows by more than ~5 lines net during P2 → stop; the
  keymap should not require renderer changes.
- renderer-boot.test.js grows by more than ~80 lines for P2 → stop
  and reconsider; P2 tests belong in markdown-shortcuts.test.js.

Manual verification checklist (run before declaring M9 done):
- [ ] Cmd/Ctrl+B wraps a selection in **, strips on second press.
- [ ] Cmd/Ctrl+I mirrors the above with *.
- [ ] Empty-selection Cmd/Ctrl+B leaves cursor between **|**.
- [ ] Cmd+Z reverses each toggle in one step.
- [ ] Note switch then Cmd/Ctrl+B still works (setState path).
- [ ] Chinese IME composition with Cmd+B held does NOT toggle.
- [ ] Long document (5 000 lines) toggle is instant.
- [ ] cm6-bundle.js byte-equal to a fresh rebuild from cm6-entry.js.
- [ ] Test-manual rows for Stages 12.1 / 12.2 / 13 / 13.1 / #23-C are
      each performable without reading code.
- [ ] README "Keyboard shortcuts" subsection covers font-size, file
      ops, and the new bold/italic.

Do NOT:
- Open a pull request without explicit human approval.
- Touch lib/cm6-write-view.js, lib/hybrid-write-view.js,
  lib/cm6-hybrid-view.js, main.js, preload.js, lib/file-name.js,
  lib/dirty-state.js, or lib/close-guard.js.
- Promote ?writeEngine=hybrid-cm6 to default.
- Split index.html or main.js.
- Add Cmd/Ctrl+K (link) or any other Markdown shortcut beyond bold
  and italic.
- Bump dependencies (including esbuild, CodeMirror, marked,
  Toast UI).
- Modify .github/, .codex/, or any settings file.
```

---

## 11. Ready-to-copy Codex review prompt

```
Audit the proposed M9 plan and any in-flight branches against main
at 7bcdf59. Tests at HEAD: 801 / 801 green.

Evaluate, ruthlessly:

1. Realism. Is M9 (P1 docs catch-up + P2 Cmd/Ctrl+B / I in CM6 + P3
   cm6-bundle freshness check) achievable in one week given the
   recent velocity (5 PRs / week, all renderer-local)? Flag if any
   priority secretly requires a renderer split or an adapter touch.

2. Priority correctness.
   - Should P1 (docs) really come before P2 (feature)? Argue for or
     against. CLAUDE.md says docs must follow user-visible behaviour
     change; this week broke that contract. Is there a stronger
     candidate (e.g. vault empty-title guard #23 R1) that should
     displace P1, P2, or P3?
   - Is P3 (bundle freshness) sequenced correctly relative to P2?
     If P3 lands after P2, P2's first commit ships an unprotected
     bundle.

3. Minimal-change discipline.
   - Does any priority require touching files outside the ones the
     plan names? List concretely.
   - Does the plan let index.html grow during P2? It should not —
     the keymap belongs in lib/cm6-entry.js.
   - Does the plan let renderer-boot.test.js grow during P2? It
     should not — new unit tests belong in markdown-shortcuts.test.js.

4. Architecture preservation.
   - Adapter boundary: lib/cm6-write-view.js MUST remain unchanged.
     Confirm.
   - lib/cm6-bundle.js: confirm rebuild is the *only* edit (no
     hand-written drift).
   - write-engine.js, file-name.js, dirty-state.js, close-guard.js,
     main.js, preload.js: untouched. Confirm.

5. TDD strength.
   - P2 RED set covers wrap, strip, empty-selection, multi-line,
     idempotence, IME suppression, setState survival, single-
     transaction / single onChange. Is anything missing? Specifically
     consider: nested marker (toggle bold on already-italic text),
     selection extending across the marker boundary, mixed-marker
     selections, and undo grouping under rapid double toggle.
   - P3 RED: confirm the script can detect a one-byte drift in
     lib/cm6-bundle.js. Confirm it does NOT depend on file mtime.
   - P1: docs-only, no TDD; verify section-by-section that each new
     manual-QA row is performable without reading code.

6. Hidden risks.
   - esbuild non-determinism across versions or platforms (P3 will
     surface this).
   - The `chrome` extension array order in cm6-entry.js — appending
     a new keymap may change relative precedence. Confirm
     defaultKeymap / historyKeymap / searchKeymap still resolve
     correctly under Cmd-z, Cmd-f, etc.
   - Stage 13's keydown handler at index.html and the new CM6 keymap
     for Cmd-b / Cmd-i. Cmd-b is also a default macOS text-edit
     shortcut; confirm it does not collide with anything globally
     bound on the document.
   - PR #25's per-note save latch should not be entangled. Confirm
     savePerNoteInProgress is not on any P2 / P3 path.
   - The `inTextSurface` exemption list (now: title input, search,
     hybridWritePane, Toast UI Preview mount). Confirm Cmd-b inside
     the title input does NOT enter the CM6 keymap path.
   - Chinese IME: P2's IME-suppression test must use the same
     `e.isComposing` / composition-event semantics as Stage 13's
     existing IME guard. Inconsistency would be a red flag.

7. Postpone candidates.
   - Renderer split, hybrid-cm6 promotion, Hybrid removal, auto-save,
     multi-window, Cmd-K (link), heading shortcuts: all postponed.
     Agree / disagree?
   - Should #23 R1 (vault empty-title guard) be promoted into M9 and
     displace P1?
   - Should the "no CI" gap (debt #9) be promoted into M9? P3
     without CI is a local-only safety net.

Output: BLOCKERS / NITS / OK-TO-PROCEED. For each BLOCKER, name the
exact file or commit / claim that fails review and the smallest
change that would make it pass. Do not commit; do not push; do not
open a PR.
```

---

## 12. Markdown summary

```markdown
# Weekly Roadmap Summary - 2026-05-08

## Main progress
- Stage 13 + 13.1: editor text-size shortcuts (Cmd/Ctrl+= / - / 0)
  and Preview heading spacing fix; persisted to localStorage.
- Stage 12.1 / 12.2: bottom scroll padding, hidden line-number
  gutter and active-line background in CM6.
- Fix #23-C: Preview pane is now exempt from ArrowUp / ArrowDown
  note nav.
- PR #25: per-note save latch + title sync before save predicate.
- Stage 11.11: contract tests for the experimental hybrid-cm6
  engine.
- Tests: 801 / 801 green.

## Main risk
- Documentation has fallen behind shipped behaviour for the first
  time: README and docs/test-manual.md do not cover Stage 12.x /
  13.x or #23-C. CLAUDE.md mandates docs follow user-visible change.
- Secondary: index.html is now 3 393 lines (+231 this week);
  Stage 13.1 was already a "rule fights rule" bug.

## Next milestone
M9 — "Editor surface honest and protected": ship Cmd/Ctrl+B + I in
CM6, behind a cm6-bundle.js freshness gate, with documentation that
matches the app a user actually sees.

## Top 3 priorities
1. P1 — Doc catch-up: README + docs/test-manual.md + stage-history
   rows for 12.1, 12.2, 13, 13.1, #23-C.
2. P2 — Cmd/Ctrl+B and Cmd/Ctrl+I in CM6 (lib/markdown-shortcuts.js
   + lib/cm6-entry.js keymap; bundle rebuilt and committed).
3. P3 — cm6-bundle.js freshness check wired into `npm test`.

## Tests to add
- toggleSurround unit suite (wrap / strip / empty / multi-line /
  idempotent / IME-suppressed / survives setState / single
  transaction / single onChange).
- cm6-bundle.js byte-equality check.
- Markdown round-trip after font-size change (no doc mutation).
- Vault-note empty-title save (carry-over from #23 R1; not in M9
  but next on the queue).

## Documentation to update
- README "Editor" / new "Keyboard shortcuts" subsection.
- docs/test-manual.md: rows for Stage 12.1 / 12.2 / 13 / 13.1 /
  #23-C / new bold/italic shortcuts.
- docs/stage-history.md: rows for 11.11, 12.1, 12.2, 13, 13.1, M9.
- README "Current Limitations": one-line entry for the open
  vault-note empty-title guard.

## My decision
Pending human review. Recommended path: ship P1 first this week as
the wedge, then P3 (bundle freshness) before P2's bundle rebuild
lands, then P2.

## Tags
weekly-roadmap, milestone-M9, editor-cm6, docs-debt, bundle-freshness,
markdown-shortcuts, postpone-renderer-split
```
