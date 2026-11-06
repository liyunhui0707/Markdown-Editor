const { test, expect, _electron: electron } = require('@playwright/test');
const { authorMixedDocument } = require('./common-authoring.cjs');
const fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createHomeFixture } = require('../test/helpers/home-fixture.cjs');
const desktop = path.resolve(__dirname, '..');
const gone = pid => { try { process.kill(pid, 0); return false; } catch (e) { if (e.code === 'ESRCH') return true; throw e; } };
function owned(pid) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map(s => s.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, parent, group] of rows) if ((ids.has(parent) || group === pid) && !ids.has(id)) { ids.add(id); changed = true; }
  }
  return [...ids];
}
async function captureTestWindow(app, file) {
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0], wasVisible = win.isVisible();
    // macOS does not reliably render a resized hidden window. Show only this
    // synthetic window without activating it, and hide again after capture.
    if (!wasVisible) win.showInactive();
    try {
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      return (await win.webContents.capturePage()).toPNG().toString('base64');
    }
    finally { if (!wasVisible) win.hide(); }
  });
  await fs.writeFile(file, Buffer.from(base64, 'base64'));
}
async function selectDocument(page, id) {
  if (!(await page.locator('#documents').isVisible())) await page.locator('#document-info > summary').click();
  await page.locator('#documents').selectOption(id);
}
async function usingDemo(body, info, secondSource = null, readOnly = false, testCopy = false, persistentCopy = false, createdMetadataTarget = null, draftOptions = {}) {
  if (!process.env.E2E_ELECTRON_EXECUTABLE) throw Error('An explicit isolated Electron executable is required');
  const env = {}; for (const k of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  let entry = process.env.DOCUMENT_DEMO_ENTRY || path.join(desktop, 'lib/document-demo-main.js');
  if (secondSource !== null) {
    // Same actual main lifecycle/IPC; substitute only one synthetic fixture before launch.
    entry = path.join(path.dirname(entry), 'document-window-main.js');
    const source = await fs.readFile(entry, 'utf8');
    const needle = "  ['b.md', '# Second synthetic document\\n\\nOriginal second body.\\n'],";
    if (source.split(needle).length !== 2) throw Error('Unknown synthetic fixture definition');
    const fixtureSource = source.replace(needle, `  ['b.md', ${JSON.stringify(secondSource)}],`);
    const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'document-fixture-entry-'));
    await fs.chmod(root, 0o700);
    const wrapper = path.join(root, 'main.cjs');
    await fs.writeFile(wrapper, `const {Module}=require('node:module');const file=${JSON.stringify(entry)};
      const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(require('node:path').dirname(file));
      m._compile(${JSON.stringify(fixtureSource)},file);m.exports.startDocumentWindow();`, { mode: 0o600, flag: 'wx' });
    entry = wrapper;
  }
  let copyRoot = null;
  if (testCopy) {
    if (!readOnly) throw Error('Copy test requires the document window');
    copyRoot = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'document-safe-create-')));
    await fs.chmod(copyRoot, 0o700);
  }
  let documentEntry = path.join(desktop, 'main.js');
  if (createdMetadataTarget) {
    if (!persistentCopy || !readOnly || !testCopy) throw Error('Metadata fixture requires persistent test mode');
    // Reproduce native save-panel attributes on only this fresh synthetic target.
    // The actual main, IPC, utility writer and File Store remain unchanged.
    const fixtureRoot = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'document-created-metadata-'));
    const writer = path.join(desktop, 'lib/document-copy-writer.js'), wrappedWriter = path.join(fixtureRoot, 'writer.cjs');
    await fs.writeFile(wrappedWriter, `const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
      const original=cp.spawnSync;let installed=false;
      cp.spawnSync=function(exe,args,opts){
        if(!installed&&exe==='/bin/ls'&&args[0]==='-lde'&&args[1]===${JSON.stringify(createdMetadataTarget)}){
          installed=true;
          // Match the observed Downloads timing: first native inspection changes
          // ctime, not the earlier exclusive open. No existing/user files touched.
          for(const [name,value] of [['com.apple.macl','01020304'],['com.apple.lastuseddate#PS','01000000000000000000000000000000']]){
            if(original('/usr/bin/xattr',['-wx',name,value,args[1]]).status!==0)throw Error('synthetic metadata unavailable');}}
        return original(exe,args,opts);};require(${JSON.stringify(writer)});`, { flag: 'wx', mode: 0o600 });
    documentEntry = path.join(fixtureRoot, 'main.cjs');
    await fs.writeFile(documentEntry, `const {utilityProcess}=require('electron');const fork=utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork=function(entry,args,options){if(entry!==${JSON.stringify(writer)}||options.cwd!==${JSON.stringify(path.dirname(createdMetadataTarget))})throw Error('unexpected fixture writer');return fork(${JSON.stringify(wrappedWriter)},args,options)};
      require(${JSON.stringify(path.join(desktop, 'main.js'))});`, { flag: 'wx', mode: 0o600 });
  }
  const app = await electron.launch({ executablePath: process.env.E2E_ELECTRON_EXECUTABLE,
    args: readOnly ? [documentEntry, '--document-readonly', draftOptions.root ? '--document-drafts-test-root=' + draftOptions.root : '--document-no-drafts', ...(testCopy ? [persistentCopy ? '--document-persistent-copy' : '--document-test-copy'] : [])] : [entry], cwd: copyRoot || desktop, env, chromiumSandbox: true });
  const child = app.process(), closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let group, ids = [child.pid], stderr = '', functional = false, watchdog = false, timer, identity;
  child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-32768); });
  try {
    group = Number(execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
    expect(group).toBe(child.pid); ids = owned(child.pid);
    identity = await app.evaluate(({ app, dialog }) => {
      process.on('uncaughtExceptionMonitor', () => console.error('p1:uncaught'));
      const original = dialog.showErrorBox;
      dialog.showErrorBox = function (...args) { console.error('p1:error-dialog'); return original.apply(this, args); };
      return { profile: app.getPath('userData'), isPackaged: app.isPackaged, electron: process.versions.electron };
    });
    const root = path.dirname(identity.profile); expect(path.basename(root)).toMatch(/^document-demo-/);
    const bytes = readOnly ? [] : await Promise.all(['a.md', 'b.md'].map(f => fs.readFile(path.join(root, f))));
    if (draftOptions.root) await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await app.firstWindow();
    if (draftOptions.root) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    else { await page.bringToFront(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus()); }
    if (readOnly) await expect(page.locator('#open-file')).toBeEnabled();
    else {
      await page.getByRole('button', { name: 'Connect synthetic documents' }).click();
      await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
    }
    const sessions = (await page.evaluate(() => window.documentDemo.list())).sessions;
    const snapshot = id => page.evaluate(sessionId => window.documentDemo.snapshot({ sessionId }), id);
    const select = (selector, from, to = from) => page.locator(selector).evaluate((node, range) => {
      node.closest('.tiptap').focus(); const r = document.createRange();
      r.setStart(node.firstChild, range.from); r.setEnd(node.firstChild, range.to);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange'));
    }, { from, to });
    const settled = () => expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).pending).toBe(0);
    const { projectSource } = await import(pathToFileURL(path.join(desktop, 'lib/document-source-map.mjs')).href);
    await body({ app, page, sessions, snapshot, select, settled, projectSource, root, copyRoot });
    for (const [i, f] of (readOnly ? [] : ['a.md', 'b.md']).entries()) expect((await fs.readFile(path.join(root, f))).equals(bytes[i])).toBe(true);
    if (!draftOptions.directExit) {
      const finalSessions = (await page.evaluate(() => window.documentDemo.list())).sessions;
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.emit('did-start-loading'));
      for (const s of finalSessions) expect((await snapshot(s.sessionId)).ok).toBe(false);
      if (await page.locator('#editor .tiptap').count()) {
        await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
        expect(JSON.parse(await page.locator('#status').textContent()).locked).toBe(true);
      } else await expect(page.locator('#connect')).toBeDisabled(); // Reload has no new main grant.
    }
    functional = true;
  } finally {
    if (group === child.pid) ids = [...new Set([...ids, ...owned(child.pid)])];
    timer = setTimeout(() => { watchdog = true; if (group === child.pid && !gone(-group)) process.kill(-group, 'SIGKILL'); else if (!gone(child.pid)) child.kill('SIGKILL'); }, 45000);
    try {
      if (draftOptions.directExit) await app.evaluate(({ app }) => { setImmediate(() => app.exit(0)); });
      else await app.close();
      const result = await closed, deadline = Date.now() + 3000;
      while (Date.now() < deadline && (!ids.every(gone) || (group && !gone(-group)))) await new Promise(r => setTimeout(r, 30));
      const remaining = !ids.every(gone) || !!(group && !gone(-group));
      const fault = /p1:(?:uncaught|error-dialog)|Object has been destroyed|Uncaught Exception/.test(stderr);
      const record = { case: info.title, functional, pid: child.pid, ...result, watchdog, fault, remaining,
        isPackaged: identity?.isPackaged, entry: readOnly ? 'document-readonly' : secondSource !== null ? 'source-fixture' : process.env.DOCUMENT_DEMO_ENTRY ? 'actual-asar' : 'source' };
      console.log('p1-parent-observation:' + JSON.stringify(record));
      await info.attach('p1-parent-exit', { body: JSON.stringify(record), contentType: 'application/json' });
      expect(result).toEqual({ code: 0, signal: null }); expect(watchdog).toBe(false); expect(fault).toBe(false); expect(remaining).toBe(false);
    } finally {
      clearTimeout(timer);
      if (group === child.pid && !gone(-group)) process.kill(-group, 'SIGKILL'); else if (!gone(child.pid)) child.kill('SIGKILL');
    }
  }
}

test('P1-1 repeated real stale IPC preserves all drafts across A/B/A', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled, projectSource } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  const fail = async (id, marker, replacement) => {
    const s = (await snapshot(id)).snapshot, span = projectSource(s.source).spans.find(s => !s.bold && s.text.endsWith(' ')) || projectSource(s.source).spans[0];
    const r = await page.evaluate(data => window.documentDemo.edit(data), { sessionId: id, expectedRevision: s.revision, from: span.from, to: span.from + 1, insert: replacement });
    expect(r.ok).toBe(true);
    const title = await page.locator('#editor h1').textContent(); await select('#editor h1', 0, title.length); await page.keyboard.insertText(marker);
    await expect(page.locator('#status')).toContainText('stale-revision'); await settled();
    expect(await page.locator('#source').textContent()).toBe(r.snapshot.source);
  };
  for (const [i, marker] of ['FIRST-UNACCEPTED', 'SECOND-UNACCEPTED', 'THIRD-UNACCEPTED'].entries()) await fail(a, marker, String(i));
  for (const marker of ['FIRST-UNACCEPTED', 'SECOND-UNACCEPTED', 'THIRD-UNACCEPTED']) await expect(page.locator('#recovery')).toContainText(marker);
  await selectDocument(page, b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await fail(b, 'B-UNACCEPTED', 'B'); await expect(page.locator('#recovery')).not.toContainText('FIRST-UNACCEPTED');
  await selectDocument(page, a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await expect(page.locator('#recovery')).toContainText('FIRST-UNACCEPTED'); await expect(page.locator('#recovery')).not.toContainText('B-UNACCEPTED');
  const before = (await snapshot(a)).snapshot;
  await page.locator('#recovery-panel > summary').click();
  await page.locator('#recovery-record').selectOption({ index: 0 });
  await page.getByRole('button', { name: 'Discard selected recovery record' }).click();
  await expect(page.locator('#recovery')).not.toContainText('FIRST-UNACCEPTED');
  await expect(page.locator('#recovery')).toContainText('SECOND-UNACCEPTED');
  expect((await snapshot(a)).snapshot).toEqual(before);
  await selectDocument(page, b); await expect(page.locator('#recovery')).toContainText('B-UNACCEPTED');
}, info));

async function delayLifecycle(h, delayNotices = false, closeFault = null) {
  await h.app.evaluate(({ ipcMain, BrowserWindow }, delayNotices) => {
    const channel = 'document-demo:request', original = ipcMain._invokeHandlers.get(channel);
    const g = globalThis.lifecycleGate = { hold: null, release: null, generated: false, calls: [], notices: [],
      holdClose: false, closeResult: null, closeRelease: null, closeFault: null, delayNotices };
    const wc = BrowserWindow.getAllWindows()[0].webContents, send = wc.send.bind(wc);
    wc.send = (channel, ...args) => {
      if (g.delayNotices && channel === 'document-demo:invalidated') g.notices.push(() => send(channel, ...args));
      else send(channel, ...args);
    };
    ipcMain.removeHandler(channel); ipcMain.handle(channel, async (event, payload) => {
      g.calls.push({ operation: payload.operation, sessionId: payload.sessionId });
      const result = original(event, payload); // Genuine authorization, snapshot and close.
      if (payload.operation === 'close' && g.holdClose) {
        g.closeResult = { result, after: original(event, { operation: 'snapshot', sessionId: payload.sessionId }) };
        await new Promise(resolve => { g.closeRelease = resolve; });
        if (g.closeFault === 'throw') throw Error('Synthetic close response lost');
      }
      if (payload.operation === 'snapshot' && payload.sessionId === g.hold) {
        if (!result.ok) throw Error('Expected a real live-session snapshot');
        g.generated = true; await new Promise(resolve => { g.release = resolve; });
      }
      return result;
    });
  }, delayNotices);
  if (closeFault) await h.app.evaluate((_, fault) => {
    globalThis.lifecycleGate.holdClose = true; globalThis.lifecycleGate.closeFault = fault;
  }, closeFault);
  return {
    hold: async id => {
      await h.app.evaluate((_, id) => { globalThis.lifecycleGate.hold = id; }, id);
      await selectDocument(h.page, id);
      await expect.poll(() => h.app.evaluate(() => globalThis.lifecycleGate.generated)).toBe(true);
    },
    release: () => h.app.evaluate(() => { const g = globalThis.lifecycleGate; g.hold = null; g.release(); }),
    notices: () => h.app.evaluate(() => {
      const g = globalThis.lifecycleGate; g.delayNotices = false;
      for (const send of g.notices.splice(0)) send();
    }),
    close: async (id, revision) => {
      await h.page.evaluate(data => {
        globalThis.closeAttempt = { done: false };
        window.documentDemo.close(data).then(result => { globalThis.closeAttempt = { done: true, result }; },
          () => { globalThis.closeAttempt = { done: true, rejected: true }; });
      }, { sessionId: id, expectedRevision: revision });
      await expect.poll(() => h.app.evaluate(() => !!globalThis.lifecycleGate.closeResult)).toBe(true);
      return h.app.evaluate(() => globalThis.lifecycleGate.closeResult);
    },
    acknowledge: async () => {
      await h.app.evaluate(() => globalThis.lifecycleGate.closeRelease());
      await expect.poll(() => h.page.evaluate(() => globalThis.closeAttempt.done)).toBe(true);
      return h.page.evaluate(() => globalThis.closeAttempt);
    },
  };
}

test('close-pending blocks old B snapshot before delayed close acknowledgement and notice', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  await selectDocument(page, b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await selectDocument(page, a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  const gate = await delayLifecycle(h, true, 'hold'); await gate.hold(b);
  const actual = await gate.close(b, 0); expect(actual.result.ok).toBe(true); expect(actual.after.code).toBe('unknown-session');
  await gate.release(); // Main has closed B, but neither close reply nor notice has arrived.
  await expect(page.locator('#documents')).toHaveValue(a);
  await expect(page.locator('#status')).toContainText('switch-failed:close-pending');
  await select('#editor h1', 2); await page.keyboard.insertText('A-WHILE-B-CLOSING'); await settled();
  expect((await snapshot(a)).snapshot.source).toContain('A-WHILE-B-CLOSING');
  expect((await snapshot(b)).code).toBe('close-pending');
  expect((await page.evaluate(() => window.documentDemo.list())).sessions.map(s => s.sessionId)).not.toContain(b);
  expect((await gate.acknowledge()).result.ok).toBe(true); await gate.notices();
  expect((await snapshot(b)).code).toBe('unknown-session');
  await expect(page.locator('#status')).toContainText('switch-failed:unknown-session');
  const calls = await h.app.evaluate(() => globalThis.lifecycleGate.calls);
  expect(calls.filter(c => c.operation === 'edit').every(c => c.sessionId === a)).toBe(true);
}, info));

test('close-pending refused by real main stays locked without losing B; A remains usable', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  await selectDocument(page, b); await expect(page.locator('#editor p')).toHaveText('Original second body.');
  await select('#editor p', 2); await page.keyboard.insertText('B-DIRTY'); await settled();
  const before = (await snapshot(b)).snapshot, gate = await delayLifecycle(h, true, 'hold');
  const actual = await gate.close(b, before.revision);
  expect(actual.result.code).toBe('unresolved-save-state'); expect(actual.after.snapshot).toEqual(before);
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  await select('#editor p', 2); await page.keyboard.insertText('MUST-NOT-EDIT-PENDING');
  expect((await gate.acknowledge()).result.code).toBe('unresolved-save-state');
  await expect(page.locator('#status')).toContainText('close-outcome-unknown');
  await select('#editor p', 2); await page.keyboard.insertText('MUST-NOT-EDIT-REFUSED');
  expect(await page.locator('#source').textContent()).toBe(before.source);
  expect((await snapshot(b)).code).toBe('close-outcome-unknown');
  expect((await page.evaluate(() => window.documentDemo.list())).sessions.map(s => s.sessionId)).toContain(b);
  await selectDocument(page, a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await select('#editor h1', 2); await page.keyboard.insertText('A-AFTER-REFUSAL'); await settled();
  expect((await snapshot(a)).snapshot.source).toContain('A-AFTER-REFUSAL');
  await selectDocument(page, b); await expect(page.locator('#documents')).toHaveValue(a);
  const calls = await h.app.evaluate(() => globalThis.lifecycleGate.calls);
  expect(calls.filter(c => c.operation === 'edit').every(c => c.sessionId === a)).toBe(true);
  await gate.notices();
}, info));

test('close-pending response exception never unlocks or republishes the old B snapshot', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  const gate = await delayLifecycle(h, true, 'throw'); await gate.hold(b);
  const actual = await gate.close(b, 0); expect(actual.result.ok).toBe(true); expect(actual.after.code).toBe('unknown-session');
  await gate.release(); await expect(page.locator('#documents')).toHaveValue(a);
  const outcome = await gate.acknowledge(); expect(outcome.result.code).toBe('close-outcome-unknown');
  expect((await snapshot(b)).code).toBe('close-outcome-unknown');
  await select('#editor h1', 2); await page.keyboard.insertText('A-AFTER-LOST-CLOSE'); await settled();
  expect((await snapshot(a)).snapshot.source).toContain('A-AFTER-LOST-CLOSE');
  await gate.notices(); expect((await snapshot(b)).code).toBe('unknown-session');
  await expect(page.locator('#documents')).toHaveValue(a);
}, info));

test('close-pending page reload cannot regain old sessions while replies are still delayed', async ({}, info) => usingDemo(async h => {
  const { page, app, sessions, snapshot } = h, b = sessions[1].sessionId;
  const gate = await delayLifecycle(h, true, 'hold'); await gate.hold(b);
  expect((await gate.close(b, 0)).result.ok).toBe(true);
  await page.reload(); // New preload loses its local map; real main revokes the old grant.
  await gate.release(); await app.evaluate(() => globalThis.lifecycleGate.closeRelease()); await gate.notices();
  expect((await page.evaluate(() => window.documentDemo.list())).code).toBe('unauthorized-sender');
  for (const s of sessions) expect((await snapshot(s.sessionId)).ok).toBe(false);
  await expect(page.locator('#connect')).toBeDisabled(); await expect(page.locator('#editor .tiptap')).toHaveCount(0);
}, info));

test('P1-3 generated B snapshot cannot outlive real close; A drafts and history survive', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled, projectSource } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  await selectDocument(page, b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await selectDocument(page, a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  const original = (await snapshot(a)).snapshot, span = projectSource(original.source).spans.find(s => s.bold);
  expect((await page.evaluate(data => window.documentDemo.edit(data), {
    sessionId: a, expectedRevision: original.revision, from: span.from, to: span.from + 1, insert: '外',
  })).ok).toBe(true);
  await select('#editor h1', 0, 2); await page.keyboard.insertText('A-RECOVERY'); await settled();
  await expect(page.locator('#recovery')).toContainText('A-RECOVERY');
  const before = (await snapshot(a)).snapshot, draft = await page.locator('#recovery').textContent();
  expect(before.canUndo).toBe(true);
  const gate = await delayLifecycle(h); await gate.hold(b);
  expect((await page.evaluate(id => window.documentDemo.close({ sessionId: id, expectedRevision: 0 }), b)).ok).toBe(true);
  await gate.release();
  await expect(page.locator('#documents')).toHaveValue(a);
  await expect(page.locator('#status')).toContainText('switch-failed:unknown-session');
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
  expect((await snapshot(a)).snapshot).toEqual(before); expect(await page.locator('#recovery').textContent()).toBe(draft);
  await select('#editor h1', 2); await page.keyboard.insertText('A-AFTER-CLOSE'); await settled();
  const edited = (await snapshot(a)).snapshot.source; expect(edited).toContain('A-AFTER-CLOSE');
  await page.keyboard.press('Meta+z'); await expect(page.locator('#source')).toHaveText(before.source); await settled();
  await page.keyboard.press('Meta+Shift+z'); await expect(page.locator('#source')).toHaveText(edited); await settled();
  expect(await page.locator('#recovery').textContent()).toBe(draft);
  expect((await snapshot(b)).code).toBe('unknown-session');
  const calls = await h.app.evaluate(() => globalThis.lifecycleGate.calls);
  expect(calls.filter(c => c.operation === 'edit').every(c => c.sessionId === a)).toBe(true);
}, info));

test('P1-3 close acknowledgement beats delayed notices and snapshots; invalid active A stays locked', async ({}, info) => usingDemo(async h => {
  const { app, page, sessions, snapshot, select } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  const gate = await delayLifecycle(h, true); await gate.hold(b);
  for (const id of [a, b]) expect((await page.evaluate(sessionId => window.documentDemo.close({ sessionId, expectedRevision: 0 }), id)).ok).toBe(true);
  await gate.release();
  await expect(page.locator('#documents')).toHaveValue(a);
  await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  expect(JSON.parse(await page.locator('#status').textContent()).locked).toBe(true);
  const before = await page.locator('#source').textContent();
  await select('#editor h1', 2); await page.keyboard.insertText('MUST-NOT-EDIT');
  await gate.notices(); // An older notice arriving later cannot resurrect either session.
  await expect(page.locator('#source')).toHaveText(before);
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('#status')).not.toContainText('"code":"opened"');
  for (const id of [a, b]) expect((await snapshot(id)).code).toBe('unknown-session');
  expect((await app.evaluate(() => globalThis.lifecycleGate.calls)).filter(c => c.operation === 'edit')).toHaveLength(0);
}, info));

test('P1-2 actual bold edge Backspace and Delete can undo and redo exact Markdown', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled } = h, a = sessions[0].sessionId;
  for (const [from, to, key] of [[0, 1, 'Backspace'], [3, 4, 'Delete']]) {
    const original = (await snapshot(a)).snapshot.source;
    await select('#editor strong', from, to); await page.keyboard.press(key); await settled();
    const edited = (await snapshot(a)).snapshot.source; expect(edited).not.toBe(original);
    await page.keyboard.press('Meta+z'); await expect(page.locator('#source')).toHaveText(original); await settled();
    expect((await snapshot(a)).snapshot.source).toBe(original);
    await page.keyboard.press('Meta+Shift+z'); await expect(page.locator('#source')).toHaveText(edited); await settled();
    await page.keyboard.press('Meta+z'); await expect(page.locator('#editor strong')).toHaveText('粗体中文'); await settled();
  }
  await select('#editor strong', 0, 4); await page.keyboard.insertText('😀中文😃'); await settled();
  const original = (await snapshot(a)).snapshot.source;
  await select('#editor strong', 0, 2); await page.keyboard.press('Backspace'); await settled();
  const edited = (await snapshot(a)).snapshot.source;
  await page.keyboard.press('Meta+z'); await expect(page.locator('#source')).toHaveText(original); await settled();
  await page.keyboard.press('Meta+Shift+z'); await expect(page.locator('#source')).toHaveText(edited);
}, info));

test('P1-3 closed B switch restores selector, keeps error and types only into A', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  await select('#editor h1', 2); await page.keyboard.insertText('A-edit'); await settled();
  const before = (await snapshot(a)).snapshot;
  expect((await page.evaluate(id => window.documentDemo.close({ sessionId: id, expectedRevision: 0 }), b)).ok).toBe(true);
  await selectDocument(page, b);
  await expect(page.locator('#documents')).toHaveValue(a);
  await expect(page.locator('#status')).toContainText('switch-failed:unknown-session');
  expect((await snapshot(a)).snapshot).toEqual(before);
  await select('#editor h1', 2); await page.keyboard.insertText('AFTER-FAIL'); await settled();
  await expect(page.locator('#documents')).toHaveValue(a); await expect(page.locator('#status')).toContainText('switch-failed:unknown-session');
  expect((await snapshot(a)).snapshot.source).toContain('AFTER-FAIL');
  expect((await snapshot(b)).code).toBe('unknown-session');
}, info));

