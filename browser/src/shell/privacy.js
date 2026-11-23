// Privacy and security extras: the breached-password check, forgetting a site when
// its last tab closes, locking Spaces (and private windows) with Windows Hello,
// authenticator codes, and telling a site Quasar is Chrome, Edge or Firefox.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const crypto = require('crypto');
const { BrowserWindow, powerMonitor, net } = require('electron');
const { hostOf } = require('./common');
const { siteOf } = require('../protection');
const { siteKey } = require('../passwords');

class PrivacyPart {
  // ---------------------------------------------------- breached passwords
  // Have I Been Pwned's "range" lookup: only the first 5 characters of each password's
  // SHA-1 hash leave this PC; the answer lists every leaked hash starting with them,
  // and the match is made here. Padding hides how many results came back.
  async breachCheck() {
    const v = this.vault;
    const byHash = new Map();
    for (const e of v.data.entries) {
      const h = crypto.createHash('sha1').update(e.password, 'utf8').digest('hex').toUpperCase();
      (byHash.get(h) || byHash.set(h, []).get(h)).push(e.id);
    }
    const prefixes = [...new Set([...byHash.keys()].map(h => h.slice(0, 5)))];
    const get = this._hibpFetch || (u => net.fetch(u, { headers: { 'Add-Padding': 'true', 'User-Agent': 'Quasar-browser-password-checkup' } }));
    const counts = {};
    let failed = 0;
    for (const p of prefixes) {
      let text = '';
      try { const r = await get(`https://api.pwnedpasswords.com/range/${p}`); if (!r.ok) throw new Error(String(r.status)); text = await r.text(); }
      catch { failed++; continue; }
      for (const line of text.split(/\r?\n/)) {
        const [suffix, n] = line.trim().split(':');
        const ids = byHash.get(p + (suffix || '').toUpperCase());
        if (ids && Number(n) > 0) for (const id of ids) counts[id] = Number(n);
      }
    }
    this.breaches = { at: Date.now(), counts };
    return { checked: v.data.entries.length, breached: Object.keys(counts).length, counts, failed };
  }

  // ------------------------------------------------ forget when closed (Brave)
  forgetsOnClose(host) { return (this.st.forgetOnClose || []).includes(siteOf(hostOf('https://' + host) || host)); }

  toggleForgetOnClose(host) {
    const site = siteOf(String(host).replace(/^www\./, ''));
    if (!site) return;
    const list = this.st.forgetOnClose ||= [];
    const on = !list.includes(site);
    this.st.forgetOnClose = on ? [...list, site] : list.filter(s => s !== site);
    this.persist();
    this.libUpdate?.();
    this.toast(on ? `Quasar will forget ${site} (cookies, logins, site data, history) when you close its last tab.` : `Quasar will remember ${site} again.`);
    return on;
  }

  // A tab closed: if it was the last one of a "forget when closed" site in its profile, forget the site.
  afterTabClosed(tab) {
    const list = this.st.forgetOnClose || [];
    if (!list.length || !/^https?:/i.test(tab.url || '')) return;
    const site = siteOf(hostOf(tab.url));
    if (!list.includes(site)) return;
    const profile = tab.profile || this.spaceById(tab.spaceId)?.partition;
    const onSite = u => { const h = hostOf(u); return h === site || h.endsWith('.' + site); };
    if ([...this.tabs.values()].some(t => (t.profile || this.spaceById(t.spaceId)?.partition) === profile && onSite(t.url))) return;
    clearTimeout(this._forgetT?.[site]);
    (this._forgetT ||= {})[site] = setTimeout(() => {
      if ([...this.tabs.values()].some(t => (t.profile || this.spaceById(t.spaceId)?.partition) === profile && onSite(t.url))) return;   // reopened meanwhile
      this.forgetSite({ url: tab.url, profile, spaceId: tab.spaceId }, { confirm: false, quiet: true })
        .then(r => { if (r) this.toast(`Closed ${site}, so Quasar forgot it.`); this.emit?.('forgot', site); }).catch(() => {});
    }, 400);
  }

  // ---------------------------------------------- locking with Windows Hello
  // A Space can be locked (Space menu › Lock with Windows Hello), and private windows
  // too (Settings). Unlocked Spaces lock again when Windows locks, the PC sleeps, Quasar
  // has been in the background for a while, or you choose "Lock Spaces now".
  isLocked(spaceId) {
    const sp = this.spaceById(spaceId);
    if (!sp) return false;
    const want = sp.locked || (sp.private && this.st.settings.lockPrivate);
    this.unlockedSpaces ||= new Set();
    // A private window you just opened is unlocked; it locks once you're away.
    if (sp.private && !(this._seenPrivate ||= new Set()).has(spaceId)) { this._seenPrivate.add(spaceId); this.unlockedSpaces.add(spaceId); }
    return !!want && !this.unlockedSpaces.has(spaceId);
  }

  anyLockable() {
    return this.st.spaces.some(s => s.locked) || (!!this.st.settings.lockPrivate && this.privateSpaces.size > 0);
  }

  // The current window's Space: cover it if it's locked, uncover it if not.
  showLockIfNeeded() {
    if (!this.cur) return;
    if (this.isLocked(this.curSpaceId)) {
      if (this.overlayMode === 'lock') return;
      if (this.cur.peek) this.closePeek();
      const sp = this.space;
      this.openCommand('lock', '', { lock: { name: sp.name, emoji: sp.emoji || '', private: !!sp.private } });
    } else if (this.overlayMode === 'lock') this.closeCommand(true);
  }

