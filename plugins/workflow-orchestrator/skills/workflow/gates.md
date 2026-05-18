# Gates — pause / resume protocol

The orchestrator pauses for explicit user approval at four mandatory points and at any other point where Codex returned `verdict ∈ {revise, reject}`. Final merge is always manual; the orchestrator never invokes a merge command.

## Mandatory gates

| Gate         | When                | Options                       |
|--------------|---------------------|-------------------------------|
| After step 5 | plan reviewed       | `proceed`, `revise`, `abort`  |
| After step 7 | diff reviewed       | `apply-fixes`, `accept-as-is`, `abort` |
| After step 11| commit readiness    | `commit`, `fix-more`, `abort` |
| Before step 12 | confirm push/PR   | `push`, `cancel`              |
| End of run   | final merge         | (no option — user merges)     |

## Conditional gates

### Manual-QA gate (P1.b/c — UI-touching runs)

Fires AFTER step 6 (implementation) and BEFORE step 7 (Codex diff review) when `state.ui` is true. `state.ui` is set at init from the selector's `--ui` flag (explicit or auto-detected from task-text keywords like `render`, `view`, `panel`, `UI`, `visual`, `display`, `browser`, `frontend`, `component`).

| When                              | Options                                       |
|-----------------------------------|-----------------------------------------------|
| Step 6 done, `state.ui` is true   | `pass`, `fail`, `skip-and-document`           |

Canonical via `GATE_OPTIONS[6]`, so the orchestrator calls `set-gate --after-step 6` without `--options`.

User reply routing:
- `pass` → clear gate, advance to step 7.
- `fail` → clear gate, loop back to step 6 with the fail reason as input.
- `skip-and-document` → clear gate, write a stub `<cwd>/.workflow/artifacts/06-manual-qa-skipped.md` with the user's reason, then advance to step 7.

The whole point: catch UI regressions with a one-minute human look BEFORE paying for a Codex round. Skipping this on UI-touching runs was the root cause of the prior session's 9-round review spiral.

### Escalation gate (P2 — review-round cap)

Fires when a Codex-owned skill's dispatch counter reaches `state.max_review_rounds` (default 3). Triggered by `should-escalate` returning `"escalate": true` BEFORE the next dispatch.

| When                                              | Options                                       |
|---------------------------------------------------|-----------------------------------------------|
| Per-skill review count reached `max_review_rounds` | `dispatch-another`, `accept-as-is`, `abort`   |

This gate is non-canonical (not keyed on `--after-step`), so set it with explicit `--options "dispatch-another,accept-as-is,abort"`. The `--after-step` argument should be the current step number for context (e.g., 5 for plan review).

**Recommend `accept-as-is`** in the gate prompt when the last 2 rounds had verdicts ∈ {`approve`, `revise`} with no blockers/majors — that's the signature of a converging review where remaining findings are defensive scope-expansion. **Recommend `dispatch-another`** when the last round had real blockers/majors that haven't been addressed.

## Pause protocol

1. Write the gate via `workflow_state.py set-gate --after-step N --prompt "…" --options "…"`.
2. Emit a single user-facing message containing the one-line summary and the option list.
3. **End your turn.** No further tool calls in the same turn.

## Resume protocol

On the next invocation (same session or after restart):

1. Call `workflow_state.py resume --repo "<cwd>"`.
2. If `pending_gate` is non-null, re-emit the gate prompt verbatim and end your turn.
3. When the user replies, parse the reply against `pending_gate.options` (case-insensitive, accept short forms `y`/`n`/`1`/`2`/`3` and option keywords). Anything else: re-prompt without advancing.
4. Clear the gate with `clear-gate`, then advance.