test('P1-3 real IPC delayed, out-of-order and failed snapshots cannot activate the wrong session', async ({}, info) => usingDemo(async h => {
  const { app, page, sessions, snapshot, select, settled } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  // Trusted test-only fault injection. Every response still invokes the real
  // registered manager with the genuine Electron sender/frame and payload.
  await app.evaluate(({ ipcMain }) => {
    const channel = 'document-demo:request', original = ipcMain._invokeHandlers.get(channel);
    if (typeof original !== 'function') throw Error('Real handler unavailable');
    const gate = globalThis.p1SnapshotGate = { hold: new Set(), waiting: new Map(), reject: new Set() };
    ipcMain.removeHandler(channel); ipcMain.handle(channel, async (event, payload) => {
      const result = original(event, payload);
      if (payload.operation === 'snapshot') {
        const id = payload.sessionId;
        if (gate.hold.has(id)) await new Promise(resolve => gate.waiting.set(id, resolve));
        if (gate.reject.delete(id)) throw Error('Synthetic snapshot transport failure');
      }
      return result;
    });
  });
  const choose = id => page.evaluate(id => { const s = document.querySelector('#documents'); s.value = id; s.dispatchEvent(new Event('change')); }, id);
  const hold = id => app.evaluate((_, id) => { globalThis.p1SnapshotGate.hold.add(id); }, id);
  const release = id => app.evaluate((_, id) => { const g = globalThis.p1SnapshotGate; g.hold.delete(id); g.waiting.get(id)?.(); g.waiting.delete(id); }, id);
  const waiting = id => expect.poll(() => app.evaluate((_, id) => globalThis.p1SnapshotGate.waiting.has(id), id)).toBe(true);
  await hold(b); await choose(b); await waiting(b);
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  await choose(a); await expect(page.locator('#documents')).toHaveValue(a);
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
  await release(b); await expect(page.locator('#editor h1')).toHaveText('合成标题😀'); await expect(page.locator('#documents')).toHaveValue(a);
  await hold(a); await choose(a); await waiting(a);
  await choose(b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await app.evaluate((_, id) => { globalThis.p1SnapshotGate.reject.add(id); }, a);
  await release(a); await expect(page.locator('#documents')).toHaveValue(b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await selectDocument(page, a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await app.evaluate((_, id) => { globalThis.p1SnapshotGate.reject.add(id); }, b);
  await selectDocument(page, b); await expect(page.locator('#status')).toContainText('switch-failed:ipc-failed');
  await expect(page.locator('#documents')).toHaveValue(a);
  await select('#editor h1', 2); await page.keyboard.insertText('A-ONLY'); await settled();
  expect((await snapshot(a)).snapshot.source).toContain('A-ONLY'); expect((await snapshot(b)).snapshot.source).not.toContain('A-ONLY');
  await expect(page.locator('#status')).toContainText('switch-failed:ipc-failed');
}, info));


async function unsafeComposition({ page, select }, local = '') {
  await select('#editor h1', 2);
  await page.locator('#editor .tiptap').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  if (local) await page.keyboard.insertText(local);
  // Candidate Enter is now protected; explicitly exercise the same refused real PM structural command.
  await page.locator('#editor .tiptap').evaluate(node => node.editor.commands.splitBlock());
  await expect(page.locator('#status')).toContainText('unsafe-composition');
}

test('1B-3R copy panel and cancel preserve unconfirmed Markdown, main state and session-scoped records', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot } = h, a = sessions[0].sessionId, b = sessions[1].sessionId;
  const before = (await snapshot(a)).snapshot;
  await unsafeComposition(h, 'LOCAL-未确认😀');
  await expect(page.locator('#composition-warning')).toBeVisible();
  await expect(page.locator('#reload')).toBeDisabled();
  await page.getByRole('button', { name: 'View / keep input copies' }).click();
  const copy = page.locator('#composition-markdown');
  expect(await copy.textContent()).toBe(before.source.replace('合成标题', '合成LOCAL-未确认😀标题'));
  const retained = await copy.textContent();
  await expect(page.locator('#composition-copy-panel')).toContainText('memory only');
  await expect(page.locator('#composition-copy-panel')).toContainText('incomplete');
  await expect(page.locator('#composition-copy-panel')).toContainText('unavailable');
  // Controlled clipboard boundary: exercise success/failure without reading or replacing the user's OS clipboard.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async () => { throw Error('Synthetic clipboard refusal'); } } }));
  await page.getByRole('button', { name: 'Copy local Markdown' }).click();
  await expect(page.locator('#composition-copy-status')).toContainText('Copy failed');
  expect(await copy.textContent()).toBe(retained); await expect(copy).toHaveAttribute('aria-readonly', 'true');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async text => { window.copiedSyntheticText = text; } } }));
  await page.getByRole('button', { name: 'Copy local Markdown' }).click();
  await expect(page.locator('#composition-copy-status')).toContainText('Copied local Markdown');
  expect(await page.evaluate(() => window.copiedSyntheticText)).toBe(retained);
  await page.getByRole('button', { name: 'Cancel copy view' }).click();
  await expect(page.locator('#composition-copy-panel')).toBeHidden();
  await expect(page.locator('#reload')).toBeDisabled();
  expect(JSON.parse(await page.locator('#status').textContent()).composing).toBe(true);
  expect((await snapshot(a)).snapshot).toEqual(before);
  await h.select('#editor h1', 2); await page.keyboard.insertText('REFUSED');
  await expect(page.locator('#status')).toContainText('composition-invalid');
  expect((await snapshot(a)).snapshot).toEqual(before);
  await page.locator('#editor .tiptap').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).composing).toBe(false);
  expect((await snapshot(a)).snapshot).toEqual(before);
  await expect(page.locator('#recovery')).toContainText('LOCAL-未确认😀');
  await selectDocument(page, b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await expect(page.locator('#recovery')).not.toContainText('LOCAL-未确认😀');
  await selectDocument(page, a); await expect(page.locator('#recovery')).toContainText('LOCAL-未确认😀');
  expect((await snapshot(a)).snapshot).toEqual(before);
}, info));

test('1B-3R DOM-only partial copies and full-capacity refusal never overwrite earlier evidence', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot } = h, a = sessions[0].sessionId;
  const before = (await snapshot(a)).snapshot;
  await unsafeComposition(h);
  // Mutate only synthetic DOM; inspect within the same event turn before PM can restore a refused mutation.
  const retainDOM = text => page.locator('#editor .tiptap').evaluate((node, text) => {
    node.firstElementChild.append(document.createTextNode(text));
    const button = document.getElementById('view-composition-copy');
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); button.click();
  }, text);
  await retainDOM('DOM-ONLY-<not-html>😀');
  expect(await page.locator('#composition-markdown').textContent()).toBe(before.source);
  expect(await page.locator('#composition-dom').textContent()).toContain('DOM-ONLY-<not-html>😀');
  await expect(page.locator('#composition-dom not-html')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel copy view' }).click();
  for (let i = 1; i < 16; i++) { await retainDOM(`DOM-COPY-${i}`); await page.getByRole('button', { name: 'Cancel copy view' }).click(); }
  await retainDOM('OVERFLOW-NOT-RETAINED');
  await expect(page.locator('#composition-copy-status')).toContainText('capacity');
  await expect(page.locator('#composition-copy-status')).toContainText('No earlier record was removed');
  await expect(page.locator('#recovery')).toContainText('DOM-ONLY-<not-html>😀');
  await expect(page.locator('#recovery')).toContainText('DOM-COPY-15');
  await expect(page.locator('#reload')).toBeDisabled();
  expect(JSON.parse(await page.locator('#status').textContent()).composing).toBe(true);
  expect((await snapshot(a)).snapshot).toEqual(before);
}, info));


test('writing V1 actual Enter, empty composition, middle split, Backspace and history write two paragraphs', async ({}, info) => usingDemo(async h => {
  const { page, sessions, snapshot, select, settled } = h, a=sessions[0].sessionId, b=sessions[1].sessionId;
  const originalA=(await snapshot(a)).snapshot;
  await selectDocument(page, b);
  await expect(page.locator('#editor p')).toHaveText('Original second body.');
  const original=(await snapshot(b)).snapshot;
  await select('#editor p', 'Original second body.'.length);
  await page.keyboard.press('Enter'); await settled();
  await expect(page.locator('#editor p')).toHaveCount(2);
  expect(await page.locator('#editor p').nth(1).textContent()).toBe('');
  const blank=(await snapshot(b)).snapshot;
  expect(blank.source).toBe(original.source.replace('Original second body.', 'Original second body.\n\n'));
  expect(blank.revision).toBe(original.revision+1);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'ceshi', selectionStart: 5, selectionEnd: 5 });
  await expect(page.locator('#status')).toContainText('"composing":true');
  await page.keyboard.press('Enter'); // Must not turn a candidate-confirmation key into a paragraph split.
  await expect(page.locator('#editor p')).toHaveCount(2);
  expect((await snapshot(b)).snapshot).toEqual(blank);
  await cdp.send('Input.insertText', { text: '测试' }); await settled();
  await expect(page.locator('#editor p').nth(1)).toHaveText('测试');
  await page.keyboard.insertText(' English 中文😀'); await settled();
  const written=(await snapshot(b)).snapshot.source;
  expect(written).toBe(original.source.replace('Original second body.', 'Original second body.\n\n测试 English 中文😀'));
  expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe('测试 English 中文😀'.length);
  await page.keyboard.press('Meta+z'); await settled();
  await expect(page.locator('#editor p').nth(1)).toHaveText('测试');
  await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(b)).snapshot.source).toBe(blank.source);
  await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(b)).snapshot.source).toBe(original.source);
  for(let i=0;i<3;i++){await page.keyboard.press('Meta+Shift+z');await settled();}
  expect((await snapshot(b)).snapshot.source).toBe(written);
  await select('#editor p:first-of-type', 9); await page.keyboard.press('Enter'); await settled();
  await expect(page.locator('#editor p')).toHaveCount(3);
  expect(await page.locator('#editor p').nth(0).textContent()).toBe('Original ');
  expect(await page.locator('#editor p').nth(1).textContent()).toBe('second body.');
  const split=(await snapshot(b)).snapshot.source;
  expect(split).toBe(written.replace('Original second body.', 'Original \n\nsecond body.'));
  await select('#editor p:nth-of-type(2)',0);await page.keyboard.press('Backspace');await settled();
  expect((await snapshot(b)).snapshot.source).toBe(written);
  await page.keyboard.press('Meta+z');await settled();expect((await snapshot(b)).snapshot.source).toBe(split);
  await page.keyboard.press('Meta+Shift+z');await settled();expect((await snapshot(b)).snapshot.source).toBe(written);
  await select('#editor p:nth-of-type(2)','测试 English 中文😀'.length);
  await page.keyboard.press('Enter');await settled();await expect(page.locator('#editor p')).toHaveCount(3);
  const empty=(await snapshot(b)).snapshot;
  await page.keyboard.press('Enter');await expect(page.locator('#status')).toContainText('unsafe-source-range');
  expect((await snapshot(b)).snapshot).toEqual(empty);
  await page.keyboard.press('Backspace');await settled();expect((await snapshot(b)).snapshot.source).toBe(written);
  await selectDocument(page, a);await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await select('#editor h1',2);await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('unsafe-source-range');expect((await snapshot(a)).snapshot).toEqual(originalA);
  await selectDocument(page, b);await expect(page.locator('#editor p')).toHaveCount(2);
  expect((await snapshot(b)).snapshot.source).toBe(written);
  await page.getByRole('button',{name:'Request save (denied)'}).click();await expect(page.locator('#status')).toContainText('coordination-required');
},info));


for (const nl of ['\r\n','\n']) test(`CRLF P1 actual Backspace without final newline (${JSON.stringify(nl)})`, async ({},info)=>usingDemo(async h=>{
  const {page,sessions,snapshot,select,settled}=h,b=sessions[1].sessionId,original='first'+nl+nl+'second';
  await selectDocument(page, b);await expect(page.locator('#editor p')).toHaveCount(2);
  const initial=(await snapshot(b)).snapshot;expect(initial.source).toBe(original);
  await select('#editor p:nth-of-type(2)',0);await page.keyboard.press('Backspace');await settled();
  await expect(page.locator('#editor p')).toHaveCount(1);await expect(page.locator('#editor p')).toHaveText('firstsecond');
  let actual=(await snapshot(b)).snapshot;expect(actual.source).toBe('firstsecond');expect(actual.revision).toBe(initial.revision+1);
  expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe(5);
  await page.keyboard.press('Meta+z');await settled();
  await expect(page.locator('#editor p')).toHaveCount(2);expect((await snapshot(b)).snapshot.source).toBe(original);
  expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe(0);
  expect(await page.evaluate(()=>window.getSelection().focusNode.parentElement.closest('p')===document.querySelectorAll('#editor p')[1])).toBe(true);
  await page.keyboard.press('Meta+Shift+z');await settled();
  actual=(await snapshot(b)).snapshot;expect(actual.source).toBe('firstsecond');expect(actual.revision).toBe(initial.revision+3);
  expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe(5);
},info,'first'+nl+nl+'second'));


test('document-first read-only opens two directories, keeps failures and renders hostile Markdown inert', async ({},info)=>usingDemo(async h=>{
  const {app,page,snapshot,root}=h,a=path.join(root,'ProjectA','x.md'),b=path.join(root,'DesktopNotes','Y.md');
  await fs.mkdir(path.dirname(a));await fs.mkdir(path.dirname(b));
  const bytesA=Buffer.from('\ufeff# File A\r\n\r\nText **粗体** 😀\r\n\r\n<script>window.__unsafeRan=true</script>\r\n\r\n![x](file:///not-authorized.png)\r\n'),bytesB=Buffer.from('# File B\n\nFrom a different directory.');
  await fs.writeFile(a,bytesA);await fs.writeFile(b,bytesB);
  const denied=path.join(root,'invalid.md');await fs.writeFile(denied,Buffer.from([0xff,0xfe,0]));
  await expect(page.locator('#document-header')).toBeVisible();await expect(page.locator('#connect')).toBeHidden();
  // Native UI itself is exercised separately; these controlled selections retain actual main read/parse/IPC/render behavior.
  await app.evaluate(({dialog})=>{
    globalThis.originalNativePicker=dialog.showOpenDialog;
    globalThis.pickerQueue=[];globalThis.pickerOptions=[];
    dialog.showOpenDialog=async(win,options)=>{globalThis.pickerOptions.push(options);return globalThis.pickerQueue.shift();};
  });
  const choose=choice=>app.evaluate((_,choice)=>{globalThis.pickerQueue.push(choice);},choice);
  const identity=async()=>JSON.parse(await page.locator('#status').textContent()).activeSessionId;
  await choose({canceled:false,filePaths:[a]});await page.locator('#open-file').click();
  await expect(page.locator('#document-name')).toHaveText('x.md');await expect(page.locator('#document-location')).toHaveText(path.dirname(a));
  await expect(page.locator('#editor h1')).toHaveText('File A');await expect(page.locator('#editor strong')).toHaveText('粗体');
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  await expect(page.locator('#editor script,#editor img,#editor iframe,#editor a')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__unsafeRan)).toBeUndefined();
  const first=await identity(),before=(await snapshot(first)).snapshot;
  await page.locator('#editor p').first().click();await page.keyboard.insertText('MUST NOT EDIT');
  for(const operation of ['edit','save','undo','redo']){
    const result=await page.evaluate(({operation,id})=>window.documentDemo[operation]({sessionId:id,expectedRevision:0,...(operation==='edit'?{from:1,to:2,insert:'bad'}:{})}),{operation,id:first});
    expect(result.code).toBe('read-only-document');
  }
  expect((await snapshot(first)).snapshot).toEqual(before);
  await choose({canceled:true,filePaths:[]});await page.keyboard.press('Meta+o');
  await expect(page.locator('#viewer-status')).toContainText('已取消打开');expect(await identity()).toBe(first);
  await choose({canceled:false,filePaths:[path.join(root,'missing.md')]});await page.locator('#open-file').click();
  await expect(page.locator('#viewer-status')).toContainText('所选文件已不存在');expect(await identity()).toBe(first);
  await choose({canceled:false,filePaths:[denied]});await page.locator('#open-file').click();
  await expect(page.locator('#viewer-status')).toContainText('UTF-8');expect(await identity()).toBe(first);await expect(page.locator('#editor h1')).toHaveText('File A');
  await choose({canceled:false,filePaths:[b]});await page.keyboard.press('Meta+o');
  await expect(page.locator('#document-name')).toHaveText('Y.md');await expect(page.locator('#document-location')).toHaveText(path.dirname(b));
  await expect(page.locator('#editor h1')).toHaveText('File B');const second=await identity();expect(second).not.toBe(first);
  expect((await snapshot(first)).code).toBe('unknown-session');expect((await snapshot(second)).snapshot.readOnly).toBe(true);
  const options=await app.evaluate(()=>globalThis.pickerOptions);expect(options).toHaveLength(5);
  expect(options.every(o=>o.properties.includes('openFile')&&!o.properties.includes('multiSelections')&&o.filters[0].extensions[0]==='md')).toBe(true);
  expect((await fs.readFile(a)).equals(bytesA)).toBe(true);expect((await fs.readFile(b)).equals(bytesB)).toBe(true);
  await info.attach('authorized-fixtures',{body:JSON.stringify({a,b}),contentType:'application/json'});
},info,null,true));


test('document UI V2 empty, Chinese and English layouts preserve readonly open flow', async ({},info)=>usingDemo(async h=>{
  const {app,page,root,snapshot}=h;
  const cnName='关于写作与阅读的日常观察——一份保留完整文件名称的中文文档.md';
  const enName='Notes on a quieter writing experience and a deliberately long document filename for the reading window.md';
  const a=path.join(root,'Chinese',cnName),b=path.join(root,'English',enName);
  const cn='# 把文字放在中央\n\n好的阅读体验，始于恰到好处的留白。我们希望每一段文字都可以被轻松阅读，也希望思考不被多余的界面打断。\n\n## 留一点空间给思考\n\n中文与 English 可以自然共处。重要的是清晰的层级、舒适的行距，以及 **真正需要强调的内容**。\n\n### 从一段文字开始\n\n打开文件，即可阅读。路径与文件信息在需要时展开，正文始终是窗口的主角。\n\n<div>特殊语法保留为安全的纯文本，不执行 HTML。</div>\n';
  const en='# Room to think\n\nA good document window lets the words take their place. The page should feel comfortable on a laptop, with enough room to read and a clear rhythm between paragraphs.\n\n## A quieter writing surface\n\nKeep **the important words** in focus. File details are close at hand without competing with the document itself.\n\n### Small details, considered\n\nReadable type, balanced margins and a single continuous page make it easier to stay with an idea.\n\n'+ 'UnbrokenWord'.repeat(65)+'\n\n<script>window.__uiUnsafe=true</script>\n';
  await fs.mkdir(path.dirname(a));await fs.mkdir(path.dirname(b));await fs.writeFile(a,cn);await fs.writeFile(b,en);
  await app.evaluate(({dialog})=>{globalThis.uiChoices=[];dialog.showOpenDialog=async()=>globalThis.uiChoices.shift();});
  const choose=file=>app.evaluate((_,file)=>{globalThis.uiChoices.push(file?{canceled:false,filePaths:[file]}:{canceled:true,filePaths:[]});},file);
  const metrics=[];
  const size=async(width,height=780)=>{await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.evaluate(async()=>{await document.fonts.ready;});};
  const capture=async name=>{const file=info.outputPath(name+'.png');await captureTestWindow(app,file);await info.attach(name,{path:file,contentType:'image/png'});};
  const layout=async label=>{
    const m=await page.evaluate(()=>{
      const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};};
      return {viewport:document.body.clientWidth,windowWidth:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,open:box('open-file'),badge:box('readonly-badge'),
        name:box('document-name'),editor:box('editor'),scroll:box('document-scroll'),scrollClient:document.getElementById('document-scroll').clientWidth,type:getComputedStyle(document.querySelector('#editor .tiptap')||document.body).fontSize};
    });metrics.push({label,...m});expect(m.overflow).toBeLessThanOrEqual(1);
    expect(m.open.left).toBeGreaterThanOrEqual(0);expect(m.name.right).toBeLessThanOrEqual(m.viewport);
    expect(m.badge.right).toBeLessThanOrEqual(m.viewport);expect(m.name.height).toBeLessThan(30);
    expect(m.editor.width).toBeLessThanOrEqual(680);expect(Math.abs(m.editor.left-m.scroll.left-(m.scrollClient-m.editor.width)/2)).toBeLessThanOrEqual(1);
  };
  await size(1050);await expect(page.locator('#empty-state')).toBeVisible();await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#document-info')).toBeHidden();await capture('ui-v1-empty-1050');
  await choose(a);await page.locator('#empty-open').click();
  await expect(page.locator('#empty-state')).toBeHidden();await expect(page.locator('#editor h1')).toHaveText('把文字放在中央');
  await expect(page.locator('#document-name')).toHaveText(cnName);await layout('Chinese 1050');await capture('ui-v1-chinese-1050');
  await page.locator('#document-info summary').click();await expect(page.locator('#document-location')).toBeVisible();
  await expect(page.locator('#document-full-name')).toHaveText(cnName);await expect(page.locator('#document-location')).toHaveText(path.dirname(a));
  await page.locator('#document-info summary').click();await size(640);await layout('Chinese 640');await capture('ui-v1-chinese-640');
  await choose(b);await page.keyboard.press('Meta+o');await expect(page.locator('#editor h1')).toHaveText('Room to think');
  await expect(page.locator('#document-name')).toHaveText(enName);await size(1050);await layout('English 1050');await capture('ui-v1-english-1050');
  await size(390);await layout('English 390');await capture('ui-v1-english-390');
  await page.locator('#document-info summary').click();await expect(page.locator('#document-full-name')).toHaveText(enName);
  await expect(page.locator('#document-location')).toBeVisible();await capture('ui-v1-file-details-390');await page.locator('#document-info summary').click();
  await size(1440,900);await layout('English 1440');await capture('ui-v1-english-1440');
  const id=JSON.parse(await page.locator('#status').textContent()).activeSessionId,before=(await snapshot(id)).snapshot;
  await choose(null);await page.keyboard.press('Meta+o');await expect(page.locator('#viewer-status')).toContainText('已取消打开');
  expect((await snapshot(id)).snapshot).toEqual(before);await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  await expect(page.locator('#editor script,#editor img,#editor a')).toHaveCount(0);expect(await page.evaluate(()=>window.__uiUnsafe)).toBeUndefined();
  await choose(a);await page.locator('#open-file').click();await expect(page.locator('#editor h1')).toHaveText('把文字放在中央');
  expect(await fs.readFile(a,'utf8')).toBe(cn);expect(await fs.readFile(b,'utf8')).toBe(en);
  await info.attach('ui-layout-metrics',{body:JSON.stringify(metrics),contentType:'application/json'});
  await info.attach('ui-synthetic-originals',{body:JSON.stringify({a,b,sha256A:require('node:crypto').createHash('sha256').update(cn).digest('hex'),sha256B:require('node:crypto').createHash('sha256').update(en).digest('hex')}),contentType:'application/json'});
},info,null,true,false,false,null,{root:path.join(await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'writing-ui-layout-'))),'drafts')}));


test('document writing entry V1 keyboard paragraphs, temporary isolation and readonly safety', async ({},info)=>usingDemo(async h=>{
  const {app,page,root,snapshot,select,settled}=h;
  await app.evaluate(({dialog})=>{
    globalThis.closeChoice=1;globalThis.closePrompts=[];globalThis.writingChoices=[];
    dialog.showMessageBoxSync=(_win,options)=>{globalThis.closePrompts.push(options);return globalThis.closeChoice;};
    dialog.showOpenDialog=async()=>globalThis.writingChoices.shift();
  }); // Decisions are controlled; main's actual close event/guard and IPC remain in use.
  const id=async()=>JSON.parse(await page.locator('#status').textContent()).activeSessionId;
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.getByRole('button',{name:'新建',exact:true}).click();
  const a=await id();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','true');
  await expect(page.locator('#backup-summary')).toBeVisible();await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
  expect((await snapshot(a)).snapshot.source).toBe('');
  await page.keyboard.type('First ');await page.keyboard.insertText('中文😀');await settled();
  const first='First 中文😀';
  await page.keyboard.press('Enter');await settled();await expect(page.locator('#editor p')).toHaveCount(2);
  await page.keyboard.type('Second paragraph');await settled();const written=first+'\n\nSecond paragraph';
  expect((await snapshot(a)).snapshot.source).toBe(written);
  expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe('Second paragraph'.length);
  await select('#editor p:nth-of-type(2)',0);await page.keyboard.press('Backspace');await settled();
  expect((await snapshot(a)).snapshot.source).toBe(first+'Second paragraph');
  expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe(first.length);
  await page.keyboard.press('Meta+z');await settled();expect((await snapshot(a)).snapshot.source).toBe(written);
  await page.keyboard.press('Meta+Shift+z');await settled();expect((await snapshot(a)).snapshot.source).toBe(first+'Second paragraph');
  await page.keyboard.press('Meta+z');await settled();
  const aBefore=(await snapshot(a)).snapshot;
  await page.getByRole('button',{name:'新建',exact:true}).click();const b=await id();expect(b).not.toBe(a);
  await page.keyboard.insertText('Other temporary');await settled();
  await page.keyboard.press('Meta+z');await settled();expect((await snapshot(b)).snapshot.source).toBe('');
  expect((await snapshot(a)).snapshot).toEqual(aBefore);
  await selectDocument(page, a);await expect(page.locator('#editor p')).toHaveCount(2);
  expect(await page.locator('#document-name').textContent()).toBe(aBefore.label);
  const file=path.join(root,'opened-readonly.md'),bytes=Buffer.from('\ufeff# Read only\r\n\r\nOriginal body.');await fs.writeFile(file,bytes);
  await app.evaluate((_,file)=>globalThis.writingChoices.push({canceled:false,filePaths:[file]}),file);
  await page.keyboard.press('Meta+o');await expect(page.locator('#editor h1')).toHaveText('Read only');const real=await id();
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');await expect(page.locator('#temporary-notice')).toBeHidden();
  const realBefore=(await snapshot(real)).snapshot;
  await page.locator('#editor p').click();await page.keyboard.type('blocked');await page.keyboard.press('Enter');await page.keyboard.press('Meta+z');
  for(const operation of ['edit','save','undo','redo']){
    const result=await page.evaluate(({operation,sessionId})=>window.documentDemo[operation]({sessionId,expectedRevision:0,...(operation==='edit'?{from:1,to:1,insert:'blocked'}:{})}),{operation,sessionId:real});
    expect(result.code).toBe('read-only-document');
  }
  expect((await snapshot(real)).snapshot).toEqual(realBefore);expect((await snapshot(a)).snapshot).toEqual(aBefore);
  await selectDocument(page, a);await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','true');
  await select('#editor p:first-of-type',first.length);await page.keyboard.insertText('!');await settled();
  await page.keyboard.press('Meta+z');await settled();expect((await snapshot(a)).snapshot.source).toBe(written);
  await app.evaluate(()=>globalThis.writingChoices.push({canceled:true,filePaths:[]}));await page.keyboard.press('Meta+o');
  await expect(page.locator('#viewer-status')).toContainText('已取消打开');expect(await id()).toBe(a);
  // Genuine stale revision produces a protected local draft; switching never discards it.
  const current=(await snapshot(a)).snapshot;
  expect((await page.evaluate(data=>window.documentDemo.edit(data),{sessionId:a,expectedRevision:current.revision,from:1,to:2,insert:'X'})).ok).toBe(true);
  await select('#editor p:first-of-type',0,1);await page.keyboard.insertText('UNCONFIRMED');await settled();
  await expect(page.locator('#recovery-panel')).toBeVisible();await expect(page.locator('#recovery')).toContainText('UNCONFIRMED');
  await selectDocument(page, b);await expect(page.locator('#recovery-panel')).toBeHidden();
  await selectDocument(page, a);await expect(page.locator('#recovery')).toContainText('UNCONFIRMED');
  const retained=(await snapshot(a)).snapshot;
  expect((await page.evaluate(data=>window.documentDemo.save(data),{sessionId:a,expectedRevision:retained.revision})).code).toBe('temporary-not-persistable');
  await app.evaluate(({BrowserWindow})=>{globalThis.closeChoice=0;BrowserWindow.getAllWindows()[0].close();});
  await expect(page.locator('#document-header')).toBeVisible();expect((await snapshot(a)).snapshot).toEqual(retained);
  const prompts=await app.evaluate(()=>globalThis.closePrompts);expect(prompts.at(-1).detail).toContain('only in this process');
  expect(prompts.at(-1).defaultId).toBe(0);expect(prompts.at(-1).cancelId).toBe(0);
  await app.evaluate(()=>{globalThis.closeChoice=1;}); // Actual close completes in the shared parent-exit verification.
  expect((await fs.readFile(file)).equals(bytes)).toBe(true);
  const seeds=(await fs.readdir(root)).filter(n=>/^temporary-\d+\.md$/.test(n));expect(seeds).toHaveLength(2);
  for(const seed of seeds)expect((await fs.readFile(path.join(root,seed))).length).toBe(0);
  const screenshot=info.outputPath('temporary-writing.png');await page.screenshot({path:screenshot});await info.attach('temporary-writing',{path:screenshot,contentType:'image/png'});
},info,null,true));


