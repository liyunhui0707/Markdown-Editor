const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let currentVaultWatcher = null;
let currentWatchedVaultPath = '';
let watchDebounceTimer = null;

function createWindow() {
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
}

function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

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

    let relativePath = '';

    if (note.source === 'vault' && note.relativePath) {
      relativePath = note.relativePath;
    } else {
      const fileNameBase = sanitizeFileName(safeTitle) || 'untitled-note';
      relativePath = `${fileNameBase}.md`;
    }

    const fullPath = path.join(vaultPath, relativePath);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const frontmatterText = serializeFrontmatter(note.frontmatter);
    const markdownContent = `${frontmatterText}# ${safeTitle}\n\n${note.body || ''}`;

    fs.writeFileSync(fullPath, markdownContent, 'utf8');

    return {
      ok: true,
      path: fullPath,
      fileName: path.basename(relativePath),
      relativePath
    };
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

app.on('before-quit', () => {
  stopWatchingVault();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});