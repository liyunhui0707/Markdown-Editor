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
  app.setName('Markora');
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
  app.setName(readOnlyWindow ? 'Markora QA' : 'Document synthetic memory QA');
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
  if (writer) app.on('will-quit', () => writer.cancelAll());
  let originalWriter=null;
  if(persistentCopies&&drafts){
    try{
      const override=!product&&process.argv.find(a=>a.startsWith('--document-original-saves-test-root='))?.split('=').slice(1).join('=');
      if(override&&(app.isPackaged||!path.isAbsolute(override)||!fs.realpathSync(path.dirname(override)).startsWith(fs.realpathSync(os.tmpdir())+path.sep)))throw Error('Invalid save test root');
      originalWriter=require('./document-original-save').createOriginalSave({root:override||path.join(app.getPath('userData'),'Original Save Versions'),
        binary:app.isPackaged?path.join(process.resourcesPath,'document-save'):path.join(__dirname,'../build/document-save')});
    }catch{/* No original-write capability if recovery storage cannot be established. */}
  }
  if(originalWriter)app.on('will-quit',()=>originalWriter.cancelAll());
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
  let temporaryNumber = 0;
  const openForWriting=!!originalWriter&&!!draftStore&&(product||(!app.isPackaged&&process.argv.includes('--document-writing-open')));
  const manager = createDocumentSessions({ openForWriting, service, draftStore, recentFiles, images, nativeOpens,
    confirmOriginalSave: originalWriter?async(win,file)=>{
      const provider=require('./document-onedrive-policy').oneDriveLayout(path.dirname(file));
      if(!provider)return true;
      const r=await dialog.showMessageBox(win,{type:'info',message:'保存到 OneDrive 本机文件',
        detail:'旧版本会保留在文件旁的隐藏恢复区，可能一起同步。请保留恢复区。本机保存成功不代表云端上传完成，可在 OneDrive 中查看上传状态。',
        buttons:['保存','取消'],defaultId:0,cancelId:1,noLink:true});return r.response===0;
    }:null,
    chooseImage: win => dialog.showOpenDialog(win, {title: '选择本地图片', properties: ['openFile', 'dontAddToRecent'], filters: [{name: 'PNG / JPEG · 每张最多 4 MiB', extensions: ['png','jpg','jpeg']}] }),
    confirmClose: readOnlyWindow ? async (win, label) => {
      const result=await dialog.showMessageBox(win,{type:'question',message:`保存对“${label}”的更改？`,
        detail:'保存会更新当前文件。也可以保留本地草稿后关闭，稍后从“草稿”恢复。',
        buttons:['保存','保留草稿并关闭','取消'],defaultId:0,cancelId:2,noLink:true});
      return ['save','keep-draft',false][result.response]??false;
    } : null, revealFile: file => shell.showItemInFolder(file), allowTestCopies: testCopies, chooseCopy: persistentCopies ? async (win, { suggestedName, mode='save-as' } = {}) => {
      const selected=await dialog.showSaveDialog(win,{title:mode==='export'?'导出 Markdown 副本':'另存为 Markdown',
        defaultPath:suggestCopyPath(app.getPath('downloads'),suggestedName),
        message:mode==='export'?'创建 Markdown 副本及图片附件，当前保存位置不变。':'选择新文件名。保存后继续编辑此文件；已有文件不会被覆盖。',
        nameFieldLabel:'文件名：',filters:[{name:'Markdown',extensions:['md']}],
        properties:['showOverwriteConfirmation','dontAddToRecent'],securityScopedBookmarks:false});
      if(!selected.canceled&&!win.isDestroyed()){
        let provider=null;try{provider=require('./document-onedrive-policy').oneDriveLayout(fs.realpathSync(path.dirname(selected.filePath)));}catch{/* Writer validates the selected destination independently. */}
        if(provider){const result=await dialog.showMessageBox(win,{type:'info',message:'创建 OneDrive 本机文件',detail:'本机写入成功不代表云端上传完成。图片附件会和 Markdown 一起创建，移动时请一起移动。之后保存此文件会保留可能同步的隐藏恢复区。',buttons:['继续','取消'],defaultId:0,cancelId:1,noLink:true});if(result.response!==0)return {canceled:true};}
      }
      if(!win.isDestroyed())win.focus();return selected;
    } : null, projectSource, mapTextEdit, mapFormatEdit, windowFor: wc => BrowserWindow.fromWebContents(wc),
    createTemporary: readOnlyWindow ? (bytes = Buffer.alloc(0)) => {
      // Trusted main-owned bytes only: empty document or independent copy of an opened snapshot.
      const file = path.join(testCopies ? process.cwd() : root, `temporary-${++temporaryNumber}.md`);
      fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
      const opened = service.open(file, { parse: projectSource, maxBytes: MAX_DOCUMENT_BYTES, ...(testCopies ? { syntheticTemporary: true } : {}) });
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
  if(readOnlyWindow){
    const command=(label,accelerator,action)=>({label,accelerator,click:()=>{if(!win.isDestroyed())win.webContents.send('document-demo:file-action',action);}});
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {role:'appMenu'},{label:'文件',submenu:[command('新建','CmdOrCtrl+N','new'),command('打开…','CmdOrCtrl+O','open'),
        {type:'separator'},command('保存','CmdOrCtrl+S','save'),command('另存为…','CmdOrCtrl+Shift+S','save-as'),command('导出 Markdown 副本…',undefined,'export'),
        {type:'separator'},command('关闭当前文档','CmdOrCtrl+W','close'),{role:'close',label:'关闭窗口',accelerator:'CmdOrCtrl+Shift+W'}]},
      {label:'编辑',submenu:[command('撤销','CmdOrCtrl+Z','undo'),command('重做','CmdOrCtrl+Shift+Z','redo'),{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    ]));
    require('./document-window-close').installWindowClose({win,ipcMain,manager,confirmUnavailable:()=>dialog.showMessageBoxSync(win,{type:'warning',message:'关闭状态不可用的窗口？',detail:'无法确认窗口中的输入。已备份正文仍可从“草稿”恢复；未备份、未应用的源码或输入法候选可能丢失。',buttons:['取消','关闭窗口'],defaultId:0,cancelId:0,noLink:true})===1});
  }
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
  win.webContents.send('document-demo:ready', { readOnlyWindow, draftsEnabled: !!draftStore, draftError, openForWriting });
}).catch(() => { console.error('Document window startup failed'); app.exit(1); });
app.on('window-all-closed', () => app.quit());

}
module.exports = { startDocumentWindow };
