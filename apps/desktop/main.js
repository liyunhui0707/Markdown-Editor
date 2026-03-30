const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

function parseMarkdownFile(fileName, content) {
  const lines = content.split('\n');

  let title = '';
  let body = content;

  if (lines.length > 0 && lines[0].startsWith('# ')) {
    title = lines[0].replace(/^# /, '').trim();
    body = lines.slice(2).join('\n').trimStart();
  }

  if (!title) {
    title = fileName.replace(/\.md$/i, '');
  }

  return {
    id: `vault:${fileName}`,
    title,
    body,
    meta: 'File note',
    fileName,
    source: 'vault'
  };
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

    let fileName = '';

    if (note.source === 'vault' && note.fileName) {
      fileName = note.fileName;
    } else {
      const fileNameBase = sanitizeFileName(safeTitle) || 'untitled-note';
      fileName = `${fileNameBase}.md`;
    }

    const fullPath = path.join(vaultPath, fileName);
    const markdownContent = `# ${safeTitle}\n\n${note.body || ''}`;

    fs.writeFileSync(fullPath, markdownContent, 'utf8');

    return {
      ok: true,
      path: fullPath,
      fileName
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
    const { vaultPath, fileName } = payload;

    if (!vaultPath) {
      return {
        ok: false,
        error: 'No vault folder selected.'
      };
    }

    if (!fileName) {
      return {
        ok: false,
        error: 'No file name provided.'
      };
    }

    ensureVaultExists(vaultPath);

    const fullPath = path.join(vaultPath, fileName);

    if (!fs.existsSync(fullPath)) {
      return {
        ok: false,
        error: 'File does not exist.'
      };
    }

    fs.unlinkSync(fullPath);

    return {
      ok: true,
      fileName
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

    const fileNames = fs
      .readdirSync(vaultPath)
      .filter((fileName) => fileName.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b));

    const notes = fileNames.map((fileName) => {
      const fullPath = path.join(vaultPath, fileName);
      const content = fs.readFileSync(fullPath, 'utf8');
      return parseMarkdownFile(fileName, content);
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});