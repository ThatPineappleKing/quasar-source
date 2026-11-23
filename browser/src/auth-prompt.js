// The "Sign in" dialog for sites (and proxies) that ask for a username and
// password with HTTP authentication. Opens a small modal window over the
// page's window and resolves with { username, password }, or null if cancelled.
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

const UI = path.join(__dirname, '..', 'ui');
const PRELOAD = path.join(__dirname, 'dialog-preload.js');
const W = 420, H = 360;

function promptLogin(parent, info) {
  return new Promise(resolve => {
    const pb = parent && !parent.isDestroyed() ? parent.getBounds() : null;
    const win = new BrowserWindow({
      width: W, height: H, useContentSize: true,
      x: pb ? Math.round(pb.x + (pb.width - W) / 2) : undefined,
      y: pb ? Math.round(pb.y + Math.min(120, Math.max(0, (pb.height - H) / 2))) : undefined,
      parent: pb ? parent : undefined, modal: !!pb,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      frame: false, show: false, skipTaskbar: !!pb, title: 'Sign in',
      backgroundColor: '#00000000', transparent: true,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, spellcheck: false },
    });
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      ipcMain.removeListener('dialog:reply', onReply);
      if (!win.isDestroyed()) win.destroy();
      if (parent && !parent.isDestroyed()) parent.focus();
      resolve(value);
    };
    const onReply = (e, data) => {
      if (win.isDestroyed() || e.sender !== win.webContents) return;
      const ok = data && typeof data.username === 'string' && typeof data.password === 'string';
      finish(ok ? { username: data.username.slice(0, 1024), password: data.password.slice(0, 4096) } : null);
    };
    ipcMain.on('dialog:reply', onReply);
    win.on('closed', () => finish(null));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('dialog:init', info);
      win.show();
      win.webContents.focus();
    });
    win.loadFile(path.join(UI, 'auth.html')).catch(() => finish(null));
  });
}

module.exports = { promptLogin };
