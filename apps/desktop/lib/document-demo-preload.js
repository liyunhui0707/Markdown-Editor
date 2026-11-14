'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed preload cannot import local modules; the capacity test checks parity.
const MAX_IMAGE_DATA_URL = 5592434;
// Sandboxed isolated preload: no generic invoke, paths, fs or policy options.
const states = new Map(), listeners = new Set(), lifecycleListeners = new Set();
let pending = 0, composing = false, draftManagementUnknown = false;
const copies = new Set(), unknown = new Map();
document.addEventListener('compositionstart', () => { composing = true; }, true);
document.addEventListener('compositionend', () => { composing = false; }, true);
function lifecycle(sessionId, state) {
  if (typeof sessionId !== 'string' || states.get(sessionId) === 'invalidated' || states.get(sessionId) === state) return;
  if (state === 'open') states.delete(sessionId); else states.set(sessionId, state);
  for (const listener of lifecycleListeners) listener({ sessionId, state });
  if (state === 'invalidated') for (const listener of listeners) listener({ sessionId });
}
const blocked = sessionId => ({ ok: false, code: states.get(sessionId) === 'invalidated' ? 'unknown-session' : states.get(sessionId) });
ipcRenderer.on('document-demo:invalidated', (_event, data) => lifecycle(data?.sessionId, 'invalidated'));
const request = async (operation, data = {}) => {
  const sessionId = data?.sessionId;
  if (states.has(sessionId)) return blocked(sessionId);
  const userClosing = operation === 'close-document';
  if (userClosing) {
    if (typeof sessionId !== 'string' || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) return { ok: false, code: 'invalid-request' };
    if (composing) return { ok: false, code: 'composition-active' };
    if (pending) return { ok: false, code: 'document-busy' };
    if (unknown.has(sessionId) || unknown.has(undefined)) return { ok: false, code: 'ipc-outcome-unknown' };
  }
  const linkedAction=['inspect-linked-file','open-linked-file','reveal-linked-file'].includes(operation);
  const originalSaving=operation==='save-original';
  const forking = operation === 'edit-copy' || operation === 'restore-draft';
  const following = operation === 'open-confirmed-copy' || operation === 'reveal-confirmed-copy';
  const nativeOpening = operation === 'open-native-file';
  const recentOpening = operation === 'open-recent', recentClearing = operation === 'clear-recents', renaming = operation === 'rename-draft';
  if (nativeOpening || recentOpening || recentClearing || renaming) {
    if (composing) return { ok: false, code: 'composition-active' };
    if (pending) return { ok: false, code: 'document-busy' };
    if (unknown.size) return { ok: false, code: 'ipc-outcome-unknown' };
  }
  const importing = operation === 'import-image';
  const managing = operation === 'manage-draft';
  if (operation === 'source-edit' && unknown.size) return { ok: false, code: 'ipc-outcome-unknown' };
  if (['format','source-edit'].includes(operation) && composing) return { ok: false, code: 'composition-active' };
  if (['format','source-edit'].includes(operation) && pending) return { ok: false, code: 'document-busy' };
  if (managing && draftManagementUnknown) return { ok: false, code: 'draft-operation-unknown' };
  const creating = operation === 'create-test-copy' || operation === 'create-persistent-copy';
  if (linkedAction || originalSaving || creating || forking || managing || following || importing) {
    if ((operation === 'restore-draft' || managing) && unknown.size) return { ok: false, code: 'ipc-outcome-unknown' };
    if (unknown.has(sessionId) || unknown.has(undefined)) return { ok: false, code: unknown.get(sessionId) || unknown.get(undefined) };
    if (composing) return { ok: false, code: 'composition-active' };
    if (pending) return { ok: false, code: 'document-busy' };
    copies.add(sessionId);
  } else if (copies.has(sessionId)) return { ok: false, code: 'copy-in-progress' };
  const closing = (operation === 'close' || userClosing) && typeof sessionId === 'string';
  // Establish the fence synchronously, before IPC can close main's session.
  if (closing) lifecycle(sessionId, 'close-pending');
  let result;
  ++pending;
  try { result = await ipcRenderer.invoke('document-demo:request', { ...data, operation }); }
  catch (error) {
    if (following) { unknown.set(sessionId, 'copy-action-unknown'); return { ok: false, code: 'copy-action-unknown' }; }
    if (managing) { draftManagementUnknown = true; return { ok: false, code: 'draft-operation-unknown' }; }
    unknown.set(sessionId, forking ? 'edit-copy-outcome-unknown' : creating ? 'copy-outcome-unknown' : 'ipc-outcome-unknown');
    if (linkedAction || originalSaving || creating || forking || managing || following || importing || renaming || nativeOpening) return { ok: false, code: unknown.get(sessionId) };
    if (!closing) throw error;
    lifecycle(sessionId, 'close-outcome-unknown'); return blocked(sessionId);
  } finally { --pending; if (linkedAction || originalSaving || creating || forking || managing || following || importing) copies.delete(sessionId); }
  if(linkedAction&&(!result||typeof result.ok!=='boolean'||(result.ok&&
    (operation==='inspect-linked-file'
      ? result.snapshot?.sessionId!==sessionId||result.snapshot.revision!==data.expectedRevision
      : result.sessionId!==sessionId||result.requestRevision!==data.expectedRevision||
        (operation==='open-linked-file'&&(typeof result.snapshot?.sessionId!=='string'||result.snapshot.sessionId===sessionId||result.snapshot.readOnly!==true||result.snapshot.temporary===true||states.has(result.snapshot.sessionId))))))){
    unknown.set(sessionId,'linked-action-unknown');return {ok:false,code:'linked-action-unknown'};
  }
  if(originalSaving&&(!result||typeof result.ok!=='boolean'||(result.ok&&(result.snapshot?.sessionId!==sessionId||result.snapshot.revision!==data.expectedRevision||result.snapshot.originalSave?.receipt?.state!=='saved-confirmed')))){unknown.set(sessionId,'save-outcome-unknown');return {ok:false,code:'save-outcome-unknown'};}
  if (importing && (!result || typeof result.ok !== 'boolean' || (result.ok &&
      (result.sessionId !== sessionId || result.revision !== data.expectedRevision || !/^markdown-image-[a-f0-9]{64}\.(png|jpg)$/.test(result.href))))) {
    unknown.set(sessionId, 'image-import-unknown'); return {ok: false, code: 'image-import-unknown'};
  }
  if (renaming && (!result || typeof result.ok !== 'boolean' || (result.ok &&
      (result.snapshot?.sessionId !== sessionId || result.snapshot.revision !== data.expectedRevision
       || result.snapshot.temporary !== true || result.snapshot.readOnly !== false
       || typeof data.label !== 'string' || result.snapshot.label !== data.label.trim().replace(/\.md$/i, '').trim())))) {
    unknown.set(sessionId, 'ipc-outcome-unknown'); return { ok: false, code: 'ipc-outcome-unknown' };
  }
  if (nativeOpening && (!result || typeof result.ok !== 'boolean' || result.requestId !== data.requestId || (result.ok &&
      (typeof result.snapshot?.sessionId !== 'string' || result.snapshot.readOnly !== true
       || result.snapshot.temporary === true || states.has(result.snapshot.sessionId))))) {
    unknown.set(undefined, 'ipc-outcome-unknown'); return { ok: false, code: 'ipc-outcome-unknown' };
  }
  if (recentOpening && (!result || typeof result.ok !== 'boolean' || (result.ok &&
      (result.recentId !== data.recentId || typeof result.snapshot?.sessionId !== 'string'
       || result.snapshot.readOnly !== true || result.snapshot.temporary === true || states.has(result.snapshot.sessionId))))) {
    unknown.set(undefined, 'ipc-outcome-unknown'); return { ok: false, code: 'ipc-outcome-unknown' };
  }
  if (managing && (!result || typeof result.ok !== 'boolean' || (result.ok &&
      result.state !== (data.action === 'archive' ? 'archived' : 'available')))) {
    draftManagementUnknown = true; return { ok: false, code: 'draft-operation-unknown' };
  }
  if (forking && (!result || typeof result.ok !== 'boolean' || (result.ok &&
      (typeof result.snapshot?.sessionId !== 'string' || result.snapshot.sessionId === sessionId
       || result.snapshot.temporary !== true || result.snapshot.readOnly !== false)))) {
    unknown.set(sessionId, 'edit-copy-outcome-unknown'); return { ok: false, code: 'edit-copy-outcome-unknown' };
  }
  if (forking && result.ok && states.has(result.snapshot.sessionId)) return blocked(result.snapshot.sessionId);
  if (creating && (!result || typeof result.ok !== 'boolean' || (result.ok && result.copy?.state !== 'created-confirmed'))) {
    unknown.set(sessionId, 'copy-outcome-unknown'); return { ok: false, code: 'copy-outcome-unknown' };
  }
  if (following && (!result || typeof result.ok !== 'boolean' || (result.ok &&
      (result.copyId !== data.copyId || (operation === 'open-confirmed-copy' &&
        (typeof result.snapshot?.sessionId !== 'string' || result.snapshot.sessionId === sessionId
         || result.snapshot.readOnly !== true || result.snapshot.temporary === true)))))) {
    unknown.set(sessionId, 'copy-action-unknown'); return { ok: false, code: 'copy-action-unknown' };
  }
  if (following && result.ok && states.has(result.snapshot?.sessionId)) return blocked(result.snapshot.sessionId);
  if (!result || typeof result.ok !== 'boolean') unknown.set(sessionId, 'ipc-outcome-unknown');
  if (userClosing) {
    const matched = result && typeof result.ok === 'boolean' && result.sessionId === sessionId
      && result.requestRevision === data.expectedRevision && result.closed === result.ok;
    if (!matched) { lifecycle(sessionId, 'close-outcome-unknown'); return blocked(sessionId); }
    if (result.ok) lifecycle(sessionId, 'invalidated');
    else if (states.get(sessionId) === 'close-pending' && typeof result.code === 'string') lifecycle(sessionId, 'open');
    else return blocked(sessionId);
    return result;
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
async function imagePreview(data) {
  if (states.has(data?.sessionId)) return blocked(data.sessionId);
  try {
    const r = await ipcRenderer.invoke('document-demo:request', {...data, operation:'image-preview'});
    if (states.has(data.sessionId) || !r?.ok || r.sessionId !== data.sessionId || r.revision !== data.expectedRevision
        || r.href !== data.href || typeof r.dataUrl !== 'string' || r.dataUrl.length > MAX_IMAGE_DATA_URL
        || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(r.dataUrl)) return {ok:false,code:'image-preview-unavailable'};
    return r;
  } catch { return {ok:false,code:'image-preview-unavailable'}; }
}
contextBridge.exposeInMainWorld('documentDemo', {
  importImage: data => request('import-image', data), imagePreview,
  renameDraft: data => request('rename-draft', data),
  listRecents: () => request('list-recents'),
  openRecent: recentId => request('open-recent', { recentId }),
  clearRecents: () => request('clear-recents'),
  listNativeOpens: () => request('list-native-opens'),
  openNativeFile: requestId => request('open-native-file', { requestId }),
  dismissNativeOpen: requestId => request('dismiss-native-open', { requestId }),
  onNativeOpenRequest: handler => ipcRenderer.on('document-demo:native-open-request', () => handler()),
  openFile: () => request('open-file'),
  newTemporary: () => request('new-temporary'),
  listDrafts: () => request('list-drafts'),
  manageDraft: data => request('manage-draft', data),
  restoreDraft: draftId => request('restore-draft', { draftId }),
  onDraftStatus: handler => ipcRenderer.on('document-demo:draft-status', (_event, data) => {
    if (typeof data?.sessionId === 'string' && !states.has(data.sessionId)) handler(data);
  }),
  inspectLinkedFile: data => request('inspect-linked-file',data),
  openLinkedFile: data => request('open-linked-file',data),
  revealLinkedFile: data => request('reveal-linked-file',data),
  saveOriginal: data => request('save-original',data),
  listSaveRecoveries: () => request('list-save-recoveries'),
  revealSaveRecovery: recordId => request('reveal-save-recovery',{recordId}),
  openConfirmedCopy: data => request('open-confirmed-copy', data),
  revealConfirmedCopy: data => request('reveal-confirmed-copy', data),
  editCopy: data => request('edit-copy', data),
  createTestCopy: data => request('create-test-copy', data),
  createPersistentCopy: data => request('create-persistent-copy', data),
  onSaveRequest: handler => ipcRenderer.on('document-demo:save-request', () => handler()),
  onOpenRequest: handler => ipcRenderer.on('document-demo:open-request', () => handler()),
  list: () => request('list'),
  snapshot: data => request('snapshot', data),
  edit: data => request('edit', data),
  sourceEdit: data => request('source-edit', data),
  format: data => request('format', data),
  undo: data => request('undo', data),
  redo: data => request('redo', data),
  check: data => request('check', data),
  save: data => request('save', data),
  close: data => request('close', data),
  closeDocument: data => request('close-document', data),
  onCloseRequest: handler => ipcRenderer.on('document-demo:close-request', () => handler()),
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
