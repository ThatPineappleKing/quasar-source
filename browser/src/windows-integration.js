// Makes Windows treat Quasar as its own app with its own icon, everywhere:
// - every Quasar window carries Quasar's app ID, icon and relaunch command, so
//   "Pin to taskbar" creates a pin with Quasar's icon (not Electron's) that reopens Quasar;
// - Quasar.lnk and a Start Menu shortcut carry the same app ID and icon;
// - an existing Quasar taskbar pin with the wrong icon gets repaired.

const path = require('path');
const fs = require('fs');
const { app, shell } = require('electron');

const APP_ID = 'Quasar.Browser';
const ICON = path.join(__dirname, '..', '..', 'icon', 'quasar.ico');

// Windows remembers icons by file path, so after the logo changes it keeps showing
// the old picture for the same path (taskbar pins especially). Windows is handed a
// copy whose name includes a fingerprint of the icon: a new logo = a new path, so
// Windows loads it fresh. The copy lives in Quasar's data folder.
let shellIconPath = null;
function shellIcon() {
  if (shellIconPath && fs.existsSync(shellIconPath)) return shellIconPath;
  try {
    const data = fs.readFileSync(ICON);
    const hash = require('crypto').createHash('sha256').update(data).digest('hex').slice(0, 10);
    const dir = path.join(app.getPath('userData'), 'icons');
    const file = path.join(dir, `quasar-${hash}.ico`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, data);
      // Old copies from earlier logos aren't needed any more.
      for (const f of fs.readdirSync(dir)) if (/^quasar-[0-9a-f]+\.ico$/.test(f) && f !== path.basename(file)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* in use */ } }
    }
    shellIconPath = file;
  } catch { shellIconPath = ICON; }
  return shellIconPath;
}

// ---- engine (Electron) that Quasar's shortcuts start; see updater.js
function engineDir() { return path.join(app.getPath('userData'), 'engine'); }
function activeEngine() {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(engineDir(), 'active.json'), 'utf8'));
    return a && typeof a.exe === 'string' && fs.existsSync(a.exe) ? a : null;
  } catch { return null; }
}
function setActiveEngine(a) {
  fs.mkdirSync(engineDir(), { recursive: true });
  fs.writeFileSync(path.join(engineDir(), 'active.json'), JSON.stringify(a, null, 1));
}

function launchCommand() {
  // Running from source: electron.exe "<app folder>". Packaged: just the exe.
  // After an engine update, shortcuts start the updated electron.exe instead.
  const engine = !app.isPackaged && activeEngine();
  if (engine) return { target: engine.exe, args: `"${app.getAppPath()}"` };
  return app.isPackaged
    ? { target: process.execPath, args: '' }
    : { target: process.execPath, args: `"${app.getAppPath()}"` };
}

function applyToWindow(win) {
  if (process.platform !== 'win32' || !fs.existsSync(ICON)) return;
  const { target, args } = launchCommand();
  try {
    win.setAppDetails({
      appId: APP_ID,
      appIconPath: shellIcon(),
      appIconIndex: 0,
      relaunchCommand: `"${target}" ${args}`.trim(),
      relaunchDisplayName: 'Quasar',
    });
  } catch { /* window already gone */ }
}

function writeShortcut(file) {
  const { target, args } = launchCommand();
  const opts = { target, args, cwd: app.getAppPath(), icon: shellIcon(), iconIndex: 0, appUserModelId: APP_ID, description: 'Quasar browser' };
  try {
    const exists = fs.existsSync(file);
    if (exists) {
      // Already correct? Then leave it alone (rewriting every launch costs start-up time).
      try {
        const d = shell.readShortcutLink(file);
        const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
        if (same(d.target, target) && same(d.args, args) && same(d.icon, shellIcon()) && d.appUserModelId === APP_ID) return false;
      } catch { /* unreadable: rewrite it */ }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    return shell.writeShortcutLink(file, exists ? 'replace' : 'create', opts);
  } catch { return false; }
}

function ensureShortcuts() {
  if (process.platform !== 'win32' || !fs.existsSync(ICON)) return { written: [] };
  const written = [];
  const appDir = app.getAppPath();
  const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  // Installed copies: the installer makes the Start Menu and desktop shortcuts, and the
  // install folder is replaced on every update, so no Quasar.lnk goes in there.
  const installed = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  const targets = installed ? [path.join(startMenu, 'Quasar.lnk')] : [path.join(appDir, 'Quasar.lnk'), path.join(startMenu, 'Quasar.lnk')];
  for (const f of targets) if (writeShortcut(f)) written.push(f);

  // Quasar used to be called Arch: remove the old Arch.lnk shortcuts (only ours).
  for (const old of [path.join(appDir, 'Arch.lnk'), path.join(startMenu, 'Arch.lnk')]) {
    try {
      if (!fs.existsSync(old)) continue;
      const d = shell.readShortcutLink(old);
      if (d.appUserModelId === 'Arch.Browser' || d.appUserModelId === APP_ID || (d.args || '').toLowerCase().includes(appDir.toLowerCase())) fs.unlinkSync(old);
    } catch { /* leave it */ }
  }

  // Repair existing taskbar pins that launch Quasar but show the wrong icon.
  const pins = path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  let files = [];
  try { files = fs.readdirSync(pins).filter(f => f.toLowerCase().endsWith('.lnk')); } catch { /* none */ }
  const exe = path.resolve(process.execPath).toLowerCase();
  for (const f of files) {
    const p = path.join(pins, f);
    let d;
    try { d = shell.readShortcutLink(p); } catch { continue; }
    const isArch = d.appUserModelId === APP_ID || d.appUserModelId === 'Arch.Browser' ||
      (d.target && path.resolve(d.target).toLowerCase() === exe && (d.args || '').toLowerCase().includes(appDir.toLowerCase()));
    const iconOk = (d.icon || '').toLowerCase() === shellIcon().toLowerCase() && d.appUserModelId === APP_ID;
    if (isArch && !iconOk && writeShortcut(p)) written.push(p);
  }
  // Windows also keeps its own hidden shortcut for a running app's taskbar button
  // (User Pinned\ImplicitAppShortcuts). It isn't refreshed when the icon changes,
  // so point any of Quasar's at the current icon too.
  const implicit = path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'ImplicitAppShortcuts');
  let subdirs = [];
  try { subdirs = fs.readdirSync(implicit); } catch { /* none */ }
  for (const sub of subdirs) {
    let links = [];
    try { links = fs.readdirSync(path.join(implicit, sub)).filter(f => f.toLowerCase().endsWith('.lnk')); } catch { continue; }
    for (const f of links) {
      const p = path.join(implicit, sub, f);
      let d;
      try { d = shell.readShortcutLink(p); } catch { continue; }
      const ours = d.appUserModelId === APP_ID || d.appUserModelId === 'Arch.Browser';
      if (ours && (d.icon || '').toLowerCase() !== shellIcon().toLowerCase()) {
        try { if (shell.writeShortcutLink(p, 'update', { icon: shellIcon(), iconIndex: 0 })) written.push(p); } catch { /* leave it */ }
      }
    }
  }
  return { written };
}

