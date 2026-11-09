# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## Current architecture (fact-checked 2026-11-09) — READ FIRST

**Current installed build: 0.63.2, bounded writing stability.**
Two profiled text-validation hotspots use native `String.isWellFormed()` instead
of repeated lookaround regex scans. Full source projection, main validation,
parser cache bounds, history, saves and capacity remain unchanged. The pinned
Node/Electron already use this API elsewhere. Unicode boundary and long-writing
checks cover this optimization; do not infer unlimited throughput or global IME
acceptance. Local test dependencies must match the lockfile: an older ignored
node_modules directory and a partially missing temporary Electron distribution
were detected this batch. Reuse only verified runtime/tool snapshots.
The user postponed the genuine 20–30 minute writing session; heading/table-cell
VoiceOver checks remain NOT TESTED. Next feature group is main-editor find/replace.

**Previous installed version: 0.63.1; basic human acceptance passed.**
PR #142 merged test/release tooling at `af2d53c` (0.63.0 unchanged). The user
subsequently reported all three genuine-input workflows PASS with built-in Pinyin,
WeChat Input and iFlytek Input on the installed 0.63.0 App. Record this scoped
human acceptance; preserve historical FAIL and untested native-input scenarios.
After PR #143 merged at `d10d79d` and 0.63.1 was installed, the user reported
the rich/source border, basic VoiceOver controls/paragraph reading, dialog
keyboard return and non-disruptive backup announcements PASS. Heading/table
VoiceOver checks were explicitly deferred; longer genuine writing also remains
pending. Do not expand these results into full accessibility acceptance.
Paid Apple Developer setup,
Developer ID signing/notarization and formal distribution are deferred by the user.

The reported rich/source green outline was visible even after mouse clicks.
0.63.1 limits the editor ring to keyboard navigation and clears it on pointer/text
input, retaining controls' focus, roles and composition guards. No document,
history, persistence or permission change. The opt-in writing soak and separate
Developer ID build/verifier remain available. Do not substitute development or
ad-hoc signing for distribution. Development integration does not clear the
remaining acceptance gates. Continue in the existing Worktree.

**Previous candidate: 0.62.2 bounded long-document typing optimization.**
PR #139 merged the 0.62.1 development checkpoint into main at `2575b77` with
explicit user approval after disclosure of pending manual QA. This does not clear
native IME NOT VERIFIED, historical FAIL or public-release acceptance. That group used `fix/document-writing-latency`; it is now merged.
`document-source-parse.mjs` reuses unchanged immutable AST nodes only around an
isolated single-line literal paragraph with unambiguous blank-line boundaries.
Its changed paragraph is parsed normally; uncertain Markdown falls back to full
parsing. Two cached revisions only. Complete projection equality, main-owned
independent validation, source bytes/history and all persistence limits remain.
Do not generalize this path to references, multiline or structural edits without
cold-parser differential evidence. Native/manual acceptance remains pending.

**Previous checkpoint: 0.62.1 local-folder compatibility and package hygiene.**
The Document package excludes `node_modules/@toast-ui/**`; retain historical
Vault development dependencies and SEC-01's legacy status. Do not restore these
unused bundled dependencies to the shipped Document app. All 75 project runtime
files and the native helper are unchanged from the tested 0.62.0 candidate.
Desktop/Documents components beneath Home now use a bounded read-only Foundation
location check, then all existing ancestor/metadata/APFS checks. iCloud-managed
folders remain refused. Export workers repeat capture; native coordinated saving
rechecks the location proof. No cloud permission, ACL change or arbitrary path
write is added. Build the production helper before running these workflows.
Native IME NOT VERIFIED, manual PENDING and historical FAIL remain open.

