// Site tools: anything from the site-info menu (the lock left of the address) can be
// pinned to the top bar as a one-click button: Forget this site, Never sleep, Mute this
// site, ads on/off, pop-ups… Pick them in the lock menu › Pin to Top Bar… (a drop-down that
// stays open while you tick several); right-click a pinned button to unpin or move it.
// The buttons sit in their own rounded box between the refresh button and the address. The buttons act on the tab you're looking at.
// st.settings.siteTools holds the pinned ids, in order.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { Menu } = require('electron');
const { hostOf, uid } = require('./common');
const { siteOf } = require('../protection');

const MAX_PINNED = 6;

class SiteToolsPart {
  // Every pinnable site-info item, for this tab: { id, label, icon, on, enabled, tip }.
  //   on: null for one-shot actions, true/false for switches (drawn highlighted when on).
  siteToolDefs(tab = this.active) {
    let u = null;
    try { u = new URL(tab?.url || ''); } catch { /* no page */ }
    const web = !!u && /^https?:$/.test(u.protocol) && !!tab && this.tabs.has(tab.id);
    const host = web ? u.hostname : '';
    const site = web ? (siteOf(host) || host) : '';
    const perm = p => (web ? this.sitePerm(tab, tab.url, p) : undefined);
    const wc = tab?.view?.webContents;
    const zoom = wc && !wc.isDestroyed() ? wc.getZoomFactor() : 1;
    const prefix = web ? `${tab.profile}|${u.origin}|` : null;
    const hasPerms = !!prefix && [...this.permissions.keys()].some(k => k.startsWith(prefix));
    const forClose = web && this.forgetsOnClose(host), awake = web && this.neverSleeps(tab.url);
    const adsBlocked = web && !this.protection.adsAllowed(host), muted = perm('sound') === false;
    const pops = perm('popups') === true, dls = perm('automatic-downloads') === true, chrome = web && this.identityFor(host) === 'chrome';
    const sw = (on, what) => `${what}: ${on ? 'on' : 'off'}${site ? ` for ${site}` : ''} (click to turn ${on ? 'off' : 'on'})`;
    return [
      { id: 'forget', label: 'Forget This Site…', icon: 'eraser', on: null, enabled: web,
        tip: web ? `Forget ${site}: sign out and remove its cookies, history and data` : 'Forget this site (open a website first)' },
      { id: 'forget-close', label: 'Forget This Site When I Close It', icon: 'trash', on: forClose, enabled: web, tip: sw(forClose, 'Forget this site when I close it') },
      { id: 'never-sleep', label: 'Never Put This Site to Sleep', icon: 'sun', on: awake, enabled: web, tip: sw(awake, 'Never put this site to sleep') },
      { id: 'ads', label: 'Block Ads and Trackers on This Site', icon: 'shield', on: adsBlocked, enabled: web && this.protection.adsOn, tip: sw(adsBlocked, 'Block ads and trackers') },
      { id: 'sound', label: 'Mute This Site', icon: muted ? 'mute' : 'volume', on: muted, enabled: web, tip: sw(muted, 'Mute this site') },
      { id: 'popups', label: 'Allow Pop-ups on This Site', icon: 'popup', on: pops, enabled: web, tip: sw(pops, 'Allow pop-ups and redirects') },
      { id: 'downloads', label: 'Allow Automatic Downloads on This Site', icon: 'download', on: dls, enabled: web, tip: sw(dls, 'Allow automatic downloads') },
      { id: 'identity', label: 'Tell This Site I’m Using Chrome', icon: 'id', on: chrome, enabled: web, tip: sw(chrome, 'Tell this site I’m using Chrome') },
      { id: 'zoom-reset', label: 'Reset Zoom to 100%', icon: 'zoomReset', on: null, enabled: Math.abs(zoom - 1) > 0.001,
        tip: Math.abs(zoom - 1) > 0.001 ? `Zoom is ${Math.round(zoom * 100)}%: click to reset to 100%` : 'Reset zoom (already 100%)' },
      { id: 'reset-perms', label: 'Reset This Site’s Permissions', icon: 'reset', on: null, enabled: hasPerms,
        tip: hasPerms ? `Reset camera, location, notification… permissions for ${site}` : 'Reset permissions (this site has none)' },
      { id: 'boost', label: 'Boost This Site (custom CSS)…', icon: 'pen', on: null, enabled: web && !this.isPrivate, tip: web ? `Boost ${site}: your own CSS for it` : 'Boost this site (open a website first)' },
      { id: 'atc', label: 'Always Open This Site In…', icon: 'plane', on: null, enabled: web && !this.isPrivate, tip: web ? `Choose the Space ${site} always opens in` : 'Always open this site in a Space (open a website first)' },
      { id: 'site-settings', label: 'All Site Settings…', icon: 'sliders', on: null, enabled: true, tip: 'All site settings and permissions' },
    ];
  }

