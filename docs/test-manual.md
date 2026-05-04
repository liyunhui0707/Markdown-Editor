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

## Final share check  
  
- [ ] Another person could follow the docs  
- [ ] README is understandable  
- [ ] Install guide is understandable  
- [ ] MCP setup guide is understandable  
- [ ] Demo script is usable
