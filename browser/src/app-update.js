// Updates for Quasar itself, in copies installed with Quasar-Setup-<version>.exe.
//
// The installer (electron-builder, NSIS) writes resources\app-update.yml, which says
// where new versions are published (a GitHub repo's Releases). Quasar checks there
// every time it starts (a few seconds in) and every few hours after that. A newer version is downloaded in the
// background and checked against the SHA-512 in the release's latest.yml; it is
// installed when Quasar closes, or straight away with "Restart to update".
//
// Each Quasar release brings its own Electron, so the engine updater (updater.js) is
// only used by copies run from source or from the zip; this class takes its place
// and answers the same calls (Settings › Updates, the command bar, the quit hook).

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Every start checks GitHub for a pending release, a moment after the windows are up
// (so the check never slows down Quasar's first paint).
const FIRST_CHECK = 3e3;
const CHECK_EVERY = 4 * 3600e3;

// Is this a copy the installer put here (and so knows where its updates come from)?
function isInstalled() {
  return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}

class AppUpdater {
  constructor(shell) {
    this.shell = shell;
    this.kind = 'app';
    this.busy = false;
    this.progress = null;      // { version, received, total } while downloading
    this.ready = null;         // version downloaded and waiting to be installed
    this.available = null;     // newer version found, not downloaded (automatic updates off)
    this.restart = false;      // "Restart to update" was clicked
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    this.au.autoInstallOnAppQuit = true;
    this.au.allowPrerelease = false;
    this.au.allowDowngrade = false;
    this.au.logger = null;
    this.wire();
  }

  get st() { return (this.shell.st.appUpdate ||= {}); }
  get auto() { return this.shell.st.settings.autoUpdate !== false; }
  get current() { return app.getVersion(); }

  wire() {
    const au = this.au;
    au.on('update-available', info => {
      this.available = info.version;
      this.st.latest = info.version;
      this.st.notes = notesText(info.releaseNotes);
      this.changed();
      if (!au.autoDownload) this.toast(`Quasar ${info.version} is available.`, [{ label: 'Update', act: ['update:install'] }]);
    });
    au.on('update-not-available', info => { this.st.latest = info?.version || this.current; this.available = null; this.changed(); });
    au.on('download-progress', p => {
      this.progress = { version: this.available, received: p.transferred, total: p.total };
      if (!this._lastPush || Date.now() - this._lastPush > 500) { this._lastPush = Date.now(); this.shell.push(); }
    });
    au.on('update-downloaded', info => {
      this.progress = null; this.ready = info.version; this.available = null;
      this.changed();
      if (this.restart) return this.installNow();
      const notes = this.st.notes ? ` ${this.st.notes}` : '';
      this.toast(`Quasar ${info.version} is ready. It installs when you close Quasar.${notes}`, [{ label: 'Restart to update', act: ['update:install'] }]);
    });
    au.on('error', err => {
      this.progress = null;
      this.st.error = `Couldn’t update Quasar: ${shortError(err)}`;
      this.changed();
      if (this._manual) this.toast(this.st.error);
    });
  }

  start() {
    if (this._started) return;
    this._started = true;
    setTimeout(() => this.check(), FIRST_CHECK);
    setInterval(() => this.check(), CHECK_EVERY);
  }

  status() {
    return {
      kind: 'app', current: this.current, installed: this.current, auto: this.auto, busy: this.busy, progress: this.progress,
      lastCheck: this.st.lastCheck || 0, latest: this.st.latest || null, available: this.available,
      pendingRestart: this.ready, notes: this.st.notes || null, error: this.st.error || null,
      electron: process.versions.electron,
    };
  }

  changed() { this.shell.persist(); this.shell.push(); }
  toast(text, buttons = null) { this.shell.toast(text, null, buttons); }

  async check({ manual = false } = {}) {
    if (this.busy || this.ready || this.progress) {
      if (manual && this.ready) this.toast(`Quasar ${this.ready} is ready.`, [{ label: 'Restart to update', act: ['update:install'] }]);
      return;
    }
    this.busy = true; this._manual = manual; this.st.error = null; this.changed();
    try {
      this.au.autoDownload = this.auto;
      const r = await this.au.checkForUpdates();
      this.st.lastCheck = Date.now();
      const found = r?.isUpdateAvailable ?? (r?.updateInfo && r.updateInfo.version !== this.current);
      if (manual && !found) this.toast(`Quasar is up to date (version ${this.current}).`);
      else if (manual && found && this.auto) this.toast(`Downloading Quasar ${r.updateInfo.version}…`);
    } catch (err) {
      this.st.error = `Couldn’t check for updates: ${shortError(err)}`;
      if (manual) this.toast(this.st.error);
    } finally { this.busy = false; this._manual = false; this.changed(); }
  }

  // "Restart to update": download first if needed, then close Quasar and install.
  async installNow() {
    this.restart = true;
    if (!this.ready) {
      if (this.progress) return;   // update-downloaded will come back here
      if (!this.available) return this.check({ manual: true });
      try { await this.au.downloadUpdate(); } catch (err) { this.restart = false; this.toast(`Couldn’t download the update: ${shortError(err)}`); }
      return;
    }
    this.shell.quitAll();
  }

  // Called by Quasar as it exits (last window closing). This can run more than once while
  // windows close, so the installer is started only the first time.
  //
  // Why the guards: electron-updater's quitAndInstall() clears its own "installer started"
  // flag when a repeat call is ignored, and its install-on-quit handler then starts a SECOND
  // installer. Two installers racing showed two windows and left Quasar not updated.
  //
  // The installer runs with its progress window (not silent): replacing Quasar's files takes
  // a minute or two, and without it the user saw nothing happen after clicking the button.
  onExit() {
    if (!this.ready || !this.restart || this._launched) return;   // otherwise autoInstallOnAppQuit installs it quietly
    this._launched = true;
    this.au.autoInstallOnAppQuit = false;   // this call starts the installer; the quit handler must not start another
    try { this.au.quitAndInstall(false, true); } catch { this.au.autoInstallOnAppQuit = true; /* it installs on quit instead */ }
  }

  offerMajor() { return this.check({ manual: true }); }
  rollback() { this.toast('To go back to an earlier Quasar, download its installer from the Releases page and run it.'); }
}

function notesText(n) {
  if (!n) return '';
  const raw = Array.isArray(n) ? n.map(x => x.note || '').join(' ') : String(n);
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 200 ? text.slice(0, 197) + '…' : text;
}
function shortError(err) {
  const m = String(err?.message || err || 'unknown error').split('\n')[0];
  if (/ENOTFOUND|ECONNREFUSED|ERR_INTERNET|net::/i.test(m)) return 'no internet connection';
  if (/404/.test(m)) return 'no published release was found';
  return m.length > 160 ? m.slice(0, 157) + '…' : m;
}

module.exports = { AppUpdater, isInstalled };