  pinnedSiteTools() {
    const ids = new Set(this.siteToolDefs(null).map(d => d.id));
    return [...new Set(Array.isArray(this.st.settings.siteTools) ? this.st.settings.siteTools : [])].filter(id => ids.has(id)).slice(0, MAX_PINNED);
  }

  // For the top bar: the pinned tools, in order, with this tab's state.
  siteToolsViewModel() {
    const pinned = this.pinnedSiteTools();
    if (!pinned.length) return [];
    const defs = new Map(this.siteToolDefs().map(d => [d.id, d]));
    return pinned.map(id => defs.get(id)).filter(Boolean).map(({ id, icon, on, enabled, tip }) => ({ id, icon, on, enabled, tip }));
  }

  // The lock menu's "Pin to Top Bar…" item: opens the picker under the lock.
  siteToolPinMenu(x = 0, y = 0) {
    return { label: 'Pin to Top Bar…', click: () => this.openPinPicker(x, y) };
  }

  // The picker: a drop-down (in the command bar's layer) listing every lock-menu item with a
  // tick; clicking one pins or unpins it and the list stays open until you click away or Esc.
  pinPickerData() {
    const pinned = this.pinnedSiteTools();
    return { max: MAX_PINNED, count: pinned.length,
      items: this.siteToolDefs().map(d => ({ id: d.id, label: d.label.replace(/…$/, ''), icon: d.icon, pinned: pinned.includes(d.id) })) };
  }

