// Spaces: switching, editing, deleting, and their right-click menu.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { Menu, session, dialog, screen } = require('electron');
const { pinnedTabNodes } = require('./common');

class SpacesPart {
  // ------------------------------------------------------------- spaces
  switchSpace(id) {
    if (this.isPrivate) id = this.curSpaceId;   // a private window has only its own Space
    if (!this.spaceById(id)) id = this.st.spaces[0].id;
    this.curSpaceId = id;
    const list = this.order[id] || (this.order[id] = []);
    let target = this.activeBySpace[id];
    if (!this.freeTab(target)) target = [...list].reverse().find(x => this.freeTab(x));
    if (!target) {
      const p = pinnedTabNodes(this.spaceById(id).pinned).map(x => this.liveTab('pinned', x.id)).find(t => t && this.freeTab(t.id));
      target = p?.id;
    }
    this.win.setBackgroundColor(this.space.colors[0]);
    if (target) this.show(target); else this.showNothing();
    this.showLockIfNeeded();   // a Space locked with Windows Hello shows its lock screen
  }

  cycleSpace(dir) {
    if (this.isPrivate) return;
    const i = this.st.spaces.findIndex(s => s.id === this.curSpaceId);
    this.switchSpace(this.st.spaces[(i + dir + this.st.spaces.length) % this.st.spaces.length].id);
  }

  // Quick new Space on its own new Profile (the sidebar uses the New Space screen instead).
  addSpace() { return this.createSpace({}); }

