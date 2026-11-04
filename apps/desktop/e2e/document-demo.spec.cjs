const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const desktop = path.resolve(__dirname, '..');

// Parent-only OS observations. No command lines/environment or other app data.
function ownedPids(rootPid, group) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const ids = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [pid, parent, pgid] of rows) if ((ids.has(parent) || pgid === group) && !ids.has(pid)) {
      ids.add(pid); changed = true;
    }
  }
  return [...ids];
}
function gone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
async function waitGone(ids, group) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (ids.every(gone) && gone(-group)) return true;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  return ids.every(gone) && gone(-group);
}
// Opt-in observer-only trace: no input data, source text, timers or extra edits.
async function observeInput(page) {
  await page.evaluate(() => {
    const rows = [], hooked = new WeakSet(); let dropped = 0, previous = '';
    const flags = () => {
      let s = {}; try { s = JSON.parse(document.querySelector('#status')?.textContent); } catch { /* not connected */ }
      return { code: s.code, editingCode: s.editingCode, composing: s.composing, pending: s.pending,
        locked: s.locked, historyPending: s.historyPending, loading: s.loading, lifecycle: s.lifecycle,
        revision: s.revision, reloadDisabled: document.querySelector('#reload')?.disabled,
        pmComposing: document.querySelector('.tiptap')?.editor?.view.composing };
    };
    const add = (kind, detail = {}) => {
      rows.push({ at: performance.timeOrigin + performance.now(), kind, ...detail, flags: flags() });
      if (rows.length > 192) { rows.shift(); dropped++; }
    };
    window.demoInputTrace = { read: () => ({ rows: rows.slice(), dropped }) };
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'focus', 'blur', 'focusin', 'focusout']) {
      window.addEventListener(type, e => add(type, { trusted: e.isTrusted, isComposing: e.isComposing,
        inputType: e.inputType, target: e.target.tagName || 'window' }), true);
    }
    window.documentDemo.onLifecycle(s => add('lifecycle', s));
    const observe = () => {
      const editor = document.querySelector('.tiptap')?.editor;
      if (editor && !hooked.has(editor)) {
        hooked.add(editor);
        for (const [index, plugin] of editor.state.plugins.entries()) {
          const filter = plugin.spec.filterTransaction;
          if (filter) plugin.spec.filterTransaction = function (tr, state) {
            const accepted = filter.call(this, tr, state);
            add('filter', { index, accepted, changed: tr.docChanged, steps: tr.steps.map(s => s.constructor.name) });
            return accepted;
          };
        }
        const events = editor.view.props.handleDOMEvents;
        for (const name of ['compositionstart', 'compositionend']) {
          const handler = events[name];
          events[name] = function (...args) {
            add('handler-before', { name }); const result = handler.apply(this, args);
            add('handler-after', { name }); return result;
          };
        }
        editor.on('transaction', ({ transaction: tr }) => add('transaction', { changed: tr.docChanged, steps: tr.steps.map(s => s.constructor.name) }));
      }
      const next = JSON.stringify(flags());
      if (next !== previous) { previous = next; add('state'); }
    };
    new MutationObserver(observe).observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['disabled', 'contenteditable'] });
    observe();
  });
}
test('restricted document demo uses real Tiptap → authorized IPC → complete source; never writes', async ({}, info) => {
  const env = {}; for (const k of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  const app = await test.step('Launch synthetic main entry', () => electron.launch({ executablePath: process.env.E2E_ELECTRON_EXECUTABLE,
    args: [process.env.DOCUMENT_DEMO_ENTRY || path.join(desktop, 'lib/document-demo-main.js')], cwd: desktop, env,
    chromiumSandbox: true, timeout: 15000 }));
  const child = app.process();
  const group = Number(execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
  expect(group).toBe(child.pid); // Playwright's detached group belongs to this run.
  const initialPids = ownedPids(child.pid, group);
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const faults = { uncaught: 0, errorDialogs: 0 };
  let functionalAssertionsComplete = false, revokedSessions = 0, stderr = '', runtimeIdentity = null;
  let diagnosticPage = null;
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-32768); });
  try {
    app.on('console', message => {
      const text = message.text();
      if (text === 'demo-monitor:uncaught') faults.uncaught++;
      if (text === 'demo-monitor:error-dialog') faults.errorDialogs++;
      if (text.startsWith('demo-lifecycle:')) console.log(text);
    });
    await app.evaluate(({ app, BrowserWindow, dialog, ipcMain }) => {
      const trace = globalThis.demoIpcTrace = [], channel = 'document-demo:request';
      const handler = ipcMain._invokeHandlers.get(channel);
      ipcMain.removeHandler(channel); ipcMain.handle(channel, (event, payload) => {
        const row = { at: Date.now(), operation: payload?.operation, sessionId: payload?.sessionId, settled: false };
        trace.push(row); if (trace.length > 24) trace.shift();
        try { const r = handler(event, payload); Object.assign(row, { settled: true, ok: r.ok, code: r.code }); return r; }
        catch (error) { Object.assign(row, { settled: true, exception: true }); throw error; }
      });
      // Monitor only: preserve Node's exception handling and the real dialog.
      process.on('uncaughtExceptionMonitor', () => console.error('demo-monitor:uncaught'));
      const original = dialog.showErrorBox;
      dialog.showErrorBox = function (...args) {
        console.error('demo-monitor:error-dialog'); return original.apply(this, args);
      };
      for (const name of ['before-quit', 'will-quit', 'window-all-closed']) app.on(name, () => console.log('demo-lifecycle:' + name));
      for (const win of BrowserWindow.getAllWindows()) {
        const focus = globalThis.demoFocusTrace = [];
        for (const name of ['focus', 'blur', 'closed']) win.on(name, () => {
          focus.push({ at: Date.now(), name }); if (focus.length > 24) focus.shift();
        });
        win.on('close', () => console.log('demo-lifecycle:window-close'));
        win.on('closed', () => console.log('demo-lifecycle:window-closed'));
      }
    });
    const paths = await test.step('Read isolated paths from real main', () => app.evaluate(({ app }) => ({
      profile: app.getPath('userData'), session: app.getPath('sessionData'), crashes: app.getPath('crashDumps'),
      isPackaged: app.isPackaged, defaultApp: Boolean(process.defaultApp), electron: process.versions.electron,
    })));
    runtimeIdentity = { isPackaged: paths.isPackaged, defaultApp: paths.defaultApp, electron: paths.electron,
      entry: process.env.DOCUMENT_DEMO_ENTRY ? 'actual-asar' : 'source' };
    const profile = paths.profile;
    expect(paths.session).toBe(profile); expect(paths.crashes).toBe(path.join(profile, 'crashes'));
    const root = path.dirname(profile); expect(path.basename(root)).toMatch(/^document-demo-/);
    const file = path.join(root, 'a.md'), disk = await fs.readFile(file);
    const page = await test.step('Find real Tiptap demo window', () => app.firstWindow({ timeout: 15000 }));
    diagnosticPage = page;
    if (process.env.DOCUMENT_INPUT_DIAGNOSTICS === '1') await observeInput(page);
    await page.getByRole('button', { name: 'Connect synthetic documents' }).click();
    await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
    const id = await page.locator('#documents').inputValue();
    const allSessions = await page.evaluate(() => window.documentDemo.list());
    expect(allSessions.ok).toBe(true); expect(allSessions.sessions).toHaveLength(2);
    expect(await page.evaluate(() => [typeof window.require, typeof window.vaultApi])).toEqual(['undefined', 'undefined']);
    const selectText = node => {
      node.closest('.tiptap').focus(); const r = document.createRange(); r.selectNodeContents(node);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      // Synchronize the test-created DOM selection before injecting text.
      document.dispatchEvent(new Event('selectionchange'));
    };
    await page.locator('#editor h1').evaluate(selectText);
    await page.keyboard.insertText('新标题😀');
    await expect(page.locator('#status')).toContainText('"revision":1');
    await page.locator('#editor strong').evaluate(selectText);
    await page.keyboard.insertText('加粗😀');
    await expect(page.locator('#status')).toContainText('"revision":2');
    const expected = disk.toString('utf8').slice(1).replace('合成标题😀', '新标题😀').replace('粗体中文', '加粗😀');
    await expect(page.locator('#source')).toHaveText(expected);
    expect(await page.locator('#source').textContent()).toBe(expected);
    const stale = await page.evaluate(id => window.documentDemo.edit({ sessionId: id, expectedRevision: 0, from: 1, to: 2, insert: 'BAD' }), id);
    expect(stale.code).toBe('stale-revision'); expect(stale.snapshot.source).toBe(expected);
    const bypass = await page.evaluate(id => window.documentDemo.save({ sessionId: id, expectedRevision: 2, unsafeExperimentalRoot: '/private/tmp' }), id);
    expect(bypass.code).toBe('invalid-request');
    // A real second webContents with the same URL/preload receives no grant.
    const secondPage = app.waitForEvent('window');
    const entryDir = path.dirname(process.env.DOCUMENT_DEMO_ENTRY || path.join(desktop, 'lib/document-demo-main.js'));
    const windowId = await app.evaluate(async ({ BrowserWindow }, files) => {
      const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false,
        sandbox: true, preload: files.preload } });
      await w.loadFile(files.html); return w.id;
    }, { preload: path.join(entryDir, 'document-demo-preload.js'), html: path.join(entryDir, 'document-demo.html') });
    const foreignPage = await secondPage; await foreignPage.waitForLoadState();
    const foreign = await foreignPage.evaluate(id => window.documentDemo.snapshot({ sessionId: id }), id);
    expect(foreign.code).toBe('unauthorized-sender'); expect(foreign.snapshot).toBeUndefined();
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(), windowId);
    await page.locator('#editor h1').evaluate(node => {
      const data = new DataTransfer(); data.setData('text/html', '<b>CONTROLLED SYNTHETIC PASTE</b>');
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await expect(page.locator('#status')).toContainText('unsupported-paste');
    expect(await page.locator('#source').textContent()).toBe(expected);
    await page.locator('#editor h1').evaluate(node => {
      node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    });
    await expect(page.locator('#status')).toContainText('unsupported-drop');
    await page.getByRole('button', { name: 'Reload memory' }).click();
    await expect(page.locator('#editor h1')).toHaveText('新标题😀');
    await expect(page.locator('#editor strong')).toHaveText('加粗😀');
    await page.locator('#documents').selectOption({ index: 1 });
    await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
    await page.locator('#documents').selectOption(id);
    await expect(page.locator('#source')).toHaveText(expected);
    await page.getByRole('button', { name: 'Request save (denied)' }).click();
    await expect(page.locator('#status')).toContainText('coordination-required');
    expect((await fs.readFile(file)).equals(disk)).toBe(true);
    await page.locator('#editor h1').click(); await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toContainText('unsafe-source-range');
    await expect(page.locator('#source')).toHaveText(expected);
    await fs.writeFile(file, 'EXTERNAL SYNTHETIC\n');
    await page.getByRole('button', { name: 'Check disk' }).click();
    await expect(page.locator('#status')).toContainText('conflict');
    await expect(page.locator('#source')).toHaveText(expected);
    if (process.env.DOCUMENT_INPUT_DIAGNOSTICS === '1') console.log('demo-input-diagnostic:' + JSON.stringify(await page.evaluate(() => window.demoInputTrace.read())));
    await page.reload();
    const invalid = await page.evaluate(ids => Promise.all(ids.map(sessionId => window.documentDemo.snapshot({ sessionId }))),
      allSessions.sessions.map(s => s.sessionId));
    for (const result of invalid) { expect(result.ok).toBe(false); expect(result.snapshot).toBeUndefined(); }
    revokedSessions = invalid.length;
    await info.attach('synthetic-root', { body: root, contentType: 'text/plain' });
    functionalAssertionsComplete = true;
  } finally {
    const started = Date.now(); let timedOut = false;
    const ids = [...new Set([...initialPids, ...ownedPids(child.pid, group)])];
    // Failure cleanup only. A fired watchdog can NEVER satisfy the assertions.
    const timeout = setTimeout(() => {
      timedOut = true; if (!gone(-group)) process.kill(-group, 'SIGKILL');
    }, 45000);
    try {
      if (!functionalAssertionsComplete) try {
        const view = await diagnosticPage?.evaluate(() => ({ status: document.querySelector('#status')?.textContent,
          reloadDisabled: document.querySelector('#reload')?.disabled, hasFocus: document.hasFocus(),
          focus: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
          contenteditable: document.querySelector('#editor .tiptap')?.getAttribute('contenteditable'),
          inputTrace: window.demoInputTrace?.read() })).catch(() => ({ unavailable: true }));
        const ipc = await app.evaluate(() => globalThis.demoIpcTrace || []).catch(() => ({ unavailable: true }));
        const focus = await app.evaluate(() => globalThis.demoFocusTrace || []).catch(() => ({ unavailable: true }));
        console.log('demo-failure-diagnostics:' + JSON.stringify({ view, ipc, focus }));
        await info.attach('failure-only-ui-ipc-diagnostics', { body: JSON.stringify({ view, ipc, focus }), contentType: 'application/json' });
      } catch { console.warn('demo-diagnostic: capture unavailable; preserving failure and cleanup'); }
      await app.close(); const result = await closed;
      clearTimeout(timeout);
      const noRemainingChildren = await waitGone(ids, group);
      const detectedFaults = {
        uncaught: Math.max(faults.uncaught, (stderr.match(/demo-monitor:uncaught/g) || []).length),
        errorDialogs: Math.max(faults.errorDialogs, (stderr.match(/demo-monitor:error-dialog/g) || []).length),
      };
      const mainErrorOnStderr = /Uncaught Exception|A JavaScript error occurred in the main process|TypeError: Object has been destroyed|demo-monitor:(?:uncaught|error-dialog)/.test(stderr);
      const observation = { functionalAssertionsComplete, revokedSessions, pid: child.pid, group, ...result,
        watchdogFired: timedOut, ...detectedFaults, mainErrorOnStderr, noRemainingChildren, observedProcesses: ids.length, runtime: runtimeIdentity,
        shutdownMs: Date.now() - started };
      console.log('demo-parent-observation:' + JSON.stringify(observation));
      await info.attach('parent-exit-observation', { body: JSON.stringify(observation), contentType: 'application/json' });
      expect(result).toEqual({ code: 0, signal: null });
      expect(child.exitCode).toBe(0); expect(child.signalCode).toBe(null);
      expect(timedOut).toBe(false); expect(detectedFaults).toEqual({ uncaught: 0, errorDialogs: 0 });
      expect(mainErrorOnStderr).toBe(false); expect(noRemainingChildren).toBe(true);
    } finally {
      clearTimeout(timeout);
      if (!gone(-group)) process.kill(-group, 'SIGKILL'); // failed-run cleanup, not a success path
    }
  }
});
