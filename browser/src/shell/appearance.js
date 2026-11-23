// Customisation: top bar, sidebar, new tab page and global appearance.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
//
// Every option is a key in st.settings, checked against SCHEMA before it's saved,
// so a bad value (or a hand-edited / imported theme file) can never break the window.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, dialog, Menu, net, screen, desktopCapturer } = require('electron');
const { UI, PRELOAD, TOP, uid, hostOf, toUrl, pinnedTabNodes } = require('./common');
const store = require('../store');

// Buttons the top bar can show, in Settings › Top bar (status pills such as Update,
// VPN, ad blocking and zoom stay next to the address bar, like Vivaldi's address field).
const TB_ITEMS = ['back', 'forward', 'reload', 'home', 'newTab', 'copyUrl', 'ext', 'profile', 'little'];
const TB_DEFAULT = { left: ['back', 'forward', 'reload'], right: ['ext', 'copyUrl'] };
const TOP_H = { compact: 34, normal: TOP, tall: 54 };
const STRIP_H = { compact: 38, normal: 44, comfortable: 50 };   // sidebar on top: height of the tab strip
const COLLAPSED_W = 60;                                         // icon-only sidebar
const NT_WIDGETS = ['clock', 'date', 'greeting', 'links', 'weather', 'todo', 'notes', 'closed'];
const SB_SECTIONS = ['favorites', 'pinned', 'folders', 'downloads', 'history'];

