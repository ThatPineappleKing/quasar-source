// Everyday browsing: search shortcuts ("w cats"), links to highlighted text, reading
// any page aloud, Windows live captions, unread counts on pinned tabs, and searching
// the text of every open tab.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { net } = require('electron');
const { hostOf, uid } = require('./common');
const { siteOf } = require('../protection');

// Built in, like Chrome's and Firefox's keywords. People can add, change or remove them.
const DEFAULT_KEYWORDS = [
  { keyword: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
  { keyword: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  { keyword: 'g', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { keyword: 'b', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { keyword: 'd', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { keyword: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s' },
  { keyword: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s' },
  { keyword: 'maps', name: 'Google Maps', url: 'https://www.google.com/maps/search/%s' },
  { keyword: 'a', name: 'Amazon', url: 'https://www.amazon.com/s?k=%s' },
  { keyword: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q=%s' },
  { keyword: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s' },
  { keyword: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=%s' },
  { keyword: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org/search?q=%s' },
];

class EverydayPart {
  // -------------------------------------------------------- search shortcuts
  get keywords() {
    if (!Array.isArray(this.st.searchKeywords)) this.st.searchKeywords = DEFAULT_KEYWORDS.map(k => ({ ...k, id: uid() }));
    return this.st.searchKeywords;
  }

  // "w cats" -> { k, url } (the keyword, then a space, then what to search for).
  keywordSearch(text) {
    const m = /^(\S+)\s+(.+)$/.exec(String(text || '').trim());
    if (!m) return null;
    const k = this.keywords.find(x => x.keyword.toLowerCase() === m[1].toLowerCase());
    if (!k) return null;
    return { k, query: m[2], url: k.url.replace(/%s/g, encodeURIComponent(m[2]).replace(/%20/g, '+')) };
  }

  keywordAct(op, arg = {}) {
    const list = this.keywords;
    if (op === 'list') return list;
    if (op === 'save') {
      const keyword = String(arg.keyword || '').trim().replace(/\s+/g, '').slice(0, 20);
      const url = String(arg.url || '').trim();
      if (!keyword) return { error: 'Type a short keyword, like “w”.' };
      if (!/^https?:\/\/.+%s/.test(url)) return { error: 'The address needs %s where the search words go, like https://example.com/search?q=%s' };
      const clash = list.find(x => x.keyword.toLowerCase() === keyword.toLowerCase() && x.id !== arg.id);
      if (clash) return { error: `“${keyword}” already searches ${clash.name}.` };
      const hit = arg.id && list.find(x => x.id === arg.id);
      const name = String(arg.name || '').trim().slice(0, 40) || hostOf(url);
      if (hit) Object.assign(hit, { keyword, url, name, auto: false }); else list.push({ id: uid(), keyword, name, url });
    } else if (op === 'remove') {
      this.st.searchKeywords = list.filter(x => x.id !== arg.id);
      (this.st.keywordsRemoved ||= []).push(hostOf(list.find(x => x.id === arg.id)?.url || ''));
    } else if (op === 'reset') this.st.searchKeywords = DEFAULT_KEYWORDS.map(k => ({ ...k, id: uid() }));
    this.changed();
    return this.keywords;
  }

  // A site described its own search (OpenSearch): add it, keyword = the site's name.
  async onOpenSearch(wc, href) {
    try {
      const tab = this.pageTabs.get(wc.id);
      if (!tab || this.privateSpaces.has(tab.spaceId) || !/^https:/i.test(href)) return;
      const host = hostOf(wc.getURL());
      if (!host || hostOf(href) && siteOf(hostOf(href)) !== siteOf(host)) return;   // only a site's own search
      if (this.keywords.some(k => siteOf(hostOf(k.url)) === siteOf(host)) || (this.st.keywordsRemoved || []).includes(host)) return;
      const r = await wc.session.fetch(href, { headers: { Accept: 'application/opensearchdescription+xml, text/xml' } });
      if (!r.ok) return;
      const xml = (await r.text()).slice(0, 50000);
      const tpl = /<Url\b[^>]*type="text\/html"[^>]*template="([^"]+)"/i.exec(xml)?.[1] || /<Url\b[^>]*template="([^"]+)"[^>]*type="text\/html"/i.exec(xml)?.[1];
      if (!tpl || !/\{searchTerms\}/.test(tpl)) return;
      const url = tpl.replace(/&amp;/g, '&').replace(/\{searchTerms\}/g, '%s').replace(/\{[^}]*\?\}/g, '').replace(/\{startPage\}/g, '1').replace(/\{count\}/g, '20');
      if (!/^https:\/\//i.test(url) || siteOf(hostOf(url)) !== siteOf(host)) return;
      const name = (/<ShortName>([^<]+)<\/ShortName>/i.exec(xml)?.[1] || host).trim().slice(0, 40);
      let keyword = siteOf(host).split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!keyword || this.keywords.some(k => k.keyword === keyword)) return;
      this.keywords.push({ id: uid(), keyword, name, url, auto: true });
      this.persist();
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------- link to highlight
  // A link that scrolls to and highlights the selected text (a "text fragment").
  highlightLink(pageUrl, text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || !/^https?:/i.test(pageUrl)) return null;
    const enc = s => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');
    const words = t.split(' ');
    const frag = words.length > 10 ? `${enc(words.slice(0, 5).join(' '))},${enc(words.slice(-5).join(' '))}` : enc(t);
    return pageUrl.replace(/#.*$/, '') + '#:~:text=' + frag;
  }

  // ---------------------------------------------------------- read aloud
  // Any page (or the selected text) read by Windows' voices; the controls are in the sidebar.
  async readAloud(tab = this.active, text = null) {
    const wc = tab?.view?.webContents;
    if (!text) {
      if (!wc || wc.isDestroyed()) return this.toast('Open a page first.');
      text = await this.pageText(wc);
    }
    if (!text?.trim()) return this.toast('There’s no text to read on this page.');
    let lang = '';
    try { lang = await wc?.executeJavaScript('document.documentElement.lang || ""'); } catch { /* ignore */ }
    const W = (tab?.host && this.wins.has(tab.host)) ? tab.host : this.cur;
    W?.win.webContents.send('ui:speak', { text: text.slice(0, 200000), lang: String(lang || '').slice(0, 20), title: tab?.title || '' });
    return true;
  }

  // ---------------------------------------------------------- live captions
  // Windows 11's own Live Captions: subtitles for any sound, made on this PC.
  liveCaptions() {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'LiveCaptions.exe');
    if (!fs.existsSync(exe)) return this.toast('Live captions need Windows 11 (version 22H2 or later).');
    try { spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); }
    catch (err) { return this.toast(`Couldn’t start Live Captions: ${err.message}`); }
    this.toast('Live Captions is on: subtitles for anything playing appear at the top of the screen. Win+Ctrl+L turns them off.');
    return true;
  }

  // -------------------------------------------------- unread counts in titles
  // "(3) Inbox", "Inbox (3) – you@x.com", "3 unread" → 3. Pinned tabs show the number.
  unreadIn(title) {
    const t = String(title || '');
    const m = /^\((\d{1,4})\+?\)\s/.exec(t) || /^\[(\d{1,4})\]\s/.exec(t) || /\((\d{1,4})\+?\)\s*[-–—|·:]/.exec(t) || /^(\d{1,4})\s+(unread|new)\b/i.exec(t) || /\((\d{1,4})\)\s*$/.exec(t);
    const n = m ? Number(m[1]) : 0;
    return n > 0 ? n : 0;
  }

  // --------------------------------------------------- search in all tabs
  // The command bar's "Find in all tabs" (Ctrl+Shift+F): every open tab of this Space.
  async searchTabs(text) {
    const q = String(text || '').trim();
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    const sp = this.space;
    const tabs = [...this.tabs.values()].filter(t => t.spaceId === sp.id && ['today', 'pinned', 'fav'].includes(t.kind) && t.url);
    const out = [];
    const snip = (body, i) => { const s = Math.max(0, i - 50); return (s ? '…' : '') + body.slice(s, i + q.length + 70).replace(/\s+/g, ' ').trim() + '…'; };
    await Promise.all(tabs.map(async t => {
      const wc = t.view?.webContents;
      let body = '';
      if (wc && !wc.isDestroyed() && !t.sleeping) {
        try { body = await Promise.race([wc.executeJavaScriptInIsolatedWorld(1012, [{ code: 'document.body ? document.body.innerText.slice(0, 400000) : ""' }]), new Promise(r => setTimeout(() => r(''), 1500))]); } catch { body = ''; }
      } else if (!sp.private) {
        body = this._htext?.get(sp.partition)?.[t.url]?.t || '';   // a sleeping tab: the text kept for history search, if any
      }
      body = String(body || '');
      const lower = body.toLowerCase();
      let i = lower.indexOf(ql), n = 0;
      const first = i;
      while (i >= 0 && n < 999) { n++; i = lower.indexOf(ql, i + ql.length); }
      const inTitle = (t.title || '').toLowerCase().includes(ql) || t.url.toLowerCase().includes(ql);
      if (!n && !inTitle) return;
      out.push({ sec: 'In your tabs', type: 'tabhit', id: t.id, text: q, title: t.title || hostOf(t.url), favicon: t.favicon,
        sub: n ? snip(body, first) : hostOf(t.url), badge: n ? `${n} match${n === 1 ? '' : 'es'}` : (t.sleeping ? 'asleep' : 'in title'), n });
    }));
    return out.sort((a, b) => b.n - a.n).slice(0, 30);
  }

  // ------------------------------------------------------- search with an image
  // Right-click an image › Search Image with Google Lens (or Bing Visual Search when
  // Bing is the search engine). The image's address is sent, not the image itself, so
  // images that only exist inside the page (data:, blob:) can't be searched this way.
  imageSearchItems(src, open) {
    const ok = /^https?:/i.test(src || '');
    const lens = 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(src || '');
    const bing = 'https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:' + encodeURIComponent(src || '');
    const bingFirst = this.st.settings.searchEngine === 'Bing';
    const items = [
      { label: 'Search Image with Google Lens', enabled: ok, url: lens },
      { label: 'Search Image with Bing', enabled: ok, url: bing },
    ];
    if (bingFirst) items.reverse();
    return items.map(({ url, ...it }) => ({ ...it, click: () => open(url) }));
  }

  // ----------------------------------------------------------- look up a word
  // Select a word › right-click › Define. English definitions come from the free
  // Dictionary API (dictionaryapi.dev; only the word is sent); anything it doesn't know
  // opens a search for "define …" in Peek.
  async defineWord(text, tab = this.active) {
    const word = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!word) return null;
    const W = this.cur;
    let entry = null;
    try {
      const get = this._defineFetch || (u => net.fetch(u, { headers: { Accept: 'application/json' } }));
      const r = await get('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase()));
      if (r.ok) {
        const j = JSON.parse(await r.text());
        const e = Array.isArray(j) ? j[0] : null;
        if (e) {
          const meanings = [];
          for (const x of j) for (const m of x.meanings || []) {
            const defs = (m.definitions || []).slice(0, 3).map(d => ({ text: String(d.definition || '').slice(0, 400), example: String(d.example || '').slice(0, 300) })).filter(d => d.text);
            if (defs.length && meanings.length < 4) meanings.push({ part: String(m.partOfSpeech || ''), defs });
          }
          entry = { word: e.word || word, phonetic: e.phonetic || (e.phonetics || []).map(p => p.text).find(Boolean) || '', meanings };
        }
      }
    } catch { /* offline, or the service is down */ }
    if (!entry?.meanings?.length) {
      this.withWin(W, () => this.openPeek(this.searchUrl('define ' + word), tab?.spaceId || this.curSpaceId));
      return null;
    }
    this.withWin(W, () => this.openCommand('define', '', { define: { ...entry, more: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(entry.word) } }));
    return entry;
  }
}

EverydayPart.DEFAULT_KEYWORDS = DEFAULT_KEYWORDS;
module.exports = EverydayPart;
