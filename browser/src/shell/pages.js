// Web page views: creating them, page events, the right-click menu, page tools, and guards every page gets.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, screen } = require('electron');
const { originOf, siteKey, generatePassword } = require('../passwords');
const { PAGE_PRELOAD, ICON, RADIUS, hostOf, DRIFT_URL, pageUrl, toUrl } = require('./common');

class PagesPart {
  // --------------------------------------------------------------- views
  // A web page view for `tab` (tabs, Peek, Little Quasar, site apps, pinned-tab previews):
  // its Space's profile, Quasar's page preload, sandbox, and the guards every page gets.
  pageView(tab, { white = true, rounded = true, prefs = {} } = {}) {
    const view = new WebContentsView({ webPreferences: { partition: this.partitionFor(tab), preload: PAGE_PRELOAD, plugins: true, sandbox: true, contextIsolation: true, spellcheck: true, ...prefs } });
    this.setupSession(view.webContents.session, tab.profile);
    this.registerPage(view.webContents, tab);
    this.guard(view.webContents);
    if (white) view.setBackgroundColor('#FFFFFFFF');
    if (rounded) view.setBorderRadius?.(this.radiusPx());
    tab.view = view;
    return view;
  }

  ensureView(tab) {
    if (tab.view) return tab.view;
    const minFont = Number(this.st.settings.minFontSize) || 0;
    const view = this.pageView(tab, { prefs: minFont ? { minimumFontSize: minFont } : {} });
    this.wire(tab);
    this.extensions.addTab(view.webContents, (tab.host && this.wins.has(tab.host) ? tab.host : this.cur)?.win);
    // Waking a sleeping tab: reload it and put the scroll position back.
    if (tab.sleeping) {
      tab.sleeping = false;
      const scroll = tab.sleepScroll;
      tab.sleepScroll = null;
      if (Array.isArray(scroll) && (scroll[0] || scroll[1])) {
        view.webContents.once('did-finish-load', () => {
          if (!view.webContents.isDestroyed()) view.webContents.executeJavaScript(`scrollTo(${Number(scroll[0]) || 0}, ${Number(scroll[1]) || 0})`).catch(() => {});
        });
      }
    }
    // (after the Profile's proxy is set, if it has one)
    this.applyIdentity(view.webContents, tab.url);
    Promise.resolve(view.webContents.session.__archProxyReady).then(() => !view.webContents.isDestroyed() && view.webContents.loadURL(pageUrl(tab.url) || 'about:blank').catch(() => {}));
    return view;
  }

