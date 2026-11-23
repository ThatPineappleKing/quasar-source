// Where pages go in the window, showing a tab, and tab hover previews.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { screen } = require('electron');
const { MARGIN, SPLIT_GAP, hostOf } = require('./common');
const EDGE = 6;   // compact mode: the strip around the page that brings the sidebar back

class LayoutPart {
  // ------------------------------------------------- layout and showing tabs
  // The rounded page area to the right of the sidebar, in window coordinates.
  // Compact mode: the sidebar and top bar are hidden and the page fills the window,
  // leaving a thin edge that brings them back when the mouse touches it.
  // A web panel (Sites as sidebar panels) takes a strip on the other side.
  cardRect(withPanel = true) {
    const [w, h] = this.win.getContentSize();
    const W = this.cur;
    const s = this.st.settings;
    const hid = this.chromeHidden(W);
    const sbOff = s.sidebarHidden || hid.sb;
    let top = hid.top ? EDGE : this.topH();
    let left = MARGIN, right = MARGIN;
    const bottom = s.compact && !W?.chromeShown ? EDGE : MARGIN;
    if (this.sidebarTop) {
      if (!sbOff) {
        top = (hid.top ? 0 : this.topH()) + this.stripH();
        if (W?.sbPanel) left = this.sbW(W);
      } else if (hid.sb && !hid.top) top = this.topH();
    } else if (!sbOff) {
      if (this.sidebarRight) right = this.sbW(W); else left = this.sbW(W);
    } else if (hid.sb) {
      if (this.sidebarRight) right = EDGE; else left = EDGE;
    }
    if (hid.top && hid.sb && !this.sidebarTop) { left = this.sidebarRight ? EDGE : left; right = this.sidebarRight ? right : EDGE; }
    const r = { x: left, y: top, width: Math.max(0, w - left - right), height: Math.max(0, h - top - bottom) };
    const pw = withPanel ? this.panelWidth(W) : 0;
    if (pw) {
      r.width = Math.max(200, r.width - pw - MARGIN);
      if (this.sidebarRight) r.x += pw + MARGIN;
    }
    return r;
  }

  // Where the open web panel goes (next to the page, on the side away from the sidebar).
  panelRect() {
    const W = this.cur;
    const pw = this.panelWidth(W);
    if (!pw) return null;
    const c = this.cardRect();
    return { x: this.sidebarRight ? c.x - pw - MARGIN : c.x + c.width + MARGIN, y: c.y, width: pw, height: c.height };
  }

  get sidebarRight() { return this.st.settings.sidebarSide === 'right'; }

  // Panes of a split view inside the card: side by side, or (Arrange as Grid) two
  // columns, with the third and fourth pane stacked.
  splitRects(g, card) {
    const n = g.tabIds.length;
    if (g.grid && n >= 3) {
      const colW = Math.round((card.width - SPLIT_GAP) / 2), rowH = Math.round((card.height - SPLIT_GAP) / 2);
      const x2 = card.x + colW + SPLIT_GAP, y2 = card.y + rowH + SPLIT_GAP;
      const right = card.x + card.width - x2, bottom = card.y + card.height - y2;
      const cells = n === 3
        ? [[card.x, card.y, colW, card.height], [x2, card.y, right, rowH], [x2, y2, right, bottom]]
        : [[card.x, card.y, colW, rowH], [x2, card.y, right, rowH], [card.x, y2, colW, bottom], [x2, y2, right, bottom]];
      return g.tabIds.map((id, i) => ({ tabId: id, x: cells[i][0], y: cells[i][1], width: cells[i][2], height: cells[i][3] }));
    }
    const avail = Math.max(0, card.width - SPLIT_GAP * (n - 1));
    const sum = g.sizes.reduce((a, b) => a + b, 0) || 1;
    let x = card.x;
    return g.tabIds.map((id, i) => {
      const width = i === n - 1 ? card.x + card.width - x : Math.round(avail * g.sizes[i] / sum);
      const r = { tabId: id, x, y: card.y, width, height: card.height };
      x += width + SPLIT_GAP;
      return r;
    });
  }

