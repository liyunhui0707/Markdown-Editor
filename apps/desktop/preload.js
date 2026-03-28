const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultApi', {
  chooseVaultFolder: () => ipcRenderer.invoke('choose-vault-folder'),
  saveNote: (payload) => ipcRenderer.invoke('save-note', payload),
  loadVaultNotes: (payload) => ipcRenderer.invoke('load-vault-notes', payload)
});