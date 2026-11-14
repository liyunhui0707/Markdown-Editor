# Markdown

A local macOS Markdown editor with a document-first writing workspace, built with
Electron and Tiptap. Open an original read-only, edit an independent copy, keep
local draft backups, explicitly export a new `.md` file, and save back to a
bound local file while retaining previous versions. New-file export never replaces
an existing target. No account or hosted backend is required.

**0.67.0 development build with explicit disk-version inspection.** This is not
a signed/notarized release or unrestricted Markdown editing/saving. Current limits are below.


The Document installation excludes the retired Toast UI dependency files, including
its old embedded sanitizer. Historical Vault source/dependencies remain available
for development; this is not a claim that their SEC-01 issue is fixed.

## Keyboard access and local delivery — 0.63.0

F6 / Shift+F6 moves between workspace regions; Option+F10 enters formatting.
Toolbars use one Tab stop with arrow-key/Home/End navigation. Read-only content
and editing copies have distinct accessible names and roles. Focus indicators
and muted-text contrast in light/dark themes are clearer, without changing the
accepted layout. Navigation does not force-confirm composition or bypass edit
and save guards. The user reported the three supplied genuine-input workflows
PASS on 0.63.0 with built-in Pinyin, WeChat Input and iFlytek Input. Basic
VoiceOver controls/paragraph reading, Source-dialog keyboard return and the
writing-focus correction passed user acceptance on 0.63.1. Heading/table-cell
VoiceOver checks and 20–30 minutes of genuine writing are still pending; these
results do not claim complete accessibility or all native-input scenarios.

The [installation guide](docs/install.md) now covers the actual standalone
Document App, Finder association, keyboard controls, verified local ZIPs,
updates, private records and recoverable rollback. No terminal is needed to run
an installed App. This batch is not a signed/notarized public release or an
automatic updater. See the [manual checks](docs/test-manual.md).

## Everyday file workflow — 0.67.0

The footer/sidebar/details distinguish an independent draft, unsaved bound-file
changes, saved content and a paused save. File status compares exact confirmed
content with its current main-owned file baseline; local backup remains separate.

In **Details → Disk file**, explicitly check for disk changes, reveal the verified
file in Finder, or open its current contents as another read-only document.
The existing original/draft, source, Undo/Redo and backups remain intact. Disk
checks are timestamped observations, not live monitoring. Changed/missing bound
files pause writing back; checking again does not restore stopped authority.
Create an editing copy of the verified disk version, or export the retained draft
under a new filename. Saving still revalidates the file independently.

Home-descendant ordinary local APFS destinations remain the supported scope.
Cross-volume replacement needs a separate native staging/recovery design; this
batch does not enable external, network or cloud/sync destinations.

## Common inline compatibility — 0.66.0

Combined bold and italic text now remains editable in supported single-line
paragraphs/headings, quote rows and tight list/task items. Supported selections
can type, replace, add/remove the compatible emphasis, continue with Enter and
Undo/Redo while preserving other marks. Find replacement uses the same gates.

In ordinary soft-wrapped paragraphs, explicitly replacing a selection across
source lines can join those lines. Enter inside a physical line splits the
paragraph. Existing BOM and all source bytes outside the actual patch are retained;
exact inverses support history, export and draft recovery. Finish composition
before edits crossing formatting/source-line boundaries. Controlled composition
and committed text do not replace physical input-method acceptance.

Nested links/code, formatted multiline paragraphs, hard breaks, transformed
entities and ambiguous structural edits remain protected in the visual editor;
Source mode is available. This does not expand file permissions or size limits.

## Formatted long-document writing — 0.65.1

Typing in isolated single-line formatted paragraphs and ATX headings now reuses
surrounding parsed content, as ordinary paragraphs already did. The changed block
is reparsed; ambiguous syntax uses the full parser. Source bytes, supported edit
scope, main validation, Undo/Redo, backup and save permissions stay the same.
Controlled long-document measurements show lower mapping cost; they do not prove
universal responsiveness, physical IME acceptance or long-term memory stability.

## Mixed-format writing — 0.65.0

Select and replace text across ordinary/bold/italic/inline-code/simple-link text
within a paragraph, heading, quote row or list item. Replacement inherits the
first selected text's format. Surviving link text keeps its original destination
and title; deleting its entire label removes the selected link. Unselected text
and source bytes are preserved. Continue typing, Undo/Redo, export and draft
recovery use the existing main-confirmed edit/history path.

Find Current/All replacement now handles the same mixed-format ranges atomically.
Unsupported combinations, cross-item link ranges and changes
whose formatting cannot be expressed equivalently in Markdown remain protected.
The original combined-emphasis and plain soft-line restrictions are superseded
by 0.66.0 above. Cross-format native IME selection replacement retains conservative composition
guards and still needs physical acceptance. Dense batches that require repeated
delimiter re-planning have a work budget;
refine the query when refused. Source mode remains available for broader changes.

## Repeated document sessions — 0.64.1

Confirmed document closing now releases that session's window-local backup,
export and save notices, and clears hidden receipt/recovery text. Late backup
notifications cannot repopulate closed-session UI caches. Other open documents,
on-disk drafts, saved versions and revoked-session guards are preserved.
This removes unbounded presentation caches; it does not prove that process
memory growth observed in earlier soak tests is resolved.

## Find and replace — 0.64.0

Use ⌘F to search the current document's rendered text, with literal matching and
optional case sensitivity. Editing copies offer Replace Current and Replace All;
each action is one main-confirmed source edit and one Undo step. Empty replacement
removes matching text where the resulting Markdown remains equivalent.

Search does not include link destinations or image paths and does not join blocks.
Replacement must stay within exact editable source spans; protected
matches or changes that introduce Markdown structure refuse the whole action.
The original cross-format restriction is superseded by 0.65.0 as described above.
Use Source mode for those changes. Replace All supports at most 1,000 matches;
refine the query when there are more. Read-only originals remain searchable.
IME preedit and pending edits pause replacement; Escape returns focus to the editor.
Controlled automation is not new physical-IME or VoiceOver acceptance.

## Long-document validation — 0.63.2

The two measured text-validation hotspots now use the native Unicode
well-formedness check already supported by the pinned runtimes. Lone UTF-16
surrogates remain rejected; valid emoji, combining characters and exact offsets
are preserved. Full projection checks, independent main-process validation,
history, backups and file-saving protections are unchanged.

A bounded 485k-unit mapper measurement fell from 14.4 ms to 10.3 ms on the same
Mac. On Air, the controlled 25-key input/confirmation sequence fell from 2.35 s
to 2.09 s, with exact text, Undo/Redo and restart recovery passing. This single
paired run includes automation overhead and is not a universal latency guarantee;
long tasks around 100 ms remain near the capacity limit.

A 21.7-minute controlled Air run passes six long-document editing/closing
sessions and 118 input/history rounds. Renderer JS heap after closing remains
9.94–10.81 MiB with six retained drafts; process working set rises during the run,
so longer memory stability remains under observation. This is synthetic input,
not the postponed human-writing session.

Paid Developer ID signing, notarization and formal distribution are deferred by
the user. 0.63.2 is installed and passed packaged startup/record-preservation checks;
0.63.1 is retained for rollback. The previous scoped human acceptance is not
a claim of new human testing. Historical failures and untested scenarios remain.

## Local Desktop and Documents — 0.62.0

Ordinary local `Desktop` / `Documents` folders beneath Home, including nested
folders with these names, can now pass the same save checks as other local
folders. This applies to new-file export and explicitly bound-file saving.
iCloud-managed Desktop/Documents remain refused with a specific explanation.
If macOS cannot confirm the location, nothing is created. The app does not change
sync settings or folder permissions. Home itself, system/hidden/provider folders,
network and external volumes remain outside the supported save scope.

## Daily writing — 0.62.2

Long-document edits inside an isolated single-line literal paragraph now reparse
that paragraph and reuse unchanged syntax. Markdown structure, references,
multiline text and uncertain boundaries fall back to complete parsing. Complete
projection comparison, independent main-process validation, exact source patches,
history and save protections remain in place. The cache still holds at most two
immutable revisions.

On the same 485k-unit synthetic article, the focused mapper mean fell from
99.5 ms to 13.7 ms; a controlled 25-key typing/confirmation sequence fell from
5.32 s to 2.62 s. These are bounded same-machine measurements, not universal
latency guarantees. Six open/edit/close cycles at the start, middle and end pass
exact history and original-file checks. Closed renderer heap measured 9.9–11.2 MiB
while six synthetic drafts were retained; process working sets fluctuated.
This historical short run does not establish long-duration memory or native IME
acceptance; subsequent scoped human results are listed above.

Earlier 0.61.2 improvements remain:

Line-boundary mapping now scans forward once. Ordinary paragraph keys no longer
request table projections; body edits retain outline buttons while updating their
confirmed positions. Ordinary keys also skip the inapplicable paragraph split/join
candidate before copying the full document. Source validation, history, backup and
save authority are unchanged. The 0.61.1 same-machine profile of eight controlled
keys in a 485,031-unit synthetic article
measured a median 695 ms → 205 ms from beforeinput to confirmed state. This is a
bounded same-machine comparison, not a universal latency guarantee; near-limit
writing still has noticeable latency and substantial memory use. The later scoped
genuine-input results are listed above; long genuine-writing
acceptance remains pending. See `docs/test-manual.md`.

## Larger articles and images — 0.61.0

The complete open/edit/history/backup/recovery/export/save path now accepts up to
**524,288 UTF-16 units of Markdown** (excluding the initial BOM) and **2 MiB of
UTF-8 file bytes**; both limits apply. PNG/JPEG attachments allow **16 distinct
images**, **4 MiB each**, **16 MiB total** and **32 million decoded pixels total**.
Each image still has a 4096-pixel side / 16-million-pixel limit. Unknown or
oversized data is refused; missing attachments remain placeholders, not verified
exports. Import/Undo retains at most 32 images / 32 MiB / 64 million pixels per
session. This does not grant access to additional paths or file types.

Document Undo keeps up to 64 entries and 8 MiB of inverse/redo text; large whole-
source replacements may retain fewer steps. Recent steps remain exact. The source
window has its own local edit history. Existing drafts need no migration, but a
larger new draft may exceed older App versions' limits: retain the 0.61.0 App and
its records before rolling back; export needed work using this version first.