**Previous local WIP checkpoint: 0.61.2 daily-writing performance.**
The source mapper, table presentation and outline optimizations preserve full
source/main validation, history, queue budgets and save/recovery authority.
Matching focused Node, controlled Electron, package and installed-startup evidence
is retained. Native IME remains NOT VERIFIED, human acceptance PENDING and
historical manual FAIL open; near-limit latency and long-duration memory remain
limitations. This checkpoint preserves work and is not daily-use/release acceptance.

On 2026-11-07 the user authorized local checkpoints, subsequent complete function
groups and Git/remote operations. Continue the accepted visual baseline and
existing architecture. Next is ordinary local-file compatibility; full CI and
security must pass before mainline integration. Public release readiness remains
separate from authorization. Earlier authorization limits below are historical.

**Previous local WIP checkpoint: 0.61.0 everyday document workflows.**
This groups Finder opening, nested local save destinations, editable source,
version-preserving bound-file saving and practical text/image capacity. Native
IME, historical manual FAIL, full CI, SEC-01 and public-release gates remain open.

**0.61.0 practical text/image capacity — included in this checkpoint.**
Document capacity is centralized in `lib/document-capacity.js`; the sandboxed
preload and native header have parity tests. Text is bounded by 524,288 UTF-16
units / 2 MiB. Images are bounded by count, encoded bytes and decoded pixels;
backup/export/native saving enforce the same limits. Two immutable parse trees
are cached; each projection remains independent. Main document history retains
at most 64 entries / 8 MiB of inverse+redo text. Larger source replacements can
reduce the available Undo depth. Do not remove aggregate budgets or claim full
long-document/native IME acceptance from controlled automation. Older bundles
may not recover enlarged drafts; preserve the current bundle/records on rollback.
See the latest stage-history entry for measured limits and remaining gates.

**0.60.0 bound-file saving — retained in this candidate.**
The user approved the explicit replacement contract described in the latest
save-hardening and stage-history records. The fixed product entry can save a
main-bound editing copy or confirmed export through native file coordination
and version-preserving exchange. This does not establish inode-CAS safety: a
racing target can already change before a conflict is reported. Legacy save
stays `coordination-required`; no arbitrary renderer paths or recovered write
authority. Build the macOS helper with `npm run build:document-save` before
local GUI testing; pack/dist commands build it automatically. Never package a
`DOCUMENT_SAVE_TESTING` binary. Prior checkpoint/installed descriptions below
are historical; current delivery and remaining gates are in stage-history.


**Previous local WIP checkpoint: 0.56.1 broader-document workflows.**
The installed 0.56.1 runtime is unchanged. This checkpoint preserves local images,
long-document/source navigation and input-saturation protection as one related
batch. Reused matching source/test/package evidence; only closeout documentation
changed. Human/native IME, independent review, full CI, SEC-01 and historical
failure acceptance remain open. No push, merge, tag or release is authorized.
Earlier delivery-time statements below are historical; their pending source is
now included in this checkpoint. See the latest stage-history entry for scope.

**0.56.1 input saturation protection — included in this checkpoint.**
The 64-edit queue is unchanged. Its first refused supported edit and queued
source are retained in existing window-local recovery records; editing pauses.
Later acknowledgements cannot clear the notice. Explicit acknowledgement and an
idle confirmed state are required before discarding that record and resuming.
There is no automatic retry, persistent backup of these records or acceptance
of keys after the pause. 151 focused Node, two Pro Electron and actual-package
pressure/history checks pass. The synthetic packaged draft was archived; prior
private records are unchanged. Installed startup passes; 0.56.0 is retained
for rollback. Native IME/human acceptance, full CI, SEC-01 and
historical failures remain open. No commit or release approval.

