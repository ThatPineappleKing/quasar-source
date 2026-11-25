// Habits people bring from Chrome and Opera: the pop-up blocker, "Restore pages?" after a
// crash, Back/Forward history lists, Paste and go, links and files dropped on the window,
// email links, per-site sound / pop-ups / automatic downloads, quieter notification
// prompts, video speed, casting and sharing, the visual Ctrl+Tab switcher, the network
// limiter, the text-selection quick menu, reopening a closed window or a batch of tabs,
// and clearing site data when Quasar closes.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, Menu, clipboard, dialog, session, shell: eShell, WebContentsView } = require('electron');
const { UI, PRELOAD, hostOf, uid, toUrl } = require('./common');

// Web mail sites for email links (Settings › General › Email links).
const MAIL = {
  gmail: { name: 'Gmail', url: 'https://mail.google.com/mail/?extsrc=mailto&url=%s' },
  outlook: { name: 'Outlook.com', url: 'https://outlook.live.com/mail/0/deeplink/compose?mailtouri=%s' },
  yahoo: { name: 'Yahoo Mail', url: 'https://compose.mail.yahoo.com/?To=%s' },
};
// Pop-ups opened within this long after a click or key press count as wanted (Chromium's
// "transient user activation" lasts 5 seconds).
const ACTIVATION_MS = 5000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
// Per-site settings stored with the other site permissions ("partition|origin|perm").
const SITE_PERMS = { sound: 'Sound', popups: 'Pop-ups and redirects', 'automatic-downloads': 'Automatic downloads' };
// Selection quick menu: which currency and units count as "yours" (from Windows' region).
const REGION_CURRENCY = { US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CN: 'CNY', IN: 'INR', KR: 'KRW', BR: 'BRL', MX: 'MXN', CH: 'CHF',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', TR: 'TRY', ZA: 'ZAR', SG: 'SGD', HK: 'HKD', IL: 'ILS', TH: 'THB', ID: 'IDR', MY: 'MYR', PH: 'PHP' };
const EURO = new Set(['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES']);

class HabitsPart {
  // ------------------------------------------------------ user activation
  // Clicks and key presses on a page, so pop-ups and downloads it starts right
  // afterwards count as ones you asked for.
  noteInput(tab) { if (tab) tab.inputAt = Date.now(); }
  recentInput(tab, ms = ACTIVATION_MS) { return !!tab?.inputAt && Date.now() - tab.inputAt < ms; }

  sitePerm(tab, url, perm) {
    let origin = '';
    try { origin = new URL(url).origin; } catch { return undefined; }
    return this.permissions.get(`${tab?.profile || this.space.partition}|${origin}|${perm}`);
  }
  siteKey(tab, url, perm) {
    try { return `${tab?.profile || this.space.partition}|${new URL(url).origin}|${perm}`; } catch { return null; }
  }

  // --------------------------------------------------------- pop-up blocker
  // Like Chrome: a pop-up or new tab a page opens without you clicking is blocked, and
  // the address bar shows "Pop-up blocked" with the address and "Always allow".
  popupAllowed(tab, wc) {
    const page = wc && !wc.isDestroyed() ? wc.getURL() : tab?.url;
    const perm = this.sitePerm(tab, page, 'popups');
    if (perm === true) return true;
    if (perm === false) return false;
    return this.recentInput(tab);
  }

  blockPopup(tab, url) {
    if (!tab || !/^(https?|ftp|blob|data):/i.test(url || '') || /^data:/i.test(url) && url.length > 4096) return;
    tab.blockedPopups ||= [];
    if (tab.blockedPopups.length < 20 && !tab.blockedPopups.includes(url)) tab.blockedPopups.push(url);
    this.push();
    // One notice per page: the pill in the address bar stays until you leave the page.
    if (tab.popupNoticed || !this.tabs.has(tab.id)) return;
    tab.popupNoticed = true;
    if (this.hostOf(tab.id) && this.st.settings.popupToast !== false) {
      this.withWin(this.hostOf(tab.id), () => this.toast(`Pop-up blocked on ${hostOf(tab.url) || 'this page'}.`, null,
        [{ label: 'Show it', act: ['popups', 'open', tab.id, 0] }, { label: 'Always allow on this site', act: ['popups', 'allow', tab.id] }]));
    }
  }

  popupAct(op, tabId, i) {
    const tab = this.tabs.get(tabId) || this.active;
    if (!tab) return;
    const list = tab.blockedPopups || [];
    if (op === 'open') {
      const url = list[Number(i) || 0];
      if (!url) return;
      tab.blockedPopups = list.filter(u => u !== url);
      this.newTab(url, { spaceId: tab.spaceId, after: tab.id });
      return this.push();
    }
    if (op === 'allow' || op === 'block') {
      const key = this.siteKey(tab, tab.url, 'popups');
      if (!key) return;
      this.setPermission(key, op === 'allow');
      if (op === 'allow') { for (const u of list) this.newTab(u, { spaceId: tab.spaceId, after: tab.id, active: false }); tab.blockedPopups = []; this.toast(`Pop-ups from ${hostOf(tab.url)} will be allowed.`); }
      return this.push();
    }
    if (op === 'menu') {
      const host = hostOf(tab.url);
      const items = [{ label: 'Pop-ups blocked on this page:', enabled: false }];
      list.forEach((u, n) => items.push({ label: u.length > 70 ? u.slice(0, 70) + '…' : u, click: () => this.popupAct('open', tab.id, n) }));
      items.push({ type: 'separator' },
        { label: `Always allow pop-ups and redirects from ${host}`, click: () => this.popupAct('allow', tab.id) },
        { label: 'Continue blocking', click: () => { tab.blockedPopups = []; this.push(); } });
      Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(Number(i?.x) || 0), y: Math.round(Number(i?.y) || 0) });
    }
  }

  // ------------------------------------------------- restore after a crash
  // Quasar notes that it's running; a clean quit clears the note. Found at start-up,
  // it means Quasar crashed or Windows restarted, so the tabs come back (asleep).
  crashCheck() {
    const crashed = this.st.running === true;
    const planned = this.st.restoreNext === true;   // Windows signing out / an update restart
    this.st.running = true;
    delete this.st.restoreNext;
    return { crashed, planned };
  }

  crashNotice(n) {
    if (!n) return;
    const W = this.cur;
    W?.win.webContents.once('did-finish-load', () => setTimeout(() => this.withWin(W, () =>
      this.toast(`Quasar didn’t close properly. Your ${n} tab${n === 1 ? ' is' : 's are'} back (asleep until you click them).`, null,
        [{ label: 'Keep them', act: ['noop'] }, { label: 'Close them', act: ['restored:close'] }])), 1400));
  }

  closeRestoredTabs() {
    const ids = [...this.tabs.values()].filter(t => t.kind === 'today' && t.restored).map(t => t.id);
    this.closeTabs(ids);
  }

  // ---------------------------------------------------- Back/Forward lists
  // Right-click (or hold) Back or Forward: the pages you can go back or forward to.
  navMenu(dir, x, y) {
    const tab = this.active;
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const nav = wc.navigationHistory;
    const all = nav.getAllEntries(), at = nav.getActiveIndex();
    const items = [];
    const step = dir === 'forward' ? 1 : -1;
    for (let i = at + step; i >= 0 && i < all.length && items.length < 15; i += step) {
      const e = all[i];
      if (this.isArchPage(e.url) && !this.isDriftPage?.(e.url)) continue;
      const label = (e.title || hostOf(e.url) || e.url).slice(0, 70);
      items.push({ label, click: () => { try { nav.goToIndex(i); } catch { /* entry gone */ } } });
    }
    if (!items.length) return;
    items.push({ type: 'separator' }, { label: 'Show Full History', accelerator: 'Ctrl+H', registerAccelerator: false, click: () => this.openLibrary('history') });
    Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  // ---------------------------------------------------------- Paste and go
  // (clipboard.readText() returns a Promise in this Electron, so this is async.)
  async pasteLabel() {
    let text = '';
    try { text = String(await clipboard.readText() || '').trim().replace(/\s+/g, ' '); } catch { return null; }
    if (!text || text.length > 2000) return null;
    const short = text.length > 32 ? text.slice(0, 32) + '…' : text;
    return { text, label: toUrl(text) ? `Paste and Go to “${short}”` : `Paste and Search for “${short}”` };
  }

  // Right-click the address in the top bar.
  async urlMenu(x, y) {
    const W = this.cur;
    const tab = this.active;
    const paste = await this.pasteLabel();
    if (!W || W.win.isDestroyed()) return;
    const inW = fn => () => this.withWin(W, fn);
    Menu.buildFromTemplate([
      { label: paste?.label || 'Paste and Go', enabled: !!paste, click: inW(() => this.navigate(paste.text, { newTab: !tab || !this.tabs.has(tab.id) })) },
      { label: 'Edit Address', accelerator: 'Ctrl+L', registerAccelerator: false, click: inW(() => this.openCommand('url')) },
      { label: 'Copy Address', accelerator: 'Ctrl+Shift+C', registerAccelerator: false, enabled: !!tab?.url, click: inW(() => { clipboard.writeText(tab.url); this.toast('Copied URL'); }) },
      { type: 'separator' },
      { label: 'Share…', enabled: /^https?:/i.test(tab?.url || ''), click: inW(() => this.sharePage(tab)) },
      { label: 'Cast…', click: inW(() => this.castTab()) },
      { label: 'QR Code for This Page', enabled: /^https?:/i.test(tab?.url || ''), click: inW(() => this.showQr(tab)) },
    ]).popup({ window: W.win, x: Math.round(x), y: Math.round(y) });
  }

  // Right-click in the command bar's text box (Electron shows no menu of its own).
  async overlayMenu(W, wc, p) {
    const f = p.editFlags || {};
    const paste = await this.pasteLabel();
    if (wc.isDestroyed() || W.win.isDestroyed()) return;
    const sep = { type: 'separator' };
    Menu.buildFromTemplate([
      { label: 'Undo', accelerator: 'Ctrl+Z', registerAccelerator: false, enabled: f.canUndo !== false, click: () => wc.undo() }, sep,
      { label: 'Cut', accelerator: 'Ctrl+X', registerAccelerator: false, enabled: !!f.canCut, click: () => wc.cut() },
      { label: 'Copy', accelerator: 'Ctrl+C', registerAccelerator: false, enabled: !!f.canCopy, click: () => wc.copy() },
      { label: 'Paste', accelerator: 'Ctrl+V', registerAccelerator: false, enabled: f.canPaste !== false, click: () => wc.paste() },
      { label: paste?.label || 'Paste and Go', visible: ['new', 'url'].includes(W.overlayMode), enabled: !!paste, click: () => this.withWin(W, () => {
        const mode = this.overlayMode;
        this.closeCommand();
        this.navigate(paste.text, { newTab: mode !== 'url' });
      }) }, sep,
      { label: 'Select All', accelerator: 'Ctrl+A', registerAccelerator: false, click: () => wc.selectAll() },
    ]).popup({ window: W.win });
  }

  // ----------------------------------------- links and files dropped on Quasar
  // Dropped on the sidebar or top bar (a page handles drops on itself).
  openDropped(data = {}) {
    const urls = (Array.isArray(data.urls) ? data.urls : []).map(String).filter(u => u.length < 8192 && /^(https?|ftp|file):/i.test(u));
    for (const p of Array.isArray(data.paths) ? data.paths : []) {
      try { if (typeof p === 'string' && p && fs.statSync(p).isFile()) urls.push(pathToFileURL(path.resolve(p)).href); } catch { /* not a file */ }
    }
    if (!urls.length && typeof data.text === 'string' && data.text.trim()) {
      const t = data.text.trim().slice(0, 2000);
      urls.push(toUrl(t) || this.searchUrl(t));
    }
    [...new Set(urls)].slice(0, 20).forEach((u, i) => this.newTab(u, { active: i === 0, route: true }));
  }

  // ------------------------------------------------------------ email links
  mailHandler() {
    const s = this.st.settings;
    if (MAIL[s.mailto]) return { name: MAIL[s.mailto].name, url: MAIL[s.mailto].url };
    if (s.mailto === 'site' && s.mailtoSite?.url) return s.mailtoSite;
    return null;
  }

  // A page clicked a link to another app (mailto:, tel:, zoommtg:, ms-teams:…).
  // Electron asks for the 'openExternal' permission; Quasar used to refuse every one.
  async onOpenExternal(wc, details, partition, cb) {
    const url = String(details?.externalURL || '');
    let scheme = '';
    try { scheme = new URL(url).protocol.replace(/:$/, '').toLowerCase(); } catch { return cb(false); }
    if (!scheme || /^(javascript|data|file|vbscript|ms-settings|shell|search-ms|ms-msdt)$/.test(scheme)) return cb(false);
    const tab = this.pageTabs.get(wc?.id);
    // Email links: the web mail site chosen in Settings (or offered by Gmail/Outlook).
    if (scheme === 'mailto') {
      const h = this.mailHandler();
      if (h) {
        cb(false);
        return this.newTab(h.url.replace('%s', encodeURIComponent(url)), { spaceId: tab?.spaceId || this.curSpaceId, after: tab?.id || null });
      }
    }
    const origin = (() => { try { return new URL(details.requestingUrl || wc.getURL()).origin; } catch { return ''; } })();
    const key = `${partition}|${origin}|external:${scheme}`;
    if (this.permissions.has(key)) return cb(this.permissions.get(key));
    const names = { mailto: 'your email app', tel: 'an app for phone calls', 'ms-teams': 'Microsoft Teams', msteams: 'Microsoft Teams', zoommtg: 'Zoom', zoomus: 'Zoom', slack: 'Slack',
      spotify: 'Spotify', steam: 'Steam', discord: 'Discord', 'ms-word': 'Word', 'ms-excel': 'Excel', 'ms-powerpoint': 'PowerPoint', webcal: 'your calendar app', magnet: 'your torrent app' };
    const win = this.windowFor(tab, wc);
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Open', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
      message: `Open ${names[scheme] || `the app for “${scheme}:” links`}?`,
      detail: `${hostOf(origin) || 'This page'} wants to open this link in another app:\n${url.length > 140 ? url.slice(0, 140) + '…' : url}` +
        (scheme === 'mailto' ? '\n\nTo open email links in Gmail or Outlook.com instead, see Settings › General › Email links.' : ''),
      checkboxLabel: origin ? `Always allow ${hostOf(origin)} to open links of this type` : undefined, checkboxChecked: false,
    });
    if (r.response === 0 && r.checkboxChecked && origin) this.setPermission(key, true);
    cb(r.response === 0);
  }

  // A site offered to handle a kind of link (navigator.registerProtocolHandler — Gmail's
  // "Open all email links with Gmail?"). Electron ignores the call, so Quasar asks.
  onProtocolHandler(wc, scheme, url) {
    const tab = this.pageTabs.get(wc.id);
    if (!tab || !this.tabs.has(tab.id) || this.privateSpaces.has(tab.spaceId)) return;
    scheme = String(scheme || '').toLowerCase();
    if (scheme !== 'mailto') return;   // the only kind Quasar hands to web sites
    let u, page;
    try { u = new URL(String(url)); page = new URL(wc.getURL()); } catch { return; }
    if (u.protocol !== 'https:' || u.origin !== page.origin || !u.href.includes('%25s') && !String(url).includes('%s')) return;
    const handlerUrl = String(url).includes('%s') ? new URL(String(url), page.href).href.replace('%25s', '%s') : u.href.replace('%25s', '%s');
    if (this.st.settings.mailto === 'site' && this.st.settings.mailtoSite?.url === handlerUrl) return;
    const id = uid();
    (this.pendingProto ||= new Map()).set(id, { url: handlerUrl, name: hostOf(page.href) });
    this.withWin(this.hostOf(tab.id) || this.cur, () => this.toast(`Let ${hostOf(page.href)} open all email links?`, null,
      [{ label: 'Allow', act: ['protoHandler', id] }, { label: 'No thanks', act: ['noop'] }]));
  }

  acceptProtocolHandler(id) {
    const h = this.pendingProto?.get(id);
    if (!h) return;
    this.pendingProto.delete(id);
    this.st.settings.mailto = 'site';
    this.st.settings.mailtoSite = h;
    this.changed();
    this.toast(`Email links will open in ${h.name}. (Settings › General › Email links changes this.)`);
  }

  // ------------------------------------------------- notification prompts
  // Settings › Privacy › Notifications: ask (a prompt), quiet (a small notice you can
  // ignore), or don't let sites ask at all.
  quietNotificationAsk(wc, key, origin) {
    const tab = this.pageTabs.get(wc?.id);
    this.quietAsked ||= new Set();
    if (this.quietAsked.has(key)) return;
    this.quietAsked.add(key);
    const id = uid();
    (this.pendingNotify ||= new Map()).set(id, key);
    this.withWin(this.hostOf(tab?.id) || this.cur, () => this.toast(`${hostOf(origin) || 'A site'} wants to show notifications.`, null,
      [{ label: 'Allow', act: ['notify:answer', id, true] }, { label: 'Block', act: ['notify:answer', id, false] }]));
  }

  answerNotify(id, allow) {
    const key = this.pendingNotify?.get(id);
    if (!key) return;
    this.pendingNotify.delete(id);
    this.setPermission(key, !!allow);
    if (allow) this.toast('Notifications allowed. Reload the page if it doesn’t notice straight away.');
  }

  // ------------------------------------------------------------ site sound
  // Site settings › Sound › Mute: every page of that site starts muted.
  applySiteSound(tab) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const mute = this.sitePerm(tab, tab.url, 'sound') === false;
    if (mute === !!tab.siteMuted) return;
    tab.siteMuted = mute;
    wc.setAudioMuted(mute || !!tab.muted);
    this.push();
  }

  setSiteSound(tab, on) {
    const key = this.siteKey(tab, tab?.url, 'sound');
    if (!key) return;
    this.setPermission(key, on ? null : false);
    for (const t of this.tabs.values()) if (t.profile === tab.profile && hostOf(t.url) === hostOf(tab.url)) { t.siteMuted = !on; t.view?.webContents?.isDestroyed?.() === false && t.view.webContents.setAudioMuted(!on || !!t.muted); }
    this.push();
  }

  // ------------------------------------------------- automatic downloads
  // A site starting a second download on its own (no click) has to ask first, like Chrome.
  // Returns true if this download was held back.
  holdAutoDownload(item, wc) {
    const tab = wc && this.pageTabs.get(wc.id);
    if (!tab || !wc || wc.isDestroyed()) return false;
    const now = Date.now();
    const page = wc.getURL();
    const recent = (tab.dlTimes || []).filter(t => now - t < 30e3);
    tab.dlTimes = [...recent, now];
    if (!recent.length || this.recentInput(tab)) return false;   // the first one, or one you clicked
    const perm = this.sitePerm(tab, page, 'automatic-downloads');
    if (perm === true) return false;
    const url = item.getURL();
    item.cancel();
    if (perm === false) return true;
    tab.heldDownloads = [...(tab.heldDownloads || []), url].slice(-20);
    if (tab.heldDownloads.length === 1) {
      const id = uid();
      (this.pendingDl ||= new Map()).set(id, tab.id);
      this.withWin(this.hostOf(tab.id) || this.cur, () => this.toast(`${hostOf(page) || 'This site'} is trying to download several files.`, null,
        [{ label: 'Allow', act: ['autodl:answer', id, true] }, { label: 'Block', act: ['autodl:answer', id, false] }]));
    }
    return true;
  }

  answerAutoDownload(id, allow) {
    const tab = this.tabs.get(this.pendingDl?.get(id));
    this.pendingDl?.delete(id);
    if (!tab) return;
    const wc = tab.view?.webContents;
    const key = this.siteKey(tab, tab.url, 'automatic-downloads');
    if (key) this.setPermission(key, !!allow);
    const held = tab.heldDownloads || [];
    tab.heldDownloads = [];
    if (allow && wc && !wc.isDestroyed()) for (const u of held) wc.downloadURL(u);
  }

  // Site-info menu: Sound, Pop-ups and redirects, Automatic downloads.
  siteSettingItems(tab) {
    if (!/^https?:/i.test(tab?.url || '')) return [];
    const get = p => this.sitePerm(tab, tab.url, p);
    const set = (p, v) => { const k = this.siteKey(tab, tab.url, p); if (k) this.setPermission(k, v); };
    const radio = (label, checked, click) => ({ label, type: 'radio', checked, click });
    const sound = get('sound') !== false, pop = get('popups'), dl = get('automatic-downloads');
    return [
      { label: `Sound: ${sound ? 'Allowed' : 'Muted'}`, submenu: [radio('Allow', sound, () => this.setSiteSound(tab, true)), radio('Mute this site', !sound, () => this.setSiteSound(tab, false))] },
      { label: `Pop-ups and redirects: ${pop === true ? 'Allowed' : 'Blocked'}`, submenu: [radio('Allow', pop === true, () => set('popups', true)), radio('Block (default)', pop !== true, () => set('popups', null))] },
      { label: `Automatic downloads: ${dl === true ? 'Allowed' : dl === false ? 'Blocked' : 'Ask'}`, submenu: [radio('Ask (default)', dl === undefined, () => set('automatic-downloads', null)),
        radio('Allow', dl === true, () => set('automatic-downloads', true)), radio('Block', dl === false, () => set('automatic-downloads', false))] },
    ];
  }

  // ------------------------------------------------------------ video speed
  async videoSpeed(rate, tab = this.active) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const code = `(() => {
      const vids = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 || !v.paused);
      if (!vids.length) return 0;
      const cur = (vids.find(v => !v.paused) || vids[0]).playbackRate || 1;
      const r = ${JSON.stringify(rate)};
      const steps = ${JSON.stringify(SPEEDS)};
      const next = r === 'up' ? (steps.find(s => s > cur + 0.01) || steps[steps.length - 1]) : r === 'down' ? ([...steps].reverse().find(s => s < cur - 0.01) || steps[0]) : Number(r) || 1;
      for (const v of vids) { try { v.playbackRate = next; } catch (e) {} }
      return next;
    })()`;
    try {
      const r = await wc.executeJavaScript(code, true);
      if (!r) return this.toast('No video on this page.');
      tab.videoRate = r;
      this.toast(`Video speed: ${r}×`);
    } catch { /* page gone */ }
  }

  speedMenuItem(tab, p = {}) {
    if (!tab || !(tab.media?.video || p.mediaType === 'video')) return null;
    const cur = tab.videoRate || 1;
    return { label: 'Video Speed', submenu: SPEEDS.map(s => ({ label: s === 1 ? 'Normal (1×)' : `${s}×`, type: 'radio', checked: Math.abs(cur - s) < 0.01, click: () => this.videoSpeed(s, tab) })) };
  }

  // -------------------------------------------------------- cast and share
  // Electron can't talk to Chromecasts. Windows can cast the screen to Miracast TVs
  // and wireless displays (Win+K), so Quasar opens that panel.
  castTab() {
    const W = this.cur;
    this.toast('Casting uses Windows’ Cast panel (Win+K): pick your TV, then press F11 for a full-screen tab. Chromecast isn’t supported.');
    eShell.openExternal('ms-settings-connectabledevices:devicediscovery').catch(() => {
      this.withWin(W, () => this.toast('Press Win+K to open Windows’ Cast panel.'));
    });
  }

  // Windows' share panel (Nearby Share, Mail, Teams, Phone Link…) for this page's address.
  sharePage(tab = this.active) {
    if (!tab?.url || !/^https?:/i.test(tab.url)) return this.toast('Only web pages can be shared.');
    const script = path.join(__dirname, '..', 'win-share.ps1');
    const { execFile } = require('child_process');
    const win = this.windowFor(tab, tab.view?.webContents);
    const hwnd = win && !win.isDestroyed() ? win.getNativeWindowHandle().readBigUInt64LE(0) : 0;
    const b = win?.getBounds() || { x: 0, y: 0, width: 800 };
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Url', tab.url, '-Title', (tab.title || hostOf(tab.url)).slice(0, 200), '-X', String(b.x + Math.round(b.width / 2)), '-Y', String(b.y + 60), '-Parent', String(hwnd)],
    { windowsHide: true, timeout: 180e3 }, (err, out) => {
      if (err || !/Shown/.test(String(out))) {
        this.withWin(this.hostOf(tab.id) || this.cur, () => this.toast('Windows’ share panel isn’t available here. The address was copied instead.'));
        clipboard.writeText(tab.url);
      }
    });
  }

  // --------------------------------------------------- visual tab switcher
  // Ctrl+Tab (most recently used order): small pictures of the tabs while Ctrl is held.
  showSwitcher(W, c) {
    if (!W || this.st.settings.tabSwitcher === false || !c || c.ids.length < 2) return;
    if (!W.switcher) {
      const v = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
      v.setBackgroundColor('#00000000');
      v.webContents.loadFile(path.join(UI, 'switcher.html'));
      W.switcher = { view: v, ready: new Promise(r => v.webContents.once('did-finish-load', r)) };
    }
    const s = W.switcher;
    const items = c.ids.slice(0, 12).map(id => this.tabs.get(id)).filter(Boolean)
      .map(t => ({ id: t.id, title: t.title || hostOf(t.url) || 'New Tab', host: hostOf(t.url), favicon: t.favicon || '', thumb: t.thumb || '' }));
    const card = this.cardRect();
    const width = Math.min(card.width - 40, items.length * 176 + 32), height = 196;
    s.view.setBounds({ x: Math.round(card.x + (card.width - width) / 2), y: Math.round(card.y + Math.max(20, (card.height - height) / 2)), width: Math.max(200, width), height });
    try { W.win.contentView.addChildView(s.view); } catch { /* window closing */ }   // (re-adding moves it to the top)
    s.shown = true;
    s.ready.then(() => { if (s.shown && !s.view.webContents.isDestroyed()) s.view.webContents.send('switcher:show', { items, i: Math.min(c.i, items.length - 1) }); });
    clearTimeout(s.timer);
    s.timer = setTimeout(() => this.hideSwitcher(W), 8000);   // Ctrl released somewhere Quasar didn't see
  }

  hideSwitcher(W) {
    const s = W?.switcher;
    if (!s?.shown) return;
    s.shown = false;
    clearTimeout(s.timer);
    try { W.win.contentView.removeChildView(s.view); } catch { /* ignore */ }
  }

  // ------------------------------------------------------- network limiter
  // Settings › Performance › Network limit (like Opera GX): caps every Space's
  // download and upload speed. 0 = no limit.
  applyNetLimit(ses) {
    const kb = Number(this.st.settings.netLimitKB) || 0;
    const targets = ses ? [ses] : [...this.sessions];
    for (const s of targets) {
      try {
        if (kb > 0) s.enableNetworkEmulation({ latency: 0, downloadThroughput: kb * 1024, uploadThroughput: kb * 1024 });
        else if (!ses) s.disableNetworkEmulation();
      } catch { /* session gone */ }
    }
  }

  // ------------------------------------------------- selection quick menu
  // Text selected on a page: Copy, Search, Translate, and a conversion when the text
  // is a price or a measurement ("$40" → €37, "5 miles" → 8.05 km).
  homeCurrency() {
    const cc = (app.getLocaleCountryCode?.() || '').toUpperCase();
    return EURO.has(cc) ? 'EUR' : REGION_CURRENCY[cc] || 'USD';
  }

  quickConvert(text) {
    const c = require('../convert');
    const s = String(text || '').trim().replace(/\s+/g, ' ');
    if (!s || s.length > 40) return null;
    const imperial = ['US', 'LR', 'MM'].includes((app.getLocaleCountryCode?.() || '').toUpperCase());
    const home = this.homeCurrency();
    // Currency: "$40", "40 USD", "€12.50", "1,299 kr"…
    let m = s.match(/^([$€£¥₹₩₺]|[A-Z]{3}|US\$|C\$|A\$)\s?(\d[\d,.\s]*\d|\d)$/i) || s.match(/^(\d[\d,.\s]*\d|\d)\s?([$€£¥₹₩₺]|[A-Z]{3})$/i);
    if (m) {
      const sym = /^\d/.test(m[1]) ? m[2] : m[1], num = (/^\d/.test(m[1]) ? m[1] : m[2]).replace(/\s/g, '');
      const n = num.replace(/,(?=\d{3}\b)/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      const from = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₺': 'TRY', 'US$': 'USD', 'C$': 'CAD', 'A$': 'AUD' }[sym.toUpperCase()] || sym.toUpperCase();
      const to = from === home ? (home === 'USD' ? 'EUR' : 'USD') : home;
      const r = c.convert(`${n} ${from} in ${to}`);
      return r && !r.pending ? r.title : null;
    }
    // Units: number + unit.
    m = s.match(/^(-?\d[\d,]*\.?\d*)\s?(°?[a-z][a-z/ ]*|°[cf]|")$/i);
    if (!m) return null;
    const unit = m[2].toLowerCase().trim().replace(/^°/, '');
    // Only convert to the other system: metric for most of the world, US units in the US.
    const toImperial = { km: 'mi', m: 'ft', cm: 'in', mm: 'in', kg: 'lb', g: 'oz', l: 'gal', ml: 'fl oz', 'km/h': 'mph', kmh: 'mph', c: 'f', celsius: 'f' };
    const toMetric = { mi: 'km', mile: 'km', miles: 'km', ft: 'm', feet: 'm', foot: 'm', in: 'cm', inch: 'cm', inches: 'cm', '"': 'cm', yd: 'm', yards: 'm',
      lb: 'kg', lbs: 'kg', pound: 'kg', pounds: 'kg', oz: 'g', gal: 'l', gallon: 'l', gallons: 'l', mph: 'km/h', f: 'c', fahrenheit: 'c' };
    const target = (imperial ? toImperial : toMetric)[unit];
    if (!target) return null;
    const r = c.convert(`${m[1].replace(/,/g, '')} ${unit} in ${target}`);
    return r ? r.title : null;
  }

  quickAct(wc, op, text) {
    const tab = this.pageTabs.get(wc.id);
    if (!tab || typeof text !== 'string' || !this.recentInput(tab, 15000)) return;
    text = text.trim().slice(0, 2000);
    if (!text) return;
    const W = this.hostOf(tab.id) || this.cur;
    const inTabs = this.tabs.has(tab.id);
    this.withWin(W, () => {
      if (op === 'copy') return clipboard.writeText(text);
      if (op === 'search') return this.newTab(this.searchUrl(text.slice(0, 500)), { spaceId: tab.spaceId, after: inTabs ? tab.id : null });
      if (op === 'translate') return this.translateSelection(text, tab.spaceId, tab);
      if (op === 'go') { const u = toUrl(text); if (u) this.newTab(u, { spaceId: tab.spaceId, after: inTabs ? tab.id : null }); }
    });
  }

  // ----------------------------------------- closed windows and tab batches
  rememberClosedWindow(W) {
    if (W.private) return;
    this.closedWins ||= [];
    this.closedWins.push({ spaceId: W.spaceId, tabId: W.activeTabId, info: this.winInfo(W) });
    if (this.closedWins.length > 10) this.closedWins.shift();
  }

  reopenClosedWindow() {
    const c = this.closedWins?.pop();
    if (!c) return this.toast('No recently closed windows.');
    const W = this.createWindow({ spaceId: this.spaceById(c.spaceId) ? c.spaceId : this.curSpaceId, restore: true, bounds: c.info.bounds, maximized: c.info.maximized });
    this.cur = W;
    this.withWin(W, () => {
      this.switchSpace(W.spaceId);
      if (c.tabId && this.tabs.has(c.tabId) && !this.shownElsewhere(c.tabId)) this.show(c.tabId);
    });
  }

  // Close Other Tabs / Close Tabs Below / tidy: one Undo brings them all back.
  closeBatch(ids) {
    ids = [...new Set(ids)].filter(id => this.tabs.get(id)?.kind === 'today');
    if (ids.length < 2) return false;
    const batch = uid();
    for (const id of ids) this.tabs.get(id).closeBatch = batch;
    this.toast(`Closed ${ids.length} tabs.`, null, [{ label: 'Undo', act: ['reopenBatch', batch] }]);
    return batch;
  }

  reopenBatch(batch) {
    const items = this.closed.filter(c => c.batch === batch);
    if (!items.length) return;
    this.closed = this.closed.filter(c => c.batch !== batch);
    items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    items.forEach((c, i) => {
      const t = this.newTab(c.url, { spaceId: this.spaceById(c.spaceId) ? c.spaceId : this.curSpaceId, active: i === items.length - 1 });
      const list = this.order[t.spaceId];
      if (list && Number.isInteger(c.index)) { list.splice(list.indexOf(t.id), 1); list.splice(Math.min(c.index, list.length), 0, t.id); }
    });
    this.changed();
  }

  // ------------------------------------------- clear site data on exit
  // Settings › Privacy › Delete cookies and site data when Quasar closes. Runs from
  // app 'will-quit' (main.js) so it finishes before Quasar exits. Passwords, history,
  // pinned tabs and Favorites are kept; only what sites stored is removed.
  async clearSiteDataOnExit() {
    if (!this.st.settings.clearOnExit) return;
    const parts = new Set((this.st.profiles || []).map(p => p.partition));
    const jobs = [...parts].map(p => {
      const ses = session.fromPartition('persist:' + p);
      return Promise.all([
        ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'] }),
        ses.clearCache(),
      ]).catch(() => {});
    });
    await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 6000))]);
  }

  // ------------------------------------------------------ DRM (Widevine)
  // A page asked for Widevine and this copy of the engine doesn't have it.
  onDrmMissing(wc) {
    const tab = this.pageTabs.get(wc.id);
    const host = hostOf(wc.getURL());
    this.drmNoted ||= new Set();
    if (!host || this.drmNoted.has(host) || this.widevineReady) return;
    this.drmNoted.add(host);
    this.withWin(this.hostOf(tab?.id) || this.cur, () => this.toast(`${host} uses Widevine copy protection, which this build of Quasar doesn’t include, so its videos won’t play here. (README › Streaming sites)`));
  }

  // Command bar entries for the things above.
  habitActions() {
    return [
      { id: 'reopen-window', title: 'Reopen closed window', icon: 'windows' },
      { id: 'clear-data', title: 'Clear browsing data…', icon: 'close', badge: 'Ctrl+Shift+Del' },
      { id: 'cast', title: 'Cast… (Windows’ Cast panel, Win+K)', icon: 'monitor' },
      { id: 'share', title: 'Share this page…', icon: 'upload' },
      { id: 'speed-up', title: 'Video faster', icon: 'playpause' },
      { id: 'speed-down', title: 'Video slower', icon: 'playpause' },
      { id: 'speed-normal', title: 'Video at normal speed', icon: 'playpause' },
      { id: 'popups-allow', title: 'Always allow pop-ups on this site', icon: 'sliders' },
    ];
  }

  habitAction(id) {
    switch (id) {
      case 'reopen-window': return this.reopenClosedWindow() ?? true;
      case 'clear-data': return this.clearBrowsingData() ?? true;
      case 'cast': return this.castTab() ?? true;
      case 'share': return this.sharePage() ?? true;
      case 'speed-up': return this.videoSpeed('up') ?? true;
      case 'speed-down': return this.videoSpeed('down') ?? true;
      case 'speed-normal': return this.videoSpeed(1) ?? true;
      case 'popups-allow': return this.active ? this.popupAct('allow', this.active.id) ?? true : true;
    }
    return false;
  }
}

HabitsPart.SITE_PERMS = SITE_PERMS;
HabitsPart.MAIL = MAIL;
module.exports = HabitsPart;
