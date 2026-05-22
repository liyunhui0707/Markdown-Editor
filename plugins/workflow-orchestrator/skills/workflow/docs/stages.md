# Named stage presets

The selector exposes five named stage presets via `--stage NAME`. Each
**replaces** the base step set entirely (same precedence semantics as
`--size`), so a stage run is a fixed, scoped subset — not whatever
slice the task-type default happens to overlap.

## Precedence

```
--step  >  --stage  >  --size  >  task-type default
```

Then in order: `--ui`, `--scan-first`, `--retro`, `--force`, `--skip`,
`--from`, `--to`. `--force`/`--skip`/`--from`/`--to` always compose on
top of whatever set the higher-precedence flag produced.

## Stage definitions

| Stage      | Steps                | What it covers                                                |
|------------|----------------------|---------------------------------------------------------------|
| `plan`     | `[1, 4, 5]`          | clarify → plan → Codex plan-review                            |
| `implement`| `[6, 7, 8]`          | TDD impl → Codex diff-review → review-fix                     |
| `qa`       | `[9, 10]`            | manual-QA checklist + README/docs sync                        |
| `ship`     | `[11, 12, 13]`       | readiness → push/PR → Codex final merge review                |
| `retro`    | `[14, 16]`           | continuity summary + development-retrospective-review         |

Step 15 (`answer-fact-check-review`) is intentionally absent from `retro`
— it is a side-channel skill invoked via `--fact-check`, not a linear step.

## Issue-context interaction

When `--stage plan` is combined with `--issue REF` (or the task text
matches `#\d+` / `issue \d+`), the selector injects steps 2 + 3:

```
--stage plan --issue myorg/myrepo#42  →  [1, 2, 3, 4, 5]
```

This is the only stage that auto-injects issue-investigation steps.
Other stages stay fixed regardless of issue context — if you need to
re-investigate from a different stage, pass `--force 2,3` explicitly.

## --scan-first interaction

`--scan-first` prepends step 0 (`existing-system-bug-risk-scan`) **only
when step 1 is in the selected set**. This makes the flag a no-op on
mid-pipeline stages (`implement`, `qa`, `ship`, `retro`) and on
`--size trivial`, since prepending a "scan the codebase first" step in
front of a partial run does not make sense.

Concrete examples:

| Invocation                                   | Result                  |
|----------------------------------------------|-------------------------|
| `--stage plan --scan-first`                  | `[0, 1, 4, 5]`          |
| `--stage plan --scan-first --issue X#1`      | `[0, 1, 2, 3, 4, 5]`    |
| `--stage implement --scan-first`             | `[6, 7, 8]` (no-op)     |
| `--size small --scan-first`                  | `[0, 1, 6, 7, 8, 11, 12]` |
| `--size trivial --scan-first`                | `[6, 7, 11, 12]` (no-op) |

## --retro interaction

`--retro` idempotently ensures both step 14 (`session-continuity-summary`)
and step 16 (`development-retrospective-review`) are present.

| Invocation                                   | Result                  |
|----------------------------------------------|-------------------------|
| feature default `--retro`                    | default set + `16`      |
| `--size trivial --retro`                     | `[6, 7, 11, 12, 14, 16]`  |
| `--size small --retro`                       | `[1, 6, 7, 8, 11, 12, 14, 16]` |
| `--stage retro --retro`                      | `[14, 16]` (no-op)       |

## When to use stages vs. the full workflow

- **Single-session focused work**: run the full `/workflow-orchestrator:workflow`.
- **Multi-day tasks**: pick a stage per session — `plan` Monday,
  `implement` Tuesday, `ship` Wednesday. State persists in
  `.workflow/state.json` across stage runs.
- **One-off mid-pipeline jumps**: stages are also fine for "I just want
  to ship what's already implemented" runs — `/workflow-orchestrator:ship`
  picks up at step 11.

State isolation: stage runs do not auto-create a new `state.json` if
one already exists for an in-flight task. The orchestrator detects the
existing state via `workflow_state.py resume` and either continues
that task (if the description matches) or surfaces the pivot prompt
(if it doesn't).
