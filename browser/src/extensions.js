// Chrome extensions in Quasar.
//
// Electron itself loads unpacked extensions (content scripts, background service
// workers, storage, runtime messaging…). electron-chrome-extensions adds the parts
// Electron lacks (chrome.tabs, chrome.windows, toolbar buttons and popups,
// chrome.contextMenus, …) by connecting them to Quasar's tabs and windows.
//
// Extensions are installed into %APPDATA%\Quasar\extensions\<id>\ and loaded into
// every Space (not private windows, as in Chrome) unless turned off for a Space
// in Library › Extensions. Sources:
//   - the Chrome Web Store (a link or ID; downloaded from Google's update server)
//   - a .crx file, or an unpacked folder (developer mode)
//   - Arc's installed extensions (copied from Arc's profile folders)

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { app, net, session: electronSession } = require('electron');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');

// Chrome's own helper extensions that Arc/Chrome profiles contain; not useful here.
const SKIP_IDS = new Set(['nmmhkkegccagdldgiimedpiccmgmieda', 'ghbmnnjooekpmoecnnnilnnbdlolhkhi', 'pkedcjkdefgpdelpbcmbmeomcjbeemfm']);
const ID_RE = /^[a-p]{32}$/;

const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, maxBuffer: 8e6 }, (err, so, se) => (err ? reject(new Error(String(se || err.message).trim())) : resolve(so))));
const api = ses => ses.extensions || ses;   // Electron 36+ moved these to session.extensions

