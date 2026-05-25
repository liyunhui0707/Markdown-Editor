# Markdown Vault App

A local-first desktop Markdown editor for macOS, built with Electron. Notes are stored as plain `.md` files on disk in a folder you choose — no cloud, no accounts, no hosted backend.

Aimed at developers and tech-savvy note-takers who want their notes as plain `.md` files on disk, edited under their full control.

The setup also integrates with the `mcp-note-ingest` MCP server (installed as a Claude Code plugin from the `workflow-and-MCP-and-plugins` marketplace) that lets AI tools write chat notes directly into the same vault.

> Status: usable for local development and early feedback. Not production-distributed. Inspired by simplified local-first Markdown editor workflows; not an Obsidian replacement.

## Headline guarantees

- **Raw Markdown is the source of truth.** The editor stores notes as plain `.md` files; `getText()` returns the raw Markdown text. The live-styling layer in Write mode is visual decoration only — no HTML is injected, no document is rewritten. Round-trip is at the LF / character level (CodeMirror normalizes line endings internally; exact on-disk byte equality is not promised for CRLF files).
- **Local-first.** Notes live in a folder you choose. No cloud, no accounts, no hosted backend.

## Screenshots

Screenshots will be captured before any wider public release and committed under `docs/assets/screenshots/`. No placeholder image binaries are checked in.

Planned shots:

```
docs/assets/screenshots/main-editor-write.png       — main window with sidebar and a note open in Write mode under the default hybrid-cm6 engine; engine label "CM6 Hybrid" visible
docs/assets/screenshots/main-editor-preview.png     — same note switched to Preview mode (Toast UI rendering)
docs/assets/screenshots/hybrid-cm6-live-styling.png — close-up of the editor pane showing several styled constructs (Setext heading, strikethrough, task list, link, horizontal rule)
docs/assets/screenshots/frontmatter-plain.png       — note that begins with YAML frontmatter showing the leading "---" rendered plain (Stage 14.9 contract)
docs/assets/screenshots/vault-picker.png            — empty-state / vault picker screen
docs/assets/screenshots/save-all-quit.png           — close-guard dialog (Cancel / Discard & Quit / Save All & Quit)
```

## Quick start

```bash
cd apps/desktop
npm install
npm run dev
```

