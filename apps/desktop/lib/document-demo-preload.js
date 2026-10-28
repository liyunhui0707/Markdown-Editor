'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed isolated preload: no generic invoke, paths, fs or policy options.
const states = new Map(), listeners = new Set(), lifecycleListeners = new Set();
function lifecycle(sessionId, state) {
  if (typeof sessionId !== 'string' || states.get(sessionId) === 'invalidated' || states.get(sessionId) === state) return;
  states.set(sessionId, state);
  for (const listener of lifecycleListeners) listener({ sessionId, state });
  if (state === 'invalidated') for (const listener of listeners) listener({ sessionId });
}
const blocked = sessionId => ({ ok: false, code: states.get(sessionId) === 'invalidated' ? 'unknown-session' : states.get(sessionId) });
ipcRenderer.on('document-demo:invalidated', (_event, data) => lifecycle(data?.sessionId, 'invalidated'));
const request = async (operation, data = {}) => {
  const sessionId = data?.sessionId;
  if (states.has(sessionId)) return blocked(sessionId);
  const closing = operation === 'close' && typeof sessionId === 'string';
  // Establish the fence synchronously, before IPC can close main's session.
  if (closing) lifecycle(sessionId, 'close-pending');
  let result;
  try { result = await ipcRenderer.invoke('document-demo:request', { ...data, operation }); }
  catch (error) {
    if (!closing) throw error;
    lifecycle(sessionId, 'close-outcome-unknown'); return blocked(sessionId);
  }
  if (closing) {
    if (result?.ok === true) lifecycle(sessionId, 'invalidated');
    else {
      // Even a legitimate refusal snapshot is not a lease against a subsequent
      // close. This restricted demo never reopens the same ID automatically.
      lifecycle(sessionId, 'close-outcome-unknown');
      return { ok: false, code: typeof result?.code === 'string' ? result.code : 'close-outcome-unknown' };
    }
  } else if (states.has(sessionId)) return blocked(sessionId);
  return result;
};
contextBridge.exposeInMainWorld('documentDemo', {
  openFile: () => request('open-file'),
  newTemporary: () => request('new-temporary'),
  onOpenRequest: handler => ipcRenderer.on('document-demo:open-request', () => handler()),
  list: () => request('list'),
  snapshot: data => request('snapshot', data),
  edit: data => request('edit', data),
  undo: data => request('undo', data),
  redo: data => request('redo', data),
  check: data => request('check', data),
  save: data => request('save', data),
  close: data => request('close', data),
  onInvalidated: handler => {
    if (typeof handler !== 'function') throw TypeError('Invalid lifecycle listener');
    listeners.add(handler);
    for (const [sessionId, state] of states) if (state === 'invalidated') handler({ sessionId });
    return () => listeners.delete(handler);
  },
  onLifecycle: handler => {
    if (typeof handler !== 'function') throw TypeError('Invalid lifecycle listener');
    lifecycleListeners.add(handler);
    for (const [sessionId, state] of states) handler({ sessionId, state });
    return () => lifecycleListeners.delete(handler);
  },
  onReady: handler => ipcRenderer.once('document-demo:ready', (_event, data) => handler(data)),
});
