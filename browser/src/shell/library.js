// The Library window (History, Downloads, Site settings, Boosts, Extensions, Shortcuts, Backup, Updates) and default browser.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app, WebContentsView, session, dialog, shell: eShell } = require('electron');
const { registerBrowser, isDefaultBrowser } = require('../windows-integration');
const { UI, PRELOAD, RADIUS, uid, hostOf } = require('./common');

class LibraryPart {
  // ------------------------------------------------------- in-app pages
  // Library and Passwords open inside the main window, in the page area (like
  // Arc), not as separate windows. Clicking a tab or switching Space closes them.
  // `this.libWin` / `this.pwWin` are small stand-ins that keep the window-like
  // API the rest of the code uses (webContents, isDestroyed, focus, close).
  openInApp(kind, file, setup) {
    const W = this.cur;
    if (W.inapp?.kind === kind && !W.inapp.view.webContents.isDestroyed()) { this.attachInApp(W); return W.inapp.facade; }
    this.closeInApp(W);
    const view = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
    view.setBackgroundColor(this.space.colors[0]);
    if (view.setBorderRadius) view.setBorderRadius(this.radiusPx());
    const facade = {
      kind, view, W, webContents: view.webContents,
      isDestroyed: () => view.webContents.isDestroyed(),
      isMinimized: () => false, restore() {},
      focus: () => { this.attachInApp(W); },
      close: () => this.closeInApp(W),
    };
    W.inapp = { kind, view, facade };
    view.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.control && !input.shift && input.key.toLowerCase() === 'w') { e.preventDefault(); return this.closeInApp(W); }
      this.withWin(W, () => this.onKey(e, input));   // Ctrl+T, Ctrl+L, Ctrl+1–9 … still work here
    });
    setup?.(facade);
    view.webContents.loadFile(path.join(UI, file));
    this.attachInApp(W);
    return facade;
  }

  attachInApp(W = this.cur) {
    const ia = W?.inapp;
    if (!ia || ia.view.webContents.isDestroyed()) return;
    this.withWin(W, () => {
      this.win.contentView.addChildView(ia.view);
      this.restack();
      this.layout();
      this.push();
    });
    ia.view.webContents.focus();
  }

  closeInApp(W = this.cur) {
    const ia = W?.inapp;
    if (!ia) return;
    W.inapp = null;
    try { W.win.contentView.removeChildView(ia.view); } catch { /* window gone */ }
    try { if (!ia.view.webContents.isDestroyed()) ia.view.webContents.close(); } catch { /* ignore */ }
    if (this.libWin === ia.facade) this.libWin = null;
    if (this.pwWin === ia.facade) this.pwWin = null;
    this.withWin(W, () => {
      this.push();
      const wc = this.active?.view?.webContents;
      if (wc && !wc.isDestroyed()) wc.focus();
    });
  }

  // ------------------------------------------------------------- Library
  // History, Downloads, Site settings, Boosts, Extensions… (Ctrl+H, Ctrl+J).
  openLibrary(section = 'history', prefill = null) {
    const spaceId = this.isPrivate ? this.st.activeSpaceId : this.curSpaceId;
    if (this.libWin && !this.libWin.isDestroyed() && this.libWin.W === this.cur) {
      this.libWin.webContents.send('lib:show', { section, spaceId, prefill });
      return this.libWin.focus();
    }
    if (this.libWin) this.libWin.close();   // open in another window: move it here
    this.libWin = this.openInApp('library', 'library.html', f => { f.libStart = { section, spaceId, prefill }; });
  }

  libUpdate() {
    if (!this.libWin || this.libWin.isDestroyed()) return;
    clearTimeout(this.libTimer);
    this.libTimer = setTimeout(() => this.libWin && !this.libWin.isDestroyed() && this.libWin.webContents.send('lib:update'), 120);
  }

  // A normal window to open Library links in (never a private one).
  normalWin() {
    if (this.cur && !this.cur.private) return this.cur;
    return [...this.wins].find(W => !W.private) || this.createWindow({ spaceId: this.st.activeSpaceId });
  }

  async libAct(name, args) {
    const spaceArg = id => this.st.spaces.find(s => s.id === id) || null;
    switch (name) {
      case 'lib:close': return this.closeInApp(this.libWin?.W);
      case 'lib:init': {
        const start = this.libWin.libStart || {};
        const sp = spaceArg(start.spaceId) || this.st.spaces[0];
        return { section: start.section || 'history', spaceId: sp.id, prefill: start.prefill || null,
          spaces: this.st.spaces.map(s => ({ id: s.id, name: s.name, emoji: s.emoji || '', colors: s.colors, grain: s.grain })) };
      }
      case 'lib:spaces': return this.st.spaces.map(s => ({ id: s.id, name: s.name, emoji: s.emoji || '', colors: s.colors, grain: s.grain }));
      // Boosts and Air Traffic Control rules
      case 'lib:boosts': return this.st.boosts;
      case 'lib:saveBoost': {
        const b = args[0] || {};
        const clean = { id: typeof b.id === 'string' && b.id ? b.id : uid(), name: String(b.name || '').slice(0, 80), pattern: String(b.pattern || '').trim().slice(0, 300),
          css: String(b.css || '').slice(0, 200000), js: String(b.js || '').slice(0, 200000), enabled: b.enabled !== false,
          spaceId: this.st.spaces.some(s => s.id === b.spaceId) ? b.spaceId : null };
        const i = this.st.boosts.findIndex(x => x.id === clean.id);
        if (i >= 0) this.st.boosts[i] = clean; else this.st.boosts.unshift(clean);
        this.persist();
        this.reapplyBoosts();
        return clean;
      }
      case 'lib:deleteBoost': this.st.boosts = this.st.boosts.filter(b => b.id !== args[0]); this.persist(); this.reapplyBoosts(); return true;
      case 'lib:reloadMatching': {   // JavaScript changes need a reload
        const b = this.st.boosts.find(x => x.id === args[0]);
        if (!b) return 0;
        let n = 0;
        for (const t of this.tabs.values()) if (t.view?.webContents && !t.view.webContents.isDestroyed() && this.ruleMatches(b.pattern, t.url)) { t.view.webContents.reload(); n++; }
        return n;
      }
      case 'lib:atc': return this.st.atc;
      case 'lib:saveAtc': {
        const r = args[0] || {};
        const clean = { id: typeof r.id === 'string' && r.id ? r.id : uid(), pattern: String(r.pattern || '').trim().slice(0, 300),
          spaceId: this.st.spaces.some(s => s.id === r.spaceId) ? r.spaceId : this.st.spaces[0].id, enabled: r.enabled !== false };
        const i = this.st.atc.findIndex(x => x.id === clean.id);
        if (i >= 0) this.st.atc[i] = clean; else this.st.atc.push(clean);
        this.persist();
        return clean;
      }
      case 'lib:deleteAtc': this.st.atc = this.st.atc.filter(r => r.id !== args[0]); this.persist(); return true;
      case 'lib:testRule': return { matches: this.ruleMatches(String(args[0] || ''), String(args[1] || '')) };
      case 'lib:history': {
        const sp = spaceArg(args[0]);
        if (!sp) return [];
        const q = String(args[1] || '').trim().toLowerCase();
        return (sp.history || [])
          .filter(h => !q || (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
          .sort((a, b) => (b.last || 0) - (a.last || 0))
          .slice(0, 2000)
          .map(h => ({ url: h.url, title: h.title, last: h.last || 0, visits: h.visits || 0 }));
      }
      case 'lib:deleteHistory': {
        const sp = spaceArg(args[0]);
        const urls = new Set((Array.isArray(args[1]) ? args[1] : []).map(String));
        if (sp) sp.history = (sp.history || []).filter(h => !urls.has(h.url));
        this.persist();
        return true;
      }
      case 'lib:clearHistory': {
        const sp = spaceArg(args[0]);
        if (!sp) return false;
        const { response } = await dialog.showMessageBox(this.win, {
          type: 'warning', buttons: ['Clear history', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          message: `Clear all history for ${`${sp.emoji || ''} ${sp.name}`.trim()}?`,
          detail: 'Cookies, logins and other Spaces aren’t affected.',
        });
        if (response !== 0) return false;
        sp.history = [];
        this.dropHistoryText(sp.partition);
        this.persist();
        return true;
      }
      case 'lib:open': {
        const sp = spaceArg(args[0]);
        const url = String(args[1] || '');
        if (!sp || !/^(https?|file):/i.test(url)) return;
        const W = this.normalWin();
        W.win.focus();
        return this.withWin(W, () => { this.cur = W; this.newTab(url, { spaceId: sp.id }); });
      }
      case 'lib:downloads': return this.st.downloads.filter(d => !d.private).map(d => ({ ...d, resume: undefined, canResume: !!this.liveDownloads.get(d.id)?.canResume(),
        resumable: this.canResumeLater(d), exists: d.state === 'completed' ? fs.existsSync(d.path) : true }));
      case 'lib:dl': return this.downloadAct(String(args[0]), String(args[1]));
      case 'lib:clearDownloads': this.st.downloads = this.st.downloads.filter(d => this.liveDownloads.has(d.id) || this.canResumeLater(d)); this.downloadsChanged(true); return true;
      case 'lib:sites': return this.siteList(spaceArg(args[0]));
      case 'lib:setPerm': {
        const key = String(args[0] || '');
        if (!/^[^|]+\|[^|]+\|[^|]+$/.test(key)) return false;
        this.setPermission(key, args[1] === null ? null : !!args[1]);
        return true;
      }
      case 'lib:resetZoom': {
        const sp = spaceArg(args[0]);
        const host = String(args[1] || '');
        if (sp && this.st.zoom[sp.partition]) { delete this.st.zoom[sp.partition][host]; this.persist(); }
        for (const t of this.tabs.values()) if (t.profile === sp?.partition && this.zoomKey(t) === host) this.applyZoom(t);
        this.libUpdate(); this.push();
        return true;
      }
      case 'lib:clearSite': {
        const sp = spaceArg(args[0]);
        let origin;
        try { origin = new URL(String(args[1])).origin; } catch { return false; }
        if (!sp) return false;
        const fake = { profile: sp.partition, spaceId: sp.id, view: null };
        await this.clearSiteData(fake, origin, new URL(origin).hostname, this.win);
        return true;
      }
      // ---- extensions
      case 'lib:extensions': return this.extensions.list.map(e => this.extensions.info(e));
      case 'lib:extInstallStore': return this.extensions.installFromStore(String(args[0] || ''), { confirm: (m, l) => this.confirmExtension(m, l) }).catch(err => ({ error: err.message }));
      case 'lib:extInstallFile': {
        const r = await dialog.showOpenDialog(this.win, { title: 'Install a Chrome extension (.crx)', filters: [{ name: 'Chrome extension', extensions: ['crx', 'zip'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths[0]) return null;
        return this.extensions.installCrxFile(r.filePaths[0], { confirm: (m, l) => this.confirmExtension(m, l) }).catch(err => ({ error: err.message }));
      }
      case 'lib:extInstallFolder': {
        const r = await dialog.showOpenDialog(this.win, { title: 'Load an unpacked extension (folder with manifest.json)', properties: ['openDirectory'] });
        if (r.canceled || !r.filePaths[0]) return null;
        return this.extensions.installFolder(r.filePaths[0], { confirm: (m, l) => this.confirmExtension(m, l) }).catch(err => ({ error: err.message }));
      }
      // Per-Space switches: one per profile (Spaces on one profile share a session).
      case 'lib:extProfiles': return this.st.profiles.filter(p => this.spacesOnProfile(p.id).length).map(p => ({
        partition: p.partition, label: this.spacesOnProfile(p.id).map(s => `${s.emoji || ''} ${s.name}`.trim()).join(', ') }));
      case 'lib:extSpace': return this.extensions.setSpaceEnabled(String(args[0]), String(args[1]), !!args[2]);
      // ---- keyboard shortcuts
      case 'lib:shortcuts': return this.shortcutList();
      case 'lib:setShortcut': return this.setShortcut(String(args[0]), args[1] === null ? null : args[1]);
      case 'lib:resetShortcuts': delete this.st.settings.shortcuts; this.persist(); return true;
      case 'lib:forgetDevice': this.devices.forget(String(args[0] || '')); this.libUpdate(); return true;
      // ---- updates for Quasar's components (npm packages)
      case 'lib:updates': return { engine: this.updater.status(), chromium: process.versions.chrome, components: { ...this.components.status(), installed: this.installed } };
      case 'lib:cmpCheck': try { await this.components.check(); } catch { /* shown as not checked */ } return true;
      case 'lib:cmpUpdate': return this.components.update();
      case 'lib:cmpUndo': return this.components.rollback();
      case 'lib:extArc': return this.extensions.arcExtensions();
      case 'lib:extImportArc': return this.extensions.importFromArc(Array.isArray(args[0]) ? args[0].map(String) : []);
      case 'lib:extUpdate': return this.extensions.updateAll();
      case 'lib:ext': {
        const [op, id] = args.map(String);
        const e = this.extensions.list.find(x => x.id === id);
        if (!e) return false;
        if (op === 'enable' || op === 'disable') return this.extensions.setEnabled(id, op === 'enable');
        if (op === 'reload') return this.extensions.reload(id);
        if (op === 'options') { const page = this.extensions.info(e).options; const W = this.normalWin(); W.win.focus(); return page && this.withWin(W, () => { this.cur = W; this.newTab(`chrome-extension://${id}/${page.replace(/^\//, '')}`); }); }
        if (op === 'remove') {
          const { response } = await dialog.showMessageBox(this.win, { type: 'question', buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, message: `Remove “${this.extensions.info(e).name}”?`, detail: 'Its settings and data in Quasar are deleted too.' });
          if (response === 0) this.extensions.remove(id);
          return true;
        }
        return false;
      }
      // ---- backup & sync
      case 'lib:backupStatus': return this.backup.status();
      case 'lib:backup': {
        const o = args[0] || {};
        const r = await dialog.showSaveDialog(this.win, { title: 'Save Quasar backup', defaultPath: path.join(app.getPath('documents'), `Quasar backup ${new Date().toISOString().slice(0, 10)}.archbackup`), filters: [{ name: 'Quasar backup', extensions: ['archbackup'] }] });
        if (r.canceled || !r.filePath) return null;
        try { return { file: this.backup.writeBackup(r.filePath, { history: o.history !== false, secrets: !!o.secrets, pass: String(o.pass || '') }) }; }
        catch (err) { return { error: err.message }; }
      }
      case 'lib:restorePick': {
        const r = await dialog.showOpenDialog(this.win, { title: 'Restore a backup', filters: [{ name: 'Quasar or Arc+Chrome backup', extensions: ['archbackup', 'json'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths[0]) return null;
        try {
          const { encrypted, raw } = this.backup.readFile(r.filePaths[0]);
          return { file: r.filePaths[0], name: path.basename(r.filePaths[0]), encrypted, summary: encrypted ? '' : this.backup.summarize(this.backup.unpack(raw)) };
        } catch (err) { return { file: null, error: err.message, summary: `Can’t read it: ${err.message}` }; }
      }
      case 'lib:restore': {
        const o = args[0] || {};
        try {
          const { raw } = this.backup.readFile(String(o.file));
          const d = this.backup.unpack(raw, String(o.pass || ''));
          if (o.mode === 'replace') {
            const { response } = await dialog.showMessageBox(this.win, { type: 'warning', buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
              message: 'Replace your Spaces and settings with this backup?', detail: `${this.backup.summarize(d)}\n\nSpaces that aren’t in the backup are closed and removed from the sidebar.` });
            if (response !== 0) return { summary: 'Cancelled.' };
          }
          return { summary: this.backup.restore(d, o.mode === 'replace' ? 'replace' : 'merge') };
        } catch (err) { return { error: err.message }; }
      }
      case 'lib:autoBackup': this.st.settings.autoBackup = !!args[0]; this.persist(); if (args[0]) this.backup.autoBackup(true); return true;
      case 'lib:syncPickFolder': {
        const r = await dialog.showOpenDialog(this.win, { title: 'Choose a folder your PCs share (OneDrive, Dropbox, Google Drive…)', properties: ['openDirectory', 'createDirectory'] });
        return r.canceled ? null : r.filePaths[0];
      }
      case 'lib:syncOn': { const o = args[0] || {}; try { return await this.backup.enable({ folder: String(o.folder || ''), pass: String(o.pass || ''), device: String(o.device || '') }); } catch (err) { return { error: err.message }; } }
      case 'lib:syncNow': return this.backup.syncNow();
      case 'lib:syncOff': this.backup.disable(); return true;
      case 'lib:defaultStatus': return { isDefault: await isDefaultBrowser() };
      case 'lib:makeDefault': return this.makeDefaultBrowser();
    }
  }

  // Before installing an extension that uses features Quasar doesn't have.
  async confirmExtension(m, limits) {
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning', buttons: ['Install anyway', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      message: `“${m.name}” may not work in Quasar`,
      detail: `It uses features Quasar can’t provide yet:\n• ${limits.join('\n• ')}\n\nThe parts that need them won’t work (an ad blocker built on blocking rules won’t block anything, for example). Quasar has its own ad and tracker blocking in Settings.`,
    });
    return response === 0;
  }

  // Every site this Space has a setting for: permissions and zoom.
  siteList(sp) {
    if (!sp) return [];
    const sites = new Map();
    const get = origin => { if (!sites.has(origin)) sites.set(origin, { origin, host: hostOf(origin) || origin, perms: [], zoom: null }); return sites.get(origin); };
    const prefix = sp.partition + '|';
    for (const [k, v] of this.permissions) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const i = rest.lastIndexOf('|');
      get(rest.slice(0, i)).perms.push({ key: k, perm: rest.slice(i + 1), allowed: v });
    }
    for (const [host, f] of Object.entries(this.st.zoom[sp.partition] || {})) {
      const existing = [...sites.values()].find(s => { try { return new URL(s.origin).hostname === host; } catch { return false; } });
      (existing || get('https://' + host)).zoom = { host, pct: Math.round(f * 100) };
    }
    // USB / serial / HID devices the site was given.
    for (const d of this.devices.siteDevices(sp.partition)) (get(d.origin).devices ||= []).push({ key: d.key, label: d.label });
    return [...sites.values()].sort((a, b) => a.host.localeCompare(b.host));
  }

  // ------------------------------------------------------ default browser
  async makeDefaultBrowser() {
    try {
      await registerBrowser();
    } catch (err) {
      return dialog.showMessageBox(this.win || undefined, { type: 'error', message: 'Couldn’t register Quasar as a browser.', detail: err.message });
    }
    // Windows only lets the user pick the default browser themselves, in Settings.
    await eShell.openExternal('ms-settings:defaultapps?registeredAppUser=Quasar');
    const where = this.win && !this.win.isDestroyed() ? this.win : undefined;
    dialog.showMessageBox(where, {
      type: 'info', buttons: ['OK'], noLink: true,
      message: 'Choose Quasar in the Settings window that just opened.',
      detail: 'Under “Set default”, click Set default for Quasar, or pick Quasar for HTTP and HTTPS. Links from other apps will then open in Quasar.',
    });
    return true;
  }
}

module.exports = LibraryPart;
