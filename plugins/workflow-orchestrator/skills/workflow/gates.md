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
