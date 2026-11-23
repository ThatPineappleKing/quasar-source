// Tabs: opening, closing (one or several), switching (Ctrl+Tab), sleeping, moving, the tab menu, the archive and history.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { app, Menu, clipboard } = require('electron');
const store = require('../store');
const { uid, hostOf, walkPinned, findPinned, pinnedTabNodes, pageUrl, toUrl } = require('./common');

class TabsPart {
  // ------------------------------------------------------- tab sleeping
  // Background tabs nobody has looked at for a while give their memory back:
  // the page is unloaded but the tab stays where it is and reloads (at the same
  // scroll position) when you click it. Pages playing sound, in picture-in-picture,
  // with unsaved work ("Leave site?"), or with DevTools open are left awake.
  sleepIdleTabs({ force = false } = {}) {
    let n = 0;
    for (const t of [...this.tabs.values()]) {
      const mins = this.sleepMinFor(t);   // the Space's own setting, else Settings; sooner on battery
      if (!force && (!mins || Math.max(t.lastActive || 0, t.hiddenAt || 0) > Date.now() - mins * 60e3)) continue;
      if (this.canSleep(t)) { this.sleepTab(t); n++; }
    }
    return n;
  }

  canSleep(t) {
    const wc = t?.view?.webContents;
    if (!wc || wc.isDestroyed() || wc.isCrashed() || this.closing.has(wc.id)) return false;
    if (!['today', 'pinned', 'fav'].includes(t.kind) || this.hostOf(t.id)) return false;
    if (t.audible || t.pip || wc.isCurrentlyAudible() || wc.isDevToolsOpened() || t.loading) return false;
    const url = wc.getURL();
    if (this.neverSleeps(url)) return false;   // site-info menu › Never put this site to sleep
    return !!url && !/^(about|data|devtools):/i.test(url) && !this.isArchPage(url);
  }

  async sleepTab(t) {
    if (!this.canSleep(t)) return false;
    const wc = t.view.webContents;
    try { t.sleepScroll = await wc.executeJavaScript('[Math.round(scrollX), Math.round(scrollY)]'); } catch { t.sleepScroll = null; }
    if (!this.canSleep(t)) return false;   // shown again meanwhile
    const entry = { kind: 'sleep', tab: t, view: t.view, quiet: true };   // quiet: unsaved work keeps it awake
    this.closing.set(wc.id, entry);
    wc.close({ waitForBeforeUnload: true });
    // A page that doesn't answer stays awake (never forced closed).
    setTimeout(() => { if (this.closing.get(wc.id) === entry) this.closing.delete(wc.id); }, 4000);
    return true;
  }

  sleepOtherTabs() {
    const n = this.sleepIdleTabs({ force: true });
    this.toast(n ? `Put ${n} background tab${n === 1 ? '' : 's'} to sleep.` : 'No background tabs to put to sleep.');
  }

  // ---------------------------------------------------------------- tabs
  searchUrl(q) {
    const tpl = store.SEARCH_ENGINES[this.st.settings.searchEngine] || store.SEARCH_ENGINES.Google;
    return tpl.replace('%s', encodeURIComponent(q));
  }

  //   route: an opened link (from a page, another app or the command bar), so
  //          Air Traffic Control rules may send it to another Space.
  newTab(url, { spaceId = this.curSpaceId, active = true, kind = 'today', ref = null, after = null, route = false } = {}) {
    if (!this.spaceById(spaceId)) spaceId = this.curSpaceId;
    if (route && kind === 'today' && !this.privateSpaces.has(spaceId)) {
      const target = this.atcTarget(url);
      if (target && target.id !== spaceId) {
        spaceId = target.id; after = null;
        this.toast(`Opened in ${`${target.emoji || ''} ${target.name}`.trim()} (Air Traffic Control)`);
        // Prefer a window already showing that Space.
        const W = [...this.wins].find(x => !x.private && x.spaceId === target.id);
        if (active && W && W !== this.cur) { W.win.focus(); return this.withWin(W, () => { this.cur = W; return this.newTab(url, { spaceId, active, kind, ref }); }); }
      }
    }
    const tab = this.record({ url, spaceId, kind, ref, title: hostOf(url) });
    if (kind === 'today') {
      const list = this.order[spaceId] || (this.order[spaceId] = []);
      const i = after ? list.indexOf(after) : -1;
      if (i >= 0) list.splice(i + 1, 0, tab.id); else if (this.st.settings.newTabsAt === 'top') list.unshift(tab.id); else list.push(tab.id);
    }
    if (active) {
      this.show(tab.id);
    } else {
      this.ensureView(tab);
      this.changed();
    }
    return tab;
  }

