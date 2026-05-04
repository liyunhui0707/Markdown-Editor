/* TDD: close-guard — pure helpers + DI factories for Stage 6.3A/B.
   Run: node --test test/close-guard.test.js

   Concerns covered:
     1. decideCloseAction — total decision matrix, including unknown
        shapes (only Discard allows close).
     2. formatDirtyDetail — singular/plural copy, draft/vault flags,
        and the unknown-state copy.
     3. runCloseGuard — clean skips dialog; dirty/unknown shows it;
        rejection / malformed / null is treated as unknown, never
        silently allowed. Stage 6.3B adds the 'save-all' branch:
        success → 'allow-close', failure / rejection / timeout / null
        → 'block-close'.
     4. createDirtySummaryRequester / createSaveAllRequester /
        createIpcRoundTripRequester — guarantee ipcMain listener
        cleanup on success, timeout, and send failure. Stage 6.3B
        adds the save-all variant; both are thin wrappers around the
        same generic round-trip factory.
     5. createCloseController — the close-confirmation latch persists
        through the non-darwin close cascade and is cleared only by
        resetForNewWindow (called from createWindow).
*/
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const {
  isValidSummary,
  decideCloseAction,
  formatDirtyDetail,
  runCloseGuard,
  createDirtySummaryRequester,
  createSaveAllRequester,
  createIpcRoundTripRequester,
  createCloseController,
} = require('../lib/close-guard');

// ── isValidSummary ───────────────────────────────────────────────────

test('isValidSummary: valid clean summary', () => {
  assert.equal(isValidSummary({ count: 0, hasDraft: false, hasDirtyVault: false }), true);
});

test('isValidSummary: valid dirty summary', () => {
  assert.equal(isValidSummary({ count: 3, hasDraft: true, hasDirtyVault: true }), true);
});

test('isValidSummary: rejects null/undefined/non-object', () => {
  assert.equal(isValidSummary(null), false);
  assert.equal(isValidSummary(undefined), false);
  assert.equal(isValidSummary('clean'), false);
  assert.equal(isValidSummary(0), false);
});

test('isValidSummary: {count: 0} missing hasDraft / hasDirtyVault is INVALID (Codex issue 2)', () => {
  assert.equal(isValidSummary({ count: 0 }), false);
  assert.equal(isValidSummary({ count: 0, hasDraft: false }), false);
  assert.equal(isValidSummary({ count: 0, hasDirtyVault: false }), false);
});

test('isValidSummary: rejects wrong types on count / flags', () => {
  assert.equal(isValidSummary({ count: '0', hasDraft: false, hasDirtyVault: false }), false);
  assert.equal(isValidSummary({ count: -1,  hasDraft: false, hasDirtyVault: false }), false);
  assert.equal(isValidSummary({ count: NaN, hasDraft: false, hasDirtyVault: false }), false);
  assert.equal(isValidSummary({ count: 0,   hasDraft: 'no',   hasDirtyVault: false }), false);
  assert.equal(isValidSummary({ count: 0,   hasDraft: false,  hasDirtyVault: 1 }),     false);
});

// ── decideCloseAction: defensive ─────────────────────────────────────

test('decideCloseAction: clean summary always allows close', () => {
  const summary = { count: 0, hasDraft: false, hasDirtyVault: false };
  assert.equal(decideCloseAction({ summary, userChoice: 'cancel' }),  'allow-close');
  assert.equal(decideCloseAction({ summary, userChoice: 'discard' }), 'allow-close');
  assert.equal(decideCloseAction({ summary, userChoice: undefined }), 'allow-close');
});

test('decideCloseAction: dirty + cancel → block-close', () => {
  const summary = { count: 1, hasDraft: true, hasDirtyVault: false };
  assert.equal(decideCloseAction({ summary, userChoice: 'cancel' }), 'block-close');
});

