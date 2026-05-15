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

## Overrides

- `--skip CSV` — remove listed steps
- `--force CSV` — add listed steps that the default profile excluded
- `--from N` — drop steps with number < N
- `--to N` — drop steps with number > N
- `--step N` — run only this single step
- `--task-type TYPE` — bypass detection
