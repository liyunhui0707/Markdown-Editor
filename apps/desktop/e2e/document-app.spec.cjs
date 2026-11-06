const { test, expect, _electron: electron } = require('@playwright/test');
const { authorMixedDocument } = require('./common-authoring.cjs');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createHomeFixture } = require('../test/helpers/home-fixture.cjs');
const hash = b => createHash('sha256').update(b).digest('hex');
test('installed document app: exclusive export, readonly reopen, restart and draft recovery', async ({}, info) => {
  test.skip(!process.env.DOCUMENT_APP_EXECUTABLE, 'Explicit built application required');
  test.setTimeout(90000);
  const exe = process.env.DOCUMENT_APP_EXECUTABLE;
  const fixture = createHomeFixture('Writing-synthetic-E2E-');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'document-installed-qa-'));
  const original = path.join(root, `Installed synthetic ${path.basename(root)}.md`), target = path.join(fixture.dir, 'export.md');
  const raw = Buffer.from('\ufeff# Installed synthetic\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.\r\n\r\nAlpha **bold** omega.\r\n\r\nA [label](<https://example.test/path> "title") tail.\r\n');
  await fs.writeFile(original, raw, { flag: 'wx', mode: 0o600 });
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) if (process.env[key]) env[key] = process.env[key];
  let app, draftId, expected, exported, passed = false;
  const launches = [];
  async function launch() {
    app = await electron.launch({ executablePath: exe, args: [], env, cwd: '/', chromiumSandbox: true });
    const child = app.process(), errors = [];
    child.stderr.on('data', b => { if (/Uncaught Exception|Object has been destroyed/.test(b.toString())) errors.push('runtime-fault'); });
    const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), cwd: process.cwd(), appPath: app.getAppPath() }));
    expect(identity.packaged).toBe(true); expect(identity.appPath).toContain('app.asar');
    expect(path.basename(identity.cwd)).toMatch(/^document-safe-create-/);
    const page = await app.firstWindow();
    await expect(page.locator('#empty-open')).toBeVisible();
    await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showMessageBoxSync = () => 1; BrowserWindow.getAllWindows()[0].hide(); });
    launches.push({ identity, closed, errors }); return page;
  }
  async function close() {
    if (!app) return;
    await app.close(); app = null;
    expect(await launches.at(-1).closed).toEqual({ code: 0, signal: null }); expect(launches.at(-1).errors).toEqual([]);
  }
  const snapshot = async (page, id) => (await page.evaluate(sessionId => window.documentDemo.snapshot({ sessionId }), id)).snapshot;
  try {
    let page = await launch();
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p.original] });
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p.target });
    }, { original, target });
    await page.locator('#empty-open').click(); const originalId = await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    expect((await page.evaluate(id => window.documentDemo.save({ sessionId: id, expectedRevision: 0 }), originalId)).ok).toBe(false);
    await page.locator('#edit-copy').click(); const id = await page.locator('#documents').inputValue();
    // Verify the new range adapter in the actual ASAR/product entry, not source.
    const rangeBefore = await snapshot(page, id);
    const selected = await page.locator('#editor .tiptap').evaluate(node => {
      const paragraphs = node.querySelectorAll('p'), a = paragraphs[0].firstChild, b = paragraphs[1].firstChild;
      node.focus(); window.getSelection().setBaseAndExtent(b, 7, a, 6);
      document.dispatchEvent(new Event('selectionchange'));
      return [node.editor.view.posAtDOM(a, 6), node.editor.view.posAtDOM(b, 7)];
    });
    await expect.poll(() => page.locator('#editor .tiptap').evaluate(node => [node.editor.state.selection.from, node.editor.state.selection.to])).toEqual(selected);
    await page.keyboard.insertText('合并😀 ');
    const replaced = rangeBefore.source.replace('paragraph.\r\n\r\nSecond ', '合并😀 ');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(replaced);
    await page.keyboard.press('Meta+z');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(rangeBefore.source);
    await page.keyboard.press('Meta+Shift+z');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(replaced);
    // Mixed plain/bold selection must retain source markers and exact history in the ASAR.
    const inlineSelected = await page.locator('#editor .tiptap').evaluate(node => {
      const p = node.querySelectorAll('p')[1], a = p.firstChild, b = p.querySelector('strong').firstChild;
      node.focus(); window.getSelection().setBaseAndExtent(a, 3, b, 2);
      document.dispatchEvent(new Event('selectionchange'));
      return [node.editor.view.posAtDOM(a, 3), node.editor.view.posAtDOM(b, 2)];
    });
    await expect.poll(() => page.locator('#editor .tiptap').evaluate(node => [node.editor.state.selection.from, node.editor.state.selection.to])).toEqual(inlineSelected);
    await page.keyboard.insertText('新😀');
    const inlineReplaced = replaced.replace('ha **bo', '新😀**');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(inlineReplaced);
    await page.keyboard.press('Meta+z');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(replaced);
    await page.keyboard.press('Meta+Shift+z');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(inlineReplaced);
    const caret = async (selector, offset) => {
      const at = await page.locator(selector).evaluate((p, offset) => {
        const root = p.closest('.tiptap'), n = p.firstChild;
        root.focus(); window.getSelection().setBaseAndExtent(n, offset, n, offset);
        document.dispatchEvent(new Event('selectionchange'));
        return root.editor.view.posAtDOM(n, offset);
      }, offset);
      await expect.poll(() => page.locator('#editor .tiptap').evaluate(n => n.editor.state.selection.from)).toBe(at);
    };
    const boundaryKey = async (key, expected) => {
      await page.keyboard.press(key); await expect.poll(async () => (await snapshot(page, id)).source).toBe(expected);
    };
    await caret('#editor strong', 1);
    const paragraphSplit = inlineReplaced.replace('**ld**', '**l**\r\n\r\n**d**');
    await boundaryKey('Enter', paragraphSplit); await boundaryKey('Backspace', inlineReplaced);
    await boundaryKey('Meta+z', paragraphSplit); await boundaryKey('Meta+Shift+z', inlineReplaced);
    await page.locator('#format-block').selectOption('bullet-list');
    const listed = inlineReplaced.replace('Alp新😀', '- Alp新😀');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(listed);
    // The new single-item range path also runs in the installed product ASAR.
    const listRange = await page.locator('#editor li p').evaluate(p => {
      const root = p.closest('.tiptap'), a = p.firstChild, b = p.querySelector('strong').firstChild;
      root.focus(); window.getSelection().setBaseAndExtent(b, 1, a, 2);
      document.dispatchEvent(new Event('selectionchange'));
      return [root.editor.view.posAtDOM(a, 2), root.editor.view.posAtDOM(b, 1)];
    });
    await expect.poll(() => page.locator('#editor .tiptap').evaluate(n => [n.editor.state.selection.from, n.editor.state.selection.to])).toEqual(listRange);
    await page.locator('#editor .tiptap').evaluate(n => {
      const data = new DataTransfer(); data.setData('text/plain', '列表😀');
      n.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    const listReplaced = listed.replace('p新😀**l', '列表😀**');
    await expect.poll(async () => (await snapshot(page, id)).source).toBe(listReplaced);
    await boundaryKey('Meta+z', listed); await boundaryKey('Meta+Shift+z', listReplaced); await boundaryKey('Meta+z', listed);
    await caret('#editor li strong', 1);
    const listSplit=listed.replace('**ld**', '**l**\r\n- **d**');
    await boundaryKey('Enter',listSplit);
    const crossList=await page.locator('#editor .tiptap').evaluate(n=>{
      const a=n.querySelectorAll('li strong')[0].firstChild,b=n.querySelectorAll('li strong')[1].firstChild;n.focus();
      window.getSelection().setBaseAndExtent(b,1,a,0);document.dispatchEvent(new Event('selectionchange'));
      return[n.editor.view.posAtDOM(a,0),n.editor.view.posAtDOM(b,1)];
    });
    await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(crossList);
    await page.keyboard.insertText('跨项');const crossResult=listed.replace('**ld**','**跨项**');
    await expect.poll(async()=>(await snapshot(page,id)).source).toBe(crossResult);
    await boundaryKey('Meta+z',listSplit);await boundaryKey('Meta+Shift+z',crossResult);await boundaryKey('Meta+z',listSplit);
    await caret('#editor li:nth-child(2) strong',0);await boundaryKey('Backspace',listed);
    await caret('#editor li p', 0); await boundaryKey('Backspace', inlineReplaced);
    await page.keyboard.press('End'); await page.keyboard.insertText('Packaged ');
    await expect.poll(async () => (await snapshot(page, id)).source.includes('Packaged ')).toBe(true);
    const beforeItalic=(await snapshot(page,id)).source;
    const italicRange=await page.locator('#editor .tiptap').evaluate(n=>{
      const text=n.querySelector('p').firstChild;n.focus();window.getSelection().setBaseAndExtent(text,5,text,0);document.dispatchEvent(new Event('selectionchange'));
      return[n.editor.view.posAtDOM(text,0),n.editor.view.posAtDOM(text,5)];
    });
    await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(italicRange);
    await page.locator('#format-italic').click();const italicSource=beforeItalic.replace('First','*First*');
    await expect.poll(async()=>(await snapshot(page,id)).source).toBe(italicSource);
    await expect(page.locator('#editor em').first()).toHaveText('First');
    await boundaryKey('Meta+i',beforeItalic);await boundaryKey('Meta+z',italicSource);
    await boundaryKey('Meta+i',beforeItalic);await page.locator('#format-code').click();
    const codeSource=beforeItalic.replace('First','`First`');await expect.poll(async()=>(await snapshot(page,id)).source).toBe(codeSource);
    await expect(page.locator('#editor code').first()).toHaveText('First');
    await boundaryKey('Meta+e',beforeItalic);await boundaryKey('Meta+z',codeSource);
    const beforeLink=(await snapshot(page,id)).source;
    await caret('#editor [data-document-link]',2);await page.keyboard.insertText('新');
    const linkSource=beforeLink.replace('[label]','[la新bel]');
    await expect.poll(async()=>(await snapshot(page,id)).source).toBe(linkSource);
    await expect(page.locator('#editor a')).toHaveCount(0);
    await boundaryKey('Meta+z',beforeLink);await boundaryKey('Meta+Shift+z',linkSource);
    await authorMixedDocument(page,async()=>(await snapshot(page,id)).source,{append:true,newline:'\r\n'});
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#open-confirmed-copy')).toBeVisible();
    exported = await snapshot(page, id); expect(exported.confirmedCopy.state).toBe('created-confirmed'); expect(exported.dirty).toBe(true);
    const bytes = await fs.readFile(target); expect(hash(bytes)).toBe(exported.confirmedCopy.sha256); fixture.recordFile('export.md', bytes);
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#copy-operation-alert')).toContainText('同名目标已存在');
    await page.locator('#open-confirmed-copy').click(); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    expect((await snapshot(page, await page.locator('#documents').inputValue())).source).toBe(exported.source);
    await page.locator('#document-info > summary').click(); await page.locator('#documents').selectOption(id); await page.keyboard.press('Escape');
    await page.locator('#editor p').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText(' Later draft.');
    await expect.poll(async () => (await snapshot(page, id)).source.includes('Later draft.')).toBe(true);
    expected = (await snapshot(page, id)).source;
    await expect.poll(async () => (await snapshot(page, id)).draftBackup?.state).toBe('backed-up');
    draftId = await page.evaluate(label => window.documentDemo.listDrafts().then(r => r.drafts.find(d => d.label === label)?.id), exported.label);
    expect(typeof draftId).toBe('string');
    // A second ordinary invocation must exit and reuse the current app instance.
    const other = spawn(exe, [], { env, cwd: '/', stdio: 'ignore' });
    expect(await new Promise(resolve => other.once('close', (code, signal) => resolve({ code, signal })))).toEqual({ code: 0, signal: null });
    await page.screenshot({ path: info.outputPath('installed-writing.png') });
    await close();
    page = await launch();
    await page.locator('#show-drafts').click();
    await page.locator(`[data-draft-id="${draftId}"]`).getByRole('button', { name: '恢复副本' }).click();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    const restored = await snapshot(page, await page.locator('#documents').inputValue());
    expect(restored.source).toBe(expected); expect(restored.canUndo).toBe(false); expect(restored.confirmedCopy ?? null).toBeNull();
    expect(await fs.readFile(original)).toEqual(raw); expect(hash(await fs.readFile(target))).toBe(exported.confirmedCopy.sha256);
    await close();
    // Archive only this newly created synthetic draft through the existing app API.
    page = await launch();
    const result = await page.evaluate(async id => {
      const row = (await window.documentDemo.listDrafts()).drafts.find(d => d.id === id);
      return window.documentDemo.manageDraft({ draftId: id, action: 'archive', expectedToken: row.manageToken });
    }, draftId);
    expect(result.ok).toBe(true); await close(); passed = true;
    const record = { version: launches[0].identity.version, originalSha256: hash(raw), exportSha256: exported.confirmedCopy.sha256,
      syntheticDraftId: draftId, syntheticDraft: 'archived in private app store', originalUnchanged: true,
      packaged: true, rangeReplacementUndoRedo: true, inlineRangeReplacementUndoRedo: true, paragraphListBoundaryKeys: true, listItemRangePasteUndoRedo: true, crossListRangeUndoRedo: true, italicToolbarShortcut: true, codeToolbarShortcut: true, mixedAuthoring: true,
      processes: launches.length, nativeDialogs: 'stubbed choices', nativeIME: 'NOT VERIFIED' };
    await fs.writeFile(info.outputPath('evidence.json'), JSON.stringify(record, null, 2));
  } finally {
    await close();
    console.log('installed-fixture:' + JSON.stringify(fixture.cleanup({ passed, quiescent: !app })));
  }
});
