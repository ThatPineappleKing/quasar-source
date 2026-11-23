// Compact mode, sites as sidebar panels, tidying today's tabs, break mode and the
// battery saver.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { Menu, powerMonitor, screen } = require('electron');
const { uid, hostOf } = require('./common');
const { siteOf } = require('../protection');

const PANEL_W = 400;

class WorkspacePart {
  // ------------------------------------------------------------ compact mode
  toggleCompact(on = !this.st.settings.compact) {
    this.st.settings.compact = !!on;
    for (const W of this.wins) W.chromeShown = false;
    this.persist();
    this.layoutAll();
    this.push();
    if (on) this.toast('Compact mode: move the mouse to the edge of the window to bring the sidebar and top bar back. Ctrl+Shift+L turns it off.');
  }

  // The mouse reached the window's edge (show) or left the sidebar and top bar (hide).
  revealChrome(show) {
    const W = this.cur;
    if (!W || !this.anyAutoHide || !!W.chromeShown === !!show) return;
    W.chromeShown = !!show;
    this.layout();
    this.push();
  }

  // Hidden bars come back when the pointer reaches the edge of the window. This is
  // watched here, from the real cursor position, as well as by the thin edge strips in
  // the window: on a window that isn't maximized, Windows keeps the outer few pixels for
  // its invisible resize border, so the strips there often never see the mouse at all.
  edgeWatch() {
    const need = this.anyAutoHide && [...this.wins].some(W => !W.chromeShown && !W.win.isDestroyed());
    if (need && !this.edgeTimer) this.edgeTimer = setInterval(() => this.edgeTick(), 100);
    else if (!need && this.edgeTimer) { clearInterval(this.edgeTimer); this.edgeTimer = null; }
  }
  edgeTick() {
    const ZONE = 10;   // px from the edge (the 6px strip plus the resize border)
    const p = screen.getCursorScreenPoint();
    const s = this.st.settings;
    for (const W of this.wins) {
      const win = W.win;
      if (W.chromeShown || win.isDestroyed() || !win.isFocused() || win.isMinimized() || W.f11 || this.htmlFull || (this.overlayMode && this.overlayMode !== 'find')) { W.edgeHits = 0; continue; }
      const b = win.getContentBounds();
      const inX = p.x >= b.x - 1 && p.x <= b.x + b.width, inY = p.y >= b.y - 1 && p.y <= b.y + b.height;
      const hid = this.chromeHidden(W);
      const side = s.sidebarSide === 'right' ? 'right' : s.sidebarSide === 'top' ? 'top' : 'left';
      const sbEdge = hid.sb && !s.sidebarHidden && side !== 'top' && inY &&
        (side === 'left' ? p.x >= b.x - 1 && p.x < b.x + ZONE : p.x > b.x + b.width - ZONE && p.x <= b.x + b.width);
      const topEdge = (hid.top || (hid.sb && side === 'top' && !s.sidebarHidden)) && inX && p.y >= b.y - 1 && p.y < b.y + ZONE;
      // Two ticks in a row, so sweeping the pointer across the edge doesn't flash the bars.
      // After the bars hide again, the pointer has to leave the edge before it counts
      // again (otherwise a pointer resting there would show and hide them over and over).
      if (!sbEdge && !topEdge) { W.edgeHits = 0; W.edgeArmed = true; continue; }
      if (W.edgeArmed === false) continue;
      W.edgeHits = (W.edgeHits || 0) + 1;
      if (W.edgeHits >= 2) { W.edgeHits = 0; W.edgeArmed = false; this.withWin(W, () => this.revealChrome(true)); }
    }
  }

  // ----------------------------------------------------- sidebar web panels
  // Sites kept in a narrow panel beside whatever page is open (chat, calendar,
  // music). Each panel uses the Space it was added from (its logins), stays loaded
  // while closed, and opens links in a normal tab.
  get panels() { return (this.st.panels ||= []); }

  panelWidth(W = this.cur) {
    const open = W?.panelOpen && this.panels.find(p => p.id === W.panelOpen);
    if (!open || this.htmlFull || W.f11) return 0;
    const [w] = this.win.getContentSize();
    return Math.min(open.width || PANEL_W, Math.max(0, w - 640));
  }

