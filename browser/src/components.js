// Updates for the code packages Quasar is built from (the engine, Electron, has its
// own updater in updater.js): electron-chrome-extensions (Chrome extensions),
// @mozilla/readability (reader mode) and @browsermt/bergamot-translator (translation).
//
// Quasar asks the npm registry for newer versions within the range package.json
// allows (no new major versions, which may change how they work), downloads the
// package, checks it against the registry's SHA-512 checksum, and swaps it in with
// the old copy kept. Then a hidden test start of Quasar must succeed (the same check
// the engine updater uses), or the old copy goes straight back. The new code runs
// after the next restart.
//
// Quasar's own code (src/, ui/) has no published source to update from: it changes
// when you replace this folder (or `git pull` if you keep it in git).

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app, net } = require('electron');

const ROOT = path.join(__dirname, '..');
const parse = v => String(v).replace(/^[^\d]*/, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const prerelease = v => /-/.test(String(v));

// Enough of semver for the ranges Quasar and its packages use: ^x.y.z, ~x.y.z, x.y.z, >=x.
function satisfies(v, range) {
  range = String(range || '*').trim();
  if (range === '*' || range === '' || range === 'latest') return true;
  if (prerelease(v)) return false;
  return range.split('||').some(r => {
    r = r.trim();
    const m = r.match(/^([\^~]|>=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/);
    if (!m) return false;
    const [, op, M, mi, pa] = m;
    const base = [Number(M), mi && !/[x*]/.test(mi) ? Number(mi) : 0, pa && !/[x*]/.test(pa) ? Number(pa) : 0].join('.');
    const [a, b] = parse(v), [bm, bmi] = parse(base);
    if (cmp(v, base) < 0) return false;
    if (op === '>=') return true;
    if (op === '~') return a === bm && b === bmi;
    if (op === '^') return bm > 0 ? a === bm : bmi > 0 ? a === 0 && b === bmi : a === 0 && b === 0 && cmp(v, base) === 0;
    if (!mi || /[x*]/.test(mi)) return a === bm;
    if (!pa || /[x*]/.test(pa)) return a === bm && b === bmi;
    return cmp(v, base) === 0;
  });
}

const pkgJson = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; } };
const modDir = name => path.join(ROOT, 'node_modules', ...name.split('/'));
const run = (file, args, opts = {}) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, maxBuffer: 8e6, ...opts }, (err, so, se) => (err ? reject(new Error(String(se || err.message).trim())) : resolve(so))));

class Components {
  constructor(shell) {
    this.shell = shell;
    this.busy = false;
  }
  get st() { return (this.shell.st.components ||= {}); }

  // [{ name, range, installed, available, newerMajor }]
  async check() {
    const root = pkgJson(ROOT) || {};
    const out = [];
    for (const [name, range] of Object.entries(root.dependencies || {})) {
      const installed = pkgJson(modDir(name))?.version || null;
      let info = null;
      try {
        const res = await net.fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
        if (res.ok) info = await res.json();
      } catch { /* offline */ }
      if (!info) { out.push({ name, range, installed, error: 'couldn’t reach the npm registry' }); continue; }
      const versions = Object.keys(info.versions || {}).filter(v => !prerelease(v));
      const ok = versions.filter(v => satisfies(v, range)).sort(cmp);
      const best = ok[ok.length - 1] || null;
      const latest = info['dist-tags']?.latest;
      out.push({ name, range, installed, available: best && installed && cmp(best, installed) > 0 ? best : null,
        newerMajor: latest && best && parse(latest)[0] > parse(best)[0] ? latest : null, dist: best ? info.versions[best].dist : null,
        deps: best ? info.versions[best].dependencies || {} : {} });
    }
    this.st.lastCheck = Date.now();
    this.st.list = out.map(({ dist, deps, ...x }) => x);
    this.shell.persist();
    return out;
  }

