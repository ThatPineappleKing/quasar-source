// Keeps Quasar's engine (Electron, which brings Chromium and its security fixes) up to date.
//
// Quasar runs from source with node_modules\electron, which is locked while it runs, and
// Electron doesn't let a helper process outlive it. So updates never replace files:
//   1. check    – ask the npm registry which Electron versions exist;
//   2. download – the official zip from Electron's GitHub releases, checked against the
//                 published SHA-256 list, unpacked into its own folder:
//                 %APPDATA%\Quasar\engine\<version>\electron.exe
//   3. test     – start Quasar on the new engine, hidden (--arch-verify-update), while the
//                 current one keeps running. If it doesn't start, the update is dropped.
//   4. switch   – Quasar's shortcuts (Start Menu, Quasar.lnk, taskbar pin, default-browser
//                 link) now start the new engine; "Restart now" relaunches on it.
// The previous engine is kept, so Settings can go back to it.
// Updates within the same major version (security and bug fixes) install by themselves;
// a new major version can change behaviour, so it is only offered.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { app, net } = require('electron');
const win32 = require('./windows-integration');

const CHECK_EVERY = 12 * 3600e3;
const parse = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const major = v => parse(v)[0];

class Updater {
  constructor(shell) {
    this.shell = shell;
    this.busy = false;
    this.progress = null;      // { version, received, total } while downloading
    this.relaunchExe = null;   // set by "Restart now"; used when Quasar exits
    this.appDir = process.env.ARCH_UPDATE_APP_DIR || app.getAppPath();
    this.engineDir = win32.engineDir();
  }

  get st() { return (this.shell.st.update ||= {}); }
  get running() { return process.env.ARCH_FAKE_ELECTRON_VERSION || process.versions.electron; }
  // The engine Quasar's shortcuts start (may be newer than the one running now).
  get active() { return win32.activeEngine(); }
  get installed() { const a = this.active; return a && cmp(a.version, this.running) !== 0 ? a.version : this.running; }
  get auto() { return this.shell.st.settings.autoUpdate !== false; }

  start() {
    const a = this.active;
    // Electron was updated by hand (npm) past the downloaded engine: use the newer one.
    if (a && cmp(this.running, a.version) > 0 && process.execPath.toLowerCase() !== a.exe.toLowerCase()) {
      this.activate({ version: this.running, exe: process.execPath });
    }
    if (a && process.execPath.toLowerCase() === a.exe.toLowerCase() && !process.env.ARCH_FAKE_ELECTRON_VERSION) this.cleanup();
    const due = Date.now() - (this.st.lastCheck || 0) > CHECK_EVERY;
    setTimeout(() => { if (due || this.isUnsupported()) this.check(); }, 90e3);
    setInterval(() => this.check(), CHECK_EVERY);
  }

  status() {
    const a = this.active;
    return {
      current: this.running, installed: this.installed, auto: this.auto, busy: this.busy, progress: this.progress,
      lastCheck: this.st.lastCheck || 0, sameMajor: this.st.sameMajor || null, latest: this.st.latest || null,
      // Downloaded and switched to, but Quasar is still running the older engine.
      pendingRestart: !!a && cmp(a.version, this.running) !== 0 ? a.version : null,
      backup: a?.previous && fs.existsSync(a.previous.exe) ? a.previous.version : null,
      unsupported: this.isUnsupported(), error: this.st.error || null,
    };
  }

  // Electron gives security fixes to its newest three major versions.
  isUnsupported() { return !!this.st.latest && major(this.st.latest) - major(this.installed) >= 3; }

  changed() { this.shell.persist(); this.shell.push(); }
  toast(text, buttons = null) { this.shell.toast(text, null, buttons); }

