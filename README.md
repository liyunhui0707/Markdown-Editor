# Markdown Vault App  
  
A local-first Markdown vault desktop app for macOS, with MCP-based AI chat ingestion.  
  
## What this app is  
  
Markdown Vault App is a simplified, Obsidian-like desktop app that lets you:  
  
- choose a local folder as your vault  
- create, edit, preview, search, and organize Markdown notes  
- keep notes as plain `.md` files on disk  
- ingest AI chat outputs from Claude Code and Codex CLI through MCP  
- view imported AI chats inside the app under **AI Imports**  
  
This project is intentionally local-first and file-based.  
  
Your notes stay as normal Markdown files in a folder you control.  
  
---  
  
## Core features in v1  
  
- Vault selection  
- Create/edit/save Markdown notes  
- Markdown preview  
- Search with result snippets  
- Frontmatter support for:  
  - tags  
  - source  
- AI Imports filter  
- MCP ingest tool:  
  - `ingest_chat_markdown`  
- App auto-refresh when new MCP-ingested notes appear  
- Demo vault seeding  
- Local packaged app build  
  
---  
  
## Project structure  
  

```
apps/desktop/               Electron desktop app  
tools/mcp-note-ingest/      MCP server for note ingestion  
docs/                       install guide, MCP guide, demo script, manual test checklist
```

---

## Who this is for

This build is currently aimed at:

- personal use
- learning
- friend-level testing
- early product demos

This is not yet a polished public production release.

---

## Quick start

### Option A: run the desktop app in development mode

```
cd apps/desktop  
npm install  
npm run dev
```
### Option B: use the packaged build

If you already built the packaged app on macOS, open the build from:

```
apps/desktop/dist/
```

If macOS blocks the app, see the Troubleshooting section below.

---

## How to use the app

1. Launch the app
2. Click **Choose Vault**
3. Pick a folder to use as your vault
4. Optionally click **Create Demo Vault**
5. Browse notes, edit notes, save notes, and search notes
6. Use the **AI Imports** filter to view notes imported through MCP

---

## MCP ingestion

This project includes a local MCP server:

```
tools/mcp-note-ingest/
```

It provides the tool:

```
ingest_chat_markdown
```

That tool writes a Markdown note into:

```
Inbox/AI Chats/YYYY/MM/
```

inside your selected vault.

For full setup instructions, see:

- `docs/mcp-ingest-setup.md`

---

## Documentation

- `docs/install.md` — install and run guide
- `docs/mcp-ingest-setup.md` — Claude Code and Codex MCP setup
- `docs/demo-script.md` — short demo script for showing the app
- `docs/test-manual.md` — manual testing checklist

---

## Current scope

This project intentionally does **not** include:

- sync across devices
- plugins
- graph view
- backlinks UI
- WYSIWYG editing
- advanced database indexing

The goal is a small, useful, understandable v1.

---

## Troubleshooting

### The app will not open on macOS

If this is an unsigned local build:

- right-click the app
- choose **Open**
- confirm the warning

### MCP ingest does not work

Check:

- the MCP server is configured correctly
- the vault path you pass is an absolute path
- the server smoke test passes:

```
cd tools/mcp-note-ingest  
npm run smoke
```

### I do not see imported notes in the app

Check:

- the note was written under `Inbox/AI Chats/YYYY/MM/`
- the app is pointing at the same vault
- the app watcher is active
- the **AI Imports** filter is selected

---

## Status

This is a learning-driven v1 build.

It is already good enough for:

- local use
- demos
- early feedback
- testing the MCP ingestion workflow

  
---  
  

