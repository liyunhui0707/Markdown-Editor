---
name: ship
description: Run only the shipping phase of the workflow — Codex commit-readiness review, commit/push/PR-create, and Codex final merge review. Public entry — /workflow-orchestrator:ship "<task>".
---

# ship — workflow shipping stage

Thin entry point to the main `workflow` skill, scoped to the shipping
steps (`--stage ship`, which expands to steps 11, 12, 13).

## How to invoke

```
/workflow-orchestrator:ship "<task description>" [--auto-merge] [--run-context "<scope statement>"]
```

This is shorthand for:

```
/workflow-orchestrator:workflow "<task>" --stage ship [...flags]
```

## What runs

| Step | Skill                        | Owner  |
|------|------------------------------|--------|
| 11   | `commit-pr-readiness-review` | Codex  |
| 12   | `commit-push-pr-create`      | Claude |
| 13   | `pr-final-merge-review`      | Codex  |

The post-step-11 gate (`commit` / `fix-more` /
`partial-commit-and-continue` / `abort`) and the pre-step-12 push gate
(`push` / `cancel`) fire as normal.

## --auto-merge opt-in

If `--auto-merge` is passed (and `--run-context` permits), the
orchestrator may merge the PR after step 13 returns a clean `approve`
verdict **and** all safety guards in
`skills/workflow/docs/auto-merge.md` pass:

- CI green (`gh pr checks`)
- `reviewDecision != CHANGES_REQUESTED`
- All review threads `isResolved: true` (GraphQL)
- Codex verdict has zero `blocker`/`major` findings

Any guard failure falls back to today's manual-recommendation flow —
the merge is **skipped**, not retried, and the reason is logged to
`.workflow/artifacts/13-auto-merge-skipped.md`.

Without `--auto-merge`, the orchestrator surfaces the Codex
recommendation and stops — same as the full workflow's manual default.

See `skills/workflow/docs/stages.md` and `skills/workflow/docs/auto-merge.md`.
