// Settings, shown in the page area like a tab (opened from the gear button in
// the sidebar). It gets the same state as the window UI and sends the same actions.
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  let S = null;
  const last = {};
  const changed = (key, val) => { const s = JSON.stringify(val); if (key in last && last[key] === s) return false; last[key] = s; return true; };   // (a value never set still draws once)

  function render() {
    if (!S) return;
    if (changed('theme', [S.space.colors, S.space.grain])) ArchTheme.apply(document.documentElement, S.space);
    ArchTheme.ui(document.documentElement, { ...S.settings, transparency: 0 });
    if (changed('priv', S.private)) {
      for (const id of ['sImportArc', 'sClear', 'sImportBrowser', 'sImportHtml', 'sExportHtml']) $(id).hidden = !!S.private;
    }
    if (changed('bg', S.settings.background || null)) {
      const want = S.settings.background || null;
      if (!want) setBgPreview(null);
      else act('background', 'get').then(u => { if ((S.settings.background || null) === want) setBgPreview(u); });
    }
    const choice = S.settings.bgChoice || (S.settings.background ? 'custom' : 'none');
    for (const t of $('sBgGrid').children) {
      const on = t.dataset.choice === choice;
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', String(on));
    }
    renderClockTiles();
    colorTile.firstChild.style.background = S.settings.ntColor || '#2d2d54';
    { const g = S.settings.ntGradient || ['#6fa8f5', '#f2a7c3']; gradTile.firstChild.style.background = `linear-gradient(${S.settings.ntAngle ?? 135}deg, ${g[0]}, ${g[1]})`; }
    $('sBgEvery').value = S.settings.bgEvery || '60';
    $('sBgEvery').hidden = $('sBgEveryLbl').hidden = choice !== 'rotate';
    const sel = $('sEngine');
    if (!sel.options.length) S.engines.forEach(n => sel.add(new Option(n, n)));
    sel.value = S.settings.searchEngine;
    $('sSuggest').checked = S.settings.searchSuggest !== false;
    $('sDarkAll').checked = !!S.settings.darkAll;
    $('sAutoScroll').checked = S.settings.autoScroll !== false;
    $('sAutoPip').checked = S.autoPip !== false;
    const pr = S.protection || {};
    $('sBlockAds').checked = pr.ads !== false;
    $('sSafe').checked = pr.safe !== false;
    $('sHttps').checked = pr.https !== false;
    $('sCookies').checked = pr.cookies !== false;
    $('sFp').checked = pr.fp !== false;
    $('sProtStatus').textContent = `${(pr.total || 0).toLocaleString()} ads and trackers blocked since Quasar started · ${(pr.adRules || 0).toLocaleString()} blocking rules, ${(pr.dangerEntries || 0).toLocaleString()} dangerous addresses` +
      (pr.updating ? ' · updating…' : pr.updated ? ` · lists from ${new Date(pr.updated).toLocaleDateString()}` : ' · lists not downloaded yet') +
      '. Lists are checked on this PC: the sites you visit are never sent anywhere.';
    $('sSleep').value = String(S.sleepAfterMin);
    $('sSleepHint').textContent = 'Sleeping tabs free their memory and reload, at the same scroll position, when you click them.' +
      (S.sleepingCount ? ` ${S.sleepingCount} tab${S.sleepingCount === 1 ? ' is' : 's are'} asleep now.` : '');
    renderUpdates();
    $('sArchive').value = String(S.settings.archiveAfterHours);
    $('sKeepTabs').checked = !!S.settings.keepTabs;
    $('sTrans').value = S.settings.translateEngine === 'google' ? 'google' : 'local';
    $('sCompact').checked = !!S.settings.compact;
    $('sGestures').checked = S.settings.gestures !== false;
    $('sBattery').checked = S.settings.batterySaver !== false;
    $('sHwAccel').checked = S.settings.hardwareAcceleration !== false;
    $('sBatteryNow').textContent = S.battery ? '(on battery now: saving)' : '';
    $('sHistText').checked = !!S.historySearch;
    $('sVpn').checked = !!S.vpn?.on;
    $('sVpnBtn').checked = S.vpn?.show !== false;
    $('sVpnWhere').textContent = S.vpn?.busy ? `(${S.vpn.busy})` : S.vpn?.on && S.vpn.where ? `(sites see you in ${S.vpn.where})` : '';
    $('sClean').checked = pr.clean !== false;
    $('sGpc').checked = pr.gpc !== false;
    $('sLockPriv').checked = !!S.settings.lockPrivate;
    $('sLockAfter').value = String(S.settings.lockAfterMin || 5);
    $('sMem').value = String(S.settings.memLimitMB || 0);
    $('sZoom').value = String(S.settings.defaultZoom || 1);
    $('sFont').value = String(S.settings.minFontSize || 0);
    $('sAskDl').checked = !!S.settings.askDownload;
    $('sCaret').checked = !!S.settings.caretBrowsing;
    $('sCycle').value = S.settings.tabCycle === 'order' ? 'order' : 'mru';
    $('sPreviews').checked = S.settings.tabPreviews !== false;
    $('sClock24').checked = !!S.settings.clock24;
    $('sClockSec').checked = !!S.settings.clockSeconds;
    renderCustom();
  }

  // Background tiles: none, rotate, your own photo (once chosen), then the built-in photos.
  const BGS = window.ArchBackgrounds || [];
  function bgTile(choice, label, title, thumb) {
    const b = document.createElement('button');
    b.className = 'bg-tile';
    b.dataset.choice = choice;
    b.setAttribute('role', 'radio');
    b.title = title;
    b.innerHTML = `<span class="bg-img"></span><span class="bg-name"></span>`;
    if (thumb) b.firstChild.style.backgroundImage = `url("${thumb}")`;
    b.lastChild.textContent = label;
    b.onclick = () => act('setting', 'bgChoice', choice);
    return b;
  }
  const customTile = bgTile('custom', 'Your photo', 'Your own photo');
  customTile.hidden = true;
  const rotateTile = bgTile('rotate', 'Rotate', 'Change between the mountain photos', BGS[0]?.thumb);
  rotateTile.firstChild.innerHTML = ArchIcons.svg('refresh');
  // Solid colour, gradient and Bing's picture of the day.
  const colorTile = bgTile('color', 'Colour', 'One colour of your choice');
  colorTile.firstChild.style.background = '#2d2d54';
  const gradTile = bgTile('gradient', 'Gradient', 'Two colours blended');
  gradTile.firstChild.style.background = 'linear-gradient(135deg, #6fa8f5, #f2a7c3)';
  const dailyTile = bgTile('daily', 'Picture of the day', 'A new photo every day (Bing’s picture of the day, from bing.com)');
  dailyTile.firstChild.innerHTML = ArchIcons.svg('sun');
  dailyTile.firstChild.style.background = 'linear-gradient(160deg, #f6b26b, #6fa8dc)';
  $('sBgGrid').replaceChildren(
    bgTile('none', 'None', 'No photo: your Space’s colours'), colorTile, gradTile, dailyTile, rotateTile, customTile,
    ...BGS.map(b => bgTile(b.id, b.title, `${b.title}, photo by ${b.by} on Unsplash`, b.thumb)));
  // Clock style tiles: each shows the current time in that style, over the
  // background photo when one is chosen. Redrawn each minute.
  const clockTiles = ArchClocks.styles.map(c => {
    const b = document.createElement('button');
    b.className = 'bg-tile clock-tile';
    b.dataset.choice = c.id;
    b.setAttribute('role', 'radio');
    b.title = c.name;
    b.innerHTML = `<span class="bg-img"><span class="clock-prev"></span></span><span class="bg-name"></span>`;
    b.lastChild.textContent = c.name;
    b.onclick = () => act('setting', 'clockStyle', c.id);
    return b;
  });
  $('sClockGrid').replaceChildren(...clockTiles);
  let clockTileTimer = null;
  function renderClockTiles() {
    const st = S.settings;
    const style = ArchClocks.valid(st.clockStyle) ? st.clockStyle : 'thin';
    const now = new Date();
    // Behind the previews: the chosen photo (the first one when rotating), else plain dark.
    const choice = st.bgChoice || (st.background ? 'custom' : 'none');
    const bg = choice === 'custom' ? customTile.firstChild.style.backgroundImage
      : (BGS.find(b => b.id === choice) || (choice === 'rotate' && BGS[0]))?.thumb;
    const bgCss = !bg ? '' : bg.startsWith('url(') ? bg : `url("${bg}")`;
    for (const t of clockTiles) {
      if (t.firstChild.style.backgroundImage !== bgCss) t.firstChild.style.backgroundImage = bgCss;
      const id = t.dataset.choice;
      const p = t.querySelector('.clock-prev');
      p.innerHTML = ArchClocks.html(id, now, { h24: !!st.clock24, sec: false });
      t.classList.toggle('on', id === style);
      t.setAttribute('aria-checked', String(id === style));
    }
    clearTimeout(clockTileTimer);
    clockTileTimer = setTimeout(renderClockTiles, 60000 - (now.getTime() % 60000) + 50);
  }
  function setBgPreview(u) {
    customTile.firstChild.style.backgroundImage = u ? `url("${u}")` : '';
    customTile.hidden = !u;
    $('sBgRemove').hidden = !u;
  }

  // Updates (Quasar's engine, Electron).
  // The version card at the top of Updates: exactly which Quasar this is, and
  // whether a newer one is waiting.
  function renderVersion() {
    const a = S.about, u = S.update || {};
    if (!a) return;
    const newer = (x, y) => String(x).localeCompare(String(y), undefined, { numeric: true }) > 0;
    const set = (id, t) => { if ($(id).textContent !== t) $(id).textContent = t; };
    set('sVerQuasar', a.quasar);
    set('sVerKind', { installed: 'Installed copy · updates itself', portable: 'Zip copy · updates its engine only (new Quasar versions come as a new download)',
      source: 'Run from source · updates its engine only' }[a.kind] + ` · ${a.arch}`);
    set('sVerElectron', `Electron ${a.electron}` + (u.kind !== 'app' && u.pendingRestart ? ` (${u.pendingRestart} after restart)` : ''));
    set('sVerChrome', a.chrome);
    set('sVerNode', a.node);
    set('sVerWin', a.windows);
    let pill = '', cls = '', latest = '';
    if (u.kind === 'app') {
      const avail = u.pendingRestart || u.available || (u.latest && newer(u.latest, a.quasar) ? u.latest : null);
      latest = u.latest || avail || (u.lastCheck ? a.quasar : '');
      if (u.progress) { pill = `Downloading ${u.progress.version || avail || ''}`.trim(); cls = 'busy'; }
      else if (u.pendingRestart) { pill = `${u.pendingRestart} ready · restart to install`; cls = 'new'; }
      else if (avail) { pill = `Update available: ${avail}`; cls = 'new'; }
      else if (u.error) { pill = 'Couldn’t check'; cls = 'err'; }
      else if (u.busy) { pill = 'Checking…'; cls = 'busy'; }
      else if (u.lastCheck) { pill = 'Up to date'; cls = 'ok'; }
      else pill = 'Not checked yet';
    } else {
      latest = 'This copy doesn’t check for new Quasar versions';
      if (u.progress) { pill = 'Updating engine'; cls = 'busy'; }
      else if (u.pendingRestart) { pill = 'Engine update ready · restart'; cls = 'new'; }
      else if (u.error) { pill = 'Engine check failed'; cls = 'err'; }
      else if (u.lastCheck) { pill = 'Engine up to date'; cls = 'ok'; }
      else pill = 'Not checked yet';
    }
    set('sVerLatest', latest ? (u.kind === 'app' ? `Quasar ${latest}` : latest) : 'Not checked yet');
    set('sVerChecked', u.lastCheck ? new Date(u.lastCheck).toLocaleString() : 'Never');
    set('sVerPill', pill);
    $('sVerPill').className = 'ver-pill' + (cls ? ' ' + cls : '');
  }

  function renderUpdates() {
    const u = S.update;
    renderVersion();
    if (!u) return;
    const mb = n => (n / 1048576).toFixed(0) + ' MB';
    const major = v => Number(String(v).split('.')[0]);
    const newer = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }) > 0;
    if (u.kind === 'app') return renderAppUpdates(u, mb);
    $('sAutoUpdLabel').textContent = 'Install security updates automatically (they take effect when Quasar restarts)';
    let s = `Engine: Electron ${u.current}. `;
    if (u.progress) s += `Downloading Electron ${u.progress.version}… ${mb(u.progress.received)}${u.progress.total ? ' of ' + mb(u.progress.total) : ''}`;
    else if (u.busy) s += 'Working…';
    else if (u.pendingRestart) s += `Electron ${u.pendingRestart} is installed and starts next time Quasar opens.`;
    else if (u.error) s += u.error;
    else if (u.sameMajor && newer(u.sameMajor, u.installed)) s += `Electron ${u.sameMajor} is available.`;
    else if (u.lastCheck) s += `Up to date (checked ${new Date(u.lastCheck).toLocaleString()}).`;
    else s += 'Not checked yet.';
    if (u.unsupported) s += ` Electron ${major(u.installed)} no longer gets security fixes — please update.`;
    $('sUpdStatus').textContent = s;
    $('sUpdBar').hidden = !u.progress;
    if (u.progress) $('sUpdBarFill').style.width = (u.progress.total ? Math.round(100 * u.progress.received / u.progress.total) : 30) + '%';
    $('sAutoUpd').checked = u.auto !== false;
    $('sUpdCheck').disabled = !!u.busy;
    $('sUpdInstall').hidden = !u.pendingRestart;
    $('sUpdInstall').textContent = `Restart now (Electron ${u.pendingRestart})`;
    const newMajor = u.latest && major(u.latest) > major(u.installed);
    $('sUpdMajor').hidden = !newMajor || !!u.busy;
    $('sUpdMajor').textContent = `Update to Electron ${u.latest}…`;
    $('sUpdRollback').hidden = !u.backup || !!u.busy;
    $('sUpdRollback').textContent = `Go back to Electron ${u.backup}`;
  }

  // Installed copies: Quasar itself updates from its published releases.
  function renderAppUpdates(u, mb) {
    let s = `Quasar ${u.current} (Electron ${u.electron}). `;
    if (u.progress) s += `Downloading Quasar ${u.progress.version || ''}… ${mb(u.progress.received)}${u.progress.total ? ' of ' + mb(u.progress.total) : ''}`;
    else if (u.busy) s += 'Checking…';
    else if (u.pendingRestart) s += `Quasar ${u.pendingRestart} is downloaded and installs when you close Quasar.`;
    else if (u.available) s += `Quasar ${u.available} is available.`;
    else if (u.error) s += u.error;
    else if (u.lastCheck) s += `Up to date (checked ${new Date(u.lastCheck).toLocaleString()}).`;
    else s += 'Not checked yet.';
    if ((u.pendingRestart || u.available) && u.notes) s += ` What’s new: ${u.notes}`;
    $('sUpdStatus').textContent = s;
    $('sUpdBar').hidden = !u.progress;
    if (u.progress) $('sUpdBarFill').style.width = (u.progress.total ? Math.round(100 * u.progress.received / u.progress.total) : 30) + '%';
    $('sAutoUpdLabel').textContent = 'Download Quasar updates automatically (they install when you close Quasar)';
    $('sAutoUpd').checked = u.auto !== false;
    $('sUpdCheck').disabled = !!u.busy || !!u.progress;
    $('sUpdInstall').hidden = !u.pendingRestart && !u.available;
    $('sUpdInstall').textContent = u.pendingRestart ? `Restart to update (${u.pendingRestart})` : `Update to ${u.available}`;
    $('sUpdMajor').hidden = true;
    $('sUpdRollback').hidden = true;
  }

  // ---- Search shortcuts
  async function loadKeywords(list) {
    list = list || await act('keywords', 'list') || [];
    $('sKeywords').replaceChildren(...list.map(k => {
      const li = document.createElement('li');
      li.innerHTML = `<b></b><span class="kw-name"></span><button class="kw-x" title="Remove">${ArchIcons.svg('close')}</button>`;
      li.querySelector('b').textContent = k.keyword;
      li.querySelector('.kw-name').textContent = k.name + (k.auto ? ' (added by the site)' : '');
      li.title = k.url;
      li.querySelector('.kw-x').onclick = async () => loadKeywords(await act('keywords', 'remove', { id: k.id }));
      return li;
    }));
  }
  $('sKwAdd').onclick = async () => {
    const r = await act('keywords', 'save', { keyword: $('sKwKey').value, url: $('sKwUrl').value });
    if (r?.error) { $('sKwMsg').textContent = r.error; return; }
    $('sKwMsg').textContent = ''; $('sKwKey').value = ''; $('sKwUrl').value = '';
    loadKeywords(r);
  };
  for (const id of ['sKwKey', 'sKwUrl']) $(id).addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('sKwAdd').click(); });

  // ---- Command chains
  let chainActions = null;
  async function loadChains(list) {
    list = list || await act('chains', 'list') || [];
    chainActions ||= await act('chains', 'actions') || [];
    const title = id => chainActions.find(a => a.id === id)?.title || id;
    $('sChains').replaceChildren(...list.map(c => {
      const li = document.createElement('li');
      li.className = 'chain';
      li.innerHTML = `<div class="chain-head"><input class="field chain-name" aria-label="Chain name"><input class="field chain-keys" placeholder="Shortcut" aria-label="Shortcut (press the keys)" readonly>
        <button class="chain-run" title="Run now">${ArchIcons.svg('play')}</button><button class="chain-del" title="Delete chain">${ArchIcons.svg('close')}</button></div>
        <ol class="chain-steps"></ol><select class="field chain-add" aria-label="Add a step"><option value="">＋ Add a step…</option></select><p class="hint chain-msg"></p>`;
      const name = li.querySelector('.chain-name'), keys = li.querySelector('.chain-keys'), msg = li.querySelector('.chain-msg');
      name.value = c.name; keys.value = c.keys || '';
      name.onchange = async () => loadChains(await act('chains', 'update', { id: c.id, name: name.value }));
      name.onkeydown = e => e.stopPropagation();
      keys.onkeydown = async e => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Backspace' || e.key === 'Delete') { loadChains(await act('chains', 'update', { id: c.id, keys: '' })); return; }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        const k = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', /^F\d+$/.test(e.code) ? e.code : e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key].filter(Boolean).join('+');
        const r = await act('chains', 'update', { id: c.id, keys: k });
        if (r?.error) msg.textContent = r.error; else loadChains(r);
      };
      li.querySelector('.chain-run').onclick = () => act('chains', 'run', { id: c.id });
      li.querySelector('.chain-del').onclick = async () => loadChains(await act('chains', 'delete', { id: c.id }));
      li.querySelector('.chain-steps').replaceChildren(...c.steps.map((s, i) => {
        const st = document.createElement('li');
        st.textContent = title(s);
        const x = document.createElement('button'); x.innerHTML = ArchIcons.svg('close'); x.title = 'Remove step';
        x.onclick = async () => loadChains(await act('chains', 'update', { id: c.id, steps: c.steps.filter((_, j) => j !== i) }));
        st.append(x);
        return st;
      }));
      const add = li.querySelector('.chain-add');
      for (const a of chainActions) add.add(new Option(a.title, a.id));
      add.onchange = async () => { if (add.value) loadChains(await act('chains', 'update', { id: c.id, steps: [...c.steps, add.value] })); };
      return li;
    }));
  }
  $('sChainNew').onclick = async () => loadChains(await act('chains', 'new'));

  // ---- wiring
  const setting = (id, key, read = e => e.target.checked) => { $(id).onchange = e => act('setting', key, read(e)); };
  const num = e => Number(e.target.value), val = e => e.target.value;
  setting('sSuggest', 'searchSuggest'); setting('sDarkAll', 'darkAll'); setting('sAutoScroll', 'autoScroll');
  setting('sKeepTabs', 'keepTabs'); setting('sClean', 'cleanLinks'); setting('sVpnBtn', 'vpnButton'); setting('sGpc', 'gpc');
  setting('sLockPriv', 'lockPrivate'); setting('sLockAfter', 'lockAfterMin', num); setting('sMem', 'memLimitMB', num);
  setting('sZoom', 'defaultZoom', num); setting('sFont', 'minFontSize', num); setting('sAskDl', 'askDownload');
  setting('sTrans', 'translateEngine', val); setting('sCompact', 'compact'); setting('sHistText', 'historySearch');
  setting('sGestures', 'gestures'); setting('sBattery', 'batterySaver'); setting('sCycle', 'tabCycle', val);
  setting('sPreviews', 'tabPreviews'); setting('sHwAccel', 'hardwareAcceleration');setting('sSide', 'sidebarSide', val); setting('sEngine', 'searchEngine', val);
  setting('sArchive', 'archiveAfterHours', val); setting('sAutoPip', 'autoPip'); setting('sSleep', 'sleepAfterMin', num);
  setting('sBlockAds', 'blockAds'); setting('sSafe', 'safeBrowsing'); setting('sHttps', 'httpsOnly');
  setting('sCookies', 'cookieBanners'); setting('sFp', 'fingerprinting'); setting('sAutoUpd', 'autoUpdate');
  setting('sClock24', 'clock24'); setting('sClockSec', 'clockSeconds');
  setting('sBgEvery', 'bgEvery', val);
  // sSide moved to the Sidebar section; same setting.

  $('sVpn').onchange = e => act('vpn', e.target.checked);
  $('sCaret').onchange = () => act('caret');
  const click = (id, ...a) => { $(id).onclick = () => act(...a); };
  click('sLockNow', 'lock:now'); click('sTaskMgr', 'taskManager'); click('sReadAloud', 'readAloud'); click('sCaptions', 'liveCaptions');
  click('sImportBrowser', 'importBrowser'); click('sImportHtml', 'importBookmarks'); click('sExportHtml', 'exportBookmarks');
  click('sExportPw', 'exportPasswords'); click('sKeys', 'library', 'shortcuts'); click('sClear', 'clearData');
  click('sImportArc', 'importArc'); click('sPasswords', 'passwords'); click('sHistory', 'library', 'history');
  click('sDownloads', 'library', 'downloads'); click('sSites', 'library', 'sites'); click('sNewWin', 'newWindow', false);
  click('sPrivate', 'newWindow', true); click('sQuit', 'quitAll'); click('sDefault', 'defaultBrowser');
  click('sFilters', 'filters:update'); click('sUpdCheck', 'update:check'); click('sUpdInstall', 'update:install');
  click('sUpdMajor', 'update:major'); click('sUpdRollback', 'update:rollback'); click('sVerCopy', 'about:copy');
  click('sBgPick', 'background', 'pick'); click('sBgRemove', 'background', 'remove');
  // These need the page area back, so Settings closes first.
  $('sBreakGo').onclick = async () => { const m = Number($('sBreak').value); await act('set:close'); act('break:start', m); };
  $('sTour').onclick = async () => { await act('set:close'); act('tour'); };

  // =================================================== customisation sections
  // Appearance, Top bar, Sidebar, New tab. Every control saves at once; sliders
  // save while dragging (throttled) so the window behind updates live.
  const TB_LABELS = { back: 'Back', forward: 'Forward', reload: 'Reload', home: 'Home', newTab: 'New tab', copyUrl: 'Copy URL', ext: 'Extensions', profile: 'Profile', little: 'Little Quasar' };
  const TB_ICONS = { back: 'M15 5l-7 7 7 7', forward: 'M9 5l7 7-7 7', reload: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5', home: 'M4 11l8-7 8 7M6 9.5V20h4v-6h4v6h4V9.5',
    newTab: 'M12 5v14M5 12h14', copyUrl: 'M8 8h12v12H8zM16 8V4H4v12h4', ext: 'M9 3h4v3a2 2 0 1 0 4 0V3h4v6h-3a2 2 0 1 0 0 4h3v8h-6v-3a2 2 0 1 0-4 0v3H3v-8h3a2 2 0 1 0 0-4H3V3z',
    profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', little: 'M5 7h14v11H5zM5 11h14' };
  const FONTS = ['Segoe UI', 'Segoe UI Variable Display', 'Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Cascadia Code', 'Consolas', 'Constantia', 'Corbel',
    'Georgia', 'Inter', 'Lucida Sans Unicode', 'Palatino Linotype', 'Tahoma', 'Trebuchet MS', 'Verdana'];
  const NT_LAYOUT_LABELS = { minimal: 'Minimal', focus: 'Focus', dashboard: 'Dashboard' };
  const throttled = (fn, ms = 60) => { let t = 0, pend = null; return v => { pend = v; if (t) return; t = setTimeout(() => { t = 0; fn(pend); }, ms); }; };
  const setNow = (k, v) => act('setting', k, v);
  const keepFocus = id => document.activeElement === $(id);   // don't overwrite a field being edited

  // ---- Appearance
  function chip(label, on, onclick, title = '') {
    const b = document.createElement('button');
    b.className = 'chip' + (on ? ' on' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(!!on));
    b.textContent = label;
    if (title) b.title = title;
    b.onclick = onclick;
    return b;
  }
  function renderAppearanceSec() {
    const st = S.settings;
    if (changed('aStyles', [S.stylePresets, st.stylePreset])) {
      const cur = st.stylePreset || 'arc';
      $('aStyles').replaceChildren(...Object.entries(S.stylePresets || {}).map(([id, label]) => chip(label, cur === id, () => setNow('stylePreset', id))),
        ...(cur === 'custom' ? [chip('Custom', true, () => {}, 'Your own changes')] : []));
    }
    if (changed('aColors', [S.presets, S.space.colors])) {
      $('aColors').replaceChildren(...(S.presets || []).map(p => {
        const b = document.createElement('button');
        b.className = 'swatch' + (JSON.stringify(p.colors) === JSON.stringify(S.space.colors) ? ' on' : '');
        b.style.background = `linear-gradient(135deg, ${p.colors.join(', ')})`;
        b.title = p.name;
        b.setAttribute('aria-label', p.name);
        b.onclick = () => act('updateSpace', S.space.id, { colors: p.colors });
        return b;
      }));
    }
    if (!keepFocus('aAccent')) $('aAccent').value = st.accent || S.space.colors[1] || S.space.colors[0] || '#6a5acd';
    $('aAccentAuto').disabled = !st.accent;
    $('aAccentNow').textContent = st.accent ? '' : 'Now matching the Space';
    const sel = $('aFont');
    if (!sel.options.length) {
      sel.add(new Option('Quasar default (Segoe UI Variable)', ''));
      for (const f of FONTS) { const o = new Option(f, f); o.style.fontFamily = `"${f}"`; sel.add(o); }
      sel.add(new Option('Another font…', '__other'));
    }
    const font = st.uiFont || '';
    if (!keepFocus('aFont') && !keepFocus('aFontOther')) {
      const known = font === '' || FONTS.includes(font);
      sel.value = known && !$('aFontOther').dataset.open ? font : '__other';
      $('aFontOther').hidden = sel.value !== '__other';
      if (!known) $('aFontOther').value = font;
    }
    rangeVal('aSize', st.uiFontSize ?? 13, v => `${v} px`);
    rangeVal('aRadius', st.radius ?? 10, v => `${v} px`);
    rangeVal('aBlur', st.blur ?? 16, v => (Number(v) ? `${v} px` : 'Off'));
    rangeVal('aTrans', st.transparency ?? 0, v => (Number(v) ? `${Math.round(v * 100)}%` : 'Solid'));
  }
  function rangeVal(id, v, fmt) {
    if (document.activeElement !== $(id)) $(id).value = v;
    $(id + 'Val').textContent = fmt($(id).value);
  }
  const live = (id, key, fmt, num = true) => {
    const send = throttled(v => setNow(key, v));
    $(id).addEventListener('input', e => { $(id + 'Val').textContent = fmt(e.target.value); send(num ? Number(e.target.value) : e.target.value); });
    $(id).addEventListener('change', e => setNow(key, num ? Number(e.target.value) : e.target.value));
  };
  live('aSize', 'uiFontSize', v => `${v} px`);
  live('aRadius', 'radius', v => `${v} px`);
  live('aBlur', 'blur', v => (Number(v) ? `${v} px` : 'Off'));
  live('aTrans', 'transparency', v => (Number(v) ? `${Math.round(v * 100)}%` : 'Solid'));
  const accentLive = throttled(v => setNow('accent', v), 80);
  $('aAccent').addEventListener('input', e => accentLive(e.target.value));
  $('aAccentAuto').onclick = () => setNow('accent', '');
  $('aFont').onchange = e => {
    const v = e.target.value;
    $('aFontOther').hidden = v !== '__other';
    $('aFontOther').dataset.open = v === '__other' ? '1' : '';
    if (v === '__other') return $('aFontOther').focus();
    setNow('uiFont', v);
  };
  $('aFontOther').addEventListener('keydown', e => e.stopPropagation());
  $('aFontOther').addEventListener('input', throttled(() => setNow('uiFont', $('aFontOther').value.trim()), 300));
  $('aExport').onclick = () => act('theme:export');
  $('aImport').onclick = () => act('theme:import');

  // ---- Top bar: drag buttons between Left / Right / Hidden
  let tbDrag = null;
  function tbLayout() {
    const t = S.toolbar || { left: [], right: [] };
    const all = S.tbItems || Object.keys(TB_LABELS);
    return { left: [...t.left], right: [...t.right], hidden: all.filter(id => !t.left.includes(id) && !t.right.includes(id)) };
  }
  function saveTb(z) { act('setting', 'toolbar', { left: z.left, right: z.right }); }
  function moveTb(id, zone, beforeId = null) {
    const z = tbLayout();
    for (const k of ['left', 'right', 'hidden']) z[k] = z[k].filter(x => x !== id);
    const list = z[zone];
    const i = beforeId ? list.indexOf(beforeId) : -1;
    if (i >= 0) list.splice(i, 0, id); else list.push(id);
    saveTb(z);
  }
  function renderToolbarEditor() {
    if (!changed('tbEd', [S.toolbar, S.tbItems])) return;
    const z = tbLayout();
    const focused = document.activeElement?.dataset?.tb;
    for (const zone of document.querySelectorAll('.tb-zone')) {
      const name = zone.dataset.zone;
      zone.querySelector('.tb-chips').replaceChildren(...z[name].map(id => {
        const c = document.createElement('button');
        c.className = 'tb-chip';
        c.draggable = true;
        c.dataset.tb = id;
        c.title = `${TB_LABELS[id]}: drag to move, or use the arrow keys (← → reorder, ↑ ↓ change box)`;
        c.innerHTML = `<svg viewBox="0 0 24 24"><path d="${TB_ICONS[id]}"/></svg><span></span>`;
        c.lastChild.textContent = TB_LABELS[id];
        c.addEventListener('dragstart', e => { tbDrag = id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
        c.addEventListener('dragend', () => { tbDrag = null; document.querySelectorAll('.tb-chip.dragging, .tb-chip.drop-before, .tb-zone.drop').forEach(n => n.classList.remove('dragging', 'drop-before', 'drop')); });
        c.addEventListener('dragover', e => { if (tbDrag && tbDrag !== id) { e.preventDefault(); e.stopPropagation(); c.classList.add('drop-before'); } });
        c.addEventListener('dragleave', () => c.classList.remove('drop-before'));
        c.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); c.classList.remove('drop-before'); if (tbDrag) moveTb(tbDrag, name, id); });
        c.addEventListener('keydown', e => {
          const zones = ['left', 'right', 'hidden'];
          const list = z[name], i = list.indexOf(id);
          if (e.key === 'ArrowLeft' && i > 0) moveTb(id, name, list[i - 1]);
          else if (e.key === 'ArrowRight' && i < list.length - 1) moveTb(id, name, list[i + 2] || null);
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') moveTb(id, zones[(zones.indexOf(name) + (e.key === 'ArrowDown' ? 1 : 2)) % 3]);
          else return;
          e.preventDefault();
          tbRefocus = id;
        });
        return c;
      }));
    }
    const f = tbRefocus || focused;
    tbRefocus = null;
    if (f) document.querySelector(`.tb-chip[data-tb="${f}"]`)?.focus();
  }
  let tbRefocus = null;
  for (const zone of document.querySelectorAll('.tb-zone')) {
    zone.addEventListener('dragover', e => { if (tbDrag) { e.preventDefault(); zone.classList.add('drop'); } });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop'); });
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drop'); if (tbDrag) moveTb(tbDrag, zone.dataset.zone); });
  }
  $('tbReset').onclick = () => act('setting', 'toolbar', { left: ['back', 'forward', 'reload'], right: ['ext', 'copyUrl'] });
  function renderTopbarSec() {
    const st = S.settings;
    renderToolbarEditor();
    $('tbHeight').value = st.tbHeight || 'normal';
    $('tbUrl').value = st.urlDisplay || 'domain';
    $('tbAuto').checked = !!st.tbAutoHide;
    $('tbTint').checked = !!st.tbColor;
    if (!keepFocus('tbColor')) $('tbColor').value = st.tbColor || S.space.colors[0] || '#2d2d54';
    $('tbColor').disabled = $('tbOp').disabled = !st.tbColor;
    rangeVal('tbOp', st.tbOpacity ?? 0.6, v => `${Math.round(v * 100)}%`);
    if (!keepFocus('tbHome') && $('tbHomeMsg').hidden) $('tbHome').value = st.homeUrl || '';
  }
  setting('tbHeight', 'tbHeight', val); setting('tbUrl', 'urlDisplay', val); setting('tbAuto', 'tbAutoHide');
  $('tbTint').onchange = e => setNow('tbColor', e.target.checked ? ($('tbColor').value || '#2d2d54') : '');
  const tbColorLive = throttled(v => setNow('tbColor', v), 80);
  $('tbColor').addEventListener('input', e => tbColorLive(e.target.value));
  live('tbOp', 'tbOpacity', v => `${Math.round(v * 100)}%`);
  $('tbHome').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  // An address Quasar can't use is not saved: say so under the field.
  const urlSetting = (id, key) => {
    $(id).onchange = async e => {
      const r = await setNow(key, e.target.value.trim());
      $(id + 'Msg').textContent = r?.error || '';
      $(id + 'Msg').hidden = !r?.error;
    };
    $(id).addEventListener('input', () => { $(id + 'Msg').hidden = true; });
  };
  urlSetting('tbHome', 'homeUrl');

  // ---- Sidebar
  function renderSidebarSec() {
    const st = S.settings;
    $('sSide').value = ['right', 'top'].includes(st.sidebarSide) ? st.sidebarSide : 'left';
    rangeVal('sbWidth', st.sidebarWidth || 240, v => `${v} px`);
    $('sbCollapsed').checked = !!st.sbCollapsed;
    $('sbCollapsed').disabled = st.sidebarSide === 'top';
    $('sbAuto').checked = !!st.sbAutoHide;
    const sec = { favorites: true, pinned: true, folders: true, downloads: false, history: false, ...(st.sbSections || {}) };
    for (const c of document.querySelectorAll('#sbSecs input')) c.checked = !!sec[c.dataset.sec];
    $('sbTabStyle').value = st.tabStyle || 'both';
    $('sbDensity').value = st.density || 'normal';
    $('sbNewAt').value = st.newTabsAt === 'top' ? 'top' : 'bottom';
  }
  live('sbWidth', 'sidebarWidth', v => `${v} px`);
  setting('sbCollapsed', 'sbCollapsed'); setting('sbAuto', 'sbAutoHide');
  for (const c of document.querySelectorAll('#sbSecs input')) c.onchange = () => setNow('sbSections', { [c.dataset.sec]: c.checked });
  setting('sbTabStyle', 'tabStyle', val); setting('sbDensity', 'density', val); setting('sbNewAt', 'newTabsAt', val);

  // ---- New tab and start page
  const NT_ON = k => { const w = S.settings.ntWidgets || {}; if (k === 'clock') return S.settings.focusClock !== false && w.clock !== false; return k in w ? !!w[k] : ['date', 'greeting', 'links'].includes(k); };
  function renderNewTabSec() {
    const st = S.settings;
    $('ntAction').value = st.newTabAction || 'command';
    $('ntUrl').hidden = $('ntAction').value !== 'url';
    if (!keepFocus('ntUrl') && $('ntUrlMsg').hidden) $('ntUrl').value = st.newTabUrl || '';
    if ($('ntUrl').hidden) $('ntUrlMsg').hidden = true;
    if (changed('ntLayouts', st.ntLayout)) {
      $('ntLayouts').replaceChildren(...Object.entries(NT_LAYOUT_LABELS).map(([id, label]) => chip(label, st.ntLayout === id, () => setNow('ntLayout', id))),
        ...(st.ntLayout && !NT_LAYOUT_LABELS[st.ntLayout] ? [chip('Custom', true, () => {})] : []));
    }
    for (const c of document.querySelectorAll('#ntWidgetBox input')) c.checked = NT_ON(c.dataset.w);
    $('ntGreet').value = st.ntGreet || 'time';
    $('ntName').hidden = $('ntGreet').value !== 'name';
    $('ntMessage').hidden = $('ntGreet').value !== 'custom';
    if (!keepFocus('ntName')) $('ntName').value = st.ntName || '';
    if (!keepFocus('ntMessage')) $('ntMessage').value = st.ntMessage || '';
    $('ntSearchPos').value = st.ntSearch || 'center';
    const eng = $('ntEngine');
    if (!eng.options.length) { eng.add(new Option('Default search engine', '')); (S.engines || []).forEach(n => eng.add(new Option(n, n))); }
    eng.value = st.ntEngine || '';
    eng.disabled = $('ntSearchPos').value === 'hidden';
    $('ntCols').value = String(st.ntCols || 6);
    $('ntTile').value = st.ntTile || 'medium';
    $('ntUnit').value = st.ntUnit === 'f' ? 'f' : 'c';
    if (!keepFocus('ntPlaceIn') && st.ntPlace?.name && !$('ntPlaceIn').dataset.typed) $('ntPlaceIn').value = st.ntPlace.name;
    const choice = st.bgChoice || (st.background ? 'custom' : 'none');
    $('ntColorRow').hidden = choice !== 'color';
    $('ntGradRow').hidden = choice !== 'gradient';
    if (!keepFocus('ntColor')) $('ntColor').value = st.ntColor || '#2d2d54';
    const g = st.ntGradient || ['#6fa8f5', '#f2a7c3'];
    if (!keepFocus('ntGradA')) $('ntGradA').value = g[0];
    if (!keepFocus('ntGradB')) $('ntGradB').value = g[1];
    if (!keepFocus('ntAngle')) $('ntAngle').value = st.ntAngle ?? 135;
    renderLinkList();
    renderPreview();
  }
  setting('ntAction', 'newTabAction', val);
  $('ntAction').addEventListener('change', () => { if ($('ntAction').value === 'url') { $('ntUrl').hidden = false; $('ntUrl').focus(); } });
  $('ntUrl').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  urlSetting('ntUrl', 'newTabUrl');
  for (const c of document.querySelectorAll('#ntWidgetBox input')) c.onchange = () => setNow('ntWidgets', { [c.dataset.w]: c.checked });
  setting('ntGreet', 'ntGreet', val);
  for (const [id, key] of [['ntName', 'ntName'], ['ntMessage', 'ntMessage']]) {
    $(id).addEventListener('keydown', e => e.stopPropagation());
    $(id).addEventListener('input', throttled(() => setNow(key, $(id).value), 250));
  }
  setting('ntSearchPos', 'ntSearch', val); setting('ntEngine', 'ntEngine', val);
  setting('ntCols', 'ntCols', num); setting('ntTile', 'ntTile', val); setting('ntUnit', 'ntUnit', val);
  $('ntPlaceIn').addEventListener('keydown', e => { e.stopPropagation(); e.target.dataset.typed = '1'; if (e.key === 'Enter') $('ntPlaceSet').click(); });
  $('ntPlaceSet').onclick = async () => {
    $('ntPlaceMsg').textContent = 'Looking it up…';
    const r = await act('nt', 'place', { name: $('ntPlaceIn').value });
    delete $('ntPlaceIn').dataset.typed;
    $('ntPlaceMsg').textContent = r?.error || (r?.name ? `Weather for ${r.name}. It shows on the start page.` : 'Weather turned off.');
  };
  const ntColorLive = throttled(v => setNow('ntColor', v), 80);
  $('ntColor').addEventListener('input', e => ntColorLive(e.target.value));
  const gradLive = throttled(() => setNow('ntGradient', [$('ntGradA').value, $('ntGradB').value]), 80);
  $('ntGradA').addEventListener('input', gradLive); $('ntGradB').addEventListener('input', gradLive);
  const angleLive = throttled(v => setNow('ntAngle', Number(v)), 60);
  $('ntAngle').addEventListener('input', e => angleLive(e.target.value));

  // Shortcut list editor (same shortcuts as on the start page).
  let ntDrag = null;
  function renderLinkList() {
    if (!changed('ntLinkList', S.settings.ntLinks)) return;
    const links = S.settings.ntLinks || [];
    $('ntLinkList').replaceChildren(...(links.length ? links.map(l => {
      const li = document.createElement('li');
      li.draggable = true;
      li.innerHTML = `<span class="grip" aria-hidden="true">⋮⋮</span><input class="field nl-icon" maxlength="2048" aria-label="Icon (emoji or image link)" placeholder="Icon"><input class="field nl-name" maxlength="40" aria-label="Name"><input class="field nl-url" aria-label="Address"><button class="kw-x" title="Remove">${ArchIcons.svg('close')}</button>`;
      const [ic, nm, ur] = li.querySelectorAll('input');
      ic.value = l.icon || ''; nm.value = l.title || ''; ur.value = l.url;
      const save = (k, el) => async () => { const r = await act('nt', 'linkEdit', { id: l.id, [k]: el.value }); $('ntLinkMsg').textContent = r?.error || 'Drag to reorder, here or on the start page. With no icon, the site’s own icon is used.'; };
      ic.onchange = save('icon', ic); nm.onchange = save('title', nm); ur.onchange = save('url', ur);
      for (const el of [ic, nm, ur]) el.addEventListener('keydown', e => e.stopPropagation());
      li.querySelector('.kw-x').onclick = () => act('nt', 'linkRemove', { id: l.id });
      li.addEventListener('dragstart', e => { if (e.target.matches('input')) return e.preventDefault(); ntDrag = l.id; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => { ntDrag = null; document.querySelectorAll('#ntLinkList .dragging, #ntLinkList .drop-before').forEach(n => n.classList.remove('dragging', 'drop-before')); });
      li.addEventListener('dragover', e => { if (ntDrag && ntDrag !== l.id) { e.preventDefault(); li.classList.add('drop-before'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
      li.addEventListener('drop', e => { e.preventDefault(); li.classList.remove('drop-before'); if (ntDrag) act('nt', 'linkMove', { id: ntDrag, before: l.id }); });
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'hint', textContent: 'No shortcuts yet. Add one below, or with the + on the start page.' })]));
  }
  $('ntLinkAdd').onclick = async () => {
    const r = await act('nt', 'linkAdd', { url: $('ntLinkUrl').value, title: $('ntLinkName').value, icon: $('ntLinkIcon').value });
    if (r?.error) { $('ntLinkMsg').textContent = r.error; return; }
    $('ntLinkUrl').value = $('ntLinkName').value = $('ntLinkIcon').value = '';
    $('ntLinkMsg').textContent = 'Added.';
  };
  for (const id of ['ntLinkUrl', 'ntLinkName', 'ntLinkIcon']) $(id).addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('ntLinkAdd').click(); });

  // A small picture of the start page, since Settings covers the real one.
  function renderPreview() {
    const st = S.settings;
    const choice = st.bgChoice || (st.background ? 'custom' : 'none');
    const bg = $('ntpBg');
    const g = st.ntGradient || ['#6fa8f5', '#f2a7c3'];
    const photo = choice === 'custom' ? customTile.firstChild.style.backgroundImage
      : choice === 'daily' ? (S.nt?.daily?.url ? `url("${S.nt.daily.url}")` : '')
      : (BGS.find(b => b.id === choice) || (choice === 'rotate' && BGS[0]))?.thumb;
    bg.style.background = choice === 'color' ? (st.ntColor || '#2d2d54')
      : choice === 'gradient' ? `linear-gradient(${st.ntAngle ?? 135}deg, ${g[0]}, ${g[1]})`
      : photo ? `center / cover no-repeat ${photo.startsWith('url(') ? photo : `url("${photo}")`}` : 'var(--bg)';
    const now = new Date();
    $('ntpTime').hidden = !NT_ON('clock');
    $('ntpTime').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !st.clock24 });
    const greet = st.ntGreet === 'custom' && st.ntMessage ? st.ntMessage : st.ntGreet === 'name' && st.ntName ? `Hello, ${st.ntName}` : 'Good day';
    const sub = [NT_ON('date') ? now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '', NT_ON('greeting') && st.ntGreet !== 'off' ? greet : ''].filter(Boolean).join(' · ');
    $('ntpSub').textContent = sub;
    $('ntpSub').hidden = !sub;
    const pos = st.ntSearch || 'center';
    for (const [k, id] of [['top', 'ntpTop'], ['center', 'ntpCenter'], ['bottom', 'ntpBottom']]) $(id).innerHTML = pos === k ? '<i class="ntp-search"></i>' : '';
    const n = Math.min(16, (st.ntLinks || []).length + 1), cols = st.ntCols || 6;
    $('ntpTiles').hidden = !NT_ON('links');
    $('ntpTiles').style.gridTemplateColumns = `repeat(${Math.min(cols, n)}, auto)`;
    $('ntpTiles').dataset.size = st.ntTile || 'medium';
    $('ntpTiles').innerHTML = '<i></i>'.repeat(n);
    const cards = ['weather', 'todo', 'notes', 'closed'].filter(NT_ON);
    $('ntpCards').innerHTML = cards.map(c => `<i title="${c}"></i>`).join('');
    $('ntpCards').hidden = !cards.length;
    $('ntPrev').dataset.layout = st.ntLayout || 'custom';
  }

  function renderCustom() {
    renderAppearanceSec();
    renderTopbarSec();
    renderSidebarSec();
    renderNewTabSec();
  }

  // ---- side nav and search
  const secs = [...document.querySelectorAll('.sec')];
  const links = secs.map(sec => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ni"></span><span></span>`;
    b.firstChild.innerHTML = ArchIcons.svg(sec.dataset.icon);
    b.lastChild.textContent = sec.dataset.title;
    b.onclick = () => { $('setSearch').value = ''; filter(''); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    return b;
  });
  $('setLinks').replaceChildren(...links);
  const main = $('setMain');
  function markCurrent() {
    const top = main.getBoundingClientRect().top + 40;
    let cur = 0;
    secs.forEach((s, i) => { if (!s.hidden && s.getBoundingClientRect().top <= top) cur = i; });
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) cur = secs.findLastIndex(s => !s.hidden);
    links.forEach((l, i) => l.classList.toggle('on', i === cur));
  }
  main.addEventListener('scroll', markCurrent, { passive: true });

  // Search: hide rows (and whole sections) that don't mention every word typed.
  const ROW = 'label.check, .form > .field, .form > .import-btn, .form > .danger, .form > .btn-row, .form > .hint, .form > .bg-grid, .form > ul, .form > .check-grid, .form > .chip-row, .form > .swatch-row, .form > .tb-editor, .form > input[type=range]';
  function filter(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let any = false;
    for (const sec of secs) {
      const head = (sec.dataset.title + ' ' + sec.querySelector('h2').textContent).toLowerCase();
      const secHit = words.every(w => head.includes(w));
      let shown = 0;
      for (const el of sec.querySelectorAll('.form > *')) {
        if (!words.length || secHit) { el.classList.remove('filtered'); continue; }
        // Labels (.lbl) stay with the control right after them.
        const target = el.classList.contains('lbl') ? el.nextElementSibling : el;
        const text = ((el.classList.contains('lbl') ? el.textContent + ' ' : '') + (target?.textContent || '') + ' ' + (target?.getAttribute?.('aria-label') || '') + ' ' +
          [...(target?.querySelectorAll?.('option') || [])].map(o => o.textContent).join(' ')).toLowerCase();
        const lblBefore = el.previousElementSibling?.classList.contains('lbl') ? el.previousElementSibling.textContent.toLowerCase() : '';
        const hit = words.every(w => text.includes(w) || lblBefore.includes(w));
        el.classList.toggle('filtered', !hit);
        if (hit && el.matches(ROW)) shown++;
      }
      sec.hidden = !!words.length && !secHit && !shown;
      if (!sec.hidden) any = true;
    }
    $('setNone').hidden = any;
    links.forEach((l, i) => { l.hidden = secs[i].hidden; });
    markCurrent();
  }
  $('setSearch').addEventListener('input', e => filter(e.target.value));
  $('setSearch').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.target.value = ''; filter(''); e.stopPropagation(); } });

  window.arch.on('ui:view', sec => {
    const el = sec && $('sec-' + (sec === 'focus' ? 'newtab' : sec));
    if (el) el.scrollIntoView({ block: 'start' });
  });
  window.arch.on('state', s => { S = s; render(); });
  act('ready').then(s => { if (s) { S = s; render(); } markCurrent(); });
  loadKeywords(); loadChains();
  $('setSearch').focus();
})();
