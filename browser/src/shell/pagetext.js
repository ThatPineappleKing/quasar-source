// A page's readable text (for reading aloud), and finding pages by what was on them.
// History search by page text (Settings, off by default) runs entirely on this PC:
// each page you visit keeps up to 4,000 characters of its text in
// %APPDATA%\Quasar\history-text (one file per profile), and the command bar can find
// pages by what they said. Nothing leaves the PC. Turning it off deletes the files.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const MAX_PAGE = 60000;   // characters of a page's text

class PageTextPart {
  get historySearchOn() { return !!this.st.settings.historySearch; }

  setHistorySearch(on) {
    this.st.settings.historySearch = !!on;
    if (!on) this.dropHistoryText();
  }

  // The article if there is one, else the whole page.
  async pageText(wc) {
    if (!wc || wc.isDestroyed()) return '';
    try {
      const { full } = this.readabilitySrc();
      const t = await wc.executeJavaScriptInIsolatedWorld(1011, [{ code: `(() => {
        let text = '';
        try { const R = ${full}; const Readability = R.Readability || R; const a = new Readability(document.cloneNode(true)).parse(); if (a && a.textContent && a.textContent.length > 400) text = a.textContent; } catch {}
        if (!text) text = document.body ? document.body.innerText : '';
        return text.replace(/\\n{3,}/g, '\\n\\n').trim();
      })()` }]);
      return String(t || '').slice(0, MAX_PAGE);
    } catch { return ''; }
  }

  historyTextFile(partition) { return path.join(app.getPath('userData'), 'history-text', `${String(partition).replace(/[^\w-]/g, '_')}.json`); }

  historyText(partition) {
    this._htext ||= new Map();
    if (!this._htext.has(partition)) {
      let m = {};
      try { m = JSON.parse(fs.readFileSync(this.historyTextFile(partition), 'utf8')); } catch { /* none yet */ }
      this._htext.set(partition, m);
    }
    return this._htext.get(partition);
  }

  async indexPageText(tab) {
    if (!this.historySearchOn || !tab?.profile || this.privateSpaces.has(tab.spaceId)) return;
    const wc = tab.view?.webContents;
    if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return;
    let text = '';
    try { text = await wc.executeJavaScriptInIsolatedWorld(1012, [{ code: '(document.body ? document.body.innerText : "").replace(/\\s+/g, " ").slice(0, 4000)' }]); } catch { return; }
    if (!text || text.length < 40) return;
    const m = this.historyText(tab.profile);
    m[wc.getURL()] = { t: text, title: tab.title || '', at: Date.now() };
    const keys = Object.keys(m);
    if (keys.length > 3000) for (const k of keys.sort((a, b) => m[a].at - m[b].at).slice(0, keys.length - 3000)) delete m[k];
    (this._htextDirty ||= new Set()).add(tab.profile);
    clearTimeout(this._htextT);
    this._htextT = setTimeout(() => this.saveHistoryText(), 3000);
  }

  // Only the profiles that changed are written, off the main thread's critical path
  // (the files can be several MB), via a temp file so a half-written file never replaces a good one.
  async saveHistoryText(...changed) {
    for (const p of changed) (this._htextDirty ||= new Set()).add(p);
    if (this._htextSaving) { clearTimeout(this._htextT); this._htextT = setTimeout(() => this.saveHistoryText(), 1000); return; }
    const dirty = this._htextDirty;
    if (!dirty?.size) return;
    this._htextDirty = new Set();
    this._htextSaving = true;
    try {
      for (const part of dirty) {
        const m = this._htext?.get(part);
        if (!m) continue;
        try {
          const f = this.historyTextFile(part);
          await fs.promises.mkdir(path.dirname(f), { recursive: true });
          await fs.promises.writeFile(f + '.tmp', JSON.stringify(m));
          // Turned off (files deleted) while this was writing: don't bring it back.
          if (this._htext?.get(part) === m && this.historySearchOn) await fs.promises.rename(f + '.tmp', f);
          else await fs.promises.rm(f + '.tmp', { force: true });
        } catch { /* ignore */ }
      }
    } finally { this._htextSaving = false; }
  }

  dropHistoryText(partition = null) {
    const dir = path.join(app.getPath('userData'), 'history-text');
    if (partition) { this._htext?.delete(partition); try { fs.rmSync(this.historyTextFile(partition), { force: true }); } catch { /* ignore */ } return; }
    this._htext = new Map();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // Command bar: pages whose text contains every word typed.
  searchHistoryText(q, partition, limit = 5) {
    if (!this.historySearchOn) return [];
    const words = String(q).toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (!words.length) return [];
    const m = this.historyText(partition);
    const out = [];
    // The lower-case text of each page, worked out once (not on every keystroke).
    const lows = this._htextLow ||= new WeakMap();
    for (const [url, e] of Object.entries(m)) {
      let low = lows.get(e);
      if (low === undefined || low.src !== e.t) { low = { src: e.t, low: e.t.toLowerCase() }; lows.set(e, low); }
      low = low.low;
      if (!words.every(w => low.includes(w))) continue;
      const i = low.indexOf(words[0]);
      const snip = e.t.slice(Math.max(0, i - 40), i + 80).trim();
      out.push({ url, title: e.title || url, snip, score: words.reduce((n, w) => n + low.split(w).length - 1, 0), at: e.at });
    }
    return out.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit);
  }
}

module.exports = PageTextPart;