**Previous delivery: 0.56.0 long documents / read-only source.**
The existing outline filters headings and measures active location logarithmically.
A renderer-only modal displays confirmed raw Markdown with selectable text,
wrapping and line-ending/BOM metadata. It cannot edit, serialize or grant file
access; unconfirmed/composing input blocks opening, and changed identity/revision
closes the snapshot. Fixed 0.55.0 attachment lookup on null opaque-block mappings.
43 focused Node and two Pro Electron checks pass. The actual 0.56.0 package
passes paced typing, outline/source, Undo/Redo, restart recovery and installed
startup. 0.55.0 is retained for rollback; prior draft/recent records are unchanged.
Zero-delay burst input hits the existing 64-edit queue and drops rejected keys;
its transient warning was insufficient. This historical stress case FAILED;
0.56.1 adds bounded pause/recovery as described above, not unlimited throughput
or accepted full-writing performance. Source stays uncommitted;
no limit expansion, overwrite or release approval. Native IME/human acceptance,
full CI, SEC-01 and historical failures remain open.

**0.55.0 local PNG/JPEG attachments — included in the current WIP.**
Main owns native image selection, bounded raster validation and document-specific
attachment bytes. Renderer receives only verified raster data URIs; CSP allows
`img-src data:` and still disallows network/file loading. Only explicitly imported
images and exact content-addressed sibling attachments of opened Markdown load.
Draft record v2 stores text and up to four 1 MiB rasters in one verified generation;
plain text stays v1, with no migration. The existing exclusive writer creates image
sidecars before Markdown and parent verification covers all outputs. Exact existing
sidecars can be reused read-only; partial/unknown outcomes remain fenced and retained.
No new overwrite/directory policy. See the latest phase record for limits/evidence.
Actual-package native image selection/preview, history, export/reopen and restart
recovery pass; installed startup and prior-record preservation pass. 0.54.0 is
retained for rollback (it cannot restore v2 image drafts). Source remains uncommitted;
native IME, human/independent acceptance and full CI remain open. Following earlier
checkpoint descriptions are historical, not current feature limitations.

**Active product: a document-first macOS ProseMirror/Tiptap editor.** The trusted
`apps/desktop/document-app-main.js` entry starts the shared Document lifecycle in
`lib/document-window-main.js`. Both `npm run dev` and the local `Markdown.app`
use it. `main.js` / `npm run dev:legacy` retain the old Vault application solely
for historical development; the dedicated document package excludes that runtime.
Use the explicitly approved branch. PR #138 integrated the Document baseline
into `main` on 2026-11-04; subsequent work uses short feature branches from `main`.
A Worktree directory name is not its current Git branch. Preserve
the recovery baseline; do not create a long-lived `develop` branch.

Raw Markdown bytes are authoritative in the Document Model/Service/File Store.
Supported edits patch verified source-map ranges and reparse; **do not serialize
or normalize the whole file**. Originals stay read-only; independently authorized
copies support paragraphs, headings, bold, italic, single-backtick inline code, simple inline links, tight task/nested lists (six levels / 32 items), bounded plain-cell GFM tables (8 columns / 32 rows), inert standalone image references, explicit single-level quote paragraphs and closed basic fences. Other structures
remain protected. Local draft recovery, document find, exclusive new-file export
and verified export shortcuts are implemented with a limited destination policy.
Existing-file overwrite remains blocked by `coordination-required`.

Version **0.54.0 is an installed local WIP checkpoint** for task/nested lists,
basic tables and image-reference
creation/edit/removal and history/export/recovery. Cards explicitly have no preview;
there is no file/image broker, URL fetch, attachment copying or CSP relaxation.
Main revalidates the existing format command and exact source projection. 316
focused Node checks and image plus mixed-authoring Pro Electron workflows pass.
Package contents match 60 project runtime files; the actual package passes combined
task/list/table/image-reference writing, history, export isolation and restart
recovery. Installed startup/recent-panel checks pass; existing private records are
unchanged and 0.53.0 is retained for rollback. No new runtime change or version bump
in this delivery closeout. Air, independent review, native IME, human acceptance,
full CI and release approval remain unestablished; historical failures stay open.

