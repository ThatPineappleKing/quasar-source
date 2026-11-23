// Boosts (custom CSS/JS per site) and Air Traffic Control.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const { webContents: allWebContents } = require('electron');

class RulesPart {
  // ------------------------------------------------- Boosts / Air Traffic
  // Site rules: "github.com" (and its subdomains), "*.example.com", "example.com/docs" (path prefix), "*" (every site).
  ruleMatches(pattern, url) {
    let host, rest;
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return false; host = u.hostname.replace(/^www\./, '').toLowerCase(); rest = (host + u.pathname + u.search).toLowerCase(); } catch { return false; }
    const p = String(pattern || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (!p) return false;
    if (p === '*') return true;
    if (p.includes('/')) return rest.startsWith(p.replace(/^\*\./, ''));
    const d = p.replace(/^\*\./, '');
    return host === d || host.endsWith('.' + d);
  }

  atcTarget(url) {
    const r = this.st.atc.find(x => x.enabled !== false && this.ruleMatches(x.pattern, url));
    return r ? this.st.spaces.find(s => s.id === r.spaceId) || null : null;
  }

  boostsFor(url, spaceId) {
    return this.st.boosts.filter(b => b.enabled !== false && (!b.spaceId || b.spaceId === spaceId) && this.ruleMatches(b.pattern, url));
  }

  // Boost CSS is inserted on every page load (and re-applied live when you edit it);
  // Boost JavaScript runs once per page load, in its own isolated world.
  async applyBoosts(wc, { cssOnly = false } = {}) {
    if (!wc || wc.isDestroyed()) return;
    const url = wc.getURL();
    const tab = this.pageTabs.get(wc.id);
    const spaceId = tab?.spaceId || null;
    for (const key of wc.__boostKeys || []) { try { await wc.removeInsertedCSS(key); } catch { /* ignore */ } }
    wc.__boostKeys = [];
    if (this.isCertPage(url)) return;
    for (const b of this.boostsFor(url, spaceId)) {
      if (b.css?.trim()) { try { wc.__boostKeys.push(await wc.insertCSS(b.css, { cssOrigin: 'user' })); } catch { /* ignore */ } }
      if (!cssOnly && b.js?.trim()) wc.executeJavaScriptInIsolatedWorld(1004, [{ code: b.js }]).catch(() => {});
    }
  }

  reapplyBoosts() {
    for (const id of this.pageTabs.keys()) {
      const wc = allWebContents.fromId(id);
      if (wc && !wc.isDestroyed()) this.applyBoosts(wc, { cssOnly: true });
    }
  }
}

module.exports = RulesPart;
