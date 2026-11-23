// Free VPN, like Opera's: one switch routes a profile's pages through Cloudflare WARP
// (free, no data limit). Quasar uses WARP's "proxy" mode, so only Quasar's pages in that
// profile go through it, not the rest of the PC. The first time, Quasar offers to install
// WARP (Cloudflare's own installer, through winget).
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { dialog, Menu, session, shell: eShell } = require('electron');

const WARP_CLI = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Cloudflare', 'Cloudflare WARP', 'warp-cli.exe');

class VpnPart {
  get vpnPort() { const p = Number(this.st.settings.vpnPort); return p > 1024 && p < 65536 ? p : 40000; }
  warpInstalled() { return fs.existsSync(this._warpCli || WARP_CLI); }

  warp(args, timeout = 20000) {
    return new Promise(res => execFile(this._warpCli || WARP_CLI, ['--accept-tos', ...args], { windowsHide: true, timeout },
      (err, stdout, stderr) => res({ ok: !err, out: String(stdout || '') + String(stderr || '') })));
  }

  // Is anything listening on WARP's proxy port?
  vpnPortOpen(port = this.vpnPort) {
    const net = require('net');
    return new Promise(res => {
      const s = net.connect({ host: '127.0.0.1', port });
      const done = ok => { s.destroy(); res(ok); };
      s.once('connect', () => done(true)); s.once('error', () => done(false)); s.setTimeout(800, () => done(false));
    });
  }

