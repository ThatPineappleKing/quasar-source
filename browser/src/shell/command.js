// The command bar (Ctrl+T), its search results and actions, and find in page.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const { WebContentsView, clipboard, screen } = require('electron');
const { Extensions } = require('../extensions');
const { Backup } = require('../backup');
const { UI, PRELOAD, hostOf, pinnedTabNodes, calculate, toUrl } = require('./common');

class CommandPart {
  // -------------------------------------------------------- command bar
  prepareOverlay() {
    if (this.overlay || !this.cur) return;
    const W = this.cur;
    const ov = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
    this.overlay = ov;
    ov.setBackgroundColor('#00000000');
    ov.webContents.on('before-input-event', (e, input) => { if (this.wins.has(W)) this.cur = W; this.onKey(e, input); });
    ov.webContents.loadFile(path.join(UI, 'command.html'));
    this.overlayReady = new Promise(r => ov.webContents.once('did-finish-load', r));
  }

  // Exchange rates for the converter (ECB, once a day).
  updateRates() {
    const { app, net } = require('electron');
    const file = require('path').join(app.getPath('userData'), 'exchange-rates.json');
    const c = require('../convert');
    if (!this._ratesLoaded) { this._ratesLoaded = true; c.loadRates(file); }
    if (this._ratesBusy) return this._ratesBusy;
    this._ratesBusy = c.updateRates(file, u => net.fetch(u)).finally(() => { this._ratesBusy = null; });
    return this._ratesBusy;
  }

  openCommand(mode = 'new', text = '', extra = {}) {
    if (!this.cur) return;
    if (mode !== 'lock' && this.overlayMode === 'lock') return;   // a locked Space shows only its lock screen
    this.prepareOverlay();
    const W = this.cur;
    this.overlayMode = mode;
    this.win.contentView.addChildView(this.overlay);
    this.layout();
    W.overlayReady.then(() => this.withWin(W, () => {
      const sp = this.space;
      W.overlay.webContents.focus();
      W.overlay.webContents.send('command:open', {
        mode, text: mode === 'url' ? (this.active?.url || '') : mode === 'find' ? this.findText : text,
        space: { colors: sp.colors, grain: sp.grain, name: sp.name, emoji: sp.emoji, private: !!sp.private },
        ui: { ...this.st.settings, transparency: 0 },
        card: (() => { const c = this.cardRect(); const [w] = this.win.getContentSize(); return { left: c.x, right: Math.max(0, w - c.x - c.width) }; })(),
        keys: mode === 'keys' ? this.shortcutList() : null,
        tour: mode === 'tour' ? { arc: !this.st.settings.arcImported && !!require('../arc-import').find() } : null,
        ...extra,
      });
    }));
  }

  // First start: a short welcome tour (shown once; Settings can show it again).
  startTour() {
    this.st.settings.toured = true;
    this.persist();
    this.openCommand('tour');
  }

  closeCommand(force = false) {
    if (!this.overlayMode) return;
    if (this.overlayMode === 'lock' && !force && this.isLocked(this.curSpaceId)) return;
    if (this.overlayMode === 'find') this.active?.view?.webContents.stopFindInPage('keepSelection');
    this.overlayMode = null;
    this.win.contentView.removeChildView(this.overlay);
    if (this.active?.view) this.active.view.webContents.focus(); else this.win.webContents.focus();
  }

