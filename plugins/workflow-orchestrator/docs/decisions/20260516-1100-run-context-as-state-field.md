# Codex run-context lives in state.json, not per-call argument

**Date:** 2026-05-16
**Status:** accepted
**Related code:** `bin/_state_lib.py` (state.codex_run_context field), `servers/codex-bridge/codex_bridge/run_context.py`, `servers/codex-bridge/codex_bridge/tools/{review_plan,review_diff,review_text}.py`
**Related PRs:** #73, #75

## Context

The workflow needs a way to give Codex reviewers a project-scope hint
("this is a CLI tool", "this is the markdown-vault-app frontend", etc.)
so review skills produce relevant findings instead of generic ones. The hint
applies across an entire workflow run — every step-5 plan review, every
step-7 diff review, every step-13 final review — and the orchestrator needs
to deliver it to Codex consistently without the user re-typing it each step.

## Options considered

- **A.** Orchestrator passes run-context as an argument on every typed Codex
  tool call (e.g., `codex_review_plan(plan=..., run_context=...)`).
- **B.** Run-context lives in a separate config file at
  `~/.workflow/run-context.txt`, read by codex-bridge on each call.
- **C.** Run-context is a field in `state.json` (`state.codex_run_context`),
  auto-injected by the codex-bridge prompt composers when present.

## Decision

We picked **C** — store run-context as `state.codex_run_context` in the
workflow's per-repo state.json. The codex-bridge prompt composers look it up
via `format_scope_block(repo_root)` on every typed Codex tool call and
prepend a `## Project scope` block to the prompt.

## Why this, not the others

- **Why not A:** The orchestrator skill would have to remember to thread
  run-context through every Codex tool call. That's six call sites today and
  more as the workflow grows. Easy to forget; no compile-time check.
- **Why not B:** A separate config file means two sources of truth
  (state.json + run-context.txt) that can drift. It also doesn't survive
  `pivot` cleanly — pivoting should reset the run-context along with
  everything else, but a separate file would persist.
- **Why C:** state.json is already the single source of truth for a run.
  The codex-bridge already reads it (for `repo_root`). One write at `init`,
  zero changes to the per-call surface, and pivot/clear semantics come for
  free with the existing state-archival pattern.

## Consequences

What gets easier:
- Adding a new Codex-owned review skill: it gets the run-context automatically
  via the shared `format_scope_block` helper. No threading needed.
- Pivoting and resuming a run: run-context follows the state file lifecycle.

What gets harder:
- Per-call run-context override (e.g., "this one review should ignore the
  project-scope hint") would require a new mechanism. Not a current need.

New invariants to preserve:
- Codex-bridge prompt composers must tolerate `repo_root=None` (some test
  callers don't have a real repo). `format_scope_block` returns `""` in that
  case rather than raising. Codified in `test_run_context_prompts.py`.
- Every typed Codex tool's `_compose_prompt` must call `format_scope_block`
  *before* the task-summary section, so project scope frames everything that
  follows.
- The `repo_root` lookup uses `.get("repo_root")` (tolerant), not
  `context["repo_root"]` (strict). PR #75 followup after Codex review flagged
  the narrower form.

## Open questions / followups

- If we ever add a Codex tool that doesn't need scope framing (e.g., raw
  code evaluation against a fixed rubric), it should explicitly opt out by
  not calling `format_scope_block`. No tool does this today.
- Run-context length: there is no current cap. If a user pastes 50 KB of
  project description, it balloons every Codex prompt. Add a soft cap +
  truncation if this shows up in practice.
