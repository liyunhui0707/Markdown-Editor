# codex-bridge

Plugin-bundled MCP server. Exposes typed review tools (`codex_review_plan`, `codex_review_diff`, `codex_review_text`) plus a fallback (`codex_run`) that proxy to the locally installed Codex CLI.

All Codex invocations use `codex --ask-for-approval never exec --cd <repo> --sandbox read-only --output-schema <schema> --output-last-message <tmpfile> -` with payloads delivered on stdin. The flag `--dangerously-bypass-approvals-and-sandbox` is denylisted at argv build time.

Phase 0 placeholder. Tool implementations land in Phases A–D.
