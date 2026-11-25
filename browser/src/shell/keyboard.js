// Keyboard shortcuts (customisable; see shortcuts.js).
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { SHORTCUTS, comboOf, normalizeCombo, reservedCombo } = require('../shortcuts');
const { UI } = require('./common');

class KeyboardPart {
  // --------------------------------------------------------- keyboard
  // Every shortcut except the fixed ones (Ctrl+1–9, Esc) can be changed in
  // Settings › Keyboard shortcuts; st.settings.shortcuts holds the changes.
  shortcutKeys(id) {
    const own = this.st.settings.shortcuts?.[id];
    return Array.isArray(own) ? own : (SHORTCUTS.find(x => x.id === id)?.keys || []);
  }

  shortcutMap() {
    const sig = JSON.stringify(this.st.settings.shortcuts || {});
    if (this._keyMap?.sig === sig) return this._keyMap.map;
    const map = new Map();
    for (const sc of SHORTCUTS) for (const k of this.shortcutKeys(sc.id)) if (!map.has(k)) map.set(k, sc.id);
    this._keyMap = { sig, map };
    return map;
  }

  // Change one shortcut (keys = [] turns it off, null puts the default back).
  // A combination another command used moves to this one.
  setShortcut(id, keys) {
    if (!SHORTCUTS.some(x => x.id === id)) return { error: 'Unknown command.' };
    const all = this.st.settings.shortcuts ||= {};
    if (keys === null) { delete all[id]; this.persist(); return { ok: true }; }
    const clean = [...new Set((Array.isArray(keys) ? keys : [keys]).map(normalizeCombo).filter(Boolean))].slice(0, 3);
    for (const k of clean) {
      const why = reservedCombo(k);
      if (why) return { error: why };
    }
    const moved = [];
    for (const sc of SHORTCUTS) {
      if (sc.id === id) continue;
      const cur = this.shortcutKeys(sc.id);
      const left = cur.filter(k => !clean.includes(k));
      if (left.length !== cur.length) { all[sc.id] = left; moved.push(sc.label); }
    }
    all[id] = clean;
    this.persist();
    this.libUpdate();
    return { ok: true, moved };
  }

  // For the cheat sheet and Settings: groups of { id, label, keys, fixed }.
  shortcutList() {
    const groups = [];
    for (const sc of SHORTCUTS) {
      let g = groups.find(x => x.name === sc.group);
      if (!g) groups.push(g = { name: sc.group, items: [] });
      g.items.push({ id: sc.id, label: sc.label, keys: this.shortcutKeys(sc.id), defaults: sc.keys, custom: Array.isArray(this.st.settings.shortcuts?.[sc.id]) });
    }
    groups.push({ name: 'Fixed', items: [
      this.st.settings.ctrlNumber === 'tabs'
        ? { label: 'Go to tab 1–8 (Ctrl+9: the last tab)', keys: ['Ctrl+1 … 9'], fixed: true }
        : { label: 'Switch to Space 1–9', keys: ['Ctrl+1 … 9'], fixed: true },
      { label: 'Close Peek, the command bar or the screenshot picker', keys: ['Esc'], fixed: true },
      { label: 'Peek a link', keys: ['Shift+Click'], fixed: true },
      { label: 'Close a tab', keys: ['Middle-click'], fixed: true },
    ] });
    return groups;
  }