  panelView(W, p) {
    W.panelViews ||= new Map();
    let v = W.panelViews.get(p.id);
    if (v && !v.webContents.isDestroyed()) return v;
    const sp = this.spaceById(p.spaceId) || this.st.spaces[0];
    const tab = { id: 'panel-' + p.id, spaceId: sp.id, kind: 'panel', url: p.url, title: p.title, favicon: '', view: null, profile: null, lastActive: Date.now() };
    v = this.pageView(tab);
    const wc = v.webContents;
    wc.on('page-favicon-updated', (e, icons) => { const f = icons.find(i => !/^data:,?$/.test(i)); if (f && f !== p.favicon) { p.favicon = f; this.persist(); this.push(); } });
    wc.on('page-title-updated', (e, t) => { tab.title = t; });
    wc.on('before-input-event', (e, input) => { if (this.wins.has(W)) this.cur = W; this.onKey(e, input); });
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (disposition === 'new-window' && features) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true } };
      this.withWin(W, () => this.newTab(url, { spaceId: sp.id, route: true }));
      return { action: 'deny' };
    });
    Promise.resolve(wc.session.__archProxyReady).then(() => !wc.isDestroyed() && wc.loadURL(p.url).catch(() => {}));
    W.panelViews.set(p.id, v);
    return v;
  }

  layoutPanel(W, full) {
    const views = W.panelViews || new Map();
    const r = full ? null : this.panelRect();
    for (const [id, v] of views) {
      if (v.webContents.isDestroyed()) { views.delete(id); continue; }
      const on = r && id === W.panelOpen;
      if (on) {
        if (!v.__attached) { this.win.contentView.addChildView(v); v.__attached = true; this.restack(); }
        v.setBounds(r);
      } else if (v.__attached) { try { this.win.contentView.removeChildView(v); } catch { /* ignore */ } v.__attached = false; }
    }
  }

  panelAct(op, arg) {
    const W = this.cur;
    if (op === 'add') {
      const t = this.active;
      if (!t?.url || !/^https?:/i.test(t.url) || this.isPrivate) return this.toast('Open the site you want as a panel first (not in a private window).');
      if (this.panels.some(p => p.url === t.url)) return;
      const p = { id: uid(), url: t.url, title: t.title || hostOf(t.url), favicon: t.favicon || '', spaceId: t.spaceId, width: PANEL_W };
      this.panels.push(p);
      W.panelOpen = p.id;
      this.panelView(W, p);
      this.toast(`${p.title} is a sidebar panel now. Click its icon at the bottom of the sidebar to open or close it.`);
    } else if (op === 'toggle') {
      const p = this.panels.find(x => x.id === arg);
      if (!p) return;
      W.panelOpen = W.panelOpen === p.id ? null : p.id;
      if (W.panelOpen) this.panelView(W, p);
    } else if (op === 'remove') {
      this.panels.splice(this.panels.findIndex(x => x.id === arg), 1);
      for (const X of this.wins) {
        const v = X.panelViews?.get(arg);
        if (v) { try { X.win.contentView.removeChildView(v); } catch { /* ignore */ } if (!v.webContents.isDestroyed()) v.webContents.close(); X.panelViews.delete(arg); }
        if (X.panelOpen === arg) X.panelOpen = null;
      }
    } else if (op === 'menu') {
      const p = this.panels.find(x => x.id === arg.id);
      if (!p) return;
      const v = W.panelViews?.get(p.id);
      return Menu.buildFromTemplate([
        { label: p.title, enabled: false },
        { label: 'Reload', enabled: !!v, click: () => v.webContents.reload() },
        { label: 'Back to Its Home Page', enabled: !!v, click: () => v.webContents.loadURL(p.url) },
        { label: 'Open in a Tab', click: () => this.newTab(v && !v.webContents.isDestroyed() ? v.webContents.getURL() : p.url, { spaceId: p.spaceId }) },
        { label: 'Width', submenu: [320, 400, 480, 560].map(n => ({ label: `${n} px`, type: 'radio', checked: (p.width || PANEL_W) === n, click: () => { p.width = n; this.persist(); this.layoutAll(); } })) },
        { type: 'separator' },
        { label: 'Remove Panel', click: () => this.panelAct('remove', p.id) },
      ]).popup({ window: this.win, x: Math.round(arg.x || 0), y: Math.round(arg.y || 0) });
    }
    this.persist();
    this.layoutAll();
    this.push();
  }

  panelsViewModel() {
    const W = this.cur;
    return this.isPrivate ? [] : this.panels.map(p => ({ id: p.id, title: p.title, url: p.url, favicon: p.favicon, open: W?.panelOpen === p.id }));
  }

  // --------------------------------------------------------- tidy today's tabs
  // Puts tabs from the same site next to each other (the sites in the order you
  // first opened them) and closes exact duplicates.
  tidyTabs(spaceId = this.curSpaceId) {
    const list = this.order[spaceId] || [];
    if (list.length < 2) return this.toast('Nothing to tidy.');
    const seen = new Map(), dupes = [];
    for (const id of list) {
      const t = this.tabs.get(id);
      if (!t) continue;
      const key = t.url.replace(/#.*$/, '');
      if (seen.has(key) && !t.splitId && ![...this.wins].some(W => W.activeTabId === id)) dupes.push(id); else seen.set(key, id);
    }
    const keep = list.filter(id => !dupes.includes(id));
    const groups = new Map();
    for (const id of keep) {
      const t = this.tabs.get(id);
      const g = t?.splitId ? 'split:' + t.splitId : siteOf(hostOf(t?.url || '')) || 'other';
      (groups.get(g) || groups.set(g, []).get(g)).push(id);
    }
    const sorted = [...groups.values()].flat();
    const moved = sorted.some((id, i) => keep[i] !== id);
    this.order[spaceId] = sorted.concat(dupes);
    for (const id of dupes) this.closeTab(id);
    const sites = [...groups.values()].filter(g => g.length > 1).length;
    this.changed();
    this.toast(moved || dupes.length ? `Tidied: ${sites ? `tabs from ${sites} site${sites === 1 ? '' : 's'} grouped together` : 'tabs grouped by site'}${dupes.length ? `, ${dupes.length} duplicate${dupes.length === 1 ? '' : 's'} closed` : ''}.` : 'Already tidy.');
    return { dupes: dupes.length, groups: groups.size };
  }

  // -------------------------------------------------------------- break mode
  // Hides every tab behind a timer and silences them, for a set number of minutes.
  startBreak(minutes = 15) {
    const m = Math.max(1, Math.min(240, Number(minutes) || 15));
    this.breakUntil = Date.now() + m * 60e3;
    this.breakMuted = [];
    for (const t of this.tabs.values()) {
      const wc = t.view?.webContents;
      if (!wc || wc.isDestroyed()) continue;
      if (!wc.isAudioMuted()) { wc.setAudioMuted(true); this.breakMuted.push(t.id); }
      wc.executeJavaScript('document.querySelectorAll("video, audio").forEach(m => { if (!m.paused) { m.pause(); m.dataset.archBreak = "1"; } })').catch(() => {});
    }
    for (const W of this.wins) this.withWin(W, () => { this.closePeek(); this.openCommand('break', '', { brk: { until: this.breakUntil, minutes: m } }); });
    clearTimeout(this.breakT);
    this.breakT = setTimeout(() => this.endBreak(), m * 60e3 + 500);
    this.push();
  }

  endBreak() {
    if (!this.breakUntil) return;
    this.breakUntil = 0;
    clearTimeout(this.breakT);
    for (const id of this.breakMuted || []) { const wc = this.tabs.get(id)?.view?.webContents; if (wc && !wc.isDestroyed()) wc.setAudioMuted(false); }
    this.breakMuted = [];
    for (const W of this.wins) this.withWin(W, () => { if (this.overlayMode === 'break') this.closeCommand(); });
    this.toast('Break over. Welcome back.');
    this.push();
  }

  // ------------------------------------------------------------ battery saver
  // On battery (Settings › Battery saver, on by default): background tabs sleep
  // after 5 minutes, hover previews aren't captured, and silent videos in
  // background tabs pause.
  startBatteryWatch() {
    const update = () => {
      const was = this.onBattery;
      this.onBattery = this.st.settings.batterySaver !== false && powerMonitor.isOnBatteryPower();
      if (this.onBattery && !was) {
        this.toast('On battery: Quasar is saving power (background tabs sleep sooner).');
        for (const t of this.tabs.values()) {
          const wc = t.view?.webContents;
          if (wc && !wc.isDestroyed() && !this.hostOf(t.id) && !t.audible) wc.executeJavaScript('document.querySelectorAll("video").forEach(v => { if (!v.paused && v.muted) v.pause(); })').catch(() => {});
        }
      }
      if (was !== this.onBattery) this.push();
    };
    try { powerMonitor.on('on-battery', update); powerMonitor.on('on-ac', update); } catch { /* not available */ }
    update();
  }
}

module.exports = WorkspacePart;