test('save copy UI V1 creates confirmed revision, preserves writing and reopens after process exit', async ({}, info) => {
  let receipt, original;
  await usingDemo(async ({ app, page, snapshot, select, settled, copyRoot }) => {
    await app.evaluate(({ dialog }) => {
      globalThis.copyClose = 1; globalThis.copyChoices = [];
      dialog.showMessageBoxSync = () => globalThis.copyClose;
      dialog.showOpenDialog = async () => globalThis.copyChoices.shift();
    });
    const id = async () => JSON.parse(await page.locator('#status').textContent()).activeSessionId;
    await page.getByRole('button', { name: '新建', exact: true }).click(); const temporary = await id();
    await page.keyboard.type('First '); await page.keyboard.insertText('中文😀'); await settled();
    await page.keyboard.press('Enter'); await settled(); await page.keyboard.type('Second paragraph'); await settled();
    const written = 'First 中文😀\n\nSecond paragraph';
    await select('#editor p:nth-of-type(2)', 0); await page.keyboard.press('Backspace'); await settled();
    expect((await snapshot(temporary)).snapshot.source).toBe('First 中文😀Second paragraph');
    await page.keyboard.press('Meta+z'); await settled(); await page.keyboard.press('Meta+Shift+z'); await settled();
    await page.keyboard.press('Meta+z'); await settled();
    const before = (await snapshot(temporary)).snapshot; expect(before.source).toBe(written);
    await page.getByRole('button', { name: '创建测试副本', exact: true }).click();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await page.locator('#cancel-test-copy').click();
    expect((await snapshot(temporary)).snapshot).toEqual(before);
    expect((await fs.readdir(copyRoot)).filter(n => n.startsWith('copy-'))).toHaveLength(0);
    // Composition protection uses real DOM events, but is not native macOS IME acceptance.
    await page.locator('#editor .tiptap').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await expect(page.locator('#create-test-copy')).toBeDisabled();
    expect((await page.evaluate(s => window.documentDemo.createTestCopy({ sessionId: s.sessionId, expectedRevision: s.revision, expectedSha256: s.copySha256 }), before)).code).toBe('composition-active');
    await page.locator('#editor .tiptap').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await expect(page.locator('#create-test-copy')).toBeEnabled();
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#test-copy-result')).toContainText('Test copy created: revision');
    const after = (await snapshot(temporary)).snapshot; receipt = after.copyState;
    for (const k of ['source', 'revision', 'dirty', 'canUndo', 'canRedo', 'saveState']) expect(after[k]).toEqual(before[k]);
    expect(receipt.state).toBe('created-confirmed'); expect(path.dirname(receipt.filePath)).toBe(copyRoot);
    original = await fs.readFile(receipt.filePath); expect(original.toString()).toBe(written);
    expect(require('node:crypto').createHash('sha256').update(original).digest('hex')).toBe(receipt.sha256);
    await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    await select('#editor p:nth-of-type(2)', 'Second paragraph'.length); await page.keyboard.insertText(' later'); await settled();
    expect((await fs.readFile(receipt.filePath)).equals(original)).toBe(true);
    await expect(page.locator('#test-copy-result')).toContainText('revision ' + receipt.revision);
    expect((await snapshot(temporary)).snapshot.revision).toBeGreaterThan(receipt.revision);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(temporary)).snapshot.source).toBe(written);
    await app.evaluate((_, file) => globalThis.copyChoices.push({ canceled: false, filePaths: [file] }), receipt.filePath);
    await page.keyboard.press('Meta+o'); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    const real = (await snapshot(await id())).snapshot;
    await expect(page.locator('#create-test-copy')).toBeHidden();
    expect((await page.evaluate(s => window.documentDemo.createTestCopy({ sessionId: s.sessionId, expectedRevision: s.revision, expectedSha256: '0'.repeat(64) }), real)).code).toBe('read-only-document');
    expect((await page.evaluate(s => window.documentDemo.save({ sessionId: s.sessionId, expectedRevision: s.revision }), real)).code).toBe('read-only-document');
    await selectDocument(page, temporary); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    await app.evaluate(({ BrowserWindow }) => { globalThis.copyClose = 0; BrowserWindow.getAllWindows()[0].close(); });
    expect((await snapshot(temporary)).snapshot.source).toBe(written);
    await app.evaluate(() => { globalThis.copyClose = 1; });
    const shot = info.outputPath('test-copy-created.png'); await page.screenshot({ path: shot }); await info.attach('test-copy-created', { path: shot, contentType: 'image/png' });
  }, info, null, true, true);
  // The creator's actual OS process has exited (shared helper verifies code/signal/watchdog).
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, receipt.filePath);
    await page.locator('#open-file').click(); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    const id = JSON.parse(await page.locator('#status').textContent()).activeSessionId;
    expect((await snapshot(id)).snapshot.source).toBe(original.toString());
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    const bytes = await fs.readFile(receipt.filePath); expect(bytes.equals(original)).toBe(true);
    expect(require('node:crypto').createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
    await expect(page.locator('#create-test-copy')).toBeHidden();
  }, info, null, true);
});


test('persistent copy V1 creates a selected new file and reopens after Electron exit', async ({}, info) => {
  const ownedFixture = createHomeFixture('Markdown-Persistent-Test-E2E-'), dir = ownedFixture.dir;
  const { spawnSync } = require('node:child_process');
  const { inspectMacMetadata } = require('../lib/document-save-policy');
  const acl = 'group:everyone deny delete';
  expect(spawnSync('/bin/chmod', ['+a', acl, dir]).status).toBe(0);
  expect(spawnSync('/usr/bin/xattr', ['-wx', 'com.apple.macl', '01020304', dir]).status).toBe(0);
  const directoryMetadata = inspectMacMetadata(dir, { newFileDirectory: true });
  expect(directoryMetadata.acl).not.toBe(false);
  expect(directoryMetadata.xattrs['com.apple.macl']).toBe(require('node:crypto').createHash('sha256').update(Buffer.from('01020304', 'hex')).digest('hex'));
  const target = path.join(dir, 'persistent.md');
  let receipt, original;
  await usingDemo(async ({ app, page, snapshot, settled, select }) => {
    await page.locator('#new-temporary').click(); await expect(page.locator('#editor p')).toHaveCount(1);
    const id = () => page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
    await page.locator('#editor p').click(); await page.keyboard.type('First '); await page.keyboard.insertText('中文😀'); await settled();
    await page.keyboard.type(' [ ]'); await settled();
    await page.keyboard.press('Meta+z'); await settled(); await expect(page.locator('#editor p')).toHaveText('First 中文😀 [ ');
    await page.keyboard.press('Meta+Shift+z'); await settled(); await expect(page.locator('#editor p')).toHaveText('First 中文😀 [ ]');
    await page.keyboard.press('Enter'); await settled(); await page.keyboard.type('Second paragraph.'); await settled();
    const temporary = await id(), before = (await snapshot(temporary)).snapshot;
    expect(before.source).toBe('First 中文😀 [ ]\n\nSecond paragraph.');
    await app.evaluate(({ dialog }, filePath) => {
      globalThis.persistentDialog = { canceled: true, filePath, calls: [] };
      dialog.showMessageBox = async () => ({ response: 1 }); // Consent fixture, no native automation claim.
      dialog.showSaveDialog = async (_win, options) => {
        globalThis.persistentDialog.calls.push({ bookmarks: options.securityScopedBookmarks, title: options.title, defaultPath: options.defaultPath, message: options.message });
        return { canceled: globalThis.persistentDialog.canceled, filePath: globalThis.persistentDialog.filePath };
      };
      dialog.showMessageBoxSync = () => 1;
    }, target);
    const create = async () => { await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click(); };
    await create();
    await expect.poll(() => app.evaluate(() => globalThis.persistentDialog.calls.length)).toBe(1);
    const saveOptions = await app.evaluate(() => globalThis.persistentDialog.calls[0]);
    expect(['Untitled.md', path.join(require('node:os').homedir(), 'Downloads', 'Untitled.md')]).toContain(saveOptions.defaultPath);
    expect(saveOptions.message).toContain('主文件夹、桌面、文稿、资源库及同步目录不受支持');
    expect(saveOptions.message).toContain('主文件夹直属');
    expect(saveOptions.message).toContain('支持通过检查的下载目录');
    await expect(page.locator('#test-copy-operation')).toContainText('create-cancelled');
    expect((await snapshot(temporary)).snapshot.source).toBe(before.source);
    await expect.poll(async () => { try { await fs.lstat(target); return true; } catch { return false; } }).toBe(false);
    await app.evaluate(() => { globalThis.persistentDialog.canceled = false; });
    await create(); await expect(page.locator('#test-copy-result')).toContainText('New Markdown file created: revision');
    const lastConfirmed = await page.locator('#test-copy-result').textContent();
    const after = (await snapshot(temporary)).snapshot; receipt = after.copyState;
    expect(receipt.ok).toBe(true); expect(receipt.filePath).toBe(target); expect(after.revision).toBe(before.revision);
    expect(after.dirty).toBe(before.dirty); expect(after.canUndo).toBe(before.canUndo); expect(after.canRedo).toBe(before.canRedo);
    original = await fs.readFile(target); expect(original.toString()).toBe(before.source);
    ownedFixture.recordFile('persistent.md', original);
    expect(require('node:crypto').createHash('sha256').update(original).digest('hex')).toBe(receipt.sha256);
    expect(await app.evaluate(() => globalThis.persistentDialog.calls.map(({ bookmarks, title }) => ({ bookmarks, title })))).toEqual([
      { bookmarks: false, title: 'Save as NEW Markdown file' }, { bookmarks: false, title: 'Save as NEW Markdown file' }
    ]);
    await select('#editor p:last-child', 'Second paragraph.'.length);
    await page.keyboard.press('Enter'); await settled(); await page.keyboard.type('THIRD'); await settled();
    expect((await snapshot(temporary)).snapshot.source).toContain('THIRD'); expect((await fs.readFile(target)).equals(original)).toBe(true);
    await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    await create(); await expect(page.locator('#test-copy-operation')).toContainText('target-exists');
    await expect(page.locator('#test-copy-result')).toHaveText(lastConfirmed);
    expect(lastConfirmed).toContain(receipt.filePath); expect(lastConfirmed).toContain(receipt.sha256);
    expect(lastConfirmed).toContain('revision ' + receipt.revision);
    expect((await fs.readFile(target)).equals(original)).toBe(true);
    const current = (await snapshot(temporary)).snapshot;
    await app.evaluate(() => { globalThis.persistentDialog.canceled = true; });
    await create(); await expect(page.locator('#test-copy-operation')).toContainText('create-cancelled');
    await expect(page.locator('#test-copy-result')).toHaveText(lastConfirmed);
    expect((await snapshot(temporary)).snapshot).toEqual(current);
    expect((await fs.readFile(target)).equals(original)).toBe(true);
    const shot = info.outputPath('persistent-copy.png'); await page.screenshot({ path: shot }); await info.attach('persistent-copy', { path: shot, contentType: 'image/png' });
  }, info, null, true, true, true, target);
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
    await page.locator('#open-file').click(); await expect(page.locator('#document-name')).toHaveText('persistent.md');
    const id = await page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
    const reopened = (await snapshot(id)).snapshot; expect(reopened.readOnly).toBe(true); expect(reopened.source).toBe(original.toString());
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false'); await expect(page.locator('#create-test-copy')).toBeHidden();
    for (const op of ['save','createPersistentCopy']) expect((await page.evaluate(async ({ op, id, revision }) => window.documentDemo[op]({ sessionId: id, expectedRevision: revision }), { op, id, revision: reopened.revision })).code).toBe('read-only-document');
    expect((await fs.readFile(target)).equals(original)).toBe(true);
  }, info, null, true);
  // The default protection must remain unchanged and never inherit onto the new file.
  expect(inspectMacMetadata(dir, { newFileDirectory: true })).toEqual(directoryMetadata);
  const createdMetadata = inspectMacMetadata(target, { newlyCreatedFile: true });
  expect(createdMetadata.acl).toBe(false);
  expect(Object.keys(createdMetadata.xattrs)).toEqual(expect.arrayContaining(['com.apple.macl', 'com.apple.lastuseddate#PS']));
  expect(() => inspectMacMetadata(target)).toThrow();
  // Both Electron processes exited. Undo only this test's exact ACE before reclaim.
  expect(spawnSync('/bin/chmod', ['-a', acl, dir]).status).toBe(0);
  const cleanup = ownedFixture.cleanup({ passed: true, quiescent: true });
  expect(cleanup.state, JSON.stringify(cleanup)).toBe('removed');
  console.log('home-fixture-cleanup:' + JSON.stringify(cleanup));
});


test('existing document editing V1 forks, writes paragraphs and persistently reopens without touching original', async ({}, info) => {
  const os = require('node:os'), hash = b => require('node:crypto').createHash('sha256').update(b).digest('hex');
  const inputs = await fs.mkdtemp(path.join(os.tmpdir(), 'existing-edit-input-'));
  const originalPath = path.join(inputs, 'original.md');
  const raw = '\ufeff---\r\nkind: synthetic\r\n---\r\n\r\nFirst 中文😀\r\n\r\nSecond.\r\n\r\n::: untouched';
  const bytes = Buffer.from(raw); await fs.writeFile(originalPath, bytes, { flag: 'wx', mode: 0o600 });
  const ownedFixture = createHomeFixture('Writing-synthetic-E2E-'), dest = ownedFixture.dir;
  const target = path.join(dest, '编辑后的副本 😀.md'); let written, receipt;
  const sentinel = path.join(dest, 'untouched.md'); await fs.writeFile(sentinel, 'UNTOUCHED', { flag: 'wx', mode: 0o600 });
  ownedFixture.recordFile('untouched.md', Buffer.from('UNTOUCHED'));
  await usingDemo(async ({ app, page, snapshot, select, settled, projectSource }) => {
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      dialog.showMessageBoxSync = () => 1;
    }, originalPath);
    await page.locator('#open-file').click(); await expect(page.locator('#document-name')).toHaveText('original.md');
    const active = () => page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
    const original = await active(), originalSnapshot = (await snapshot(original)).snapshot;
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await page.locator('#edit-copy').click(); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    const copy = await active(); expect(copy).not.toBe(original);
    await expect(page.locator('#document-name')).toContainText('original.md');
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    await select('#editor p:first-of-type', 'First 中文😀'.length);
    await page.keyboard.type(' X'); await settled(); await page.keyboard.press('Backspace'); await settled();
    await page.keyboard.insertText('中文😃'); await settled(); await page.keyboard.press('Enter'); await settled();
    await page.keyboard.type('New paragraph'); await settled();
    const split = (await snapshot(copy)).snapshot.source;
    await select('#editor p:nth-of-type(2)', 0); await page.keyboard.press('Backspace'); await settled();
    const joined = (await snapshot(copy)).snapshot.source; expect(joined).not.toBe(split);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(copy)).snapshot.source).toBe(split);
    await page.keyboard.press('Meta+Shift+z'); await settled(); expect((await snapshot(copy)).snapshot.source).toBe(joined);
    await page.keyboard.press('Meta+z'); await settled();
    expect(split).toBe(raw.slice(1).replace('First 中文😀', 'First 中文😀 中文😃\r\n\r\nNew paragraph'));
    const before = (await snapshot(copy)).snapshot;
    await selectDocument(page, original);
    await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    for (const operation of ['edit','save','createPersistentCopy']) {
      const r = await page.evaluate(({ operation, id }) => window.documentDemo[operation]({ sessionId: id, expectedRevision: 0 }), { operation, id: original });
      expect(r.code).toBe('read-only-document');
    }
    expect((await snapshot(original)).snapshot).toEqual(originalSnapshot);
    await selectDocument(page, copy); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect((await snapshot(copy)).snapshot).toEqual(before);
    const unsafe = await page.evaluate(q => window.documentDemo.edit(q), { sessionId: copy, expectedRevision: before.revision, from: 0, to: 1, insert: 'X' });
    expect(unsafe.code).toBe('unsafe-source-range'); expect(unsafe.snapshot.source).toBe(split);
    await app.evaluate(({ dialog }, filePath) => {
      globalThis.editingSaveCancel = true;
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({ canceled: globalThis.editingSaveCancel, filePath });
    }, target);
    const create = async () => { await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click(); };
    await create(); await expect(page.locator('#test-copy-operation')).toContainText('create-cancelled');
    expect((await snapshot(copy)).snapshot.source).toBe(split); await expect.poll(() => fs.access(target).then(() => true, () => false)).toBe(false);
    await app.evaluate(() => { globalThis.editingSaveCancel = false; });
    await expect(page.locator('#create-test-copy')).toHaveText('Save as new file…');
    await create(); await expect(page.locator('#test-copy-result')).toContainText('New Markdown file created: revision');
    const lastConfirmed = await page.locator('#test-copy-result').textContent();
    expect(await fs.readFile(sentinel, 'utf8')).toBe('UNTOUCHED');
    const after = (await snapshot(copy)).snapshot; receipt = after.copyState; written = await fs.readFile(target);
    expect(written.equals(Buffer.from('\ufeff' + split))).toBe(true); expect(hash(written)).toBe(receipt.sha256);
    ownedFixture.recordFile(path.basename(target), written);
    for (const key of ['source','revision','dirty','canUndo','canRedo']) expect(after[key]).toBe(before[key]);
    await select('#editor p:first-of-type', 0); await page.keyboard.type('LATER '); await settled();
    expect((await fs.readFile(target)).equals(written)).toBe(true);
    await create(); await expect(page.locator('#test-copy-operation')).toContainText('target-exists');
    await expect(page.locator('#test-copy-result')).toHaveText(lastConfirmed);
    expect(lastConfirmed).toContain(receipt.filePath); expect(lastConfirmed).toContain(receipt.sha256);
    expect(lastConfirmed).toContain('revision ' + receipt.revision);
    await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect((await fs.readFile(originalPath)).equals(bytes)).toBe(true);
    const current = (await snapshot(copy)).snapshot;
    await selectDocument(page, original);
    await expect(page.locator('#test-copy-panel')).toBeHidden();
    await selectDocument(page, copy);
    await expect(page.locator('#test-copy-result')).toHaveText(lastConfirmed);
    await expect(page.locator('#test-copy-operation')).toContainText('target-exists');
    expect((await snapshot(copy)).snapshot).toEqual(current);
    const shot = info.outputPath('existing-document-copy.png'); await page.screenshot({ path: shot });
    await info.attach('existing-document-copy', { path: shot, contentType: 'image/png' });
  }, info, null, true, true, true);
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
    await page.keyboard.press('Meta+o'); await expect(page.locator('#document-name')).toHaveText('编辑后的副本 😀.md');
    const id = await page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
    const reopened = (await snapshot(id)).snapshot;
    expect(reopened.readOnly).toBe(true); expect(reopened.bom).toBe(true); expect(reopened.source).toBe(written.toString().slice(1));
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    expect(hash(await fs.readFile(target))).toBe(receipt.sha256); expect((await fs.readFile(originalPath)).equals(bytes)).toBe(true);
  }, info, null, true);
  const cleanup = ownedFixture.cleanup({ passed: true, quiescent: true });
  expect(cleanup.state, JSON.stringify(cleanup)).toBe('removed');
  console.log('home-fixture-cleanup:' + JSON.stringify(cleanup));
});

test('existing document editing V1 lost copy response keeps original identity and existing drafts', async ({}, info) => usingDemo(async ({ app, page, snapshot, select, settled }) => {
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'editing-copy-lost-'));
  const file = path.join(root, 'original.md'); await fs.writeFile(file, 'Original synthetic text.');
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); dialog.showMessageBoxSync = () => 1; }, file);
  await page.locator('#new-temporary').click(); await page.locator('#editor p').click(); await page.keyboard.type('Retained writing'); await settled();
  const temp = await page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
  // Genuine stale revision produces a recovery record before switching away.
  // Do not assume keyboard batching; obtain the authoritative revision first.
  const current = (await snapshot(temp)).snapshot;
  await page.evaluate(q => window.documentDemo.edit(q), { sessionId: temp, expectedRevision: current.revision, from: 1, to: 1, insert: 'MAIN ' });
  await select('#editor p', 0); await page.keyboard.type('D'); await settled(); await expect(page.locator('#status')).toContainText('stale-revision');
  const savedDraft = await page.locator('#recovery').textContent(); expect(savedDraft).toContain('DRetained writing');
  await page.locator('#open-file').click(); await expect(page.locator('#document-name')).toHaveText('original.md');
  const original = await page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
  const originalState = (await snapshot(original)).snapshot;
  await app.evaluate(({ ipcMain }) => {
    const channel = 'document-demo:request', actual = ipcMain._invokeHandlers.get(channel);
    ipcMain.removeHandler(channel); ipcMain.handle(channel, async (event, q) => {
      const result = await actual(event, q); if (q.operation === 'edit-copy') throw Error('synthetic lost copy response'); return result;
    });
  });
  await page.locator('#edit-copy').click(); await expect(page.locator('#viewer-status')).toContainText('outcome is unknown');
  await expect(page.locator('#documents')).toHaveValue(original); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  await page.locator('#editor p').click(); await page.keyboard.type('MUST NOT WRITE');
  expect((await snapshot(original)).snapshot).toEqual(originalState);
  await selectDocument(page, temp); await expect(page.locator('#recovery')).toHaveText(savedDraft);
  expect((await fs.readFile(file, 'utf8'))).toBe('Original synthetic text.');
}, info, null, true));

for (const complex of [false, true]) test(`existing editing QA browser composition continues after selected Chinese replacement ${complex ? 'complex' : 'plain'}`, async ({}, info) => usingDemo(async h => {
  const { app, page, snapshot, select, settled } = h;
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'editing-ime-'));
  const originalPath = path.join(root, 'synthetic.md');
  const original = (complex ? '# Synthetic heading\r\n\r\n' : '') + '第一段中文 text.\r\n\r\n第二段中文 text.'
    + (complex ? '\r\n\r\n```js\r\nconst sample = 1;\r\n```\r\n\r\n::: opaque\r\n\r\nA **bold** tail.' : '');
  await fs.writeFile(originalPath, '\ufeff' + original, { flag: 'wx', mode: 0o600 });
  const bytes = await fs.readFile(originalPath);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); dialog.showMessageBoxSync = () => 1;
  }, originalPath);
  await page.locator('#open-file').click(); await expect(page.locator('#edit-copy')).toBeVisible();
  const active = () => page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
  const originalId = await active(); await page.locator('#edit-copy').click();
  await expect(page.locator('#readonly-badge')).toHaveText('本地草稿'); const copy = await active();
  await page.evaluate(() => {
    const rows = []; const add = (type, extra = {}) => {
      const s = JSON.parse(document.querySelector('#status').textContent), editor = document.querySelector('.tiptap').editor;
      rows.push({ at: performance.now(), type, ...extra, composing: s.composing, code: s.editingCode, pending: s.pending,
        revision: s.revision, session: s.activeSessionId, pmComposing: editor.view.composing,
        focused: document.activeElement === editor.view.dom, disabled: document.querySelector('#documents').disabled });
      if (rows.length > 160) rows.shift();
    }; window.editingInputTrace = rows;
    for (const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input','focus','blur'])
      window.addEventListener(type, e => add(type, { trusted: e.isTrusted, isComposing: e.isComposing, inputType: e.inputType }), true);
    const editor = document.querySelector('.tiptap').editor;
    for (const plugin of editor.state.plugins) if (plugin.spec.filterTransaction) {
      const filter = plugin.spec.filterTransaction;
      plugin.spec.filterTransaction = function (tr, state) { const accepted = filter.call(this, tr, state); add('transaction', { accepted, changed: tr.docChanged, steps: tr.steps.map(s => s.constructor.name) }); return accepted; };
    }
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await select('#editor p:first-of-type', 0, 5);
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
    await cdp.send('Input.imeSetComposition', { text: '改写中文', selectionStart: 4, selectionEnd: 4 });
    await cdp.send('Input.insertText', { text: '改写中文' });
    await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).composing).toBe(false);
    await settled(); expect((await snapshot(copy)).snapshot.source).toBe(original.replace('第一段中文', '改写中文'));
    // Browser commits an active composition when the user clicks another paragraph.
    await select('#editor p:nth-of-type(2)', 0, 5);
    await cdp.send('Input.imeSetComposition', { text: '点击提交', selectionStart: 4, selectionEnd: 4 });
    await page.locator('#editor p:first-of-type').click();
    await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).composing).toBe(false);
    await settled(); expect((await snapshot(copy)).snapshot.source).toContain('点击提交');
    const beforeCancel = (await snapshot(copy)).snapshot.source;
    await cdp.send('Input.imeSetComposition', { text: 'cancel', selectionStart: 6, selectionEnd: 6 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).composing).toBe(false);
    await settled(); expect((await snapshot(copy)).snapshot.source).toBe(beforeCancel);
    if (complex) {
      const beforeUnsafe = (await snapshot(copy)).snapshot.source;
      await expect(page.locator('#editor pre').first()).toHaveAttribute('contenteditable', 'false');
      await page.locator('#editor pre').first().click();
      await cdp.send('Input.imeSetComposition', { text: '拒绝', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.insertText', { text: '拒绝' });
      await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).composing).toBe(false);
      await settled(); expect((await snapshot(copy)).snapshot.source).toBe(beforeUnsafe);
    }
    await page.locator('#editor p:nth-of-type(2)').click(); await page.keyboard.press('End');
    await page.keyboard.type(' MORE'); await settled();
    const after = (await snapshot(copy)).snapshot; expect(after.source).toContain('MORE');
    await page.keyboard.press('Meta+z'); await settled(); await page.keyboard.press('Meta+Shift+z'); await settled();
    expect((await snapshot(copy)).snapshot.source).toBe(after.source);
    await selectDocument(page, originalId); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    await selectDocument(page, copy); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect((await snapshot(copy)).snapshot.source).toBe(after.source); expect((await fs.readFile(originalPath)).equals(bytes)).toBe(true);
  } finally {
    const trace = info.outputPath('composition-metadata.json'); await fs.writeFile(trace, JSON.stringify(await page.evaluate(() => window.editingInputTrace), null, 2));
    await info.attach('composition-metadata-only', { path: trace, contentType: 'application/json' });
    await cdp.detach();
  }
}, info, null, true));