  // Download, verify (SHA-512 from the registry), swap in, test-start, keep or roll back.
  async update() {
    if (this.busy) return { error: 'An update is already running.' };
    this.busy = true;
    const done = [], skipped = [];
    const backups = [];
    try {
      const list = (await this.check()).filter(c => c.available && c.dist);
      if (!list.length) return { summary: 'Everything is up to date.' };
      for (const c of list) {
        // Its own dependencies must already be here (Quasar doesn't fetch new ones by itself).
        const missing = Object.entries(c.deps).filter(([d, r]) => !satisfies(pkgJson(modDir(d))?.version || '0.0.0', r)).map(([d, r]) => `${d}@${r}`);
        if (missing.length) { skipped.push(`${c.name} ${c.available} (needs ${missing.join(', ')}; run “npm update” in Quasar’s folder)`); continue; }
        const tgz = await this.download(c.dist);
        const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-pkg-'));
        try {
          await run('tar.exe', ['-xzf', tgz, '-C', stage]);
          const src = path.join(stage, 'package');
          if (pkgJson(src)?.version !== c.available) throw new Error('the package didn’t contain what the registry said');
          const dest = modDir(c.name);
          const bak = path.join(app.getPath('userData'), 'component-backup', `${c.name.replace('/', '+')}@${c.installed}`);
          fs.rmSync(bak, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(bak), { recursive: true });
          fs.cpSync(dest, bak, { recursive: true });
          backups.push({ dest, bak, name: c.name, from: c.installed, to: c.available });
          fs.rmSync(dest, { recursive: true, force: true });
          fs.cpSync(src, dest, { recursive: true });
          done.push(`${c.name} ${c.installed} → ${c.available}`);
        } finally {
          fs.rmSync(stage, { recursive: true, force: true });
          fs.rmSync(tgz, { force: true });
        }
      }
      if (backups.length && !(await this.testStart())) {
        for (const b of backups) { fs.rmSync(b.dest, { recursive: true, force: true }); fs.cpSync(b.bak, b.dest, { recursive: true }); }
        return { error: `The new versions didn’t pass Quasar’s start-up test, so the old ones were put back. (${done.join(', ')})` };
      }
      if (done.length) { this.st.pendingRestart = true; this.st.lastUpdate = { at: Date.now(), done, backups: backups.map(({ name, from, to, bak }) => ({ name, from, to, bak })) }; }
      this.shell.persist();
      return { summary: [done.length && `Updated ${done.join(', ')}. Restart Quasar to use ${done.length === 1 ? 'it' : 'them'}.`, skipped.length && `Not updated: ${skipped.join('; ')}.`].filter(Boolean).join(' ') };
    } catch (err) {
      for (const b of backups) { try { fs.rmSync(b.dest, { recursive: true, force: true }); fs.cpSync(b.bak, b.dest, { recursive: true }); } catch { /* ignore */ } }
      return { error: `Couldn’t update: ${err.message}. Nothing was changed.` };
    } finally { this.busy = false; this.shell.libUpdate(); }
  }

  // Put back what the last update replaced.
  rollback() {
    const last = this.st.lastUpdate;
    if (!last?.backups?.length) return { error: 'There’s no earlier version to go back to.' };
    for (const b of last.backups) {
      if (!fs.existsSync(b.bak)) continue;
      const dest = modDir(b.name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(b.bak, dest, { recursive: true });
    }
    this.st.lastUpdate = null;
    this.st.pendingRestart = true;
    this.shell.persist();
    return { summary: `Went back to ${last.backups.map(b => `${b.name} ${b.from}`).join(', ')}. Restart Quasar to use ${last.backups.length === 1 ? 'it' : 'them'}.` };
  }

  async download(dist) {
    const res = await net.fetch(dist.tarball);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const [alg, want] = String(dist.integrity || '').split('-');
    if (alg === 'sha512') {
      if (crypto.createHash('sha512').update(buf).digest('base64') !== want) throw new Error('the download didn’t match its checksum');
    } else if (dist.shasum) {
      if (crypto.createHash('sha1').update(buf).digest('hex') !== dist.shasum) throw new Error('the download didn’t match its checksum');
    } else throw new Error('the registry gave no checksum');
    const file = path.join(os.tmpdir(), `arch-pkg-${Date.now()}.tgz`);
    fs.writeFileSync(file, buf);
    return file;
  }

  // Same hidden start the engine updater uses: Quasar's code loads and its window renders.
  testStart() {
    const marker = path.join(os.tmpdir(), `arch-verify-${Date.now()}.txt`);
    return new Promise(resolve => {
      execFile(process.execPath, [ROOT, `--arch-verify-update=${marker}`], { windowsHide: true, timeout: 90e3, env: { ...process.env, ARCH_USER_DATA: '' } }, () => {
        let ok = false;
        try { ok = fs.readFileSync(marker, 'utf8') === process.versions.electron; } catch { /* no marker */ }
        try { fs.rmSync(marker, { force: true }); } catch { /* ignore */ }
        resolve(ok);
      });
    });
  }

  status() {
    return { list: this.st.list || [], lastCheck: this.st.lastCheck || 0, pendingRestart: !!this.st.pendingRestart, busy: this.busy,
      canRollback: !!this.st.lastUpdate?.backups?.length, last: this.st.lastUpdate ? { at: this.st.lastUpdate.at, done: this.st.lastUpdate.done } : null,
      git: fs.existsSync(path.join(ROOT, '.git')) };
  }

  // Checked once a day (just looks; installing is your choice, in Settings › Updates).
  start() {
    setTimeout(async () => {
      if (Date.now() - (this.st.lastCheck || 0) < 24 * 3600e3) return;
      try {
        const n = (await this.check()).filter(c => c.available).length;
        if (n) this.shell.toast(`${n} update${n === 1 ? '' : 's'} for Quasar’s components ${n === 1 ? 'is' : 'are'} available.`, null, [{ label: 'See updates', act: ['library', 'updates'] }]);
      } catch { /* try tomorrow */ }
    }, 180e3);
    if (this.st.pendingRestart) { this.st.pendingRestart = false; this.shell.persist(); }   // we restarted: the new code is running
  }
}

module.exports = { Components, satisfies };
