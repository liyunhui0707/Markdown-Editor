# MCP Ingest Setup Guide  
  
This guide explains how to configure the local MCP server so Claude Code and Codex CLI can ingest chat notes into your vault.  
  
## What the MCP tool does  
  
This project includes a local MCP server at:  
  
```
tools/mcp-note-ingest/
```

The main tool is:

```
ingest_chat_markdown
```

That tool writes a Markdown file directly into a fixed local Inbox folder. By default:

```
/Users/liyunhui/Liyunhui/Inbox/
```

The destination can be overridden at server-launch time with the `MCP_INGEST_TARGET_DIR` environment variable. The tool no longer accepts a `vault_path` argument.

---

## 1. Verify the MCP server locally first

Before configuring any client, test the MCP server directly.

Open Terminal:

```
cd ~/code/markdown-vault-app/tools/mcp-note-ingest  
npm install  
npm run smoke
```

If the smoke test passes, your local MCP server is working.

---

## 2. Claude Code setup

From the project root:

```
cd ~/code/markdown-vault-app  
claude mcp add mcp-note-ingest --scope project -- node tools/mcp-note-ingest/server.js
```
Then verify:

```
claude mcp list  
claude mcp get mcp-note-ingest
```

You should also have a project `.mcp.json` file in the repo root.

A typical project-level `.mcp.json` looks like this:
```json
{
  "mcpServers": {
    "mcp-note-ingest": {
      "type": "stdio",
      "command": "node",
      "args": ["tools/mcp-note-ingest/server.js"],
      "env": {}
    }
  }
}
```

---

## 3. Codex CLI setup

Create or update:

```
.codex/config.toml
```

inside the project root with content like:

```TOML
[mcp_servers.mcp-note-ingest]  
command = "node"  
args = ["tools/mcp-note-ingest/server.js"]  
cwd = "/absolute/path/to/your/repo"  
enabled = true  
startup_timeout_sec = 15  
tool_timeout_sec = 60
```

Then verify:

```
cd ~/code/markdown-vault-app  
codex mcp list
```

---

## 4. Example Claude Code prompt

Use this inside Claude Code:

```
Please call the MCP tool `ingest_chat_markdown`.

Arguments:
- title: Claude MCP Test
- body: This note was created through the local MCP server.
- source: claude
- model: sonnet
- tags: chat, imported, test

After calling the tool, tell me the returned full_path.
```

---

## 5. Example Codex prompt

Use this inside Codex:

```
Use the MCP tool `ingest_chat_markdown`.

Arguments:
- title: Codex MCP Test
- body: This note was created through the local MCP server from Codex CLI.
- source: codex
- model: gpt-5.1-codex
- tags: chat, imported, test

After calling the tool, tell me the returned full_path.
```

---

## 6. Overriding the destination

By default, files land in `/Users/liyunhui/Liyunhui/Inbox/`. To redirect the tool to a different folder, set the `MCP_INGEST_TARGET_DIR` environment variable at server-launch time, for example by editing the `env` field of your `.mcp.json`:

```json
{
  "mcpServers": {
    "mcp-note-ingest": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/tools/mcp-note-ingest/server.js"],
      "env": { "MCP_INGEST_TARGET_DIR": "/Users/your-name/path/to/your/inbox" }
    }
  }
}
```

The target directory is created automatically if it does not exist.

Legacy absolute-vault-path rule (kept for reference):
```

Incorrect:

```
my-vault
```

---

## 7. What success looks like

A successful MCP ingest means:

- the tool call succeeds
- a real Markdown file is written into the configured target directory (default `/Users/liyunhui/Liyunhui/Inbox/`)
- the response includes the `full_path` of the new file
- if the target directory is inside your editor's vault, the app picks up the new file and shows it under **AI Imports** (the editor classifies AI imports by frontmatter `source`, so notes ingested with `source: claude` etc. are recognized regardless of folder layout)

---

## 8. Troubleshooting

### Problem: `npm run smoke` fails

Fix the MCP server first before trying Claude Code or Codex.

### Problem: Claude Code cannot see the server

Check:

- `.mcp.json` exists
- you ran the add command from the project root
- `claude mcp list` shows `mcp-note-ingest`

### Problem: Codex cannot see the server

Check:

- `.codex/config.toml` exists
- `codex mcp list` shows `mcp-note-ingest`
- `cwd` points to the real repo path

### Problem: file is written but app does not show it

Check:

- the target directory is inside the vault the app is currently using (the response's `full_path` tells you where the file landed)
- the app is open
- the note's `full_path` (returned by the tool) points at the expected target directory
- the app watcher is active
- the **AI Imports** filter is selected

---

## 9. Safe beginner test path

Use this order every time:

1. `npm run smoke`
2. configure Claude Code
3. test Claude Code ingest
4. configure Codex
5. test Codex ingest
6. verify app auto-refresh

  
---  
  

