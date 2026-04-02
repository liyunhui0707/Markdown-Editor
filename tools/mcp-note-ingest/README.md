# mcp-note-ingest

Day 26 stabilized MCP server for Markdown vault ingestion.

## What this now supports

This server now supports:

- stdio transport using `Content-Length` framing
- `initialize`
- `tools/list`
- `ping`
- `ingest_chat_markdown`

## Bug bash fixes in this version

This version improves reliability by fixing:

- transport mismatch with the smoke test
- stronger argument validation
- safer duplicate filename handling
- clearer ingest logging to stderr
- stronger smoke-test verification

## Main tool

### `ingest_chat_markdown`

This tool writes a new Markdown file into:

```text
Inbox/AI Chats/YYYY/MM/