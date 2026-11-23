// "--arch-verify-update=<file>": started (hidden) by the updater on a newly downloaded
// Electron, before switching to it. Checks that Quasar's code loads and its window page renders
// on this Electron, writes the Electron version to <file>, and exits. No windows are
// shown and no user data is touched.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

module.exports = function verify(marker) {
  const fail = () => { try { fs.writeFileSync(marker, 'failed'); } catch { /* ignore */ } app.exit(1); };
  setTimeout(fail, 60000);
  app.setPath('userData', path.join(app.getPath('temp'), 'arch-verify-' + process.pid));
  app.whenReady().then(async () => {
    try {
      require('./shell');                       // all of Quasar's main-process code loads
      require('./updater');
      require('@mozilla/readability');          // the packages Quasar is built from load too (components.js)
      require('electron-chrome-extensions');
      if (!fs.existsSync(path.join(__dirname, '..', 'node_modules', '@browsermt', 'bergamot-translator', 'translator.js'))) return fail();
      const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
      await win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
      const ok = await win.webContents.executeJavaScript('typeof window.arch === "object" && !!document.getElementById("sidebar")');
      if (!ok) return fail();
      fs.writeFileSync(marker, process.versions.electron);
      try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch { /* ignore */ }
      app.exit(0);
    } catch { fail(); }
  });
};
