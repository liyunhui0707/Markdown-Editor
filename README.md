# Markdown Vault App

A local-first desktop Markdown editor for macOS, built with Electron. Notes are stored as plain `.md` files on disk in a folder you choose — no cloud, no accounts, no hosted backend.

The repository also ships an optional local MCP server (`tools/mcp-note-ingest/`) that lets AI tools write chat notes directly into the same vault.

> Status: usable for local development and early feedback. Not production-distributed. Inspired by simplified local-first Markdown editor workflows; not an Obsidian replacement.

## Screenshots

Not yet included. Add screenshots before any wider public release.

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
- Detect MCP-ingested notes under `Inbox/AI Chats/YYYY/MM/`.
- Package a local macOS Electron build for testing.
- Adjustable editor text size with `Cmd/Ctrl + =`, `Cmd/Ctrl + -`, `Cmd/Ctrl + 0` (persists across launches).

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
3. Default: `cm6`

| Engine | Status | Description |
|---|---|---|
| `cm6` | **Default** | CodeMirror 6 production adapter — single-document Markdown editing with syntax highlighting, real undo/redo, real selection, Chinese IME support. |
| `hybrid-cm6` | Experimental | CodeMirror 6 with an additional live-Markdown decoration layer that styles common syntax in place (see list below). |
| `hybrid` | Legacy fallback | Stage 2 HybridWriteView (per-block textarea swap) plus Toast UI Preview. Retained while CM6 stabilizes; removal is deferred. |

### Live styling in `hybrid-cm6` (experimental)

The hybrid-cm6 engine emits CSS-class decorations over the existing source text — purely visual, never modifying the document or generating HTML. Currently styled:

- ATX headings `#` … `######`
- Bold `**…**` and italic `*…*` / `_…_`
- Inline code `` `…` ``
- Inline links `[text](url)` — rendered as underlined link-text, **non-clickable** (no `<a>`, no `href`, no navigation)
- List markers (`-`, `*`, `+`, `1.`) and blockquote markers (`>`) — dimmed, always visible
- Fenced code fences (```` ``` ```` / `~~~`) and the optional language info string — dimmed
- Horizontal rules (`---`, `***`, `___`)
- Strikethrough `~~…~~` (line-through; `~~` delimiters hide off the active line and reveal dimmed when the caret enters)
- Task list markers `[ ]`, `[x]`, `[X]` — dimmed; **not interactive**
- Autolinks `<https://…>`, `<mailto:…>`, raw `<email@host>`, and bare URLs (`https://example.com`) — underlined; angle brackets share the same hide/reveal mechanism. **Not clickable.**

Image URLs and link-reference definition URLs are intentionally not autolink-styled.

## Local-first storage

Notes are plain Markdown files in a folder of your choosing. The app does not include cloud sync, accounts, hosted storage, or a remote backend. Drafts created before a vault is selected live in memory until the OS folder picker is used at first save.

Before publishing or sharing the repository, do not commit personal vault content, `.env` files, local MCP config, generated builds, dependency folders, logs, or private assistant/editor settings.

## Tech Stack

- Electron (desktop shell)
- Node.js (renderer + main + tests)
- CodeMirror 6 (`@codemirror/*`) — default Write engine
- `@lezer/markdown` — Markdown parser; the `Strikethrough` extension is enabled in `lib/cm6-entry.js`
- Toast UI Editor (`@toast-ui/editor`) — Preview renderer; also powers the `hybrid` legacy Write engine
- `marked` — Markdown utility
- Node.js built-in test runner
- Local MCP stdio server (`tools/mcp-note-ingest/`)

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

Opens the Electron window in development mode. To select a non-default Write engine, set `markdownVault.writeEngine` to `hybrid-cm6` or `hybrid` in DevTools localStorage (Electron has no normal address bar). The same value is also accepted as a `?writeEngine=hybrid-cm6` query string when the window is loaded with one.

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
npm test                       # full suite (all .test.js under test/, test/spike-cm6/, test/cm6-write-view/)
npm run test:write-engine      # focused: Write engine resolver
npm run test:cm6-write-view    # focused: CM6 write adapters, hybrid-cm6 decorations, and bundle-entry source contracts
```

MCP smoke test:

```bash
cd tools/mcp-note-ingest
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
| `Arrow Up` / `Arrow Down` | Navigate note list (when focus is outside text inputs) |

The Write/Preview toggle is mouse-only — there is currently no global keyboard shortcut for it.

## MCP Note Ingestion

The repository includes a local MCP server in `tools/mcp-note-ingest/`.

The main tool is:

```text
ingest_chat_markdown
```

It writes Markdown files into the selected vault under:

```text
Inbox/AI Chats/YYYY/MM/
```

See `docs/mcp-ingest-setup.md` for setup details.

## Experimental features

- **`hybrid-cm6` Write engine** — see "Editor modes" above. Live styling layer; not the default. Behavior may change.
- **CM6 spike artifacts** — `apps/desktop/spike/` and `apps/desktop/lib/spike-cm6-*` remain in the tree for spike reproducibility (`npm run spike:cm6`, `npm run test:spike-cm6`). They are not consumed by the production app at runtime. Cleanup is deferred.

## Known limitations

- The packaged build workflow is currently macOS-focused.
- No built-in sync across devices.
- No account system or hosted backend.
- No plugin system, graph view, or backlinks UI.
- Live styling in `hybrid-cm6` is visual-only — no clickable links, no interactive checkboxes, no images, no tables.
- The app is intended for local testing and early feedback, not production distribution.

### Deferred items

- Hybrid editor removal (CM6 is the default; Hybrid remains as a fallback).
- CodeMirror 6 spike code cleanup.
- Claude Design prototype.
- Auto-save.
- Multi-window support.

## Roadmap / future work

- Add screenshots and a polished release checklist.
- Broaden automated coverage for vault file operations.
- Improve metadata editing and frontmatter handling.
- Expand packaging and signing guidance.
- Continue incremental hybrid-cm6 live-styling coverage.

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
apps/desktop/test/        Desktop app tests
apps/desktop/spike/       CM6 spike artifacts (deferred cleanup)
tools/mcp-note-ingest/    Local MCP server for note ingestion
docs/                     Install, MCP, demo, roadmap, and test-manual docs
```

## Documentation

- `docs/install.md` — install and run guide
- `docs/mcp-ingest-setup.md` — MCP setup guide
- `docs/demo-script.md` — demo walkthrough
- `docs/test-manual.md` — manual release checklist (includes per-stage QA sections)
- `docs/roadmap.md` — roadmap notes
- `docs/stage-history.md` — completed stages and deferred items (partial; not all sub-stages are tracked)

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
