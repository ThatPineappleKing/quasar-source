// Browser sessions, Profiles shared by Spaces, and site permissions.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { app, clipboard, dialog, screen } = require('electron');
const store = require('../store');
const { uid, hostOf, PROFILE_KEYS } = require('./common');

class ProfilesPart {
  // ------------------------------------------------------------ sessions
  // Every Space is its own profile: its own cookies, logins, cache, site
  // storage, history, Favorites and saved passwords — like Chrome profiles.
  // `space.partition` names its storage; it never changes once set.
  partitionFor(tab) {
    const sp = this.spaceById(tab.spaceId) || this.space;
    tab.profile = sp.partition;
    return sp.private ? sp.partition : 'persist:' + sp.partition;   // private = in memory only
  }

  newPartition(spaceId) { return 'space-' + spaceId; }

  // ------------------------------------------------- connection per Profile
  // { mode: 'system' (default) | 'direct' | 'custom' (rules: "socks5://host:port",
  // "http://proxy:8080", or Chromium proxy rules) | 'tor' }. A private Tor window
  // keeps its setting on its in-memory Space.
  proxyFor(partition) {
    const priv = [...this.privateSpaces.values()].find(s => s.partition === partition);
    if (priv) return priv.proxy || null;
    return this.st.profiles.find(p => p.partition === partition)?.proxy || null;
  }

  // Tor Browser listens on 9150, the Tor service on 9050.
  torPort() {
    const net = require('net');
    const probe = port => new Promise(res => {
      const s = net.connect({ host: '127.0.0.1', port });
      const done = ok => { s.destroy(); res(ok ? port : 0); };
      s.once('connect', () => done(true)); s.once('error', () => done(false)); s.setTimeout(800, () => done(false));
    });
    return probe(9150).then(p => p || probe(9050));
  }

  applyProxy(ses, partition) {
    // Pages wait for this before their first load, so nothing goes out before the proxy is set.
    ses.__archProxyReady = this._applyProxy(ses, partition).catch(() => {});
    return ses.__archProxyReady;
  }

  async _applyProxy(ses, partition) {
    const p = this.proxyFor(partition);
    let cfg = { mode: 'system' };
    if (p?.mode === 'direct') cfg = { mode: 'direct' };
    else if (p?.mode === 'custom' && p.rules) cfg = { mode: 'fixed_servers', proxyRules: p.rules, proxyBypassRules: p.bypass || '<local>' };
    else if (p?.mode === 'tor') {
      const port = await this.torPort();
      // No Tor running: fail closed (pages don't load) rather than go out directly.
      cfg = { mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${port || 9050}`, proxyBypassRules: '<-loopback>' };
      if (!port) this.toast('Tor isn’t running on this PC, so pages in this Space won’t load. Start Tor Browser (or the Tor service) and reload.');
    } else if (p?.mode === 'vpn') {
      // Quasar's VPN (Cloudflare WARP's local proxy). If WARP isn't running, start it; if it
      // still isn't there, fail closed: pages don't load rather than going out directly.
      const up = (await this.vpnPortOpen()) || !(await this.vpnStart({ ask: false })).error;
      cfg = { mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${this.vpnPort}`, proxyBypassRules: '<local>' };
      if (!up) this.toast('The VPN (Cloudflare WARP) isn’t connected, so pages in this Space won’t load. Click VPN in the top bar to reconnect, or turn it off.');
    }
    try { await ses.setProxy(cfg); await ses.closeAllConnections?.(); } catch (err) { this.toast(`Couldn’t set the proxy: ${err.message}`); }
    ses.__archProxied = cfg.mode === 'fixed_servers';
    // Pages of this profile that opened while the proxy was being set.
    const { webContents } = require('electron');
    for (const id of this.pageTabs.keys()) { const wc = webContents.fromId(id); if (wc && !wc.isDestroyed() && wc.session === ses) this.webrtcPolicy(wc); }
  }

