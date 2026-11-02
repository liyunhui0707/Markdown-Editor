const { test, expect, _electron: electron } = require('@playwright/test');
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
async function usingDemo(body, info, secondSource = null, readOnly = false, testCopy = false, persistentCopy = false) {
  if (!process.env.E2E_ELECTRON_EXECUTABLE) throw Error('An explicit isolated Electron executable is required');
  const env = {}; for (const k of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  let entry = process.env.DOCUMENT_DEMO_ENTRY || path.join(desktop, 'lib/document-demo-main.js');
  if (secondSource !== null) {
    // Same actual main lifecycle/IPC; substitute only one synthetic fixture before launch.
    const source = await fs.readFile(entry, 'utf8');
    const needle = "  ['b.md', '# Second synthetic document\\n\\nOriginal second body.\\n'],";
    if (source.split(needle).length !== 2) throw Error('Unknown synthetic fixture definition');
    const fixtureSource = source.replace(needle, `  ['b.md', ${JSON.stringify(secondSource)}],`);
    const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'document-fixture-entry-'));
    await fs.chmod(root, 0o700);
    const wrapper = path.join(root, 'main.cjs');
    await fs.writeFile(wrapper, `const {Module}=require('node:module');const file=${JSON.stringify(entry)};
      const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(require('node:path').dirname(file));
      m._compile(${JSON.stringify(fixtureSource)},file);`, { mode: 0o600, flag: 'wx' });
    entry = wrapper;
  }
  let copyRoot = null;
  if (testCopy) {
    if (!readOnly) throw Error('Copy test requires the document window');
    copyRoot = await fs.realpath(await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'document-safe-create-')));
    await fs.chmod(copyRoot, 0o700);
  }
  const app = await electron.launch({ executablePath: process.env.E2E_ELECTRON_EXECUTABLE,
    args: readOnly ? [path.join(desktop, 'main.js'), '--document-readonly', ...(testCopy ? [persistentCopy ? '--document-persistent-copy' : '--document-test-copy'] : [])] : [entry], cwd: copyRoot || desktop, env, chromiumSandbox: true });
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
    const page = await app.firstWindow(); await page.bringToFront();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
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
    const finalSessions = (await page.evaluate(() => window.documentDemo.list())).sessions;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.emit('did-start-loading'));
    for (const s of finalSessions) expect((await snapshot(s.sessionId)).ok).toBe(false);
    if (await page.locator('#editor .tiptap').count()) {
      await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
      expect(JSON.parse(await page.locator('#status').textContent()).locked).toBe(true);
    } else await expect(page.locator('#connect')).toBeDisabled(); // Reload has no new main grant.
    functional = true;
  } finally {
    if (group === child.pid) ids = [...new Set([...ids, ...owned(child.pid)])];
    timer = setTimeout(() => { watchdog = true; if (group === child.pid && !gone(-group)) process.kill(-group, 'SIGKILL'); else if (!gone(child.pid)) child.kill('SIGKILL'); }, 45000);
    try {
      await app.close(); const result = await closed, deadline = Date.now() + 3000;
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
  await page.locator('#documents').selectOption(b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await fail(b, 'B-UNACCEPTED', 'B'); await expect(page.locator('#recovery')).not.toContainText('FIRST-UNACCEPTED');
  await page.locator('#documents').selectOption(a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await expect(page.locator('#recovery')).toContainText('FIRST-UNACCEPTED'); await expect(page.locator('#recovery')).not.toContainText('B-UNACCEPTED');
  const before = (await snapshot(a)).snapshot;
  await page.locator('#recovery-panel > summary').click();
  await page.locator('#recovery-record').selectOption({ index: 0 });
  await page.getByRole('button', { name: 'Discard selected recovery record' }).click();
  await expect(page.locator('#recovery')).not.toContainText('FIRST-UNACCEPTED');
  await expect(page.locator('#recovery')).toContainText('SECOND-UNACCEPTED');
  expect((await snapshot(a)).snapshot).toEqual(before);
  await page.locator('#documents').selectOption(b); await expect(page.locator('#recovery')).toContainText('B-UNACCEPTED');
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
      await h.page.locator('#documents').selectOption(id);
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
  await page.locator('#documents').selectOption(b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await page.locator('#documents').selectOption(a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
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
  await page.locator('#documents').selectOption(b); await expect(page.locator('#editor p')).toHaveText('Original second body.');
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
  await page.locator('#documents').selectOption(a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await select('#editor h1', 2); await page.keyboard.insertText('A-AFTER-REFUSAL'); await settled();
  expect((await snapshot(a)).snapshot.source).toContain('A-AFTER-REFUSAL');
  await page.locator('#documents').selectOption(b); await expect(page.locator('#documents')).toHaveValue(a);
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
  await page.locator('#documents').selectOption(b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await page.locator('#documents').selectOption(a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
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
  await page.locator('#documents').selectOption(b);
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
  await page.locator('#documents').selectOption(a); await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await app.evaluate((_, id) => { globalThis.p1SnapshotGate.reject.add(id); }, b);
  await page.locator('#documents').selectOption(b); await expect(page.locator('#status')).toContainText('switch-failed:ipc-failed');
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
  await page.locator('#documents').selectOption(b); await expect(page.locator('#editor h1')).toHaveText('Second synthetic document');
  await expect(page.locator('#recovery')).not.toContainText('LOCAL-未确认😀');
  await page.locator('#documents').selectOption(a); await expect(page.locator('#recovery')).toContainText('LOCAL-未确认😀');
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
  await page.locator('#documents').selectOption(b);
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
  await page.locator('#documents').selectOption(a);await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
  await select('#editor h1',2);await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('unsafe-source-range');expect((await snapshot(a)).snapshot).toEqual(originalA);
  await page.locator('#documents').selectOption(b);await expect(page.locator('#editor p')).toHaveCount(2);
  expect((await snapshot(b)).snapshot.source).toBe(written);
  await page.getByRole('button',{name:'Request save (denied)'}).click();await expect(page.locator('#status')).toContainText('coordination-required');
},info));


for (const nl of ['\r\n','\n']) test(`CRLF P1 actual Backspace without final newline (${JSON.stringify(nl)})`, async ({},info)=>usingDemo(async h=>{
  const {page,sessions,snapshot,select,settled}=h,b=sessions[1].sessionId,original='first'+nl+nl+'second';
  await page.locator('#documents').selectOption(b);await expect(page.locator('#editor p')).toHaveCount(2);
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
  await choose({canceled:false,filePaths:[a]});await page.getByRole('button',{name:'Open Markdown…',exact:true}).click();
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
  await expect(page.locator('#viewer-status')).toContainText('cancelled');expect(await identity()).toBe(first);
  await choose({canceled:false,filePaths:[path.join(root,'missing.md')]});await page.locator('#open-file').click();
  await expect(page.locator('#viewer-status')).toContainText('no longer exists');expect(await identity()).toBe(first);
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


test('document UI V1 empty, Chinese and English layouts preserve readonly open flow', async ({},info)=>usingDemo(async h=>{
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
  const capture=async name=>{const file=info.outputPath(name+'.png');await page.screenshot({path:file,caret:'hide'});await info.attach(name,{path:file,contentType:'image/png'});};
  const layout=async label=>{
    const m=await page.evaluate(()=>{
      const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};};
      return {viewport:document.body.clientWidth,windowWidth:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,open:box('open-file'),badge:box('readonly-badge'),
        name:box('document-name'),editor:box('editor'),type:getComputedStyle(document.querySelector('#editor .tiptap')||document.body).fontSize};
    });metrics.push({label,...m});expect(m.overflow).toBeLessThanOrEqual(1);
    expect(m.open.right).toBeLessThanOrEqual(m.name.left);expect(m.name.right).toBeLessThanOrEqual(m.badge.left);
    expect(m.badge.right).toBeLessThanOrEqual(m.viewport);expect(m.name.height).toBeLessThan(30);
    expect(m.editor.width).toBeLessThanOrEqual(781);expect(Math.abs(m.editor.left-(m.viewport-m.editor.right))).toBeLessThanOrEqual(1);
  };
  await size(1050);await expect(page.locator('#empty-state')).toBeVisible();await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#document-info')).toBeHidden();await capture('ui-v1-empty-1050');
  await choose(a);await page.getByRole('button',{name:'Open Markdown file',exact:true}).click();
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
  await choose(null);await page.keyboard.press('Meta+o');await expect(page.locator('#viewer-status')).toContainText('cancelled');
  expect((await snapshot(id)).snapshot).toEqual(before);await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  await expect(page.locator('#editor script,#editor img,#editor a')).toHaveCount(0);expect(await page.evaluate(()=>window.__uiUnsafe)).toBeUndefined();
  await choose(a);await page.locator('#open-file').click();await expect(page.locator('#editor h1')).toHaveText('把文字放在中央');
  expect(await fs.readFile(a,'utf8')).toBe(cn);expect(await fs.readFile(b,'utf8')).toBe(en);
  await info.attach('ui-layout-metrics',{body:JSON.stringify(metrics),contentType:'application/json'});
  await info.attach('ui-synthetic-originals',{body:JSON.stringify({a,b,sha256A:require('node:crypto').createHash('sha256').update(cn).digest('hex'),sha256B:require('node:crypto').createHash('sha256').update(en).digest('hex')}),contentType:'application/json'});
},info,null,true));


test('document writing entry V1 keyboard paragraphs, temporary isolation and readonly safety', async ({},info)=>usingDemo(async h=>{
  const {app,page,root,snapshot,select,settled}=h;
  await app.evaluate(({dialog})=>{
    globalThis.closeChoice=1;globalThis.closePrompts=[];globalThis.writingChoices=[];
    dialog.showMessageBoxSync=(_win,options)=>{globalThis.closePrompts.push(options);return globalThis.closeChoice;};
    dialog.showOpenDialog=async()=>globalThis.writingChoices.shift();
  }); // Decisions are controlled; main's actual close event/guard and IPC remain in use.
  const id=async()=>JSON.parse(await page.locator('#status').textContent()).activeSessionId;
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.getByRole('button',{name:'New temporary document',exact:true}).click();
  const a=await id();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','true');
  await expect(page.locator('#temporary-notice')).toBeVisible();await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
  await page.getByRole('button',{name:'New temporary document',exact:true}).click();const b=await id();expect(b).not.toBe(a);
  await page.keyboard.insertText('Other temporary');await settled();
  await page.keyboard.press('Meta+z');await settled();expect((await snapshot(b)).snapshot.source).toBe('');
  expect((await snapshot(a)).snapshot).toEqual(aBefore);
  await page.locator('#documents').selectOption(a);await expect(page.locator('#editor p')).toHaveCount(2);
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
  await page.locator('#documents').selectOption(a);await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','true');
  await select('#editor p:first-of-type',first.length);await page.keyboard.insertText('!');await settled();
  await page.keyboard.press('Meta+z');await settled();expect((await snapshot(a)).snapshot.source).toBe(written);
  await app.evaluate(()=>globalThis.writingChoices.push({canceled:true,filePaths:[]}));await page.keyboard.press('Meta+o');
  await expect(page.locator('#viewer-status')).toContainText('cancelled');expect(await id()).toBe(a);
  // Genuine stale revision produces a protected local draft; switching never discards it.
  const current=(await snapshot(a)).snapshot;
  expect((await page.evaluate(data=>window.documentDemo.edit(data),{sessionId:a,expectedRevision:current.revision,from:1,to:2,insert:'X'})).ok).toBe(true);
  await select('#editor p:first-of-type',0,1);await page.keyboard.insertText('UNCONFIRMED');await settled();
  await expect(page.locator('#recovery-panel')).toBeVisible();await expect(page.locator('#recovery')).toContainText('UNCONFIRMED');
  await page.locator('#documents').selectOption(b);await expect(page.locator('#recovery-panel')).toBeHidden();
  await page.locator('#documents').selectOption(a);await expect(page.locator('#recovery')).toContainText('UNCONFIRMED');
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
    await page.getByRole('button', { name: 'New temporary document', exact: true }).click(); const temporary = await id();
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
    await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
    await select('#editor p:nth-of-type(2)', 'Second paragraph'.length); await page.keyboard.insertText(' later'); await settled();
    expect((await fs.readFile(receipt.filePath)).equals(original)).toBe(true);
    await expect(page.locator('#test-copy-result')).toContainText('revision ' + receipt.revision);
    expect((await snapshot(temporary)).snapshot.revision).toBeGreaterThan(receipt.revision);
    await page.keyboard.press('Meta+z'); await settled(); expect((await snapshot(temporary)).snapshot.source).toBe(written);
    await app.evaluate((_, file) => globalThis.copyChoices.push({ canceled: false, filePaths: [file] }), receipt.filePath);
    await page.keyboard.press('Meta+o'); await expect(page.locator('#readonly-badge')).toHaveText('Read-only');
    const real = (await snapshot(await id())).snapshot;
    await expect(page.locator('#create-test-copy')).toBeHidden();
    expect((await page.evaluate(s => window.documentDemo.createTestCopy({ sessionId: s.sessionId, expectedRevision: s.revision, expectedSha256: '0'.repeat(64) }), real)).code).toBe('read-only-document');
    expect((await page.evaluate(s => window.documentDemo.save({ sessionId: s.sessionId, expectedRevision: s.revision }), real)).code).toBe('read-only-document');
    await page.locator('#documents').selectOption(temporary); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'true');
    await app.evaluate(({ BrowserWindow }) => { globalThis.copyClose = 0; BrowserWindow.getAllWindows()[0].close(); });
    expect((await snapshot(temporary)).snapshot.source).toBe(written);
    await app.evaluate(() => { globalThis.copyClose = 1; });
    const shot = info.outputPath('test-copy-created.png'); await page.screenshot({ path: shot }); await info.attach('test-copy-created', { path: shot, contentType: 'image/png' });
  }, info, null, true, true);
  // The creator's actual OS process has exited (shared helper verifies code/signal/watchdog).
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, receipt.filePath);
    await page.locator('#open-file').click(); await expect(page.locator('#readonly-badge')).toHaveText('Read-only');
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
  const target = path.join(dir, 'persistent.md');
  let receipt, original;
  await usingDemo(async ({ app, page, snapshot, settled, select }) => {
    await page.locator('#new-temporary').click(); await expect(page.locator('#editor p')).toHaveCount(1);
    const id = () => page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
    await page.locator('#editor p').click(); await page.keyboard.type('First '); await page.keyboard.insertText('中文😀'); await settled();
    await page.keyboard.press('Enter'); await settled(); await page.keyboard.type('Second paragraph.'); await settled();
    const temporary = await id(), before = (await snapshot(temporary)).snapshot;
    expect(before.source).toBe('First 中文😀\n\nSecond paragraph.');
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
    expect(saveOptions.defaultPath).toBe('Untitled.md');
    expect(saveOptions.message).toContain('主文件夹、桌面、文稿、资源库及同步目录不受支持');
    expect(saveOptions.message).toContain('主文件夹直属');
    expect(saveOptions.message).toContain('下载等目录可能因 ACL 被拒绝');
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
    await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
  }, info, null, true, true, true);
  await usingDemo(async ({ app, page, snapshot }) => {
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
    await page.locator('#open-file').click(); await expect(page.locator('#document-name')).toHaveText('persistent.md');
    const id = await page.evaluate(() => JSON.parse(document.querySelector('#status').textContent).activeSessionId);
    const reopened = (await snapshot(id)).snapshot; expect(reopened.readOnly).toBe(true); expect(reopened.source).toBe(original.toString());
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false'); await expect(page.locator('#create-test-copy')).toBeHidden();
    for (const op of ['save','createPersistentCopy']) expect((await page.evaluate(async ({ op, id, revision }) => window.documentDemo[op]({ sessionId: id, expectedRevision: revision }), { op, id, revision: reopened.revision })).code).toBe('read-only-document');
    expect((await fs.readFile(target)).equals(original)).toBe(true);
  }, info, null, true);
  // Both Electron processes and their sessions have exited; no cleanup on failure.
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
    await page.locator('#edit-copy').click(); await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
    await page.locator('#documents').selectOption(original);
    await expect(page.locator('#readonly-badge')).toHaveText('Read-only');
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
    for (const operation of ['edit','save','createPersistentCopy']) {
      const r = await page.evaluate(({ operation, id }) => window.documentDemo[operation]({ sessionId: id, expectedRevision: 0 }), { operation, id: original });
      expect(r.code).toBe('read-only-document');
    }
    expect((await snapshot(original)).snapshot).toEqual(originalSnapshot);
    await page.locator('#documents').selectOption(copy); await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
    await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
    expect((await fs.readFile(originalPath)).equals(bytes)).toBe(true);
    const current = (await snapshot(copy)).snapshot;
    await page.locator('#documents').selectOption(original);
    await expect(page.locator('#test-copy-panel')).toBeHidden();
    await page.locator('#documents').selectOption(copy);
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
  await expect(page.locator('#documents')).toHaveValue(original); await expect(page.locator('#readonly-badge')).toHaveText('Read-only');
  await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  await page.locator('#editor p').click(); await page.keyboard.type('MUST NOT WRITE');
  expect((await snapshot(original)).snapshot).toEqual(originalState);
  await page.locator('#documents').selectOption(temp); await expect(page.locator('#recovery')).toHaveText(savedDraft);
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
  await expect(page.locator('#readonly-badge')).toHaveText('Not saved'); const copy = await active();
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
    await page.locator('#documents').selectOption(originalId); await expect(page.locator('#readonly-badge')).toHaveText('Read-only');
    await page.locator('#documents').selectOption(copy); await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
    await page.locator('#edit-copy').click();await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
    await expect(page.locator('#viewer-status')).toContainText('Edit not applied');
    expect((await snapshot(copy)).snapshot).toEqual(beforeReject);
    await select('#editor p:first-of-type',2);await page.keyboard.press('Enter');
    await expect(page.locator('#viewer-status')).toContainText('Edit not applied');
    expect((await snapshot(copy)).snapshot).toEqual(beforeReject);
    await select('#editor p:first-of-type',second+3);await page.keyboard.type('Y');await settled();
    await expect(page.locator('#viewer-status')).not.toContainText('Edit not applied');
    const expected=changed.replace('新😀econd','新😀Yecond');
    expect((await snapshot(copy)).snapshot.source).toBe(expected);
    await expect(page.locator('#editor pre').last()).toHaveAttribute('contenteditable','false');
    await page.locator('#documents').selectOption(original);await expect(page.locator('#readonly-badge')).toHaveText('Read-only');
    expect((await snapshot(original)).snapshot).toEqual(originalSnapshot);
    expect((await page.evaluate(id=>window.documentDemo.save({sessionId:id,expectedRevision:0}),original)).code).toBe('read-only-document');
    await page.locator('#documents').selectOption(copy);await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
    await page.locator('#edit-copy').click(); await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
    await paste('one\ntwo'); await expect(page.locator('#viewer-status')).toContainText('没有截断内容');
    expect((await snapshot(copy)).snapshot).toEqual(beforeReject);
    await select('#editor p:last-of-type', 7); await page.keyboard.type(' next'); await settled();
    await page.keyboard.press('Enter'); await page.keyboard.type('Third.'); await settled();
    await page.keyboard.press('Meta+ArrowLeft'); await page.keyboard.press('Backspace'); await settled();
    await page.keyboard.press('Meta+z'); await settled(); await page.keyboard.press('Meta+Shift+z'); await settled();
    await page.locator('#documents').selectOption(original); await expect(page.locator('#readonly-badge')).toHaveText('Read-only');
    await select('#editor p:first-of-type', 2); await paste('NO');
    expect((await snapshot(original)).snapshot.source).toBe('First.\r\n\r\nSecond.');
    expect((await page.evaluate(id => window.documentDemo.save({ sessionId: id, expectedRevision: 0 }), original)).code).toBe('read-only-document');
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    await page.locator('#documents').selectOption(copy); await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
    await expect(page.locator('#readonly-badge')).toHaveText('Not saved');
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
  const roles = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Edit').submenu.items.map(i => i.role));
  expect(roles).toContain('paste');
}, info, null, true));
