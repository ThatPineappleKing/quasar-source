// Peek (link previews over the page) and screenshots.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app, WebContentsView, clipboard, nativeImage } = require('electron');
const { UI, PRELOAD, ICON, uid, hostOf, copyImage, DRIFT_URL } = require('./common');

class PeekPart {
  // --------------------------------------------------------------- Peek
  // A link preview floating over the current page (Shift+click, links from pinned
  // tabs/Favorites to other sites, or right-click › Open Link in Peek).
  peekRect(card) {
    const w = Math.min(card.width - 48, Math.max(480, Math.round(card.width * 0.86)));
    const top = 48;
    return { x: card.x + Math.round((card.width - w) / 2), y: card.y + top, width: w, height: Math.max(120, card.height - top - 20) };
  }

  ensureLayer() {
    const W = this.cur;
    if (W.layer) return W.layer;
    const layer = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
    layer.setBackgroundColor('#00000000');
    layer.webContents.on('before-input-event', (e, input) => { if (this.wins.has(W)) this.cur = W; this.onKey(e, input); });
    layer.webContents.loadFile(path.join(UI, 'layer.html'));
    W.layerReady = new Promise(r => layer.webContents.once('did-finish-load', r));
    W.layer = layer;
    return layer;
  }

  showLayer(mode, data = {}) {
    const W = this.cur;
    this.ensureLayer();
    W.layerMode = mode;
    this.win.contentView.addChildView(W.layer);
    this.restack();
    this.layout();
    W.layerReady.then(() => {
      if (W.layerMode !== mode || W.layer.webContents.isDestroyed()) return;
      W.layer.webContents.send('layer:show', { mode, ...data, theme: { colors: this.spaceById(W.spaceId)?.colors || [] } });
      if (mode === 'shot') W.layer.webContents.focus();
    });
  }

  hideLayer() {
    const W = this.cur;
    if (!W?.layer || !W.layerMode) return;
    W.layerMode = null;
    try { this.win.contentView.removeChildView(W.layer); } catch { /* ignore */ }
    if (!W.layer.webContents.isDestroyed()) W.layer.webContents.send('layer:hide');
  }

