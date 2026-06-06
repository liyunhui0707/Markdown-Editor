# Manual Test Checklist  
  
Use this checklist before sharing the app with another person.  
  
## App startup  
  
- [ ] App starts from development mode  
- [ ] Packaged app starts  
- [ ] No immediate crash on launch  
  
## Vault workflow  
  
- [ ] Vault can be selected  
- [ ] Demo vault can be created  
- [ ] Existing notes appear  
- [ ] Note selection works  
  
## Note editing  
  
- [ ] New note can be created  
- [ ] Existing note can be edited  
- [ ] Save works  
- [ ] Saved note remains visible  

## Dirty state and draft survival

- [ ] Create a new draft — note list shows "Draft" badge
- [ ] Edit a vault note — status bar shows "Draft" indicator
- [ ] Switch to a different note while a draft is dirty, then switch back — content is preserved
- [ ] Load a new vault while a draft exists — draft survives and appears in the Drafts filter

## Filename collision guard

- [ ] Create a draft whose title matches an existing vault filename → Save is blocked with an error toast; no file is overwritten
- [ ] Create two drafts with the same title → Save All & Quit is blocked with an error toast; neither is saved

## Editor mode (CM6 / Hybrid)

- [ ] Default write surface is hybrid-cm6 (live-styled Markdown) — Stage 17 flip
- [ ] `?writeEngine=cm6` fallback engine still loads CodeMirror 6 styled-source mode
- [ ] Undo and redo work correctly in CM6 mode
- [ ] Chinese IME composition does not drop the first character in CM6 mode
- [ ] Append `?writeEngine=hybrid` to the dev URL → Hybrid write view loads instead
- [ ] Hybrid Preview renders Markdown correctly

## Task-toggle behavior (Stage 23, hybrid-cm6 only)

Default engine is `hybrid-cm6`. Open a note containing
`- [ ] one\n- [x] two\n- [X] three\n`.

- [x] Primary-click the `[ ]` marker → toggles to `[x]`; click again → back to `[ ]`
- [x] Primary-click the `[X]` marker → toggles to `[ ]`
- [x] Primary-click on the label text (not the marker) → only caret movement; no toggle
- [x] Primary-click on the bullet `-` → only caret movement; no toggle
- [x] Right-click on the marker → no toggle
- [x] Middle-click on the marker → no toggle (skip if no middle-click affordance)
- [x] `Cmd-click`, `Ctrl-click`, `Alt-click`, `Shift-click` on the marker → no toggle (modifier keys are reserved)
- [x] Place caret on a task line, press `Cmd-Shift-X` (macOS) → toggles that line's marker
- [x] Place caret on a non-task line, press `Cmd-Shift-X` → no change, no error
- [x] **Dirty badge appears** in the title bar after any toggle. Stop and investigate if the badge does not update
- [x] Active selection across multiple lines including a task line → press `Cmd-Shift-X` → toggles only the line containing the primary caret; selection preserved
- [x] Begin Chinese / Japanese / Korean IME composition on a task-line label; click another task marker mid-composition → no toggle; composition completes normally on commit
- [x] `Cmd-Z` undoes the last toggle in one step; `Cmd-Shift-Z` redoes
- [x] Save the note, close it, reopen → marker state is **character-identical after LF normalization** with what the editor showed before save
- [x] Long-document responsiveness: open a note with 200+ task markers, click any one → toggle feels instant (< 100 ms perceptually)
- [x] Preview pane (Toast UI) reflects the toggled state after the existing Write→Preview sync
- [x] Switch to `?writeEngine=cm6` fallback → task markers are NOT clickable; no error
- [x] Switch to `?writeEngine=hybrid` legacy fallback → no toggle behavior; no error
- [x] No new console warnings or errors during any of the above

Tester: liyunhui  Date: 2026-05-14  OS: macOS

## Search  
  
- [ ] Search finds matches in title  
- [ ] Search finds matches in body  
- [ ] Search finds matches in tags  
- [ ] Search finds matches in source  
- [ ] Search snippets are visible  
  
## Filters  
  
- [ ] All Notes filter works  
- [ ] AI Imports filter works  
- [ ] Drafts filter works  
- [ ] Vault Files filter works  
  
## Metadata  
  
- [ ] Frontmatter tags display correctly  
- [ ] Frontmatter source displays correctly  
  
## MCP ingest  
  
- [ ] `npm run smoke` passes  
- [ ] Claude Code can call `ingest_chat_markdown`  
- [ ] Codex can call `ingest_chat_markdown`  
- [ ] Ingested file is written into `Inbox/AI Chats/YYYY/MM/`  
- [ ] App auto-refreshes after ingest  
- [ ] New imported note appears in AI Imports  
  
## Delete behavior  
  
- [ ] Draft delete works  
- [ ] File-backed delete works safely  
  
## Close warning (Stage 6.3A)

- [ ] Clean state, click window close button → app closes, no dialog
- [ ] Clean state, Cmd+Q (macOS) → app quits, no dialog
- [ ] Type into a new draft, click window close button → warning dialog appears
- [ ] Warning: Cancel keeps the app open and the draft intact
- [ ] Warning: Discard & Quit closes the app (draft is intentionally lost)
- [ ] Edit a vault note, Cmd+Q → warning dialog appears
- [ ] Cancel from the warning leaves the dirty vault note still dirty (Draft status)
- [ ] Untouched "Untitled note" draft does NOT trigger the warning