  async check({ manual = false } = {}) {
    if (this.busy) return;
    this.busy = true; this.st.error = null; this.changed();
    try {
      const res = await net.fetch('https://registry.npmjs.org/electron', { headers: { Accept: 'application/vnd.npm.install-v1+json' } });
      if (!res.ok) throw new Error(`the npm registry answered ${res.status}`);
      const data = await res.json();
      const stable = Object.keys(data.versions || {}).filter(v => /^\d+\.\d+\.\d+$/.test(v));
      const have = this.installed;
      const sameMajor = stable.filter(v => major(v) === major(have)).sort(cmp).pop() || have;
      const tag = data['dist-tags']?.latest;
      const latest = /^\d+\.\d+\.\d+$/.test(tag || '') ? tag : stable.sort(cmp).pop();
      Object.assign(this.st, { lastCheck: Date.now(), sameMajor, latest });
      this.busy = false;
      if (cmp(sameMajor, have) > 0) {
        if (this.auto || manual) await this.install(sameMajor);
        else this.toast(`Electron ${sameMajor} (security and bug fixes) is available.`, [{ label: 'Update', act: ['update:install'] }]);
      } else if (manual) {
        const pending = this.status().pendingRestart;
        this.toast(pending ? `Electron ${pending} is installed; restart Quasar to start using it.`
          : major(latest) > major(have) ? `Quasar is up to date on Electron ${have}. Electron ${latest} (a new major version) is available in Settings › Updates.`
          : `Quasar is up to date (Electron ${have}).`, pending ? [{ label: 'Restart now', act: ['update:install'] }] : null);
      }
      if (this.isUnsupported()) this.toast(`Electron ${major(have)} no longer gets security fixes. Update in Settings › Updates.`, [{ label: 'Update…', act: ['update:major'] }]);
    } catch (err) {
      this.st.error = `Couldn’t check for updates: ${err.message}`;
      if (manual) this.toast(this.st.error);
    } finally { this.busy = false; this.changed(); }
  }

