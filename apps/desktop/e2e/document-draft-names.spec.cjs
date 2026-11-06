const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { createHomeFixture } = require('../test/helpers/home-fixture.cjs');

test('draft name survives recovery and suggests export name without changing files or history', async ({}, info) => {
  test.setTimeout(60000);
  if (!process.env.E2E_ELECTRON_EXECUTABLE) throw Error('Explicit isolated Electron required');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-names-e2e-')));
  const fixture = createHomeFixture('Writing-synthetic-E2E-');
  const original = path.join(root, 'Original.md'), bytes = Buffer.from('\ufeff# Original\r\n\r\nSynthetic paragraph.\r\n');
  const target = path.join(fixture.dir, '日常写作.md');
  await fs.writeFile(original, bytes, { flag: 'wx', mode: 0o600 });
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) if (process.env[key]) env[key] = process.env[key];
  let app, exited, passed = false, cleanup; const exits = [], faults = [];
  async function launch() {
    const createRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-safe-create-')));
    app = await electron.launch({ executablePath: process.env.E2E_ELECTRON_EXECUTABLE,
      args: [path.resolve(__dirname, '../main.js'), '--document-readonly', '--document-persistent-copy',
        '--document-drafts-test-root=' + path.join(root, 'drafts'), '--document-recents-test-root=' + path.join(root, 'recents')],
      cwd: createRoot, env, chromiumSandbox: true });
    exited = new Promise(resolve => app.process().once('close', (code, signal) => resolve({ code, signal })));
    app.process().stderr.on('data', b => { if (/Uncaught Exception|Object has been destroyed/.test(String(b))) faults.push(String(b)); });
    const page = await app.firstWindow(); page.on('pageerror', e => faults.push(e.message));
    await app.evaluate(({ dialog, BrowserWindow }, paths) => {
      dialog.showMessageBoxSync = () => 1; dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.original] });
      globalThis.nameSuggestions = [];
      dialog.showSaveDialog = async (_win, options) => {
        globalThis.nameSuggestions.push(options.defaultPath);
        return { canceled: false, filePath: paths.target };
      };
      BrowserWindow.getAllWindows()[0].hide();
    }, { original, target });
    await expect(page.locator('#empty-new')).toBeEnabled(); return page;
  }
  async function stop() {
    if (!app) return;
    await app.close(); app = null; const result = await exited; exits.push(result);
    expect(result).toEqual({ code: 0, signal: null });
  }
  const current = page => page.evaluate(async () => (await window.documentDemo.snapshot({ sessionId: document.querySelector('#documents').value })).snapshot);
  async function openName(page) {
    await page.locator('#document-info summary').click(); await page.locator('#rename-draft').click();
    await expect(page.locator('#name-dialog')).toBeVisible();
  }
  async function rename(page, name) {
    await openName(page); await page.locator('#draft-name-input').fill(name); await page.locator('#name-apply').click();
    await expect(page.locator('#name-dialog')).not.toBeVisible();
  }
  async function exportFile(page) {
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#copy-confirm-dialog')).not.toBeVisible();
  }
  try {
    let page = await launch(); await page.locator('#empty-open').click();
    await page.locator('#document-info summary').click(); await expect(page.locator('#rename-draft')).toBeHidden();
    await page.locator('#document-info summary').click(); await page.locator('#edit-copy').click();
    await page.locator('#editor .tiptap p').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' Continued.');
    await expect.poll(async () => (await current(page)).source).toContain('Continued.');
    const before = await current(page);
    await openName(page); await page.locator('#draft-name-input').fill('Cancelled name'); await page.keyboard.press('Escape');
    await expect(page.locator('#name-dialog')).not.toBeVisible(); expect((await current(page)).label).toBe(before.label);
    await openName(page); await page.locator('#draft-name-input').fill('../unsafe'); await page.locator('#name-apply').click();
    await expect(page.locator('#draft-name-error')).toContainText('路径分隔符'); expect((await current(page)).label).toBe(before.label);
    // Controlled composition only: no native IME acceptance is inferred.
    await page.locator('#draft-name-input').dispatchEvent('compositionstart'); await expect(page.locator('#name-apply')).toBeDisabled();
    await page.locator('#draft-name-input').dispatchEvent('compositionend'); await page.locator('#draft-name-input').fill('日常写作.md');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await page.screenshot({ path: info.outputPath('name-dialog.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await page.locator('#name-apply').click(); await expect(page.locator('#name-dialog')).not.toBeVisible();
    let named = await current(page); expect(named.label).toBe('日常写作');
    for (const key of ['source', 'revision', 'canUndo', 'canRedo', 'dirty']) expect(named[key]).toEqual(before[key]);
    await expect(page.locator('#document-name')).toHaveText('日常写作');
    await page.locator('#format-undo').click(); await expect.poll(async () => (await current(page)).source).not.toContain('Continued.');
    await page.locator('#format-redo').click(); await expect.poll(async () => (await current(page)).source).toBe(before.source);
    await exportFile(page); await expect.poll(async () => (await current(page)).copyState?.state).toBe('created-confirmed');
    const exported = await fs.readFile(target), receipt = (await current(page)).copyState;
    expect(exported).toEqual(Buffer.from('\ufeff' + before.source));
    expect(receipt.sha256).toBe(createHash('sha256').update(exported).digest('hex')); fixture.recordFile('日常写作.md', exported);
    expect(path.basename((await app.evaluate(() => globalThis.nameSuggestions))[0])).toBe('日常写作.md');
    await rename(page, '下一篇'); expect((await current(page)).copyState).toEqual(receipt);
    await exportFile(page); await expect.poll(async () => (await current(page)).copyState?.code).toBe('target-exists');
    expect(await fs.readFile(target)).toEqual(exported); expect(await fs.readFile(original)).toEqual(bytes);
    expect(path.basename((await app.evaluate(() => globalThis.nameSuggestions))[1])).toBe('下一篇.md');
    await expect(page.locator('#copy-summary-compact')).toContainText('日常写作.md');
    await expect.poll(async () => (await current(page)).draftBackup?.state).toBe('backed-up'); await stop();
    page = await launch(); await expect(page.locator('#welcome-draft-list button')).toHaveCount(1);
    await expect(page.locator('#welcome-draft-list')).toContainText('下一篇'); await page.locator('#welcome-draft-list button').click();
    named = await current(page); expect(named.label).toBe('下一篇'); expect(named.source).toBe(before.source); expect(named.canUndo).toBe(false);
    await openName(page); await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(680, 800); w.showInactive(); });
    const box = await page.locator('#name-dialog').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(680);
    await page.screenshot({ path: info.outputPath('name-narrow.png') }); await page.locator('#name-cancel').click();
    await app.evaluate(({ dialog, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].hide();
      dialog.showSaveDialog = async (_win, options) => { globalThis.nameSuggestions.push(options.defaultPath); return { canceled: true }; };
    });
    await exportFile(page); await expect(page.locator('#copy-operation-alert')).toContainText('操作已取消');
    expect(path.basename((await app.evaluate(() => globalThis.nameSuggestions))[0])).toBe('下一篇.md');
    expect(await fs.readFile(original)).toEqual(bytes); expect(await fs.readFile(target)).toEqual(exported);
    await stop(); expect(faults).toEqual([]); passed = true;
    await fs.writeFile(info.outputPath('evidence.json'), JSON.stringify({ root, exits, recoveredName: named.label,
      originalSha256: createHash('sha256').update(bytes).digest('hex'), exportedSha256: receipt.sha256,
      defaultFilename: true, historyPreserved: true, existingFileRefused: true, nativeDialogs: 'controlled', nativeIME: 'NOT VERIFIED' }, null, 2));
  } finally {
    await stop(); cleanup = fixture.cleanup({ passed, quiescent: !app && exits.every(e => e.code === 0 && !e.signal) });
    await fs.writeFile(info.outputPath('fixture-cleanup.json'), JSON.stringify(cleanup, null, 2));
  }
  expect(cleanup.state).toBe('removed');
});