  // The first time: install WARP (Cloudflare's installer via winget; Windows asks for permission).
  async offerWarpInstall() {
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question', buttons: ['Install', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
      message: 'Install Cloudflare WARP for Quasar’s free VPN?',
      detail: 'Quasar’s VPN runs through Cloudflare WARP: free, with no data limit. It’s a 57 MB download from Cloudflare, about 200 MB installed, and Windows will ask for permission. Quasar only sends its own pages through it; the rest of your PC isn’t affected.\n\nWARP hides your IP address from sites. It doesn’t let you pick a country: sites still see roughly your region.',
    });
    if (response !== 0) return false;
    this.vpnBusy = 'Installing Cloudflare WARP…'; this.push();
    this.toast('Installing Cloudflare WARP… If Windows asks for permission, click Yes.');
    const ok = await new Promise(res => {
      const p = spawn('winget', ['install', '--id', 'Cloudflare.Warp', '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements'], { windowsHide: true });
      p.on('error', () => res(false));
      p.on('exit', () => res(this.warpInstalled()));
    });
    this.vpnBusy = null; this.push();
    if (!ok) {
      const r = await dialog.showMessageBox(this.win, { type: 'warning', buttons: ['Open download page', 'Close'], defaultId: 0, cancelId: 1, noLink: true,
        message: 'WARP didn’t install.', detail: 'You can install “1.1.1.1 / WARP” from Cloudflare’s site, then turn the VPN on again.' });
      if (r.response === 0) eShell.openExternal('https://one.one.one.one/');
    }
    return ok;
  }

  // Make sure WARP is registered, in proxy mode on our port, and connected.
  async vpnStart({ ask = true } = {}) {
    if (await this.vpnPortOpen()) return { ok: true };
    if (!this.warpInstalled()) {
      if (!ask || !(await this.offerWarpInstall())) return { error: 'Cloudflare WARP isn’t installed.' };
    }
    this.vpnBusy = 'Connecting…'; this.push();
    try {
      const st = await this.warp(['-j', 'status']);
      if (/Registration\s*Missing|RegistrationMissing/i.test(st.out)) {
        const r = await this.warp(['registration', 'new'], 40000);
        if (!r.ok) return { error: 'WARP couldn’t register: ' + r.out.trim().slice(0, 200) };
      }
      // WARP set up as a whole-PC VPN: switching it to proxy mode changes that, so ask first.
      const settings = await this.warp(['settings', 'list']);
      const mode = /Mode:\s*(\S+)/.exec(settings.out)?.[1] || '';
      if (mode && !/Proxy/i.test(mode) && /Connected/i.test(st.out) && ask) {
        const { response } = await dialog.showMessageBox(this.win, { type: 'question', buttons: ['Switch WARP to Quasar only', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
          message: 'WARP is protecting your whole PC right now.', detail: 'Quasar’s VPN uses WARP’s proxy mode, which covers only Quasar. Switching means the rest of your PC no longer goes through WARP. (You can switch back in the WARP app.)' });
        if (response !== 0) return { error: 'Cancelled.' };
      }
      if (!/Proxy/i.test(mode) || !new RegExp(`port\\s*${this.vpnPort}\\b`).test(settings.out)) {
        await this.warp(['mode', 'proxy']);
        await this.warp(['proxy', 'port', String(this.vpnPort)]);
      }
      await this.warp(['connect']);
      for (let i = 0; i < 40; i++) { if (await this.vpnPortOpen()) return { ok: true }; await new Promise(r => setTimeout(r, 500)); }
      return { error: 'WARP didn’t connect. Check your internet connection, or open the WARP app.' };
    } finally { this.vpnBusy = null; this.push(); }
  }

  // Turn the VPN on or off for a Profile (default: the current Space's).
  async setVpn(on, profileId = this.space.profileId) {
    const sp = this.space;
    if (sp.private) {   // a private window: its own in-memory setting
      if (on) { const r = await this.vpnStart(); if (r.error) { this.toast(r.error); return r; } }
      sp.proxy = on ? { mode: 'vpn' } : null;
      const ses = session.fromPartition(sp.partition);
      if (this.sessions.has(ses)) await this.applyProxy(ses, sp.partition);
      this.vpnChanged(on);
      return { ok: true };
    }
    const p = this.st.profiles.find(x => x.id === profileId);
    if (!p) return { error: 'No such profile.' };
    if (on) {
      const r = await this.vpnStart();
      if (r.error) { this.toast(r.error); return r; }
      if (p.proxy?.mode !== 'vpn') p.proxyBefore = p.proxy || null;
      await this.setProfileProxy(p.id, { mode: 'vpn' });
    } else {
      const back = p.proxyBefore || null;
      delete p.proxyBefore;
      await this.setProfileProxy(p.id, back || { mode: 'system' });
    }
    this.vpnChanged(on);
    return { ok: true };
  }

  vpnChanged(on) {
    this.vpnInfoCache = null;
    for (const t of this.tabs.values()) if (t.profile === this.space.partition && !t.sleeping) t.view?.webContents?.reload();
    this.toast(on ? 'VPN on: pages in this Space now go through Cloudflare WARP.' : 'VPN off.');
    if (on) this.vpnInfo().then(() => this.push());
    this.push();
  }

  vpnOnFor(sp = this.space) { const p = sp.private ? sp.proxy : this.profileOf(sp)?.proxy; return p?.mode === 'vpn'; }

  // What sites now see (Cloudflare's trace page, through the VPN).
  async vpnInfo() {
    if (this.vpnInfoCache && Date.now() - this.vpnInfoCache.at < 60e3) return this.vpnInfoCache;
    const sp = this.space;
    const ses = session.fromPartition(sp.private ? sp.partition : 'persist:' + sp.partition);
    try {
      const r = await ses.fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' });
      const kv = Object.fromEntries((await r.text()).trim().split('\n').map(l => l.split('=')));
      this.vpnInfoCache = { at: Date.now(), ip: kv.ip || '', loc: kv.loc || '', colo: kv.colo || '', warp: kv.warp === 'on' || kv.warp === 'plus' };
    } catch { this.vpnInfoCache = { at: Date.now(), error: true }; }
    return this.vpnInfoCache;
  }

  vpnViewModel() {
    const sp = this.space;
    const i = this.vpnInfoCache;
    return { on: this.vpnOnFor(sp), busy: this.vpnBusy || null, show: this.st.settings.vpnButton !== false,
      where: i && !i.error ? [i.loc && (new Intl.DisplayNames(['en'], { type: 'region' }).of(i.loc) || i.loc), i.colo].filter(Boolean).join(' · ') : '', working: !!i?.warp };
  }

  // The VPN button in the top bar.
  async vpnMenu(x, y) {
    const sp = this.space;
    const on = this.vpnOnFor(sp);
    if (!on) return this.setVpn(true);
    const info = await this.vpnInfo();
    this.push();
    const region = info.loc ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(info.loc) || info.loc) : '';
    Menu.buildFromTemplate([
      { label: info.error ? 'VPN on, but it isn’t answering' : info.warp ? 'VPN on: Cloudflare WARP' : 'VPN on, but WARP isn’t carrying the traffic', enabled: false },
      ...(info.ip ? [{ label: `Sites see: ${info.ip}`, enabled: false }, { label: `Location shown: ${region}${info.colo ? ` (via ${info.colo})` : ''}`, enabled: false }] : []),
      { label: `Covers: ${sp.private ? 'this private window' : `the “${this.profileOf(sp)?.name}” profile (${this.spacesOnProfile(sp.profileId).map(s => s.name).join(', ')})`}`, enabled: false },
      { type: 'separator' },
      { label: 'Turn VPN Off', click: () => this.setVpn(false) },
      { label: 'Reconnect', click: async () => { await this.warp(['disconnect']); const r = await this.vpnStart({ ask: false }); this.vpnInfoCache = null; this.toast(r.error || 'VPN reconnected.'); } },
      { label: 'New Private Window with VPN', click: () => this.newWindow({ vpn: true }) },
    ]).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }
}

module.exports = VpnPart;
