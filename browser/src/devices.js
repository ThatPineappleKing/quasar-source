// Hardware access for web pages: USB (WebUSB), serial ports (Web Serial), HID
// devices (WebHID) and Bluetooth (Web Bluetooth). Used by firmware flashers,
// microcontroller IDEs, 3D printers, game-controller tools and similar sites.
//
// When a page asks (navigator.usb.requestDevice() etc.), Electron hands Quasar the
// list of matching devices and Quasar shows a small chooser window, like Chrome's.
// The site only ever gets the one device you pick. A device you picked stays
// allowed for that site in that profile until you remove it (Site settings), except
// in private windows, where it's forgotten when the window closes.

const path = require('path');
const { BrowserWindow, dialog } = require('electron');

const KIND = {
  usb: { title: 'USB device', verb: 'connect to a USB device' },
  serial: { title: 'serial port', verb: 'connect to a serial port' },
  hid: { title: 'HID device', verb: 'connect to a HID device' },
  bluetooth: { title: 'Bluetooth device', verb: 'pair with a Bluetooth device' },
};

const hex = n => (typeof n === 'number' ? n.toString(16).padStart(4, '0') : '');

class Devices {
  constructor(shell) {
    this.shell = shell;
    this.choosers = new Map();   // chooser window webContents id -> chooser
    this.btChoosers = new Map(); // page webContents id -> chooser (Bluetooth sends its list many times)
  }

  get grants() { return (this.shell.st.deviceGrants ||= {}); }   // "partition|origin|kind" -> [device keys]

  // A stable key per device, so "allowed" survives unplugging and restarting.
  static key(kind, d) {
    if (kind === 'usb') return `${hex(d.vendorId)}:${hex(d.productId)}:${d.serialNumber || ''}`;
    if (kind === 'hid') return `${hex(d.vendorId)}:${hex(d.productId)}:${d.name || ''}`;
    if (kind === 'serial') return d.serialNumber ? `${hex(Number(d.vendorId))}:${hex(Number(d.productId))}:${d.serialNumber}` : `port:${d.portName || d.portId}`;
    return d.deviceId;
  }

  static label(kind, d) {
    if (kind === 'usb') return { name: d.productName || 'USB device', sub: [d.manufacturerName, `ID ${hex(d.vendorId)}:${hex(d.productId)}`, d.serialNumber && `serial ${d.serialNumber}`].filter(Boolean).join(' · ') };
    if (kind === 'hid') return { name: d.name || 'HID device', sub: `ID ${hex(d.vendorId)}:${hex(d.productId)}` };
    if (kind === 'serial') return { name: d.displayName || d.portName || 'Serial port', sub: [d.portName, d.vendorId && `ID ${hex(Number(d.vendorId))}:${hex(Number(d.productId))}`].filter(Boolean).join(' · ') };
    return { name: d.deviceName || 'Unknown device', sub: d.deviceId };
  }

  // Called for every web session (from Shell.setupSession).
  setupSession(ses, partition) {
    const priv = () => [...this.shell.privateSpaces.values()].some(s => s.partition === partition);
    const originOf = (details, wc) => {
      try { return new URL(details?.origin || details?.securityOrigin || details?.frame?.url || wc?.getURL()).origin; } catch { return ''; }
    };
    // Choosers. Electron gives the list now and tells us when devices come and go.
    ses.on('select-usb-device', (e, details, cb) => { e.preventDefault(); this.choose(ses, partition, 'usb', details.deviceList, cb, details.frame, originOf(details, null)); });
    ses.on('select-hid-device', (e, details, cb) => { e.preventDefault(); this.choose(ses, partition, 'hid', details.deviceList, cb, details.frame, originOf(details, null)); });
    ses.on('select-serial-port', (e, portList, wc, cb) => { e.preventDefault(); this.choose(ses, partition, 'serial', portList, cb, wc?.mainFrame, originOf(null, wc), wc); });
    for (const [ev, kind, add] of [['usb-device-added', 'usb', true], ['usb-device-removed', 'usb', false], ['hid-device-added', 'hid', true], ['hid-device-removed', 'hid', false],
      ['serial-port-added', 'serial', true], ['serial-port-removed', 'serial', false]]) {
      ses.on(ev, (e, a, b) => {
        const dev = kind === 'serial' ? a : (a?.device || a);
        const id = kind === 'usb' ? dev?.deviceId : kind === 'hid' ? dev?.deviceId : dev?.portId;
        for (const c of this.choosers.values()) if (c.ses === ses && c.kind === kind) c.update(add ? [...c.list.filter(x => x.id !== id), this.item(kind, dev)] : c.list.filter(x => x.id !== id));
      });
    }
    // Remembered choices.
    ses.setDevicePermissionHandler(details => {
      const kind = details.deviceType;
      if (!KIND[kind]) return false;
      const list = this.grants[`${partition}|${details.origin}|${kind}`] || [];
      return list.includes(Devices.key(kind, details.device));
    });
    // The site may *ask*; the chooser decides what it gets. (Private windows too.)
    ses.__archDeviceCheck = (perm) => ['usb', 'serial', 'hid', 'bluetooth'].includes(perm);
    // Bluetooth pairing (PIN or confirm).
    try {
      ses.setBluetoothPairingHandler((details, cb) => this.pair(details, cb));
    } catch { /* not on this platform */ }
    this.priv = priv;
  }

  item(kind, d) {
    const id = kind === 'serial' ? d.portId : d.deviceId;
    return { id, key: Devices.key(kind, d), ...Devices.label(kind, d) };
  }

