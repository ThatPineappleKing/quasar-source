// Split view.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { Menu } = require('electron');
const { uid, hostOf, findPinned } = require('./common');

class SplitPart {
  // ---------------------------------------------------------- split view
  // Up to 4 tabs of one Space side by side. this.splits: id -> { id, spaceId, tabIds, sizes, pinnedRef }
  splitWith(baseId, otherId, { focus = otherId } = {}) {
    const a = this.tabs.get(baseId), b = this.tabs.get(otherId);
    if (!a || !b || a === b || a.kind === 'little' || b.kind === 'little') return;
    if (a.spaceId !== b.spaceId) return this.toast('Split view tabs have to be in the same Space.');
    let g = a.splitId ? this.splits.get(a.splitId) : null;
    if (g && g.tabIds.includes(b.id)) return this.show(focus);
    if (g && g.tabIds.length >= 4) return this.toast('A split view holds up to 4 tabs.');
    if (b.splitId) this.leaveSplit(b);
    if (!g) {
      g = { id: uid(), spaceId: a.spaceId, tabIds: [a.id], sizes: [1], pinnedRef: null };
      this.splits.set(g.id, g);
      a.splitId = g.id;
    }
    g.tabIds.splice(g.tabIds.indexOf(a.id) + 1, 0, b.id);
    b.splitId = g.id;
    g.sizes = g.tabIds.map(() => 1);
    // A pinned split gets the new pane too.
    if (g.pinnedRef) this.syncPinnedSplit(g);
    else if (b.kind === 'today') {
      const list = this.order[b.spaceId];
      list.splice(list.indexOf(b.id), 1);
      list.splice(list.indexOf(a.id) + 1, 0, b.id);
    }
    this.show(focus);
  }

  // Take one tab out of its split view (it stays open as a normal tab).
  //   touchPinned: false when the tab is just closing (a pinned split keeps its saved panes)
  //   reshow:      false when the caller re-shows the window itself
  leaveSplit(tab, { keepPinned = true, touchPinned = true, reshow = true } = {}) {
    const g = tab.splitId ? this.splits.get(tab.splitId) : null;
    tab.splitId = null;
    if (!g) return;
    const i = g.tabIds.indexOf(tab.id);
    if (i >= 0) { g.tabIds.splice(i, 1); g.sizes.splice(i, 1); }
    // A pinned split keeps its other panes; this tab's pinned entry moves out next to it.
    if (g.pinnedRef && touchPinned) {
      const sp = this.spaceById(g.spaceId);
      const f = sp && findPinned(sp.pinned, g.pinnedRef);
      const child = f && tab.kind === 'pinned' ? f.node.children.findIndex(c => c.id === tab.ref) : -1;
      if (f && child >= 0) {
        const [c] = f.node.children.splice(child, 1);
        if (keepPinned) f.list.splice(f.index + 1, 0, c);
        if (f.node.children.length === 1) f.list.splice(f.list.indexOf(f.node), 1, f.node.children[0]);
        else f.node.sizes = f.node.children.map(() => 1);
      }
    }
    if (g.tabIds.length <= 1) {
      for (const id of g.tabIds) { const t = this.tabs.get(id); if (t) t.splitId = null; }
      this.splits.delete(g.id);
    }
    if (reshow) {
      for (const W of this.wins) if ((W.attached || []).includes(tab.id) || g.tabIds.some(id => (W.attached || []).includes(id))) {
        this.withWin(W, () => { const a = this.active; if (a) this.show(a.id); });
      }
    }
    this.changed();
  }

  separateSplit(gid) {
    const g = this.splits.get(gid);
    if (!g) return;
    const focus = this.cur?.activeTabId;
    for (const id of [...g.tabIds]) { const t = this.tabs.get(id); if (t) this.leaveSplit(t); }
    if (focus && this.tabs.has(focus)) this.show(focus);
  }

  closeSplit(gid) {
    const g = this.splits.get(gid);
    if (!g) return;
    for (const id of [...g.tabIds]) this.closeTab(id);
  }

  // Pin a whole split view (it becomes one pinned entry that reopens side by side).
  pinSplit(gid, { folderId = null } = {}) {
    const g = this.splits.get(gid);
    const sp = g && this.spaceById(g.spaceId);
    if (!g || !sp || g.pinnedRef) return;
    const node = { id: uid(), type: 'split', sizes: [...g.sizes], children: [] };
    for (const id of g.tabIds) {
      const t = this.tabs.get(id);
      if (!t) continue;
      if (t.kind === 'pinned') { const f = findPinned(sp.pinned, t.ref); if (f) f.list.splice(f.index, 1); }
      if (t.kind === 'fav') continue;
      const c = { id: uid(), url: t.url, title: t.title, favicon: t.favicon };
      node.children.push(c);
      const list = this.order[sp.id];
      if (list.includes(id)) list.splice(list.indexOf(id), 1);
      t.kind = 'pinned'; t.ref = c.id;
    }
    const target = folderId ? findPinned(sp.pinned, folderId)?.node : null;
    (target?.type === 'folder' ? target.children : sp.pinned).push(node);
    g.pinnedRef = node.id;
    this.changed();
  }

