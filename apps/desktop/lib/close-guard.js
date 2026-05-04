'use strict';

/* close-guard — pure helpers + dependency-injected factories
   for the Stage 6.3A close-time data-loss guard.

   The renderer is the source of truth for dirty state (via Stage 6.1's
   DirtyState.summarizeDirty). The main process intercepts the close
   intent, asks the renderer for its summary over IPC, and decides
   whether to close, prompt, or block. Everything that does not need
   Electron lives here so it can be unit-tested under node:test.

   Exports:

   isValidSummary(summary)
     Pure. True iff the value has the full DirtyState shape:
       { count: finite number >= 0, hasDraft: boolean, hasDirtyVault: boolean }
     Anything else (null, missing keys, wrong types) is rejected. A
     {count:0}-but-missing-booleans response is NOT clean.

   decideCloseAction({ summary, userChoice })
     Pure. Total. Returns 'allow-close' or 'block-close'. A clean
     summary always allows. Any other shape (dirty, unknown, malformed)
     allows close ONLY when userChoice === 'discard'.

   formatDirtyDetail(summary)
     Pure. Builds the dialog detail string. Handles invalid/null and
     singular/plural copy from { count, hasDraft, hasDirtyVault }.

   runCloseGuard({ getDirtySummary, showDialog })
     Async orchestrator:
       1. ask renderer for summary
       2. clean → 'allow-close' (no dialog)
       3. anything else → showDialog(summaryOrNull) → decideCloseAction
     getDirtySummary is expected to settle on its own (it owns the
     timeout). A rejection / null / malformed response is treated as
     unknown — the dialog is always shown for those cases.

   createDirtySummaryRequester({ ipcMain, getWebContents, makeReplyChannel, timeoutMs })
     Factory that returns a request function. Each call:
       - registers ONE per-channel listener via ipcMain.once
       - sends the request to the renderer with the reply channel
       - resolves on reply / rejects on timeout or send failure
       - GUARANTEES the listener is removed on every exit path
     This is the cleanup-discipline layer Codex flagged: stale
     listeners across timeouts/retries are eliminated by construction.

   createCloseController()
     Tiny state machine for the "this close is already confirmed —
     don't re-prompt" latch. Two states (confirmed, in-flight).
     resetForNewWindow() runs at the start of createWindow() and
     clears BOTH so a new window after macOS reactivation doesn't
     inherit a stale confirmation. The reset is deliberately tied to
     fresh-window creation rather than to the previous window's
     'closed' event, so the latch persists through the non-darwin
     close-cascade (close → closed → window-all-closed → app.quit →
     before-quit) and that final before-quit doesn't re-run the guard.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CloseGuard = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function isValidSummary(s) {
    return s != null
      && typeof s === 'object'
      && Number.isFinite(s.count)
      && s.count >= 0
      && typeof s.hasDraft      === 'boolean'
      && typeof s.hasDirtyVault === 'boolean';
  }

  function isCleanSummary(s) {
    return isValidSummary(s) && s.count === 0;
  }

  function decideCloseAction(args) {
    const summary    = args ? args.summary    : null;
    const userChoice = args ? args.userChoice : null;
    if (isCleanSummary(summary)) return 'allow-close';
    if (userChoice === 'discard') return 'allow-close';
    return 'block-close';
  }

  function formatDirtyDetail(summary) {
    if (!isValidSummary(summary)) {
      return 'Saving status is unavailable. Quitting now may discard unsaved changes.';
    }
    const count = summary.count;
    if (count <= 0) {
      // Defensive: caller should not invoke the dialog for clean summaries.
      return '';
    }
    const noun = count === 1 ? 'note' : 'notes';
    const parts = [];
    if (summary.hasDraft)      parts.push('unsaved drafts');
    if (summary.hasDirtyVault) parts.push('edited vault notes');
    if (parts.length === 0) {
      return `You have ${count} unsaved ${noun}.`;
    }
    return `You have ${count} unsaved ${noun} (${parts.join(' and ')}).`;
  }

  async function runCloseGuard(deps) {
    const getDirtySummary = deps.getDirtySummary;
    const showDialog      = deps.showDialog;

    let summary = null;
    try {
      summary = await getDirtySummary();
    } catch (_err) {
      summary = null;
    }

    if (isCleanSummary(summary)) {
      return 'allow-close';
    }

    // Malformed / unknown / dirty: hand the raw value to the dialog so
    // its detail line can adapt; decideCloseAction also rejects unknown
    // shapes unless the user explicitly Discards.
    const valueForDialog = isValidSummary(summary) ? summary : null;
    const userChoice     = await showDialog(valueForDialog);
    return decideCloseAction({ summary: summary, userChoice: userChoice });
  }

  function createDirtySummaryRequester(deps) {
    const ipcMain          = deps.ipcMain;
    const getWebContents   = deps.getWebContents;
    const makeReplyChannel = deps.makeReplyChannel;
    const timeoutMs        = typeof deps.timeoutMs === 'number' ? deps.timeoutMs : 1500;

    return function requestDirtySummary() {
      return new Promise(function (resolve, reject) {
        const replyChannel = makeReplyChannel();
        let settled = false;
        let timer   = null;

        function cleanup() {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          ipcMain.removeAllListeners(replyChannel);
        }

        function settleResolve(value) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        }
        function settleReject(err) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        }

        ipcMain.once(replyChannel, function (_event, summary) {
          settleResolve(summary);
        });

        timer = setTimeout(function () {
          settleReject(new Error('close-guard: dirty-summary timeout'));
        }, timeoutMs);

        let webContents;
        try {
          webContents = getWebContents();
        } catch (err) {
          settleReject(err);
          return;
        }
        if (!webContents) {
          settleReject(new Error('close-guard: no web contents'));
          return;
        }
        try {
          webContents.send('request-dirty-summary', { replyChannel: replyChannel });
        } catch (err) {
          settleReject(err);
        }
      });
    };
  }

  function createCloseController() {
    let confirmed = false;
    let inFlight  = false;
    return {
      isConfirmed: function () { return confirmed; },
      isInFlight:  function () { return inFlight; },
      // Returns false if a guard is already running — caller should
      // not start another. Returns true when the caller is now the
      // active guard owner.
      beginGuard: function () {
        if (inFlight) return false;
        inFlight = true;
        return true;
      },
      endGuard: function () {
        inFlight = false;
      },
      // Mark close/quit as authorized — subsequent close/quit events
      // bypass the guard until a fresh window is created. The latch
      // must persist through the *entire* close cascade:
      //   non-darwin: close → 'closed' → window-all-closed → app.quit
      //               → before-quit
      // If we cleared on 'closed', `before-quit` would see confirmed=false
      // and re-run the guard against a torn-down renderer. Reset is
      // therefore tied to createWindow(), not to the window's death.
      confirmClose: function () {
        confirmed = true;
      },
      // Clear both flags. Wired to the start of createWindow() so a
      // newly-created window (e.g. macOS Dock reactivation) always
      // begins with a fresh guard state, while the close-cascade of a
      // dying window still sees confirmed=true throughout.
      resetForNewWindow: function () {
        confirmed = false;
        inFlight  = false;
      },
    };
  }

  return {
    isValidSummary:              isValidSummary,
    decideCloseAction:           decideCloseAction,
    formatDirtyDetail:           formatDirtyDetail,
    runCloseGuard:               runCloseGuard,
    createDirtySummaryRequester: createDirtySummaryRequester,
    createCloseController:       createCloseController,
  };
});