A controlled Electron workflow passed with roughly 491,000 UTF-16 units,
701 headings and 16 images, including a real 1.13 MiB PNG, through export, save
back and restart recovery. Opening measured 0.40 s and saving 0.26 s; a controlled
edit/confirmation flow took 2.13 s, including automation overhead. This is bounded
functional evidence, **not** smooth extreme-length typing or native IME acceptance.
Long-document latency and full-app memory profiling remain daily-use gates.

## Save back to a local file — 0.60.0

Open a file, choose **编辑副本**, edit, wait for the draft backup, then choose
**保存** (⌘S). The first save asks for confirmation of the bound target. A newly
exported file also becomes the draft's save target. Later changes require another
explicit save; there is no automatic overwrite. **另存新文件…** remains exclusive
creation. Inside **源码**, ⌘S still applies the source buffer to the draft only.

Confirmed saves retain the previous content and clear the saved revision's dirty
state without resetting Undo. Later edits remain unsaved. An external change or
uncertain outcome stops this draft's subsequent original saves and preserves the
last successful receipt separately. Keep the draft and inspect the file/version
records; no automatic retry or rollback occurs. This uses native coordination
and version preservation, **not** an inode-conditional replacement: an arbitrary
outside writer can still race the final exchange. In that case the pathname may
already contain the new version; the displaced object is retained, and detected
conflicts are not reported as successful saves.

Use **草稿 → 保存版本 → 在 Finder 查看** to inspect retained versions, even after
restart. Copy a needed `baseline.md` / `draft.md` / `previous.md` to a new location
before reopening; `exchanged.md` retains the displaced object and can still be
changed by another process holding it open. Recovery never automatically writes
back or restores save authority. The private local store stops at 128 records;
it never automatically deletes them. It is not a backup against disk loss.

The same ordinary local Home-descendant APFS directory policy applies. Unknown
ACLs/attributes, synced/network/external-volume locations and unsupported files
remain refused. Current text/image limits remain. Building on macOS now compiles
a small Foundation helper (`npm run build:document-save`); packaging includes its
production arm64/x86_64 binary. Native IME, broader OS acceptance, full CI/security
and signed/notarized release gates remain separate.

## Edit complete Markdown source — 0.59.0

On an independent draft, **源码** opens an editable Markdown window with line
numbers, syntax highlighting, search, line wrapping and local Undo/Redo. You can
edit YAML, HTML and other structures that the visual editor protects. Originals
remain read-only: choose **编辑副本** first.

Choose **应用并返回** (⌘S or ⌘Enter inside the source window) to apply the buffer
as one document history step and include it in the existing local draft backup.
This does not save over a file. Unapplied changes stay only in this window;
returning asks whether to discard them. Complete composition before applying.
A stale or uncertain result retains the source for copying rather than retrying.

Untouched Markdown, the file's BOM and original line endings are retained through
application, document Undo/Redo, backup/recovery and new-file export. New line
breaks follow the nearby source style; the editor/clipboard displays LF. Unsupported
rich constructs remain protected visually and can be edited here as source; raw
HTML is not executed. Current document/image limits still apply.

## Save into local subfolders — 0.58.0

**另存新文件…** now accepts ordinary local APFS folders beneath your home,
including nested folders such as `~/Liyunhui/Inbox` or `~/Downloads/Articles`.
The selected folder and all ancestors must pass ownership, permissions, identity
and metadata checks. This export action creates only a new filename and never replaces existing
targets. Saving back uses the separate bound-file action described above. Failed/cancelled exports retain the draft and
last confirmed receipt. Imported image attachments use the same destination.

This does not mean any disk or directory is supported. Home itself, Library, Applications, hidden/system and known cloud/sync components,
symlinked paths, other filesystems and unsupported permissions remain refused.
The app never changes folder permissions; confirm that no other app syncs your
chosen folder. Saving back uses the separate bound-file action described above.

## Finder opening — 0.57.0

Markdown declares `.md` support for macOS **Open With**. Cold and running-app
opens use the same bounded, read-only file service. Repeated opens reuse an
unchanged original; changed/replaced files retain the old snapshot and ask for
explicit reopening. Current drafts and their history stay available in the sidebar.
While composing, waiting for an edit or using a modal, a Finder request stays in
**Finder 打开请求**; finish the operation, then choose **打开文件** or skip it.
At most 16 pending requests and eight open documents are held; over-capacity
requests are reported. Failed/unsupported files never replace the active draft.

The app does not change your default handler. After installing this version,
use Finder → select an `.md` → Get Info → Open with → Markdown → Change All
if you want ordinary double-click to use this app. This choice is optional.
Files still need to be readable regular UTF-8 `.md` files within the current
size limits; association does not grant overwrite or other filesystem authority.
Remaining save locations, safe original-file saving, richer visual structures and
practical capacity are tracked in [the three-phase roadmap](docs/roadmap.md).

## Long articles / source view — 0.56.0 baseline (source editing added in 0.59.0)

Filter headings in the outline and press Enter to jump to the first match;
Escape clears the filter. The **源码** toolbar button shows the complete confirmed
Markdown in a read-only window, including unsupported syntax. Select/copy text,
toggle line wrapping and return to the article without changing its contents or
history. Pending or composing input must finish first. Clipboard selection may
normalize newlines and omits the BOM; export preserves the original file format.
The original-file source view remains read-only; draft source editing is described
above. Document/save limits are unchanged. The 0.56.0 baseline also
fixes an image-lookup regression that prevented opening protected HTML blocks.
43 focused Node checks and two Pro Electron workflows pass. The packaged app also
passes paced typing, outline/source, Undo/Redo, restart recovery and installed
startup; 0.55.0 is retained for rollback. Human acceptance remains pending.
The 0.56.0 zero-delay stress failure is retained. In 0.56.1, reaching the
64-edit queue limit pauses input and preserves the first refused supported edit.
Open **查看未确认修改**, select/copy needed Markdown, then explicitly acknowledge
and resume after pending operations settle. Later successful replies do not hide
this notice. Recovery text exists only in this window; it is not backed up and
keys after the pause are not accepted. No automatic retry or throughput guarantee.
151 focused Node, two Pro Electron and actual-package pressure/history checks
pass. Native IME remains NOT VERIFIED; human acceptance is still pending.

## Local images — 0.55.0 installed local WIP (2026-11-06)

Use the image button → **选择本地图片…** to choose a PNG/JPEG, add a description,
then insert it. Verified images appear in the writing surface; Enter continues
in prose and Undo/Redo retains the attachment. Current 0.61.0 limits are 16 distinct images per
article, 4 MiB each, 16 MiB / 32 million pixels aggregate; each image remains
limited to 4096 pixels per side and 16 million pixels.
The original image is read only. Image clipboard/drop, SVG/GIF and remote loading
are not supported. Other relative/http(s) addresses remain reference-only cards.

Images are backed up with the same private draft snapshot as the text. Image
snapshots require 0.55.0; plain-text snapshots remain compatible. Export creates
new Markdown plus content-addressed image files **in the same supported folder**.
Keep them together when moving or sharing. Existing identical verified image
files may be reused read-only; differing files, links or unsupported metadata
are refused. Success requires verification of the text and every attachment.
Partial or unknown results retain the draft and possible created-file paths,
without automatic retry or cleanup. New-file export does not overwrite; bound-file saving is described above.

212 distinct targeted Node checks and two Pro Electron workflows pass, with
final affected checks repeated after review corrections. Native dialogs are
controlled in E2E. Native IME/human acceptance, independent review and full CI
remain open. The actual 0.55.0 package also passes native image selection, preview,
history, export/reopen and restart recovery. Installed startup passes; prior drafts
are unchanged. The 0.54.0 app is retained for rollback, but cannot restore image
drafts made by 0.55.0. This work is included in the 0.56.1 local WIP checkpoint,
not release approval.

## Image references — 0.54.0 checkpoint history (2026-11-06)

The image toolbar button inserts a standalone Markdown image reference after the
current paragraph (or in an empty paragraph). Select its card and use the button
to edit its description/address or remove it. Enter returns to prose; Delete or
Backspace removes the selected reference. Undo/Redo, export/reopen and draft
recovery retain the reference and untouched source bytes, including existing titles.

**In the 0.54.0 checkpoint, cards say “未加载预览”: images are not loaded, validated or copied.** Relative
addresses and http(s) references are stored as Markdown text only. Exporting to a
different folder does not relocate attachments or repair relative paths. Inline,
reference-style, nested or complex images remain protected; paste/drop of image
files, title editing, local-file access and network previews are not implemented.
316 focused Node checks and two Pro Electron workflows (images and existing mixed
writing) pass. Controlled dialogs/composition do not establish native IME or human
acceptance. The actual 0.54.0 package also passes combined task/table/image-reference
writing, history, export snapshot isolation and restart recovery. Installed startup
and recent-panel checks pass; existing private records were unchanged. The 0.53.0
bundle is retained for rollback. The combined task/nested-list, table and image-reference
batch is preserved in one local WIP checkpoint. Focused human acceptance remains
pending; the checkpoint is not release acceptance.

## Basic tables — 0.53.0 local candidate (2026-11-06)

Use the table button in the format toolbar from an ordinary paragraph to create
2 columns with a header and 2 data rows. Type or paste one line in a cell. Tab /
Shift+Tab moves between cells; Enter moves down; advancing past the last row adds
an empty row. Cmd+Enter returns to prose. The contextual controls add a row below,
add a column to the right, or delete a data row/column; Undo/Redo restores them.
The header and final column cannot be deleted. Existing alignment and untouched
source bytes are retained through export, readonly reopen and draft recovery.

This first subset supports rectangular, outer-pipe GFM tables with plain-text
cells, at most 8 columns and 32 rows including the header. Separator cells need
at least three hyphens. Cell padding remains editable source text. Inline marks,
links, escaped pipes/backslashes, merged cells, formulas, cell newlines and
spreadsheet/cross-cell paste remain protected; they are not silently normalized.

421 targeted Node checks, two Pro source Electron workflows (table and prior
list regression), actual-package table/history/export/restart recovery and installed
startup/recent-panel checks pass. Prior draft/catalog records remain unchanged.
Native dialog choices/composition are controlled, not native IME acceptance.
Original files remain read-only; export only creates a new file. Human table/list
acceptance, native IME, SEC-01 and existing release limitations remain open.

## Structured lists — introduced in 0.52.0 (2026-11-06)

The installed local candidate adds task items and tight nested lists (up to
six levels and 32 items per projected list). Type `- [ ] ` or use **任务列表**;
click a checkbox to toggle it. Enter continues with an unchecked task, Tab nests
the current item and its children, and Shift+Tab lifts it. A nested empty task
lifts one level; a first/last top-level empty item exits to prose. Same-parent
leaf-item selections support replacement, deletion and one-line plain-text paste.
All changes use the existing main-owned source patches, revision and Undo/Redo.

