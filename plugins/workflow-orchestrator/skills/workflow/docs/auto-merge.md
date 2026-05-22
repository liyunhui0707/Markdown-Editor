# Auto-merge — opt-in procedure for orchestrator-driven PR merge

This document is the **only** place in plugin source where `gh pr merge`
may appear. `tests/grep-no-merge.sh` allow-lists exactly this file and
forbids the command everywhere else. Adding the command in any other
file fails CI by design.

## When auto-merge applies

Auto-merge is opt-in. It triggers only when **all** of the following are
true:

1. The user passed `--auto-merge` at workflow invocation. The orchestrator
   persisted this as `state.auto_merge = true` via
   `workflow_state.py set --field auto_merge --value true`.
2. Step 13 (`pr-final-merge-review`) returned verdict `approve` with
   zero `blocker` and zero `major` findings.
3. CI is green and **complete**. Run
   `gh pr checks <N> --json name,state,conclusion`. Every returned
   check must be terminal AND acceptable:

   - terminal `state`: `COMPLETED`. Any check still in `PENDING`,
     `QUEUED`, `IN_PROGRESS`, `WAITING`, `REQUESTED`, or any other
     non-terminal/unknown state → **skip merge**. Do not wait, do not
     poll — this run does not auto-merge.
   - terminal `conclusion` of a completed check must be `SUCCESS`,
     `NEUTRAL`, or `SKIPPED`. Anything else (`FAILURE`, `CANCELLED`,
     `TIMED_OUT`, `ACTION_REQUIRED`, `STALE`, `STARTUP_FAILURE`,
     `null`, unknown) → **skip merge**.

   If `gh pr checks` returns zero rows (repo has no required checks
   configured), treat that as "no required checks" — acceptable.
   Any JSON parse error or non-zero exit from `gh` → **skip merge**.
4. `gh pr view <N> --json reviewDecision` is not `CHANGES_REQUESTED`.
   Acceptable values: `APPROVED`, `REVIEW_REQUIRED`, `null`.
5. No unresolved review threads. Detect with GraphQL — the REST
   `/reviews` endpoint does **not** expose `isResolved`. Paginate
   over **all** threads; a PR with >100 review threads can have
   unresolved comments hidden on later pages:

   ```sh
   gh api graphql -F number=<N> -F owner=<OWNER> -F name=<REPO> \
     -F cursor=<endCursor-or-null> -f query='
     query($number:Int!, $owner:String!, $name:String!, $cursor:String) {
       repository(owner:$owner, name:$name) {
         pullRequest(number:$number) {
           reviewThreads(first: 100, after: $cursor) {
             pageInfo { hasNextPage endCursor }
             nodes { isResolved }
           }
         }
       }
     }'
   ```

   Loop while `pageInfo.hasNextPage` is true, passing back
   `pageInfo.endCursor` as the next `cursor`. If any thread on any
   page has `isResolved: false` → skip merge. If the cursor loop
   exits with even one page where `hasNextPage` could not be
   determined (parse error, missing field, gh failure) → skip merge.

## Fail-safe — skip on any failure

If any of the `gh`, `gh api`, or JSON-parse calls returns a non-zero
exit code OR yields output the orchestrator cannot parse, the
orchestrator **must skip the merge**. The fall-through behavior is
identical to today's manual-recommendation flow: surface the verdict to
the user and stop.

Skipping must be visible. Write `.workflow/artifacts/13-auto-merge-skipped.md`
with:

- the failed check (which guard tripped)
- the raw `gh`/API output that triggered the skip
- a one-line recommendation ("retry after fixing CI", "resolve review
  threads", "abandon auto-merge for this PR", etc.)

## The merge call itself

Only after every guard above passes:

```sh
gh pr merge <N> --<method> --delete-branch=false
```

`<method>` is detected from the repository's merge convention — see
the "Detecting the merge method" section of the standalone
`pr-final-merge-review` skill. Never default to squash. Never delete the
branch automatically.

After a successful merge, write `.workflow/artifacts/13-merged.md` with:

- PR number + URL
- merge method used
- whether GitHub auto-closed any linked Issue
- the Codex verdict and findings count that authorized the merge

## What auto-merge does **not** do

- Force-push to anything.
- Override `CHANGES_REQUESTED` review decisions.
- Delete branches.
- Bypass branch protection.
- Merge into the wrong base branch — always verify `gh pr view --json baseRefName`.
- Close Issues directly (rely on GitHub's `Closes #...` automation).

## Standalone `pr-final-merge-review` skill

The `pr-final-merge-review` skill at `~/.claude/skills/` remains
review-only by default and project-agnostic. When the orchestrator
invokes it under `state.auto_merge = true`, the orchestrator (not the
skill) authorizes the merge after this document's guards all pass.
The skill's own action-mode contract — explicit written approval from
the user — is untouched for standalone invocations outside the workflow.
