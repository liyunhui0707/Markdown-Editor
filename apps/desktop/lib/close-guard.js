'use strict';

/* close-guard — pure helpers + dependency-injected factories
   for the Stage 6.3A close-time data-loss guard, extended in Stage
   6.3B with the Save All & Quit flow.

   The renderer is the source of truth for dirty state (via Stage 6.1's
   DirtyState.summarizeDirty). The main process intercepts the close
   intent, asks the renderer for its summary over IPC, and decides
   whether to close, prompt, or block. Stage 6.3B adds a second IPC
   round-trip for the Save All flow: main asks the renderer to save
   everything dirty; the renderer reuses the existing save-note IPC
   per-note and replies with a single ok/error result. Everything
   that does not need Electron lives here so it can be unit-tested
   under node:test.

   Exports:

   isValidSummary(summary)
     Pure. True iff the value has the full DirtyState shape:
       { count: finite number >= 0, hasDraft: boolean, hasDirtyVault: boolean }
     Anything else (null, missing keys, wrong types) is rejected. A
     {count:0}-but-missing-booleans response is NOT clean.

   decideCloseAction({ summary, userChoice })
     Pure. Total. Returns 'allow-close' or 'block-close' for the
     non-save branches (cancel / discard / unknown). The 'save-all'
     branch is async and lives in runCloseGuard.

   formatDirtyDetail(summary)
     Pure. Builds the dialog detail string. Handles invalid/null and
     singular/plural copy from { count, hasDraft, hasDirtyVault }.

   runCloseGuard({ getDirtySummary, showDialog, requestSaveAll })
     Async orchestrator:
       1. ask renderer for summary
       2. clean → 'allow-close' (no dialog)
       3. anything else → showDialog(summaryOrNull):
            'cancel' / 'discard' / unknown → decideCloseAction
            'save-all' (Stage 6.3B) → await requestSaveAll(); ok=true
                                      allows close, anything else
                                      blocks. Rejection / null /
                                      missing dep all block — never
                                      silently allow.
     getDirtySummary owns its own timeout (via the IPC requester it
     came from). A rejection / null / malformed response is treated
     as unknown — the dialog is always shown for those cases.

   createIpcRoundTripRequester({ ipcMain, getWebContents,
                                  requestChannel, makeReplyChannel,
                                  timeoutMs, timeoutMessage })
     Generic factory — single source of truth for the cleanup
     discipline (settled flag + cleanup() in every exit path). Used
     by both 6.3A (dirty-summary) and 6.3B (save-all). Resolves with
     whatever the renderer sent on the per-request reply channel;
     rejects on timeout, missing webContents, send throw, or sync
     getWebContents throw. ALWAYS removes the per-request listener.

   createDirtySummaryRequester({ ipcMain, getWebContents, makeReplyChannel, timeoutMs })
     Stage 6.3A wrapper. Pinned to the 'request-dirty-summary'
     channel; default timeout 1500 ms.

   createSaveAllRequester({ ipcMain, getWebContents, makeReplyChannel, timeoutMs })
     Stage 6.3B wrapper. Pinned to the 'request-save-all' channel;
     default timeout 30000 ms (saves can take seconds on slow disks
     and the OS folder picker for the no-vault path can take
     longer).

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
    const requestSaveAll  = deps.requestSaveAll;

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
    // its detail line can adapt; decideCloseAction rejects unknown
    // shapes unless the user explicitly Discards. The Save All branch
    // is async and is handled here rather than in decideCloseAction.
    const valueForDialog = isValidSummary(summary) ? summary : null;
    const userChoice     = await showDialog(valueForDialog);

    if (userChoice === 'save-all') {
      // Defensive: if the dialog can return 'save-all' but the caller
      // didn't wire the requester, blocking is the only safe outcome.
      if (typeof requestSaveAll !== 'function') {
        return 'block-close';
      }
      let saveResult = null;
      try {
        saveResult = await requestSaveAll();
      } catch (_err) {
        saveResult = null;
      }
      // ok:true is the ONLY shape that allows close. null, malformed,
      // ok:false (conflict, generic failure, vault-cancel, save error)
      // all keep the app open. The renderer is responsible for surfacing
      // the user-facing error message via its own status pill.
      if (saveResult && saveResult.ok === true) {
        return 'allow-close';
      }
      return 'block-close';
    }

    return decideCloseAction({ summary: summary, userChoice: userChoice });
  }

  function createIpcRoundTripRequester(deps) {
    const ipcMain          = deps.ipcMain;
    const getWebContents   = deps.getWebContents;
    const makeReplyChannel = deps.makeReplyChannel;
    const requestChannel   = deps.requestChannel;
    const timeoutMs        = typeof deps.timeoutMs === 'number' ? deps.timeoutMs : 1500;
    const timeoutMessage   = typeof deps.timeoutMessage === 'string' && deps.timeoutMessage.length > 0
      ? deps.timeoutMessage
      : `close-guard: ${requestChannel} timeout`;

    return function ipcRoundTripRequest() {
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

        ipcMain.once(replyChannel, function (_event, payload) {
          settleResolve(payload);
        });

        timer = setTimeout(function () {
          settleReject(new Error(timeoutMessage));
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
          webContents.send(requestChannel, { replyChannel: replyChannel });
        } catch (err) {
          settleReject(err);
        }
      });
    };
  }

  function createDirtySummaryRequester(deps) {
    return createIpcRoundTripRequester({
      ipcMain:          deps.ipcMain,
      getWebContents:   deps.getWebContents,
      makeReplyChannel: deps.makeReplyChannel,
      requestChannel:   'request-dirty-summary',
      timeoutMs:        typeof deps.timeoutMs === 'number' ? deps.timeoutMs : 1500,
      timeoutMessage:   'close-guard: dirty-summary timeout',
    });
  }

  function createSaveAllRequester(deps) {
    return createIpcRoundTripRequester({
      ipcMain:          deps.ipcMain,
      getWebContents:   deps.getWebContents,
      makeReplyChannel: deps.makeReplyChannel,
      requestChannel:   'request-save-all',
      timeoutMs:        typeof deps.timeoutMs === 'number' ? deps.timeoutMs : 30000,
      timeoutMessage:   'close-guard: save-all timeout',
    });
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
    createIpcRoundTripRequester: createIpcRoundTripRequester,
    createDirtySummaryRequester: createDirtySummaryRequester,
    createSaveAllRequester:      createSaveAllRequester,
    createCloseController:       createCloseController,
  };
});