test('existing editing QA missing compositionend preserves copies and refuses to invent completion', async ({}, info) => usingDemo(async h => {
  const { page, snapshot, sessions } = h, id = sessions[0].sessionId;
  const before = (await snapshot(id)).snapshot;
  await unsafeComposition(h, 'UNCONFIRMED-中文');
  await page.locator('#editor p').first().click();
  await expect(page.locator('#composition-status')).toBeVisible();
  await expect(page.locator('#documents')).toBeDisabled();
  expect(JSON.parse(await page.locator('#status').textContent()).composing).toBe(true);
  expect((await snapshot(id)).snapshot).toEqual(before);
  await expect(page.locator('#recovery')).toContainText('UNCONFIRMED-中文');
  await page.locator('#editor .tiptap').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect(page.locator('#documents')).toBeEnabled();
  await expect(page.locator('#composition-status')).toBeHidden();
  expect((await snapshot(id)).snapshot).toEqual(before);
  await expect(page.locator('#recovery')).toContainText('UNCONFIRMED-中文');
}, info));


test('soft paragraph V1 edits source lines, refuses crossing and saves exact new bytes', async ({}, info) => {
  const os=require('node:os'),hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
  const inputs=await fs.mkdtemp(path.join(os.tmpdir(),'soft-paragraph-input-')),originalPath=path.join(inputs,'soft.md');
  const raw='\ufeff---\r\nkind: synthetic\r\n---\r\n\r\nFirst 中文😀\r\nsecond line.\r\n\r\nLast.\r\n\r\n```js\r\nKEEP();\r\n```\r\n\r\n![x](../x.png)';
  const bytes=Buffer.from(raw);await fs.writeFile(originalPath,bytes,{flag:'wx',mode:0o600});
  const ownedFixture=createHomeFixture('Writing-synthetic-E2E-'),target=path.join(ownedFixture.dir,'soft-edited.md');
  let written,receipt;
  await usingDemo(async({app,page,snapshot,select,settled})=>{
    await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});dialog.showMessageBoxSync=()=>1;},originalPath);
    await page.keyboard.press('Meta+o');await expect(page.locator('#document-name')).toHaveText('soft.md');
    await expect(page.locator('#editor p:first-of-type')).toHaveText('First 中文😀 second line.');
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    const active=()=>page.evaluate(()=>JSON.parse(document.querySelector('#status').textContent).activeSessionId);
    const original=await active(),originalSnapshot=(await snapshot(original)).snapshot;
    await page.locator('#edit-copy').click();await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    const copy=await active();expect(copy).not.toBe(original);
    await select('#editor p:first-of-type',1,2);await page.keyboard.type('X');await settled();
    expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe(2);
    const second='First 中文😀'.length+1;
    await select('#editor p:first-of-type',second,second+1);await page.keyboard.insertText('新😀');await settled();
    expect(await page.evaluate(()=>window.getSelection().focusOffset)).toBe(second+3);
    const changed=raw.slice(1).replace('First','FXrst').replace('second','新😀econd');
    expect((await snapshot(copy)).snapshot.source).toBe(changed);
    await page.keyboard.press('Meta+z');await settled();expect((await snapshot(copy)).snapshot.source).toBe(raw.slice(1).replace('First','FXrst'));
    await page.keyboard.press('Meta+Shift+z');await settled();expect((await snapshot(copy)).snapshot.source).toBe(changed);
    const beforeReject=(await snapshot(copy)).snapshot;
    await select('#editor p:first-of-type',second);await page.keyboard.press('Backspace');
    await expect(page.locator('#viewer-status')).toContainText('此处暂不支持该修改');
    expect((await snapshot(copy)).snapshot).toEqual(beforeReject);
    await select('#editor p:first-of-type',2);await page.keyboard.press('Enter');
    await expect(page.locator('#viewer-status')).toContainText('此处暂不支持该修改');
    expect((await snapshot(copy)).snapshot).toEqual(beforeReject);
    await select('#editor p:first-of-type',second+3);await page.keyboard.type('Y');await settled();
    await expect(page.locator('#viewer-status')).not.toContainText('此处暂不支持该修改');
    const expected=changed.replace('新😀econd','新😀Yecond');
    expect((await snapshot(copy)).snapshot.source).toBe(expected);
    await expect(page.locator('#editor pre').last()).toHaveAttribute('contenteditable','false');
    await selectDocument(page, original);await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    expect((await snapshot(original)).snapshot).toEqual(originalSnapshot);
    expect((await page.evaluate(id=>window.documentDemo.save({sessionId:id,expectedRevision:0}),original)).code).toBe('read-only-document');
    await selectDocument(page, copy);await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect((await snapshot(copy)).snapshot.source).toBe(expected);
    await app.evaluate(({dialog},filePath)=>{dialog.showMessageBox=async()=>({response:1});dialog.showSaveDialog=async()=>({canceled:false,filePath});},target);
    const before=(await snapshot(copy)).snapshot;
    await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#test-copy-result')).toContainText('New Markdown file created: revision');
    const after=(await snapshot(copy)).snapshot;receipt=after.copyState;written=await fs.readFile(target);
    expect(written.equals(Buffer.from('\ufeff'+expected))).toBe(true);expect(hash(written)).toBe(receipt.sha256);
    ownedFixture.recordFile('soft-edited.md',written);
    for(const k of ['source','revision','dirty','canUndo','canRedo'])expect(after[k]).toBe(before[k]);
    expect((await fs.readFile(originalPath)).equals(bytes)).toBe(true);
    const screenshot=info.outputPath('soft-paragraph-writing.png');await page.screenshot({path:screenshot});await info.attach('soft-paragraph-writing',{path:screenshot,contentType:'image/png'});
  },info,null,true,true,true);
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},target);
    await page.keyboard.press('Meta+o');await expect(page.locator('#document-name')).toHaveText('soft-edited.md');
    const id=await page.evaluate(()=>JSON.parse(document.querySelector('#status').textContent).activeSessionId),r=(await snapshot(id)).snapshot;
    expect(r.readOnly).toBe(true);expect(r.bom).toBe(true);expect(r.source).toBe(written.toString().slice(1));
    await expect(page.locator('#editor p:first-of-type')).toHaveText('FXrst 中文😀 新😀Yecond line.');
    expect(hash(await fs.readFile(target))).toBe(receipt.sha256);expect(hash(await fs.readFile(originalPath))).toBe(hash(bytes));
  },info,null,true);
  const cleanup=ownedFixture.cleanup({passed:true,quiescent:true});expect(cleanup.state,JSON.stringify(cleanup)).toBe('removed');console.log('home-fixture-cleanup:'+JSON.stringify(cleanup));
});


test('paste V1 accepts plain clipboard text and preserves the original session', async ({}, info) => {
  const fixture = createHomeFixture('Writing-synthetic-E2E-'), target = path.join(fixture.dir, 'pasted.md');
  let written, receipt, originalFile, originalBytes;
  await usingDemo(async ({ app, page, snapshot, select, settled, root }) => {
    const file = path.join(root, 'paste-original.md'), bytes = Buffer.from('\ufeffFirst.\r\n\r\nSecond.');
    originalFile = file; originalBytes = bytes;
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      dialog.showMessageBoxSync = () => 1;
    }, file);
    await page.keyboard.press('Meta+o'); await expect(page.locator('#document-name')).toHaveText('paste-original.md');
    const original = JSON.parse(await page.locator('#status').textContent()).activeSessionId;
    await page.locator('#edit-copy').click(); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    const copy = JSON.parse(await page.locator('#status').textContent()).activeSessionId;
    const paste = text => page.locator('#editor .tiptap').evaluate((node, value) => {
      const data = new DataTransfer(); data.setData('text/plain', value);
      data.setData('text/html', '<img src=x onerror="window.pasteExecuted=true">');
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, text);
    await select('#editor p:first-of-type', 5); await paste(' 中文😀');
    await expect(page.locator('#editor p:first-of-type')).toHaveText('First 中文😀.'); await settled();
    expect((await snapshot(copy)).snapshot.source).toBe('First 中文😀.\r\n\r\nSecond.');
    expect(await page.locator('#editor img').count()).toBe(0);
    expect(await page.evaluate(() => !!window.pasteExecuted)).toBe(false);
    await page.keyboard.press('Meta+z'); await settled(); await expect(page.locator('#editor p:first-of-type')).toHaveText('First.');
    await page.keyboard.press('Meta+Shift+z'); await settled(); await expect(page.locator('#editor p:first-of-type')).toHaveText('First 中文😀.');
    const beforeReject = (await snapshot(copy)).snapshot;
    await paste('one\n\n\ntwo'); await expect(page.locator('#viewer-status')).toContainText('没有截断内容');
    expect((await snapshot(copy)).snapshot).toEqual(beforeReject);
    await select('#editor p:last-of-type', 7); await page.keyboard.type(' next'); await settled();
    await page.keyboard.press('Enter'); await page.keyboard.type('Third.'); await settled();
    await page.keyboard.press('Meta+ArrowLeft'); await page.keyboard.press('Backspace'); await settled();
    await page.keyboard.press('Meta+z'); await settled(); await page.keyboard.press('Meta+Shift+z'); await settled();
    await selectDocument(page, original); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    await select('#editor p:first-of-type', 2); await paste('NO');
    expect((await snapshot(original)).snapshot.source).toBe('First.\r\n\r\nSecond.');
    expect((await page.evaluate(id => window.documentDemo.save({ sessionId: id, expectedRevision: 0 }), original)).code).toBe('read-only-document');
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    await selectDocument(page, copy); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    await app.evaluate(({ dialog }, filePath) => {
      globalThis.pasteSaveTarget = filePath; globalThis.pasteSaveCancel = false;
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({ canceled: globalThis.pasteSaveCancel, filePath: globalThis.pasteSaveTarget });
    }, target);
    const create = async () => { await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click(); };
    const beforeCreate = (await snapshot(copy)).snapshot;
    expect(beforeCreate.source).toBe('First 中文😀.\r\n\r\nSecond. nextThird.');
    await create(); await expect(page.locator('#test-copy-summary')).toContainText('已创建新文件');
    const saved = (await snapshot(copy)).snapshot; receipt = saved.copyState; written = await fs.readFile(target);
    expect(written.equals(Buffer.from('\ufeff' + beforeCreate.source))).toBe(true);
    expect(require('node:crypto').createHash('sha256').update(written).digest('hex')).toBe(receipt.sha256);
    for (const key of ['source', 'revision', 'dirty', 'canUndo', 'canRedo']) expect(saved[key]).toBe(beforeCreate[key]);
    fixture.recordFile('pasted.md', written);
    await select('#editor p:first-of-type', 0); await page.keyboard.type('Later '); await settled();
    await expect(page.locator('#test-copy-summary')).toContainText('后续修改尚未导出');
    const last = await page.locator('#test-copy-result').textContent();
    await create(); await expect(page.locator('#test-copy-operation')).toContainText('同名目标已存在');
    await expect(page.locator('#test-copy-result')).toHaveText(last);
    await app.evaluate(() => { globalThis.pasteSaveCancel = true; });
    await create(); await expect(page.locator('#test-copy-operation')).toContainText('操作已取消');
    await app.evaluate((_, filePath) => { globalThis.pasteSaveCancel = false; globalThis.pasteSaveTarget = filePath; }, path.join(root, 'not-supported.md'));
    await create(); await expect(page.locator('#test-copy-operation')).toContainText('未创建文件');
    await expect(page.locator('#test-copy-operation')).toContainText('unsupported-copy-directory');
    await expect(page.locator('#test-copy-result')).toHaveText(last);
    expect((await fs.readFile(target)).equals(written)).toBe(true); expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    expect((await fs.readdir(root)).includes('not-supported.md')).toBe(false);
    await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    await page.screenshot({ path: info.outputPath('paste-save-feedback.png') });
  }, info, null, true, true, true);
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
    await page.keyboard.press('Meta+o'); await expect(page.locator('#document-name')).toHaveText('pasted.md');
    const id = JSON.parse(await page.locator('#status').textContent()).activeSessionId, reopened = (await snapshot(id)).snapshot;
    expect(reopened.readOnly).toBe(true); expect(reopened.bom).toBe(true); expect(reopened.source).toBe(written.toString().slice(1));
    expect(require('node:crypto').createHash('sha256').update(await fs.readFile(target)).digest('hex')).toBe(receipt.sha256);
    expect((await fs.readFile(originalFile)).equals(originalBytes)).toBe(true);
  }, info, null, true);
  const cleanup = fixture.cleanup({ passed: true, quiescent: true }); expect(cleanup.state, JSON.stringify(cleanup)).toBe('removed');
  console.log('home-fixture-cleanup:' + JSON.stringify(cleanup));
});

test('paste V1 native Edit menu provides the Paste role', async ({}, info) => usingDemo(async ({ app }) => {
  const roles = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === '编辑').submenu.items.map(i => i.role));
  expect(roles).toContain('paste');
}, info, null, true));


test('multiline paste V1 writes paragraphs atomically and reopens a faithful new file', async ({}, info) => {
  let fixture, target, savedBytes, receipt, originalFile, originalBytes;
  await usingDemo(async ({ app, page, snapshot, select, settled, root }) => {
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    try {
    originalFile = path.join(root, 'multiline-original.md');
    originalBytes = Buffer.from('\ufeff---\r\nx: keep\r\n---\r\n\r\nBefore OLD after.\r\n\r\nTail.\r\n\r\n```js\r\nopaque()\r\n```');
    await fs.writeFile(originalFile, originalBytes, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, originalFile);
    await page.keyboard.press('Meta+o'); await expect(page.locator('#document-name')).toHaveText('multiline-original.md');
    const original = JSON.parse(await page.locator('#status').textContent()).activeSessionId;
    await page.locator('#edit-copy').click(); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    const copy = JSON.parse(await page.locator('#status').textContent()).activeSessionId;
    const paste = text => page.locator('#editor .tiptap').evaluate((node, value) => {
      const data = new DataTransfer(); data.setData('text/plain', value); data.setData('text/html', '<script>BAD</script>');
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, text);
    await select('#editor p:first-of-type', 7, 10); await paste('第一😀\r\n\r\nSecond\n第三'); await settled();
    const source = originalBytes.toString().slice(1), pasted = source.replace('OLD', '第一😀\r\n\r\nSecond\r\n\r\n第三');
    expect((await snapshot(copy)).snapshot.source).toBe(pasted);
    await expect(page.locator('#editor p')).toHaveText(['Before 第一😀', 'Second', '第三 after.', 'Tail.']);
    expect(await page.evaluate(() => window.getSelection().anchorOffset)).toBe(2);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(copy)).snapshot.source).toBe(source);
    await page.keyboard.press('Meta+Shift+z'); await settled(); expect((await snapshot(copy)).snapshot.source).toBe(pasted);
    const beforeRefusal = (await snapshot(copy)).snapshot;
    await paste('One\n\n\nTwo'); await expect(page.locator('#viewer-status')).toContainText('没有截断内容');
    expect((await snapshot(copy)).snapshot).toEqual(beforeRefusal);
    await select('#editor p:last-of-type', 5); await page.keyboard.press('Enter'); await page.keyboard.type('Next.'); await settled();
    const splitSource = pasted.replace('Tail.', 'Tail.\r\n\r\nNext.'), finalSource = pasted.replace('Tail.', 'Tail.Next.');
    expect((await snapshot(copy)).snapshot.source).toBe(splitSource);
    // Deterministically reproduce the observed gap in one event-loop turn.
    const gap = await page.locator('#editor .tiptap').evaluate(node => {
      const paragraph = node.querySelector('p:last-of-type'), s = window.getSelection(), range = document.createRange();
      range.setStart(paragraph.firstChild, 0); range.collapse(true); s.removeAllRanges(); s.addRange(range);
      const before = { dom: s.anchorOffset, pm: node.editor.state.selection.$from.parentOffset };
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }));
      return before;
    });
    expect(gap).toEqual({ dom: 0, pm: 5 }); await settled();
    expect((await snapshot(copy)).snapshot.source).toBe(finalSource);
    await page.keyboard.press('Meta+z');
    await expect.poll(async () => (await snapshot(copy)).snapshot.source).toBe(splitSource);
    await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).historyPending).toBe(false);
    await page.keyboard.press('Meta+Shift+z');
    await expect.poll(async () => (await snapshot(copy)).snapshot.source).toBe(finalSource);
    await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).historyPending).toBe(false);
    await page.keyboard.press('Meta+z');
    await expect.poll(async () => (await snapshot(copy)).snapshot.source).toBe(splitSource);
    await expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).historyPending).toBe(false);
    await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Meta+ArrowLeft');
    await page.keyboard.press('Backspace'); await settled();
    expect((await snapshot(copy)).snapshot.source).toBe(finalSource);
    expect(await page.locator('#editor .tiptap').evaluate(node => node.editor.state.selection.$from.parentOffset)).toBe(5);
    await selectDocument(page, original); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    const denied = await page.evaluate(id => window.documentDemo.edit({ sessionId: id, expectedRevision: 0, from: 1, to: 1, insert: 'NO\n\nWRITE' }), original);
    expect(denied.code).toBe('read-only-document'); expect((await snapshot(original)).snapshot.source).toBe(source);
    await selectDocument(page, copy); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect((await snapshot(copy)).snapshot.source).toBe(finalSource);
    fixture = createHomeFixture('Writing-synthetic-E2E-'); target = path.join(fixture.dir, 'multiline.md');
    console.log('home-fixture-created:' + fixture.dir);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showMessageBox = async () => ({ response: 1 }); dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, target);
    const beforeSave = (await snapshot(copy)).snapshot;
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#test-copy-summary')).toContainText('已创建新文件');
    const saved = (await snapshot(copy)).snapshot; receipt = saved.copyState; savedBytes = await fs.readFile(target);
    expect(savedBytes.equals(Buffer.from('\ufeff' + finalSource))).toBe(true);
    expect(require('node:crypto').createHash('sha256').update(savedBytes).digest('hex')).toBe(receipt.sha256);
    for (const key of ['source', 'revision', 'dirty', 'canUndo', 'canRedo']) expect(saved[key]).toBe(beforeSave[key]);
    fixture.recordFile('multiline.md', savedBytes);
    await select('#editor p:first-of-type', 0); await page.keyboard.type('Later '); await settled();
    await expect(page.locator('#test-copy-summary')).toContainText('后续修改尚未导出');
    const beforeCancel = (await snapshot(copy)).snapshot.source;
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#test-copy-operation')).toContainText('操作已取消');
    expect((await snapshot(copy)).snapshot.source).toBe(beforeCancel);
    expect((await fs.readFile(target)).equals(savedBytes)).toBe(true); expect((await fs.readFile(originalFile)).equals(originalBytes)).toBe(true);
    await page.screenshot({ path: info.outputPath('multiline-paste.png') });
    } catch (error) {
      await info.attach('multiline-functional-error', { body: String(error.stack || error), contentType: 'text/plain' });
      await page.screenshot({ path: info.outputPath('multiline-failure.png') });
      throw error;
    }
  }, info, null, true, true, true);
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
    await page.keyboard.press('Meta+o'); await expect(page.locator('#document-name')).toHaveText('multiline.md');
    const id = JSON.parse(await page.locator('#status').textContent()).activeSessionId, reopened = (await snapshot(id)).snapshot;
    expect(reopened.readOnly).toBe(true); expect(reopened.bom).toBe(true); expect(reopened.source).toBe(savedBytes.toString().slice(1));
    expect(require('node:crypto').createHash('sha256').update(await fs.readFile(target)).digest('hex')).toBe(receipt.sha256);
    expect((await fs.readFile(originalFile)).equals(originalBytes)).toBe(true);
  }, info, null, true);
  const cleanup = fixture.cleanup({ passed: true, quiescent: true }); expect(cleanup.state, JSON.stringify(cleanup)).toBe('removed');
  console.log('home-fixture-cleanup:' + JSON.stringify(cleanup));
});

test('local drafts V1 restores two confirmed documents after direct process exit and exports a fresh file', async ({}, info) => {
  const os = require('node:os'), hash = b => require('node:crypto').createHash('sha256').update(b).digest('hex');
  const area = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-drafts-e2e-'))), draftRoot = path.join(area, 'drafts');
  const originalPath = path.join(area, 'original.md'), raw = '\ufeffFirst 中文😀\r\n\r\nSecond.\r\n\r\n```js\r\nopaque();\r\n```\r\n';
  await fs.writeFile(originalPath, raw, { flag: 'wx', mode: 0o600 });
  let expected, originalSession, saved, exported, target, ownedFixture;
  const secondText = 'Independent second draft 中文😀';
  await usingDemo(async ({ app, page, snapshot, select, settled }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, originalPath);
    await page.locator('#open-file').click(); await expect(page.locator('#document-name')).toHaveText('original.md');
    originalSession = await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await page.locator('#edit-copy').click(); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    const id = await page.locator('#documents').inputValue();
    await select('#editor p:first-of-type', 'First 中文😀'.length); await page.keyboard.insertText(' accepted 编辑'); await settled();
    expected = (await snapshot(id)).snapshot;
    await expect(page.locator('#draft-backup-status')).toContainText(`本地草稿已备份（修订 ${expected.revision}）`);
    expect(expected.source).toBe(raw.slice(1).replace('First 中文😀', 'First 中文😀 accepted 编辑'));
    for (const op of ['edit', 'save']) expect((await page.evaluate(({ op, id }) => window.documentDemo[op]({ sessionId: id, expectedRevision: 0 }), { op, id: originalSession })).code).toBe('read-only-document');
    await page.locator('#new-temporary').click(); await page.locator('#editor p').click(); await page.keyboard.insertText(secondText); await settled();
    await expect(page.locator('#draft-backup-status')).toContainText('本地草稿已备份');
    expect((await page.evaluate(() => window.documentDemo.listDrafts())).drafts.length).toBe(2);
    expect((await snapshot(id)).snapshot.source).toBe(expected.source);
    expect(hash(await fs.readFile(originalPath))).toBe(hash(raw));
    await page.screenshot({ path: info.outputPath('drafts-before-direct-exit.png') });
  }, info, null, true, false, false, null, { root: draftRoot, directExit: true });
  // Only after the first process has exited: a new independent Electron instance.
  await usingDemo(async ({ app, page, snapshot, select, settled }) => {
    await page.locator('#show-drafts').click();
    await expect(page.locator('#draft-recovery-list > p')).toHaveCount(2);
    const firstRow = page.locator('#draft-recovery-list > p').filter({ hasText: 'original.md' });
    await firstRow.getByRole('button', { name: '恢复副本' }).click();
    await expect(page.locator('#document-name')).toContainText('恢复：');
    const firstId = await page.locator('#documents').inputValue(), recovered = (await snapshot(firstId)).snapshot;
    expect(recovered.source).toBe(expected.source); expect(recovered.bom).toBe(true); expect(recovered.revision).toBe(0);
    expect(recovered.canUndo).toBe(false); expect(recovered.canRedo).toBe(false); expect(recovered.temporary).toBe(true);
    expect(firstId).not.toBe(originalSession); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    await expect(page.locator('#draft-backup-status')).toContainText('本地草稿已备份（修订 0）');
    await page.locator('#show-drafts').click();
    await page.locator('#draft-recovery-list > p').filter({ hasText: 'Temporary' }).getByRole('button', { name: '恢复副本' }).click();
    const secondId = await page.locator('#documents').inputValue(); expect((await snapshot(secondId)).snapshot.source).toBe(secondText);
    await selectDocument(page, firstId); await select('#editor p:first-of-type', 0);
    await page.keyboard.insertText('CONTINUED '); await settled();
    const continued = (await snapshot(firstId)).snapshot.source;
    expect(continued).toBe('CONTINUED ' + expected.source); expect((await snapshot(firstId)).snapshot.canUndo).toBe(true);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(firstId)).snapshot.source).toBe(expected.source);
    await page.keyboard.press('Meta+Shift+z'); await settled(); expect((await snapshot(firstId)).snapshot.source).toBe(continued);
    ownedFixture = createHomeFixture('Writing-synthetic-E2E-'); target = path.join(ownedFixture.dir, 'recovered-new.md');
    console.log('draft-export-fixture:' + ownedFixture.dir);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showMessageBox = async () => ({ response: 1 }); dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, target);
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#test-copy-operation')).toContainText('本次已创建新文件');
    saved = (await snapshot(firstId)).snapshot.copyState; exported = await fs.readFile(target);
    expect(exported.equals(Buffer.from('\ufeff' + continued))).toBe(true); expect(hash(exported)).toBe(saved.sha256);
    ownedFixture.recordFile('recovered-new.md', exported);
    // Continue at the caret returned by Redo/export; do not race a synthetic DOM selectionchange.
    await page.keyboard.insertText('LATER '); await settled();
    expect((await snapshot(firstId)).snapshot.source).toBe('CONTINUED LATER ' + expected.source);
    await expect(page.locator('#draft-backup-status')).toContainText('本地草稿已备份');
    await expect(page.locator('#test-copy-summary')).toContainText('后续修改尚未导出');
    await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect((await fs.readFile(target)).equals(exported)).toBe(true); expect(hash(await fs.readFile(originalPath))).toBe(hash(raw));
    await page.screenshot({ path: info.outputPath('draft-restored-and-exported.png') });
  }, info, null, true, true, true, null, { root: draftRoot });
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
    await page.locator('#open-file').click(); await expect(page.locator('#document-name')).toHaveText('recovered-new.md');
    const reopened = (await snapshot(await page.locator('#documents').inputValue())).snapshot;
    expect(reopened.readOnly).toBe(true); expect(reopened.source).toBe(exported.toString().slice(1)); expect(reopened.bom).toBe(true);
    expect(hash(await fs.readFile(target))).toBe(saved.sha256); expect(hash(await fs.readFile(originalPath))).toBe(hash(raw));
    const integrity = info.outputPath('drafts-integrity.json');
    await fs.writeFile(integrity, JSON.stringify({ originalSha256: hash(raw), originalUnchanged: true, exportedSha256: saved.sha256, exportedBytes: exported.length, draftRoot, nativeIme: 'NOT VERIFIED', dialog: 'stubbed selection', hiddenWindow: true }, null, 2), { flag: 'wx', mode: 0o600 });
    await info.attach('drafts-integrity', { path: integrity, contentType: 'application/json' });
  }, info, null, true, false, false, null, { root: draftRoot });
  const cleanup = ownedFixture.cleanup({ passed: true, quiescent: true });
  console.log('home-fixture-cleanup:' + JSON.stringify(cleanup)); expect(cleanup.state, JSON.stringify(cleanup)).toBe('removed');
});

