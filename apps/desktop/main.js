const { app, BrowserWindow, ipcMain } = require('electron');
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

ipcMain.handle('save-note', async (_event, note) => {
  try {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const vaultPath = path.join(projectRoot, 'vault-demo');

    if (!fs.existsSync(vaultPath)) {
      fs.mkdirSync(vaultPath, { recursive: true });
    }

    const safeTitle =
      note.title && note.title.trim().length > 0
        ? note.title.trim()
        : 'Untitled note';

    const fileNameBase = sanitizeFileName(safeTitle) || 'untitled-note';
    const fileName = `${fileNameBase}.md`;
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