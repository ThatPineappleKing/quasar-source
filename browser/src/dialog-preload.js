// Bridge for Quasar's small dialog windows (the site sign-in prompt).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('archDialog', {
  onInit: cb => ipcRenderer.on('dialog:init', (e, data) => cb(data)),
  reply: data => ipcRenderer.send('dialog:reply', data),
});
