# Gate policy — authoritative per-gate behavior

| Gate         | What's being approved                                       | Default if user replies `revise` / `fix` |
|--------------|-------------------------------------------------------------|-----------------------------------------|
| After step 5 | Codex's review of the implementation plan                   | Loop back to step 4 with findings as input |
| After step 7 | Codex's review of the working-tree diff                     | Run step 8 (`minimal-review-fix`) with findings |
| After step 11| Codex's review of commit readiness                          | Loop back to step 8 or 10 as appropriate |
| Before step 12 | User confirmation to push the branch and open a PR        | Do not push; remain on the local branch  |
| End of run   | Codex's final merge recommendation (step 13 output)         | The user performs the merge manually     |

The orchestrator never assumes the user agrees with Codex. The user's reply at every gate is authoritative.