See [Getting Started](#getting-started) below for build, test, and engine-selection details.

## Features

- Choose any local folder as a Markdown vault.
- Load `.md` files recursively from the selected vault.
- Create, edit, save, and delete notes.
- Notes are kept as normal Markdown files on disk — no proprietary format.
- Focused editor workspace with a collapsible sidebar (open by default).
- Filter notes by All Notes, AI Imports, Drafts, and Vault Files.
- Search by title, body, tags, source, file name, and relative path.
- Lightweight frontmatter parsing for `tags` and `source`.
- Seed a demo vault for local testing and demos.
- Watch the selected vault and refresh when Markdown files change on disk.
- Detect MCP-ingested notes by frontmatter `source` (claude/codex/chatgpt/gemini/ai). Older notes under `Inbox/AI Chats/YYYY/MM/` are still recognized by path for backward compatibility.
- Package a local macOS Electron build for testing.
- Adjustable editor text size with `Cmd/Ctrl + =`, `Cmd/Ctrl + -`, `Cmd/Ctrl + 0` (persists across launches).
- **AI Sessions search (Stage S4)** — when an AI Sessions note is open in Read mode, a sticky toolbar above the transcript provides in-transcript substring search with match counter and prev/next cycling. When the AI Sessions filter is active in the sidebar, the existing search input ALSO runs cross-session content search across every imported session's body; results render below the note list with match-count badges sorted by match count. The cross-session index builds lazily on the first query (with a small "Indexing sessions…" progress banner), is reused for subsequent queries, and is invalidated automatically on vault reload.
- **AI Sessions favorites + grouped view (Stage S5)** — the AI Sessions filter now renders sessions as a grouped tree: **Favorites** (when any; rendered flat) → **Codex** → **Claude** → **Other**. The three agent groups are bucketed by mtime: Today / Within 3 Days / Older Than 3 Days. Empty buckets are skipped. Click the ☆ on any session row to favorite it (★); favorites persist to `localStorage` and appear in a collapsible Favorites section at the top. Group headers collapse/expand on click and that state also persists. Cross-session search results (Stage S4) show the ★ indicator for favorited sessions. Other filters (All / Drafts / Vault / AI Imports) keep their flat list — only AI Sessions gets the grouped view. AI Imports and AI Sessions are disjoint: imported sessions appear only under AI Sessions, not under AI Imports.

### Data-safety guarantees

- Track unsaved state for drafts and vault notes with a visible dirty badge.
- Preserve draft content across note and vault switches — no silent data loss.
- Require vault selection before saving a pre-vault draft (OS folder picker opens automatically).
- Block app quit when unsaved work exists — close-guard dialog with Cancel, Discard & Quit, or Save All & Quit.
- Save All & Quit saves every dirty note and draft in one action before quitting.
- Block duplicate filenames and refuse to overwrite existing vault files on save.

## Editor modes

Each note has two display modes selected by the `Write` and `Preview` tab buttons above the editor (mouse-toggle only — no keyboard shortcut for the toggle).

- **Write mode** — type and edit Markdown source.
- **Preview mode** — Toast UI Editor renders the Markdown read-only.

Three Write engines exist in the codebase. The engine is resolved on load by `apps/desktop/lib/write-engine.js` in the following priority order:

1. URL query parameter: `?writeEngine=<name>`
2. `localStorage` key: `markdownVault.writeEngine = "<name>"`
3. Default: `hybrid-cm6`  (Stage 17; previously `cm6`)

| Engine | Status | Description |
|---|---|---|
| `hybrid-cm6` | **Default** | CodeMirror 6 with an additional live-Markdown decoration layer that styles common syntax in place (see list below). Promoted from experimental to default in Stage 17. |
| `cm6` | Fallback | CodeMirror 6 single-document adapter — Markdown editing with syntax highlighting, real undo/redo, real selection, Chinese IME support. Reachable via `?writeEngine=cm6` or by setting the `markdownVault.writeEngine` localStorage key to `cm6`. |
| `hybrid` | Legacy fallback | Stage 2 HybridWriteView (per-block textarea swap) plus Toast UI Preview. Retained as a fallback; removal is deferred. |

### Live styling in `hybrid-cm6` (default)

The hybrid-cm6 engine emits CSS-class decorations over the existing source text — purely visual, never modifying the document or generating HTML. Raw Markdown is the source of truth; `getText()` returns the raw Markdown source text without rendered HTML or decoration artifacts. (CodeMirror normalizes line endings internally, so source-text round-trip is at the LF / character level, not the exact on-disk byte level for CRLF files.)

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

- macOS
- Node.js
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

Opens the Electron window in development mode. The default Write engine is `hybrid-cm6` (Stage 17). To select a fallback engine, set the `markdownVault.writeEngine` localStorage key to `cm6` or `hybrid` in DevTools (`localStorage.setItem('markdownVault.writeEngine', 'cm6')` or `localStorage.setItem('markdownVault.writeEngine', 'hybrid')` — Electron has no normal address bar). The same fallback can also be selected by loading the window with `?writeEngine=cm6` or `?writeEngine=hybrid` in its URL.

### Build a local macOS app

```bash
cd apps/desktop
npm run pack            # unsigned dir build into apps/desktop/dist/
npm run dist:mac        # unsigned zip build for macOS
```

Build artifacts are written to `apps/desktop/dist/` and should not be committed.

### Building renderer bundles

The renderer loads two pre-built IIFE bundles checked into `apps/desktop/lib/`. Rebuild them after changing the corresponding entry file:

```bash
cd apps/desktop
npm run build:cm6       # rebuilds lib/cm6-bundle.js (used by cm6 + hybrid-cm6 engines)
npm run build:editor    # rebuilds lib/toastui-bundle.js (used by Preview + hybrid engine)
```

If you change `lib/cm6-entry.js` or `lib/editor-entry.js` and skip the rebuild, the running app will silently keep using the old bundle.

## Testing

The project uses the Node.js built-in test runner.

```bash
cd apps/desktop
npm test                       # full suite (test/, test/spike-cm6/, test/cm6-write-view/, test/session-import/)
npm run test:write-engine      # focused: Write engine resolver
npm run test:cm6-write-view    # focused: CM6 write adapters, hybrid-cm6 decorations, and bundle-entry source contracts
node --test test/session-import/*.test.mjs   # focused: ported Local-Web-Server importers (Stage S1a)
```

MCP smoke test (from the plugin source — clone `markdown-vault-app` if needed):

```bash
cd <markdown-vault-app>/plugins/mcp-note-ingest
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
| `Cmd/Ctrl + 0` | Reset editor text size to default (15px) |
| `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` | Undo / redo in CM6 Write mode |
| `Cmd + Shift + O` | Open the external link at the caret (macOS, hybrid-cm6 Write mode; CodeMirror binding `Mod-Shift-o`) |
| `Arrow Up` / `Arrow Down` | Navigate note list (when focus is outside text inputs) |
| `Enter` | (Stage S4) In the in-transcript search input — jump to next match |
| `Shift + Enter` | (Stage S4) In the in-transcript search input — jump to previous match |
| `Escape` | (Stage S4) In the in-transcript search input — clear the query and remove highlights |
| `Enter` / `Space` | (Stage S5) On a focused AI Sessions star button — toggle favorite; on a focused group header — collapse / expand the group |

The Write/Preview toggle is mouse-only — there is currently no global keyboard shortcut for it.

## MCP Note Ingestion

The `mcp-note-ingest` MCP server is installed as a Claude Code plugin via the `workflow-and-MCP-and-plugins` marketplace. Source for the plugin lives in this repo at `plugins/mcp-note-ingest/`.

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
- **Session import (developer preview, Stage S1a)** — two CLI scripts under `apps/desktop/tools/session-import/` import Claude Code (`~/.claude/projects/<project>/<uuid>.jsonl`) and Codex CLI (`~/.codex/sessions/YYYY/MM/DD/rollout-…<uuid>.jsonl`) session transcripts into markdown files under `~/agent-sessions/<agent>/`. Run from `apps/desktop/`:

  ```bash
  npm run session-import:claude   # imports ~/.claude/projects/**/*.jsonl
  npm run session-import:codex    # imports ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
  SESSION_ROOT=/some/other/dir npm run session-import:claude   # override output root
  SESSION_IMPORT_MAX_BYTES=1048576 npm run session-import:claude   # override 50 MB cap
  ```

  The output is a faithful port of `Local-Web-Server/tools/import-{claude,codex}.js` — byte-for-byte parity with upstream output except for a single inserted `source: claude` / `source: codex` line added immediately after `agent:` (so the existing AI Imports filter recognizes the imported notes). Security guarantees mirror upstream verbatim: `O_NOFOLLOW` open, post-open dev/ino TOCTOU check, ancestor-symlink rejection on the output chain, `0o600` files / `0o700` directories, atomic tmp+rename with 5× `EEXIST` retry. No UI integration at this stage; the right-side AI Imports panel is deferred to Stage S2.

- **AI Sessions search (Stage S4)** — port of `Local-Web-Server/public/search-utils.js` into the desktop renderer. Split into three IIFE-wrapped modules under `apps/desktop/lib/session-viewer/` to stay under the project's 300-LOC cap:
  - `search-dom.js` — pure DOM walk that wraps matches in `<mark>` via `createElement` + `createTextNode` (never `innerHTML`); clears highlights by coalescing sibling text nodes; flips an `mark--active` class to mark the currently-focused result.
  - `search-index.js` — lazy in-memory index over imported session bodies. `buildGlobalIndex` runs with bounded concurrency; `searchIndex` returns `{id, title, mtime, matchCount}` rows sorted by match count then mtime; `MIN_GLOBAL_QUERY_LEN = 2`.
  - `in-file-search-toolbar.js` — headless controller for the Read-mode toolbar. Input → walk + counter; prev/next → cycle + scroll-into-view; Enter / Shift+Enter mirror the buttons; Escape clears.

  Index lifecycle (in `apps/desktop/index.html`) holds two invariants:
  - Single-flight: a `pendingCrossSessionIndexBuild` promise is reused across rapid keystrokes so two input events never kick two builds.
  - Generation-stamped: `currentNotesGeneration` bumps on every successful `loadVaultNotes`; the index records its build-time generation in its `.then()`, and a post-await guard forces a rebuild on any mismatch so a mid-build vault refresh can't yield stale results. The index is also reset on `stopWatchingVault`.

  Outgoing edits are preserved across cross-session result clicks via a shared `selectNote(noteId)` helper that runs `liveEditorInstance.exitWriteMode()` + `bodyForRead(outgoingNote)` BEFORE reassigning `selectedNoteId` — the same flush path the note-list row click uses, so the cross-session jump is data-safe.

- **AI Sessions favorites + grouping (Stage S5)** — port of `Local-Web-Server/public/grouping.js` (verbatim) + the favorites helpers from `view-state.js` lines 76–124. Three IIFE-wrapped modules under `apps/desktop/lib/session-viewer/`:
  - `favorites.js` — `createFavoritesController({ storage, key })` returning `{ isFavorite, toggle, getAll, clear, size }`. Pure helpers (`loadFavoritesFromStorage`, `saveFavoritesToStorage`, `toggleFavorite`) remain on the api for direct testing. localStorage key is namespaced as `markdownVault.aiSessions.favorites`.
  - `grouping.js` — `groupAndSort(items, { sort, today, isFavorite })` returning `{ favorite?, codex, claude, other, counts }`. `LAYER_ORDER` is `today / w3 / older` (3-layer scheme — simplified from upstream's 5-layer based on round-2 user feedback). `localEpochDay` is timezone-aware. The editor's port bucketizes **all** agent groups including `other` (uniform tree shape; intentional divergence from upstream which leaves `other` flat). The Favorites overlay is rendered flat (not bucketed) so starred sessions are reachable in one glance.
  - `grouped-list-renderer.js` — headless renderer. Builds collapsible group + bucket + row DOM via `createElement` + `createTextNode` (no `innerHTML`). Star-click handlers call `stopPropagation` so toggling a row's star doesn't also fire the row's selection click. Group-header collapse state is stored in a renderer-injected `isCollapsed` callback so the caller owns persistence.

  The grouped tree replaces the flat AI Sessions list only when `currentFilter === 'sessions'`; all other filters keep the existing flat-list code path unchanged. Notes are adapted into the grouping item shape via an in-renderer `notesToSessionItems(notes)` + `relPathToAgent(relativePath)` pair (the agent prefix rules mirror `sessions-filter.js`).

## Project status & maturity

**What works**

- Local vault workflow: choose any folder, load `.md` files recursively, create / edit / save / delete notes.
- Save / load round-trip preserves raw Markdown source.
- Dirty-state tracking and close-guard dialog (Cancel / Discard & Quit / Save All & Quit) protect unsaved work.
- Live-styled Write mode under the default `hybrid-cm6` engine; Preview mode via Toast UI Editor.
- All three engines (`hybrid-cm6`, `cm6`, `hybrid`) selectable via URL query or `markdownVault.writeEngine` localStorage key.
- MCP ingest writes AI-chat notes into a fixed local Inbox folder (default `/Users/liyunhui/Liyunhui/Inbox/`; overridable via `MCP_INGEST_TARGET_DIR`).
- Stage 18 stabilization QA passed — clean Branch A closure (see `docs/test-manual.md` Stage 18 section).
- Automated test suite at `tests 907, pass 905, skipped 2, fail 0` (`npm test`); perf opt-in suite at `5 / 5 / 0 / 0` (`npm run test:perf`).

**What's still evolving**

- Screenshots not yet captured (planned paths listed above under "Screenshots").
- Packaging is currently macOS-only.
- No code-signing guidance yet.
- Broader release polish (issue-reporting pointer, additional `docs/assets/` artifacts).

**What's not supported**

- No clickable links / autolinks in Write mode (they render as visual underline only).
- No real image preview in Write mode (`![alt](url)` shows styled alt text; no image is fetched).
- No interactive task checkboxes (`[ ]` / `[x]` are dimmed but not clickable).
- No full table rendering in Write mode — tables work in Preview only.
- No math syntax (`$x$`, `$$…$$`).
- No footnote support.
- No cross-platform packaging.
- No sync, no accounts, no hosted backend.
- Not a WYSIWYG editor.

**How to run tests** — see the [Testing](#testing) section.

## Known limitations

- The packaged build workflow is currently macOS-focused.
- No built-in sync across devices.
- No account system or hosted backend.
- No plugin system, graph view, or backlinks UI.
- Not a WYSIWYG editor. Write mode always edits Markdown source — `hybrid-cm6` adds visual decorations on top, it does not replace the source with a rendered view.
- Write mode does not currently support:
  - Full table rendering (the GFM `Table` parser nodes exist but are not styled by hybrid-cm6 — pipes stay raw; switch to Preview for table rendering).
  - Math syntax (`$x$`, `$$…$$`) — no parser or renderer.
  - Footnotes (`[^1]` and `[^1]: …`) — no parser support.
  - Real image preview (`![alt](url)` shows alt text styled but does not load the image).
  - Clickable links / autolinks (text is underlined but never navigates).
  - Interactive task checkboxes (`[ ]` / `[x]` are dimmed but not toggled by clicking).
- The `hybrid-cm6` engine became the default in Stage 17. The plain `cm6` adapter and the legacy `hybrid` engine remain available as fallbacks via `?writeEngine=cm6` / `?writeEngine=hybrid` or by setting the `markdownVault.writeEngine` localStorage key to the matching value. Users who had the `markdownVault.writeEngine` localStorage key set to `"cm6"` before Stage 17 continue to get `cm6`.
- The app is intended for local testing and early feedback, not production distribution.

### Deferred items

- Hybrid editor removal (`hybrid-cm6` is the default; both `cm6` and legacy `hybrid` remain as fallbacks).
- CodeMirror 6 spike code cleanup.
- Claude Design prototype.
- Auto-save.
- Multi-window support.

## Roadmap / future work

Not committed to dates. Items listed roughly in priority order:

- ~~Hybrid-cm6 default-readiness sequence~~ — completed in Stage 17. `hybrid-cm6` is now the default Write engine; `cm6` and legacy `hybrid` remain selectable fallbacks.
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
        ├── Write engine resolver (lib/write-engine.js) → cm6 | hybrid-cm6 | hybrid
        ├── Write surface
        │     ├── cm6              → lib/cm6-write-view.js + lib/cm6-bundle.js
        │     ├── hybrid-cm6       → lib/cm6-hybrid-view.js (decoration walker over the same bundle)
        │     └── hybrid (legacy)  → lib/hybrid-write-view.js + Toast UI textarea per block
        ├── Preview surface        → Toast UI Editor (lib/toastui-bundle.js, read-only renderer)
        ├── Dirty-state tracking   → lib/dirty-state.js + close-guard.js
        └── Note list, search, filters, status bar (in index.html)
```

The hybrid-cm6 walker is intentionally limited to `Decoration.mark` over the existing source — no widgets, no `Decoration.replace`, no document mutation, no HTML generation. Source text is the source of truth; decorations are visual only.

## Project Structure

```text
apps/desktop/             Electron desktop app
apps/desktop/lib/         Editor, vault, and renderer helper modules
apps/desktop/test/        Desktop app tests (incl. test/session-import/ for the Stage S1a importer port)
apps/desktop/tools/       Developer CLI tools (currently: session-import/ — Local-Web-Server importer port)
apps/desktop/spike/       CM6 spike artifacts (deferred cleanup)
plugins/mcp-note-ingest/  MCP plugin (note ingestion; distributed via the workflow-and-MCP-and-plugins marketplace)
plugins/workflow-orchestrator/  Engineering-workflow orchestrator plugin (same marketplace)
docs/                     Install, MCP, demo, roadmap, and test-manual docs
```

## Documentation

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
