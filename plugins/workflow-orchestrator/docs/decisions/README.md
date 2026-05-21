# Design decisions

Short markdown documents capturing non-trivial design decisions for the
workflow-orchestrator plugin. Each doc records the options that were
considered, the one we picked, and *why we rejected the others*.

The goal: make decisions retrievable months later, when neither commit
messages, PR descriptions, nor chat transcripts make the reasoning obvious.

## When to write one

Write a decision doc when ALL of these are true:

- The choice has at least two plausible alternatives.
- The choice changes a contract between two modules — a state field, a tool
  input, a gate's option set, a file-path convention, or a CLI subcommand
  surface.
- You expect to need the reasoning again in three months.

Skip a doc for: typo fixes, renames, internal refactors that don't change a
contract, or one-line bug fixes.

## How to write one

1. Copy `_template.md` to `<YYYYMMDD>-<HHMM>-<short-slug>.md`.
2. Fill in every section. Half a page to one page is the target. Longer means
   you're probably explaining too much.
3. Add a row to the index below.
4. Commit alongside the PR that implements the decision. If the doc is
   retroactive, prefix the commit with `docs:` and keep it standalone.

## Naming

`<YYYYMMDD>-<HHMM>-<short-slug>.md` — sortable, dated, descriptive.
The time portion lets multiple decisions in the same day stay ordered.

## Status values

- **accepted** — the decision is live in the codebase.
- **superseded by <filename>** — we changed our minds; link to the newer doc.
- **deprecated** — the decision still describes past code, but we no longer
  do this. Kept for historical context.

When a decision is superseded, do not delete the old file. Flip its status
and add a one-line pointer at the top of its `## Context` section.

## Index

| Date       | Decision | Status |
|------------|----------|--------|
| 2026-05-16 | [Codex run-context lives in state.json, not per-call argument](20260516-1100-run-context-as-state-field.md) | accepted |
| 2026-05-16 | [Review-round cap is per-skill, not global](20260516-1400-review-round-cap-per-skill.md) | accepted |

## Template

See [`_template.md`](_template.md).