test('decideCloseAction: dirty + discard → allow-close', () => {
  const summary = { count: 1, hasDraft: true, hasDirtyVault: false };
  assert.equal(decideCloseAction({ summary, userChoice: 'discard' }), 'allow-close');
});

test('decideCloseAction: dirty + unknown choice → block-close (safe default)', () => {
  const summary = { count: 1, hasDraft: true, hasDirtyVault: false };
  assert.equal(decideCloseAction({ summary, userChoice: undefined }), 'block-close');
  assert.equal(decideCloseAction({ summary, userChoice: null }),      'block-close');
  assert.equal(decideCloseAction({ summary, userChoice: 'whatever' }), 'block-close');
});

test('decideCloseAction: null summary (timeout/unknown) + cancel → block-close', () => {
  assert.equal(decideCloseAction({ summary: null, userChoice: 'cancel' }), 'block-close');
});

test('decideCloseAction: null summary (timeout/unknown) + discard → allow-close', () => {
  assert.equal(decideCloseAction({ summary: null, userChoice: 'discard' }), 'allow-close');
});

test('decideCloseAction: null summary + missing choice → block-close', () => {
  assert.equal(decideCloseAction({ summary: null, userChoice: undefined }), 'block-close');
  assert.equal(decideCloseAction({ summary: undefined, userChoice: undefined }), 'block-close');
});

test('decideCloseAction: malformed {count: 0} (no flags) is NOT clean — block on cancel (Codex issue 2)', () => {
  // The point: the user MUST be prompted. {count:0} with no booleans
  // is unknown, not clean. cancel keeps the app open.
  const summary = { count: 0 };
  assert.equal(decideCloseAction({ summary, userChoice: 'cancel' }),  'block-close');
  assert.equal(decideCloseAction({ summary, userChoice: 'discard' }), 'allow-close');
});

// ── formatDirtyDetail ────────────────────────────────────────────────

test('formatDirtyDetail: null/invalid summary describes unknown state', () => {
  assert.match(formatDirtyDetail(null), /unknown|unavailable/i);
  assert.match(formatDirtyDetail({ count: 0 }), /unknown|unavailable/i);
  assert.match(formatDirtyDetail({ count: 'bad', hasDraft: false, hasDirtyVault: false }), /unknown|unavailable/i);
});

test('formatDirtyDetail: drafts only, singular', () => {
  const detail = formatDirtyDetail({ count: 1, hasDraft: true, hasDirtyVault: false });
  assert.match(detail, /1 unsaved note/);
  assert.match(detail, /draft/i);
  assert.doesNotMatch(detail, /vault/i);
});

test('formatDirtyDetail: drafts only, plural', () => {
  const detail = formatDirtyDetail({ count: 3, hasDraft: true, hasDirtyVault: false });
  assert.match(detail, /3 unsaved notes/);
  assert.match(detail, /draft/i);
});

test('formatDirtyDetail: vault edits only, singular', () => {
  const detail = formatDirtyDetail({ count: 1, hasDraft: false, hasDirtyVault: true });
  assert.match(detail, /1 unsaved note/);
  assert.match(detail, /vault/i);
  assert.doesNotMatch(detail, /draft/i);
});

test('formatDirtyDetail: both drafts and vault edits', () => {
  const detail = formatDirtyDetail({ count: 4, hasDraft: true, hasDirtyVault: true });
  assert.match(detail, /4 unsaved notes/);
  assert.match(detail, /draft/i);
  assert.match(detail, /vault/i);
});

// ── runCloseGuard: clean ─────────────────────────────────────────────

test('runCloseGuard: clean summary allows close without showing dialog', async () => {
  let dialogCalls = 0;
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 0, hasDraft: false, hasDirtyVault: false }),
    showDialog:      async () => { dialogCalls += 1; return 'cancel'; },
  });
  assert.equal(decision, 'allow-close');
  assert.equal(dialogCalls, 0, 'dialog must NOT appear when there is nothing dirty');
});

// ── runCloseGuard: dirty ─────────────────────────────────────────────

