---
name: workflow
description: Orchestrate the 15-skill engineering workflow end-to-end with typed Codex review handoffs and human gates. Public entry — /workflow-orchestrator:workflow "<task>"
---

# workflow

You are the orchestrator for the 15-skill engineering workflow. Walk the user through a selected subset of steps, invoking Claude-owned skills inline and Codex-owned review skills via the bundled `codex-bridge` MCP. Final merge is always manual.

## How to invoke

```
/workflow-orchestrator:workflow "<task description>" [--size {trivial|small|medium|large}] [--from N] [--to N] [--skip CSV] [--force CSV] [--step N] [--resume] [--issue REF] [--run-context "<scope statement>"]
```

Per-repo state is stored at `<repo>/.workflow/state.json` and is managed exclusively by `bin/workflow_state.py`. Step selection is computed by `bin/workflow_select.py`. Do not write or modify state files by hand.

## Run-context (project-scope hint for Codex)

`--run-context "..."` writes a free-form scope string into `state.codex_run_context`. From that point on, every typed Codex review tool (`codex_review_plan`, `codex_review_diff`, `codex_review_text`) auto-prepends a "## Project scope" block to its prompt — so Codex frames every review under the same lens without you having to re-explain.

Use it when the project has a stance that's not obvious from the diff:

- "Renderer is intentionally a minimal subset of CommonMark; input comes only from controlled importers."
- "Library is internal-only; defensive checks for adversarial input are out of scope."
- "Security-sensitive — be strict about all input boundaries."

Set it once at init via `--run-context`, or update mid-run with `workflow_state.py set --field codex_run_context --value '"..."'`. Leave it unset (default) for fully strict, scope-naive Codex review.

## Resume detection (run first)

Before doing anything else, check for existing state:

```
python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py resume --repo "<cwd>"
```

If the command returns a non-null `pending_gate`, re-emit the gate prompt verbatim and **end your turn**. Do not re-run prior steps. Otherwise, continue with the preview.

## Mid-flight pivot (P4)

If `resume` returns a non-null `run_id` AND the task description in this invocation doesn't match `state.task.title`, surface this to the user before initializing anything:

> "There's an active workflow run titled '<old>'. This invocation asked for '<new>'. Pivot, extend, or abort-and-restart?"

| Option              | Effect                                                                                                  |
|---------------------|---------------------------------------------------------------------------------------------------------|
| `pivot`             | Archive the in-progress state.json + artifacts, reset the run for the new task, preserve the `run_id`. |
| `extend`            | Treat the new invocation as supplementary work on the existing task. Continue with current state.       |
| `abort-and-restart` | Release the lock, archive, start a fresh `init` from scratch.                                            |

On `pivot`, run:

```
python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py pivot --repo "<cwd>" \
  --new-task "<new title>" \
  --new-selected "<CSV from a fresh `workflow_select.py preview`>" \
  [--new-task-type <type>] \
  --reason "<one-line summary of why the pivot>"
```

The helper archives `state.json` → `.workflow/state.history/<ts>-<run_id>.json`, moves `.workflow/artifacts/` → `.workflow/artifacts.v<N>/`, resets `step_status` / `current_step` / `pending_gate` / `review_rounds` / `partial_commits`, increments `state.iteration`, and appends a `state.pivot_log` entry. The `run_id` is preserved so the entire arc (across pivots) shares one identifier.

To inspect the pivot history mid-run or post-run:

```
python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py history --repo "<cwd>"
```

After a pivot, restart the run from "Preview" with the new task description.

## Preview

BEFORE executing any step, you MUST:

1. Run the selector to compute the step set. If the user passed `--size {trivial|small|medium|large}` in the invocation, pass it through to the selector. Same for the other override flags:
   ```
   python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_select.py preview \
     --task "<task description>" \
     [--size {trivial|small|medium|large}] \
     [--issue REF] [--skip CSV] [--force CSV] \
     [--from N] [--to N] [--step N]
   ```
   `--size` REPLACES the task-type-derived step set; the other flags compose on top.
2. Print a numbered preview of the selected steps. For each step, mark:
   - `[OPTIONAL]` if the user can drop it without breaking the chain
   - `[GATE]` for steps 5, 7, 11, and the pre-12 push gate
   - the owner: `Claude` for steps 1, 2, 4, 6, 8, 9, 10, 12, 14; `Codex` for steps 3, 5, 7, 11, 13, 15
