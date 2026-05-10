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

- [ ] Default write surface is CodeMirror 6 (styled-source Markdown)
- [ ] Undo and redo work correctly in CM6 mode
- [ ] Chinese IME composition does not drop the first character in CM6 mode
- [ ] Append `?writeEngine=hybrid` to the dev URL → Hybrid write view loads instead
- [ ] Hybrid Preview renders Markdown correctly

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
- [ ] Bullet markers `-`, `*`, `+` and ordered `1.`, `1)` — dimmed but always visible
- [ ] `- [ ]`, `- [x]`, `- [X]` task markers — dimmed; clicking does NOT toggle the checkbox
- [ ] `>` blockquote markers — dimmed but always visible; nested `> >` keeps each level dimmed

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
- [ ] **Default CM6** (`?writeEngine=cm6`): open every fixture above — editor doesn't crash; no `cm-md-*` decoration classes; default CM6 syntax coloring is acceptable
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
- [ ] **Default CM6 engine** (`?writeEngine=cm6`) opening a note containing `~~x~~` — editor does not throw; no `cm-md-strikethrough` decoration; no `~~` hide/reveal. Default syntax highlighting may color the tokens — that is acceptable. The invariant is: no hybrid live-decoration behavior and no jarring visual regression.
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
- [ ] **Default CM6 engine** (`?writeEngine=cm6`) opening a note containing `- [ ] todo` — editor does not throw; no `cm-md-task-marker` decoration; no jarring visual regression. Default syntax coloring is acceptable.
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
- [ ] **Default CM6 engine** (`?writeEngine=cm6`) opening a note containing `<https://example.com>` and a bare URL — editor doesn't crash; no `cm-md-autolink-url` / `cm-md-autolink-mark` decorations applied. Default syntax coloring is acceptable.
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
- [ ] **Default CM6 engine** (`?writeEngine=cm6`) opening a note containing `![alt](pic.png)` — editor doesn't crash; no `cm-md-image-alt` / `cm-md-image-mark` decoration applied. Default syntax coloring is acceptable.
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
- [ ] **Default CM6 engine** (`?writeEngine=cm6`) opening a note containing `[text][ref]` and `[ref]: url` — editor doesn't crash; no `cm-md-reflink-text` / `cm-md-reflink-mark` / `cm-md-link-def` decoration applied.
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
- [ ] **Default CM6 engine** (`?writeEngine=cm6`) opening a note with Setext headings — editor doesn't crash; default CM6 syntax coloring acceptable; no `cm-md-h1` / `cm-md-h2` / `cm-md-heading-mark` decoration applied by hybrid-cm6.
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
- [ ] **Default CM6** (`?writeEngine=cm6`): same notes open without crashing; no `cm-md-*` decoration applied (default CM6 doesn't use the hybrid walker).
- [ ] **IME:** type `---`, Enter, `中文标题`, Enter, `---` — IME composition is not interfered with.
- [ ] **Edit-into-non-frontmatter:** delete the closing `---` of frontmatter — the leading `---` flips to a thematic break (parser sees no closing fence; detection returns null; HR styling reappears). Source changed, decoration follows source.

## Final share check  
  
- [ ] Another person could follow the docs  
- [ ] README is understandable  
- [ ] Install guide is understandable  
- [ ] MCP setup guide is understandable  
- [ ] Demo script is usable
