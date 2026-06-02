# mcp-chat-rag

Status: alpha (v0.1.0)

MCP server that indexes Claude Code session JSONL files (`~/.claude/projects/<slug>/*.jsonl`) into a local SQLite + `sqlite-vec` store and exposes three retrieval tools over MCP stdio: `search_chats`, `get_session`, `list_recent_sessions`.

Full installation and usage docs land in commit 5 of the implementation series.
