const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultApi', {
  chooseVaultFolder: () => ipcRenderer.invoke('choose-vault-folder'),
  watchVaultFolder: (payload) => ipcRenderer.invoke('watch-vault-folder', payload),
  unwatchVaultFolder: () => ipcRenderer.invoke('unwatch-vault-folder'),
  seedDemoVault: (payload) => ipcRenderer.invoke('seed-demo-vault', payload),
  saveNote: (payload) => ipcRenderer.invoke('save-note', payload),
  deleteNoteFile: (payload) => ipcRenderer.invoke('delete-note-file', payload),
  loadVaultNotes: (payload) => ipcRenderer.invoke('load-vault-notes', payload),
  onVaultChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vault-changed', listener);
    return () => ipcRenderer.removeListener('vault-changed', listener);
  }
});