// Site icons for pinned tabs and Favorites that aren't loaded. A loaded page tells
// Quasar its icon, but anything not opened since a restart (or imported from Arc) had
// none, and the sidebar fell back to a letter. Here Quasar fetches the icon from the
// site itself (the icon its page names, else /favicon.ico) through the Space's own
// profile, and keeps it inside Quasar as a small data: image, so it shows instantly,
// offline, and after restarts. Sites with no icon keep the first letter of their name.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { session } = require('electron');
const { pinnedTabNodes } = require('./common');
const { siteOf } = require('../protection');

const MAX_ICON = 150 * 1024;
const RETRY_AFTER = 3 * 864e5;   // a site with no icon is asked again after 3 days

class IconsPart {
  // Pinned tabs and Favorites (every Profile) whose icon is missing or only a web address.
  iconTargets() {
    const out = [];
    for (const p of this.st.profiles || []) {
      for (const n of pinnedTabNodes(p.pinned || [])) out.push({ n, partition: p.partition });
      for (const f of p.favorites || []) out.push({ n: f, partition: p.partition });
    }
    return out.filter(({ n }) => /^https?:/i.test(n.url || '') && !/^data:image\//.test(n.favicon || '')
      && !(n.iconTried && Date.now() - n.iconTried < RETRY_AFTER));
  }

  // Soon after start-up, and shortly after something is pinned or made a Favorite.
  scheduleIconFill(ms = 3000) {
    clearTimeout(this._iconT);
    this._iconT = setTimeout(() => this.fillIcons().catch(() => {}), ms);
  }

  async fillIcons() {
    if (this._iconBusy) return this._iconBusy;
    this._iconBusy = (async () => {
      const todo = this.iconTargets().slice(0, 60);
      let changed = 0;
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async ({ n, partition }) => {
          const icon = await this.fetchIcon(n.url, partition, n.favicon).catch(() => null);
          n.iconTried = Date.now();
          if (icon && icon !== n.favicon) { n.favicon = icon; changed++; }
        }));
      }
      if (changed || todo.length) { this.persist(); this.push(); }
      if (todo.length && this.iconTargets().length) this.scheduleIconFill(2000);   // more to do (a big import)
      return changed;
    })().finally(() => { this._iconBusy = null; });
    return this._iconBusy;
  }

  // The site's icon as a data: image, or null.
  async fetchIcon(pageUrl, partition, known = '') {
    const ses = session.fromPartition('persist:' + partition);
    const get = this._iconFetch || ((u, o) => ses.fetch(u, o));
    const asImage = async u => {
      try {
        if (/^data:image\//i.test(u)) return u.length < MAX_ICON * 1.4 ? u : null;
        const r = await get(u, { headers: { Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8' } });
        if (!r.ok) return null;
        let type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length || buf.length > MAX_ICON) return null;
        // Some servers say text/plain or octet-stream for icons: tell by the bytes.
        if (!type.startsWith('image/')) {
          if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) type = 'image/x-icon';
          else if (buf.slice(0, 4).toString('hex') === '89504e47') type = 'image/png';
          else if (buf[0] === 0xff && buf[1] === 0xd8) type = 'image/jpeg';
          else if (buf.slice(0, 4).toString() === 'GIF8') type = 'image/gif';
          else if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buf.slice(0, 300).toString())) type = 'image/svg+xml';
          else return null;
        }
        return `data:${type};base64,${buf.toString('base64')}`;
      } catch { return null; }
    };
    // A web address saved from the open page: keep that same picture.
    if (/^https?:/i.test(known)) { const d = await asImage(known); if (d) return d; }
    let base;
    try { base = new URL(pageUrl); } catch { return null; }
    // The icon the page itself names (if the page is on the same site; a sign-in
    // redirect to another site would give that site's icon).
    try {
      const r = await get(pageUrl, { headers: { Accept: 'text/html' } });
      const final = new URL(r.url || pageUrl);
      if (r.ok && siteOf(final.hostname) === siteOf(base.hostname)) {
        const html = (await r.text()).slice(0, 300000);
        const links = [];
        for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
          const tag = m[0];
          const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1] || '').toLowerCase();
          const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || /\bhref\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
          if (!href || !/(^|\s)(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(rel)) continue;
          const size = Number(/\bsizes\s*=\s*["']?(\d+)x\d+/i.exec(tag)?.[1]) || (rel.includes('apple') ? 180 : 0);
          const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1] || '').toLowerCase();
          let abs;
          try { abs = new URL(href.replace(/&amp;/g, '&'), final).href; } catch { continue; }
          // Best: 32–64px, then SVG, then bigger, then whatever else (16px icons look blurry).
          const rank = size >= 32 && size <= 64 ? 0 : type.includes('svg') || /\.svg(\?|$)/i.test(abs) ? 1 : size > 64 ? 2 : 3;
          links.push({ abs, rank, size });
        }
        links.sort((a, b) => a.rank - b.rank || Math.abs(a.size - 48) - Math.abs(b.size - 48));
        for (const l of links.slice(0, 4)) { const d = await asImage(l.abs); if (d) return d; }
      }
    } catch { /* the page didn't load */ }
    return asImage(`${base.origin}/favicon.ico`);
  }
}

module.exports = IconsPart;
