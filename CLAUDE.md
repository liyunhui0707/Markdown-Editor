# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

MCP ingest plugin smoke test:

```bash
cd plugins/mcp-note-ingest && npm run smoke
```

## Architecture

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
- **`hybrid-cm6-lp` (Stages A + B + C + D + E + F + G.1 + G.2 + G.3 live-preview)** — extends the `Decoration.mark` invariant with `Decoration.replace` AND `WidgetType` widgets for inline markers PLUS Decoration.replace for block-level markers PLUS multi-line block widgets for GFM tables PLUS KaTeX math rendering (inline `$x$` and display `$$x$$`) PLUS fenced-code syntax highlighting via highlight.js PLUS Mermaid diagram rendering for ` ```mermaid ` fenced blocks (first async-render widget). **Stage G.3 architectural fix**: multi-line block widgets (Stage E table, Stage F display math, Stage G.1 fenced code, Stage G.2 mermaid — all using `Decoration.replace({block: true})`) must be delivered via a CodeMirror 6 `StateField`, NOT a `ViewPlugin`. CM6 enforces this with a runtime `RangeError("Block decorations may not be specified via plugins")`. Stage G.3 moves all `block: true` emissions out of `cm6-lp-block.js` (ViewPlugin) into the new `cm6-lp-block-widgets.js` (StateField). `cm6-lp-block.js` retains only Stage D's line-internal HeaderMark / ListMark / QuoteMark replaces, which are inline decorations and remain ViewPlugin-safe. `cm6-entry.js` was extended to export `StateField` on `window.CM6Production` and `cm6-bundle.js` was rebuilt. Regression test `cm6-lp-block-widgets.test.js` constructs an `EditorState` with the StateField + a doc containing all four block-widget kinds and asserts `EditorState.create` does NOT throw — the pure-function tests in the prior render-integration files never triggered CM6's block-decoration check because they call `buildBlockWidgetDecorations` directly without mounting a view. Stage A covered emphasis (`*`, `_`, `**`, `__`); Stage B extended to four additional inline marker categories (inline-code backticks, strikethrough `~~`, inline-link brackets/parens/URL/title, and inline-image MARKUP). **Stage C is the first stage where lp produces RENDERED CONTENT the default engine cannot**: inline images (`![alt](url)`) off-active are replaced by an `InlineImageWidget` that renders an actual `<img>` element. Stage C introduces three new architectural surfaces all subsequent widget stages (E tables, F math, G mermaid) will reuse: (1) `WidgetType` for actual DOM rendering (not just empty placeholders); (2) URL/path security allowlist (`isSafeImageUrl`: `https:`, `data:image/*` with MIME allowlist, vault-relative paths; rejects `http:`/`javascript:`/`file:`/`chrome-ext:`/`blob:` + null bytes + absolute paths); (3) IPC contract `resolve-image-path` for vault-relative resolution with typed reason codes mirroring Retrofit #1, symlink-safe filesystem reads mirroring `tools/session-import/lib/safe-read.mjs` (O_NOFOLLOW + fdStat identity check + realpath containment). **Stage D extends the Decoration.replace + atomicRanges pattern to three block-level marker categories**: ATX heading prefix (`HeaderMark` with parent guard `ATXHeading1..6` excluding SetextHeading1/2 underlines), list bullets (`ListMark` — sibling `TaskMarker` exempt per Stage 23), and blockquote `>` (`QuoteMark` — multi-line blockquote uses per-line active-line resolution). HorizontalRule is intentionally OUT of Stage D scope (would require an `<hr>` widget; deferred to a focused future stage). **Stage E renders GFM tables as actual HTML `<table>` grids off-active via a new multi-line block `TableWidget` (`Decoration.replace({block: true})`)**: walks the Lezer `Table` node's `TableHeader` / `TableDelimiter` (parent=Table) / `TableRow` children, parses GFM alignment from the delimiter row (`:---` / `---:` / `:---:`), builds `<table>/<thead>/<tbody>/<tr>/<th>/<td>` via `document.createElement` + `textContent` (XSS-safe — no `innerHTML`). Cell text rendered as PLAIN text (inline markdown inside cells is NOT rendered — deferred follow-on). Table-level active resolution: caret on ANY line of the Table → emit no widget → walker source returns. Cell extraction splits row source on `|` (not via TableCell children, since Lezer's GFM parser silently drops empty/whitespace-only TableCell nodes — splitting preserves column alignment for `| a |  | c |`). Off-active-line for non-image/non-table categories: `Decoration.replace` with an empty widget + `EditorView.atomicRanges` so arrow-key motion is atomic. On-active-line for ALL categories: lp emits nothing; the hybrid walker's existing `Decoration.mark` + existing CSS reveals dimmed. The raw-Markdown-as-source-of-truth invariant is preserved: no `Decoration.replace` mutates the document, even with real `<img>` and `<table>` rendering. **Stage F adds KaTeX math rendering** — inline `$x$` and display `$$x$$` source ranges off-active render as actual TeX via KaTeX. `$` is not a CommonMark / GFM syntax character; Lezer's parser does not emit Math nodes, so Stage F introduces a regex-based detector (`cm6-lp-math-detect.js` → `parseMath(docText)`) that respects Pandoc rules (no whitespace adjacent to `$` fences; `\$` escape; display `$$...$$` may span multiple lines; precedence: display first, then inline in gaps). Caller-side Lezer-aware filtering skips matches inside `InlineCode` / `FencedCode` / frontmatter. Inline math integrates via `cm6-lp-inline.js`; display math integrates via `cm6-lp-block.js` (`block: true` decoration). KaTeX is vendored to `lib/vendor/katex/` (CSS + JS + woff2 fonts ~3 MB total). KaTeX called with `throwOnError: false` + `trust: false` and wrapped in try/catch; invalid TeX produces a styled `cm-md-lp-math-error` placeholder showing raw source. **Stage F is the first lp stage to add a new npm dependency** (`katex@^0.16`) — a deliberate exception to the prior no-new-dependencies rule, accepted because no pure-JS path produces actual TeX. **Stage G.1 adds fenced-code syntax highlighting via highlight.js** — Lezer's `@lezer/markdown` already emits `FencedCode > CodeMark + CodeInfo + CodeText + CodeMark`, so no regex layer is needed (in contrast to Stage F's math). The Stage G.1 branch in `cm6-lp-block.js` walks each `FencedCode` node, extracts the language from `CodeInfo` and the body from `CodeText`, and emits ONE `Decoration.replace({block: true})` with a `CodeBlockWidget`. The widget wraps in `<pre class="cm-md-lp-code-block"><code class="hljs language-{lang}">` and calls `hljs.highlight(code, {language, ignoreIllegals: true})` for known languages; for unknown / missing language OR when hljs throws, falls back to plain `textContent`. highlight.js is vendored to `lib/vendor/highlight/highlight.min.js` (~157 KB minified — common-languages bundle covering ~30 popular languages) + one default theme `hljs.css` (atom-one-light). New `build:hljs` npm script uses esbuild to produce the bundle from `lib/highlight-entry.js`. Whole-block active resolution mirrors Stage E tables + Stage F display math. Mermaid (` ```mermaid ` blocks rendered as diagrams) deferred to Stage G.2 — they need an async-render surface that differs meaningfully from sync hljs. **Stage G.2 adds Mermaid diagram rendering** for ` ```mermaid ` fenced blocks — the FIRST lp stage with an async-render widget. Mermaid's API is `mermaid.render(id, source) → Promise<{svg: string}>`; the widget's `toDOM()` is sync (CM6 requires the element immediately), so the widget returns a `<div class="cm-md-lp-mermaid">` container synchronously, kicks off the render Promise, and patches `container.innerHTML = result.svg` when the Promise resolves. Async safety via a `destroyed` flag set in the widget's `destroy()` lifecycle — late-arriving Promise callbacks become no-ops after CM6 removes the widget (mirrors Stage C's InlineImageWidget for vault-relative IPC). Lang dispatch happens in `cm6-lp-block.js`'s FencedCode branch: when `lang === 'mermaid'` AND the widget module is loaded, the MermaidWidget is chosen; otherwise the Stage G.1 CodeBlockWidget renders the block. Mermaid is vendored to `lib/vendor/mermaid/mermaid.min.js` (~3 MB minified — the full Mermaid bundle covering flowchart, sequence, gantt, class, state, ER, journey, etc.). New `build:mermaid` npm script uses esbuild to produce the bundle from `lib/mermaid-entry.js`, which calls `mermaid.initialize({startOnLoad: false, securityLevel: 'strict', theme: 'default'})` at module load. The `securityLevel: 'strict'` setting rejects HTML in user content + sanitizes SVG output (no `<script>`, no inline event handlers). Error handling: missing mermaid global → raw source via textContent; sync throw → styled `cm-md-lp-mermaid-error` placeholder with raw source + error title; rejected Promise → same error placeholder via the destroyed-flag-guarded reject handler. Stage H (promotion to default) remains upcoming.

The hybrid-cm6 walker styles a subset of `@lezer/markdown` nodes (ATX/Setext headings, bold/italic, inline code, links, images, lists, blockquotes, fenced code, HR, tables, strikethrough, task list, autolinks, YAML frontmatter). The "hide off the active line / reveal on the active line" reveal mechanism follows the full selection — every line touched by selection or cursor reveals its markers (see README's "Live styling in hybrid-cm6" for the full per-construct spec and the construct-active scoping rules across Stages 26–34).

Task list `[ ]` ↔ `[x]` toggle (primary click on marker, or `Cmd-Shift-X` on macOS) and Cmd-click link opening (allowlist: `https:` and `mailto:` only) are real Markdown edits routed through `onChange` → dirty state → undo/redo.

## Plugins

- `plugins/mcp-note-ingest/` — MCP server that writes AI chat notes into a fixed local Inbox directory. Target overridable via `MCP_INGEST_TARGET_DIR` env var. Distributed via the `workflow-and-MCP-and-plugins` Claude Code marketplace.
- `plugins/workflow-orchestrator/` — engineering-workflow orchestrator plugin (skills + bin + servers).

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
- `plugins/*/package.json` have **independent** versions. Do not bump them in lockstep with the app.

### AI workflow
- Claude may implement.
- Codex should audit important diffs.
- Human makes final decisions.
