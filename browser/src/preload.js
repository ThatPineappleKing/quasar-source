// Bridge between Quasar's own UI pages and the main process. Web pages never
// get this preload; they run sandboxed with no access to it.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The main window shows extension toolbar buttons (only there; other Quasar pages
// are sandboxed and can't load this module).
if (/\/ui\/index\.html$/.test(location.pathname)) {
  try { require('electron-chrome-extensions/browser-action').injectBrowserAction(); } catch { /* extensions unavailable */ }
}

contextBridge.exposeInMainWorld('arch', {
  act: (name, ...args) => ipcRenderer.invoke('act', name, args),
  on: (channel, cb) => {
    const allowed = ['state', 'toast', 'command:open', 'find:result', 'little:state', 'little:focus-url', 'ui:space', 'ui:folder', 'lib:update', 'lib:show', 'layer:show', 'layer:hide', 'layer:peek', 'chooser:list', 'ui:view',
      'ui:speak', 'dl:list', 'ui:group', 'ui:f6', 'ui:focus', 'markup:init', 'tm:update', 'ui:glass', 'switcher:show'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (e, data) => cb(data));
  },
  // A file dropped on Quasar's window: where it is on disk (to open it in a tab).
  pathForFile: f => { try { return webUtils.getPathForFile(f) || ''; } catch { return ''; } },
});
