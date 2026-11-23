// Live Folders (pinned folders that fill themselves from an RSS/Atom feed or a
// GitHub repository's pull requests or issues), notes for each Space, and a
// Read Later list.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { net, clipboard } = require('electron');
const { uid, hostOf, findPinned, walkPinned } = require('./common');

const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&').trim();

// RSS 2.0 / RSS 1.0 / Atom -> { title, items: [{ title, url, date }] }
function parseFeed(xml) {
  const tag = (s, t) => (s.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')) || [])[1] || '';
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const body = m[2];
    let url = decode(tag(body, 'link'));
    if (!/^https?:/i.test(url)) {
      const links = [...body.matchAll(/<link\b([^>]*)\/?>/gi)].map(l => l[1]);
      const pick = links.find(a => /rel=["']alternate["']/i.test(a)) || links.find(a => !/rel=/i.test(a)) || links[0] || '';
      url = (pick.match(/href=["']([^"']+)["']/i) || [])[1] || decode(tag(body, 'guid'));
    }
    url = decode(url);
    if (!/^https?:/i.test(url)) continue;
    items.push({ title: decode(tag(body, 'title')) || url, url, date: Date.parse(decode(tag(body, 'pubDate') || tag(body, 'updated') || tag(body, 'published') || tag(body, 'dc:date'))) || 0 });
  }
  const head = xml.replace(/<(item|entry)[\s\S]*$/i, '');
  return { title: decode(tag(head, 'title')), items };
}

class CollectionsPart {
  // ------------------------------------------------------------ Live Folders
  // source: a feed address, a site (its feed is found), or a GitHub repository
  // ("github.com/owner/repo", "…/pulls" or "…/issues").
  async createLiveFolder(source, spaceId = this.curSpaceId) {
    const sp = this.spaceById(spaceId);
    if (!sp || sp.private) return null;
    let s = String(source || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    const gh = s.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(pulls|issues))?/i);
    const live = gh ? { kind: 'github', repo: `${gh[1]}/${gh[2].replace(/\.git$/, '')}`, what: (gh[3] || 'pulls').toLowerCase() } : { kind: 'feed', url: s };
    const folder = { id: uid(), type: 'folder', title: gh ? `${live.repo} · ${live.what === 'issues' ? 'Issues' : 'Pull requests'}` : hostOf(s), open: true, children: [], live };
    try { await this.refreshLiveFolder(folder, { first: true }); } catch (err) { this.toast(`Couldn’t set up the Live Folder: ${err.message}`); return null; }
    sp.pinned.unshift(folder);
    this.changed();
    this.toast(`Live Folder “${folder.title}” added. It updates itself every 30 minutes.`);
    return folder.id;
  }

  async liveItems(live) {
    const get = async (url, accept) => {
      const res = await net.fetch(url, { headers: { accept, 'user-agent': 'Quasar browser (Live Folders)' } });
      if (!res.ok) throw new Error(res.status === 404 ? 'not found' : res.status === 403 ? 'GitHub’s limit for anonymous requests was reached; try again later' : `the site answered ${res.status}`);
      return res;
    };
    if (live.kind === 'github') {
      const path = live.what === 'issues' ? 'issues?state=open&per_page=30' : 'pulls?state=open&per_page=30';
      const list = await (await get(`https://api.github.com/repos/${live.repo}/${path}`, 'application/vnd.github+json')).json();
      return { items: list.filter(x => live.what !== 'issues' || !x.pull_request).slice(0, 25).map(x => ({ title: `#${x.number} ${x.title}`, url: x.html_url, date: Date.parse(x.updated_at) || 0 })) };
    }
    let res = await get(live.url, 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5');
    let text = await res.text();
    if (/<html[\s>]/i.test(text.slice(0, 2000)) && !/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000))) {
      // A web page: use the feed it links to.
      const link = [...text.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).find(l => /rel=["']?alternate/i.test(l) && /(rss|atom)\+xml/i.test(l));
      const href = link && (link.match(/href=["']([^"']+)["']/i) || [])[1];
      if (!href) throw new Error('that page has no RSS or Atom feed');
      live.url = new URL(decode(href), live.url).href;
      res = await get(live.url, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
      text = await res.text();
    }
    const feed = parseFeed(text);
    if (!feed.items.length) throw new Error('no entries found in that feed');
    return { title: feed.title, items: feed.items.slice(0, 25) };
  }

  async refreshLiveFolder(folder, { first = false } = {}) {
    const live = folder.live;
    try {
      const { title, items } = await this.liveItems(live);
      if (first && title) folder.title = title.slice(0, 60);
      const old = new Map((folder.children || []).map(c => [c.url, c]));
      const keep = [];
      for (const it of items) {
        const was = old.get(it.url);
        keep.push(was ? { ...was, title: it.title } : { id: uid(), url: it.url, title: it.title.slice(0, 200), favicon: '', liveItem: true, fresh: !first });
        old.delete(it.url);
      }
      // Items that dropped out of the feed stay while their tab is open.
      for (const c of old.values()) if (this.liveTab('pinned', c.id)) keep.push(c);
      folder.children = keep;
      live.updated = Date.now();
      live.error = null;
    } catch (err) {
      live.error = err.message;
      if (first) throw err;
    }
    this.changed();
  }

  refreshAllLiveFolders() {
    for (const sp of this.st.spaces) walkPinned(sp.pinned, n => { if (n.live && Date.now() - (n.live.updated || 0) > 25 * 60e3) this.refreshLiveFolder(n); });
  }

  markLiveRead(folderId) {
    for (const sp of this.allSpaces) { const f = findPinned(sp.pinned, folderId); if (f?.node.live) for (const c of f.node.children) c.fresh = false; }
    this.changed();
  }

  // --------------------------------------------------------- Space notes
  // A scratchpad per Space: notes you type, and text added from pages (with the
  // page's address, so you can go back to it).
  notesOf(spaceId = this.curSpaceId) { const sp = this.spaceById(spaceId); return sp ? (sp.notes ||= []) : []; }

  addNote({ text = '', url = '', title = '', spaceId = this.curSpaceId } = {}) {
    const sp = this.spaceById(spaceId);
    if (!sp || sp.private || !String(text).trim()) return null;
    const n = { id: uid(), text: String(text).slice(0, 20000), url: /^(https?|file):/i.test(url) ? url : '', title: String(title || '').slice(0, 200), at: Date.now() };
    this.notesOf(spaceId).unshift(n);
    this.changed();
    if (url) this.toast(`Added to ${`${sp.emoji || ''} ${sp.name}`.trim()}’s notes.`, null, [{ label: 'Show notes', act: ['ui:view', 'notes'] }]);
    return n.id;
  }

  notesAct(op, a = {}) {
    const list = this.notesOf();
    if (op === 'add') return this.addNote({ text: a.text });
    const n = list.find(x => x.id === a.id);
    if (!n) return null;
    if (op === 'update') { n.text = String(a.text || '').slice(0, 20000); n.at = Date.now(); if (!n.text.trim()) list.splice(list.indexOf(n), 1); }
    if (op === 'delete') list.splice(list.indexOf(n), 1);
    if (op === 'open' && n.url) this.newTab(n.url);
    if (op === 'copy') clipboard.writeText(n.text + (n.url ? `\n${n.url}` : ''));
    this.changed();
    return true;
  }

  // ---------------------------------------------------------- Read Later
  saveReadLater(tab = this.active, { close = false } = {}) {
    const sp = tab && this.spaceById(tab.spaceId);
    if (!tab?.url || !sp || sp.private || !/^(https?|file):/i.test(tab.url)) return this.toast('Only web pages can be saved for later.');
    const list = sp.readLater ||= [];
    if (!list.some(x => x.url === tab.url && !x.read)) list.unshift({ id: uid(), url: tab.url, title: tab.title || hostOf(tab.url), favicon: tab.favicon || '', at: Date.now(), read: false });
    sp.readLater = list.slice(0, 500);
    this.changed();
    this.toast('Saved to Read Later.', null, [{ label: 'Show list', act: ['ui:view', 'later'] }]);
    if (close && tab.kind === 'today') this.closeTab(tab.id);
  }

  readLaterAct(op, id) {
    const list = this.space.readLater ||= [];
    const r = list.find(x => x.id === id);
    if (op === 'clearRead') { this.space.readLater = list.filter(x => !x.read); return this.changed(); }
    if (!r) return;
    if (op === 'open') { r.read = true; r.readAt = Date.now(); this.newTab(r.url); }
    if (op === 'toggle') r.read = !r.read;
    if (op === 'delete') list.splice(list.indexOf(r), 1);
    this.changed();
  }

  // The Live Folder parts of the pinned folder menu.
  liveFolderMenu(n) {
    if (!n.live) return [];
    const where = n.live.kind === 'github' ? `github.com/${n.live.repo}` : n.live.url;
    return [
      { label: `Live Folder: ${where}`.slice(0, 80), enabled: false },
      ...(n.live.error ? [{ label: `Last update failed: ${n.live.error}`.slice(0, 90), enabled: false }] : []),
      { label: 'Refresh Now', click: () => this.refreshLiveFolder(n) },
      { label: 'Mark All as Read', click: () => this.markLiveRead(n.id) },
      { label: 'Copy Feed Address', click: () => clipboard.writeText(n.live.kind === 'github' ? `https://github.com/${n.live.repo}/${n.live.what}` : n.live.url) },
      { type: 'separator' },
    ];
  }
}

module.exports = CollectionsPart;
module.exports.parseFeed = parseFeed;
