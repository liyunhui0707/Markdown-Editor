---
name: implement
description: Run only the implementation phase of the workflow — write/update tests, do the minimal-change TDD implementation, have Codex review the diff, then apply review fixes. Public entry — /workflow-orchestrator:implement "<task>".
---

# implement — workflow implementation stage

Thin entry point to the main `workflow` skill, scoped to the
implementation steps (`--stage implement`, which expands to steps 6, 7, 8).

## How to invoke

```
/workflow-orchestrator:implement "<task description>" [--ui|--no-ui] [--run-context "<scope statement>"]
```

This is shorthand for:

```
/workflow-orchestrator:workflow "<task>" --stage implement [...flags]
```

## What runs

| Step | Skill                          | Owner  |
|------|--------------------------------|--------|
| 6    | `minimal-tdd-implementation`   | Claude |
| 7    | `strict-git-diff-review`       | Codex  |
| 8    | `minimal-review-fix`           | Claude |

If `state.ui` is true (set via `--ui` here or auto-detected on a prior
plan-stage run), the manual-QA gate fires after step 6 — see
`skills/workflow/gates.md`. The post-step-7 gate fires as normal
(`apply-fixes` / `accept-as-is` / `abort`).

## Prerequisites

This stage assumes a plan exists. If `.workflow/state.json` shows no
step-5 verdict, the orchestrator will warn and recommend running
`/workflow-orchestrator:plan` first. You can override by passing
`--skip 5` semantically (i.e., proceed without plan review) — but the
prior plan-review gate exists to catch design issues cheaply, so
skipping it is rarely a good call.

See `skills/workflow/docs/stages.md` for the full precedence rules.