test('local drafts V1 shows corrupted-newest fallback and honest backup failure without losing editing', async ({}, info) => {
  const os = require('node:os'), { createDraftStore } = require('../lib/document-draft-store');
  const area = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-drafts-errors-e2e-'))), draftRoot = path.join(area, 'drafts');
  const store = createDraftStore(draftRoot), id = store.newId();
  expect(store.save({ id, label: 'Corrupt synthetic', revision: 9, bytes: Buffer.from('Recover this confirmed content.') }).ok).toBe(true);
  const partial = path.join(draftRoot, id + '.2.json'); await fs.writeFile(partial, '{partial', { flag: 'wx', mode: 0o600 });
  await usingDemo(async ({ page, snapshot, select, settled }) => {
    await page.locator('#show-drafts').click();
    await expect(page.locator('#draft-recovery-list')).toContainText('较新记录损坏');
    await page.getByRole('button', { name: '恢复副本', exact: true }).click();
    await expect(page.locator('#viewer-status')).toContainText('已恢复较早的可验证草稿');
    const restoredId = await page.locator('#documents').inputValue();
    expect((await snapshot(restoredId)).snapshot.source).toBe('Recover this confirmed content.');
    await expect(page.locator('#draft-backup-status')).toContainText('本地草稿已备份（修订 0）');
    // Change only this test-owned directory; app must not ignore its protection failure.
    await fs.chmod(draftRoot, 0o750);
    await select('#editor p', 0); await page.keyboard.type('KEEP '); await settled();
    await expect(page.locator('#draft-backup-status')).toContainText('草稿备份未确认');
    await expect(page.locator('#draft-backup-status')).toContainText('最后已备份修订 0');
    expect((await snapshot(restoredId)).snapshot.source).toBe('KEEP Recover this confirmed content.');
    await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect(await fs.readFile(partial, 'utf8')).toBe('{partial');
    await page.screenshot({ path: info.outputPath('draft-backup-failure-retains-content.png') });
  }, info, null, true, false, false, null, { root: draftRoot });
});


test('draft management V1 confirms reversible archive, survives restart and protects active writing', async ({}, info) => {
  const os = require('node:os'), { createDraftStore } = require('../lib/document-draft-store');
  const area = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-draft-management-e2e-'))), draftRoot = path.join(area, 'drafts');
  const store = createDraftStore(draftRoot), originalPath = path.join(area, 'original.md'), raw = '\ufeffFirst paragraph.\r\n\r\nSecond paragraph.\r\n';
  await fs.writeFile(originalPath, raw, { flag: 'wx', mode: 0o600 });
  const first = store.save({ id: store.newId(), label: 'Same synthetic name', revision: 7, bytes: Buffer.from(raw) });
  const second = store.save({ id: store.newId(), label: 'Same synthetic name', revision: 3, bytes: Buffer.from('Other independent draft.') });
  const corrupt = store.save({ id: store.newId(), label: 'Partial synthetic', revision: 1, bytes: Buffer.from('Older content.') });
  const partial = path.join(draftRoot, corrupt.id + '.2.json'); await fs.writeFile(partial, '{partial', { flag: 'wx', mode: 0o600 });
  expect(first.ok && second.ok && corrupt.ok).toBe(true);
  await usingDemo(async ({ app, page }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, originalPath);
    await page.locator('#open-file').click(); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await page.locator('#show-drafts').click();
    await expect(page.locator('#draft-recovery-status')).toContainText('待恢复 3 / 32');
    const row = page.locator(`[data-draft-id="${first.id}"]`);
    await expect(row).toContainText(first.id.slice(0, 8)); await expect(row).toContainText('修订 7');
    await expect(page.locator(`[data-draft-id="${corrupt.id}"]`).getByRole('button', { name: '归档', exact: true })).toBeDisabled();
    const before = await fs.readdir(draftRoot);
    await row.getByRole('button', { name: '归档', exact: true }).click(); await page.locator('#cancel-draft-management').click();
    await expect(page.locator('#draft-management-confirmation')).toBeHidden(); expect(await fs.readdir(draftRoot)).toEqual(before);
    await row.getByRole('button', { name: '归档', exact: true }).click(); await page.locator('#confirm-draft-management').click();
    await expect(page.locator('#draft-operation-status')).toContainText('已归档');
    await expect(page.locator('#draft-recovery-status')).toContainText('待恢复 2 / 32');
    await page.locator('#draft-archive-panel > summary').click();
    await expect(page.locator(`#draft-archive-list [data-draft-id="${first.id}"]`)).toContainText('修订 7');
    expect((await fs.readFile(originalPath)).equals(Buffer.from(raw))).toBe(true);
    await captureTestWindow(app, info.outputPath('draft-management-archived.png'));
  }, info, null, true, false, false, null, { root: draftRoot, directExit: true });
  await usingDemo(async ({ app, page, snapshot, select, settled }) => {
    await page.locator('#show-drafts').click(); await page.locator('#draft-archive-panel > summary').click();
    await page.locator(`#draft-archive-list [data-draft-id="${first.id}"]`).getByRole('button', { name: '放回待恢复列表' }).click();
    await page.locator('#confirm-draft-management').click(); await expect(page.locator('#draft-operation-status')).toContainText('已放回');
    await page.locator(`#draft-recovery-list [data-draft-id="${first.id}"]`).getByRole('button', { name: '恢复副本' }).click();
    const id = await page.locator('#documents').inputValue(), restored = (await snapshot(id)).snapshot;
    expect(restored.source).toBe(raw.slice(1)); expect(restored.bom).toBe(true); expect(restored.revision).toBe(0);
    await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    await page.locator('#show-drafts').click();
    await expect(page.locator(`#draft-recovery-list [data-draft-id="${first.id}"]`).getByRole('button', { name: '归档', exact: true })).toBeDisabled();
    await page.locator('#close-draft-dialog').click();
    await select('#editor p:first-of-type', 0); await page.keyboard.type('EDIT '); await settled();
    await expect(page.locator('#draft-backup-status')).toContainText('本地草稿已备份');
    const before = (await snapshot(id)).snapshot; expect(before.source).toBe('EDIT ' + raw.slice(1)); expect(before.canUndo).toBe(true);
    await page.locator('#show-drafts').click();
    await page.locator(`[data-draft-id="${second.id}"]`).getByRole('button', { name: '归档', exact: true }).click();
    await fs.chmod(draftRoot, 0o750); await page.locator('#confirm-draft-management').click();
    await expect(page.locator('#draft-operation-status')).toContainText('草稿整理未确认');
    expect((await snapshot(id)).snapshot.source).toBe(before.source); expect((await snapshot(id)).snapshot.canUndo).toBe(true);
    await fs.chmod(draftRoot, 0o700); await page.locator('#refresh-drafts').click();
    await expect(page.locator('#draft-operation-status')).toContainText('草稿整理未确认');
    await expect(page.locator(`[data-draft-id="${second.id}"]`)).toBeVisible();
    expect(await fs.readFile(partial, 'utf8')).toBe('{partial'); expect((await fs.readFile(originalPath)).equals(Buffer.from(raw))).toBe(true);
    await captureTestWindow(app, info.outputPath('draft-management-returned-failure-retained.png'));
    console.log('draft-management-evidence:' + JSON.stringify({ area, originalUnchanged: true, originalSha256: require('node:crypto').createHash('sha256').update(raw).digest('hex'), archiveReopenExact: true, partialRetained: true, nativeIme: 'NOT VERIFIED' }));
  }, info, null, true, false, false, null, { root: draftRoot });
});


test('writing UI V2 panels, composition gate, copy feedback and document switching', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'writing-ui-flow-')));
  let ownedFixture, target, exported;
  await usingDemo(async ({ app, page, root, snapshot, select, settled }) => {
    const original = path.join(root, '写作练习.md');
    const raw = '# 把文字放在中央\n\n这是第一段普通文字。在安静的页面里，专注于正在写下的内容。\n\n第二段文字，也可以继续编辑。\n\n```js\nprotected();\n```\n';
    await fs.writeFile(original, raw, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.original] });
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => { globalThis.uiSaveCalls = (globalThis.uiSaveCalls || 0) + 1; return { canceled: false, filePath: paths.target }; };
    }, { original });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 820));
    await page.locator('#show-drafts').click(); await expect(page.locator('#draft-empty')).toBeVisible();
    await captureTestWindow(app, info.outputPath('panels-empty-drafts.png')); await page.keyboard.press('Escape');
    await page.locator('#open-file').click(); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    await page.locator('#show-details').click();
    await expect(page.locator('#details-document-name')).toHaveText('写作练习.md');
    await expect(page.locator('#details-document-kind')).toHaveText('原文件 · 只读');
    await expect(page.locator('#details-backup-card')).toBeHidden();
    await captureTestWindow(app, info.outputPath('panels-original-details.png')); await page.keyboard.press('Escape');
    const sourceId = await page.locator('#documents').inputValue();
    await page.locator('#edit-copy').click(); await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    const copyId = await page.locator('#documents').inputValue();
    await expect(page.locator('#draft-recovery-panel')).toBeHidden(); await expect(page.locator('#temporary-notice')).toBeHidden();
    expect(await page.locator('#editor').evaluate(n => n.getBoundingClientRect().top)).toBeLessThan(160);
    await expect(page.locator('#backup-summary')).toContainText('已备份');
    await captureTestWindow(app, info.outputPath('writing-v2-editor.png'));
    await page.locator('#show-drafts').click(); await expect(page.locator('#draft-dialog')).toBeVisible();
    await expect(page.locator('#close-draft-dialog')).toBeFocused();
    await expect(page.locator('#draft-recovery-list > p')).toHaveCount(1);
    await captureTestWindow(app, info.outputPath('writing-v2-drafts.png'));
    await page.keyboard.press('Escape'); await expect(page.locator('#draft-dialog')).toBeHidden();
    await expect(page.locator('#show-drafts')).toBeFocused();
    await page.locator('#show-details').click(); await expect(page.locator('#temporary-notice')).toBeHidden();
    await expect(page.locator('#details-document-kind')).toHaveText('独立草稿 · 未存为文件');
    await expect(page.locator('#copy-empty')).toBeVisible();
    await page.locator('#details-writing-help > summary').click(); await expect(page.locator('#temporary-notice')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#document-details-dialog')).toBeHidden();
    await select('#editor p:first-of-type', 0); await page.keyboard.type('X'); await settled();
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(copyId)).snapshot.source).toBe(raw);
    await page.keyboard.press('Meta+Shift+z'); await settled();
    const edited = (await snapshot(copyId)).snapshot;
    await selectDocument(page, sourceId); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await selectDocument(page, copyId); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    expect((await snapshot(copyId)).snapshot.source).toBe(edited.source); expect((await snapshot(copyId)).snapshot.canUndo).toBe(true);
    // Controlled composition tests UI gating only; not native macOS IME acceptance.
    await page.locator('#editor .tiptap').dispatchEvent('compositionstart', { data: '' });
    await expect(page.locator('#show-drafts')).toBeDisabled(); await expect(page.locator('#show-details')).toBeDisabled();
    await expect(page.locator('#create-test-copy')).toBeDisabled();
    await page.locator('#editor .tiptap').dispatchEvent('compositionend', { data: '' }); await settled();
    await expect(page.locator('#show-drafts')).toBeEnabled();
    await page.locator('#create-test-copy').click(); await expect(page.locator('#copy-confirm-dialog')).toBeVisible();
    await captureTestWindow(app, info.outputPath('panels-save-confirmation.png'));
    await page.keyboard.press('Escape'); await expect(page.locator('#copy-confirm-dialog')).toBeHidden();
    expect(await app.evaluate(() => globalThis.uiSaveCalls || 0)).toBe(0);
    expect((await snapshot(copyId)).snapshot.source).toBe(edited.source);
    ownedFixture = createHomeFixture('Writing-synthetic-E2E-'); target = path.join(ownedFixture.dir, 'writing-ui.md');
    console.log('writing-ui-export-fixture:' + target);
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#copy-summary-compact')).toBeVisible(); await expect(page.locator('#copy-summary-compact')).toContainText('当前内容已导出');
    await expect(page.locator('#copy-confirm-dialog')).toBeHidden(); await expect(page.locator('#editor .tiptap')).toBeFocused();
    exported = await fs.readFile(target); expect(exported.toString()).toBe(edited.source); ownedFixture.recordFile('writing-ui.md', exported);
    const receipt = (await snapshot(copyId)).snapshot.copyState;
    expect(require('node:crypto').createHash('sha256').update(exported).digest('hex')).toBe(receipt.sha256);
    await select('#editor p:nth-of-type(2)', 0); await page.keyboard.type('LATER '); await settled();
    await expect(page.locator('#copy-summary-compact')).toContainText('后续修改尚未导出');
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#copy-operation-alert')).toBeVisible(); await expect(page.locator('#copy-operation-alert')).toContainText('同名目标已存在');
    await expect(page.locator('#copy-summary-compact')).toContainText('writing-ui.md');
    expect((await fs.readFile(target)).equals(exported)).toBe(true); expect(await fs.readFile(original, 'utf8')).toBe(raw);
    await captureTestWindow(app, info.outputPath('writing-v2-export-failure-preserves-receipt.png'));
    await page.locator('#show-reading-settings').click(); await page.locator('#reading-theme-dark').click();
    await page.locator('#close-reading-settings').click();
    await page.locator('#show-details').click(); await expect(page.locator('#test-copy-summary')).toContainText(target);
    await expect(page.locator('#confirmed-copy-card')).toBeVisible();
    await expect(page.locator('#latest-copy-card')).toHaveAttribute('data-tone','error');
    await expect(page.locator('#latest-copy-card')).toContainText('target-exists');
    await page.locator('#test-copy-receipt > summary').click(); await expect(page.locator('#test-copy-result')).toContainText(receipt.sha256);
    await captureTestWindow(app, info.outputPath('writing-v2-details.png'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(390,800));
    await captureTestWindow(app, info.outputPath('panels-details-dark-narrow.png'));
    expect(await page.locator('#document-details-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await page.locator('#toggle-session-sidebar').click(); await page.locator('#show-drafts').click();
    await expect(page.locator('#draft-recovery-list .state-pill').first()).toHaveText('正在使用');
    await captureTestWindow(app, info.outputPath('panels-drafts-dark-narrow.png'));
    expect(await page.locator('#draft-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200,820));
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
    await page.locator('#open-file').click(); await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    expect((await snapshot(await page.locator('#documents').inputValue())).snapshot.source).toBe(exported.toString());
    await expect(page.locator('#copy-operation-alert')).toBeHidden(); await expect(page.locator('#copy-summary-compact')).toBeHidden();
    expect(await fs.readFile(original, 'utf8')).toBe(raw);
    console.log('writing-ui-evidence:' + JSON.stringify({ originalUnchanged: true, exportedSha256: receipt.sha256, nativeIme: 'NOT VERIFIED', dialog: 'stubbed selection', windowMode: 'hidden except inactive screenshot capture', area }));
  }, info, null, true, true, true, null, { root: path.join(area, 'drafts') });
  const cleanup = ownedFixture.cleanup({ passed: true, quiescent: true });
  console.log('home-fixture-cleanup:' + JSON.stringify(cleanup)); expect(cleanup.state, JSON.stringify(cleanup)).toBe('removed');
});

test('writing V3 quiet composition and safe formatting export reopen', async ({}, info) => {
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'writing-v3-')));
  const draftRoot=path.join(area,'drafts'),original=path.join(area,'original.md');
  const raw='\ufeff---\r\nkeep: synthetic\r\n---\r\n\r\n第一段中文。\r\n\r\nSecond paragraph.\r\n\r\n```md metadata\r\nuntouched [syntax]\r\n```\r\n';
  const bytes=Buffer.from(raw),hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
  await fs.writeFile(original,bytes,{flag:'wx',mode:0o600});let fixture,target,exported;
  await usingDemo(async({app,page,snapshot,select,settled})=>{
    await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},original);
    await page.locator('#open-file').click();await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    const originalId=await page.locator('#documents').inputValue();await expect(page.locator('#format-toolbar')).toBeHidden();
    const refusal=await page.evaluate(sessionId=>window.documentDemo.format({sessionId,expectedRevision:0,action:'heading-1',from:1,to:1}),originalId);expect(refusal.code).toBe('read-only-document');
    await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue();
    await expect(page.locator('#format-toolbar')).toBeVisible();await expect(page.locator('#document-name')).toContainText('编辑副本');
    await expect(page.locator('#backup-summary')).toHaveText('已备份');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
    await page.evaluate(()=>{window.v3Trace=[];for(const type of ['compositionstart','compositionend'])document.addEventListener(type,()=>window.v3Trace.push({type}),true);});
    await select('#editor p:first-of-type',6);const top=await page.locator('#editor').evaluate(n=>n.getBoundingClientRect().top);
    const cdp=await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.imeSetComposition',{text:'wo',selectionStart:2,selectionEnd:2});
      await expect(page.locator('#backup-summary')).toHaveText('输入中…');
      await expect(page.locator('#composition-status')).toBeHidden();await expect(page.locator('#copy-operation-alert')).toBeHidden();
      await expect(page.locator('#create-test-copy')).toBeDisabled();await expect(page.locator('#format-block')).toBeDisabled();
      expect(await page.locator('#editor').evaluate(n=>n.getBoundingClientRect().top)).toBe(top);
      await captureTestWindow(app,info.outputPath('quiet-composition.png'));
      await cdp.send('Input.insertText',{text:'我'});await settled();
      console.log('v3-composition-state:'+await page.evaluate(()=>JSON.stringify({events:window.v3Trace,state:JSON.parse(document.querySelector('#status').textContent)})));
      await expect(page.locator('#create-test-copy')).toBeEnabled();await expect(page.locator('#format-block')).toBeEnabled();
      expect((await snapshot(id)).snapshot.source).toContain('第一段中文。我');
    } finally {await cdp.detach();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());}
    await page.keyboard.press('Meta+z');await settled();expect((await snapshot(id)).snapshot.source).toBe(raw.slice(1));
    await select('#editor p:first-of-type',0);await page.locator('#format-block').selectOption('heading-2');await settled();
    await expect(page.locator('#editor h2')).toHaveText('第一段中文。');
    await page.locator('#format-undo').click();await settled();await expect(page.locator('#editor h2')).toHaveCount(0);
    await page.locator('#format-redo').click();await settled();await expect(page.locator('#editor h2')).toHaveCount(1);
    await select('#editor h2',6);await page.keyboard.press('Enter');await settled();await page.keyboard.type('New body');await settled();
    await expect(page.locator('#editor > .tiptap > p').first()).toHaveText('New body');
    await select('#editor > .tiptap > p:first-of-type',0,3);await page.locator('#format-bold').click();await settled();
    await expect(page.locator('#editor strong')).toHaveText('New');
    // Remove the whole selected mark with the same keyboard command; original bytes return.
    await page.keyboard.press('Meta+b');await settled();await expect(page.locator('#editor strong')).toHaveCount(0);
    await select('#editor > .tiptap > p:first-of-type',0);await page.locator('#format-block').selectOption('bullet-list');await settled();
    await expect(page.locator('#editor ul li p')).toHaveText('New body');
    await select('#editor ul li p',8);await page.keyboard.press('Enter');await settled();await page.keyboard.type('Next item');await settled();
    await expect(page.locator('#editor ul li')).toHaveCount(2);
    await page.keyboard.press('Enter');await settled();await expect(page.locator('#editor ul li')).toHaveCount(3);
    await page.keyboard.press('Enter');await settled();await expect(page.locator('#editor ul li')).toHaveCount(2);
    await page.keyboard.type('After list');await settled();
    await select('#editor ul li:first-child p',0);await page.locator('#format-block').selectOption('ordered-list');await settled();
    await expect(page.locator('#editor ol li')).toHaveCount(2);
    const beforeUnsupported=(await snapshot(id)).snapshot;
    await page.locator('#editor pre').last().click();await page.keyboard.type('MUST NOT MODIFY');await settled();
    expect((await snapshot(id)).snapshot.source).toBe(beforeUnsupported.source);expect((await snapshot(id)).snapshot.revision).toBe(beforeUnsupported.revision);
    await selectDocument(page,originalId);await expect(page.locator('#format-toolbar')).toBeHidden();
    await selectDocument(page,id);expect((await snapshot(id)).snapshot.source).toBe(beforeUnsupported.source);
    await captureTestWindow(app,info.outputPath('formatted-writing.png'));
    fixture=createHomeFixture('Writing-synthetic-E2E-');target=path.join(fixture.dir,'formatted.md');
    await app.evaluate(({dialog},filePath)=>{dialog.showMessageBox=async()=>({response:1});dialog.showSaveDialog=async()=>({canceled:false,filePath});},target);
    await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#copy-summary-compact')).toContainText('当前内容已导出');
    exported=await fs.readFile(target);expect(exported.equals(Buffer.from('\ufeff'+beforeUnsupported.source))).toBe(true);
    fixture.recordFile('formatted.md',exported);const after=(await snapshot(id)).snapshot;
    expect(after.copyState.sha256).toBe(hash(exported));expect(after.canUndo).toBe(true);expect(after.dirty).toBe(true);
    expect((await fs.readFile(original)).equals(bytes)).toBe(true);
    console.log('writing-v3-evidence:'+JSON.stringify({originalSha256:hash(bytes),exportedSha256:hash(exported),nativeIme:'NOT VERIFIED',composition:'CDP browser IME',layoutStable:true,source:original,target}));
  },info,null,true,true,true,null,{root:draftRoot});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},target);
    await page.locator('#open-file').click();await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    const s=(await snapshot(await page.locator('#documents').inputValue())).snapshot;
    expect(Buffer.from('\ufeff'+s.source).equals(exported)).toBe(true);await expect(page.locator('#editor h2')).toHaveText('第一段中文。');await expect(page.locator('#editor ol li')).toHaveCount(2);
    expect((await fs.readFile(original)).equals(bytes)).toBe(true);
  },info,null,true,false,false,null,{root:draftRoot});
  const cleanup=fixture.cleanup({passed:true,quiescent:true});console.log('home-fixture-cleanup:'+JSON.stringify(cleanup));expect(cleanup.state).toBe('removed');
});


test('approved shell V1 real sidebar keeps identity through switching, composition and failed IPC', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'approved-shell-')));
  await usingDemo(async ({app,page,root,snapshot,select,settled}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    const original = path.join(root, '日常写作.md');
    const raw = '# 让文字，回到中心\n\n第一段中文，保留原始文字。\n\n## 一个安静的开始\n\nSecond paragraph for writing.\n\n```md\nprotected [syntax]\n```\n';
    await fs.writeFile(original, raw, {flag:'wx', mode:0o600});
    await app.evaluate(({dialog},filePath) => {dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});}, original);
    await expect(page.locator('#writing-app')).toBeVisible();
    await expect(page.locator('#session-list button')).toHaveCount(0);
    await page.locator('#empty-open').click(); const sourceId=await page.locator('#documents').inputValue();
    await expect(page.locator('#session-list button')).toHaveCount(1);
    await page.locator('#edit-copy').click(); const copyId=await page.locator('#documents').inputValue();
    const row = id => page.locator('#session-list button').filter({has:page.locator('strong')}).and(page.locator(`[data-session-id="${id}"]`));
    await expect(row(copyId)).toHaveAttribute('aria-current','true');
    await expect(page.locator('#session-count')).toHaveText('2');
    await select('#editor p:first-of-type',0);await page.keyboard.type('X');await settled();
    const edited=(await snapshot(copyId)).snapshot;
    await row(sourceId).click();await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    await expect(row(sourceId)).toHaveAttribute('aria-current','true');
    await row(copyId).click();await expect(page.locator('#readonly-badge')).toHaveText('本地草稿');
    expect((await snapshot(copyId)).snapshot.source).toBe(edited.source);
    await page.locator('#format-undo').click();await settled();expect((await snapshot(copyId)).snapshot.source).toBe(raw);
    await page.locator('#format-redo').click();await settled();expect((await snapshot(copyId)).snapshot.source).toBe(edited.source);
    await page.locator('#session-filter').fill('不存在');await expect(page.locator('#session-empty')).toHaveText('没有匹配的已打开文档。');
    expect(await page.locator('#documents').inputValue()).toBe(copyId);await page.locator('#session-filter').fill('');
    await page.locator('#editor .tiptap').dispatchEvent('compositionstart',{data:''});
    await expect(row(sourceId)).toBeDisabled();await expect(page.locator('#toggle-session-sidebar')).toBeDisabled();
    await expect(page.locator('#backup-summary')).toHaveText('输入中…');
    await expect(page.locator('#copy-operation-alert')).toBeHidden();
    await page.locator('#editor .tiptap').dispatchEvent('compositionend',{data:''});await settled();
    await expect(row(sourceId)).toBeEnabled();
    // Intercept only the next synthetic target snapshot, leaving normal sender checks intact.
    await app.evaluate(({ipcMain},id)=>{
      const channel='document-demo:request',original=ipcMain._invokeHandlers.get(channel);
      globalThis.shellSnapshotRestore=()=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,original);};
      ipcMain.removeHandler(channel);ipcMain.handle(channel,(event,payload)=>{
        if(payload.operation==='snapshot'&&payload.sessionId===id)return new Promise(resolve=>{globalThis.shellReject=()=>resolve({ok:false,code:'read-failed'});});
        return original(event,payload);
      });
    },sourceId);
    await row(sourceId).click();await expect(row(sourceId)).toBeDisabled();
    await expect(row(copyId)).toHaveAttribute('aria-current','true');
    await app.evaluate(()=>globalThis.shellReject());
    await expect(page.locator('#viewer-status')).toContainText('switch-failed');
    await expect(row(copyId)).toHaveAttribute('aria-current','true');expect((await snapshot(copyId)).snapshot.source).toBe(edited.source);
    await app.evaluate(()=>globalThis.shellSnapshotRestore());
    await row(sourceId).click();await expect(row(sourceId)).toHaveAttribute('aria-current','true');
    await row(copyId).click();await expect(row(copyId)).toHaveAttribute('aria-current','true');
    await captureTestWindow(app,info.outputPath('approved-shell-writing.png'));
    await page.locator('#toggle-session-sidebar').click();await expect(page.locator('#document-sidebar')).toBeHidden();
    expect(await page.locator('#document-sidebar').evaluate(n=>n.inert)).toBe(true);
    await page.locator('#toggle-session-sidebar').click();await expect(row(copyId)).toBeVisible();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(390,800));
    await expect(page.locator('#document-sidebar')).toBeHidden();
    await expect(page.locator('#toggle-session-sidebar')).toBeVisible();
    await page.locator('#toggle-session-sidebar').click();await expect(row(copyId)).toBeVisible();
    await row(sourceId).click();await expect(page.locator('#document-sidebar')).toBeHidden();
    await expect(page.locator('#readonly-badge')).toHaveText('原文只读');
    await captureTestWindow(app,info.outputPath('approved-shell-narrow.png'));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await fs.readFile(original,'utf8')).toBe(raw);expect(errors).toEqual([]);
    console.log('approved-shell-evidence:'+JSON.stringify({originalUnchanged:true,originalSha256:require('node:crypto').createHash('sha256').update(raw).digest('hex'),nativeIme:'NOT VERIFIED',area}));
  }, info, null, true, true, true, null, {root:path.join(area,'drafts')});
});

