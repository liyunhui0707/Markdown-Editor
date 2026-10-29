'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed isolated preload: no generic invoke, paths, fs or policy options.
const states = new Map(), listeners = new Set(), lifecycleListeners = new Set();
let pending = 0, composing = false;
const copies = new Set(), unknown = new Map();
document.addEventListener('compositionstart', () => { composing = true; }, true);
document.addEventListener('compositionend', () => { composing = false; }, true);
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
  const creating = operation === 'create-test-copy' || operation === 'create-persistent-copy';
  if (creating) {
    if (unknown.has(sessionId) || unknown.has(undefined)) return { ok: false, code: unknown.get(sessionId) || unknown.get(undefined) };
    if (composing) return { ok: false, code: 'composition-active' };
    if (pending) return { ok: false, code: 'document-busy' };
    copies.add(sessionId);
  } else if (copies.has(sessionId)) return { ok: false, code: 'copy-in-progress' };
  const closing = operation === 'close' && typeof sessionId === 'string';
  // Establish the fence synchronously, before IPC can close main's session.
  if (closing) lifecycle(sessionId, 'close-pending');
  let result;
  ++pending;
  try { result = await ipcRenderer.invoke('document-demo:request', { ...data, operation }); }
  catch (error) {
    unknown.set(sessionId, creating ? 'copy-outcome-unknown' : 'ipc-outcome-unknown');
    if (creating) return { ok: false, code: 'copy-outcome-unknown' };
    if (!closing) throw error;
    lifecycle(sessionId, 'close-outcome-unknown'); return blocked(sessionId);
  } finally { --pending; if (creating) copies.delete(sessionId); }
  if (creating && (!result || typeof result.ok !== 'boolean' || (result.ok && result.copy?.state !== 'created-confirmed'))) {
    unknown.set(sessionId, 'copy-outcome-unknown'); return { ok: false, code: 'copy-outcome-unknown' };
  }
  if (!result || typeof result.ok !== 'boolean') unknown.set(sessionId, 'ipc-outcome-unknown');
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
  createTestCopy: data => request('create-test-copy', data),
  createPersistentCopy: data => request('create-persistent-copy', data),
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
