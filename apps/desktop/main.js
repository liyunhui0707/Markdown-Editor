const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const FileName   = require('./lib/file-name');
const CloseGuard = require('./lib/close-guard');

let mainWindow = null;
let currentVaultWatcher = null;
let currentWatchedVaultPath = '';
let watchDebounceTimer = null;

// Stage 6.3A close guard. The CloseController owns two latches:
// `confirmed` lets every close/quit event in the active cascade
// through unmodified — that includes the bypassed re-fire of the
// originating event AND the non-darwin chain
//   close → closed → window-all-closed → app.quit → before-quit
// where before-quit must NOT re-run the guard against a torn-down
// renderer. `inFlight` stops Cmd+Q-after-window-close-button from
// stacking two prompts. Both are cleared by resetForNewWindow(),
// which runs at the start of createWindow(); that fires only when a
// fresh window is being constructed (e.g. macOS Dock reactivation),
// so the cascade above is never interrupted, and a re-activated app
// still cannot inherit a stale confirmation (Codex issue 1 +
// follow-up).
const closeController = CloseGuard.createCloseController();

// Monotonic counters for per-request reply channels so concurrent or
// retried close requests cannot mix up replies. The requester factories
// own their own listener cleanup on success / timeout / send failure.
let dirtySummaryRequestId = 0;
let saveAllRequestId      = 0;
const getMainWebContents = () =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;

const requestDirtySummaryFromRenderer = CloseGuard.createDirtySummaryRequester({
  ipcMain,
  getWebContents: getMainWebContents,
  makeReplyChannel: () => {
    dirtySummaryRequestId += 1;
    return `dirty-summary-reply:${dirtySummaryRequestId}`;
  },
  timeoutMs: 1500,
});

// Stage 6.3B: save-all uses the same generic IPC round-trip pattern,
// pinned to a longer timeout — saves can take seconds on slow disks
// and the no-vault path opens an OS folder picker that the user may
// take a while to dismiss. Listener cleanup on every exit path is
// inherited from the shared factory.
const requestSaveAllFromRenderer = CloseGuard.createSaveAllRequester({
  ipcMain,
  getWebContents: getMainWebContents,
  makeReplyChannel: () => {
    saveAllRequestId += 1;
    return `save-all-reply:${saveAllRequestId}`;
  },
  timeoutMs: 30000,
});

function createWindow() {
  // Reset the close-guard latches BEFORE attaching this window's
  // listeners. On macOS Dock reactivation a previous window may have
  // been closed via Discard — its confirmed=true latch must not carry
  // over to this fresh window. We deliberately reset here (a fresh-
  // window event) rather than on the previous window's 'closed'
  // (which is part of the non-darwin close cascade `close → closed →
  // window-all-closed → app.quit → before-quit` and would break the
  // last step by clearing the latch too early).
  closeController.resetForNewWindow();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Markdown Vault App',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (closeController.isConfirmed()) return;
    event.preventDefault();
    runCloseGuardForSource('window-close');
  });
}

async function showCloseDialog(summary) {
  const detail = CloseGuard.formatDirtyDetail(summary);
  // Stage 6.3B: three-button dialog. Save All & Quit is the default
  // (Enter), Cancel is the dismiss action (Esc / dialog close). Order
  // and indices are wired tightly to the response → choice mapping
  // below — keep them in sync.
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Save All & Quit', 'Discard & Quit', 'Cancel'],
    defaultId: 0,
    cancelId:  2,
    noLink: true,
    title: 'Unsaved changes',
    message: 'You have unsaved changes.',
    detail,
  });
  if (result.response === 0) return 'save-all';
  if (result.response === 1) return 'discard';
  return 'cancel';
}