test('reading V1 outline navigation and appearance preserve real document state', async ({}, info) => {
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'reading-v1-')));
  await usingDemo(async({app,page,root,snapshot,select,settled})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const raw='# 写作与阅读\n\n第一段中文，留给安静的思考。\n\n## 重复标题\n\n'+
      Array(9).fill('这是一段合成的长文。A quiet page keeps attention on the words.').join('\n\n')+
      '\n\n## 重复标题\n\nSecond section.\n\n### 更细的层次\n\nA paragraph.\n\n```md\n# Not a real heading\n```\n\n## 文章最后\n\nEnd of synthetic document.\n';
    const original=path.join(root,'reading.md');await fs.writeFile(original,raw,{flag:'wx',mode:0o600});
    await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},original);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
    await page.locator('#empty-open').click();const originalId=await page.locator('#documents').inputValue();
    const before=(await snapshot(originalId)).snapshot;
    await page.locator('#toggle-document-outline').click();
    await expect(page.locator('#document-outline')).toBeVisible();
    await expect(page.locator('#outline-list button')).toHaveText(['写作与阅读','重复标题','重复标题','更细的层次','文章最后']);
    await page.evaluate(()=>{window.staleReadingJump=document.querySelector('#outline-list button:last-child').onclick;window.readingEditorNode=document.querySelector('#editor .tiptap');});
    await page.locator('#outline-list button').last().click();
    expect(await page.locator('#document-scroll').evaluate(n=>n.scrollTop)).toBeGreaterThan(300);
    expect((await snapshot(originalId)).snapshot).toEqual(before);
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    await page.locator('#show-reading-settings').click();
    await page.locator('#reading-theme-dark').click();
    await page.locator('#reading-font').selectOption('serif');await page.locator('#reading-size').selectOption('21');
    await page.locator('#reading-width').selectOption('800');await page.locator('#reading-spacing').selectOption('2.2');
    await expect(page.locator('body')).toHaveAttribute('data-reading-theme','dark');
    await captureTestWindow(app,info.outputPath('reading-settings-dark.png'));
    await page.locator('#close-reading-settings').click();
    expect(await page.locator('#editor').evaluate(n=>getComputedStyle(n).fontSize)).toBe('21px');
    expect(await page.locator('#editor').evaluate(n=>getComputedStyle(n).maxWidth)).toBe('800px');
    expect(await page.evaluate(()=>window.readingEditorNode===document.querySelector('#editor .tiptap'))).toBe(true);
    expect((await snapshot(originalId)).snapshot).toEqual(before);
    await page.locator('#outline-list button').first().click();
    await captureTestWindow(app,info.outputPath('reading-outline-dark.png'));
    await page.keyboard.press('Meta+,');await expect(page.locator('#reading-settings-dialog')).toBeVisible();
    await page.emulateMedia({colorScheme:'dark'});await page.locator('#reading-theme-system').click();
    await expect(page.locator('body')).toHaveAttribute('data-reading-theme','dark');
    await page.emulateMedia({colorScheme:'light'});await expect(page.locator('body')).toHaveAttribute('data-reading-theme','light');
    await page.keyboard.press('Escape');await expect(page.locator('#reading-settings-dialog')).toBeHidden();
    await page.locator('#edit-copy').click();const copyId=await page.locator('#documents').inputValue();
    await expect(page.locator('#outline-list button')).toHaveCount(5);
    await page.evaluate(()=>window.staleReadingJump());
    expect(await page.locator('#document-scroll').evaluate(n=>n.scrollTop)).toBe(0);
    expect(await page.locator('#editor').evaluate(n=>getComputedStyle(n).fontSize)).toBe('21px');
    await select('#editor h1',0);await page.keyboard.type('X');await settled();
    await expect(page.locator('#outline-list button').first()).toHaveText('X写作与阅读');
    const edited=(await snapshot(copyId)).snapshot;
    await page.locator('#format-undo').click();await settled();await expect(page.locator('#outline-list button').first()).toHaveText('写作与阅读');
    expect((await snapshot(copyId)).snapshot.source).toBe(raw);
    await page.locator('#format-redo').click();await settled();await expect(page.locator('#outline-list button').first()).toHaveText('X写作与阅读');
    expect((await snapshot(copyId)).snapshot.source).toBe(edited.source);
    await page.locator('#editor .tiptap').dispatchEvent('compositionstart',{data:''});
    await expect(page.locator('#show-reading-settings')).toBeDisabled();
    await expect(page.locator('#toggle-document-outline')).toBeDisabled();
    await expect(page.locator('#outline-list button').last()).toBeDisabled();
    const top=await page.locator('#document-scroll').evaluate(n=>n.scrollTop);
    await page.evaluate(()=>document.querySelector('#outline-list button:last-child').onclick());
    expect(await page.locator('#document-scroll').evaluate(n=>n.scrollTop)).toBe(top);
    await page.locator('#editor .tiptap').dispatchEvent('compositionend',{data:''});await settled();
    await expect(page.locator('#show-reading-settings')).toBeEnabled();
    await page.locator('#show-reading-settings').click();await page.locator('#reading-theme-dark').click();
    await page.locator('#close-reading-settings').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(390,800));
    await expect(page.locator('#document-outline')).toBeHidden();
    await page.locator('#toggle-document-outline').click();await expect(page.locator('#document-outline')).toBeVisible();
    await captureTestWindow(app,info.outputPath('reading-outline-narrow.png'));
    await page.locator('#outline-list button').last().click();await expect(page.locator('#document-outline')).toBeHidden();
    await page.locator('#show-reading-settings').click();
    await captureTestWindow(app,info.outputPath('reading-settings-narrow.png'));
    expect(await page.locator('#reading-settings-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
    await page.locator('#reset-reading-settings').click();
    await expect(page.locator('body')).toHaveAttribute('data-reading-theme','light');
    await expect(page.locator('#reading-size')).toHaveValue('17');await page.locator('#close-reading-settings').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await snapshot(copyId)).snapshot.source).toBe(edited.source);
    expect((await snapshot(copyId)).snapshot.revision).toBe(edited.revision+2); // Undo and Redo only.
    expect(await fs.readFile(original,'utf8')).toBe(raw);expect(errors).toEqual([]);
    console.log('reading-v1-evidence:'+JSON.stringify({originalUnchanged:true,originalSha256:require('node:crypto').createHash('sha256').update(raw).digest('hex'),nativeIme:'NOT VERIFIED',themeDetection:'emulated media',area}));
  },info,null,true,true,true,null,{root:path.join(area,'drafts')});
});

test('integrated appearance acceptance preserves writing across panels and responsive navigation', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'appearance-acceptance-')));
  await usingDemo(async ({ app, page, root, snapshot, settled }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const resize = (width, height) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await resize(1280, 850);
    await captureTestWindow(app, info.outputPath('acceptance-welcome.png'));
    await page.locator('#empty-new').click();
    await page.locator('#editor .tiptap').click(); await page.keyboard.type('A quiet page for everyday writing.'); await settled();
    const draftId = await page.locator('#documents').inputValue();
    await expect.poll(async () => (await snapshot(draftId)).snapshot.draftBackup.state).toBe('backed-up');
    const before = (await snapshot(draftId)).snapshot;
    for (const [button, panel] of [['show-reading-settings', 'reading-settings-dialog'], ['show-drafts', 'draft-dialog'], ['show-details', 'document-details-dialog']]) {
      await page.locator('#' + button).click(); await expect(page.locator('#' + panel)).toBeVisible();
      expect(await page.locator('#' + panel).evaluate(n => n.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape'); await expect(page.locator('#' + panel)).toBeHidden();
      await expect(page.locator('#' + button)).toBeFocused();
    }
    await page.locator('#create-test-copy').click(); await expect(page.locator('#copy-confirm-dialog')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#copy-confirm-dialog')).toBeHidden();
    expect((await snapshot(draftId)).snapshot).toEqual(before);
    const raw = '# 给文字留一点空间\n\n把零散的想法写下来，再慢慢整理成自己的语言。\n\n## 今天的笔记\n\n一个安静的界面，让注意力回到正在写下的内容。\n\n- 记录观察\n- 整理思路\n- 留下明天的起点\n\n## 关于写作\n\nGood writing begins with a clear thought.\n\n```js\nconst thought = "Keep it simple.";\n```\n';
    const original = path.join(root, '给文字留一点空间 — 一份用于整体界面验收的合成文档.md');
    await fs.writeFile(original, raw, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, original);
    await page.locator('#open-file').click(); const originalId = await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await page.locator('#edit-copy').click(); const copyId = await page.locator('#documents').inputValue();
    await expect.poll(async () => (await snapshot(copyId)).snapshot.draftBackup.state).toBe('backed-up');
    const copyBefore = (await snapshot(copyId)).snapshot;
    const title = page.locator('#document-info > summary'), popup = page.locator('#document-info');
    await title.click(); await page.keyboard.press('Escape');
    await expect.soft(popup, 'Escape dismisses the document title popup').not.toHaveAttribute('open', '', { timeout: 500 });
    if (await popup.evaluate(n => n.open)) await title.click();
    await title.click(); await page.locator('#document-statistics').click();
    await expect.soft(popup, 'Clicking outside dismisses the document title popup').not.toHaveAttribute('open', '', { timeout: 500 });
    if (await popup.evaluate(n => n.open)) await title.click();
    await resize(1440, 900); await page.locator('#toggle-document-outline').click();
    await expect(page.locator('#document-outline')).toBeVisible();
    await captureTestWindow(app, info.outputPath('acceptance-writing-light.png'));
    await page.locator('#show-reading-settings').click(); await page.locator('#reading-theme-dark').click();
    await page.keyboard.press('Escape'); await captureTestWindow(app, info.outputPath('acceptance-writing-dark.png'));
    for (const width of [1024, 760, 390]) {
      await resize(width, 800); await title.click();
      const box = await page.locator('.document-info-panel').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expect(page.locator('#documents')).toHaveValue(copyId);
      await page.locator('#documents').focus(); await page.keyboard.press('Escape');
      await expect.soft(popup, 'Keyboard exit works at width ' + width).not.toHaveAttribute('open', '', { timeout: 500 });
      await expect.soft(title).toBeFocused();
      if (await popup.evaluate(n => n.open)) await title.click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await captureTestWindow(app, info.outputPath('acceptance-writing-narrow.png'));
    await page.locator('#toggle-session-sidebar').click();
    await page.locator('#session-list button').filter({ has: page.locator('strong') }).and(page.locator(`[data-session-id="${draftId}"]`)).click();
    await expect(page.locator('#document-sidebar')).toBeHidden();
    expect((await snapshot(draftId)).snapshot).toEqual(before);
    expect((await snapshot(copyId)).snapshot).toEqual(copyBefore);
    expect((await snapshot(originalId)).snapshot.source).toBe(raw);
    expect(await fs.readFile(original, 'utf8')).toBe(raw); expect(errors).toEqual([]);
    console.log('appearance-acceptance-evidence:' + JSON.stringify({ originalUnchanged: true, originalSha256: require('node:crypto').createHash('sha256').update(raw).digest('hex'), nativeIme: 'NOT VERIFIED', exportedFiles: 0, area }));
  }, info, null, true, true, true, null, { root: path.join(area, 'drafts') });
});

test('find V1 searches readonly and editable documents without changing content or history', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'find-v1-')));
  await usingDemo(async ({ app, page, root, snapshot, select, settled }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const raw = '# 在文字中查找\n\nAlpha 中文 alpha 😀\n\nA **bold** word.\n\n```md\nAlpha read-only\n```\n';
    const file = path.join(root, 'find-synthetic.md'); await fs.writeFile(file, raw, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await page.locator('#empty-open').click(); const sourceId = await page.locator('#documents').inputValue();
    const before = (await snapshot(sourceId)).snapshot;
    await select('#editor p:first-of-type', 0, 5);
    await page.keyboard.press('Meta+f'); await expect(page.locator('#find-query')).toBeFocused();
    await page.locator('#find-query').fill('alpha'); await expect(page.locator('#find-count')).toHaveText('1 / 3');
    await page.keyboard.press('Enter'); await expect(page.locator('#find-count')).toHaveText('2 / 3');
    await page.keyboard.press('Shift+Enter'); await expect(page.locator('#find-count')).toHaveText('1 / 3');
    await page.locator('#find-case').check(); await expect(page.locator('#find-count')).toHaveText('1 / 1');
    await page.locator('#find-case').uncheck();
    await page.locator('#find-query').fill('A bold'); await expect(page.locator('#find-count')).toHaveText('1 / 1');
    expect((await page.locator('.document-find-hit').allTextContents()).join('')).toBe('A bold');
    await page.locator('#find-query').fill('😀'); await expect(page.locator('#find-count')).toHaveText('1 / 1');
    await page.keyboard.press('Escape'); await expect(page.locator('#document-find')).toBeHidden();
    await expect(page.locator('#editor .tiptap')).toBeFocused();
    expect(await page.evaluate(() => getSelection().toString())).toBe('Alpha');
    expect((await snapshot(sourceId)).snapshot).toEqual(before);
    await page.locator('#edit-copy').click(); const copyId = await page.locator('#documents').inputValue();
    await page.locator('#show-document-find').click(); await page.locator('#find-query').fill('Zulu');
    await expect(page.locator('#find-count')).toHaveText('无匹配');
    // One input transaction: the existing controller records per-edit Undo steps.
    await select('#editor p:first-of-type', 0); await page.keyboard.insertText('Zulu '); await settled();
    await expect(page.locator('#find-count')).toHaveText('1 / 1');
    const edited = (await snapshot(copyId)).snapshot;
    await page.locator('#format-undo').click(); await settled();
    expect((await snapshot(copyId)).snapshot.source).toBe(raw);
    await expect(page.locator('#find-count')).toHaveText('无匹配');
    await page.locator('#format-redo').click(); await settled(); await expect(page.locator('#find-count')).toHaveText('1 / 1');
    expect((await snapshot(copyId)).snapshot.source).toBe(edited.source);
    await page.locator(`#session-list button[data-session-id="${sourceId}"]`).click(); await expect(page.locator('#find-count')).toHaveText('无匹配');
    await page.locator(`#session-list button[data-session-id="${copyId}"]`).click(); await expect(page.locator('#find-count')).toHaveText('1 / 1');
    await page.locator('#find-query').fill('Alpha'); await expect(page.locator('#find-count')).toHaveText('1 / 3');
    await captureTestWindow(app, info.outputPath('find-light.png'));
    await page.locator('#show-reading-settings').click(); await page.locator('#reading-theme-dark').click(); await page.locator('#close-reading-settings').click();
    await captureTestWindow(app, info.outputPath('find-dark.png'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(390, 800));
    await captureTestWindow(app, info.outputPath('find-narrow.png'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#find-query').fill(''); await expect(page.locator('.document-find-hit')).toHaveCount(0);
    await page.locator('#find-close').click(); await expect(page.locator('#editor .tiptap')).toBeFocused();
    expect(await fs.readFile(file, 'utf8')).toBe(raw); expect(errors).toEqual([]);
    console.log('find-v1-evidence:' + JSON.stringify({ originalSha256: require('node:crypto').createHash('sha256').update(await fs.readFile(file)).digest('hex'), originalUnchanged: true, area, nativeIme: 'NOT VERIFIED' }));
  }, info, null, true, true, false, null, { root: path.join(area, 'drafts') });
});

test('find V1 pauses for editor composition and respects search input composition and modal focus', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'find-ime-v1-')));
  await usingDemo(async ({ page, root, app, settled }) => {
    const file = path.join(root, 'find-guard.md'); await fs.writeFile(file, 'Alpha 中文\n', { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
    await page.locator('#empty-open').click(); await page.locator('#edit-copy').click();
    await page.locator('#show-document-find').click(); await page.locator('#find-query').fill('Alpha');
    await page.locator('#editor .tiptap').focus();
    await page.locator('#editor .tiptap').dispatchEvent('compositionstart', { data: '' });
    await expect(page.locator('#find-query')).toBeDisabled(); await expect(page.locator('#find-next')).toBeDisabled();
    await page.keyboard.press('Meta+f'); await expect(page.locator('#editor .tiptap')).toBeFocused();
    await page.locator('#editor .tiptap').dispatchEvent('compositionend', { data: '' }); await settled();
    await expect(page.locator('#find-query')).toBeEnabled();
    await page.locator('#find-query').focus();
    await page.locator('#find-query').dispatchEvent('compositionstart');
    await page.locator('#find-query').evaluate(input => { input.value = '中文'; input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); });
    await expect(page.locator('#find-count')).toHaveText('等待输入完成');
    await page.locator('#find-query').dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    await expect(page.locator('#document-find')).toBeVisible();
    await page.locator('#find-query').dispatchEvent('compositionend'); await expect(page.locator('#find-count')).toHaveText('1 / 1');
    await page.locator('#show-details').click(); await expect(page.locator('#document-details-dialog')).toBeVisible();
    await page.keyboard.press('Meta+f'); await expect(page.locator('#find-query')).not.toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.locator('#document-details-dialog')).toBeHidden(); await expect(page.locator('#document-find')).toBeVisible();
    await page.locator('#find-query').focus(); await page.keyboard.press('Escape'); await expect(page.locator('#document-find')).toBeHidden();
    expect(await fs.readFile(file, 'utf8')).toBe('Alpha 中文\n');
  }, info, null, true, false, false, null, { root: path.join(area, 'drafts') });
});


test('confirmed export shortcuts reopen readonly, retain later edits and request Finder without changing the original', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'copy-shortcuts-')));
  const fixture = createHomeFixture('Writing-synthetic-'), target = path.join(fixture.dir, 'confirmed.md');
  const hash = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  console.log('copy-shortcuts-fixture:' + JSON.stringify({ directory: fixture.dir, target }));
  let created;
  await usingDemo(async ({ app, page, root, snapshot, select, settled }) => {
    const original = path.join(root, 'original.md'), raw = '\ufeffFirst synthetic paragraph.\r\n\r\nSecond paragraph.\r\n';
    await fs.writeFile(original, raw, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog, shell }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.original] });
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.target });
      globalThis.copyShown = []; shell.showItemInFolder = file => globalThis.copyShown.push(file);
    }, { original, target });
    await page.locator('#empty-open').click();
    const originalId = await page.locator('#documents').inputValue();
    await page.locator('#edit-copy').click(); const draftId = await page.locator('#documents').inputValue();
    await select('#editor p:first-child', 0); await page.keyboard.insertText('Exported '); await settled();
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#copy-confirm-dialog')).toBeHidden();
    await expect(page.locator('#document-scroll #open-confirmed-copy')).toBeInViewport();
    await expect(page.locator('#reveal-confirmed-copy')).toBeInViewport();
    const exported = (await snapshot(draftId)).snapshot;
    expect(exported.confirmedCopy.state).toBe('created-confirmed'); expect(exported.dirty).toBe(true);
    created = await fs.readFile(target); expect(hash(created)).toBe(exported.confirmedCopy.sha256);
    fixture.recordFile('confirmed.md', created);
    await select('#editor p:first-child', 0); await page.keyboard.insertText('Later '); await settled();
    const later = (await snapshot(draftId)).snapshot;
    await page.locator('#reveal-confirmed-copy').click();
    await expect(page.locator('#copy-action-status')).toContainText('已请求');
    expect(await app.evaluate(() => globalThis.copyShown)).toEqual([target]);
    await captureTestWindow(app, info.outputPath('copy-shortcuts-light.png'));
    await page.locator('#open-confirmed-copy').click();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    const openedId = await page.locator('#documents').inputValue(); expect(openedId).not.toBe(draftId);
    expect((await snapshot(openedId)).snapshot.source).toBe(exported.source);
    await selectDocument(page, draftId); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    const returned = (await snapshot(draftId)).snapshot;
    for (const key of ['source', 'revision', 'dirty', 'canUndo', 'canRedo']) expect(returned[key]).toEqual(later[key]);
    await page.keyboard.press('Escape');
    await page.locator('#format-undo').click(); await settled(); expect((await snapshot(draftId)).snapshot.source).toBe(exported.source);
    await page.locator('#format-redo').click(); await settled(); expect((await snapshot(draftId)).snapshot.source).toBe(later.source);
    // A rejected subsequent export must not disable the prior successful receipt.
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect(page.locator('#copy-operation-alert')).toContainText('同名目标已存在');
    expect((await snapshot(draftId)).snapshot.confirmedCopy.copyId).toBe(exported.confirmedCopy.copyId);
    await page.locator('#open-confirmed-copy').click();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    expect((await snapshot(await page.locator('#documents').inputValue())).snapshot.source).toBe(exported.source);
    await selectDocument(page, draftId); await page.keyboard.press('Escape');
    await page.locator('#show-reading-settings').click(); await page.locator('#reading-theme-dark').click(); await page.keyboard.press('Escape');
    await captureTestWindow(app, info.outputPath('copy-shortcuts-dark.png'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(390, 800));
    await expect(page.locator('#document-scroll #open-confirmed-copy')).toBeInViewport();
    await expect(page.locator('#reveal-confirmed-copy')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureTestWindow(app, info.outputPath('copy-shortcuts-narrow.png'));
    expect((await snapshot(originalId)).snapshot.readOnly).toBe(true);
    expect(await fs.readFile(original, 'utf8')).toBe(raw); expect(await fs.readFile(target)).toEqual(created);
    console.log('copy-shortcuts-evidence:' + JSON.stringify({ originalSha256: hash(Buffer.from(raw)), exportedSha256: hash(created),
      originalUnchanged: true, exportUnchanged: true, draftAndHistoryRetained: true, finder: 'verified main invocation; UI stubbed', nativeIme: 'NOT VERIFIED' }));
  }, info, null, true, true, true, null, { root: path.join(area, 'drafts') });
  expect(await fs.readFile(target)).toEqual(created);
  const cleanup = fixture.cleanup({ passed: true, quiescent: true }); expect(cleanup.state).toBe('removed');
  console.log('home-fixture-cleanup:' + JSON.stringify(cleanup));
});


test('individual document close cancels safely, keeps recoverable writing and returns to welcome', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'document-close-e2e-')));
  await usingDemo(async ({ app, page, root, snapshot, select, settled }) => {
    const file = path.join(root, 'close-original.md'), bytes = Buffer.from('# Original\n\nFirst paragraph.\n\nSecond paragraph.\n');
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = async () => ({ response: 0 }); }, file);
    await page.locator('#open-file').click();
    const original = (await page.evaluate(() => window.documentDemo.list())).sessions[0].sessionId;
    await page.locator('#edit-copy').click();
    const draft = (await page.evaluate(() => window.documentDemo.list())).sessions.find(s => s.sessionId !== original).sessionId;
    await select('#editor p:first-of-type', 0); await page.keyboard.type('Edited '); await settled();
    const before = await snapshot(draft); expect(before.snapshot.canUndo).toBe(true);
    await page.locator('#close-current-document').click();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    expect((await snapshot(draft)).snapshot.source).toBe(before.snapshot.source);
    expect((await snapshot(draft)).snapshot.canUndo).toBe(true);
    await page.locator('#editor .tiptap').dispatchEvent('compositionstart', { data: 'controlled' });
    await expect(page.locator('#close-current-document')).toBeDisabled();
    expect((await page.evaluate(s => window.documentDemo.closeDocument({ sessionId: s.sessionId, expectedRevision: s.revision }), before.snapshot)).code).toBe('composition-active');
    await page.locator('#editor .tiptap').dispatchEvent('compositionend', { data: '' }); await settled();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.locator('#close-current-document').click();
    await expect(page.locator('#document-name')).toHaveText('close-original.md');
    expect((await page.evaluate(() => window.documentDemo.list())).sessions.map(s => s.sessionId)).toEqual([original]);
    const drafts = await page.evaluate(() => window.documentDemo.listDrafts());
    expect(drafts.drafts).toHaveLength(1); expect(drafts.drafts[0].active).toBe(false);
    await page.locator('#toggle-document-outline').click(); await expect(page.locator('#outline-list')).toContainText('Original');
    await page.locator('#show-document-find').click(); await page.locator('#find-query').fill('First');
    await expect(page.locator('#find-count')).toHaveText('1 / 1');
    await page.locator('#close-current-document').click();
    await expect(page.locator('#find-query')).toHaveValue(''); await expect(page.locator('#outline-list')).toBeEmpty();
    await expect(page.locator('#empty-state')).toBeVisible(); await expect(page.locator('#session-count')).toHaveText('0');
    await expect(page.locator('#close-current-document')).toBeHidden(); await expect(page.locator('#editor')).toBeHidden();
    await page.locator('#show-drafts').click(); await page.locator('#refresh-drafts').click();
    await page.getByRole('button', { name: '恢复副本', exact: true }).click();
    await expect(page.locator('#editor')).toBeVisible();
    const recovered = (await page.evaluate(() => window.documentDemo.list())).sessions[0].sessionId;
    expect((await snapshot(recovered)).snapshot.source).toBe(before.snapshot.source);
    expect((await snapshot(recovered)).snapshot.canUndo).toBe(false);
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === '文件').submenu.items.find(i => i.label === '关闭当前文档').accelerator);
    expect(menu).toBe('CmdOrCtrl+W');
    console.log('individual-close-evidence:' + JSON.stringify({ cancelPreservedHistory: true, draftRecovered: true, originalUnchanged: true, emptyWelcome: true, nativeIme: 'NOT VERIFIED', electron: await app.evaluate(() => process.versions.electron) }));
  }, info, null, true, false, false, null, { root: path.join(area, 'drafts') });
});


test('individual document close refuses a replaced backup directory and retains editable content and history', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'document-close-failure-')));
  const draftRoot = path.join(area, 'drafts');
  await usingDemo(async ({ app, page, root, snapshot, select, settled }) => {
    const file = path.join(root, 'original.md'), source = 'First synthetic paragraph.\n';
    await fs.writeFile(file, source, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, file);
    await page.locator('#open-file').click(); await page.locator('#edit-copy').click();
    const id = await page.locator('#documents').inputValue();
    await select('#editor p:first-child', 0); await page.keyboard.type('Edited '); await settled();
    await expect(page.locator('#backup-summary')).toHaveText('已备份');
    const before = (await snapshot(id)).snapshot;
    // Only the private synthetic draft fixture is moved; retain both identities as failure evidence.
    await fs.rename(draftRoot, draftRoot + '-moved'); await fs.mkdir(draftRoot, { mode: 0o700 });
    await page.locator('#close-current-document').click();
    await expect(page.locator('#viewer-status')).toContainText('文档未关闭');
    await expect(page.locator('#backup-summary')).toContainText('本地备份未确认');
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    await expect(page.locator('#close-current-document')).toBeEnabled();
    let after = (await snapshot(id)).snapshot;
    expect(after.source).toBe(before.source); expect(after.canUndo).toBe(true);
    await select('#editor p:first-child', 0); await page.keyboard.type('X'); await settled();
    expect((await snapshot(id)).snapshot.source).not.toBe(before.source);
    await page.locator('#format-undo').click(); await settled();
    after = (await snapshot(id)).snapshot; expect(after.source).toBe(before.source); expect(after.canRedo).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(source);
    await captureTestWindow(app, info.outputPath('close-backup-refused.png'));
    console.log('individual-close-failure-evidence:' + JSON.stringify({ directory: area, retained: ['drafts', 'drafts-moved'],
      closeRefused: true, textAndHistoryRetained: true, editingContinues: true, originalUnchanged: true }));
  }, info, null, true, false, false, null, { root: draftRoot });
});


