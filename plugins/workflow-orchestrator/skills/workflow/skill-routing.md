# Skill routing — owner and tool for each of the 17 skills

This is the authoritative routing table. For each skill, the orchestrator either invokes a Claude-side skill by name or calls one of the typed MCP tools on `codex-bridge`. The fallback escape-hatch tool is NEVER used for these review steps — see `mcp-contract.md` for its only documented use.

## Claude-owned skills (run inline)

| Step | Skill                                | When                              |
|------|---------------------------------------|-----------------------------------|
| 0    | `existing-system-bug-risk-scan`       | opt-in via `--scan-first`         |
| 1    | `task-clarification-tdd-spec`         | always                            |
| 2    | `github-issue-risk-investigation`     | `bug-with-issue` only             |
| 4    | `minimal-tdd-implementation-plan-builder` | always                        |
| 6    | `minimal-tdd-implementation`          | always                            |
| 8    | `minimal-review-fix`                  | after step 7 if findings exist    |
| 9    | `manual-qa-checklist-builder`         | bug-with-issue / bug / feature    |
| 10   | `readme-docs-sync`                    | feature (or when docs affected)   |
| 12   | `commit-push-pr-create`               | always (after step 11 gate)       |
| 14   | `session-continuity-summary`          | end of run                        |
| 16   | `development-retrospective-review`    | opt-in via `--retro`              |

## Codex-owned skills (typed MCP tools via codex-bridge)

| Step | Skill                                | MCP tool             | Schema                          |
|------|---------------------------------------|----------------------|---------------------------------|
| 3    | `issue-investigation-plan-review`     | `codex_review_text`  | `review_text.schema.json`       |
| 5    | `implementation-plan-review`          | `codex_review_plan`  | `review_plan.schema.json`       |
| 7    | `strict-git-diff-review`              | `codex_review_diff`  | `review_diff.schema.json`       |
| 11   | `commit-pr-readiness-review`          | `codex_review_text`  | `review_text.schema.json`       |
| 13   | `pr-final-merge-review`               | `codex_review_text`  | `review_text.schema.json`       |
| 15   | `answer-fact-check-review`            | `codex_review_text`  | `review_text.schema.json`       |

Step 15 is exposed as the side-channel flag `--fact-check "<answer>"`, not as a linear step.

For each Codex-owned step, the orchestrator calls the typed MCP tool with the artifact from the previous step and the task context, then surfaces the resulting `ReviewResult` to the user (with verdict, summary, findings, and a `raw_output` fallback).