## Save All & Quit (Stage 6.3B)

- [ ] Dialog shows three buttons: Save All & Quit, Discard & Quit, Cancel
- [ ] Default button (Enter) is Save All & Quit
- [ ] Esc / dialog dismiss → Cancel (app stays open)
- [ ] Edit one vault note, Save All & Quit → file saves, app quits
- [ ] Edit one new draft (with a real title), Save All & Quit → draft saves under derived filename, app quits
- [ ] Mixed dirty drafts + dirty vault notes, Save All & Quit → all save, app quits
- [ ] Edit a draft pre-vault, Save All & Quit → OS folder picker opens; pick a folder → save proceeds, app quits
- [ ] Edit a draft pre-vault, Save All & Quit → cancel the OS picker → app stays open, draft still dirty
- [ ] Two new drafts with the same title → Save All & Quit aborts on the conflict, error toast, app stays open
- [ ] File-permission error during save → Save All & Quit aborts, error toast, app stays open
- [ ] Discard & Quit (regression) still works alongside Save All
- [ ] Cancel (regression) still keeps the app open

## Packaging  
  
- [ ] Local packaged app artifact exists  
- [ ] Unsigned app opens after running: `codesign --force --deep --sign - dist/mac-arm64/markdown-vault-desktop.app`  
  
## Visual appearance (Stage 7.1 baseline)

- [ ] Editor surface, title input, and empty-note hint render with the warm-paper token palette — no pure-white or pure-black areas
- [ ] Preview headings, body text, links, inline code, code blocks, blockquotes, and horizontal rules all use design tokens, not hardcoded colors
- [ ] Destructive button (e.g. Delete Note) hover shows a warm red tint, not bright pink

## Hybrid-cm6 consolidated smoke checklist

A 5-minute pre-merge pass that covers every Markdown family the hybrid-cm6 engine styles today. Run in `?writeEngine=hybrid-cm6` unless an item says otherwise. **Source-of-truth invariant** for every section below: after each interaction, save the note and reopen — the raw Markdown source text should be preserved without rendered HTML or decoration artifacts; for LF fixtures, text should round-trip character-for-character. (CodeMirror normalizes line endings internally, so exact on-disk byte equality is not promised for CRLF files.) Per-stage sections further down provide more detailed coverage when you need it.

**Headings (ATX & Setext)**
- [ ] `#` through `######` headings render with matching typography; the `#` markers hide off the active line and reveal dimmed when the caret is on the heading line
- [ ] Setext H1 (`Title\n=====`) and Setext H2 (`Title\n-----`) render with H1 / H2 typography; the `=====` / `-----` hides off the underline line and reveals dimmed only when the caret is on that line

**Inline emphasis & code**
- [ ] `**bold**`, `*italic*`, `_italic_`, `` `code` `` — content styled; the `**` / `*` / `_` / `` ` `` markers hide off the active line and reveal dimmed on it
- [ ] `***both***` renders italic AND bold (composition)
- [ ] `` `**not bold**` `` — inline code wins; no bold styling inside the backticks

**Links (inline, reference, definitions)**
- [ ] `[text](url)` — text underlined; URL and brackets hide off the line, reveal on it. Click does NOT navigate
- [ ] `[text][ref]` plus `[ref]: url` — text underlined; brackets and `[ref]` label hide off the line; the definition line is dimmed end-to-end
- [ ] `[text][]` collapsed reference — same hide/reveal; empty `[]` is hidden as syntax
- [ ] `[shortcut]` alone with definition — intentionally NOT styled (documented deferral)

**Images (markers only)**
- [ ] `![alt](image.png)` — alt text italic + muted; `![`, `]`, `(`, URL, `)` hide off the line and reveal on it. No `<img>` is rendered, no file is fetched
- [ ] `![alt][1]` reference-style image — NOT styled (intentional)

**Lists, task lists, blockquotes**
- [ ] Bullet markers `-`, `*`, `+` and ordered `1.`, `1)` — dimmed; hidden when the caret is off the list item, revealed (dimmed) when the caret is anywhere inside the list item (including a continuation line — Stage 30)
- [ ] `>` blockquote markers — dimmed; hidden off the blockquote, revealed (dimmed) when the caret is anywhere inside the blockquote (including a continuation line with no leading `>` — Stage 28)
- [ ] `- [ ]`, `- [x]`, `- [X]` task markers — dimmed but always visible (intentional, Stage 27 D1 click-target exemption); clicking the bullet `-` does NOT toggle the checkbox
- [ ] Cascade smoke (Risk-2 manual gate from Issue #83): DevTools → Elements → `.cm-md-list-mark`. With caret OUTSIDE any list, computed style shows `display: none`. With caret INSIDE a multi-line list item ON the continuation line, computed style on the first-line `.cm-md-list-mark` element shows `display: inline; opacity: 0.5`.

**Fenced code & horizontal rules**
- [ ] ` ```lang ` … ``` ``` ` — fences dimmed, language info dimmed, code body untouched (no inline marks fire inside)
- [ ] Standalone `---`, `***`, `___` — rendered as dimmed letter-spaced rule. Setext underlines following non-blank text are NOT styled as HR

**Strikethrough & autolinks**
- [ ] `~~done~~` — line-through; `~~` markers hide/reveal on the active line. `~one~` (single tilde) is NOT struck
- [ ] `<https://example.com>`, `<mailto:a@b.com>`, raw email `<a@b.com>`, and bare `https://example.com` in prose — all underlined; angle brackets hide/reveal where present. Click does NOT navigate