Multiline/loose list items, cross-level or subtree-crossing range replacement,
multiline list paste and bulk conversion of a structured list stay refused.
An empty ordinary bullet cannot start a new nested list after a paragraph in
CommonMark: enter its text before indenting. A newly nested ordered list starts
at `1`; untouched markers and exact inverse bytes are retained. Some empty or
mixed-marker boundaries that cannot reparse identically remain protected.

396 focused Node checks and three Pro Electron workflows pass, including export,
readonly reopen and draft recovery. Installed 0.51.0 also passed the bounded
name/edit/export/reopen/recovery preflight with synthetic content and controlled
dialog choices. The actual 0.52.0 package also passed task editing, history,
export and restart recovery; installed startup and record preservation passed.
The old 0.51.0 bundle is retained for rollback. Native IME, human list acceptance,
Air, full CI and independent review are not newly accepted. Historical failures
and file-safety limits remain. No Git commit or release was made.

## Open the application

On this development Mac, double-click `~/Applications/Markdown.app` in Finder.
It may be kept in the Dock. The installed bundle includes its runtime and does
not need Terminal, mise, a Worktree path or an external Electron installation.
It uses the current writing workspace, not the historical Vault interface.
Source edits do not update the installed app until it is rebuilt and reinstalled.
The installed app includes line-start shortcuts: type `#` through `######`
then Space for headings, or `-`, `+`, `*`, `1.` / `3)` then Space for flat lists.
Bare prefixes stay visible until Space; an empty heading accepts text, Enter
returns it to a paragraph, and Backspace at a heading start removes its format.
Undo/Redo uses the existing document history. Heading levels 1–6 are also in
the format menu. Type `>` then Space for a single-level quote, or three backticks
(optionally followed by a simple language name) then Enter for a fenced code block.
The block menu also offers quote/code creation. Plain quote paragraphs split with
Enter; Enter on the last empty quote paragraph returns to prose. Code supports
literal Enter/Tab and multiline plain-text paste, including blank lines. **Cmd+Enter**
exits either block into prose. Undo/Redo and new-file export/reopen preserve source
markers and line endings. Nested/lazy/soft-wrapped quotes, splitting marked quote
paragraphs, unclosed/metadata-bearing fences and code execution stay unsupported.
Code-to-prose conversion is limited to one line; use Cmd+Enter for multiline code.
The installed app includes the task/nested-list subset introduced in 0.52.0. Nested inline marks remain protected.
The link button or **Cmd+K** opens an insert/edit panel. Select plain text or place
the caret to insert; place the caret in a simple link to edit its text/address or
remove the link while retaining its text. Cancel/Escape preserves the document;
Undo/Redo covers the complete change. Unchanged addresses and existing titles
retain their source spelling. Enter at the end of a linked paragraph continues
with a new paragraph without rewriting the link. Links stay inert; cross-link selection/splitting,
nested marks and title editing remain unsupported. The panel accepts http(s),
mailto, relative and fragment targets, rejecting script/file protocols, credentials,
whitespace and control characters. No URL is opened or fetched.
The installed app is now **0.54.0**; the previous 0.53.0 bundle is retained locally
for recovery; user documents and existing drafts were not migrated. The 0.48.0
checkpoint is `dd0eef4`; the 0.49.0 local WIP `d8a3f25` preserves quote/code and authoring closeout.
The mixed writing closeout fixes typed heading and mixed-paragraph spaces, fence prefixes before an
existing final newline, and structural keys arriving before text acknowledgements.
For that 0.49.0 authoring closeout, 351 targeted Node cases, five source Electron
workflows, one real packaged-app workflow and installed startup passed. Export/reopen and restart recovery preserve
verified source bytes. Controlled dialogs/clipboard and text insertion are not
native IME acceptance. Air, independent review and full CI were not run for this
batch; historical manual failures and release limitations remain.

The recent-documents slice passed 148 targeted Node cases and the
restart/recovery/reopen/clear workflow on Pro and Air (three clean exits per run).
Air used the final 0.50.0 snapshot and isolated copied dependencies. Package
membership, source hashes and main-process dependency imports passed. Five recent
regressions also pass on the combined 0.51.0 candidate. See the phase record for
exact evidence; these counts cover different scopes, not one full CI run.

The 0.51.0 checkpoint adds draft naming and suggested export names. It passes 130
targeted Node checks, one two-start Pro Electron workflow and package checks.
This batch's Air GUI did not start because its launch-time check found the screen
locked. The 0.51.0 package subsequently passed bounded welcome/recent-panel and
name cancel/invalid-input checks; the installed app passed startup and the recent
panel with the same ASAR. Existing draft/recent record identities and hashes were
unchanged. Full packaged writing/recovery, native dialogs/IME, independent review
and full CI are not newly accepted by this closeout. Human experience checks remain open.

With existing development dependencies, start the same UI from source:

```sh
cd apps/desktop
mise exec -- npm run dev
```

Build the current unsigned app with `mise exec -- npm run pack`.
See [DEVELOPMENT.md](DEVELOPMENT.md) for isolated packaging verification.
`npm run dev:legacy` explicitly starts the historical Vault runtime. The older
`tools/run-document-copy-demo.cjs --persistent` launcher remains a QA tool and is
no longer required for ordinary app use.

## Current document workflow

Use **打开…** or **Cmd+O** to select one `.md` file from any directory,
then open a different file in the same window. No Vault is required. The approved
prototype's first integration batch provides a collapsible sidebar of real open
sessions, a compact document/format toolbar, a centered writing surface and a
bottom status bar. The sidebar filters open document names only; it does not scan
folders or search document content. Click a row to switch original/copy, or click
the document title to see its full name and directory. Press Escape or click outside to dismiss the title menu;
Escape returns focus to the title when focus was inside the menu. On narrow windows the
sidebar becomes an overlay. The 0.50.0 welcome page adds **继续写作** (up to three local drafts) and
**最近文档** (six recent files); the sidebar opens the full recent list of up to
12 entries. Recovery reuses independent drafts, without old Undo history or save
authority. Recent files reopen read-only after identity and content verification.
Changed, replaced or missing files require a fresh selection through **打开…**.
The catalog contains local paths, identities and hashes, not document bodies; it
does not scan folders. **清空列表** removes visible history, not Markdown files or
drafts; older verified catalog generations may remain, so this is not secure
erasure. Catalog failures leave normal native Open available. Opened original
files cannot be edited or saved.

For an independent draft, click its title and choose **重命名草稿…**. A confirmed
name appears in the sidebar and survives draft recovery, including an empty named
draft. Cancel/Escape keeps the old name. Names cannot be paths; invalid names or
unconfirmed backups retain the current body and name. **另存新文件…** suggests this
name with `.md`; you can still choose a different new filename in the native dialog.
Naming does not rename original/exported files, change text or reset Undo/Redo.
Recovery keeps the name and confirmed body, without restoring old history or
export receipts. That source operation grants no file-write authority; the separate bound-file save and destination restrictions are described above.

**Installed WIP candidate (`feat/document-close`):** click the header
× or press **Cmd+W** to close only the current document. Read-only originals close
without writes. Editing copies offer Cancel or Keep draft and close; closing
requires a verified backup of their latest confirmed body. Cancellation retains
text and Undo/Redo. Recovery restores the body, not old history or export receipts.
Unfinished input, uncertain exports or unverified backups prevent closing. The
last document returns to the welcome page; **Cmd+Shift+W** closes the window using
the existing window guard. Closing does not delete or archive drafts or files.

The second integration batch adds a real **文档大纲** on the right: click a heading
to scroll to it without changing the caret or document. It lists supported headings
rendered by the editor, excluding code and protected/opaque structures, and follows
confirmed heading edits and Undo/Redo. Narrow windows use a closable overlay.
Choose **Aa** (or **Cmd+,**) for light/dark/follow-system appearance, body font,
size, width and line spacing. These display choices keep the existing editor and
Markdown unchanged, remain across document switches in this window, and reset on
restart. They do not change exported Markdown formatting. Navigation/settings
pause while input or an edit is unconfirmed.

**Cmd/Ctrl+F** or the search icon opens document find: literal text highlights,
current/total count, optional case sensitivity, Enter/Shift+Enter navigation and
Escape to return to the editor. It searches displayed text (including protected
blocks), crosses inline marks but not block boundaries, and does not change the
document, revision or history. Queries allow 256 UTF-16 units; for more than 1,000
matches the total remains exact but only the first 1,000 are highlighted/navigable.
Edits and session switches refresh matches; unsettled input pauses navigation.
Find does not replace text or search folders. The user has accepted the current
visual layout as the baseline for subsequent functional work.

**草稿** shows recovery cards, active/uncertain labels and reversible archive
actions. Empty results are distinguished from list errors. **详情** separates
current-document identity, local backup, the last confirmed new file and the latest
operation; later failure never replaces an earlier success receipt. Technical
details and limits are expandable. Save confirmation offers **返回编辑** or
**选择位置…**; Escape cancels through the existing handler. Draft-management
confirmation cannot be closed while its request is pending. These panels support
the same light/dark appearance and narrow-window layout as the editor.
Cancel or an open error keeps the current document.

Click **新建**, or open a file and choose **编辑副本**, to
write in an independent session. Confirmed writing receives a separate local draft
backup; the original file stays read-only.
Ordinary paragraphs support typing, Enter, Backspace and Cmd+Z / Cmd+Shift+Z;
source-line boundaries and unsupported structures remain protected. Literal `[`
and `]` can be typed when they remain ordinary text; typing that creates links or
reference syntax is still refused. Use the link panel for explicit link creation. Plain-text
paste accepts a single line in one supported text range, or up to 32 nonempty
paragraphs within one plain top-level paragraph (including an empty input slot).
The installed WIP also replaces or deletes a selection across up to
32 adjacent plain paragraphs and supports multiline paste over that selection.
It preserves exact untouched source bytes and one Undo/Redo operation per
replacement; typing, Enter and Backspace can continue afterward.
Within a single-source-line paragraph containing plain, bold, italic and inline-code text, selections
can also be replaced/deleted or pasted over with a single line. Replacement text
inherits the format at the start of the selected text (regardless of drag
direction); at a collapsed marked boundary, typing inherits the left-hand format.
Undo restores exact original bytes, including `**` versus `__` and `*` versus `_` delimiters.
With a collapsed caret, Enter also splits a plain/bold/italic/code paragraph, and Backspace
at the following paragraph's start joins it to a supported previous paragraph.
Existing source delimiter style and marks are retained; Undo restores exact bytes.
Cross-format IME replacement remains unsupported; finish composition first.
A clipboard newline or one blank separator becomes a paragraph boundary, using
the document's existing newline style. One paste is one Undo/Redo item. The 4096
UTF-16 limit applies before and after conversion; clipboard HTML is ignored.
Leading/trailing blank lines, consecutive empty paragraphs, selections crossing
headings/lists/protected blocks, formatted paragraph boundaries or source soft breaks, mixed or ambiguous
paragraph separators, multiline paste into formatted/soft-wrapped paragraphs, files and unsafe syntax
are refused as a whole. The native Edit menu includes Paste for system dialogs. Cross-paragraph IME
replacement and Enter over an existing cross-paragraph selection are not enabled;
finish input first, and collapse the selection before splitting a paragraph.

