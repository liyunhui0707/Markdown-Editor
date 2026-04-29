# Markdown Vault App

A local-first desktop Markdown vault editor for macOS, built with Electron and plain files on disk. It includes an optional MCP server that lets AI tools write chat notes directly into a local Markdown vault.

## Screenshots

Screenshots are not included yet. Add app screenshots here before a wider public release.

## Features

- Choose any local folder as a Markdown vault.
- Load `.md` files recursively from the selected vault.
- Create, edit, save, and delete notes.
- Keep notes as normal Markdown files on disk.
- Use a focused editor workspace with a sidebar hidden by default.
- Filter notes by All Notes, AI Imports, Drafts, and Vault Files.
- Search by title, body, tags, source, file name, and relative path.
- Parse lightweight frontmatter for `tags` and `source`.
- Seed a demo vault for local testing and demos.
- Watch the selected vault and refresh when Markdown files change.
- Detect MCP-ingested notes under `Inbox/AI Chats/YYYY/MM/`.
- Package a local macOS Electron build for testing.

## Tech Stack

- Electron
- Node.js
- Toast UI Editor bundle
- `marked`
- Node.js built-in test runner
- Local MCP stdio server

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

### Run tests

```bash
cd apps/desktop
npm test
```

```bash
cd tools/mcp-note-ingest
npm run smoke
```

### Build a local macOS app

```bash
cd apps/desktop
npm run pack
```

Build artifacts are written to `apps/desktop/dist/` and should not be committed.

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

## Project Structure

```text
apps/desktop/             Electron desktop app
apps/desktop/lib/         Editor, vault, and renderer helper modules
apps/desktop/test/        Desktop app tests
tools/mcp-note-ingest/    Local MCP server for note ingestion
docs/                     Install, MCP, demo, roadmap, and test docs
```

## Documentation

- `docs/install.md` - install and run guide
- `docs/mcp-ingest-setup.md` - MCP setup guide
- `docs/demo-script.md` - demo walkthrough
- `docs/test-manual.md` - manual release checklist
- `docs/roadmap.md` - roadmap notes

## Privacy And Security

Markdown Vault App is local-first. Notes are stored as plain Markdown files in a folder selected by the user. The app does not include cloud sync, accounts, hosted storage, or a remote backend.

Before publishing or sharing the repository, do not commit personal vault content, `.env` files, local MCP config, generated builds, dependency folders, logs, or private assistant/editor settings.

## Current Limitations

- The packaged build workflow is currently macOS-focused.
- There is no built-in sync across devices.
- There is no account system or hosted backend.
- There is no plugin system, graph view, or backlinks UI.
- The editor bundle is generated and should be refreshed intentionally when editor dependencies change.
- The app is intended for local testing and early feedback, not production distribution.

## Roadmap

- Add screenshots and a polished release checklist.
- Clarify the generated editor bundle workflow.
- Add broader automated coverage for vault file operations.
- Improve metadata editing and frontmatter handling.
- Expand packaging and signing guidance.
- Add a license file before public release.

## License

The desktop package currently declares `MIT`, but this repository does not yet include a root `LICENSE` file. Add a license file before publishing publicly.
