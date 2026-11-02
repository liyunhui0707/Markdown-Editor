'use strict';
// Shared restricted entry: synthetic editing QA or explicit document-first read-only mode.
const { app, BrowserWindow, ipcMain, session, dialog, Menu, utilityProcess } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDocumentService } = require('./document-service');
const { createDocumentSessions, registerDocumentIpc } = require('./document-session-ipc');
const readOnlyWindow = process.argv.includes('--document-readonly');
const persistentCopies = readOnlyWindow && !app.isPackaged && !process.mas && process.argv.includes('--document-persistent-copy');
const testCopies = readOnlyWindow && !app.isPackaged && (process.argv.includes('--document-test-copy') || persistentCopies);
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
  const writer = persistentCopies ? require('./document-copy-process').createCopyProcess({ fork: utilityProcess.fork.bind(utilityProcess) }) : null;
  if (writer) app.on('before-quit', () => writer.cancelAll());
  const service = createDocumentService(testCopies ? { isolatedCreateRoot: process.cwd(), ...(writer ? { persistentWriter: writer.create } : {}) } : {}); // Never unsafeExperimentalRoot.
  let temporaryCreated = false, temporaryNumber = 0;
  const manager = createDocumentSessions({ service, allowTestCopies: testCopies, chooseCopy: persistentCopies ? async win => {
      const accepted = await dialog.showMessageBox(win, { type: 'warning', message: 'Save as a new Markdown file?',
        detail: '请选择主文件夹直属的普通本地文件夹，例如你自行准备的 Markdown Writing；目录仍需通过 APFS、所有权、权限与身份检查。下载等目录可能带有不支持的额外权限（ACL）。主文件夹本身、桌面、文稿、资源库、隐藏及同步目录不受支持。仅在确认该目录未被其他应用同步时继续。只创建新的 .md，已有文件绝不覆盖。当前编辑副本仍为 Not saved，后续修改不会自动更新新文件。',
        buttons: ['Cancel', 'Choose local folder…'], defaultId: 0, cancelId: 0, noLink: true });
      if (accepted.response !== 1 || win.isDestroyed()) return { canceled: true };
      const selected = await dialog.showSaveDialog(win, { title: 'Save as NEW Markdown file', defaultPath: 'Untitled.md',
        message: '请选择主文件夹直属的普通本地 APFS 文件夹；仍需通过权限检查。下载等目录可能因 ACL 被拒绝。主文件夹、桌面、文稿、资源库及同步目录不受支持。只创建新文件，不覆盖。',
        nameFieldLabel: 'New Markdown filename:', filters: [{ name: 'Markdown', extensions: ['md'] }],
        properties: ['showOverwriteConfirmation', 'dontAddToRecent'], securityScopedBookmarks: false });
      if (!win.isDestroyed()) win.focus();
      return selected; // Non-MAS, bookmarks disabled; no file precreation is requested.
    } : null, projectSource, mapTextEdit, windowFor: wc => BrowserWindow.fromWebContents(wc),
    createTemporary: readOnlyWindow ? (bytes = Buffer.alloc(0)) => {
      // Trusted main-owned bytes only: empty document or independent copy of an opened snapshot.
      const file = path.join(testCopies ? process.cwd() : root, `temporary-${++temporaryNumber}.md`);
      fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
      const opened = service.open(file, { parse: projectSource, maxBytes: 524288, ...(testCopies ? { syntheticTemporary: true } : {}) });
      if (opened.ok) temporaryCreated = true;
      return opened;
    } : null,
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
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  win.on('close', event => {
    // Keep the warning even after session revocation: renderer-only drafts may exist.
    if (temporaryCreated && dialog.showMessageBoxSync(win, { type: 'warning',
      message: 'Close without saving temporary documents?',
      detail: testCopies ? 'Temporary writing and recovery records remain in memory. Test copy receipts describe files that may exist in the disposable test directory. Only confirmed revisions have verified contents. New files explicitly created with Save as new file remain at their last verified location; later changes are not saved. Cancel to review or copy your text.' : 'Temporary writing and recovery copies exist only in this process. Closing, refreshing or a crash loses them. No edited text has been saved to disk. Cancel to select and copy text before closing.',
      buttons: ['Cancel', 'Close without saving'], defaultId: 0, cancelId: 0, noLink: true }) !== 1) event.preventDefault();
  });
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
