// The browser itself: one frameless window whose own page (ui/index.html)
// draws the Arc-style sidebar and top bar, with each web tab shown as a
// WebContentsView placed in the rounded "card" area to the right.
//
// The Shell class is split by area into src/shell/*.js; each part's methods are
// mixed into Shell.prototype below. This file keeps start-up, the state sent to
// the window UI, and the IPC entry point.
const { app, Menu, clipboard, session, screen, shell: eShell } = require('electron');
const store = require('./store');
const { Vault } = require('./passwords');
const { Updater } = require('./updater');
const { AppUpdater, isInstalled } = require('./app-update');
const { Protection } = require('./protection');
const { Extensions } = require('./extensions');
const { Backup } = require('./backup');
const { Devices } = require('./devices');
const { Components } = require('./components');
const { UI, TOP, MARGIN, RADIUS, uid, hostOf, pinnedTabNodes } = require('./shell/common');
const { PROFILE_KEYS, ZOOMS } = require('./shell/common');

const PARTS = ['windows', 'profiles', 'downloads', 'pages', 'tabs', 'warnings', 'reader', 'layout', 'split', 'rules', 'peek', 'media', 'pinned', 'spaces', 'command', 'little', 'keyboard', 'library', 'autofill', 'arc', 'tools', 'collections', 'workspace', 'apps', 'pagetext', 'migrate', 'privacy', 'everyday', 'power', 'vpn', 'focus', 'omnibox', 'appearance'].map(n => require('./shell/' + n));

class Shell {
  constructor() {
    this.st = store.load();
    // The AI features (and any API key saved for them) were removed.
    if (this.st.settings.ai) { if (this.st.settings.ai.on && this.st.settings.ai.historySearch) this.st.settings.historySearch = true; delete this.st.settings.ai; }
    this.tabs = new Map();          // id -> tab
    this.order = {};                // spaceId -> [tabId] (today tabs)
    this.activeBySpace = {};        // spaceId -> tabId
    this.closed = [];               // recently closed, for Ctrl+Shift+T
    this.wins = new Set();          // main windows (see createWindow)
    this.cur = null;                // the main window being acted on (last focused)
    this.privateSpaces = new Map(); // id -> in-memory Space of a private window
    this.splits = new Map();        // split view id -> { id, spaceId, tabIds, sizes, pinnedRef }
    this.linkClicks = new Map();    // webContents id -> last link the user clicked (for Peek)
    this.crashInfo = new Map();     // webContents id -> { url, reason, count, at } for the crash page
    this.failInfo = new Map();      // webContents id -> { url, code } for the "can't reach this page" page
    this.hung = new Map();          // token -> webContents id of a page that stopped responding
    // Installed with Quasar-Setup.exe: Quasar updates as a whole from its GitHub releases
    // (each release brings its own Electron). Zip / source copies keep the engine updater.
    this.installed = isInstalled();
    this.updater = this.installed ? new AppUpdater(this) : new Updater(this);
    this.protection = new Protection(this);
    this.extensions = new Extensions(this);
    this.backup = new Backup(this);
    this.devices = new Devices(this);
    this.components = new Components(this);
    this.st.adAllow ||= [];         // sites where ads/trackers are allowed
    this.st.boosts ||= [];          // { id, name, pattern, css, js, enabled, spaceId }
    this.st.atc ||= [];             // Air Traffic Control: { id, pattern, spaceId, enabled }
    this.sessions = new Set();
    // "partition|origin|perm" -> boolean; remembered across restarts (not for private windows)
    this.permissions = new Map(Object.entries(this.st.sitePermissions || {}));
    this.liveDownloads = new Map(); // download id -> Electron DownloadItem
    this.st.downloads = (this.st.downloads || []).map(d => d.state === 'progressing' || d.state === 'paused' ? { ...d, state: 'interrupted' } : d);
    this.st.zoom ||= {};            // partition -> { host: zoom factor }
    this.littles = new Map();       // webContents id -> Little window
    this.pushTimer = null;
    this.findText = '';
    this.pageTabs = new Map();      // web page webContents id -> tab (for password requests)
    this.pendingSaves = new Map();  // save-password offers waiting for a click
    this.verifiedUntil = 0;         // Windows Hello check lasts 5 minutes
    this.pwWin = null;
    this.closing = new Map();       // webContents id -> why it is being closed (waits for "Leave site?")
    this.certErrors = new Map();    // webContents id -> cert error shown on the warning page
    this.certPending = new Map();   // webContents id -> last main-frame cert error, before the page fails
    this.certExceptions = new Map();// "partition|host" -> Set of certificate fingerprints the user accepted
    this.certInfo = new Map();      // "partition|host" -> certificate summary, for the site-info panel
    this.authQueue = Promise.resolve();
  }

