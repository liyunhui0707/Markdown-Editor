# Stage 3 Spike — CodeMirror 6

Throwaway prototype to measure whether CodeMirror 6 satisfies the Stage 3
acceptance criteria for a styled-source Markdown Write surface, before any
production migration is undertaken.

- Branch: `stage3-spike-codemirror6`
- Spike code: `apps/desktop/spike/codemirror6/`, `apps/desktop/lib/spike-cm6-*`
- Production app (HybridWriteView, Toast UI Preview, IPC, save/load, MCP
  ingest): **untouched.**

The B9 interpretation for this spike is **styled-source** Markdown editing
(per user decision on 2026-04-30): syntax highlighting, real selection,
real undo, real keyboard behavior — not full rich-text WYSIWYG.

## How to run

```bash
cd apps/desktop
npm install
npm run build:spike-cm6
npm run test:spike-cm6     # 22 automated tests (round-trip + CRLF coverage)
npm test                   # full suite: 212 tests (190 existing + 22 spike)
npm run spike:cm6          # opens isolated Electron window for manual scenarios
```

## Acceptance mapping

Each Stage 3 must-have criterion is mapped to one of the six manual
measurement scenarios below. A scenario PASSES only if every linked
criterion passes.

| Scenario | Stage 3 criteria covered |
|---|---|
| 1. Round-trip corpus | B10.1, B10.2, B10.3, B11.1 |
| 2. Cross-block selection + delete | B5.1, B5.2, B5.3, B6.3 |
| 3. Cmd+A → Backspace → Cmd+Z | B7.1, B7.2, B8.1 |
| 4. Undo across blocks | B8.1, B8.2, B8.3 |
| 5. 5,000-line stress | B14.1, B14.2, B14.3 |
| 6. Chinese IME composition | B13.1, B13.2, B13.3 |

B9 visual editing is interpreted as styled-source highlighting, which CM6
provides via `@codemirror/lang-markdown` + `defaultHighlightStyle`. Verify
visually in scenario 1 (the initial doc covers all relevant constructs).

## Line-ending strategy (CRLF blocker)

**Finding:** CodeMirror 6 normalizes input line endings to LF in its text
storage, regardless of the `EditorState.lineSeparator` facet. The facet
controls how input is split into lines and how the editor reports line
breaks for cursor movement; it does NOT change the in-memory bytes. The
empirical result, pinned by automated tests in
`apps/desktop/test/spike-cm6/round-trip.test.js`:

| input                | `state.doc.toString()` |
|----------------------|------------------------|
| `a\r\nb\r\n`         | `a\nb\n`               |
| `one\r\ntwo\nthree\r\n` | `one\ntwo\nthree\n` |
| `a\rb\rc`            | `a\nb\nc`              |
| `a\r\nb\r\n` + `lineSeparator.of('\r\n')` | `a\nb\n` |

This means **CM6 cannot byte-preserve CRLF input through the editor.**

**Strategy for production (when we move past spike):** the existing vault
file IO layer is already LF-only — `apps/desktop/lib/hybrid-write-view.js`
documents this explicitly: *"LF-only line-ending policy: HybridWriteView
assumes LF-normalized input. The file IO layer is responsible for any
CRLF→LF normalization on load."* The production app already enforces LF
on disk in `main.js` save/load handlers, so CM6's normalization aligns
with that contract.

**Risk classification:** **NOT a Stage 3 blocker** for this app, because:
1. The vault file IO layer normalizes to LF on read (existing behavior).
2. Save writes LF (existing behavior).
3. CM6 normalizes any CRLF that slips through.
4. Therefore an unmodified vault note remains LF on disk after editing,
   matching what was there before.

**Risk classification: BLOCKER** if a future user requirement demands
preserving CRLF files byte-for-byte (e.g., Windows-edited notes shared
through the vault). To address that case later, the strategy would be:
capture the dominant line-ending style at file-read time, store it
alongside the note (out-of-band metadata, not in the doc), and re-emit
on save. That work belongs in the file IO layer, not the editor.

**Decision needed before Stage 3 ship:** confirm that LF-only on disk
remains acceptable. If yes, CM6 is fine. If no, CM6 still works but the
file IO layer must be extended.

## Automated results (real, from running the suite on this machine)

These are reproducible by re-running the commands below.

| Check | Command | Result |
|---|---|---|
| Round-trip corpus (17 items + 5k synthetic) | `npm run test:spike-cm6` | **22/22 pass** |
| CRLF behavior pinned (4 tests) | included in above | **PASS — normalization confirmed** |
| Full suite (existing + spike) | `npm test` | **212/212 pass** (190 existing + 22 spike) |
| Build | `npm run build:spike-cm6` | **OK, 25 ms** |
| Bundle size — raw | `ls -la lib/spike-cm6-bundle.js` | **1,059,897 bytes (≈ 1.01 MB)** |
| Bundle size — gzipped | `gzip -c lib/spike-cm6-bundle.js \| wc -c` | **268,809 bytes (≈ 262 KB)** |

