# A6 — untouched-note dirty state investigation

Date: 2026-09-09. **Fix implemented locally; scripted checks pass; independent
review/native acceptance pending.** The subsequent [security remediation](dependency-security-sep9.md)
clears both audit gates; the failed-audit evidence below records the A6 run,
not the latest candidate. Shipping still requires review/native acceptance.

## Approved implementation follow-up

The user approved the bounded TDD fix after the investigation below. Changes:

- Tiptap retains the loaded raw text while its rich document and frontmatter
  match that load. Rich edit/undo restores this baseline. The latest Source
  text has a separate snapshot so a deliberate formatting-only Source change
  is not mistaken for an untouched document. Both snapshots reset on note
  load; actual rich changes still use the existing remark serializer.
- Main checks the current on-disk frontmatter before any save/rename, after
  the existing path validation. The approved conservative option is used:
  **reject unsupported metadata, rather than silently discard it**. Unsaved
  edits remain in memory, the original file is unchanged and Save All reports
  failure rather than allowing a successful quit. This applies to all engines.
- Supported metadata remains a deliberately small subset: unique single-line
  `source` and bracket-list `tags` containing simple string values. Unknown
  fields, comments, nested/multiline YAML, duplicate keys, BOM/CRLF headers,
  malformed headers and complex scalar syntax are save-blocked. This is not a
  YAML-preserving editor. Existing simple quoted `source: "codex"` AI Imports
  and ordinary tag/source updates remain tested and editable.
- There is no automatic conversion or removal of metadata. Keep blocked edits
  and transfer them using a YAML-capable editor; do not discard or delete the
  metadata to silence the warning. Source-only formatting undo after leaving
  the textarea is not promoted to a new rich-history guarantee.

### TDD and verification

Initial RED: 14 expected failures in the new regression cases. Final focused
run: 46/46 passed (load-history, frontmatter-save-safety, editor-session-boundary).
Four factory tests and fifteen main-process tests were added; existing factory
expectations were updated only where they required eager normalization of
unchanged text. Currency/math node assertions remain in place. Final self-review
added a separate RED → GREEN case for quoted metadata ending in a colon, which
must be rejected because the existing serializer emits it unquoted.

| Check | Current result |
| --- | --- |
| `mise exec -- npm run test:ci` | 2,360 tests; 2,358 pass; 2 existing opt-in skips; zero failures |
| `mise exec -- npm run check:tiptap-readiness` | 44 tests pass; corpus READY, zero corpus blockers (not overall release readiness) |
| `mise exec -- npm run build:tiptap`, repeated | Identical SHA-256 `4e966ddda91ec4fc42a3de8b29bd8f29b78218ad4ff466f87c5248994e8a2d8f` |
| Cached Electron 43.4.1 unsigned `npm run pack` | Passed; packaged main/preload/renderer, Tiptap entry/bundle and new guard bytes match working sources |
| Isolated real Electron main/renderer integration | 16 scripted assertions pass: no-op switch/Save All, edit/undo/redo, one-note save preserving another edit, no cross-note mixing, Source spelling, and blocked Save Note/Save All retaining edits and metadata |
| `npm run audit:prod` / `npm run audit:full` | **FAIL: 31 / 32 high-severity dependency findings**; counts include dependents, not distinct advisories |
| `git diff --check` | Passed |

The fresh audit reports identify `@tiptap/core` (GHSA-j95f-988m-3j2f) and,
in the full audit, `js-yaml` (GHSA-2883-xcg3-v3hh). Runtime reachability has not
been investigated. Earlier clean-audit evidence is superseded; no dependency
upgrade or `npm audit fix` was performed. Investigate/remediate this separate
security gate before shipping, with scoped approval and regression testing.