The preceding **0.53.0 table candidate is included in the 0.54.0 WIP checkpoint**.
Table projection/commands use the same source patches, main-owned revision/history
and save policy. Plain rectangular outer-pipe tables support cell text/navigation,
row/column addition/removal and export/recovery; formatted/escaped/ragged tables
remain protected. No table serializer or new persistence authority is introduced.
421 focused Node checks, two Pro source workflows and actual-package table/history/
export/restart recovery and installed startup/panel checks pass. The installed
0.53.0 bundle preserves existing private records; 0.52.0 is retained for rollback.
A further mixed-authoring Pro workflow passes continuous writing, document switching,
export snapshot isolation and restart recovery; only tests/docs changed in that
closeout. Native IME and human table/list QA remain open.
The preceding 0.52.0 app is retained for rollback; no commit/publication implied.

The preceding **0.52.0 list candidate, now included in the 0.54.0 WIP**, was installed for bounded user
acceptance of task and nested lists. The preceding 0.51.0 checkpoint is `755c751`.
Task toggles, Enter continuation and Tab/Shift+Tab subtree moves use existing
source patches and main-owned history. Loose/multiline items, cross-parent or
subtree-spanning range edits, and ambiguous source boundaries remain protected.
396 focused Node / three source Electron workflows pass; the actual package
passes task editing/history/export/restart recovery, with installed startup
verified. Dialogs and IME events are controlled; human/native acceptance remains
open. The installed 0.51.0 bundle is retained for rollback. No Git checkpoint,
publication, original-file overwrite or broad Markdown acceptance is implied.

Version **0.51.0 is a local WIP checkpoint** for draft naming and recent documents, not public-release acceptance.
The preceding 0.49.0 checkpoint is `d8a3f25`; that checkpoint installed 0.51.0.
Draft naming uses the existing private backup writer, bound to session, content
revision and previous label. Only a confirmed backup updates the live name;
body/history and export receipts remain unchanged. Recovery keeps the saved label.
The main-owned name supplies a Save As filename suggestion, never a target path or
overwrite permission. Pending/unconfirmed input and unknown results remain fenced.
Recent documents remember at most 12 main-owned path/identity/hash records in a
separate private catalog using the existing draft snapshot writer. Reopening
uses a new read-only session and revalidates identity/content; changed files
require native selection. Welcome resume-writing uses existing draft recovery.
Clearing history does not delete files/drafts or securely erase older snapshots.
No new file-write permission or directory scan is introduced.
The preceding 0.48.0 checkpoint is `dd0eef4`; 0.49.0 preserves quote/code and the bounded writing closeout.
The installed 0.51.0 app passed bounded startup/panel checks; 0.49.0 is retained
for rollback. Existing draft/catalog records were verified unchanged. This does
not replace native manual acceptance or full CI.
The preceding list-editing checkpoint is `01a4d7a` (0.43.0). Selected italic and inline-code
formatting reuse existing source-map patches, format toolbar and main-owned history.
Line-start heading (1–6) and flat-list shortcuts convert on Space through the
existing queued format/revision path. Heading/list/marked-paragraph boundary keys
also use that queue so pending text acknowledgements do not drop Enter/Backspace.
Bare prefixes stay literal until Space;
empty headings remain editable. Do not enable unrestricted Tiptap input rules.
Simple italic, inline-code text and existing simple link labels are editable.
The link toolbar/Cmd+K panel inserts links, updates label/address or removes the
link while keeping text. Main revalidates the bounded format command, session,
revision and projected source; unchanged addresses/titles retain exact bytes.
Links render inertly, without navigation. Quote/code mapping uses the existing
source patch and main-owned history; `sourceEditable` is projection data, never
save or session authority. Opaque code-shaped nodes default to protected. Code
newlines display as LF but source keeps LF/CRLF/CR; history selections use PM
coordinates, never source offsets. Cmd+Enter exits to prose. Nested marks,
reference links, complex quotes and unclosed/metadata-bearing fences stay protected. No file overwrite or save-authority change. Native IME and
historical formal/manual failures are not globally cleared by controlled E2E.
Keep SEC-01 and other release limitations visible; no publish/merge/tag authority
is implied. Current scope/evidence: [phase record](docs/document-editing-interaction-phase1b3.md).
The [October recovery audit](docs/audits/2026-10-22-project-recovery-audit.md)
remains historical evidence of the old Vault pipeline's defects, not a description
of the current default application.

