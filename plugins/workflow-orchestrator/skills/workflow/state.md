# State — `<repo>/.workflow/state.json`

Logic of record lives in `bin/workflow_state.py`. This doc is a schema reference; the orchestrator must invoke the helper rather than write `state.json` directly.

## Schema

```json
{
  "schema_version": 1,
  "run_id": "<uuid4>",
  "started_at": "<ISO-8601 UTC>",
  "updated_at": "<ISO-8601 UTC>",
  "task": {
    "title": "<task description>",
    "type": "bug-with-issue | bug | feature | refactor | freeform",
    "issue_ref": "owner/repo#N | null"
  },
  "selected_steps": [1, 4, 5, 6, 7, 8, 11, 12, 13, 14],
  "step_status": {
    "1": {"state": "pending|in_progress|done|failed|skipped",
          "artifact_path": ".workflow/artifacts/01-…md",
          "verdict": "approve|revise|reject|null",
          "ended_at": "<ISO-8601|null>"}
  },
  "current_step": 5,
  "pending_gate": {
    "after_step": 5,
    "prompt": "<one-line summary>",
    "options": ["proceed", "revise", "abort"]
  } ,
  "lock": null
}
```

## Atomicity

Every mutation writes `state.json.tmp` exclusively (`O_EXCL`), `fsync`s it, then `os.replace`s into `state.json` and `fsync`s the directory. A stale `state.json.tmp` is removed before each write — it does not poison the rename.

## Locking

`acquire-lock` creates `state.lock` with `O_EXCL`. The lock file records `acquired_at` and `host` — it is NOT keyed on the helper-process pid and is NOT auto-reclaimed when the original process exits. If `state.lock` exists, the next `acquire-lock` exits non-zero with the held-since timestamp. Use `acquire-lock --force` to override an existing lock (e.g. after an aborted run leaves a stale `state.lock`); `release-lock` removes the lock cleanly.
