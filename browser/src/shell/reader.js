// Reader mode and translation (on this PC with Bergamot, or Google Translate).
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app, Menu, clipboard, session, dialog, webContents: allWebContents } = require('electron');
const { BLOCK_PAGE, READER_PAGE, READABILITY, uid, hostOf } = require('./common');

class ReaderPart {
  // ---------------------------------------------------------- reader mode
  // Mozilla Readability (Firefox's Reader View engine), run in an isolated world.
  readabilitySrc() {
    if (!this._readability) {
      const mod = f => `(() => { const module = { exports: {} }; ${fs.readFileSync(path.join(READABILITY, f), 'utf8')}\n; return module.exports; })()`;
      this._readability = { full: mod('Readability.js'), check: mod('Readability-readerable.js') };
    }
    return this._readability;
  }

  // After a page loads: is it an article? (shows the reader button) and what language is it?
  async inspectPage(tab) {
    const wc = tab.view?.webContents;
    if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) { tab.readerable = false; tab.pageLang = ''; return this.push(); }
    try {
      const { check } = this.readabilitySrc();
      // Checked when the page is idle, so it doesn't compete with the page's own start-up.
      const r = await wc.executeJavaScriptInIsolatedWorld(1006, [{ code: `new Promise(done => requestIdleCallback(() => { const R = ${check}; const f = R.isProbablyReaderable || R;
        done({ reader: !!f(document, { minContentLength: 140, minScore: 20 }), lang: (document.documentElement.lang || document.querySelector('meta[http-equiv="content-language" i]')?.content || '').trim() }); }, { timeout: 2000 }))` }]);
      tab.readerable = !!r?.reader;
      tab.pageLang = String(r?.lang || '').slice(0, 20);
    } catch { tab.readerable = false; }
    this.push();
    // You translated a page on this site: the next ones in that language are translated too.
    const a = tab.autoTranslate;
    if (a && hostOf(tab.url) === a.site && tab.pageLang.split('-')[0].toLowerCase() === a.from && this.localTranslation) this.translateLocal(tab, a.from, a.to);
  }

  async openReader(tab = this.active) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (this.isReaderPage(wc.getURL())) return this.readerAction(wc, 'exit');
    let art = null;
    try {
      const { full } = this.readabilitySrc();
      art = await wc.executeJavaScriptInIsolatedWorld(1006, [{ code: `(() => { const R = ${full}; const Readability = R.Readability || R;
        const a = new Readability(document.cloneNode(true), { charThreshold: 300, keepClasses: false }).parse();
        return a && { title: a.title, byline: a.byline, siteName: a.siteName, content: a.content, length: a.length, excerpt: a.excerpt, lang: a.lang || document.documentElement.lang, dir: a.dir, published: a.publishedTime }; })()` }]);
    } catch { art = null; }
    if (!art?.content) return this.toast('Reader mode couldn’t find an article on this page.');
    const url = wc.getURL();
    this.readerInfo ||= new Map();
    this.readerInfo.set(wc.id, { url, art: { ...art, url, host: hostOf(url) } });
    wc.loadFile(READER_PAGE).catch(() => {});   // guard() hands it the article when it has loaded
  }

  // Reader page buttons signal by replacing the #hash.
  readerAction(wc, action) {
    const info = this.readerInfo?.get(wc.id);
    if (!info) return;
    if (action === 'exit') {
      const nav = wc.navigationHistory;
      const i = nav.getActiveIndex();
      if (i > 0 && nav.getAllEntries()[i - 1].url === info.url) nav.goBack(); else wc.loadURL(info.url).catch(() => {});
    } else if (action === 'translate') {
      const t = this.pageTabs.get(wc.id);
      if (t) this.translatePage(t, info.url, this.localTranslation ? String(info.art?.lang || '').split('-')[0].toLowerCase() || null : null);
    }
  }

  // ----------------------------------------------------------- translation
  // Pages: Google Translate's public page translator (works for public pages only).
  // Selections: Google Translate in Peek. Asks once, since the address goes to Google.
  get translateTo() { return (this.st.settings.translateTo || app.getLocale() || 'en').split('-')[0].toLowerCase(); }
  langName(code) { try { return new Intl.DisplayNames([app.getLocale() || 'en'], { type: 'language' }).of(code) || code; } catch { return code; } }

  async translateConsent() {
    if (this.st.settings.translateConsent) return true;
    const { response, checkboxChecked } = await dialog.showMessageBox(this.win, {
      type: 'question', buttons: ['Translate', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
      message: 'Translate with Google Translate?',
      detail: 'The page’s address is sent to Google, which fetches the page and shows it translated. Pages that need you to be signed in (or are on your own network) can’t be translated this way.',
      checkbox: 'Don’t ask again', checkboxChecked: true,
    });
    if (response !== 0) return false;
    if (checkboxChecked) { this.st.settings.translateConsent = true; this.persist(); }
    return true;
  }

  // On this PC (Bergamot, src/mt.js) when the languages are available, which is the
  // default; Google Translate otherwise, or when chosen in Settings.
  get mt() { return this._mt || (this._mt = new (require('../mt').OnDeviceTranslator)()); }
  get localTranslation() { return this.st.settings.translateEngine !== 'google'; }

  async translatePage(tab = this.active, url = null, from = null) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const src = url || tab.url;
    if (tab.translated?.local) return this.showOriginal(tab);
    if (/\.translate\.goog$/i.test(hostOf(src))) return this.showOriginal(tab);
    if (!/^(https?|file):/i.test(src) && !this.isReaderPage(wc.getURL())) return this.toast('Only web pages can be translated.');
    if (this.localTranslation) {
      const to = this.translateTo;
      from = from || (tab.pageLang || '').split('-')[0].toLowerCase();
      let ok = false;
      try { ok = !!from && from !== to && !!(await this.mt.route(from, to)); } catch (err) { this.toast(err.message); }
      if (ok) return this.translateLocal(tab, from, to);
      if (!from || from === to) return this.pickSourceLanguage(tab);
      // Not available on this PC: offer Google instead.
      const { response } = await dialog.showMessageBox(this.windowFor(tab, wc), { type: 'question', buttons: ['Use Google Translate', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
        message: `${this.langName(from)} to ${this.langName(to)} can’t be translated on this PC yet.`,
        detail: 'Quasar’s on-device translation covers Bulgarian, Czech, Dutch, English, Estonian, Farsi, French, German, Icelandic, Italian, Norwegian, Polish, Portuguese, Russian, Spanish and Ukrainian. Google Translate can do it, but the page’s address is sent to Google and pages you’re signed in to won’t work.' });
      if (response !== 0) return;
      tab.translatedFrom = src;
      return wc.loadURL(`https://translate.google.com/translate?sl=auto&tl=${to}&hl=${to}&u=${encodeURIComponent(src)}`).catch(() => {});
    }
    if (!/^https?:/i.test(src)) return this.toast('Only web pages can be translated with Google.');
    if (!(await this.translateConsent())) return;
    tab.translatedFrom = src;
    wc.loadURL(`https://translate.google.com/translate?sl=auto&tl=${this.translateTo}&hl=${this.translateTo}&u=${encodeURIComponent(src)}`).catch(() => {});
  }

  // The page doesn't say what language it's in: ask.
  async pickSourceLanguage(tab) {
    let langs;
    try { langs = (await this.mt.languages()).from.filter(l => l !== this.translateTo); } catch (err) { return this.toast(err.message); }
    const items = [{ label: 'This page is in…', enabled: false }];
    for (const l of langs.sort((a, b) => this.langName(a).localeCompare(this.langName(b)))) items.push({ label: this.langName(l), click: () => this.translatePage(tab, null, l) });
    items.push({ type: 'separator' }, { label: 'Use Google Translate (detects the language)…', click: async () => {
      if (!(await this.translateConsent())) return;
      tab.translatedFrom = tab.url;
      tab.view?.webContents.loadURL(`https://translate.google.com/translate?sl=auto&tl=${this.translateTo}&hl=${this.translateTo}&u=${encodeURIComponent(tab.url)}`).catch(() => {});
    } });
    Menu.buildFromTemplate(items).popup({ window: this.windowFor(tab, tab.view?.webContents) });
  }

  // Translate the page's text where it is (event handlers and layout stay as they are).
  // The originals are kept in the page's isolated world for "Show original".
  async translateLocal(tab, from, to) {
    const wc = tab.view?.webContents;
    if (!wc || wc.isDestroyed() || tab.translating) return;
    const W = this.hostOf(tab.id) || this.cur;
    const nav = wc.getURL();
    tab.translating = true;
    this.push();
    try {
      const need = await this.mt.needed(from, to);
      if (need) this.withWin(W, () => this.toast(`Downloading the ${this.langName(from)} → ${this.langName(to)} translation model (${Math.round(need / 1048576)} MB, only this once)…`));
      const texts = await wc.executeJavaScriptInIsolatedWorld(1007, [{ code: `(() => {
        const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|KBD|SAMP|VAR|SVG|MATH|TEMPLATE|IFRAME|OBJECT|INPUT|SELECT|OPTION)$/;
        const st = window.__archTr = window.__archTr || { nodes: [], orig: [] };
        const nodes = [], texts = [];
        const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: n => {
          for (let p = n.parentElement; p; p = p.parentElement) { if (SKIP.test(p.tagName) || p.isContentEditable || p.getAttribute('translate') === 'no' || p.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT; }
          return /\\p{L}{2}/u.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        } });
        for (let n; (n = w.nextNode()) && nodes.length < 6000;) {
          if (st.nodes.includes(n)) continue;
          nodes.push(n); texts.push(n.nodeValue.trim().replace(/\\s+/g, ' ').slice(0, 4000));
        }
        st.pending = nodes;
        return texts;
      })()` }]);
      if (!texts?.length) { tab.translating = false; this.push(); return this.toast('No text to translate on this page.'); }
      // In chunks, applied as they come, so the top of the page changes first.
      for (let i = 0; i < texts.length; i += 120) {
        const part = await this.mt.translate(from, to, texts.slice(i, i + 120));
        if (wc.isDestroyed() || wc.getURL() !== nav) return;
        await wc.executeJavaScriptInIsolatedWorld(1007, [{ code: `(() => {
          const st = window.__archTr, out = ${JSON.stringify(part)};
          out.forEach((t, k) => {
            const n = st.pending[${i} + k];
            if (!n || t == null || !n.isConnected) return;
            const v = n.nodeValue, lead = v.match(/^\\s*/)[0], trail = v.match(/\\s*$/)[0];
            st.nodes.push(n); st.orig.push(v);
            n.nodeValue = lead + t + trail;
          });
          if (!document.documentElement.dataset.archTranslatedFrom) document.documentElement.dataset.archTranslatedFrom = document.documentElement.lang || '';
          document.documentElement.lang = ${JSON.stringify(to)};
        })()` }]);
      }
      tab.translated = { local: true, from, to };
      tab.autoTranslate = { from, to, site: hostOf(tab.url) };   // following pages on this site too, until "Show original"
    } catch (err) {
      this.withWin(W, () => this.toast(`Couldn’t translate: ${err.message}`));
    } finally {
      tab.translating = false;
      this.push();
    }
  }

  showOriginal(tab = this.active) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (tab.translated?.local) {
      tab.translated = null;
      tab.autoTranslate = null;
      wc.executeJavaScriptInIsolatedWorld(1007, [{ code: `(() => {
        const st = window.__archTr; if (!st) return;
        st.nodes.forEach((n, i) => { if (n.isConnected) n.nodeValue = st.orig[i]; });
        st.nodes = []; st.orig = [];
        if ('archTranslatedFrom' in document.documentElement.dataset) { document.documentElement.lang = document.documentElement.dataset.archTranslatedFrom; delete document.documentElement.dataset.archTranslatedFrom; }
      })()` }]).catch(() => {});
      return this.push();
    }
    let orig = tab.translatedFrom;
    if (!orig) {
      // example-com.translate.goog/path?_x_tr_sl=… -> https://example.com/path
      try {
        const u = new URL(tab.url);
        const host = u.hostname.replace(/\.translate\.goog$/, '').replace(/--/g, '\u0000').replace(/-/g, '.').replace(/\u0000/g, '-');
        for (const k of [...u.searchParams.keys()]) if (k.startsWith('_x_tr_')) u.searchParams.delete(k);
        orig = `https://${host}${u.pathname}${u.search}`;
      } catch { return; }
    }
    tab.translatedFrom = null;
    wc.loadURL(orig).catch(() => {});
  }

  async translateSelection(text, spaceId, tab = null) {
    // On this PC when the page's language is known and available.
    const from = (tab?.pageLang || '').split('-')[0].toLowerCase();
    if (this.localTranslation && from && from !== this.translateTo) {
      try {
        if (await this.mt.route(from, this.translateTo)) {
          const [t] = await this.mt.translate(from, this.translateTo, [String(text).slice(0, 4000)]);
          if (t) {
            const { response } = await dialog.showMessageBox(this.windowFor(tab, tab?.view?.webContents), { type: 'none', buttons: ['Copy', 'Close'], defaultId: 1, cancelId: 1, noLink: true,
              title: 'Translation', message: t, detail: `${this.langName(from)} → ${this.langName(this.translateTo)} · translated on this PC` });
            if (response === 0) clipboard.writeText(t);
            return;
          }
        }
      } catch { /* fall back to Google */ }
    }
    if (!(await this.translateConsent())) return;
    this.openPeek(`https://translate.google.com/?sl=auto&tl=${this.translateTo}&op=translate&text=${encodeURIComponent(String(text).slice(0, 4000))}`, spaceId);
  }

  // A main-frame load failed: was it stopped by the dangerous-site check, or was it
  // an Always-HTTPS upgrade the site doesn't support? Then show the right page.
  onBlockedLoad(wc, url, code) {
    const P = this.protection;
    const b = P.blocked.get(wc.id);
    if (b && code === -20 /* ERR_BLOCKED_BY_CLIENT */) {
      wc.loadFile(BLOCK_PAGE, { query: { kind: b.kind, host: b.host } }).catch(() => {});
      this.push();
      return true;
    }
    const up = P.upgrades.get(wc.id);
    if (up && code !== -3 /* aborted */ && /^https:/i.test(url) && hostOf(url) === hostOf(up.httpsUrl)) {
      P.blocked.set(wc.id, { kind: 'https', url: up.httpUrl, host: up.host, partition: wc.session.__archPartition, code });
      P.upgrades.delete(wc.id);
      wc.loadFile(BLOCK_PAGE, { query: { kind: 'https', host: up.host, code: String(code) } }).catch(() => {});
      this.push();
      return true;
    }
    return false;
  }

  // Buttons on the warning page signal by replacing its #hash.
  blockPageAction(wc, action) {
    const P = this.protection;
    const b = P.blocked.get(wc.id);
    if (!b) return;
    if (action === 'proceed') {
      if (b.kind === 'https') P.httpOk.add(`${b.partition}|${b.host}`);      // this session only
      else P.dangerOk.add(`${b.partition}|${b.host}`);
      wc.loadURL(b.url).catch(() => {});
    } else if (action === 'back') {
      const nav = wc.navigationHistory;
      const entries = nav.getAllEntries();
      let i = nav.getActiveIndex() - 1;
      while (i >= 0 && (entries[i].url === b.url || this.isArchPage(entries[i].url))) i--;
      if (i >= 0) nav.goToIndex(i); else wc.loadURL('about:blank').catch(() => {});
    }
  }

  // Reload: on the crash page this means "load the page that crashed again".
  reloadPage(wc) {
    if (!wc || wc.isDestroyed()) return;
    if (this.isCrashPage(wc.getURL())) return this.crashPageAction(wc, 'reload');
    if (this.isFailPage(wc.getURL())) return this.failPageAction(wc, 'retry');
    wc.reload();
  }

  // A page stopped responding (e.g. an endless script): offer to wait or stop it.
  onUnresponsive(wc) {
    if (wc.isDestroyed()) return;
    const tab = this.pageTabs.get(wc.id);
    const token = uid();
    this.hung.set(token, wc.id);
    const host = hostOf(tab?.url || wc.getURL()) || 'This page';
    const W = (tab && this.hostOf(tab.id)) || this.cur;
    this.withWin(W, () => this.toast(`${host} isn’t responding.`, null,
      [{ label: 'Wait', act: ['hung:wait', token] }, { label: 'Stop page', act: ['hung:kill', token] }]));
  }

  hungAct(op, token) {
    const id = this.hung.get(token);
    this.hung.delete(token);
    const wc = id && allWebContents.fromId(id);
    if (op === 'kill' && wc && !wc.isDestroyed()) {
      (this.stoppedByUser ||= new Set()).add(wc.id);
      wc.forcefullyCrashRenderer();   // shows the "page was stopped" page with Reload
    }
  }

  finishWinClose(W) {
    W.quitting = false;
    W.quitReady = true;
    if (W.closeAll) {
      // Quit Quasar: the other windows close first, without asking again (their pages already agreed).
      for (const x of [...this.wins]) if (x !== W) { x.quitReady = true; if (!x.win.isDestroyed()) x.win.close(); }
    }
    if (W.win && !W.win.isDestroyed()) W.win.close();
  }
}

module.exports = ReaderPart;
