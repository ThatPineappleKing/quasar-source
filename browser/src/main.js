const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, ipcMain, Menu, protocol } = require('electron');

// The updater's hidden test start after swapping in a new Electron (see updater.js).
const verifyArg = process.argv.find(a => a.startsWith('--arch-verify-update='));
if (verifyArg) {
  require('./verify-update')(verifyArg.slice('--arch-verify-update='.length).replace(/^"|"$/g, ''));
  return;
}
app.setName('Quasar');
// For testing: run against a separate data folder.
if (process.env.ARCH_USER_DATA) app.setPath('userData', process.env.ARCH_USER_DATA);
else {
  // Quasar was called Arch. An existing install keeps its data where it is
  // (%APPDATA%\Arch: logins, passwords, the updated engine its shortcuts start),
  // so nothing has to move; new installs use %APPDATA%\Quasar.
  const appData = app.getPath('appData');
  const oldDir = path.join(appData, 'Arch');
  if (fs.existsSync(path.join(oldDir, 'state.json')) && !fs.existsSync(path.join(appData, 'Quasar', 'state.json'))) {
    app.setPath('userData', oldDir);
  }
}
// (No memory-saving engine switches: V8's optimize-for-size, process-per-site and a small
// GPU image cache each saved a little memory but made pages load or scroll slower.)
// Settings › Performance › Use hardware acceleration (off saves ~300 MB, costs CPU).
try {
  const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'state.json'), 'utf8'));
  if (saved?.settings?.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch { /* no state yet */ }

const { Shell } = require('./shell');
const win32 = require('./windows-integration');

// arch-mt:// serves the on-device translation engine and its models (src/mt.js).
// It has to be a "standard", secure scheme for module scripts, Web Workers and WebAssembly.
protocol.registerSchemesAsPrivileged([{ scheme: 'arch-mt', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setAppUserModelId(win32.APP_ID);   // own taskbar identity, so Windows uses Quasar's icon

// Every Quasar window (main, Little Quasar, Passwords, sign-in pop-ups) gets Quasar's
// icon and relaunch command, so pinning it from the taskbar keeps Quasar's icon.
app.on('browser-window-created', (e, win) => win32.applyToWindow(win));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let shell;

  // A link or .html file passed on the command line (what Windows does when
  // Quasar is the default browser and you click a link in another app).
  const urlFromArgs = argv => {
    for (const a of argv.slice(1)) {
      if (/^https?:\/\//i.test(a)) return a;
      if (/\.(x?html?)$/i.test(a) && !a.startsWith('-')) {
        try { if (fs.existsSync(a)) return pathToFileURL(path.resolve(a)).href; } catch { /* ignore */ }
      }
    }
    return null;
  };

  // Links opened from other apps while Quasar is running go into a new tab.
  // An installed site app's shortcut ("--arch-app=<id>").
  const appFromArgs = argv => (argv.find(a => a.startsWith('--arch-app=')) || '').slice(11).replace(/[^a-z0-9]/gi, '') || null;

  app.on('second-instance', (e, argv) => {
    const appId = appFromArgs(argv);
    if (appId && shell) return shell.openApp(appId);
    const url = urlFromArgs(argv);
    if (shell) shell.openExternalLink(url);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    shell = new Shell();
    // Only plain data goes back to the UI; most actions return nothing.
    const returns = new Set(['ready', 'cmd:query', 'cmd:suggest', 'addSpace', 'tabPreview', 'setProfileProxy', 'notes', 'readLater', 'keywords', 'chains', 'lock:unlock', 'background', 'nt', 'setting']);   // setting: only { error } for an address it couldn't use
    ipcMain.handle('act', async (e, name, args) => {
      const r = await shell.act(e.sender, name, args);
      return returns.has(name) || /^(pwm|lib|chooser|ai|tm|mu):/.test(name) ? r : undefined;
    });
    // A site offering its own search (OpenSearch), for search shortcuts.
    ipcMain.on('arch:opensearch', (e, href) => { if (e.senderFrame === e.sender.mainFrame && typeof href === 'string' && href.length < 2048) shell.onOpenSearch(e.sender, href); });
    // Password autofill / save requests from web pages (checked against the real page URL).
    ipcMain.handle('pw', (e, op, arg) => shell.pwInvoke(e, op, arg));
    ipcMain.on('pw:candidate', (e, data) => shell.pwCandidate(e, data));
    ipcMain.on('addr:candidate', (e, data) => shell.addrCandidate(e, data));
    ipcMain.on('card:candidate', (e, data) => shell.cardCandidate(e, data));
    ipcMain.on('arch:gesture', (e, g) => { if (e.senderFrame === e.sender.mainFrame && /^[LRUD]{1,4}$/.test(String(g))) shell.onGesture(e.sender, String(g)); });
    // "Add to notes" from a page selection is done from the right-click menu (no page IPC needed).
    // What a page is playing, for the sidebar's media controls.
    ipcMain.on('arch:media', (e, s) => { if (e.senderFrame === e.sender.mainFrame) shell.onMedia(e.sender, s); });
    // Ad blocking setup a page's preload asks for at document start (CSS + YouTube/skipper flags).
    ipcMain.on('arch:page-config', (e, host) => {
      try { e.returnValue = shell.protection.pageConfig(typeof host === 'string' ? host.toLowerCase().slice(0, 253) : ''); }
      catch { e.returnValue = { block: false }; }
    });
    // Generic ad/cookie-banner hiding rules for classes and ids the page has shown
    // (protection.js cosmeticFor). The site comes from the frame's real address.
    ipcMain.handle('arch:cosmetic', (e, tokens) => {
      if (e.senderFrame !== e.sender.mainFrame || !Array.isArray(tokens)) return '';
      let host = '';
      try { const u = new URL(e.senderFrame.url); if (/^https?:$/.test(u.protocol)) host = u.hostname; } catch { /* ignore */ }
      try { return host ? shell.protection.cosmeticFor(host, tokens.slice(0, 5000).filter(t => typeof t === 'string' && t.length < 256)) : ''; }
      catch { return ''; }
    });
    ipcMain.on('arch:link-click', (e, href) => {
      if (typeof href === 'string' && href.length < 4096 && e.senderFrame === e.sender.mainFrame) shell.linkClicks.set(e.sender.id, { href, at: Date.now() });
    });
    shell.start();
    // Keep Quasar.lnk, the Start Menu entry and any Quasar taskbar pin on Quasar's icon.
    // Done well after start-up so it never competes with the first page load.
    // (Not in test mode: a test run must never repoint the real Start Menu shortcut.)
    if (!process.env.ARCH_USER_DATA) setTimeout(() => win32.ensureShortcuts(), 8000);
    if (process.env.ARCH_USER_DATA) global.__arch = shell; // test mode only
    const url = urlFromArgs(process.argv);
    if (url) shell.newTab(url);
    const appId = appFromArgs(process.argv);
    if (appId) {
      // Started from an app shortcut: the app comes first; Quasar's own window waits minimised.
      for (const W of shell.wins) W.win.once('ready-to-show', () => setTimeout(() => !W.win.isDestroyed() && W.win.minimize(), 50));
      shell.openApp(appId);
    }
  });

  // Username/password pop-ups (HTTP basic/digest auth, proxies).
  app.on('login', (e, wc, details, authInfo, cb) => {
    if (shell) shell.onLogin(e, wc, details, authInfo, cb);
  });
  // Bad certificates: blocked unless the user chose "Proceed" on Quasar's warning page.
  app.on('certificate-error', (e, wc, url, error, cert, cb, isMainFrame) => {
    if (shell) shell.onCertError(e, wc, url, error, cert, cb, isMainFrame); else cb(false);
  });

  // Block anything that tries to embed <webview> tags.
  app.on('web-contents-created', (e, wc) => {
    wc.on('will-attach-webview', ev => ev.preventDefault());
  });

  app.on('window-all-closed', () => app.quit());
}