  activeSplit() {
    const g = this.active?.splitId ? this.splits.get(this.active.splitId) : null;
    return g && g.tabIds.every(id => (this.cur?.attached || []).includes(id)) ? g : null;
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const W = this.cur;
    const [w, h] = this.win.getContentSize();
    const tab = this.active;
    const card = this.cardRect();
    const full = this.htmlFull || W?.f11;
    const g = this.activeSplit();
    W.paneRects = null;
    if (g && !full) {
      W.paneRects = this.splitRects(g, card);
      for (const r of W.paneRects) {
        const t = this.tabs.get(r.tabId);
        if (!t?.view) continue;
        t.view.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
        if (t.view.setBorderRadius) t.view.setBorderRadius(this.radiusPx());
      }
    } else if (tab?.view) {
      for (const id of W.attached || []) {   // other split panes hide while one is full screen
        const t = this.tabs.get(id);
        if (t !== tab && t?.view) t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      if (full) {
        tab.view.setBounds({ x: 0, y: 0, width: w, height: h });
        if (tab.view.setBorderRadius) tab.view.setBorderRadius(0);
      } else {
        tab.view.setBounds(card);
        if (tab.view.setBorderRadius) tab.view.setBorderRadius(this.radiusPx());
      }
    }
    // Library / Passwords shown inside the window cover the page area.
    if (W.inapp) W.inapp.view.setBounds(full ? { x: 0, y: 0, width: 0, height: 0 } : card);
    // Peek and the screenshot picker float over the page.
    if (W.layer && W.layerMode) {
      const r = W.layerMode === 'shot' ? this.shotTarget().rect : card;
      W.layer.setBounds(r);
    }
    if (W.peek) W.peek.view.setBounds(this.peekRect(card));
    this.layoutPanel(W, full);
    if (this.overlay && this.overlayMode) {
      if (this.overlayMode === 'find') this.overlay.setBounds({ x: Math.max(0, card.x + card.width - 380 - 8), y: card.y + 8, width: 380, height: 64 });
      else this.overlay.setBounds({ x: 0, y: 0, width: w, height: h });
    }
  }

  // Keep floating views above the page views: Peek / screenshot layer, Peek page, command bar.
  restack() {
    const W = this.cur;
    if (W.inapp && !W.inapp.view.webContents.isDestroyed()) this.win.contentView.addChildView(W.inapp.view);
    if (W.layer && W.layerMode) this.win.contentView.addChildView(W.layer);
    if (W.peek) this.win.contentView.addChildView(W.peek.view);
    if (this.overlay && this.overlayMode) this.win.contentView.addChildView(this.overlay);
  }

  detachAll(keep = new Set()) {
    const W = this.cur;
    for (const id of W.attached || []) {
      if (keep.has(id)) continue;
      const t = this.tabs.get(id);
      if (t?.view) { try { this.win.contentView.removeChildView(t.view); } catch { /* ignore */ } }
      if (t && t.host === W) t.host = null;
      if (t) t.hiddenAt = Date.now();   // tab sleeping counts from when it left the screen
    }
    W.attached = (W.attached || []).filter(id => keep.has(id));
  }

  show(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return this.showNothing();
    const W = this.cur;
    // Private tabs only show in their private window, and normal tabs never in a private one.
    const tabPrivate = this.privateSpaces.has(tab.spaceId);
    if (tabPrivate ? W.spaceId !== tab.spaceId : W.private) {
      let to = [...this.wins].find(x => (tabPrivate ? x.spaceId === tab.spaceId : !x.private));
      if (!to && tabPrivate) return;
      if (!to) return this.newWindow({ tabId });
      to.win.focus();
      return this.withWin(to, () => this.show(tabId));
    }
    // Opening a tab leaves the Library / Passwords page, like Arc.
    if (W.inapp) this.closeInApp(W);
    // A tab in a split view shows together with the rest of its split.
    const g = tab.splitId ? this.splits.get(tab.splitId) : null;
    const members = (g ? g.tabIds : [tab.id]).map(id => this.tabs.get(id)).filter(Boolean);
    // Another window showing any of them lets go and shows something else.
    for (const m of members) {
      const other = [...this.wins].find(x => x !== W && (x.attached || []).includes(m.id));
      if (other) this.withWin(other, () => this.vacate(m.id));
    }
    const prev = this.active;
    const keep = new Set(members.map(m => m.id));
    // A last look at the tab we're leaving, for hover previews in the sidebar.
    for (const id of W.attached || []) if (!keep.has(id)) this.captureThumb(this.tabs.get(id));
    this.detachAll(keep);
    for (const m of members) {
      this.ensureView(m);
      this.win.contentView.addChildView(m.view);
      m.host = W;
    }
    W.attached = [...keep];
    this.restack();
    this.activeTabId = tab.id;
    if (!this.cycling) { tab.lastActive = Date.now(); if (W.mruCycle) this.endCycle(W); }   // (Ctrl+Tab sets it when Ctrl is let go)
    // A pinned tab or Favorite is shared by every Space on the same Profile:
    // opening it from "Second Home" keeps you in "Second Home".
    if (tab.kind !== 'today' && tab.spaceId !== this.curSpaceId && this.sameProfile(tab.spaceId, this.curSpaceId)) tab.spaceId = this.curSpaceId;
    // Showing a tab always brings its own Space forward.
    if (tab.spaceId && tab.spaceId !== this.curSpaceId && this.spaceById(tab.spaceId)) {
      this.curSpaceId = tab.spaceId;
      this.win.setBackgroundColor(this.windowBg());
    }
    this.activeBySpace[tab.spaceId] = tab.id;
    this.layout();
    this.extensions.addTab(tab.view.webContents, W.win);   // (re)tell extensions which window it's in
    this.extensions.selectTab(tab.view.webContents);
    if (!this.overlayMode && !W.peek) tab.view.webContents.focus();
    // A tab that crashed in the background shows the crash page (with Reload) now.
    for (const m of members) {
      const mwc = m.view?.webContents;
      if (m.crashed && mwc && !mwc.isDestroyed() && !this.isCrashPage(mwc.getURL())) this.showCrashPage(mwc);
    }
    // Picture-in-picture: a video playing in the tab we left floats; coming back ends it.
    if (prev && prev !== tab && !keep.has(prev.id)) this.autoPip(prev);
    for (const m of members) if (m.pip) this.endPip(m);
    this.changed();
  }

  // ---------------------------------------------------- tab hover previews
  // A small picture of each tab, taken while it's on screen (when it finishes
  // loading, every half minute, and just before you switch away). Kept in memory only.
  captureThumb(tab) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed() || !this.hostOf(tab.id) || this.st.settings.tabPreviews === false || this.onBattery) return;
    if (this.privateSpaces.has(tab.spaceId)) return;   // nothing kept from private windows
    if (tab.thumbAt && Date.now() - tab.thumbAt < 1500) return;
    tab.thumbAt = Date.now();
    wc.capturePage().then(img => {
      if (!img || img.isEmpty()) return;
      const s = img.getSize();
      const small = s.width > 400 ? img.resize({ width: 400, quality: 'good' }) : img;
      tab.thumb = 'data:image/jpeg;base64,' + small.toJPEG(72).toString('base64');
    }).catch(() => {});
  }

  thumbsTick() {
    // Only for windows you're using: a minimised or background window's previews are
    // refreshed when you switch away from a tab anyway.
    for (const W of this.wins) {
      if (W.win.isDestroyed() || W.win.isMinimized() || !W.win.isFocused()) continue;
      for (const id of W.attached || []) this.captureThumb(this.tabs.get(id));
    }
  }

  tabPreview(id) {
    const t = this.tabs.get(id) || this.liveTab('pinned', id) || this.liveTab('fav', id);
    if (!t || this.st.settings.tabPreviews === false) return null;
    return { title: t.title || hostOf(t.url), host: hostOf(t.url) || t.url, thumb: t.thumb || '', sleeping: !!t.sleeping };
  }

  showNothing() {
    if (this.cur?.inapp) this.closeInApp(this.cur);
    const prev = this.active;
    this.detachAll();
    this.activeTabId = null;
    if (prev) this.autoPip(prev);
    this.changed();
  }

  // The current window gives up `tabId` (shown elsewhere now) and picks another tab of its Space.
  vacate(tabId) {
    const t = this.tabs.get(tabId);
    const gone = new Set(t?.splitId ? this.splits.get(t.splitId)?.tabIds || [tabId] : [tabId]);
    this.detachAll();
    this.activeTabId = null;
    const list = (this.order[this.curSpaceId] || []).filter(id => !gone.has(id) && !this.shownElsewhere(id));
    const next = list[list.length - 1];
    if (next) this.show(next); else this.changed();
  }

  // Tab not on screen in another window (so this window may show it without stealing).
  freeTab(id) { return id && this.tabs.has(id) && !this.shownElsewhere(id); }
}

module.exports = LayoutPart;