  // Download, verify, test-start and switch to a version.
  async install(version, { quiet = false } = {}) {
    if (this.busy) return false;
    const a = this.active;
    if (a?.version === version && fs.existsSync(a.exe)) { if (!quiet) this.readyToast(version); return true; }
    this.busy = true; this.st.error = null;
    const dir = path.join(this.engineDir, version);
    const tmp = dir + '.download';
    const zipName = `electron-v${version}-win32-${process.arch}.zip`;
    const base = `https://github.com/electron/electron/releases/download/v${version}/`;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      // 1. The published checksums.
      const sums = await (await okFetch(base + 'SHASUMS256.txt')).text();
      const line = sums.split(/\r?\n/).find(l => l.trim().endsWith(zipName));
      const want = line && line.trim().split(/\s+/)[0].toLowerCase();
      if (!want || !/^[0-9a-f]{64}$/.test(want)) throw new Error(`no checksum is published for ${zipName}`);
      // 2. The zip, streamed to disk while hashing.
      const res = await okFetch(base + zipName);
      this.progress = { version, received: 0, total: Number(res.headers.get('content-length')) || 0 };
      this.changed();
      const zip = path.join(tmp, zipName);
      const hash = crypto.createHash('sha256');
      let last = 0;
      const body = Readable.fromWeb(res.body);
      body.on('data', chunk => {
        hash.update(chunk);
        this.progress.received += chunk.length;
        if (Date.now() - last > 500) { last = Date.now(); this.shell.push(); }
      });
      await pipeline(body, fs.createWriteStream(zip));
      if (hash.digest('hex') !== want) throw new Error('the download didn’t match its published checksum, so it was thrown away');
      // 3. Unpack (Windows' built-in tar reads zip files).
      const out = path.join(tmp, 'engine');
      fs.mkdirSync(out);
      await run('tar.exe', ['-xf', zip, '-C', out]);
      fs.rmSync(zip, { force: true });
      const exe = path.join(out, 'electron.exe');
      if (!fs.existsSync(exe)) throw new Error('the download had no electron.exe');
      // 4. Test-start Quasar on it (hidden, separate data folder).
      this.progress = null; this.st.testing = version; this.changed();
      const seen = await this.testStart(exe);
      if (seen !== version) throw new Error(`Quasar didn’t start on it (${seen || 'no answer'}), so Quasar is staying on Electron ${this.installed}`);
      // 5. Keep it and switch the shortcuts to it.
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(out, dir);
      fs.rmSync(tmp, { recursive: true, force: true });
      this.activate({ version, exe: path.join(dir, 'electron.exe') });
      if (!quiet) this.readyToast(version);
      return true;
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      this.st.error = `Update to Electron ${version} failed: ${err.message}`;
      this.toast(this.st.error);
      return false;
    } finally { this.busy = false; this.progress = null; this.st.testing = null; this.changed(); }
  }

  // Start Quasar hidden on `exe` with --arch-verify-update; resolves to the version it reported.
  testStart(exe) {
    const marker = path.join(this.engineDir, `verify-${process.pid}-${Date.now()}.txt`);
    fs.mkdirSync(this.engineDir, { recursive: true });
    return new Promise(resolve => {
      execFile(exe, [this.appDir, `--arch-verify-update=${marker}`], { windowsHide: true, timeout: 90e3 }, () => {
        let v = '';
        try { v = fs.readFileSync(marker, 'utf8').trim(); } catch { /* none */ }
        try { fs.rmSync(marker, { force: true }); } catch { /* ignore */ }
        resolve(v);
      });
    });
  }

  // Point Quasar's shortcuts at an engine; remember the one it replaces.
  activate(engine) {
    const cur = this.active || { version: this.running, exe: process.execPath };
    const previous = cur.exe.toLowerCase() === engine.exe.toLowerCase() ? cur.previous || null : { version: cur.version, exe: cur.exe };
    win32.setActiveEngine({ ...engine, previous });
    if (!process.env.ARCH_USER_DATA) this.refreshShortcuts();   // tests never touch real shortcuts
  }

  async refreshShortcuts() {
    try { win32.ensureShortcuts(); } catch { /* ignore */ }
    try { if (await win32.isRegisteredBrowser()) await win32.registerBrowser(); } catch { /* ignore */ }
  }

  readyToast(version) {
    this.toast(`Electron ${version} is installed. Restart Quasar to start using it.`, [{ label: 'Restart now', act: ['update:install'] }]);
  }

  // "Restart now": install if needed, then quit and come back on the new engine.
  async installNow() {
    let a = this.active;
    if (!a || cmp(a.version, this.running) === 0) {
      const v = this.st.sameMajor && cmp(this.st.sameMajor, this.installed) > 0 ? this.st.sameMajor : null;
      if (!v || !(await this.install(v, { quiet: true }))) return;
      a = this.active;
    }
    this.relaunchExe = a.exe;
    this.shell.st.restoreNext = true;   // the restarted Quasar reopens your tabs
    this.shell.quitAll();
  }

  // Called by Quasar as it exits.
  onExit() {
    if (!this.relaunchExe || !fs.existsSync(this.relaunchExe)) return;
    app.relaunch({ execPath: this.relaunchExe, args: [this.appDir] });
  }

  // A new major version: explain, then install and restart on a yes.
  async offerMajor() {
    const v = this.st.latest;
    if (!v || major(v) <= major(this.installed)) return this.check({ manual: true });
    const { dialog } = require('electron');
    const { response } = await dialog.showMessageBox(this.shell.win || undefined, {
      type: 'question', buttons: [`Update to Electron ${v}`, 'Not now'], defaultId: 0, cancelId: 1, noLink: true,
      message: `Update Quasar’s engine to Electron ${v}?`,
      detail: `Quasar is on Electron ${this.installed}. A new major version brings a newer Chromium and security fixes, but it can change how some things work.\n\nArch downloads it, checks that it starts, and only then switches. You can go back later in Settings › Updates.`,
    });
    if (response !== 0) return;
    if (await this.install(v, { quiet: true })) this.installNow();
  }

  // Go back to the engine the last update replaced.
  rollback() {
    const a = this.active;
    if (!a?.previous || !fs.existsSync(a.previous.exe)) return this.toast('There’s no earlier version to go back to.');
    this.activate({ version: a.previous.version, exe: a.previous.exe });
    this.changed();
    this.toast(`Quasar will use Electron ${a.previous.version} again.`, [{ label: 'Restart now', act: ['update:install'] }]);
  }

  // Keep only the engines in use (the active one, the one it replaced, the one running).
  cleanup() {
    const a = this.active;
    const keep = new Set([a?.exe, a?.previous?.exe, process.execPath].filter(Boolean).map(p => path.dirname(p).toLowerCase()));
    for (const name of safeList(this.engineDir)) {
      const full = path.join(this.engineDir, name);
      if (!fs.statSync(full).isDirectory() || keep.has(full.toLowerCase())) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); } catch { /* in use */ }
    }
  }
}

async function okFetch(url) {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res;
}
function run(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, maxBuffer: 4e6 }, (err, so, se) => (err ? reject(new Error(String(se || err.message).trim())) : resolve(so))));
}
function safeList(dir) { try { return fs.readdirSync(dir); } catch { return []; } }

module.exports = { Updater, cmp };
