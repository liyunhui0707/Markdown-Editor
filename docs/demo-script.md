# Demo Script  
  
This is a short, beginner-friendly demo script for showing the product to another person.  
  
## Demo goal  
  
Show that the app can:  
  
- open a vault  
- display Markdown notes  
- search notes  
- show AI-imported notes  
- receive a new note through MCP without restarting  
  
---  
  
## Demo setup before starting  
  
Before the demo:  
  
1. build or open the app  
2. choose a test vault  
3. click **Create Demo Vault**  
4. make sure Claude Code or Codex is ready to call MCP  
5. keep the app open  
  
---  
  
## 5-minute demo flow  
  
### Step 1 — explain the product in one sentence  
Say:  
  
> This is a local-first Markdown vault app.    
> Notes are plain `.md` files on disk, and AI tools can write new notes into the vault through MCP.  
  
### Step 2 — show the main app  
Show:  
  
- note list  
- editor  
- preview  
- filters  
- search box  
  
### Step 3 — show the demo vault  
Click a few notes and show:  
  
- regular notes  
- project note  
- meeting note  
- AI Imports filter  
  
### Step 4 — show search  
Search for one of these:  
  
- `roadmap`  
- `meeting`  
- `claude`  
- `codex`  
  
Explain that search shows snippets and context.  
  
### Step 5 — show AI Imports  
Click **AI Imports**.  
  
Explain that imported AI notes live under:  
  
 
```
Inbox/AI Chats/YYYY/MM/
```

### Step 6 — perform a live MCP ingest

Use Claude Code or Codex with a prompt like:

```
Use ingest_chat_markdown with:  
- vault_path: /absolute/path/to/your/vault  *(replace with your actual path, e.g. /Users/yourname/notes)*
- title: Live Demo Import  
- body: This note was created during the live demo.  
- source: claude  
- model: sonnet  
- tags: demo, imported
```

### Step 7 — show auto-refresh

Point out that the app:

- refreshes automatically
- moves to **AI Imports**
- selects the new note
- shows the imported content

### Step 8 — explain the value

Say:

> This means AI outputs can move directly into a personal Markdown vault without manual copy/paste.

---

## Demo fallback plan

If live MCP fails, do this:

1. explain that the MCP server writes Markdown files into the vault
2. show an already imported note in `AI Imports`
3. optionally run `npm run smoke` later to prove the server path works

---

## Key message to repeat

The most important message is:

- local-first
- plain Markdown files
- MCP ingestion
- app notices imported notes automatically

That is the product story.

  
---  
  