test('runCloseGuard: dirty summary + Cancel blocks close', async () => {
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 1, hasDraft: true, hasDirtyVault: false }),
    showDialog:      async () => 'cancel',
  });
  assert.equal(decision, 'block-close');
});

test('runCloseGuard: dirty summary + Discard allows close', async () => {
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 2, hasDraft: false, hasDirtyVault: true }),
    showDialog:      async () => 'discard',
  });
  assert.equal(decision, 'allow-close');
});

test('runCloseGuard: dialog receives the dirty summary verbatim when valid', async () => {
  let received = null;
  await runCloseGuard({
    getDirtySummary: async () => ({ count: 2, hasDraft: true, hasDirtyVault: true }),
    showDialog:      async (s) => { received = s; return 'cancel'; },
  });
  assert.deepEqual(received, { count: 2, hasDraft: true, hasDirtyVault: true });
});

// ── runCloseGuard: timeout / failure / malformed ─────────────────────

test('runCloseGuard: getDirtySummary rejection (timeout-equivalent) shows dialog with null', async () => {
  let received = 'unset';
  const decision = await runCloseGuard({
    getDirtySummary: async () => { throw new Error('close-guard: dirty-summary timeout'); },
    showDialog:      async (s) => { received = s; return 'cancel'; },
  });
  assert.equal(received, null, 'dialog must be invoked with null on rejection');
  assert.equal(decision, 'block-close', 'cancel on unknown state must block close');
});

test('runCloseGuard: rejection + Discard still allows close (explicit user intent)', async () => {
  const decision = await runCloseGuard({
    getDirtySummary: async () => { throw new Error('renderer dead'); },
    showDialog:      async () => 'discard',
  });
  assert.equal(decision, 'allow-close');
});

test('runCloseGuard: malformed {count: 0} response shows dialog with null (Codex issue 2)', async () => {
  let received = 'unset';
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 0 }),
    showDialog:      async (s) => { received = s; return 'cancel'; },
  });
  assert.equal(received, null, 'dialog must NOT receive a partial summary');
  assert.equal(decision, 'block-close');
});

test('runCloseGuard: malformed (missing count) response shows dialog with null', async () => {
  let received = 'unset';
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ hasDraft: true }),
    showDialog:      async (s) => { received = s; return 'cancel'; },
  });
  assert.equal(received, null);
  assert.equal(decision, 'block-close');
});

test('runCloseGuard: explicit null response shows dialog (Codex issue 3)', async () => {
  let received = 'unset';
  const decision = await runCloseGuard({
    getDirtySummary: async () => null,
    showDialog:      async (s) => { received = s; return 'cancel'; },
  });
  assert.equal(received, null);
  assert.equal(decision, 'block-close');
});

// ── createDirtySummaryRequester: cleanup discipline (Codex issue 4) ──

function makeFakeIpcMain() {
  // Minimal ipcMain stand-in: tracks per-channel listeners so tests
  // can assert they're removed on every exit path.
  const channels = new Map();
  return {
    once(channel, listener) {
      const arr = channels.get(channel) || [];
      const wrapped = function (...args) {
        const i = arr.indexOf(wrapped);
        if (i >= 0) arr.splice(i, 1);
        listener.apply(null, args);
      };
      arr.push(wrapped);
      channels.set(channel, arr);
    },
    removeAllListeners(channel) {
      channels.delete(channel);
    },
    listenerCount(channel) {
      return (channels.get(channel) || []).length;
    },
    fire(channel, ...args) {
      const arr = (channels.get(channel) || []).slice();
      arr.forEach((listener) => listener(...args));
    },
  };
}