test('paragraph range V1 replaces selections, continues writing and reopens an exact new file', async ({}, info) => {
  const area = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'paragraph-range-e2e-')));
  const hash = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  let receipt, exported, original, raw;
  await usingDemo(async ({ app, page, root, snapshot, select, settled }) => {
    original = path.join(root, 'range-original.md');
    raw = Buffer.from('\ufeff# Keep\r\n\r\nFirst 中😀.\r\n\r\nMiddle plain.\r\n\r\nLast 文😀.\r\n\r\n```md\r\nkeep [x]\r\n```\r\n\r\nTail.\r\n');
    await fs.writeFile(original, raw, { flag: 'wx', mode: 0o600 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, original);
    await page.locator('#empty-open').click(); const originalId = await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await page.locator('#edit-copy').click(); const id = await page.locator('#documents').inputValue();
    const before = (await snapshot(id)).snapshot;
    const range = async (a, b, start, end, backward = false) => {
      const positions = await page.locator('#editor .tiptap').evaluate((node, args) => {
        const [a, b, start, end, backward] = args, ps = node.querySelectorAll('p'); node.focus();
        const left = ps[a].firstChild, right = ps[b].firstChild, selection = window.getSelection();
        selection.setBaseAndExtent(backward ? right : left, backward ? end : start, backward ? left : right, backward ? start : end);
        document.dispatchEvent(new Event('selectionchange'));
        return [node.editor.view.posAtDOM(left, start), node.editor.view.posAtDOM(right, end)];
      }, [a, b, start, end, backward]);
      await expect.poll(() => page.locator('#editor .tiptap').evaluate(node => [node.editor.state.selection.from, node.editor.state.selection.to])).toEqual(positions);
    };
    await range(0, 2, 6, 5, true); await page.keyboard.insertText('替换😀'); await settled();
    const replaced = before.source.replace('中😀.\r\n\r\nMiddle plain.\r\n\r\nLast ', '替换😀');
    expect((await snapshot(id)).snapshot.source).toBe(replaced);
    expect((await snapshot(id)).snapshot.revision).toBe(before.revision + 1);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(id)).snapshot.source).toBe(before.source);
    await page.keyboard.press('Meta+Shift+z'); await settled(); expect((await snapshot(id)).snapshot.source).toBe(replaced);
    await page.keyboard.type(' next'); await settled(); const typed = (await snapshot(id)).snapshot.source;
    await page.keyboard.press('Enter'); await settled(); const split = (await snapshot(id)).snapshot.source;
    expect(split).not.toBe(typed);
    await page.keyboard.press('Backspace'); await settled(); expect((await snapshot(id)).snapshot.source).toBe(typed);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(id)).snapshot.source).toBe(split);
    await range(0, 1, 6, 1); await page.keyboard.press('Backspace'); await settled();
    expect((await snapshot(id)).snapshot.source).toBe(split.replace('替换😀 next\r\n\r\n文', ''));
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(id)).snapshot.source).toBe(split);
    await range(0, 1, 6, 1);
    await page.locator('#editor .tiptap').evaluate(node => {
      const data = new DataTransfer(); data.setData('text/plain', 'One\nTwo'); data.setData('text/html', '<script>BAD</script>');
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await settled(); const pasted = split.replace('替换😀 next\r\n\r\n文', 'One\r\n\r\nTwo');
    expect((await snapshot(id)).snapshot.source).toBe(pasted);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(id)).snapshot.source).toBe(split);
    await page.keyboard.press('Meta+Shift+z'); await settled(); expect((await snapshot(id)).snapshot.source).toBe(pasted);
    // A protected code block between the endpoints prevents the entire change.
    await range(0, 2, 1, 1); const guarded = (await snapshot(id)).snapshot;
    await page.keyboard.insertText('REFUSE'); await settled(); expect((await snapshot(id)).snapshot).toEqual(guarded);
    await expect(page.locator('#viewer-status')).toContainText('原有内容已保留');
    await select('#editor p:last-child', 0); await page.keyboard.insertText('Safe '); await settled();
    expect((await snapshot(id)).snapshot.source).toBe(pasted.replace('Tail.', 'Safe Tail.'));
    await selectDocument(page, originalId); expect((await snapshot(originalId)).snapshot.source).toBe(before.source);
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    await selectDocument(page, id); await page.locator('#format-undo').click(); await settled();
    expect((await snapshot(id)).snapshot.source).toBe(pasted);
    await page.locator('#format-redo').click(); await settled(); const ready = (await snapshot(id)).snapshot;
    await page.locator('#create-test-copy').click(); await page.locator('#confirm-test-copy').click();
    await expect.poll(async () => (await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const after = (await snapshot(id)).snapshot; receipt = after.copyState;
    exported = await fs.readFile(receipt.filePath);
    expect(exported.equals(Buffer.from('\ufeff' + ready.source))).toBe(true); expect(hash(exported)).toBe(receipt.sha256);
    expect(after.dirty).toBe(true); expect(after.canUndo).toBe(true); expect((await fs.readFile(original)).equals(raw)).toBe(true);
    await captureTestWindow(app, info.outputPath('paragraph-range-created.png'));
  }, info, null, true, true, false, null, { root: path.join(area, 'drafts') });
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, receipt.filePath);
    await page.locator('#empty-open').click(); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    const reopened = (await snapshot(await page.locator('#documents').inputValue())).snapshot;
    expect(reopened.bom).toBe(true); expect(Buffer.from('\ufeff' + reopened.source).equals(exported)).toBe(true);
    expect(hash(await fs.readFile(original))).toBe(hash(raw)); expect(hash(await fs.readFile(receipt.filePath))).toBe(receipt.sha256);
    console.log('paragraph-range-evidence:' + JSON.stringify({ original, exported: receipt.filePath, originalSha256: hash(raw),
      exportedSha256: receipt.sha256, originalUnchanged: true, reopenedAfterExit: true, nativeIme: 'NOT VERIFIED',
      clipboard: 'controlled ClipboardEvent', openDialog: 'stubbed', area }));
  }, info, null, true, false, false, null, { root: path.join(area, 'reopen-drafts') });
});

// Real lifecycle/IPC, with only synthetic files and controlled dialog choices.
test('inline range V1 edits mixed bold text, continues typing and exports exact source', async ({}, info) => {
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'inline-range-e2e-')));
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
  let receipt,bytes,original,raw;
  await usingDemo(async({app,page,root,snapshot,settled})=>{
    original=path.join(root,'inline-original.md');
    raw=Buffer.from('\ufeff# Keep\r\n\r\nAlpha **bold** omega.\r\n\r\n```md\r\nkeep **bytes**\r\n```\r\n\r\nTail.\r\n');
    await fs.writeFile(original,raw,{flag:'wx',mode:0o600});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
    await page.locator('#empty-open').click();const originalId=await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue();
    const before=(await snapshot(id)).snapshot.source;
    const source=async()=>(await snapshot(id)).snapshot.source;
    const range=async(from,to,backward=false)=>{
      const positions=await page.locator('#editor p').first().evaluate((p,[from,to,backward])=>{
        const editor=p.closest('.tiptap');editor.focus();
        const resolve=offset=>{const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;
          while(n=walker.nextNode()){if(offset<=n.length)return[n,offset];offset-=n.length;}throw Error('Range outside synthetic paragraph');};
        const [a,x]=resolve(from),[b,y]=resolve(to),s=window.getSelection();
        s.setBaseAndExtent(backward?b:a,backward?y:x,backward?a:b,backward?x:y);
        document.dispatchEvent(new Event('selectionchange'));
        return[editor.editor.view.posAtDOM(a,x),editor.editor.view.posAtDOM(b,y)];
      },[from,to,backward]);
      await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(positions);
    };
    const undo=async expected=>{await page.keyboard.press('Meta+z');await settled();expect(await source()).toBe(expected);};
    await range(3,8,true);await page.keyboard.insertText('新😀');await settled();
    const replaced=before.replace('ha **bo','新😀**');expect(await source()).toBe(replaced);
    await page.keyboard.type('Z');await settled();const continued=replaced.replace('**ld**','Z**ld**');expect(await source()).toBe(continued);
    await undo(replaced);await undo(before);
    await page.keyboard.press('Meta+Shift+z');await settled();expect(await source()).toBe(replaced);
    await undo(before);
    await range(8,13);await page.keyboard.type('X');await settled();
    expect(await source()).toBe(before.replace('ld** om','X**'));await undo(before);
    await range(6,10);await page.keyboard.press('Backspace');await settled();
    expect(await source()).toBe(before.replace('**bold**',''));await undo(before);
    await range(0,6);await page.keyboard.press('Backspace');await settled();
    expect(await source()).toBe(before.replace('Alpha ',''));await undo(before);
    await range(3,8);
    const paste=async text=>page.locator('#editor .tiptap').evaluate((n,text)=>{
      const data=new DataTransfer();data.setData('text/plain',text);data.setData('text/html','<b>NOT USED</b>');
      n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    },text);
    await paste('保留😀');await settled();const pasted=before.replace('ha **bo','保留😀**');expect(await source()).toBe(pasted);
    await undo(before);await range(3,8);await paste('One\nTwo');await settled();expect(await source()).toBe(before);
    await expect(page.locator('#viewer-status')).toContainText('未粘贴');
    const protectedRange=await page.locator('#editor .tiptap').evaluate(n=>{
      n.focus();const ps=n.querySelectorAll('p'),a=ps[0].firstChild,b=ps[ps.length-1].firstChild;
      window.getSelection().setBaseAndExtent(a,1,b,2);document.dispatchEvent(new Event('selectionchange'));
      return[n.editor.view.posAtDOM(a,1),n.editor.view.posAtDOM(b,2)];
    });
    await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(protectedRange);
    await page.keyboard.insertText('REFUSE');await settled();expect(await source()).toBe(before);
    await range(3,8);await paste('保留😀');await settled();expect(await source()).toBe(pasted);
    await selectDocument(page,originalId);await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    expect((await snapshot(originalId)).snapshot.source).toBe(before);
    await selectDocument(page,id);await page.locator('#format-undo').click();await settled();expect(await source()).toBe(before);
    await page.locator('#format-redo').click();await settled();expect(await source()).toBe(pasted);
    await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const after=(await snapshot(id)).snapshot;receipt=after.copyState;bytes=await fs.readFile(receipt.filePath);
    expect(bytes.equals(Buffer.from('\ufeff'+pasted))).toBe(true);expect(hash(bytes)).toBe(receipt.sha256);
    expect(after.dirty).toBe(true);expect((await fs.readFile(original)).equals(raw)).toBe(true);
    await captureTestWindow(app,info.outputPath('inline-range.png'));
  },info,null,true,true,false,null,{root:path.join(area,'drafts')});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    const reopened=(await snapshot(await page.locator('#documents').inputValue())).snapshot;
    expect(Buffer.from('\ufeff'+reopened.source).equals(bytes)).toBe(true);expect(hash(await fs.readFile(original))).toBe(hash(raw));
    console.log('inline-range-evidence:'+JSON.stringify({original,exported:receipt.filePath,originalSha256:hash(raw),exportSha256:receipt.sha256,originalUnchanged:true,reopenedAfterExit:true,nativeIme:'NOT VERIFIED',clipboard:'controlled',dialog:'stubbed',area}));
  },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});

// Keyboard-driven boundary commands, verified against main source and disk bytes.
test('writing boundaries V1 splits joins and exits lists with exact export reopen',async({},info)=>{
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'writing-boundaries-e2e-')));
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
  let receipt,bytes,raw,original;
  await usingDemo(async({app,page,root,snapshot})=>{
    original=path.join(root,'boundaries-original.md');
    raw=Buffer.from('\ufeff# Keep\r\n\r\nAlpha **bold** omega.\r\n\r\n- First **bold** tail.\r\n- Next.\r\n- \r\n- End.\r\n\r\n```md\r\nKEEP []\r\n```\r\n');
    await fs.writeFile(original,raw,{flag:'wx',mode:0o600});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
    await page.locator('#empty-open').click();const originalId=await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue();
    const source=async()=>(await snapshot(id)).snapshot.source,before=await source();
    const caret=async(selector,n,offset)=>{
      const at=await page.locator(selector).nth(n).evaluate((p,offset)=>{
        const root=p.closest('.tiptap'),w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node,chosen=p,pos=0;
        while(node=w.nextNode()){chosen=node;pos=Math.min(offset,node.length);if(offset<=node.length)break;offset-=node.length;}
        root.focus();window.getSelection().setBaseAndExtent(chosen,pos,chosen,pos);document.dispatchEvent(new Event('selectionchange'));
        return root.editor.view.posAtDOM(chosen,pos);
      },offset);
      await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>n.editor.state.selection.from)).toBe(at);
    };
    const key=async(k,expected)=>{await page.keyboard.press(k);await expect.poll(source).toBe(expected);};
    await caret('#editor .tiptap > p',0,8);
    const split=before.replace('**bold**','**bo**\r\n\r\n**ld**');
    await key('Enter',split);await key('Backspace',before);
    await key('Meta+z',split);await key('Meta+Shift+z',before);
    await caret('#editor li p',0,8);
    const listSplit=before.replace('First **bold**','First **bo**\r\n- **ld**');
    await key('Enter',listSplit);await key('Backspace',before);
    await caret('#editor li p',0,0);
    const lifted=before.replace('- First **bold** tail.\r\n','First **bold** tail.\r\n\r\n');
    await key('Backspace',lifted);await key('Meta+z',before);
    await caret('#editor li p',2,0);await page.keyboard.press('Enter');
    await expect(page.locator('#viewer-status')).toContainText('空项退出仅支持首项或末项');expect(await source()).toBe(before);
    await page.keyboard.type('Safe');
    const filled=before.replace('- \r\n- End.','- Safe\r\n- End.');await expect.poll(source).toBe(filled);
    await caret('#editor li p',3,4);
    const emptyEnd=filled.replace('- End.\r\n\r\n','- End.\r\n- \r\n\r\n');await key('Enter',emptyEnd);
    const exited=filled.replace('- End.\r\n\r\n','- End.\r\n\r\n\r\n\r\n');await key('Enter',exited);
    await page.keyboard.type('After list.');const finished=exited.replace('- End.\r\n\r\n','- End.\r\n\r\nAfter list.');await expect.poll(source).toBe(finished);
    await selectDocument(page,originalId);expect((await snapshot(originalId)).snapshot.source).toBe(before);
    await selectDocument(page,id);await page.keyboard.press('Escape');
    await page.locator('#new-temporary').click();const blankId=await page.locator('#documents').inputValue();
    await page.locator('#editor p').click();await page.locator('#format-block').selectOption('bullet-list');
    await expect.poll(async()=>(await snapshot(blankId)).snapshot.source).toBe('- ');
    await page.locator('#editor li p').click();await page.keyboard.press('Enter');
    await expect.poll(async()=>(await snapshot(blankId)).snapshot.source).toBe('');
    await selectDocument(page,id);await page.keyboard.press('Escape');expect(await source()).toBe(finished);
    await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);
    expect(bytes.equals(Buffer.from('\ufeff'+finished))).toBe(true);expect(hash(bytes)).toBe(receipt.sha256);expect(saved.dirty).toBe(true);
    expect(await fs.readFile(original)).toEqual(raw);await captureTestWindow(app,info.outputPath('boundaries.png'));
  },info,null,true,true,false,null,{root:path.join(area,'drafts')});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    const reopened=(await snapshot(await page.locator('#documents').inputValue())).snapshot;
    expect(Buffer.from('\ufeff'+reopened.source)).toEqual(bytes);expect(await fs.readFile(original)).toEqual(raw);
    console.log('boundaries-evidence:'+JSON.stringify({original,exported:receipt.filePath,originalSha256:hash(raw),exportSha256:receipt.sha256,
      originalUnchanged:true,reopenedAfterExit:true,nativeIME:'NOT VERIFIED',dialog:'stubbed',area}));
  },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});


// Same production controller/history; native dialogs and clipboard data are controlled.
test('list ranges V2 replacement deletion paste and continuous editing export reopen',async({},info)=>{
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'list-item-range-e2e-')));
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
  let original,raw,receipt,bytes;
  await usingDemo(async({app,page,root,snapshot,settled})=>{
    original=path.join(root,'list-original.md');
    raw=Buffer.from('\ufeff# Keep\r\n\r\n- Alpha **bold** tail.\r\n- Keep\r\n- **All**\r\n\r\n```md protected\r\nKeep []\r\n```\r\n\r\nEnd.');
    await fs.writeFile(original,raw,{flag:'wx',mode:0o600});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
    await page.locator('#empty-open').click();const originalId=await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue();
    const source=async()=>(await snapshot(id)).snapshot.source,before=await source();
    const range=async(row,from,to,reverse=false,endRow=row)=>{
      const selected=await page.locator('#editor .tiptap').evaluate((root,r)=>{
        function at(index,offset){const p=root.querySelectorAll('li p')[index],w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;
          while(n=w.nextNode()){if(offset<=n.length)return[n,offset];offset-=n.length;}return[p,0];}
        const a=at(r.row,r.from),b=at(r.endRow,r.to);root.focus();
        window.getSelection().setBaseAndExtent(...(r.reverse?b:a),...(r.reverse?a:b));document.dispatchEvent(new Event('selectionchange'));
        return[root.editor.view.posAtDOM(...a),root.editor.view.posAtDOM(...b)];
      },{row,from,to,reverse,endRow});
      await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(selected);
    };
    const key=async(k,expected)=>{await page.keyboard.press(k);await expect.poll(source).toBe(expected);};
    const paste=async(text)=>{await page.locator('#editor .tiptap').evaluate((n,text)=>{
      const d=new DataTransfer();d.setData('text/plain',text);d.setData('text/html','<b>NOT USED</b>');
      n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));
    },text);await settled();};
    await range(0,3,8,true);await page.keyboard.insertText('X');
    const typed=before.replace('ha **bo','X**');await expect.poll(source).toBe(typed);
    await key('Meta+z',before);await key('Meta+Shift+z',typed);await key('Meta+z',before);
    await range(0,6,10);await key('Backspace',before.replace('**bold**',''));await key('Meta+z',before);
    await range(0,8,13,true);await paste('中文😀');await expect.poll(source).toBe(before.replace('ld** ta','中文😀**'));await key('Meta+z',before);
    await range(2,0,3);const empty=before.replace('**All**','');await key('Backspace',empty);
    await page.keyboard.type('Again');await expect.poll(source).toBe(before.replace('**All**','Again'));
    await key('Meta+z',before.replace('**All**','Agai')); // ordinary keystrokes retain their existing history granularity
    for(let i=0;i<4;i++)await page.keyboard.press('Meta+z');await expect.poll(source).toBe(empty);await key('Meta+z',before);
    await range(0,3,2,false,2);await page.keyboard.insertText('X');
    const cross=before.replace('ha **bold** tail.\r\n- Keep\r\n- **Al','X**');
    await expect.poll(source).toBe(cross);await key('Meta+z',before);await key('Meta+Shift+z',cross);await key('Meta+z',before);
    await range(0,0,3,true,2);const cleared=before.replace('- Alpha **bold** tail.\r\n- Keep\r\n- **All**','- ');
    await key('Backspace',cleared);await page.keyboard.insertText('Again');await expect.poll(source).toBe(cleared.replace('- \r\n','- Again\r\n'));
    await key('Meta+z',cleared);await key('Meta+z',before);
    await range(0,0,3,false,2);await key('Delete',cleared);await key('Meta+z',before);
    const acrossBlock=await page.locator('#editor .tiptap').evaluate(n=>{
      const a=n.querySelector('li p').firstChild,b=n.querySelector('pre code').firstChild;n.focus();
      window.getSelection().setBaseAndExtent(a,1,b,2);document.dispatchEvent(new Event('selectionchange'));
      return[n.editor.view.posAtDOM(a,1),n.editor.view.posAtDOM(b,2)];
    });
    await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(acrossBlock);
    const protectedRevision=(await snapshot(id)).snapshot.revision;
    await page.keyboard.insertText('REFUSE');await settled();expect(await source()).toBe(before);
    expect((await snapshot(id)).snapshot.revision).toBe(protectedRevision);await expect(page.locator('#viewer-status')).toContainText('输入范围与当前选区不一致');
    await range(0,8,2,true,2);await paste('One\nTwo');expect(await source()).toBe(before);await expect(page.locator('#viewer-status')).toContainText('未粘贴');
    await paste('');expect(await source()).toBe(before);
    await paste('最终😀');let finished=before.replace('ld** tail.\r\n- Keep\r\n- **Al','最终😀');await expect.poll(source).toBe(finished);
    await page.keyboard.type('Q');finished=finished.replace('最终😀','最终😀Q');await expect.poll(source).toBe(finished);
    await selectDocument(page,originalId);expect((await snapshot(originalId)).snapshot.source).toBe(before);
    await selectDocument(page,id);await page.keyboard.press('Escape');await key('Meta+z',finished.replace('最终😀Q','最终😀'));await key('Meta+Shift+z',finished);
    await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);
    expect(bytes).toEqual(Buffer.from('\ufeff'+finished));expect(hash(bytes)).toBe(receipt.sha256);expect(saved.dirty).toBe(true);
    expect(await fs.readFile(original)).toEqual(raw);await captureTestWindow(app,info.outputPath('list-cross-range.png'));
  },info,null,true,true,false,null,{root:path.join(area,'drafts')});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    const reopened=(await snapshot(await page.locator('#documents').inputValue())).snapshot;
    expect(Buffer.from('\ufeff'+reopened.source)).toEqual(bytes);expect(await fs.readFile(original)).toEqual(raw);
    console.log('list-cross-range-evidence:'+JSON.stringify({original,exported:receipt.filePath,originalSha256:hash(raw),exportSha256:receipt.sha256,originalUnchanged:true,reopenedAfterExit:true,nativeIME:'NOT VERIFIED',clipboard:'controlled',dialog:'stubbed',area}));
  },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});

// Production source/history/export path; only dialog choices and clipboard are controlled.
test('italic V1 toolbar shortcut continuous editing export and readonly reopen',async({},info)=>{
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'italic-e2e-')));
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');let original,raw,receipt,bytes;
  await usingDemo(async({app,page,root,snapshot,settled})=>{
    original=path.join(root,'italic-original.md');raw=Buffer.from('\ufeff# Title\r\n\r\nAlpha word tail.\r\n\r\n- First *italic* tail.\r\n- Second **bold** end.\r\n\r\n*All*\r\n\r\n```md\r\nKeep []\r\n```\r\n');
    await fs.writeFile(original,raw,{flag:'wx',mode:0o600});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
    await page.locator('#empty-open').click();const originalId=await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');await expect(page.locator('#format-italic')).toBeHidden();
    await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue();
    const source=async()=>(await snapshot(id)).snapshot.source,before=await source();
    const range=async(selector,from,to=from,reverse=false)=>{
      const positions=await page.locator(selector).evaluate((p,r)=>{
        const root=p.closest('.tiptap');function at(n){const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;
          while(node=w.nextNode()){if(n<=node.length)return[node,n];n-=node.length;}return[p,0];}
        const a=at(r.from),b=at(r.to);root.focus();window.getSelection().setBaseAndExtent(...(r.reverse?b:a),...(r.reverse?a:b));document.dispatchEvent(new Event('selectionchange'));
        return[root.editor.view.posAtDOM(...a),root.editor.view.posAtDOM(...b)];
      },{from,to,reverse});
      await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(positions);
    };
    const key=async(k,expected)=>{await page.keyboard.press(k);await expect.poll(source).toBe(expected);};
    await range('#editor .tiptap > p:first-of-type',6,10,true);await page.locator('#format-italic').click();
    const formatted=before.replace('Alpha word','Alpha *word*');await expect.poll(source).toBe(formatted);
    await expect(page.locator('#format-italic')).toHaveAttribute('aria-pressed','true');
    await key('Meta+i',before);await key('Meta+z',formatted);
    await range('#editor .tiptap > p:first-of-type em',2);await page.keyboard.insertText('新');
    const typed=formatted.replace('*word*','*wo新rd*');await expect.poll(source).toBe(typed);await key('Meta+z',formatted);await key('Meta+Shift+z',typed);
    await range('#editor .tiptap > p:first-of-type em',2);const split=typed.replace('*wo新rd*','*wo*\r\n\r\n*新rd*');await key('Enter',split);await key('Backspace',typed);
    await range('#editor .tiptap > p:nth-of-type(2) em',0,3);await key('Backspace',typed.replace('*All*',''));await page.keyboard.insertText('Again');
    await expect.poll(source).toBe(typed.replace('*All*','Again'));await key('Meta+z',typed.replace('*All*',''));await key('Meta+z',typed);
    await range('#editor li:first-child em',2);const listSplit=typed.replace('*italic*','*it*\r\n- *alic*');await key('Enter',listSplit);await key('Backspace',typed);
    await range('#editor li:first-child p',3,9,true);
    await page.locator('#editor .tiptap').evaluate(n=>{const data=new DataTransfer();data.setData('text/plain','单行');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
    const pasted=typed.replace('st *ita','单行*');await expect.poll(source).toBe(pasted);await key('Meta+z',typed);
    await range('#editor li:nth-child(2) strong',0,4);await page.locator('#format-italic').click();await settled();expect(await source()).toBe(typed);await expect(page.locator('#viewer-status')).toContainText('暂不支持叠加');
    await selectDocument(page,originalId);expect((await snapshot(originalId)).snapshot.source).toBe(before);await selectDocument(page,id);await page.keyboard.press('Escape');
    expect(await source()).toBe(typed);await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);
    expect(bytes).toEqual(Buffer.from('\ufeff'+typed));expect(hash(bytes)).toBe(receipt.sha256);expect(saved.dirty).toBe(true);expect(await fs.readFile(original)).toEqual(raw);
    await captureTestWindow(app,info.outputPath('italic.png'));
  },info,null,true,true,false,null,{root:path.join(area,'drafts')});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    const reopened=(await snapshot(await page.locator('#documents').inputValue())).snapshot;expect(Buffer.from('\ufeff'+reopened.source)).toEqual(bytes);
    expect(await fs.readFile(original)).toEqual(raw);await expect(page.locator('#editor em').first()).toHaveText('wo新rd');
    console.log('italic-evidence:'+JSON.stringify({original,exported:receipt.filePath,originalSha256:hash(raw),exportSha256:receipt.sha256,originalUnchanged:true,reopenedAfterExit:true,nativeIME:'NOT VERIFIED',clipboard:'controlled',dialog:'stubbed',area}));
  },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});