  // Web Bluetooth: the page's webContents gets the event, repeatedly while scanning.
  setupPage(wc) {
    wc.on('select-bluetooth-device', (e, list, cb) => {
      e.preventDefault();
      const items = (list || []).map(d => this.item('bluetooth', d));
      const open = this.btChoosers.get(wc.id);
      if (open && !open.done) { open.cb = cb; return open.update(items); }
      let origin = '';
      try { origin = new URL(wc.getURL()).origin; } catch { /* ignore */ }
      const c = this.choose(wc.session, wc.session.__archPartition, 'bluetooth', [], cb, wc.mainFrame, origin, wc, items);
      if (c) { this.btChoosers.set(wc.id, c); c.onDone = () => this.btChoosers.delete(wc.id); }
    });
  }

  // Show the chooser. cb(id) gives the site that device; cb() (or '' for Bluetooth) refuses.
  choose(ses, partition, kind, rawList, cb, frame, origin, wc = null, items = null) {
    const S = this.shell;
    const pageWc = wc || (frame && require('electron').webContents.getAllWebContents().find(w => !w.isDestroyed() && w.mainFrame === frame)) || null;
    const tab = pageWc ? S.pageTabs.get(pageWc.id) : null;
    const parent = S.windowFor(tab, pageWc);
    const host = (() => { try { return new URL(origin).host; } catch { return origin || 'This site'; } })();
    const c = {
      kind, ses, cb, done: false, origin, partition, list: items || (rawList || []).map(d => this.item(kind, d)), win: null, onDone: null,
      update: list => { c.list = list; if (c.win && !c.win.isDestroyed()) c.win.webContents.send('chooser:list', c.view()); },
      view: () => ({ kind, title: KIND[kind].title, host, verb: KIND[kind].verb, list: c.list.map(({ id, name, sub }) => ({ id, name, sub })), scanning: kind === 'bluetooth' }),
      finish: id => {
        if (c.done) return;
        c.done = true;
        const hit = c.list.find(x => x.id === id);
        if (hit && kind !== 'bluetooth') {
          const k = `${partition}|${origin}|${kind}`;
          const g = this.grants;
          g[k] = [...new Set([...(g[k] || []), hit.key])];
          if (!this.isPrivate(partition)) S.persist();
        }
        // Refusing: Bluetooth and serial take an empty string, USB and HID no argument.
        try { if (hit) c.cb(hit.id); else if (kind === 'bluetooth' || kind === 'serial') c.cb(''); else c.cb(); } catch { /* the page went away */ }
        if (c.win && !c.win.isDestroyed()) c.win.destroy();
        c.onDone?.();
      },
    };
    c.win = new BrowserWindow({
      width: 460, height: 420, minWidth: 360, minHeight: 280, parent: parent && !parent.isDestroyed() ? parent : undefined, modal: false,
      title: `Connect a ${KIND[kind].title}`, autoHideMenuBar: true, show: false, resizable: true, minimizable: false, maximizable: false,
      backgroundColor: '#F7F5FC', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    c.win.setMenu(null);
    c.win.loadFile(path.join(__dirname, '..', 'ui', 'chooser.html'));
    c.win.once('ready-to-show', () => c.win.show());
    const id = c.win.webContents.id;
    this.choosers.set(id, c);
    c.win.on('closed', () => { this.choosers.delete(id); c.finish(null); });
    // The page navigated away or closed: nothing to connect to any more.
    if (pageWc) {
      const gone = () => { if (!c.done) c.finish(null); };
      pageWc.once('destroyed', gone);
      pageWc.once('did-start-navigation', (e) => { if (e?.isMainFrame !== false && !e?.isSameDocument) gone(); });
    }
    return c;
  }

  isPrivate(partition) { return [...this.shell.privateSpaces.values()].some(s => s.partition === partition); }

  // From the chooser window.
  act(sender, name, args) {
    const c = this.choosers.get(sender.id);
    if (!c) return null;
    if (name === 'chooser:init') return c.view();
    if (name === 'chooser:pick') return c.finish(String(args[0] || ''));
    if (name === 'chooser:cancel') return c.finish(null);
    return null;
  }

  async pair(details, cb) {
    const S = this.shell;
    const win = S.win;
    const name = details.deviceId;
    if (details.pairingKind === 'confirm') {
      const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: ['Pair', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true, message: `Pair with Bluetooth device ${name}?` });
      return cb({ confirmed: response === 0 });
    }
    if (details.pairingKind === 'confirmPin') {
      const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: ['Pair', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true, message: `Does the device show the PIN ${details.pin}?` });
      return cb({ confirmed: response === 0 });
    }
    if (details.pairingKind === 'providePin') {
      const { promptLogin } = require('./auth-prompt');
      const r = await promptLogin(win, { host: name, origin: 'Bluetooth pairing', realm: 'Enter the PIN shown on (or printed on) the device', isProxy: false, insecure: false, pinOnly: true });
      return cb(r?.password ? { confirmed: true, pin: r.password } : { confirmed: false });
    }
    cb({ confirmed: false });
  }

  // For Site settings: devices a site may use, and forgetting them.
  siteDevices(partition) {
    const out = [];
    for (const [k, list] of Object.entries(this.grants)) {
      const [part, origin, kind] = k.split('|');
      if (part === partition && list.length) out.push({ key: k, origin, kind, count: list.length, label: `${KIND[kind]?.title || kind}${list.length > 1 ? `s (${list.length})` : ''}` });
    }
    return out;
  }
  forget(key) { delete this.grants[key]; this.shell.persist(); }
  dropPartition(partition) { for (const k of Object.keys(this.grants)) if (k.startsWith(partition + '|')) delete this.grants[k]; }
}

module.exports = { Devices };