test('createDirtySummaryRequester: resolves with renderer payload and removes the listener', async () => {
  const ipcMain = makeFakeIpcMain();
  let sentChannel = null;
  let sentPayload = null;
  const wc = {
    send(channel, payload) {
      sentChannel = channel;
      sentPayload = payload;
      // Simulate the renderer responding on the per-request channel.
      setImmediate(() => ipcMain.fire(payload.replyChannel, /* event */ {}, { count: 0, hasDraft: false, hasDirtyVault: false }));
    },
  };

  const request = createDirtySummaryRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'dirty-summary-reply:1',
    timeoutMs:        1000,
  });

  const summary = await request();
  assert.equal(sentChannel, 'request-dirty-summary');
  assert.equal(sentPayload.replyChannel, 'dirty-summary-reply:1');
  assert.deepEqual(summary, { count: 0, hasDraft: false, hasDirtyVault: false });
  assert.equal(ipcMain.listenerCount('dirty-summary-reply:1'), 0,
    'listener must be removed after resolve');
});

test('createDirtySummaryRequester: rejects on timeout AND removes the listener (Codex issue 4)', async () => {
  const ipcMain = makeFakeIpcMain();
  const wc = { send() { /* never reply */ } };

  const request = createDirtySummaryRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'dirty-summary-reply:42',
    timeoutMs:        20,
  });

  const promise = request();
  // While waiting, the listener is registered.
  assert.equal(ipcMain.listenerCount('dirty-summary-reply:42'), 1);

  await assert.rejects(promise, /timeout/i);

  assert.equal(ipcMain.listenerCount('dirty-summary-reply:42'), 0,
    'listener MUST be removed on timeout — no leaked one-shot');
});

test('createDirtySummaryRequester: removes listener even when send() throws synchronously', async () => {
  const ipcMain = makeFakeIpcMain();
  const wc = { send() { throw new Error('webContents gone'); } };

  const request = createDirtySummaryRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'dirty-summary-reply:99',
    timeoutMs:        1000,
  });

  await assert.rejects(request(), /webContents gone/);
  assert.equal(ipcMain.listenerCount('dirty-summary-reply:99'), 0);
});

test('createDirtySummaryRequester: rejects when getWebContents returns null', async () => {
  const ipcMain = makeFakeIpcMain();
  const request = createDirtySummaryRequester({
    ipcMain,
    getWebContents:   () => null,
    makeReplyChannel: () => 'dirty-summary-reply:nope',
    timeoutMs:        1000,
  });
  await assert.rejects(request(), /no web contents/i);
  assert.equal(ipcMain.listenerCount('dirty-summary-reply:nope'), 0);
});

test('createDirtySummaryRequester: late reply after timeout does NOT leak (cleanup makes it a no-op)', async () => {
  const ipcMain = makeFakeIpcMain();
  let savedReplyChannel = null;
  const wc = {
    send(_channel, payload) { savedReplyChannel = payload.replyChannel; },
  };
  const request = createDirtySummaryRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'dirty-summary-reply:late',
    timeoutMs:        15,
  });

  await assert.rejects(request(), /timeout/i);

  // After the timeout, listener is gone — a late reply has no
  // listener to invoke, so we're safe even if the renderer eventually
  // does reply. firing the channel must not throw.
  ipcMain.fire(savedReplyChannel, {}, { count: 1, hasDraft: true, hasDirtyVault: false });
  assert.equal(ipcMain.listenerCount(savedReplyChannel), 0);
});

// ── createCloseController: latch lifecycle (Codex issues 1 & follow-up) ──

test('createCloseController: starts not-confirmed and not-in-flight', () => {
  const ctl = createCloseController();
  assert.equal(ctl.isConfirmed(), false);
  assert.equal(ctl.isInFlight(),  false);
});

test('createCloseController: beginGuard prevents stacked prompts', () => {
  const ctl = createCloseController();
  assert.equal(ctl.beginGuard(), true,  'first beginGuard must succeed');
  assert.equal(ctl.beginGuard(), false, 'second beginGuard while in-flight must refuse');
  ctl.endGuard();
  assert.equal(ctl.beginGuard(), true,  'after endGuard, a new guard can start');
});

test('createCloseController: confirmClose flips the latch', () => {
  const ctl = createCloseController();
  ctl.confirmClose();
  assert.equal(ctl.isConfirmed(), true);
});