**YAML frontmatter**
- [ ] Note starting with `---\nKEY: VAL\n---\n\nbody` — the entire frontmatter region (both fences and the metadata lines) renders as plain text. No `cm-md-hr`, no `cm-md-h2`, no inline styling on any token inside the region. Body renders normally
- [ ] Frontmatter without a closing `---` — leading `---` is rendered as a thematic break (frontmatter NOT detected)

**Cross-engine regressions**
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17): open every fixture above — editor doesn't crash; no `cm-md-*` decoration classes; default `cm6` engine syntax coloring is acceptable
- [ ] **Legacy hybrid** (`?writeEngine=hybrid`): open the same notes — textarea-swap view loads; Toast UI Preview remains unchanged
- [ ] **Toast UI Preview tab**: switch to Preview on every fixture — rendering is identical to the previous build (no hybrid-cm6 decoration leaks into Preview)

**Long-document smoke**
- [ ] Open or paste a note with ~5k lines of mixed Markdown (headings, lists, fenced code, links). Scroll top-to-bottom — no flicker, no decoration drift, typing remains responsive

**IME smoke (Chinese / Japanese)**
- [ ] Type `中文标题` after `#`, after `**`, inside a list item, inside `~~`, and inside frontmatter `---` fences — composition is not interrupted; the first character is not dropped

## Strikethrough live styling (Stage 14.2)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) unless an item says otherwise.

- [ ] `~~done~~` — line-through visible; the `~~` delimiters are hidden when the caret is on another line
- [ ] Caret on the `~~done~~` line — both `~~` delimiters reveal (dimmed)
- [ ] `~one~` (single tilde) — no styling, raw text
- [ ] `~~ spaced ~~` (internal spaces at delimiter) — no strikethrough styling
- [ ] `# heading with ~~strike~~` — composes correctly with the heading
- [ ] `~~**bold strike**~~` — both line-through and bold render
- [ ] `- list item with ~~strike~~` — composes with the list marker
- [ ] `> quote with ~~strike~~` — composes with the quote marker
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17) opening a note containing `~~x~~` — editor does not throw; no `cm-md-strikethrough` decoration; no `~~` hide/reveal. Default syntax highlighting may color the tokens — that is acceptable. The invariant is: no hybrid live-decoration behavior and no jarring visual regression.
- [ ] Long doc with mixed strikethrough / bold / inline-code — no perceptible perf regression while typing or scrolling
- [ ] Chinese IME composing `~~中文~~` — no premature commit; composition adjacent to `~~` stays stable
- [ ] Single Cmd+Z after typing `~~strike~~` reverts the whole token; history boundaries unchanged
- [ ] Toast UI Preview rendering of strikethrough is unchanged (Toast UI already supports `~~`)
- [ ] Cursor navigation across a hidden `~~` boundary — Arrow keys behave identically to existing emphasis markers

## Task list visual styling (Stage 14.3)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) unless an item says otherwise.

- [ ] `- [ ] todo` — bullet `-` dimmed; `[ ]` dimmed; `todo` at normal weight/color
- [ ] **Cursor behavior:** caret moves through the visible `[ ]` marker as 3 normal cursor positions (no skip, no widget jump); Shift+Arrow selection across the marker behaves like normal text
- [ ] `- [x] done` and `- [X] DONE` — same dimming pattern; lowercase and uppercase both render dimmed; clicking the marker does **not** toggle it; document text unchanged
- [ ] `- one` (plain bullet, no task marker) — bullet dimmed; `one` normal; no `[ ]`-like artifact appears
- [ ] Mixed list with task and non-task items intermixed — each renders correctly; no decoration leak between items
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17) opening a note containing `- [ ] todo` — editor does not throw; no `cm-md-task-marker` decoration; no jarring visual regression. Default syntax coloring is acceptable.
- [ ] Save a note containing task items, reload — file bytes on disk unchanged; the marker character sequence (brackets, spaces, `x`/`X`) preserved exactly

## Autolink live styling (Stage 14.4)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) unless an item says otherwise.

- [ ] `<https://example.com>` — URL underlined; `<` and `>` hidden when caret is on a different line; reveal dimmed when caret enters the line
- [ ] `<mailto:name@example.com>` — same hide/reveal; mailto URL rendered as link-text
- [ ] `Visit https://example.com today` — bare URL underlined in place; no brackets to hide; surrounding text at natural style
- [ ] **Inline link regression:** `[OpenAI](https://openai.com)` still renders with `OpenAI` as the visible underlined label and the URL hidden when caret elsewhere (Stage 11.7 unchanged)
- [ ] **Image regression:** `![alt](https://example.com)` — the image URL is **not** underlined; no autolink-marker reveal/hide on the brackets
- [ ] **Reference-definition regression:** `[OpenAI]: https://example.com` (typically at the bottom of a doc) — URL is **not** underlined
- [ ] `# See https://example.com` — heading-level styling AND URL underline both render
- [ ] **No clicks:** clicking on any underlined autolink/bare URL does **not** open a browser, does **not** navigate, does **not** toggle anything; document text unchanged
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17) opening a note containing `<https://example.com>` and a bare URL — editor doesn't crash; no `cm-md-autolink-url` / `cm-md-autolink-mark` decorations applied. Default syntax coloring is acceptable.
- [ ] Save a note with autolinks and bare URLs, reload — file bytes on disk preserved exactly (angle brackets, `mailto:`, etc.)

