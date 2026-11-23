// Quasar window UI: sidebar, top bar, empty-state card. All browser logic lives
// in the main process; this page renders the state it sends and forwards clicks.
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

  const ICON = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 3H6l4-3-1-6zM12 13v7"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    muted: '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5"/></svg>',
  };
  // Speaker button on a row whose tab is playing sound (click to mute/unmute).
  const audioBtn = t => (t.muted ? `<button class="audio on" data-a="mute" title="Unmute tab">${ICON.muted}</button>`
    : t.audible ? `<button class="audio" data-a="mute" title="Mute tab">${ICON.sound}</button>` : '');

  let S = null;              // latest state from main
  let view = 'main';
  let drag = null;           // { kind: 'tab'|'pinned', id }
  let lastSpaceIdx = -1;
  let editingFor = null;
  let liveTheme = null;      // colours being dragged in the theme picker, before they're saved

  // favicon with a letter fallback
  function ico(fav, url, title) {
    const letter = esc((host(url) || title || '?').charAt(0).toUpperCase());
    if (!fav) return `<span class="ico">${letter}</span>`;
    return `<span class="ico has-img"><img src="${esc(fav)}" alt="" data-letter="${letter}"></span>`;
  }
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.letter) {
      const span = img.parentElement; span.classList.remove('has-img'); span.textContent = img.dataset.letter;
    }
  }, true);

  // ------------------------------------------------------------ render
  // State arrives on every page-load event, so only touch the parts of the
  // DOM whose data actually changed (rebuilding everything forced a full
  // repaint of the gradient + grain and re-decoded every favicon).
  const last = {};
  const changed = (key, val) => {
    const s = JSON.stringify(val);
    if (key in last && last[key] === s) return false;   // (a value that was never set still draws once)
    last[key] = s;
    return true;
  };
  const setHTML = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };
  const RELOAD_SVG = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>';
  // Site security icons for the address pill.
  const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const WARN = '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>';
  const INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>';
  const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>';
  const SEC_ICON = { secure: LOCK, warning: WARN, danger: WARN, insecure: INFO, local: INFO, none: SEARCH };

  function render() {
    if (!S) return;
    const colors = liveTheme?.spaceId === S.space.id ? liveTheme.colors : S.space.colors;
    if (changed('theme', [colors, S.space.grain])) {
      ArchTheme.apply(document.documentElement, { ...S.space, colors });
      $('fThemePreview').style.background = `linear-gradient(135deg, ${colors.join(', ')})`;
    }
    renderAppearance();

    // top bar
    const a = S.active;
    $('back').disabled = !a?.canBack;
    $('forward').disabled = !a?.canForward;
    setHTML($('reload'), a?.loading ? ICON.close : RELOAD_SVG);
    document.body.classList.toggle('inapp', !!S.inapp);   // no tab looks selected while Library is open
    const urlText = S.inapp ? ({ library: 'Library', passwords: 'Passwords', settings: 'Settings' }[S.inapp] || 'Quasar')
      : a ? urlLabel(a) : 'Search or Enter URL…';
    if ($('urlText').textContent !== urlText) $('urlText').textContent = urlText;
    $('urlText').classList.toggle('muted', !a);
    const sec = a ? (a.security || 'local') : 'none';
    if (changed('sec', sec)) {
      const si = $('siteInfo');
      si.className = 'site-ico ' + sec;
      si.disabled = !a;
      si.innerHTML = (SEC_ICON[sec] || SEC_ICON.local) + (['insecure', 'warning', 'danger'].includes(sec) ? '<span class="sec-label">Not secure</span>' : '');
      si.title = { secure: 'Connection is secure — view site information', warning: 'Not secure: certificate error ignored', danger: 'Your connection isn’t private',
        insecure: 'Not secure — view site information', local: 'View site information', none: 'Site information' }[sec];
    }
    if (changed('max', S.maximized)) $('wMax').innerHTML = S.maximized
      ? '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="11" height="11" rx="1.5"/><path d="M8 8V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
    $('nt').hidden = !!a;
    renderFocus(!a);
    if (!a) renderStart();
    // Reader mode and translation buttons in the address pill.
    $('readerBtn').hidden = !a || !(a.readerable || a.reading);
    $('readerBtn').classList.toggle('on', !!a?.reading);
    $('readerBtn').title = a?.reading ? 'Leave reader mode (F9)' : 'Reader mode (F9)';
    $('transBtn').hidden = !a || !(a.foreign || a.translated || a.translating);
    $('transBtn').classList.toggle('on', !!a?.translated);
    $('transBtn').classList.toggle('busy', !!a?.translating);
    $('transBtn').title = a?.translating ? 'Translating on this PC…' : a?.translated ? 'Show the original page' : a?.foreign ? `This page is in ${a.foreign}: translate it` : 'Translate';
    // Extension buttons (<browser-action-list> comes from electron-chrome-extensions).
    const ex = S.ext || {};
    const showExt = ex.count > 0 && !!ex.partition;
    $('extBtn').hidden = !(ex.partition);
    $('extBar').hidden = !showExt;
    if (showExt && customElements.get('browser-action-list')) {
      let list = $('extBar').querySelector('browser-action-list');
      if (!list) { list = document.createElement('browser-action-list'); list.setAttribute('alignment', 'bottom left'); $('extBar').append(list); }
      if (list.getAttribute('partition') !== ex.partition) list.setAttribute('partition', ex.partition);
      if (list.getAttribute('tab') !== String(ex.tab)) list.setAttribute('tab', String(ex.tab));
    }
    // Shield: how many ads/trackers were blocked on this page (click for the site panel).
    const sh = $('shield');
    const nb = a?.blocked || 0;
    sh.hidden = !a || (!nb && !a.adsAllowed);
    const shTxt = a?.adsAllowed ? 'off' : String(nb);
    if (sh.dataset.n !== shTxt) { sh.dataset.n = shTxt; sh.innerHTML = ArchIcons.svg('shield') + shTxt; }
    sh.title = a?.adsAllowed ? 'Ad and tracker blocking is off on this site' : `${nb} ad${nb === 1 ? '' : 's'} and tracker${nb === 1 ? '' : 's'} blocked on this page`;
    // VPN button (Opera-style): grey when off, coloured when on.
    const vp = S.vpn || {};
    // Update button: a new Quasar is out (click to get it), downloading, or ready (click to restart into it).
    const up = S.update || {};
    const upPct = up.progress?.total ? Math.round(up.progress.received / up.progress.total * 100) : null;
    const upState = up.pendingRestart ? 'ready' : up.progress ? 'downloading' : up.available ? 'available' : '';
    const ub = $('updBtn');
    ub.hidden = !upState;
    ub.classList.toggle('busy', upState === 'downloading');
    const upLabel = upState === 'ready' ? 'Restart to update' : upState === 'downloading' ? `Updating${upPct != null ? ` ${upPct}%` : '…'}` : 'Update';
    if ($('updText').textContent !== upLabel) $('updText').textContent = upLabel;
    const upVer = up.pendingRestart || up.progress?.version || up.available || '';
    ub.title = upState === 'ready' ? `Quasar ${upVer} is ready. Click to restart and install it (or it installs when you close Quasar).`
      : upState === 'downloading' ? `Downloading Quasar ${upVer}…` : `Quasar ${upVer} is available. Click to update.`;
    $('vpnBtn').hidden = !vp.show && !vp.on;
    $('vpnBtn').classList.toggle('on', !!vp.on);
    $('vpnBtn').classList.toggle('busy', !!vp.busy);
    $('vpnBtn').title = vp.busy ? `VPN: ${vp.busy}` : vp.on ? `VPN on (Cloudflare WARP)${vp.where ? ` · sites see you in ${vp.where}` : ''} · click for details` : 'VPN off · click to turn it on (free, Cloudflare WARP)';
    // Zoom indicator (only when not 100%) and downloads button.
    const zp = $('zoomPill');
    const z = a?.zoom || 100;
    zp.hidden = !a || z === 100;
    if (!zp.hidden && zp.textContent !== z + '%') zp.textContent = z + '%';
    const d = S.downloads || {};
    $('dlBtn').hidden = !d.show;
    $('dlBtn').classList.toggle('busy', d.running > 0);
    $('dlRing').style.setProperty('--p', d.progress < 0 ? 0.25 : Math.max(0.02, d.progress || 0));
    $('dlBtn').title = d.running ? `Downloading ${d.running} file${d.running > 1 ? 's' : ''} (Ctrl+J)` : 'Downloads (Ctrl+J)';
    if (changed('priv', S.private)) {
      document.body.classList.toggle('private', !!S.private);
      $('privateNote').hidden = !S.private;
      for (const id of ['addSpace', 'fDelete']) $(id).hidden = !!S.private;
    }

    if (changed('head', [S.space.emoji, S.space.name])) {
      $('emptyTitle').textContent = `${S.space.emoji || ''} ${S.space.name}`.trim();
      $('spaceEmoji').textContent = S.space.emoji || '+';
      $('spaceEmoji').classList.toggle('empty', !S.space.emoji);
      $('spaceTitle').textContent = S.space.name;
    }
    if (changed('media', S.media)) renderMedia();
    if (changed('panels', S.panels)) renderPanels();
    if (changed('sbExtra', S.sbExtra)) renderSbExtra();
    if (changed('split', S.split)) renderSplit();
    if (changed('favs', S.favorites)) renderFavorites();
    if (changed('pinned', S.pinned)) renderPinned();
    if (changed('today', S.today)) renderToday();
    if (changed('spaces', [S.spaces, S.space.id])) renderSpaces();
    if (view === 'archive') renderArchive();
    if (view === 'edit') { renderEditor(); renderEditorProfile(); }
    if (view === 'notes' && changed('notes', S.notes)) renderNotes();
    if (view === 'later' && changed('later', S.readLater)) renderLater();
    if (view === 'later' && changed('videos', S.videos)) renderVideos();
    const unreadLater = (S.readLater || []).filter(r => !r.read).length;
    $('laterCount').hidden = !unreadLater;
    $('laterCount').textContent = unreadLater > 99 ? '99+' : String(unreadLater);
    $('notesBtn').hidden = $('laterBtn').hidden = !!S.private;
    for (const v of ['main', 'edit', 'archive', 'new', 'notes', 'later']) $('v-' + v).hidden = view !== v;
    syncPanel();

    const idx = S.spaces.findIndex(s => s.id === S.space.id);
    if (lastSpaceIdx !== -1 && idx !== lastSpaceIdx) {
      const el = $('v-main');
      el.classList.remove('swipe-l', 'swipe-r'); void el.offsetWidth;
      el.classList.add(idx > lastSpaceIdx ? 'swipe-l' : 'swipe-r');
    }
    lastSpaceIdx = idx;
  }

  // ------------------------------------------------- customisation
  // Settings › Appearance / Top bar / Sidebar. Applied as CSS variables and body
  // classes; the main process places the pages to match (src/shell/appearance.js).
  function urlLabel(a) {
    const mode = S.settings.urlDisplay || 'domain';
    if (mode === 'title') return a.title || a.host || a.url || 'New Tab';
    if (mode === 'full') return (a.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || 'New Tab';
    return a.host || a.url || 'New Tab';
  }
  function renderAppearance() {
    const st = S.settings, hid = S.hidden || {};
    const side = ['right', 'top'].includes(st.sidebarSide) ? st.sidebarSide : 'left';
    const b = document.body.classList, root = document.documentElement;
    if (changed('ui', [st.accent, st.uiFont, st.uiFontSize, st.radius, st.blur, st.transparency, st.density, S.layout?.top, S.strip, S.sbW, st.sidebarWidth])) {
      ArchTheme.ui(root, st);
      root.style.setProperty('--top', (S.layout?.top || 44) + 'px');
      root.style.setProperty('--strip', (S.strip || 44) + 'px');
      root.style.setProperty('--sb', (S.sbW || st.sidebarWidth) + 'px');
    }
    b.toggle('sb-hidden', !!st.sidebarHidden);
    b.toggle('sb-right', side === 'right');
    b.toggle('sb-top', side === 'top');
    b.toggle('sb-collapsed', !!st.sbCollapsed && side !== 'top');
    b.toggle('sb-expanded', !!S.sbPanel);
    b.toggle('top-off', !!hid.top);
    b.toggle('sb-off', !!hid.sb);
    b.toggle('chrome-peek', !!S.autoHide && !!S.chromeShown);
    for (const t of ['icon', 'title']) b.toggle('tabs-' + t, st.tabStyle === t);
    for (const d of ['compact', 'comfortable']) b.toggle('dens-' + d, st.density === d);
    // edges that bring hidden bars back
    $('edgeS').hidden = !(hid.sb && side !== 'top' && !st.sidebarHidden);
    $('edgeT').hidden = !(hid.top || (hid.sb && side === 'top' && !st.sidebarHidden));
    // The top bar keeps the sidebar toggle when the sidebar's own top row isn't there.
    $('showSidebar').hidden = !st.sidebarHidden && side === 'left' && !hid.sb;
    $('showSidebar').title = st.sidebarHidden ? 'Show sidebar (Ctrl+S)' : 'Hide sidebar (Ctrl+S)';
    // top bar colour / transparency
    if (changed('tbColor', [st.tbColor, st.tbOpacity])) {
      const tb = $('topbar');
      if (st.tbColor) {
        const op = st.tbOpacity ?? 0.6;
        tb.style.setProperty('--tb-bg', `color-mix(in srgb, ${st.tbColor} ${Math.round(op * 100)}%, transparent)`);
        tb.classList.add('tinted');
        // Readable text on a strong tint.
        if (op >= 0.5) tb.dataset.ink = ArchTheme.isDark([st.tbColor]) ? 'light' : 'dark'; else delete tb.dataset.ink;
      } else { tb.style.removeProperty('--tb-bg'); tb.classList.remove('tinted'); delete tb.dataset.ink; }
    }
    // toolbar buttons: left of the address, right of it, or hidden
    const tbl = S.toolbar || { left: ['back', 'forward', 'reload'], right: ['ext', 'copyUrl'] };
    if (changed('toolbar', tbl)) {
      const el = id => document.querySelector(`#topbar [data-tb="${id}"]`);
      for (const n of document.querySelectorAll('#topbar [data-tb]')) $('tbPool').append(n);
      for (const id of tbl.left) { const n = el(id); if (n) $('tbLeft').append(n); }
      for (const id of tbl.right) { const n = el(id); if (n) $('tbRight').append(n); }
    }
    const pn = (S.profileName || '?').trim();
    if ($('profileInitial').textContent !== pn.charAt(0).toUpperCase()) $('profileInitial').textContent = pn.charAt(0).toUpperCase();
    $('profileBtn').title = `Profile: ${pn} · Space: ${S.space.name}\nClick to switch Space or profile`;
    $('homeBtn').title = st.homeUrl ? `Home: ${st.homeUrl}` : 'Home (start page)';
    // sidebar sections
    const sec = { favorites: true, pinned: true, folders: true, ...(st.sbSections || {}) };
    $('favorites').classList.toggle('off', !sec.favorites);
    $('pinned').classList.toggle('off', !sec.pinned);
    document.querySelector('#v-main .divider').classList.toggle('off', !sec.pinned);
    if (changed('secs', [sec.folders])) { last.pinned = null; last.today = null; }
    chromeShownChanged();
    placeToast();
  }

  // Where toasts show. Normally at the bottom of the sidebar; when the sidebar has no
  // room (icons only, hidden, or on top with buttons to show) they float in the top
  // bar instead, so the page doesn't get pushed aside every time one appears.
  const toastHome = { parent: $('toast').parentNode, next: $('toast').nextSibling };
  function toastInBar() {
    if (!S) return false;
    const st = S.settings, hid = S.hidden || {};
    const side = ['right', 'top'].includes(st.sidebarSide) ? st.sidebarSide : 'left';
    if (hid.top) return false;   // no top bar on screen: the sidebar makes room instead (see syncPanel)
    const btns = !!$('toast').querySelector('.toast-btns');
    return !!st.sidebarHidden || !!hid.sb || (!!st.sbCollapsed && side !== 'top' && !S.sbPanel) || (side === 'top' && btns);
  }
  function placeToast() {
    const t = $('toast');
    const bar = toastInBar();
    if (bar && t.parentNode !== document.body) document.body.append(t);
    else if (!bar && t.parentNode !== toastHome.parent) toastHome.parent.insertBefore(t, toastHome.next);
    t.classList.toggle('in-bar', bar);
  }
  const showFolders = () => (S.settings.sbSections || {}).folders !== false;

  // The icon-only sidebar and the sidebar on top have no room for the Space editor,
  // notes, pickers and long toasts, so the window makes room while one is open.
  function syncPanel() {
    if (!S) return;
    const st = S.settings;
    const small = st.sidebarSide === 'top' || !!st.sbCollapsed;
    // Toasts only need room when the top bar is hidden (otherwise they show in it).
    const toastNeeds = !$('toast').hidden && !!S.hidden?.top && (!!st.sbCollapsed && st.sidebarSide !== 'top' || !!$('toast').querySelector('.toast-btns'));
    const need = small && !st.sidebarHidden && (view !== 'main' || !$('emojiPicker').hidden || !$('themePicker').hidden || toastNeeds);
    if (need !== !!S.sbPanel && need !== syncPanel.asked) { syncPanel.asked = need; act('sbPanel', need); }
    if (need === !!S.sbPanel) syncPanel.asked = undefined;
  }

  // Recent downloads and history in the sidebar (Settings › Sidebar › Sections).
  function renderSbExtra() {
    const x = S.sbExtra || {};
    $('sbDl').hidden = !x.downloads;
    $('sbHist').hidden = !x.history;
    const none = t => [Object.assign(document.createElement('li'), { className: 'hint', textContent: t })];
    if (x.downloads) {
      $('sbDlList').replaceChildren(...(x.downloads.length ? x.downloads.map(d => {
        const li = rowEl({ title: d.name, url: d.url, loading: d.state === 'progressing' }, { tools: `<button data-a="show" title="Show in folder">${ICON.folder}</button>` });
        li.firstElementChild.title = d.name + (d.state === 'progressing' ? ' (downloading)' : d.state === 'completed' ? '\nClick to open' : `\n${d.state}`);
        li.firstElementChild.onclick = e => act('sbItem', e.target.closest('[data-a=show]') ? 'show' : 'open', d.id);
        return li;
      }) : none('No downloads yet.')));
    }
    if (x.history) {
      $('sbHistList').replaceChildren(...(x.history.length ? x.history.map(h => {
        const li = rowEl({ title: h.title, url: h.url });
        li.firstElementChild.onclick = () => act('nt', 'open', { url: h.url });
        return li;
      }) : none('Nothing yet.')));
    }
  }
  $('sbDlAll').onclick = () => act('library', 'downloads');
  $('sbHistAll').onclick = () => act('library', 'history');

  // ------------------------------------------------- start page (no tab open)
  const WMO = c => (c === 0 ? ['☀️', 'Clear'] : c <= 2 ? ['⛅', 'Partly cloudy'] : c === 3 ? ['☁️', 'Cloudy'] : c <= 48 ? ['🌫️', 'Fog']
    : c <= 57 ? ['🌦️', 'Drizzle'] : c <= 67 ? ['🌧️', 'Rain'] : c <= 77 ? ['🌨️', 'Snow'] : c <= 82 ? ['🌧️', 'Showers'] : c <= 86 ? ['🌨️', 'Snow showers'] : ['⛈️', 'Thunderstorm']);
  // Widgets that are on unless switched off: clock, date, greeting, shortcuts.
  const wOn = k => {
    const w = S.settings.ntWidgets || {};
    if (k === 'clock') return S.settings.focusClock !== false && w.clock !== false;
    return k in w ? !!w[k] : ['date', 'greeting', 'links'].includes(k);
  };
  function renderStart() {
    const st = S.settings;
    const pos = st.ntSearch || 'center';
    const slot = { top: 'ntTop', bottom: 'ntBottom', center: 'ntCenter' }[pos];
    if (slot && $('ntSearch').parentElement.id !== slot) $(slot).append($('ntSearch'));
    $('ntSearch').hidden = pos === 'hidden';
    const eng = st.ntEngine || st.searchEngine || 'Google';
    const ph = `Search ${eng} or type a web address`;
    if ($('ntQ').placeholder !== ph) $('ntQ').placeholder = ph;
    const nt = $('nt');
    nt.dataset.layout = st.ntLayout || 'custom';
    nt.style.setProperty('--nt-cols', st.ntCols || 6);
    nt.dataset.tile = st.ntTile || 'medium';
    $('emptyTitle').hidden = wOn('clock');
    $('emptyNew').hidden = pos !== 'hidden';
    if (changed('ntLinks', [st.ntLinks, wOn('links'), S.nt?.icons])) renderLinks();
    if (changed('ntWidgets', [st.ntWidgets, S.nt, st.ntUnit, st.ntPlace])) renderWidgets();
    const d = S.nt?.daily;
    const credit = st.bgChoice === 'daily' && d?.credit ? d.credit : '';
    $('ntCredit').hidden = !credit;
    if ($('ntCredit').textContent !== credit) $('ntCredit').textContent = credit;
  }
  $('ntSearch').onsubmit = e => { e.preventDefault(); const q = $('ntQ').value.trim(); if (q) { act('nt', 'search', { text: q }); $('ntQ').value = ''; } };
  $('ntQ').addEventListener('keydown', e => e.stopPropagation());
  $('ntCustom').onclick = () => act('nt', 'customize');

  // Quick links: click to open, drag to reorder, × to remove, + to add.
  let linkDrag = null, addingLink = false;
  function linkIcon(l) {
    const ic = (l.icon || '').trim();
    const letter = esc((l.title || host(l.url) || '?').charAt(0).toUpperCase());
    if (/^(https?:|data:image\/)/i.test(ic)) return `<span class="ico has-img"><img src="${esc(ic)}" alt="" data-letter="${letter}"></span>`;
    if (ic) return `<span class="ico nt-emoji">${esc(ic)}</span>`;
    // The site's icon if Quasar already has it (from a tab, pinned tab or Favorite), else its letter.
    const fav = S.nt?.icons?.[host(l.url)];
    return ico(fav || '', l.url, l.title);
  }
  function linksRedraw() { last.ntLinks = null; render(); }
  function renderLinks() {
    const box = $('ntLinks');
    box.hidden = !wOn('links');
    if (box.hidden) return;
    const links = S.settings.ntLinks || [];
    const tiles = links.map(l => {
      const a = document.createElement('div');
      a.className = 'nt-tile';
      a.draggable = true;
      a.tabIndex = 0;
      a.title = `${l.title}\n${l.url}\nDrag to move`;
      a.innerHTML = `<span class="nt-ico">${linkIcon(l)}</span><span class="nt-name">${esc(l.title)}</span><button class="nt-x" title="Remove shortcut">${ICON.close}</button>`;
      a.onclick = e => { if (e.target.closest('.nt-x')) act('nt', 'linkRemove', { id: l.id }); else act('nt', 'open', { url: l.url }); };
      a.onkeydown = e => { if (e.key === 'Enter') act('nt', 'open', { url: l.url }); };
      a.addEventListener('dragstart', e => { linkDrag = l.id; a.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      a.addEventListener('dragend', () => { linkDrag = null; box.querySelectorAll('.dragging,.drop-before').forEach(n => n.classList.remove('dragging', 'drop-before')); });
      a.addEventListener('dragover', e => { if (linkDrag && linkDrag !== l.id) { e.preventDefault(); a.classList.add('drop-before'); } });
      a.addEventListener('dragleave', () => a.classList.remove('drop-before'));
      a.addEventListener('drop', e => { e.preventDefault(); a.classList.remove('drop-before'); if (linkDrag) act('nt', 'linkMove', { id: linkDrag, before: l.id }); });
      return a;
    });
    const add = document.createElement('div');
    add.className = 'nt-tile nt-add';
    if (addingLink) {
      add.classList.add('editing');
      add.innerHTML = `<form class="nt-addform"><input class="field" name="url" placeholder="Address" aria-label="Address"><input class="field" name="name" placeholder="Name (optional)" aria-label="Name">
        <input class="field" name="icon" placeholder="Emoji or image link (optional)" aria-label="Icon"><div class="nt-addbtns"><button type="submit" class="import-btn">Add</button><button type="button" class="import-btn nt-cancel">Cancel</button></div><p class="hint nt-err"></p></form>`;
      const f = add.querySelector('form');
      f.onsubmit = async e => {
        e.preventDefault();
        const r = await act('nt', 'linkAdd', { url: f.elements.url.value, title: f.elements.name.value, icon: f.elements.icon.value });
        if (r?.error) { f.querySelector('.nt-err').textContent = r.error; return; }
        addingLink = false; linksRedraw();
      };
      f.querySelector('.nt-cancel').onclick = () => { addingLink = false; linksRedraw(); };
      f.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { addingLink = false; linksRedraw(); } });
      setTimeout(() => f.elements.url.focus(), 0);
    } else {
      add.title = 'Add a shortcut';
      add.tabIndex = 0;
      add.innerHTML = '<span class="nt-ico"><span class="ico nt-plus">+</span></span><span class="nt-name">Add</span>';
      add.onclick = () => { addingLink = true; linksRedraw(); };
      add.addEventListener('dragover', e => { if (linkDrag) e.preventDefault(); });
      add.addEventListener('drop', e => { e.preventDefault(); if (linkDrag) act('nt', 'linkMove', { id: linkDrag, before: null }); });
    }
    box.replaceChildren(...tiles, add);
  }

  let noteTa = null;
  function noteBox() {
    if (noteTa) return noteTa;
    const ta = noteTa = document.createElement('textarea');
    ta.className = 'field'; ta.id = 'ntNote'; ta.rows = 5; ta.placeholder = 'Jot something down…';
    let t;
    const save = () => { clearTimeout(t); delete ta.dataset.dirty; act('nt', 'note', { text: ta.value }); };
    ta.oninput = () => { ta.dataset.dirty = '1'; clearTimeout(t); t = setTimeout(save, 400); };
    ta.onblur = () => { if (ta.dataset.dirty) save(); };
    ta.addEventListener('keydown', e => e.stopPropagation());
    return ta;
  }

  // Widgets: weather, to-do list, notes, recently closed tabs.
  function renderWidgets() {
    const box = $('ntWidgets');
    const nt = S.nt || {};
    const sig = JSON.stringify([S.settings.ntWidgets, S.settings.focusClock, nt.todos, nt.closed, nt.weather]);
    // Don't redraw while typing in the notes box unless something else changed.
    if (document.activeElement?.id === 'ntNote' && renderWidgets.sig === sig) return;
    renderWidgets.sig = sig;
    const focusId = box.contains(document.activeElement) ? document.activeElement.id : null;
    const sel = focusId === 'ntNote' ? [noteTa.selectionStart, noteTa.selectionEnd, noteTa.scrollTop] : null;
    const cards = [];
    const card = (cls, title) => { const c = document.createElement('section'); c.className = 'nt-card ' + cls; c.innerHTML = `<h3>${esc(title)}</h3>`; cards.push(c); return c; };
    if (wOn('weather')) {
      const c = card('nt-weather', 'Weather');
      const w = nt.weather;
      if (!w) {
        c.insertAdjacentHTML('beforeend', `<form class="nt-row" id="ntPlaceForm"><input class="field" id="ntPlace" placeholder="Your city" aria-label="City for weather"><button class="import-btn">Set</button></form>
          <p class="hint" id="ntPlaceErr">From Open-Meteo (free, no account). Only the place you type is sent.</p>`);
      } else if (w.loading || w.error) {
        c.insertAdjacentHTML('beforeend', `<p class="hint">${w.error ? 'Couldn’t get the weather right now.' : 'Getting the weather…'}</p><p class="nt-place">${esc(w.place || '')}</p>`);
        // A failed lookup may be the wrong place: let it be changed here, not just in Settings.
        if (w.error) c.insertAdjacentHTML('beforeend', `<form class="nt-row" id="ntPlaceForm"><input class="field" id="ntPlace" placeholder="Another city" aria-label="City for weather"><button class="import-btn">Set</button></form>
          <p class="hint" id="ntPlaceErr"></p>`);
      } else {
        const [em, label] = WMO(w.code);
        c.insertAdjacentHTML('beforeend', `<div class="nt-wx"><span class="nt-wx-ico" aria-hidden="true">${w.day || w.code > 3 ? em : '🌙'}</span><span class="nt-wx-t">${w.temp}°${w.unit.toUpperCase()}</span></div>
          <div class="nt-wx-sub">${esc(label)} · H ${w.hi}° L ${w.lo}°</div><p class="nt-place">${esc(w.place)}</p>`);
      }
      const f = c.querySelector('#ntPlaceForm');
      if (f) {
        f.onsubmit = async e => { e.preventDefault(); const r = await act('nt', 'place', { name: c.querySelector('#ntPlace').value }); if (r?.error && $('ntPlaceErr')) $('ntPlaceErr').textContent = r.error; };
        f.addEventListener('keydown', e => e.stopPropagation());
      }
    }
    if (wOn('todo')) {
      const c = card('nt-todo', 'To-do');
      const ul = document.createElement('ul');
      ul.className = 'nt-todos';
      for (const t of nt.todos || []) {
        const li = document.createElement('li');
        li.className = t.done ? 'done' : '';
        li.innerHTML = `<label><input type="checkbox" ${t.done ? 'checked' : ''}><span></span></label><button class="nt-x" title="Delete">${ICON.close}</button>`;
        li.querySelector('span').textContent = t.text;
        li.querySelector('input').onchange = () => act('nt', 'todoToggle', { id: t.id });
        li.querySelector('.nt-x').onclick = () => act('nt', 'todoRemove', { id: t.id });
        ul.append(li);
      }
      c.append(ul);
      c.insertAdjacentHTML('beforeend', '<form class="nt-row" id="ntTodoForm"><input class="field" id="ntTodoIn" placeholder="Add a task…" maxlength="200" aria-label="New task"></form>');
      if ((nt.todos || []).some(t => t.done)) {
        const clr = document.createElement('button'); clr.className = 'link'; clr.textContent = 'Clear done'; clr.onclick = () => act('nt', 'todoClear'); c.append(clr);
      }
      const f = c.querySelector('#ntTodoForm');
      f.onsubmit = e => { e.preventDefault(); const inp = c.querySelector('#ntTodoIn'); const v = inp.value.trim(); if (v) { act('nt', 'todoAdd', { text: v }); inp.value = ''; } };
      f.addEventListener('keydown', e => e.stopPropagation());
    }
    if (wOn('notes')) {
      const c = card('nt-notes', 'Notes');
      // The same box is kept across redraws, so text typed but not yet saved (and the
      // caret) survive another widget changing at that moment.
      const ta = noteBox();
      if (document.activeElement !== ta && !ta.dataset.dirty) ta.value = nt.note || '';
      c.append(ta);
    }
    if (wOn('closed')) {
      const c = card('nt-closed', 'Recently closed');
      const ul = document.createElement('ul');
      ul.className = 'list';
      for (const x of nt.closed || []) {
        const li = rowEl({ title: x.title, url: x.url });
        li.firstElementChild.onclick = () => act('nt', 'reopen', { i: x.i });
        ul.append(li);
      }
      if (!(nt.closed || []).length) ul.innerHTML = '<li class="hint">Nothing closed in this Space yet.</li>';
      c.append(ul);
    }
    box.replaceChildren(...cards);
    box.hidden = !cards.length;
    if (focusId && $(focusId)) $(focusId).focus();
    if (sel && document.activeElement === noteTa) { noteTa.setSelectionRange(sel[0], sel[1]); noteTa.scrollTop = sel[2]; }
  }

  // Focus screen: a clock in the page area while no tab is open, over the
  // background photo (if one is chosen). Only ticks while it's on screen.
  let clockTimer = null, bgUrl = null, bgWant = null, rotTimer = null, wasIdle = false;
  const BGS = window.ArchBackgrounds || [];
  // Rotating "every time": a new photo each time the page area empties.
  let rotStep = Math.floor(Math.random() * Math.max(1, BGS.length));
  function renderFocus(idle) {
    const st = S.settings;
    const on = idle && (wOn('clock') || wOn('date') || (wOn('greeting') && st.ntGreet !== 'off'));
    $('focusClock').hidden = !on;
    $('fcTime').hidden = !wOn('clock');
    $('fcDate').hidden = !wOn('date');
    $('fcGreet').hidden = !wOn('greeting') || st.ntGreet === 'off';
    $('card').classList.toggle('has-clock', on);
    if (idle && !wasIdle && st.bgChoice === 'rotate' && st.bgEvery === 'open') rotStep++;
    wasIdle = idle;
    applyBackground();
    if (on && !clockTimer) { tick(); }
    else if (!on && clockTimer) { clearTimeout(clockTimer); clockTimer = null; }
    else if (on && changed('clockFmt', [st.clock24, st.clockSeconds, st.clockStyle, st.ntGreet, st.ntName, st.ntMessage])) tick();
  }
  // Which photo should show now: a built-in one (by file), the user's own
  // ('custom:<name>'), or none.
  function wantedBackground() {
    const st = S.settings;
    const choice = st.bgChoice || (st.background ? 'custom' : 'none');
    clearTimeout(rotTimer); rotTimer = null;
    if (choice === 'custom') return st.background ? 'custom:' + st.background : null;
    if (choice === 'color') return 'css:' + (st.ntColor || '#2d2d54');
    if (choice === 'gradient') { const g = st.ntGradient || ['#6fa8f5', '#f2a7c3']; return `css:linear-gradient(${st.ntAngle ?? 135}deg, ${g[0]}, ${g[1]})|${g.join(',')}`; }
    if (choice === 'daily') return S.nt?.daily?.url || null;
    if (choice === 'rotate' && BGS.length) {
      if (st.bgEvery === 'open') return BGS[rotStep % BGS.length].file;
      const ms = Math.max(1, Number(st.bgEvery) || 60) * 60000;
      const now = Date.now();
      rotTimer = setTimeout(applyBackground, ms - (now % ms) + 50);
      return BGS[Math.floor(now / ms) % BGS.length].file;
    }
    return BGS.find(b => b.id === choice)?.file || null;
  }
  function applyBackground() {
    const want = wantedBackground();
    if (want === bgWant) return;
    bgWant = want;
    if (!want) return setBackground(null);
    if (want.startsWith('css:')) return setBackground(null, want.slice(4));
    const load = want.startsWith('custom:') ? act('background', 'get') : Promise.resolve(want);
    load.then(u => {
      if (bgWant !== want) return;
      if (!u) return setBackground(null);
      // Load it first so the switch is a smooth fade, not a blank flash.
      const img = new Image();
      img.onload = img.onerror = () => { if (bgWant === want) setBackground(u); };
      img.src = u;
    });
  }
  // A photo (u) or a plain colour / gradient (css, with its colours after "|" for the text colour).
  function setBackground(u, css = null) {
    bgUrl = u;
    const [paint, cols] = (css || '').split('|');
    const colors = (cols || paint || '').match(/#[0-9a-f]{6}/gi) || [];
    const light = !!css && colors.length > 0 && !ArchTheme.isDark(colors);
    $('cardBg').style.backgroundImage = u ? `url("${u}")` : paint && paint.startsWith('linear') ? paint : '';
    $('cardBg').style.backgroundColor = paint && paint.startsWith('#') ? paint : '';
    $('card').classList.toggle('has-bg', !!u || (!!css && !light));
    $('card').classList.toggle('has-fill', !!css);
    $('card').classList.toggle('bg-light', light);
  }
  function tick() {
    clearTimeout(clockTimer);
    const now = new Date();
    const st = S.settings;
    const style = window.ArchClocks?.valid(st.clockStyle) ? st.clockStyle : 'thin';
    ArchClocks.update($('fcTime'), style, now, { h24: !!st.clock24, sec: !!st.clockSeconds && style !== 'words' });
    const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if ($('fcDate').textContent !== date) $('fcDate').textContent = date;
    const h = now.getHours();
    const base = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const greet = st.ntGreet === 'custom' && st.ntMessage ? st.ntMessage : st.ntGreet === 'name' && st.ntName ? `${base}, ${st.ntName}` : base;
    if ($('fcGreet').textContent !== greet) $('fcGreet').textContent = greet;
    const step = st.clockSeconds ? 1000 : 60000;
    clockTimer = setTimeout(tick, step - (now.getTime() % step) + 20);
  }

  // Now playing: whatever tab is playing (or just paused) and isn't on screen.
  const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';
  function renderMedia() {
    const m = S.media;
    $('media').hidden = !m;
    if (!m) return;
    const art = $('mediaOpen');
    if (m.art) { art.style.backgroundImage = `url("${m.art.replace(/["\\]/g, '')}")`; art.innerHTML = ''; }
    else { art.style.backgroundImage = ''; art.innerHTML = ico(m.favicon, '', m.title); }
    $('mediaTitle').textContent = m.title;
    $('mediaSub').textContent = m.sub;
    $('media').title = `${m.title}\n${m.sub}`;
    $('mediaPlay').innerHTML = m.playing ? PAUSE : PLAY;
    $('mediaPlay').title = m.playing ? 'Pause' : 'Play';
    $('mediaNext').disabled = !m.canNext;
    $('mediaPrev').hidden = !m.canPrev;
    $('mediaMute').innerHTML = m.muted ? ICON.muted : ICON.sound;
    $('mediaMute').title = m.muted ? 'Unmute' : 'Mute';
  }
  $('mediaOpen').onclick = () => S.media && act('media', 'show', S.media.tabId);
  $('mediaPlay').onclick = () => S.media && act('media', 'toggle', S.media.tabId);
  $('mediaNext').onclick = () => S.media && act('media', 'next', S.media.tabId);
  $('mediaPrev').onclick = () => S.media && act('media', 'prev', S.media.tabId);
  $('mediaMute').onclick = () => S.media && act('media', 'mute', S.media.tabId);
  document.querySelector('.media-text').onclick = () => S.media && act('media', 'show', S.media.tabId);

  // Sites as sidebar panels.
  function renderPanels() {
    const list = S.panels || [];
    const btns = list.map(p => {
      const b = document.createElement('button');
      b.className = 'panel-btn' + (p.open ? ' on' : '');
      b.title = `${p.title}\nClick to ${p.open ? 'close' : 'open'} · right-click for options`;
      b.innerHTML = ico(p.favicon, p.url, p.title);
      b.onclick = () => act('panel', 'toggle', p.id);
      b.oncontextmenu = e => { e.preventDefault(); act('panel', 'menu', { id: p.id, x: e.clientX, y: e.clientY }); };
      return b;
    });
    const add = document.createElement('button');
    add.className = 'panel-btn add';
    add.title = 'Keep the current site in a side panel';
    add.textContent = '+';
    add.onclick = () => act('panel', 'add');
    $('panels').replaceChildren(...btns, add);
    $('panels').classList.toggle('empty', !list.length);
  }

  // Compact mode: the edges bring the sidebar and top bar back; leaving them hides them again.
  let hideT = null;
  // mousemove too: an edge that appears under a pointer already resting there gets no mouseenter.
  // (Quasar also watches the cursor itself, for the window's resize border; see edgeWatch.)
  const fromEdge = () => { if (!S?.chromeShown) { clearTimeout(hideT); act('chrome:show', true); } };
  for (const id of ['edgeS', 'edgeT']) { $(id).addEventListener('mouseenter', fromEdge); $(id).addEventListener('mousemove', fromEdge); }
  // Bars brought back but never pointed at (the pointer stayed on the edge, or went
  // back out of the window): hide them again after a moment.
  let wasShown = false;
  function chromeShownChanged() {
    const shown = !!(S?.autoHide && S.chromeShown);
    if (shown && !wasShown) {
      clearTimeout(hideT);
      hideT = setTimeout(() => { if (!$('sidebar').matches(':hover') && !$('topbar').matches(':hover')) act('chrome:show', false); }, 1500);
    }
    wasShown = shown;
  }
  const keepChrome = () => clearTimeout(hideT);
  const dropChrome = () => { if (!S?.autoHide || !S.chromeShown) return; clearTimeout(hideT); hideT = setTimeout(() => act('chrome:show', false), 700); };
  // Sidebar on top and hidden: pointing at the top bar brings the tab strip down.
  $('topbar').addEventListener('mouseenter', () => { if (S?.hidden?.sb && S.settings.sidebarSide === 'top') { clearTimeout(hideT); act('chrome:show', true); } });
  for (const id of ['sidebar', 'topbar']) { $(id).addEventListener('mouseenter', keepChrome); $(id).addEventListener('mouseleave', dropChrome); }
  document.documentElement.addEventListener('mouseleave', dropChrome);

  function renderFavorites() {
    $('favorites').replaceChildren(...S.favorites.map(f => {
      const b = document.createElement('button');
      b.className = 'fav' + (f.open ? ' open' : '') + (f.active ? ' active' : '');
      b.title = (f.title || f.url) + '\nRight-click to remove' + (f.audible || f.muted ? '\nAlt+click to ' + (f.muted ? 'unmute' : 'mute') : '');
      b.innerHTML = ico(f.favicon, f.url, f.title) + (f.muted ? `<span class="fav-audio">${ICON.muted}</span>` : f.audible ? `<span class="fav-audio">${ICON.sound}</span>` : '') +
        (f.unread ? `<span class="fav-badge">${f.unread > 99 ? '99+' : f.unread}</span>` : '');
      b.setAttribute('aria-label', (f.title || host(f.url)) + (f.unread ? `, ${f.unread} unread` : ''));
      b.onclick = e => (e.altKey && f.tabId ? act('mute', f.tabId) : act('openFavorite', f.id));
      b.oncontextmenu = e => { e.preventDefault(); act('removeFavorite', f.id); };
      return b;
    }));
  }

  function rowEl(item, { tools = '', cls = '', draggable = false } = {}) {
    const li = document.createElement('li');
    const note = item.crashed ? '\nThis page crashed — click to see it and reload' : item.sleeping ? '\nSleeping (memory freed) — click to wake' : '';
    li.innerHTML = `<div class="row${item.active ? ' active' : ''}${item.sleeping ? ' sleeping' : ''}${item.crashed ? ' crashed' : ''} ${cls}" ${draggable ? 'draggable="true"' : ''} title="${esc(item.url + note)}" tabindex="-1" role="button" aria-label="${esc((item.title || host(item.url) || 'New Tab') + (item.active ? ', current tab' : '') + (item.sleeping ? ', sleeping' : '') + (item.unread ? `, ${item.unread} unread` : ''))}"${item.active ? ' aria-current="page"' : ''}>
      ${item.loading ? '<span class="spin"></span>' : item.crashed ? '<span class="ico crash-ico">!</span>' : ico(item.favicon, item.url, item.title)}
      <span class="title">${esc(item.title || host(item.url) || 'New Tab')}</span>
      ${item.unread ? `<span class="count unread" title="${item.unread} unread">${item.unread > 99 ? '99+' : item.unread}</span>` : ''}
      ${audioBtn(item)}
      ${item.elsewhere ? '<span class="elsewhere" title="Showing in another window">⧉</span>' : ''}
      ${item.open && !item.active ? '<span class="dot"></span>' : ''}
      <span class="tools">${tools}</span></div>`;
    return li;
  }

  // Hover over a tab for a moment: a picture of the page (taken while it was on screen).
  let pvT = null, pvFor = null;
  function hidePreview() { clearTimeout(pvT); pvFor = null; $('tabPreview').hidden = true; }
  function hoverPreview(row, tabId) {
    if (!tabId) return;
    row.addEventListener('mouseenter', () => {
      clearTimeout(pvT);
      if (S?.settings.tabPreviews === false || S?.settings.sidebarSide === 'top' || drag) return;
      pvT = setTimeout(async () => {
        if (row.classList.contains('active') || !row.isConnected || !row.matches(':hover')) return;
        pvFor = tabId;
        const p = await act('tabPreview', tabId);
        if (!p || pvFor !== tabId || !row.matches(':hover')) return;
        const box = $('tabPreview');
        box.innerHTML = (p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : `<div class="pv-none">${p.sleeping ? 'Sleeping — click to wake it' : 'No preview yet'}</div>`) +
          `<div class="pv-title">${esc(p.title)}</div><div class="pv-host">${esc(p.host)}</div>`;
        box.hidden = false;
        const sb = $('sidebar').getBoundingClientRect(), r = row.getBoundingClientRect();
        const h = box.offsetHeight;
        const top = r.bottom + 6 + h < sb.bottom - 8 ? r.bottom + 6 : Math.max(8, r.top - h - 6);
        box.style.top = (top - sb.top) + 'px';
      }, 550);
    });
    row.addEventListener('mouseleave', hidePreview);
    row.addEventListener('mousedown', hidePreview);
  }

  function dropTarget(el, kinds, onDrop, cls = 'drop-before') {
    el.addEventListener('dragover', e => { if (drag && kinds.includes(drag.kind)) { e.preventDefault(); el.classList.add(cls); } });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove(cls); });
    el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); el.classList.remove(cls); if (drag && kinds.includes(drag.kind)) onDrop(drag); });
  }
  function dragSource(el, data) {
    el.addEventListener('dragstart', e => { drag = data; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', e => {
      // Nothing accepted the drop: if it ended outside this window, the tab gets its own
      // window (or joins the Quasar window it was dropped on). Quasar checks where the cursor is.
      if (data.kind === 'tab' && e.dataTransfer.dropEffect === 'none') act('tearOff', data.id);
      drag = null; document.querySelectorAll('.dragging,.drop,.drop-before').forEach(n => n.classList.remove('dragging', 'drop', 'drop-before'));
    });
  }

  // Split view: a ring around the focused pane and draggable dividers, drawn in
  // the gaps between the page panes (the pages themselves cover everything else).
  function renderSplit() {
    const box = $('splitUI');
    const sp = S.split;
    if (!sp) { box.replaceChildren(); box.hidden = true; return; }
    box.hidden = false;
    const els = [];
    for (const p of sp.panes) {
      if (!p.active) continue;
      const ring = document.createElement('div');
      ring.className = 'pane-ring';
      Object.assign(ring.style, { left: p.x - 3 + 'px', top: p.y - 3 + 'px', width: p.width + 6 + 'px', height: p.height + 6 + 'px' });
      els.push(ring);
    }
    const x0 = sp.panes[0].x, last = sp.panes[sp.panes.length - 1], x1 = last.x + last.width;
    if (!sp.grid) sp.panes.slice(0, -1).forEach((p, i) => {   // (a grid has fixed halves: no drag handles)
      const d = document.createElement('div');
      d.className = 'pane-divider';
      d.title = 'Drag to resize';
      const gap = sp.panes[i + 1].x - (p.x + p.width);
      Object.assign(d.style, { left: p.x + p.width + 'px', top: p.y + 'px', width: Math.max(4, gap) + 'px', height: p.height + 'px' });
      d.addEventListener('pointerdown', e => {
        e.preventDefault();
        d.setPointerCapture(e.pointerId);
        d.classList.add('dragging');
        const move = ev => act('splitResize', sp.id, i, (ev.clientX - x0) / (x1 - x0));
        const up = () => { d.classList.remove('dragging'); d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); };
        d.addEventListener('pointermove', move);
        d.addEventListener('pointerup', up);
      });
      d.ondblclick = () => act('splitMenu', sp.id, d.getBoundingClientRect().left, d.getBoundingClientRect().top + 40);
      els.push(d);
    });
    box.replaceChildren(...els);
  }

  // Several favicons side by side, for a split view row.
  const splitIcons = kids => `<span class="split-icos">${kids.slice(0, 4).map(k => ico(k.favicon, k.url, k.title)).join('')}</span>`;

  // Pinned tabs: a tree with folders (click to open/close) and pinned split views.
  function renderPinned() {
    const out = [];
    const walk = (nodes, depth) => {
      for (const p of nodes) {
        const indent = `padding-left:${8 + depth * 14}px`;
        if (p.type === 'folder' && !showFolders()) { walk(p.children, depth); continue; }
        if (p.type === 'folder') {
          const li = document.createElement('li');
          li.innerHTML = `<div class="row folder" draggable="true" style="${indent}" title="${esc(p.title)}">
            <span class="chev ${p.open ? 'open' : ''}">${ICON.chev}</span><span class="ico folder-ico${p.icon ? ' emoji' : ''}" ${p.live ? `title="Live Folder${p.live.error ? ': ' + esc(p.live.error) : ''}"` : ''}>${p.icon ? esc(p.icon) : p.live ? ArchIcons.svg(p.live.error ? 'alert' : 'rss') : ICON.folder}</span>
            <span class="title">${esc(p.title)}</span>${p.unread ? `<span class="count live" title="New since you last looked">${p.unread}</span>` : p.open ? '' : `<span class="count">${p.count}</span>`}
            <span class="tools"><button data-a="unpin" title="Delete folder (keeps its tabs)">${ICON.close}</button></span></div>`;
          const row = li.firstElementChild;
          row.dataset.id = p.id;
          row.onclick = e => (e.target.closest('[data-a=unpin]') ? act('pinnedMenu', p.id, e.clientX, e.clientY) : act('toggleFolder', p.id));
          row.ondblclick = e => { e.preventDefault(); startRename(row, p); };
          row.oncontextmenu = e => { e.preventDefault(); act('pinnedMenu', p.id, e.clientX, e.clientY); };
          dragSource(row, { kind: 'pinned', id: p.id });
          dropTarget(row, ['pinned', 'tab'], d => (d.kind === 'tab' ? act('pinInto', d.id, p.id) : act('movePinned', d.id, p.id, 'into')), 'drop');
          out.push(li);
          if (p.open) walk(p.children, depth + 1);
          continue;
        }
        const li = p.type === 'split'
          ? (() => { const l = document.createElement('li'); l.innerHTML = `<div class="row split-row${p.active ? ' active' : ''}" draggable="true" title="Split view: ${esc(p.title)}">${splitIcons(p.children)}<span class="title">${esc(p.title)}</span>${p.open && !p.active ? '<span class="dot"></span>' : ''}<span class="tools"><button data-a="unpin" title="Unpin split view">${ICON.close}</button></span></div>`; return l; })()
          : rowEl(p, { draggable: true, cls: (p.drifted ? 'drifted ' : '') + (p.fresh ? 'fresh' : ''),
            tools: (p.drifted ? `<button data-a="reset" title="Go back to the pinned address">${ICON.reset}</button>` : '') + `<button data-a="unpin" title="Unpin">${ICON.close}</button>` });
        if (p.drifted) {
          // Like Arc: "Pinned title / page it's on now".
          const tt = li.querySelector('.title');
          tt.innerHTML = `${esc(p.title || host(p.url))}<span class="drift-sep"> / </span><span class="drift-now">${esc(p.now)}</span>`;
          li.firstElementChild.title = `${p.url}\nNow on: ${p.now}\nClick ↺ to go back to the pinned address`;
        }
        const row = li.firstElementChild;
        row.dataset.id = p.id;
        row.style.cssText += ';' + indent;
        row.onclick = e => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'unpin') act('unpin', p.id); else if (a === 'mute') act('mute', p.tabId); else if (a === 'reset') act('resetPinned', p.tabId); else act('openPinned', p.id);
        };
        row.oncontextmenu = e => { e.preventDefault(); act('pinnedMenu', p.id, e.clientX, e.clientY); };
        if (p.type !== 'split' && p.open) hoverPreview(row, p.tabId);
        dragSource(row, { kind: 'pinned', id: p.id });
        dropTarget(row, ['pinned'], d => act('movePinned', d.id, p.id, 'before'));
        out.push(li);
      }
    };
    walk(S.pinned, 0);
    $('pinned').replaceChildren(...out);
  }

  // Rename a folder (or pinned tab) right in the sidebar.
  function startRename(row, p) {
    const t = row.querySelector('.title');
    if (!t || row.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = p.title || '';
    t.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = save => { if (done) return; done = true; if (save && input.value.trim()) act('renamePinned', p.id, input.value.trim()); else render(); last.pinned = null; render(); };
    input.onkeydown = e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); e.stopPropagation(); };
    input.onblur = () => finish(true);
    input.onclick = e => e.stopPropagation();
  }
  // Right-click a folder › Change Icon…: the emoji picker, by the folder.
  function folderIcon(kind, id) {
    setTimeout(() => {
      const row = document.querySelector(kind === 'group' ? `#today .row[data-gid="${id}"]` : `#pinned .row[data-id="${id}"]`);
      const cur = row?.querySelector('.folder-ico.emoji')?.textContent || '';
      openEmojiPicker(row || $('spaceEmoji'), '__folder', em => act('folderIcon', kind, id, em), cur);
    }, 60);
  }
  window.arch.on('ui:folder', ({ action, id }) => {
    if (action === 'icon') return folderIcon('pinned', id);
    if (action !== 'rename') return;
    setTimeout(() => {
      const row = document.querySelector(`#pinned .row[data-id="${id}"]`);
      const find = list => { for (const n of list) { if (n.id === id) return n; const c = n.children && find(n.children); if (c) return c; } return null; };
      const p = find(S.pinned || []);
      if (row && p) startRename(row, p);
    }, 60);
  });

  // Today's tabs, with folders (two levels deep).
  function renderToday() {
    const out = [];
    const walk = (items, depth) => {
      for (const t of items) {
        if (t.group && !showFolders()) { walk(t.children, depth); continue; }
        if (t.group) { out.push(groupRow(t, depth)); if (t.open) walk(t.children, depth + 1); continue; }
        const li = todayRow(t);
        if (depth) li.firstElementChild.style.paddingLeft = `${8 + depth * 14}px`;
        out.push(li);
      }
    };
    walk(S.today, 0);
    $('today').replaceChildren(...out);
  }
  function groupRow(g, depth) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="row folder today-folder${g.active && !g.open ? ' active-in' : ''}" draggable="true" style="padding-left:${8 + depth * 14}px" title="${esc(g.title)}" tabindex="-1" role="button" aria-expanded="${g.open}" aria-label="Folder ${esc(g.title)}, ${g.count} tabs">
      <span class="chev ${g.open ? 'open' : ''}">${ICON.chev}</span><span class="ico folder-ico${g.icon ? ' emoji' : ''}">${g.icon ? esc(g.icon) : ICON.folder}</span>
      <span class="title">${esc(g.title)}</span>${g.open ? '' : `<span class="count">${g.count}</span>`}
      <span class="tools"><button data-a="close" title="Close the tabs in this folder">${ICON.close}</button></span></div>`;
    const row = li.firstElementChild;
    row.dataset.gid = g.id;
    row.onclick = e => (e.target.closest('[data-a=close]') ? act('group', 'close', g.id) : act('group', 'toggle', g.id));
    row.ondblclick = e => { e.preventDefault(); renameGroup(row, g); };
    row.oncontextmenu = e => { e.preventDefault(); act('group', 'menu', g.id, { x: e.clientX, y: e.clientY }); };
    dragSource(row, { kind: 'group', id: g.id });
    dropTarget(row, ['tab', 'group'], d => (d.kind === 'tab' ? act('groupAdd', d.id, g.id) : act('group', 'nest', d.id, g.id)), 'drop');
    return li;
  }
  function renameGroup(row, g) {
    const t = row.querySelector('.title');
    if (!t || row.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = g.title || '';
    t.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = save => { if (done) return; done = true; if (save && input.value.trim()) act('group', 'rename', g.id, input.value.trim()); last.today = null; render(); };
    input.onkeydown = e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); e.stopPropagation(); };
    input.onblur = () => finish(true);
    input.onclick = e => e.stopPropagation();
  }
  window.arch.on('ui:group', ({ action, id }) => {
    if (action === 'icon') return folderIcon('group', id);
    if (action !== 'rename') return;
    setTimeout(() => {
      const row = document.querySelector(`#today .row[data-gid="${id}"]`);
      const find = list => { for (const n of list) { if (n.group && n.id === id) return n; const c = n.children && find(n.children); if (c) return c; } return null; };
      const g = find(S.today || []);
      if (row && g) renameGroup(row, g);
    }, 80);
  });
  function todayRow(t) {
    {
      if (t.split) {
        // A split view: one row with each pane's icon; click shows them side by side.
        const li = document.createElement('li');
        li.innerHTML = `<div class="row split-row${t.active ? ' active' : ''}" title="Split view: ${esc(t.title)}">
          ${splitIcons(t.tabs)}<span class="title">${esc(t.title)}</span>${audioBtn(t)}
          ${t.elsewhere ? '<span class="elsewhere" title="Showing in another window">⧉</span>' : ''}
          <span class="tools"><button data-a="pin" title="Pin split view">${ICON.pin}</button><button data-a="close" title="Close split view">${ICON.close}</button></span></div>`;
        const row = li.firstElementChild;
        const focusTab = (t.tabs.find(k => k.active) || t.tabs[0]).id;
        row.onclick = e => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'close') act('closeSplit', t.id);
          else if (a === 'pin') act('pin', focusTab);
          else if (a === 'mute') t.tabs.filter(k => k.audible || k.muted).forEach(k => act('mute', k.id));
          else act('select', focusTab);
        };
        row.oncontextmenu = e => { e.preventDefault(); act('splitMenu', t.id, e.clientX, e.clientY); };
        return li;
      }
      const li = rowEl(t, {
        draggable: true,
        tools: `<button data-a="pin" title="Pin (Ctrl+D)">${ICON.pin}</button><button data-a="fav" title="Add to Favorites">${ICON.star}</button><button data-a="close" title="Close (Ctrl+W)">${ICON.close}</button>`,
      });
      const row = li.firstElementChild;
      row.onclick = e => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'close') act('close', t.id);
        else if (a === 'pin') act('pin', t.id);
        else if (a === 'fav') act('favorite', t.id);
        else if (a === 'mute') act('mute', t.id);
        else act('select', t.id);
      };
      row.onauxclick = e => { if (e.button === 1) act('close', t.id); };
      hoverPreview(row, t.id);
      row.oncontextmenu = e => { e.preventDefault(); act('tabMenu', t.id, e.clientX, e.clientY); };
      dragSource(row, { kind: 'tab', id: t.id });
      dropTarget(row, ['tab'], d => act('reorder', d.id, t.id));
      return li;
    }
  }

  function renderSpaces() {
    $('spaces').replaceChildren(...S.spaces.map((s, i) => {
      const b = document.createElement('button');
      b.className = 'space-dot' + (s.id === S.space.id ? ' on' : '');
      b.dataset.id = s.id;
      b.title = `${s.name}${i < 9 ? `  (Ctrl+${i + 1})` : ''}\nRight-click for options`;
      b.innerHTML = s.emoji ? esc(s.emoji) : '<span class="ring"></span>';
      b.onclick = () => act('switchSpace', s.id);
      b.oncontextmenu = e => { e.preventDefault(); act('spaceMenu', s.id, e.clientX, e.clientY); };
      dropTarget(b, ['tab'], d => act('moveToSpace', d.id, s.id), 'drop');
      return b;
    }));
  }

  // ------------------------------------------------------- emoji picker
  const EMOJI = ('🏠 🏚️ 🏫 🏢 💼 📚 🎓 ✏️ 🧪 💻 🖥️ 🎮 🕹️ 🎧 🎵 🎬 📷 🎨 ✨ 🌸 🌙 ☀️ 🌈 🔥 ⚡ ❄️ 🌊 🌿 🍀 🌵 🍕 ☕ ' +
    '🛒 💰 📈 🧾 ✈️ 🚗 🏖️ 🗺️ ❤️ 💜 💙 💚 🧡 💛 🖤 🤍 ⭐ 🔑 🔒 🛡️ ⚙️ 🧠 💡 📝 📌 📎 🗂️ 📅 💬 📣 🎯 🏆 ⚽ 🏀 🐶 🐱 🦊 🐼 👻 🤖 👾 🚀').split(' ');
  let pickerFor = null;
  let pickCb = null;   // set when picking for the New Space screen instead of an existing Space

  function openEmojiPicker(anchor, spaceId = S.space.id, onPick = null, current = null) {
    pickerFor = spaceId;
    pickCb = onPick;
    const target = onPick ? { emoji: current } : (S.spaces.find(s => s.id === spaceId) || S.space);
    const pk = $('emojiPicker');
    const grid = $('epGrid');
    grid.replaceChildren(...EMOJI.map(e => {
      const b = document.createElement('button');
      b.textContent = e;
      b.title = e;
      if (e === target.emoji) b.className = 'cur';
      b.onclick = () => setEmoji(e);
      return b;
    }));
    $('epRemove').disabled = !target.emoji;
    $('epInput').value = '';
    pk.hidden = false;
    syncPanel();
    // Place it next to whatever was clicked, inside the sidebar.
    const sb = $('sidebar').getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const h = pk.offsetHeight;
    const below = r.bottom + 6;
    pk.style.top = (below + h < sb.bottom - 8 ? below : Math.max(8, r.top - h - 6)) - sb.top + 'px';
    $('epInput').focus();
  }
  function closeEmojiPicker() { $('emojiPicker').hidden = true; pickerFor = null; pickCb = null; syncPanel(); }
  async function setEmoji(e) {
    if (!pickerFor) return;
    if (pickCb) { pickCb(e); closeEmojiPicker(); return; }
    await act('updateSpace', pickerFor, { emoji: e });
    editingFor = null;   // refresh the editor's emoji box if it's open
    closeEmojiPicker();
  }
  // Take the first emoji typed or pasted (handles multi-part emoji like 👨‍💻 and flags).
  $('epInput').addEventListener('input', () => {
    const v = $('epInput').value.trim();
    if (!v) return;
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = [...seg.segment(v)].map(x => x.segment).find(g => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g));
    if (first) setEmoji(first);
  });
  $('epRemove').onclick = () => setEmoji('');
  $('emojiPicker').addEventListener('keydown', e => { if (e.key === 'Escape') closeEmojiPicker(); });
  document.addEventListener('mousedown', e => {
    if (pickerFor && !e.target.closest('#emojiPicker')) closeEmojiPicker();
  });

  // Right-click on the Space name or emoji at the top = same menu as its bottom icon.
  for (const id of ['spaceEmoji', 'spaceTitle']) {
    $(id).oncontextmenu = e => { e.preventDefault(); act('spaceMenu', S.space.id, e.clientX, e.clientY); };
  }

  // Actions chosen from the Space right-click menu.
  window.arch.on('ui:space', async ({ action, spaceId }) => {
    if (action === 'new') return openNewSpace();
    if (action === 'icon') {
      const anchor = document.querySelector(`.space-dot[data-id="${spaceId}"]`) || $('spaceEmoji');
      return setTimeout(() => openEmojiPicker(anchor, spaceId), 50);
    }
    if (action === 'theme') {
      // Like Arc: the colour picker pops up right by the Space's icon.
      if (spaceId !== S.space.id) await act('switchSpace', spaceId);
      const anchor = document.querySelector(`.space-dot[data-id="${spaceId}"]`) || $('spaceEmoji');
      return setTimeout(() => openTheme(spaceId, anchor), 60);
    }
    if (spaceId !== S.space.id) await act('switchSpace', spaceId);
    setView('edit');
    setTimeout(() => { if (action === 'rename') { $('fName').focus(); $('fName').select(); } }, 80);
  });

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return m + 'm';
    const h = Math.round(m / 60);
    return h < 48 ? h + 'h' : Math.round(h / 24) + 'd';
  }
  function renderArchive() {
    if (!S.archive.length) { $('archive').innerHTML = '<li class="hint">Nothing archived yet.</li>'; return; }
    $('archive').replaceChildren(...S.archive.map(a => {
      const li = rowEl(a, { tools: `<span class="when">${ago(a.closedAt)}</span>` });
      li.firstElementChild.onclick = () => act('restoreArchived', a.id);
      return li;
    }));
  }

  // ------------------------------------------------------- notes, Read Later
  let editingNote = null;
  function renderNotes() {
    const list = S.notes || [];
    $('notesList').replaceChildren(...(list.length ? list.map(n => {
      const li = document.createElement('li');
      li.className = 'note';
      if (editingNote === n.id) {
        const ta = document.createElement('textarea');
        ta.className = 'field'; ta.rows = Math.min(12, Math.max(3, n.text.split('\n').length + 1)); ta.value = n.text;
        const save = () => { editingNote = null; act('notes', 'update', { id: n.id, text: ta.value }); };
        ta.onblur = save;
        ta.onkeydown = e => { if (e.key === 'Escape') { editingNote = null; last.notes = null; render(); } else if (e.key === 'Enter' && e.ctrlKey) ta.blur(); e.stopPropagation(); };
        li.append(ta);
        setTimeout(() => ta.focus(), 0);
        return li;
      }
      const t = document.createElement('div'); t.className = 'note-text'; t.textContent = n.text;
      t.title = 'Click to edit';
      t.onclick = () => { editingNote = n.id; last.notes = null; render(); };
      const meta = document.createElement('div'); meta.className = 'note-meta';
      if (n.url) { const a = document.createElement('button'); a.className = 'note-src'; a.textContent = n.title || host(n.url); a.title = n.url; a.onclick = () => act('notes', 'open', { id: n.id }); meta.append(a); }
      const when = document.createElement('span'); when.textContent = ago(n.at); meta.append(when);
      const cp = document.createElement('button'); cp.className = 'note-act'; cp.textContent = 'Copy'; cp.onclick = () => act('notes', 'copy', { id: n.id });
      const del = document.createElement('button'); del.className = 'note-act'; del.textContent = 'Delete'; del.onclick = () => act('notes', 'delete', { id: n.id });
      meta.append(cp, del);
      li.append(t, meta);
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'hint', textContent: 'No notes yet.' })]));
  }
  $('noteNew').onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.ctrlKey && $('noteNew').value.trim()) { act('notes', 'add', { text: $('noteNew').value }); $('noteNew').value = ''; }
  };
  $('noteNew').onblur = () => { if ($('noteNew').value.trim()) { act('notes', 'add', { text: $('noteNew').value }); $('noteNew').value = ''; } };
  function renderLater() {
    const list = S.readLater || [];
    if (!list.length) { $('laterList').innerHTML = '<li class="hint">Nothing saved. Right-click a page › Save to Read Later, or Ctrl+Shift+D.</li>'; return; }
    $('laterList').replaceChildren(...list.map(r => {
      const li = rowEl({ ...r, title: r.title }, { cls: r.read ? 'read' : '', tools: `<button data-a="toggle" title="${r.read ? 'Mark as unread' : 'Mark as read'}">${r.read ? '↺' : '✓'}</button><button data-a="delete" title="Remove">${ICON.close}</button>` });
      li.firstElementChild.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; act('readLater', a || 'open', r.id); };
      return li;
    }));
  }
  function renderVideos() {
    const list = S.videos || [];
    $('videosHead').hidden = !list.length;
    $('videoList').replaceChildren(...list.map(v => {
      const li = rowEl({ title: v.title, url: v.page, loading: v.saving }, { tools: v.saving ? '<span class="when">saving…</span>'
        : `<span class="when">${v.size ? Math.round(v.size / 1048576) + ' MB' : ''}</span><button data-a="page" title="Open the page it came from">↗</button><button data-a="delete" title="Delete the saved video">${ICON.close}</button>` });
      li.firstElementChild.title = `${v.title}\nSaved from ${v.page}`;
      li.firstElementChild.onclick = e => { if (v.saving) return; const a = e.target.closest('[data-a]')?.dataset.a; act('video', a || 'open', v.id); };
      return li;
    }));
  }
  $('laterSave').onclick = () => act('readLater', 'save');
  $('laterClear').onclick = () => act('readLater', 'clearRead');
  $('notesBtn').onclick = () => setView(view === 'notes' ? 'main' : 'notes');
  $('laterBtn').onclick = () => setView(view === 'later' ? 'main' : 'later');
  window.arch.on('ui:view', v => setView(v));

  // --------------------------------------------------------- Space editor
  function renderEditor() {
    const sp = S.space;
    $('fDelete').hidden = S.spaces.length < 2;
    if (editingFor === sp.id) return;   // don't clobber fields while typing
    editingFor = sp.id;
    $('fEmoji').value = sp.emoji || '';
    $('fName').value = sp.name;
    $('fGrain').value = sp.grain ?? 0.35;
    $('fGrainVal').textContent = Math.round(($('fGrain').value) * 100) + '%';
    $('fSleep').value = sp.sleepAfterMin == null ? '' : String(sp.sleepAfterMin);
    $('fLock').checked = !!sp.locked;
    $('fSleep').disabled = $('fLock').disabled = !!sp.private;
  }
  $('fSleep').onchange = e => act('setting', 'sleepSpace', e.target.value);
  $('fLock').onchange = e => act('lock:space', S.space.id, e.target.checked);

  // Profile dropdown + "who shares it" line, used by the editor and New Space.
  function fillProfiles(sel, current, withNew) {
    const opts = (S.profiles || []).map(p => new Option(p.name, p.id, false, p.id === current));
    if (withNew) opts.push(new Option('New profile…', 'new', false, current === 'new'));
    sel.replaceChildren(...opts);
    sel.value = current;
  }
  function profileHint(profileId, exceptSpace) {
    if (profileId === 'new') return 'A fresh profile: this Space shares nothing with your other Spaces.';
    const p = (S.profiles || []).find(x => x.id === profileId);
    const others = (p?.spaces || []).filter(n => n !== exceptSpace);
    return others.length
      ? `Shares logins, history, pinned tabs, Favorites and passwords with ${others.join(', ')}. Open tabs and theme stay separate.`
      : 'Only this Space uses this profile, so nothing is shared with other Spaces.';
  }
  function renderEditorProfile() {
    const sp = S.space;
    if (document.activeElement !== $('fProfile')) fillProfiles($('fProfile'), sp.profileId, true);
    $('fProfileHint').textContent = profileHint(sp.profileId, `${sp.emoji || ''} ${sp.name}`.trim());
    const px = (S.profiles || []).find(p => p.id === sp.profileId)?.proxy || null;
    if (document.activeElement !== $('fConn') && document.activeElement !== $('fProxy')) {
      $('fConn').value = px?.mode || 'system';
      $('fProxy').value = px?.rules || '';
    }
    $('fProxy').hidden = $('fConn').value !== 'custom';
    $('fConn').disabled = !!sp.private;
  }
  async function saveConn() {
    const mode = $('fConn').value;
    $('fProxy').hidden = mode !== 'custom';
    if (mode === 'custom' && !$('fProxy').value.trim()) { $('fProxy').focus(); return; }
    const r = await act('setProfileProxy', S.space.profileId, { mode, rules: $('fProxy').value });
    $('fConnMsg').textContent = r?.error || ({ vpn: 'Pages in this profile go through the free VPN (Cloudflare WARP).', tor: 'Pages in this profile go through Tor. Keep Tor Browser (or the Tor service) running.', custom: 'Pages in this profile go through your proxy.', direct: 'This profile ignores the Windows proxy.', system: '' }[mode] || '');
  }
  $('fConn').onchange = saveConn;
  $('fProxy').onchange = saveConn;
  $('fProfile').onchange = async e => {
    const to = e.target.value;
    const name = to === 'new' ? 'a new profile' : `the “${(S.profiles.find(p => p.id === to) || {}).name}” profile`;
    if (!confirm(`Switch this Space to ${name}?\n\nIts open tabs reopen there, and you'll see that profile's logins, history, pinned tabs and Favorites.`)) {
      return fillProfiles($('fProfile'), S.space.profileId, true);
    }
    await act('setSpaceProfile', S.space.id, to);
  };

  // ---------------------------------------------------------- New Space
  // Arc's flow: name + emoji, pick a profile (share an existing one, or new), theme.
  const draft = { emoji: '', colors: null, theme: null };
  function openNewSpace() {
    Object.assign(draft, { emoji: '', colors: null, theme: null });
    $('nsName').value = '';
    $('nsProfileName').value = '';
    $('nsEmoji').innerHTML = NS_EMOJI_ICON;
    $('nsThemePrev').hidden = true;
    fillProfiles($('nsProfile'), S.space.profileId || 'new', true);
    nsProfileChanged();
    setView('new');
    setTimeout(() => $('nsName').focus(), 30);
  }
  const NS_EMOJI_ICON = $('nsEmoji').innerHTML;
  function nsProfileChanged() {
    const v = $('nsProfile').value;
    $('nsNewProfileRow').hidden = v !== 'new';
    $('nsProfileHint').textContent = profileHint(v);
  }
  $('nsProfile').onchange = nsProfileChanged;
  $('nsEmoji').onclick = e => openEmojiPicker(e.currentTarget, '__new', em => {
    draft.emoji = em;
    if (em) $('nsEmoji').textContent = em; else $('nsEmoji').innerHTML = NS_EMOJI_ICON;
  }, draft.emoji);
  $('nsTheme').onclick = e => {
    if (ThemePicker.isOpen()) return ThemePicker.close();
    const base = { id: '__new', colors: draft.colors || S.space.colors, theme: draft.theme };
    ThemePicker.open(base, e.currentTarget, (colors, theme) => {
      draft.colors = colors; draft.theme = theme;
      $('nsThemePrev').hidden = false;
      $('nsThemePrev').style.background = `linear-gradient(135deg, ${colors.join(', ')})`;
      liveTheme = { spaceId: S.space.id, colors };   // preview the new theme on the window
      render();
    });
  };
  async function createSpace() {
    const profileId = $('nsProfile').value;
    ThemePicker.close();
    await act('createSpace', {
      name: $('nsName').value.trim(), emoji: draft.emoji,
      profileId, newProfileName: $('nsProfileName').value.trim() || $('nsName').value.trim(),
      colors: draft.colors || undefined, theme: draft.theme || undefined,
    });
    liveTheme = null;
    setView('main');
  }
  $('nsCreate').onclick = createSpace;
  $('nsName').addEventListener('keydown', e => { if (e.key === 'Enter') createSpace(); });
  $('nsProfileName').addEventListener('keydown', e => { if (e.key === 'Enter') createSpace(); });
  let saveT;
  function saveSpace() {
    clearTimeout(saveT);
    saveT = setTimeout(() => act('updateSpace', S.space.id, {
      emoji: $('fEmoji').value.trim(),
      name: $('fName').value.trim(),
      grain: Number($('fGrain').value),
    }), 60);
  }

  // ------------------------------------------------- theme colour picker
  // While dragging, the window recolours instantly; the choice is saved shortly after.
  let themeSaveT;
  function openTheme(spaceId, anchor) {
    const sp = S.spaces.find(s => s.id === spaceId) || S.space;
    ThemePicker.open(sp, anchor, (colors, theme) => {
      liveTheme = { spaceId: sp.id, colors };
      render();
      clearTimeout(themeSaveT);
      themeSaveT = setTimeout(async () => {
        await act('updateSpace', sp.id, { colors, theme });
        if (!ThemePicker.isOpen()) liveTheme = null;
      }, 90);
    });
  }
  $('fTheme').onclick = e => (ThemePicker.isOpen() ? ThemePicker.close() : openTheme(S.space.id, e.currentTarget));
  $('fEmoji').oninput = $('fName').oninput = saveSpace;
  $('fGrain').oninput = () => { $('fGrainVal').textContent = Math.round($('fGrain').value * 100) + '%'; saveSpace(); };
  // Quasar asks for confirmation itself (deleting a Space deletes its data).
  $('fDelete').onclick = async () => { const before = S.space.id; await act('deleteSpace', before); if (S.space.id !== before) setView('main'); };

  $('vpnBtn').onclick = () => { const r = $('vpnBtn').getBoundingClientRect(); act('vpnMenu', r.left, r.bottom + 6); };

  // ---- Read aloud (Windows voices), any page
  const speak = { parts: [], i: 0, paused: false, lang: '' };
  const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  function speakNext() {
    if (speak.i >= speak.parts.length) return stopSpeak();
    const u = new SpeechSynthesisUtterance(speak.parts[speak.i]);
    const voice = speechSynthesis.getVoices().find(v => speak.lang && v.lang && v.lang.toLowerCase().startsWith(speak.lang.slice(0, 2).toLowerCase()));
    if (voice) u.voice = voice;
    if (speak.lang) u.lang = speak.lang;
    u.onend = () => { if (!$('speak').hidden) { speak.i++; speakNext(); } };
    $('speakSub').textContent = `Part ${speak.i + 1} of ${speak.parts.length}`;
    speechSynthesis.speak(u);
  }
  function stopSpeak() { speechSynthesis.cancel(); $('speak').hidden = true; speak.parts = []; }
  window.arch.on('ui:speak', ({ text, lang, title }) => {
    speechSynthesis.cancel();
    // Paragraphs, joined into pieces of up to ~600 characters (long utterances can stall).
    const parts = [];
    for (const p of String(text).split(/\n+/).map(x => x.trim()).filter(Boolean)) {
      if (parts.length && parts[parts.length - 1].length + p.length < 600) parts[parts.length - 1] += '\n' + p;
      else for (let i = 0; i < p.length; i += 1500) parts.push(p.slice(i, i + 1500));
    }
    Object.assign(speak, { parts, i: 0, paused: false, lang });
    $('speakTitle').textContent = title ? `Reading: ${title}` : 'Reading aloud';
    $('speakPause').innerHTML = PAUSE_SVG; $('speakPause').title = 'Pause';
    $('speak').hidden = false;
    speakNext();
  });
  $('speakPause').onclick = () => {
    speak.paused = !speak.paused;
    if (speak.paused) speechSynthesis.pause(); else speechSynthesis.resume();
    $('speakPause').innerHTML = speak.paused ? PLAY_SVG : PAUSE_SVG;
    $('speakPause').title = speak.paused ? 'Resume' : 'Pause';
  };
  $('speakStop').onclick = stopSpeak;

  // ---- Keyboard: F6 lands here; arrow keys move between rows, Enter opens one.
  const focusables = () => [...document.querySelectorAll('#sidebar .row, #sidebar .fav, #newTab')].filter(el => el.offsetParent !== null);
  const TOOLBAR_ALL = () => [...document.querySelectorAll('#topbar button')].filter(b => !b.closest('#tbPool, .winctl')).map(b => b.id).filter(Boolean);
  window.arch.on('ui:focus', where => {
    if (where === 'toolbar') return $('urlBtn').focus();
    if (where === 'start') return setTimeout(() => { if (!$('ntSearch').hidden) $('ntQ').focus(); }, 30);   // New Tab opens the start page
    const rows = focusables();
    const el = document.querySelector('#sidebar .row.active') || rows[0];
    if (el) { el.tabIndex = 0; el.focus(); }
  });
  window.arch.on('ui:f6', dir => {
    const a = document.activeElement;
    const inSidebar = a && $('sidebar').contains(a);
    const inTop = a && $('topbar').contains(a);
    if (dir > 0 ? inTop : inSidebar) return act('focusPage');
    if (dir > 0 ? inSidebar : inTop) { if (dir > 0) $('urlBtn').focus(); else { const el = document.querySelector('#sidebar .row.active') || focusables()[0]; el?.focus(); } return; }
    act('focusPage');
  });
  $('sidebar').addEventListener('keydown', e => {
    const el = e.target.closest?.('.row, .fav, #newTab');
    if (!el || e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = focusables();
      const n = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) { el.tabIndex = -1; n.tabIndex = 0; n.focus(); }
      e.preventDefault();
    } else if ((e.key === 'Enter' || e.key === ' ') && el.tagName !== 'BUTTON') { el.click(); e.preventDefault(); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.bottom })); e.preventDefault(); }
  });
  $('topbar').addEventListener('keydown', e => {
    const TOOLBAR = TOOLBAR_ALL();
    const i = TOOLBAR.indexOf(document.activeElement?.id);
    if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const ids = TOOLBAR.filter(id => $(id).offsetParent !== null && !$(id).disabled);
    const j = ids.indexOf(TOOLBAR[i]) + (e.key === 'ArrowRight' ? 1 : -1);
    if (ids[j]) $(ids[j]).focus();
    e.preventDefault();
  });
  // Screen readers: every icon button gets its tooltip as its name.
  const labelButtons = () => { for (const b of document.querySelectorAll('button[title]:not([aria-label])')) b.setAttribute('aria-label', b.title.split('\n')[0]); };
  new MutationObserver(() => { clearTimeout(labelButtons.t); labelButtons.t = setTimeout(labelButtons, 50); }).observe(document.body, { subtree: true, childList: true });
  labelButtons();
  $('zoomPill').onclick = () => { const r = $('zoomPill').getBoundingClientRect(); act('zoomMenu', r.left, r.bottom + 6); };
  $('dlBtn').onclick = () => act('library', 'downloads');
  $('updBtn').onclick = () => { if (!$('updBtn').classList.contains('busy')) act('update:install'); };
  $('extBtn').onclick = () => act('library', 'extensions');
  $('readerBtn').onclick = () => act('reader');
  $('transBtn').onclick = () => act('translate');

  $('shield').onclick = () => { const r = $('siteInfo').getBoundingClientRect(); act('siteInfo', r.left, r.bottom + 6); };

  function setView(v) {
    if (v === 'notes') last.notes = null;
    if (v === 'later') { last.later = null; last.videos = null; }
    if (v === 'settings') return act('settings:open');   // Settings is a page now, not a sidebar view
    // Leaving New Space without creating: drop the theme preview.
    if (view === 'new' && v !== 'new') { liveTheme = null; if (ThemePicker.isOpen()) ThemePicker.close(); last.theme = null; }
    view = v; editingFor = null; render();
  }

  // --------------------------------------------------------------- wiring
  $('pinned').parentElement && dropTarget($('pinned'), ['tab', 'pinned'], d => (d.kind === 'tab' ? act('pin', d.id) : act('movePinned', d.id, null)), 'drop');
  $('newFolder').onclick = () => act('newFolder');
  dropTarget($('favorites'), ['tab', 'pinned'], d => d.kind === 'tab' && act('favorite', d.id), 'drop');
  $('newTab').onclick = $('emptyNew').onclick = () => act('newTab');
  $('clearToday').onclick = () => act('clearToday');
  $('spaceTitle').onclick = $('spaceEmoji').onclick = $('editSpace').onclick = () => setView('edit');
  $('archiveBtn').onclick = () => setView(view === 'archive' ? 'main' : 'archive');
  $('settingsBtn').onclick = () => act(S?.inapp === 'settings' ? 'set:close' : 'settings:open');
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => setView('main'));
  $('clearArchive').onclick = () => act('clearArchive');
  $('addSpace').onclick = () => openNewSpace();
  $('toggleSidebar').onclick = $('showSidebar').onclick = () => act('toggleSidebar');
  $('little').onclick = () => act('little');
  $('back').onclick = () => act('back');
  $('forward').onclick = () => act('forward');
  $('reload').onclick = () => act('reload');
  $('urlBtn').onclick = () => act('openUrlBar');
  $('siteInfo').onclick = () => { const r = $('siteInfo').getBoundingClientRect(); act('siteInfo', r.left, r.bottom + 6); };
  $('copyUrl').onclick = () => act('cmd:run', { type: 'action', id: 'copy-url' });
  $('homeBtn').onclick = () => act('home');
  $('newTabTop').onclick = () => act('newTab');
  $('littleTop').onclick = () => act('little');
  $('profileBtn').onclick = () => { const r = $('profileBtn').getBoundingClientRect(); act('profileMenu', r.left, r.bottom + 6); };
  $('topbar').oncontextmenu = e => { if (e.target.closest('.url-pill, browser-action-list, .winctl')) return; e.preventDefault(); act('topbarMenu', e.clientX, e.clientY); };
  $('wMin').onclick = () => act('win:min');
  $('wMax').onclick = () => act('win:max');
  $('wClose').onclick = () => act('win:close');
  $('topbar').ondblclick = e => { if (!e.target.closest('button, .url-pill')) act('win:max'); };

  // two-finger horizontal swipe switches Space
  let acc = 0, lock = 0;
  $('sidebar').addEventListener('wheel', e => {
    if (S?.settings.sidebarSide === 'top') return;   // the tab strip scrolls sideways instead
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Date.now() < lock) return;
    acc += e.deltaX;
    if (Math.abs(acc) > 120) { act('cycleSpace', acc > 0 ? 1 : -1); acc = 0; lock = Date.now() + 550; }
  }, { passive: true });

  $('v-main').addEventListener('wheel', e => {
    if (S?.settings.sidebarSide !== 'top' || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    $('v-main').scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // sidebar resize
  $('resizer').addEventListener('mousedown', e => {
    e.preventDefault();
    const move = ev => {
      const w = Math.max(180, Math.min(420, S?.settings.sidebarSide === 'right' ? window.innerWidth - ev.clientX : ev.clientX));
      document.documentElement.style.setProperty('--sb', w + 'px');
      act('setting', 'sidebarWidth', w);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // toasts
  let toastT;
  window.arch.on('toast', ({ text, action, buttons }) => {
    const t = $('toast');
    const span = document.createElement('span');
    span.className = 'toast-text';
    span.textContent = text;
    span.title = text;
    t.replaceChildren(span);
    t.hidden = false;
    t.classList.toggle('clickable', !!action);
    t.onclick = action?.type === 'show-file' ? () => act('showFile', action.path)
      : action?.type === 'downloads' ? () => { t.hidden = true; act('library', 'downloads'); }
      : action?.type === 'import-arc' ? () => { t.hidden = true; act('importArc'); } : null;
    if (buttons?.length) {
      const row = document.createElement('div');
      row.className = 'toast-btns';
      for (const b of buttons) {
        const el = document.createElement('button');
        el.textContent = b.label;
        el.onclick = () => { t.hidden = true; syncPanel(); if (b.act[0] === 'ui:view') setView(b.act[1]); else act(...b.act); };
        row.append(el);
      }
      t.append(row);
    }
    clearTimeout(toastT);
    placeToast();
    syncPanel();
    toastT = setTimeout(() => { t.hidden = true; syncPanel(); }, buttons?.length ? 45000 : action?.type === 'import-arc' ? 15000 : 4000);
  });

  // Pickers and long toasts opening or closing may need the sidebar panel (see syncPanel).
  const panelWatch = new MutationObserver(() => syncPanel());
  for (const id of ['emojiPicker', 'themePicker', 'toast']) panelWatch.observe($(id), { attributes: true, attributeFilter: ['hidden'] });

  window.arch.on('state', s => { S = s; render(); });
  act('ready').then(s => { if (s) { S = s; render(); } });
})();
