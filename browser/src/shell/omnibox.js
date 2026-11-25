// The command bar as an address bar: completing the address as you type ("yo" →
// youtube.com) from your own history, tabs, pinned tabs and Favorites, and the
// search engine's suggestions ("weather tom…" → "weather tomorrow").
// Suggestions send what you type to the search engine, so they have a switch
// (Settings › General) and are never fetched in private windows.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { net } = require('electron');
const { pinnedTabNodes, toUrl } = require('./common');

// Each engine's own suggestion service; all answer [query, [suggestion, …]].
const SUGGEST = {
  Google: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s',
  Bing: 'https://api.bing.com/osjson.aspx?query=%s',
  DuckDuckGo: 'https://duckduckgo.com/ac/?q=%s&type=list',
  Brave: 'https://search.brave.com/api/suggest?q=%s',
};

const bare = h => String(h || '').toLowerCase().replace(/^www\./, '');

class OmniboxPart {
  get suggestOn() { return this.st.settings.searchSuggest !== false; }

  // The address to fill in for what's typed, or null.
  completeFor(typed, sp = this.space) {
    const raw = String(typed || '').trim();
    if (!raw || /\s/.test(raw) || raw.length > 200) return null;
    const q = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (!q || /^[.\/:]/.test(q)) return null;
    const withPath = q.includes('/');
    const score = new Map();   // completion text -> { n, url }
    const note = (url, n) => {
      let u;
      try { u = new URL(url); } catch { return; }
      if (!/^https?:$/.test(u.protocol)) return;
      const host = bare(u.host);
      let text = host;
      if (withPath) {
        const full = (host + u.pathname + u.search).replace(/\/$/, '');
        if (!full.startsWith(q)) return;
        text = full;
      } else if (!host.startsWith(q)) return;
      const cur = score.get(text) || { n: 0, url: withPath ? url : `${u.protocol}//${u.host}/`, https: false };
      cur.n += n;
      if (u.protocol === 'https:') cur.https = true;
      score.set(text, cur);
    };
    for (const h of sp.history || []) note(h.url, (h.visits || 1) + (h.last && Date.now() - h.last < 7 * 864e5 ? 3 : 0));
    for (const t of this.tabs.values()) if (t.spaceId === sp.id) note(t.url, 2);
    for (const p of pinnedTabNodes(sp.pinned || [])) note(p.url, 4);
    for (const f of sp.favorites || []) note(f.url, 4);
    if (!score.size) return null;
    // Most used first; between equals, the shorter one (the site itself before its pages).
    const [text, best] = [...score.entries()].sort((a, b) => b[1].n - a[1].n || a[0].length - b[0].length)[0];
    if (text === q) return null;
    const url = !withPath && best.https ? best.url.replace(/^http:/, 'https:') : best.url;
    return { text, url };
  }

  // The search engine's suggestions for what's typed (only when the switch is on).
  async searchSuggestions(text) {
    const q = String(text || '').trim();
    if (!this.suggestOn || this.isPrivate || !q || q.length > 200 || this.overlayMode === 'tabs') return [];
    // Addresses (and anything with a user:password@ in it) aren't sent: you're going there, not searching.
    if (toUrl(q) || /\S+:\S*@/.test(q)) return [];
    const tpl = SUGGEST[this.st.settings.searchEngine] || SUGGEST.Google;
    this._suggestAbort?.abort();
    const ctl = this._suggestAbort = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    try {
      const fetchIt = this._suggestFetch || (u => net.fetch(u, { signal: ctl.signal, headers: { Accept: 'application/json' } }));
      const r = await fetchIt(tpl.replace('%s', encodeURIComponent(q)));
      if (!r.ok) return [];
      const j = JSON.parse(await r.text());
      const list = Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [];
      return [...new Set(list.map(s => String(typeof s === 'object' && s ? s.phrase || '' : s).trim()))]
        .filter(s => s && s.length < 200 && s.toLowerCase() !== q.toLowerCase()).slice(0, 5)
        .map(s => ({ sec: '', type: 'search', text: s, title: s, icon: 'search', suggestion: true }));
    } catch { return []; } finally { clearTimeout(timer); }
  }
}

OmniboxPart.SUGGEST = SUGGEST;
module.exports = OmniboxPart;
