// Main windows: opening, closing, restoring, tearing tabs off, private windows.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, session, screen } = require('electron');
const store = require('../store');
const { UI, PRELOAD, ICON, TOP, MARGIN, uid, hostOf } = require('./common');

class WindowsPart {
  // ------------------------------------------------------------ windows
  // Each main window has its own current Space, active tab and command bar.
  // Tabs belong to Spaces, not windows (like Arc): showing a tab that another
  // window is showing moves it to this window. Closing one of several windows
  // keeps its tabs; closing the last one quits (after "Leave site?" checks).
  // A private window has its own in-memory Space: no history, cookies,
  // permissions or downloads are kept after it closes.
  createWindow({ spaceId = null, private: priv = false, tor = false, vpn = false, restore = false, at = null, bounds = null, maximized = null } = {}) {
    let b = restore ? { ...(bounds || this.st.bounds || {}) } : {};
    if (maximized !== null) b.maximized = maximized;
    // A saved position on a monitor that's no longer connected: let Windows place it.
    if (b.x !== undefined && !screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return b.x < a.x + a.width - 80 && b.x + (b.width || 400) > a.x + 80 && b.y < a.y + a.height - 40 && b.y >= a.y - 20;
    })) { delete b.x; delete b.y; }
    const area = screen.getDisplayNearestPoint(at || screen.getCursorScreenPoint()).workArea;
    const width = b.width || Math.min(restore ? 1440 : 1280, area.width);
    const height = b.height || Math.min(restore ? 920 : 820, area.height);
    let x = b.x, y = b.y;
    if (at) { x = Math.round(Math.max(area.x, Math.min(at.x - 120, area.x + area.width - width))); y = Math.round(Math.max(area.y, Math.min(at.y - 20, area.y + area.height - height))); }
    else if (!restore && this.cur && !this.cur.win.isDestroyed()) { const p = this.cur.win.getBounds(); x = p.x + 32; y = p.y + 32; }
    const W = { id: uid(), win: null, activeTabId: null, attached: [], paneRects: null, layer: null, layerMode: null, peek: null,
      spaceId, overlay: null, overlayReady: null, overlayMode: null,
      htmlFull: false, f11: false, private: priv, quitting: false, quitReady: false, quitLeft: 0 };
    if (priv) {
      const id = 'private-' + uid();
      const sp = { id, name: tor ? 'Private (Tor)' : vpn ? 'Private (VPN)' : 'Private', emoji: tor ? '🧅' : vpn ? '🛡️' : '🕶️', proxy: tor ? { mode: 'tor' } : vpn ? { mode: 'vpn' } : null, colors: ['#24212E', '#2E2940', '#1C1A24'], grain: 0.25, partition: id,
        private: true, pinned: [], favorites: [], history: [], tabs: [], activeIndex: -1 };
      this.privateSpaces.set(id, sp);
      this.order[id] = [];
      W.spaceId = id;
    }
    if (!this.spaceById(W.spaceId)) W.spaceId = this.st.activeSpaceId;
    if (!this.spaceById(W.spaceId)) W.spaceId = this.st.spaces[0].id;
    W.win = new BrowserWindow({
      width, height, x, y, minWidth: 720, minHeight: 460,
      frame: false, show: false, icon: fs.existsSync(ICON) ? ICON : undefined,
      backgroundColor: (this.st.settings.transparency || 0) > 0 ? '#00000000' : this.spaceById(W.spaceId).colors[0], title: priv ? 'Quasar (Private)' : 'Quasar',
      // Not sandboxed: its preload loads the extension toolbar (<browser-action-list>).
      // This window only ever shows Quasar's own local page (ui/index.html); web pages
      // are separate views and stay sandboxed.
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false, nodeIntegration: false },
    });
    W.win.webContents.on('will-navigate', e => e.preventDefault());   // it never leaves index.html
    this.wins.add(W);
    if (!this.cur) this.cur = W;
    const win = W.win;
    win.loadFile(path.join(UI, 'index.html'));
    this.applySeeThrough(W);   // Settings › Appearance › window transparency (Windows 11 acrylic)
    win.once('ready-to-show', () => { if (b.maximized) win.maximize(); win.show(); });
    win.on('focus', () => { if (this.wins.has(W)) this.cur = W; });
    for (const e of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      win.on(e, () => this.withWin(W, () => { this.layout(); this.push(); }));
    }
    win.on('leave-full-screen', () => { if (W.f11) { W.f11 = false; this.withWin(W, () => { this.layout(); this.push(); }); } });
    // Windows is signing out / shutting down: keep every window for next time.
    win.on('session-end', () => {
      if (this.quittingAll) return;
      const normal = [...this.wins].filter(x => !x.private);
      if (normal.length) this.st.windows = normal.map(x => this.winInfo(x));
      this.quittingAll = true;
      for (const x of this.wins) x.quitReady = true;
    });
    // Closing asks each page that would be lost whether it can unload ("Leave site?").
    win.on('close', e => {
      if (!W.quitReady) { e.preventDefault(); this.withWin(W, () => this.requestClose(W)); return; }
      this.onWindowClosing(W);
    });
    win.on('closed', () => this.onWindowClosed(W));
    win.webContents.on('before-input-event', (e, input) => { this.cur = W; this.onKey(e, input); });
    win.webContents.on('did-finish-load', () => this.withWin(W, () => this.push()));
    // Load the command bar in the background once the window is up, so Ctrl+T opens instantly.
    win.webContents.once('did-finish-load', () => setTimeout(() => this.withWin(W, () => this.prepareOverlay()), 1500));
    return W;
  }

  // Run fn with `W` as the current window, then restore the previous one.
  withWin(W, fn) {
    if (!W || !this.wins.has(W)) return undefined;
    const prev = this.cur;
    this.cur = W;
    try { return fn(); } finally { this.cur = prev && this.wins.has(prev) ? prev : W; }
  }

  winOf(wc) {
    for (const W of this.wins) if (W.win.webContents === wc || W.overlay?.webContents === wc || W.layer?.webContents === wc || W.inapp?.view.webContents === wc) return W;
    return null;
  }

  // Open a new main window (Ctrl+N) or a private one (Ctrl+Shift+N).
  newWindow({ private: priv = false, tor = false, vpn = false, at = null, tabId = null, url = null, spaceId = null } = {}) {
    const from = this.cur;
    const sid = spaceId && !this.privateSpaces.has(spaceId) ? spaceId : (from && !from.private ? from.spaceId : this.st.activeSpaceId);
    const W = this.createWindow({ spaceId: sid, private: priv || tor || vpn, tor, vpn, at });
    this.cur = W;
    this.withWin(W, () => {
      if (tabId) return this.show(tabId);
      if (url) return this.newTab(url);
      this.win.setBackgroundColor(this.windowBg());
      this.changed();
    });
    // An empty new window opens the command bar, like Ctrl+T.
    if (!tabId && !url) W.win.webContents.once('did-finish-load', () => setTimeout(() => this.withWin(W, () => this.openCommand('new')), 50));
    return W;
  }

  // A link from another app (Quasar as default browser): new tab in the last normal window.
  openExternalLink(url) {
    const W = this.normalWin();
    if (W.win.isMinimized()) W.win.restore();
    W.win.show(); W.win.focus();
    this.cur = W;
    if (url) this.withWin(W, () => this.newTab(url));
  }

  // A tab dragged out of the sidebar: into the window under the cursor, or a new window.
  tearOff(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const pt = screen.getCursorScreenPoint();
    const inside = W => { const r = W.win.getBounds(); return pt.x >= r.x && pt.x < r.x + r.width && pt.y >= r.y && pt.y < r.y + r.height; };
    const from = this.cur;
    const sp = this.spaceById(tab.spaceId);
    if (from && inside(from)) {
      // Dropped on its own window: over the page area it gets its own window (like
      // dragging a tab down in Chrome); over the sidebar or top bar nothing happens.
      const cb = from.win.getContentBounds();
      const x = pt.x - cb.x, y = pt.y - cb.y;
      const c = this.cardRect(false);
      if (x < c.x || x > c.x + c.width || y < c.y || sp?.private) return;   // over the sidebar or top bar
      return this.newWindow({ at: pt, tabId });
    }
    const target = [...this.wins].find(W => W !== from && inside(W) && !!W.private === !!sp?.private && (!W.private || W.spaceId === tab.spaceId));
    if (target) { this.cur = target; target.win.focus(); return this.withWin(target, () => this.show(tabId)); }
    if (sp?.private) return;   // private tabs stay in their private window
    this.newWindow({ at: pt, tabId });
  }

  onWindowClosing(W) {
    // Tabs it was showing stay alive in their Space; just take the pages off this window.
    this.withWin(W, () => { this.closePeek(); this.hideLayer(); this.detachAll(); });
    // Last window = every other window is already closing (Quit Quasar closes them all at once).
    const last = [...this.wins].every(x => x === W || x.quitReady || x.win.isDestroyed());
    if (!W.private) {
      const info = this.winInfo(W);
      this.st.bounds = { ...info.bounds, maximized: info.maximized };
      this.st.activeSpaceId = W.spaceId;
      if (!this.quittingAll) {
        // Windows closed just before the last one (e.g. taskbar "Close all windows")
        // count as part of the session, so they come back too.
        const now = Date.now();
        this.recentlyClosed = (this.recentlyClosed || []).filter(x => now - x.at < 1500);
        if (last || ![...this.wins].some(x => x !== W && !x.private)) {
          this.st.windows = [...this.recentlyClosed.map(x => x.info), info];
          this.recentlyClosed = [];
        } else this.recentlyClosed.push({ at: now, info });
      }
    }
    if (W.private) this.dropPrivateSpace(W.spaceId);
    if (last) {
      for (const x of this.wins) if (x !== W && x.private && !x.win.isDestroyed()) this.dropPrivateSpace(x.spaceId);
      if (!this.st.settings.keepTabs) this.closeAllTabsForQuit();
      this.suspendDownloads();
      try { this.updater.onExit(); } catch { /* never block quitting */ }
      try { this.backup.flushOnExit(); } catch { /* never block quitting */ }
      this.persist(); store.flush();
      for (const l of this.littles.values()) l.win.destroy();
    } else this.persist();
  }

  winInfo(W) {
    return { bounds: W.win.getNormalBounds(), maximized: W.win.isMaximized(), spaceId: W.spaceId, focused: W === this.cur };
  }

  // Quit Quasar (Ctrl+Shift+Q): every window closes together and all of them come back next time.
  quitAll() {
    const normal = [...this.wins].filter(W => !W.private);
    if (normal.length) this.st.windows = normal.map(W => this.winInfo(W));
    this.quittingAll = true;
    const W = this.cur || [...this.wins][0];
    if (W) this.requestClose(W, { all: true });
  }

  // Quasar is closing: every open tab in every Space closes (pinned tabs and Favorites stay).
  // They go to the Archive, so a tab closed by mistake can still be found.
  closeAllTabsForQuit() {
    const now = Date.now();
    for (const sp of this.st.spaces) {
      for (const id of this.order[sp.id] || []) {
        const t = this.tabs.get(id);
        if (!t?.url || /^(about|data|view-source|devtools):/i.test(t.url) || this.isCertPage(t.url)) continue;
        this.st.archive.unshift({ id: uid(), url: t.url, title: t.title || t.url, favicon: t.favicon, spaceId: sp.id, closedAt: now });
      }
      this.order[sp.id] = [];
      delete this.activeBySpace[sp.id];
      sp.tabs = []; sp.activeIndex = -1;
    }
    this.st.archive = this.st.archive.slice(0, 300);
  }

  onWindowClosed(W) {
    try { if (W.overlay && !W.overlay.webContents.isDestroyed()) W.overlay.webContents.close(); } catch { /* ignore */ }
    try { if (W.layer && !W.layer.webContents.isDestroyed()) W.layer.webContents.close(); } catch { /* ignore */ }
    this.wins.delete(W);
    if (this.cur === W) this.cur = [...this.wins].pop() || null;
  }

  // Forget everything a private window had: tabs, history, cookies, downloads.
  dropPrivateSpace(id) {
    const sp = this.privateSpaces.get(id);
    if (!sp) return;
    for (const t of [...this.tabs.values()]) {
      if (t.spaceId !== id) continue;
      const wc = t.view?.webContents;
      if (wc && !wc.isDestroyed()) { this.closing.delete(wc.id); wc.close(); }
      this.tabs.delete(t.id);
    }
    for (const l of [...this.littles.values()]) if (l.tab.spaceId === id && !l.win.isDestroyed()) l.win.destroy();
    delete this.order[id]; delete this.activeBySpace[id];
    this.closed = this.closed.filter(c => c.spaceId !== id);
    this.st.downloads = this.st.downloads.filter(d => d.spaceId !== id);
    for (const k of [...this.permissions.keys()]) if (k.startsWith(sp.partition + '|')) this.permissions.delete(k);
    for (const k of [...this.certExceptions.keys()]) if (k.startsWith(sp.partition + '|')) this.certExceptions.delete(k);
    this.devices.dropPartition(sp.partition);
    try { const ses = session.fromPartition(sp.partition); ses.clearStorageData().catch(() => {}); ses.clearCache().catch(() => {}); } catch { /* ignore */ }
    this.privateSpaces.delete(id);
    this.libUpdate();
  }

  // Per-window state, reached through the current window.
  get win() { return this.cur?.win || null; }
  get activeTabId() { return this.cur ? this.cur.activeTabId : null; }
  set activeTabId(v) { if (this.cur) this.cur.activeTabId = v; }
  get overlay() { return this.cur?.overlay || null; }
  set overlay(v) { if (this.cur) this.cur.overlay = v; }
  get overlayReady() { return this.cur?.overlayReady || null; }
  set overlayReady(v) { if (this.cur) this.cur.overlayReady = v; }
  get overlayMode() { return this.cur?.overlayMode || null; }
  set overlayMode(v) { if (this.cur) this.cur.overlayMode = v; }
  get htmlFull() { return !!this.cur?.htmlFull; }
  set htmlFull(v) { if (this.cur) this.cur.htmlFull = v; }
  get curSpaceId() { return this.cur ? this.cur.spaceId : this.st.activeSpaceId; }
  set curSpaceId(v) {
    if (this.cur) this.cur.spaceId = v;
    if (!this.privateSpaces.has(v)) this.st.activeSpaceId = v;
  }
  get isPrivate() { return !!this.cur?.private; }

  get space() { return this.spaceById(this.curSpaceId) || this.st.spaces[0]; }
  spaceById(id) { return this.st.spaces.find(s => s.id === id) || this.privateSpaces.get(id); }
  get active() { return this.tabs.get(this.activeTabId) || null; }
  // Spaces this window can switch between (a private window has only its own).
  get visibleSpaces() { return this.isPrivate ? [this.space] : this.st.spaces; }
  // Is this tab on screen in a window other than the current one?
  shownElsewhere(tabId) {
    for (const W of this.wins) if (W !== this.cur && (W.attached || []).includes(tabId)) return true;
    return false;
  }
  // The window that has this tab on screen (as its tab, or as a pane of a split view).
  hostOf(tabId) { return [...this.wins].find(W => (W.attached || []).includes(tabId)) || null; }

  record(t) {
    const tab = {
      id: uid(), spaceId: t.spaceId, kind: t.kind || 'today', ref: t.ref || null,
      url: t.url || '', title: t.title || '', favicon: t.favicon || '', lastActive: t.lastActive || Date.now(),
      view: null, loading: false, profile: null,
    };
    this.tabs.set(tab.id, tab);
    return tab;
  }
}

module.exports = WindowsPart;
