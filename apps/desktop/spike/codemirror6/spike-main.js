'use strict';

/* Stage 3 throwaway spike — boots an isolated Electron window pointed at
   spike.html. Does NOT touch the production app's main.js, preload, IPC,
   or vault layer. Quitting this window has no effect on the main app. */

const { app, BrowserWindow } = require('electron');
const path = require('path');

function createSpikeWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 880,
    title: 'CM6 Spike — Stage 3',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'spike.html'));
}

app.whenReady().then(() => {
  createSpikeWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSpikeWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
