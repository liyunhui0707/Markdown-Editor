'use strict';
// Shared restricted entry: synthetic editing QA or explicit document-first read-only mode.
const { app, BrowserWindow, ipcMain, session, dialog, Menu, utilityProcess, shell } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDocumentService } = require('./document-service');
const { suggestCopyPath } = require('./document-save-policy');
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
  const { mapFormatEdit } = await import('./document-format-edit.mjs');
  const writer = persistentCopies ? require('./document-copy-process').createCopyProcess({ fork: utilityProcess.fork.bind(utilityProcess) }) : null;
  if (writer) app.on('before-quit', () => writer.cancelAll());
  const service = createDocumentService(testCopies ? { isolatedCreateRoot: process.cwd(), ...(writer ? { persistentWriter: writer.create } : {}) } : {}); // Never unsafeExperimentalRoot.
  let draftStore = null, draftError = null;
  if (readOnlyWindow && !process.argv.includes('--document-no-drafts')) {
    try {
      const override = process.argv.find(a => a.startsWith('--document-drafts-test-root='))?.split('=').slice(1).join('=');
      const parent = fs.realpathSync(app.getPath('appData'));
      const draftRoot = override || path.join(parent, 'Markdown Vault Document Drafts');
      if (override && (app.isPackaged || !path.isAbsolute(override)
          || !fs.realpathSync(path.dirname(override)).startsWith(fs.realpathSync(os.tmpdir()) + path.sep))) throw Error('Invalid draft test root');
      draftStore = require('./document-draft-store').createDraftStore(draftRoot);
    } catch { draftError = 'draft-directory-unavailable'; }
  }
  let temporaryCreated = false, temporaryNumber = 0;
  const manager = createDocumentSessions({ service, draftStore, revealFile: file => shell.showItemInFolder(file), allowTestCopies: testCopies, chooseCopy: persistentCopies ? async win => {
      const accepted = await dialog.showMessageBox(win, { type: 'warning', message: '另存为新的 Markdown 文件？',
        detail: '请选择主文件夹直属的普通本地文件夹，例如下载或你自行准备的 Markdown Writing；目录仍需通过 APFS、所有权、权限与身份检查。仅支持 macOS 防止删除目录自身的默认权限，其他额外权限仍可能被拒绝。主文件夹本身、桌面、文稿、资源库、隐藏及同步目录不受支持。仅在确认该目录未被其他应用同步时继续。只创建新的 .md，已有文件绝不覆盖。后续修改保留在草稿中，不会自动更新新文件。',
        buttons: ['取消', '选择本地文件夹…'], defaultId: 0, cancelId: 0, noLink: true });
      if (accepted.response !== 1 || win.isDestroyed()) return { canceled: true };
      const selected = await dialog.showSaveDialog(win, { title: '另存为新 Markdown 文件', defaultPath: suggestCopyPath(app.getPath('downloads')),
        message: '请选择主文件夹直属的普通本地 APFS 文件夹；仍需通过权限检查。支持通过检查的下载目录；其他额外权限仍可能被拒绝。主文件夹、桌面、文稿、资源库及同步目录不受支持。只创建新文件，不覆盖。',
        nameFieldLabel: '新文件名：', filters: [{ name: 'Markdown', extensions: ['md'] }],
        properties: ['showOverwriteConfirmation', 'dontAddToRecent'], securityScopedBookmarks: false });
      if (!win.isDestroyed()) win.focus();
      return selected; // Non-MAS, bookmarks disabled; no file precreation is requested.
    } : null, projectSource, mapTextEdit, mapFormatEdit, windowFor: wc => BrowserWindow.fromWebContents(wc),
    createTemporary: readOnlyWindow ? (bytes = Buffer.alloc(0)) => {
      // Trusted main-owned bytes only: empty document or independent copy of an opened snapshot.
      const file = path.join(testCopies ? process.cwd() : root, `temporary-${++temporaryNumber}.md`);
      fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
      const opened = service.open(file, { parse: projectSource, maxBytes: 524288, ...(testCopies ? { syntheticTemporary: true } : {}) });
      if (opened.ok) temporaryCreated = true;
      return opened;
    } : null,
    chooseFile: readOnlyWindow ? async win => {
      const result = await dialog.showOpenDialog(win, { title: '打开 Markdown 文件',
        properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!win.isDestroyed()) win.focus(); // Restore the document window after the native sheet.
      return result;
    } : null });
  registerDocumentIpc(ipcMain, manager);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }));
  const win = new BrowserWindow({ width: 1050, height: 800, title: readOnlyWindow ? 'Markdown — 原文只读' : 'Phase 1B-2 — synthetic memory only',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false,
      preload: path.join(__dirname, 'document-demo-preload.js') } });
  if (readOnlyWindow) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { label: '文件', submenu: [
      { label: '打开 Markdown…', accelerator: 'CmdOrCtrl+O', click: () => {
        if (!win.isDestroyed()) win.webContents.send('document-demo:open-request');
      } }, { role: 'close' } ] },
    { label: '编辑', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  win.on('close', event => {
    manager.flushDrafts();
    // Keep the warning even after session revocation: renderer-only drafts may exist.
    if (temporaryCreated && dialog.showMessageBoxSync(win, { type: 'warning',
      message: '关闭当前草稿窗口？',
      detail: draftStore ? '仅最近已确认并成功备份的正文可在下次启动时恢复。尚未备份、未提交的输入法文字及输入恢复记录仍可能丢失。草稿备份不等于已保存 Markdown；新文件也不会自动更新。取消可返回检查备份状态。' : testCopies ? 'Temporary writing and recovery records remain in memory. Test copy receipts describe files that may exist in the disposable test directory. Only confirmed revisions have verified contents. New files explicitly created with Save as new file remain at their last verified location; later changes are not saved. Cancel to review or copy your text.' : 'Temporary writing and recovery copies exist only in this process. Closing, refreshing or a crash loses them. No edited text has been saved to disk. Cancel to select and copy text before closing.',
      buttons: ['取消', '关闭窗口'], defaultId: 0, cancelId: 0, noLink: true }) !== 1) event.preventDefault();
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
  win.webContents.send('document-demo:ready', { readOnlyWindow, draftsEnabled: !!draftStore, draftError });
}).catch(() => { console.error('Synthetic document demo startup failed'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