// ------------------------------------------------------ default browser
// Registers Quasar with Windows as a browser that can handle http/https links
// and .html files (per-user, HKCU only). Windows 10/11 don't let apps make
// themselves the default; the user picks Quasar in Settings › Default apps.
const { execFile } = require('child_process');
// Registry key names stay from when Quasar was called Arch, so an existing
// "default browser" choice keeps working; only the names Windows shows changed.
const PROG_ID = 'ArchHTML';
const CLIENT = 'Arch';

function reg(args) {
  return new Promise((resolve, reject) => execFile('reg.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim())); else resolve(String(stdout));
  }));
}

function openCommand() {
  const { target, args } = launchCommand();
  return `"${target}" ${args ? args + ' ' : ''}"%1"`;
}

// `root` is only changed by tests (so they never touch the real registration).
function registryEntries(root = 'HKCU\\Software') {
  const icon = `"${shellIcon()}",0`;
  const cmd = openCommand();
  const client = `${root}\\Clients\\StartMenuInternet\\${CLIENT}`;
  const cls = `${root}\\Classes\\${PROG_ID}`;
  const caps = `${client}\\Capabilities`;
  return [
    [cls, '', 'Quasar HTML Document'],
    [cls, 'FriendlyTypeName', 'Quasar HTML Document'],
    [`${cls}\\Application`, 'ApplicationName', 'Quasar'],
    [`${cls}\\Application`, 'ApplicationIcon', icon],
    [`${cls}\\Application`, 'AppUserModelId', APP_ID],
    [`${cls}\\DefaultIcon`, '', icon],
    [`${cls}\\shell\\open\\command`, '', cmd],
    [client, '', 'Quasar'],
    [`${client}\\DefaultIcon`, '', icon],
    [`${client}\\shell\\open\\command`, '', launchCommandLine()],
    [caps, 'ApplicationName', 'Quasar'],
    [caps, 'ApplicationDescription', 'Quasar — an Arc-style browser'],
    [caps, 'ApplicationIcon', icon],
    [`${caps}\\StartMenu`, 'StartMenuInternet', CLIENT],
    [`${caps}\\URLAssociations`, 'http', PROG_ID],
    [`${caps}\\URLAssociations`, 'https', PROG_ID],
    [`${caps}\\FileAssociations`, '.htm', PROG_ID],
    [`${caps}\\FileAssociations`, '.html', PROG_ID],
    [`${caps}\\FileAssociations`, '.xhtml', PROG_ID],
    [`${root}\\RegisteredApplications`, CLIENT, `${root.replace(/^HKCU\\/, '')}\\Clients\\StartMenuInternet\\${CLIENT}\\Capabilities`],
  ];
}

function launchCommandLine() {
  const { target, args } = launchCommand();
  return `"${target}"${args ? ' ' + args : ''}`;
}

async function registerBrowser(root) {
  if (process.platform !== 'win32') throw new Error('Only available on Windows.');
  for (const [key, name, value] of registryEntries(root)) {
    await reg(['add', key, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f']);
  }
}

// Is Quasar the user's chosen browser for https links?
async function isDefaultBrowser() {
  if (process.platform !== 'win32') return false;
  try {
    const out = await reg(['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']);
    return new RegExp(`ProgId\\s+REG_SZ\\s+${PROG_ID}\\s*$`, 'im').test(out);
  } catch { return false; }
}

// Has the user registered Quasar as a browser (Settings › Default browser)?
async function isRegisteredBrowser() {
  if (process.platform !== 'win32') return false;
  try { await reg(['query', `HKCU\\Software\\Clients\\StartMenuInternet\\${CLIENT}\\shell\\open\\command`]); return true; } catch { return false; }
}

module.exports = { APP_ID, ICON, shellIcon, launchCommand, applyToWindow, ensureShortcuts, registerBrowser, isDefaultBrowser, isRegisteredBrowser, registryEntries, engineDir, activeEngine, setActiveEngine };