  onKey(e, input) {
    // Ctrl let go after Ctrl+Tab: the tab you landed on counts as the most recent one.
    if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta') && this.cur?.mruCycle) { this.endCycle(this.cur); return; }
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    const c = input.control || input.meta, a = input.alt;
    // A locked Space: only switching Space works until it's unlocked.
    if (this.overlayMode === 'lock') {
      if (c && !a && !input.shift && /^Digit[1-9]$/.test(input.code || '')) { const sp = this.visibleSpaces[Number(input.code.slice(5)) - 1]; if (sp) this.switchSpace(sp.id); e.preventDefault(); }
      else if (['next-space', 'prev-space'].includes(this.shortcutMap().get(comboOf(input)))) { this.runShortcut(this.shortcutMap().get(comboOf(input))); e.preventDefault(); }
      else if (c && /^[a-z]$/.test(k)) e.preventDefault();
      return;
    }
    // Fixed keys first.
    let hit = true;
    if (k === 'escape' && this.cur?.layerMode === 'shot') this.hideLayer();
    else if (k === 'escape' && this.cur?.peek && !this.overlayMode) this.closePeek();
    else if (k === 'escape' && this.overlayMode && this.overlayMode !== 'break') this.closeCommand();
    else if (c && !a && !input.shift && /^(Digit|Numpad)[1-9]$/.test(input.code || '')) this.ctrlNumber(Number(input.code.slice(-1)));
    else if (c && input.shift && a && k === 'i') this.win.webContents.toggleDevTools();   // Quasar's own UI (for development)
    else hit = false;
    if (!hit) {
      const combo = comboOf(input);
      const id = this.shortcutMap().get(combo);
      if (id) { hit = true; if (this.recording && SHORTCUT_ACTIONS[id] && id !== 'copy-url') this.recording.push(SHORTCUT_ACTIONS[id]); this.runShortcut(id); }
      else { const chain = this.chainForKey(combo); if (chain) { hit = true; this.runChain(chain.id); } }
    }
    if (hit) e.preventDefault();
  }

  runShortcut(id) {
    const wc = this.active?.view?.webContents;
    switch (id) {
      case 'command': return this.newTabAction();
      case 'url': return this.openCommand('url');
      case 'find': return this.openCommand('find');
      case 'close-tab': return this.closeTab();
      case 'reopen-tab': return this.reopenClosed();
      case 'next-tab': return this.cycleTab(1);
      case 'prev-tab': return this.cycleTab(-1);
      case 'tab-down': return this.cycleTab(1, { mru: false });
      case 'tab-up': return this.cycleTab(-1, { mru: false });
      case 'pin': return this.pinTab();
      case 'split': return this.active && this.openCommand('split');
      case 'new-window': return this.newWindow();
      case 'private-window': return this.newWindow({ private: true });
      case 'close-window': return this.win?.close();
      case 'quit': return this.quitAll();
      case 'little': return this.openLittle();
      case 'toggle-sidebar': return this.toggleSidebar();
      case 'next-space': return this.cycleSpace(1);
      case 'prev-space': return this.cycleSpace(-1);
      case 'shortcuts': return this.openCommand('keys');
      case 'back': return wc?.navigationHistory.canGoBack() && wc.navigationHistory.goBack();
      case 'forward': return wc?.navigationHistory.canGoForward() && wc.navigationHistory.goForward();
      case 'reload': return this.reloadPage(wc);
      case 'hard-reload': return wc?.reloadIgnoringCache();
      case 'zoom-in': return this.zoom(1);
      case 'zoom-out': return this.zoom(-1);
      case 'zoom-reset': return this.zoom(0);
      case 'print': return this.print();
      case 'save-page': return this.savePage();
      case 'view-source': return this.viewSource();
      case 'reader': return this.openReader();
      case 'translate': return this.active && this.act(this.win.webContents, 'translate');
      case 'fullscreen': return this.toggleF11();
      case 'screenshot': return this.startScreenshot();
      case 'copy-url': return this.action('copy-url');
      case 'devtools': return wc?.toggleDevTools();
      case 'mute': return this.toggleMute();
      case 'play-pause': return this.mediaAct('toggle');
      case 'media-next': return this.mediaAct('next');
      case 'history': return this.openLibrary('history');
      case 'downloads': return this.openLibrary('downloads');
      case 'passwords': return this.openPasswords();
      case 'extensions': return this.openLibrary('extensions');
      case 'sleep-others': return this.sleepOtherTabs();
      case 'read-later': return this.saveReadLater(this.active);
      case 'zap': return this.startZap();
      case 'dark': return this.toggleSiteDark();
      case 'qr': return this.showQr();
      case 'compact': return this.toggleCompact();
      case 'notes': return this.win?.webContents.send('ui:view', 'notes');
      case 'tidy': return this.tidyTabs();
      case 'break': return this.startBreak(15);
      case 'find-tabs': return this.openCommand('tabs');
      case 'task-manager': return this.openTaskManager();
      case 'lock-now': return this.lockNow();
      case 'focus-cycle': return this.focusCycle(1);
      case 'focus-back': return this.focusCycle(-1);
      case 'caret': return this.toggleCaret();
      case 'read-aloud': return this.readAloud();
      case 'speed-up': return this.videoSpeed('up');
      case 'speed-down': return this.videoSpeed('down');
      case 'speed-normal': return this.videoSpeed(1);
      case 'clear-data': return this.clearBrowsingData();
      case 'reopen-window': return this.reopenClosedWindow();
    }
  }