The legacy Tiptap adapter uses the `remark`/`unified` bridge, not
`@tiptap/markdown`; its edited round-trip is remark-normalized. That adapter-level
property does not describe the Document source-map pipeline above. CodeMirror and
legacy renderers remain in source history; do not resume their WYSIWYG work.

**SUPERSEDED — `hybrid-cm6-lp` (CM6-decoration live preview, Stages A–G.13).**
Merged to `main` via PR #133 (`bd1aa33`) and retained only as a base / future
Source mode. It is **no longer the WYSIWYG direction**: do not resume patching
its click/caret/reflow behavior (this project's layout and interaction tradeoffs
made that route unsuitable; this is not a claim that CodeMirror cannot support
block widgets or live preview). Everything in
the "Architecture" section below about `hybrid-cm6` / `hybrid-cm6-lp` is
**historical reference**. Reviewers and agents (including Codex): when the task
concerns WYSIWYG, the ProseMirror direction here overrides any `hybrid-cm6-lp`
text further down.

## Commands

All npm commands run from `apps/desktop/` unless noted. Use the repository's
mise pin, **Node 24.20.0** (`mise exec --` before npm commands); Electron has its
own bundled runtime. Review command side effects first; see
[DEVELOPMENT.md](DEVELOPMENT.md) for environment setup.

```bash
cd apps/desktop
npm ci                           # fresh checkout only; replaces node_modules
npm run dev                      # current Document app
npm run dev:legacy               # historical Vault runtime only
npm test                         # full Node built-in test runner suite
npm run test:ci                  # full suite with baseline-count gate
npm run check:tiptap-readiness   # corpus tests + readiness gate (limited scope)
npm run test:e2e                 # existing isolated synthetic Electron smoke
npm run audit:prod              # require zero production dependency findings
npm run audit:full              # includes Electron runtime advisories
npm run test:write-engine        # focused: Write engine resolver
npm run test:cm6-write-view      # focused: CM6 write adapters + hybrid-cm6 decorations
npm run test:perf                # opt-in perf bench (PERF_BENCH=1)
npm run test:spike-cm6           # CM6 spike tests
```

Run a single test file:

```bash
node --test test/<file>.test.js
node --test test/cm6-write-view/<file>.test.js
```

Renderer bundles (must rebuild after editing the matching entry file, or the app silently keeps the old bundle):

```bash
npm run build:cm6        # rebuilds lib/cm6-bundle.js     (cm6 + hybrid-cm6 engines)
npm run build:editor     # rebuilds lib/toastui-bundle.js (Preview + legacy hybrid engine)
npm run build:tiptap     # rebuilds lib/tiptap-bundle.js (opt-in Tiptap engine)
npm run build:spike-cm6  # rebuilds lib/spike-cm6-bundle.js (spike only)
npm run check:generated # checks tracked output cleanliness; does not rebuild
```

`build:generated` removes and regenerates the vendor output directories;
`verify:generated` runs that build before the cleanliness check. Do not run
either as a read-only inspection. A clean status alone does not establish
reproducibility: compare rebuilt outputs against the actual commit tree in an
isolated copy. Rebuild vendor assets with `build:katex`, `build:hljs` and
`build:mermaid` when their approved inputs change.

Packaging (macOS, unsigned local WIP; explicit `electron-builder.document.cjs`):

```bash
npm run pack             # current Markdown.app to apps/desktop/dist/
npm run dist:mac         # zip build
```