The compact format bar offers **正文 / 标题 1–6 / 无序列表 / 有序列表**, selection
**加粗** (Cmd+B), **斜体** (Cmd+I), **行内代码** (Cmd+E), **链接** (Cmd+K), and Undo/Redo. Commands patch a verified source range, then
reparse it; they do not normalize the whole file. Headings use a supported single
source line and may start empty. Bold/italic/code applies within one unmarked text leaf; removing it requires the
whole corresponding marked leaf. Combining marks, partial removal and
formatting a selection across leaves remain refused. The flat-list baseline supports up to 32 tight, one-line items containing
plain/bold/italic/code text. Select within one item or across adjacent items in that same
list to replace/delete or paste one line, including plain/bold/italic/code text. A cross-item
replacement merges the selected items, retaining their unselected text and marks.
Replacement inherits the selection's start format (plain when starting at an item's
end); Undo restores exact bytes, markers and original numbering. Deleting all
selected item text leaves one empty item; subsequent typing starts plain.
Multiline list paste, selections crossing different lists or other block types,
and edits whose existing delimiters cannot represent the formatting remain refused.
If the browser reports a different input range from the current selection, the
operation is cancelled with a message; it must not partially replace the selection.
Enter splits an item; Backspace at a nonfirst item's start joins
it to its predecessor. Backspace at the first item's start returns that item to
an ordinary paragraph and preserves remaining list items. Enter on the first or
last empty item exits; an empty paragraph can become a list through the format
selector when reparsing preserves surrounding structure. A middle empty item
cannot exit because a blank paragraph alone cannot separate same-kind Markdown
lists; this operation is explicitly refused. Converting a list with the selector
still applies to the whole flat list. The 0.52.0 candidate extends tasks/nesting as described above; loose lists and complex structures remain protected.
Typing Markdown markers is not a general formatting shortcut in this preview.

Normal IME composition shows only **输入中…**, without moving the writing area.
Formatting, switching and export stay disabled until input is confirmed. Invalid
input, backup failure and uncertain file creation still show actionable warnings;
no composition state is cleared by a timer or by hiding its status.

The installed app and `npm run dev` include the restricted **另存新文件…** flow.

Choose an existing ordinary local APFS folder within your home folder, including subfolders,
owned by you and not writable by others. Local Desktop/Documents are supported after checks; iCloud-managed ones remain refused.
Home itself, Library, Applications, hidden and known sync folders are unsupported. Downloads is supported
when it passes these checks: its non-inheriting everyone deny-delete protection
and opaque `com.apple.macl` directory metadata are accepted and fingerprinted;
other ACLs/xattrs remain refused. The dialog suggests Downloads only after checks
pass, then revalidates the selected destination before creation. The app does not
change folder permissions. Every ancestor is bound into the destination authorization. Native MACL and last-used
attributes on newly created files are retained and checked across writer/main
verification. The first native metadata probe precedes the strict stat/byte
baseline so initial macOS metadata setup is not mistaken for a later change;
unknown metadata or changes after that baseline still prevent a success receipt.
Only new files are created; existing targets are never overwritten. The UI
separates the last confirmed file's path/revision/hash from later failures and
reports uncertain outcomes without claiming that no file exists.

After a confirmed export, **打开已导出文件** opens that file read-only and
**在 Finder 中显示** requests its location. These shortcuts use the main-owned
last successful receipt, rechecking canonical path, file identity, byte length
and SHA-256. A moved, replaced, modified or unreadable file is refused; use the
ordinary Open dialog to inspect it manually. Later edits and Undo/Redo stay in the
independent draft, and a subsequent failed export does not erase the successful
receipt. Unconfirmed input pauses both actions. Shortcuts are session-local and
are not restored as file authority from a draft backup; the existing eight-session
limit still applies. Finder receives a display request, not a write permission.

**本地草稿** describes the independent editing session, not a saved Markdown file.
**已备份** confirms its local backup; **当前内容已导出** confirms the exported
revision only. Later edits show **后续修改尚未导出** and do not update the file. Open **草稿** at the bottom of the sidebar to list local recovery
snapshots after a restart. **恢复副本** opens an independent temporary session with the confirmed
Markdown bytes (including BOM/newlines), a fresh revision and empty Undo history.
The compact backup indicator is separate from file export; it never means that a
Markdown file has been saved or an older export updated. **详情** contains the
backup revision, export path/hash and destination limits. Normal writing keeps
these explanations out of the document; backup/input/export failures remain visible.
Switch open sessions using the sidebar or document-title menu. Drafts and details open in side
panels; Escape closes them. The existing export confirmation remains cancellable
before IPC, and cannot be dismissed while a create response is pending.

Drafts are stored locally, unencrypted, under
`~/Library/Application Support/Markdown Vault Document Drafts/` with private
permissions. Main-confirmed edits are coalesced over an 800 ms window; close also
attempts a flush. Sudden exit can lose the newest unbacked edits. Uncommitted IME
text, renderer recovery copies and prior Undo history are not persisted. A failed
or uncertain backup preserves memory and earlier records and reports the failure.
The list shows backup time, revision and a short ID to distinguish same-name drafts.
**归档** requires confirmation, moves an inactive verified draft out of the recovery
list and retains its content locally; **已归档 → 放回待恢复列表** reverses it.
Active drafts and groups with unreadable records cannot be organized. Cancel does
not change records. An uncertain result is shown separately and never auto-retried.

At most 32 non-archived drafts and 128 total snapshot records are supported,
normally retaining two verified generations per draft. Archiving frees a recovery
slot, not disk records. Archived, damaged and partial records still count toward
the record ceiling; reaching it stops writes and asks users to export new Markdown
files. There is no permanent-delete UI or automatic dismissal after export.
Close/Quit still asks before discarding. The document selector retains temporary
sessions while viewing real files. The eight-session limit is a development
constraint. Native macOS IME remains unaccepted; this is not daily-writing or
release sign-off.

