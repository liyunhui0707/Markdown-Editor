const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
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
async function usingDemo(body, info) {
  if (!process.env.E2E_ELECTRON_EXECUTABLE) throw Error('An explicit isolated Electron executable is required');
  const env = {}; for (const k of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG']) if (process.env[k]) env[k] = process.env[k];
  const app = await electron.launch({ executablePath: process.env.E2E_ELECTRON_EXECUTABLE,
    args: [process.env.DOCUMENT_DEMO_ENTRY || path.join(desktop, 'lib/document-demo-main.js')], cwd: desktop, env, chromiumSandbox: true });
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
    const bytes = await Promise.all(['a.md', 'b.md'].map(f => fs.readFile(path.join(root, f))));
    const page = await app.firstWindow(); await page.bringToFront();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.getByRole('button', { name: 'Connect synthetic documents' }).click();
    await expect(page.locator('#editor h1')).toHaveText('合成标题😀');
    const sessions = (await page.evaluate(() => window.documentDemo.list())).sessions;
    const snapshot = id => page.evaluate(sessionId => window.documentDemo.snapshot({ sessionId }), id);
    const select = (selector, from, to = from) => page.locator(selector).evaluate((node, range) => {
      node.closest('.tiptap').focus(); const r = document.createRange();
      r.setStart(node.firstChild, range.from); r.setEnd(node.firstChild, range.to);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange'));
    }, { from, to });
    const settled = () => expect.poll(async () => JSON.parse(await page.locator('#status').textContent()).pending).toBe(0);
    const { projectSource } = await import(pathToFileURL(path.join(desktop, 'lib/document-source-map.mjs')).href);
    await body({ app, page, sessions, snapshot, select, settled, projectSource });
    for (const [i, f] of ['a.md', 'b.md'].entries()) expect((await fs.readFile(path.join(root, f))).equals(bytes[i])).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.emit('did-start-loading'));
    for (const s of sessions) expect((await snapshot(s.sessionId)).ok).toBe(false);
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
        isPackaged: identity?.isPackaged, entry: process.env.DOCUMENT_DEMO_ENTRY ? 'actual-asar' : 'source' };
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