// Production source/history/export path; only dialog choices and clipboard are controlled.
test('code V1 toolbar shortcut continuous editing export and readonly reopen',async({},info)=>{
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'code-e2e-')));
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');let original,raw,receipt,bytes;
  await usingDemo(async({app,page,root,snapshot,settled})=>{
    original=path.join(root,'code-original.md');raw=Buffer.from('\ufeff# Title\r\n\r\nAlpha word tail.\r\n\r\n- First `code` tail.\r\n- Second **bold** end.\r\n\r\n`All`\r\n\r\n```md\r\nKeep []\r\n```\r\n');
    await fs.writeFile(original,raw,{flag:'wx',mode:0o600});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
    await page.locator('#empty-open').click();const originalId=await page.locator('#documents').inputValue();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');await expect(page.locator('#format-code')).toBeHidden();
    await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue();
    const source=async()=>(await snapshot(id)).snapshot.source,before=await source();
    const range=async(selector,from,to=from,reverse=false)=>{
      const positions=await page.locator(selector).evaluate((p,r)=>{
        const root=p.closest('.tiptap');function at(n){const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;
          while(node=w.nextNode()){if(n<=node.length)return[node,n];n-=node.length;}return[p,0];}
        const a=at(r.from),b=at(r.to);root.focus();window.getSelection().setBaseAndExtent(...(r.reverse?b:a),...(r.reverse?a:b));document.dispatchEvent(new Event('selectionchange'));
        return[root.editor.view.posAtDOM(...a),root.editor.view.posAtDOM(...b)];
      },{from,to,reverse});
      await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(positions);
    };
    const key=async(k,expected)=>{await page.keyboard.press(k);await expect.poll(source).toBe(expected);};
    await range('#editor .tiptap > p:first-of-type',6,10,true);await page.locator('#format-code').click();
    const formatted=before.replace('Alpha word','Alpha `word`');await expect.poll(source).toBe(formatted);
    await expect(page.locator('#format-code')).toHaveAttribute('aria-pressed','true');
    await key('Meta+e',before);await key('Meta+z',formatted);
    await range('#editor .tiptap > p:first-of-type code',2);await page.keyboard.insertText('新');
    const typed=formatted.replace('`word`','`wo新rd`');await expect.poll(source).toBe(typed);await key('Meta+z',formatted);await key('Meta+Shift+z',typed);
    await range('#editor .tiptap > p:first-of-type code',2);const split=typed.replace('`wo新rd`','`wo`\r\n\r\n`新rd`');await key('Enter',split);await key('Backspace',typed);
    await range('#editor .tiptap > p:nth-of-type(2) code',0,3);await key('Backspace',typed.replace('`All`',''));await page.keyboard.insertText('Again');
    await expect.poll(source).toBe(typed.replace('`All`','Again'));await key('Meta+z',typed.replace('`All`',''));await key('Meta+z',typed);
    await range('#editor li:first-child code',2);const listSplit=typed.replace('`code`','`co`\r\n- `de`');await key('Enter',listSplit);await key('Backspace',typed);
    await range('#editor li:first-child p',3,9,true);
    await page.locator('#editor .tiptap').evaluate(n=>{const data=new DataTransfer();data.setData('text/plain','单行');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
    const pasted=typed.replace('st `cod','单行`');await expect.poll(source).toBe(pasted);await key('Meta+z',typed);
    await range('#editor li:nth-child(2) strong',0,4);await page.locator('#format-code').click();await settled();expect(await source()).toBe(typed);await expect(page.locator('#viewer-status')).toContainText('暂不支持叠加');
    await selectDocument(page,originalId);expect((await snapshot(originalId)).snapshot.source).toBe(before);await selectDocument(page,id);await page.keyboard.press('Escape');
    expect(await source()).toBe(typed);await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);
    expect(bytes).toEqual(Buffer.from('\ufeff'+typed));expect(hash(bytes)).toBe(receipt.sha256);expect(saved.dirty).toBe(true);expect(await fs.readFile(original)).toEqual(raw);
    await captureTestWindow(app,info.outputPath('code.png'));
  },info,null,true,true,false,null,{root:path.join(area,'drafts')});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    const reopened=(await snapshot(await page.locator('#documents').inputValue())).snapshot;expect(Buffer.from('\ufeff'+reopened.source)).toEqual(bytes);
    expect(await fs.readFile(original)).toEqual(raw);await expect(page.locator('#editor code').first()).toHaveText('wo新rd');
    console.log('code-evidence:'+JSON.stringify({original,exported:receipt.filePath,originalSha256:hash(raw),exportSha256:receipt.sha256,originalUnchanged:true,reopenedAfterExit:true,nativeIME:'NOT VERIFIED',clipboard:'controlled',dialog:'stubbed',area}));
  },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});


test('link text V1 inert clicks editing history export and readonly reopen',async({},info)=>{
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'link-label-e2e-')));
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');let original,raw,receipt,bytes;
  await usingDemo(async({app,page,root,snapshot,settled})=>{
    original=path.join(root,'link-original.md');raw=Buffer.from('\ufeff# Link text\r\n\r\nA [label](<https://example.test/a?q=1> "Keep title") tail.\r\n\r\n- [list label](../other.md#section) end.\r\n- Next item.\r\n\r\n[danger](javascript:alert(1))\r\n\r\n[**nested**](target)\r\n\r\nOrdinary paragraph.\r\n');
    await fs.writeFile(original,raw,{flag:'wx',mode:0o400});
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
    await page.locator('#empty-open').click();const originalId=await page.locator('#documents').inputValue(),url=page.url();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    await expect(page.locator('#editor a')).toHaveCount(0);await expect(page.locator('#editor [data-document-link]')).toHaveCount(3);
    await page.locator('#editor [data-document-link]').first().click();await page.keyboard.press('Meta+Enter');
    expect(page.url()).toBe(url);expect((await snapshot(originalId)).ok).toBe(true);expect(app.windows()).toHaveLength(1);
    await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue();
    const source=async()=>(await snapshot(id)).snapshot.source,before=await source();
    const range=async(selector,from,to=from,reverse=false)=>{
      const positions=await page.locator(selector).evaluate((p,r)=>{
        const root=p.closest('.tiptap');function at(n){const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;
          while(node=w.nextNode()){if(n<=node.length)return[node,n];n-=node.length;}return[p,0];}
        const a=at(r.from),b=at(r.to);root.focus();window.getSelection().setBaseAndExtent(...(r.reverse?b:a),...(r.reverse?a:b));document.dispatchEvent(new Event('selectionchange'));
        return[root.editor.view.posAtDOM(...a),root.editor.view.posAtDOM(...b)];
      },{from,to,reverse});
      await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(positions);
    };
    const key=async(k,expected)=>{await page.keyboard.press(k);await expect.poll(source).toBe(expected);};
    const label='#editor .tiptap > p:first-of-type [data-document-link]';
    await range(label,2);await page.keyboard.type('X');const typed=before.replace('[label]','[laXbel]');await expect.poll(source).toBe(typed);
    await key('Backspace',before);await key('Meta+z',typed);await key('Meta+Shift+z',before);
    await range(label,0,5,true);await page.keyboard.insertText('中文😀');const replaced=before.replace('[label]','[中文😀]');await expect.poll(source).toBe(replaced);
    await key('Meta+z',before);await key('Meta+Shift+z',replaced);
    // Failed whole-label deletion/cross-link replacement/split never poisons later input.
    await range(label,0,4);await key('Backspace',replaced);await range('#editor .tiptap > p:first-of-type',1,4);await page.keyboard.insertText('No');await settled();expect(await source()).toBe(replaced);
    await range(label,1);await key('Enter',replaced);await page.keyboard.insertText('新');const continued=replaced.replace('中文','中新文');await expect.poll(source).toBe(continued);
    await range('#editor li:first-child [data-document-link]',2);await page.locator('#editor .tiptap').evaluate(n=>{const data=new DataTransfer();data.setData('text/plain','字');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
    const pasted=continued.replace('[list label]','[li字st label]');await expect.poll(source).toBe(pasted);
    await range('#editor .tiptap > p:last-of-type',9);await page.keyboard.insertText('more ');const final=pasted.replace('Ordinary paragraph.','Ordinary more paragraph.');await expect.poll(source).toBe(final);
    await page.locator('#editor .tiptap > p:nth-of-type(2) [data-document-link]').click({modifiers:['Meta']});expect(page.url()).toBe(url);expect(app.windows()).toHaveLength(1);expect((await snapshot(id)).ok).toBe(true);
    await page.locator('#editor pre').click();await page.keyboard.type('Blocked');await settled();expect(await source()).toBe(final);
    await selectDocument(page,originalId);expect((await snapshot(originalId)).snapshot.source).toBe(before);await selectDocument(page,id);await page.keyboard.press('Escape');
    await key('Meta+z',pasted);await key('Meta+Shift+z',final);
    await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);
    expect(bytes).toEqual(Buffer.from('\ufeff'+final));expect(hash(bytes)).toBe(receipt.sha256);expect(saved.dirty).toBe(true);expect(await fs.readFile(original)).toEqual(raw);expect((await fs.stat(original)).mode&0o777).toBe(0o400);
    await captureTestWindow(app,info.outputPath('link-text.png'));
  },info,null,true,true,false,null,{root:path.join(area,'drafts')});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    const id=await page.locator('#documents').inputValue(),reopened=(await snapshot(id)).snapshot;expect(Buffer.from('\ufeff'+reopened.source)).toEqual(bytes);
    await expect(page.locator('#editor [data-document-link]').first()).toHaveText('中新文😀');await expect(page.locator('#editor a')).toHaveCount(0);
    await page.locator('#editor [data-document-link]').first().click();expect((await snapshot(id)).ok).toBe(true);expect(await fs.readFile(original)).toEqual(raw);
    console.log('link-evidence:'+JSON.stringify({original,exported:receipt.filePath,originalSha256:hash(raw),exportSha256:receipt.sha256,originalUnchanged:true,mode:'0400',reopenedAfterExit:true,nativeIME:'NOT VERIFIED',clipboard:'controlled',dialog:'stubbed',area}));
  },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});

test('block input V1 blank draft heading list typing history export and reopen',async({},info)=>{
  const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'block-input-e2e-')));
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');let receipt,bytes;
  await usingDemo(async({app,page,snapshot,settled})=>{
    await page.locator('#empty-new').click();const id=await page.locator('#documents').inputValue();
    const source=async()=>(await snapshot(id)).snapshot.source;
    await page.locator('#editor .tiptap > p').click();
    // No IPC waits between the marker, Space and subsequent ordinary keystrokes.
    await page.keyboard.type('# Title');await expect.poll(source).toBe('# Title');
    await expect(page.locator('#editor h1')).toHaveText('Title');
    await page.keyboard.press('Enter');await expect.poll(source).toBe('# Title\n\n');
    await page.keyboard.type('- First');await expect.poll(source).toBe('# Title\n\n- First');
    await page.keyboard.press('Enter');await expect.poll(source).toBe('# Title\n\n- First\n- ');
    await page.keyboard.type('Second');await expect.poll(source).toBe('# Title\n\n- First\n- Second');
    await page.keyboard.press('Enter');await settled();await page.keyboard.press('Enter');await settled();
    await page.keyboard.type('3) Numbered');const numbered='# Title\n\n- First\n- Second\n\n3) Numbered';
    await expect.poll(source).toBe(numbered);await expect(page.locator('#editor ol')).toHaveAttribute('start','3');
    await page.keyboard.press('Enter');await settled();await page.keyboard.press('Enter');await settled();
    const base=await source();await page.keyboard.type('###### ');await expect.poll(source).toBe(base+'###### ');
    await expect(page.locator('#editor h6')).toHaveText('');
    await page.keyboard.press('Meta+z');await expect.poll(source).toBe(base+'######');
    await page.keyboard.press('Meta+Shift+z');await expect.poll(source).toBe(base+'###### ');
    await page.keyboard.press('Enter');await expect.poll(source).toBe(base);
    await page.keyboard.press('Meta+z');await expect.poll(source).toBe(base+'###### ');
    await page.keyboard.insertText('末尾');await expect.poll(source).toBe(base+'###### 末尾');
    await page.locator('#editor h6').evaluate(p=>{p.closest('.tiptap').focus();const s=getSelection();s.collapse(p.firstChild,0);document.dispatchEvent(new Event('selectionchange'));});
    await page.keyboard.press('Backspace');await expect.poll(source).toBe(base+'末尾');
    await page.locator('#format-block').selectOption('heading-4');await expect.poll(source).toBe(base+'#### 末尾');
    const final=await source();await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
    const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);
    expect(bytes).toEqual(Buffer.from(final));expect(hash(bytes)).toBe(receipt.sha256);expect(saved.dirty).toBe(true);
    await captureTestWindow(app,info.outputPath('block-input.png'));
  },info,null,true,true,false,null,{root:path.join(area,'drafts')});
  await usingDemo(async({app,page,snapshot})=>{
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    expect(Buffer.from((await snapshot(await page.locator('#documents').inputValue())).snapshot.source)).toEqual(bytes);
    await expect(page.locator('#editor h1')).toHaveText('Title');await expect(page.locator('#editor h4')).toHaveText('末尾');
    await expect(page.locator('#editor li')).toHaveCount(3);
    console.log('block-input-evidence:'+JSON.stringify({exported:receipt.filePath,sha256:receipt.sha256,reopenedAfterExit:true,nativeIME:'NOT VERIFIED',dialog:'stubbed',area}));
  },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});

test('link panel V1 insert edit cancel remove stale guard export and reopen',async({},info)=>{
 const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'link-panel-e2e-')));
 const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');let original,raw,receipt,bytes;
 await usingDemo(async({app,page,root,snapshot,settled})=>{
  original=path.join(root,'link-panel-original.md');raw=Buffer.from('\ufeff# Title\r\n\r\nFirst word tail.\r\n\r\nA [label](a(b) "Keep title") Z\r\n\r\n- List item\r\n');
  await fs.writeFile(original,raw,{flag:'wx',mode:0o400});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
  await page.locator('#empty-open').click();await expect(page.locator('#format-link')).toBeHidden();
  await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue(),url=page.url();
  const source=async()=>(await snapshot(id)).snapshot.source,before=await source();
  const range=async(selector,from,to=from)=>{
   const positions=await page.locator(selector).evaluate((p,r)=>{const root=p.closest('.tiptap'),node=p.firstChild;root.focus();
    getSelection().setBaseAndExtent(node,r.to,node,r.from);document.dispatchEvent(new Event('selectionchange'));
    return[root.editor.view.posAtDOM(node,r.from),root.editor.view.posAtDOM(node,r.to)];},{from,to});
   await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(positions);
  };
  const key=async(k,expected)=>{await page.keyboard.press(k);await expect.poll(source).toBe(expected);};
  await range('#editor .tiptap > p:first-of-type',6,10);await page.keyboard.press('Meta+k');
  await expect(page.locator('#link-dialog')).toBeVisible();await expect(page.locator('#link-label')).toHaveValue('word');
  await page.locator('#link-href').fill('javascript:alert(1)');await page.locator('#link-apply').click();
  await expect(page.locator('#link-error')).toContainText('有效');expect(await source()).toBe(before);
  await page.locator('#link-href').fill('https://example.test/created');
  // Input-method guard is controlled here; this is not a native IME acceptance.
  await page.locator('#link-label').dispatchEvent('compositionstart');await expect(page.locator('#link-apply')).toBeDisabled();
  await page.keyboard.press('Enter');expect(await source()).toBe(before);await page.locator('#link-label').dispatchEvent('compositionend');
  await page.locator('#link-apply').click();const created=before.replace('word','[word](<https://example.test/created>)');
  await expect(page.locator('#link-dialog')).not.toBeVisible();await expect.poll(source).toBe(created);
  await key('Meta+z',before);await key('Meta+Shift+z',created);
  await range('#editor .tiptap > p:first-of-type [data-document-link]',2);await page.locator('#format-link').click();
  await page.locator('#link-href').fill('#cancelled');await page.keyboard.press('Escape');await expect(page.locator('#link-dialog')).not.toBeVisible();expect(await source()).toBe(created);
  // Existing title bytes are retained when the address is changed.
  await range('#editor .tiptap > p:nth-of-type(2) [data-document-link]',2);await page.keyboard.press('Meta+k');
  await expect(page.locator('#link-href')).toHaveValue('a(b)');await page.locator('#link-label').fill('新文字');await page.locator('#link-href').fill('../other.md#section');
  await page.screenshot({path:info.outputPath('link-panel.png')});
  await page.locator('#link-apply').click();const changed=created.replace('[label](a(b) "Keep title")','[新文字](<../other.md#section> "Keep title")');await expect.poll(source).toBe(changed);
  await range('#editor .tiptap > p:nth-of-type(2) [data-document-link]',1);await page.keyboard.press('Meta+k');await page.locator('#link-remove').click();
  const removed=changed.replace('[新文字](<../other.md#section> "Keep title")','新文字');await expect.poll(source).toBe(removed);
  await key('Meta+z',changed);await key('Meta+Shift+z',removed);await key('Meta+z',changed);
  // A real revision change after opening the form cannot be overwritten by its captured selection.
  await range('#editor .tiptap > p:first-of-type [data-document-link]',2);await page.keyboard.press('Meta+k');await page.locator('#link-label').fill('Retained form');
  const s=(await snapshot(id)).snapshot;
  const result=await page.evaluate(q=>window.documentDemo.edit(q),{sessionId:id,expectedRevision:s.revision,from:2,to:2,insert:'X'});expect(result.ok).toBe(true);
  await page.locator('#link-apply').click();await expect(page.locator('#link-error')).toContainText('未确认');await expect(page.locator('#link-label')).toHaveValue('Retained form');
  expect(await source()).toBe(result.snapshot.source);await page.locator('#link-cancel').click();
  // Ordinary editing remains possible after a declined form operation.
  await range('#editor li p',4);await page.keyboard.insertText('more ');const final=result.snapshot.source.replace('List item','Listmore  item');await expect.poll(source).toBe(final);
  await page.locator('#editor [data-document-link]').first().click();expect(page.url()).toBe(url);expect(app.windows()).toHaveLength(1);await expect(page.locator('#editor a')).toHaveCount(0);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
  await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');receipt=(await snapshot(id)).snapshot.copyState;bytes=await fs.readFile(receipt.filePath);
  expect(bytes).toEqual(Buffer.from('\ufeff'+final));expect(hash(bytes)).toBe(receipt.sha256);expect(await fs.readFile(original)).toEqual(raw);expect((await fs.stat(original)).mode&0o777).toBe(0o400);
 },info,null,true,true,false,null,{root:path.join(area,'drafts')});
 await usingDemo(async({app,page,snapshot})=>{
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
  await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  expect(Buffer.from('\ufeff'+(await snapshot(await page.locator('#documents').inputValue())).snapshot.source)).toEqual(bytes);
  await expect(page.locator('#editor [data-document-link]')).toHaveCount(2);await expect(page.locator('#editor a')).toHaveCount(0);expect(await fs.readFile(original)).toEqual(raw);
  console.log('link-panel-evidence:'+JSON.stringify({original,exported:receipt.filePath,originalSha256:hash(raw),exportSha256:receipt.sha256,originalUnchanged:true,reopenedAfterExit:true,nativeIME:'NOT VERIFIED',dialog:'stubbed',area}));
 },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});

test('quote code V1 natural creation editing history export and reopen',async({},info)=>{
 const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'quote-code-e2e-')));
 const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');let receipt,bytes;
 await usingDemo(async({app,page,snapshot,settled})=>{
  await page.locator('#empty-new').click();const id=await page.locator('#documents').inputValue();
  const source=async()=>(await snapshot(id)).snapshot.source;
  await page.locator('#editor .tiptap > p').click();await page.keyboard.type('> First');await expect.poll(source).toBe('> First');
  await expect(page.locator('#editor blockquote p')).toHaveText('First');
  await page.keyboard.press('Enter');await page.keyboard.type('Second');await expect.poll(source).toBe('> First\n> \n> Second');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('```js');await page.keyboard.press('Enter');
  await expect.poll(source).toBe('> First\n> \n> Second\n\n```js\n```');
  await page.keyboard.type('const x = [];');await page.keyboard.press('Enter');await page.keyboard.press('Tab');await page.keyboard.type('x.push(1);');
  const base='> First\n> \n> Second\n\n```js\nconst x = [];\n\tx.push(1);\n```';await expect.poll(source).toBe(base);
  await page.locator('#editor .tiptap').evaluate(root=>{const data=new DataTransfer();data.setData('text/plain','\n\n\t// 中文');root.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  const pasted=base.replace('x.push(1);','x.push(1);\n\n\t// 中文');await expect.poll(source).toBe(pasted);
  await page.keyboard.press('Meta+z');await expect.poll(source).toBe(base);await page.keyboard.press('Meta+Shift+z');await expect.poll(source).toBe(pasted);
  await page.keyboard.press('Meta+Enter');await page.keyboard.type('After code');await expect.poll(source).toBe(pasted+'\n\nAfter code');
  // Same toolbar handles conversion back to prose, without touching the previous code.
  await page.locator('#format-block').selectOption('blockquote');await expect.poll(source).toBe(pasted+'\n\n> After code');
  await page.locator('#format-block').selectOption('paragraph');const final=pasted+'\n\nAfter code';await expect.poll(source).toBe(final);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();
  await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);
  expect(bytes).toEqual(Buffer.from(final));expect(hash(bytes)).toBe(receipt.sha256);expect(saved.dirty).toBe(true);
  await captureTestWindow(app,info.outputPath('quote-code.png'));
 },info,null,true,true,false,null,{root:path.join(area,'drafts')});
 await usingDemo(async({app,page,snapshot})=>{
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},receipt.filePath);
  await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  expect(Buffer.from((await snapshot(await page.locator('#documents').inputValue())).snapshot.source)).toEqual(bytes);
  await expect(page.locator('#editor blockquote p')).toHaveCount(2);await expect(page.locator('#editor pre code')).toHaveText('const x = [];\n\tx.push(1);\n\n\t// 中文');
  console.log('quote-code-evidence:'+JSON.stringify({exported:receipt.filePath,sha256:receipt.sha256,reopenedAfterExit:true,nativeIME:'NOT VERIFIED',dialog:'stubbed',area}));
 },info,null,true,false,false,null,{root:path.join(area,'reopen-drafts')});
});

test('quote code V1 loaded CRLF blocks preserve original and reject unsupported edits',async({},info)=>{
 const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'quote-code-loaded-e2e-')));
 await usingDemo(async({app,page,root,snapshot,settled})=>{
  const file=path.join(root,'quote-code-original.md'),raw=Buffer.from('\ufeff> First **bold** tail\r\n> \r\n> Second\r\n\r\n```js\r\nconst x = 1;\r\n```\r\n\r\n```js metadata\r\nProtected bytes\r\n```\r\n');
  await fs.writeFile(file,raw,{flag:'wx',mode:0o400});await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},file);
  await page.locator('#empty-open').click();await page.locator('#edit-copy').click();const id=await page.locator('#documents').inputValue(),source=async()=>(await snapshot(id)).snapshot.source,before=await source();
  const range=async(selector,from,to=from)=>{
   const positions=await page.locator(selector).evaluate((p,r)=>{const root=p.closest('.tiptap'),n=p.firstChild;root.focus();getSelection().setBaseAndExtent(n,r.from,n,r.to);document.dispatchEvent(new Event('selectionchange'));return[root.editor.view.posAtDOM(n,r.from),root.editor.view.posAtDOM(n,r.to)];},{from,to});
   await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(positions);
  };
  await range('#editor blockquote strong',0,4);await page.keyboard.insertText('粗体');await expect.poll(source).toBe(before.replace('bold','粗体'));
  await range('#editor pre:first-of-type code',0,12);await page.keyboard.press('Backspace');const cleared=before.replace('bold','粗体').replace('const x = 1;','');await expect.poll(source).toBe(cleared);
  await page.keyboard.type('a');await page.keyboard.press('Enter');await page.keyboard.type('b');const typed=cleared.replace('```js\r\n\r\n```','```js\r\na\r\nb\r\n```');await expect.poll(source).toBe(typed);
  await page.keyboard.press('Meta+z');await expect.poll(source).toBe(typed.replace('a\r\nb','a\r\n'));await page.keyboard.press('Meta+Shift+z');await expect.poll(source).toBe(typed);
  await range('#editor pre:first-of-type code',0,3);await page.keyboard.insertText('```\n# escape');await settled();expect(await source()).toBe(typed);
  await expect(page.locator('#editor pre').last()).toHaveAttribute('contenteditable','false');await page.locator('#editor pre').last().click();await page.keyboard.type('REFUSE');await settled();expect(await source()).toBe(typed);
  await range('#editor pre:first-of-type code',3);await page.keyboard.type('c');const final=typed.replace('a\r\nb','a\r\nbc');await expect.poll(source).toBe(final);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
  const receipt=(await snapshot(id)).snapshot.copyState;expect(await fs.readFile(receipt.filePath)).toEqual(Buffer.from('\ufeff'+final));expect(await fs.readFile(file)).toEqual(raw);expect((await fs.stat(file)).mode&0o777).toBe(0o400);
  console.log('quote-code-loaded-evidence:'+JSON.stringify({original:file,exported:receipt.filePath,sha256:receipt.sha256,originalUnchanged:true,crlfPreserved:true,area}));
 },info,null,true,true,false,null,{root:path.join(area,'drafts')});
});


test('common authoring closeout mixed document export restart recovery and continued editing',async({},info)=>{
 const area=await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(),'common-authoring-e2e-'))),draftRoot=path.join(area,'drafts');
 let expected,receipt,bytes,draftId;
 await usingDemo(async({app,page,snapshot})=>{
  await page.locator('#empty-new').click();const id=await page.locator('#documents').inputValue();
  expected=await authorMixedDocument(page,async()=>(await snapshot(id)).snapshot.source);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snapshot(id)).snapshot.copyState.state).toBe('created-confirmed');
  const saved=(await snapshot(id)).snapshot;receipt=saved.copyState;bytes=await fs.readFile(receipt.filePath);expect(bytes).toEqual(Buffer.from(expected));expect(saved.dirty).toBe(true);
  await page.locator('#open-confirmed-copy').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');expect((await snapshot(await page.locator('#documents').inputValue())).snapshot.source).toBe(expected);
  await selectDocument(page,id);await page.keyboard.press('Escape');await expect.poll(async()=>(await snapshot(id)).snapshot.draftBackup.state).toBe('backed-up');
  draftId=await page.evaluate(label=>window.documentDemo.listDrafts().then(r=>r.drafts.find(d=>d.label===label)?.id),saved.label);expect(typeof draftId).toBe('string');
  await captureTestWindow(app,info.outputPath('mixed-document.png'));
 },info,null,true,true,false,null,{root:draftRoot});
 await usingDemo(async({app,page,snapshot})=>{
  await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
  const id=await page.locator('#documents').inputValue(),restored=(await snapshot(id)).snapshot;expect(restored.source).toBe(expected);expect(restored.canUndo).toBe(false);expect(restored.confirmedCopy ?? null).toBeNull();
  await page.locator('#editor .tiptap > p').last().click();await page.keyboard.press('End');await page.keyboard.insertText(' Continued.');await expect.poll(async()=>(await snapshot(id)).snapshot.source).toBe(expected+' Continued.');
  await page.keyboard.press('Meta+z');await expect.poll(async()=>(await snapshot(id)).snapshot.source).toBe(expected);expect(await fs.readFile(receipt.filePath)).toEqual(bytes);
  console.log('common-authoring-evidence:'+JSON.stringify({exported:receipt.filePath,sha256:receipt.sha256,draftRoot,draftId,restartRecovery:true,laterEditDoesNotChangeExport:true,nativeIME:'NOT VERIFIED',dialog:'stubbed'}));
 },info,null,true,false,false,null,{root:draftRoot});
});
