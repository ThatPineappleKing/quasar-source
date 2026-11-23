// Little Quasar windows.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { UI, PRELOAD, ICON, uid, DRIFT_URL, pageUrl, toUrl } = require('./common');

class LittlePart {
  // ------------------------------------------------------- Little Quasar
  openLittle(url = null) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = 560, h = 720;
    const lw = new BrowserWindow({
      width: w, height: h, x: area.x + area.width - w - 24, y: area.y + 64,
      frame: false, icon: ICON, backgroundColor: this.space.colors[0], minWidth: 360, minHeight: 300,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
    });
    lw.loadFile(path.join(UI, 'little.html'));
    const tab = { id: uid(), spaceId: this.curSpaceId, kind: 'little', url: url || '', title: '', favicon: '', lastActive: Date.now(), view: null, profile: null };
    const little = { win: lw, tab };
    this.littles.set(lw.webContents.id, little);
    const view = this.pageView(tab, { white: false });
    const lay = () => { const [cw, ch] = lw.getContentSize(); view.setBounds({ x: 6, y: 40, width: cw - 12, height: ch - 46 }); };
    lw.contentView.addChildView(view);
    lay(); lw.on('resize', lay);
    const wc = view.webContents;
    const send = () => !lw.isDestroyed() && lw.webContents.send('little:state', { url: tab.url, title: tab.title, colors: this.space.colors, grain: this.space.grain });
    wc.on('did-navigate', (e, u) => { tab.url = this.isCertPage(u) ? (this.certErrors.get(wc.id)?.url || tab.url) : this.isDriftPage(u) ? DRIFT_URL : this.isFailPage(u) ? (this.failInfo.get(wc.id)?.url || tab.url) : u; send(); });
    wc.on('page-title-updated', (e, t) => { if (!this.isArchPage(wc.getURL())) { tab.title = t; send(); } });
    // Closing Little Quasar asks the page first, like closing a tab.
    lw.on('close', e => {
      if (little.closeOk || !tab.view) return;
      const vwc = tab.view.webContents;
      if (!vwc || vwc.isDestroyed() || vwc.isCrashed()) return;
      e.preventDefault();
      if (this.closing.has(vwc.id)) return;
      const entry = { kind: 'little', little };
      this.closing.set(vwc.id, entry);
      vwc.close({ waitForBeforeUnload: true });
      setTimeout(() => { if (this.closing.get(vwc.id) === entry && !vwc.isDestroyed()) vwc.close(); }, 3000);
    });
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.control) { /* let pages use Esc */ }
    });
    wc.setWindowOpenHandler(({ url: u }) => { wc.loadURL(u); return { action: 'deny' }; });
    lw.webContents.on('did-finish-load', () => { send(); if (!url) lw.webContents.send('little:focus-url'); });
    lw.on('closed', () => { this.littles.delete(little.winId); });
    little.winId = lw.webContents.id;
    if (url) Promise.resolve(wc.session.__archProxyReady).then(() => !wc.isDestroyed() && wc.loadURL(pageUrl(url)).catch(() => {}));
    return little;
  }

  littleAct(sender, name, args) {
    const l = this.littles.get(sender.id);
    if (!l) return;
    const wc = l.tab.view.webContents;
    switch (name) {
      case 'go': { const u = toUrl(args[0]) || this.searchUrl(args[0]); l.tab.url = u; wc.loadURL(pageUrl(u)); wc.focus(); return; }
      case 'back': return wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack();
      case 'close': return l.win.close();
      case 'open-main': {
        // Move this page into the main window as a normal tab.
        l.win.contentView.removeChildView(l.tab.view);
        // Goes into the Space it was opened from, since it uses that Space's profile.
        const spaceId = this.spaceById(l.tab.spaceId) ? l.tab.spaceId : this.curSpaceId;
        const tab = this.record({ url: l.tab.url, title: l.tab.title, spaceId });
        tab.profile = l.tab.profile;
        tab.view = l.tab.view;
        this.registerPage(tab.view.webContents, tab);
        this.wire(tab);
        this.order[tab.spaceId].push(tab.id);
        l.tab.view = null;
        l.win.destroy();
        this.win.show(); this.win.focus();
        return this.show(tab.id);
      }
    }
  }
}

module.exports = LittlePart;