MCP ingest plugin smoke test (plugins now live in the standalone
`~/Liyunhui/Codes/claude-plugins` repo — see "## Plugins"):

```bash
cd ~/Liyunhui/Codes/claude-plugins/mcp-note-ingest && npm run smoke
```

## Architecture

> **Historical reference for the `hybrid-cm6` / `hybrid-cm6-lp` engines.** The
> current WYSIWYG direction is ProseMirror/Tiptap — see "Current architecture"
> at the top of this file. Do not treat the `hybrid-cm6-lp` details below as the
> active target.

Electron app split between main and renderer:

```
apps/desktop/main.js                    Electron main + IPC
apps/desktop/lib/vault-actions.js       Vault file I/O over IPC
apps/desktop/index.html                 Renderer entry
apps/desktop/lib/write-engine.js        Resolves which Write engine loads
apps/desktop/lib/cm6-write-view.js      cm6 engine
apps/desktop/lib/cm6-hybrid-view.js     hybrid-cm6 engine (decoration walker on the cm6 bundle)
apps/desktop/lib/hybrid-write-view.js   legacy hybrid engine (per-block Toast UI textareas)
apps/desktop/lib/tiptap-entry.js        opt-in Tiptap editor and Markdown bridge setup
apps/desktop/lib/markdown-mdast-pm.js    Markdown/mdast/ProseMirror conversion
apps/desktop/lib/dirty-state.js         Unsaved-state tracking
apps/desktop/lib/close-guard.js         Quit-with-unsaved-work dialog
```

Five Write engines coexist. Resolution priority (`lib/write-engine.js`): `?writeEngine=<name>` URL param → `localStorage.markdownVault.writeEngine` → default `hybrid-cm6`. Valid names: `hybrid-cm6` (default), `cm6` (fallback), `hybrid` (legacy fallback), `hybrid-cm6-lp` (historical live-preview opt-in), `tiptap` (current WYSIWYG opt-in).

**Historical CM6 adapter invariant (BOTH `hybrid-cm6` and `hybrid-cm6-lp`, not the whole file pipeline).** `getText()` returns raw Markdown verbatim; decorations do not mutate the document. Round-trip is character-identical at the LF level within these adapters (CodeMirror normalizes line endings, so CRLF byte-equality is not promised). This does not apply to edited Tiptap serialization or guarantee safe main-process file reconstruction; see the current architecture warning above.

- **`hybrid-cm6` (legacy default)** — uses `Decoration.mark` ONLY. No widgets, no `Decoration.replace`. Marker visibility is driven by CSS `display: none` on `.cm-md-syntax`, revealed via the `.cm-activeLine` / `.cm-md-active-range` selectors.
- **`hybrid-cm6-lp` (CM6-decoration live preview, Stages A–G.13) — SUPERSEDED.** Extended `hybrid-cm6` with `Decoration.replace` + `WidgetType` widgets to render inline images, GFM tables, KaTeX math, highlight.js fenced code, and Mermaid diagrams off the active line; block-level widgets are delivered via a CodeMirror `StateField` (not a `ViewPlugin`, which CM6 forbids for block decorations). Retained only as a base / future Source mode — the active WYSIWYG direction is ProseMirror/Tiptap (see "Current architecture" at the top). Per-stage detail lives in `docs/stage-history.md` (documented through G.3).