// The Web Store ID from a store link or a bare ID.
function storeId(text) {
  const m = String(text || '').match(/(?:^|\/)([a-p]{32})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

// A .crx is a small header followed by a normal zip file.
function crxToZip(buf) {
  if (buf.length > 16 && buf.toString('ascii', 0, 4) === 'Cr24') {
    const version = buf.readUInt32LE(4);
    if (version === 3) return buf.subarray(12 + buf.readUInt32LE(8));
    if (version === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
    throw new Error(`unsupported CRX version ${version}`);
  }
  if (buf.toString('ascii', 0, 2) === 'PK') return buf;   // already a zip
  throw new Error('this isn’t a Chrome extension package');
}

// The extension's public key from a CRX3 header (protobuf: field 2 = RSA key proofs
// {1: public_key}, field 10000 = signed data {1: crx_id}). Written into manifest.json
// as "key" so Electron gives the extension its real Chrome ID.
function crxPublicKey(buf) {
  if (buf.toString('ascii', 0, 4) !== 'Cr24' || buf.readUInt32LE(4) !== 3) return null;
  const header = buf.subarray(12, 12 + buf.readUInt32LE(8));
  const fields = b => {
    const out = [];
    for (let i = 0; i < b.length;) {
      let key = 0, shift = 0, x;
      do { x = b[i++]; key += (x & 0x7f) * 2 ** shift; shift += 7; } while (x & 0x80);
      const field = Math.floor(key / 8), wire = key % 8;
      if (wire === 2) {
        let len = 0; shift = 0;
        do { x = b[i++]; len += (x & 0x7f) * 2 ** shift; shift += 7; } while (x & 0x80);
        out.push({ field, data: b.subarray(i, i + len) }); i += len;
      } else if (wire === 0) { do { x = b[i++]; } while (x & 0x80); }
      else if (wire === 5) i += 4; else if (wire === 1) i += 8; else break;
    }
    return out;
  };
  const top = fields(header);
  const signed = top.find(f => f.field === 10000);
  const crxId = signed ? fields(signed.data).find(f => f.field === 1)?.data : null;
  const idOf = key => [...require('crypto').createHash('sha256').update(key).digest().subarray(0, 16)].map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
  const wantId = crxId ? [...crxId].map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('') : null;
  for (const proof of top.filter(f => f.field === 2)) {
    const pub = fields(proof.data).find(f => f.field === 1)?.data;
    if (pub && (!wantId || idOf(pub) === wantId)) return pub.toString('base64');
  }
  return null;
}

function readManifest(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  // Names like "__MSG_appName__" come from _locales.
  const msg = key => {
    const want = String(key).replace(/^__MSG_|__$/g, '').toLowerCase();
    for (const loc of [app.getLocale().replace('-', '_'), app.getLocale().split('-')[0], m.default_locale, 'en'].filter(Boolean)) {
      try {
        const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8').replace(/^﻿/, ''));
        const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === want);
        if (hit) return hit[1].message;
      } catch { /* next */ }
    }
    return key;
  };
  const t = s => (typeof s === 'string' && s.startsWith('__MSG_') ? msg(s) : s);
  return { ...m, name: t(m.name) || 'Extension', description: t(m.description) || '', short_name: t(m.short_name) };
}

function iconDataUrl(dir, manifest) {
  const icons = manifest.icons || manifest.action?.default_icon || manifest.browser_action?.default_icon || {};
  const list = typeof icons === 'string' ? [[48, icons]] : Object.entries(icons).map(([k, v]) => [Number(k), v]).sort((a, b) => Math.abs(a[0] - 48) - Math.abs(b[0] - 48));
  for (const [, rel] of list) {
    try {
      const file = path.join(dir, rel);
      const ext = path.extname(file).slice(1).toLowerCase();
      return `data:image/${ext === 'svg' ? 'svg+xml' : ext || 'png'};base64,` + fs.readFileSync(file).toString('base64');
    } catch { /* next */ }
  }
  return '';
}

// Chrome extension features Quasar (Electron + electron-chrome-extensions) doesn't have.
// Shown before installing and in the Extensions list, so nobody is left wondering.
const UNSUPPORTED = {
  declarativeNetRequest: 'blocking rules (declarativeNetRequest) — how most Manifest V3 ad and tracker blockers work',
  declarativeNetRequestWithHostAccess: 'blocking rules (declarativeNetRequest)',
  declarativeNetRequestFeedback: 'blocking rules (declarativeNetRequest)',
  sidePanel: 'a side panel',
  offscreen: 'offscreen documents',
  identity: 'signing in with chrome.identity',
  tabCapture: 'recording tabs', desktopCapture: 'recording the screen', pageCapture: 'saving pages',
  proxy: 'proxy settings', privacy: 'privacy settings', contentSettings: 'site settings', fontSettings: 'font settings',
  debugger: 'the debugger', nativeMessaging: 'talking to apps on your PC',
  history: 'your browsing history', bookmarks: 'bookmarks', downloads: 'downloads', readingList: 'the reading list',
  sessions: 'recently closed tabs', topSites: 'most visited sites', search: 'the search engine', tts: 'text to speech', ttsEngine: 'text to speech',
  userScripts: 'user scripts', gcm: 'push messages', enterprise: 'enterprise features',
};
function unsupported(m) {
  const perms = [...(m.permissions || []), ...(m.optional_permissions || [])].filter(p => typeof p === 'string');
  const out = new Map();
  for (const p of perms) { const base = p.split('.')[0]; if (UNSUPPORTED[base]) out.set(UNSUPPORTED[base], true); }
  if (m.declarative_net_request) out.set(UNSUPPORTED.declarativeNetRequest, true);
  if (m.side_panel) out.set(UNSUPPORTED.sidePanel, true);
  if (m.chrome_url_overrides) out.set('replacing the new tab or history page', true);
  if (m.omnibox) out.set('address bar keywords (omnibox)', true);
  return [...out.keys()];
}

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

class Extensions {
  constructor(shell) {
    this.shell = shell;
    this.dir = path.join(app.getPath('userData'), 'extensions');
    this.bySession = new Map();     // session -> ElectronChromeExtensions
    this.errors = {};               // id -> last load error
    this.crxHandled = false;
  }

  get list() { return (this.shell.st.extensions ||= []); }
  get enabledList() { return this.list.filter(e => e.enabled !== false && fs.existsSync(path.join(e.path, 'manifest.json'))); }
  // Extensions can be turned off for single Spaces. Spaces that share a profile share
  // one browser session, so the switch applies to that profile (all its Spaces).
  onFor(e, partition) { return e.enabled !== false && !(e.offIn || []).includes(partition); }
  enabledFor(partition) { return this.enabledList.filter(e => this.onFor(e, partition)); }

  // Called for each Space's session (from Shell.setupSession).
  setupSession(ses, partition, isPrivate) {
    if (isPrivate || this.bySession.has(ses)) return;
    const S = this.shell;
    const ext = new ElectronChromeExtensions({
      session: ses,
      createTab: async details => {
        const spaceId = S.allSpaces.find(s => s.partition === partition)?.id || S.curSpaceId;
        const t = S.newTab(details.url || 'about:blank', { spaceId, active: details.active !== false });
        const W = S.hostOf(t.id) || S.cur;
        return [t.view.webContents, W.win];
      },
      // Only when an extension asks (chrome.tabs.update { active }) — the library also calls
      // this while Quasar is just registering a tab, which must not show background tabs.
      selectTab: wc => {
        if (this.registering) return;
        const t = S.pageTabs.get(wc.id);
        if (t && S.tabs.has(t.id) && S.activeTabId !== t.id) S.withWin(S.hostOf(t.id) || S.cur, () => S.show(t.id));
      },
      removeTab: wc => { const t = S.pageTabs.get(wc.id); if (t && S.tabs.has(t.id)) S.closeTab(t.id); },
      createWindow: async details => {
        const url = Array.isArray(details.url) ? details.url[0] : details.url;
        const W = S.newWindow(url ? { url } : {});
        return W.win;
      },
      removeWindow: win => { for (const W of S.wins) if (W.win === win) W.win.close(); },
      assignTabDetails: (details, wc) => {
        const t = S.pageTabs.get(wc.id);
        if (t) { details.discarded = !!t.sleeping; details.pinned = t.kind === 'pinned'; }
      },
    });
    this.bySession.set(ses, ext);
    if (!this.crxHandled) { ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession); this.crxHandled = true; }
    for (const e of this.enabledList) this.loadInto(ses, e);
  }

  async loadInto(ses, e) {
    if (!this.onFor(e, ses.__archPartition)) return;   // turned off for this Space
    try {
      if (api(ses).getExtension?.(e.id)) return;
      const loaded = await api(ses).loadExtension(e.path, { allowFileAccess: false });
      if (loaded?.id && loaded.id !== e.id && !e.idFixed) { e.id = loaded.id; e.idFixed = true; this.shell.persist(); }
      delete this.errors[e.id];
    } catch (err) { this.errors[e.id] = err.message; }
    this.changed();
  }

  unloadFrom(ses, id) { try { if (api(ses).getExtension?.(id)) api(ses).removeExtension(id); } catch { /* ignore */ } }

  // Quasar tells the library about its tabs.
  addTab(wc, win) {
    const ext = this.bySession.get(wc.session);
    if (!ext || !win || win.isDestroyed()) return;
    this.registering = true;
    try { ext.addTab(wc, win); } catch { /* ignore */ } finally { this.registering = false; }
  }
  selectTab(wc) {
    const ext = this.bySession.get(wc.session);
    if (!ext) return;
    this.registering = true;   // Quasar already shows it; don't echo back
    try { ext.selectTab(wc); } catch { /* ignore */ } finally { this.registering = false; }
  }
  contextMenuItems(wc, params) {
    const ext = this.bySession.get(wc.session);
    try { return ext ? ext.getContextMenuItems(wc, params) : []; } catch { return []; }
  }

  changed() { this.shell.push(); this.shell.libUpdate(); }

  info(e) {
    let m = {};
    try { m = readManifest(e.path); } catch { /* missing */ }
    return {
      id: e.id, name: m.name || e.name, version: m.version || e.version, description: m.description || '', enabled: e.enabled !== false,
      source: e.source, icon: iconDataUrl(e.path, m), mv: m.manifest_version || 2, options: m.options_ui?.page || m.options_page || null,
      permissions: [...new Set([...(m.permissions || []), ...(m.host_permissions || [])])].slice(0, 12), error: this.errors[e.id] || null,
      missing: !fs.existsSync(path.join(e.path, 'manifest.json')), offIn: e.offIn || [], limits: unsupported(m),
    };
  }

  // Turn an extension on or off for one Space's profile.
  async setSpaceEnabled(id, partition, on) {
    const e = this.list.find(x => x.id === id);
    if (!e || !partition) return;
    e.offIn = (e.offIn || []).filter(p => p !== partition);
    if (!on) e.offIn.push(partition);
    this.shell.persist();
    for (const ses of this.bySession.keys()) {
      if (ses.__archPartition !== partition) continue;
      if (on) await this.loadInto(ses, e); else this.unloadFrom(ses, id);
    }
    this.changed();
  }

  // Ask before installing something that won't fully work. confirm(manifest, limits) -> bool
  async check(dir, confirm) {
    if (!confirm) return true;
    const m = readManifest(dir);
    const lim = unsupported(m);
    return !lim.length || !!(await confirm(m, lim));
  }

  // Add (or replace) an extension folder and load it everywhere.
  async register(dir, { source, storeId: sid = null, dev = false }) {
    const m = readManifest(dir);
    if (!m.manifest_version) throw new Error('manifest.json has no manifest_version');
    // Load once to learn the ID Electron gives it.
    const any = this.bySession.keys().next().value || electronSession.fromPartition('persist:' + this.shell.space.partition);
    let id = sid;
    const existing = this.list.find(x => (sid && x.storeId === sid) || x.path === dir);
    if (existing) for (const ses of this.bySession.keys()) this.unloadFrom(ses, existing.id);
    try {
      const loaded = await api(any).loadExtension(dir, { allowFileAccess: false });
      id = loaded.id;
      if (!this.bySession.has(any)) this.unloadFrom(any, id);
    } catch (err) { throw new Error(`Electron couldn’t load it: ${err.message}`); }
    const entry = { id, name: m.name, version: m.version, path: dir, enabled: true, source, storeId: sid, dev, installedAt: Date.now() };
    const list = this.list.filter(x => x !== existing && x.id !== id);
    list.push(entry);
    this.shell.st.extensions = list;
    this.shell.persist();
    for (const ses of this.bySession.keys()) await this.loadInto(ses, entry);
    this.changed();
    return this.info(entry);
  }

  // ---- install sources
  async installFromStore(text, { confirm = null } = {}) {
    const id = storeId(text);
    if (!id) throw new Error('That isn’t a Chrome Web Store link or extension ID.');
    const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`the Web Store answered ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('the Web Store didn’t send this extension (it may be unavailable or not public)');
    return this.installCrxBuffer(buf, { source: 'webstore', storeId: id, confirm });
  }

  async installCrxFile(file, { confirm = null } = {}) {
    return this.installCrxBuffer(fs.readFileSync(file), { source: 'crx', confirm });
  }

  async installCrxBuffer(buf, { source, storeId: sid = null, confirm = null }) {
    const zip = crxToZip(buf);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-ext-'));
    try {
      const zipFile = path.join(tmp, 'ext.zip');
      fs.writeFileSync(zipFile, zip);
      const out = path.join(tmp, 'x');
      fs.mkdirSync(out);
      await run('tar.exe', ['-xf', zipFile, '-C', out]);
      // Keep the extension's real ID (Chrome derives it from the package's public key).
      const pub = crxPublicKey(buf);
      if (pub) {
        const mf = path.join(out, 'manifest.json');
        const raw = JSON.parse(fs.readFileSync(mf, 'utf8').replace(/^﻿/, ''));
        if (!raw.key) { raw.key = pub; fs.writeFileSync(mf, JSON.stringify(raw, null, 2)); }
      }
      if (!(await this.check(out, confirm))) return { cancelled: true };
      const m = readManifest(out);
      const dest = path.join(this.dir, sid || `${(m.name || 'extension').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${Date.now().toString(36)}`);
      fs.mkdirSync(this.dir, { recursive: true });
      copyDir(out, dest);
      return await this.register(dest, { source, storeId: sid });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // Developer mode: load an unpacked folder where it is (changes show after Reload).
  async installFolder(dir, { confirm = null } = {}) {
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('That folder has no manifest.json.');
    if (!(await this.check(dir, confirm))) return { cancelled: true };
    return this.register(dir, { source: 'folder', dev: true });
  }

  // Arc keeps installed extensions unpacked in User Data\<profile>\Extensions\<id>\<version>.
  arcExtensions() {
    const arc = require('./arc-import').find();
    if (!arc) return [];
    const found = new Map();
    let profiles = [];
    try { profiles = fs.readdirSync(arc.userData).filter(p => p === 'Default' || /^Profile \d+$/.test(p)); } catch { /* none */ }
    for (const p of profiles) {
      const base = path.join(arc.userData, p, 'Extensions');
      let ids = [];
      try { ids = fs.readdirSync(base).filter(x => ID_RE.test(x) && !SKIP_IDS.has(x)); } catch { continue; }
      for (const id of ids) {
        let vers = [];
        try { vers = fs.readdirSync(path.join(base, id)).filter(v => fs.existsSync(path.join(base, id, v, 'manifest.json'))); } catch { continue; }
        const v = vers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
        if (!v || found.has(id)) continue;
        try {
          const dir = path.join(base, id, v);
          const m = readManifest(dir);
          if (m.theme && !m.background && !m.content_scripts) continue;   // Chrome themes
          found.set(id, { id, dir, name: m.name, version: m.version, installed: this.list.some(e => e.storeId === id) });
        } catch { /* broken */ }
      }
    }
    return [...found.values()];
  }

  async importFromArc(ids) {
    const out = [];
    for (const a of this.arcExtensions().filter(x => !ids || ids.includes(x.id))) {
      try {
        const dest = path.join(this.dir, a.id);
        copyDir(a.dir, dest);
        fs.rmSync(path.join(dest, '_metadata'), { recursive: true, force: true });
        out.push(await this.register(dest, { source: 'arc', storeId: a.id }));
      } catch (err) { out.push({ id: a.id, name: a.name, error: err.message }); }
    }
    return out;
  }

  // ---- manage
  async setEnabled(id, on) {
    const e = this.list.find(x => x.id === id);
    if (!e) return;
    e.enabled = !!on;
    this.shell.persist();
    for (const ses of this.bySession.keys()) { if (on) await this.loadInto(ses, e); else this.unloadFrom(ses, id); }
    this.changed();
  }

  async reload(id) {
    const e = this.list.find(x => x.id === id);
    if (!e) return;
    for (const ses of this.bySession.keys()) { this.unloadFrom(ses, id); await this.loadInto(ses, e); }
  }

  remove(id) {
    const e = this.list.find(x => x.id === id);
    if (!e) return;
    for (const ses of this.bySession.keys()) this.unloadFrom(ses, id);
    if (!e.dev && e.path.startsWith(this.dir)) fs.rmSync(e.path, { recursive: true, force: true });
    this.shell.st.extensions = this.list.filter(x => x !== e);
    this.shell.persist();
    this.changed();
  }

  // Web Store extensions: download again and replace when the version is newer.
  async updateAll() {
    let n = 0;
    for (const e of this.list.filter(x => x.storeId && (x.source === 'webstore' || x.source === 'arc'))) {
      try {
        const before = this.info(e).version;
        const res = await net.fetch(`https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=id%3D${e.storeId}%26uc`);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-extu-'));
        try {
          fs.writeFileSync(path.join(tmp, 'e.zip'), crxToZip(buf));
          fs.mkdirSync(path.join(tmp, 'x'));
          await run('tar.exe', ['-xf', path.join(tmp, 'e.zip'), '-C', path.join(tmp, 'x')]);
          const v = readManifest(path.join(tmp, 'x')).version;
          if (String(v).localeCompare(String(before), undefined, { numeric: true }) > 0) {
            for (const ses of this.bySession.keys()) this.unloadFrom(ses, e.id);
            copyDir(path.join(tmp, 'x'), e.path);
            e.version = v;
            for (const ses of this.bySession.keys()) await this.loadInto(ses, e);
            n++;
          }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      } catch { /* try next time */ }
    }
    this.shell.st.extUpdateAt = Date.now();
    this.shell.persist();
    this.changed();
    return n;
  }

  start() {
    setTimeout(() => { if (Date.now() - (this.shell.st.extUpdateAt || 0) > 24 * 3600e3 && this.list.length) this.updateAll(); }, 120e3);
  }
}

module.exports = { Extensions, storeId, crxToZip, readManifest, crxPublicKey, unsupported };