  navigate(text, { newTab = false } = {}) {
    const url = toUrl(text) || this.searchUrl(text);
    if (newTab || !this.active) return this.newTab(url);
    this.active.url = url;
    this.ensureView(this.active).webContents.loadURL(pageUrl(url)).catch(() => {});
    this.active.view.webContents.focus();
    this.changed();
  }

  // Closing asks the page first (beforeunload), so a tab with unsaved work
  // shows "Leave site?" instead of silently losing it.
  //   force:  close without asking (e.g. the whole Space is being deleted)
  //   quiet:  if the page has unsaved work, keep it open without asking (auto-archive)
  //   onClosed: runs once the tab has really closed
  closeTab(id = this.activeTabId, { force = false, quiet = false, onClosed = null } = {}) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const wc = tab.view?.webContents;
    if (!force && wc && !wc.isDestroyed() && !wc.isCrashed()) {
      if (this.closing.has(wc.id)) return;
      const entry = { kind: 'tab', tab, quiet, onClosed };
      this.closing.set(wc.id, entry);
      wc.close({ waitForBeforeUnload: true });
      // A hung page that never answers is closed anyway.
      setTimeout(() => { if (this.closing.get(wc.id) === entry && !wc.isDestroyed()) wc.close(); }, 3000);
      return;
    }
    this.finishClose(tab);
    try { onClosed?.(); } catch { /* ignore */ }
  }

  finishClose(tab) {
    const id = tab.id;
    if (!this.tabs.has(id)) return;
    const list = this.order[tab.spaceId] || [];
    const idx = list.indexOf(id);
    if (tab.kind === 'today') {
      this.closed.push({ url: tab.url, title: tab.title, spaceId: tab.spaceId });
      if (this.closed.length > 30) this.closed.shift();
      list.splice(idx, 1);
    }
    // The window showing it (if any) picks the next tab.
    const host = this.hostOf(id);
    const wasActive = host?.activeTabId === id;
    if (tab.view) {
      if (host) { try { host.win.contentView.removeChildView(tab.view); } catch { /* ignore */ } host.attached = host.attached.filter(x => x !== id); }
      const wc = tab.view.webContents;   // undefined once the page has been destroyed
      if (wc && !wc.isDestroyed()) { this.closing.delete(wc.id); if (typeof wc.close === 'function') wc.close(); else wc.destroy?.(); }
    }
    // Closing a pane of a split view: the rest of the split stays.
    const g = tab.splitId ? this.splits.get(tab.splitId) : null;
    const neighbour = g ? g.tabIds[Math.max(0, g.tabIds.indexOf(id) - 1)] : null;
    if (g) this.leaveSplit(tab, { touchPinned: false, reshow: false });
    tab.host = null;
    this.tabs.delete(id);
    try { this.afterTabClosed(tab); } catch { /* ignore */ }   // "forget this site when I close it"
    if (this.activeBySpace[tab.spaceId] === id) delete this.activeBySpace[tab.spaceId];
    if (host) this.withWin(host, () => {
      if (!wasActive && this.active) return this.show(this.active.id);   // re-lay out the remaining panes
      this.activeTabId = null;
      if (neighbour && neighbour !== id && this.tabs.has(neighbour)) return this.show(neighbour);
      const cur = this.order[this.curSpaceId] || [];
      const free = cur.filter(x => !this.shownElsewhere(x));
      const next = cur[Math.min(Math.max(idx, 0), cur.length - 1)];
      const pick = next && !this.shownElsewhere(next) ? next : free[free.length - 1];
      if (pick) this.show(pick); else this.showNothing();
    });
    this.changed();
  }

  // -------------------------------------------------- switching tabs
  reopenClosed() {
    // Only tabs closed in this Space.
    for (let i = this.closed.length - 1; i >= 0; i--) {
      if (this.closed[i].spaceId !== this.curSpaceId) continue;
      const [c] = this.closed.splice(i, 1);
      return this.newTab(c.url, { spaceId: c.spaceId });
    }
  }

  // Ctrl+Tab. By default the most recently used tab first (keep holding Ctrl and press
  // Tab again to go further back, like Alt+Tab); Settings can switch it to sidebar order.
  // Ctrl+Alt+Up/Down always go in sidebar order.
  cycleTab(dir, { mru = this.st.settings.tabCycle !== 'order' } = {}) {
    if (!mru) {
      const list = this.order[this.curSpaceId] || [];
      if (!list.length) return;
      const i = list.indexOf(this.activeTabId);
      return this.show(list[(i + dir + list.length) % list.length]);
    }
    const W = this.cur;
    let c = W.mruCycle;
    if (!c || Date.now() - c.at > 2500) {
      if (c) this.endCycle(W);
      const seen = new Set();
      const ids = [...this.tabs.values()]
        .filter(t => t.spaceId === this.curSpaceId && ['today', 'pinned', 'fav'].includes(t.kind) && (t.id === this.activeTabId || !this.shownElsewhere(t.id)))
        .sort((a, b) => (b.id === this.activeTabId) - (a.id === this.activeTabId) || (b.lastActive || 0) - (a.lastActive || 0))
        .filter(t => { const k = t.splitId || t.id; if (seen.has(k)) return false; seen.add(k); return true; })   // a split view is one stop
        .map(t => t.id);
      c = W.mruCycle = { ids, i: 0, at: 0 };
    }
    if (c.ids.length < 2) return;
    c.i = (c.i + dir + c.ids.length) % c.ids.length;
    c.at = Date.now();
    this.cycling = true;
    try { this.show(c.ids[c.i]); } finally { this.cycling = false; }
  }

  // Ctrl let go: the tab you landed on becomes the most recent one.
  endCycle(W = this.cur) {
    if (!W?.mruCycle) return;
    W.mruCycle = null;
    const t = this.tabs.get(W.activeTabId);
    if (t) t.lastActive = Date.now();
  }

  // ---- closing several tabs at once
  closeTabs(ids) {
    for (const id of [...new Set(ids)]) if (this.tabs.has(id)) this.closeTab(id);
  }

  // Open tabs of the pinned tabs inside a folder (the pinned entries stay).
  closeFolderTabs(folderId) {
    const f = findPinned(this.space.pinned, folderId) || this.allSpaces.map(s => findPinned(s.pinned, folderId)).find(Boolean);
    if (!f) return;
    this.closeTabs(pinnedTabNodes(f.node.children || []).map(n => this.liveTab('pinned', n.id)?.id).filter(Boolean));
  }

  // ---------------------------------------------------- tab right-click menu
  // Right-click on a tab in the sidebar.
  tabMenu(tabId, x, y) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const wc = tab.view?.webContents;
    const live = wc && !wc.isDestroyed();
    const priv = this.privateSpaces.has(tab.spaceId);
    const others = priv ? [] : this.st.spaces.filter(s => s.id !== tab.spaceId);
    const act = this.active;
    const canSplitWithActive = act && act.id !== tab.id && act.spaceId === tab.spaceId && !(act.splitId && act.splitId === tab.splitId);
    const folders = [];
    walkPinned(this.spaceById(tab.spaceId)?.pinned || [], (n, l, p, depth) => { if (n.type === 'folder') folders.push({ n, depth }); });
    // Bulk closing: today tabs of this Space (a split view counts as one).
    const today = this.order[tab.spaceId] || [];
    const mates = new Set(tab.splitId ? this.splits.get(tab.splitId)?.tabIds || [tab.id] : [tab.id]);
    const otherTabs = tab.kind === 'today' ? today.filter(id => !mates.has(id)) : [];
    const below = tab.kind === 'today' ? today.slice(Math.max(...[...mates].map(id => today.indexOf(id))) + 1).filter(id => !mates.has(id)) : [];
    let parentFolder = null;
    if (tab.kind === 'pinned') {
      for (const s of this.allSpaces) {
        let f = findPinned(s.pinned, tab.ref);
        if (f?.parent?.type === 'split') f = findPinned(s.pinned, f.parent.id);   // a pinned split inside a folder
        if (f) { parentFolder = f.parent?.type === 'folder' ? f.parent : null; break; }
      }
    }
    const saved = this.savedNodeFor(tab);
    const items = [
      { label: 'Split View with Current Tab', visible: !!canSplitWithActive, click: () => this.splitWith(act.id, tab.id) },
      { label: 'Open in Split View…', visible: !tab.splitId, click: () => { this.show(tab.id); this.openCommand('split'); } },
      { label: 'Remove from Split View', visible: !!tab.splitId, click: () => this.leaveSplit(tab) },
      { label: 'Pin to Folder', visible: tab.kind === 'today' && folders.length > 0, submenu: folders.map(({ n, depth }) => ({ label: `${'   '.repeat(depth)}${n.title}`, click: () => this.pinTab(tabId, { folderId: n.id }) })) },
      { label: 'Add to New Folder', visible: tab.kind === 'today', click: () => this.groupNew(tabId) },
      { label: 'Move to Folder', visible: tab.kind === 'today' && this.groupsOf(tab.spaceId).some(g => g.id !== tab.groupId), submenu: (() => {
        const gs = this.groupsOf(tab.spaceId);
        const tops = gs.filter(g => !g.parentId);
        return tops.flatMap(g => [g, ...gs.filter(c => c.parentId === g.id)]).filter(g => g.id !== tab.groupId)
          .map(g => ({ label: `${g.parentId ? '      ' : ''}${g.title}`, click: () => this.groupAdd(tabId, g.id) }));
      })() },
      { label: 'Remove from Folder', visible: !!tab.groupId, click: () => this.groupRemove(tabId) },
      { type: 'separator' },
      { label: tab.muted ? 'Unmute Tab' : 'Mute Tab', click: () => this.toggleMute(tabId) },
      { label: 'Sleep Tab (free its memory)', visible: this.canSleep(tab), click: () => this.sleepTab(tab) },
      { label: 'Put Other Tabs to Sleep', click: () => this.sleepOtherTabs() },
      { label: 'Reload', enabled: !!live, click: () => wc.reload() },
      { label: 'Duplicate', click: () => this.newTab(tab.url, { spaceId: tab.spaceId, after: tabId }) },
      { type: 'separator' },
      { label: 'Move to New Window', visible: !priv, click: () => this.newWindow({ tabId }) },
      { label: 'Move to Space', visible: tab.kind === 'today' && others.length > 0, submenu: others.map(s => ({
        label: `${s.emoji || ''} ${s.name}`.trim() + (this.sameProfile(tab.spaceId, s.id) ? '  (same profile: stays signed in)' : ''),
        click: () => this.moveTabToSpace(tabId, s.id) })) },
      { label: tab.kind === 'pinned' ? 'Unpin' : 'Pin', visible: tab.kind !== 'fav', click: () => this.pinTab(tabId) },
      { label: 'Add to Favorites', visible: tab.kind === 'today', click: () => this.favoriteTab(tabId) },
      { label: `Go Back to ${tab.kind === 'fav' ? 'Favorite' : 'Pinned'} Address`, visible: !!saved && this.drifted(tab, saved), click: () => this.resetPinned(tabId) },
      { label: `Make This Page the ${tab.kind === 'fav' ? 'Favorite' : 'Pinned'} Address`, visible: !!saved && this.drifted(tab, saved), click: () => this.setPinnedUrl(tabId) },
      { label: 'Copy Link', click: () => clipboard.writeText(tab.url) },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'Ctrl+W', registerAccelerator: false, click: () => this.closeTab(tabId) },
      { label: 'Close Other Tabs', visible: tab.kind === 'today', enabled: otherTabs.length > 0, click: () => this.closeTabs(otherTabs) },
      { label: 'Close Tabs Below', visible: tab.kind === 'today', enabled: below.length > 0, click: () => this.closeTabs(below) },
      { label: `Close Tabs in “${(parentFolder?.title || '').slice(0, 30)}”`, visible: !!parentFolder, click: () => this.closeFolderTabs(parentFolder.id) },
    ];
    Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  // ------------------------------------------------------ moving tabs
  // Spaces on different profiles don't share cookies, so a tab moved there reopens fresh.
  moveTabToSpace(tabId, spaceId) {
    const tab = this.tabs.get(tabId);
    const to = this.spaceById(spaceId);
    if (!tab || tab.kind !== 'today' || tab.spaceId === spaceId || !to) return;
    if (to.private || this.privateSpaces.has(tab.spaceId)) return;   // private tabs never cross over
    if (this.sameProfile(tab.spaceId, spaceId)) {
      // Same Profile = same logins: the tab moves as-is, nothing reloads.
      const from = this.order[tab.spaceId] || [];
      if (from.includes(tabId)) from.splice(from.indexOf(tabId), 1);
      const wasActive = tabId === this.activeTabId;
      tab.spaceId = spaceId;
      delete tab.groupId;
      (this.order[spaceId] ||= []).push(tabId);
      if (wasActive) { this.activeTabId = null; const next = from[from.length - 1]; if (next) this.show(next); else this.showNothing(); }
      this.toast(`Moved to ${to.emoji || ''} ${to.name}`.trim());
      return this.changed();
    }
    const url = tab.url;
    const wasActive = tabId === this.activeTabId;
    this.closeTab(tabId, { onClosed: () => {
      this.closed.pop(); // not a real "close"
      this.newTab(url, { spaceId, active: false });
      this.toast(`Moved to ${to.emoji} ${to.name}. It opened fresh there, since Spaces don't share logins.`);
      if (wasActive && !this.active) this.switchSpace(this.curSpaceId);
    } });
  }

  reorderTab(tabId, beforeId) {
    const tab = this.tabs.get(tabId);
    const list = this.order[tab?.spaceId];
    if (!list || tabId === beforeId) return;
    list.splice(list.indexOf(tabId), 1);
    const i = beforeId ? list.indexOf(beforeId) : -1;
    if (i >= 0) list.splice(i, 0, tabId); else list.push(tabId);
    this.changed();
  }

  // ------------------------------------------------------------ archive
  autoArchive() {
    const hours = Number(this.st.settings.archiveAfterHours) || 0;
    if (!hours) return;
    const cutoff = Date.now() - hours * 3600e3;
    for (const t of [...this.tabs.values()]) {
      if (t.kind !== 'today' || [...this.wins].some(W => W.activeTabId === t.id) || t.lastActive > cutoff) continue;
      if (this.privateSpaces.has(t.spaceId)) continue;
      if (t.audible || t.view?.webContents?.isCurrentlyAudible()) continue;
      // Pages with unsaved work ("Leave site?") are left open instead of archived.
      const entry = { id: uid(), url: t.url, title: t.title || t.url, favicon: t.favicon, spaceId: t.spaceId, closedAt: Date.now() };
      this.closeTab(t.id, { quiet: true, onClosed: () => {
        this.st.archive.unshift(entry);
        this.st.archive = this.st.archive.slice(0, 300);
        this.changed();
      } });
    }
    this.st.archive = this.st.archive.slice(0, 300);
    this.changed();
  }

  restoreArchived(id) {
    const a = this.st.archive.find(x => x.id === id);
    if (!a) return;
    this.st.archive = this.st.archive.filter(x => x.id !== id);
    this.newTab(a.url, { spaceId: this.spaceById(a.spaceId) ? a.spaceId : this.curSpaceId });
  }

  // ------------------------------------------------------------ history
  // History is kept per Space; other Spaces never see it.
  touchHistory(spaceId, url, title, visit = false) {
    if (!url || /^(about|data|file|devtools|chrome|chrome-extension|view-source):/i.test(url)) return;
    const sp = this.spaceById(spaceId);
    if (!sp) return;
    if (sp.private) return;   // private windows keep no history
    const h = sp.history || (sp.history = []);
    let e = h.find(x => x.url === url);
    if (!e) { e = { url, title: title || '', visits: 0, last: 0 }; h.unshift(e); }
    if (title) e.title = title;
    if (visit) { e.visits++; e.last = Date.now(); }
    if (h.length > 3000) h.length = 3000;
  }
}

module.exports = TabsPart;
