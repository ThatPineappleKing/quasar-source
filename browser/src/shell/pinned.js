// Pinned tabs (with folders and pinned split views) and Favorites.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { Menu, clipboard } = require('electron');
const { uid, hostOf, walkPinned, findPinned, pinnedTabNodes, pageUrl } = require('./common');

class PinnedPart {
  // ---- pinned tabs and Favorites that wandered off their saved address
  savedNodeFor(tab) {
    if (tab?.kind === 'pinned') return this.allSpaces.map(s => findPinned(s.pinned, tab.ref)?.node).find(Boolean) || null;
    if (tab?.kind === 'fav') return this.allSpaces.map(s => s.favorites.find(f => f.id === tab.ref)).find(Boolean) || null;
    return null;
  }

  drifted(tab, node = this.savedNodeFor(tab)) {
    if (!tab || !node?.url || !tab.url) return false;
    const norm = u => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return u; } };
    return norm(tab.url) !== norm(node.url);
  }

  // Send a pinned tab (or Favorite) back to the address it was pinned with.
  resetPinned(tabId) {
    const tab = this.tabs.get(tabId);
    const node = this.savedNodeFor(tab);
    if (!node?.url) return;
    tab.url = node.url;
    const wc = tab.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.loadURL(pageUrl(node.url)).catch(() => {});
    if (!this.hostOf(tab.id)) this.show(tab.id);
    this.changed();
  }

  // Make the page it's on now the pinned address.
  setPinnedUrl(tabId) {
    const tab = this.tabs.get(tabId);
    const node = this.savedNodeFor(tab);
    if (!node || !/^(https?|file|arch):/i.test(tab.url)) return;
    node.url = tab.url;
    if (tab.title && !(node.title && tab.kind === 'pinned' && node.renamed)) node.title = tab.title;
    if (tab.favicon) node.favicon = tab.favicon;
    this.toast(`${tab.kind === 'fav' ? 'Favorite' : 'Pinned tab'} now opens ${hostOf(tab.url) || tab.url}`);
    this.changed();
  }

  liveTab(kind, ref) {
    for (const t of this.tabs.values()) if (t.kind === kind && t.ref === ref) return t;
    return null;
  }

  // ------------------------------------------------- pinned + favorites
  // Pinned tabs are a tree per Space. A node is one of:
  //   tab    { id, url, title, favicon }
  //   folder { id, type: 'folder', title, open, children: [nodes] }
  //   split  { id, type: 'split', sizes, children: [tab nodes] }  (a pinned split view)
  pinTab(tabId = this.activeTabId, { folderId = null } = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (tab.kind === 'pinned' && !folderId) return this.unpin(tab.ref);
    if (tab.kind !== 'today') return;
    if (tab.splitId) return this.pinSplit(tab.splitId, { folderId });   // a split view is pinned as a whole
    const sp = this.spaceById(tab.spaceId);
    const p = { id: uid(), url: tab.url, title: tab.title, favicon: tab.favicon };
    const target = folderId ? findPinned(sp.pinned, folderId)?.node : null;
    (target?.type === 'folder' ? target.children : sp.pinned).push(p);
    if (target) target.open = true;
    const list = this.order[tab.spaceId];
    list.splice(list.indexOf(tabId), 1);
    tab.kind = 'pinned'; tab.ref = p.id;
    this.changed();
  }

  get allSpaces() { return [...this.st.spaces, ...this.privateSpaces.values()]; }

  // Unpin a tab, folder or split. Open tabs it contained go back to the Today list.
  unpin(pinId) {
    for (const sp of this.allSpaces) {
      const f = findPinned(sp.pinned, pinId);
      if (!f) continue;
      f.list.splice(f.index, 1);
      for (const n of pinnedTabNodes([f.node])) {
        const t = this.liveTab('pinned', n.id);
        if (t) {
          const home = this.spaceById(t.spaceId) ? t.spaceId : sp.id;   // stays in the Space it's open in
          t.kind = 'today'; t.ref = null; t.spaceId = home; (this.order[home] ||= []).unshift(t.id);
        }
      }
      if (f.node.type === 'split') { const g = [...this.splits.values()].find(x => x.pinnedRef === pinId); if (g) g.pinnedRef = null; }
    }
    this.changed();
  }

  openPinned(pinId) {
    const live = this.liveTab('pinned', pinId);
    if (live) return this.show(live.id);
    // Prefer the current Space: Spaces on one Profile share the same pinned tabs.
    const sp = [this.space, ...this.allSpaces].find(s => s && findPinned(s.pinned, pinId));
    const node = sp && findPinned(sp.pinned, pinId).node;
    if (!node) return;
    if (node.type === 'folder') return this.toggleFolder(pinId);
    if (node.type === 'split') return this.openPinnedSplit(sp, node);
    if (node.fresh) node.fresh = false;   // a Live Folder item: read now
    this.newTab(node.url, { spaceId: sp.id, kind: 'pinned', ref: node.id });
  }

  // Move a pinned node before another node, into a folder, or to the end.
  movePinned(pinId, targetId, mode = 'before') {
    const sp = this.space;
    if (!sp || pinId === targetId) return;
    const f = findPinned(sp.pinned, pinId);
    if (!f) return;
    // Never move a folder into itself.
    if (targetId && f.node.children && findPinned(f.node.children, targetId)) return;
    f.list.splice(f.index, 1);
    const t = targetId ? findPinned(sp.pinned, targetId) : null;
    if (t && mode === 'into' && t.node.type === 'folder') { t.node.children.push(f.node); t.node.open = true; }
    else if (t) t.list.splice(t.index, 0, f.node);
    else sp.pinned.push(f.node);
    this.changed();
  }
  reorderPinned(pinId, beforeId) { this.movePinned(pinId, beforeId, 'before'); }

  newFolder(name = 'New Folder', { withPin = null } = {}) {
    const sp = this.space;
    if (!sp) return null;
    const folder = { id: uid(), type: 'folder', title: name, open: true, children: [] };
    sp.pinned.unshift(folder);
    if (withPin) this.movePinned(withPin, folder.id, 'into');
    this.changed();
    this.win?.webContents.send('ui:folder', { action: 'rename', id: folder.id });
    return folder.id;
  }

  renamePinned(pinId, title) {
    for (const sp of this.allSpaces) {
      const n = findPinned(sp.pinned, pinId)?.node;
      if (n) { n.title = String(title || '').slice(0, 80) || (n.type === 'folder' ? 'Folder' : n.title); if (!n.type) n.renamed = true; this.changed(); return; }
    }
  }

  toggleFolder(pinId, open = null) {
    for (const sp of this.allSpaces) {
      const n = findPinned(sp.pinned, pinId)?.node;
      if (n?.type === 'folder') { n.open = open === null ? !n.open : !!open; this.changed(); return; }
    }
  }

  // Delete a folder: what's inside moves up to where the folder was.
  dissolveFolder(pinId) {
    for (const sp of this.allSpaces) {
      const f = findPinned(sp.pinned, pinId);
      if (f?.node.type !== 'folder') continue;
      f.list.splice(f.index, 1, ...f.node.children);
      this.changed();
      return;
    }
  }

  pinnedMenu(pinId, x, y) {
    const sp = this.space;
    const f = findPinned(sp.pinned, pinId);
    if (!f) return;
    const n = f.node;
    const live = n.type ? null : this.liveTab('pinned', n.id);
    const folders = [];
    walkPinned(sp.pinned, (m, list, parent, depth) => { if (m.type === 'folder' && m.id !== n.id && !(n.children && findPinned(n.children, m.id))) folders.push({ m, depth }); });
    const moveTo = [
      { label: 'Top level', enabled: !!f.parent, click: () => { f.list.splice(f.index, 1); sp.pinned.push(n); this.changed(); } },
      ...folders.map(({ m, depth }) => ({ label: `${'   '.repeat(depth)}${m.title}`, enabled: f.parent?.id !== m.id, click: () => this.movePinned(n.id, m.id, 'into') })),
    ];
    const items = [];
    if (n.type === 'folder') {
      items.push(...this.liveFolderMenu(n),
        { label: n.open ? 'Collapse Folder' : 'Expand Folder', click: () => this.toggleFolder(n.id) },
        { label: 'Rename Folder…', click: () => this.win.webContents.send('ui:folder', { action: 'rename', id: n.id }) },
        { label: 'Change Icon…', click: () => this.win.webContents.send('ui:folder', { action: 'icon', id: n.id }) },
        { label: 'New Folder Inside', click: () => { const c = { id: uid(), type: 'folder', title: 'New Folder', open: true, children: [] }; n.children.unshift(c); n.open = true; this.changed(); this.win.webContents.send('ui:folder', { action: 'rename', id: c.id }); } },
        { label: 'Move To', submenu: moveTo },
        { type: 'separator' },
        { label: 'Close Tabs in Folder', enabled: pinnedTabNodes(n.children).some(c => this.liveTab('pinned', c.id)), click: () => this.closeFolderTabs(n.id) },
        { label: 'Delete Folder (keep its tabs)', click: () => this.dissolveFolder(n.id) },
        { label: 'Unpin Folder and Its Tabs', click: () => this.unpin(n.id) });
    } else {
      if (n.type === 'split') items.push({ label: 'Open Split View', click: () => this.openPinned(n.id) });
      else items.push({ label: 'Open', click: () => this.openPinned(n.id) });
      if (live) items.push({ label: live.muted ? 'Unmute Tab' : 'Mute Tab', click: () => this.toggleMute(live.id) });
      const away = !!live && this.drifted(live, n);
      const splitLive = n.type === 'split' ? n.children.map(c => this.liveTab('pinned', c.id)).filter(Boolean) : [];
      items.push(
        { label: 'Go Back to Pinned Address', visible: away, click: () => this.resetPinned(live.id) },
        { label: 'Make This Page the Pinned Address', visible: away, click: () => this.setPinnedUrl(live.id) },
        { label: 'Rename…', visible: !n.type, click: () => this.win.webContents.send('ui:folder', { action: 'rename', id: n.id }) },
        { label: 'New Folder With This', click: () => this.newFolder('New Folder', { withPin: n.id }) },
        { label: 'Move To', submenu: moveTo },
        { label: 'Copy Link', visible: !n.type, click: () => clipboard.writeText(n.url) },
        { type: 'separator' },
        { label: 'Close Tab', visible: !!live, click: () => this.closeTab(live.id) },
        { label: 'Close Split View', visible: splitLive.length > 0, click: () => this.closeTabs(splitLive.map(t => t.id)) },
        { label: `Close Tabs in “${(f.parent?.title || '').slice(0, 30)}”`, visible: f.parent?.type === 'folder', click: () => this.closeFolderTabs(f.parent.id) },
        { label: n.type === 'split' ? 'Unpin Split View' : 'Unpin', click: () => this.unpin(n.id) });
    }
    Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  pinnedViewModel(nodes) {
    return nodes.map(n => {
      if (n.type === 'folder') return { id: n.id, type: 'folder', title: n.title, icon: n.icon || '', open: !!n.open, children: this.pinnedViewModel(n.children), count: pinnedTabNodes(n.children).length,
        live: n.live ? { kind: n.live.kind, error: n.live.error || null } : null, unread: n.live ? n.children.filter(c => c.fresh).length : 0 };
      if (n.type === 'split') {
        const g = [...this.splits.values()].find(x => x.pinnedRef === n.id);
        const kids = n.children.map(c => { const t = this.liveTab('pinned', c.id); return { id: c.id, url: c.url, title: t?.title || c.title, favicon: t?.favicon || c.favicon }; });
        const active = !!g && g.tabIds.includes(this.activeTabId);
        return { id: n.id, type: 'split', children: kids, open: !!g, active, title: kids.map(k => k.title || hostOf(k.url)).join('  |  '), url: kids[0]?.url || '' };
      }
      const t = this.liveTab('pinned', n.id);
      return { ...n, favicon: t?.favicon || n.favicon, title: n.title, open: !!t, unread: t ? this.unreadIn(t.title) : 0, active: t?.id === this.activeTabId, audible: !!t?.audible, muted: !!t?.muted, tabId: t?.id, elsewhere: !!t && this.shownElsewhere(t.id), sleeping: !!t?.sleeping, crashed: !!t?.crashed,
        drifted: !!t && this.drifted(t, n), now: t && this.drifted(t, n) ? (t.title || hostOf(t.url)) : '' };
    });
  }

  // Favorites belong to one Space (like bookmarks in a Chrome profile), up to 12 each.
  favoriteTab(tabId = this.activeTabId) {
    const tab = this.tabs.get(tabId);
    const sp = tab && this.spaceById(tab.spaceId);
    if (!tab || !sp || tab.kind === 'fav' || sp.favorites.length >= 12) return;
    if (tab.kind === 'pinned') this.unpin(tab.ref);
    const f = { id: uid(), url: tab.url, title: tab.title, favicon: tab.favicon };
    sp.favorites.push(f);
    const list = this.order[tab.spaceId];
    if (list.includes(tabId)) list.splice(list.indexOf(tabId), 1);
    tab.kind = 'fav'; tab.ref = f.id;
    this.changed();
  }

  removeFavorite(favId) {
    for (const sp of this.allSpaces) {
      if (!sp.favorites.some(f => f.id === favId)) continue;
      sp.favorites = sp.favorites.filter(f => f.id !== favId);
      const t = this.liveTab('fav', favId);
      if (t) { t.kind = 'today'; t.ref = null; this.order[t.spaceId].unshift(t.id); }
    }
    this.changed();
  }

  openFavorite(favId) {
    const live = this.liveTab('fav', favId);
    if (live) return this.show(live.id);
    const sp = [this.space, ...this.allSpaces].find(s => s && s.favorites.some(f => f.id === favId));
    const f = sp?.favorites.find(x => x.id === favId);
    if (f) this.newTab(f.url, { spaceId: sp.id, kind: 'fav', ref: f.id });
  }

  clearToday() {
    for (const id of [...(this.order[this.curSpaceId] || [])]) this.closeTab(id);
  }
}

module.exports = PinnedPart;