  // Ctrl+1–9: Spaces (Arc) or, with Settings › General › Ctrl+number set to tabs, the
  // tabs in sidebar order like Chrome and Opera (Ctrl+9 = the last one).
  ctrlNumber(n) {
    if (this.st.settings.ctrlNumber !== 'tabs') { const sp = this.visibleSpaces[n - 1]; if (sp) this.switchSpace(sp.id); return; }
    const sp = this.space;
    const ids = [];
    const push = t => { if (t && !ids.includes(t.id)) ids.push(t.id); };
    for (const f of sp.favorites || []) push(this.liveTab('fav', f.id) || { id: 'fav:' + f.id });
    for (const id of this.order[sp.id] || []) push(this.tabs.get(id));
    const pick = n === 9 ? ids[ids.length - 1] : ids[n - 1];
    if (!pick) return;
    if (pick.startsWith('fav:')) return this.openFavorite(pick.slice(4));
    this.show(pick);
  }

  // F6 (like Chrome): keyboard focus goes page › sidebar › top bar › page.
  focusCycle(dir = 1) {
    const ui = this.win?.webContents;
    if (!ui) return;
    if (ui.isFocused()) return ui.send('ui:f6', dir);   // the sidebar page moves its own focus, or hands it back
    ui.focus();
    ui.send('ui:focus', dir > 0 ? 'sidebar' : 'toolbar');
  }

  // F7 (like Chrome): caret browsing, asked about the first time.
  toggleCaret() {
    const on = !this.st.settings.caretBrowsing;
    if (on && !this.st.settings.caretAsked) {
      const { dialog } = require('electron');
      const r = dialog.showMessageBoxSync(this.win, { type: 'question', buttons: ['Turn on', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
        message: 'Turn on caret browsing?', detail: 'A text cursor appears on the page; move it with the arrow keys and hold Shift to select. Press Enter on a link to open it. F7 turns it off.' });
      if (r !== 0) return;
      this.st.settings.caretAsked = true;
    }
    this.st.settings.caretBrowsing = on;
    this.persist();
    const { webContents } = require('electron');
    for (const id of this.pageTabs.keys()) { const wc = webContents.fromId(id); if (wc && !wc.isDestroyed()) wc.send('arch:caret', on); }
    this.toast(on ? 'Caret browsing is on (F7 turns it off).' : 'Caret browsing is off.');
  }
}

// Shortcuts that are also command bar commands (so a recorded chain can replay them).
const SHORTCUT_ACTIONS = { 'toggle-sidebar': 'toggle-sidebar', pin: 'pin', 'new-window': 'new-window', 'private-window': 'private-window', little: 'little', 'reopen-tab': 'reopen',
  'copy-url': 'copy-url', 'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', 'zoom-reset': 'zoom-reset', fullscreen: 'fullscreen', screenshot: 'screenshot', reader: 'reader',
  'read-later': 'read-later', zap: 'zap', dark: 'dark', qr: 'qr', compact: 'compact', notes: 'notes', tidy: 'tidy', mute: 'mute', 'play-pause': 'play-pause',
  history: 'history', downloads: 'downloads', passwords: 'passwords', extensions: 'extensions', 'sleep-others': 'sleep-others', 'find-tabs': 'find-tabs',
  'task-manager': 'task-manager', 'clear-data': 'clear-data', 'reopen-window': 'reopen-window', 'lock-now': 'lock-now', caret: 'caret', 'read-aloud': 'read-aloud', split: 'split', translate: 'translate', print: 'print' };

module.exports = KeyboardPart;