  openPeek(url, spaceId = this.curSpaceId) {
    if (!/^(https?|file):/i.test(url)) return;
    const W = this.cur;
    if (W.peek) { W.peek.tab.url = url; W.peek.view.webContents.loadURL(url).catch(() => {}); return; }
    const tab = { id: uid(), spaceId, kind: 'peek', url, title: hostOf(url), favicon: '', view: null, profile: null, lastActive: Date.now() };
    const view = this.pageView(tab);
    W.peek = { view, tab };
    const wc = view.webContents;
    // These handlers only act while the page is in Peek (Expand turns it into a normal tab).
    const live = () => W.peek?.view === view;
    const send = () => { if (live() && W.layer && !W.layer.webContents.isDestroyed()) W.layer.webContents.send('layer:peek', { url: tab.url, title: tab.title, loading: tab.loading }); };
    wc.on('did-navigate', (e, u) => { if (live()) { if (W.peek.summary) { W.peek.summary = null; this.withWin(W, () => this.layout()); } tab.url = this.isCertPage(u) ? (this.certErrors.get(wc.id)?.url || tab.url) : this.isDriftPage(u) ? DRIFT_URL : this.isFailPage(u) ? (this.failInfo.get(wc.id)?.url || tab.url) : u; send(); } });
    wc.on('did-navigate-in-page', (e, u, main) => { if (live() && main) { tab.url = u; send(); } });
    wc.on('page-title-updated', (e, t) => { if (live()) { tab.title = t; send(); } });
    wc.on('did-start-loading', () => { if (live()) { tab.loading = true; send(); } });
    wc.on('did-stop-loading', () => {
      if (!live()) return;
      tab.loading = false; send();
    });
    wc.on('before-input-event', (e, input) => {
      if (!live()) return;
      if (this.wins.has(W)) this.cur = W;
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.control && !input.alt) { e.preventDefault(); return this.withWin(W, () => this.closePeek()); }
      this.onKey(e, input);
    });
    wc.setWindowOpenHandler(({ url: u, disposition, features }) => {
      if (disposition === 'new-window' && features) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, icon: ICON } };
      this.withWin(W, () => this.newTab(u, { spaceId, active: disposition !== 'background-tab', route: true }));
      return { action: 'deny' };
    });
    this.showLayer('peek', { url, title: tab.title });
    this.win.contentView.addChildView(view);
    this.restack();
    this.layout();
    Promise.resolve(wc.session.__archProxyReady).then(() => !wc.isDestroyed() && wc.loadURL(url).catch(() => {}));
    wc.focus();
    this.push();
  }

  closePeek() {
    const W = this.cur;
    if (!W?.peek) return;
    const { view } = W.peek;
    W.peek = null;
    try { this.win.contentView.removeChildView(view); } catch { /* ignore */ }
    const wc = view.webContents;
    if (wc && !wc.isDestroyed()) wc.close();
    this.hideLayer();
    this.active?.view?.webContents?.focus();
    this.push();
  }

  // Turn the Peek page into a normal tab (keeps its history and scroll position).
  expandPeek() {
    const W = this.cur;
    if (!W?.peek) return;
    const { view, tab: p } = W.peek;
    W.peek = null;
    try { this.win.contentView.removeChildView(view); } catch { /* ignore */ }
    this.hideLayer();
    const tab = this.record({ url: p.url, title: p.title, spaceId: p.spaceId });
    tab.profile = p.profile;
    tab.view = view;
    this.registerPage(view.webContents, tab);
    this.wire(tab);   // wire() also replaces Peek's window-open handler with a tab's
    const list = this.order[tab.spaceId] || (this.order[tab.spaceId] = []);
    const i = list.indexOf(this.activeTabId);
    if (i >= 0) list.splice(i + 1, 0, tab.id); else list.push(tab.id);
    this.show(tab.id);
  }

  // --------------------------------------------------------- screenshots
  // Ctrl+Shift+2: drag over the page to capture a region; buttons for the visible
  // area or the whole page. The image is copied and saved to Downloads.
  shotTarget() {
    const W = this.cur;
    const tab = this.active;
    const r = (W.paneRects || []).find(p => p.tabId === tab?.id);
    return { tab, rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : this.cardRect() };
  }

  startScreenshot() {
    const tab = this.active;
    if (!tab?.view || tab.view.webContents.isDestroyed()) return this.toast('Open a page first.');
    if (this.cur.peek) this.closePeek();
    this.closeCommand();
    this.showLayer('shot');
  }

  async screenshot(kind, rect = null) {
    const W = this.cur;
    const tab = this.shotTarget().tab;
    this.hideLayer();
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    let img;
    try {
      if (kind === 'full') img = await this.capturefullPage(wc);
      else if (kind === 'region' && rect) {
        const r = { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
        await new Promise(res => setTimeout(res, 60));   // let the picker disappear first
        img = await wc.capturePage(r);
      } else { await new Promise(res => setTimeout(res, 60)); img = await wc.capturePage(); }
    } catch (err) { return this.toast(`Couldn’t take the screenshot: ${err.message}`); }
    if (!img || img.isEmpty()) return this.toast('The screenshot came out empty.');
    await copyImage(img);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' at ').replace(/:/g, '.');
    let file = path.join(app.getPath('downloads'), `Screenshot ${stamp}.png`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(app.getPath('downloads'), `Screenshot ${stamp} (${i}).png`);
    try { await fs.promises.writeFile(file, img.toPNG()); } catch (err) { return this.toast(`Copied, but couldn’t save: ${err.message}`); }
    const sp = this.spaceById(tab.spaceId);
    const size = img.getSize();
    this.st.downloads.unshift({ id: uid(), url: tab.url, filename: path.basename(file), path: file, mime: 'image/png', total: fs.statSync(file).size,
      received: fs.statSync(file).size, state: 'completed', start: Date.now(), end: Date.now(), spaceId: sp?.id || null, partition: tab.profile, private: !!sp?.private, screenshot: true });
    this.downloadsChanged(true);
    this.withWin(W, () => this.toast(`Screenshot copied to the clipboard and saved (${size.width}×${size.height}).`, { type: 'show-file', path: file },
      [{ label: '✎ Mark up', act: ['markup', file] }, { label: 'Show file', act: ['showFile', file] }]));
    return file;
  }

  // Whole page, including what's scrolled out of view (via the DevTools protocol).
  async capturefullPage(wc) {
    const dbg = wc.debugger;
    const attached = dbg.isAttached();
    if (!attached) dbg.attach('1.3');
    try {
      const m = await dbg.sendCommand('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      const width = Math.ceil(Math.min(size.width, 8000));
      const height = Math.ceil(Math.min(size.height, 16000));   // very long pages are cut at 16,000px
      const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
    } finally { if (!attached) { try { dbg.detach(); } catch { /* ignore */ } } }
  }
}

module.exports = PeekPart;
