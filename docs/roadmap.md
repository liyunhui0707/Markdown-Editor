# Project Roadmap — Markdown Vault App

## Current phase — Tiptap stabilization (2026-08-21)

The original phases below are retained as project history. The active product
direction is the opt-in ProseMirror/Tiptap WYSIWYG engine with raw Markdown as
the source of truth and a separate Source mode.

Priority order:

1. Prove data integrity with a representative Markdown round-trip corpus,
   especially mixed/nested lists, frontmatter, raw HTML, references, footnotes,
   math, Mermaid, tables, and images.
2. Complete real Electron QA for save/switch/quit, undo/redo, Chinese IME,
   cursor behavior, image paste/drop, and long documents.
3. **Completed in v0.17.3:** add repeatable clean-install,
   bundle-reproducibility, dependency-audit, and macOS packaging checks.
4. Promote Tiptap to the default only after those gates pass; keep CM6 as
   Source/fallback until migration confidence is established.

Defer new rendering engines, broad UI expansion, and removal of fallbacks until
the stabilization gate is complete.

---

## Phase 0 — Concept clarity and environment setup
Objective:
- define MVP clearly
- set up repo and folder structure
- prepare for safe development

Key outputs:
- repo initialized
- docs/mvp.md
- docs/roadmap.md

---

## Phase 1 — Minimum technical foundations
Objective:
- learn the minimum concepts needed to build the app

Topics:
- TypeScript basics
- React basics
- Electron basics
- Markdown rendering basics

---

## Phase 2 — First working Markdown editor
Objective:
- build a simple editor + preview app

Features:
- app window
- editor area
- preview area

---

## Phase 3 — Note storage and organization
Objective:
- make the app work with a real local vault

Features:
- vault picker
- file tree
- create note
- rename note
- safe delete
- save/load

---

## Phase 4 — MCP ingestion
Objective:
- allow Claude Code CLI and Codex CLI outputs to enter the vault through MCP

Features:
- MCP ingest tool
- write markdown into vault
- app detects imported files

---

## Phase 5 — Parallel agent workflow in development
Objective:
- use structured multi-agent workflow to build features safely

Roles:
- architect
- implementer
- reviewer
- tester
- documentation agent

---

## Phase 6 — Testing and stabilization
Objective:
- improve reliability and reduce bugs

Focus:
- manual testing
- basic automated tests
- logging
- debugging
- bug fixing

---

## Phase 7 — Packaging and sharing
Objective:
- prepare a usable shareable product

Outputs:
- packaged app
- README
- setup instructions
- demo vault
- MCP setup instructions