The writing surface supports the bounded common-authoring, task/list, table and
local-image workflows described above. Other syntax is retained as protected
source; remote resources are not loaded. Only UTF-8 regular, non-linked `.md` files up to
2 MiB and 524,288 UTF-16 code units (excluding the initial BOM) are accepted. Finder opening uses this same read boundary; it is not release acceptance. See the
[scope and verification](docs/document-editing-interaction-phase1b3.md#document-first-open-v1-read-only-2026-10-26).

## Historical Vault reference

Everything below documents the old `main.js` / `dev:legacy` application and its
experiments. It is retained for historical development, is excluded from the
current document app, and does not promise these features in `Markdown.app`.
The [October recovery audit](docs/audits/2026-10-22-project-recovery-audit.md)
records the old pipeline's safety problems. Do not use its Save All / overwrite
path as a substitute for current Document save protection.

### Legacy features

- Choose any local folder as a Markdown vault.
- Load `.md` files recursively from the selected vault.
- Create, edit, save, and delete notes.
- Notes are kept as normal Markdown files on disk — no proprietary format.
- Focused editor workspace with a collapsible sidebar (open by default).
- Filter notes by Drafts, My Notes, and AI Imports. Codex/Claude session browsing and refresh belong to the independent AI Session Manager.
- Search by title, body, tags, source, file name, and relative path.
- Lightweight frontmatter parsing for `tags` and `source`.
- Seed a demo vault for local testing and demos.
- Watch the selected vault and refresh when Markdown files change on disk.
- Detect MCP-ingested notes by frontmatter `source` (claude/codex/chatgpt/gemini/ai). Older notes under `Inbox/AI Chats/YYYY/MM/` are still recognized by path for backward compatibility.
- Package a local macOS Electron build for testing.
- Adjustable editor text size with `Cmd/Ctrl + =`, `Cmd/Ctrl + -`, `Cmd/Ctrl + 0` (persists across launches).
- **Local AI: Summarize & Rewrite** — one-click **Summarize** the active note and one-click **Rewrite** a selection (or whole note) via a configurable local OpenAI-compatible endpoint (LM Studio, Ollama, `llama-server`). Results **stream into a side panel** below the editor token-by-token, stored **per note**: switching away does not lose them, and the × button both dismisses the panel and aborts the in-flight request. The original note body, dirty state, and on-disk file are never modified by either verb. See [Local AI: Summarize & Rewrite](#local-ai-summarize--rewrite) below.

### Session data after the split

Use the standalone **AI Session Manager** for Codex/Claude transcripts, grouping, favorites, transcript search, and refresh. Select your existing `Inbox/AI Chats` library there; no transcript move, rewrite, or deletion is needed.

The editor skips `Inbox/AI Chats/codex/` and `Inbox/AI Chats/claude-code/` before reading Markdown bodies, including when an agent directory or its descendant is selected as the vault. Save, rename, delete, demo seeding, and image-write entry points reject these reserved locations. Matching is case-insensitive and checks symlink aliases. Session-file watcher events do not navigate the editor.

**AI Imports remain editable:** MCP-created notes, legacy `Inbox/AI Chats/YYYY/MM/` notes, and ordinary notes tagged with an AI `source` are retained. Local AI Summarize/Rewrite are unchanged. Existing local preferences and transcript files are not migrated or erased. This boundary identifies the reserved directory layout, not arbitrary transcripts copied or renamed elsewhere.

### Data-safety guarantees

- Track unsaved state for drafts and vault notes with a visible dirty badge.
- Preserve draft content across note and vault switches — no silent data loss.
- Require vault selection before saving a pre-vault draft (OS folder picker opens automatically).
- Block app quit when unsaved work exists — close-guard dialog with Cancel, Discard & Quit, or Save All & Quit.
- Save All & Quit saves every dirty note and draft in one action before quitting.
- Block duplicate filenames and refuse to overwrite existing vault files on save.

## Editor modes

Each note has two display modes selected by the `Write` and `Preview` tab buttons above the editor (mouse-toggle only — no keyboard shortcut for the toggle).

- **Write mode** — edit Markdown source in the CodeMirror engines, or use the opt-in Tiptap rich surface with its Source/Rich toggle.
- **Preview mode** — Toast UI Editor renders the Markdown read-only.

Five Write engines exist in the codebase. The engine is resolved on load by `apps/desktop/lib/write-engine.js` in the following priority order:

1. URL query parameter: `?writeEngine=<name>`
2. `localStorage` key: `markdownVault.writeEngine = "<name>"`
3. Default: `hybrid-cm6`  (Stage 17; previously `cm6`)

| Engine | Status | Description |
|---|---|---|
| `tiptap` | **Active WYSIWYG direction; opt-in** | ProseMirror/Tiptap rich editing backed by a `remark`/`unified` Markdown bridge. Supports headings, marks, lists and task lists, tables, fenced code, KaTeX math, Mermaid, safe images, preserved frontmatter/raw HTML/references/footnotes, a Source/Rich toggle, and vault-backed image paste/drop. Opt in with `localStorage.setItem('markdownVault.writeEngine', 'tiptap')`. |
| `hybrid-cm6` | **Default** | CodeMirror 6 with an additional live-Markdown decoration layer that styles common syntax in place (see list below). Promoted from experimental to default in Stage 17. Uses `Decoration.mark` only — no widgets, no `Decoration.replace`. |
| `hybrid-cm6-lp` | Experimental (Stages A + B + C + D + E + F + G.1 + G.2, opt-in) | Live-preview variant of `hybrid-cm6`. Reuses the hybrid walker via its public export PLUS adds inline-marker and block-marker plugins. **Stage A covered emphasis** (`*`, `_`, `**`, `__`); **Stage B added inline-code backticks, strikethrough `~~`, inline-link brackets/parens/URL/title, and inline-image markup**. **Stage C is the first stage where lp visibly diverges from `hybrid-cm6`**: inline images (`![alt](url)`) render as actual `<img>` elements inline (off-active-line) via `WidgetType` widgets. URL allowlist (`https:`, `data:image/*`, vault-relative paths) gates what renders; vault-relative paths resolve via a new IPC route (`window.vaultApi.resolveImagePath`) with symlink-safe filesystem reads using no-follow reads and realpath containment. Disallowed URLs (`http:`, `javascript:`, etc.) show a styled-alt placeholder. **Stage D extends the Decoration.replace + atomic-range pattern from inline markers to three block-level marker categories**: ATX heading prefix (`#` … `######`), list bullets (`-`, `*`, `+`, `1.`, `1)`), and blockquote `>`. Setext underlines + HorizontalRule + TaskMarker + fenced-code fences are explicitly preserved unchanged. The Stage D user-visible payoff is thin (cursor atomicity + DOM-level absence of block markers); the architectural payoff is that subsequent widget stages (E, F, G) can rely on block-marker scope decisions being settled. **Stage E renders GFM tables as actual HTML `<table>` grids off-active** via a new multi-line block `TableWidget`: walks the Lezer Table node, parses GFM alignment from the delimiter row (`:---`/`:---:`/`---:`), builds `<table>/<thead>/<tbody>` via `document.createElement` + `textContent` (XSS-safe; HTML special chars in cells render as escaped text). Cell text rendered as plain text (inline markdown inside cells NOT rendered — deferred). Table-level active resolution: caret on ANY line of the table → widget disappears, walker source returns. **Stage F renders LaTeX math via KaTeX**: inline `$x$` and display `$$x$$` off-active render as real TeX. Detection is regex-based with a Pandoc-style whitespace rule + `\$` escape handling; caller-side Lezer-aware filtering skips matches inside InlineCode / FencedCode / frontmatter. KaTeX vendored to `lib/vendor/katex/`; called with `throwOnError: false` + `trust: false`; invalid TeX produces a styled error placeholder. Stage F is the FIRST lp stage to add a new npm dependency (`katex@^0.16`). **Stage G.1 adds fenced-code syntax highlighting via highlight.js** — a `CodeBlockWidget` walks the Lezer `FencedCode` node, reads the language info, and calls `hljs.highlight` for known languages; unknown / missing-language code blocks fall back to plain text. highlight.js vendored to `lib/vendor/highlight/` (~157 KB minified + atom-one-light theme). **Stage G.2 adds Mermaid diagram rendering** for ` ```mermaid ` fenced blocks — first lp stage with async-render widget. The widget returns a sync placeholder; `mermaid.render()` (Promise) patches in the SVG on resolve. Async safety via a `destroyed` flag (mirrors Stage C's image-widget IPC pattern). Mermaid vendored to `lib/vendor/mermaid/` (~3 MB; `securityLevel: 'strict'`). Lang dispatch in `cm6-lp-block.js`'s FencedCode branch: `mermaid` → MermaidWidget; everything else → Stage G.1 CodeBlockWidget. On-active-line behavior matches `hybrid-cm6` exactly for ALL Stages A–G.2. Opt in via `?writeEngine=hybrid-cm6-lp` or `localStorage.setItem('markdownVault.writeEngine', 'hybrid-cm6-lp')`. Stage H (promote lp to default) remains upcoming. |
| `cm6` | Fallback | CodeMirror 6 single-document adapter — Markdown editing with syntax highlighting, real undo/redo, real selection, Chinese IME support. Reachable via `?writeEngine=cm6` or by setting the `markdownVault.writeEngine` localStorage key to `cm6`. |
| `hybrid` | Legacy fallback | Stage 2 HybridWriteView (per-block textarea swap) plus Toast UI Preview. Retained as a fallback; removal is deferred. |

The long `hybrid-cm6-lp` description above is retained as stage history. That
engine's planned Stage H promotion was abandoned; ProseMirror/Tiptap is the
current WYSIWYG direction.

In Tiptap, loading or switching notes starts fresh undo/redo history; undo cannot
restore a previous note or reverse the incoming load. Same-note rich edits and
Source/Rich body edits remain undoable. Undo history is not restored on revisit.

Untouched Tiptap documents retain their loaded Markdown spelling, including
after rich edit/undo; merely switching notes or invoking Save All does not
normalize an unchanged table. Deliberate Source spelling is retained until a
rich edit changes the document. Rich edits still serialize through `remark`.
Source-only formatting changes are not represented in rich undo history.

**Metadata save safety:** saves/renames are blocked for existing notes with
custom or complex YAML frontmatter that the app cannot safely retain. Simple
single-line `source` and bracket-list `tags` string values remain supported;
comments, nested/multiline fields, duplicate keys, quoted values with boundary
whitespace and BOM/CRLF headers are among the refused forms. The file and unsaved
edits remain intact; Save All reports failure and does not complete quitting.
Keep blocked edits and use a YAML-capable editor to preserve that metadata. See [A6 details and current QA
status](docs/a6-dirty-state-investigation.md).

Tiptap uses Pandoc-style single-dollar math boundaries: no whitespace just inside
the delimiters, and no digit (`0–9`) immediately after the closing dollar. `$x$`
and `$5$` are formulas; `$ x $` and `$x$2` are literal text. Write `\$` for an
explicit literal dollar. Rich-edit serialization normalizes literal dollars to
`\$`; display math and existing multi-dollar inline math remain supported. This is a Tiptap rule,
not a change to the fallback engines or a claim of full Pandoc compatibility.

### Live styling in `hybrid-cm6` (default) and `hybrid-cm6-lp` (Stages A + B + C + D + E + F + G.1 + G.2 opt-in)

The hybrid-cm6 engine emits CSS-class decorations over the existing source text — purely visual, never modifying the document or generating HTML. Raw Markdown is the source of truth; `getText()` returns the raw Markdown source text without rendered HTML or decoration artifacts. (CodeMirror normalizes line endings internally, so source-text round-trip is at the LF / character level, not the exact on-disk byte level for CRLF files.)

**Stage A + B `hybrid-cm6-lp` differs from `hybrid-cm6` for five inline marker categories**: emphasis (`*`, `_`, `**`, `__`), inline code (`` ` ``), strikethrough (`~~`), inline link brackets/parens/URL/title, and inline image markup. The lp engine reuses the hybrid walker via its public export (no duplication) and adds an inline-marker plugin that emits `Decoration.replace` off the active line (the marker characters are removed from the visible DOM) and registers the replaced ranges with `EditorView.atomicRanges` so arrow-key cursor motion steps over each hidden marker as one unit. Link TEXT and image ALT ranges stay visible (link text underlined per existing `cm-md-link-text`; alt text italic+muted per existing `cm-md-image-alt`). On the active line the lp plugin emits nothing — the hybrid walker's existing `Decoration.mark` + existing CSS reveal the marker dimmed exactly as in `hybrid-cm6`. Off-active-line visual appearance is essentially identical between the two engines (both hide the markers); the differences are cursor mechanics (atomic-range stepping over hidden markers) and the architectural foundation for stages C–H. Reference-style links/images, autolinks, and link-reference definitions are intentionally NOT replaced (deferred to a later stage or post-migration polish).

Since Stage 26 the "hide off the active line / reveal on the active line" reveal mechanism that appears in the bullets below actually follows the FULL selection: every line touched by the current selection or any cursor reveals its syntax markers. Single-caret behavior is unchanged. Multi-line drag selections and multi-cursor selections (Alt-click) now show raw markers on every touched line, not just the line containing the primary caret. Currently styled:

- ATX headings `#` … `######`
- Setext headings (`Heading\n=====` and `Heading\n-----`) — reuse the same H1 / H2 typography as ATX; the `===` / `---` underline hides off the active line and reveals dimmed when the caret enters the underline line. **As of Stage 29, touching the title line ALSO reveals the underline** (the construct-reveal plugin propagates a Setext-scoped class to both lines so caret on either reveals the marker). Scoped to Setext only — ATX `#` markers inside a blockquote whose other lines are construct-active do NOT silently reveal
- Bold `**…**` and italic `*…*` / `_…_`
- Inline code `` `…` ``
- Inline links `[text](url)` — underlined link-text. **Clickable in hybrid-cm6**: on macOS, `Cmd-click` on the link text opens the URL via the system default handler (browser for `https:`, mail client for `mailto:`). Place the caret inside the link and press `Cmd-Shift-O` to open from the keyboard. URLs are validated against an allowlist — only `https:` and `mailto:` schemes (case-insensitive) open; everything else, including degenerate forms like `https:` or `mailto:` with no rest, silently no-ops. `Cmd-Shift-click`, `Cmd-Alt-click`, `Cmd-Ctrl-click`, and plain (no-modifier) click do not open and remain normal caret moves. IME composition is never interrupted. Links inside YAML frontmatter do not open. Cross-platform Ctrl-click is deferred. No `<a>` is rendered and no `href` attribute is emitted — the click is routed via preload + main IPC to `shell.openExternal`
- Reference-style links `[text][ref]` and collapsed `[text][]` — same underline as inline links; shortcut references `[shortcut]` are intentionally not styled
- Link definitions `[ref]: url "title"` — entire definition line dimmed
- Inline images `![alt](url)` (with optional title) — alt text rendered italic and muted; `![`, `]`, `(`, URL, optional title, `)` hide off the active line. **No `<img>`, no fetch, no clicks.** Reference-style images `![alt][1]` are intentionally not styled
- List markers (`-`, `*`, `+`, `1.`, `1)`) and blockquote markers (`>`) — dimmed when revealed; hidden off-active and revealed dimmed via three layered mechanisms: (Stage 27) `.cm-activeLine` and Stage 26's `.cm-md-active-range` reveal the marker when the caret or any selection range touches the marker line itself; (Stage 28) for multi-line blockquotes, touching any line of the blockquote also reveals the first-line `>` via the construct-active reveal path; (Stage 30) for multi-line list items, touching any line of the same `ListItem` — including a continuation paragraph — also reveals the first-line list marker via the scoped `.cm-md-list-item-active` reveal path (sibling list items remain hidden when not active). Task-list `[ ]` markers stay dimmed-but-always-visible so the Stage 23 primary-click toggle target is preserved
- Fenced code fences (```` ``` ```` / `~~~`) and the optional language info string — dimmed when revealed; **as of Stage 28, hidden off the active construct and revealed when the active line / selection range touches any line inside the fenced code block**. Multi-line blockquotes also gain construct-level reveal in Stage 28 (touching one line reveals `>` on every line of the quote)
- Horizontal rules (`---`, `***`, `___`) — dimmed and letter-spaced
- GFM tables `| col | col |\n|-----|-----|` — **as of Stage 31 + 32, the cell-separator `|` characters and the `|---|---|` delimiter row hide off the active table and reveal dimmed when the caret/selection touches any line of the table** via a scoped `.cm-md-table-active` reveal path (mirrors the Stage 30 list-item pattern; Stage 28's `.cm-md-construct-active` quote/fence reveal selectors do NOT leak to table interiors and vice versa). **As of Stage 33, tables also get always-visible visual structure**: a light bottom border under the header row and faint alternating background striping on body rows, both rendered whether the caret is in the table or not — so off-active tables still read as tables instead of text-with-spaces. Table header text renders bold via CodeMirror's `defaultHighlightStyle` mapping `tags.heading` on `TableHeader`; **as of Stage 34, the per-character underline that the same mapping adds is suppressed** by a scoped `.cm-md-table-header-line *` rule using `text-decoration-line` so the existing inline-link / autolink / strikethrough semantic decorations inside header cells are preserved. Stage 33's `border-bottom` under the header line is now the single horizontal separator
- Strikethrough `~~…~~` — line-through; `~~` delimiters hide off the active line and reveal dimmed when the caret enters
- Task list markers `[ ]`, `[x]`, `[X]` — dimmed and **interactive in hybrid-cm6**: primary-click on the marker toggles `[ ]` ↔ `[x]` (and `[X]` → `[ ]`). On macOS you can also place the caret on a task line and press **`Cmd-Shift-X`** to toggle (CodeMirror registers this as `Mod-Shift-x`). Toggles are real Markdown edits — they flow through `onChange`, update the dirty badge, participate in undo/redo, and round-trip character-identically after LF normalization on save/reload. Modifier-held clicks and non-primary buttons are no-ops; IME composition is never interrupted
- Autolinks `<https://…>`, `<mailto:…>`, raw `<email@host>`, and bare URLs (`https://example.com`) — underlined; angle brackets share the same hide/reveal mechanism. **Scheme-bearing autolinks `<https://…>` and `<mailto:…>` are clickable on Cmd-click** (same rules as inline links). Raw email autolinks `<foo@example.com>` and bare URLs (not wrapped in `<>` or `[]()`) remain non-clickable — raw email autolinks no-op because the parser exposes the address without a `mailto:` scheme and the URL allowlist rejects schemeless URLs; conversion to `mailto:` is deferred. Reference-style links `[text][ref]` and collapsed `[text][]` are also non-clickable (deferred).
- YAML frontmatter — when a note begins with a strict `---` fence and has a later strict `---` closing fence, the entire region (both fences and the metadata lines between them) renders as plain text. The leading `---` is not styled as a horizontal rule and the closing `---` is not styled as a Setext heading. Detection requires exact `---` on each fence (no `+++`, no trailing whitespace). See Stage 14.9 for details.

Image URLs and link-reference definition URLs are intentionally not autolink-styled.

## Local-first storage

Notes are plain Markdown files in a folder of your choosing. The app does not include cloud sync, accounts, hosted storage, or a remote backend. Drafts created before a vault is selected live in memory until the OS folder picker is used at first save.

Before publishing or sharing the repository, do not commit personal vault content, `.env` files, local MCP config, generated builds, dependency folders, logs, or private assistant/editor settings.

## Tech Stack

- Electron (desktop shell)
- Node.js (renderer + main + tests)
- CodeMirror 6 (`@codemirror/*`) — Write-mode runtime for the default `hybrid-cm6` engine and the `cm6` fallback engine
- `@lezer/markdown` — Markdown parser. The `lib/cm6-entry.js` configuration uses `markdownLanguage` as the base, which already enables the GFM extension set (tables, task lists, strikethrough, autolinks) plus subscript / superscript / emoji transitively. Only a subset of the parser's nodes is currently styled by the hybrid-cm6 walker — see "Live styling in `hybrid-cm6`" above
- Toast UI Editor (`@toast-ui/editor`) — Preview renderer; also powers the `hybrid` legacy Write engine
- `marked` — Markdown utility
- Node.js built-in test runner
- `mcp-note-ingest` MCP plugin — installed via the `workflow-and-MCP-and-plugins` Claude Code marketplace (see `docs/mcp-ingest-setup.md`)

## Getting Started

### Requirements

- macOS 12 Monterey or newer
- Node.js 22.12 or newer (Node.js 24 recommended)
- npm

### Install dependencies

```bash
cd apps/desktop
npm install
```

### Run the desktop app

```bash
cd apps/desktop
npm run dev
```

Opens the Electron window in development mode. The default Write engine remains `hybrid-cm6`. To exercise the active WYSIWYG work, run `localStorage.setItem('markdownVault.writeEngine', 'tiptap')` in DevTools and reload. The same resolver also accepts `cm6`, `hybrid`, and the superseded `hybrid-cm6-lp` engine through localStorage or `?writeEngine=<name>`.

### Build a local macOS app

```bash
cd apps/desktop
npm run pack            # unsigned dir build into apps/desktop/dist/
npm run dist:mac        # unsigned zip build for macOS
```

Build artifacts are written to `apps/desktop/dist/` and should not be committed.

### Building renderer bundles

The renderer loads pre-built IIFE bundles checked into `apps/desktop/lib/`. Rebuild them after changing the corresponding entry file or dependency:

```bash
cd apps/desktop
npm run build:cm6       # rebuilds lib/cm6-bundle.js (used by cm6 + hybrid-cm6 + hybrid-cm6-lp engines)
npm run build:editor    # rebuilds lib/toastui-bundle.js (used by Preview + hybrid engine)
npm run build:tiptap    # rebuilds lib/tiptap-bundle.js (used by the tiptap engine)
npm run build:mermaid   # rebuilds lib/vendor/mermaid/mermaid.min.js
npm run verify:generated # rebuilds every committed renderer/vendor output and verifies a clean tree
```

If you change a bundle entry or its dependency and skip the rebuild, the running app will silently keep using the old bundle.

## Testing

The main suite uses the Node.js built-in test runner. A separate, opt-in Playwright
Electron smoke test checks Tiptap save/reopen persistence.

```bash
cd apps/desktop
npm test                       # full suite (test/, test/spike-cm6/, test/cm6-write-view/)
npm run test:ci                # full suite plus the CI baseline/count guard
npm run test:e2e               # separate Electron save/reopen smoke test (requires GUI)
npm run test:write-engine      # focused: Write engine resolver
npm run test:cm6-write-view    # focused: CM6 write adapters, hybrid-cm6 decorations, and bundle-entry source contracts
npm run audit:prod             # require zero production dependency vulnerabilities
npm run audit:full             # reject high/critical findings in the complete dependency tree
node --test test/editor-session-boundary.test.js  # editor/session data boundary
```

See [Electron E2E testing](docs/electron-e2e.md) for runtime setup, isolation,
diagnostic artifacts, and coverage limits. This smoke test does not replace real
Chinese IME acceptance testing.

MCP smoke test (from the standalone plugin repository):

```bash
cd ~/Liyunhui/Codes/claude-plugins/mcp-note-ingest
npm run smoke
```

## Usage basics

1. Launch the app with `npm run dev`.
2. Choose a local folder as a vault when prompted (or seed a demo vault from the empty state).
3. Press `Cmd+N` for a new note, type in Write mode, press `Cmd+S` to save.
4. Switch to Preview by clicking the `Preview` tab; switch back with `Write`.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + N` | Create new note |
| `Cmd/Ctrl + S` | Save current note |
| `Cmd/Ctrl + =` (or `+`) | Increase editor text size |
| `Cmd/Ctrl + -` | Decrease editor text size |
| `Cmd/Ctrl + 0` | Reset editor text size to default (18px) |
| `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` | Undo / redo in CM6 Write mode |
| `Cmd + Shift + O` | Open the external link at the caret (macOS, hybrid-cm6 Write mode; CodeMirror binding `Mod-Shift-o`) |
| `Cmd/Ctrl + Shift + D` | Translate the selected word in context via the local Dictionary macOS app (see [Dictionary lookup](#dictionary-lookup)) |
| `Arrow Up` / `Arrow Down` | Navigate note list (when focus is outside text inputs) |

The Write/Preview toggle is mouse-only — there is currently no global keyboard shortcut for it.

## Local AI: Summarize & Rewrite

Two one-click AI actions against a local OpenAI-compatible model — **Summarize** the active note, or **Rewrite** a selected passage (or the whole note) for clarity and concision. The app sends the active note's Markdown body (or your selection, for Rewrite) to the configured endpoint, **streams the response back token-by-token**, and shows it in the same side panel below the editor. By default the endpoint must be a **loopback** address (`localhost` / `127.x` / `::1`), so nothing leaves your machine; pointing at a remote server requires an explicit opt-in (see [Remote endpoints & privacy](#remote-endpoints--privacy) below).

- The original note's body, file on disk, and dirty state are **never** modified by either verb. Copy/paste the result manually if you want to use it.
- Each note has its own result state, shared between Summarize and Rewrite (most recent action wins). Switching to another note mid-flight does not show a stale result; returning to a note while it is still streaming restores the accumulated text so far.
- The × button on the panel **aborts the in-flight request** (cross-process cancel — the model server stops getting new HTTP reads) AND dismisses the current note's result. Buttons re-enable immediately so you can start a fresh request without waiting.
- If the local server is unreachable, the panel shows a friendly inline error and the app stays interactive.

### Rewrite — selection vs. whole note

When you click **Rewrite**:

- If you have a non-empty selection in the editor (Write mode, CM6 engine), Rewrite operates on **just that selection**.
- Otherwise (no selection, or you're in Preview/Read mode, or the active note is an AI Session / read-only note), Rewrite falls back to the **whole note body**.

This protects against rewriting text you cannot see: a stale CM6 selection from a previous note never leaks into the request.

### Setup

1. Start a local OpenAI-compatible server. Examples:
   - **LM Studio** → Server tab → Start. Default endpoint: `http://localhost:1234`. Load any text model.
   - **Ollama** → `ollama serve` (the OpenAI-compatible path lives under `:11434/v1`). Pull a model first, e.g. `ollama pull llama3.1`.
   - **llama.cpp `llama-server`** or any other OpenAI-compatible local server.
2. Launch the editor: `cd apps/desktop && npm run dev`.
3. Open a Markdown note and click **Summarize** or **Rewrite** in the toolbar.

### Configuration

AI settings apply to **both** Summarize and Rewrite. The endpoint URL, model, and remote-allow toggle can be edited in the in-app **AI Settings** panel (see below); the remaining tuning knobs are environment variables. Precedence per setting is **environment variable > saved panel value > built-in default** — an env var, when present, always wins, and the matching panel field is shown locked.

| Variable | Default | Notes |
|---|---|---|
| `MARKDOWN_AI_PROVIDER` | `openai-compatible` | Adapter selector. `openai-compatible` (default — LM Studio, Ollama's `/v1`, `llama-server`, any OpenAI-compatible server) or `ollama` (Ollama's **native** API — set `MARKDOWN_AI_BASE_URL` to the `:11434` root, **no `/v1`**). Both adapters support Summarize, Rewrite, streaming, and the Test-connection model list. |
| `MARKDOWN_AI_BASE_URL` | `http://localhost:1234/v1` | Must be `http://` or `https://`. A trailing slash is normalized away. Must be **loopback** unless `MARKDOWN_AI_ALLOW_REMOTE=true` (see below). |
| `MARKDOWN_AI_ALLOW_REMOTE` | _unset_ (treated as `false`) | Gate for non-loopback endpoints. By default a base URL that isn't `localhost` / `127.x` / `::1` is rejected before any network call (reason `remote-blocked`). Set to `true` (case-insensitive) to permit a remote/LAN endpoint; a **Remote AI** badge then appears in the toolbar. |
| `MARKDOWN_AI_MODEL` | `local-model` | LM Studio routes to the currently-loaded model regardless of name. Ollama requires the real model id (e.g. `llama3.1`). |
| `MARKDOWN_AI_TEMPERATURE` | `0.2` | |
| `MARKDOWN_AI_MAX_TOKENS` | `1024` | Bump higher for reasoning models (DeepSeek-R1, Gemma-thinking, etc.) whose `reasoning_content` eats the token budget before any visible content appears. |
| `MARKDOWN_AI_TIMEOUT_MS` | `60000` | IPC-handler timeout. The handler resolves with reason `'timeout'` even if the model adapter hangs. |
| `MARKDOWN_AI_MAX_INPUT_CHARS` | `48000` | Notes larger than this are rejected without a network call. |
| `MARKDOWN_AI_STREAMING` | _unset_ (treated as on) | Streaming is on by default. Set to `false` (case-insensitive) to opt out: the panel will show `Summarizing…` / `Rewriting…` for the full duration, then the final reply in one shot. Use this if a specific local server doesn't speak SSE cleanly. Stall timeout still applies via `MARKDOWN_AI_TIMEOUT_MS` — in streaming mode the timer resets on every token (per-chunk stall), not over the whole response. |

Example: point at Ollama via its OpenAI-compatible endpoint:

```bash
cd apps/desktop
MARKDOWN_AI_BASE_URL=http://localhost:11434/v1 \
MARKDOWN_AI_MODEL=llama3.1 \
  npm run dev
```

Example: use Ollama's **native** adapter instead (note the `:11434` root with no `/v1`):

```bash
cd apps/desktop
MARKDOWN_AI_PROVIDER=ollama \
MARKDOWN_AI_BASE_URL=http://localhost:11434 \
MARKDOWN_AI_MODEL=llama3.1 \
  npm run dev
```

### Settings panel

Click **AI Settings** in the toolbar to edit the most common settings without a terminal:

- **Server URL** — the OpenAI-compatible endpoint (`baseUrl`).
- **Model** — the model id.
- **Allow a remote (off-machine) server** — the privacy opt-in (see below).

**Test connection** pings the endpoint's `/models` (respecting the loopback/allow-remote gate) and reports *"Connected — N models available"* or a friendly error. On success the **Model** field becomes a pick-from-list (a dropdown populated from the server's models; free-typing still works). The test uses the values currently in the panel, so you can verify a URL before saving.

Saved values persist to `ai-settings.json` in Electron's app-data directory and survive restarts. Changes take effect **immediately** — no relaunch — including the **Remote AI** badge, which updates live when you toggle allow-remote or change the URL. If a setting is controlled by an environment variable, its field is shown **disabled** with a hint, because the env var takes precedence. The tuning knobs (temperature, max tokens, timeout, max input chars, streaming, provider) remain environment-only for now.

### Remote endpoints & privacy

By default the AI verbs only talk to a **loopback** endpoint — `localhost`, any `127.x.x.x`, or `::1`. This keeps note content on your machine. A non-loopback `MARKDOWN_AI_BASE_URL` (a LAN IP, a hostname, a public server) is **rejected before any network call** with the typed reason `remote-blocked`; the panel shows _"Remote AI server blocked. Set MARKDOWN_AI_ALLOW_REMOTE=true to allow."_

To send notes to a non-loopback server, set `MARKDOWN_AI_ALLOW_REMOTE=true`. When a remote endpoint is both configured **and** allowed, a **Remote AI** badge appears next to the AI buttons in the toolbar (its tooltip shows the destination hostname) so you always know note content is leaving your machine. The badge stays hidden for loopback endpoints and whenever the allow flag is off.

### Constraints (this stage)

- Streaming is over plain text — the rendered panel is `textContent` only, so any Markdown the model emits is shown verbatim rather than re-rendered as headings / bold / etc.
- No retrieval-augmented generation (RAG); only the active note's body (or the selected passage for Rewrite) is sent.
- No auto-editing of the original note for either verb. The panel is read-only; copy/paste manually if you want to use the result.
- The × button aborts the in-flight HTTP request from this app's side, but whether the local model server actually stops generating depends on the server. LM Studio's `llama.cpp` backend, for example, continues to finish a scheduled response even after the client disconnects — the app re-enables the buttons immediately either way, but you may notice the model server keeps working in the background.
- Most-recent-action wins on the same note: running Summarize after Rewrite (or vice versa) overwrites the previous result. There is no separate history per verb in this stage.
- Selection-aware Summarize is not implemented; Summarize always sends the whole note.
- The in-app settings panel covers the endpoint URL, model, and remote-allow toggle only; the other tuning knobs (temperature, max tokens, timeout, max input chars, streaming, provider) remain environment-variable only.
- No retries, no provider failover, no multi-provider concurrency.
- Failure modes return one of a fixed set of typed reasons (`empty-input`, `input-too-large`, `server-unreachable`, `timeout`, `http-error`, `invalid-response`, `provider-error`, `unknown`) with canned, sanitized user-facing messages. Provider-supplied error text is **not** echoed to the UI.

## Dictionary lookup

`Cmd/Ctrl + Shift + D` translates the currently-selected word using the local
[Dictionary macOS app](https://github.com/) (a separate menu-bar app). The app
captures your selection plus the surrounding paragraph so the translation is
context-aware (e.g. "bank" as a riverbank vs. a financial institution), then
shows its own popup with the result.

This is optional and requires the Dictionary app to be installed and running:

- The Dictionary app runs a loopback HTTP server on `127.0.0.1:49152` and writes
  a bearer token to `~/Library/Application Support/DictionaryApp/token` (mode
  `0600`). This app reads that token in the **main process** and POSTs the
  selection there — never over the network, never from the renderer (a renderer
  fetch to `127.0.0.1` would be CORS-blocked).
- If the Dictionary app is not running, or the token is missing, pressing
  `Cmd/Ctrl + Shift + D` shows a short status message in the bottom-right pill
  instead of translating. No note content is ever modified.

If you do not use the Dictionary app, simply ignore this shortcut — it has no
effect on normal editing.

## MCP Note Ingestion

The `mcp-note-ingest` MCP server is installed through the `workflow-and-MCP-and-plugins` marketplace. Its source was extracted from this app repository and now lives in the standalone `~/Liyunhui/Codes/claude-plugins/mcp-note-ingest/` repository.

The main tool is:

```text
ingest_chat_markdown
```

It writes Markdown files directly into a fixed local Inbox folder, by default:

```text
/Users/liyunhui/Liyunhui/Inbox/
```

The target can be overridden at server-launch time via the `MCP_INGEST_TARGET_DIR` environment variable. See `docs/mcp-ingest-setup.md` for setup details.

## Developer notes

- **CM6 spike artifacts** — `apps/desktop/spike/` and `apps/desktop/lib/spike-cm6-*` remain in the tree for spike reproducibility (`npm run spike:cm6`, `npm run test:spike-cm6`). They are not consumed by the production app at runtime. Cleanup is deferred.
- **Product boundary (v0.18.0)** — session-viewer modules, session refresh IPC, importer CLIs, and their session-only tests are no longer part of this editor. The shared frontmatter scalar decoder remains under `lib/frontmatter-scalar.js`. See [editor split QA and handoff](docs/editor-session-split.md).

## Project status & maturity

**What works**

- Local vault workflow: choose any folder, load `.md` files recursively, create / edit / save / delete notes.
- Save / load round-trip preserves raw Markdown source.
- Dirty-state tracking and close-guard dialog (Cancel / Discard & Quit / Save All & Quit) protect unsaved work.
- Live-styled Write mode under the default `hybrid-cm6` engine; Preview mode via Toast UI Editor.
- All five engines are selectable via URL query or `markdownVault.writeEngine`; `tiptap` is the active opt-in WYSIWYG direction, while `hybrid-cm6` remains the default during stabilization.
- Tiptap GFM tables preserve left, center, right, and unaligned column semantics through Rich editing and remark-normalized Markdown saves (`0.17.4`).
- MCP ingest writes AI-chat notes into a fixed local Inbox folder (default `/Users/liyunhui/Liyunhui/Inbox/`; overridable via `MCP_INGEST_TARGET_DIR`).
- Stage 18 stabilization QA passed — clean Branch A closure (see `docs/test-manual.md` Stage 18 section).
- The full automated suite runs with `npm test`; the heavier performance checks are opt-in through `npm run test:perf`.

**What's still evolving**

- Screenshots not yet captured (planned paths listed above under "Screenshots").
- Packaging is currently macOS-only.
- No code-signing guidance yet.
- Broader release polish (issue-reporting pointer, additional `docs/assets/` artifacts).

**What's not supported**

- Tiptap is not yet the default and has not completed release-level manual QA for IME, long documents, navigation, and every Markdown edge case.
- Tiptap's Source view is a plain textarea without syntax highlighting or cursor/scroll restoration across the Source/Rich toggle.
- Some preserved Markdown constructs, including raw HTML, reference definitions, and footnotes, are passthrough content rather than fully rich-editable nodes.
- No cross-platform packaging.
- No sync, no accounts, no hosted backend.

**How to run tests** — see the [Testing](#testing) section.

## Known limitations

- The packaged build workflow is currently macOS-focused.
- No built-in sync across devices.
- No account system or hosted backend.
- No plugin system, graph view, or backlinks UI.
- The default `hybrid-cm6` engine is a source editor with visual decorations; richer tables, math, diagrams, image rendering, and task controls are available in the opt-in `tiptap` engine.
- Tiptap normalizes Markdown through `remark`; use Source mode when exact source-level control matters.
- The `hybrid-cm6` engine became the default in Stage 17. The plain `cm6` adapter and the legacy `hybrid` engine remain available as fallbacks via `?writeEngine=cm6` / `?writeEngine=hybrid` or by setting the `markdownVault.writeEngine` localStorage key to the matching value. Users who had the `markdownVault.writeEngine` localStorage key set to `"cm6"` before Stage 17 continue to get `cm6`.
- The app is intended for local testing and early feedback, not production distribution.
- **Local AI: Summarize & Rewrite** is intentionally narrow this stage: streaming + abort ship, but the rendered output is plain `textContent` (no Markdown re-rendering), there is no RAG, no auto-edit of the original note, an in-app settings panel for the endpoint/model/allow-remote (other tuning knobs remain env-var only), no retries, no provider failover, no per-verb history per note, and whether the upstream model server actually stops on × depends on the server. See the [Local AI: Summarize & Rewrite](#local-ai-summarize--rewrite) section for the full constraint list.

### Deferred items

- Hybrid editor removal (`hybrid-cm6` is the default; both `cm6` and legacy `hybrid` remain as fallbacks).
- CodeMirror 6 spike code cleanup.
- Claude Design prototype.
- Auto-save.
- Multi-window support.

## Roadmap / future work

Not committed to dates. Items listed roughly in priority order:

- **Stabilize the Tiptap engine before changing the default** — expand Markdown corpus/round-trip coverage, complete real Electron QA for save/switch/undo/redo/Chinese IME/long documents, and add repeatable build/packaging checks. Do not add another rendering architecture during this phase.
- The historical `hybrid-cm6-lp` Stage H promotion is cancelled; its stage narrative below is retained for provenance only.
- ~~Hybrid-cm6 default-readiness sequence~~ — completed in Stage 17. `hybrid-cm6` is now the default Write engine; `cm6` and legacy `hybrid` remain selectable fallbacks.
- **Obsidian-style Live Preview migration** — Stages A, B, C, D, E, F, G.1, and G.2 done. Stages A + B introduced `Decoration.replace`-based hiding + atomic-range cursor motion for emphasis, inline code, strikethrough, inline link markers, and inline image markup. **Stage C is the first stage where lp visibly diverges from `hybrid-cm6`**: actual `<img>` elements render inline for inline images, with URL/path security allowlist (`https:`, `data:image/*`, vault-relative resolved via new IPC route) + symlink-safe filesystem reads mirroring the session importer. **Stage D extends the Decoration.replace + atomic-range pattern from inline markers to three block-level marker categories** (ATX heading prefix, list bullets, blockquote `>`). HorizontalRule, Setext underlines, TaskMarker, and fenced-code fences preserved. **Stage E renders GFM tables as actual HTML `<table>` grids off-active** via a multi-line block `TableWidget` (XSS-safe via `textContent`; per-column GFM alignment; cell text rendered as plain text — inline markdown inside cells deferred). Table-level active resolution: caret on ANY line in the table → widget swaps back to walker-styled Markdown source. **Stage F adds KaTeX math rendering** for inline `$x$` and display `$$x$$` via a regex-based detector (Pandoc whitespace rule + `\$` escape) with Lezer-aware filtering (math inside InlineCode/FencedCode/frontmatter NOT rendered). KaTeX vendored to `lib/vendor/katex/`; invalid TeX produces a styled error placeholder via `throwOnError: false` + try/catch. First lp stage to add an npm dependency (`katex@^0.16`). **Stage G.1 adds fenced-code syntax highlighting** via highlight.js (Lezer-native FencedCode detection — no regex layer; whole-block active resolution; known languages get `hljs.highlight`, unknown languages fall back to plain text). **Stage G.2 adds Mermaid diagram rendering** for ` ```mermaid ` blocks — first async-render widget (sync placeholder + Promise-resolve patches SVG; destroyed-flag prevents stale DOM updates). Mermaid vendored to `lib/vendor/mermaid/` (~3 MB). Stage H (promotion to default) remains upcoming. See `docs/stage-history.md` Stages A + B + C + D + E + F + G.1 + G.2 rows for full implementation summaries.
- Add screenshots and a polished release checklist.
- Broaden automated coverage for vault file operations.
- Improve metadata editing UX (current frontmatter handling is read-only beyond tags / source).
- Expand packaging and signing guidance.
- Optional further hybrid-cm6 live-styling coverage: hard line breaks (two-space EOL / `\`), HTML block / tag dimming. (GFM table delimiter dimming shipped in Stages 31 + 32.) None are blockers for current usage.

## Architecture overview

```
Electron main (apps/desktop/main.js)
  ├── Vault file I/O + IPC bridge (apps/desktop/lib/vault-actions.js)
  └── Renderer window (apps/desktop/index.html)
        ├── Write engine resolver (lib/write-engine.js) → tiptap | cm6 | hybrid-cm6 | hybrid-cm6-lp | hybrid
        ├── Write surface
        │     ├── tiptap           → lib/tiptap-entry.js + lib/tiptap-bundle.js + remark bridge
        │     ├── cm6              → lib/cm6-write-view.js + lib/cm6-bundle.js
        │     ├── hybrid-cm6       → lib/cm6-hybrid-view.js (decoration walker over the same bundle)
        │     ├── hybrid-cm6-lp    → lib/cm6-lp-view.js + lib/cm6-lp-emphasis.js (reuses the hybrid walker; adds Decoration.replace + EditorView.atomicRanges for emphasis markers — Stage A opt-in)
        │     └── hybrid (legacy)  → lib/hybrid-write-view.js + Toast UI textarea per block
        ├── Preview surface        → Toast UI Editor (lib/toastui-bundle.js, read-only renderer)
        ├── Dirty-state tracking   → lib/dirty-state.js + close-guard.js
        └── Note list, search, filters, status bar (in index.html)
```

The `hybrid-cm6` walker is intentionally limited to `Decoration.mark` over the existing source — no widgets, no `Decoration.replace`, no document mutation, no HTML generation. The Stage A `hybrid-cm6-lp` engine relaxes this for emphasis markers only (uses `Decoration.replace` + `WidgetType` widgets to hide off-active markers and registers them with `EditorView.atomicRanges` for atomic cursor motion) while preserving the source-of-truth invariant: the document is never mutated. Source text is the source of truth in BOTH engines; decorations are visual only.

## Project Structure

```text
apps/desktop/             Electron desktop app
apps/desktop/lib/         Editor, vault, and renderer helper modules
apps/desktop/test/        Desktop app tests (including editor/session boundary coverage)
apps/desktop/tools/       Developer checks (test baseline, generated assets, Tiptap readiness)
apps/desktop/spike/       CM6 spike artifacts (deferred cleanup)
docs/                     Install, MCP, demo, roadmap, and test-manual docs
```

Cross-project plugins live in the separate `~/Liyunhui/Codes/claude-plugins`
repository and are not part of this app tree.

## Documentation

- [2026-10-22 recovery audit](docs/audits/2026-10-22-project-recovery-audit.md) — verified findings, preserved evidence, and proposed product/technical direction
- `docs/install.md` — install and run guide
- `docs/mcp-ingest-setup.md` — MCP setup guide
- `docs/demo-script.md` — demo walkthrough
- `docs/test-manual.md` — manual release checklist (includes per-stage QA sections)
- `docs/roadmap.md` — roadmap notes
- `docs/stage-history.md` — completed stages and deferred items

## Contributing

Small, reviewable changes are preferred. The project follows a TDD-first workflow for production changes:

1. Inspect the current code and existing tests before editing.
2. Add or update a focused test that pins the new behavior.
3. Make the smallest implementation change that turns it green.
4. Run the focused suite and the full `npm test` before opening a PR.
5. Update `docs/test-manual.md` if user-facing behavior changes.

See `CLAUDE.md` for the project rules followed when collaborating with AI coding assistants.

## License

This repository is licensed under the MIT License. See the `LICENSE` file at the repository root.

Local recovery archives live under the original checkout's ignored `.local/`.
They are not disposable build cache; consult `.local/RELOCATION.md` and the
archive manifests before restoring old paths. Do not use `git clean -x/-X`.