async function runCloseGuardForSource(source) {
  if (!closeController.beginGuard()) return;
  let decision;
  try {
    decision = await CloseGuard.runCloseGuard({
      getDirtySummary: requestDirtySummaryFromRenderer,
      showDialog:      showCloseDialog,
      requestSaveAll:  requestSaveAllFromRenderer,
    });
  } catch (_err) {
    // Defensive: any unexpected failure in the guard itself must not
    // silently quit. Block until the user retries.
    decision = 'block-close';
  } finally {
    closeController.endGuard();
  }
  if (decision !== 'allow-close') return;

  closeController.confirmClose();
  if (source === 'before-quit') {
    app.quit();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
}

// Filename derivation + save orchestration live in the shared FileName helper
// so the renderer pre-check and this main-process guard cannot drift out of
// sync. performSaveNote owns the disk-side write semantics (`wx` for any path
// that would create a new file; plain write only for vault save-in-place).
const performSaveNote = FileName.performSaveNote;

function ensureVaultExists(vaultPath) {
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeTags(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }

    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function parseFrontmatter(content) {
  const result = {
    frontmatter: {
      tags: [],
      source: ''
    },
    body: content
  };

  if (!content.startsWith('---\n')) {
    return result;
  }

  const endIndex = content.indexOf('\n---\n', 4);

  if (endIndex === -1) {
    return result;
  }

  const frontmatterBlock = content.slice(4, endIndex);
  const body = content.slice(endIndex + 5);
  const lines = frontmatterBlock.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (key === 'tags') {
      result.frontmatter.tags = normalizeTags(rawValue);
    } else if (key === 'source') {
      result.frontmatter.source = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }

  result.body = body.trimStart();
  return result;
}

function serializeFrontmatter(frontmatter) {
  const lines = [];

  const tags = normalizeTags(frontmatter?.tags);
  const source = frontmatter?.source ? String(frontmatter.source).trim() : '';

  if (tags.length > 0) {
    lines.push(`tags: [${tags.join(', ')}]`);
  }

  if (source) {
    lines.push(`source: ${source}`);
  }

  if (lines.length === 0) {
    return '';
  }

  return `---\n${lines.join('\n')}\n---\n\n`;
}

function isAiImported(relativePath, frontmatterSource) {
  const normalizedPath = relativePath.split(path.sep).join('/').toLowerCase();
  const source = String(frontmatterSource || '').trim().toLowerCase();

  if (normalizedPath.startsWith('inbox/ai chats/')) {
    return true;
  }

  const aiSources = new Set([
    'claude',
    'codex',
    'chatgpt',
    'gpt',
    'gemini',
    'ai'
  ]);

  return aiSources.has(source);
}

function parseMarkdownFile(relativePath, content) {
  const fileName = path.basename(relativePath);
  const { frontmatter, body: contentWithoutFrontmatter } = parseFrontmatter(content);
  const lines = contentWithoutFrontmatter.split('\n');

  let title = '';
  let body = contentWithoutFrontmatter;

  if (lines.length > 0 && lines[0].startsWith('# ')) {
    title = lines[0].replace(/^# /, '').trim();
    body = lines.slice(2).join('\n').trimStart();
  }

  if (!title) {
    title = fileName.replace(/\.md$/i, '');
  }

  const aiImported = isAiImported(relativePath, frontmatter.source);

  return {
    id: `vault:${relativePath}`,
    title,
    // Baseline against which the renderer detects an intentional title change.
    // Equal to `title` at load time; the rename gate in checkSaveCollision
    // fires only when note.title diverges from note.loadedTitle.
    loadedTitle: title,
    body,
    meta: aiImported ? 'AI import note' : 'File note',
    fileName,
    relativePath,
    source: 'vault',
    aiImported,
    frontmatter: {
      tags: normalizeTags(frontmatter.tags),
      source: frontmatter.source || ''
    }
  };
}

function walkMarkdownFiles(rootPath, currentPath = rootPath) {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(rootPath, fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(path.relative(rootPath, fullPath));
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function stopWatchingVault() {
  if (currentVaultWatcher) {
    currentVaultWatcher.close();
    currentVaultWatcher = null;
  }

  currentWatchedVaultPath = '';

  if (watchDebounceTimer) {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = null;
  }
}

function startWatchingVault(vaultPath) {
  stopWatchingVault();

  ensureVaultExists(vaultPath);
  currentWatchedVaultPath = vaultPath;

  currentVaultWatcher = fs.watch(vaultPath, { recursive: true }, (eventType, fileName) => {
    const isMarkdownFile =
      !fileName || String(fileName).toLowerCase().endsWith('.md');

    if (!isMarkdownFile) {
      return;
    }

    if (watchDebounceTimer) {
      clearTimeout(watchDebounceTimer);
    }

    watchDebounceTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vault-changed', {
          vaultPath: currentWatchedVaultPath,
          eventType,
          fileName: fileName || ''
        });
      }
    }, 250);
  });
}

function buildDemoVaultFiles() {
  return [
    {
      relativePath: 'Welcome.md',
      title: 'Welcome to the Demo Vault',
      body: `# Welcome to the Demo Vault

This vault exists so you can demo the app end-to-end.

## What to try
- open different notes
- search for keywords like vault, meeting, claude, codex
- click the AI Imports filter
- edit a note and save it
- create a new note from a template
- delete a draft or file-backed note`,
      frontmatter: {
        tags: ['demo', 'welcome'],
        source: 'manual'
      }
    },
    {
      relativePath: 'Projects/Project Roadmap.md',
      title: 'Project Roadmap',
      body: `# Project Roadmap

## Phase 1
- basic editor
- save and load

## Phase 2
- metadata
- AI imports
- search quality`,
      frontmatter: {
        tags: ['project', 'roadmap'],
        source: 'manual'
      }
    },
    {
      relativePath: 'Meetings/Weekly Sync.md',
      title: 'Weekly Sync',
      body: `# Weekly Sync

## Attendees
- Alex
- Sam

## Decisions
- keep the MVP local-first
- simplify before scaling

## Action Items
- improve demo flow
- test watcher refresh`,
      frontmatter: {
        tags: ['meeting', 'team'],
        source: 'manual'
      }
    },
    {
      relativePath: 'Inbox/AI Chats/Claude Session.md',
      title: 'Claude Session',
      body: `# Claude Session

We discussed how to structure the note ingestion workflow.

## Key points
- keep Markdown files simple
- store imported chats in Inbox/AI Chats
- use frontmatter for lightweight metadata`,
      frontmatter: {
        tags: ['chat', 'claude', 'imported'],
        source: 'claude'
      }
    },
    {
      relativePath: 'Inbox/AI Chats/Codex Output.md',
      title: 'Codex Output',
      body: `# Codex Output

Codex suggested a cleaner save-and-refresh flow.

## Suggested improvements
- preserve file identity
- refresh after save
- keep UI status messages clear`,
      frontmatter: {
        tags: ['chat', 'codex', 'imported'],
        source: 'codex'
      }
    }
  ];
}