  async unlockSpace(spaceId = this.curSpaceId) {
    const sp = this.spaceById(spaceId);
    if (!sp) return false;
    if (!this.isLocked(spaceId)) { this.showLockIfNeeded(); return true; }
    const ok = await this.verifyUser(sp.private ? 'Quasar wants to unlock your private window.' : `Quasar wants to unlock the “${sp.name}” Space.`);
    if (!ok) return false;
    this.unlockedSpaces.add(spaceId);
    for (const W of this.wins) if (W.spaceId === spaceId) this.withWin(W, () => this.showLockIfNeeded());
    this.push();
    return true;
  }

  lockNow() {
    if (!this.anyLockable()) return this.toast('No Space is set to lock. Right-click a Space › Lock with Windows Hello.');
    (this.unlockedSpaces ||= new Set()).clear();
    this.verifiedUntil = 0;
    for (const W of this.wins) if (!W.win.isDestroyed()) this.withWin(W, () => this.showLockIfNeeded());
  }

  setSpaceLock(spaceId, on) {
    const sp = this.spaceById(spaceId);
    if (!sp || sp.private) return;
    sp.locked = !!on;
    if (on) (this.unlockedSpaces ||= new Set()).add(spaceId);   // you're in it now; it locks when you're away
    this.changed();
    this.toast(on ? `${sp.name} now needs Windows Hello after Windows locks or Quasar has been in the background for ${this.lockAfterMin()} minutes.` : `${sp.name} no longer locks.`);
  }

  lockAfterMin() { return Math.max(1, Number(this.st.settings.lockAfterMin) || 5); }

  startLockWatch() {
    const relock = () => { if (this.anyLockable() && this.unlockedSpaces?.size) this.lockNow(); else this.verifiedUntil = 0; };
    try { powerMonitor.on('lock-screen', relock); powerMonitor.on('suspend', relock); } catch { /* not available */ }
    this.lastFocusAt = Date.now();
    setInterval(() => {
      if (BrowserWindow.getFocusedWindow()) { this.lastFocusAt = Date.now(); return; }
      if (Date.now() - this.lastFocusAt > this.lockAfterMin() * 60e3 && this.unlockedSpaces?.size && this.anyLockable()) {
        this.unlockedSpaces.clear();
        for (const W of this.wins) if (!W.win.isDestroyed()) this.withWin(W, () => this.showLockIfNeeded());
      }
    }, 15e3);
  }

  // ------------------------------------------------------- authenticator codes
  // Pages ask for the logins of their site that have a code; the code is worked out here.
  otpInvoke(s, op, arg) {
    if (op === 'otp:list') return this.vault.forSite(s.profile, s.origin).filter(e => e.otp).map(e => ({ id: e.id, username: e.username }));
    if (op === 'otp:fill') {
      const e = this.vault.get(arg);
      if (!e?.otp || e.profile !== s.profile || siteKey(e.origin) !== siteKey(s.origin)) return null;
      return this.vault.otpCode(e.id)?.code || null;
    }
    return null;
  }

  // ------------------------------------------------- browser identity per site
  // Some sites refuse browsers they don't know. Quasar can tell one site it's Chrome,
  // Edge or Firefox (in the request headers and to the page's scripts).
  identityFor(host) { const s = siteOf(String(host || '').toLowerCase()); return (s && this.st.siteIdentity?.[s]) || null; }

  setIdentity(host, kind) {
    const s = siteOf(String(host || '').toLowerCase().replace(/^www\./, ''));
    if (!s) return;
    const m = this.st.siteIdentity ||= {};
    if (!kind || kind === 'arch') delete m[s]; else if (['chrome', 'edge', 'firefox'].includes(kind)) m[s] = kind;
    this.persist();
    for (const t of this.tabs.values()) {
      const wc = t.view?.webContents;
      const h = hostOf(t.url);
      if (wc && !wc.isDestroyed() && (h === s || h.endsWith('.' + s))) { this.applyIdentity(wc, t.url); wc.reload(); }
    }
    this.toast(m[s] ? `${s} now sees Quasar as ${{ chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox' }[m[s]]}.` : `${s} sees Quasar as itself again.`);
  }

  // The user agent text for an identity ('' = the session's own).
  uaFor(kind, base) {
    const major = String(process.versions.chrome || '140').split('.')[0];
    const chrome = String(base || '').replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`);
    if (kind === 'chrome') return chrome;
    if (kind === 'edge') return chrome + ` Edg/${major}.0.0.0`;
    if (kind === 'firefox') {
      const ff = 140 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 5, 24)) / (28 * 864e5)));   // Firefox ships every 4 weeks
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${ff}.0) Gecko/20100101 Firefox/${ff}.0`;
    }
    return '';
  }

  // Request headers for a site with an identity (called from the request filter).
  identityHeaders(kind, headers, base) {
    const major = String(process.versions.chrome || '140').split('.')[0];
    const ua = this.uaFor(kind, base);
    if (!ua) return headers;
    for (const k of Object.keys(headers)) if (/^user-agent$/i.test(k)) delete headers[k];
    headers['User-Agent'] = ua;
    const brand = { chrome: 'Google Chrome', edge: 'Microsoft Edge' }[kind];
    for (const k of Object.keys(headers)) if (/^sec-ch-ua/i.test(k) && (kind === 'firefox' || /^sec-ch-ua$/i.test(k))) delete headers[k];
    if (brand) headers['sec-ch-ua'] = `"${brand}";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
    return headers;
  }

  // What the page's own scripts see (navigator.userAgent): set before each navigation.
  applyIdentity(wc, url) {
    if (!wc || wc.isDestroyed()) return;
    const kind = this.identityFor(hostOf(url));
    const base = wc.session.getUserAgent();
    const want = kind ? this.uaFor(kind, base) : base;
    try { if (wc.getUserAgent() !== want) wc.setUserAgent(want); } catch { /* ignore */ }
  }
}

module.exports = PrivacyPart;
