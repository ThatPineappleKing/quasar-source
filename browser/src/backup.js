// Backup, restore and sync for Quasar.
//
// Backups: one file with Spaces (name, colours, pinned tabs and folders, Favorites),
// settings, Boosts, Air Traffic Control, site permissions and zoom, and optionally
// history and saved passwords/addresses. With a passphrase the file is encrypted
// (scrypt + AES-256-GCM); passwords are only ever written encrypted.
//
// Sync: no Quasar server. You pick a folder that OneDrive/Dropbox/Google Drive keep in
// step between PCs. Each PC writes its own encrypted file there and merges the
// others': per item, the newest change wins; deletions are carried over.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const hash = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('base64').slice(0, 22);
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

function deriveKey(pass, salt) { return crypto.scryptSync(String(pass), Buffer.from(salt, 'base64'), 32, SCRYPT); }
function seal(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function open(box, key) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
}

// Settings that belong to one PC, not to the user.
// (the AI settings hold the encrypted API key: it never goes into backups or sync)
const LOCAL_SETTINGS = ['sidebarWidth', 'sidebarHidden', 'arcImported', 'arcOffered', 'ai'];

class Backup {
  constructor(shell) { this.shell = shell; }
  get st() { return this.shell.st; }
  get vault() { return this.shell.vault; }

  // ---- what a Space looks like in a backup / sync file
  spaceOut(sp) {
    const strip = list => (list || []).map(n => (n.children ? { ...n, children: strip(n.children) } : { id: n.id, url: n.url, title: n.title, favicon: '' }))
      .map(n => (n.type ? { id: n.id, type: n.type, title: n.title, open: n.open, sizes: n.sizes, children: n.children } : n));
    return { id: sp.id, name: sp.name, emoji: sp.emoji, colors: sp.colors, grain: sp.grain, theme: sp.theme || null, arcId: sp.arcId || null,
      pinned: strip(sp.pinned), favorites: (sp.favorites || []).map(f => ({ id: f.id, url: f.url, title: f.title, favicon: '' })) };
  }
  settingsOut() {
    const s = { ...this.st.settings };
    for (const k of LOCAL_SETTINGS) delete s[k];
    return s;
  }
  partitionOf(spaceId) { return this.st.spaces.find(s => s.id === spaceId)?.partition; }
  spaceOfPartition(p) { return this.st.spaces.find(s => s.partition === p)?.id; }

  snapshot({ history = true, secrets = false } = {}) {
    const st = this.st;
    const perm = {};
    for (const [k, v] of Object.entries(st.sitePermissions || {})) {
      const [part, ...rest] = k.split('|');
      const sid = this.spaceOfPartition(part);
      if (sid) perm[`${sid}|${rest.join('|')}`] = v;
    }
    const zoom = {};
    for (const [part, m] of Object.entries(st.zoom || {})) { const sid = this.spaceOfPartition(part); if (sid) zoom[sid] = m; }
    const data = {
      spaces: st.spaces.map(sp => this.spaceOut(sp)), activeSpaceId: st.activeSpaceId,
      settings: this.settingsOut(), boosts: clone(st.boosts || []), atc: clone(st.atc || []),
      sitePermissions: perm, zoom, adAllow: [...(st.adAllow || [])],
    };
    if (history) data.history = Object.fromEntries(st.spaces.map(sp => [sp.id, sp.history || []]));
    if (secrets) {
      const v = this.vault.data;
      data.passwords = v.entries.map(e => ({ ...e, spaceId: this.spaceOfPartition(e.profile), profile: undefined })).filter(e => e.spaceId);
      data.never = v.never.map(n => ({ spaceId: this.spaceOfPartition(n.profile), site: n.site })).filter(n => n.spaceId);
      data.addresses = v.addresses.map(a => ({ ...a, spaceId: this.spaceOfPartition(a.profile), profile: undefined })).filter(a => a.spaceId);
    }
    return { format: 'arch-backup', version: 1, created: Date.now(), device: os.hostname(), app: app.getVersion(), data };
  }

