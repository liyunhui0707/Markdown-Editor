const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const desktop = path.resolve(__dirname, '..');
const gone = pid => { try { process.kill(pid, 0); return false; } catch (e) { if (e.code === 'ESRCH') return true; throw e; } };
function owned(pid, group) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map(s => s.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, parent, pgid] of rows) if ((ids.has(parent) || pgid === group) && !ids.has(id)) { ids.add(id); changed = true; }
  }
  return [...ids];
}

test('actual keyboard, composition, history and refusal keep UI and main source synchronized', async ({}, info) => {
  const env = {}; for (const k of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  const app = await electron.launch({ executablePath: process.env.E2E_ELECTRON_EXECUTABLE,
    args: [process.env.DOCUMENT_DEMO_ENTRY || path.join(desktop, 'lib/document-demo-main.js')], cwd: desktop, env, chromiumSandbox: true });
  const child = app.process(), closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let group, ids = [child.pid], stderr = '', functional = false, revoked = 0, timer, watchdog = false, runtimeIdentity;
  child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-32768); });
  try {
    group = Number(execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
    expect(group).toBe(child.pid); ids = owned(child.pid, group);
    await app.evaluate(({ dialog }) => {
      process.on('uncaughtExceptionMonitor', () => console.error('interaction:uncaught'));
      const original = dialog.showErrorBox;
      dialog.showErrorBox = function (...args) { console.error('interaction:error-dialog'); return original.apply(this, args); };
    });
    const runtime = await app.evaluate(({ app }) => ({ profile: app.getPath('userData'), isPackaged: app.isPackaged,
      defaultApp: !!process.defaultApp, electron: process.versions.electron }));
    const { profile, ...identity } = runtime;
    runtimeIdentity = { ...identity, entry: process.env.DOCUMENT_DEMO_ENTRY ? 'actual-asar' : 'source' };
    const root = path.dirname(profile), diskA = await fs.readFile(path.join(root, 'a.md')), diskB = await fs.readFile(path.join(root, 'b.md'));
    expect(path.basename(root)).toMatch(/^document-demo-/);
    const page = await app.firstWindow();
    await page.bringToFront();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.getByRole('button', { name: 'Connect synthetic documents' }).click();
    await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
    const sessions = (await page.evaluate(() => window.documentDemo.list())).sessions;
    const a = sessions[0].sessionId, b = sessions[1].sessionId;
    const snapshot = async id => (await page.evaluate(id => window.documentDemo.snapshot({ sessionId: id }), id)).snapshot;
    const select = async (selector, from, to = from) => page.locator(selector).evaluate((node, offsets) => {
      node.closest('.tiptap').focus(); const range = document.createRange();
      range.setStart(node.firstChild, offsets.from); range.setEnd(node.firstChild, offsets.to);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    }, { from, to });
    const settled = async () => expect.poll(async () => {
      const s = JSON.parse(await page.locator('#status').textContent());
      return s.pending === 0 && !s.composing && !s.locked;
    }).toBe(true);
    const agrees = async id => {
      await settled(); const s = await snapshot(id);
      expect(await page.locator('#source').textContent()).toBe(s.source);
      expect(JSON.parse(await page.locator('#status').textContent()).revision).toBe(s.revision); return s;
    };
    const before = await snapshot(a), burst = 'fastABCDEFGHIJKLMN';
    await select('#editor h1', 2); await page.keyboard.type(burst);
    let heading = '合成' + burst + '标题😀', at = 2 + burst.length;
    await expect(page.locator('#editor h1')).toHaveText(heading); await agrees(a);
    expect(await page.evaluate(() => window.getSelection().focusOffset)).toBe(at);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); at -= 2;
    await page.keyboard.press('Backspace'); heading = heading.slice(0, at - 1) + heading.slice(at); at--;
    await page.keyboard.press('Delete'); heading = heading.slice(0, at) + heading.slice(at + 1);
    await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.insertText('Q'); heading = heading.slice(0, at - 2) + 'Q' + heading.slice(at); at--;
    await expect(page.locator('#editor h1')).toHaveText(heading); await agrees(a);
    expect(await page.evaluate(() => window.getSelection().focusOffset)).toBe(at);
    await select('#editor strong', 0, 4); await page.keyboard.insertText('加粗😀');
    await expect(page.locator('#editor strong')).toHaveText('加粗😀');
    const afterBold = await agrees(a);
    expect(afterBold.source).toBe(before.source.replace('合成标题😀', heading).replace('粗体中文', '加粗😀'));
    await page.keyboard.press('Meta+z'); await expect(page.locator('#editor strong')).toHaveText('粗体中文'); await agrees(a);
    await page.keyboard.press('Meta+Shift+z'); await expect(page.locator('#editor strong')).toHaveText('加粗😀'); await agrees(a);

    await page.locator('#documents').selectOption(b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
    const originalB = await snapshot(b); expect(originalB.canUndo).toBe(false);
    await select('#editor p', 9); await page.keyboard.press('Meta+z'); await settled();
    expect((await snapshot(b)).source).toBe(originalB.source);
    // Chromium IME protocol exercises composition mechanics, not macOS Pinyin.
    await page.evaluate(() => {
      window.compositionEvidence = [];
      for (const name of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(name, event => window.compositionEvidence.push({ type: name, data: event.data }));
    });
    await select('#editor p', 9);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ce', selectionStart: 2, selectionEnd: 2 });
    await expect(page.locator('#status')).toContainText('"composing":true');
    expect((await snapshot(b)).revision).toBe(originalB.revision);
    await cdp.send('Input.imeSetComposition', { text: 'ceshi', selectionStart: 5, selectionEnd: 5 });
    expect((await snapshot(b)).source).toBe(originalB.source);
    await cdp.send('Input.insertText', { text: '测试' });
    await settled(); const composed = await agrees(b);
    expect(composed.source).toBe(originalB.source.replace('Original ', 'Original 测试'));
    expect(composed.revision).toBe(originalB.revision + 1);
    const events = await page.evaluate(() => window.compositionEvidence);
    expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['compositionstart', 'compositionupdate', 'compositionend']));
    await info.attach('chromium-composition-evidence-not-native-ime', { body: JSON.stringify(events), contentType: 'application/json' });
    await page.keyboard.press('Meta+z'); await settled(); expect((await agrees(b)).source).toBe(originalB.source);
    await page.keyboard.press('Meta+Shift+z'); await settled(); expect((await agrees(b)).source).toBe(composed.source);
    expect(await page.evaluate(() => window.getSelection().focusOffset)).toBe(11);
    await page.keyboard.type('EN'); await settled();
    const mixed = await agrees(b); expect(mixed.source).toBe(composed.source.replace('测试', '测试EN'));
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
    expect((await snapshot(b)).revision).toBe(mixed.revision);
    await cdp.send('Input.insertText', { text: '中文' }); await settled();
    const twice = await agrees(b); expect(twice.source).toBe(mixed.source.replace('测试EN', '测试EN中文'));
    expect(twice.revision).toBe(mixed.revision + 1);
    await cdp.send('Input.imeSetComposition', { text: 'cancel', selectionStart: 6, selectionEnd: 6 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await settled(); expect((await agrees(b)).source).toBe(twice.source);
    expect((await snapshot(b)).revision).toBe(twice.revision);
    await page.locator('#documents').selectOption(a); await expect(page.locator('#editor h1')).toHaveText(heading);
    expect((await agrees(a)).source).toBe(afterBold.source);
    await page.locator('#documents').selectOption(b); await expect(page.locator('#editor p')).toHaveText('Original 测试EN中文second body.');

    const { projectSource } = await import(pathToFileURL(path.join(desktop, 'lib/document-source-map.mjs')).href);
    const current = await snapshot(b), span = projectSource(current.source).spans.find(s => s.text.startsWith('Original'));
    const remote = await page.evaluate(data => window.documentDemo.edit(data), { sessionId: b, expectedRevision: current.revision, from: span.from, to: span.from + 1, insert: 'X' });
    expect(remote.ok).toBe(true);
    await select('#editor p', 2); await page.keyboard.insertText('LOCAL');
    await expect(page.locator('#status')).toContainText('stale-revision');
    expect((await agrees(b)).source).toBe(remote.snapshot.source);
    await expect(page.locator('#recovery')).toContainText('LOCAL');
    await page.keyboard.press('Meta+z'); await settled(); expect((await agrees(b)).source).toBe(current.source);
    await page.keyboard.press('Enter'); await expect(page.locator('#status')).toContainText('unsafe-source-range');
    expect((await snapshot(b)).source).toBe(current.source);
    await page.getByRole('button', { name: 'Request save (denied)' }).click();
    await expect(page.locator('#status')).toContainText('coordination-required');
    expect((await fs.readFile(path.join(root, 'a.md'))).equals(diskA)).toBe(true);
    expect((await fs.readFile(path.join(root, 'b.md'))).equals(diskB)).toBe(true);
    // Known main invalidation locks before input, rather than first allowing an
    // optimistic edit and discovering revoked authority through its failure.
    const retainedSource = await page.locator('#source').textContent(), retainedDrafts = await page.locator('#recovery').textContent();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.emit('did-start-loading'));
    await expect(page.locator('#status')).toContainText('session-invalidated');
    await expect(page.locator('#status')).toContainText('"locked":true');
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await select('#editor p', 2); await page.keyboard.insertText('REFUSED');
    expect(await page.locator('#source').textContent()).toBe(retainedSource);
    expect(await page.locator('#recovery').textContent()).toBe(retainedDrafts);
    await expect(page.locator('#recovery')).toContainText('LOCAL');
    for (const s of sessions) {
      const r = await page.evaluate(sessionId => window.documentDemo.snapshot({ sessionId }), s.sessionId);
      expect(r.ok).toBe(false); expect(r.snapshot).toBeUndefined(); revoked++;
    }
    functional = true;
  } finally {
    if (group === child.pid) ids = [...new Set([...ids, ...owned(child.pid, group)])];
    timer = setTimeout(() => {
      watchdog = true;
      if (group === child.pid && !gone(-group)) process.kill(-group, 'SIGKILL');
      else if (!gone(child.pid)) child.kill('SIGKILL');
    }, 45000);
    try {
      await app.close(); const result = await closed;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && (!ids.every(gone) || (group && !gone(-group)))) await new Promise(r => setTimeout(r, 30));
      const remaining = !ids.every(gone) || !!(group && !gone(-group));
      const fault = /interaction:(?:uncaught|error-dialog)|Object has been destroyed|Uncaught Exception/.test(stderr);
      const record = { functional, revoked, pid: child.pid, ...result, watchdog, fault, remaining, runtime: runtimeIdentity };
      console.log('interaction-parent-observation:' + JSON.stringify(record));
      await info.attach('interaction-parent-exit', { body: JSON.stringify(record), contentType: 'application/json' });
      expect(result).toEqual({ code: 0, signal: null }); expect(watchdog).toBe(false); expect(fault).toBe(false); expect(remaining).toBe(false);
    } finally {
      clearTimeout(timer);
      if (group === child.pid && !gone(-group)) process.kill(-group, 'SIGKILL');
      else if (!gone(child.pid)) child.kill('SIGKILL');
    }
  }
});
