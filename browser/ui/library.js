// Quasar Library: History, Downloads and Site settings. All data comes from the
// main process; actions go back through window.arch.act('lib:…').
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const letter = (u, t) => `<span class="ico">${esc((host(u) || t || '?').charAt(0).toUpperCase())}</span>`;

  let section = 'history';
  let spaceId = null;
  let spaces = [];
  const selected = new Set();
  let histLimit = 300;

  const SECTIONS = ['history', 'downloads', 'sites', 'boosts', 'atc', 'extensions', 'shortcuts', 'backup', 'updates'];
  function setSection(s) {
    section = SECTIONS.includes(s) ? s : 'history';
    recording = null;
    document.querySelectorAll('.lib-nav > button').forEach(b => b.classList.toggle('on', b.dataset.sec === section));
    for (const k of SECTIONS) $('sec-' + k).hidden = k !== section;
    document.title = { history: 'History', downloads: 'Downloads', sites: 'Site settings', boosts: 'Boosts', atc: 'Air Traffic Control', extensions: 'Extensions', shortcuts: 'Keyboard shortcuts', backup: 'Backup & sync', updates: 'Updates' }[section] + ' – Quasar';
    load();
  }

  function setSpace(id) {
    spaceId = spaces.some(s => s.id === id) ? id : spaces[0]?.id;
    $('space').value = spaceId;
    const sp = spaces.find(s => s.id === spaceId);
    if (sp) ArchTheme.apply(document.documentElement, sp);
    selected.clear();
    load();
  }

  function load() {
    if (!spaceId) return;
    if (section === 'history') loadHistory();
    else if (section === 'downloads') loadDownloads();
    else if (section === 'boosts') loadBoosts();
    else if (section === 'atc') loadAtc();
    else if (section === 'extensions') loadExtensions();
    else if (section === 'shortcuts') loadShortcuts();
    else if (section === 'updates') loadUpdates();
    else if (section === 'backup') loadBackup();
    else loadSites();
  }

  // ---------------------------------------------------------- Extensions
  const busy = (btn, on) => { btn.disabled = on; };
  async function loadExtensions() {
    const [exts, profs] = await Promise.all([act('lib:extensions'), act('lib:extProfiles')]);
    const list = $('extList');
    if (!exts.length) { list.innerHTML = '<li class="empty-msg" style="padding:18px;text-align:center">No extensions yet.</li>'; return; }
    list.innerHTML = exts.map(e => `<li class="ext-item" data-id="${esc(e.id)}">
      ${e.icon ? `<img src="${esc(e.icon)}" alt="">` : `<span class="noicon">${ArchIcons.svg('puzzle')}</span>`}
      <div class="ext-body"><b>${esc(e.name)} <small style="display:inline">${esc(e.version || '')} · ${esc({ webstore: 'Web Store', arc: 'from Arc', crx: '.crx file', folder: 'unpacked folder' }[e.source] || e.source)}${e.mv === 2 ? ' · Manifest V2' : ''}</small></b>
        <small>${esc(e.description)}</small>
        ${e.permissions.length ? `<small>Can access: ${esc(e.permissions.join(', '))}</small>` : ''}
        ${e.limits?.length ? `<small class="warn">Won’t fully work in Quasar: it uses ${esc(e.limits.join('; '))}.</small>` : ''}
        ${e.error ? `<small class="err">Couldn’t load: ${esc(e.error)}</small>` : ''}${e.missing ? '<small class="err">Its files are missing.</small>' : ''}
        ${e.enabled && profs.length > 1 ? `<div class="ext-spaces"><small>Runs in:</small>${profs.map(p => `<label class="chk small"><input type="checkbox" data-op="space" data-part="${esc(p.partition)}" ${e.offIn.includes(p.partition) ? '' : 'checked'}> ${esc(p.label)}</label>`).join('')}</div>` : ''}</div>
      <div class="ext-acts">
        <label class="toggle"><input type="checkbox" data-op="toggle" ${e.enabled ? 'checked' : ''}> On</label>
        ${e.options ? '<button data-op="options">Options</button>' : ''}
        ${e.source === 'folder' ? '<button data-op="reload">Reload</button>' : ''}
        <button data-op="remove">Remove</button></div></li>`).join('');
  }
  const extMsg = t => { $('extMsg').textContent = t; };
  async function extInstall(op, arg, btn) {
    if (btn) busy(btn, true);
    extMsg('Installing…');
    const r = await act(op, arg);
    if (btn) busy(btn, false);
    if (!r) return extMsg('');
    if (r.cancelled) return extMsg('Not installed.');
    extMsg(r.error ? `Couldn’t install: ${r.error}` : `Installed ${r.name}${r.version ? ' ' + r.version : ''}.`);
    if (!r.error) $('extStore').value = '';
    loadExtensions();
  }
  $('extStoreBtn').onclick = () => extInstall('lib:extInstallStore', $('extStore').value, $('extStoreBtn'));
  $('extStore').onkeydown = e => { if (e.key === 'Enter') $('extStoreBtn').click(); };
  $('extCrx').onclick = () => extInstall('lib:extInstallFile');
  $('extFolder').onclick = () => extInstall('lib:extInstallFolder');
  $('extUpdate').onclick = async () => { busy($('extUpdate'), true); const n = await act('lib:extUpdate'); busy($('extUpdate'), false); extMsg(n ? `Updated ${n} extension${n === 1 ? '' : 's'}.` : 'All extensions are up to date.'); loadExtensions(); };
  $('extArc').onclick = async () => {
    const found = await act('lib:extArc');
    const ul = $('arcExtList');
    ul.hidden = false;
    if (!found.length) { ul.innerHTML = '<li>No Arc extensions found on this PC.</li>'; return; }
    ul.innerHTML = found.map(a => `<li><label class="chk"><input type="checkbox" value="${esc(a.id)}" ${a.installed ? 'disabled' : 'checked'}> ${esc(a.name)} <small>${esc(a.version)}${a.installed ? ' · already added' : ''}</small></label></li>`).join('') +
      '<li><button class="btn small" id="arcGo">Import selected</button></li>';
    $('arcGo').onclick = async () => {
      const ids = [...ul.querySelectorAll('input:checked')].map(i => i.value);
      if (!ids.length) return;
      extMsg('Importing…');
      const res = await act('lib:extImportArc', ids);
      const bad = res.filter(r => r.error);
      extMsg(`Imported ${res.length - bad.length} extension${res.length - bad.length === 1 ? '' : 's'}.${bad.length ? ' Couldn’t import: ' + bad.map(b => `${b.name} (${b.error})`).join('; ') : ''}`);
      ul.hidden = true;
      loadExtensions();
    };
  };
  $('extList').addEventListener('click', async e => {
    const b = e.target.closest('[data-op]'); const li = e.target.closest('.ext-item');
    if (!b || !li || b.dataset.op === 'toggle') return;
    await act('lib:ext', b.dataset.op, li.dataset.id);
    loadExtensions();
  });
  $('extList').addEventListener('change', async e => {
    const li = e.target.closest('.ext-item');
    const b = e.target.closest('[data-op=toggle]');
    if (b && li) { await act('lib:ext', b.checked ? 'enable' : 'disable', li.dataset.id); loadExtensions(); }
    const sp = e.target.closest('[data-op=space]');
    if (sp && li) { await act('lib:extSpace', li.dataset.id, sp.dataset.part, sp.checked); loadExtensions(); }
  });

  // ------------------------------------------------------------- updates
  async function loadUpdates() {
    const s = await act('lib:updates');
    const u = s.engine || {};
    const c = s.components;
    if (u.kind === 'app') $('engText').textContent = `Quasar ${u.current}, Electron ${u.electron} (Chromium ${s.chromium}). The engine and these packages update together with Quasar.`;
    else $('engText').textContent = `Electron ${u.current} (Chromium ${s.chromium}). ` + (u.pendingRestart ? `Electron ${u.pendingRestart} is installed and starts next time.` :
      u.lastCheck ? `Last checked ${new Date(u.lastCheck).toLocaleString()}.` : '') + (u.auto === false ? ' Automatic engine updates are off.' : '');
    $('cmpList').innerHTML = c.list.length ? c.list.map(x => `<li><b>${esc(x.name)}</b> <span>${esc(x.installed || 'not installed')}</span>
      ${x.error ? `<small class="err">${esc(x.error)}</small>` : x.available ? `<small class="new">→ ${esc(x.available)} available</small>` : '<small>up to date</small>'}
      ${x.newerMajor ? `<small>(${esc(x.newerMajor)} is a new major version: not installed automatically)</small>` : ''}</li>`).join('')
      : '<li><small>Not checked yet.</small></li>';
    $('cmpUpdate').hidden = !c.list.some(x => x.available) || c.busy;
    $('cmpUndo').hidden = !c.canRollback || c.busy;
    if (!$('cmpMsg').dataset.keep) $('cmpMsg').textContent = c.busy ? 'Updating…' : c.pendingRestart ? 'Restart Quasar to use the updated components.' : c.lastCheck ? `Checked ${new Date(c.lastCheck).toLocaleString()}.` : '';
    if (c.installed) $('cmpUpdate').hidden = true;   // installed copies get new packages with each Quasar update
    $('selfText').textContent = c.installed
      ? 'Quasar updates itself: new versions are downloaded from its Releases page and installed when you close Quasar (Settings › Updates).'
      : c.git
      ? 'This copy of Quasar is a git checkout: run “git pull” in its folder to get the newest code, then restart.'
      : 'Quasar’s own code isn’t published anywhere Quasar could download it from, so it changes only when you replace its folder. The engine and the components above cover the security-sensitive parts.';
  }
  const cmpMsg = t => { $('cmpMsg').textContent = t; $('cmpMsg').dataset.keep = t ? '1' : ''; };
  $('cmpCheck').onclick = async () => { cmpMsg('Checking…'); $('cmpCheck').disabled = true; await act('lib:cmpCheck'); $('cmpCheck').disabled = false; cmpMsg(''); loadUpdates(); };
  $('cmpUpdate').onclick = async () => { cmpMsg('Downloading, checking and test-starting… (this can take a minute)'); $('cmpUpdate').disabled = true; const r = await act('lib:cmpUpdate'); $('cmpUpdate').disabled = false; cmpMsg(r?.error || r?.summary || ''); loadUpdates(); };
  $('cmpUndo').onclick = async () => { const r = await act('lib:cmpUndo'); cmpMsg(r?.error || r?.summary || ''); loadUpdates(); };

  // ------------------------------------------------- keyboard shortcuts
  // Keys the same way the main process names them (see src/shortcuts.js).
  const CODE_KEYS = { Equal: '=', Minus: '-', Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Backquote: '`', NumpadAdd: '=', NumpadSubtract: '-', NumpadDivide: '/', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', ArrowLeft: 'Left',
    ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Esc' };
  function comboOf(e) {
    let k = '';
    if (/^[a-z]$/i.test(e.key)) k = e.key.toUpperCase();
    else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (/^(Digit|Numpad)\d$/.test(e.code)) k = e.code.slice(-1);
    else if (/^F\d{1,2}$/.test(e.code)) k = e.code;
    else if (CODE_KEYS[e.code]) k = CODE_KEYS[e.code];
    if (!k || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
    return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
  }
  const kbd = k => k.split(/\+(?!$)/).map(p => `<kbd>${esc(p)}</kbd>`).join('+');
  let recording = null;
  async function loadShortcuts() {
    const groups = await act('lib:shortcuts');
    $('keyList').innerHTML = groups.map(g => `<li class="k-group"><h3>${esc(g.name)}</h3></li>` + g.items.map(i => `<li class="k-item${i.fixed ? ' fixed' : ''}" data-id="${esc(i.id || '')}">
      <span class="k-label">${esc(i.label)}${i.custom ? ' <small>(changed)</small>' : ''}</span>
      <span class="k-keys">${recording === i.id ? '<i>Press the new keys… (Esc to cancel)</i>' : i.keys.length ? i.keys.map(kbd).join(' ') : '<small>not set</small>'}</span>
      ${i.fixed ? '<small>fixed</small>' : `<span class="k-acts"><button class="btn ghost small" data-op="set">${i.keys.length ? 'Change' : 'Set'}</button>${i.keys.length ? '<button class="btn ghost small" data-op="add">Add</button><button class="btn ghost small" data-op="clear">Remove</button>' : ''}${i.custom ? '<button class="btn ghost small" data-op="reset">Default</button>' : ''}</span>`}
    </li>`).join('')).join('');
  }
  let recordMode = 'set';
  $('keyList').addEventListener('click', async e => {
    const b = e.target.closest('button[data-op]'); const li = e.target.closest('.k-item');
    if (!b || !li) return;
    const id = li.dataset.id;
    if (b.dataset.op === 'set' || b.dataset.op === 'add') { recording = id; recordMode = b.dataset.op; $('keyMsg').textContent = ''; return loadShortcuts(); }
    if (b.dataset.op === 'clear') await act('lib:setShortcut', id, []);
    if (b.dataset.op === 'reset') await act('lib:setShortcut', id, null);
    loadShortcuts();
  });
  document.addEventListener('keydown', async e => {
    if (!recording) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { recording = null; return loadShortcuts(); }
    const combo = comboOf(e);
    if (!combo) return;   // just a modifier so far
    const id = recording;
    recording = null;
    const groups = await act('lib:shortcuts');
    const cur = groups.flatMap(g => g.items).find(i => i.id === id)?.keys || [];
    const r = await act('lib:setShortcut', id, recordMode === 'add' ? [...cur, combo] : [combo]);
    $('keyMsg').textContent = r?.error ? `Couldn’t use ${combo}: ${r.error}` : r?.moved?.length ? `${combo} was taken from “${r.moved.join('”, “')}”.` : '';
    loadShortcuts();
  }, true);
  $('keyReset').onclick = async () => { if (confirm('Put every keyboard shortcut back to the default?')) { await act('lib:resetShortcuts'); $('keyMsg').textContent = ''; loadShortcuts(); } };

  // ------------------------------------------------------- Backup & sync
  let restoreFile = null;
  async function loadBackup() {
    const s = await act('lib:backupStatus');
    $('abOn').checked = !!s.auto;
    $('abDir').textContent = s.autoDir;
    $('abMsg').textContent = s.lastAuto ? `Last automatic backup: ${new Date(s.lastAuto).toLocaleString()}` : '';
    const y = s.sync || {};
    $('syFolder').value = y.folder || '';
    $('syName').value = y.device || s.defaultDevice || '';
    $('syOn').hidden = !!y.on; $('syNow').hidden = !y.on; $('syOff').hidden = !y.on;
    $('syPass').hidden = !!y.on;
    $('syMsg').textContent = y.on ? `Sync is on.${y.last ? ' Last synced ' + new Date(y.last).toLocaleString() + '.' : ''}${y.error ? ' ' + y.error : ''}` : (y.error || '');
    $('syDevices').innerHTML = (y.devices || []).map(d => `<li>${esc(d.name)} · last change ${new Date(d.at).toLocaleString()}${d.self ? ' (this PC)' : ''}</li>`).join('');
    const rt = (y.remoteTabs || []).filter(d => d.tabs.length);
    $('rtCard').hidden = !y.on || !rt.length;
    $('rtList').innerHTML = rt.map(d => `<h4 class="rt-pc">${ArchIcons.svg('monitor')}${esc(d.name)} <small>· ${d.tabs.length} tab${d.tabs.length === 1 ? '' : 's'} · ${new Date(d.at).toLocaleString()}</small></h4>
      <ul class="rt-tabs">${d.tabs.map(t => `<li><button class="rt-tab" data-url="${esc(t.url)}" data-space="${esc(t.spaceId)}" title="${esc(t.url)}">${letter(t.url, t.title)}<span>${esc(t.title || host(t.url))}</span><small>${esc(host(t.url))}${t.space ? ' · ' + esc(t.space) : ''}</small></button></li>`).join('')}</ul>`).join('');
  }
  $('rtList').addEventListener('click', e => {
    const b = e.target.closest('.rt-tab');
    if (b) act('lib:open', spaces.some(s => s.id === b.dataset.space) ? b.dataset.space : spaceId, b.dataset.url);
  });
  $('bkSave').onclick = async () => {
    const r = await act('lib:backup', { history: $('bkHistory').checked, secrets: $('bkSecrets').checked, pass: $('bkPass').value });
    $('bkMsg').textContent = r?.error ? r.error : r?.file ? `Saved ${r.file}` : '';
    if (r?.file) $('bkPass').value = '';
  };
  $('rsPick').onclick = async () => {
    const r = await act('lib:restorePick');
    if (!r) return;
    restoreFile = r.file;
    $('rsStep').hidden = false;
    $('rsPass').hidden = !r.encrypted;
    $('rsInfo').textContent = r.encrypted ? `${r.name} is encrypted: enter its passphrase.` : r.summary;
    $('rsMsg').textContent = '';
  };
  $('rsGo').onclick = async () => {
    const mode = document.querySelector('input[name=rsMode]:checked').value;
    const r = await act('lib:restore', { file: restoreFile, pass: $('rsPass').value, mode });
    $('rsMsg').textContent = r?.error ? r.error : r?.summary || '';
    if (!r?.error) { $('rsStep').hidden = true; $('rsPass').value = ''; }
  };
  $('abOn').onchange = async e => { await act('lib:autoBackup', e.target.checked); loadBackup(); };
  $('syPick').onclick = async () => { const f = await act('lib:syncPickFolder'); if (f) $('syFolder').value = f; };
  $('syOn').onclick = async () => {
    $('syMsg').textContent = 'Turning on…';
    const r = await act('lib:syncOn', { folder: $('syFolder').value, pass: $('syPass').value, device: $('syName').value });
    $('syMsg').textContent = r?.error || '';
    if (!r?.error) { $('syPass').value = ''; loadBackup(); }
  };
  $('syNow').onclick = async () => { $('syMsg').textContent = 'Syncing…'; const r = await act('lib:syncNow'); $('syMsg').textContent = r?.error || r?.summary || ''; setTimeout(loadBackup, 400); };
  $('syOff').onclick = async () => { await act('lib:syncOff'); loadBackup(); };

  // ------------------------------------------------------------- Boosts
  const spaceOptions = (sel, allLabel) => (allLabel ? `<option value="">${esc(allLabel)}</option>` : '') +
    spaces.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(`${s.emoji} ${s.name}`.trim())}</option>`).join('');
  let boostsDirty = false;   // don't redraw while you're typing
  async function loadBoosts(focusId = null) {
    if (boostsDirty && !focusId) return;
    const boosts = await act('lib:boosts');
    const list = $('boostList');
    if (!boosts.length) { list.innerHTML = '<p class="card empty-msg" style="padding:18px;text-align:center">No Boosts yet. Click “New Boost”, or use the site icon left of the address › Boost this site.</p>'; return; }
    list.innerHTML = boosts.map(b => `<div class="boost" data-id="${esc(b.id)}">
      <div class="row1">
        <label class="toggle"><input type="checkbox" data-k="enabled" ${b.enabled !== false ? 'checked' : ''}> On</label>
        <input class="field name" data-k="name" placeholder="Name (optional)" value="${esc(b.name)}">
        <input class="field" data-k="pattern" placeholder="Site, e.g. youtube.com" value="${esc(b.pattern)}">
        <select class="field" data-k="spaceId" style="flex:0 1 170px">${spaceOptions(b.spaceId, 'All Spaces')}</select>
        <button class="btn ghost danger small" data-op="delete">Delete</button>
      </div>
      <textarea data-k="css" spellcheck="false" placeholder="/* CSS for this site, e.g. */&#10;#comments { display: none !important; }&#10;body { font-family: Georgia, serif; }">${esc(b.css)}</textarea>
      <details ${b.js ? 'open' : ''}><summary>Advanced: JavaScript (runs on each page load, isolated from the site's own scripts)</summary>
        <textarea class="js" data-k="js" spellcheck="false" placeholder="// e.g. document.querySelector('video')?.pause()">${esc(b.js || '')}</textarea>
        <div class="meta"><span>JavaScript changes apply when the page reloads.</span><button class="btn ghost small" data-op="reload">Reload matching tabs</button></div>
      </details>
      <div class="meta"><span class="saved"></span></div>
    </div>`).join('');
    if (focusId) list.querySelector(`.boost[data-id="${CSS.escape(focusId)}"] [data-k=pattern]`)?.focus();
  }
  function readBoost(card) {
    const v = k => card.querySelector(`[data-k=${k}]`);
    return { id: card.dataset.id, enabled: v('enabled').checked, name: v('name').value, pattern: v('pattern').value, spaceId: v('spaceId').value || null, css: v('css').value, js: v('js').value };
  }
  let boostT;
  const saveBoostSoon = card => {
    boostsDirty = true;
    clearTimeout(boostT);
    card.querySelector('.saved').textContent = 'Saving…';
    boostT = setTimeout(async () => { await act('lib:saveBoost', readBoost(card)); card.querySelector('.saved').textContent = 'Saved'; boostsDirty = false; }, 350);
  };
  $('boostList').addEventListener('input', e => { const c = e.target.closest('.boost'); if (c) saveBoostSoon(c); });
  $('boostList').addEventListener('change', e => { const c = e.target.closest('.boost'); if (c) saveBoostSoon(c); });
  $('boostList').addEventListener('click', async e => {
    const b = e.target.closest('button[data-op]'); const c = e.target.closest('.boost');
    if (!b || !c) return;
    if (b.dataset.op === 'delete') { await act('lib:deleteBoost', c.dataset.id); boostsDirty = false; loadBoosts(); }
    if (b.dataset.op === 'reload') { await act('lib:saveBoost', readBoost(c)); const n = await act('lib:reloadMatching', c.dataset.id); c.querySelector('.saved').textContent = `Reloaded ${n} tab${n === 1 ? '' : 's'}`; }
  });
  async function newBoost(pattern = '') {
    const existing = pattern && (await act('lib:boosts')).find(b => b.pattern === pattern);
    const b = existing || await act('lib:saveBoost', { pattern, name: '', css: '', js: '', enabled: true, spaceId: null });
    boostsDirty = false;
    loadBoosts(b.id);
  }
  $('boostNew').onclick = () => newBoost('');

  // ------------------------------------------------- Air Traffic Control
  async function loadAtc() {
    const rules = await act('lib:atc');
    const list = $('atcList');
    if (!rules.length) { list.innerHTML = '<li class="empty-msg" style="padding:18px;text-align:center">No rules yet. Click “Add rule”, or use the site icon left of the address › Always open this site in.</li>'; return; }
    list.innerHTML = rules.map(r => `<li class="atc-item" data-id="${esc(r.id)}">
      <label class="toggle"><input type="checkbox" data-k="enabled" ${r.enabled !== false ? 'checked' : ''}></label>
      <input class="field" data-k="pattern" placeholder="Site, e.g. github.com" value="${esc(r.pattern)}">
      <span class="arrow">opens in</span>
      <select class="field" data-k="spaceId">${spaceOptions(r.spaceId)}</select>
      <button class="x" data-op="delete" title="Delete rule">${X}</button></li>`).join('');
  }
  const readAtc = li => ({ id: li.dataset.id, pattern: li.querySelector('[data-k=pattern]').value, spaceId: li.querySelector('[data-k=spaceId]').value, enabled: li.querySelector('[data-k=enabled]').checked });
  let atcT;
  $('atcList').addEventListener('input', e => { const li = e.target.closest('.atc-item'); if (!li) return; clearTimeout(atcT); atcT = setTimeout(() => act('lib:saveAtc', readAtc(li)), 300); });
  $('atcList').addEventListener('change', e => { const li = e.target.closest('.atc-item'); if (li) act('lib:saveAtc', readAtc(li)); });
  $('atcList').addEventListener('click', async e => { const b = e.target.closest('[data-op=delete]'); if (b) { await act('lib:deleteAtc', b.closest('.atc-item').dataset.id); loadAtc(); } });
  $('atcNew').onclick = async () => { await act('lib:saveAtc', { pattern: '', spaceId: spaceId, enabled: true }); await loadAtc(); [...$('atcList').querySelectorAll('[data-k=pattern]')].pop()?.focus(); };

  function applyPrefill(prefill) {
    if (prefill?.pattern && section === 'boosts') newBoost(prefill.pattern);
  }

  // ----------------------------------------------------------- history
  const dayName = ts => {
    if (!ts) return 'Earlier';
    const d = new Date(ts); const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };
  async function loadHistory() {
    const q = $('histSearch').value;
    const items = await act('lib:history', spaceId, q);
    const sp = spaces.find(s => s.id === spaceId);
    $('histSub').textContent = `${items.length}${items.length >= 2000 ? '+' : ''} pages in ${sp ? `${sp.emoji} ${sp.name}`.trim() : 'this Space'}. Only this Space's history is shown.`;
    const list = $('histList');
    if (!items.length) { list.innerHTML = `<p class="empty-msg" style="padding:18px;text-align:center">${q ? 'No matches.' : 'No history yet.'}</p>`; updateDelete(); return; }
    const out = [];
    let lastDay = null;
    for (const h of items.slice(0, histLimit)) {
      const day = dayName(h.last);
      if (day !== lastDay) { out.push(`<div class="day">${esc(day)}</div>`); lastDay = day; }
      const time = h.last ? new Date(h.last).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
      out.push(`<div class="h-item" data-url="${esc(h.url)}">
        <input type="checkbox" aria-label="Select" ${selected.has(h.url) ? 'checked' : ''}>
        <span class="time">${esc(time)}</span>${letter(h.url, h.title)}
        <a title="${esc(h.url)}">${esc(h.title || h.url)}</a>
        <span class="host">${esc(host(h.url))}</span>
        <button class="x" title="Remove from history">${X}</button></div>`);
    }
    if (items.length > histLimit) out.push(`<button class="btn ghost more" id="histMore">Show more</button>`);
    list.innerHTML = out.join('');
    $('histMore')?.addEventListener('click', () => { histLimit += 500; loadHistory(); });
    updateDelete();
  }
  $('histList').addEventListener('click', async e => {
    const row = e.target.closest('.h-item');
    if (!row) return;
    const url = row.dataset.url;
    if (e.target.closest('.x')) { await act('lib:deleteHistory', spaceId, [url]); selected.delete(url); return loadHistory(); }
    if (e.target.matches('input[type=checkbox]')) { e.target.checked ? selected.add(url) : selected.delete(url); return updateDelete(); }
    if (e.target.closest('a')) act('lib:open', spaceId, url);
  });
  function updateDelete() { $('histDelete').disabled = !selected.size; $('histDelete').textContent = selected.size ? `Delete ${selected.size} selected` : 'Delete selected'; }
  $('histDelete').onclick = async () => { await act('lib:deleteHistory', spaceId, [...selected]); selected.clear(); loadHistory(); };
  $('histClear').onclick = async () => { if (await act('lib:clearHistory', spaceId)) { selected.clear(); loadHistory(); } };
  let searchT;
  $('histSearch').oninput = () => { clearTimeout(searchT); searchT = setTimeout(() => { histLimit = 300; loadHistory(); }, 150); };

  // --------------------------------------------------------- downloads
  const size = n => {
    if (!n && n !== 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(v < 10 ? 1 : 0) : v) + ' ' + u[i];
  };
  async function loadDownloads() {
    let items = await act('lib:downloads');
    if (!$('dlAll').checked) items = items.filter(d => d.spaceId === spaceId);
    const list = $('dlList');
    if (!items.length) { list.innerHTML = '<li class="empty-msg" style="padding:18px;text-align:center">No downloads.</li>'; return; }
    list.innerHTML = items.map(d => {
      const running = d.state === 'progressing';
      const pct = d.total ? Math.min(100, (d.received / d.total) * 100) : 0;
      let meta = '';
      if (running) meta = d.paused ? `Paused — ${size(d.received)}${d.total ? ' of ' + size(d.total) : ''}` : `${size(d.received)}${d.total ? ' of ' + size(d.total) : ''}`;
      else if (d.state === 'completed') meta = `${size(d.total || d.received)} · ${new Date(d.end || d.start).toLocaleString()}${d.exists ? '' : ' · file moved or deleted'}`;
      else if (d.state === 'cancelled') meta = 'Cancelled';
      else if (d.resumable) meta = `Stopped when Quasar closed — ${size(d.received)}${d.total ? ' of ' + size(d.total) : ''} saved, can continue`;
      else meta = 'Failed' + (d.received ? ` after ${size(d.received)}` : '');
      const btns = [];
      if (running && !d.paused) btns.push('<button data-op="pause">Pause</button>');
      if (running && d.paused) btns.push('<button data-op="resume">Resume</button>');
      if (running) btns.push('<button data-op="cancel">Cancel</button>');
      if (d.resumable) btns.push('<button data-op="resume">Resume</button>', '<button data-op="cancel">Cancel</button>');
      else if (d.state === 'interrupted' || d.state === 'cancelled') btns.push('<button data-op="retry">Retry</button>');
      if (d.state === 'completed' && d.exists) btns.push('<button data-op="open">Open</button>', '<button data-op="show">Show in folder</button>');
      if (d.state === 'completed' && !d.exists) btns.push('<button data-op="retry">Download again</button>');
      btns.push('<button data-op="copy">Copy link</button>');
      if (!running) btns.push(`<button data-op="remove" title="Remove from list">Remove</button>`);
      return `<li class="d-item" data-id="${esc(d.id)}">${letter(d.url, d.filename)}
        <div class="d-body"><div class="d-name ${d.state === 'completed' && !d.exists ? 'gone' : ''}">${esc(d.filename)}</div>
          <div class="d-url" title="${esc(d.url)}">${esc(d.url)}</div>
          <div class="d-meta">${esc(meta)}</div>
          ${running ? `<div class="bar ${d.total ? '' : 'indet'}"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}</div>
        <div class="d-acts">${btns.join('')}</div></li>`;
    }).join('');
  }
  $('dlList').addEventListener('click', async e => {
    const b = e.target.closest('button[data-op]');
    const row = e.target.closest('.d-item');
    if (!b || !row) return;
    await act('lib:dl', b.dataset.op, row.dataset.id);
    loadDownloads();
  });
  $('dlAll').onchange = loadDownloads;
  $('dlClear').onclick = async () => { await act('lib:clearDownloads'); loadDownloads(); };

  // ------------------------------------------------------ site settings
  const PERM = { media: 'Camera and microphone', geolocation: 'Location', notifications: 'Notifications', midi: 'MIDI devices',
    midiSysex: 'MIDI devices (full control)', 'clipboard-read': 'Clipboard', 'display-capture': 'Screen sharing', 'idle-detection': 'Idle detection' };
  async function loadSites() {
    const q = $('siteSearch').value.trim().toLowerCase();
    let sites = await act('lib:sites', spaceId);
    if (q) sites = sites.filter(s => s.host.toLowerCase().includes(q));
    const list = $('siteList');
    if (!sites.length) {
      list.innerHTML = `<li class="empty-msg" style="padding:18px;text-align:center">${q ? 'No matches.' : 'No site settings yet. When a site asks for your camera, location and so on, your answer shows up here.'}</li>`;
      return;
    }
    list.innerHTML = sites.map(s => `<li class="s-item" data-origin="${esc(s.origin)}">${letter(s.origin, s.host)}
      <span class="s-host" title="${esc(s.origin)}">${esc(s.host)}</span>
      <button class="btn ghost small" data-op="clear">Clear cookies and data…</button>
      <div class="s-rows">
        ${s.perms.map(p => `<div class="s-row"><span>${esc(PERM[p.perm] || p.perm)}</span>
          <select data-key="${esc(p.key)}" aria-label="${esc(PERM[p.perm] || p.perm)}">
            <option value="allow" ${p.allowed ? 'selected' : ''}>Allow</option>
            <option value="block" ${!p.allowed ? 'selected' : ''}>Block</option>
            <option value="ask">Ask next time</option>
          </select></div>`).join('')}
        ${s.zoom ? `<div class="s-row"><span>Zoom ${s.zoom.pct}%</span><button class="btn ghost small" data-op="zoom" data-host="${esc(s.zoom.host)}">Reset to 100%</button></div>` : ''}
        ${(s.devices || []).map(d => `<div class="s-row"><span>Can use your ${esc(d.label)}</span><button class="btn ghost small" data-op="device" data-key="${esc(d.key)}">Remove access</button></div>`).join('')}
      </div></li>`).join('');
  }
  $('siteList').addEventListener('change', async e => {
    const sel = e.target.closest('select[data-key]');
    if (!sel) return;
    await act('lib:setPerm', sel.dataset.key, sel.value === 'ask' ? null : sel.value === 'allow');
    loadSites();
  });
  $('siteList').addEventListener('click', async e => {
    const b = e.target.closest('button[data-op]');
    if (!b) return;
    const origin = b.closest('.s-item').dataset.origin;
    if (b.dataset.op === 'zoom') await act('lib:resetZoom', spaceId, b.dataset.host);
    if (b.dataset.op === 'clear') await act('lib:clearSite', spaceId, origin);
    if (b.dataset.op === 'device') await act('lib:forgetDevice', b.dataset.key);
    loadSites();
  });
  $('siteSearch').oninput = () => { clearTimeout(searchT); searchT = setTimeout(loadSites, 150); };

  // ------------------------------------------------------ default browser
  async function loadDefault() {
    const { isDefault } = await act('lib:defaultStatus') || {};
    $('defaultText').textContent = isDefault ? 'Quasar is your default browser.' : 'Quasar isn’t your default browser.';
    $('makeDefault').hidden = !!isDefault;
  }
  $('makeDefault').onclick = async () => { await act('lib:makeDefault'); setTimeout(loadDefault, 4000); };
  window.addEventListener('focus', loadDefault);

  // ------------------------------------------------------------- wiring
  document.querySelectorAll('.lib-nav > button').forEach(b => b.onclick = () => setSection(b.dataset.sec));
  $('space').onchange = e => setSpace(e.target.value);
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); setSection('history'); }
    if (e.ctrlKey && e.key.toLowerCase() === 'j') { e.preventDefault(); setSection('downloads'); }
    if (e.ctrlKey && e.key.toLowerCase() === 'f' && section === 'history') { e.preventDefault(); $('histSearch').focus(); }
  });
  let updT;
  window.arch.on('lib:update', () => { clearTimeout(updT); updT = setTimeout(load, 80); });
  window.arch.on('lib:show', ({ section: s, spaceId: id, prefill }) => { if (id && spaces.some(x => x.id === id)) { spaceId = id; $('space').value = id; } setSection(s); applyPrefill(prefill); });

  act('lib:init').then(init => {
    spaces = init.spaces;
    $('space').replaceChildren(...spaces.map(s => new Option(`${s.emoji} ${s.name}`.trim(), s.id)));
    spaceId = init.spaceId;
    setSpace(init.spaceId);
    setSection(init.section);
    applyPrefill(init.prefill);
    loadDefault();
  });
})();
