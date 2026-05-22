# Selector — task-type → step-set

Logic of record lives in `bin/workflow_select.py`. This doc describes the rules for human reference; the orchestrator must invoke the helper rather than re-implement them.

## Task type detection

| Signal                                  | Result          |
|-----------------------------------------|-----------------|
| `--issue` flag or `#\d+` / `issue \d+` in task | `bug-with-issue` |
| Contains `bug`/`regression`/`broken`/`fails`/`crash` | `bug` |
| Contains `refactor`/`rename`/`extract`/`split`/`tidy` | `refactor` |
| Contains `add `/`implement`/`new `/` feature`/`support ` | `feature` |
| Otherwise                               | `freeform`      |

## Default step sets

| Task type        | Steps                                       |
|------------------|---------------------------------------------|
| `bug-with-issue` | 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14   |
| `bug`            | 1, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14         |
| `feature`        | 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14     |
| `refactor`       | 1, 4, 5, 6, 7, 8, 11, 12, 13, 14            |
| `freeform`       | 1, 4, 5, 6, 7, 8, 11, 12, 13, 14            |

All profiles include the mandatory gate-bearing steps 5, 7, 11, and the pre-12 push gate.

## Size override

`--size {trivial|small|medium|large}` REPLACES the task-type-derived set with a size-tuned set. Use it when the task-type default is too heavy (e.g. a 50-LOC CSS change classified as `feature`). Step 11 (commit-readiness) is preserved in every size — it is the last cheap check before code leaves the local machine.

| Size       | Steps                            | Notes                                                  |
|------------|----------------------------------|--------------------------------------------------------|
| `trivial`  | 6, 7, 11, 12                     | write → diff-review → readiness → push. Skips plan, QA, wrap-up. |
| `small`    | 1, 6, 7, 8, 11, 12               | +clarify, +review-fix.                                 |
| `medium`   | 1, 4, 5, 6, 7, 8, 11, 12, 14     | +plan, +plan-review, +continuity-summary.              |
| `large`    | (task-type default)              | Use the full task-type-derived set. Same as omitting `--size`. |

Skipping steps 5 / 7 / 12 still triggers a mandatory-gate warning. Trivial drops step 5; that warning is expected — it's the workflow telling you "you opted out of plan review."

## UI flag (P1.b)

`--ui` / `--no-ui` controls whether the manual-QA gate fires after step 6. The selector also force-includes steps 9 (manual-QA checklist) and 10 (docs sync) in any size preset when `--ui` is set.

| Flag       | Effect                                                                                              |
|------------|-----------------------------------------------------------------------------------------------------|
| `--ui`     | Forces `ui=true`. Always adds 9 + 10 to the selected set.                                            |
| `--no-ui`  | Forces `ui=false`. No auto-detect; trusts the user.                                                  |
| (omitted)  | Auto-detect from task text. Triggers `ui=true` if any of these whole-words appears (case-insensitive): `render`, `rendering`, `view`, `panel`, `UI`, `visual`, `display`, `browser`, `frontend`, `component`. |

The selector emits `"ui": <bool>` in its preview JSON. The orchestrator passes that value through to `workflow_state.py init --ui` so the run-loop knows whether to fire the manual-QA gate after step 6.

## Other overrides

- `--skip CSV` — remove listed steps
- `--force CSV` — add listed steps that the default profile excluded
- `--from N` — drop steps with number < N
- `--to N` — drop steps with number > N
- `--step N` — run only this single step
- `--task-type TYPE` — bypass detection
- `--stage {plan|implement|qa|ship|retro}` — named stage preset; **replaces** the base set entirely (precedence: `--step` > `--stage` > `--size` > task-type). Full preset table in `docs/stages.md`.
- `--scan-first` — prepend step 0 (`existing-system-bug-risk-scan`); only takes effect when step 1 is already in the selected set.
- `--retro` — idempotently ensure step 14 (`session-continuity-summary`) and step 16 (`development-retrospective-review`) are both in the set.
- `--auto-merge` — opt-in flag surfaced in preview JSON; the orchestrator persists this as `state.auto_merge` to authorize merging the PR after step 13 returns `approve`. See `docs/auto-merge.md` for the safety procedure.