Diagnostic artifacts: `/private/tmp/editor-a6-fixed.E1oxiS/qa.cjs`, `qa.log`
and `qa-packaged.log` (final repeat, 16/16 assertions passed);
test/build/audit logs: `/private/tmp/editor-a6-{red,green,ci,corpus,pack,audit-prod,audit-full}.log`.
The harness used a new profile, synthetic notes only and blocked HTTP(S).
It first loaded working sources under Electron, then repeated against the final
packaged `app.asar` through the isolated harness. Packaged runtime source bytes
were also compared directly. It did not exercise physical keys, IME, the native
close dialog or normal installed-app launch. No private data was inspected. No claim of completed native
acceptance or an independent review is made.

### Files and remaining acceptance

Code: `apps/desktop/lib/tiptap-entry.js`, generated `lib/tiptap-bundle.js`,
`main.js`, new `lib/frontmatter-save-safety.js`.
Tests: `test/tiptap-load-history.test.mjs`, new `test/frontmatter-save-safety.test.js`,
and `tools/check-test-baseline.mjs` (all relative to `apps/desktop`).
Docs: README, this report, roadmap, test-manual and stage-history.

The existing 352-line Tiptap entry and 867-line main are retained: the changes
are small boundary additions, and splitting these files would broaden the task.
The new guard is 37 lines; the two affected test files are below 300 lines each.
No new dependencies or manifest/lockfile/version changes. A version decision
belongs to the later shipping scope (standalone bug-fix release: patch); the
accumulated candidate is still unreleased `0.18.0`.

Review the A6 delta independently, then complete the existing A1–A5 native
checks on disposable notes. In particular, repeat physical Undo/Redo/IME after
the text-read change; confirm untouched tables stay clean and a custom-YAML
edit followed by Save All & Quit reports an error, keeps the app open and
retains the edit. Results remain pending, not inferred from scripted testing.
Whole-patch review A7 and security gate A8 are not completed by this fix.
No commit, push, tag, branch operation or sibling-project change was performed.

## Original investigation (before the fix)

The remaining sections record the pre-fix reproduction and its approved scope;
they are historical evidence, not a description of the corrected implementation.

## Finding

With opt-in Tiptap, merely opening and leaving a non-normalized table marks
the note dirty. Navigation itself does not write the file. However, Save All
includes that untouched note and can discard its custom YAML frontmatter.
This fails A6's condition for deferring a formatting-only indicator.

Two mechanisms combine:

1. Tiptap serializes the loaded table with remark-normalized spacing.
   `index.html`'s `selectNote()` assigns that text to the outgoing note even
   without an edit. `lib/dirty-state.js` compares it to the original loaded
   body using exact string equality, so it reports dirty. Save All also
   flushes the active editor before selecting dirty notes: an untouched
   active table can be added to the save batch at that point.
2. `main.js`'s `parseFrontmatter()` retains only `tags` and `source` in the
   current patch. `serializeFrontmatter()` and the `save-note` handler
   reconstruct the file from those fields, title and body. Unknown fields
   have no preservation path. The synthetic `custom` and `aliases` fields
   disappear when the false-positive dirty note is saved.

Unknown-field parsing was already absent at HEAD; this investigation does
not attribute its origin to the editor split. The current combined behavior
is nevertheless unsafe. Explicit Save Note uses the same lossy serialization
path; avoiding Save All or switching engines is not a general metadata fix.

## Reproduction and evidence

Tested the current working-tree main/preload/renderer and generated Tiptap
bundle under cached Electron 43.4.1 on macOS arm64. The temporary harness
loaded the real app, selected Tiptap in a fresh profile, called renderer
functions and observed actual save IPC and disk contents. HTTP(S) requests
were blocked. No private vault, transcript, secret file or existing user
profile was read. Only synthetic fixture files were written.

Baseline: `refactor/editor-session-split`, HEAD
`8926fd6f1101ed643d669074bbe4bccd3f29b7c4`, plus the existing uncommitted patch.
Key source fingerprints (SHA-256):

```text
main.js               fdc15a3b9739c2589e32f0fb06eee1e8d0888e1e7dde1573b33232ec81914eeb
index.html            2fe8982285d6191ad37a2a20af266e5ca439b3a322a5784c0057774523c323e8
lib/tiptap-bundle.js   24ed13b943059805fe490352a26f590395c90bbdef33cb0ea9ccfa1bf17b682d
```

