// Quasar's own pages and prompts: crashes, hung pages, dangerous-site / HTTPS / offline pages, sign-in pop-ups, certificate errors and the site info panel.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const { Menu, clipboard, session, dialog, screen } = require('electron');
const { fileURLToPath } = require('url');
const { promptLogin } = require('../auth-prompt');
const { siteOf } = require('../protection');
const { CERT_PAGE, CRASH_PAGE, BLOCK_PAGE, READER_PAGE, FAIL_PAGE, uid, summarizeCert } = require('./common');

class WarningsPart {
  // ----------------------------------------------- crashed and hung pages
  isCrashPage(url) {
    if (!url || !/^file:/i.test(url)) return false;
    try { return path.normalize(fileURLToPath(url.split(/[?#]/)[0])).toLowerCase() === path.normalize(CRASH_PAGE).toLowerCase(); } catch { return false; }
  }

  onCrash(wc, details) {
    if (wc.isDestroyed() || details?.reason === 'clean-exit') return;
    const tab = this.pageTabs.get(wc.id);
    const prev = this.crashInfo.get(wc.id);
    const url = (this.isCrashPage(wc.getURL()) ? prev?.url : null) || tab?.url || wc.getURL();
    // Crashing again soon after a reload counts up (the page says so).
    const count = prev && Date.now() - prev.at < 120e3 ? prev.count + 1 : 1;
    const reason = this.stoppedByUser?.delete(wc.id) ? 'killed' : (details?.reason || 'crashed');   // "Stop page" on a hung page
    this.crashInfo.set(wc.id, { url, reason, exitCode: details?.exitCode, count, at: Date.now() });
    if (tab) { tab.crashed = true; tab.audible = false; tab.loading = false; tab.pip = false; }
    for (const [k, id] of this.hung) if (id === wc.id) this.hung.delete(k);
    // On screen now: show the crash page right away; otherwise when the tab is next shown.
    const onScreen = !tab || tab.kind === 'little' || tab.kind === 'peek' || !!this.hostOf(tab.id);
    if (onScreen) this.showCrashPage(wc);
    this.push();
  }

  showCrashPage(wc) {
    const info = this.crashInfo.get(wc.id);
    if (!info || wc.isDestroyed()) return;
    let host = '';
    try { host = new URL(info.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    wc.loadFile(CRASH_PAGE, { query: { host, reason: info.reason, n: String(info.count) } }).catch(() => {});
  }

  // Buttons on the crash page signal by replacing its #hash.
  crashPageAction(wc, action) {
    const info = this.crashInfo.get(wc.id);
    const tab = this.pageTabs.get(wc.id);
    if (action === 'reload' && info) {
      if (tab) tab.crashed = false;
      wc.loadURL(info.url).catch(() => {});
    } else if (action === 'close') {
      if (tab && this.tabs.has(tab.id)) this.closeTab(tab.id, { force: true });
      else if (tab?.kind === 'little') { for (const l of this.littles.values()) if (l.tab === tab) l.win.destroy(); }
      else if (tab?.kind === 'peek') this.withWin(this.wins.has(this.cur) ? this.cur : null, () => this.closePeek());
    }
  }

  // Turn ad/tracker blocking off (or back on) for one site, then reload it.
  setAdsAllowed(host, allowed) {
    const { siteOf } = require('../protection');
    const s = siteOf(host);
    if (!s) return;
    this.st.adAllow = this.st.adAllow.filter(x => x !== s);
    if (allowed) this.st.adAllow.push(s);
    this.persist();
    this.active?.view?.webContents?.reload();
    this.toast(allowed ? `Ads and trackers are allowed on ${s}.` : `Blocking ads and trackers on ${s} again.`);
  }

  // ------------------------------- dangerous sites and Always-HTTPS pages
  isBlockPage(url) {
    if (!url || !/^file:/i.test(url)) return false;
    try { return path.normalize(fileURLToPath(url.split(/[?#]/)[0])).toLowerCase() === path.normalize(BLOCK_PAGE).toLowerCase(); } catch { return false; }
  }
  // Any of Quasar's own warning pages shown inside a tab.
  isArchPage(url) { return this.isCertPage(url) || this.isCrashPage(url) || this.isBlockPage(url) || this.isReaderPage(url) || this.isFailPage(url); }

  // ----------------------------------- pages that fail to load (offline etc.)
  isFailPage(url) {
    if (!url || !/^file:/i.test(url)) return false;
    try { return path.normalize(fileURLToPath(url.split(/[?#]/)[0])).toLowerCase() === path.normalize(FAIL_PAGE).toLowerCase(); } catch { return false; }
  }

  showFailPage(wc, url, code, desc) {
    if (wc.isDestroyed()) return;
    // -3 = aborted (download, redirect, user stopped it): not an error worth a page.
    // Quasar's own pages, about:, data: etc. never get one either.
    if (code === -3 || !/^https?:/i.test(url || '')) return;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    this.failInfo.set(wc.id, { url, code });
    wc.loadFile(FAIL_PAGE, { query: { host, code: String(code), error: String(desc || '') } }).catch(() => {});
    this.push();
  }

  // arch://drift: the same page, opened straight into the game.
  isDriftPage(url) { return this.isFailPage(url) && /[?&]game=1(&|#|$)/.test(url); }

  // Buttons on the page signal by replacing its #hash.
  failPageAction(wc, action) {
    if (this.isDriftPage(wc.getURL())) { if (action === 'retry') wc.reload(); return; }
    const info = this.failInfo.get(wc.id);
    if (!info) return;
    if (action === 'retry') {
      wc.loadURL(info.url).catch(() => {});
    } else if (action === 'back') {
      const nav = wc.navigationHistory;
      const entries = nav.getAllEntries();
      let i = nav.getActiveIndex() - 1;
      while (i >= 0 && (entries[i].url === info.url || this.isArchPage(entries[i].url))) i--;
      if (i >= 0) nav.goToIndex(i); else wc.loadURL('about:blank').catch(() => {});
    }
  }
  isReaderPage(url) {
    if (!url || !/^file:/i.test(url)) return false;
    try { return path.normalize(fileURLToPath(url.split(/[?#]/)[0])).toLowerCase() === path.normalize(READER_PAGE).toLowerCase(); } catch { return false; }
  }

  // --------------------------------------------------- password pop-ups
  // HTTP basic/digest auth and proxy sign-in: ask in a small Quasar dialog.
  onLogin(event, wc, details, authInfo, callback) {
    event.preventDefault();
    let answered = false;
    const answer = (u, p) => { if (answered) return; answered = true; if (u == null) callback(); else callback(u, p); };
    const tab = wc && !wc.isDestroyed() ? this.pageTabs.get(wc.id) : null;
    this.authQueue = this.authQueue.then(async () => {
      if (wc && wc.isDestroyed()) return answer();
      if (tab && this.tabs.has(tab.id) && tab.id !== this.activeTabId && !authInfo.isProxy) this.show(tab.id);
      const win = this.windowFor(tab, wc);
      let url = details?.url || '';
      let scheme = '';
      try { const u = new URL(url); scheme = u.protocol.replace(':', ''); url = u.origin; } catch { /* keep as-is */ }
      const r = await promptLogin(win, {
        host: authInfo.host + (authInfo.port && ![80, 443].includes(authInfo.port) ? ':' + authInfo.port : ''),
        origin: url, realm: authInfo.realm || '', isProxy: !!authInfo.isProxy,
        insecure: !authInfo.isProxy && scheme === 'http',
      });
      if (r) answer(r.username, r.password); else answer();
    }).catch(() => answer());
  }

  // -------------------------------------------------- certificate errors
  certKey(partition, host) { return `${partition || ''}|${String(host || '').toLowerCase()}`; }

  onCertError(event, wc, url, error, certificate, callback, isMainFrame) {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    const partition = wc?.session?.__archPartition;
    const ok = this.certExceptions.get(this.certKey(partition, host));
    if (ok && (ok.has(certificate?.fingerprint) || ok.has('*'))) {
      event.preventDefault();
      return callback(true);
    }
    if (wc && isMainFrame !== false) this.certPending.set(wc.id, { url, host, error, cert: summarizeCert(certificate) });
    callback(false);   // subresources with bad certificates are simply blocked, like Chrome
  }

  showCertError(wc, url, code, desc) {
    if (wc.isDestroyed()) return;
    const pending = this.certPending.get(wc.id);
    this.certPending.delete(wc.id);
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    const usable = pending && pending.host === host;
    const error = (usable && pending.error) || desc || `Error ${code}`;
    this.certErrors.set(wc.id, {
      url, host, error, cert: usable ? pending.cert : null,
      canProceed: !!usable, partition: wc.session.__archPartition,
    });
    wc.loadFile(CERT_PAGE, { query: { host, error: String(error).replace(/^net::/, ''), p: usable ? '1' : '0' } }).catch(() => {});
    this.push();
  }

  isCertPage(url) {
    if (!url || !/^file:/i.test(url)) return false;
    try { return path.normalize(fileURLToPath(url.split(/[?#]/)[0])).toLowerCase() === path.normalize(CERT_PAGE).toLowerCase(); } catch { return false; }
  }

  // The warning page signals its buttons by replacing its #hash.
  certPageAction(wc, action) {
    const ce = this.certErrors.get(wc.id);
    if (!ce) return;
    if (action === 'proceed' && ce.canProceed) {
      const key = this.certKey(ce.partition, ce.host);
      if (!this.certExceptions.has(key)) this.certExceptions.set(key, new Set());
      this.certExceptions.get(key).add(ce.cert?.fingerprint || '*');
      wc.loadURL(ce.url).catch(() => {});
    } else if (action === 'back') {
      // Skip the failed attempt just before the warning page, or "back" would hit the error again.
      const nav = wc.navigationHistory;
      const entries = nav.getAllEntries();
      let i = nav.getActiveIndex() - 1;
      while (i >= 0 && (entries[i].url === ce.url || this.isCertPage(entries[i].url))) i--;
      if (i >= 0) nav.goToIndex(i); else wc.loadURL('about:blank').catch(() => {});
    }
  }

  // Once we've moved on, remove warning pages (and the failed attempt that led
  // to each one) from back/forward history.
  dropCertPages(wc, failedUrl) {
    const nav = wc.navigationHistory;
    if (typeof nav?.removeEntryAtIndex !== 'function') return;
    try {
      const entries = nav.getAllEntries();
      const drop = new Set();
      entries.forEach((en, i) => {
        if (this.isCrashPage(en.url) || this.isBlockPage(en.url) || (this.isFailPage(en.url) && !this.isDriftPage(en.url))) return drop.add(i);   // Quasar's crash / warning pages
        if (!this.isCertPage(en.url)) return;
        drop.add(i);
        if (failedUrl && i > 0 && entries[i - 1].url === failedUrl) drop.add(i - 1);
      });
      for (const i of [...drop].sort((a, b) => b - a)) {
        if (i !== nav.getActiveIndex()) nav.removeEntryAtIndex(i);
      }
    } catch { /* ignore */ }
  }

  rememberCert(partition, host, cert, result) {
    if (!host || !cert) return;
    const key = this.certKey(partition, host);
    this.certInfo.delete(key);
    this.certInfo.set(key, { ...summarizeCert(cert), result });
    if (this.certInfo.size > 500) this.certInfo.delete(this.certInfo.keys().next().value);
  }

  // ------------------------------------------------------ site info panel
  // secure | warning (cert error accepted) | danger (warning page) | insecure (http) | local | none
  securityOf(tab) {
    if (!tab?.url) return 'none';
    const wc = tab.view?.webContents;
    if (wc && !wc.isDestroyed() && this.certErrors.has(wc.id) && this.isCertPage(wc.getURL())) return 'danger';
    if (wc && !wc.isDestroyed() && this.isBlockPage(wc.getURL())) return this.protection.blocked.get(wc.id)?.kind === 'https' ? 'insecure' : 'danger';
    let u;
    try { u = new URL(tab.url); } catch { return 'local'; }
    if (u.protocol === 'https:' || u.protocol === 'wss:') {
      return this.certExceptions.has(this.certKey(tab.profile, u.hostname)) ? 'warning' : 'secure';
    }
    if (u.protocol === 'http:' || u.protocol === 'ws:') return 'insecure';
    return 'local';
  }

  // Padlock / site-info panel for the current tab.
  siteInfo(x, y) {
    const tab = this.active;
    if (!tab) return;
    const wc = tab.view?.webContents;
    const sec = this.securityOf(tab);
    let u = null;
    try { u = new URL(tab.url); } catch { /* ignore */ }
    const host = u?.hostname || '';
    const sep = { type: 'separator' };
    const head = {
      secure: ['Connection is secure', 'Your information (for example, passwords or card numbers) is private when it is sent to this site.'],
      warning: ['Not secure', 'You chose to ignore a certificate error on this site. Someone may be able to see or change what you send.'],
      danger: ['Your connection isn’t private', 'This site’s certificate couldn’t be trusted, so Quasar stopped loading it.'],
      insecure: ['Not secure', 'This site doesn’t use HTTPS. Don’t enter passwords or card details here.'],
      local: ['Local or built-in page', 'This page isn’t loaded from the internet.'],
      none: ['No page', ''],
    }[sec];
    const items = [{ label: head[0], enabled: false }];
    if (host) items.push({ label: host, enabled: false });
    if (head[1]) items.push({ label: head[1], enabled: false });

    const ce = wc && this.certErrors.get(wc.id);
    const cert = (sec === 'danger' ? ce?.cert : null) || this.certInfo.get(this.certKey(tab.profile, host));
    if (cert && /^(https|wss):$/.test(u?.protocol || '')) {
      const day = ms => (ms ? new Date(ms).toLocaleDateString() : '—');
      items.push(sep, {
        label: 'Certificate', submenu: [
          { label: `Issued to: ${cert.subject || '—'}`, enabled: false },
          ...(cert.org ? [{ label: `Organization: ${cert.org}`, enabled: false }] : []),
          { label: `Issued by: ${cert.issuer || '—'}`, enabled: false },
          { label: `Valid from: ${day(cert.validStart)}`, enabled: false },
          { label: `Valid until: ${day(cert.validExpiry)}`, enabled: false },
          ...(cert.result && cert.result !== 'net::OK' ? [{ label: `Problem: ${cert.result.replace(/^net::/, '')}`, enabled: false }] : []),
          sep,
          { label: 'Copy SHA-256 fingerprint', enabled: !!cert.fingerprint, click: () => clipboard.writeText(String(cert.fingerprint).replace(/^sha256\//, '')) },
        ],
      });
    }
    if (sec === 'warning') {
      items.push({ label: `Turn certificate warnings back on for ${host}`, click: () => {
        this.certExceptions.delete(this.certKey(tab.profile, host));
        wc?.reload();
        this.push();
      } });
    }

    // Site permissions this Space has decided (camera, location, …).
    if (u && /^https?:$/.test(u.protocol)) {
      const names = { media: 'Camera and microphone', geolocation: 'Location', notifications: 'Notifications', midi: 'MIDI devices',
        midiSysex: 'MIDI devices (full control)', 'clipboard-read': 'Clipboard', 'display-capture': 'Screen sharing', 'idle-detection': 'Idle detection' };
      const prefix = `${tab.profile}|${u.origin}|`;
      const own = ['sound', 'popups', 'automatic-downloads'];   // shown as Site settings below
      const perms = [...this.permissions].filter(([k]) => k.startsWith(prefix) && !own.includes(k.slice(prefix.length)));
      items.push(sep, { label: 'Site settings', enabled: false }, ...this.siteSettingItems(tab));
      items.push(sep, { label: 'Permissions', enabled: false });
      if (!perms.length) items.push({ label: 'No permissions asked for yet', enabled: false });
      for (const [k, allowed] of perms) {
        const perm = k.slice(prefix.length);
        if (perm.startsWith('external:')) names[perm] = `Open “${perm.slice(9)}:” links in another app`;
        items.push({ label: `${names[perm] || perm}: ${allowed ? 'Allowed' : 'Blocked'}`, submenu: [
          { label: 'Allow', type: 'radio', checked: allowed, click: () => this.setPermission(k, true) },
          { label: 'Block', type: 'radio', checked: !allowed, click: () => this.setPermission(k, false) },
          { label: 'Ask next time', type: 'radio', checked: false, click: () => this.setPermission(k, null) },
        ] });
      }
      if (perms.length) items.push({ label: 'Reset permissions', click: () => { for (const [k] of perms) this.permissions.delete(k); this.savePermissions(); wc?.reload(); } });
      const f = wc && !wc.isDestroyed() ? wc.getZoomFactor() : 1;
      if (Math.abs(f - 1) > 0.001) items.push({ label: `Zoom: ${Math.round(f * 100)}% — reset to 100%`, click: () => this.zoom(0, tab) });
      items.push(sep, { label: `Forget ${siteOf(host) || host}…`, click: () => this.forgetSite(tab) },
        { label: 'Forget This Site When I Close It', type: 'checkbox', checked: this.forgetsOnClose(host), click: () => this.toggleForgetOnClose(host) },
        { label: 'Never Put This Site to Sleep', type: 'checkbox', checked: this.neverSleeps(tab.url), click: () => this.toggleNeverSleep(host) },
        { label: 'Tell This Site I’m Using', submenu: ['arch', 'chrome', 'edge', 'firefox'].map(k => ({ label: { arch: 'Quasar (default)', chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox' }[k],
          type: 'radio', checked: (this.identityFor(host) || 'arch') === k, click: () => this.setIdentity(host, k) })) });
    }
    // Ad and tracker blocking on this site.
    if (u && /^https?:$/.test(u.protocol) && this.protection.adsOn) {
      const n = wc && !wc.isDestroyed() ? (this.protection.counts.get(wc.id) || 0) : 0;
      const allowed = this.protection.adsAllowed(u.hostname);
      items.push(sep,
        { label: allowed ? 'Ad and tracker blocking: off on this site' : `Blocked ${n} ad${n === 1 ? '' : 's'} and tracker${n === 1 ? '' : 's'} on this page`, enabled: false },
        { label: allowed ? 'Block ads and trackers on this site' : 'Allow ads and trackers on this site', click: () => this.setAdsAllowed(u.hostname, !allowed) });
    }
    if (u && /^https?:$/.test(u.protocol) && !this.isPrivate) {
      const site = u.hostname.replace(/^www\./, '');
      const boosts = this.boostsFor(tab.url, tab.spaceId);
      const rule = this.st.atc.find(r => r.enabled !== false && this.ruleMatches(r.pattern, tab.url));
      items.push(sep,
        { label: boosts.length ? `Boosts on this site (${boosts.length})…` : 'Boost this site (custom CSS)…', click: () => this.openLibrary('boosts', { pattern: site }) },
        { label: 'Always open this site in', submenu: [
          ...this.st.spaces.map(s => ({ label: `${s.emoji || ''} ${s.name}`.trim(), type: 'radio', checked: rule?.spaceId === s.id,
            click: () => { this.st.atc = this.st.atc.filter(r => r.pattern !== site); this.st.atc.push({ id: uid(), pattern: site, spaceId: s.id, enabled: true }); this.persist(); this.libUpdate(); this.toast(`Links to ${site} will open in ${s.name}.`); } })),
          { type: 'separator' },
          { label: 'Any Space (no rule)', type: 'radio', checked: !rule, click: () => { this.st.atc = this.st.atc.filter(r => r.pattern !== site); this.persist(); this.libUpdate(); } },
        ] });
    }
    items.push(sep, { label: 'All site settings…', click: () => this.openLibrary('sites') }, this.siteToolPinMenu(x, y));
    Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  // "Forget this site": everything this profile kept about the site (all its
  // subdomains): cookies and logins, site storage, cache, history, the text kept for
  // history search, archived and recently closed tabs, the downloads list entries,
  // permissions, device access, zoom and certificate choices. Then its open tabs reload,
  // as if you'd never been there. Your own choices for the site (Boosts, Air Traffic
  // Control, dark mode, ads allowed) and things you saved on purpose (pinned tabs,
  // Favorites, passwords, Read Later, notes) stay.
  async forgetSite(tab, { confirm = true, parent = this.win, quiet = false } = {}) {
    let u;
    try { u = new URL(tab.url); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const site = siteOf(u.hostname) || u.hostname;
    const onSite = url => { try { const h = new URL(url).hostname.toLowerCase(); return h === site || h.endsWith('.' + site); } catch { return false; } };
    if (confirm) {
      const { response } = await dialog.showMessageBox(parent, {
        type: 'warning', buttons: ['Forget site', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
        message: `Forget ${site}?`,
        detail: `Quasar removes everything it kept about ${site} in this profile: cookies and logins, site storage and cache, history, archived and recently closed tabs, permissions and zoom. You’ll be signed out, and its open tabs reload as if you’d never visited.\n\nPinned tabs, Favorites, saved passwords, Read Later, notes and your settings for the site (Boosts, dark mode…) stay.`,
      });
      if (response !== 0) return null;
    }
    const part = tab.profile;
    const priv = this.privateSpaces.has(tab.spaceId);
    const ses = session.fromPartition(priv ? part : 'persist:' + part);
    const spaces = priv ? [this.spaceById(tab.spaceId)] : this.st.spaces.filter(s => s.partition === part);
    const spaceIds = new Set(spaces.map(s => s.id));
    // Every origin of the site this profile has seen.
    const isIp = /^[\d.]+$|^\[|:/.test(site);   // no "www." version of an IP address
    const origins = new Set([u.origin, `https://${site}`, `http://${site}`, ...(isIp ? [] : [`https://www.${site}`, `http://www.${site}`])]);
    for (const sp of spaces) for (const h of sp.history || []) if (onSite(h.url)) { try { origins.add(new URL(h.url).origin); } catch { /* ignore */ } }
    for (const t of this.tabs.values()) if (t.profile === part && onSite(t.url)) { try { origins.add(new URL(t.url).origin); } catch { /* ignore */ } }
    let n = 0;
    try {
      // Storage, cache and cookies for those origins.
      // (one origin Chromium won't take mustn't stop the rest, or the cookies below)
      try { if (typeof ses.clearData === 'function') await ses.clearData({ origins: [...origins] }); else throw new Error('old'); }
      catch { for (const o of origins) await ses.clearStorageData({ origin: o }).catch(() => {}); }
      const cookies = (await ses.cookies.get({})).filter(c => { const d = c.domain.replace(/^\./, '').toLowerCase(); return d === site || d.endsWith('.' + site); });
      await Promise.all(cookies.map(c => ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`, c.name).catch(() => {})));
      n += cookies.length;
    } catch (err) { this.toast(`Couldn’t clear all of ${site}’s data: ${err.message}`); }
    // History and the page text kept for history search.
    for (const sp of spaces) { const before = (sp.history || []).length; sp.history = (sp.history || []).filter(h => !onSite(h.url)); n += before - sp.history.length; }
    const ht = !priv && this._htext?.get(part) || (!priv && this.historySearchOn ? this.historyText(part) : null);
    if (ht) { for (const k of Object.keys(ht)) if (onSite(k)) delete ht[k]; this.saveHistoryText(part); }
    // Archived and recently closed tabs, and the downloads list (the files stay).
    this.st.archive = this.st.archive.filter(a => !(spaceIds.has(a.spaceId) && onSite(a.url)));
    this.closed = this.closed.filter(c => !(spaceIds.has(c.spaceId) && onSite(c.url)));
    this.st.downloads = this.st.downloads.filter(d => !(d.partition === part && onSite(d.url)) || this.liveDownloads.has(d.id));
    // Permissions, device access, zoom, certificate choices, "continue anyway" choices.
    for (const k of [...this.permissions.keys()]) { const [p, origin] = k.split('|'); if (p === part && onSite(origin)) this.permissions.delete(k); }
    for (const k of Object.keys(this.st.deviceGrants || {})) { const [p, origin] = k.split('|'); if (p === part && onSite(origin)) delete this.st.deviceGrants[k]; }
    for (const h of Object.keys(this.st.zoom[part] || {})) if (onSite('https://' + h)) delete this.st.zoom[part][h];
    for (const m of [this.certExceptions, this.certInfo]) for (const k of [...m.keys()]) { const [p, h] = k.split('|'); if (p === part && onSite('https://' + h)) m.delete(k); }
    for (const s of [this.protection.httpOk, this.protection.dangerOk]) for (const k of [...s]) { const [p, h] = k.split('|'); if (p === part && onSite('https://' + h)) s.delete(k); }
    this.savePermissions();
    this.downloadsChanged(true);
    // Its open pages start fresh.
    for (const t of this.tabs.values()) {
      const wc = t.view?.webContents;
      if (t.profile === part && onSite(t.url) && wc && !wc.isDestroyed()) { t.forgotUrl = t.url; wc.reload(); }   // (that reload isn't a visit to record)
    }
    this.changed();
    this.libUpdate();
    if (!quiet) this.toast(`Forgot ${site}: its cookies, site data and history are gone from this profile.`);
    return { site, origins: [...origins], removed: n };
  }

  async clearSiteData(tab, origin, host, parent = this.win) {
    const { response } = await dialog.showMessageBox(parent, {
      type: 'warning', buttons: ['Clear', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      message: `Clear cookies and site data for ${host}?`,
      detail: 'You’ll be signed out of this site in this Space. Other sites and Spaces aren’t affected.',
    });
    if (response !== 0) return;
    try {
      const ses = session.fromPartition(this.privateSpaces.has(tab.spaceId) ? tab.profile : 'persist:' + tab.profile);
      await ses.clearStorageData({ origin });
      const cookies = await ses.cookies.get({ domain: host.replace(/^www\./, '') });
      await Promise.all(cookies.map(c => ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`, c.name).catch(() => {})));
      this.toast(`Cleared site data for ${host}`);
      tab.view?.webContents.reload();
    } catch (err) { this.toast(`Couldn’t clear site data: ${err.message}`); }
  }
}

module.exports = WarningsPart;