const bool = v => !!v;
const oneOf = (...xs) => v => (xs.includes(v) ? v : undefined);
const hex = v => (v === '' || v == null ? '' : /^#[0-9a-f]{6}$/i.test(v) ? String(v).toLowerCase() : undefined);
const range = (lo, hi, step = 0) => v => {
  let n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  n = Math.max(lo, Math.min(hi, n));
  return step ? Number((Math.round(n / step) * step).toFixed(4)) : n;
};
const text = max => v => String(v ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, max);
const flags = keys => v => (v && typeof v === 'object' ? Object.fromEntries(keys.filter(k => k in v).map(k => [k, !!v[k]])) : undefined);
const webUrl = v => { const s = String(v ?? '').trim(); if (!s) return ''; const u = toUrl(s); return u && /^(https?|file):/i.test(u) ? u : undefined; };
// Shortcut icon: an emoji, or a link to an image (a small data: image works too).
const linkIcon = v => { const s = String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim(); return s.length <= 2048 ? s : undefined; };
const ICON_ERR = 'That icon is too long. Use an emoji, or a link to an image (up to 2,000 characters).';
const fontName = v => { const s = String(v ?? '').trim(); return s === '' || /^[\p{L}\p{N} ._'-]{1,60}$/u.test(s) ? s : undefined; };

const SCHEMA = {
  // top bar
  tbHeight: oneOf('compact', 'normal', 'tall'),
  urlDisplay: oneOf('domain', 'full', 'title'),
  tbAutoHide: bool,
  tbColor: hex,
  tbOpacity: range(0, 1, 0.01),
  homeUrl: webUrl,
  // sidebar
  sbCollapsed: bool,
  sbAutoHide: bool,
  sbSections: flags(SB_SECTIONS),
  tabStyle: oneOf('both', 'icon', 'title'),
  density: oneOf('compact', 'normal', 'comfortable'),
  newTabsAt: oneOf('bottom', 'top'),
  // new tab / empty screen
  newTabAction: oneOf('command', 'start', 'url'),
  newTabUrl: webUrl,
  ntColor: hex,
  ntGradient: v => (Array.isArray(v) && v.length === 2 && v.every(c => hex(c)) ? v.map(c => c.toLowerCase()) : undefined),
  ntAngle: range(0, 360, 1),
  ntWidgets: flags(NT_WIDGETS),
  ntCols: range(3, 8, 1),
  ntTile: oneOf('small', 'medium', 'large'),
  ntSearch: oneOf('center', 'top', 'bottom', 'hidden'),
  ntEngine: v => (v === '' || store.SEARCH_ENGINES[v] ? v : undefined),
  ntGreet: oneOf('time', 'name', 'custom', 'off'),
  ntName: text(40),
  ntMessage: text(120),
  ntUnit: oneOf('c', 'f'),
  // global
  accent: hex,
  uiFont: fontName,
  uiFontSize: range(11, 16, 0.5),
  radius: range(0, 20, 1),
  blur: range(0, 40, 1),
  transparency: range(0, 0.85, 0.01),
  glassBlur: bool,
};
// What a theme file carries (Settings › Appearance › Export theme).
const THEME_KEYS = ['tbHeight', 'urlDisplay', 'tbAutoHide', 'tbColor', 'tbOpacity', 'sbCollapsed', 'sbAutoHide', 'sbSections', 'tabStyle', 'density',
  'ntColor', 'ntGradient', 'ntAngle', 'ntWidgets', 'ntCols', 'ntTile', 'ntSearch', 'ntGreet', 'ntMessage', 'ntLayout',
  'accent', 'uiFont', 'uiFontSize', 'radius', 'blur', 'transparency', 'glassBlur', 'clockStyle', 'clock24', 'clockSeconds', 'focusClock', 'bgChoice', 'bgEvery', 'sidebarSide', 'sidebarWidth', 'toolbar'];
const LAYOUT_KEYS = new Set(['tbHeight', 'tbAutoHide', 'sbCollapsed', 'sbAutoHide', 'radius', 'density']);

// Style presets: whole looks in one click (colours stay the Space's own).
// Each preset is a whole look: it starts from the default and changes only what it
// lists, so nothing is left over from the preset chosen before it.
const PRESET_BASE = { tbHeight: 'normal', density: 'normal', tabStyle: 'both', radius: 10, blur: 16, transparency: 0, uiFontSize: 13, sbCollapsed: false, tbAutoHide: false, sbAutoHide: false };
const STYLE_PRESETS = Object.fromEntries(Object.entries({
  arc: { label: 'Quasar (default)', uiFont: '', tbColor: '' },
  compact: { label: 'Compact', tbHeight: 'compact', density: 'compact', radius: 6, blur: 12, uiFontSize: 12 },
  glass: { label: 'Glass', radius: 14, blur: 28, transparency: 0.35 },
  square: { label: 'Square', radius: 0, blur: 0 },
  roomy: { label: 'Roomy', tbHeight: 'tall', density: 'comfortable', radius: 12, uiFontSize: 14 },
  zen: { label: 'Zen (bars hide)', tbAutoHide: true, sbAutoHide: true, tbHeight: 'compact', density: 'compact' },
}).map(([id, p]) => [id, { ...PRESET_BASE, ...p }]));
// New tab layout presets.
const NT_LAYOUTS = {
  minimal: { ntWidgets: { clock: true, date: false, greeting: false, links: false, weather: false, todo: false, notes: false, closed: false }, ntSearch: 'hidden' },
  focus: { ntWidgets: { clock: true, date: true, greeting: true, links: false, weather: false, todo: true, notes: false, closed: false }, ntSearch: 'center' },
  dashboard: { ntWidgets: { clock: true, date: true, greeting: true, links: true, weather: true, todo: true, notes: true, closed: true }, ntSearch: 'top' },
};

class AppearancePart {
  // ------------------------------------------------------------ geometry
  topH() { return TOP_H[this.st.settings.tbHeight] || TOP; }
  stripH() { return STRIP_H[this.st.settings.density] || STRIP_H.normal; }
  radiusPx() { const r = this.st.settings.radius; return Number.isFinite(r) ? r : 10; }
  // Sidebar width in px. The icon-only sidebar widens while one of its panels
  // (Space editor, notes, pickers) is open.
  sbW(W = this.cur) { return this.st.settings.sbCollapsed && !W?.sbPanel ? COLLAPSED_W : this.st.settings.sidebarWidth; }
  get sidebarTop() { return this.st.settings.sidebarSide === 'top'; }
  get anyAutoHide() { const s = this.st.settings; return !!(s.compact || s.tbAutoHide || s.sbAutoHide); }
  chromeHidden(W = this.cur) {
    const s = this.st.settings, shown = !!W?.chromeShown;
    return { top: !!(s.compact || s.tbAutoHide) && !shown, sb: !!(s.compact || s.sbAutoHide) && !shown };
  }

  // ------------------------------------------------------------ settings
  // Returns true if `key` is one of ours (saved or rejected), false to let the
  // older settings code handle it.
  appearanceSetting(key, val) {
    const s = this.st.settings;
    if (key === 'toolbar') {
      const clean = list => [...new Set((Array.isArray(list) ? list : []).filter(id => TB_ITEMS.includes(id)))];
      const left = clean(val?.left), right = clean(val?.right).filter(id => !left.includes(id));
      s.toolbar = { left, right };
      return true;
    }
    if (key === 'stylePreset') {
      const p = STYLE_PRESETS[val];
      if (!p) return true;
      for (const [k, v] of Object.entries(p)) if (k !== 'label' && SCHEMA[k]) s[k] = SCHEMA[k](v);
      s.stylePreset = val;
      this.afterAppearance(true);
      return true;
    }
    if (key === 'ntLayout') {
      const p = NT_LAYOUTS[val];
      if (!p) return true;
      s.ntLayout = val;
      s.ntWidgets = { ...p.ntWidgets };
      s.ntSearch = p.ntSearch;
      s.focusClock = !!p.ntWidgets.clock;
      return true;
    }
    if (!(key in SCHEMA)) return false;
    const v = SCHEMA[key](val);
    if (v === undefined) {
      if (key === 'homeUrl' || key === 'newTabUrl') return { error: 'That doesn’t look like a web address (for example: example.com).' };
      return true;
    }
    if (key === 'sbSections' || key === 'ntWidgets') s[key] = { ...(s[key] || {}), ...v };
    else s[key] = v;
    if (key === 'ntWidgets' && 'clock' in v) s.focusClock = v.clock;
    // Only what the layouts themselves set (widgets and the search box) makes the layout "Custom".
    if (key === 'ntWidgets' || key === 'ntSearch') s.ntLayout = 'custom';
    if (key === 'ntWidgets' && v.weather) this.weatherData(true);
    if (key === 'ntUnit') this.weatherData(true);
    if (['tbHeight', 'density', 'radius', 'blur', 'uiFont', 'uiFontSize', 'tabStyle', 'accent', 'tbColor'].includes(key)) s.stylePreset = 'custom';
    this.afterAppearance(LAYOUT_KEYS.has(key) || key === 'transparency');
    return true;
  }

  afterAppearance(relayout) {
    if (relayout) { for (const W of this.wins) W.chromeShown = false; this.layoutAll(); }
    for (const W of this.wins) this.applySeeThrough(W);
  }

  // ------------------------------------------------------------ see-through window
  // Glass (Settings › Appearance › Style presets › Glass). Like Zen, the window itself
  // is transparent, so whatever is behind it (other apps, the desktop) shows through
  // the sidebar, top bar and empty tab area, under a neutral (untinted) veil of
  // (1 - transparency). Web pages always stay solid.
  // Blur: Windows' own acrylic isn't used. It turns into a flat grey box whenever
  // Windows decides not to blur (inactive window, battery, some visual-effects
  // settings). Instead each glass window gets a backdrop: a click-through window the
  // size of the screen, kept just under the Quasar window (stackBackdrop) and cut to
  // the Quasar window's outline. It captures the screen and shows it
  // blurred (ui/glass.html). Both windows are left out of screen capture
  // (WDA_EXCLUDEFROMCAPTURE), so the capture holds only what's behind Quasar. The
  // backdrop itself never moves while Quasar is dragged, only its outline does, in
  // step with the move, so the blur stays exactly in place.
  // Side effect: while blur is on, screenshots and screen sharing see through Quasar.
  // Electron can only make a window transparent when it's created, so turning
  // glass on applies to new windows and after a restart.
  seeThroughWanted() { return (this.st.settings.transparency || 0) > 0; }
  glassBlurWanted() { return this.seeThroughWanted() && this.st.settings.glassBlur !== false; }
  windowBg(W = this.cur) {
    if (W?.transparent) return '#00000000';
    const sp = this.spaceById(W?.spaceId) || this.space;
    return sp?.colors?.[0] || '#1A1B32';
  }
  // Tells the backdrop page which screen to capture.
  async sendGlass(W) {
    const b = W?.backdrop;
    if (!b || b.isDestroyed() || b.webContents.isDestroyed()) return;
    const d = W.backdropDisplay;
    let id = null;
    try {
      const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      id = (srcs.find(s => String(s.display_id) === String(d.id)) || srcs[0])?.id || null;
    } catch { /* capture unavailable: glass stays clear */ }
    if (b.isDestroyed() || W.backdrop !== b) return;
    const msg = { on: !!id, id, blur: Math.max(12, this.st.settings.blur ?? 16) };
    const key = JSON.stringify(msg);
    if (W.glassKey === key) return;
    W.glassKey = key;
    b.webContents.send('ui:glass', msg);
  }
  // Cuts the backdrop to the Quasar window's outline (nb: where it's about to be).
  placeBackdrop(W, nb) {
    const b = W.backdrop, win = W.win;
    if (!b || b.isDestroyed() || win.isDestroyed()) return;
    const r = nb || win.getBounds(), d = W.backdropDisplay.bounds;
    try { b.setShape([{ x: r.x - d.x, y: r.y - d.y, width: r.width, height: r.height }]); } catch { /* ignore */ }
  }
  // The window moved to another screen: the backdrop follows and captures that one.
  backdropScreen(W) {
    const b = W.backdrop, win = W.win;
    if (!b || b.isDestroyed() || win.isDestroyed()) return;
    const d = screen.getDisplayMatching(win.getBounds());
    if (d.id !== W.backdropDisplay.id || JSON.stringify(d.bounds) !== JSON.stringify(W.backdropDisplay.bounds)) {
      W.backdropDisplay = d;
      b.setBounds(d.bounds);
      this.sendGlass(W);
    }
    this.placeBackdrop(W);
  }
  glassBackdrop(W, on) {
    const win = W.win;
    if (!on || win.isDestroyed()) {
      const b = W.backdrop;
      if (!b) return;
      W.backdrop = null; W.glassKey = null;
      if (!b.isDestroyed()) b.destroy();
      return;
    }
    if (W.backdrop && !W.backdrop.isDestroyed()) { this.sendGlass(W); return this.placeBackdrop(W); }
    const d = screen.getDisplayMatching(win.getBounds());
    const b = new BrowserWindow({
      ...d.bounds, frame: false, transparent: true, backgroundColor: '#00000000', show: false, focusable: false,
      skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, hasShadow: false, title: 'Quasar glass',
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    W.backdrop = b; W.backdropDisplay = d; W.glassKey = null;
    b.setIgnoreMouseEvents(true);
    b.setContentProtection(true);
    b.webContents.on('will-navigate', e => e.preventDefault());
    b.webContents.on('did-finish-load', () => { W.glassKey = null; this.sendGlass(W); });
    b.loadFile(path.join(UI, 'glass.html'));
    this.placeBackdrop(W);
    if (win.isVisible() && !win.isMinimized()) { b.showInactive(); this.stackBackdrop(W); }
  }
  // Puts the backdrop directly under its Quasar window. (Making the backdrop the Quasar
  // window's owner would do this by itself, but costs Quasar its taskbar button.)
  stackBackdrop(W) {
    const b = W.backdrop, win = W.win;
    if (!b || b.isDestroyed() || win.isDestroyed() || !b.isVisible()) return;
    try { b.moveAbove(win.getMediaSourceId()); win.moveAbove(b.getMediaSourceId()); } catch { /* ignore */ }
  }
  applySeeThrough(W) {
    const win = W?.win;
    if (!win || win.isDestroyed()) return;
    if (W.transparent) {
      const blur = this.glassBlurWanted();
      if (W.capBlur !== blur) {
        W.capBlur = blur;
        try { win.setContentProtection(blur); } catch { /* ignore */ }
      }
      if (!W.glassHooked) {
        W.glassHooked = true;
        const place = (e, nb) => this.placeBackdrop(W, nb);
        const toScreen = () => this.backdropScreen(W);
        const showB = () => { const b = W.backdrop; if (b && !b.isDestroyed() && !win.isMinimized()) { b.showInactive(); this.stackBackdrop(W); } };
        const hideB = () => { const b = W.backdrop; if (b && !b.isDestroyed()) b.hide(); };
        win.on('will-move', place);      // before Windows moves it, so the outline moves in step
        win.on('will-resize', place);
        for (const e of ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(e, () => this.placeBackdrop(W));
        win.on('moved', toScreen);
        win.on('show', showB); win.on('restore', showB);
        win.on('focus', () => this.stackBackdrop(W));   // brought to the front: bring the backdrop with it
        win.on('hide', hideB); win.on('minimize', hideB);
        screen.on('display-metrics-changed', toScreen);
        win.once('closed', () => { screen.removeListener('display-metrics-changed', toScreen); this.glassBackdrop(W, false); });
      }
      this.glassBackdrop(W, blur);
    } else if (this.seeThroughWanted() && !this.glassRestartNoted) {
      this.glassRestartNoted = true;
      this.toast('Restart Quasar to make the window see-through.', null, [{ label: 'Restart now', act: ['app:restart'] }]);
    }
    try { win.setBackgroundColor(this.withWin(W, () => this.windowBg(W))); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ new tab
  // Ctrl+T, the "New Tab" row and the + button.
  newTabAction() {
    const s = this.st.settings;
    if (s.newTabAction === 'url' && s.newTabUrl) return this.newTab(s.newTabUrl);
    if (s.newTabAction === 'start') return this.showStartPage();
    return this.openCommand('new');
  }
  showStartPage(focusSearch = true) {
    this.showNothing();
    if (focusSearch && !this.win.isDestroyed()) {
      this.win.webContents.focus();
      this.win.webContents.send('ui:focus', 'start');
    }
  }
  goHome() {
    const u = this.st.settings.homeUrl;
    if (!u) return this.showStartPage(false);
    if (this.active) return this.navigate(u);
    return this.newTab(u);
  }

  ntViewModel() {
    const s = this.st.settings, sp = this.space;
    const w = s.ntWidgets || {};
    const closed = [];
    for (let i = this.closed.length - 1; i >= 0 && closed.length < 6; i--) {
      const c = this.closed[i];
      if (c.spaceId === sp.id) closed.push({ i, url: c.url, title: c.title || hostOf(c.url) });
    }
    // Icons for shortcut tiles, from tabs, pinned tabs and Favorites Quasar already knows
    // (fetching each site's /favicon.ico from the start page would tell every site you opened it).
    const icons = {};
    const known = (url, fav) => { const h = hostOf(url || ''); if (h && fav && !/^data:,?$/.test(fav) && !icons[h]) icons[h] = fav; };
    for (const t of this.tabs.values()) if (!this.privateSpaces.has(t.spaceId)) known(t.url, t.favicon);
    if (!sp.private) {
      for (const n of pinnedTabNodes(sp.pinned || [])) known(n.url, n.favicon);
      for (const f of sp.favorites || []) known(f.url, f.favicon);
    }
    const wanted = new Set((s.ntLinks || []).map(l => hostOf(l.url)));
    return {
      icons: Object.fromEntries(Object.entries(icons).filter(([h]) => wanted.has(h))),
      todos: (this.st.ntTodos || []).slice(0, 50),
      note: this.st.ntNote || '',
      closed: w.closed ? closed : [],
      weather: w.weather ? this.weatherData() : null,
      daily: s.bgChoice === 'daily' ? this.dailyWallpaper() : null,
    };
  }

  // Sidebar sections for recent downloads and history (only when switched on).
  sbExtraViewModel() {
    const sec = this.st.settings.sbSections || {};
    const sp = this.space;
    return {
      downloads: sec.downloads ? (this.st.downloads || []).filter(d => !d.private || sp.private).slice(0, 5)
        .map(d => ({ id: d.id, name: d.filename, state: d.state, url: d.url })) : null,
      history: sec.history && !sp.private ? [...(sp.history || [])].filter(h => h.last).sort((a, b) => b.last - a.last).slice(0, 8)
        .map(h => ({ url: h.url, title: h.title || hostOf(h.url) })) : null,
    };
  }

  ntAct(op, a = {}) {
    const s = this.st.settings;
    const links = (s.ntLinks ||= []);
    const todos = (this.st.ntTodos ||= []);
    switch (op) {
      case 'search': {
        const q = String(a.text || '').trim();
        if (!q) return null;
        const tpl = store.SEARCH_ENGINES[s.ntEngine] || store.SEARCH_ENGINES[s.searchEngine] || store.SEARCH_ENGINES.Google;
        return void this.newTab(toUrl(q) || tpl.replace('%s', encodeURIComponent(q)), { route: true });
      }
      case 'open': { const u = webUrl(a.url); if (u) this.newTab(u, { route: true }); return null; }
      case 'linkAdd': {
        const url = webUrl(a.url);
        if (!url) return { error: 'That doesn’t look like a web address.' };
        if (links.length >= 40) return { error: 'You can have up to 40 shortcuts.' };
        const icon = linkIcon(a.icon);
        if (icon === undefined) return { error: ICON_ERR };
        links.push({ id: uid(), url, title: text(40)(a.title) || hostOf(url), icon });
        break;
      }
      case 'linkEdit': {
        const l = links.find(x => x.id === a.id);
        if (!l) return null;
        if ('url' in a) { const u = webUrl(a.url); if (!u) return { error: 'That doesn’t look like a web address.' }; l.url = u; }
        if ('title' in a) l.title = text(40)(a.title) || hostOf(l.url);
        if ('icon' in a) { const icon = linkIcon(a.icon); if (icon === undefined) return { error: ICON_ERR }; l.icon = icon; }
        break;
      }
      case 'linkRemove': s.ntLinks = links.filter(x => x.id !== a.id); break;
      case 'linkMove': {
        const from = links.findIndex(x => x.id === a.id);
        let to = a.before ? links.findIndex(x => x.id === a.before) : links.length;
        if (from < 0 || to < 0) return null;
        const [l] = links.splice(from, 1);
        if (to > from) to--;
        links.splice(to, 0, l);
        break;
      }
      case 'todoAdd': { const t = text(200)(a.text).trim(); if (t && todos.length < 50) todos.push({ id: uid(), text: t, done: false }); break; }
      case 'todoToggle': { const t = todos.find(x => x.id === a.id); if (t) t.done = !t.done; break; }
      case 'todoRemove': this.st.ntTodos = todos.filter(x => x.id !== a.id); break;
      case 'todoClear': this.st.ntTodos = todos.filter(x => !x.done); break;
      case 'note': this.st.ntNote = String(a.text ?? '').slice(0, 5000); break;
      case 'reopen': {
        const c = this.closed[a.i];
        if (!c || c.spaceId !== this.curSpaceId) return null;
        this.closed.splice(a.i, 1);
        return void this.newTab(c.url, { spaceId: c.spaceId });
      }
      case 'place': return this.setWeatherPlace(String(a.name || ''));
      case 'customize': return this.openSettings('newtab');
      default: return null;
    }
    this.changed();
    return { ok: true };
  }

  // ------------------------------------------------------------ weather (Open-Meteo: free, no account)
  // Only the place you typed (to find it) and its coordinates (for the forecast) are sent.
  async setWeatherPlace(name) {
    const s = this.st.settings;
    name = name.trim().slice(0, 80);
    if (!name) { s.ntPlace = null; this.wx = null; this.changed(); return { ok: true }; }
    try {
      const r = await net.fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(name)}`);
      const j = await r.json();
      const p = j?.results?.[0];
      if (!p) return { error: `Couldn’t find “${name}”.` };
      s.ntPlace = { name: [p.name, p.admin1, p.country_code].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude };
      s.ntWidgets = { ...(s.ntWidgets || {}), weather: true };
      this.wx = null;
      this.weatherData(true);
      this.changed();
      return { ok: true, name: s.ntPlace.name };
    } catch {
      return { error: 'Couldn’t reach the weather service. Check your connection.' };
    }
  }
  weatherData(force = false) {
    const s = this.st.settings, p = s.ntPlace;
    if (!p) return null;
    const unit = s.ntUnit === 'f' ? 'f' : 'c';
    const fresh = this.wx && this.wx.unit === unit && this.wx.place === p.name && Date.now() - this.wx.at < 30 * 60000;
    if ((force || !fresh) && !this.wxBusy) {
      this.wxBusy = true;
      const q = `latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto${unit === 'f' ? '&temperature_unit=fahrenheit' : ''}`;
      net.fetch('https://api.open-meteo.com/v1/forecast?' + q).then(r => r.json()).then(j => {
        this.wx = { at: Date.now(), unit, place: p.name, temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, day: !!j.current.is_day,
          hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]) };
      }).catch(() => { this.wx = { at: Date.now() - 25 * 60000, unit, place: p.name, error: true }; })
        .finally(() => { this.wxBusy = false; this.push(); });
    }
    return this.wx ? { ...this.wx } : { place: p.name, loading: true };
  }

  // ------------------------------------------------------------ daily wallpaper (Bing's picture of the day)
  dailyWallpaper() {
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;   // your day, not UTC's
    const d = this.st.ntDaily;
    // After a failed download (offline, Bing down) wait before trying again: each try
    // redraws the window, and the redraw would otherwise ask again straight away.
    const waiting = this.dailyFailAt && Date.now() - this.dailyFailAt < 10 * 60000;
    if ((!d || d.day !== today) && !this.dailyBusy && !waiting) {
      this.dailyBusy = true;
      net.fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US').then(r => r.json()).then(j => {
        const im = j?.images?.[0];
        if (!im?.url) throw new Error('no image');
        this.st.ntDaily = { day: today, url: 'https://www.bing.com' + im.url.replace(/&rf=.*$/, ''), credit: String(im.copyright || '').slice(0, 200) };
        this.dailyFailAt = 0;
        this.persist();
        this.push();
      }).catch(() => { this.dailyFailAt = Date.now(); }).finally(() => { this.dailyBusy = false; });
    }
    return d || null;
  }

  // ------------------------------------------------------------ menus
  profileMenu(x, y) {
    const cur = this.space;
    const items = [];
    for (const p of this.st.profiles) {
      const spaces = this.spacesOnProfile(p.id).filter(s => !s.private);
      if (!spaces.length) continue;
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: `Profile: ${p.name}`, enabled: false });
      for (const s of spaces) items.push({ label: `${s.emoji ? s.emoji + '  ' : ''}${s.name}`, type: 'radio', checked: s.id === cur.id, click: () => this.switchSpace(s.id) });
    }
    items.push({ type: 'separator' },
      { label: 'Edit This Space…', click: () => this.win.webContents.send('ui:view', 'edit') },
      { label: 'New Space…', click: () => this.win.webContents.send('ui:space', { action: 'new', spaceId: this.curSpaceId }) },
      { label: 'New Private Window', click: () => this.newWindow({ private: true }) });
    Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }
  topbarMenu(x, y) {
    Menu.buildFromTemplate([
      { label: 'Customize Toolbar…', click: () => this.openSettings('topbar') },
      { label: 'Hide the Top Bar Until I Point at It', type: 'checkbox', checked: !!this.st.settings.tbAutoHide, click: () => { this.appearanceSetting('tbAutoHide', !this.st.settings.tbAutoHide); this.changed(); } },
      { type: 'separator' },
      ...['compact', 'normal', 'tall'].map(h => ({ label: `${h[0].toUpperCase() + h.slice(1)} Height`, type: 'radio', checked: (this.st.settings.tbHeight || 'normal') === h, click: () => { this.appearanceSetting('tbHeight', h); this.changed(); } })),
    ]).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }
  // The icon-only / top sidebar asks for room while a panel is open.
  setSbPanel(on) {
    const W = this.cur;
    if (!W || !!W.sbPanel === !!on) return;
    W.sbPanel = !!on;
    this.layout();
    this.push();
  }
  setFolderIcon(kind, id, icon) {
    const v = text(16)(icon).trim();
    if (kind === 'group') {
      const g = this.groupsOf(this.curSpaceId).find(x => x.id === id);
      if (g) g.icon = v;
    } else {
      const f = require('./common').findPinned(this.space.pinned, id);
      if (f?.node.type === 'folder') f.node.icon = v;
    }
    this.changed();
  }
  sbItemAct(op, id) {
    const d = (this.st.downloads || []).find(x => x.id === id);
    if (!d) return null;
    if (op === 'show') return require('electron').shell.showItemInFolder(d.path);
    if (op === 'open' && d.state === 'completed') return require('electron').shell.openPath(d.path);
    return this.openLibrary('downloads');
  }

  // ------------------------------------------------------------ theme files
  async exportTheme() {
    const s = this.st.settings;
    const r = await dialog.showSaveDialog(this.win, { title: 'Export theme', defaultPath: `${(this.space.name || 'Quasar').replace(/[^\w -]/g, '')} theme.quasartheme`,
      filters: [{ name: 'Quasar theme', extensions: ['quasartheme', 'json'] }] });
    if (r.canceled || !r.filePath) return null;
    const data = { quasarTheme: 1, name: this.space.name, exported: new Date().toISOString(),
      colors: this.space.colors, grain: this.space.grain, settings: Object.fromEntries(THEME_KEYS.filter(k => s[k] !== undefined).map(k => [k, s[k]])) };
    try { fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2)); this.toast('Theme exported.'); } catch (e) { this.toast('Couldn’t save the theme: ' + e.message); }
    return null;
  }
  async importTheme() {
    const r = await dialog.showOpenDialog(this.win, { title: 'Import theme', properties: ['openFile'], filters: [{ name: 'Quasar theme', extensions: ['quasartheme', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let d;
    try {
      if (fs.statSync(r.filePaths[0]).size > 512 * 1024) throw new Error('too big');
      d = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      if (d?.quasarTheme !== 1 || typeof d.settings !== 'object') throw new Error('not a theme');
    } catch { this.toast('That file isn’t a Quasar theme.'); return null; }
    const old = { ...this.st.settings };
    const undoSpace = this.space.private ? null : { id: this.space.id, colors: [...(this.space.colors || [])], grain: this.space.grain };
    let usedColors = false;
    const s = this.st.settings;
    for (const [k, v] of Object.entries(d.settings)) {
      if (!THEME_KEYS.includes(k)) continue;
      if (k === 'toolbar') { this.appearanceSetting('toolbar', v); continue; }
      if (SCHEMA[k]) { const ok = SCHEMA[k](v); if (ok !== undefined) s[k] = k === 'sbSections' || k === 'ntWidgets' ? { ...(s[k] || {}), ...ok } : ok; continue; }
      // older settings keys, checked the way their own code checks them
      if (k === 'sidebarSide' && ['left', 'right', 'top'].includes(v)) s[k] = v;
      if (k === 'sidebarWidth') s[k] = Math.max(180, Math.min(420, Number(v) || 240));
      if (['clock24', 'clockSeconds', 'focusClock'].includes(k)) s[k] = !!v;
      if (k === 'clockStyle' && ['thin', 'bold', 'flip', 'stack', 'led', 'nixie', 'dots', 'words'].includes(v)) s[k] = v;
      if (k === 'bgChoice' && (['none', 'rotate', 'color', 'gradient', 'daily'].includes(v) || /^m\d\d$/.test(v))) s[k] = v;
      if (k === 'bgEvery' && ['open', '10', '60', '1440'].includes(String(v))) s[k] = String(v);
      if (k === 'ntLayout' && typeof v === 'string') s[k] = v.slice(0, 20);
    }
    s.stylePreset = 'custom';
    const colors = Array.isArray(d.colors) ? d.colors.filter(c => hex(c)).slice(0, 3) : [];
    if (colors.length && !this.space.private) {
      const { response } = await dialog.showMessageBox(this.win, { type: 'question', buttons: ['Use Its Colours', 'Keep My Colours'], defaultId: 0, cancelId: 1,
        message: `Use the theme’s colours for “${this.space.name}” too?` });
      if (response === 0) { await this.updateSpace(this.space.id, { colors, ...(typeof d.grain === 'number' ? { grain: Math.max(0, Math.min(1, d.grain)) } : {}) }); usedColors = true; }
    }
    this.afterAppearance(true);
    this.changed();
    this.toast(`Theme “${String(d.name || 'imported').slice(0, 40)}” applied.`, null, [{ label: 'Undo', act: ['theme:undo'] }]);
    this.themeUndo = { settings: old, space: usedColors ? undoSpace : null };
    return null;
  }
  // Puts back only what the theme changed: its settings and (if you said yes) the
  // Space's colours. Anything you changed since then stays as it is.
  async undoTheme() {
    const u = this.themeUndo;
    if (!u) return;
    this.themeUndo = null;
    const s = this.st.settings;
    for (const k of [...THEME_KEYS, 'stylePreset']) {
      if (k in u.settings) s[k] = u.settings[k]; else delete s[k];
    }
    if (u.space && this.spaceById(u.space.id)) {
      await this.updateSpace(u.space.id, { colors: u.space.colors, ...(typeof u.space.grain === 'number' ? { grain: u.space.grain } : {}) });
    }
    for (const W of this.wins) W.sbPanel = false;
    this.afterAppearance(true);
    this.changed();
  }

  // Everything the UI needs to draw these options (added to the state every window gets).
  appearanceViewModel() {
    const s = this.st.settings;
    return {
      toolbar: s.toolbar || TB_DEFAULT, tbItems: TB_ITEMS, stylePresets: Object.fromEntries(Object.entries(STYLE_PRESETS).map(([k, v]) => [k, v.label])),
      hidden: this.chromeHidden(), sbPanel: !!this.cur?.sbPanel, sbW: this.sbW(), strip: this.stripH(),
      nt: this.ntViewModel(), sbExtra: this.sbExtraViewModel(),
      profileName: (this.st.profiles.find(p => p.id === this.space.profileId) || {}).name || '',
    };
  }
}

AppearancePart.SCHEMA = SCHEMA;
module.exports = AppearancePart;