## Image Markdown marker styling (Stage 14.5)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) unless an item says otherwise.

- [ ] `![alt text](image.png)` — alt text shown italic+muted; `![`, `]`, `(`, URL, `)` hidden when caret is on a different line; reveal dimmed when caret enters
- [ ] `![alt](image.png "caption")` — title is also hidden/revealed alongside the other markers
- [ ] **Empty-alt visibility:** `![](image.png)` on its own line — when the caret is on a *different* line, all syntax is hidden and there is no visible alt range, so this image **becomes visually blank**. Confirm the behavior is acceptable for the MVP (caret on the line still reveals all markers, so the image source can always be inspected). If unacceptable, escalate before merging.
- [ ] `![alt **bold**](pic.jpg)` — alt text italic+muted; `**bold**` inside the alt continues to render bold (composition); the bold text is also italic because it sits inside the `cm-md-image-alt` span
- [ ] `# Look ![alt](pic.png) here` — heading styling AND image styling both render
- [ ] **Inline link regression:** `[text](image.png)` (URL with image-like extension but inline LINK syntax) still renders as a normal inline link (`text` underlined; URL hidden)
- [ ] **Reference-style image regression:** `![alt][1]` followed by `[1]: pic.png` definition — neither line gets image-alt or image-mark styling
- [ ] **No clicks, no rendering:** no `<img>` appears in the editor; clicking any image syntax does **not** open a file picker, does **not** navigate, does **not** fetch anything
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17) opening a note containing `![alt](pic.png)` — editor doesn't crash; no `cm-md-image-alt` / `cm-md-image-mark` decoration applied. Default syntax coloring is acceptable.
- [ ] Save a note with images, reload — file bytes preserved exactly (alt text, URL, title, all whitespace)
- [ ] **Toast UI Preview** mode unchanged — Toast UI's existing image rendering is untouched

## Reference-style link marker styling (Stage 14.6)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) unless an item says otherwise.

- [ ] `[text][ref]` followed by `[ref]: https://example.com` definition — `text` underlined; `[`, `]`, `[ref]` hidden when caret is on a different line; reveal dimmed when caret enters the line. The `[ref]: ...` definition line is dimmed with muted color.
- [ ] `[text][]` collapsed reference (with matching `[text]: url` definition) — same hide/reveal; the empty `[]` is hidden as syntax.
- [ ] **Shortcut deferred:** `[shortcut]` with a matching `[shortcut]: url` definition — `[shortcut]` is **NOT** underlined and the brackets are **NOT** hidden. (Intentional: parser cannot distinguish shortcut references from plain bracketed text. Documented as deferred.)
- [ ] **Plain brackets stay raw:** `[just some text in brackets]` (no matching definition anywhere) — also NOT underlined and brackets NOT hidden. (Confirms the shortcut deferral doesn't over-style plain text.)
- [ ] **Composition:** `[**bold text**][ref]` with definition — `bold text` rendered both underlined AND bold; brackets and LinkLabel hidden when caret elsewhere.
- [ ] **Definition styling:** `[ref]: url`, `[ref]: url "title"`, and definitions with long URLs all render dimmed (muted color) for the entire line.
- [ ] **Image reference regression:** `![alt][1]` followed by `[1]: pic.png` — image reference itself is NOT underlined or styled (Stage 14.5 invariant). The `[1]: pic.png` definition line IS dimmed (correct — definitions are definitions regardless of what they refer to).
- [ ] **Inline link regression:** `[OpenAI](https://openai.com)` still renders as a normal underlined inline link (Stage 11.7 invariant).
- [ ] **No clicks, no resolution:** clicking a reference link does not navigate; the editor does NOT validate whether `[ref]` has a matching definition; broken references are NOT highlighted. Source bytes never modified.
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17) opening a note containing `[text][ref]` and `[ref]: url` — editor doesn't crash; no `cm-md-reflink-text` / `cm-md-reflink-mark` / `cm-md-link-def` decoration applied.
- [ ] Save a note with reference links and definitions, reload — file bytes preserved exactly (label, URL, title, all whitespace).
- [ ] **Toast UI Preview** mode unchanged — Toast UI's existing reference-link rendering is untouched.

## Setext heading marker styling (Stage 14.7)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) unless an item says otherwise.