These numbers are from the spike branch on 2026-05-01. Any later run will
overwrite them in the table — re-record before sign-off.

## Manual measurement procedure (you run, you record)

Run all six scenarios. Record results in the **Manual result record** table
at the bottom. Anything other than PASS is a blocker.

### Scenario 1 — Round-trip corpus (B10)

**Goal:** prove that opening + saving an unmodified note leaves bytes intact.

1. In the spike window, click **Run corpus round-trip** (right panel).
2. Observe the result panel — every item must report `[PASS]`.
3. Repeat the Node test as a second check: `npm run test:spike-cm6`.
4. Real-vault diff:
   ```bash
   # from repo root
   cat path/to/some/vault-note.md | pbcopy
   # in spike window: paste into "Custom doc" textarea, click "Load pasted text"
   # then click "Copy current doc to clipboard"
   pbpaste > /tmp/spike-output.md
   diff path/to/some/vault-note.md /tmp/spike-output.md
   ```
5. **Record in row 1 below:** PASS if all three checks are clean (corpus
   button, Node test, real-vault diff empty). Note the vault note path used.

### Scenario 2 — Cross-block selection + delete (B5, B6)

1. With the initial spike doc loaded, drag-select from inside the H2 heading
   "What to try" through three list items into the blockquote.
2. Confirm the selection is a single continuous highlight.
3. Press <kbd>Backspace</kbd>. Confirm the entire range is removed in one
   operation.
4. Press <kbd>Cmd+Z</kbd>. Confirm the deleted range is fully restored.
5. Place caret at the start of the blockquote. Press <kbd>Backspace</kbd>.
   Confirm the blockquote line merges into the previous line cleanly.
6. **Record in row 2 below:** PASS if all five steps behave; FAIL with
   description otherwise.

### Scenario 3 — Cmd+A → Backspace → Cmd+Z (B7, B8)

1. Press <kbd>Cmd+A</kbd>. Whole document highlights.
2. Press <kbd>Backspace</kbd>. Header should read `doc: 0 chars · 0 lines`.
3. Press <kbd>Cmd+Z</kbd>. Document fully restored.
4. Press <kbd>Cmd+Shift+Z</kbd>. Document empty again.
5. **Record in row 3 below:** PASS if all four steps work; undo/redo
   symmetric; FAIL otherwise.

### Scenario 4 — Undo across multiple blocks (B8.3)

1. Edit the H1 heading (insert "(edit 1)" at the end).
2. Click into the code block, edit a line (insert "(edit 2)").
3. Click into the blockquote, edit a line (insert "(edit 3)").
4. Press <kbd>Cmd+Z</kbd> three times — peels off in reverse order.
5. Press <kbd>Cmd+Shift+Z</kbd> three times — reapplies in order.
6. **Record in row 4 below:** PASS if undo stack is one continuous
   timeline across blocks; FAIL if focus changes split history.

### Scenario 5 — 5,000-line stress (B14)

1. Click **Load 5,000-line stress note**. Record the load time displayed
   (e.g. `5,000-line load: 145.3 ms`).
2. Scroll top-to-bottom. Note any visible jank.
3. Click **Measure keystroke latency (1,000 inserts)**. Record `p50`, `p95`,
   `p99`, `max` from the panel.
4. Optionally click **Load 20,000-line stress note** and re-measure.
5. **Record in row 5 below:** raw numbers — `load_ms / p50 / p95 / p99`.
   Pass thresholds: load < 2000 ms, keystroke p95 < 5 ms (engine-level).

### Scenario 6 — Chinese / IME composition (B13)

1. Place caret in the line `Type Chinese here:` in the initial doc.
2. Switch macOS input to Pinyin (or another IME). Type a multi-syllable
   composition (e.g., `nihaoshijie` → 你好世界). Confirm:
   - Composition popup appears.
   - First character is not dropped.
   - Pressing space/enter commits the composed text in place.
3. Repeat at the very start of an empty doc (paste empty string into
   Custom doc, click Load, then type 中文).
4. Repeat mid-composition: start composing, then click into another line
   without committing. Confirm either clean commit or graceful preservation.
5. **Record in row 6 below:** PASS if all three IME scenarios work without
   dropped characters or document corruption; FAIL otherwise with detail.

## Manual result record (FILL IN AFTER RUNNING)