  // Settings › Space editor › Connection.
  async setProfileProxy(profileId, proxy) {
    const p = this.st.profiles.find(x => x.id === profileId);
    if (!p) return { error: 'No such profile.' };
    const mode = ['system', 'direct', 'custom', 'tor', 'vpn'].includes(proxy?.mode) ? proxy.mode : 'system';
    let rules = String(proxy?.rules || '').trim();
    if (mode === 'custom') {
      if (/^[\w.-]+:\d+$/.test(rules)) rules = 'http://' + rules;   // "host:port"
      if (!/^((https?|socks[45]?|quic):\/\/)?[\w.[\]:-]+(:\d+)?([;,=\w\s.:/[\]-]*)$/i.test(rules)) return { error: 'That doesn’t look like a proxy address (for example socks5://127.0.0.1:1080 or proxy.example.com:8080).' };
    }
    if (mode === 'vpn') { const r = await this.vpnStart(); if (r.error) return r; }
    p.proxy = mode === 'system' ? null : { mode, ...(mode === 'custom' ? { rules } : {}) };
    this.persist();
    const { session } = require('electron');
    const ses = session.fromPartition('persist:' + p.partition);
    if (this.sessions.has(ses)) await this.applyProxy(ses, p.partition);
    for (const t of this.tabs.values()) if (t.profile === p.partition) this.webrtcPolicy(t.view?.webContents);
    this.push();
    return { ok: true };
  }

