'use strict';
// Shared restricted entry: synthetic editing QA or explicit document-first read-only mode.
const { app, BrowserWindow, ipcMain, session, dialog, Menu } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDocumentService } = require('./document-service');
const { createDocumentSessions, registerDocumentIpc } = require('./document-session-ipc');
const readOnlyWindow = process.argv.includes('--document-readonly');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-demo-')));
fs.chmodSync(root, 0o700);
const profile = path.join(root, 'profile'); fs.mkdirSync(profile, { mode: 0o700 });
app.setName(readOnlyWindow ? 'Markdown Document Viewer' : 'Document synthetic memory QA');
app.setPath('userData', profile); app.setPath('sessionData', profile);
const crashes = path.join(profile, 'crashes'); fs.mkdirSync(crashes, { mode: 0o700 });
app.setPath('crashDumps', crashes);
app.commandLine.appendSwitch('disable-background-networking');
const fixtures = readOnlyWindow ? [] : [
  ['a.md', '\ufeff---\r\nprivate: synthetic\r\n---\r\n# 合成标题😀\r\n\r\nA **粗体中文** end.\r\n\r\n![pic](../assets/x.png)\r\n\r\n| x | y |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\n::: unknown\r\n'],
  ['b.md', '# Second synthetic document\n\nOriginal second body.\n'],
];
for (const [name, source] of fixtures) fs.writeFileSync(path.join(root, name), source, { flag: 'wx', mode: 0o640 });
app.whenReady().then(async () => {
  const { projectSource, mapTextEdit } = await import('./document-source-map.mjs');
  const service = createDocumentService(); // Never unsafeExperimentalRoot here.
  const manager = createDocumentSessions({ service, projectSource, mapTextEdit, windowFor: wc => BrowserWindow.fromWebContents(wc),
    chooseFile: readOnlyWindow ? async win => {
      const result = await dialog.showOpenDialog(win, { title: 'Open Markdown file',
        properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!win.isDestroyed()) win.focus(); // Restore the document window after the native sheet.
      return result;
    } : null });
  registerDocumentIpc(ipcMain, manager);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }));
  const win = new BrowserWindow({ width: 1050, height: 800, title: readOnlyWindow ? 'Markdown — Read-only' : 'Phase 1B-2 — synthetic memory only',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false,
      preload: path.join(__dirname, 'document-demo-preload.js') } });
  if (readOnlyWindow) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { label: 'File', submenu: [
      { label: 'Open Markdown…', accelerator: 'CmdOrCtrl+O', click: () => {
        if (!win.isDestroyed()) win.webContents.send('document-demo:open-request');
      } }, { role: 'close' } ] },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
  ]));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => { event.preventDefault(); manager.revoke(win); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  const html = path.join(__dirname, 'document-demo.html');
  await win.loadFile(html);
  manager.grant(win, pathToFileURL(html).href);
  for (const [name] of fixtures) {
    const opened = service.open(path.join(root, name));
    if (!opened.ok) throw Error('Synthetic fixture refused');
    manager.provision(win, opened.document, name);
  }
  win.webContents.send('document-demo:ready', { readOnlyWindow });
}).catch(() => { console.error('Synthetic document demo startup failed'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