function writeMarkdownNote(vaultPath, relativePath, title, body, frontmatter = {}) {
  const fullPath = path.join(vaultPath, relativePath);
  const parentDir = path.dirname(fullPath);

  ensureDirExists(parentDir);

  const frontmatterText = serializeFrontmatter(frontmatter);
  const markdownContent = `${frontmatterText}# ${title}\n\n${body || ''}`;

  fs.writeFileSync(fullPath, markdownContent, 'utf8');
}

ipcMain.handle('choose-vault-folder', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true
      };
    }

    return {
      ok: true,
      vaultPath: result.filePaths[0]
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.handle('watch-vault-folder', async (_event, payload) => {
  try {
    const { vaultPath } = payload;

    if (!vaultPath) {
      return {
        ok: false,
        error: 'No vault folder selected.'
      };
    }

    startWatchingVault(vaultPath);

    return {
      ok: true,
      vaultPath
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.handle('unwatch-vault-folder', async () => {
  try {
    stopWatchingVault();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.handle('seed-demo-vault', async (_event, payload) => {
  try {
    const { vaultPath } = payload;

    if (!vaultPath) {
      return {
        ok: false,
        error: 'No vault folder selected.'
      };
    }

    ensureVaultExists(vaultPath);

    const demoFiles = buildDemoVaultFiles();

    for (const file of demoFiles) {
      writeMarkdownNote(
        vaultPath,
        file.relativePath,
        file.title,
        file.body,
        file.frontmatter
      );
    }

    return {
      ok: true,
      createdCount: demoFiles.length
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.handle('save-note', async (_event, payload) => {
  try {
    const { vaultPath, note } = payload;

    if (!vaultPath) {
      return {
        ok: false,
        error: 'No vault folder selected.'
      };
    }

    ensureVaultExists(vaultPath);

    const safeTitle =
      note.title && note.title.trim().length > 0
        ? note.title.trim()
        : 'Untitled note';

    const frontmatterText = serializeFrontmatter(note.frontmatter);
    const markdownContent = `${frontmatterText}# ${safeTitle}\n\n${note.body || ''}`;

    // performSaveNote runs the rename gate, the duplicate-name check, and the
    // no-overwrite disk write semantics in one call. It returns the same
    // shape of response the IPC contract has always produced, with optional
    // additive fields (`renamed`, `oldRelativePath`) on a successful rename.
    return performSaveNote({
      vaultPath,
      note,
      content: markdownContent,
      fs,
      path,
    });
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.handle('delete-note-file', async (_event, payload) => {
  try {
    const { vaultPath, relativePath } = payload;

    if (!vaultPath) {
      return {
        ok: false,
        error: 'No vault folder selected.'
      };
    }

    if (!relativePath) {
      return {
        ok: false,
        error: 'No relative path provided.'
      };
    }

    ensureVaultExists(vaultPath);

    const fullPath = path.join(vaultPath, relativePath);

    if (!fs.existsSync(fullPath)) {
      return {
        ok: false,
        error: 'File does not exist.'
      };
    }

    fs.unlinkSync(fullPath);

    return {
      ok: true,
      relativePath,
      fileName: path.basename(relativePath)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.handle('load-vault-notes', async (_event, payload) => {
  try {
    const { vaultPath } = payload;

    if (!vaultPath) {
      return {
        ok: false,
        error: 'No vault folder selected.'
      };
    }

    ensureVaultExists(vaultPath);

    const relativePaths = walkMarkdownFiles(vaultPath);

    const notes = relativePaths.map((relativePath) => {
      const fullPath = path.join(vaultPath, relativePath);
      const content = fs.readFileSync(fullPath, 'utf8');
      return parseMarkdownFile(relativePath, content);
    });

    return {
      ok: true,
      notes
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', (event) => {
  // Stage 6.3A: Cmd+Q (and any app.quit() not triggered by the guard
  // itself) must run through the dirty-summary prompt first. Once the
  // guard has confirmed close, we let this handler fall through and
  // the app shuts down normally.
  if (!closeController.isConfirmed()) {
    event.preventDefault();
    runCloseGuardForSource('before-quit');
    return;
  }
  stopWatchingVault();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});