  updateSpace(id, patch) {
    const sp = this.spaceById(id);
    if (!sp) return;
    if (typeof patch.name === 'string') sp.name = patch.name.slice(0, 40) || 'Untitled';
    if (typeof patch.emoji === 'string') sp.emoji = patch.emoji.trim().slice(0, 16); // '' removes it
    if (Array.isArray(patch.colors) && patch.colors.length) sp.colors = patch.colors.slice(0, 3).filter(c => /^#[0-9a-f]{6}$/i.test(c));
    if (typeof patch.grain === 'number') sp.grain = Math.max(0, Math.min(1, patch.grain));
    // Arc-style picker state: 1–3 dots on the colour pad, light/dark, intensity.
    const t = patch.theme;
    if (t && Array.isArray(t.dots) && t.dots.length) {
      const c01 = v => Math.max(0, Math.min(1, Number(v) || 0));
      sp.theme = {
        dots: t.dots.slice(0, 3).map(d => ({ x: c01(d.x), y: c01(d.y) })),
        mode: t.mode === 'dark' ? 'dark' : 'light',
        intensity: c01(t.intensity),
      };
    }
    if (id === this.curSpaceId) this.win.setBackgroundColor(sp.colors[0]);
    this.changed();
  }

  // Deleting a Space deletes everything in it, like removing a Chrome profile:
  // its tabs, cookies/logins, site data, history and saved passwords.
  async deleteSpace(id) {
    if (this.st.spaces.length < 2) return;
    const sp = this.spaceById(id);
    if (!sp) return;
    // If another Space shares this Space's Profile, only the Space goes; the
    // Profile's logins, history, pinned tabs, Favorites and passwords stay.
    const others = this.spacesOnProfile(sp.profileId).filter(s => s.id !== id);
    const prof = this.profileOf(sp);
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning', buttons: ['Delete Space', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Delete “${sp.name}”?`,
      detail: others.length
        ? `This closes its open tabs and removes the Space. Its profile “${prof?.name}” is still used by ${others.map(s => s.name).join(', ')}, so its logins, history, pinned tabs, Favorites and saved passwords are kept.`
        : `This closes its tabs and permanently deletes its profile “${prof?.name || sp.name}”: pinned tabs, Favorites, history, saved passwords, and the cookies and logins stored for it. Other Spaces are not affected.`,
    });
    if (response !== 0) return;
    const partition = sp.partition;
    for (const t of [...this.tabs.values()]) if (t.spaceId === id) {
      // Shared pinned tabs/Favorites that happen to be open here move to a sibling Space instead of closing.
      if (others.length && t.kind !== 'today') { t.spaceId = others[0].id; continue; }
      this.closeTab(t.id, { force: true });
    }
    this.closed = this.closed.filter(c => c.spaceId !== id);
    this.st.archive = this.st.archive.filter(a => a.spaceId !== id);
    this.st.spaces = this.st.spaces.filter(s => s.id !== id);
    delete this.order[id]; delete this.activeBySpace[id];
    if (others.length) {
      this.st.atc = this.st.atc.filter(r => r.spaceId !== id);
      for (const b of this.st.boosts) if (b.spaceId === id) b.spaceId = null;
      for (const [gid, g] of this.splits) if (g.spaceId === id) this.splits.delete(gid);
      for (const W of this.wins) if (W.spaceId === id) this.withWin(W, () => this.switchSpace(others[0].id));
      this.changed();
      return this.libUpdate();
    }
    this.st.profiles = this.st.profiles.filter(p => p.id !== sp.profileId);
    Object.defineProperty(sp, 'partition', { value: partition, configurable: true });   // for the clean-up below
    try {
      const ses = session.fromPartition('persist:' + sp.partition);
      await ses.clearStorageData(); await ses.clearCache();
    } catch { /* ignore */ }
    try {
      this.vault.data.entries = this.vault.data.entries.filter(e => e.profile !== sp.partition);
      this.vault.data.never = this.vault.data.never.filter(n => n.profile !== sp.partition);
      this.vault.save();
    } catch { /* ignore */ }
    // Remembered permissions, zoom and downloads list for that Space go too.
    for (const k of [...this.permissions.keys()]) if (k.startsWith(sp.partition + '|')) this.permissions.delete(k);
    this.savePermissions();
    this.devices.dropPartition(sp.partition);
    this.dropHistoryText(sp.partition);
    delete this.st.zoom[sp.partition];
    this.st.atc = this.st.atc.filter(r => r.spaceId !== id);
    for (const b of this.st.boosts) if (b.spaceId === id) b.spaceId = null;
    for (const [gid, g] of this.splits) if (g.spaceId === id) this.splits.delete(gid);
    this.st.downloads = this.st.downloads.filter(d => d.spaceId !== id);
    for (const W of this.wins) if (W.spaceId === id) this.withWin(W, () => this.switchSpace(this.st.spaces[0].id));
    this.changed();
    this.libUpdate();
  }

  // Right-click menu on a Space (its icon in the bottom bar, or its name/emoji), like Arc's.
  spaceMenu(spaceId, x, y) {
    const sp = this.spaceById(spaceId);
    if (!sp) return;
    if (sp.private) return Menu.buildFromTemplate([{ label: 'Private window: nothing is saved after it closes', enabled: false },
      { label: 'Lock Private Windows with Windows Hello When I’m Away', type: 'checkbox', checked: !!this.st.settings.lockPrivate, click: m => { this.st.settings.lockPrivate = m.checked; if (m.checked) (this.unlockedSpaces ||= new Set()).add(spaceId); this.changed(); } },
      { label: 'Lock Now', visible: !!this.st.settings.lockPrivate, click: () => this.lockNow() }])
      .popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
    const ui = action => this.win.webContents.send('ui:space', { action, spaceId });
    const menu = Menu.buildFromTemplate([
      { label: 'Space Context Menu', enabled: false },
      { label: 'Change Space Icon…', click: () => ui('icon') },
      { label: 'Rename Space…', click: () => ui('rename') },
      { label: 'Edit Theme Color…', click: () => ui('theme') },
      {
        label: 'Set Profile', submenu: [
          ...this.st.profiles.map(p => {
            const users = this.spacesOnProfile(p.id).filter(s => s.id !== spaceId).map(s => s.name);
            return { label: p.name + (users.length ? `  (also ${users.join(', ')})` : ''), type: 'radio', checked: p.id === sp.profileId, click: () => this.setSpaceProfile(spaceId, p.id) };
          }),
          { type: 'separator' },
          { label: 'New Profile', click: () => this.setSpaceProfile(spaceId, 'new') },
        ],
      },
      { type: 'separator' },
      { label: 'New Space', click: () => ui('new') },
      { label: 'Open in New Window', click: () => this.newWindow({ spaceId }) },
      { label: 'Clear Browsing Data…', click: () => { this.switchSpace(spaceId); this.clearBrowsingData(); } },
      { label: 'Lock with Windows Hello', type: 'checkbox', checked: !!sp.locked, click: () => this.setSpaceLock(spaceId, !sp.locked) },
      { label: 'Lock Now', visible: !!sp.locked, click: () => this.lockNow() },
      { type: 'separator' },
      { label: 'Delete Space', enabled: this.st.spaces.length > 1, click: () => this.deleteSpace(spaceId) },
    ]);
    menu.popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }
}

module.exports = SpacesPart;