  // ---- files
  writeBackup(file, { history = true, secrets = false, pass = '' } = {}) {
    if (secrets && !pass) throw new Error('A passphrase is needed to include passwords (the file is then encrypted).');
    if (pass && pass.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    const snap = this.snapshot({ history, secrets });
    let out = snap;
    if (pass) {
      const salt = crypto.randomBytes(16).toString('base64');
      out = { format: 'arch-backup', encrypted: true, kdf: 'scrypt', salt, created: snap.created, ...seal(snap, deriveKey(pass, salt)) };
    }
    fs.writeFileSync(file + '.tmp', JSON.stringify(out));
    fs.renameSync(file + '.tmp', file);
    return file;
  }

  // { encrypted, raw } — raw is the parsed file
  readFile(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return { encrypted: !!raw.encrypted, raw };
  }

  // Turns any supported file into Quasar's backup data.
  unpack(raw, pass) {
    if (raw.encrypted) {
      try { raw = open(raw, deriveKey(pass, raw.salt)); } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
    }
    if (raw.format === 'arch-backup' && raw.data) return raw.data;
    // Backups from the Arc+Chrome extension.
    if (Array.isArray(raw.spaces) && raw.spaces.length) {
      const favs = (raw.favorites || []).map(f => ({ id: uid(), url: f.url, title: f.title || '', favicon: '' }));
      return {
        spaces: raw.spaces.map((s, i) => ({ id: s.id, name: s.name, emoji: s.emoji || '', colors: s.colors, grain: s.grain ?? 0.35,
          pinned: (s.pinned || []).map(p => ({ id: uid(), url: p.url, title: p.title || '', favicon: '' })), favorites: i === 0 ? favs : [] })),
        settings: {}, boosts: (raw.settings?.boosts || []).map(b => ({ id: b.id || uid(), name: '', pattern: b.domain || b.pattern || '', css: b.css || '', js: '', enabled: b.enabled !== false, spaceId: null })),
        atc: (raw.settings?.atc || []).map(r => ({ id: r.id || uid(), pattern: r.pattern, spaceId: r.spaceId, enabled: true })),
      };
    }
    throw new Error('This isn’t an Quasar or Arc+Chrome backup.');
  }

  summarize(d) {
    const count = list => (list || []).reduce((n, x) => n + (x.children ? count(x.children) : 1), 0);
    const parts = [`${d.spaces.length} Space${d.spaces.length === 1 ? '' : 's'} (${d.spaces.map(s => `${s.emoji || ''} ${s.name}`.trim()).join(', ')})`,
      `${d.spaces.reduce((n, s) => n + count(s.pinned), 0)} pinned tabs`, `${d.spaces.reduce((n, s) => n + (s.favorites || []).length, 0)} Favorites`];
    if (d.boosts?.length) parts.push(`${d.boosts.length} Boosts`);
    if (d.atc?.length) parts.push(`${d.atc.length} Air Traffic rules`);
    if (d.history) parts.push(`${Object.values(d.history).reduce((n, h) => n + h.length, 0)} history entries`);
    if (d.passwords) parts.push(`${d.passwords.length} passwords`, `${(d.addresses || []).length} addresses`);
    return parts.join(' · ');
  }

  // ---- restore
  restore(d, mode = 'merge') {
    const S = this.shell, st = this.st;
    const before = new Set(st.spaces.map(s => s.id));
    if (mode === 'replace') {
      // Spaces not in the backup are closed and removed from the sidebar (their site data stays on disk).
      const keep = new Set(d.spaces.map(s => s.id));
      for (const t of [...S.tabs.values()]) if (!keep.has(t.spaceId) && !S.privateSpaces.has(t.spaceId)) S.closeTab(t.id, { force: true });
      st.spaces = st.spaces.filter(s => keep.has(s.id));
      Object.assign(st.settings, d.settings || {});
      st.boosts = clone(d.boosts || []); st.atc = clone(d.atc || []); st.adAllow = [...(d.adAllow || [])];
    }
    for (const bs of d.spaces) {
      const local = st.spaces.find(s => s.id === bs.id);
      if (!local) {
        st.spaces.push({ ...clone(bs), partition: 'space-' + bs.id, history: [], tabs: [], activeIndex: -1 });
        S.order[bs.id] = [];
      } else if (mode === 'replace') {
        Object.assign(local, { name: bs.name, emoji: bs.emoji, colors: bs.colors, grain: bs.grain, theme: bs.theme || local.theme, pinned: clone(bs.pinned), favorites: clone(bs.favorites) });
      } else {
        // Merge: add pinned tabs and Favorites this Space doesn't have yet.
        const urls = new Set();
        const walk = l => (l || []).forEach(n => (n.children ? walk(n.children) : urls.add(n.url)));
        walk(local.pinned);
        for (const n of bs.pinned || []) if (n.children || !urls.has(n.url)) local.pinned.push(clone(n));
        const favUrls = new Set((local.favorites || []).map(f => f.url));
        for (const f of bs.favorites || []) if (!favUrls.has(f.url) && local.favorites.length < 12) local.favorites.push(clone(f));
      }
    }
    if (mode === 'merge') {
      const has = (list, id) => list.some(x => x.id === id);
      for (const b of d.boosts || []) if (!has(st.boosts, b.id)) st.boosts.push(clone(b));
      for (const r of d.atc || []) if (!has(st.atc, r.id)) st.atc.push(clone(r));
      for (const a of d.adAllow || []) if (!st.adAllow.includes(a)) st.adAllow.push(a);
    }
    for (const [k, v] of Object.entries(d.sitePermissions || {})) {
      const [sid, ...rest] = k.split('|');
      const part = this.partitionOf(sid);
      if (part && (mode === 'replace' || !S.permissions.has(`${part}|${rest.join('|')}`))) S.permissions.set(`${part}|${rest.join('|')}`, v);
    }
    S.savePermissions();
    for (const [sid, m] of Object.entries(d.zoom || {})) { const part = this.partitionOf(sid); if (part) st.zoom[part] = { ...(mode === 'merge' ? st.zoom[part] : {}), ...m }; }
    for (const [sid, h] of Object.entries(d.history || {})) { const sp = st.spaces.find(s => s.id === sid); if (sp) sp.history = mergeHistory(sp.history || [], h); }
    let pw = 0, ad = 0;
    if (d.passwords && this.vault.available) {
      for (const e of d.passwords) { const part = this.partitionOf(e.spaceId); if (part && e.origin && e.password) {
        this.vault.upsert({ profile: part, origin: e.origin, username: e.username || '', password: e.password });
        if (e.otp) { const hit = this.vault.forSite(part, e.origin).find(x => x.username === (e.username || '')); if (hit) { hit.otp = e.otp; this.vault.save(); } }
        pw++;
      } }
      for (const n of d.never || []) { const part = this.partitionOf(n.spaceId); if (part && !this.vault.data.never.some(x => x.profile === part && x.site === n.site)) this.vault.data.never.push({ profile: part, site: n.site }); }
      for (const a of d.addresses || []) { const part = this.partitionOf(a.spaceId); if (part && !this.vault.findAddress(part, a)) { this.vault.saveAddress(part, a); ad++; } }
      this.vault.save();
    }
    if (!st.spaces.length) st.spaces = [{ id: 'personal', name: 'Personal', emoji: '🌸', colors: ['#B9A6F2', '#D9B8EC', '#F6C4B4'], grain: 0.35, partition: 'space-personal', pinned: [], favorites: [], history: [], tabs: [], activeIndex: -1 }];
    for (const W of S.wins) if (!S.spaceById(W.spaceId)) S.withWin(W, () => S.switchSpace(st.spaces[0].id));
    S.changed();
    const added = st.spaces.filter(s => !before.has(s.id)).length;
    return `Restored: ${added} new Space${added === 1 ? '' : 's'}, ${d.spaces.length - added} updated${pw ? `, ${pw} passwords` : ''}${ad ? `, ${ad} addresses` : ''}.`;
  }

  // ---- automatic daily backups
  // (Quasar was called Arch: an existing "Arch Backups" folder keeps being used.)
  get autoDir() {
    const docs = app.getPath('documents');
    const old = path.join(docs, 'Arch Backups');
    return fs.existsSync(old) ? old : path.join(docs, 'Quasar Backups');
  }
  autoBackup(force = false) {
    if (!this.st.settings.autoBackup && !force) return;
    if (!force && Date.now() - (this.st.lastAutoBackup || 0) < 20 * 3600e3) return;
    try {
      fs.mkdirSync(this.autoDir, { recursive: true });
      const file = path.join(this.autoDir, `Quasar backup ${new Date().toISOString().slice(0, 10)}.archbackup`);
      this.writeBackup(file, { history: true, secrets: false });
      const old = fs.readdirSync(this.autoDir).filter(f => /^(Quasar|Arch) backup \d{4}-\d\d-\d\d\.archbackup$/.test(f))
        .sort((a, b) => a.slice(-21).localeCompare(b.slice(-21)));   // by date, whichever name
      for (const f of old.slice(0, Math.max(0, old.length - 10))) fs.rmSync(path.join(this.autoDir, f), { force: true });
      this.st.lastAutoBackup = Date.now();
      this.shell.persist();
      return file;
    } catch (err) { this.st.autoBackupError = err.message; return null; }
  }

  // ======================================================== sync
  get sync() { return (this.st.sync ||= { on: false }); }
  // The shared sync folder keeps the name it was created with ("Arch Sync" before
  // the rename), so PCs that already sync keep finding each other.
  syncSubdir(folder) {
    return fs.existsSync(path.join(folder, 'Arch Sync')) ? 'Arch Sync' : 'Quasar Sync';
  }
  syncDir() { return path.join(this.sync.folder, this.syncSubdir(this.sync.folder)); }
  key() {
    if (!this.sync.keyEnc) throw new Error('Sync isn’t set up on this PC.');
    return Buffer.from(safeStorage.decryptString(Buffer.from(this.sync.keyEnc, 'base64')), 'base64');
  }

  // Turn on: the first PC creates the folder's salt + check value; later PCs must use the same passphrase.
  enable({ folder, pass, device }) {
    if (!folder || !fs.existsSync(folder)) throw new Error('Choose a folder that exists.');
    if (!pass || pass.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption isn’t available, so the sync key can’t be stored safely.');
    const dir = path.join(folder, this.syncSubdir(folder));
    fs.mkdirSync(path.join(dir, 'devices'), { recursive: true });
    const metaFile = path.join(dir, 'sync.json');
    let meta;
    if (fs.existsSync(metaFile)) {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      try { if (open(meta.check, deriveKey(pass, meta.salt)) !== 'arch-sync') throw new Error(); } catch { throw new Error('That isn’t the passphrase the other PCs use for this folder.'); }
    } else {
      const salt = crypto.randomBytes(16).toString('base64');
      meta = { format: 'arch-sync', version: 1, salt, check: seal('arch-sync', deriveKey(pass, salt)), created: Date.now() };
      fs.writeFileSync(metaFile, JSON.stringify(meta));
    }
    const key = deriveKey(pass, meta.salt);
    Object.assign(this.sync, {
      on: true, folder, keyEnc: safeStorage.encryptString(key.toString('base64')).toString('base64'),
      device: { id: this.sync.device?.id || uid(), name: String(device || os.hostname()).slice(0, 60) }, error: null, meta: this.sync.meta || {},
    });
    this.shell.persist();
    return this.syncNow();
  }

  disable() { Object.assign(this.sync, { on: false, keyEnc: null, error: null, remoteTabs: {} }); this.shell.persist(); }

  // What this PC has, with a "last changed" time per item (from hashes kept in sync.meta).
  localState() {
    const st = this.st, meta = (this.sync.meta ||= {});
    const now = Date.now();
    // Before this PC's first sync, existing items count as "old" (time 0), so the first
    // sync merges both sides instead of this PC's copy winning just for being seen first.
    const track = (bucket, id, value) => {
      const m = (meta[bucket] ||= {});
      const h = hash(value);
      if (!m[id]) m[id] = { h, at: this.sync.initialized ? now : 0 };
      else if (m[id].h !== h) m[id] = { h, at: now };
      return m[id].at;
    };
    const tomb = (meta.tomb ||= { spaces: {}, boosts: {}, atc: {}, passwords: {}, addresses: {} });
    const sweep = (bucket, ids) => { for (const id of Object.keys(meta[bucket] || {})) if (!ids.has(id) && !tomb[bucket][id]) { tomb[bucket][id] = now; delete meta[bucket][id]; } };
    const spaces = {};
    for (const sp of st.spaces) { const out = this.spaceOut(sp); spaces[sp.id] = { at: track('spaces', sp.id, out), data: out }; }
    sweep('spaces', new Set(st.spaces.map(s => s.id)));
    const items = bucket => {
      const out = {};
      for (const x of st[bucket] || []) out[x.id] = { at: track(bucket, x.id, x), data: clone(x) };
      sweep(bucket, new Set((st[bucket] || []).map(x => x.id)));
      return out;
    };
    const snap = this.snapshot({ history: true, secrets: true }).data;
    const pwKey = e => `${e.spaceId}|${String(e.origin).toLowerCase()}|${e.username}`;
    const adKey = a => `${a.spaceId}|${String(a.street || '').toLowerCase()}|${String(a.postal || '').toLowerCase()}`;
    const passwords = {}, addresses = {};
    for (const e of snap.passwords || []) passwords[pwKey(e)] = { at: e.updatedAt || e.createdAt || now, data: e };
    for (const a of snap.addresses || []) addresses[adKey(a)] = { at: a.updatedAt || a.createdAt || now, data: a };
    sweep2(meta, tomb, 'passwords', passwords, now);
    sweep2(meta, tomb, 'addresses', addresses, now);
    const settings = this.settingsOut();
    const extras = { sitePermissions: snap.sitePermissions, zoom: snap.zoom, adAllow: snap.adAllow };
    return {
      spaces, boosts: items('boosts'), atc: items('atc'), passwords, addresses, never: snap.never || [],
      settings: { at: track('one', 'settings', settings), data: settings }, extras: { at: track('one', 'extras', extras), data: extras },
      history: snap.history, tomb: clone(tomb),
    };
  }

  // Bring another PC's state into this one.
  applyRemote(r) {
    const S = this.shell, st = this.st, meta = this.sync.meta, tomb = meta.tomb;
    let changed = 0;
    const newer = (bucket, id, at) => at > ((meta[bucket] || {})[id]?.at || 0) && at > (tomb[bucket]?.[id] || 0);
    const settle = (bucket, id, value, at) => { (meta[bucket] ||= {})[id] = { h: hash(value), at }; };
    // Spaces
    for (const [id, { at, data }] of Object.entries(r.spaces || {})) {
      if (!newer('spaces', id, at)) continue;
      const local = st.spaces.find(s => s.id === id);
      if (local) Object.assign(local, { name: data.name, emoji: data.emoji, colors: data.colors, grain: data.grain, theme: data.theme, pinned: clone(data.pinned), favorites: clone(data.favorites) });
      else { st.spaces.push({ ...clone(data), partition: 'space-' + id, history: [], tabs: [], activeIndex: -1 }); S.order[id] = []; }
      settle('spaces', id, data, at); changed++;
    }
    for (const [id, at] of Object.entries(r.tomb?.spaces || {})) {
      const local = st.spaces.find(s => s.id === id);
      if (!local || at <= (meta.spaces?.[id]?.at || 0) || st.spaces.length < 2) continue;
      for (const t of [...S.tabs.values()]) if (t.spaceId === id) S.closeTab(t.id, { force: true });
      st.spaces = st.spaces.filter(s => s.id !== id);
      for (const W of S.wins) if (W.spaceId === id) S.withWin(W, () => S.switchSpace(st.spaces[0].id));
      tomb.spaces[id] = at; delete meta.spaces?.[id]; changed++;
    }
    // Boosts and Air Traffic rules
    for (const bucket of ['boosts', 'atc']) {
      for (const [id, { at, data }] of Object.entries(r[bucket] || {})) {
        if (!newer(bucket, id, at)) continue;
        st[bucket] = (st[bucket] || []).filter(x => x.id !== id).concat([clone(data)]);
        settle(bucket, id, data, at); changed++;
      }
      for (const [id, at] of Object.entries(r.tomb?.[bucket] || {})) {
        if (at > (meta[bucket]?.[id]?.at || 0) && (st[bucket] || []).some(x => x.id === id)) { st[bucket] = st[bucket].filter(x => x.id !== id); tomb[bucket][id] = at; delete meta[bucket][id]; changed++; }
      }
    }
    // Settings and per-site settings
    if (r.settings && r.settings.at > (meta.one?.settings?.at || 0)) { Object.assign(st.settings, r.settings.data); settle('one', 'settings', this.settingsOut(), r.settings.at); changed++; }
    if (r.extras && r.extras.at > (meta.one?.extras?.at || 0)) {
      this.restore({ spaces: [], sitePermissions: r.extras.data.sitePermissions, zoom: r.extras.data.zoom, adAllow: r.extras.data.adAllow }, 'merge');
      st.adAllow = [...(r.extras.data.adAllow || [])];
      changed++;
    }
    // History: everything from both
    for (const [sid, h] of Object.entries(r.history || {})) { const sp = st.spaces.find(s => s.id === sid); if (sp) sp.history = mergeHistory(sp.history || [], h); }
    // Passwords and addresses
    if (this.vault.available) {
      const v = this.vault;
      let vChanged = false;
      for (const [k, { at, data }] of Object.entries(r.passwords || {})) {
        const part = this.partitionOf(data.spaceId);
        if (!part || at <= (tomb.passwords[k] || 0)) continue;
        const local = v.data.entries.find(e => e.profile === part && String(e.origin).toLowerCase() === String(data.origin).toLowerCase() && e.username === data.username);
        if (local && (local.updatedAt || 0) >= at) continue;
        if (local) Object.assign(local, { password: data.password, updatedAt: at }, data.otp ? { otp: data.otp } : {});
        else v.data.entries.push({ id: uid(), profile: part, origin: data.origin, username: data.username, password: data.password, ...(data.otp ? { otp: data.otp } : {}), createdAt: data.createdAt || at, updatedAt: at });
        vChanged = true;
      }
      for (const [k, at] of Object.entries(r.tomb?.passwords || {})) {
        const [sid, origin, ...u] = k.split('|');
        const part = this.partitionOf(sid);
        const i = v.data.entries.findIndex(e => e.profile === part && String(e.origin).toLowerCase() === origin && e.username === u.join('|') && (e.updatedAt || 0) < at);
        if (i >= 0) { v.data.entries.splice(i, 1); tomb.passwords[k] = at; vChanged = true; }
      }
      for (const [k, { at, data }] of Object.entries(r.addresses || {})) {
        const part = this.partitionOf(data.spaceId);
        if (!part || at <= (tomb.addresses[k] || 0)) continue;
        const local = v.findAddress(part, data);
        if (local && (local.updatedAt || 0) >= at) continue;
        if (local) Object.assign(local, { ...data, profile: part, spaceId: undefined, id: local.id, updatedAt: at });
        else v.data.addresses.push({ ...data, spaceId: undefined, id: uid(), profile: part, updatedAt: at });
        vChanged = true;
      }
      for (const n of r.never || []) { const part = this.partitionOf(n.spaceId); if (part && !v.data.never.some(x => x.profile === part && x.site === n.site)) { v.data.never.push({ profile: part, site: n.site }); vChanged = true; } }
      if (vChanged) { v.save(); changed++; }
    }
    return changed;
  }

  // Read the other PCs, merge, then write this PC's file.
  async syncNow() {
    const y = this.sync;
    if (!y.on) return { error: 'Sync is off.' };
    try {
      const key = this.key();
      const dir = path.join(this.syncDir(), 'devices');
      fs.mkdirSync(dir, { recursive: true });
      this.localState();   // record local changes before merging
      let changed = 0;
      const devices = [];
      for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.archsync'))) {
        const id = f.replace(/\.archsync$/, '');
        if (id === y.device.id) continue;
        try {
          const box = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          const remote = open(box, key);
          devices.push({ id, name: remote.device?.name || id, at: remote.at });
          // "Tabs on your other PCs": shown, never merged into this PC's tabs.
          if (Array.isArray(remote.openTabs)) (y.remoteTabs ||= {})[id] = { name: remote.device?.name || id, at: remote.at, tabs: remote.openTabs.slice(0, 300) };
          if ((y.seen || {})[id] === remote.at) continue;    // nothing new from that PC
          // First time this PC meets another: add everything from both sides (like a merge restore).
          if (!y.initialized) this.restore(stateToBackup(remote.state), 'merge');
          changed += this.applyRemote(remote.state);
          (y.seen ||= {})[id] = remote.at;
        } catch (err) { devices.push({ id, name: id, error: err.message }); }
      }
      y.initialized = true;
      // PCs whose file is gone (sync turned off there) drop out of the list.
      for (const id of Object.keys(y.remoteTabs || {})) if (!devices.some(d => d.id === id)) delete y.remoteTabs[id];
      this.writeOwn(key);
      y.last = Date.now(); y.error = null; y.devices = devices;
      this.shell.changed();
      return { summary: changed ? `Synced: ${changed} change${changed === 1 ? '' : 's'} from other PCs.` : 'Synced. Everything was already up to date.' };
    } catch (err) {
      y.error = `Sync failed: ${err.message}`;
      this.shell.persist();
      return { error: y.error };
    }
  }

  writeOwn(key = this.key()) {
    const y = this.sync;
    const state = this.localState();
    const file = path.join(this.syncDir(), 'devices', y.device.id + '.archsync');
    const body = { device: y.device, at: Date.now(), state, openTabs: this.openTabsOut() };
    fs.writeFileSync(file + '.tmp', JSON.stringify(seal(body, key)));
    fs.renameSync(file + '.tmp', file);
  }

  // This PC's open tabs (not private windows), for the other PCs' "Tabs on other PCs".
  openTabsOut() {
    const S = this.shell, out = [];
    for (const sp of this.st.spaces) {
      for (const id of S.order[sp.id] || []) {
        const t = S.tabs.get(id);
        if (!t?.url || !/^(https?|file):/i.test(t.url)) continue;
        out.push({ spaceId: sp.id, space: `${sp.emoji || ''} ${sp.name}`.trim(), url: t.url, title: String(t.title || '').slice(0, 200),
          favicon: /^https?:/i.test(t.favicon || '') ? t.favicon : '', lastActive: t.lastActive || 0 });
      }
    }
    return out.sort((a, b) => b.lastActive - a.lastActive).slice(0, 300);
  }

  // Tabs open on the other PCs, newest PC first.
  remoteTabs() {
    return Object.entries(this.sync.on ? this.sync.remoteTabs || {} : {}).map(([id, d]) => ({ id, name: d.name, at: d.at, tabs: d.tabs || [] }))
      .sort((a, b) => b.at - a.at);
  }

  // Quasar is quitting: write the latest state (no reading).
  flushOnExit() {
    if (!this.sync.on) return;
    try { this.writeOwn(); } catch { /* ignore */ }
  }

  start() {
    setTimeout(() => { if (this.sync.on) this.syncNow(); this.autoBackup(); }, 15e3);
    setInterval(() => { if (this.sync.on) this.syncNow(); }, 5 * 60e3);
    setInterval(() => this.autoBackup(), 3600e3);
  }

  status() {
    const y = this.sync;
    const devices = (y.devices || []).map(d => ({ ...d, self: false }));
    if (y.on) devices.unshift({ id: y.device.id, name: y.device.name, at: y.last || Date.now(), self: true });
    return {
      auto: !!this.st.settings.autoBackup, autoDir: this.autoDir, lastAuto: this.st.lastAutoBackup || 0, defaultDevice: os.hostname(),
      sync: { on: !!y.on, folder: y.folder || '', device: y.device?.name || '', last: y.last || 0, error: y.error || null, devices, remoteTabs: this.remoteTabs() },
    };
  }
}

// A sync state as backup data (for the first-time merge).
function stateToBackup(s) {
  const vals = o => Object.values(o || {}).map(x => x.data);
  return { spaces: vals(s.spaces), boosts: vals(s.boosts), atc: vals(s.atc), history: s.history, settings: {},
    sitePermissions: s.extras?.data?.sitePermissions, zoom: s.extras?.data?.zoom, adAllow: s.extras?.data?.adAllow,
    passwords: vals(s.passwords), addresses: vals(s.addresses), never: s.never };
}

function sweep2(meta, tomb, bucket, current, now) {
  const seen = (meta['keys_' + bucket] ||= {});
  for (const k of Object.keys(seen)) if (!current[k] && !tomb[bucket][k]) tomb[bucket][k] = now;
  meta['keys_' + bucket] = Object.fromEntries(Object.keys(current).map(k => [k, 1]));
}

function mergeHistory(a, b) {
  const map = new Map();
  for (const e of [...a, ...b]) {
    const x = map.get(e.url);
    if (!x) map.set(e.url, { ...e });
    else { x.visits = Math.max(x.visits || 0, e.visits || 0); if ((e.last || 0) > (x.last || 0)) { x.last = e.last; if (e.title) x.title = e.title; } }
  }
  return [...map.values()].sort((p, q) => (q.last || 0) - (p.last || 0)).slice(0, 3000);
}

module.exports = { Backup, mergeHistory };
