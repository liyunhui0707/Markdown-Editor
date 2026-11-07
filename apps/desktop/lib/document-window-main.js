'use strict';
const {MAX_DOCUMENT_BYTES} = require('./document-capacity');
// One shared document lifecycle; only trusted entry code selects product mode.
function startDocumentWindow({ product = false } = {}) {
const { app, BrowserWindow, ipcMain, session, dialog, Menu, utilityProcess, shell, nativeImage } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDocumentService } = require('./document-service');
const { suggestCopyPath } = require('./document-save-policy');
const { createDocumentSessions, registerDocumentIpc } = require('./document-session-ipc');
const { readOnlyWindow, persistentCopies, testCopies, drafts } = require('./document-launch-mode').resolveLaunchMode({
  product, packaged: app.isPackaged, mas: process.mas, platform: process.platform, argv: process.argv });
let productWindow;
const nativeOpens = readOnlyWindow ? require('./document-native-open').createNativeOpenQueue() : null;
function focusDocumentWindow() {
  if (!productWindow || productWindow.isDestroyed()) return;
  if (productWindow.isMinimized()) productWindow.restore();
  productWindow.show(); productWindow.focus();
}
// Must precede whenReady: Finder can send the first file during cold launch.
if (nativeOpens) app.on('open-file', (event, file) => {
  event.preventDefault(); nativeOpens.enqueue(file); focusDocumentWindow();
});
if (product) {
  app.setName('Markdown');
  // Stable profile supplies a single-instance lock; drafts keep their existing location.
  app.setPath('userData', path.join(app.getPath('appData'), 'Markdown Vault Document'));
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', focusDocumentWindow);
  // Establish the same cwd-bound authority as the development launcher BEFORE
  // service/window/IPC creation. It is main-created and fixed for this lifetime.
  const createRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-safe-create-')));
  fs.chmodSync(createRoot, 0o700); process.chdir(createRoot);
}
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-demo-')));
fs.chmodSync(root, 0o700);
const profile = path.join(root, 'profile'); fs.mkdirSync(profile, { mode: 0o700 });
if (!product) {
  app.setName(readOnlyWindow ? 'Markdown Document Viewer' : 'Document synthetic memory QA');
  app.setPath('userData', profile);
}
app.setPath('sessionData', profile);
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
  const images = require('./document-local-images').createLocalImages({projectSource, validateRaster: asset => {
    const decoded = nativeImage.createFromBuffer(asset.bytes), size = decoded.getSize();
    return !decoded.isEmpty() && size.width === asset.width && size.height === asset.height;
  }});
  const writer = persistentCopies ? require('./document-copy-process').createCopyProcess({ fork: utilityProcess.fork.bind(utilityProcess) }) : null;
  if (writer) app.on('before-quit', () => writer.cancelAll());
  let originalWriter=null;
  if(persistentCopies&&drafts){
    try{
      const override=!product&&process.argv.find(a=>a.startsWith('--document-original-saves-test-root='))?.split('=').slice(1).join('=');
      if(override&&(app.isPackaged||!path.isAbsolute(override)||!fs.realpathSync(path.dirname(override)).startsWith(fs.realpathSync(os.tmpdir())+path.sep)))throw Error('Invalid save test root');
      originalWriter=require('./document-original-save').createOriginalSave({root:override||path.join(app.getPath('userData'),'Original Save Versions'),
        binary:app.isPackaged?path.join(process.resourcesPath,'document-save'):path.join(__dirname,'../build/document-save')});
    }catch{/* No original-write capability if recovery storage cannot be established. */}
  }
  if(originalWriter)app.on('before-quit',()=>originalWriter.cancelAll());
  const service = createDocumentService(testCopies ? { isolatedCreateRoot: process.cwd(), attachmentsFor: images.attachments, ...(originalWriter?{originalWriter}:{}), ...(writer ? { persistentWriter: writer.create } : {}) } : {}); // Never unsafeExperimentalRoot.
  let draftStore = null, draftError = null;
  if (drafts) {
    try {
      const override = !product && process.argv.find(a => a.startsWith('--document-drafts-test-root='))?.split('=').slice(1).join('=');
      const parent = fs.realpathSync(app.getPath('appData'));
      const draftRoot = override || path.join(parent, 'Markdown Vault Document Drafts');
      if (override && (app.isPackaged || !path.isAbsolute(override)
          || !fs.realpathSync(path.dirname(override)).startsWith(fs.realpathSync(os.tmpdir()) + path.sep))) throw Error('Invalid draft test root');
      draftStore = require('./document-draft-store').createDraftStore(draftRoot);
    } catch { draftError = 'draft-directory-unavailable'; }
  }
  let recentFiles = null;
  if (readOnlyWindow) {
    try {
      const override = !product && process.argv.find(a => a.startsWith('--document-recents-test-root='))?.split('=').slice(1).join('=');
      if (override && (app.isPackaged || !path.isAbsolute(override)
          || !fs.realpathSync(path.dirname(override)).startsWith(fs.realpathSync(os.tmpdir()) + path.sep))) throw Error('Invalid recent test root');
      recentFiles = require('./document-recent-files').createRecentFiles(override || path.join(app.getPath('userData'), 'Recent Documents'));
    } catch { /* History unavailable: native open and drafts remain usable. */ }
  }
  let temporaryCreated = false, temporaryNumber = 0;
  const manager = createDocumentSessions({ service, draftStore, recentFiles, images, nativeOpens,
    confirmOriginalSave: originalWriter?async(win,file)=>{
      const r=await dialog.showMessageBox(win,{type:'warning',message:'保存回原文件？',detail:`${file}\n已确认正文将写回这个文件，旧版本保留在本机恢复目录。外部修改会报告冲突；极窄竞态下原路径可能已更新，被换下的版本会保留，不会自动覆盖回去。仅用于未同步的普通本地文件。之后点击保存仍使用这个目标。`,buttons:['取消','保存并保留旧版本'],defaultId:0,cancelId:0,noLink:true});return r.response===1;
    }:null,
    chooseImage: win => dialog.showOpenDialog(win, {title: '选择本地图片', properties: ['openFile', 'dontAddToRecent'], filters: [{name: 'PNG / JPEG · 每张最多 4 MiB', extensions: ['png','jpg','jpeg']}] }),
    confirmClose: readOnlyWindow ? async (win, label) => {
      const result = await dialog.showMessageBox(win, { type: 'question',
        message: `关闭“${label}”？`, detail: '关闭前会验证本地草稿。正文可从“草稿”恢复；撤销历史与文件导出回执不会随草稿恢复。原文件和已导出的文件保持不变。',
        buttons: ['取消', '保留草稿并关闭'], defaultId: 0, cancelId: 0, noLink: true });
      return result.response === 1;
    } : null, revealFile: file => shell.showItemInFolder(file), allowTestCopies: testCopies, chooseCopy: persistentCopies ? async (win, { suggestedName } = {}) => {
      const accepted = await dialog.showMessageBox(win, { type: 'warning', message: '另存为新的 Markdown 文件？',
        detail: '请选择主文件夹内的普通本地文件夹及其子文件夹，例如下载或你自行准备的 Markdown Writing；目录仍需通过 APFS、所有权、权限与身份检查。仅支持 macOS 防止删除目录自身的默认权限，其他额外权限仍可能被拒绝。本地且未同步的桌面、文稿也需通过检查。主文件夹本身、资源库、应用程序、隐藏及同步目录不受支持。仅在确认该目录未被其他应用同步时继续。只创建新的 .md；所选本地图片会作为同目录附件导出，移动时请一起移动。已有文件绝不覆盖。后续修改保留在草稿中，不会自动更新新文件。',
        buttons: ['取消', '选择本地文件夹…'], defaultId: 0, cancelId: 0, noLink: true });
      if (accepted.response !== 1 || win.isDestroyed()) return { canceled: true };
      const selected = await dialog.showSaveDialog(win, { title: '另存为新 Markdown 文件', defaultPath: suggestCopyPath(app.getPath('downloads'), suggestedName),
        message: '请选择主文件夹内的普通本地 APFS 文件夹及其子文件夹；仍需通过权限检查。支持通过检查的下载目录；其他额外权限仍可能被拒绝。支持通过检查的本地桌面、文稿；iCloud 同步的桌面、文稿仍不支持。主文件夹、资源库、应用程序及同步目录不受支持。只创建新文件，不覆盖。',
        nameFieldLabel: '新文件名：', filters: [{ name: 'Markdown', extensions: ['md'] }],
        properties: ['showOverwriteConfirmation', 'dontAddToRecent'], securityScopedBookmarks: false });
      if (!win.isDestroyed()) win.focus();
      return selected; // Non-MAS, bookmarks disabled; no file precreation is requested.
    } : null, projectSource, mapTextEdit, mapFormatEdit, windowFor: wc => BrowserWindow.fromWebContents(wc),
    createTemporary: readOnlyWindow ? (bytes = Buffer.alloc(0)) => {
      // Trusted main-owned bytes only: empty document or independent copy of an opened snapshot.
      const file = path.join(testCopies ? process.cwd() : root, `temporary-${++temporaryNumber}.md`);
      fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
      const opened = service.open(file, { parse: projectSource, maxBytes: MAX_DOCUMENT_BYTES, ...(testCopies ? { syntheticTemporary: true } : {}) });
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
  productWindow = win;
  if (readOnlyWindow) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { label: '文件', submenu: [
      { label: '打开 Markdown…', accelerator: 'CmdOrCtrl+O', click: () => {
        if (!win.isDestroyed()) win.webContents.send('document-demo:open-request');
      } }, {label:'保存',accelerator:'CmdOrCtrl+S',click:()=>{if(!win.isDestroyed())win.webContents.send('document-demo:save-request');}}, { label: '关闭当前文档', accelerator: 'CmdOrCtrl+W', click: () => {
        if (!win.isDestroyed()) win.webContents.send('document-demo:close-request');
      } }, { role: 'close', label: '关闭窗口', accelerator: 'CmdOrCtrl+Shift+W' } ] },
    { label: '编辑', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  win.on('close', event => {
    manager.flushDrafts();
    // Keep the warning even after session revocation: renderer-only drafts may exist.
    if (temporaryCreated && dialog.showMessageBoxSync(win, { type: 'warning',
      message: '关闭当前草稿窗口？',
      detail: draftStore ? '仅最近已确认并成功备份的正文可在下次启动时恢复。尚未备份、未应用的源码修改、未提交的输入法文字及输入恢复记录仍可能丢失。草稿备份不等于已保存 Markdown；新文件也不会自动更新。取消可返回检查备份状态。' : testCopies ? 'Temporary writing and recovery records remain in memory. Test copy receipts describe files that may exist in the disposable test directory. Only confirmed revisions have verified contents. New files explicitly created with Save as new file remain at their last verified location; later changes are not saved. Cancel to review or copy your text.' : 'Temporary writing and recovery copies exist only in this process. Closing, refreshing or a crash loses them. No edited text has been saved to disk. Cancel to select and copy text before closing.',
      buttons: ['取消', '关闭窗口'], defaultId: 0, cancelId: 0, noLink: true }) !== 1) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => { event.preventDefault(); manager.revoke(win); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  const html = path.join(__dirname, 'document-demo.html');
  await win.loadFile(html);
  manager.grant(win, pathToFileURL(html).href);
  nativeOpens?.subscribe(() => {
    if (!win.isDestroyed()) win.webContents.send('document-demo:native-open-request');
  });
  for (const [name] of fixtures) {
    const opened = service.open(path.join(root, name));
    if (!opened.ok) throw Error('Synthetic fixture refused');
    manager.provision(win, opened.document, name);
  }
  win.webContents.send('document-demo:ready', { readOnlyWindow, draftsEnabled: !!draftStore, draftError });
}).catch(() => { console.error('Document window startup failed'); app.exit(1); });
app.on('window-all-closed', () => app.quit());

}
module.exports = { startDocumentWindow };
