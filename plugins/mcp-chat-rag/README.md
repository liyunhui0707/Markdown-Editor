# mcp-chat-rag

Status: alpha (v0.1.0)

A local MCP server that indexes your Claude Code session JSONL files
(`~/.claude/projects/<slug>/*.jsonl`) into a single SQLite + `sqlite-vec`
file at `~/.cache/mcp-chat-rag/index.db`, and exposes three retrieval
tools over MCP stdio:

- `search_chats(query, project?, cross_project?, date_from?, date_to?, k?)`
- `get_session(session_id, around_chunk_id?, window?)`
- `list_recent_sessions(project?, cross_project?, limit?)`

Use it to ask, from inside any Claude Code session, "what did we
discuss / decide / try before?" and get cited evidence.

## Prerequisites

- Node.js >= 20 (the plugin uses Node's built-in `fetch` and `node:test`).
- [Ollama](https://ollama.com) running locally with the `nomic-embed-text`
  model pulled: `ollama pull nomic-embed-text`.
- macOS arm64 / x64, Linux x64, or Windows x64 — `better-sqlite3` ships
  prebuilt native binaries for these. On other platforms you'll need a
  working C++ toolchain.

## Install (in this repo)

```bash
cd plugins/mcp-chat-rag
npm install
npm test         # 43 tests
npm run smoke    # MCP protocol smoke test
```

Then enable the plugin in your Claude Code host. The `.mcp.json` here
points the host at `${CLAUDE_PLUGIN_ROOT}/server.js`.

## What it indexes

- Lines with `type: "user"` or `type: "assistant"` only.
- Within those, the parser keeps `text` blocks and a one-line summary
  of each `tool_use` block. It drops `thinking` and `tool_result`
  blocks entirely (they're either internal or low-signal high-cost).
- Noise types — `queue-operation`, `permission-mode`,
  `file-history-snapshot`, `attachment`, `ai-title`, `system`,
  `last-prompt` — are skipped.

## Privacy posture

- 100% local. Embeddings are computed by a locally running Ollama; no
  text leaves the machine.
- Index lives at `~/.cache/mcp-chat-rag/index.db`. Delete the file to
  reset everything.
- The plugin never writes to `~/.claude/projects/...` or to the
  auto-memory directory under there. Read-only with respect to your
  Claude Code data.
- An index-time redactor masks the most-recognizable secret patterns
  (`sk-ant-`, `sk-`, `ghp_`/`gho_`/`ghs_`, `AKIA…`, and high-entropy
  `KEY=value` env-style lines) BEFORE chunks are sent to the
  embedder. Chunks where >50% of the content was masked are dropped
  entirely. This is high-precision but not exhaustive — treat it as
  defense-in-depth, not a security guarantee.

## Behavior when Ollama is down

- `search_chats` still returns BM25-only results.
- Response includes `"warnings": ["ollama_unavailable_bm25_only"]` so
  the caller knows the vector half is missing.
- Background indexing queues chunks without embeddings; they'll be
  embedded on the next index pass once Ollama is back.

## Behavior on first run (empty index)

- The server starts immediately and kicks off background indexing.
- `search_chats` returns `{ results: [], warnings: ['index_empty'] }`
  while the database is empty, and `['indexing_in_progress']` once
  there's some data but backfill is still running.

## Configuration (env vars)

| Variable | Default | Notes |
|---|---|---|
| `MCP_CHAT_RAG_DB` | `~/.cache/mcp-chat-rag/index.db` | SQLite file path. |
| `MCP_CHAT_RAG_ROOT` | `~/.claude/projects` | Where to find session JSONLs. |
| `MCP_CHAT_RAG_OLLAMA_URL` | `http://localhost:11434` | Ollama base URL. |
| `MCP_CHAT_RAG_DEFAULT_PROJECT` | `$PWD` then `process.cwd()` | Default project filter when `project` is not passed. |
| `MCP_CHAT_RAG_NO_INDEX` | unset | Set to `1` to skip background indexing (used by the smoke test). |

## Known limitations (v0.1.0)

- Token estimation uses `Math.ceil(text.length / 4)` — overshoots for
  ASCII and undershoots for CJK. Acceptable for chunk-budget purposes;
  not a substitute for a real tokenizer.
- FTS5's default tokenizer has imperfect CJK recall. Vector retrieval
  helps cover the gap.
- The `cwd` value baked into each session is the value Claude Code
  saw at the time. If you `cd` mid-session, the JSONL records each
  turn's actual `cwd`, which is the most stable join key for project
  scoping. The server-level default project comes from `process.env.PWD`
  at boot and does not follow further `cd` operations.
- Codex CLI sessions are not yet indexed. The format adapter is
  scoped for a future minor release.
- No cross-encoder reranker. Pure BM25 + sqlite-vec with RRF fusion.
- No filesystem watcher; re-scan happens on server start (mtime-gated).

## Architecture

```
~/.claude/projects/<slug>/*.jsonl   ← read-only source
        │
        ▼
   indexer  →  parser → chunker → redactor → embedder (Ollama)
                                                  │
                                                  ▼
                                          ~/.cache/mcp-chat-rag/
                                              index.db
                                          (sessions, chunks,
                                           chunks_fts, vec_chunks)
                                                  ▲
                                                  │   hybrid search (BM25 ∪ vector → RRF)
                                                  │
                                          MCP stdio server (server.js)
                                                  ▲
                                                  │ search_chats / get_session / list_recent_sessions
                                                  │
                                            Claude Code host
```

Each module is independently unit-tested. Five sequential commits land
the plugin: scaffold + parser + chunker → redactor → store + indexer →
embedder + retrieval → server + handlers + smoke.
