const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultApi', {
  saveNote: (note) => ipcRenderer.invoke('save-note', note),
  loadVaultNotes: () => ipcRenderer.invoke('load-vault-notes')
});