3. Show the rationale string from the selector.
4. Wait for user confirmation before any step is executed. Acceptable confirmations: `proceed`, `yes`, `y`, or step adjustments like `skip 9,10` / `from 4`. Anything else: re-ask without advancing.

Only after the user confirms may you initialize state and begin the run.

## Initialize state

```
python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py acquire-lock --repo "<cwd>"
python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py init \
  --repo "<cwd>" --task-type "<detected>" --selected "<CSV>" --title "<task>" \
  [--run-context "<scope statement>"]
```

Acquire the lock FIRST. If `acquire-lock` returns non-zero, another orchestrator run is already active in this repo; surface that to the user and stop without touching state. (Running `init` first would clobber any in-flight `state.json` from a parallel invocation before this run discovered the conflict.)

If `--run-context` was passed at invocation, pass it through to `init`. The resulting `codex_run_context` field is auto-read by every typed Codex tool for this run.

## Run loop

For each selected step in order:

1. Look up its owner in `skill-routing.md`.
2. If Claude-owned: invoke the corresponding skill directly using its standard `/<skill-name>` invocation. In runtime contexts where direct slash-command invocation is unavailable (e.g., when this orchestrator skill is already active and is the one initiating the next step), use the Skill tool instead.
3. If Codex-owned: BEFORE dispatching, check the review-round cap (P2):
   ```
   python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py should-escalate \
     --repo "<cwd>" --skill <mcp_tool_name>
   ```
   - If the response has `"escalate": true`, do NOT dispatch another round. Set the escalation gate instead (see "Escalation gate" below) and end your turn.
   - Otherwise, dispatch the typed MCP tool (see `mcp-contract.md` for routing), then bump the counter:
     ```
     python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py bump-review \
       --repo "<cwd>" --skill <mcp_tool_name>
     ```
   Use only typed tools for review skills.
4. Write the produced artifact to `<cwd>/.workflow/artifacts/NN-<skill-id>.md` (create the directory if needed).
5. Mark the step as done:
   ```
   workflow_state.py set --repo "<cwd>" --field step_status.N.state --value '"done"'
   workflow_state.py advance --repo "<cwd>" --to-step <next>
   ```
6. If the step is a gate trigger (5, **6 when `state.ui` is true**, 7, 11, or just before 12), set the gate and pause:
   ```
   workflow_state.py set-gate --repo "<cwd>" --after-step N --prompt "<one-line summary>"
   ```
   **Omit `--options` for canonical gates** (after steps 5, 6, 7, 11, and 12) — the helper fills in the gate-specific options from `GATE_OPTIONS` (see `docs/gate-policy.md`). The canonical options are:

   | After step | Options                                  | Fires when |
   |------------|------------------------------------------|------------|
   | 5          | `proceed`, `revise`, `abort`             | always (plan review) |
   | 6          | `pass`, `fail`, `skip-and-document`      | **P1.c — only when `state.ui` is true** (manual QA before Codex diff review) |
   | 7          | `apply-fixes`, `accept-as-is`, `abort`   | always (diff review) |
   | 11         | `commit`, `fix-more`, `partial-commit-and-continue`, `abort` | always (commit readiness) |
   | 12         | `push`, `cancel`                         | always (pre-push) |

   For any non-canonical, ad-hoc gate (e.g., after a `revise` round), pass `--options` explicitly. Read the resulting `pending_gate.options` from state and present them verbatim. Emit the prompt + option list as a single user-facing message, then **end your turn**. The next user message is the gate reply; clear the gate with `clear-gate` before advancing.

## Manual-QA gate (P1.b/c — UI runs only)

When `state.ui` is true, the manual-QA gate fires AFTER step 6 and BEFORE step 7 (Codex diff review). The whole point is to put eyeballs on the UI output before paying for a Codex round. Skipping QA on UI-touching runs is what caused the prior session's 9-round review spiral — manual QA at gate-11 caught a bug that lived in the first commit and would have been visible to a human in one minute.

After step 6 finishes, if `state.ui` is true:

```
workflow_state.py set-gate --repo "<cwd>" --after-step 6 \
  --prompt "Manual QA: load the changed UI in a browser; does it render correctly?"
```

User reply parsing:

- `pass` — proceed to step 7.
- `fail` — loop back to step 6 with the reason as input for the next iteration. Do NOT advance to step 7.
- `skip-and-document` — write a stub artifact at `<cwd>/.workflow/artifacts/06-manual-qa-skipped.md` recording the user's reason (one paragraph), then proceed to step 7. Future audits can grep for these to find runs that consciously skipped QA.

When `state.ui` is false, step 6 → step 7 transition is unchanged (no manual-QA gate).

## Step-11 partial-commit-and-continue (P5)

When the user picks `partial-commit-and-continue` at the after-step-11 gate, ship the Codex-approved subset now and keep iterating on the rest. The state helper just records the partial commit for audit; the orchestrator drives the actual git operations via Bash so the user can review the staged diff first.

Sequence:

1. Show the user `git status --short` so they can see what's in the working tree.
2. Ask which files they want to commit now (default: the files Codex already approved this round; the user can adjust).
3. `git add <selected_files>` (specific paths only — NEVER `git add -A`, per the project rule).
4. `git diff --cached` so the user can confirm before committing.
5. `git commit -m "<message>"` — message scoped to the committed subset, ending with a short note like "(partial commit; rest still in working tree)".
6. Record the audit entry:
   ```
   workflow_state.py record-partial-commit --repo "<cwd>" \
     --files "<csv>" --reason "<one-line summary>"
   ```
7. Clear the gate (`clear-gate`).
8. Continue iteration on the remaining working-tree changes — typically loop back to step 8 (`minimal-review-fix`) or step 6 (`minimal-tdd-implementation`) depending on what's contested.

State carries `state.partial_commits: list[{at, files, reason}]` so a future audit can see what shipped piecemeal and why. Never auto-push: pushing the partial commit is still a separate gate (the pre-step-12 push gate).

## Step-11 fix-more routing (P1.d)

When the user picks `fix-more` at the after-step-11 gate, route based on `step_status[9].state`:

- If step 9 is not `done` (missing or in_progress): clear the gate, advance to step 9, fire the manual-QA gate again so the user can verify the latest output before continuing. Then return to whatever step was in flight.
- If step 9 is `done`: clear the gate, advance to the appropriate fix step (usually 8 for Codex-flagged issues, or 6 for new implementation).

This prevents the case where `fix-more` silently loops back to step 6 (implementation) without surfacing the UI for human inspection — exactly the failure mode P1.b/c is designed to prevent.

## Escalation gate (P2 — review-round cap)

When `should-escalate` returns `"escalate": true`, the per-skill review count has reached `state.max_review_rounds` (default 3, set at init via `init --max-review-rounds N`). Set an escalation gate instead of dispatching:

```
workflow_state.py set-gate --repo "<cwd>" --after-step <current_step> \
  --prompt "Step <N> reviewed <round> times. Latest verdict: <verdict>. Continue reviewing?" \
  --options "dispatch-another,accept-as-is,abort"
```

User options:

- `dispatch-another` — bump the cap inline (`set --field max_review_rounds --value <round+N>`) or pass `--max` to the next `should-escalate` to allow one more round, then dispatch as usual.
- `accept-as-is` — skip further review; treat the most recent verdict as final and proceed.
- `abort` — stop the run; release the lock.

Recommend `accept-as-is` in the gate prompt when the last 2 rounds had verdicts in {`approve`, `revise`} with no blockers/majors — that's the signature of a converging review where remaining findings are defensive scope-expansion, not real bugs.

## Final merge

After step 13 (`pr-final-merge-review`), present Codex's recommendation. The orchestrator never auto-merges; the user performs the merge step themselves. Do not invoke any merge command from this skill or its helpers.

## Wrap-up (step 14)

If step 14 (`session-continuity-summary`) is in `selected_steps`, run it as the final step of the workflow — typically after the user has acknowledged the step 13 recommendation. Skipping step 14 is allowed only when it was excluded from the selected set during preview.

## Supporting documents

- `selector.md` — task-type → step-set rules (logic lives in `bin/workflow_select.py`)
- `state.md` — state file schema (logic lives in `bin/workflow_state.py`)
- `gates.md` — gate definitions and the pause/resume protocol
- `mcp-contract.md` — codex-bridge tool routing (typed tools only for review skills)
- `skill-routing.md` — owner mapping for each of the 15 skills
- `docs/gate-policy.md` — gate-by-gate policy reference
- `docs/step-catalog.md` — numbered catalog of the 15 steps with owner + tool