  // Through a proxy, WebRTC mustn't reveal the real address.
  webrtcPolicy(wc) {
    if (!wc || wc.isDestroyed()) return;
    try { wc.setWebRTCIPHandlingPolicy(wc.session.__archProxied ? 'disable_non_proxied_udp' : 'default'); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------- profiles
  // Like Arc: a Profile holds what Spaces may share — cookies and logins (its
  // storage partition), history, pinned tabs, Favorites and saved passwords.
  // Each Space points to one Profile and keeps its own name, emoji, theme and
  // open tabs. So "Home" and "Second Home" can share a Profile, while a Space
  // on another Profile shares nothing with them.
  //
  // To keep the rest of the code simple, `space.partition / pinned / favorites
  // / history` are accessors that read and write the Space's Profile.

  setupProfiles() {
    this.st.profiles ||= [];
    for (const sp of this.st.spaces) this.ensureProfile(sp);
  }

  profileOf(sp) { return (sp && this.st.profiles.find(p => p.id === sp.profileId)) || null; }

  newProfile(name) {
    const p = { id: 'p-' + uid(), name: String(name || 'Profile').trim().slice(0, 40) || 'Profile', partition: 'prof-' + uid(), pinned: [], favorites: [], history: [] };
    this.st.profiles.push(p);
    return p;
  }

  // Give a Space a Profile (creating one from its own data if it has none) and
  // route its shared fields to that Profile. Safe to call any number of times.
  ensureProfile(sp, nameForNew) {
    if (!sp || sp.private) return;
    const own = k => { const d = Object.getOwnPropertyDescriptor(sp, k); return !!d && !d.get; };
    let p = this.profileOf(sp);
    if (!p) {
      const part = own('partition') ? sp.partition : null;
      p = (part && this.st.profiles.find(x => x.partition === part)) || null;   // e.g. restored from a backup
      if (!p) {
        p = { id: 'p-' + uid(), name: String(nameForNew || sp.name || 'Profile').slice(0, 40), partition: part || this.newPartition(sp.id), pinned: [], favorites: [], history: [] };
        this.st.profiles.push(p);
      }
      sp.profileId = p.id;
    }
    for (const k of PROFILE_KEYS) {
      if (own(k)) {
        if (k !== 'partition' && Array.isArray(sp[k]) && sp[k].length && !(p[k] || []).length) p[k] = sp[k];
        delete sp[k];
      }
      if (!Object.getOwnPropertyDescriptor(sp, k)) {
        Object.defineProperty(sp, k, {
          configurable: true, enumerable: false,   // not written into each Space in state.json
          get: () => this.profileOf(sp)?.[k],
          set: v => { const pp = this.profileOf(sp); if (pp) pp[k] = v; },
        });
      }
    }
  }

  spacesOnProfile(profileId) { return this.st.spaces.filter(s => s.profileId === profileId); }

  // New Space, as on Arc's "New Space" screen: name, emoji, Profile (an existing
  // one to share logins/history/pinned tabs, or a new one), and theme.
  createSpace(o = {}) {
    if (this.isPrivate) return null;
    const id = uid();
    let p = o.profileId && o.profileId !== 'new' ? this.st.profiles.find(x => x.id === o.profileId) : null;
    if (!p) p = this.newProfile(o.newProfileName || o.name || `Profile ${this.st.profiles.length + 1}`);
    const used = new Set(this.st.spaces.map(s => s.colors[0]));
    const preset = store.PRESETS.find(x => !used.has(x.colors[0])) || store.PRESETS[0];
    const colors = Array.isArray(o.colors) && o.colors.every(c => /^#[0-9a-f]{6}$/i.test(c)) && o.colors.length ? o.colors.slice(0, 3) : [...preset.colors];
    const sp = {
      id, name: String(o.name || '').trim().slice(0, 40) || `Space ${this.st.spaces.length + 1}`,
      emoji: typeof o.emoji === 'string' ? o.emoji.trim().slice(0, 16) : '✨',
      colors, grain: 0.35, profileId: p.id, tabs: [], activeIndex: -1,
    };
    this.st.spaces.push(sp);
    this.ensureProfile(sp);
    this.order[id] = [];
    if (o.theme) this.updateSpace(id, { theme: o.theme });
    this.switchSpace(id);
    this.changed();
    return id;
  }

  // Move a Space onto another Profile (Arc's "Set Profile"). Its open tabs reopen
  // in the new Profile's storage; its pinned tabs/Favorites become the new Profile's.
  setSpaceProfile(spaceId, profileId) {
    const sp = this.spaceById(spaceId);
    if (!sp || sp.private || sp.profileId === profileId) return;
    const p = profileId === 'new' ? this.newProfile(sp.name) : this.st.profiles.find(x => x.id === profileId);
    if (!p) return;
    const urls = (this.order[spaceId] || []).map(id => this.tabs.get(id)?.url).filter(Boolean);
    for (const t of [...this.tabs.values()]) if (t.spaceId === spaceId) this.closeTab(t.id, { force: true });
    this.closed = this.closed.filter(c => c.spaceId !== spaceId);
    sp.profileId = p.id;
    this.order[spaceId] = [];
    for (const u of urls) this.newTab(u, { spaceId, active: false });
    for (const W of this.wins) if (W.spaceId === spaceId) this.withWin(W, () => this.switchSpace(spaceId));
    this.toast(`${sp.emoji || ''} ${sp.name} now uses the “${p.name}” profile`.trim());
    this.changed();
  }

  renameProfile(profileId, name) {
    const p = this.st.profiles.find(x => x.id === profileId);
    if (p && String(name || '').trim()) { p.name = String(name).trim().slice(0, 40); this.changed(); }
  }

  // Two tabs can be shown in either Space of the same Profile (pinned tabs, Favorites).
  sameProfile(a, b) {
    const pa = this.spaceById(a)?.profileId, pb = this.spaceById(b)?.profileId;
    return !!pa && pa === pb;
  }

  // One-time upgrade from the old "Spaces can share a profile" model.
  migrateToIsolatedSpaces() {
    const st = this.st;
    if (st.isolatedSpaces) return;
    const slug = p => 'profile-' + String(p || 'Default').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const used = new Set();
    const nameToPartition = {};
    for (const sp of st.spaces) {
      // The first Space on each old profile keeps that profile's logins and cookies.
      const old = slug(sp.profile);
      if (!sp.partition) sp.partition = used.has(old) ? this.newPartition(sp.id) : old;
      used.add(sp.partition);
      const name = sp.profile || 'Default';
      if (!(name in nameToPartition)) nameToPartition[name] = sp.partition;
      sp.favorites ||= [];
      sp.history ||= [];
      delete sp.profile;
    }
    const first = st.spaces.find(s => s.id === st.activeSpaceId) || st.spaces[0];

    // Old shared Favorites: give each to the Space whose Arc profile it came from, else the current Space.
    const legacyFavs = st.favorites || [];
    if (legacyFavs.length) {
      let arcFavs = [];
      try {
        const arc = require('../arc-import');
        const found = arc.find();
        if (found) {
          const d = arc.parse(found.sidebar, found.userData);
          arcFavs = d.favorites.map(f => ({ url: f.url, spaces: d.spaces.filter(s => s.profile === f.profile).map(s => s.arcId) }));
        }
      } catch { /* Arc not available */ }
      for (const f of legacyFavs) {
        const hit = arcFavs.find(a => a.url === f.url);
        const targets = hit ? st.spaces.filter(s => hit.spaces.includes(s.arcId)) : [];
        for (const sp of (targets.length ? targets : [first])) if (sp.favorites.length < 12) sp.favorites.push({ ...f, id: uid() });
      }
    }
    // Old shared history can't be split by Space without leaking, so it is dropped.
    const droppedHistory = (st.history || []).length;
    delete st.favorites; delete st.history;

    // Passwords were keyed by profile name; re-key them to that profile's Space.
    for (const e of this.vault.data.entries) e.profile = nameToPartition[e.profile] || first.partition;
    for (const n of this.vault.data.never) n.profile = nameToPartition[n.profile] || first.partition;
    if (this.vault.data.entries.length || this.vault.data.never.length) { try { this.vault.save(); } catch { /* ignore */ } }

    st.isolatedSpaces = true;
    store.save(st);
    if (droppedHistory) this.migrationNote = `Each Space is now its own profile. ${droppedHistory} old shared history entries were cleared so Spaces can't see each other's history.`;
  }

  setupSession(ses, partition) {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    ses.__archPartition = partition;
    // Present as plain Chrome so sites don't treat us as an unknown browser.
    ses.setUserAgent(ses.getUserAgent()
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '')
      .replace(/\sarch-browser\/\S+/i, ''));

    // Spell check in the user's own languages (falls back to US English).
    try {
      const avail = ses.availableSpellCheckerLanguages || [];
      const prefs = (app.getPreferredSystemLanguages?.() || []).concat(app.getLocale(), 'en-US');
      const pick = l => avail.find(a => a.toLowerCase() === l.toLowerCase()) || avail.find(a => a.toLowerCase() === l.split('-')[0].toLowerCase());
      const langs = [...new Set(prefs.map(pick).filter(Boolean))].slice(0, 3);
      if (langs.length) ses.setSpellCheckerLanguages(langs);
      ses.setSpellCheckerEnabled(true);
    } catch { /* spell check unavailable */ }

    // Remember each site's certificate for the site-info panel; Chromium still decides validity (-3).
    ses.setCertificateVerifyProc((req, cb) => {
      try { this.rememberCert(partition, req.hostname, req.certificate, req.verificationResult); } catch { /* ignore */ }
      cb(-3);
    });

    const always = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
    const ask = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'display-capture', 'idle-detection']);
    // Glass blur: Quasar's own backdrop page (ui/glass.html, never a website) captures the
    // screen behind a glass window (see glassBackdrop). Nothing else gets this without asking.
    const glassCapture = (wc, perm) => perm === 'media' && this.glassBlurWanted()
      && [...this.wins].some(W => W.backdrop && !W.backdrop.isDestroyed() && W.backdrop.webContents === wc);
    ses.setPermissionCheckHandler((wc, perm, origin) => {
      if (always.has(perm) || glassCapture(wc, perm)) return true;
      if (perm === 'usb' || perm === 'serial' || perm === 'hid') return true;   // the site may ask; the device chooser decides (devices.js)
      return this.permissions.get(`${partition}|${origin}|${perm}`) === true;
    });
    ses.setPermissionRequestHandler(async (wc, perm, cb, details) => {
      if (always.has(perm) || glassCapture(wc, perm)) return cb(true);
      if (!ask.has(perm)) return cb(false);
      const origin = (() => { try { return new URL(details.requestingUrl).origin; } catch { return details.requestingUrl; } })();
      const key = `${partition}|${origin}|${perm}`;
      if (this.permissions.has(key)) return cb(this.permissions.get(key));
      const what = { media: 'use your camera/microphone', geolocation: 'know your location', notifications: 'show notifications',
        'clipboard-read': 'read your clipboard', 'display-capture': 'see your screen' }[perm] || `use ${perm}`;
      const { response } = await dialog.showMessageBox(this.windowFor(this.pageTabs.get(wc?.id), wc), {
        type: 'question', buttons: ['Allow', 'Block'], defaultId: 1, cancelId: 1,
        message: `${hostOf(origin) || origin} wants to ${what}.`,
        detail: 'You can change this later in Site settings (Ctrl+H, or the icon left of the address).',
      });
      this.setPermission(key, response === 0);
      cb(response === 0);
    });

    ses.on('will-download', (e, item) => this.onDownload(ses, item));
    // USB, serial, HID and Bluetooth device choosers.
    try { this.devices.setupSession(ses, partition); } catch { /* not supported */ }
    // Ad/tracker blocking, dangerous-site checks and Always-HTTPS.
    this.protection.install(ses, partition);
    // The Profile's connection: system proxy, direct, a proxy of its own, or Tor.
    this.applyProxy(ses, partition);
    // Chrome extensions (not in private windows).
    try { this.extensions.setupSession(ses, partition, [...this.privateSpaces.values()].some(s => s.partition === partition)); } catch { /* extensions unavailable */ }
  }

  // ---------------------------------------------------- site permissions
  // Remembered across restarts per Space (private windows: until they close).
  setPermission(key, value) {
    if (value === null || value === undefined) this.permissions.delete(key); else this.permissions.set(key, !!value);
    this.savePermissions();
  }
  savePermissions() {
    const priv = [...this.privateSpaces.values()].map(s => s.partition + '|');
    const out = {};
    for (const [k, v] of this.permissions) if (!priv.some(p => k.startsWith(p))) out[k] = v;
    this.st.sitePermissions = out;
    this.persist();
    this.libUpdate();
  }
}

module.exports = ProfilesPart;
