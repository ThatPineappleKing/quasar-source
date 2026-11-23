// Sites installed as apps (like Chrome's "Install page as app"): a Start menu (and
// optionally desktop) shortcut with the site's icon that opens the site in its own
// window with its own taskbar button, without the sidebar. It uses the Space it was
// installed from, so it's signed in the same way.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, dialog, nativeImage, shell: eShell } = require('electron');
const { ICON, uid, hostOf } = require('./common');
const { siteOf } = require('../protection');

// An .ico file can simply hold a PNG (Windows Vista and later).
function pngToIco(png) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(0, 6); head.writeUInt8(0, 7);   // 0 = 256 px
  head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

class AppsPart {
  get apps() { return (this.st.apps ||= []); }
  appsDir() { return path.join(app.getPath('userData'), 'apps'); }
  // Tests never touch the real Start menu or desktop.
  shortcutDir(where) {
    if (process.env.ARCH_USER_DATA) return path.join(app.getPath('userData'), 'test-shortcuts', where);
    return where === 'desktop' ? app.getPath('desktop') : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Quasar Apps');
  }

  async installApp(tab = this.active, { desktop = null } = {}) {
    if (!tab?.url || !/^https?:/i.test(tab.url) || this.privateSpaces.has(tab.spaceId)) return this.toast('Open the site you want to install first (not in a private window).');
    const name = String(tab.title || hostOf(tab.url)).replace(/\s*[|–—-]\s*[^|–—-]*$/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || hostOf(tab.url);
    if (desktop === null) {
      const { response, checkboxChecked } = await dialog.showMessageBox(this.win, {
        type: 'question', buttons: ['Install', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
        message: `Install “${name}” as an app?`,
        detail: `It opens in its own window with its own taskbar button, without the sidebar, signed in as in this Space. A shortcut goes in the Start menu (Quasar Apps).`,
        checkboxLabel: 'Also put a shortcut on the desktop', checkboxChecked: false,
      });
      if (response !== 0) return null;
      desktop = checkboxChecked;
    }
    const id = uid();
    const start = (() => { try { const u = new URL(tab.url); return u.origin + u.pathname; } catch { return tab.url; } })();
    fs.mkdirSync(this.appsDir(), { recursive: true });
    // The site's icon (its favicon, made big enough), or Quasar's.
    let ico = ICON;
    try {
      const res = tab.favicon && await tab.view?.webContents.session.fetch(tab.favicon);
      let img = res?.ok ? nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())) : null;
      if (img && !img.isEmpty()) {
        img = img.resize({ width: 256, height: 256, quality: 'best' });
        ico = path.join(this.appsDir(), id + '.ico');
        fs.writeFileSync(ico, pngToIco(img.toPNG()));
      }
    } catch { ico = ICON; }
    const a = { id, name, url: start, spaceId: tab.spaceId, icon: ico, installedAt: Date.now(), shortcuts: [] };
    const { launchCommand } = require('../windows-integration');
    const { target, args } = launchCommand();
    for (const where of desktop ? ['start', 'desktop'] : ['start']) {
      const dir = this.shortcutDir(where);
      fs.mkdirSync(dir, { recursive: true });
      const lnk = path.join(dir, `${name}.lnk`);
      const ok = eShell.writeShortcutLink(lnk, 'create', { target, args: `${args} --arch-app=${id}`.trim(), cwd: app.getAppPath(), icon: ico, iconIndex: 0, appUserModelId: `Quasar.App.${id}`, description: `${name} (Quasar app)` });
      if (ok) a.shortcuts.push(lnk);
    }
    this.apps.push(a);
    this.persist();
    this.toast(`Installed ${name}. Find it in the Start menu${desktop ? ' and on the desktop' : ''}.`);
    this.openApp(id);
    return id;
  }

  uninstallApp(id) {
    const a = this.apps.find(x => x.id === id);
    if (!a) return;
    for (const f of a.shortcuts || []) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
    if (a.icon && a.icon !== ICON) { try { fs.rmSync(a.icon, { force: true }); } catch { /* ignore */ } }
    this.st.apps = this.apps.filter(x => x !== a);
    for (const w of BrowserWindow.getAllWindows()) if (w.__archApp === id) w.close();
    this.persist();
    this.toast(`Uninstalled ${a.name}.`);
  }

