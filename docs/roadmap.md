# Project Roadmap — Markdown Vault App

## Current direction (2026-11-07)

The product goal is a complete, attractive, simple, independent local Mac
Markdown editor: open a standard file from Finder, write in the accepted visual
workspace, save predictably, and recover work. The accepted layout remains the
visual baseline; do not return to Vault/AI/plugin platform work or rebuild the
editor framework. Group related changes into complete user workflows, with
focused tests inside each batch rather than a new approval cycle for each control.

The user approved the following **three delivery phases**, including all five
remaining product limits. They are development commitments, not claims that the
limits have already been removed.

| Phase | Complete user outcome | Exit criteria / current position |
| --- | --- | --- |
| 1. Native Mac file opening | Open `.md` via Finder Open With; after the user chooses Markdown as default, double-click opens it. Cold/warm launch, repeat opens, Unicode paths and pending input behave predictably. | 0.57.0 installed local candidate implements association, main-owned queued read intent, unchanged-session reuse and deferred opening. Existing originals stay read-only; no default handler is changed automatically. 109 focused Node checks, three source Electron workflows and actual-package cold/warm/repeated LaunchServices opens pass; no unrestricted filesystem or release claim. |
| 2. Everyday document editing and saving | Choose ordinary local save folders; edit source and supported rich content; safely save back to a file; work with realistic article/image sizes. | 0.58.0 implements ordinary Home-descendant save destinations; 0.59.0 adds explicit draft source editing with exact history, recovery and export. 0.60.0 adds coordinated, version-preserving bound-file saving; broader filesystem/sync locations remain outside these batches. 0.61.0 extends the complete path to 524,288 UTF-16 units / 2 MiB and 16 bounded local images, with exact recovery/history checks. Functional capacity is implemented; extreme-length interaction latency and full-app memory remain phase-3 gates. Reuse Document Model, Service, File Store, IPC and history. The five limits must be resolved or have a concrete technical blocker, not remain permanent disclaimers. |
| 3. Daily-use and distribution | A dependable installable app for repeated real writing, with clear failures, recovery and updates. | Native IME historical failure retests, performance/accessibility, full CI and SEC-01, signed/notarized delivery and update/rollback evidence before a daily-use/public release claim. |

### Local compatibility follow-through — 0.62.0 (2026-11-07)

Ordinary local Desktop/Documents and nested same-named folders join the checked
Home-descendant save scope. iCloud-managed locations remain blocked with an
explicit reason; ACL/xattr and identity checks are preserved. Export, reopen,
bound-file saving, conflict retention and restart recovery form one verification
group. Complete CI/security gates before integrating PR #139; the genuine-input
checklist remains PENDING. Next prioritize actual input acceptance and measured
long-document performance, followed by distribution readiness. This batch does
not promise network, third-party sync or external-volume semantics.

### Phase 3 — daily-writing stabilization, first batch (2026-11-07)

The 0.61.0 checkpoint is `af3df23747dbbe71c15cb4f374d1dbcd37ef5ab0`.
The 0.61.2 local WIP checkpoint preserves the performance batch below; genuine-input
acceptance remains pending. On 2026-11-07 the user authorized subsequent groups,
checkpoints and Git/remote operations, with acceptance gates kept explicit.
0.61.1 starts this phase with measured input bottlenecks, continuous input/history,
outline navigation, backup and restart recovery. It keeps the accepted UI and
existing safety model. 0.61.2 extends this batch with repeated-session writing,
closure and memory measurements, plus a small allocation reduction. Three repeated
sessions pass; near-limit latency and long-duration memory acceptance remain open.
Controlled Unicode input cannot close the native-IME historical failure gate.
Next complete the concise genuine-input checklist, fix any reproducible failures
as a group, then decide whether incremental validation is justified for near-limit
writing before broader distribution gates.
Do not substitute more Markdown features or new infrastructure for these gates.

### Phase 2 — explicit work and safety gates

1. **Save destinations:** support user-selected ordinary writable local folders,
   including nested folders, through the native dialog. Validate ancestor/target
   identity, symlinks, ownership, metadata and exclusive creation. Keep arbitrary
   overwrite closed. Network/sync behavior needs its own evidence; do not call a
   folder safe merely because its path is outside known provider directories.