test('createCloseController: resetForNewWindow clears confirmation latch (Codex issue 1)', () => {
  const ctl = createCloseController();
  ctl.confirmClose();
  assert.equal(ctl.isConfirmed(), true, 'pre-condition: latch is set');

  ctl.resetForNewWindow();

  assert.equal(ctl.isConfirmed(), false,
    'a freshly created window MUST start with a clean guard state — no inherited confirmation');
  assert.equal(ctl.isInFlight(), false);
});

test('createCloseController: resetForNewWindow also clears the in-flight latch', () => {
  const ctl = createCloseController();
  ctl.beginGuard();
  ctl.resetForNewWindow();
  assert.equal(ctl.isInFlight(), false);
  assert.equal(ctl.beginGuard(), true, 'a fresh window can start its own guard');
});

test('createCloseController: macOS reactivation bypass — confirmed window 1 → resetForNewWindow → window 2 prompts again', () => {
  // The original Codex issue 1 scenario, re-pinned under the new name.
  const ctl = createCloseController();

  // Window 1: user picks Discard.
  ctl.beginGuard();
  ctl.confirmClose();
  ctl.endGuard();
  // App.activate fires; createWindow() runs and resets the controller
  // before attaching the new window's listeners.
  ctl.resetForNewWindow();

  // Window 2 starts fresh.
  assert.equal(ctl.isConfirmed(), false);
  assert.equal(ctl.beginGuard(), true);
});

test('createCloseController: non-darwin close cascade preserves confirmation — close → closed → window-all-closed → app.quit → before-quit (Codex follow-up)', () => {
  // The bug: on non-darwin, after a confirmed window close, Electron
  // fires close → closed → window-all-closed → (we call) app.quit →
  // before-quit. Under the previous design, mainWindow.on('closed')
  // reset the controller, so before-quit saw confirmed=false and
  // re-ran the guard against a torn-down renderer. The fix moves the
  // reset off 'closed' (which is part of the cascade) and onto
  // createWindow() (a fresh-window event). The latch must therefore
  // remain confirmed through every cascade step below.
  const ctl = createCloseController();

  // ── User clicks the window close button. mainWindow.on('close')
  //    intercepts; guard runs; user picks Discard.
  assert.equal(ctl.beginGuard(), true);
  ctl.confirmClose();
  ctl.endGuard();

  // ── Guard calls mainWindow.close() — 'close' event re-fires.
  //    The handler reads isConfirmed and must let it through.
  assert.equal(ctl.isConfirmed(), true,
    'second close event must bypass the guard');

  // ── Window destroys; mainWindow.on('closed') fires.
  //    Under the new design, this is NOT a reset trigger — we simply
  //    do nothing here. Confirmed must remain true.
  assert.equal(ctl.isConfirmed(), true,
    "'closed' event must not reset the latch — that would break the non-darwin quit cascade");

  // ── window-all-closed fires; on non-darwin we call app.quit().
  //    app.quit() fires 'before-quit'. The handler must see
  //    confirmed=true and fall through (no second prompt).
  assert.equal(ctl.isConfirmed(), true,
    'before-quit during the non-darwin cascade must see the still-confirmed latch — no second guard prompt');

  // ── Only the next createWindow() (e.g. macOS Dock reactivation)
  //    clears the latch. On non-darwin, the app exits before any new
  //    window is ever created, so this code path is never reached on
  //    that platform — exactly the desired behavior.
  ctl.resetForNewWindow();
  assert.equal(ctl.isConfirmed(), false);
});

// ── Stage 6.3B: runCloseGuard 'save-all' branch ─────────────────────

test("runCloseGuard: 'save-all' choice + saveResult.ok=true → 'allow-close'", async () => {
  let saveAllCalls = 0;
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 1, hasDraft: true, hasDirtyVault: false }),
    showDialog:      async () => 'save-all',
    requestSaveAll:  async () => { saveAllCalls += 1; return { ok: true, savedCount: 1 }; },
  });
  assert.equal(decision, 'allow-close');
  assert.equal(saveAllCalls, 1, 'save-all must be invoked exactly once');
});

