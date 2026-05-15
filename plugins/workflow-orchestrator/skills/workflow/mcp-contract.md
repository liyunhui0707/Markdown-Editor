# codex-bridge MCP contract

The plugin bundles a Python MCP server at `${CLAUDE_PLUGIN_ROOT}/servers/codex-bridge/` declared in the plugin-root `.mcp.json`. The orchestrator calls only the typed tools below; payload size limits and secret scanning are enforced at the MCP boundary, not in the orchestrator skill.

## Tools

### `codex_review_plan(plan_text | plan_path, context)`

Reviews an implementation plan. Returns a `ReviewResult` with verdict in `{approve, revise, reject}`. Use for step 5.

### `codex_review_diff(diff_text | diff_path, context)`

Reviews a git diff. Chunks by file when over 256 KB; aggregates per-chunk verdicts (worst-of). Use for step 7.

### `codex_review_text(payload | payload_path, skill_id, context)`

Generic text review, parameterised by `skill_id`. Allowed values:

- `issue-investigation-plan-review` (step 3)
- `commit-pr-readiness-review` (step 11)
- `pr-final-merge-review` (step 13)
- `answer-fact-check-review` (step 15)

## Context object

```
{
  "task_summary": "<short task description>",
  "repo_root": "<absolute path to the target repo>",
  "related_files": ["..."]
}
```

`repo_root` is required when passing a `*_path`; the MCP enforces that the path resolves inside `repo_root` and refuses payloads matching known secret patterns.

## ReviewResult shape

```
{
  "verdict": "approve | revise | reject",
  "summary": "≤ 2 sentences",
  "findings": [
    {"severity": "blocker|major|minor|nit", "where": "...", "what": "...", "suggested_fix": "..."}
  ],
  "raw_output": "<full Codex last-message text>",
  "meta": {"tool": "<tool_name>", "chunks": N, "schema_version": "1"}
}
```

When Codex returns non-schema-conformant text, the bridge returns a conservative `verdict="revise"` with the text preserved in `raw_output` so a human can adjudicate.

## FALLBACK only — `codex_run(prompt, cwd, timeout)`

A generic Codex invocation. Returns raw stdout/stderr/exit_code. **The orchestrator must not use this for any of the six Codex-owned review skills.** It exists solely as an escape hatch for ad-hoc Codex calls the user explicitly asks for; the review path always uses the typed tools above.
