const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');

test('Finder event workflow: cold start, warm opens, draft/history isolation, composition deferral and refusal', async ({}, info) => {
  test.setTimeout(90000);
  if (!process.env.E2E_ELECTRON_EXECUTABLE) throw Error('isolated Electron required');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-native-open-e2e-')));
  const original = path.join(root, '中文 first article.md'), second = path.join(root, 'Second.md');
  const before = Buffer.from('\ufeff# 原文\r\n\r\nSynthetic first paragraph.\r\n');
  await fs.writeFile(original, before, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(second, '# Second\n\nSynthetic second paragraph.', { flag: 'wx', mode: 0o600 });
  const entry = path.join(root, 'cold-entry.cjs');
  // Deliver the OS event before whenReady resolves, without product test switches.
  await fs.writeFile(entry, `require(${JSON.stringify(path.resolve(__dirname, '../main.js'))});\nrequire('electron').app.emit('open-file',{preventDefault(){}},${JSON.stringify(original)});\n`, { flag: 'wx' });
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-safe-create-')));
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
  for (const k of ['TMPDIR', 'TMP', 'TEMP']) if (process.env[k]) env[k] = process.env[k];
  let app, outcome = { ok: false, root }; const faults = [];
  const snapshot = p => p.evaluate(async () => (await window.documentDemo.snapshot({ sessionId: document.querySelector('#documents').value })).snapshot);
  const emit = file => app.evaluate(({ app }, target) => app.emit('open-file', { preventDefault() {} }, target), file);
  try {
    app = await _electron.launch({ executablePath: process.env.E2E_ELECTRON_EXECUTABLE,
      args: [entry, '--document-readonly', '--document-persistent-copy', '--document-drafts-test-root=' + path.join(root, 'drafts'), '--document-recents-test-root=' + path.join(root, 'recents')],
      cwd, env, chromiumSandbox: true });
    const p = await app.firstWindow(); p.on('pageerror', e => faults.push(e.message));
    await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showMessageBoxSync = () => 1; dialog.showMessageBox = async () => ({ response: 1 }); BrowserWindow.getAllWindows()[0].hide(); });
    await expect(p.locator('#document-name')).toHaveText(path.basename(original));
    const first = await snapshot(p); expect(first.readOnly).toBe(true); expect(first.bom).toBe(true);
    await emit(original); await expect.poll(async () => (await p.evaluate(() => window.documentDemo.listNativeOpens())).requests.length).toBe(0);
    expect((await snapshot(p)).sessionId).toBe(first.sessionId); await expect(p.locator('#documents option')).toHaveCount(1);
    await p.locator('#edit-copy').click(); const draft = await snapshot(p);
    const paragraph = p.locator('#editor .tiptap > p').first(); await paragraph.click(); await p.keyboard.press('End'); await p.keyboard.insertText('X');
    await expect.poll(async () => (await snapshot(p))?.source).toBe(first.source.replace('paragraph.', 'paragraph.X'));
    await expect.poll(async () => { const s = await snapshot(p); return s.draftBackup?.state === 'backed-up' && s.draftBackup.revision === s.revision; }).toBe(true);
    const edited = await snapshot(p);
    await emit(second); await expect(p.locator('#document-name')).toHaveText('Second.md'); await expect(p.locator('#documents option')).toHaveCount(3);
    await p.locator('[data-session-id="'+draft.sessionId+'"]').click(); await expect(p.locator('#document-name')).toHaveText(draft.label);
    expect((await snapshot(p)).source).toBe(edited.source);
    await p.locator('#format-undo').click(); await expect.poll(async () => (await snapshot(p)).source).toBe(first.source);
    await p.locator('#format-redo').click(); await expect.poll(async () => (await snapshot(p)).source).toBe(edited.source);
    // Controlled browser composition events test the switching fence, not native IME acceptance.
    await paragraph.dispatchEvent('compositionstart', { data: '' });
    await emit(original); await expect(p.locator('#native-open-panel')).toBeVisible();
    await expect(p.locator('#native-open-next')).toBeDisabled(); expect((await snapshot(p)).sessionId).toBe(draft.sessionId);
    await paragraph.dispatchEvent('compositionend', { data: '' });
    await expect(p.locator('#native-open-next')).toBeEnabled(); expect((await snapshot(p)).source).toBe(edited.source);
    await p.locator('#native-open-next').click(); await expect(p.locator('#document-name')).toHaveText(path.basename(original));
    await expect(p.locator('#documents option')).toHaveCount(3);
    // Do not interrupt an explicit modal or silently forget the Finder request.
    await p.locator('#show-details').click(); await emit(second);
    await expect(p.locator('#native-open-next')).toBeDisabled(); await p.keyboard.press('Escape');
    await expect(p.locator('#native-open-next')).toBeEnabled(); await p.locator('#native-open-next').click();
    await expect(p.locator('#document-name')).toHaveText('Second.md');
    await fs.writeFile(second, 'External synthetic change'); await emit(second);
    await expect(p.locator('#native-open-status')).toContainText('磁盘文件已变化');
    expect((await snapshot(p)).source).toBe('# Second\n\nSynthetic second paragraph.');
    await emit(path.join(root, 'missing.md')); await expect(p.locator('#native-open-next')).toBeEnabled(); await p.locator('#native-open-next').click();
    await expect(p.locator('#native-open-status')).toContainText('文件已不存在');
    await p.locator('[data-session-id="'+draft.sessionId+'"]').click(); expect((await snapshot(p)).source).toBe(edited.source);
    expect(await fs.readFile(original)).toEqual(before);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await p.screenshot({ path: info.outputPath('finder-open-workspace.png') });
    expect(faults).toEqual([]);
    outcome = { ok: true, root, coldEventBeforeReady: true, warmOpen: true, deduplicated: true, retainedDraftAndHistory: true,
      compositionAndModalDeferred: true, externalChangeRefused: true, originalSha256: createHash('sha256').update(before).digest('hex'), nativeIME: 'NOT VERIFIED', osLaunchServices: 'separate package check' };
  } finally {
    if (app) await app.close();
    await fs.writeFile(info.outputPath('evidence.json'), JSON.stringify(outcome, null, 2));
  }
});
