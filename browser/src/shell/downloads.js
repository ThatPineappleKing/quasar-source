// Downloads (including resuming after a restart) and per-site zoom.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app, clipboard, dialog, session, shell: eShell } = require('electron');
const { uid, ZOOMS } = require('./common');

class DownloadsPart {
  // ----------------------------------------------------------- downloads
  onDownload(ses, item) {
    const partition = ses.__archPartition;
    // Downloads from known malware addresses are stopped.
    const bad = this.protection.safeOn && (item.getURLChain() || [item.getURL()]).map(u => this.protection.dangerous(u)).find(Boolean);
    if (bad) {
      item.cancel();
      return this.toast(`Quasar blocked a download from ${bad.host}: it’s on a list of ${bad.kind === 'malware' ? 'malware' : 'phishing'} sites.`);
    }
    const sp = [...this.st.spaces, ...this.privateSpaces.values()].find(s => s.partition === partition);
    // A download carried over from last time (see resumeDownload): reuse its entry.
    const pending = this.pendingResume?.get(path.normalize(item.getSavePath() || '').toLowerCase());
    let d;
    if (pending) {
      this.pendingResume.delete(path.normalize(item.getSavePath()).toLowerCase());
      d = pending;
      Object.assign(d, { state: 'progressing', paused: false, suspended: false, part: null, end: null });
    } else {
      const dir = app.getPath('downloads');
      const name = item.getFilename() || 'download';
      let target = path.join(dir, name);
      for (let i = 1; fs.existsSync(target) || fs.existsSync(target + '.archpart'); i++) {
        const ext = path.extname(name);
        target = path.join(dir, `${path.basename(name, ext)} (${i})${ext}`);
      }
      // Settings › Ask where to save each download.
      if (this.st.settings.askDownload) {
        const W = [...this.wins].find(x => x.spaceId === sp?.id) || this.cur;
        const ext = path.extname(name).slice(1);
        const chosen = dialog.showSaveDialogSync(W?.win || this.win, { title: 'Save as', defaultPath: target, filters: ext ? [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : [] });
        if (!chosen) { item.cancel(); return; }
        target = chosen;
      }
      item.setSavePath(target);
      d = {
        id: uid(), url: item.getURL(), filename: path.basename(target), path: target, mime: item.getMimeType(),
        total: item.getTotalBytes(), received: 0, state: 'progressing', paused: false, start: Date.now(),
        spaceId: sp?.id || null, partition, private: !!sp?.private,
      };
      this.st.downloads.unshift(d);
      this.st.downloads = this.st.downloads.slice(0, 300);
      this.toast(`Downloading ${d.filename}…`, { type: 'downloads' });
    }
    this.liveDownloads.set(d.id, item);
    // What's needed to pick the download up again after Quasar restarts.
    const remember = () => {
      d.resume = { urlChain: item.getURLChain(), mime: item.getMimeType(), etag: item.getETag(), lastModified: item.getLastModifiedTime(),
        startTime: item.getStartTime(), total: item.getTotalBytes() };
    };
    remember();
    let last = 0;
    item.on('updated', (ev, state) => {
      if (d.suspended) return;
      d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      d.paused = item.isPaused();
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      if (Date.now() - last > 300) { last = Date.now(); remember(); this.downloadsChanged(); }
    });
    item.once('done', (ev, state) => {
      this.liveDownloads.delete(d.id);
      if (d.suspended) return;    // Quasar is quitting; the partial file was kept for next time
      d.state = state;            // completed | cancelled | interrupted
      d.paused = false;
      d.received = item.getReceivedBytes();
      d.end = Date.now();
      if (state === 'completed') { d.resume = null; this.toast(`Downloaded ${d.filename}`, { type: 'show-file', path: d.path }); }
      else if (state === 'interrupted') this.toast(`Download failed: ${d.filename}`, { type: 'downloads' });
      else d.resume = null;
      this.downloadsChanged(true);
    });
    if (pending) item.resume();
    this.downloadsChanged(true);
  }

  // Quasar is quitting: Electron would cancel unfinished downloads and delete what they
  // had saved. Pause them and keep the partial file (a hard link, so it's instant) as
  // "<file>.archpart", so they can carry on from the same point next time.
  suspendDownloads() {
    for (const [id, item] of this.liveDownloads) {
      const d = this.st.downloads.find(x => x.id === id);
      if (!d || d.private) continue;
      try {
        if (item.getState() !== 'progressing') continue;
        item.pause();
        const part = d.path + '.archpart';
        try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
        try { fs.linkSync(d.path, part); } catch { fs.copyFileSync(d.path, part); }
        d.suspended = true;
        d.part = part;
        d.state = 'interrupted';
        d.paused = false;
        d.received = fs.statSync(part).size;
      } catch { /* can't keep it: it will show as failed, with Retry */ }
    }
  }

  // Next launch: offer to continue downloads that were running when Quasar closed.
  offerDownloadResume() {
    const waiting = this.st.downloads.filter(d => this.canResumeLater(d));
    if (!waiting.length) return;
    const W = this.cur;
    W?.win.webContents.once('did-finish-load', () => setTimeout(() => this.withWin(W, () => this.toast(
      waiting.length === 1 ? `“${waiting[0].filename}” didn’t finish downloading before Quasar closed.` : `${waiting.length} downloads didn’t finish before Quasar closed.`,
      { type: 'downloads' }, [{ label: 'Resume', act: ['resumeDownloads'] }, { label: 'Show', act: ['library', 'downloads'] }])), 1200));
  }

  canResumeLater(d) {
    return d.state === 'interrupted' && !this.liveDownloads.has(d.id) && !!d.part && !!d.resume?.urlChain?.length && fs.existsSync(d.part);
  }

  // Continue a download from its kept partial file (asks the server for the rest).
  resumeDownload(d) {
    if (!this.canResumeLater(d)) return false;
    let target = d.path;
    if (fs.existsSync(target)) {   // something else took the name meanwhile
      const ext = path.extname(d.path), stem = path.basename(d.path, ext);
      for (let i = 1; fs.existsSync(target); i++) target = path.join(path.dirname(d.path), `${stem} (${i})${ext}`);
    }
    try { fs.renameSync(d.part, target); } catch { return false; }
    d.path = target; d.filename = path.basename(target); d.part = null;
    const offset = fs.statSync(target).size;
    const sp = this.spaceById(d.spaceId);
    const partition = sp?.partition || d.partition;
    const ses = session.fromPartition('persist:' + partition);
    this.setupSession(ses, partition);
    (this.pendingResume ||= new Map()).set(path.normalize(target).toLowerCase(), d);
    const r = d.resume;
    const opts = { path: target, urlChain: r.urlChain, mimeType: r.mime || '', offset, length: r.total || 0, startTime: r.startTime || Date.now() / 1000 };
    if (r.lastModified) opts.lastModified = r.lastModified;
    if (r.etag) opts.eTag = r.etag;
    ses.createInterruptedDownload(opts);
    return true;
  }

  resumeAllDownloads() {
    for (const d of this.st.downloads.filter(x => this.canResumeLater(x))) this.resumeDownload(d);
    this.downloadsChanged(true);
  }

  dropPart(d) {
    if (d?.part) { try { fs.rmSync(d.part, { force: true }); } catch { /* ignore */ } d.part = null; }
  }

  downloadsChanged(save = false) {
    if (save) this.persist();
    this.push();
    this.libUpdate();
    // The downloads drop-down, if it's open, follows along (progress, finished, removed).
    clearTimeout(this._dlMenuT);
    this._dlMenuT = setTimeout(() => {
      for (const W of this.wins) if (W.overlayMode === 'downloads' && W.overlay && !W.overlay.webContents.isDestroyed()) this.withWin(W, () => this.dlMenuData().then(d => W.overlay.webContents.send('dl:list', d)));
    }, 150);
  }

  // ---------------------------------------------- the downloads drop-down
  // The button at the top left of the sidebar: the last 3 downloads, and "Click to see
  // all" (the Library) when there are more. Like Arc's and Chrome's.
  dlVisible() {
    const sp = this.space;
    return this.st.downloads.filter(d => sp.private ? d.spaceId === sp.id : !d.private);
  }

  async dlMenuData() {
    const list = this.dlVisible();
    this._dlIcons ||= new Map();
    const items = await Promise.all(list.slice(0, 3).map(async d => {
      const exists = d.state === 'completed' ? fs.existsSync(d.path) : true;
      let icon = this._dlIcons.get(path.extname(d.path || '').toLowerCase());
      if (icon === undefined && d.path) {
        try { const img = await app.getFileIcon(fs.existsSync(d.path) ? d.path : (d.path + '.archpart'), { size: 'normal' }); icon = img.isEmpty() ? '' : img.toDataURL(); } catch { icon = ''; }
        if (fs.existsSync(d.path)) this._dlIcons.set(path.extname(d.path).toLowerCase(), icon);
      }
      const live = this.liveDownloads.get(d.id);
      return { id: d.id, name: d.filename, state: d.state, paused: !!d.paused, received: d.received || 0, total: d.total || 0, exists, icon: icon || '',
        host: (() => { try { return new URL(d.url).hostname.replace(/^www./, ''); } catch { return ''; } })(), end: d.end || 0,
        canResume: !!live?.canResume() || this.canResumeLater(d), screenshot: !!d.screenshot };
    }));
    return { items, more: Math.max(0, list.length - 3), total: list.length };
  }

  async openDownloadsMenu(x, y) {
    const data = await this.dlMenuData();
    this.openCommand('downloads', '', { dl: { ...data, x, y } });
  }

  dlMenuAct(op, id) {
    if (op === 'all') { this.closeCommand(); return this.openLibrary('downloads'); }
    if (op === 'open' || op === 'show') this.closeCommand();
    return this.downloadAct(op, id);
  }

  downloadAct(op, id) {
    const d = this.st.downloads.find(x => x.id === id);
    if (!d) return;
    const item = this.liveDownloads.get(id);
    switch (op) {
      case 'pause': item?.pause(); d.paused = true; break;
      case 'resume':
        if (item?.canResume()) { item.resume(); d.paused = false; }
        else if (!item) this.resumeDownload(d);   // left unfinished when Quasar closed
        break;
      case 'cancel': if (item) item.cancel(); else { this.dropPart(d); d.state = 'cancelled'; d.resume = null; } break;
      case 'retry': {
        if (item?.canResume()) { item.resume(); break; }
        if (!item && this.resumeDownload(d)) break;
        this.dropPart(d);
        this.st.downloads = this.st.downloads.filter(x => x !== d);
        const sp = this.spaceById(d.spaceId);
        const ses = session.fromPartition(sp ? (sp.private ? sp.partition : 'persist:' + sp.partition) : 'persist:' + (d.partition || this.space.partition));
        this.setupSession(ses, sp?.partition || d.partition);
        ses.downloadURL(d.url);
        break;
      }
      case 'open': if (d.state === 'completed') eShell.openPath(d.path).then(err => err && this.toast(err)); break;
      case 'show': if (fs.existsSync(d.path)) eShell.showItemInFolder(d.path); else this.toast('That file was moved or deleted.'); break;
      case 'remove': if (!item) { this.dropPart(d); this.st.downloads = this.st.downloads.filter(x => x !== d); } break;
      case 'copy': clipboard.writeText(d.url); break;
    }
    this.downloadsChanged(true);
  }

  // ----------------------------------------------------------- page zoom
  // Zoom is remembered per site, per Space; Ctrl+wheel and Ctrl +/- both use it.

  zoomKey(tab) {
    try { const u = new URL(tab.url); return /^https?:$/.test(u.protocol) ? u.hostname : ''; } catch { return ''; }
  }

  applyZoom(tab) {
    const wc = tab.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const host = this.zoomKey(tab);
    const f = (host && this.st.zoom[tab.profile]?.[host]) || (host ? this.defaultZoom : 1);
    if (Math.abs(wc.getZoomFactor() - f) > 0.001) wc.setZoomFactor(f);
  }

  // Settings › Default zoom (sites you've zoomed keep their own).
  get defaultZoom() { const z = Number(this.st.settings.defaultZoom); return ZOOMS.includes(z) ? z : 1; }

  zoom(dir, tab = this.active) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const Z = ZOOMS;
    const cur = wc.getZoomFactor();
    const host = this.zoomKey(tab);
    const base = host ? this.defaultZoom : 1;
    let f = base;
    if (dir > 0) f = Z.find(z => z > cur + 0.001) || Z[Z.length - 1];
    else if (dir < 0) f = [...Z].reverse().find(z => z < cur - 0.001) || Z[0];
    wc.setZoomFactor(f);
    const sp = this.spaceById(tab.spaceId);
    if (host && tab.profile) {
      const m = this.st.zoom[tab.profile] ||= {};
      if (f === base) delete m[host]; else m[host] = f;
      if (sp?.private) { /* applied now, never saved */ } else this.persist();
    }
    this.push();
    this.libUpdate();
  }
}

module.exports = DownloadsPart;
