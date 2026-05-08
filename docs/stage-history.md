# Stage History

Concise record of completed stages, their key deliverables, and known deferred items.

## Completed stages

| Stage | Title | Status | Key deliverables |
|---|---|---|---|
| 1 | Electron shell | Done | App window, vault picker, note list, basic save/load |
| 2 | HybridWriteView | Done | Markdown write surface, Toast UI Preview |
| 3 | Editor / data-safety stabilization and CM6 spike | Done | Spike validated CM6 as production editor; all six manual scenarios passed |
| 4 | CM6 default | Done | CM6 promoted to default write surface; Hybrid retained as fallback behind `?writeEngine=hybrid` |
| 5.1 | Design tokens and typography | Done | Warm-paper token palette, iA-inspired typography, full `:root` token block |
| 5.2 | Status-bar document stats | Done | Word count, character count, line count in the status bar |
| 5.3 | Note-list row polish | Done | Snippet preview, tag chips, type badge, dirty badge in note list |
| 6.1 | Dirty-state tracking across navigation | Done | Dirty badge, draft tracking, edits preserved across note and vault switches |
| 6.2 | Pre-vault draft preservation and Save-without-vault | Done | Drafts survive before a vault is chosen; OS folder picker opens on first save |
| 6.3A | Close warning — Cancel / Discard | Done | Quit blocked when dirty; dialog with Cancel and Discard & Quit |
| 6.3B | Save All & Quit | Done | Saves all dirty vault notes and drafts, then quits; aborts on filename collision or permission error |
| Bug #4 | Initial multi-display window movement issue | Fixed | Window position normalized correctly on multi-display setups at launch |
| 7.1 | Remaining color token cleanup | Done | All hardcoded color literals outside `:root` replaced with design tokens; `--danger-bg` added |
| 7.2 | Documentation and consolidation | Done | README, test-manual, and stage-history updated to reflect current behavior |
| 14.2 | Strikethrough live styling | Done | `~~strike~~` parser activation in `cm6-entry.js` via `@lezer/markdown` Strikethrough; hybrid-cm6 decorations (`cm-md-strikethrough`, `cm-md-strikethrough-mark`) and `.cm-md-strikethrough` CSS |
| 14.3 | Task list visual styling | Done | Hybrid-cm6 decorates `[ ]` / `[x]` / `[X]` task markers with `cm-md-task-marker` (bullet keeps `cm-md-list-mark`); dimmed via `.cm-md-task-marker` CSS. No interactivity, no parser change (existing config already exposes TaskMarker) |

## Deferred items

- **Hybrid editor removal** — CM6 is the default. Hybrid (`?writeEngine=hybrid`) remains as a fallback. Removal is deferred.
- **CM6 spike code cleanup** — Spike artifacts (`apps/desktop/spike/`, `lib/spike-cm6-*`) remain. Cleanup is deferred.
- **Claude Design prototype** — Deferred.
- **Auto-save** — Deferred.
- **Multi-window support** — Deferred.