  wire(tab) {
    const wc = tab.view.webContents;
    wc.on('page-title-updated', (e, title) => {
      if (this.isArchPage(wc.getURL()) && !this.isDriftPage(wc.getURL())) return; // keep the real page's title
      tab.title = title; if (tab.forgotUrl !== tab.url) this.touchHistory(tab.spaceId, tab.url, title); this.changed();
    });
    wc.on('page-favicon-updated', (e, icons) => {
      tab.favicon = icons.find(i => !/^data:,?$/.test(i)) || '';
      this.changed();
    });
    wc.on('did-start-loading', () => { tab.loading = true; this.push(); });
    wc.on('did-stop-loading', () => { tab.loading = false; this.push(); setTimeout(() => { tab.thumbAt = 0; this.captureThumb(tab); }, 900); });
    wc.on('did-navigate', (e, url) => {
      // On the certificate warning page the address still shows the site that failed.
      if (this.isCertPage(url)) { tab.url = this.certErrors.get(wc.id)?.url || tab.url; return this.changed(); }
      // Same for the crash page.
      if (this.isCrashPage(url)) { tab.url = this.crashInfo.get(wc.id)?.url || tab.url; return this.changed(); }
      // And on the dangerous-site / no-HTTPS warning.
      if (this.isBlockPage(url)) { tab.url = this.protection.blocked.get(wc.id)?.url || tab.url; return this.changed(); }
      // And on the "can't reach this page" / offline page.
      if (this.isFailPage(url)) { tab.url = this.isDriftPage(url) ? DRIFT_URL : (this.failInfo.get(wc.id)?.url || tab.url); return this.changed(); }
      // And in reader mode.
      if (this.isReaderPage(url)) { tab.url = this.readerInfo?.get(wc.id)?.url || tab.url; return this.changed(); }
      if (tab.translatedFrom && !/\.translate\.goog$|^translate\.google\./i.test(hostOf(url))) tab.translatedFrom = null;
      // A page reloaded by "Forget this site" isn't recorded again; moving on is.
      if (tab.forgotUrl && tab.forgotUrl !== url) tab.forgotUrl = null;
      tab.url = url; if (tab.forgotUrl !== url) this.touchHistory(tab.spaceId, url, tab.title, true);
      this.applyZoom(tab);
      this.changed();
    });
    wc.on('did-navigate-in-page', (e, url, main) => { if (main && !this.isArchPage(url)) { tab.url = url; this.changed(); } });
    wc.on('before-input-event', (e, input) => { if (tab.host && this.wins.has(tab.host)) this.cur = tab.host; this.focusPane(tab); this.onKey(e, input); });
    // Split view: clicking into a pane makes it the active one.
    wc.on('focus', () => this.focusPane(tab));
    wc.on('before-mouse-event', (e, m) => { if (m?.type === 'mouseDown') this.focusPane(tab); });
    // Pinned tabs and Favorites open links to other sites in Peek, so the pinned page stays put.
    wc.on('will-navigate', e => {
      if ((tab.kind !== 'pinned' && tab.kind !== 'fav') || !e.isMainFrame || e.isSameDocument) return;
      const click = this.linkClicks.get(wc.id);
      if (!click || Date.now() - click.at > 1500 || click.href !== e.url) return;   // only real link clicks, never redirects
      if (!/^https?:/i.test(e.url) || siteKey(originOf(e.url) || '') === siteKey(originOf(tab.url) || '')) return;
      e.preventDefault();
      this.withWin(tab.host || this.cur, () => this.openPeek(e.url, tab.spaceId));
    });
    // Reader-mode button and translation offer depend on what the page is.
    wc.on('did-finish-load', () => { if (!this.isArchPage(wc.getURL())) { this.inspectPage(tab); setTimeout(() => this.indexPageText(tab), 1500); } });
    wc.on('did-start-navigation', e => { if (e?.isMainFrame && !e.isSameDocument) { this.applyIdentity(wc, e.url); tab.readerable = false; tab.pageLang = ''; tab.translated = null; if (tab.media) { tab.media = null; this.push(); } } });
    // Ctrl + mouse wheel / pinch zoom, remembered per site.
    wc.on('zoom-changed', (e, dir) => this.zoom(dir === 'in' ? 1 : -1, tab));
    // Speaker icon in the sidebar for tabs playing sound.
    wc.on('audio-state-changed', e => { tab.audible = !!e.audible; this.push(); });
    wc.on('found-in-page', (e, r) => (tab.host || this.cur)?.overlay?.webContents.send('find:result', { active: r.activeMatchOrdinal, matches: r.matches }));
    wc.on('enter-html-full-screen', () => this.withWin(tab.host || this.cur, () => { this.htmlFull = true; this.win.setFullScreen(true); this.layout(); }));
    wc.on('leave-html-full-screen', () => this.withWin(tab.host || this.cur, () => { this.htmlFull = false; if (!this.cur.f11) this.win.setFullScreen(false); this.layout(); }));
    // (crashes are handled in guard(), for every kind of page)
    // Sign-in pop-ups get the same right-click menu, certificate warnings and "Leave site?" checks.
    wc.on('did-create-window', child => this.guard(child.webContents));
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      // Real pop-ups (sign-in windows etc.) open as small windows so they keep working.
      if (disposition === 'new-window' && features) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, icon: ICON } };
      }
      // Shift+click on a link: Peek.
      if (disposition === 'new-window') {
        this.withWin(tab.host || this.cur, () => this.openPeek(url, tab.spaceId));
        return { action: 'deny' };
      }
      // New tabs stay in the opener's Space (same profile, same logins) unless an
      // Air Traffic Control rule sends that site to another Space.
      this.newTab(url, { spaceId: tab.spaceId, active: disposition !== 'background-tab', after: tab.id, route: true });
      return { action: 'deny' };
    });
  }

  // Right-click menu for web pages (tabs, Little Quasar, sign-in pop-ups).
  // Edit commands call the page's own webContents directly, so they always act on the page clicked.
  contextMenu(wc, p) {
    if (wc.isDestroyed()) return;
    const tab = this.pageTabs.get(wc.id) || null;
    if (tab?.host && this.wins.has(tab.host)) this.cur = tab.host;
    const win = this.windowFor(tab, wc);
    const spaceId = tab?.spaceId || this.curSpaceId;
    const after = tab && this.tabs.has(tab.id) ? tab.id : null;
    const open = (url, active = true) => this.newTab(url, { spaceId, active, after });
    const nav = wc.navigationHistory;
    const f = p.editFlags || {};
    const sep = { type: 'separator' };
    const items = [];
    const sel = (p.selectionText || '').replace(/\s+/g, ' ').trim();
    items.push(...this.appMenuItems(wc));   // in an installed app's window

    if (p.isEditable && p.misspelledWord) {
      const sugg = (p.dictionarySuggestions || []).slice(0, 5);
      if (sugg.length) for (const s of sugg) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      else items.push({ label: 'No spelling suggestions', enabled: false });
      items.push({ label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, sep);
    }
    if (p.linkURL) items.push(
      { label: 'Open Link in New Tab', click: () => open(p.linkURL, false) },
      { label: 'Open Link in Peek', accelerator: 'Shift+Click', registerAccelerator: false, click: () => this.withWin(this.hostOf(tab?.id) || this.cur, () => this.openPeek(p.linkURL, spaceId)) },
      { label: 'Open Link in Split View', visible: !!tab && this.tabs.has(tab?.id), click: () => { const t = this.newTab(p.linkURL, { spaceId, active: false, after }); this.splitWith(tab.id, t.id); } },
      { label: 'Open Link in New Window', visible: !this.spaceById(spaceId)?.private, click: () => this.newWindow({ url: p.linkURL, spaceId }) },
      { label: 'Open Link in Private Window', click: () => this.newWindow({ private: true, url: p.linkURL }) },
      { label: 'Open Link in Little Quasar', click: () => this.openLittle(p.linkURL) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) }, sep);
    if (p.mediaType === 'video' && tab && this.tabs.has(tab.id) && !this.spaceById(spaceId)?.private) items.push(
      { label: 'Save Video to Watch Offline', enabled: /^https?:/i.test(p.srcURL || ''), click: () => this.saveVideo(tab, p.srcURL) },
      { label: 'Copy Video Address', enabled: /^https?:/i.test(p.srcURL || ''), click: () => clipboard.writeText(p.srcURL) }, sep);
    if (p.mediaType === 'image') items.push(
      { label: 'Open Image in New Tab', click: () => open(p.srcURL) },
      { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Copy Text from Image', click: () => this.withWin(this.hostOf(tab?.id) || this.cur, () => this.copyTextFromImage(wc, p)) },
      ...this.imageSearchItems(p.srcURL, url => this.newTab(url, { spaceId, after })),
      { label: 'Save Image', click: () => wc.downloadURL(p.srcURL) }, sep);

    // Right-click a password box: a strong generated password (filled into it and its "confirm" box).
    if (p.isEditable && (p.formControlType === 'input-password' || p.inputFieldType === 'password')) {
      items.push({ label: 'Suggest Strong Password', click: () => wc.send('arch:suggest-password', generatePassword()) }, sep);
    }
    if (p.isEditable) {
      items.push(
        { label: 'Undo', accelerator: 'Ctrl+Z', registerAccelerator: false, enabled: f.canUndo !== false, click: () => wc.undo() },
        { label: 'Redo', accelerator: 'Ctrl+Y', registerAccelerator: false, enabled: f.canRedo !== false, click: () => wc.redo() }, sep,
        { label: 'Cut', accelerator: 'Ctrl+X', registerAccelerator: false, enabled: !!f.canCut, click: () => wc.cut() },
        { label: 'Copy', accelerator: 'Ctrl+C', registerAccelerator: false, enabled: !!f.canCopy, click: () => wc.copy() },
        { label: 'Paste', accelerator: 'Ctrl+V', registerAccelerator: false, enabled: f.canPaste !== false, click: () => wc.paste() },
        { label: 'Paste as Plain Text', accelerator: 'Ctrl+Shift+V', registerAccelerator: false, enabled: f.canPaste !== false, click: () => wc.pasteAndMatchStyle() },
        { label: 'Select All', accelerator: 'Ctrl+A', registerAccelerator: false, enabled: f.canSelectAll !== false, click: () => wc.selectAll() });
      if (!sel) items.push(sep, { label: 'Check Spelling', type: 'checkbox', checked: wc.session.isSpellCheckerEnabled(),
        click: m => wc.session.setSpellCheckerEnabled(m.checked) });
      items.push(sep);
    } else if (sel) {
      items.push({ label: 'Copy', accelerator: 'Ctrl+C', registerAccelerator: false, click: () => wc.copy() });
    }
    if (sel) {
      const short = sel.length > 28 ? sel.slice(0, 28) + '…' : sel;
      const asUrl = toUrl(sel);
      if (asUrl) items.push({ label: `Go to “${short}”`, click: () => open(asUrl) });
      items.push({ label: `Search ${this.st.settings.searchEngine || 'the web'} for “${short}”`, click: () => open(this.searchUrl(sel.slice(0, 500))) },
        { label: `Define “${short}”`, visible: /^[\p{L}'’-]{2,40}( [\p{L}'’-]{2,40}){0,2}$/u.test(sel), click: () => this.withWin(this.hostOf(tab?.id) || this.cur, () => this.defineWord(sel, tab)) },
        { label: 'Copy Link to Highlight', visible: /^https?:/i.test(tab?.url || wc.getURL()), click: () => { const l = this.highlightLink(tab?.url || wc.getURL(), p.selectionText || sel); if (l) { clipboard.writeText(l); this.toast('Copied a link that scrolls to this text.'); } } },
        { label: 'Read Selection Aloud', click: () => this.withWin(this.hostOf(tab?.id) || this.cur, () => this.readAloud(tab, sel.slice(0, 50000))) },
        { label: 'Add to Notes', visible: !this.spaceById(spaceId)?.private, click: () => this.addNote({ text: sel.slice(0, 20000), url: tab?.url || wc.getURL(), title: tab?.title || wc.getTitle(), spaceId }) },
        { label: `Translate “${short}” to ${this.langName(this.translateTo)}`, click: () => this.withWin(this.hostOf(tab?.id) || this.cur, () => this.translateSelection(sel, spaceId, tab)) }, sep);
    }

    if (!p.isEditable && !sel && !p.linkURL && p.mediaType !== 'image') {
      items.push({ label: 'Select All', accelerator: 'Ctrl+A', registerAccelerator: false, click: () => wc.selectAll() }, sep);
    }
    const pageUrl = tab?.url || wc.getURL();
    // Items added by extensions (chrome.contextMenus).
    const extItems = this.extensions.contextMenuItems(wc, p);
    if (extItems.length) items.push(...extItems, sep);
    items.push(
      { label: 'Back', enabled: nav.canGoBack(), click: () => nav.goBack() },
      { label: 'Forward', enabled: nav.canGoForward(), click: () => nav.goForward() },
      { label: 'Reload', click: () => wc.reload() }, sep,
      { label: 'Save Page As…', accelerator: 'Ctrl+Shift+S', registerAccelerator: false, click: () => this.savePage(wc, tab) },
      { label: 'Print…', accelerator: 'Ctrl+P', registerAccelerator: false, click: () => this.print(wc) },
      { label: 'Save as PDF…', click: () => this.saveAsPdf(wc, tab) },
      { label: this.isReaderPage(wc.getURL()) ? 'Exit Reader Mode' : 'Open in Reader Mode', accelerator: 'F9', registerAccelerator: false, visible: !!tab && this.tabs.has(tab?.id) && (!!tab.readerable || this.isReaderPage(wc.getURL())), click: () => this.openReader(tab) },
      { label: /\.translate\.goog$/i.test(hostOf(pageUrl)) || tab?.translated ? 'Show Original' : `Translate Page to ${this.langName(this.translateTo)}`, visible: !!tab && this.tabs.has(tab?.id) && /^(https?|file):/i.test(pageUrl), click: () => this.translatePage(tab) },
      { label: 'Copy Page URL', click: () => clipboard.writeText(pageUrl) },
      { label: 'QR Code for This Page', visible: /^https?:/i.test(pageUrl), click: () => this.withWin(this.hostOf(tab?.id) || this.cur, () => this.showQr(tab && this.tabs.has(tab.id) ? tab : { url: pageUrl, title: wc.getTitle() })) },
      { label: 'Save to Read Later', visible: !!tab && this.tabs.has(tab?.id) && /^https?:/i.test(pageUrl) && !this.spaceById(spaceId)?.private, click: () => this.saveReadLater(tab) },
      { label: 'Read Page Aloud', accelerator: 'Ctrl+Shift+U', registerAccelerator: false, visible: !!tab && this.tabs.has(tab?.id) && !sel, click: () => this.withWin(this.hostOf(tab.id) || this.cur, () => this.readAloud(tab)) }, sep,
      { label: 'Hide Things on This Page (Zap)…', visible: !!tab && this.tabs.has(tab?.id) && /^https?:/i.test(pageUrl), click: () => this.startZap(tab) },
      { label: 'Dark Mode for This Site', type: 'checkbox', checked: this.darkFor(pageUrl), visible: !!tab && /^https?:/i.test(pageUrl), click: () => this.toggleSiteDark(tab) }, sep,
      { label: 'View Page Source', accelerator: 'Ctrl+U', registerAccelerator: false, click: () => this.viewSource(pageUrl, tab) },
      { label: 'Take Screenshot…', accelerator: 'Ctrl+Shift+2', registerAccelerator: false, visible: !!tab && this.tabs.has(tab?.id), click: () => { this.show(tab.id); this.startScreenshot(); } },
      { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: win });
  }

  // The window a page lives in: main window, a Little Quasar window, or a pop-up.
  windowFor(tab, wc) {
    if (tab?.kind === 'app') {
      const w = BrowserWindow.getAllWindows().find(x => x.__archApp === tab.id.slice(4) && !x.isDestroyed());
      if (w) return w;
    }
    if (tab?.kind === 'little') {
      for (const l of this.littles.values()) if (l.tab === tab && !l.win.isDestroyed()) return l.win;
    }
    if (tab && this.tabs.has(tab.id)) return (tab.host && this.wins.has(tab.host) ? tab.host.win : this.win);
    const w = wc && !wc.isDestroyed() ? BrowserWindow.fromWebContents(wc) : null;
    return w && !w.isDestroyed() ? w : this.win;
  }

  // ---------------------------------------------------------- page tools
  safeName(tab, wc, ext) {
    const base = (tab?.title || wc.getTitle() || hostOf(wc.getURL()) || 'page').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 120) || 'page';
    return path.join(app.getPath('downloads'), base + ext);
  }

  async savePage(wc = this.active?.view?.webContents, tab = this.active) {
    if (!wc || wc.isDestroyed()) return;
    const win = this.windowFor(tab, wc);
    const r = await dialog.showSaveDialog(win, {
      title: 'Save page as', defaultPath: this.safeName(tab, wc, '.html'),
      filters: [
        { name: 'Webpage, complete', extensions: ['html', 'htm'] },
        { name: 'Webpage, HTML only', extensions: ['html', 'htm'] },
        { name: 'Webpage, single file (MHTML)', extensions: ['mhtml'] },
      ],
    });
    if (r.canceled || !r.filePath) return;
    const type = /\.mhtml?$/i.test(r.filePath) ? 'MHTML' : 'HTMLComplete';
    try { await wc.savePage(r.filePath, type); this.toast(`Saved ${path.basename(r.filePath)}`, { type: 'show-file', path: r.filePath }); }
    catch (err) { this.toast(`Couldn’t save the page: ${err.message}`); }
  }

  // Windows' print dialog (choose "Microsoft Print to PDF" there to make a PDF).
  print(wc = this.active?.view?.webContents) {
    if (!wc || wc.isDestroyed()) return;
    wc.print({ silent: false, printBackground: true }, (ok, reason) => {
      if (!ok && reason && !/cancel/i.test(reason)) this.toast(`Couldn’t print: ${reason}`);
    });
  }

  async saveAsPdf(wc = this.active?.view?.webContents, tab = this.active) {
    if (!wc || wc.isDestroyed()) return;
    const win = this.windowFor(tab, wc);
    const r = await dialog.showSaveDialog(win, { title: 'Save as PDF', defaultPath: this.safeName(tab, wc, '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return;
    try {
      const data = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
      await fs.promises.writeFile(r.filePath, data);
      this.toast(`Saved ${path.basename(r.filePath)}`, { type: 'show-file', path: r.filePath });
    } catch (err) { this.toast(`Couldn’t save PDF: ${err.message}`); }
  }

  viewSource(url = this.active?.url, tab = this.active) {
    if (!url || /^view-source:/i.test(url) || this.isCertPage(url)) return;
    const spaceId = tab && this.tabs.has(tab.id) ? tab.spaceId : this.curSpaceId;
    this.newTab('view-source:' + url, { spaceId, after: tab && this.tabs.has(tab.id) ? tab.id : null });
  }

  // F11: the page fills the whole screen, no sidebar or top bar.
  toggleF11() {
    const W = this.cur;
    if (!W) return;
    W.f11 = !W.f11;
    W.win.setFullScreen(W.f11 || W.htmlFull);
    this.layout();
    this.push();
    if (W.f11) this.toast('Full screen. Press F11 to exit.');
  }

  // ------------------------------------------- page guards (all web pages)
  // Things every web page needs no matter which window it's in: the
  // right-click menu, "Leave site?" prompts and certificate warnings.
  guard(wc) {
    if (!wc || wc.__archGuarded) return;
    wc.__archGuarded = true;
    const id = wc.id;
    wc.on('context-menu', (e, p) => this.contextMenu(wc, p));
    try { this.devices.setupPage(wc); } catch { /* ignore */ }
    wc.on('will-prevent-unload', e => this.onPreventUnload(e, wc));
    wc.on('dom-ready', () => { this.applyBoosts(wc); this.protection.onDomReady(wc); this.applySiteDark(wc); });
    wc.on('render-process-gone', (e, details) => this.onCrash(wc, details));
    wc.on('unresponsive', () => this.onUnresponsive(wc));
    wc.on('responsive', () => { for (const [k, x] of this.hung) if (x === id) this.hung.delete(k); });
    wc.once('destroyed', () => this.linkClicks.delete(id));
    wc.on('did-fail-load', (e, code, desc, url, isMain) => {
      if (!isMain) return;
      if (this.onBlockedLoad(wc, url, code)) return;                                // dangerous site / no HTTPS
      if (code <= -200 && code > -300) return this.showCertError(wc, url, code, desc); // -2xx = certificate errors
      this.showFailPage(wc, url, code, desc);                                       // offline, site down, not found...
    });
    // A new page: reset its blocked-ads count.
    wc.on('did-start-navigation', (e) => {
      if (e?.isMainFrame && !e.isSameDocument) { this.protection.counts.delete(id); this.push(); }
    });
    wc.on('did-navigate', (e, url) => {
      // Always-HTTPS: the secure address worked.
      const up = this.protection.upgrades.get(id);
      if (up && /^https:/i.test(url) && hostOf(url) === hostOf(up.httpsUrl)) this.protection.upgrades.delete(id);
      if (!this.isBlockPage(url) && this.protection.blocked.has(id)) { this.protection.blocked.delete(id); this.dropCertPages(wc, null); }
      if ((!this.isFailPage(url) || this.isDriftPage(url)) && this.failInfo.has(id)) { this.failInfo.delete(id); this.dropCertPages(wc, null); }
      // Back on a real page after the crash page: tidy the crash page out of history.
      if (!this.isCrashPage(url) && this.crashInfo.has(id)) {
        const t = this.pageTabs.get(id);
        if (t) t.crashed = false;
        this.dropCertPages(wc, null);
        // The entry for the page as it was before the crash is the same page: keep one.
        try {
          const nav = wc.navigationHistory, i = nav.getActiveIndex(), all = nav.getAllEntries();
          if (i > 0 && all[i - 1].url === all[i].url) nav.removeEntryAtIndex(i - 1);
        } catch { /* ignore */ }
      }
      if (this.isCertPage(url) || !this.certErrors.has(id)) return;
      const ce = this.certErrors.get(id);
      this.certErrors.delete(id);
      this.dropCertPages(wc, ce.url);
      this.push();
    });
    wc.on('did-navigate-in-page', (e, url, isMain) => {
      if (isMain && this.isCertPage(url)) this.certPageAction(wc, new URL(url).hash.slice(1));
      if (isMain && this.isCrashPage(url)) this.crashPageAction(wc, new URL(url).hash.slice(1));
      if (isMain && this.isBlockPage(url)) this.blockPageAction(wc, new URL(url).hash.slice(1));
      if (isMain && this.isFailPage(url)) this.failPageAction(wc, new URL(url).hash.slice(1));
      if (isMain && this.isReaderPage(url)) { const a = new URL(url).hash.slice(1); if (a) this.readerAction(wc, a); }
    });
    // The reader page gets its article whenever it loads (also via Back/Forward).
    wc.on('did-finish-load', () => {
      const info = this.readerInfo?.get(id);
      if (info && this.isReaderPage(wc.getURL())) wc.executeJavaScript(`window.archReaderShow && window.archReaderShow(${JSON.stringify(info.art)})`).catch(() => {});
    });
    wc.once('destroyed', () => {
      this.certErrors.delete(id);
      this.certPending.delete(id);
      this.onPageDestroyed(id, wc);
    });
  }

  // A page has a beforeunload handler and wants to stop us leaving or closing it.
  onPreventUnload(e, wc) {
    const c = this.closing.get(wc.id);
    // Background closes (auto-archive) and a quit that was already cancelled: keep the page, don't ask.
    if (c && (c.quiet || (c.kind === 'quit' && !c.w.quitting))) { this.closing.delete(wc.id); return; }
    const tab = this.pageTabs.get(wc.id);
    if (tab && this.tabs.has(tab.id)) {
      // Show the page being asked about, in the window that has it (or the one closing).
      const W = (tab.host && this.wins.has(tab.host)) ? tab.host : (c?.w && this.wins.has(c.w) ? c.w : this.cur);
      if (W && W.activeTabId !== tab.id) this.withWin(W, () => this.show(tab.id));
    }
    const win = this.windowFor(tab, wc);
    // Bring the page's window forward (e.g. a Little Quasar window behind the main one).
    if (win && !win.isDestroyed() && win !== this.win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    const host = hostOf(tab?.url || wc.getURL());
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', title: 'Leave site?', noLink: true,
      message: 'Leave site?', detail: `Changes you made${host ? ` on ${host}` : ''} may not be saved.`,
      buttons: ['Leave', 'Cancel'], defaultId: 0, cancelId: 1,
    });
    if (choice === 0) { e.preventDefault(); return; }   // preventDefault = ignore the page and leave
    if (c) {
      this.closing.delete(wc.id);
      if (c.kind === 'quit') { c.w.quitting = false; c.w.closeAll = false; this.quittingAll = false; }
    }
  }

  // A page we asked to close (and that agreed) is gone.
  onPageDestroyed(id, wc) {
    const c = this.closing.get(id);
    if (!c) return;
    this.closing.delete(id);
    if (c.kind === 'tab') {
      this.finishClose(c.tab);
      try { c.onClosed?.(); } catch { /* ignore */ }
    } else if (c.kind === 'quit') {
      const t = c.tab;
      if (c.little) {
        // A Little Quasar page that agreed to close: its window goes with it.
        c.little.closeOk = true;
        if (!c.little.win.isDestroyed()) c.little.win.destroy();
      } else if (t.view && t.view === c.view) {
        const host = t.host && this.wins.has(t.host) ? t.host : null;
        if (host) { try { host.win.contentView.removeChildView(t.view); } catch { /* ignore */ } }
        t.view = null;   // the tab stays in the list and reloads when shown again
      }
      const W = c.w;
      if (W.quitting) { if (--W.quitLeft <= 0) this.finishWinClose(W); }
      else if (t.host && this.wins.has(t.host) && t.host.activeTabId === t.id && this.tabs.has(t.id)) this.withWin(t.host, () => this.show(t.id));
    } else if (c.kind === 'sleep') {
      // Tab sleeping: the page is gone but the tab stays in the sidebar and reloads when shown.
      const t = c.tab;
      if (t.view === c.view && this.tabs.has(t.id)) {
        t.view = null; t.sleeping = true; t.loading = false; t.audible = false;
        this.push();
      }
    } else if (c.kind === 'little') {
      c.little.closeOk = true;
      if (!c.little.win.isDestroyed()) c.little.win.close();
    }
  }

  // Closing a main window. The last window quits Quasar, so every loaded page
  // (and Little Quasar) is asked first. A private window closes its own tabs.
  // Any other window just goes away; its tabs stay in their Spaces.
  requestClose(W, { all = false } = {}) {
    if (W.quitting) return;
    W.closeAll = all;
    const last = all || [...this.wins].every(x => x === W);
    const alive = wc => wc && !wc.isDestroyed() && !wc.isCrashed() && !this.closing.has(wc.id);
    const mine = t => last || (W.private && t.spaceId === W.spaceId);
    if (!last && !W.private) return this.finishWinClose(W);
    this.persist();
    const live = [...this.tabs.values()].filter(t => mine(t) && alive(t.view?.webContents)).map(t => ({ tab: t, little: null }));
    for (const l of this.littles.values()) {
      if (!l.win.isDestroyed() && mine(l.tab) && alive(l.tab.view?.webContents)) live.push({ tab: l.tab, little: l });
    }
    if (!live.length) return this.finishWinClose(W);
    W.quitting = true;
    W.quitLeft = live.length;
    for (const { tab: t, little } of live) {
      const wc = t.view.webContents;
      this.closing.set(wc.id, { kind: 'quit', w: W, tab: t, wc, view: t.view, little });
      wc.close({ waitForBeforeUnload: true });
    }
    // Pages that don't answer (hung) are closed anyway.
    setTimeout(() => {
      if (!W.quitting) return;
      for (const c of this.closing.values()) if (c.kind === 'quit' && c.w === W && !c.wc.isDestroyed()) c.wc.close();
      setTimeout(() => { if (W.quitting) this.finishWinClose(W); }, 1500);
    }, 4000);
  }
}

module.exports = PagesPart;
