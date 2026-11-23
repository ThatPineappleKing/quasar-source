// Focus screen: the clock shown in the page area when no tab is open, and the
// custom background photo behind it (only the page area, never the sidebar).
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };
const MAX_BYTES = 40 * 1024 * 1024;
const bgDir = () => path.join(app.getPath('userData'), 'backgrounds');

class FocusPart {
  // Settings opens in the page area, like a tab (and like Library / Passwords).
  // `section` scrolls it to one part, e.g. 'focus' for the clock and background.
  openSettings(section = null) {
    const W = this.cur;
    const open = W.inapp?.kind === 'settings' && !W.inapp.view.webContents.isDestroyed();
    const f = this.openInApp('settings', 'settings.html');
    if (section && /^[a-z]+$/.test(section)) {
      const go = () => !f.webContents.isDestroyed() && f.webContents.send('ui:view', section);
      if (open) go(); else f.webContents.once('did-finish-load', go);
    }
    return null;
  }

  async backgroundAct(what) {
    const s = this.st.settings;
    switch (what) {
      case 'pick': {
        const r = await dialog.showOpenDialog(this.win, {
          title: 'Choose a background photo',
          filters: [{ name: 'Images', extensions: Object.keys(IMG_TYPES) }], properties: ['openFile'],
        });
        if (r.canceled || !r.filePaths[0]) return null;
        const src = r.filePaths[0];
        const ext = path.extname(src).slice(1).toLowerCase();
        if (!IMG_TYPES[ext]) { this.toast('That file isn’t a picture Quasar can show.'); return null; }
        if (fs.statSync(src).size > MAX_BYTES) { this.toast('That picture is too big (over 40 MB).'); return null; }
        // A new name each time, so every window notices the change.
        const name = `bg-${Date.now()}.${ext}`;
        try {
          fs.mkdirSync(bgDir(), { recursive: true });
          fs.copyFileSync(src, path.join(bgDir(), name));
        } catch (e) { this.toast('Couldn’t use that picture: ' + e.message); return null; }
        this.removeBackgroundFile(s.background);
        s.background = name;
        s.bgChoice = 'custom';
        this.changed();
        return { ok: true };
      }
      case 'remove':
        this.removeBackgroundFile(s.background);
        s.background = null;
        if (s.bgChoice === 'custom') s.bgChoice = 'none';
        this.changed();
        return { ok: true };
      case 'get': {
        // Sent on request (not in every state update) since a photo can be megabytes.
        const name = s.background;
        if (!name || name !== path.basename(name)) return null;
        const ext = path.extname(name).slice(1).toLowerCase();
        try { return `data:${IMG_TYPES[ext] || 'image/jpeg'};base64,${fs.readFileSync(path.join(bgDir(), name)).toString('base64')}`; } catch { return null; }
      }
    }
    return null;
  }

  removeBackgroundFile(name) {
    if (!name || name !== path.basename(name)) return;
    try { fs.unlinkSync(path.join(bgDir(), name)); } catch { /* already gone */ }
  }
}

module.exports = FocusPart;