  syncPinnedSplit(g) {
    const sp = this.spaceById(g.spaceId);
    const node = sp && findPinned(sp.pinned, g.pinnedRef)?.node;
    if (!node) return;
    for (const id of g.tabIds) {
      const t = this.tabs.get(id);
      if (!t || (t.kind === 'pinned' && node.children.some(c => c.id === t.ref))) continue;
      const c = { id: uid(), url: t.url, title: t.title, favicon: t.favicon };
      if (t.kind === 'today') { const list = this.order[sp.id]; list.splice(list.indexOf(id), 1); }
      t.kind = 'pinned'; t.ref = c.id;
      node.children.splice(g.tabIds.indexOf(id), 0, c);
    }
    node.sizes = [...g.sizes];
  }

  openPinnedSplit(sp, node) {
    let g = [...this.splits.values()].find(x => x.pinnedRef === node.id);
    if (!g) {
      const ids = node.children.map(c => (this.liveTab('pinned', c.id) || this.newTab(c.url, { spaceId: sp.id, kind: 'pinned', ref: c.id, active: false })).id);
      for (const id of ids) { const t = this.tabs.get(id); if (t.splitId) this.leaveSplit(t); }
      g = { id: uid(), spaceId: sp.id, tabIds: ids, sizes: node.sizes?.length === ids.length ? [...node.sizes] : ids.map(() => 1), pinnedRef: node.id, grid: !!node.grid };
      this.splits.set(g.id, g);
      for (const id of ids) this.tabs.get(id).splitId = g.id;
    }
    const focus = g.tabIds.includes(this.activeBySpace[sp.id]) ? this.activeBySpace[sp.id] : g.tabIds[0];
    this.show(focus);
  }

  // Three or four panes as a grid (two columns) instead of side by side.
  setSplitGrid(gid, on) {
    const g = this.splits.get(gid);
    if (!g) return;
    g.grid = !!on;
    if (g.pinnedRef) { const n = findPinned(this.spaceById(g.spaceId)?.pinned || [], g.pinnedRef)?.node; if (n) n.grid = g.grid; }
    for (const W of this.wins) if ((W.attached || []).includes(g.tabIds[0])) this.withWin(W, () => this.layout());
    this.changed();
  }

  // Divider i (between pane i and i+1) dragged to `frac` of the page area's width.
  splitResize(gid, i, frac) {
    const g = this.splits.get(gid);
    if (!g || i < 0 || i >= g.tabIds.length - 1) return;
    const sum = g.sizes.reduce((a, b) => a + b, 0);
    const f = g.sizes.map(s => s / sum);
    const before = f.slice(0, i).reduce((a, b) => a + b, 0);
    const pair = f[i] + f[i + 1];
    const MIN = 0.12;
    const left = Math.max(MIN, Math.min(pair - MIN, Number(frac) - before));
    f[i] = left; f[i + 1] = pair - left;
    g.sizes = f;
    if (g.pinnedRef) { const n = findPinned(this.spaceById(g.spaceId)?.pinned || [], g.pinnedRef)?.node; if (n) n.sizes = [...f]; }
    for (const W of this.wins) if ((W.attached || []).includes(g.tabIds[0])) this.withWin(W, () => this.layout());
    this.push();
    clearTimeout(this.splitSaveT);
    this.splitSaveT = setTimeout(() => this.persist(), 500);
  }

  // -------------------------------------------------- split view panes
  // Clicking into a pane makes it the one the address bar and shortcuts act on.
  focusPane(tab) {
    const W = this.hostOf(tab.id);
    if (!W || !tab.splitId || W.activeTabId === tab.id) return;
    W.activeTabId = tab.id;
    this.activeBySpace[tab.spaceId] = tab.id;
    this.push();
  }

  splitMenu(gid, x, y) {
    const g = this.splits.get(gid);
    if (!g) return;
    const titles = g.tabIds.map(id => this.tabs.get(id)).filter(Boolean);
    Menu.buildFromTemplate([
      { label: 'Split View', enabled: false },
      { label: 'Add a Pane…', enabled: g.tabIds.length < 4, accelerator: 'Ctrl+Shift+=', registerAccelerator: false, click: () => { this.show(g.tabIds[g.tabIds.length - 1]); this.openCommand('split'); } },
      { label: 'Make Panes Equal', visible: !g.grid, click: () => { g.sizes = g.tabIds.map(() => 1); this.splitResize(gid, 0, 1 / g.tabIds.length); } },
      { label: g.grid ? 'Arrange Side by Side' : 'Arrange as Grid (2 × 2)', enabled: g.tabIds.length >= 3, click: () => this.setSplitGrid(gid, !g.grid) },
      { label: 'Pin Split View', visible: !g.pinnedRef, click: () => this.pinSplit(gid) },
      { label: 'Separate Into Tabs', click: () => this.separateSplit(gid) },
      { type: 'separator' },
      ...titles.map(t => ({ label: `Close “${(t.title || hostOf(t.url)).slice(0, 40)}”`, click: () => this.closeTab(t.id) })),
      { label: 'Close Split View', click: () => this.closeSplit(gid) },
    ]).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }
}

module.exports = SplitPart;