  // ------------------------------------------------------------- startup
  // The password vault is decrypted the first time something needs it, not at start-up.
  get vault() { return this._vault || (this._vault = new Vault()); }

  start() {
    this.migrateToIsolatedSpaces();
    this.setupProfiles();
    // Open tabs: by default they don't survive closing Quasar (pinned tabs and Favorites
    // do) and go to the Archive. With "Continue where you left off" they come back,
    // asleep (nothing loads until you click one), until auto-archive takes them.
    const keep = !!this.st.settings.keepTabs;
    for (const sp of this.st.spaces) {
      this.order[sp.id] = [];
      const groups = new Map();
      (sp.tabs || []).forEach((t, i) => {
        if (!t.url || /^(about|data):/i.test(t.url)) return;
        if (!keep) return this.st.archive.unshift({ id: uid(), url: t.url, title: t.title || t.url, favicon: t.favicon || '', spaceId: sp.id, closedAt: Date.now() });
        const tab = this.record({ url: t.url, title: t.title, favicon: t.favicon, lastActive: t.lastActive, spaceId: sp.id });
        tab.sleeping = true;
        if (t.group) tab.groupId = t.group;
        this.order[sp.id].push(tab.id);
        if (i === sp.activeIndex) this.activeBySpace[sp.id] = tab.id;
        if (t.split) (groups.get(t.split) || groups.set(t.split, []).get(t.split)).push(tab.id);
      });
      // Split views come back as split views.
      for (const ids of groups.values()) {
        if (ids.length < 2) continue;
        const g = { id: uid(), spaceId: sp.id, tabIds: ids.slice(0, 4), sizes: ids.slice(0, 4).map(() => 1), pinnedRef: null };
        this.splits.set(g.id, g);
        for (const id of g.tabIds) this.tabs.get(id).splitId = g.id;
      }
      if (!keep) { sp.tabs = []; sp.activeIndex = -1; }
    }
    this.st.archive = this.st.archive.slice(0, 300);

    // Bring back every window that was open when Quasar closed, each on its own Space.
    const saved = (Array.isArray(this.st.windows) && this.st.windows.length ? this.st.windows : [{ bounds: this.st.bounds, maximized: this.st.bounds?.maximized, spaceId: this.st.activeSpaceId }])
      .filter(w => w && typeof w === 'object').slice(0, 12);
    let focus = null;
    for (const info of saved) {
      const W = this.createWindow({ spaceId: this.st.spaces.some(s => s.id === info.spaceId) ? info.spaceId : this.st.activeSpaceId, restore: true, bounds: info.bounds, maximized: !!info.maximized });
      this.withWin(W, () => this.switchSpace(W.spaceId));
      if (info.focused || !focus) focus = W;
    }
    if (focus) { this.cur = focus; focus.win.once('ready-to-show', () => setTimeout(() => !focus.win.isDestroyed() && focus.win.focus(), 50)); }
    this.offerDownloadResume();
    this.updater.start();
    this.protection.start();
    this.extensions.start();
    // Installed copies get new components with each Quasar update, so they don't check for them separately.
    if (!process.env.ARCH_NO_BACKGROUND) { this.backup.start(); if (!this.installed) this.components.start(); }
    setInterval(() => this.autoArchive(), 10 * 60 * 1000);
    setInterval(() => this.sleepIdleTabs(), 60 * 1000);
    setInterval(() => this.thumbsTick(), 30 * 1000);
    setTimeout(() => this.refreshAllLiveFolders(), 30e3);
    setTimeout(() => this.updateRates(), 20e3);
    setInterval(() => this.refreshAllLiveFolders(), 10 * 60e3);
    setInterval(() => this.enforceMemoryLimit(), 30e3);
    this.startBatteryWatch();
    this.startLockWatch();

    if (this.migrationNote) {
      this.win.webContents.once('did-finish-load', () => setTimeout(() => this.toast(this.migrationNote), 1500));
    }

    // Brand-new install: the welcome tour (its last page offers the Arc import).
    if (!this.st.settings.toured && (!process.env.ARCH_USER_DATA || process.env.ARCH_TOUR)) {
      const W = this.cur;
      this.st.settings.arcOffered = true;
      W?.win.webContents.once('did-finish-load', () => setTimeout(() => this.withWin(W, () => this.startTour()), 900));
    }
    // First start after an update: what changed (once per version).
    const whatsNew = require('./whats-new').takePending(this.st, this.st.appUpdate?.notes);
    this.persist();
    if (whatsNew) {
      const W = this.cur;
      W?.win.webContents.once('did-finish-load', () => setTimeout(() => this.withWin(W, () => this.openCommand('whatsnew', '', { whatsNew })), 1200));
    }
    // First run with Arc installed: offer the import.
    if (!this.st.settings.arcImported && !this.st.settings.arcOffered && require('./arc-import').find()) {
      this.st.settings.arcOffered = true;
      this.persist();
      this.win.webContents.once('did-finish-load', () => setTimeout(() =>
        this.toast('Arc found on this PC. Click here to import your Spaces.', { type: 'import-arc' }), 800));
    }
  }

