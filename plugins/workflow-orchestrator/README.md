# workflow-orchestrator

Claude Code plugin that orchestrates a 15-skill engineering workflow end-to-end and delegates review steps to Codex CLI via a bundled MCP server (`codex-bridge`). Designed to eliminate manual copy/paste between Claude Code and Codex during the plan-review and diff-review handoffs.

Public entry: `/workflow-orchestrator:workflow "<task description>"`

This README is intentionally minimal during Phase 0 scaffolding. See `skills/workflow/` for the orchestrator behavior, `servers/codex-bridge/` for the MCP server, and `tests/` for the contract tests.

## After source edits

Claude Code copies plugin contents into `~/.claude/plugins/cache/` at install time. Source-tree edits are NOT picked up by the running plugin until you reinstall:

```
/plugin uninstall workflow-orchestrator
/plugin install workflow-orchestrator@workflow-and-MCP-and-plugins
/reload-plugins
```

(Schema files in `servers/codex-bridge/schemas/` are read by Codex on each invocation, so editing them in the installed cache directly is a faster dev loop. But the canonical fix path is reinstall.)
