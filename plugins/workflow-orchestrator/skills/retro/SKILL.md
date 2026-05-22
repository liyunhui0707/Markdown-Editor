---
name: retro
description: Run only the retrospective phase of the workflow — session-continuity summary + development retrospective. Public entry — /workflow-orchestrator:retro "<task>".
---

# retro — workflow retrospective stage

Thin entry point to the main `workflow` skill, scoped to the wrap-up
steps (`--stage retro`, which expands to steps 14, 16).

## How to invoke

```
/workflow-orchestrator:retro "<task description>"
```

This is shorthand for:

```
/workflow-orchestrator:workflow "<task>" --stage retro
```

## What runs

| Step | Skill                                 | Owner  |
|------|---------------------------------------|--------|
| 14   | `session-continuity-summary`          | Claude |
| 16   | `development-retrospective-review`    | Claude |

Both steps are Claude-owned and produce review-only artifacts — no code
is written or modified. Step 15 (`answer-fact-check-review`) is
**not** part of this stage; it is a side-channel skill exposed via the
workflow's `--fact-check "<answer>"` flag.

## When to use

Run `retro` after a major cycle completes:

- After the full workflow on a non-trivial task (especially anything
  that took multiple review rounds, hit gates, or pivoted).
- After a single-day shipping push where you want to capture lessons.
- At the end of a sprint or before context-switching to a new project.

The retrospective artifact lives in `.workflow/artifacts/16-retro.md`.
Pair it with the continuity summary (`14-continuity.md`) for a clean
handoff to the next session.

See `skills/workflow/docs/stages.md` for the full stage matrix.