The reviewer fills in this table by hand. Do not let an AI assistant
fabricate values here — every cell except the leftmost must be entered by
the human running the spike.

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | Round-trip corpus + real-vault diff | PASS | Corpus button: PASS — 17/17. Node test: PASS — 22/22. Real-vault diff: PASS — used `./node_modules/isbinaryfile/README.md`; diff output empty. |
| 2 | Cross-block select + delete | PASS | Continuous selection from H2 through list items into blockquote worked. Backspace removed the full selected range. Cmd+Z fully restored it. Backspace at start of blockquote merged cleanly with previous line. |
| 3 | Cmd+A flow | PASS | Cmd+A selected the whole document. Backspace cleared the document and header showed `doc: 0 chars · 0 lines`. Cmd+Z restored the full document. Cmd+Shift+Z cleared it again. |
| 4 | Undo across blocks | PASS | Edited H1 with `(edit 1)`, code block with `(edit 2)`, and blockquote with `(edit 3)`. Cmd+Z three times removed the edits in reverse order across blocks. Cmd+Shift+Z three times reapplied them in order. Undo history remained one continuous timeline across focus changes. |
| 5 | 5,000-line stress | PASS | 5k load: `28.3 ms`; doc length: `359,872 chars`; latency for 1,000 inserts at end-of-doc: p50 `0.900 ms`, p95 `2.300 ms`, p99 `3.000 ms`, max `5.800 ms`; scroll top-to-bottom: smooth/no visible jank. 20k load optional check: `28.7 ms`, doc length `1,452,653 chars`. Pass thresholds met: load < 2000 ms and p95 < 5 ms. |
| 6 | Chinese / IME composition | PASS | Pinyin IME worked inside `Type Chinese here:` line: composition popup appeared, `nihaoshijie` committed as `你好世界`, no dropped first character. Empty-doc test passed: `zhongwen` committed as `中文` at document start. Mid-composition click-away behaved gracefully with no dropped characters or document corruption. |

**Overall recommendation:** Ship CodeMirror 6 as the Stage 3 editor foundation for styled-source Markdown editing. Do not run a Milkdown spike at this time. Proceed to a separate production integration phase behind a feature flag; do not promote the throwaway spike code directly.

**Decision date:** 2026-05-01

**Reviewer:** liyunhui

## Remaining blockers / open questions before Stage 3 production integration

1. **Manual scenarios verified.** Scenarios 1–6 were manually run and recorded as PASS. This removes the spike-level blocker for CodeMirror 6 as the Stage 3 editor foundation.

2. **Line-ending policy ratified.** LF-only on disk is acceptable for Stage 3. CRLF byte-perfect preservation is out of scope for Stage 3. If future requirements demand CRLF preservation, that work belongs in the file IO layer, not the editor.

3. **Bundle weight accepted for Stage 3 exploration.** The spike bundle size is acceptable for moving into production integration, but the final production bundle should be re-measured after integration and minification.

4. **Preview parity remains a production integration requirement.** The spike does not render Preview. The Stage 3 implementation must keep Preview synchronized with the new CodeMirror Write surface.

5. **Toast UI Preview decision deferred.** For the first production integration, keep the current Preview behavior unchanged. A later cleanup can decide whether to keep Toast UI Preview or replace it with a simpler safeMarked-only renderer.

6. **Spike code is not promoted directly.** The spike validates the direction only. Production integration must be a separate implementation task with tests, feature flagging, and Codex review.

## What this spike deliberately does NOT cover

- True WYSIWYG (live rendered tables, images-as-images, headings sized
  visually while editing). Stage 3 has accepted styled-source for B9.
- Save/load wiring. The spike never writes to disk. Round-trip fidelity is
  proven via in-memory adapter calls + Node test.
- Preview pane parity. The spike does not render Preview; the production
  Preview (Toast UI) is untouched.
- IPC. The spike Electron window has no preload, no IPC bridge, no vault
  access.
- MCP ingest. Unchanged file-level path; outside the editor surface.
- Migration of existing Stage 2 tests. Decided in Phase 3 implementation,
  not the spike.

## Throwaway hygiene

- This branch (`stage3-spike-codemirror6`) is throwaway. If results are
  negative, the branch is deleted; nothing on `main` changes.
- If results are positive, the spike code is **not promoted directly**. A
  separate Phase 3 implementation PR replaces HybridWriteView with a
  production CM6 integration informed by the spike's measurements.

## Codex revisions tracked

This document and the spike code were revised on 2026-05-01 in response to
a Codex review with verdict "revise (not reject)". Changes:

1. `package.json` test script: `node --test test/**/*.test.js` →
   `node --test test/*.test.js test/spike-cm6/*.test.js`. Confirmed picks
   up both root (190) and nested (22) tests under npm's POSIX sh.
2. CRLF round-trip coverage added to
   `test/spike-cm6/round-trip.test.js` (4 new tests). Behavior pinned;
   line-ending strategy section added above.
3. `@lezer/markdown` removed from dependencies — pulled transitively by
   `@codemirror/lang-markdown` and not directly imported.
4. Manual result table reformatted with explicit "TODO" markers; reviewer
   instructions emphasize that AI must not fabricate values.
