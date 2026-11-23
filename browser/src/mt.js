// On-device translation with Bergamot, the engine behind Firefox Translations.
//
// Translation runs on this PC: neither the page nor its address goes anywhere,
// so it also works on pages you're signed in to. What's downloaded (once per
// language pair, ~20–40 MB, from Mozilla's public model store) are the models,
// checked against their SHA-256 before use and kept in %APPDATA%\Quasar\translation-models.
//
// The engine itself (WebAssembly in a Web Worker) runs in a hidden, sandboxed
// window loaded from Quasar's own arch-mt:// scheme, which serves the
// @browsermt/bergamot-translator package files and the cached models.
//
// Languages: Bulgarian, Czech, Dutch, English, Estonian, Farsi, French, German,
// Icelandic, Italian, Norwegian (Bokmål/Nynorsk), Polish, Portuguese, Russian,
// Spanish, Ukrainian — between any two of them via English, where models exist.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, net, session, BrowserWindow } = require('electron');

const BASE = 'https://storage.googleapis.com/bergamot-models-sandbox/0.3.3/';
const PKG = path.join(__dirname, '..', 'node_modules', '@browsermt', 'bergamot-translator');
const UI = path.join(__dirname, '..', 'ui');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };

class OnDeviceTranslator {
  constructor() {
    this.dir = path.join(app.getPath('userData'), 'translation-models');
    this.registry = null;
    this.win = null;
    this.ready = null;
    this.downloads = new Map();   // url -> promise
    this.progress = null;         // { pair, received, total } while a model downloads
    this.onProgress = null;
  }

  // ---- what can be translated
  async loadRegistry() {
    if (this.registry) return this.registry;
    const file = path.join(this.dir, 'registry.json');
    let reg = null;
    const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86400e3;
    if (!fresh) {
      try {
        const res = await net.fetch(BASE + 'registry.json');
        if (res.ok) { reg = await res.json(); fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(reg)); }
      } catch { /* offline: use the saved copy */ }
    }
    if (!reg) { try { reg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none */ } }
    if (!reg) throw new Error('The list of translation languages couldn’t be downloaded. Check your connection.');
    this.registry = reg;
    return reg;
  }

  // The models needed for from -> to (direct, or through English).
  async route(from, to) {
    const reg = await this.loadRegistry();
    if (from === to) return [];
    if (reg[from + to]) return [from + to];
    if (reg[from + 'en'] && reg['en' + to]) return [from + 'en', 'en' + to];
    return null;
  }

  async languages() {
    const reg = await this.loadRegistry();
    const src = new Set(), dst = new Set();
    for (const k of Object.keys(reg)) { src.add(k.slice(0, 2)); dst.add(k.slice(2, 4)); }
    return { from: [...src], to: [...dst] };
  }

  // Bytes still to download for this pair (0 when everything is here).
  async needed(from, to) {
    const reg = await this.loadRegistry();
    const r = await this.route(from, to);
    if (!r) return null;
    let n = 0;
    for (const pair of r) for (const f of Object.values(reg[pair])) if (f?.name && !this.haveFile(pair, f)) n += f.size || 0;
    return n;
  }

  haveFile(pair, f) {
    const p = path.join(this.dir, pair, f.name);
    try { return fs.statSync(p).size === f.size || (!f.size && fs.statSync(p).size > 0); } catch { return false; }
  }

  // Download one model file (once), check its SHA-256, keep it.
  async modelFile(pair, name) {
    const reg = await this.loadRegistry();
    const f = Object.values(reg[pair] || {}).find(x => x?.name === name);
    if (!f || !/^[a-z]{4}$/.test(pair) || /[\\/]/.test(name)) throw new Error('not a model file');
    const dest = path.join(this.dir, pair, name);
    if (this.haveFile(pair, f)) return fs.promises.readFile(dest);
    const url = BASE + pair + '/' + name;
    if (!this.downloads.has(url)) {
      this.downloads.set(url, (async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const chunks = [];
        let got = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          got += value.length;
          this.progress = { pair, name, received: got, total: f.size || 0 };
          this.onProgress?.(this.progress);
        }
        const buf = Buffer.concat(chunks);
        if (f.expectedSha256Hash && crypto.createHash('sha256').update(buf).digest('hex') !== f.expectedSha256Hash) throw new Error(`${name} didn’t match its checksum`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest + '.tmp', buf);
        fs.renameSync(dest + '.tmp', dest);
        this.progress = null;
        this.onProgress?.(null);
        return buf;
      })().finally(() => this.downloads.delete(url)));
    }
    return this.downloads.get(url);
  }

  // ---- the arch-mt:// scheme (only in the translator's own session)
  async serve(req) {
    const u = new URL(req.url);
    try {
      if (u.host === 'app') {
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
        let file = null;
        if (rel === 'mt.html' || rel === 'mt-engine.js') file = path.join(UI, rel);
        else if (rel.startsWith('bergamot/')) file = path.join(PKG, rel.slice(9));
        if (!file || !path.resolve(file).startsWith(path.resolve(rel.startsWith('bergamot/') ? PKG : UI))) return new Response('not found', { status: 404 });
        return new Response(await fs.promises.readFile(file), { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } });
      }
      if (u.host === 'models') {
        const [pair, name] = decodeURIComponent(u.pathname).replace(/^\/+/, '').split('/');
        if (pair === 'registry.json') return new Response(JSON.stringify(await this.loadRegistry()), { headers: { 'content-type': 'application/json' } });
        return new Response(await this.modelFile(pair, name), { headers: { 'content-type': 'application/octet-stream' } });
      }
    } catch (err) { return new Response(String(err.message), { status: 500 }); }
    return new Response('not found', { status: 404 });
  }

  // The hidden window that runs the engine. Started on first use, closed after 5 idle minutes.
  engine() {
    if (this.ready && this.win && !this.win.isDestroyed()) { this.touch(); return this.ready; }
    const ses = session.fromPartition('arch-mt');   // in memory, only for this
    if (!ses.__archMt) {
      ses.__archMt = true;
      ses.protocol.handle('arch-mt', req => this.serve(req));
      ses.setPermissionRequestHandler((wc, p, cb) => cb(false));
      ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(arch-mt|devtools):/i.test(d.url) }));   // nothing leaves this window
    }
    this.win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    this.ready = (async () => {
      await this.win.loadURL('arch-mt://app/mt.html');
      for (let i = 0; i < 100; i++) {
        if (await this.win.webContents.executeJavaScript('!!window.archTranslate')) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('the translation engine didn’t start');
    })();
    this.ready.catch(() => this.close());
    this.win.on('closed', () => { this.win = null; this.ready = null; });
    this.touch();
    return this.ready;
  }

  touch() {
    clearTimeout(this.idleT);
    this.idleT = setTimeout(() => this.close(), 5 * 60e3);
  }

  close() { if (this.win && !this.win.isDestroyed()) this.win.destroy(); this.win = null; this.ready = null; }

  // texts: [string] (plain text or HTML snippets) -> [string|null]
  async translate(from, to, texts, { html = false } = {}) {
    const r = await this.route(from, to);
    if (!r) throw new Error(`Translating from ${from} to ${to} isn’t available on this PC yet.`);
    if (!r.length) return texts;
    await this.engine();
    this.touch();
    const out = await this.win.webContents.executeJavaScript(`window.archTranslate(${JSON.stringify({ from, to, texts, html })})`);
    this.touch();
    return out;
  }
}

module.exports = { OnDeviceTranslator };
