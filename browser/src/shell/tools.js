// Page tools: Zap (click things to hide them for good), dark mode for any site,
// copying text out of images (Windows' own text recognition), a QR code for the
// page, and mouse gestures.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { clipboard, nativeImage } = require('electron');
const { uid, hostOf } = require('./common');
const { siteOf } = require('../protection');

// Quasar's dark mode: invert the page's colours, then invert pictures and video back.
const DARK_CSS = `html { filter: invert(0.9) hue-rotate(180deg) !important; background: #fff !important; }
img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"], [role="img"] { filter: invert(1) hue-rotate(180deg) !important; }`;

class ToolsPart {
  // ------------------------------------------------------------------ Zap
  // Click anything on the page to hide it. Each click adds a CSS rule to this site's
  // "Zapped" Boost, so it stays hidden next time (undo: Library › Boosts).
  async startZap(tab = this.active) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return this.toast('Zap works on web pages.');
    if (tab.zapping) return;
    tab.zapping = true;
    wc.focus();
    let picked = [];
    try {
      picked = await wc.executeJavaScriptInIsolatedWorld(1009, [{ code: `new Promise(done => {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #e5484d;background:rgba(229,72,77,.15);border-radius:4px;transition:all .05s;display:none';
        const bar = document.createElement('div');
        bar.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:#1d1730;color:#fff;font:600 13px "Segoe UI",system-ui;padding:8px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center';
        const msg = document.createElement('span'); msg.textContent = 'Zap: click anything to hide it';
        const undo = document.createElement('button'); undo.textContent = 'Undo'; undo.disabled = true;
        const fin = document.createElement('button'); fin.textContent = 'Done (Esc)';
        for (const b of [undo, fin]) b.style.cssText = 'font:inherit;border:0;border-radius:7px;padding:4px 10px;background:#ffffff26;color:#fff;cursor:pointer';
        bar.append(msg, undo, fin);
        document.documentElement.append(box, bar);
        const hidden = [];
        let cur = null;
        // A selector that's specific enough for this element, but survives a reload.
        const esc = s => CSS.escape(s);
        const stable = c => c && !/\\d{3,}|^(css|sc|jsx|_)-?[a-z0-9]{4,}$|[A-Z][a-z]+[A-Z]|active|hover|focus|open|show|visible/i.test(c);
        function sel(el) {
          const parts = [];
          for (let e = el; e && e !== document.documentElement && parts.length < 5; e = e.parentElement) {
            if (e.id && !/\\d{3,}/.test(e.id)) { parts.unshift('#' + esc(e.id)); break; }
            let p = e.tagName.toLowerCase();
            const cls = [...e.classList].filter(stable).slice(0, 2);
            if (cls.length) p += cls.map(c => '.' + esc(c)).join('');
            const sib = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : [];
            if (!cls.length && sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
            parts.unshift(p);
            const s = parts.join(' > ');
            try { if (document.querySelectorAll(s).length === 1) return s; } catch {}
          }
          return parts.join(' > ');
        }
        const over = e => {
          if (bar.contains(e.target)) { box.style.display = 'none'; cur = null; return; }
          cur = e.target;
          const r = cur.getBoundingClientRect();
          Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        };
        const click = e => {
          if (bar.contains(e.target)) return;
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          if (!cur || cur === document.body || cur === document.documentElement) return;
          const s = sel(cur);
          hidden.push({ el: cur, s, old: cur.style.getPropertyValue('display'), prio: cur.style.getPropertyPriority('display') });
          cur.style.setProperty('display', 'none', 'important');
          box.style.display = 'none';
          undo.disabled = false;
          msg.textContent = 'Zap: ' + hidden.length + ' hidden — click more, or Done';
        };
        const block = e => { if (!bar.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } };
        const finish = () => {
          removeEventListener('mouseover', over, true); removeEventListener('click', click, true);
          for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) removeEventListener(t, block, true);
          removeEventListener('keydown', key, true);
          box.remove(); bar.remove();
          done(hidden.map(h => h.s));
        };
        const key = e => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); finish(); } else if ((e.ctrlKey && e.key === 'z') || e.key === 'Backspace') { e.preventDefault(); undo.click(); } };
        undo.onclick = () => { const h = hidden.pop(); if (h) h.el.style.setProperty('display', h.old, h.prio); undo.disabled = !hidden.length; msg.textContent = hidden.length ? 'Zap: ' + hidden.length + ' hidden' : 'Zap: click anything to hide it'; };
        fin.onclick = finish;
        addEventListener('mouseover', over, true); addEventListener('click', click, true);
        for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) addEventListener(t, block, true);
        addEventListener('keydown', key, true);
        window.__archZapFinish = finish;
      })` }], true);
    } catch { picked = []; } finally { tab.zapping = false; }
    if (!Array.isArray(picked) || !picked.length) return;
    const site = hostOf(wc.getURL());
    let b = this.st.boosts.find(x => x.zap && x.pattern === site);
    if (!b) { b = { id: uid(), name: `Zapped on ${site}`, pattern: site, css: '', js: '', enabled: true, spaceId: null, zap: true }; this.st.boosts.unshift(b); }
    b.css = (b.css ? b.css.replace(/\s*$/, '\n') : '') + picked.map(s => `${s} { display: none !important; }`).join('\n');
    this.persist();
    this.reapplyBoosts();
    this.libUpdate();
    this.toast(`Hidden on ${site} from now on (${picked.length}). Undo in Library › Boosts.`, null, [{ label: 'Undo all', act: ['zap:undo', b.id] }, { label: 'OK', act: ['noop'] }]);
  }

  undoZap(boostId) {
    this.st.boosts = this.st.boosts.filter(b => b.id !== boostId);
    this.persist(); this.reapplyBoosts(); this.libUpdate();
  }

  // ------------------------------------------------- dark mode for any site
  // Settings › "Make every site dark" turns it on everywhere; then the per-site switch
  // turns a site back to normal (it's remembered in darkExcept).
  darkFor(url) {
    const s = siteOf(hostOf(url));
    if (!s || !/^https?:/i.test(url || '')) return false;
    if (this.st.settings.darkAll) return !(this.st.darkExcept || []).includes(s);
    return (this.st.darkSites || []).includes(s);
  }

  reapplyDark() {
    for (const t of this.tabs.values()) { const w = t.view?.webContents; if (w && !w.isDestroyed()) this.applySiteDark(w); }
    this.push();
  }

  async applySiteDark(wc) {
    if (!wc || wc.isDestroyed()) return;
    if (wc.__darkKey) { try { await wc.removeInsertedCSS(wc.__darkKey); } catch { /* ignore */ } wc.__darkKey = null; }
    if (!this.darkFor(wc.getURL())) return;
    // A page that's already dark is left alone (inverting it would make it light).
    let dark = false;
    try {
      dark = await wc.executeJavaScriptInIsolatedWorld(1010, [{ code: `(() => {
        const bg = el => { const c = getComputedStyle(el).backgroundColor.match(/\\d+(\\.\\d+)?/g); if (!c || (c[3] !== undefined && +c[3] < 0.1)) return null; return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; };
        const v = bg(document.body || document.documentElement) ?? bg(document.documentElement);
        return v !== null && v < 0.35;
      })()` }]);
    } catch { /* ignore */ }
    if (dark || wc.isDestroyed()) return;
    try { wc.__darkKey = await wc.insertCSS(DARK_CSS, { cssOrigin: 'user' }); } catch { /* ignore */ }
  }

  toggleSiteDark(tab = this.active) {
    const wc = tab?.view?.webContents;
    const s = siteOf(hostOf(tab?.url || ''));
    if (!wc || !s) return this.toast('Dark mode works on web pages.');
    const on = !this.darkFor(tab.url);
    if (this.st.settings.darkAll) {
      const ex = this.st.darkExcept ||= [];
      this.st.darkExcept = on ? ex.filter(x => x !== s) : [...new Set([...ex, s])];
    } else {
      const list = this.st.darkSites ||= [];
      this.st.darkSites = on ? [...new Set([...list, s])] : list.filter(x => x !== s);
    }
    this.persist();
    for (const t of this.tabs.values()) { const w = t.view?.webContents; if (w && !w.isDestroyed() && siteOf(hostOf(w.getURL())) === s) this.applySiteDark(w); }
    this.toast(on ? `${s} is dark now (Quasar remembers it).` : `${s} is back to normal.`);
    this.push();
  }

  // -------------------------------------------------- copy text from an image
  // Windows' built-in text recognition (Windows.Media.Ocr), on this PC.
  async copyTextFromImage(wc, p) {
    const W = this.cur;
    this.toast('Reading the text in the picture…');
    let img = null;
    try {
      const res = await wc.session.fetch(p.srcURL);
      if (res.ok) img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    } catch { /* fall back to the clipboard */ }
    if (!img || img.isEmpty()) {
      // Formats nativeImage can't read (WebP, SVG…): let the page copy the picture.
      try { wc.copyImageAt(p.x, p.y); await new Promise(r => setTimeout(r, 400)); img = await clipboard.readImage(); } catch { img = null; }
    }
    if (!img || img.isEmpty()) return this.withWin(W, () => this.toast('Couldn’t read that picture.'));
    // Small pictures read better a bit bigger.
    const { width, height } = img.getSize();
    if (width < 800 && height < 800) img = img.resize({ width: width * 2, quality: 'best' });
    let text = '';
    try { text = await this.ocr(img.toPNG()); } catch (err) { return this.withWin(W, () => this.toast(`Couldn’t read the text: ${err.message}`)); }
    if (!text.trim()) return this.withWin(W, () => this.toast('No text found in that picture.'));
    clipboard.writeText(text);
    const lines = text.split('\n').filter(Boolean).length;
    this.withWin(W, () => this.toast(`Copied the text from the picture (${lines} line${lines === 1 ? '' : 's'}).`));
    return text;
  }

  ocr(png) {
    const file = path.join(os.tmpdir(), `arch-ocr-${uid()}.png`);
    fs.writeFileSync(file, png);
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
      "$g = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
      'function Await($op, $t) { $task = $g.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }',
      '[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null',
      '[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null',
      '[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType=WindowsRuntime] | Out-Null',
      `$f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${file.replace(/'/g, "''")}')) ([Windows.Storage.StorageFile])`,
      '$s = Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
      '$d = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])',
      '$b = Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
      '$e = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
      "if (-not $e) { Write-Error 'Windows has no text recognition language installed'; exit 1 }",
      '$r = Await ($e.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult])',
      '$s.Dispose()',
      '$r.Lines | ForEach-Object { $_.Text }',
    ].join('; ');
    return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 60000, encoding: 'utf8', maxBuffer: 4e6 }, (err, out, errOut) => {
        try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
        if (err) return reject(new Error(String(errOut || err.message).split('\n')[0].trim() || 'text recognition failed'));
        resolve(String(out).replace(/\r/g, '').trim());
      }));
  }

  // ---------------------------------------------------------- QR code
  qrFor(url) {
    const qrcode = require('qrcode-generator');
    const q = qrcode(0, 'M');
    q.addData(String(url).slice(0, 2000), 'Byte');
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  }

  showQr(tab = this.active) {
    if (!tab?.url || !/^(https?|ftp):/i.test(tab.url)) return this.toast('A QR code needs a web address.');
    this.openCommand('qr', '', { qr: { svg: this.qrFor(tab.url), url: tab.url, title: tab.title || hostOf(tab.url) } });
  }

  // ------------------------------------------------------- mouse gestures
  // Hold the right button and draw: ← back, → forward, ↓ new tab, ↓→ close tab,
  // ↑↓ reload, ↑ to the top, ↓↑ … (a plain right-click still opens the menu).
  // (Also two-finger touchpad swipes on a page, sent as L/R with swipe: true.)
  onGesture(wc, g, { swipe = false } = {}) {
    if (this.st.settings.gestures === false && !swipe) return;
    const tab = this.pageTabs.get(wc.id);
    if (!tab || !this.tabs.has(tab.id)) return;
    this.withWin(this.hostOf(tab.id) || this.cur, () => {
      const nav = wc.navigationHistory;
      switch (g) {
        case 'L': return nav.canGoBack() && nav.goBack();
        case 'R': return nav.canGoForward() && nav.goForward();
        case 'D': return this.openCommand('new');
        case 'DR': return this.closeTab(tab.id);
        case 'UD': return this.reloadPage(wc);
        case 'U': return wc.executeJavaScript('scrollTo({ top: 0, behavior: "smooth" })').catch(() => {});
        case 'DU': return wc.executeJavaScript('scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })').catch(() => {});
        case 'LR': return this.reopenClosed();
      }
    });
  }
}

module.exports = ToolsPart;