  // ------------------------------------------------- state to the UI
  toast(text, action = null, buttons = null) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('toast', { text, action, buttons });
  }

  changed() { this.persist(); this.push(); }

  persist() {
    for (const sp of this.st.spaces) this.ensureProfile(sp);   // e.g. Spaces added by a backup restore or sync
    this.pruneGroups();
    for (const sp of this.st.spaces) {
      const list = this.order[sp.id] || [];
      sp.tabs = list.map(id => this.tabs.get(id)).filter(Boolean)
        .map(t => {
          const g = t.splitId ? this.splits.get(t.splitId) : null;
          return { url: t.url, title: t.title, favicon: t.favicon, lastActive: t.lastActive, ...(g && !g.pinnedRef ? { split: g.id } : {}), ...(t.groupId ? { group: t.groupId } : {}) };
        });
      sp.activeIndex = list.indexOf(this.activeBySpace[sp.id]);
      for (const p of pinnedTabNodes(sp.pinned)) { const t = this.liveTab('pinned', p.id); if (t?.favicon) p.favicon = t.favicon; }
    }
    // Nothing from private windows is ever written to disk.
    if (this.privateSpaces.size) {
      const priv = new Set([...this.privateSpaces.values()].map(s => s.partition));
      const zoom = {};
      for (const [p, m] of Object.entries(this.st.zoom)) if (!priv.has(p)) zoom[p] = m;
      const deviceGrants = {};
      for (const [k, v] of Object.entries(this.st.deviceGrants || {})) if (!priv.has(k.split('|')[0])) deviceGrants[k] = v;
      return store.save({ ...this.st, zoom, deviceGrants, downloads: this.st.downloads.filter(d => !d.private) });
    }
    store.save(this.st);
  }

  push() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      for (const W of this.wins) {
        if (W.win.isDestroyed()) continue;
        this.withWin(W, () => {
          const vm = this.viewModel();
          W.win.webContents.send('state', vm);
          // The Settings page (in the page area) shows the same state.
          const ia = W.inapp;
          if (ia?.kind === 'settings' && !ia.view.webContents.isDestroyed()) ia.view.webContents.send('state', vm);
        });
      }
      this.edgeWatch();   // hidden bars: watch for the pointer at the window's edge
    }, 16);
  }

  // Settings › Updates › version card: exactly which Quasar (and engine) this is.
  aboutInfo() {
    if (this._about) return this._about;
    const kind = isInstalled() ? 'installed' : app.isPackaged ? 'portable' : 'source';
    return (this._about = {
      quasar: app.getVersion(), kind, arch: process.arch,
      electron: process.versions.electron, chrome: process.versions.chrome,
      node: process.versions.node, v8: process.versions.v8,
      windows: require('os').release(),
    });
  }

  aboutText() {
    const a = this.aboutInfo();
    const how = { installed: 'installed copy', portable: 'zip copy', source: 'run from source' }[a.kind];
    return [`Quasar ${a.quasar} (${how}, ${a.arch})`, `Electron ${a.electron}`, `Chromium ${a.chrome}`,
      `Node ${a.node}`, `V8 ${a.v8}`, `Windows ${a.windows}`].join('\n');
  }

  viewModel() {
    const sp = this.space;
    const act = this.active;
    const elsewhere = id => this.shownElsewhere(id);
    const summary = t => ({ id: t.id, title: t.title || hostOf(t.url) || 'New Tab', url: t.url, favicon: t.favicon, loading: t.loading,
      active: t.id === this.activeTabId, elsewhere: elsewhere(t.id), audible: !!t.audible, muted: !!t.muted, sleeping: !!t.sleeping, crashed: !!t.crashed });
    const nav = act?.view?.webContents?.navigationHistory;
    const zf = act?.view?.webContents && !act.view.webContents.isDestroyed() ? act.view.webContents.getZoomFactor() : 1;
    // Downloads button: shown while something is downloading, or for a minute after.
    const dl = this.st.downloads.filter(d => d.spaceId === sp.id);
    const running = dl.filter(d => d.state === 'progressing');
    const recent = dl.some(d => d.end && Date.now() - d.end < 60e3);
    const tot = running.reduce((n, d) => n + (d.total || 0), 0);
    const got = running.reduce((n, d) => n + (d.received || 0), 0);
    return {
      spaces: this.visibleSpaces.map(s => ({ id: s.id, name: s.name, emoji: s.emoji, colors: s.colors, grain: s.grain, theme: s.theme || null })),
      space: { id: sp.id, name: sp.name, emoji: sp.emoji, colors: sp.colors, grain: sp.grain, private: !!sp.private, profileId: sp.profileId || null, sleepAfterMin: sp.sleepAfterMin ?? null, locked: !!sp.locked },
      profiles: this.st.profiles.map(p => ({ id: p.id, name: p.name, proxy: p.proxy || null, spaces: this.spacesOnProfile(p.id).map(s => `${s.emoji || ''} ${s.name}`.trim()) })),
      private: this.isPrivate,
      inapp: this.cur?.inapp?.kind || null,   // Library / Passwords open in the page area
      favorites: sp.favorites.map(f => { const t = this.liveTab('fav', f.id); return { ...f, favicon: t?.favicon || f.favicon, open: !!t, unread: t ? this.unreadIn(t.title) : 0, active: t?.id === this.activeTabId, audible: !!t?.audible, muted: !!t?.muted, tabId: t?.id }; }),
      pinned: this.pinnedViewModel(sp.pinned),
      // Tabs in a split view show as one row.
      today: (() => {
        const out = [], done = new Set();
        for (const id of this.order[sp.id] || []) {
          const t = this.tabs.get(id);
          if (!t) continue;
          const g = t.splitId ? this.splits.get(t.splitId) : null;
          if (!g || g.pinnedRef) { out.push({ ...summary(t), groupId: t.groupId || null }); continue; }
          if (done.has(g.id)) continue;
          done.add(g.id);
          const kids = g.tabIds.map(x => this.tabs.get(x)).filter(Boolean).map(summary);
          out.push({ split: true, id: g.id, tabs: kids, title: kids.map(k => k.title).join('  |  '), url: kids[0]?.url || '', groupId: t.groupId || null,
            active: kids.some(k => k.active), elsewhere: kids.some(k => k.elsewhere), audible: kids.some(k => k.audible), muted: kids.every(k => k.muted) && kids.some(k => k.audible || k.muted) });
        }
        return this.todayTree(sp.id, out);
      })(),
      todayFolders: this.groupsOf(sp.id).map(g => ({ id: g.id, title: g.title, parentId: g.parentId || null })),
      videos: this.videosViewModel(),
      locked: !!sp.locked,
      vpn: this.vpnViewModel(),
      // Split view panes on screen (for the dividers and the focus ring drawn between them).
      split: (() => {
        const g = this.activeSplit();
        if (!g || !this.cur?.paneRects || this.htmlFull || this.cur.f11) return null;
        return { id: g.id, grid: !!g.grid, panes: this.cur.paneRects.map(r => ({ ...r, active: r.tabId === this.activeTabId })) };
      })(),
      peek: this.cur?.peek ? { url: this.cur.peek.tab.url } : null,
      active: act ? { ...summary(act), canBack: !!nav?.canGoBack(), canForward: !!nav?.canGoForward(), host: hostOf(act.url), security: this.securityOf(act), zoom: Math.round(zf * 100),
        blocked: act.view?.webContents && !act.view.webContents.isDestroyed() ? (this.protection.counts.get(act.view.webContents.id) || 0) : 0,
        readerable: !!act.readerable, reading: !!act.view?.webContents && !act.view.webContents.isDestroyed() && this.isReaderPage(act.view.webContents.getURL()),
        foreign: !!act.pageLang && act.pageLang.split('-')[0].toLowerCase() !== this.translateTo ? this.langName(act.pageLang.split('-')[0]) : null,
        translated: /\.translate\.goog$/i.test(hostOf(act.url)) || !!act.translated, translating: !!act.translating,
        adsAllowed: this.protection.adsAllowed(hostOf(act.url)) } : null,
      protection: this.protection.status(),
      // Extension toolbar: the Space's session and the active tab's id.
      ext: { count: sp.private ? 0 : this.extensions.enabledFor(sp.partition).length, partition: sp.private ? null : 'persist:' + sp.partition,
        tab: act?.view?.webContents && !act.view.webContents.isDestroyed() ? act.view.webContents.id : -1 },
      downloads: { show: running.length > 0 || recent, running: running.length, progress: tot ? got / tot : (running.length ? -1 : 1) },
      archive: this.st.archive.filter(a => a.spaceId === sp.id).slice(0, 100),
      settings: this.st.settings,
      engines: Object.keys(store.SEARCH_ENGINES),
      presets: store.PRESETS,
      maximized: this.win.isMaximized(),
      fullscreen: !!this.cur?.f11,
      autoPip: this.st.settings.autoPip !== false,
      sleepAfterMin: Number(this.st.settings.sleepAfterMin ?? 10),
      sleepingCount: [...this.tabs.values()].filter(t => t.sleeping).length,
      update: this.updater.status(),
      about: this.aboutInfo(),
      media: this.mediaViewModel(),
      notes: sp.private ? [] : (sp.notes || []).slice(0, 300),
      readLater: sp.private ? [] : (sp.readLater || []).slice(0, 300),
      panels: this.panelsViewModel(),
      compact: !!this.st.settings.compact, chromeShown: !!this.cur?.chromeShown,
      battery: !!this.onBattery, breakUntil: this.breakUntil || 0,
      historySearch: this.historySearchOn,
      dark: !!act && this.darkFor(act.url),
      layout: { top: this.topH(), margin: MARGIN, radius: this.radiusPx() },
      autoHide: this.anyAutoHide,
      ...this.appearanceViewModel(),
    };
  }

  // ------------------------------------------------------------- IPC
  act(sender, name, args = []) {
    if (this.devices.choosers.has(sender.id)) return this.devices.act(sender, name, args);
    if (this.pwWin && !this.pwWin.isDestroyed() && sender.id === this.pwWin.webContents.id) return this.pwAct(name, args);
    if (this.libWin && !this.libWin.isDestroyed() && sender.id === this.libWin.webContents.id) return this.libAct(name, args);
    if (this.tmWin && !this.tmWin.isDestroyed() && sender.id === this.tmWin.webContents.id) return this.taskAct(name, args);
    if (this.muWin && !this.muWin.isDestroyed() && sender.id === this.muWin.webContents.id) return this.markupAct(name, args);
    const W = this.winOf(sender);
    if (!W) return this.littleAct(sender, name, args);
    this.cur = W;   // a click in a window acts on that window
    switch (name) {
      case 'ready': return this.viewModel();
      case 'tabMenu': return this.tabMenu(args[0], Number(args[1]) || 0, Number(args[2]) || 0);
      case 'tearOff': return this.tearOff(args[0]);
      case 'mute': return this.toggleMute(args[0]);
      case 'zoomMenu': return this.zoomMenu(Number(args[0]) || 0, Number(args[1]) || 0);
      case 'library': return this.openLibrary(String(args[0] || 'history'));
      case 'newWindow': return this.newWindow({ private: !!args[0] });
      case 'defaultBrowser': return this.makeDefaultBrowser();
      case 'exitFullscreen': return this.cur.f11 && this.toggleF11();
      case 'resumeDownloads': return this.resumeAllDownloads();
      case 'reader': return this.openReader();
      case 'translate': return this.active && (/\.translate\.goog$/i.test(hostOf(this.active.url)) || this.active.translated ? this.showOriginal() : this.translatePage());
      case 'filters:update': return this.protection.update({ force: true }).then(ch => this.toast(ch ? 'Blocking and safety lists updated.' : 'Lists are up to date (or couldn’t be downloaded).'));
      case 'adsAllow': return this.setAdsAllowed(hostOf(this.active?.url || ''), !!args[0]);
      case 'hung:wait': return this.hungAct('wait', args[0]);
      case 'hung:kill': return this.hungAct('kill', args[0]);
      case 'sleepTab': { const t = this.tabs.get(args[0]); return t && this.sleepTab(t); }
      case 'sleepOthers': return this.sleepOtherTabs();
      case 'update:check': return this.updater.check({ manual: true });
      case 'about:copy': { clipboard.writeText(this.aboutText()); this.toast('Copied version info'); return; }
      case 'update:install': return this.updater.installNow();
      case 'update:major': return this.updater.offerMajor();
      case 'update:rollback': return this.updater.rollback();
      case 'quitAll': return this.quitAll();
      case 'app:restart': app.relaunch(); return this.quitAll();
      // pinned folders
      case 'pinnedMenu': return this.pinnedMenu(args[0], Number(args[1]) || 0, Number(args[2]) || 0);
      case 'movePinned': return this.movePinned(args[0], args[1] || null, args[2] === 'into' ? 'into' : 'before');
      case 'pinInto': return this.pinTab(args[0], { folderId: args[1] });
      case 'newFolder': return this.newFolder();
      case 'renamePinned': return this.renamePinned(args[0], args[1]);
      case 'toggleFolder': return this.toggleFolder(args[0]);
      case 'resetPinned': return this.resetPinned(args[0]);
      case 'setPinnedUrl': return this.setPinnedUrl(args[0]);
      // split view
      case 'splitMenu': return this.splitMenu(args[0], Number(args[1]) || 0, Number(args[2]) || 0);
      case 'splitResize': return this.splitResize(args[0], Number(args[1]), Number(args[2]));
      case 'closeSplit': return this.closeSplit(args[0]);
      case 'splitWith': return this.splitWith(args[0], args[1]);
      // Peek and screenshot layer
      case 'peek:close': return this.closePeek();
      case 'peek:expand': return this.expandPeek();
      case 'peek:little': { const u = this.cur.peek?.tab.url; this.closePeek(); return u && this.openLittle(u); }
      case 'peek:copy': { const u = this.cur.peek?.tab.url; if (u) { clipboard.writeText(u); this.toast('Copied link'); } return; }
      case 'shot:region': return this.screenshot('region', args[0]);
      case 'shot:visible': return this.screenshot('visible');
      case 'shot:full': return this.screenshot('full');
      case 'shot:cancel': return this.hideLayer();
      case 'screenshot': return this.startScreenshot();
      case 'win:min': return this.win.minimize();
      case 'win:max': return this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
      case 'win:close': return this.win.close();
      case 'back': return this.active?.view?.webContents.navigationHistory.goBack();
      case 'forward': return this.active?.view?.webContents.navigationHistory.goForward();
      case 'reload': return this.active?.loading ? this.active.view.webContents.stop() : this.reloadPage(this.active?.view?.webContents);
      case 'select': return this.show(args[0]);
      case 'close': return this.closeTab(args[0]);
      case 'newTab': return this.newTabAction();
      case 'openUrlBar': return this.openCommand('url');
      case 'pin': return this.pinTab(args[0]);
      case 'unpin': return this.unpin(args[0]);
      case 'openPinned': return this.openPinned(args[0]);
      case 'reorderPinned': return this.reorderPinned(args[0], args[1]);
      case 'favorite': return this.favoriteTab(args[0]);
      case 'removeFavorite': return this.removeFavorite(args[0]);
      case 'openFavorite': return this.openFavorite(args[0]);
      case 'reorder': return this.reorderTab(args[0], args[1]);
      case 'moveToSpace': return this.moveTabToSpace(args[0], args[1]);
      case 'clearToday': return this.clearToday();
      case 'switchSpace': return this.switchSpace(args[0]);
      case 'cycleSpace': return this.cycleSpace(args[0]);
      case 'addSpace': return this.win.webContents.send('ui:space', { action: 'new', spaceId: this.curSpaceId });
      case 'createSpace': return this.createSpace(args[0] || {});
      case 'setSpaceProfile': return this.setSpaceProfile(args[0], args[1]);
      case 'setProfileProxy': return this.setProfileProxy(String(args[0]), args[1] || {});
      case 'renameProfile': return this.renameProfile(args[0], args[1]);
      case 'updateSpace': return this.updateSpace(args[0], args[1] || {});
      case 'deleteSpace': return this.deleteSpace(args[0]);
      case 'restoreArchived': return this.restoreArchived(args[0]);
      case 'clearArchive': this.st.archive = []; return this.changed();
      case 'setting': {
        const [key, val] = args;
        const handled = this.appearanceSetting(key, val);
        if (handled) { this.changed(); return handled.error ? handled : undefined; }
        if (key === 'archiveAfterHours') this.st.settings.archiveAfterHours = Number(val) || 0;
        if (key === 'autoPip') this.st.settings.autoPip = !!val;
        if (key === 'keepTabs') this.st.settings.keepTabs = !!val;
        if (key === 'translateEngine') this.st.settings.translateEngine = val === 'google' ? 'google' : 'local';
        if (key === 'compact') return this.toggleCompact(!!val);
        if (key === 'gestures') this.st.settings.gestures = !!val;
        if (key === 'batterySaver') { this.st.settings.batterySaver = !!val; this.onBattery = !!val && require('electron').powerMonitor.isOnBatteryPower(); }
        if (key === 'tabPreviews') this.st.settings.tabPreviews = !!val;
        if (key === 'hardwareAcceleration') { this.st.settings.hardwareAcceleration = !!val; this.toast('Restart Quasar for the hardware acceleration change to take effect.'); }
        if (key === 'focusClock' || key === 'clock24' || key === 'clockSeconds') this.st.settings[key] = !!val;
        if (key === 'bgChoice' && (['none', 'rotate', 'color', 'gradient', 'daily'].includes(val) || /^m\d\d$/.test(val) || (val === 'custom' && this.st.settings.background))) this.st.settings.bgChoice = val;
        if (key === 'clockStyle' && ['thin', 'bold', 'flip', 'stack', 'led', 'nixie', 'dots', 'words'].includes(val)) this.st.settings.clockStyle = val;
        if (key === 'bgEvery' && ['open', '10', '60', '1440'].includes(String(val))) this.st.settings.bgEvery = String(val);
        if (key === 'sidebarSide') { this.st.settings.sidebarSide = ['right', 'top'].includes(val) ? val : 'left'; for (const W of this.wins) W.sbPanel = false; this.layoutAll(); }
        if (key === 'tabCycle') this.st.settings.tabCycle = val === 'order' ? 'order' : 'mru';
        if (key === 'sleepAfterMin') this.st.settings.sleepAfterMin = Math.max(0, Math.min(1440, Number(val) || 0));
        if (key === 'autoUpdate') { this.st.settings.autoUpdate = !!val; if (val) this.updater.check(); }
        if (key === 'blockAds' || key === 'safeBrowsing' || key === 'httpsOnly' || key === 'cookieBanners' || key === 'fingerprinting') this.st.settings[key] = !!val;
        if (key === 'vpnButton') this.st.settings.vpnButton = !!val;
        if (key === 'searchSuggest' || key === 'darkAll' || key === 'autoScroll') this.st.settings[key] = !!val;
        if (key === 'darkAll') this.reapplyDark();
        if (key === 'historySearch') this.setHistorySearch(!!val);
        if (key === 'gpc' || key === 'cleanLinks' || key === 'lockPrivate' || key === 'askDownload') this.st.settings[key] = !!val;
        if (key === 'lockAfterMin') this.st.settings.lockAfterMin = Math.max(1, Math.min(240, Number(val) || 5));
        if (key === 'memLimitMB') this.st.settings.memLimitMB = Math.max(0, Math.min(65536, Number(val) || 0));
        if (key === 'defaultZoom') { const z = Number(val); this.st.settings.defaultZoom = ZOOMS.includes(z) ? z : 1; for (const t of this.tabs.values()) this.applyZoom(t); }
        if (key === 'minFontSize') this.st.settings.minFontSize = Math.max(0, Math.min(24, Number(val) || 0));
        if (key === 'sleepSpace') { const s = this.spaceById(this.curSpaceId); if (s && !s.private) s.sleepAfterMin = val === '' || val == null ? null : Math.max(0, Math.min(1440, Number(val) || 0)); }
        if (key === 'searchEngine' && store.SEARCH_ENGINES[val]) this.st.settings.searchEngine = val;
        if (key === 'sidebarWidth') { this.st.settings.sidebarWidth = Math.max(180, Math.min(420, Number(val) || 240)); this.layoutAll(); }
        return this.changed();
      }
      case 'background': return this.backgroundAct(args[0]);
      // customisation (src/shell/appearance.js)
      case 'nt': return this.ntAct(String(args[0] || ''), args[1] || {});
      case 'home': return this.goHome();
      case 'profileMenu': return this.profileMenu(Number(args[0]) || 0, Number(args[1]) || 0);
      case 'topbarMenu': return this.topbarMenu(Number(args[0]) || 0, Number(args[1]) || 0);
      case 'sbPanel': return this.setSbPanel(!!args[0]);
      case 'folderIcon': return this.setFolderIcon(args[0] === 'group' ? 'group' : 'pinned', String(args[1] || ''), args[2]);
      case 'sbItem': return this.sbItemAct(String(args[0] || ''), String(args[1] || ''));
      case 'theme:export': return this.exportTheme();
      case 'theme:import': return this.importTheme();
      case 'theme:undo': return this.undoTheme();
      case 'settings:open': return this.openSettings(args[0]);
      case 'set:close': return this.cur?.inapp?.kind === 'settings' && this.closeInApp(this.cur);
      case 'toggleSidebar': return this.toggleSidebar();
      case 'little': return this.openLittle();
      case 'showFile': return args[0] && eShell.showItemInFolder(args[0]);
      case 'clearData': return this.clearBrowsingData();
      case 'importArc': return this.importArc();
      case 'spaceMenu': return this.spaceMenu(args[0], args[1], args[2]);
      case 'siteInfo': return this.siteInfo(Number(args[0]) || 0, Number(args[1]) || 0);
      case 'passwords': return this.openPasswords();
      case 'pw:save': return this.pwSavePending(args[0]);
      case 'pw:never': return this.pwSavePending(args[0], true);
      case 'addr:save': return this.addrSavePending(args[0]);
      case 'addr:skip': return this.pendingAddrs?.delete(args[0]);
      case 'card:save': return this.cardSavePending(args[0]);
      case 'card:skip': return this.pendingCards?.delete(args[0]);
      // command bar (overlay)
      case 'cmd:query': return this.commandQuery(String(args[0] || ''));
      case 'cmd:suggest': return this.searchSuggestions(String(args[0] || ''));
      case 'define': return this.defineWord(String(args[0] || ''));
      case 'cmd:run': return this.commandRun(args[0], args[1]);
      case 'cmd:close': return this.closeCommand();
      case 'tour:done': return this.closeCommand();
      case 'tabPreview': return this.tabPreview(args[0]);
      // notes, Read Later, Live Folders
      case 'notes': return this.notesAct(String(args[0]), args[1] || {});
      case 'readLater': return args[0] === 'save' ? this.saveReadLater(this.active, { close: !!args[1] }) : this.readLaterAct(String(args[0]), args[1]);
      case 'liveFolder': return this.openCommand('live');
      case 'zap:undo': return this.undoZap(args[0]);
      case 'noop': return null;
      // tools
      case 'zap': return this.startZap();
      case 'dark': return this.toggleSiteDark();
      case 'qr': return this.showQr();
      // compact mode, panels, split grid, tidy
      case 'chrome:show': return this.revealChrome(!!args[0]);
      case 'panel': return this.panelAct(String(args[0]), args[1]);
      case 'tidy': return this.tidyTabs();
      // break mode
      case 'break:start': return this.startBreak(Number(args[0]) || 15);
      case 'break:end': return this.endBreak();
      // AI (optional, off by default)
      case 'media': return this.mediaAct(String(args[0]), args[1] || null).then(() => setTimeout(() => this.push(), 300));
      case 'tour': return this.startTour();
      case 'shortcuts': return this.openCommand('keys');
      case 'cmd:find': return this.find(String(args[0] || ''), args[1] || {});
      // switching browsers
      case 'importBrowser': return this.importBrowser();
      case 'importBookmarks': return this.importBookmarksHtml();
      case 'exportBookmarks': return this.exportBookmarksHtml();
      case 'exportPasswords': return this.exportPasswords();
      // locks
      case 'lock:unlock': return this.unlockSpace();
      case 'lock:now': return this.lockNow();
      case 'lock:space': return this.setSpaceLock(args[0] || this.curSpaceId, !!args[1]);
      // everyday
      case 'keywords': return this.keywordAct(String(args[0] || 'list'), args[1] || {});
      case 'readAloud': return this.readAloud();
      case 'liveCaptions': return this.liveCaptions();
      case 'findTabs': return this.openCommand('tabs');
      // power tools
      case 'taskManager': return this.openTaskManager();
      case 'chains': return this.chainAct(String(args[0] || 'list'), args[1] || {});
      case 'group': return this.groupAct(String(args[0]), args[1], args[2]);
      case 'groupAdd': return this.groupAdd(args[0], args[1]);
      case 'groupNew': return this.groupNew(args[0]);
      case 'video': return this.videoAct(String(args[0]), args[1]);
      case 'markup': return this.openMarkup(args[0]);
      case 'focusPage': { const wc = this.active?.view?.webContents; if (wc && !wc.isDestroyed()) wc.focus(); return; }
      case 'caret': return this.toggleCaret();
      // free VPN (Cloudflare WARP)
      case 'vpn': return this.setVpn(!!args[0]);
      case 'vpnMenu': return this.vpnMenu(Number(args[0]) || 0, Number(args[1]) || 0);
    }
  }

  zoomMenu(x, y) {
    const tab = this.active;
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const pct = Math.round(wc.getZoomFactor() * 100);
    Menu.buildFromTemplate([
      { label: `Zoom: ${pct}%${hostOf(tab.url) ? ` on ${hostOf(tab.url)}` : ''}`, enabled: false },
      { type: 'separator' },
      { label: 'Zoom In', accelerator: 'Ctrl+=', registerAccelerator: false, click: () => this.zoom(1, tab) },
      { label: 'Zoom Out', accelerator: 'Ctrl+-', registerAccelerator: false, click: () => this.zoom(-1, tab) },
      { label: 'Reset to 100%', accelerator: 'Ctrl+0', registerAccelerator: false, click: () => this.zoom(0, tab) },
    ]).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }
}

// Mix the parts in (getters and setters included).
for (const Part of PARTS) {
  for (const key of Object.getOwnPropertyNames(Part.prototype)) {
    if (key === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Shell.prototype, key)) throw new Error(`Shell.${key} is defined twice`);
    Object.defineProperty(Shell.prototype, key, Object.getOwnPropertyDescriptor(Part.prototype, key));
  }
}
Shell.PROFILE_KEYS = PROFILE_KEYS;
Shell.ZOOMS = ZOOMS;

module.exports = { Shell };
