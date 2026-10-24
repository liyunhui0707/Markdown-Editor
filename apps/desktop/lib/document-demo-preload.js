'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed isolated preload: no generic invoke, paths, fs or policy options.
const request = (operation, data = {}) => ipcRenderer.invoke('document-demo:request', { ...data, operation });
contextBridge.exposeInMainWorld('documentDemo', {
  list: () => request('list'),
  snapshot: data => request('snapshot', data),
  edit: data => request('edit', data),
  check: data => request('check', data),
  save: data => request('save', data),
  close: data => request('close', data),
  onReady: handler => ipcRenderer.once('document-demo:ready', () => handler()),
});
