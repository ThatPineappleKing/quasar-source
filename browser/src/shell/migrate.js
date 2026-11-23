// Switching browsers: importing from Chrome, Edge, Brave, Opera, Opera GX, Vivaldi and
// Firefox, bookmarks HTML files in and out, and exporting passwords (after Windows Hello).
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { uid, importPinned } = require('./common');

class MigratePart {
  // ------------------------------------------------- from other browsers
  async importBrowser() {
    if (this.isPrivate) return this.toast('Open a normal window to import.');
    const bi = require('../browser-import');
    const found = bi.findAll().slice(0, 9);
    const buttons = [...found.map(f => f.label), 'Bookmarks HTML file…', 'Cancel'];
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question', buttons, cancelId: buttons.length - 1, noLink: true,
      message: 'Import from another browser',
      detail: found.length
        ? `Bookmarks go into a pinned folder in ${this.space.name}; history helps the command bar suggest sites. Passwords come next, from a file you export in that browser.`
        : 'No other browsers were found on this PC. You can still import a bookmarks HTML file exported from any browser.',
    });
    if (response === buttons.length - 1) return null;
    if (response === buttons.length - 2) return this.importBookmarksHtml();
    return this.importFrom(found[response]);
  }

  // Bookmarks (as a pinned folder) and history from one browser profile.
  async importFrom(src, { confirm = true, history = true } = {}) {
    const bi = require('../browser-import');
    const sp = this.space;
    const data = bi.read(src, { history: true });
    const nb = bi.count(data.bookmarks);
    let withHistory = history;
    if (confirm) {
      const r = await dialog.showMessageBox(this.win, {
        type: 'question', buttons: ['Import', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
        message: `Import from ${src.label} into ${`${sp.emoji || ''} ${sp.name}`.trim()}?`,
        detail: [`${nb} bookmark${nb === 1 ? '' : 's'} (into a pinned folder “From ${src.label}”)`,
          `${data.history.length} history entries`,
          ...(data.errors.length ? ['', `Some things couldn’t be read: ${data.errors.join('; ')}`] : [])].join('\n'),
        checkboxLabel: 'Also import history', checkboxChecked: true,
      });
      if (r.response !== 0) return null;
      withHistory = r.checkboxChecked;
    }
    if (nb) this.addImportedBookmarks(data.bookmarks, `From ${src.label}`, sp);
    const nh = withHistory ? this.mergeHistory(sp, data.history) : 0;
    this.changed();
    this.toast(`Imported ${nb} bookmark${nb === 1 ? '' : 's'}${nh ? ` and ${nh} history entries` : ''} from ${src.label}.`);
    if (confirm) {
      const help = bi.PASSWORD_HELP[src.browser] || '';
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'info', buttons: ['Choose the passwords file…', 'Not now'], defaultId: 0, cancelId: 1, noLink: true,
        message: `Bring your passwords from ${src.label.split(' — ')[0]} too?`,
        detail: `${help}\n\nThat saves a CSV file. Choose it here and Quasar adds the passwords to this Space’s profile, then offers to delete the file (it isn’t encrypted).`,
      });
      if (response === 0) await this.importPasswordCsv(sp.partition);
    }
    return { bookmarks: nb, history: nh, errors: data.errors };
  }

  addImportedBookmarks(tree, title, sp = this.space) {
    const folder = { id: uid(), type: 'folder', title: String(title).slice(0, 80), open: false, children: importPinned(tree) };
    sp.pinned.push(folder);
    return folder;
  }

  // Add visits to a Space's history; the same address keeps one entry.
  mergeHistory(sp, entries) {
    const byUrl = new Map((sp.history || []).map(h => [h.url, h]));
    let n = 0;
    for (const e of entries || []) {
      const h = byUrl.get(e.url);
      if (h) { h.visits = (h.visits || 0) + (e.visits || 1); h.last = Math.max(h.last || 0, e.last || 0); if (!h.title) h.title = e.title; }
      else { const x = { url: e.url, title: e.title || '', visits: e.visits || 1, last: e.last || 0 }; byUrl.set(e.url, x); n++; }
    }
    sp.history = [...byUrl.values()].sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, 3000);
    return n;
  }

  // ----------------------------------------------------- bookmarks HTML
  async importBookmarksHtml(file = null) {
    if (this.isPrivate) return this.toast('Open a normal window to import.');
    if (!file) {
      const r = await dialog.showOpenDialog(this.win, { title: 'Import bookmarks', filters: [{ name: 'Bookmarks file (HTML)', extensions: ['html', 'htm'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    }
    const bi = require('../browser-import');
    let tree;
    try { tree = bi.parseHtml(fs.readFileSync(file, 'utf8')); } catch (err) { this.toast(`Couldn’t read that file: ${err.message}`); return null; }
    const n = bi.count(tree);
    if (!n) { this.toast('No bookmarks found in that file.'); return { bookmarks: 0 }; }
    this.addImportedBookmarks(tree, `Imported bookmarks`);
    this.changed();
    this.toast(`Imported ${n} bookmark${n === 1 ? '' : 's'} into a pinned folder.`);
    return { bookmarks: n };
  }

  // Pinned tabs (with folders), Favorites and Read Later of this Space, as the
  // bookmarks file every browser can import.
  bookmarksTree(sp = this.space) {
    const conv = list => (list || []).map(n => n.type === 'folder' ? { type: 'folder', title: n.title, children: conv(n.children) }
      : n.type === 'split' ? { type: 'folder', title: 'Split view', children: conv(n.children) }
      : { url: n.url, title: n.title || n.url }).filter(n => n.url || n.children?.length);
    const tree = [];
    if (sp.pinned?.length) tree.push({ type: 'folder', title: 'Pinned tabs', children: conv(sp.pinned) });
    if (sp.favorites?.length) tree.push({ type: 'folder', title: 'Favorites', children: sp.favorites.map(f => ({ url: f.url, title: f.title })) });
    if (sp.readLater?.length) tree.push({ type: 'folder', title: 'Read Later', children: sp.readLater.map(r => ({ url: r.url, title: r.title })) });
    return tree;
  }

  async exportBookmarksHtml(file = null) {
    const sp = this.space;
    const tree = this.bookmarksTree(sp);
    const bi = require('../browser-import');
    if (!bi.count(tree)) { this.toast('Nothing to export yet: pin some tabs first.'); return null; }
    if (!file) {
      const r = await dialog.showSaveDialog(this.win, { title: 'Export bookmarks', defaultPath: path.join(app.getPath('documents'), `Quasar bookmarks - ${sp.name.replace(/[\\/:*?"<>|]+/g, ' ')}.html`),
        filters: [{ name: 'Bookmarks file (HTML)', extensions: ['html'] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    fs.writeFileSync(file, bi.toHtml(tree, `${sp.name} — Quasar bookmarks`));
    this.toast(`Exported ${bi.count(tree)} bookmarks.`, { type: 'show-file', path: file });
    return file;
  }

  // ------------------------------------------------------ password export
  // Like Chrome and Edge: Windows Hello first, a warning that the file isn't encrypted,
  // then a CSV (name,url,username,password,note) any password manager can import.
  async exportPasswords({ file = null, all = null } = {}) {
    if (!this.vault.available) return { error: 'Passwords aren’t available.' };
    if (!(await this.verifyUser('Quasar wants to export your saved passwords.'))) return null;
    const sp = this.space;
    if (all === null) {
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'warning', buttons: [`Export ${sp.name}’s passwords`, 'Export all profiles', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
        message: 'Export passwords?',
        detail: 'The file will hold your passwords as plain text. Anyone who can open it can read them. Import it where you need it, then delete it.',
      });
      if (response === 2) return null;
      all = response === 1;
    }
    const entries = this.vault.data.entries.filter(e => all || e.profile === sp.partition);
    if (!file) {
      const r = await dialog.showSaveDialog(this.win, { title: 'Export passwords', defaultPath: path.join(app.getPath('documents'), 'Quasar Passwords.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    const totp = require('../totp');
    const q = v => /[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
    const host = o => { try { return new URL(o).hostname; } catch { return o; } };
    const rows = [['name', 'url', 'username', 'password', 'note'],
      ...entries.map(e => [host(e.origin), e.origin + '/', e.username, e.password, e.otp ? totp.uri(e.otp, `${host(e.origin)}:${e.username}`) : ''])];
    fs.writeFileSync(file, rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
    this.toast(`Exported ${entries.length} password${entries.length === 1 ? '' : 's'}. Delete the file once you’ve imported it.`, { type: 'show-file', path: file });
    return { file, count: entries.length };
  }
}

module.exports = MigratePart;
