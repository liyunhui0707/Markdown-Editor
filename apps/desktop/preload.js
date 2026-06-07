const { contextBridge, ipcRenderer } = require('electron');
// Stage C: the privacy badge state AND all AI settings come from the MAIN
// process via the ai:get-settings IPC — main is the single source of truth,
// merging env > stored (settings panel) > default. The preload no longer
// computes the badge from process.env: once settings can be persisted to a
// file the sandboxed preload cannot read, an env-only badge would go stale.

contextBridge.exposeInMainWorld('vaultApi', {
  // Resolves to the badge sub-object with a safe no-badge fallback so the boot
  // wiring can never throw if main is slow or the channel is missing.
  getAiBadgeState: () => ipcRenderer.invoke('ai:get-settings')
    .then((r) => (r && r.badge) || { isRemote: false, allowRemote: false, hostname: '' })
    .catch(() => ({ isRemote: false, allowRemote: false, hostname: '' })),
  // Settings panel: full snapshot { effective, envOverridden, badge } and a
  // save that takes a partial { baseUrl?, model?, allowRemote? }.
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
  saveAiSettings: (partial) => ipcRenderer.invoke('ai:save-settings', partial),
  chooseVaultFolder: () => ipcRenderer.invoke('choose-vault-folder'),
  watchVaultFolder: (payload) => ipcRenderer.invoke('watch-vault-folder', payload),
  unwatchVaultFolder: () => ipcRenderer.invoke('unwatch-vault-folder'),
  seedDemoVault: (payload) => ipcRenderer.invoke('seed-demo-vault', payload),
  saveNote: (payload) => ipcRenderer.invoke('save-note', payload),
  deleteNoteFile: (payload) => ipcRenderer.invoke('delete-note-file', payload),
  loadVaultNotes: (payload) => ipcRenderer.invoke('load-vault-notes', payload),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  dictionaryLookup: (payload) => ipcRenderer.invoke('dictionary:lookup', payload),
  refreshSessions: (vaultPath) => ipcRenderer.invoke('sessionViewer:import', { vaultPath }),
  onVaultChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vault-changed', listener);
    return () => ipcRenderer.removeListener('vault-changed', listener);
  },
  // Stage 6.3A close-time data-loss guard. Main sends 'request-dirty-summary'
  // with a one-shot replyChannel; the renderer's handler computes the
  // current dirty-note summary and replies via that channel exactly once.
  // Per-request reply channels keep concurrent requests from racing.
  onCloseRequest: (handler) => {
    const listener = (_event, payload) => {
      const replyChannel = payload && payload.replyChannel;
      let replied = false;
      const respond = (summary) => {
        if (replied || !replyChannel) return;
        replied = true;
        ipcRenderer.send(replyChannel, summary);
      };
      handler(respond);
    };
    ipcRenderer.on('request-dirty-summary', listener);
    return () => ipcRenderer.removeListener('request-dirty-summary', listener);
  },
  // Stage 6.3B Save All & Quit. Main sends 'request-save-all' when the
  // user picks Save All & Quit; the renderer runs saveAllDirtyNotes()
  // and replies on the per-request channel with one ok/error result.
  // Same per-request reply-channel discipline as onCloseRequest so
  // concurrent or retried requests cannot mix replies.
  onSaveAllRequest: (handler) => {
    const listener = (_event, payload) => {
      const replyChannel = payload && payload.replyChannel;
      let replied = false;
      const respond = (result) => {
        if (replied || !replyChannel) return;
        replied = true;
        ipcRenderer.send(replyChannel, result);
      };
      handler(respond);
    };
    ipcRenderer.on('request-save-all', listener);
    return () => ipcRenderer.removeListener('request-save-all', listener);
  }
});

// Path D / Stage A / Stage B — local AI Summarize + Rewrite (+ streaming).
// Renderer calls window.ai.summarizeNote(text [, options]) / rewriteText(...).
// When options.onChunk is a function, preload subscribes to a unique chunk
// channel BEFORE invoke and cleans up on settle. options.signal (an
// AbortSignal) lets the renderer cancel; abort triggers an 'ai:cancel'
// IPC send keyed by the same chunk channel. Both methods ALWAYS return a
// bare Promise (preserves T8.2 / CA3.2 direct-invoke regex). No raw
// ipcRenderer is exposed (A7); 'ai:cancel' is internal to this module.
const _chunkSubs = new Map(); // chunkChannel -> { listener }
// F2 (Codex): WeakMap side table instead of mutating options. The
// renderer's options object may be frozen / sealed / proxied by Electron's
// contextBridge; a property back-write like `options._chunkChannel = ...`
// can silently no-op, leaving cleanup() unable to find the channel and
// orphaning the IPC chunk listener. WeakMap lookup keys by object identity
// and works regardless of whether the object is mutable.
const _optionsToChannel = new WeakMap(); // options -> chunkChannel
let _aiChunkCounter = 0;

function subscribe(options) {
  if (!options || typeof options.onChunk !== 'function') return null;
  _aiChunkCounter += 1;
  const chunkChannel = 'ai:chunk:' + _aiChunkCounter;
  const listener = (_event, payload) => {
    const text = payload && payload.text;
    if (typeof text === 'string') options.onChunk(text);
  };
  ipcRenderer.on(chunkChannel, listener);
  _chunkSubs.set(chunkChannel, { listener });
  // Stage B cancel propagation. Electron's contextBridge strips prototype
  // methods from objects crossing renderer↔preload, so an AbortSignal
  // passed in options arrives without addEventListener — we can't observe
  // its 'abort' event. Functions, however, ARE proxied across the bridge.
  // So the renderer passes a `registerAbort` callback; we synchronously
  // hand it an abort function (a preload-side closure) that issues
  // 'ai:cancel' over the only safe IPC. The renderer stores it and calls
  // it when × is clicked; the call crosses back to preload and fires the
  // send.
  if (typeof options.registerAbort === 'function') {
    const abortFn = () => ipcRenderer.send('ai:cancel', { chunkChannel });
    try { options.registerAbort(abortFn); } catch (_e) { /* renderer-side throw — ignore */ }
  }
  // WeakMap-keyed side table so cleanup() can recover the chunkChannel
  // without mutating options. WeakMap.set throws if key is not an object
  // (shouldn't happen here, but guard defensively).
  try { _optionsToChannel.set(options, chunkChannel); } catch (_e) { /* ignore */ }
  return chunkChannel;
}

function cleanup(options) {
  if (!options) return;
  const chunkChannel = _optionsToChannel.get(options);
  if (!chunkChannel) return;
  const entry = _chunkSubs.get(chunkChannel);
  if (entry) ipcRenderer.removeListener(chunkChannel, entry.listener);
  _chunkSubs.delete(chunkChannel);
  _optionsToChannel.delete(options);
}

// Build the streaming portion of the invoke payload. Spread out so the
// `ai` object literal below contains exactly the documented surface keys
// (summarizeNote, rewriteText) — keeping the T8.3 key-count probe stable.
function streamMeta(options) {
  return { chunkChannel: subscribe(options) };
}

contextBridge.exposeInMainWorld('ai', {
  summarizeNote: (text, options) => ipcRenderer.invoke('ai:summarize-note', { text, ...streamMeta(options) }).finally(() => cleanup(options)),
  rewriteText:   (text, options) => ipcRenderer.invoke('ai:rewrite-text',   { text, ...streamMeta(options) }).finally(() => cleanup(options)),
});