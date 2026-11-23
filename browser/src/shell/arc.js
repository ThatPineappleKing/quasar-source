// Importing from Arc, and clearing browsing data.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const { session, dialog } = require('electron');
const { uid, importPinned } = require('./common');

class ArcPart {
  // ------------------------------------------------------- Arc import
  async importArc() {
    const arc = require('../arc-import');
    let found = arc.find();
    if (!found) {
      const r = await dialog.showOpenDialog(this.win, {
        title: 'Find Arc’s StorableSidebar.json',
        message: 'Arc keeps it in %LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_…\\LocalCache\\Local\\Arc',
        filters: [{ name: 'Arc sidebar data', extensions: ['json'] }], properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return;
      found = { sidebar: r.filePaths[0], userData: path.join(path.dirname(r.filePaths[0]), 'User Data') };
    }
    let data;
    try { data = arc.parse(found.sidebar, found.userData); } catch (e) {
      return dialog.showMessageBox(this.win, { type: 'error', message: 'Couldn’t read Arc’s data.', detail: e.message });
    }
    const have = new Set(this.st.spaces.map(s => s.arcId).filter(Boolean));
    const fresh = data.spaces.filter(s => !have.has(s.arcId));
    if (!fresh.length) {
      return dialog.showMessageBox(this.win, { type: 'info', message: 'Nothing new to import.', detail: 'Your Arc Spaces are already in Quasar.' });
    }
    // Each Arc Space becomes its own isolated Quasar Space. Favorites and history
    // go only to the Space(s) that used the Arc profile they came from.
    const favsFor = s => data.favorites.filter(f => f.profile === s.profile).slice(0, 12);
    const starters = this.st.spaces.filter(s => ['personal', 'work'].includes(s.id) && !s.pinned.length && !s.favorites?.length && !(this.order[s.id] || []).length);
    const folderCount = list => (list || []).reduce((n, x) => n + (x.type === 'folder' ? 1 + folderCount(x.children) : 0), 0);
    const splitCount = list => (list || []).reduce((n, x) => n + (x.type === 'split' ? 1 : x.type === 'folder' ? splitCount(x.children) : 0), 0);
    const lines = fresh.map(s => {
      const extra = [folderCount(s.pinned) && `${folderCount(s.pinned)} folders`, (splitCount(s.pinned) + splitCount(s.tabs)) && `${splitCount(s.pinned) + splitCount(s.tabs)} split views`].filter(Boolean).join(', ');
      return `${s.emoji} ${s.name} — ${arc.countTabs(s.pinned)} pinned${extra ? ` (${extra})` : ''}, ${arc.countTabs(s.tabs)} open tabs, ${favsFor(s).length} Favorites`;
    });
    if (starters.length) lines.push('', `Your empty starter Spaces (${starters.map(s => s.name).join(', ')}) will be replaced.`);
    lines.push('', 'Each Space gets its own separate profile. Logins and passwords can’t be copied from Arc, so you’ll sign in to sites again in each Space.');
    const { response, checkboxChecked } = await dialog.showMessageBox(this.win, {
      type: 'question', buttons: ['Import', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Import ${fresh.length} Space${fresh.length === 1 ? '' : 's'} from Arc?`,
      detail: lines.join('\n'),
      checkboxLabel: 'Also import each Space’s browsing history (for command bar suggestions)', checkboxChecked: true,
    });
    if (response !== 0) return;

    for (const s of starters) { this.st.spaces = this.st.spaces.filter(x => x !== s); delete this.order[s.id]; }
    const histCache = {};
    let hist = 0, favCount = 0;
    for (const s of fresh) {
      const id = uid();
      const sp = {
        id, arcId: s.arcId, name: s.name, emoji: s.emoji, colors: s.colors, grain: s.grain, partition: this.newPartition(id),
        pinned: importPinned(s.pinned),
        favorites: favsFor(s).map(f => ({ id: uid(), url: f.url, title: f.title, favicon: '' })),
        history: [], tabs: [], activeIndex: -1,
      };
      favCount += sp.favorites.length;
      if (checkboxChecked) {
        histCache[s.profileDir] ||= arc.readHistory(found.userData, [s.profileDir]).entries;
        sp.history = histCache[s.profileDir].slice(0, 3000).map(e => ({ ...e }));
        hist += sp.history.length;
      }
      this.st.spaces.push(sp);
      // Open tabs; Arc split views become Quasar split views.
      this.order[sp.id] = [];
      for (const t of s.tabs) {
        if (t.type !== 'split') { this.order[sp.id].push(this.record({ ...t, spaceId: sp.id, kind: 'today' }).id); continue; }
        const ids = t.children.map(c => this.record({ ...c, spaceId: sp.id, kind: 'today' }).id);
        this.order[sp.id].push(...ids);
        const g = { id: uid(), spaceId: sp.id, tabIds: ids, sizes: ids.map(() => 1), pinnedRef: null };
        this.splits.set(g.id, g);
        for (const id of ids) this.tabs.get(id).splitId = g.id;
      }
    }
    this.st.settings.arcImported = true;
    const first = this.st.spaces.find(s => s.arcId === fresh[0]?.arcId);
    this.switchSpace((first || this.st.spaces[0]).id);
    this.toast(`Imported ${fresh.length} Spaces, ${favCount} Favorites${hist ? `, ${hist} history entries` : ''} from Arc`);
  }

  // Like Chrome, clearing data applies to the current Space (profile) only.
  async clearBrowsingData() {
    const sp = this.space;
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning', buttons: ['Clear', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Clear history, cookies and cached files for ${sp.emoji || ''} ${sp.name}?`,
      detail: 'You will be signed out of websites in this Space. Its pinned tabs, Favorites and saved passwords are kept. Other Spaces are not affected.',
    });
    if (response !== 0) return;
    sp.history = [];
    this.dropHistoryText(sp.partition);
    this.closed = this.closed.filter(c => c.spaceId !== sp.id);
    const ses = session.fromPartition('persist:' + sp.partition);
    await ses.clearStorageData(); await ses.clearCache();
    this.toast(`Browsing data cleared for ${sp.name}`);
    this.changed();
  }
}

module.exports = ArcPart;
