// Power-user tools: the task manager (Shift+Esc) and memory limit, command chains,
// tab sleeping per Space (and sites that never sleep), folders for today's tabs (two
// levels), marking up screenshots, and videos saved to watch offline.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, dialog, nativeImage, shell: eShell } = require('electron');
const { UI, PRELOAD, ICON, uid, hostOf, copyImage } = require('./common');
const { siteOf } = require('../protection');

class PowerPart {
  // ------------------------------------------------------------ task manager
  openTaskManager() {
    if (this.tmWin && !this.tmWin.isDestroyed()) { this.tmWin.focus(); return this.tmWin; }
    const w = new BrowserWindow({ width: 760, height: 520, minWidth: 520, minHeight: 300, title: 'Quasar Task Manager', icon: ICON, autoHideMenuBar: true,
      backgroundColor: '#f6f4fb', webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
    w.loadFile(path.join(UI, 'taskmgr.html'));
    w.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') w.close(); });
    this.tmWin = w;
    w.on('closed', () => { this.tmWin = null; });
    return w;
  }

  // Every Quasar process: tabs (with their pages), Quasar's own windows, the GPU and helpers.
  taskList() {
    const metrics = app.getAppMetrics();
    const byPid = new Map(metrics.map(m => [m.pid, m]));
    const rows = [];
    const used = new Set();
    const mb = m => Math.round((m?.memory?.workingSetSize || 0) / 1024);
    const cpu = m => Math.round((m?.cpu?.percentCPUUsage || 0) * 10) / 10;
    for (const t of this.tabs.values()) {
      const wc = t.view?.webContents;
      if (!wc || wc.isDestroyed()) continue;
      const pid = wc.getOSProcessId();
      const m = byPid.get(pid);
      if (used.has(pid)) { const r = rows.find(x => x.pid === pid); if (r) r.title += ` + ${t.title || hostOf(t.url)}`; continue; }
      used.add(pid);
      const sp = this.spaceById(t.spaceId);
      rows.push({ id: t.id, pid, kind: 'Tab', title: t.title || hostOf(t.url) || 'New Tab', sub: `${sp ? `${sp.emoji || ''} ${sp.name}`.trim() : ''}${t.audible ? ' · playing sound' : ''}`, mem: mb(m), cpu: cpu(m), canEnd: true });
    }
    const sleeping = [...this.tabs.values()].filter(t => t.sleeping).length;
    for (const m of metrics) {
      if (used.has(m.pid)) continue;
      const kind = { Browser: 'Quasar', GPU: 'GPU', Utility: m.serviceName || m.name || 'Utility', Tab: 'Quasar page' }[m.type] || m.type;
      rows.push({ id: null, pid: m.pid, kind: m.type === 'Tab' ? 'Quasar' : 'System', title: m.type === 'Tab' ? 'Sidebar, extensions and Quasar’s own pages' : kind, sub: m.type === 'Browser' ? 'Main process' : '', mem: mb(m), cpu: cpu(m), canEnd: false });
    }
    const total = rows.reduce((n, r) => n + r.mem, 0);
    return { rows: rows.sort((a, b) => b.mem - a.mem), total, sleeping, limit: Number(this.st.settings.memLimitMB) || 0 };
  }

  taskAct(name, args = []) {
    switch (name) {
      case 'tm:list': return this.taskList();
      case 'tm:end': {
        const t = this.tabs.get(args[0]);
        const wc = t?.view?.webContents;
        if (!wc || wc.isDestroyed()) return false;
        // The tab then shows "This page crashed" with a Reload button. (Sandboxed page
        // processes can't be killed from outside, so the page is told to crash.)
        try { wc.forcefullyCrashRenderer(); } catch { /* ignore */ }
        setTimeout(() => {
          if (wc.isDestroyed() || wc.isCrashed() || t.crashed) return;
          try { if (!wc.debugger.isAttached()) wc.debugger.attach('1.3'); wc.debugger.sendCommand('Page.crash').catch(() => {}); } catch { /* ignore */ }
        }, 300);
        return true;
      }
      case 'tm:sleep': { const t = this.tabs.get(args[0]); return !!t && this.sleepTab(t); }
      case 'tm:show': { const t = this.tabs.get(args[0]); if (t) { this.show(t.id); this.win.focus(); } return true; }
      case 'tm:limit': this.st.settings.memLimitMB = Math.max(0, Math.min(65536, Number(args[0]) || 0)); this.persist(); this.push(); return this.taskList();
      case 'tm:close': return this.tmWin?.close();
    }
  }

  // Opera GX-style limit: when Quasar uses more memory than allowed, the tabs you used
  // least recently go to sleep (never the one on screen, or one playing sound).
  enforceMemoryLimit() {
    const limit = Number(this.st.settings.memLimitMB) || 0;
    if (!limit) return 0;
    const { rows, total } = this.taskList();
    let over = total - limit;
    if (over <= 0) return 0;
    const memOf = new Map(rows.filter(r => r.id).map(r => [r.id, r.mem]));
    const shown = new Set([...this.wins].flatMap(W => [W.activeTabId, ...(W.attached || [])]));
    const cands = [...this.tabs.values()].filter(t => !shown.has(t.id) && this.canSleep(t)).sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
    let n = 0;
    for (const t of cands) {
      if (over <= 0) break;
      this.sleepTab(t); n++;
      over -= memOf.get(t.id) || 60;
    }
    if (n && Date.now() - (this._memToast || 0) > 10 * 60e3) { this._memToast = Date.now(); this.toast(`Quasar was over its ${limit >= 1024 ? (limit / 1024).toFixed(1) + ' GB' : limit + ' MB'} memory limit, so ${n} tab${n === 1 ? '' : 's'} went to sleep.`); }
    return n;
  }

  // ---------------------------------------------------------- command chains
  // Several command bar commands in one go, with an optional shortcut. Record one
  // ("Record a command chain", run some commands, "Stop recording"), or build it in Settings.
  get chains() { return (this.st.chains ||= []); }

  startChainRecording() {
    this.recording = [];
    this.toast('Recording a command chain: run the commands you want (from the command bar or with their shortcuts), then choose “Stop recording” in the command bar.');
  }

  stopChainRecording() {
    const steps = this.recording || [];
    this.recording = null;
    if (!steps.length) return this.toast('Nothing was recorded.');
    const titles = new Map(this.commandActions().map(a => [a.id, a.title]));
    const c = { id: uid(), name: steps.map(s => titles.get(s) || s).join(' + ').slice(0, 60), steps: steps.slice(0, 20), keys: '' };
    this.chains.push(c);
    this.persist();
    this.toast(`Saved the chain “${c.name}”. Run it from the command bar, or give it a shortcut in Settings › Command chains.`);
    return c;
  }

  async runChain(id) {
    const c = this.chains.find(x => x.id === id);
    if (!c) return false;
    for (const step of c.steps) {
      if (step.startsWith('chain')) continue;
      try { await this.action(step); } catch { /* keep going */ }
      await new Promise(r => setTimeout(r, 250));
    }
    return true;
  }

  chainAct(op, arg = {}) {
    const { normalizeCombo, reservedCombo } = require('../shortcuts');
    if (op === 'list') return this.chains;
    if (op === 'actions') return this.commandActions().filter(a => !a.id.startsWith('chain') && !a.id.startsWith('space:')).map(a => ({ id: a.id, title: a.title }));
    const c = this.chains.find(x => x.id === arg.id);
    if (op === 'new') { const n = { id: uid(), name: 'New chain', steps: [], keys: '' }; this.chains.push(n); this.persist(); return this.chains; }
    if (!c) return this.chains;
    if (op === 'delete') this.st.chains = this.chains.filter(x => x !== c);
    if (op === 'update') {
      if (typeof arg.name === 'string') c.name = arg.name.trim().slice(0, 60) || c.name;
      if (Array.isArray(arg.steps)) c.steps = arg.steps.filter(s => typeof s === 'string' && !s.startsWith('chain')).slice(0, 20);
      if (typeof arg.keys === 'string') {
        const k = normalizeCombo(arg.keys);
        if (k) {
          const why = reservedCombo(k);
          if (why) return { error: why };
          if (this.shortcutMap().has(k)) return { error: `${k} is already used by another command (Settings › Keyboard shortcuts).` };
          for (const o of this.chains) if (o !== c && o.keys === k) o.keys = '';
        }
        c.keys = k;
      }
    }
    if (op === 'run') { this.runChain(c.id); return true; }
    this.persist();
    return this.chains;
  }

  chainForKey(combo) { return combo ? this.chains.find(c => c.keys === combo) : null; }

  // ------------------------------------------------- tab sleeping per Space
  sleepMinFor(t) {
    const sp = this.spaceById(t.spaceId);
    const own = sp && sp.sleepAfterMin != null && sp.sleepAfterMin !== '' ? Number(sp.sleepAfterMin) : null;
    if (own === 0) return 0;   // a Space set to "never" stays awake, even on battery
    const mins = own ?? Number(this.st.settings.sleepAfterMin ?? 10);   // default: 10 minutes (background tabs are most of Quasar's memory)
    return this.onBattery ? (mins ? Math.min(mins, 5) : 5) : mins;
  }

  neverSleeps(url) {
    const s = siteOf(hostOf(url) || '');
    return !!s && (this.st.neverSleep || []).includes(s);
  }

  toggleNeverSleep(host) {
    const s = siteOf(String(host || '').replace(/^www\./, ''));
    if (!s) return;
    const list = this.st.neverSleep ||= [];
    const on = !list.includes(s);
    this.st.neverSleep = on ? [...list, s] : list.filter(x => x !== s);
    this.persist();
    this.toast(on ? `${s} will stay awake (it won’t be put to sleep to save memory).` : `${s} can sleep again when it isn’t used.`);
    return on;
  }

  // ------------------------------------------------- folders for today's tabs
  // Two levels, like Vivaldi's tab stacks: folders, and folders inside them.
  groupsOf(spaceId) { const sp = this.spaceById(spaceId); return sp ? (sp.todayGroups ||= []) : []; }

  matesOf(tab) { return tab.splitId ? (this.splits.get(tab.splitId)?.tabIds || [tab.id]) : [tab.id]; }

  groupNew(tabId, title = 'New folder') {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.kind !== 'today') return null;
    const g = { id: uid(), title, open: true, parentId: null };
    this.groupsOf(tab.spaceId).push(g);
    this.groupAdd(tabId, g.id);
    this.win?.webContents.send('ui:group', { action: 'rename', id: g.id });
    return g;
  }

  groupAdd(tabId, gid) {
    const tab = this.tabs.get(tabId);
    const groups = tab && this.groupsOf(tab.spaceId);
    if (!tab || tab.kind !== 'today' || !groups.some(g => g.id === gid)) return;
    const list = this.order[tab.spaceId] || [];
    const mates = this.matesOf(tab);
    const inGroup = id => { let g = this.tabs.get(id)?.groupId; while (g) { if (g === gid) return true; g = groups.find(x => x.id === g)?.parentId; } return false; };
    const lastIdx = list.reduce((m, id, i) => (inGroup(id) && !mates.includes(id) ? i : m), -1);
    for (const id of mates) { const t = this.tabs.get(id); if (t) t.groupId = gid; }
    // Keep the folder's tabs together: move these right after its last tab.
    if (lastIdx >= 0) {
      const moving = list.filter(id => mates.includes(id));
      const anchor = list[lastIdx];
      const rest = list.filter(id => !mates.includes(id));
      rest.splice(rest.indexOf(anchor) + 1, 0, ...moving);
      this.order[tab.spaceId] = rest;
    }
    const g = groups.find(x => x.id === gid);
    if (g) g.open = true;
    this.changed();
  }

  groupRemove(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    for (const id of this.matesOf(tab)) { const t = this.tabs.get(id); if (t) delete t.groupId; }
    this.changed();
  }

  groupAct(op, gid, arg) {
    const sp = this.space;
    const groups = this.groupsOf(sp.id);
    const g = groups.find(x => x.id === gid);
    if (!g) return;
    const tabsIn = (id, deep = true) => [...this.tabs.values()].filter(t => t.spaceId === sp.id && (t.groupId === id || (deep && groups.some(c => c.parentId === id && c.id === t.groupId))));
    switch (op) {
      case 'toggle': g.open = !g.open; break;
      case 'rename': g.title = String(arg || '').trim().slice(0, 60) || g.title; break;
      case 'ungroup':   // its tabs and subfolders move up a level
        for (const t of tabsIn(gid, false)) { if (g.parentId) t.groupId = g.parentId; else delete t.groupId; }
        for (const c of groups) if (c.parentId === gid) c.parentId = g.parentId || null;
        sp.todayGroups = groups.filter(x => x !== g);
        break;
      case 'nest': {
        const p = groups.find(x => x.id === arg);
        if (!p || p.id === gid || p.parentId || groups.some(c => c.parentId === gid)) return this.toast('Folders go two levels deep: a folder that has folders inside can’t go into another one.');
        g.parentId = p.id; p.open = true;
        break;
      }
      case 'unnest': g.parentId = null; break;
      case 'close': return this.closeTabs(tabsIn(gid).map(t => t.id));
      case 'menu': return this.groupMenu(g, arg?.x || 0, arg?.y || 0);
    }
    this.changed();
  }

  groupMenu(g, x, y) {
    const groups = this.groupsOf(this.curSpaceId);
    const others = groups.filter(o => o.id !== g.id && !o.parentId);
    const hasKids = groups.some(c => c.parentId === g.id);
    Menu.buildFromTemplate([
      { label: g.title, enabled: false },
      { label: 'Rename…', click: () => this.win.webContents.send('ui:group', { action: 'rename', id: g.id }) },
      { label: 'Change Icon…', click: () => this.win.webContents.send('ui:group', { action: 'icon', id: g.id }) },
      { label: 'Put Inside Folder', visible: !hasKids && others.length > 0 && !g.parentId, submenu: others.map(o => ({ label: o.title, click: () => this.groupAct('nest', g.id, o.id) })) },
      { label: 'Move Out of Its Folder', visible: !!g.parentId, click: () => this.groupAct('unnest', g.id) },
      { type: 'separator' },
      { label: 'Ungroup (keep the tabs)', click: () => this.groupAct('ungroup', g.id) },
      { label: 'Close Tabs in Folder', click: () => this.groupAct('close', g.id) },
    ]).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  // Tabs and split rows (from viewModel) arranged into their folders.
  todayTree(spaceId, items) {
    const groups = this.groupsOf(spaceId);
    if (!groups.length) return items;
    const byId = new Map(groups.map(g => [g.id, g]));
    const nodes = new Map();
    const root = [];
    const ensure = gid => {
      if (nodes.has(gid)) return nodes.get(gid);
      const g = byId.get(gid);
      const parent = g.parentId && byId.has(g.parentId) ? ensure(g.parentId) : null;
      const n = { group: true, id: g.id, title: g.title, icon: g.icon || '', open: g.open !== false, depth: parent ? 1 : 0, children: [], count: 0, active: false };
      (parent ? parent.children : root).push(n);
      nodes.set(gid, n);
      return n;
    };
    for (const it of items) {
      if (it.groupId && byId.has(it.groupId)) {
        const n = ensure(it.groupId);
        n.children.push(it);
        for (let p = n; p; p = byId.get(p.id)?.parentId ? nodes.get(byId.get(p.id).parentId) : null) { p.count += it.split ? it.tabs.length : 1; if (it.active) p.active = true; }
      } else root.push(it);
    }
    return root;
  }

  // Folders with no tabs left go away.
  pruneGroups() {
    for (const sp of this.allSpaces || this.st.spaces) {
      if (!sp.todayGroups?.length) continue;
      const used = new Set([...this.tabs.values()].filter(t => t.spaceId === sp.id && t.groupId).map(t => t.groupId));
      let keep = sp.todayGroups.filter(g => used.has(g.id) || sp.todayGroups.some(c => c.parentId === g.id && used.has(c.id)));
      keep = keep.filter(g => !g.parentId || keep.some(p => p.id === g.parentId) || ((g.parentId = null), true));
      sp.todayGroups = keep;
    }
  }

  // ------------------------------------------------------ screenshot markup
  // Draw, highlight, box and blur on a screenshot, then copy or save it.
  openMarkup(file) {
    if (!file || !fs.existsSync(file)) return this.toast('That screenshot is gone.');
    if (this.muWin && !this.muWin.isDestroyed()) this.muWin.close();
    const img = nativeImage.createFromPath(file);
    const { width, height } = img.getSize();
    const w = new BrowserWindow({ width: Math.min(1280, Math.max(700, width + 40)), height: Math.min(900, Math.max(480, height + 120)), title: 'Mark up screenshot', icon: ICON,
      autoHideMenuBar: true, backgroundColor: '#2a2633', webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
    this.muWin = w;
    this.muFile = file;
    w.loadFile(path.join(UI, 'markup.html'));
    w.webContents.once('did-finish-load', () => w.webContents.send('markup:init', { src: img.toDataURL(), name: path.basename(file) }));
    w.on('closed', () => { this.muWin = null; });
    return w;
  }

  async markupAct(name, args = []) {
    const data = String(args[0] || '');
    const img = /^data:image\/png;base64,/.test(data) ? nativeImage.createFromDataURL(data) : null;
    switch (name) {
      case 'mu:copy': if (!img) return false; await copyImage(img); return true;
      case 'mu:save': {
        if (!img) return false;
        fs.writeFileSync(this.muFile, img.toPNG());
        this.toast('Marked-up screenshot saved.', { type: 'show-file', path: this.muFile });
        return this.muFile;
      }
      case 'mu:saveAs': {
        if (!img) return false;
        const r = await dialog.showSaveDialog(this.muWin, { defaultPath: this.muFile.replace(/\.png$/i, ' (marked up).png'), filters: [{ name: 'PNG image', extensions: ['png'] }] });
        if (r.canceled || !r.filePath) return null;
        fs.writeFileSync(r.filePath, img.toPNG());
        return r.filePath;
      }
      case 'mu:close': return this.muWin?.close();
    }
  }

  // ---------------------------------------------------- videos for offline
  // Like Brave Playlist: a video file the page plays is saved on this PC and listed
  // under Read Later › Saved videos. (Sites that stream in small pieces, like YouTube
  // and Netflix, can't be saved this way.)
  get videosDir() { return path.join(app.getPath('userData'), 'videos'); }

  async saveVideo(tab = this.active, src = null) {
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return this.toast('Open the page with the video first.');
    if (this.privateSpaces.has(tab.spaceId)) return this.toast('Videos aren’t saved from private windows.');
    let info = { src, poster: '', title: tab.title };
    if (!src) {
      try {
        info = await wc.executeJavaScript(`(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0];
          if (!v) return null; const s = v.currentSrc || v.src || (v.querySelector('source[src]') || {}).src || ''; return { src: s, poster: v.poster || '', title: document.title }; })()`);
      } catch { info = null; }
    }
    if (!info?.src) return this.toast('No video found on this page.');
    if (/^(blob|mediasource|data):/i.test(info.src)) return this.toast('This site streams its video in small pieces (like YouTube), so it can’t be saved for offline.');
    if (!/^https?:/i.test(info.src)) return this.toast('That video can’t be saved.');
    const id = uid();
    const ext = (/\.(mp4|webm|m4v|mov|ogv|ogg|mkv|mp3|m4a)(\?|$)/i.exec(info.src)?.[1] || 'mp4').toLowerCase();
    fs.mkdirSync(this.videosDir, { recursive: true });
    const file = path.join(this.videosDir, `${id}.${ext}`);
    const v = { id, title: (info.title || tab.title || hostOf(tab.url)).slice(0, 200), page: tab.url, src: info.src, file, size: 0, at: Date.now(), state: 'saving', spaceId: tab.spaceId };
    (this.st.videos ||= []).unshift(v);
    this.toast(`Saving “${v.title}” for offline…`);
    this.push();
    try {
      const res = await wc.session.fetch(info.src, { headers: { Referer: tab.url } });
      if (!res.ok || !res.body) throw new Error(`the server said ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (/mpegurl|dash\+xml/i.test(type)) throw new Error('it streams in pieces');
      const { Readable } = require('stream');
      const { pipeline } = require('stream/promises');
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
      v.size = fs.statSync(file).size;
      v.state = 'done';
      this.toast(`Saved “${v.title}” to watch offline (${(v.size / 1048576).toFixed(0)} MB). Find it under Read Later.`, null, [{ label: 'Show', act: ['ui:view', 'later'] }]);
    } catch (err) {
      v.state = 'failed';
      try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
      this.st.videos = this.st.videos.filter(x => x !== v);
      this.toast(`Couldn’t save the video: ${err.message}`);
    }
    this.changed();
    return v.state === 'done' ? v : null;
  }

  videoAct(op, id) {
    const v = (this.st.videos || []).find(x => x.id === id);
    if (!v) return;
    if (op === 'open') { if (!fs.existsSync(v.file)) return this.toast('That video file is gone.'); return this.newTab(pathToFileURL(v.file).href); }
    if (op === 'page') return this.newTab(v.page);
    if (op === 'show') return fs.existsSync(v.file) && eShell.showItemInFolder(v.file);
    if (op === 'delete') { try { fs.rmSync(v.file, { force: true }); } catch { /* ignore */ } this.st.videos = this.st.videos.filter(x => x !== v); this.changed(); }
  }

  videosViewModel() {
    const sp = this.space;
    if (sp.private) return [];
    return (this.st.videos || []).filter(v => v.state !== 'failed' && (!v.spaceId || this.sameProfile(v.spaceId, sp.id) || v.spaceId === sp.id))
      .map(v => ({ id: v.id, title: v.title, page: v.page, size: v.size, at: v.at, saving: v.state === 'saving' }));
  }
}

module.exports = PowerPart;