  commandQuery(text) {
    if (this.overlayMode === 'tabs') return this.searchTabs(text);   // Find in all tabs (Ctrl+Shift+F)
    const q = text.trim().toLowerCase();
    const out = [];
    const seen = new Set();
    const add = (sec, it, key = it.url) => { if (key) { if (seen.has(key)) return; seen.add(key); } out.push({ sec, ...it }); };
    // Only this Space's tabs, pinned tabs, Favorites and history are searched.
    const sp = this.space;
    const allTabs = [...this.tabs.values()].filter(t => t.url && t.id !== this.activeTabId && t.spaceId === sp.id && t.kind !== 'little');

    if (!q) {
      allTabs.sort((a, b) => b.lastActive - a.lastActive).slice(0, 6).forEach(t =>
        add('Recent tabs', { type: 'tab', id: t.id, title: t.title || hostOf(t.url), sub: hostOf(t.url), url: t.url, favicon: t.favicon, badge: 'Switch to Tab' }));
      return out;
    }
    // Calculator: "12*7.5", "(40+2)/3", "2^10", "15% of 80", "sqrt(2)".
    let calc = calculate(text);
    if (calc !== null) out.push({ sec: '', type: 'calc', value: calc, title: `= ${calc}`, sub: text.trim(), icon: 'equals', badge: 'Copy' });
    // Units, currencies and time zones ("10 km in miles", "100 usd in eur", "3pm london in tokyo").
    const conv = calc === null ? require('../convert').convert(text) : null;
    if (conv) {
      if (conv.pending) this.updateRates();
      out.push({ sec: '', type: conv.pending ? 'none' : 'calc', value: conv.value, title: conv.title, sub: conv.sub, icon: 'swap', badge: conv.pending ? '' : 'Copy' });
      calc = conv.value;
    }
    // Search shortcuts: "w cats" searches Wikipedia, "yt lofi" YouTube…
    const kw = calc === null ? this.keywordSearch(text) : null;
    if (kw) out.push({ sec: '', type: 'url', url: kw.url, title: `Search ${kw.k.name} for “${kw.query}”`, sub: kw.url, icon: 'search', badge: kw.k.name });
    // Completing the address as you type: "yo" fills in youtube.com, and Enter goes there.
    const done = calc === null && !kw ? this.completeFor(text, sp) : null;
    if (done) out.unshift({ sec: '', type: 'url', url: done.url, title: done.text, sub: done.url, icon: 'external', badge: 'Open', complete: done.text });
    const url = calc !== null ? null : toUrl(text);
    if (url && url !== done?.url) out.push({ sec: '', type: 'url', url, title: url, icon: 'external', badge: 'Open' });
    out.push({ sec: '', type: 'search', text, title: text, icon: 'search', badge: `Search ${this.st.settings.searchEngine}` });

    this.commandActions().filter(a => a.title.toLowerCase().includes(q)).slice(0, 4).forEach(a => add('Actions', { type: 'action', ...a }));

    allTabs.filter(t => (t.title || '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q)).slice(0, 5).forEach(t =>
      add('Open tabs', { type: 'tab', id: t.id, title: t.title || hostOf(t.url), sub: hostOf(t.url), url: t.url, favicon: t.favicon, badge: 'Switch to Tab' }));
    return this.commandQueryRest(q, text, sp, add, out);
  }

  // Everything the command bar can do (also what command chains are made of).
  commandActions() {
    const actions = [
      { id: 'new-space', title: 'New Space', icon: 'plus' },
      { id: 'little', title: 'New Little Quasar window', icon: 'little' },
      { id: 'reopen', title: 'Reopen closed tab', icon: 'reset' },
      { id: 'copy-url', title: 'Copy URL', icon: 'copy' },
      { id: 'toggle-sidebar', title: 'Toggle sidebar', icon: 'sidebar' },
      { id: 'pin', title: 'Pin / unpin this tab', icon: 'pin' },
      { id: 'devtools', title: 'Developer tools', icon: 'code' },
      { id: 'passwords', title: 'Passwords', icon: 'key' },
      { id: 'new-window', title: 'New window', icon: 'windows', badge: 'Ctrl+N' },
      { id: 'private-window', title: 'New private window', icon: 'incognito', badge: 'Ctrl+Shift+N' },
      { id: 'history', title: 'History', icon: 'history', badge: 'Ctrl+H' },
      { id: 'downloads', title: 'Downloads', icon: 'download', badge: 'Ctrl+J' },
      { id: 'site-settings', title: 'Site settings and permissions', icon: 'sliders' },
      { id: 'print', title: 'Print…', icon: 'printer', badge: 'Ctrl+P' },
      { id: 'pdf', title: 'Save page as PDF…', icon: 'file' },
      { id: 'save-page', title: 'Save page as…', icon: 'download', badge: 'Ctrl+Shift+S' },
      { id: 'view-source', title: 'View page source', icon: 'code', badge: 'Ctrl+U' },
      { id: 'mute', title: 'Mute / unmute this tab', icon: 'mute' },
      { id: 'zoom-in', title: 'Zoom in', icon: 'plus', badge: 'Ctrl+=' },
      { id: 'zoom-out', title: 'Zoom out', icon: 'minus', badge: 'Ctrl+-' },
      { id: 'zoom-reset', title: 'Reset zoom', glyph: '1:1', badge: 'Ctrl+0' },
      { id: 'fullscreen', title: 'Full screen', icon: 'fullscreen', badge: 'F11' },
      { id: 'default-browser', title: 'Make Quasar your default browser', icon: 'star' },
      { id: 'quit', title: 'Quit Quasar (all windows)', icon: 'power', badge: 'Ctrl+Shift+Q' },
      { id: 'screenshot', title: 'Take screenshot', icon: 'camera', badge: 'Ctrl+Shift+2' },
      { id: 'split', title: 'Split view: open a tab beside this one', icon: 'split', badge: 'Ctrl+Shift+=' },
      { id: 'new-folder', title: 'New folder for pinned tabs', icon: 'folder' },
      { id: 'boosts', title: 'Boosts (custom CSS for sites)', icon: 'code' },
      { id: 'boost-site', title: 'Boost this site', icon: 'code' },
      { id: 'atc', title: 'Air Traffic Control rules', icon: 'plane' },
      { id: 'pip', title: 'Picture-in-picture for this tab’s video', icon: 'pip' },
      { id: 'sleep-others', title: 'Put background tabs to sleep (free memory)', icon: 'moon' },
      { id: 'check-updates', title: 'Check for updates', icon: 'refresh' },
      { id: 'reader', title: 'Reader mode', icon: 'book', badge: 'F9' },
      { id: 'translate', title: 'Translate page', icon: 'translate' },
      { id: 'extensions', title: 'Extensions', icon: 'puzzle' },
      { id: 'backup', title: 'Backup & sync', icon: 'cloud' },
      { id: 'backup', title: 'Tabs on your other PCs', icon: 'monitor' },
      { id: 'shortcuts', title: 'Keyboard shortcuts', icon: 'keyboard', badge: 'Ctrl+/' },
      { id: 'tour', title: 'Welcome tour', icon: 'compass' },
      { id: 'play-pause', title: 'Play / pause what’s playing', icon: 'playpause' },
      { id: 'close-others', title: 'Close other tabs', icon: 'close' },
      { id: 'reset-pinned', title: 'Go back to the pinned address', icon: 'reset' },
      { id: 'zap', title: 'Zap: hide things on this page', icon: 'zap' },
      { id: 'dark', title: 'Dark mode for this site', icon: 'contrast' },
      { id: 'dark-all', title: this.st.settings.darkAll ? 'Turn off dark mode for every site' : 'Make every site dark', icon: 'contrast' },
      { id: 'qr', title: 'QR code for this page', icon: 'qr' },
      { id: 'read-later', title: 'Save to Read Later', icon: 'bookmark', badge: 'Ctrl+Shift+D' },
      { id: 'read-later-list', title: 'Read Later list', icon: 'bookmark' },
      { id: 'notes', title: 'Notes for this Space', icon: 'note' },
      { id: 'live-folder', title: 'New Live Folder (RSS feed or GitHub)', icon: 'rss' },
      { id: 'compact', title: 'Compact mode (hide sidebar and top bar)', icon: 'expand', badge: 'Ctrl+Shift+L' },
      { id: 'panel-add', title: 'Keep this site in a sidebar panel', icon: 'panel' },
      { id: 'grid', title: 'Split view: arrange as grid / side by side', icon: 'grid' },
      { id: 'tidy', title: 'Tidy today’s tabs (group by site, close duplicates)', icon: 'layers' },
      { id: 'install-app', title: 'Install this site as an app', icon: 'download' },
      { id: 'break-5', title: 'Take a 5-minute break', icon: 'coffee' },
      { id: 'break-15', title: 'Take a 15-minute break', icon: 'coffee' },
      { id: 'break-30', title: 'Take a 30-minute break', icon: 'coffee' },
      { id: 'tor-window', title: 'New private window with Tor', icon: 'globe' },
      { id: 'vpn', title: this.vpnOnFor(this.space) ? 'Turn VPN off' : 'Turn VPN on (free, Cloudflare WARP)', icon: 'shield' },
      { id: 'vpn-window', title: 'New private window with VPN', icon: 'shield' },
      { id: 'import-browser', title: 'Import from Chrome, Edge, Firefox, Brave, Opera…', icon: 'download' },
      { id: 'import-bookmarks', title: 'Import bookmarks (HTML file)…', icon: 'download' },
      { id: 'export-bookmarks', title: 'Export pinned tabs as bookmarks (HTML file)…', icon: 'upload' },
      { id: 'export-passwords', title: 'Export passwords (CSV, asks for Windows Hello)…', icon: 'key' },
      { id: 'breach-check', title: 'Check passwords against data breaches', icon: 'key' },
      { id: 'lock-now', title: 'Lock Spaces now (Windows Hello)', icon: 'lock' },
      { id: 'lock-space', title: 'Lock this Space with Windows Hello (on / off)', icon: 'lock' },
      { id: 'forget-on-close', title: 'Forget this site when I close it (on / off)', icon: 'close' },
      { id: 'read-aloud', title: 'Read this page aloud', icon: 'volume', badge: 'Ctrl+Shift+U' },
      { id: 'live-captions', title: 'Live captions (Windows)', icon: 'message' },
      { id: 'find-tabs', title: 'Find text in all open tabs', icon: 'search', badge: 'Ctrl+Shift+F' },
      { id: 'copy-highlight', title: 'Copy link to the selected text', icon: 'link' },
      { id: 'task-manager', title: 'Task manager (memory and CPU per tab)', icon: 'chart', badge: 'Shift+Esc' },
      { id: 'chain-record', title: 'Record a command chain', icon: 'record' },
      { id: 'chain-stop', title: 'Stop recording and save the command chain', icon: 'stop' },
      { id: 'never-sleep', title: 'Never put this site to sleep (on / off)', icon: 'sun' },
      { id: 'new-tab-folder', title: 'Put this tab in a new folder', icon: 'folder' },
      { id: 'save-video', title: 'Save this page’s video to watch offline', icon: 'film' },
      { id: 'markup', title: 'Mark up the last screenshot', icon: 'pen' },
      { id: 'caret', title: 'Caret browsing (move through text with the arrow keys)', icon: 'caret', badge: 'F7' },
      { id: 'focus-sidebar', title: 'Move keyboard focus to the sidebar', icon: 'focus', badge: 'F6' },
      { id: 'identity-chrome', title: 'Tell this site I’m using Chrome', icon: 'id' },
      { id: 'identity-arch', title: 'Tell this site I’m using Quasar (default)', icon: 'id' },
      ...this.chains.map(c => ({ id: 'chain:' + c.id, title: c.name, icon: 'link', badge: c.keys || 'Chain' })),
      ...(this.isPrivate ? [] : this.st.spaces.map(s => ({ id: 'space:' + s.id, title: `Switch to ${s.name}`, glyph: s.emoji || '●', badge: s.locked ? 'Locked Space' : 'Space' }))),
    ];
    return actions;
  }

  commandQueryRest(q, text, sp, add, out) {
    const hit = (title, u) => (title || '').toLowerCase().includes(q) || (u || '').toLowerCase().includes(q);
    for (const p of pinnedTabNodes(sp.pinned)) {
      if (hit(p.title, p.url)) add('Pinned', { type: 'pinned', id: p.id, title: p.title || hostOf(p.url), sub: hostOf(p.url), url: p.url, favicon: p.favicon });
    }
    for (const f of sp.favorites) {
      if (hit(f.title, f.url)) add('Favorites', { type: 'fav', id: f.id, title: f.title || hostOf(f.url), sub: hostOf(f.url), url: f.url, favicon: f.favicon });
    }
    (sp.history || [])
      .filter(h => hit(h.title, h.url))
      .sort((a, b) => (b.visits * 1e12 + b.last) - (a.visits * 1e12 + a.last))
      .slice(0, 6)
      .forEach(h => add('History', { type: 'url', url: h.url, title: h.title || h.url, sub: hostOf(h.url) }));
    // Pages found by what was on them (AI › history search, kept on this PC).
    if (!sp.private) for (const h of this.searchHistoryText(text, sp.partition)) add('Found in pages you visited', { type: 'url', url: h.url, title: h.title, sub: `…${h.snip}…`, icon: 'search' });

    // Archived tabs (auto-archived, or closed when Quasar quit): this Space first, then the others.
    if (!this.isPrivate) {
      const label = id => { const s = this.spaceById(id); return s ? `${s.emoji || ''} ${s.name}`.trim() : ''; };
      this.st.archive.filter(a => hit(a.title, a.url))
        .sort((a, b) => (a.spaceId === sp.id ? 0 : 1) - (b.spaceId === sp.id ? 0 : 1) || b.closedAt - a.closedAt)
        .slice(0, 5)
        .forEach(a => add('Archive', { type: 'archived', id: a.id, title: a.title || hostOf(a.url), sub: `${hostOf(a.url)}${a.spaceId !== sp.id ? ' · ' + label(a.spaceId) : ''}`, url: a.url, favicon: a.favicon, badge: 'Restore' }));

      // Open tabs, pinned tabs and Favorites in other Spaces (choosing one switches Space).
      // A locked Space keeps its tabs to itself.
      const otherSpaces = this.st.spaces.filter(s => s.id !== sp.id && !this.isLocked(s.id) && !s.locked);
      const found = [];
      for (const s of otherSpaces) {
        for (const t of this.tabs.values()) {
          if (t.spaceId === s.id && t.kind === 'today' && t.url && hit(t.title, t.url)) found.push({ type: 'tab', id: t.id, title: t.title || hostOf(t.url), url: t.url, favicon: t.favicon, s });
        }
        for (const p of pinnedTabNodes(s.pinned)) if (hit(p.title, p.url)) found.push({ type: 'pinned', id: p.id, title: p.title || hostOf(p.url), url: p.url, favicon: p.favicon, s });
        for (const f of s.favorites) if (hit(f.title, f.url)) found.push({ type: 'fav', id: f.id, title: f.title || hostOf(f.url), url: f.url, favicon: f.favicon, s });
      }
      found.slice(0, 6).forEach(({ s, ...it }) => add('Other Spaces', { ...it, sub: `${hostOf(it.url)} · ${`${s.emoji || ''} ${s.name}`.trim()}`, badge: `Switch to ${s.name}` }, `${s.id}|${it.url}`));

      // Tabs open on your other PCs (Backup & sync).
      const remote = [];
      for (const d of this.backup.remoteTabs()) for (const t of d.tabs) if (hit(t.title, t.url)) remote.push({ d, t });
      remote.slice(0, 5).forEach(({ d, t }) => add('On your other PCs', { type: 'remote', url: t.url, spaceId: t.spaceId, title: t.title || hostOf(t.url),
        sub: `${hostOf(t.url)} · ${d.name}${t.space ? ' · ' + t.space : ''}`, favicon: t.favicon, badge: 'Open here' }, `remote|${t.url}`));
    }
    return out;
  }

  commandRun(item, mode) {
    this.closeCommand();
    // Split mode (Ctrl+Shift+=): whatever is chosen opens next to the current tab.
    if (mode === 'split') return this.commandSplit(item);
    // New Live Folder: what was typed is the feed, site or GitHub repository.
    if (mode === 'live') return this.createLiveFolder(item.url || item.text || '');
    const newTab = mode === 'new';
    switch (item.type) {
      case 'url': return newTab ? this.newTab(item.url, { route: true }) : this.navigate(item.url);
      case 'search': return this.navigate(item.text, { newTab });
      case 'tab': {
        const t = this.tabs.get(item.id);
        return t && this.show(t.id);
      }
      case 'pinned': return this.openPinned(item.id);
      case 'fav': return this.openFavorite(item.id);
      case 'action': return this.action(item.id);
      case 'archived': return this.restoreArchived(item.id);
      case 'remote': return /^(https?|file):/i.test(item.url || '') && this.newTab(item.url, { spaceId: this.st.spaces.some(s => s.id === item.spaceId) && !this.isPrivate ? item.spaceId : this.curSpaceId });
      case 'calc': clipboard.writeText(String(item.value)); return this.toast(`Copied ${item.value}`);
      case 'tabhit': {
        const t = this.tabs.get(item.id);
        if (!t) return;
        this.show(t.id);
        // Highlight the matches on that page (find bar, with the text filled in).
        setTimeout(() => { this.findText = String(item.text || ''); this.openCommand('find'); }, t.sleeping ? 1500 : 120);
        return;
      }
    }
  }

  commandSplit(item) {
    const base = this.active;
    let other = null;
    if (item.type === 'tab') other = this.tabs.get(item.id);
    else if (item.type === 'url' || item.type === 'archived' || item.type === 'fav' || item.type === 'pinned' || item.type === 'search') {
      const url = item.type === 'search' ? (toUrl(item.text) || this.searchUrl(item.text))
        : item.type === 'archived' ? this.st.archive.find(a => a.id === item.id)?.url : item.url;
      if (url) other = this.newTab(url, { active: false, after: base?.id, spaceId: base?.spaceId });
    } else if (item.type === 'calc') { clipboard.writeText(String(item.value)); return; }
    if (!other) return;
    if (!base || base.id === other.id) return this.show(other.id);
    this.splitWith(base.id, other.id);
  }

  action(id) {
    // Recording a command chain: remember each command as it runs.
    if (this.recording && !id.startsWith('chain')) this.recording.push(id);
    if (id.startsWith('space:')) return this.switchSpace(id.slice(6));
    if (id.startsWith('chain:')) return this.runChain(id.slice(6));
    const tab = this.active;
    const host = hostOf(tab?.url || '');
    switch (id) {
      case 'import-browser': return this.importBrowser();
      case 'import-bookmarks': return this.importBookmarksHtml();
      case 'export-bookmarks': return this.exportBookmarksHtml();
      case 'export-passwords': return this.exportPasswords();
      case 'breach-check': return this.openPasswords();
      case 'lock-now': return this.lockNow();
      case 'lock-space': return this.setSpaceLock(this.curSpaceId, !this.space.locked);
      case 'forget-on-close': return host ? this.toggleForgetOnClose(host) : this.toast('Open a site first.');
      case 'never-sleep': return host ? this.toggleNeverSleep(host) : this.toast('Open a site first.');
      case 'read-aloud': return this.readAloud();
      case 'live-captions': return this.liveCaptions();
      case 'find-tabs': return setTimeout(() => this.openCommand('tabs'), 30);
      case 'copy-highlight': {
        const wc = tab?.view?.webContents;
        if (!wc) return;
        return wc.executeJavaScript('String(getSelection())').then(s => {
          const l = this.highlightLink(tab.url, s);
          if (!l) return this.toast('Select some text on the page first.');
          clipboard.writeText(l); this.toast('Copied a link that scrolls to this text.');
        }).catch(() => {});
      }
      case 'task-manager': return this.openTaskManager();
      case 'chain-record': return this.startChainRecording();
      case 'chain-stop': return this.stopChainRecording();
      case 'new-tab-folder': return tab?.kind === 'today' ? this.groupNew(tab.id) : this.toast('Only today’s tabs go in folders (pinned tabs have their own).');
      case 'save-video': return this.saveVideo(tab);
      case 'markup': { const s = this.st.downloads.find(d => d.screenshot && require('fs').existsSync(d.path)); return s ? this.openMarkup(s.path) : this.toast('Take a screenshot first (Ctrl+Shift+2).'); }
      case 'caret': return this.toggleCaret();
      case 'focus-sidebar': return this.focusCycle();
      case 'identity-chrome': return host && this.setIdentity(host, 'chrome');
      case 'identity-arch': return host && this.setIdentity(host, 'arch');
    }
    switch (id) {
      case 'new-space': return this.win.webContents.send('ui:space', { action: 'new', spaceId: this.curSpaceId });
      case 'little': return this.openLittle();
      case 'reopen': return this.reopenClosed();
      case 'copy-url': if (this.active) { clipboard.writeText(this.active.url); this.toast('Copied URL'); } return;
      case 'toggle-sidebar': return this.toggleSidebar();
      case 'pin': return this.pinTab();
      case 'devtools': return this.active?.view?.webContents.toggleDevTools();
      case 'passwords': return this.openPasswords();
      case 'new-window': return this.newWindow();
      case 'private-window': return this.newWindow({ private: true });
      case 'history': return this.openLibrary('history');
      case 'downloads': return this.openLibrary('downloads');
      case 'site-settings': return this.openLibrary('sites');
      case 'print': return this.print();
      case 'pdf': return this.saveAsPdf();
      case 'save-page': return this.savePage();
      case 'view-source': return this.viewSource();
      case 'mute': return this.toggleMute();
      case 'zoom-in': return this.zoom(1);
      case 'zoom-out': return this.zoom(-1);
      case 'zoom-reset': return this.zoom(0);
      case 'fullscreen': return this.toggleF11();
      case 'default-browser': return this.makeDefaultBrowser();
      case 'quit': return this.quitAll();
      case 'screenshot': return this.startScreenshot();
      case 'split': return this.active && setTimeout(() => this.openCommand('split'), 30);
      case 'new-folder': return this.newFolder();
      case 'boosts': return this.openLibrary('boosts');
      case 'boost-site': { const h = hostOf(this.active?.url || ''); return this.openLibrary('boosts', h ? { pattern: h } : null); }
      case 'atc': return this.openLibrary('atc');
      case 'pip': return this.active && this.autoPip(this.active, true);
      case 'sleep-others': return this.sleepOtherTabs();
      case 'check-updates': return this.updater.check({ manual: true });
      case 'reader': return this.openReader();
      case 'translate': return this.act(this.win.webContents, 'translate');
      case 'extensions': return this.openLibrary('extensions');
      case 'backup': return this.openLibrary('backup');
      case 'shortcuts': return setTimeout(() => this.openCommand('keys'), 30);
      case 'tour': return setTimeout(() => this.startTour(), 30);
      case 'play-pause': return this.mediaAct('toggle');
      case 'close-others': { const a = this.active; if (!a || a.kind !== 'today') return; const mates = new Set(a.splitId ? this.splits.get(a.splitId)?.tabIds : [a.id]); return this.closeTabs((this.order[a.spaceId] || []).filter(id => !mates.has(id))); }
      case 'reset-pinned': return this.active && this.resetPinned(this.active.id);
      case 'zap': return this.startZap();
      case 'dark': return this.toggleSiteDark();
      case 'dark-all': this.st.settings.darkAll = !this.st.settings.darkAll; this.persist(); this.reapplyDark(); return this.toast(this.st.settings.darkAll ? 'Every site is dark now. Right-click a page › Dark Mode for This Site to turn one back.' : 'Dark mode for every site is off.');
      case 'qr': return setTimeout(() => this.showQr(), 30);
      case 'read-later': return this.saveReadLater(this.active);
      case 'read-later-list': return this.win.webContents.send('ui:view', 'later');
      case 'notes': return this.win.webContents.send('ui:view', 'notes');
      case 'live-folder': return setTimeout(() => this.openCommand('live'), 30);
      case 'compact': return this.toggleCompact();
      case 'panel-add': return this.panelAct('add');
      case 'grid': { const g = this.active?.splitId && this.splits.get(this.active.splitId); return g ? this.setSplitGrid(g.id, !g.grid) : this.toast('Open a split view with 3 or 4 tabs first.'); }
      case 'tidy': return this.tidyTabs();
      case 'install-app': return this.installApp(this.active);
      case 'break-5': return setTimeout(() => this.startBreak(5), 30);
      case 'break-15': return setTimeout(() => this.startBreak(15), 30);
      case 'break-30': return setTimeout(() => this.startBreak(30), 30);
      case 'tor-window': return this.newWindow({ tor: true });
      case 'vpn': return this.setVpn(!this.vpnOnFor(this.space));
      case 'vpn-window': return this.vpnStart().then(r => (r.error ? this.toast(r.error) : this.newWindow({ vpn: true })));
    }
  }

  find(text, { next = false, back = false } = {}) {
    const wc = this.active?.view?.webContents;
    if (!wc) return;
    this.findText = text;
    if (!text) return wc.stopFindInPage('clearSelection');
    wc.findInPage(text, { findNext: !!next, forward: !back });
  }

  toggleSidebar() {
    this.st.settings.sidebarHidden = !this.st.settings.sidebarHidden;
    this.layoutAll();
    this.changed();
  }

  layoutAll() { for (const W of this.wins) this.withWin(W, () => this.layout()); }
}

module.exports = CommandPart;
