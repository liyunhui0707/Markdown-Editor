---
name: plan
description: Run only the planning phase of the workflow — clarify the task, build a minimal-change TDD plan, and have Codex review it. Public entry — /workflow-orchestrator:plan "<task>".
---

# plan — workflow planning stage

Thin entry point to the main `workflow` skill, scoped to the planning
steps (`--stage plan`, which expands to steps 1, 4, 5).

## How to invoke

```
/workflow-orchestrator:plan "<task description>" [--scan-first] [--issue REF] [--run-context "<scope statement>"]
```

This is shorthand for:

```
/workflow-orchestrator:workflow "<task>" --stage plan [...flags]
```

## What runs

| Step | Skill                                       | Owner  |
|------|---------------------------------------------|--------|
| 1    | `task-clarification-tdd-spec`               | Claude |
| 4    | `minimal-tdd-implementation-plan-builder`   | Claude |
| 5    | `implementation-plan-review`                | Codex  |

The post-step-5 gate fires as normal (`proceed` / `revise` / `abort`).
On `proceed`, the run stops — the plan stage does not auto-flow into
`implement`. Pick that up with `/workflow-orchestrator:implement` when
you are ready to code, or run the full workflow.

## Optional additions

- `--scan-first` — prepend step 0 (`existing-system-bug-risk-scan`) when
  you do not yet know what to fix. Expands to `[0, 1, 4, 5]`.
- `--issue REF` (or a `#N` token in the task text) — inject steps 2 + 3
  (`github-issue-risk-investigation` + Codex review). Expands to
  `[1, 2, 3, 4, 5]`, or `[0, 1, 2, 3, 4, 5]` with `--scan-first`.

## Delegation

The plan stage shares `.workflow/state.json` with all other stages and
with the full workflow. If state already exists for an in-flight task,
the orchestrator will resume rather than re-init. Behavior past that
point is identical to `/workflow-orchestrator:workflow --stage plan`.

See `skills/workflow/docs/stages.md` for the full precedence rules and
interaction matrix.