2. **Editable source and complex Markdown — 0.59.0 installed candidate:** source editing of the full
   confirmed Markdown on an independent draft with history, recovery and exact
   untouched bytes. Switching to/from WYSIWYG must preserve unsupported syntax,
   BOM/newlines and selection where supportable. Expand common rich structures
   in coherent groups; source mode must be a usable route when rich editing cannot
   safely represent a construct, rather than leaving the entire document blocked.
   Implemented with explicit Apply/return, local source history/search and
   discard protection. Unapplied edits are memory-only; native IME acceptance
   and broader performance limits remain open.
3. **Save back to the original:** design a finite implementation around the known
   external-replacement counterexample. Main must own target identity and revision
   authorization, recheck content/metadata, coordinate the final write, report
   conflicts/partial or uncertain outcomes accurately, and preserve drafts.
   `coordination-required` stays enforced until the precise supported write
   conditions are demonstrated; removing the guard is not a solution. Do not
   introduce a second save framework. State any remaining native coordination
   blocker with evidence instead of claiming success.
   **Nov 7 result at 0.59.0: BLOCKED under the current guarantee.** Native file
   coordination does not constrain arbitrary POSIX writers; the file-lease route
   requires a private Apple entitlement and returned EPERM locally. A bounded
   atomic-exchange probe retained the displaced version, but changed the target
   before detecting conflict, so it does not meet the old guarantee. A concrete
   coordinated/version-preserving save proposal and its required contract decision
   are recorded in the [save phase record](document-save-hardening-phase1b.md#original-save-native-feasibility--0590-blocked-2026-11-07).
   That investigation did not enable production writes. **The user subsequently
   approved the changed contract**: native coordination, retained versions and
   explicit conflict/uncertainty, including the narrow pathname-change race.
   **0.60.0 local candidate** implements that bounded workflow through the existing
   services: bound target/revision, backup-before-save, native exchange and retained
   baseline/draft/displaced versions, exact readback, stable success receipt,
   conflict stop and restart-visible recovery records. Legacy `save()` still returns
   `coordination-required`; renderer paths and restored drafts gain no write authority.
   This is bounded local evidence, not universal overwrite safety or release sign-off.
   The following capacity group reuses this implementation; no new editor
   framework or closed rename experiments are needed.
4. **Practical capacity:** measure parsing/editing/history/backup/export memory and
   latency on representative larger text and images, then raise consistent limits
   across the complete path. Support more/larger images with bounded decoding and
   portable attachments. No infinite document/image guarantee and no isolated
   constant increase that bypasses IPC, recovery or export budgets.
   **0.61.0 implemented locally:** 524,288 UTF-16 units / 2 MiB; 16 PNG/JPEGs,
   4 MiB each, 16 MiB / 32 million decoded pixels aggregate. IPC, native helper,
   source editing, backup/recovery and export share the limits. History has an
   8 MiB text budget as well as its 64-entry cap. A 491k-unit / 701-heading /
   16-image workflow passes exact export, save and restart recovery. Measured
   opening 0.40 s, saving 0.26 s; controlled edit/confirmation 2.13 s including
   automation. Node-only 490k projection ~81 ms, validation ~91 ms, backup ~11 ms;
   cumulative measurement-process RSS ~260 MiB is not whole-app/peak memory.
   This completes bounded functional capacity, not smooth extreme-length writing.

The 0.61.0 local WIP checkpoint groups phases 1–2 above on `feat/document-close`;
installed code and matching evidence are preserved. No remote operation is included.

**Next complete group:** phase-3 daily-writing stabilization: native Chinese IME
and historical failure retests, representative sustained editing/large-document
latency and full-app memory, then accessibility and full CI/security readiness.
Keep the accepted visuals and existing file protections. No new feature family,
public release, push or merge starts automatically from this capacity delivery.

The current source/installed baseline before phase 1 is the **0.56.1 local WIP
checkpoint `c402e65`** on `feat/document-close`. The combined Pro regression passed,
and the user reported simple input/history, image export/reopen and long-article
navigation/source experience as basically passing. This is LIMITED BASIC PASS,
not comprehensive native IME acceptance. Historical failures, full CI and SEC-01
remain explicit. PR #138 previously integrated the earlier mainline baseline;
this development authorization does not authorize another push, merge or release.

### Historical delivery goals and cumulative evidence (through 0.56.1)

The goal is a local-first Mac Markdown app: write continuously in one WYSIWYG
surface, retain standard `.md` files and recover work reliably. Preserve the
accepted visual baseline. Do not return to a Vault/AI/plugin platform or rewrite
the editor framework. The direction remains correct; delivery has been too
fragmented into individual marks, with natural Markdown typing lagging behind.
Group related implementation slices into user-complete writing workflows; test
small changes internally without asking for a separate user approval per button.

| Major stage | User outcome / exit criteria | Position |
| --- | --- | --- |
| Document workspace and protection | Installed app, accepted visual workspace, open/copy/switch/find/close, draft recovery and new-file export | Baseline available; remaining limitations stay explicit |
| Everyday Markdown authoring | Write an ordinary article from blank: headings, paragraphs, emphasis, links, lists, quotes and basic code blocks; consistent selection, paste, keyboard input and Undo/Redo | Implemented and locally installed; mixed-document/export/recovery checks pass within supported syntax; native IME and broader acceptance remain open |
| Everyday file workflow | Clear saved/draft states, convenient reopen/close/recovery and supported save destinations; controlled existing-file saving only after coordination/conflict requirements are proven | 0.51.0 locally checkpointed and installed: recent documents, resume writing, draft naming and export-name continuity; bounded checks pass, human acceptance remains open; overwrite protection remains |
| Broader documents | Tasks/nesting, tables, images, long documents and the necessary source/preview escape hatches | 0.56.1 installed local WIP checkpoint includes local PNG/JPEG import/export/recovery, filtered outline, read-only source and bounded input-pressure recovery; prior tasks/tables/reference baseline retained; combined regression passes and the user reports all three basic experience areas pass; comprehensive acceptance remains open |
| Daily-use release | Native IME acceptance, accessibility/performance, dependency/security gates, installation/update/rollback and limited real-use trial | Before public daily-use claim; no date/1.0 promise |

The everyday-authoring implementation and bounded installed closeout are complete;
this is not general Markdown or release sign-off. The **everyday file workflow**
stage combines the 0.50.0 recent-documents / resume-writing slice in the 0.51.0 local WIP.
148 targeted Node checks and the same three-start workflow on Pro and Air pass;
package checks pass. A recent entry grants
no write authority; unavailable or changed files require native selection.
The 0.51.0 checkpoint implements draft naming and export-name
continuity through the existing session, draft and Save As New File services.
130 targeted Node checks, a two-start Pro naming/export/recovery workflow and
package verification pass. Air stopped before GUI launch because the screen was
locked; no Air PASS is claimed for 0.51.0. Five recent regressions pass on the
combined version. The authorized closeout installed 0.51.0 with a recoverable
0.49.0 bundle; bounded package/startup/panel checks passed and existing private
records were unchanged. This local WIP preserves the cohesive file-workflow batch.
The installed 0.51.0 writing/name/export/readonly-reopen/recovery workflow now
passes a bounded synthetic Pro check with controlled dialog selections. It is
separate from native IME/human acceptance. The next approved **structured writing**
batch now implements task toggles, six-level tight lists, keyboard nesting/lifting,
continuation, same-parent range edits and exact source export/recovery. 396 targeted
Node cases and three Pro Electron workflows pass. It remains an uncommitted source
candidate, now versioned and installed as 0.52.0. Nine packaging/entry checks pass;
the actual package passes task editing/history/export/restart recovery. Installed
startup and existing-record preservation pass; 0.51.0 is retained for rollback.
This is not a Git checkpoint, native IME/human sign-off or a release.

The user authorized continuing to basic tables from the preserved, uncommitted
0.52.0 baseline; this does not turn the pending list/manual checks into PASS.
**Basic GFM table authoring** is now implemented as one workflow in the 0.53.0
candidate: creation, plain cell editing/navigation, row/column operations,
Undo/Redo, export/reopen and draft recovery. It reuses verified source patches;
rectangular outer-pipe tables are limited to 8 columns / 32 rows, with formatted
or escaped cells and spreadsheet paste protected. 421 targeted Node cases, two
Pro source workflows and the actual-package table/export/recovery check pass.
A mixed-document Pro workflow now also passes heading/inline/quote/code/list/table
continuity, sidebar switching, export snapshot isolation and restart recovery.
That 0.53.0 closeout changed only tests/records. The user then authorized the next
development step; this is not human acceptance or permission to commit the prior
candidate. The 0.54.0 candidate now adds **standalone image-reference
authoring**: insert/edit/remove, Enter back to prose, history, export/reopen and
recovery. 316 targeted Node checks and two Pro source workflows pass. Cards are
inert and explicitly say no preview: no image bytes are read, fetched or copied,
and relative references are not relocated on export. This is only part of image
support, not its completion. The subsequent delivery closeout installed 0.54.0:
60 packaged runtime files match, the actual package passes combined structured
writing/history/export/restart recovery, and installed startup/panel checks pass.
Existing private records are unchanged; 0.53.0 is retained for rollback. No runtime
changes or extra version bump were needed. Native IME/human acceptance remain open.
The subsequent authorized 0.54.0 local WIP checkpoint preserves this 47-file
structured-authoring batch without changing runtime code, tests or the version.
Focused human experience and native IME remain pending; preservation is not product
acceptance. Next, prioritize one bounded, explicitly selected local-image preview /
attachment portability workflow before claiming image support. Long-document
and source escape hatches remain later work; do not keep adding unrelated syntax
before delivery and acceptance.
Do not add another save framework or unlock overwrite. Preserve the visual baseline
and keep unsaved draft, exported snapshot and subsequent edits distinct. Native
IME, file integrity, SEC-01 and release checks remain continuous gates. No merge,
publication or overwrite authorization is implied.

## Historical assessment — project recovery audit (2026-10-22)

The user has clarified a file-first macOS document editor with one continuous
WYSIWYG surface. The [recovery audit](audits/2026-10-22-project-recovery-audit.md)
records verified implementation gaps, reproduced storage defects, current failing
security audits, and a proposed phased direction. Saving that report does not
approve implementation or close acceptance gates. At that date the application remained
Vault-based and Tiptap was opt-in; the current direction above supersedes this status.

## Historical milestone — independent editor pilot baseline (scope frozen 2026-09-09)

**Outcome:** a reviewed, reproducible editor build for a controlled daily-use
pilot on backed-up copies of notes. The user can open, edit, save, switch and
reopen Markdown without losing content or mixing notes. This is not a public
release, a 1.0 promise or permission to promote Tiptap to the default.

This section preserves the September pilot scope and acceptance record. It does
not define the October document-first requirements; dated passes below are not
current release approval. Older stages and reports remain historical evidence.
Baseline: `refactor/editor-session-split`, HEAD
`8926fd6f1101ed643d669074bbe4bccd3f29b7c4`, plus the existing uncommitted patch.
Current manifest version: unreleased `0.18.0`; no version/tag change here.

### Included / frozen

- [Independent editor split](editor-session-split.md): keep Markdown editing,
  AI Imports and Local AI Summarize/Rewrite; session management belongs to the
  separately developed `ai-session-manager`. Do not migrate or delete transcripts.
- Existing [dependency security work](dependency-security-followup.md),
  [note-load undo fix](tiptap-load-undo-fix.md), and approved
  [currency/math delimiter fix](tiptap-math-delimiter-fix.md), with their tests,
  generated bundles and documentation. No new capabilities in this milestone.
- Preserve the Electron/main/preload boundaries and Markdown source of truth.
  Tiptap remains opt-in and remark-normalized; current default/fallbacks remain.

### Finite acceptance record

Results below distinguish user reports, scripted checks and checks not yet run.
Prior evidence remains valid unless subsequent changes affect the tested path.
Record the build, tester/date, result and reproduction for any new result here.

| ID | Required outcome / check | Current evidence and owner |
| --- | --- | --- |
| A1 | Physical Undo/Redo after loading retains the original note; Chinese IME has no dropped/duplicated text | **PASS for the guided Sep12 candidate sequence:** Tiptap + Simplified Pinyin; Space committed `中文`, Return committed Latin `ceshi`. User reports both Undo/Redo and unsaved note-switch sequences passed; AI verified exact saved text and fresh-process reopen with zero drafts for both paths. Historical failure remains recorded but was not reproduced in this controlled retest; no IME fix or universal guarantee claimed. [Evidence](pilot-acceptance-sep12.md) |
| A2 | Put `ONLY-A` / `ONLY-B` in two synthetic notes; switch repeatedly; each keeps only its own edits | **Native PASS (2026-09-10):** exact A-edit → B-Undo/Redo → B-edit/Undo → A sequence preserved note isolation; scripted persistence also passed |
| A3 | In Source enter `Price $5; formula $x$.`; switch Rich/Preview, save, switch away/back and reopen; price stays literal and formula/content survive | **PASS (2026-09-12, combined AI/human):** AI observed Source/Rich/Preview/Save and exact disk bytes. After fresh-process reopen, user reported Currency Preview → Other → Currency Preview unchanged with no Draft; AI observed intact Preview and zero drafts. See [follow-up](pilot-acceptance-sep12.md) |
| A4 | Edit two synthetic notes; close → Cancel retains both; close → Save All then restart/reopen retains each correct note | **Native PASS (2026-09-10):** two dirty notes, Cancel, Save All & Quit, fresh-process reopen with both markers and zero drafts |
| A5 | Synthetic note with 100+ paragraphs and table/tasks: edit/undo near end without losing caret/content; paste one test image, save/reopen and verify its vault-relative image | **Partial native PASS:** 187-line table/task note, near-end edit/undo and task save/revisit. Exact 100+ paragraph and image-paste/save/reopen evidence remains pending |
| A6 | Classify the observed formatting-only dirty state: compare original text, in-memory normalization and disk before/after switch and explicit save | **Fixed locally; scripted PASS.** Native quoted-whitespace save/rename refusal passed all four fixtures with unchanged disk hashes and retained edits. Sep 12 untouched raw-table navigation and clean quit/relaunch passed with zero drafts and unchanged disk hash; post-restart table selection and failed Save All native evidence remain pending after tool errors. [Implementation and evidence](a6-dirty-state-investigation.md#approved-implementation-follow-up) |
| A7 | Review the complete accumulated diff, including generated output, split removals and changed/untracked files; identify user-owned changes separately; resolve blocking findings | **Whole-patch review performed; closure pending.** Packaging-policy follow-up accepted in focused review 2026-09-12; no blocking packaging defect found. This is not overall pilot/shipping approval; remaining acceptance gates still apply |
| A8 | Full tests, corpus gate, both audits and repeat-build equality pass for the candidate; packaged sources match and launch succeeds | **2026-09-12:** both authorized npm audits returned **0 vulnerabilities**; full CI rerun: 2,375 tests / 2,373 pass / 2 existing skips; packaging tests 4/4. September 11 corpus 44/44, unchanged E2E, offline install, repeat-build equality, package membership and isolated packaged-runtime smoke remain applicable: source/package hashes rechecked unchanged. Ordinary installed launch and final clean-checkout CI remain pending |

Use the [existing native checklist](tiptap-load-undo-fix.md#manual-qa-checklist)
and [math QA evidence](tiptap-math-delimiter-fix.md#test-results), not a new test
programme. Repeat only unresolved or affected checks, including the conflicting
IME sequence; do not repeat settled native evidence without a reason. Missing
evidence stays pending; a broad “Pass” does not complete unrelated checks.

### Packaging and acceptance follow-up — 2026-09-11

Packaging now allowlists main/preload/index/package and `lib/**/*`, retains
electron-builder's production-dependency collection, and explicitly excludes
environment files, secrets, Inbox, personal/workflow state, E2E/results and retired
session modules. This corrects an inherited selection-policy gap; no actual
private-data distribution was established. No runtime behavior or version changed.

Disposable evidence: `/private/tmp/editor-packaging-policy.w59caT/` contains the
reviewed source manifest, synthetic canary list, build log, membership checker,
repeat-build comparison, isolated launch harness/log and `VERIFICATION.md`.
The package used the permanent manifest policy with only output/runtime-location
overrides. All 32 synthetic canaries were excluded; 164 runtime files matched
source bytes, all 27 direct production dependencies were present, and no unpacked
files were produced. ASAR SHA-256:
`32ee2581bd0ff5785d8f6882d01462d67df57bb8c47c5846cfdedf7b2591f55b`.
Default CM6 and opt-in Tiptap each passed synthetic save and fresh-process/profile
reopen, Preview and font-resource checks. Tiptap rich math rendering also passed.
This is **packaged-runtime harness verification**, not an ordinary installed-app
launch or new native IME evidence. The dependency install used offline cached
packages with lifecycle scripts disabled; packaging reused cached Electron 43.4.1.

Acceptance reconciliation preserves the historical `A7-NATIVE-QA-REPORT.md`
(2026-09-10; ASAR `94eee588fd9dc0804fc885db5582766945573c57d834f251a8de9aa5b3ad0f43`)
and the user's subsequent manual PASS as separate observations. To settle IME,
record the manual build path/hash, selected engine/input method, Space/Return
composition commit, Undo/Redo, note-switch and save/reopen sequence; compare or
repeat only the missing sequence on an identified isolated candidate. No IME
fix is presumed necessary or complete. Product TDD requires a controlled,
reproduced defect, not a coverage gap or packaging-harness assertion error.

### What blocks closure

Confirmed content loss/corruption, wrong-file writes or cross-note leakage;
unauthorized filesystem access or a failing security gate; crashes or inability
to complete the essential open/edit/save/reopen workflow; failing required
tests/build checks; unresolved blocking review findings or missing acceptance
evidence. Report infrastructure failures separately from application defects.

A6 may be deferred **only after** evidence shows a formatting-only indicator
with no unintended disk writes or loss of content/metadata. If it conceals lost
edits or unsafe saving, it blocks closure. Cosmetic issues and optional features
do not automatically become blockers. Any scope expansion needs a reason and
explicit user agreement; no new broad bug hunt is required to finish.

For a confirmed blocker: first write the smallest failing behavior test (or
record an exact native reproduction when automation cannot express it), then
propose a minimal fix at the existing boundary. After approval, use RED → GREEN,
run focused regression tests and `mise exec -- npm run test:ci` from
`apps/desktop`; repeat affected native checks. Do not change expectations just
to turn a failure green or refactor unrelated code.

### Completion and shipping boundary

1. **Ready to request shipping approval:** A1–A8 are satisfied, A6 is resolved
   or explicitly deferred with evidence, and no blocking findings remain. The
   generated clean-tree checker is an acknowledged exception while the intended
   outputs are uncommitted; repeat-build equality must already pass. Preserve
   unrelated user changes and review the proposed version/commit scope.
2. **Milestone closed:** only after separate authorization for Git/GitHub actions,
   the approved work is committed and integrated through the review workflow;
   clean-checkout CI passes, including generated assets, and the pilot artifact
   is tied to that revision with known limitations. Do not stage files or weaken
   checks to conceal the current dirty-tree failure. No automatic tags/deletions.
3. **Then use, rather than expand:** try several writing sessions on backed-up
   copies. Select the next improvement from repeated real friction, not from
   the size of the test suite or another open-ended architecture exercise.

### Deferred until after this milestone

New AI/session capabilities, sync/accounts/mobile, new rendering engines, broad
UI expansion, large renderer refactoring, legacy-engine removal and default
Tiptap promotion. Longer-term direction remains one primary rich editor and an
explicit Source mode; this milestone does not implement that consolidation.

**Next bounded task:** recover reliable access to the isolated QA window, then
finish only A5 long-note/image acceptance and A6 raw-table post-restart revisit and
failed Save All. Guided A1 Space/Return and combined A3 retests passed on the
identified candidate; do not repeat them without a build or sequence change.
The AI-operated A6 navigation check passed, but subsequent native control errors
blocked further input; no new product defect is established. A sequential retry
verified clean quit/relaunch (PID 59032 → 60909) and unchanged raw-table disk, but
native window/element targeting errors recurred before post-restart selection.
September 12 audits and packaging follow-up
review passed. Ordinary installed launch and clean-checkout CI remain separate
A8 gates. See [the bounded follow-up and observed results](pilot-acceptance-sep12.md).
Use disposable copies only; no new feature or architecture work is required.
No commit, push, merge, tag or `ai-session-manager` change is authorized by
this acceptance record.

---

## Phase 0 — Concept clarity and environment setup
Objective:
- define MVP clearly
- set up repo and folder structure
- prepare for safe development

Key outputs:
- repo initialized
- docs/mvp.md
- docs/roadmap.md

---

## Phase 1 — Minimum technical foundations
Objective:
- learn the minimum concepts needed to build the app

Topics:
- TypeScript basics
- React basics
- Electron basics
- Markdown rendering basics

---

## Phase 2 — First working Markdown editor
Objective:
- build a simple editor + preview app

Features:
- app window
- editor area
- preview area

---

## Phase 3 — Note storage and organization
Objective:
- make the app work with a real local vault

Features:
- vault picker
- file tree
- create note
- rename note
- safe delete
- save/load

---

## Phase 4 — MCP ingestion
Objective:
- allow Claude Code CLI and Codex CLI outputs to enter the vault through MCP

Features:
- MCP ingest tool
- write markdown into vault
- app detects imported files

---

## Phase 5 — Parallel agent workflow in development
Objective:
- use structured multi-agent workflow to build features safely

Roles:
- architect
- implementer
- reviewer
- tester
- documentation agent

---

## Phase 6 — Testing and stabilization
Objective:
- improve reliability and reduce bugs

Focus:
- manual testing
- basic automated tests
- logging
- debugging
- bug fixing

---

## Phase 7 — Packaging and sharing
Objective:
- prepare a usable shareable product

Outputs:
- packaged app
- README
- setup instructions
- demo vault
- MCP setup instructions


### Local image workflow delivery (2026-11-06)

0.55.0 completes the bounded local-image workflow within Broader documents:
choose PNG/JPEG, preview, undo, back up, export with sidecars, reopen and recover.
The visual baseline is unchanged. Packaged native-image selection and the
image/export/recovery workflow pass; 0.55.0 is installed with 0.54.0 retained for
rollback. Source remains uncommitted. Focused human acceptance remains pending
before broadening syntax or save destinations; installation is not release approval.
Long-document work and a bounded source/preview escape hatch remain in this stage;
ordinary existing-file overwrite still requires a separately proven coordination
solution. Do not restart the blocked replacement experiment to finish images.


### Long-document and source candidate (2026-11-06)

0.56.0 source adds filtered outline navigation, bounded scroll measurements and
complete read-only source viewing within Broader documents. It also fixes the
0.55.0 opaque-block attachment lookup regression. 43 focused Node checks and two
Pro Electron workflows pass. 0.56.0 is installed; packaged paced typing,
outline/source, history/recovery and installed startup pass, with prior records
unchanged and 0.55.0 retained for rollback. Source remains uncommitted.
Integrated delivery exposed the existing 64-edit queue limit under zero-delay
input: rejected keys are absent and later acknowledgements obscure the warning.
The stress failure is retained; a 20 ms per-key run preserved all 1,066 characters.
0.56.1 now implements deterministic queue saturation pause/recovery. Next finish
focused human acceptance and checkpoint readiness on the accepted visual baseline
before expanding authoring; do not split further feature work into this fix. Do not equate this bounded fixture with unlimited
large-file performance or reopen unrestricted saving/source editing. Native IME,
accessibility, broader performance, full CI and release gates remain outstanding.


### Input saturation correction (2026-11-07)

0.56.1 completes the bounded pause/notice/recovery fix within the current
Broader documents stage. It does not raise the queue limit or introduce new
file-writing authority. Source, actual-package checks and delivery evidence are
recorded in stage history; native IME and broad authoring acceptance remain open.