- [ ] `Title` followed by `=====` on the next line — `Title` rendered with H1 typography matching ATX `# Title`; `=====` is hidden when the caret is on a different line; the `=====` reveals dimmed **only when the caret is on the underline line**. (It does not reveal when the caret is only on the title line — cross-line reveal is out of scope.)
- [ ] `Title` followed by `-----` on the next line — same behavior with H2 typography matching ATX `## Title`.
- [ ] **Composition:** `**Bold** title` followed by `=====` — title rendered H1 AND `**Bold**` rendered bold; the `**` markers continue to hide / reveal via the existing inline syntax mechanism.
- [ ] **Mixed document:** ATX `# Heading` and a Setext `Heading\n=====` in the same note — both render with their respective heading styles, no cross-contamination.
- [ ] **Layout:** the underline line (with `=====` hidden) does NOT inherit H1/H2 line-height; the heading-text mark stops before the newline so the underline line sits at body line-height.
- [ ] **HR regression:** standalone `---` on its own line (with blank lines around) still renders as a dimmed horizontal rule (Stage 14.1 invariant); not styled as a heading.
- [ ] **ATX regression:** `# Heading` and `## Heading` continue to render exactly as before (Stage 11.4 invariant).
- [ ] **Edit-into-paragraph:** delete the underline characters of a Setext heading — the parser flips back to a plain paragraph and the H1/H2 styling disappears.
- [ ] **No widgets, no clicks:** the underline characters are real characters; caret traverses them; clicking the underline line places the caret normally.
- [ ] **IME / Chinese input:** type `中文标题`, press Enter, type `===` — IME composition is not interfered with; no decoration causes caret jump.
- [ ] **Long document:** scroll a doc containing many Setext H1/H2 headings — no flicker, no decoration drift across viewport changes.
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17) opening a note with Setext headings — editor doesn't crash; default `cm6` engine syntax coloring acceptable; no `cm-md-h1` / `cm-md-h2` / `cm-md-heading-mark` decoration applied by hybrid-cm6.
- [ ] Save a note with Setext headings, reload — file bytes preserved exactly (title text, newline, `=====` or `-----`, newline).
- [ ] **Toast UI Preview** mode unchanged — Toast UI's existing Setext rendering is untouched.

## Frontmatter visual fix (Stage 14.9)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) unless an item says otherwise.

Detection rule: the leading and closing fences must be **exactly** `---` — no trailing whitespace, no `+++` TOML alternative. The contract is "frontmatter plain" — no decoration of any kind fires inside the detected region.