Four fixtures: canonical `plain.md`, non-normalized `table.md`, an untouched
`active.md` table, and `custom.md` containing this synthetic content:

```markdown
---
custom: keep-me
aliases: [Synthetic Alias]
---

# Custom

| Left | Right |
| :--- | ---: |
| a | b |

- [x] Done

Keep this note intact.
```

| Step | Observed result |
| --- | --- |
| Load canonical plain note; invoke Save All without editing | Clean; `savedCount: 0`; no save IPC or changed files |
| Open raw table without editing | Note body equals its loaded baseline; clean. Live editor text is already normalized |
| Switch to plain note | Table becomes dirty; zero save IPC; all four disk files remain byte-identical |
| Revisit table, insert `REAL-EDIT`, then invoke editor undo | Real edit appears and undo removes it; original table content returns, but formatting-only dirty flag remains |
| Open custom-frontmatter table, then switch to plain | Custom note becomes dirty without an edit |
| Edit and explicitly save only plain note | Exactly one save IPC, for `plain.md`; table and custom files remain byte-identical; their dirty states survive refresh |
| Open untouched active table, then invoke Save All | Active table was clean before the flush. Save All writes all three tables and reports `{ok:true,savedCount:3}` |
| Inspect disk and reload custom note | Table text/tasks remain, with normalized spacing. Both custom YAML fields are gone; dirty summary is zero |

The normalized body changes only this table's spacing/alignment markers:

```markdown
| Left | Right |
| :--- | ----: |
| a    |     b |
```

The custom note's saved file starts with `# Custom`; its entire original YAML
block is absent. The intentional plain-note edit survives Save All/reload.
No wrong-file writes or body loss were observed in these four fixtures; this
is not a claim of safety for every Markdown construct or metadata format.

Temporary evidence is retained at `/private/tmp/editor-a6-qa.PD9Q5q/`:
`investigate.cjs`, `investigation-repeat.log` (state/text/hash/IPC snapshots),
and `targeted-tests.log`. These are local diagnostic artifacts, not portable
repository tests; the fixtures now contain the test's saved output.
The isolated process exited successfully after checking the reproduction.
The first diagnostic run's assertion expected an unescaped underscore in an
edit marker; the repeat used `REAL-EDIT` and passed the reproduction assertions.
Those assertions confirm the bug, not product acceptance.

## Verification limits

Existing focused regression command, from `apps/desktop`:

```bash
mise exec -- node --test test/dirty-state.test.js test/save-note.test.js test/renderer-boot.test.js
```

Result: **320 tests passed; zero failures/skips**. They do not currently catch
this combined real-Tiptap → dirty classification → disk serialization failure.
No application code, dependencies, bundles or versions changed in this task.
Full CI, security audits and packaging were not rerun for this documentation-only
investigation; their earlier recorded results are not an A6 pass.

This was scripted Electron integration testing, not physical-input QA or a
native close-dialog/restart test. A2–A5 remain pending as previously recorded.

## Recommended next bounded task — approval required

Resolve A6 with a minimal TDD fix, not a renderer refactor:

- Add failing regressions for untouched non-normalized notes remaining clean
  across switch and Save All, including the active-note flush and edit/undo.
  Preserve actual edits, title edits, Source mode changes and note isolation;
  do not disable dirty checks or normalize all source text indiscriminately.
- Prevent silent loss of unknown frontmatter on save. Preserve it or reject
  an unsafe save explicitly until preservation is supported; prove the chosen
  behavior using synthetic metadata and real disk assertions. Fixing only the
  false-positive indicator does not make intentional saves metadata-safe.
- Reproduce the failing scenario before implementation, rerun focused/full
  tests afterward, rebuild affected bundles, and repeat affected acceptance
  checks. Then resume whole-patch review (A7), not new feature development.

Until resolved, use synthetic or disposable backed-up copies only. No code fix,
commit, push, merge, tag, sibling-project change or data migration was performed.