  // An installed app's own window.
  openApp(id) {
    const a = this.apps.find(x => x.id === id);
    if (!a) return this.toast('That app isn’t installed any more.');
    const open = BrowserWindow.getAllWindows().find(w => w.__archApp === id && !w.isDestroyed());
    if (open) { if (open.isMinimized()) open.restore(); return open.focus(); }
    const sp = this.spaceById(a.spaceId) || this.st.spaces[0];
    const win = new BrowserWindow({ width: 1100, height: 760, minWidth: 360, minHeight: 300, title: a.name, icon: fs.existsSync(a.icon) ? a.icon : ICON, autoHideMenuBar: true, backgroundColor: '#ffffff', show: false });
    win.__archApp = id;
    win.setMenu(null);
    try {
      const { launchCommand } = require('../windows-integration');
      const { target, args } = launchCommand();
      win.setAppDetails({ appId: `Quasar.App.${id}`, appIconPath: fs.existsSync(a.icon) ? a.icon : ICON, appIconIndex: 0, relaunchCommand: `"${target}" ${args} --arch-app=${id}`.trim(), relaunchDisplayName: a.name });
    } catch { /* ignore */ }
    const tab = { id: 'app-' + id, spaceId: sp.id, kind: 'app', url: a.url, title: a.name, favicon: '', view: null, profile: null, lastActive: Date.now() };
    const view = this.pageView(tab, { white: false, rounded: false });
    win.contentView.addChildView(view);
    const fit = () => { const [w, h] = win.getContentSize(); view.setBounds({ x: 0, y: 0, width: w, height: h }); };
    fit(); win.on('resize', fit);
    const wc = view.webContents;
    wc.on('page-title-updated', (e, t) => { if (!win.isDestroyed()) win.setTitle(t ? `${t}` : a.name); });
    const site = siteOf(hostOf(a.url));
    // Links to other sites open as tabs in the main window.
    const outside = u => /^https?:/i.test(u) && siteOf(hostOf(u)) !== site;
    wc.on('will-navigate', e => { if (outside(e.url)) { e.preventDefault(); this.withWin(this.normalWin(), () => this.newTab(e.url, { spaceId: sp.id, route: true })); } });
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (disposition === 'new-window' && features) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true } };
      if (outside(url) || disposition !== 'foreground-tab') { const W = this.normalWin(); W.win.focus(); this.withWin(W, () => this.newTab(url, { spaceId: sp.id, route: true })); }
      else wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const k = input.key.toLowerCase();
      if ((input.control && k === 'r') || k === 'f5') { e.preventDefault(); wc.reload(); }
      else if (input.alt && k === 'arrowleft') { e.preventDefault(); wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack(); }
      else if (input.alt && k === 'arrowright') { e.preventDefault(); wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward(); }
      else if (input.control && k === 'w') { e.preventDefault(); win.close(); }
      else if (k === 'f12') wc.toggleDevTools();
    });
    win.once('ready-to-show', () => win.show());
    win.loadURL('about:blank');
    Promise.resolve(wc.session.__archProxyReady).then(() => !wc.isDestroyed() && wc.loadURL(a.url).catch(() => {}));
    win.on('closed', () => { if (!wc.isDestroyed()) wc.close(); });
    return win;
  }

  appMenuItems(wc) {
    const tab = this.pageTabs.get(wc.id);
    if (tab?.kind !== 'app') return [];
    const id = tab.id.slice(4);
    return [
      { label: 'Open in Quasar', click: () => { const W = this.normalWin(); W.win.focus(); this.withWin(W, () => this.newTab(wc.getURL(), { spaceId: tab.spaceId })); } },
      { label: 'Uninstall This App…', click: async () => {
        const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(wc) || undefined, { type: 'question', buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, message: `Uninstall ${this.apps.find(a => a.id === id)?.name || 'this app'}?`, detail: 'Its shortcuts are removed. Your sign-ins stay in the Space.' });
        if (response === 0) this.uninstallApp(id);
      } },
      { type: 'separator' },
    ];
  }
}

module.exports = AppsPart;
module.exports.pngToIco = pngToIco;
