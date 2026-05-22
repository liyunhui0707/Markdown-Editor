---
name: qa
description: Run only the QA phase of the workflow — build a manual-QA checklist for the change and sync README/docs. Public entry — /workflow-orchestrator:qa "<task>".
---

# qa — workflow QA stage

Thin entry point to the main `workflow` skill, scoped to the QA steps
(`--stage qa`, which expands to steps 9, 10).

## How to invoke

```
/workflow-orchestrator:qa "<task description>" [--run-context "<scope statement>"]
```

This is shorthand for:

```
/workflow-orchestrator:workflow "<task>" --stage qa [...flags]
```

## What runs

| Step | Skill                        | Owner  |
|------|------------------------------|--------|
| 9    | `manual-qa-checklist-builder`| Claude |
| 10   | `readme-docs-sync`           | Claude |

Both steps are Claude-owned; no Codex round in this stage.

## When to use

Run `qa` between `implement` and `ship` for any change that:

- touches user-visible behavior (cursor, persistence, view-state,
  keyboard, navigation, IME, long-document handling)
- updates default behavior in a way users can observe
- changes commands, flags, or configuration surface

For pure refactors or internal-only changes, you can skip the `qa`
stage entirely — `ship` does not depend on it.

See `skills/workflow/docs/stages.md` for the full stage matrix.