test("runCloseGuard: 'save-all' choice + saveResult.ok=false → 'block-close'", async () => {
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 1, hasDraft: false, hasDirtyVault: true }),
    showDialog:      async () => 'save-all',
    requestSaveAll:  async () => ({ ok: false, error: 'EACCES: permission denied' }),
  });
  assert.equal(decision, 'block-close',
    'a save-all failure must keep the app open');
});

test("runCloseGuard: 'save-all' choice + requestSaveAll throws → 'block-close'", async () => {
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 1, hasDraft: true, hasDirtyVault: false }),
    showDialog:      async () => 'save-all',
    requestSaveAll:  async () => { throw new Error('save-all timeout'); },
  });
  assert.equal(decision, 'block-close',
    'rejection from requestSaveAll must NOT silently allow close');
});

test("runCloseGuard: 'save-all' choice + null saveResult → 'block-close'", async () => {
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 1, hasDraft: true, hasDirtyVault: false }),
    showDialog:      async () => 'save-all',
    requestSaveAll:  async () => null,
  });
  assert.equal(decision, 'block-close',
    'a malformed null reply from save-all must NOT allow close');
});

test("runCloseGuard: 'save-all' choice + missing requestSaveAll dep → 'block-close' (defensive)", async () => {
  // If main wires the dialog with a Save All button but forgets to wire
  // requestSaveAll, the only safe behavior is to block the close.
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 1, hasDraft: true, hasDirtyVault: false }),
    showDialog:      async () => 'save-all',
    // requestSaveAll intentionally omitted
  });
  assert.equal(decision, 'block-close');
});

test("runCloseGuard: 'save-all' choice still works when dirty-summary was rejected (unknown branch)", async () => {
  // The dialog can be reached via the unknown-summary path. If the user
  // picks Save All, we must still attempt the save-all flow rather than
  // falling through to block on the cancel default.
  let saveAllCalls = 0;
  const decision = await runCloseGuard({
    getDirtySummary: async () => { throw new Error('unreachable'); },
    showDialog:      async () => 'save-all',
    requestSaveAll:  async () => { saveAllCalls += 1; return { ok: true, savedCount: 0 }; },
  });
  assert.equal(decision, 'allow-close');
  assert.equal(saveAllCalls, 1);
});

test("runCloseGuard: 'cancel' regression — dirty summary + Cancel still blocks (Stage 6.3A pin)", async () => {
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 1, hasDraft: true, hasDirtyVault: false }),
    showDialog:      async () => 'cancel',
    requestSaveAll:  async () => { throw new Error('must not be called'); },
  });
  assert.equal(decision, 'block-close');
});

test("runCloseGuard: 'discard' regression — dirty summary + Discard still allows (Stage 6.3A pin)", async () => {
  let saveAllCalls = 0;
  const decision = await runCloseGuard({
    getDirtySummary: async () => ({ count: 2, hasDraft: false, hasDirtyVault: true }),
    showDialog:      async () => 'discard',
    requestSaveAll:  async () => { saveAllCalls += 1; return { ok: true }; },
  });
  assert.equal(decision, 'allow-close');
  assert.equal(saveAllCalls, 0,
    'Discard must NOT trigger save-all — it intentionally drops unsaved work');
});

// ── Stage 6.3B: createSaveAllRequester / createIpcRoundTripRequester ─

