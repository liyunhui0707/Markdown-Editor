---
name: workflow
description: Orchestrate the 15-skill engineering workflow end-to-end with typed Codex review handoffs and human gates. Public entry — /workflow-orchestrator:workflow "<task>"
---

# workflow

You are the orchestrator for the 15-skill engineering workflow. Walk the user through a selected subset of steps, invoking Claude-owned skills inline and Codex-owned review skills via the bundled `codex-bridge` MCP. Final merge is always manual.

## How to invoke

```
/workflow-orchestrator:workflow "<task description>" [--size {trivial|small|medium|large}] [--from N] [--to N] [--skip CSV] [--force CSV] [--step N] [--resume] [--issue REF]
```

Per-repo state is stored at `<repo>/.workflow/state.json` and is managed exclusively by `bin/workflow_state.py`. Step selection is computed by `bin/workflow_select.py`. Do not write or modify state files by hand.

## Resume detection (run first)

Before doing anything else, check for existing state:

```
python ${CLAUDE_PLUGIN_ROOT}/bin/workflow_state.py resume --repo "<cwd>"
```

If the command returns a non-null `pending_gate`, re-emit the gate prompt verbatim and **end your turn**. Do not re-run prior steps. Otherwise, continue with the preview.

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
  --repo "<cwd>" --task-type "<detected>" --selected "<CSV>" --title "<task>"
```

Acquire the lock FIRST. If `acquire-lock` returns non-zero, another orchestrator run is already active in this repo; surface that to the user and stop without touching state. (Running `init` first would clobber any in-flight `state.json` from a parallel invocation before this run discovered the conflict.)

## Run loop

For each selected step in order:

1. Look up its owner in `skill-routing.md`.
2. If Claude-owned: invoke the corresponding skill directly using its standard `/<skill-name>` invocation. In runtime contexts where direct slash-command invocation is unavailable (e.g., when this orchestrator skill is already active and is the one initiating the next step), use the Skill tool instead.
3. If Codex-owned: call the corresponding typed MCP tool. See `mcp-contract.md` for the routing table. Use only typed tools for review skills.
4. Write the produced artifact to `<cwd>/.workflow/artifacts/NN-<skill-id>.md` (create the directory if needed).
5. Mark the step as done:
   ```
   workflow_state.py set --repo "<cwd>" --field step_status.N.state --value '"done"'
   workflow_state.py advance --repo "<cwd>" --to-step <next>
   ```
6. If the step is a gate trigger (5, 7, 11, or just before 12), set the gate and pause:
   ```
   workflow_state.py set-gate --repo "<cwd>" --after-step N --prompt "<one-line summary>"
   ```
   **Omit `--options` for canonical gates** (after steps 5, 7, 11, and 12) — the helper fills in the gate-specific options from `GATE_OPTIONS` (see `docs/gate-policy.md`). The canonical options are:

   | After step | Options                                  |
   |------------|------------------------------------------|
   | 5          | `proceed`, `revise`, `abort`             |
   | 7          | `apply-fixes`, `accept-as-is`, `abort`   |
   | 11         | `commit`, `fix-more`, `abort`            |
   | 12         | `push`, `cancel`                         |

   For any non-canonical, ad-hoc gate (e.g., after a `revise` round), pass `--options` explicitly. Read the resulting `pending_gate.options` from state and present them verbatim. Emit the prompt + option list as a single user-facing message, then **end your turn**. The next user message is the gate reply; clear the gate with `clear-gate` before advancing.

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