  openPinPicker(x, y) {
    this.openCommand('pins', '', { pins: { ...this.pinPickerData(), x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) } });
  }

  toggleSiteToolPin(id, on = null) {
    const list = this.pinnedSiteTools();
    const has = list.includes(id);
    const want = on === null ? !has : !!on;
    if (want === has) return;
    if (want && list.length >= MAX_PINNED) return this.toast(`Only ${MAX_PINNED} buttons fit in the top bar. Unpin one first.`);
    this.st.settings.siteTools = want ? [...list, id] : list.filter(x => x !== id);
    this.changed();
  }

  moveSiteTool(id, dir) {
    const list = this.pinnedSiteTools();
    const i = list.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.st.settings.siteTools = list;
    this.changed();
  }

  // A pinned button was clicked (or picked from its menu).
  runSiteTool(id, x = 0, y = 0) {
    const tab = this.active;
    const d = this.siteToolDefs(tab).find(t => t.id === id);
    if (!d || !d.enabled || !tab) return;
    const host = hostOf(tab.url);
    const wc = tab.view?.webContents;
    switch (id) {
      case 'forget': return this.forgetSite(tab);
      case 'forget-close': this.toggleForgetOnClose(host); return this.push();
      case 'never-sleep': this.toggleNeverSleep(host); this.toast(d.on ? `${siteOf(host) || host} can sleep again.` : `${siteOf(host) || host} will never be put to sleep.`); return this.push();
      case 'ads': return this.setAdsAllowed(host, d.on);
      case 'sound': this.setSiteSound(tab, d.on); this.toast(d.on ? `${siteOf(host) || host} can play sound again.` : `${siteOf(host) || host} is muted.`); return this.push();
      case 'popups': { const k = this.siteKey(tab, tab.url, 'popups'); if (k) this.setPermission(k, d.on ? null : true); this.toast(d.on ? `Pop-ups from ${host} will be blocked.` : `Pop-ups from ${host} will be allowed.`); return this.push(); }
      case 'downloads': { const k = this.siteKey(tab, tab.url, 'automatic-downloads'); if (k) this.setPermission(k, d.on ? null : true); this.toast(d.on ? `${host} will ask before downloading several files.` : `${host} may download several files at once.`); return this.push(); }
      case 'identity': this.setIdentity(host, d.on ? 'arch' : 'chrome'); return this.push();
      case 'zoom-reset': return this.zoom(0, tab);
      case 'reset-perms': {
        const prefix = `${tab.profile}|${new URL(tab.url).origin}|`;
        for (const k of [...this.permissions.keys()]) if (k.startsWith(prefix)) this.permissions.delete(k);
        this.savePermissions();
        if (wc && !wc.isDestroyed()) wc.reload();
        this.toast(`Permissions reset for ${host}.`);
        return this.push();
      }
      case 'boost': return this.openLibrary('boosts', { pattern: host.replace(/^www\./, '') });
      case 'atc': return this.atcMenu(tab, x, y);
      case 'site-settings': return this.openLibrary('sites');
    }
  }

  // "Always open this site in" as its own menu, under the pinned button.
  atcMenu(tab, x, y) {
    const site = hostOf(tab.url).replace(/^www\./, '');
    const rule = this.st.atc.find(r => r.enabled !== false && this.ruleMatches(r.pattern, tab.url));
    const set = sp => {
      this.st.atc = this.st.atc.filter(r => r.pattern !== site);
      if (sp) this.st.atc.push({ id: uid(), pattern: site, spaceId: sp.id, enabled: true });
      this.persist(); this.libUpdate();
      if (sp) this.toast(`Links to ${site} will open in ${sp.name}.`);
    };
    Menu.buildFromTemplate([
      { label: `Always open ${site} in`, enabled: false },
      ...this.st.spaces.map(s => ({ label: `${s.emoji || ''} ${s.name}`.trim(), type: 'radio', checked: rule?.spaceId === s.id, click: () => set(s) })),
      { type: 'separator' },
      { label: 'Any Space (no rule)', type: 'radio', checked: !rule, click: () => set(null) },
    ]).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  // Right-click a pinned button.
  siteToolMenu(id, x, y) {
    const list = this.pinnedSiteTools();
    const d = this.siteToolDefs().find(t => t.id === id);
    if (!d) return;
    const i = list.indexOf(id);
    Menu.buildFromTemplate([
      { label: d.label, enabled: d.enabled, click: () => this.runSiteTool(id, x, y) },
      { type: 'separator' },
      { label: 'Move Left', enabled: i > 0, click: () => this.moveSiteTool(id, -1) },
      { label: 'Move Right', enabled: i >= 0 && i < list.length - 1, click: () => this.moveSiteTool(id, 1) },
      { label: 'Unpin from Top Bar', click: () => this.toggleSiteToolPin(id, false) },
      { label: 'Pin or Unpin Others…', click: () => this.openPinPicker(x, y + 8) },
    ]).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  siteToolAct(op, id, x, y) {
    id = String(id || '');
    x = Number(x) || 0; y = Number(y) || 0;
    if (op === 'run') return this.runSiteTool(id, x, y);
    if (op === 'menu') return this.siteToolMenu(id, x, y);
    if (op === 'pin') return this.toggleSiteToolPin(id, true);
    if (op === 'unpin') return this.toggleSiteToolPin(id, false);
    // From the picker: flip one and send the list back so it redraws in place.
    if (op === 'toggle') { this.toggleSiteToolPin(id); return this.pinPickerData(); }
    if (op === 'picker') return this.openPinPicker(x, y);
  }
}

module.exports = SiteToolsPart;