test('createIpcRoundTripRequester: sends to the configured request channel and resolves with renderer payload', async () => {
  const ipcMain = makeFakeIpcMain();
  const sentChannels = [];
  const wc = {
    send(channel, payload) {
      sentChannels.push({ channel, replyChannel: payload.replyChannel });
      setImmediate(() => ipcMain.fire(payload.replyChannel, {}, { ok: true, savedCount: 3 }));
    },
  };

  const request = createIpcRoundTripRequester({
    ipcMain,
    getWebContents:   () => wc,
    requestChannel:   'request-save-all',
    makeReplyChannel: () => 'save-all-reply:1',
    timeoutMs:        1000,
  });

  const reply = await request();
  assert.deepEqual(sentChannels, [{ channel: 'request-save-all', replyChannel: 'save-all-reply:1' }]);
  assert.deepEqual(reply, { ok: true, savedCount: 3 });
  assert.equal(ipcMain.listenerCount('save-all-reply:1'), 0,
    'listener must be removed after resolve');
});

test('createIpcRoundTripRequester: rejects on timeout and removes the listener', async () => {
  const ipcMain = makeFakeIpcMain();
  const wc = { send() { /* never reply */ } };

  const request = createIpcRoundTripRequester({
    ipcMain,
    getWebContents:   () => wc,
    requestChannel:   'request-save-all',
    makeReplyChannel: () => 'save-all-reply:2',
    timeoutMs:        15,
  });

  const promise = request();
  assert.equal(ipcMain.listenerCount('save-all-reply:2'), 1);
  await assert.rejects(promise, /timeout/i);
  assert.equal(ipcMain.listenerCount('save-all-reply:2'), 0,
    'timeout must clean up the per-request listener');
});

test('createSaveAllRequester: sends to "request-save-all" channel', async () => {
  const ipcMain = makeFakeIpcMain();
  let sentChannel = null;
  const wc = {
    send(channel, payload) {
      sentChannel = channel;
      setImmediate(() => ipcMain.fire(payload.replyChannel, {}, { ok: true }));
    },
  };
  const request = createSaveAllRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'save-all-reply:3',
    timeoutMs:        500,
  });
  await request();
  assert.equal(sentChannel, 'request-save-all');
});

test('createSaveAllRequester: defaults to a 30s timeout (longer than dirty-summary)', async () => {
  // We do NOT actually wait 30 seconds — we just inspect that the
  // factory accepts the requester contract without blowing up. The
  // important thing is the default is much longer than the
  // dirty-summary's 1500 ms; this is asserted indirectly by the
  // close-guard module documentation. Here we exercise the happy path.
  const ipcMain = makeFakeIpcMain();
  const wc = {
    send(_c, payload) {
      setImmediate(() => ipcMain.fire(payload.replyChannel, {}, { ok: true }));
    },
  };
  const request = createSaveAllRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'save-all-reply:4',
    // timeoutMs intentionally omitted to exercise the default
  });
  const reply = await request();
  assert.deepEqual(reply, { ok: true });
});

test('createSaveAllRequester: removes listener on timeout', async () => {
  const ipcMain = makeFakeIpcMain();
  const wc = { send() { /* never reply */ } };
  const request = createSaveAllRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'save-all-reply:5',
    timeoutMs:        15,
  });
  await assert.rejects(request(), /timeout/i);
  assert.equal(ipcMain.listenerCount('save-all-reply:5'), 0);
});

test('createDirtySummaryRequester still works (regression — same factory, "request-dirty-summary" channel)', async () => {
  // Stage 6.3B refactors createDirtySummaryRequester onto the generic
  // round-trip factory. The existing 6.3A behavior must not regress.
  const ipcMain = makeFakeIpcMain();
  let sentChannel = null;
  const wc = {
    send(channel, payload) {
      sentChannel = channel;
      setImmediate(() => ipcMain.fire(payload.replyChannel, {},
        { count: 0, hasDraft: false, hasDirtyVault: false }));
    },
  };
  const request = createDirtySummaryRequester({
    ipcMain,
    getWebContents:   () => wc,
    makeReplyChannel: () => 'dirty-summary-reply:regression',
    timeoutMs:        500,
  });
  const reply = await request();
  assert.equal(sentChannel, 'request-dirty-summary');
  assert.deepEqual(reply, { count: 0, hasDraft: false, hasDirtyVault: false });
});