- [ ] Note with `---\ntitle: My Note\ntags: [example]\n---\n\nbody` — the entire frontmatter region (both `---` fences AND the metadata lines) renders as plain text. No thematic-break dimming, no H2 typography, no bold/italic/inline-code/autolink styling on any token inside the region. Body renders normally.
- [ ] Frontmatter containing a URL: `---\nurl: https://example.com\n---\n\nsee https://example.com` — the URL inside the frontmatter is plain text (no underline). The URL in the body IS underlined (Stage 14.4 invariant).
- [ ] Frontmatter containing `**bold**`: `---\ntitle: **bold**\n---\nbody **bold**` — the metadata `**bold**` is plain (asterisks visible, content not bold). The body `**bold**` is bold.
- [ ] Empty frontmatter `---\n---\nbody` — both `---` plain; body normal.
- [ ] Multi-paragraph frontmatter (with a blank line inside the metadata region) — every line of the region is plain.
- [ ] **HR regression:** standalone `---` after content (`body\n\n---\n\nmore`) — still rendered as a dimmed thematic break.
- [ ] **HR regression:** frontmatter, then later in the body a real `---` HR — only the real HR is dimmed; the frontmatter `---` is plain.
- [ ] **Setext regression:** `Title\n=====` and `Title\n-----` (no leading `---`) — H1/H2 typography intact; underline hide/reveal still works.
- [ ] **No-closing-fence:** `---\njust a heading` — leading `---` is rendered as a thematic break (frontmatter NOT detected).
- [ ] **Strict fence:** `--- ` (with trailing space) on the leading line is NOT detected as frontmatter — known limitation; matches strict YAML conventions.
- [ ] **Save/reload:** save a frontmatter-bearing note; reopen — file bytes preserved exactly (the `---` lines, indentation, blank lines all unchanged).
- [ ] **Toast UI Preview:** Preview rendering on a frontmatter-bearing note is unchanged from the previous build.
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17): same notes open without crashing; no `cm-md-*` decoration applied (the `cm6` fallback engine doesn't use the hybrid walker).
- [ ] **IME:** type `---`, Enter, `中文标题`, Enter, `---` — IME composition is not interfered with.
- [ ] **Edit-into-non-frontmatter:** delete the closing `---` of frontmatter — the leading `---` flips to a thematic break (parser sees no closing fence; detection returns null; HR styling reappears). Source changed, decoration follows source.

## Long-document performance smoke (Stage 15)

Run in the hybrid-cm6 engine (`?writeEngine=hybrid-cm6`) against a developer-machine release build. The automated baseline lives in `apps/desktop/test/cm6-write-view/hybrid-cm6-perf.test.js`: three light 10k-line tests run in every `npm test`; two heavy tests (50k-line build + 100-edit typing loop) are opt-in via `npm run test:perf` (sets `PERF_BENCH=1`). When the automated thresholds trip on a healthy developer machine, do NOT raise the thresholds — escalate as a Stage 16 finding.

- [ ] Open a real ~10 000-line Markdown note (mix of headings, lists, fenced code, links, frontmatter). Editor opens in under ~2 seconds; no visual freeze.
- [ ] Scroll top-to-bottom of the same note; no frame stutter or visible flicker around decoration transitions.
- [ ] Place the caret mid-document and hold a character key for ~5 seconds; input remains responsive.
- [ ] Type into a heading line; the `#` marker hide/reveal stays in sync with the caret line.
- [ ] Switch Write → Preview → Write on the long note; no perceptible delay.
- [ ] Open a note with ~50 000 lines (if available). Editor opens within ~10 seconds; typing remains usable. If unusable, file as a Stage 16 trigger.
- [ ] Open a note that starts with `---` but has no closing `---` (e.g. a paragraph using `---` as a thematic break). Editor opens within ~2 seconds; the `---` renders as a horizontal rule. (Confirms `detectFrontmatter` worst case is not user-visible.)
- [ ] **`?writeEngine=cm6` fallback engine** (post-Stage-17) on the same long notes — rule out a parser-level regression also visible in the `cm6` fallback engine.
- [ ] Run `npm run test:perf` locally; record the five reported numbers (`build_after_full_parse_ms` for 15-1 / 15-2 / 15-4 / 15-5, and `typing_loop_incremental_p95_ms` for 15-3) in the PR description so reviewers see the developer-machine baseline.

## Bundle parity + cross-engine smoke (Stage 16)

Automated safeguards before any future Stage 17 default-engine flip. The tests live in `apps/desktop/test/cm6-write-view/cm6-bundle-parity.test.js` (5 tests) and `cross-engine-smoke.test.js` (7 tests). Both run as part of the default `npm test` suite.

- [ ] Run `cd apps/desktop && node --test test/cm6-write-view/cm6-bundle-parity.test.js`. Expected: `tests 5, pass 5, skipped 0, fail 0`.
- [ ] Run `cd apps/desktop && node --test test/cm6-write-view/cross-engine-smoke.test.js`. Expected: `tests 7, pass 7, skipped 0, fail 0`.
- [ ] Run `cd apps/desktop && npm test`. Expected: approximately `tests 898, pass 896, skipped 2, fail 0` (the 2 skipped are the Stage 15 opt-in perf benchmarks).
- [ ] **Parity-reactivity sanity check (one-time, not committed):** edit `cm6-entry.js`'s `extensions: [Strikethrough]` to `extensions: [Strikethrough, FakeExt]` (plain identifiers — no `/* ... */` comment, because `parseExtensionsArray` is regex-based and does not strip comments). Do NOT rebuild the bundle. Re-run the parity test; confirm Stage 16-3 fails with a clear `[Strikethrough]` vs `[FakeExt, Strikethrough]` diff. Revert. Confirm `git status` is clean before continuing.
- [ ] **`npm run build:cm6` is manual QA only:** optionally run it once to verify the bundle is in sync. If `git diff lib/cm6-bundle.js` shows no diff → bundle in sync (expected). **If non-empty → STOP.** Discard the rebuild from the working tree. Propose the bundle rebuild as a **separate, reviewed patch** containing only `lib/cm6-bundle.js` and a one-line stage-history note. The Stage 16 patch must never include a rebuilt bundle.
- [ ] In `?writeEngine=cm6` (default), open a real note containing the full Stage 14 surface (frontmatter, ATX + Setext headings, bold, italic, inline code, inline link, reference link + definition, image, list, task list, blockquote, fenced code, HR, strikethrough, autolink). Save and reopen. Confirm byte-identical round trip.
- [ ] Repeat in `?writeEngine=hybrid-cm6`. Confirm visual decoration is correct AND saved bytes are identical to the cm6 round trip.
- [ ] In `?writeEngine=hybrid` (legacy), open the same note. Confirm it loads, edits work, save round-trips bytes identically. (Legacy hybrid is not in automated Stage 16 coverage — it requires DOM. Its boot-path coverage lives in renderer-boot.test.js Stage 11.2 + Save All & Quit tests.)
- [ ] Switch between engines via the URL query and confirm note content survives in every direction.
- [ ] Switch a note from Write → Preview → Write in each engine. Preview rendering is identical across engines.

### Pre-Stage-17 readiness checklist

- [ ] All Stage 16 automated tests pass on the developer machine.
- [ ] Parity-reactivity sanity check performed and confirmed (Stage 16-3 catches a fake entry edit).
- [ ] `npm run build:cm6` produced no bundle diff during manual QA.
- [ ] Manual cross-engine QA completed on a real-note fixture.
- [ ] Stage 15 `npm run test:perf` ran and developer-machine numbers recorded in the Stage 17 PR description.
- [ ] No outstanding hybrid-cm6 bug reports.
- [ ] Fallback-engine policy decided (does `cm6` remain as a documented fallback when `hybrid-cm6` becomes default?).

## Default-engine flip (Stage 17)

Stage 17 promoted `hybrid-cm6` to the default Write engine. `cm6` and legacy `hybrid` remain selectable as fallbacks via the `?writeEngine=` URL query or the `markdownVault.writeEngine` localStorage key. Users who had the `markdownVault.writeEngine` localStorage key set to `"cm6"` before the flip continue to get `cm6`.

- [ ] Clear the `markdownVault.writeEngine` localStorage key in DevTools (`localStorage.removeItem('markdownVault.writeEngine')`). Reload with no `?writeEngine=` query. Confirm: status-bar engine label shows **"CM6 Hybrid"**; live-styled decorations render on a Stage-14-rich note.
- [ ] Reload with `?writeEngine=cm6`. Confirm: engine label shows "CM6"; raw-source coloring; no `cm-md-*` decorations applied.
- [ ] Reload with `?writeEngine=hybrid`. Confirm: legacy hybrid view loads; Toast UI Preview works.
- [ ] Set the `markdownVault.writeEngine` localStorage key to `'cm6'` in DevTools (`localStorage.setItem('markdownVault.writeEngine', 'cm6')`). Reload with no query. Confirm: `cm6` is selected (existing user preference preserved).
- [ ] Set the `markdownVault.writeEngine` localStorage key to `'hybrid'` (`localStorage.setItem('markdownVault.writeEngine', 'hybrid')`). Reload. Confirm: `hybrid` is selected.
- [ ] Open `?writeEngine=garbage` (invalid query). Confirm: falls back to `hybrid-cm6` (the new default).
- [ ] Open `?writeEngine=CM6` (case-sensitive invalid). Confirm: falls back to `hybrid-cm6`.
- [ ] Open the same Stage-14-rich note in each of the three engines via URL query. Save in each. Confirm file bytes are byte-identical across all three saves.
- [ ] Switch between engines via URL change + reload. Confirm note content survives in every direction.
- [ ] Switch Write → Preview → Write in each engine. Preview rendering is identical across engines (Toast UI is the same renderer regardless of Write engine).
- [ ] Verify the Stage 14.10 consolidated hybrid-cm6 smoke checklist still passes on the new default (since hybrid-cm6 is now the most common code path users will exercise).
- [ ] Run `cd apps/desktop && npm test`. Expected: `tests 907, pass 905, skipped 2, fail 0`.
- [ ] Run `cd apps/desktop && npm run test:perf`. Expected: `tests 5, pass 5, skipped 0, fail 0`.

### Stage 17 rollback (if needed)

Three paths to revert:
1. `git revert <Stage-17-commit-sha>` — single command, complete reversion.
2. Manual revert: change `DEFAULT = 'hybrid-cm6'` back to `'cm6'` in `apps/desktop/lib/write-engine.js`; flip Stage 17 test assertions back; revert doc edits.
3. User-side override (no code change needed): users can force `cm6` via `localStorage.setItem('markdownVault.writeEngine', 'cm6')` or `?writeEngine=cm6`.

All three paths preserve `hybrid-cm6` availability via explicit `?writeEngine=hybrid-cm6`.

## Default-engine stabilization manual QA (Stage 18)

Stage 18 is a verification-first stabilization audit performed after Stage 17 made `hybrid-cm6` the default Write engine. The goal is to confirm no user-visible regression slipped in. The v3 plan's allowed per-bullet outcomes are **PASS / FAIL / SKIP-WITH-REASON**. **Current status of this audit pass:** the automated regression contract below is PASS (verified at HEAD `9d7596a`), and the live-app manual QA bullets below are PASS based on the developer's `npm run dev` QA pass on macOS. Stage 18 is accepted as a clean Branch A closure: docs-only, no regression found, no code or test change required.

### Automated regression contract (PASS — verified at Stage 18 audit time)

- [x] `cd apps/desktop && npm test` → `tests 907, pass 905, skipped 2, fail 0`. (Step 0 baseline; matches the assumed Stage 17 post-flip floor exactly; no drift.)
- [x] `cd apps/desktop && npm run test:perf` → `tests 5, pass 5, skipped 0, fail 0`.
- [x] `cd apps/desktop && node --test test/cm6-write-view/cm6-bundle-parity.test.js` → `5 / 5 / 0 / 0`.
- [x] `cd apps/desktop && node --test test/cm6-write-view/cross-engine-smoke.test.js` → `7 / 7 / 0 / 0`. (Stage 16-11 proves `cm6.getText() === hybridCm6.getText()` byte-identity for a Stage-14-rich fixture; this is the load-bearing round-trip contract under the new default.)
- [x] `cd apps/desktop && node --test test/cm6-write-view/heading-marks.test.js` → `125 / 125 / 0 / 0`. (Stage 14.9 frontmatter contract + every styled construct.)
- [x] `cd apps/desktop && node --test test/cm6-write-view/hybrid-cm6-readiness.test.js` → `7 / 7 / 0 / 0`. (Section H source-file invariants: no widget / no `Decoration.replace` / no `<a>` / no `href` / no click handlers.)
- [x] `cd apps/desktop && node --test test/write-engine.test.js` → `30 / 30 / 0 / 0`. (Stage 17 resolver anchors: default is `hybrid-cm6`; explicit `cm6` / `hybrid` selection preserved; localStorage preferences preserved.)
- [x] `cd apps/desktop && node --test test/renderer-boot.test.js` → `270 / 270 / 0 / 0`. (Stage 17 default-pin renderer flip + 4 new Stage 17 anchors covering default boot label, `?writeEngine=cm6` regression, `?writeEngine=hybrid` regression, `?writeEngine=garbage` fallback.)

**Coverage-gap inspection (Stage 18 Step 1):** `rg -n -m 30 "saveNotePayloads|calls\.saveNote|relativePath" apps/desktop/test/renderer-boot.test.js` confirms `saveNotePayloads.length` is asserted in multiple renderer save tests but byte-identical save-payload **content** is NOT asserted at the renderer-harness level. However, `cross-engine-smoke.test.js` Stage 16-11 already proves byte-identical `getText()` round-trip across `cm6` and `hybrid-cm6` adapters for a Stage-14 fixture, which satisfies the round-trip contract at the adapter boundary. No new renderer anchor test is needed for Stage 18.

### Live-app manual QA (PASS — verified on `npm run dev`)

**Status of every bullet in this section, recorded by this Stage 18 audit pass: PASS.** The developer executed the live-app checklist on a real `npm run dev` build on macOS and reported no FAIL or SKIP-WITH-REASON outcomes.

Use a Stage-14-rich note covering frontmatter, ATX + Setext headings, bold, italic, inline code, inline link, reference link + definition, image marker, list, task list, blockquote, fenced code, HR, strikethrough, autolink. Record outcome per bullet as PASS / FAIL / SKIP-WITH-REASON.

**Clean-start baseline**
- [x] `localStorage.removeItem('markdownVault.writeEngine')` in DevTools; reload with no `?writeEngine=` query. Confirm: status-bar engine label shows **"CM6 Hybrid"**; `Cm6HybridView` is constructed; live-styled decorations render correctly.

**Fallback URL queries**
- [x] `?writeEngine=cm6` — engine label "CM6"; raw-source coloring; no `cm-md-*` decorations.
- [x] `?writeEngine=hybrid` — legacy hybrid view loads; per-block textarea swap works; Preview tab renders Markdown.
- [x] `?writeEngine=hybrid-cm6` — same as default; explicit selection equivalent.
- [x] `?writeEngine=garbage` — falls back to hybrid-cm6 (engine label "CM6 Hybrid").
- [x] `?writeEngine=CM6` (case-sensitive invalid) — falls back to hybrid-cm6.

**localStorage preferences**
- [x] `localStorage.setItem('markdownVault.writeEngine', 'cm6')` + reload → `cm6` selected (existing user preference preserved).
- [x] `localStorage.setItem('markdownVault.writeEngine', 'hybrid')` + reload → legacy hybrid selected.

**Realistic-note open / save / reload**
- [x] Open a Stage-14-rich note in the default (`hybrid-cm6`). Confirm all decorations render; no crash; engine label "CM6 Hybrid".
- [x] Edit; Cmd+S; close and reopen. Confirm: file bytes are LF-identical to what was saved.
- [x] Open the same note with `?writeEngine=cm6` and `?writeEngine=hybrid`. Confirm: file bytes are identical across all three engines.

**Frontmatter under default**
- [x] Open a frontmatter-bearing note (`---\ntitle: My Note\ntags: [a, b]\n---\n\nbody`). Confirm: leading `---` is plain (no `cm-md-hr` dimmed letter-spacing); metadata lines are plain (no `cm-md-h2`); body renders normally.
- [x] Open a note that begins with `---\njust text\n` (no closing fence). Confirm: leading `---` renders as a thematic break.

**Preview mode unchanged**
- [x] Switch Write → Preview → Write on a Stage-14-rich note. Confirm Preview rendering is identical to pre-Stage-17 Preview.

**Keyboard shortcuts**
- [x] Cmd+N (new note), Cmd+S (save) work in all three engines.
- [x] Cmd+Z / Cmd+Shift+Z (undo / redo) work in `hybrid-cm6`.
- [x] Cmd+= / Cmd+- / Cmd+0 (font-size) work in `hybrid-cm6` and `cm6`; preference persists across reload.
- [x] Arrow-Up / Arrow-Down navigate the note list when focus is outside text inputs.

**Dictionary lookup (`Cmd+Shift+D`)** — requires the local Dictionary macOS app running.
- [ ] Select a word in Write or Preview mode, press `Cmd+Shift+D` → Dictionary app popup shows a context-aware translation; the bottom-right pill briefly shows "Translating..." then returns to its prior state.
- [ ] Press `Cmd+Shift+D` with nothing selected → pill shows "Dictionary: select a word first" for ~2s, no popup, no note change.
- [ ] Quit the Dictionary app, then press `Cmd+Shift+D` on a selection → pill shows a "not running" error for ~3s; note content unchanged.
- [ ] Confirm the surrounding sentence/paragraph reaches the popup (e.g. a word with two meanings translates differently in two different sentences).

**IME / Chinese input**
- [x] Compose `中文标题` inside `# `, `**`, `~~`, and inside frontmatter under the new default. Confirm composition not interrupted; no first-character drop; no caret jump.

**Long-document responsiveness**
- [x] Open a ~10 000-line note. Confirm opens in ~2 seconds; typing remains responsive (no perceptible keystroke lag).
- [x] (Optional) Open a ~50 000-line note. Confirm opens within ~10 seconds; typing usable. If unusable, escalate per Stage 15 thresholds.

**Save All & Quit + close-guard + dirty state**
- [x] Dirty draft → close window → close-guard dialog appears with Cancel / Discard & Quit / Save All & Quit. Cancel keeps the app open; Save All & Quit saves and exits.
- [x] Edit two notes → Save All & Quit saves both, then quits.

**Filename collision + pre-vault draft**
- [x] Create a draft whose title collides with an existing vault filename → save is blocked with an error toast.
- [x] Edit a pre-vault draft → first Save opens OS folder picker → choose folder → save proceeds.

**Vault watcher**
- [x] Edit a file on disk outside the app → app auto-refreshes the note list / contents.

**Final automated regression sweep**
- [x] Re-run `cd apps/desktop && npm test` after the live-app QA. Expected: `907 / 905 / 2 / 0` (unchanged).
- [x] Re-run `cd apps/desktop && npm run test:perf`. Expected: `5 / 5 / 0 / 0` (unchanged).

### Stage 18 outcome summary (current state)

**Automated audit:** PASS — every entry in the automated regression contract above matched its expected counts at HEAD `9d7596a`, and the Step 1 coverage-gap inspection concluded no new anchor test is needed.

**Live-app manual QA:** PASS — every live-app bullet above passed on a real `npm run dev` build on macOS.

**Conclusion:** Stage 18 is accepted as a clean Branch A closure. Automated regression checks and live-app manual QA passed; no regression was found; no code or test change was required. The patch is documentation-only.

## Final share check  
  
- [ ] Another person could follow the docs  
- [ ] README is understandable  
- [ ] Install guide is understandable  
- [ ] MCP setup guide is understandable  
- [ ] Demo script is usable
