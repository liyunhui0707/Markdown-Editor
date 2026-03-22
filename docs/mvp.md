# MVP Definition — Markdown Vault App

## 1. Product summary

This project is a local-first Markdown vault app for macOS.

The app should let a user:
- choose a local vault folder
- create and edit Markdown notes
- preview Markdown rendering
- browse and organize notes in folders
- save notes as local `.md` files
- ingest Claude Code CLI and Codex CLI outputs into the vault through MCP

The app should be usable by me first, and later shareable with other people.

---

## 2. Target user

Primary target user:
- me, as a local-first note-taking and AI-output capture user

Future users:
- people who want a simple Markdown vault app
- people who want to capture AI coding/chat outputs into a local knowledge system

---

## 3. Core value

The core value of the app is:

"Keep my notes and AI outputs in one local Markdown vault that I own."

---

## 4. Version 1 goals

Version 1 must support:

1. choosing a vault folder
2. browsing Markdown files in the vault
3. creating a new note
4. editing note content
5. previewing rendered Markdown
6. saving notes to local `.md` files
7. renaming notes
8. deleting notes safely
9. basic search
10. MCP-based ingestion of AI chat/output into the vault

---

## 5. Version 1 non-goals

Version 1 will NOT include:

- graph view
- plugin system
- cloud sync
- multi-device sync
- WYSIWYG editor
- advanced backlink system
- advanced tag explorer
- collaboration features
- full Obsidian feature parity

---

## 6. MVP storage model

The app is local-first.

This means:
- notes are stored as plain Markdown files
- the vault is a normal folder on disk
- the app reads and writes directly to that folder

---

## 7. MVP AI ingestion model

The app will support AI content ingestion through MCP.

The first MCP milestone is:
- an MCP tool writes a Markdown file into the vault
- the app detects the file and shows it

---

## 8. Success criteria for MVP

The MVP is successful if:

- I can use the app to take my own notes
- I can save and reopen notes reliably
- I can organize notes in a vault folder
- I can ingest at least one Claude Code or Codex output through MCP into the vault
- the app runs normally on macOS
- another person could follow instructions and run it

---

## 9. Product principle

Keep version 1 small, reliable, and real.
Do not try to clone Obsidian.
