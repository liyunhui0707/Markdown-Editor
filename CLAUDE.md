# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current architecture (updated 2026-06-07) — READ FIRST

**Active direction: ProseMirror/Tiptap WYSIWYG.** The desktop editor's WYSIWYG
work has pivoted to a ProseMirror/Tiptap surface (vmark-style). Raw Markdown is
still the source of truth, but the WYSIWYG editor serializes back to Markdown via
a `remark`/`unified` bridge; CodeMirror 6 is kept as a separate **Source mode**.
New work lands on the `wysiwyg-prosemirror` branch; the first slice is an opt-in
`tiptap` Write engine (paragraphs, headings, emphasis, lists, blockquote, fenced
code; tables/math/mermaid deferred).

**Relaxed invariant:** Markdown round-trip is now **remark-normalized, not
byte/character-identical**. This deliberately supersedes the older
"character-identical round-trip" guarantee stated for `hybrid-cm6-lp` below.

**SUPERSEDED — `hybrid-cm6-lp` (CM6-decoration live preview, Stages A–G.13).**
Merged to `main` via PR #133 (`bd1aa33`) and retained only as a base / future
Source mode. It is **no longer the WYSIWYG direction**: do not resume patching
its click/caret/reflow behavior (abandoned by design — CodeMirror cannot host
arbitrary-height render-only block nodes without layout reflow). Everything in
the "Architecture" section below about `hybrid-cm6` / `hybrid-cm6-lp` is
**historical reference**. Reviewers and agents (including Codex): when the task
concerns WYSIWYG, the ProseMirror direction here overrides any `hybrid-cm6-lp`
text further down.

## Commands

All npm commands run from `apps/desktop/` unless noted.

```bash
cd apps/desktop
npm install
npm run dev                      # launch Electron in development
npm test                         # full Node built-in test runner suite
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
npm run build:spike-cm6  # rebuilds lib/spike-cm6-bundle.js (spike only)
```

Packaging (macOS, unsigned):

```bash
npm run pack             # dir build to apps/desktop/dist/
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
apps/desktop/lib/dirty-state.js         Unsaved-state tracking
apps/desktop/lib/close-guard.js         Quit-with-unsaved-work dialog
```

Four Write engines coexist. Resolution priority (`lib/write-engine.js`): `?writeEngine=<name>` URL param → `localStorage.markdownVault.writeEngine` → default `hybrid-cm6`. Valid names: `hybrid-cm6` (default), `cm6` (fallback), `hybrid` (legacy fallback), `hybrid-cm6-lp` (Stage A live-preview opt-in).

**Core invariant: raw Markdown is the source of truth (applies to BOTH `hybrid-cm6` and `hybrid-cm6-lp`).** `getText()` returns raw Markdown verbatim; no decoration mutates the document; no HTML is generated; round-trip is character-identical at the LF level (CodeMirror normalizes line endings, so CRLF byte-equality is not promised).

- **`hybrid-cm6` (legacy default)** — uses `Decoration.mark` ONLY. No widgets, no `Decoration.replace`. Marker visibility is driven by CSS `display: none` on `.cm-md-syntax`, revealed via the `.cm-activeLine` / `.cm-md-active-range` selectors.
- **`hybrid-cm6-lp` (CM6-decoration live preview, Stages A–G.13) — SUPERSEDED.** Extended `hybrid-cm6` with `Decoration.replace` + `WidgetType` widgets to render inline images, GFM tables, KaTeX math, highlight.js fenced code, and Mermaid diagrams off the active line; block-level widgets are delivered via a CodeMirror `StateField` (not a `ViewPlugin`, which CM6 forbids for block decorations). Retained only as a base / future Source mode — the active WYSIWYG direction is ProseMirror/Tiptap (see "Current architecture" at the top). Per-stage detail lives in `docs/stage-history.md` (documented through G.3).

The hybrid-cm6 walker styles a subset of `@lezer/markdown` nodes (ATX/Setext headings, bold/italic, inline code, links, images, lists, blockquotes, fenced code, HR, tables, strikethrough, task list, autolinks, YAML frontmatter). The "hide off the active line / reveal on the active line" reveal mechanism follows the full selection — every line touched by selection or cursor reveals its markers (see README's "Live styling in hybrid-cm6" for the full per-construct spec and the construct-active scoping rules across Stages 26–34).

Task list `[ ]` ↔ `[x]` toggle (primary click on marker, or `Cmd-Shift-X` on macOS) and Cmd-click link opening (allowlist: `https:` and `mailto:` only) are real Markdown edits routed through `onChange` → dirty state → undo/redo.

## Plugins

The Claude Code plugins that used to live in this repo's `plugins/` were
**extracted to a standalone repo at `~/Liyunhui/Codes/claude-plugins`** (2026-06-07)
because they are cross-project tooling; history was preserved via `git subtree
split`. Claude Code loads them via the `workflow-and-MCP-and-plugins` directory
marketplace, which now points at that path (not this repo).

- `mcp-note-ingest` — MCP server that writes AI chat notes into a fixed local Inbox directory. Target overridable via `MCP_INGEST_TARGET_DIR` env var. Distributed via the `workflow-and-MCP-and-plugins` marketplace.
- `workflow-orchestrator` — engineering-workflow orchestrator plugin (skills + bin + servers, including the bundled `codex-bridge` MCP).
- `mcp-chat-rag` — MCP server for local RAG over Claude Code session history; registered separately at project scope (not via the marketplace).

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
- The app version lives in `apps/desktop/package.json` (currently `0.1.0`, pre-1.0).
- Follow SemVer (`MAJOR.MINOR.PATCH`). Pre-1.0 rules: bump **patch** for bug fixes, **minor** for user-visible features or a new stage's worth of behavior, **major** only when cutting `1.0.0` (the "ready for daily use by others" signal).
- Before committing, propose the version bump in the same commit as the change. Map by intent, not line count:
  - Bug fix only → patch (`0.1.0` → `0.1.1`)
  - New stage / user-visible feature → minor (`0.1.0` → `0.2.0`)
  - Internal refactor with no behavior change → no bump
- After the bump commit lands on `main`, tag it: `git tag v0.X.Y && git push --tags`. Tagging is a destructive-ish action — confirm with the user before pushing tags.
- The extracted plugins (now in `~/Liyunhui/Codes/claude-plugins`) have **independent** versions. Do not bump them in lockstep with the app.

### AI workflow
- Claude may implement.
- Codex should audit important diffs.
- Human makes final decisions.
