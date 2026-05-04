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
  }
});