The hybrid-cm6 walker styles a subset of `@lezer/markdown` nodes (ATX/Setext headings, bold/italic, inline code, links, images, lists, blockquotes, fenced code, HR, tables, strikethrough, task list, autolinks, YAML frontmatter). The "hide off the active line / reveal on the active line" reveal mechanism follows the full selection — every line touched by selection or cursor reveals its markers (see README's "Live styling in hybrid-cm6" for the full per-construct spec and the construct-active scoping rules across Stages 26–34).

Task list `[ ]` ↔ `[x]` toggle (primary click on marker, or `Cmd-Shift-X` on macOS) and Cmd-click link opening (allowlist: `https:` and `mailto:` only) are real Markdown edits routed through `onChange` → dirty state → undo/redo.

## Plugins

The agent plugins that used to live in this repo's `plugins/` were
**extracted to a standalone repo at `~/Liyunhui/Codes/claude-plugins`** (2026-06-07)
because they are cross-project tooling; history was preserved via `git subtree
split`. Codex loads them via the `workflow-and-MCP-and-plugins` directory
marketplace, which now points at that path (not this repo).

- `mcp-note-ingest` — MCP server that writes AI chat notes into a fixed local Inbox directory. Target overridable via `MCP_INGEST_TARGET_DIR` env var. Distributed via the `workflow-and-MCP-and-plugins` marketplace.
- `workflow-orchestrator` — engineering-workflow orchestrator plugin (skills + bin + servers, including the bundled `codex-bridge` MCP).
- `mcp-chat-rag` — optional MCP server for local RAG over agent session history, maintained in the standalone plugin repo. Do not assume it is available: this project's `.mcp.json` currently registers no servers, and availability must be checked in the active Codex session.

## Stage history

The project ships in numbered stages. `docs/stage-history.md` is the canonical record; user-visible behavior changes also update `docs/test-manual.md`. Reference the relevant stage number when touching live-styling, reveal mechanics, or click/keyboard behavior in the editor.

## Project Rules

### Core workflow
- Use small, reviewable changes.
- Do not refactor unrelated files during bug fixes.
- Prefer TDD for bug fixes.
- Before committing, run tests and inspect git diff.

### Code size
- Try to keep files under about 300 lines.
- If a file exceeds 300 lines, explain whether it should be split.
- Test files (`**/*.test.js`) have a higher practical cap of ~800–1200 lines: a single test file commonly packs unit + integration + invariant + perf coverage with helper scaffolding, and splitting often balloons stage scope. Stage 25 (`link-click.test.js`, 1170 lines) and Stage 26 (`cm6-active-range.test.js`, ~600 lines) ship over the 300-line guideline with documented rationale; this is allowed for test files but each stage should still note the size in its stage-history row.

### Markdown editor
- Pay special attention to Markdown shortcuts, cursor behavior, undo/redo, Chinese IME input, and long documents.

### Documentation
- When user-facing behavior changes, update docs.

### Versioning
- Read the current app version from `apps/desktop/package.json`; that file is the version source of truth.
- Follow SemVer (`MAJOR.MINOR.PATCH`). Pre-1.0 rules: bump **patch** for bug fixes, **minor** for user-visible features or a new stage's worth of behavior, **major** only when cutting `1.0.0` (the "ready for daily use by others" signal).
- Before committing, propose the version bump in the same commit as the change. Map by intent, not line count:
  - Bug fix only → patch (`0.1.0` → `0.1.1`)
  - New stage / user-visible feature → minor (`0.1.0` → `0.2.0`)
  - Internal refactor with no behavior change → no bump
- After the bump commit lands on `main`, tag it: `git tag v0.X.Y && git push --tags`. Tagging is a destructive-ish action — confirm with the user before pushing tags.
- The extracted plugins (now in `~/Liyunhui/Codes/claude-plugins`) have **independent** versions. Do not bump them in lockstep with the app.

### AI workflow
- Codex may implement.
- Codex should audit important diffs.
- Human makes final decisions.

## Local development artifacts

- Keep private archives, rollback copies and verification output in ignored `.local/`; explicitly exclude them from packaging and recursive backup collection.
- Do not create workspace-root `Archives` or `Backups` without task authorization. Preserve recovery material: `.local/` is not disposable cache.
- Do not run `git clean -x` or `git clean -X` over recovery material. Project-local copies do not protect against project deletion or disk failure.
- Keep historical scripts/manifests unchanged. Consult the original checkout's `.local/RELOCATION.md` before following restore instructions with old absolute paths.
