# Step catalog — the 15 skills

| Step | Skill                                | Owner  | Routing                |
|------|---------------------------------------|--------|------------------------|
| 1    | task-clarification-tdd-spec           | Claude | inline                 |
| 2    | github-issue-risk-investigation       | Claude | inline                 |
| 3    | issue-investigation-plan-review       | Codex  | `codex_review_text`    |
| 4    | minimal-tdd-implementation-plan-builder | Claude | inline               |
| 5    | implementation-plan-review            | Codex  | `codex_review_plan`    |
| 6    | minimal-tdd-implementation            | Claude | inline                 |
| 7    | strict-git-diff-review                | Codex  | `codex_review_diff`    |
| 8    | minimal-review-fix                    | Claude | inline                 |
| 9    | manual-qa-checklist-builder           | Claude | inline                 |
| 10   | readme-docs-sync                      | Claude | inline                 |
| 11   | commit-pr-readiness-review            | Codex  | `codex_review_text`    |
| 12   | commit-push-pr-create                 | Claude | inline                 |
| 13   | pr-final-merge-review                 | Codex  | `codex_review_text`    |
| 14   | session-continuity-summary            | Claude | inline                 |
| 15   | answer-fact-check-review              | Codex  | `codex_review_text` (side-channel via `--fact-check`) |
