// The Command Bar (Ctrl+T / Ctrl+L) and Find bar (Ctrl+F), shown as an
// overlay above the page. Results are computed in the main process.
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q = $('q');
  let mode = 'new', items = [], sel = 0, token = 0;

  window.arch.on('command:open', ({ mode: m, text, space, ui, card, keys, tour, qr, brk, lock, whatsNew, define }) => {
    if (ui) ArchTheme.ui(document.documentElement, ui);
    mode = m;
    // Where the page area is, so the bar sits in the middle of it rather than of the window.
    if (card) {
      document.documentElement.style.setProperty('--card-left', card.left + 'px');
      document.documentElement.style.setProperty('--card-right', card.right + 'px');
    }
    ArchTheme.apply(document.documentElement, space);
    document.documentElement.style.setProperty('--sel', `color-mix(in srgb, ${space.colors[1] || space.colors[0]} 35%, transparent)`);
    const find = mode === 'find';
    const sheet = ['keys', 'tour', 'qr', 'break', 'lock', 'whatsnew', 'define'].includes(mode);
    document.body.classList.toggle('find-mode', find);
    document.body.classList.toggle('break-mode', mode === 'break' || mode === 'lock');
    $('bar').hidden = find || sheet;
    $('find').hidden = !find;
    $('sheet').hidden = !sheet;
    clearInterval(breakT);
    if (mode === 'keys') return showKeys(keys || []);
    if (mode === 'tour') return showTour(tour || {});
    if (mode === 'qr') return showQr(qr || {});
    if (mode === 'whatsnew') return showWhatsNew(whatsNew || {});
    if (mode === 'break') return showBreak(brk || {});
    if (mode === 'lock') return showLock(lock || {});
    if (mode === 'define') return showDefine(define || {});
    if (find) {
      $('fq').value = text || '';
      $('fcount').textContent = '';
      $('fq').focus(); $('fq').select();
      if (text) act('cmd:find', text);
      return;
    }
    $('tag').textContent = mode === 'url' ? 'Current tab' : mode === 'split' ? 'Split view' : mode === 'live' ? 'New Live Folder' : mode === 'tabs' ? 'All tabs' : `${space.emoji || ''} ${space.name}`.trim();
    q.placeholder = mode === 'url' ? 'Enter URL or search…' : mode === 'split' ? 'Open beside this tab: search, URL or a tab…'
      : mode === 'live' ? 'Paste a feed or site address, or github.com/owner/repo (/issues)…' : mode === 'tabs' ? 'Find text in every open tab of this Space…' : 'Search, calculate, convert, or enter URL… (try “w cats”)';
    q.value = text || '';
    // restart the pop animation
    const bar = $('bar'); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
    q.focus(); q.select(); typing = false;
    refresh();
  });

  let typing = false;   // the last change added characters (so the address may be filled in)
  async function refresh() {
    const my = ++token;
    const typed = q.value;
    const res = await act('cmd:query', typed);
    if (my !== token) return;
    items = res || [];
    // Completing the address: the rest of it is filled in and selected, so typing on
    // replaces it, Backspace removes it, and Enter goes to the site.
    const c = items[0]?.complete;
    if (c && typing && q.value === typed && q.selectionEnd === typed.length && c.toLowerCase().startsWith(typed.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')) && !/^(https?:\/\/|www\.)/i.test(typed.trim())) {
      q.value = typed + c.slice(typed.trim().length);
      q.setSelectionRange(typed.length, q.value.length, 'backward');
    } else if (c && !typing) items.shift();   // deleting: don't put it back
    sel = 0;
    draw();
    // The search engine's suggestions (if turned on in Settings), under the search line.
    if (!['new', 'url', 'split'].includes(mode) || !typed.trim()) return;
    const sugg = await act('cmd:suggest', typed);
    if (my !== token || !sugg?.length) return;
    const at = items.findIndex(it => it.type === 'search');
    const have = new Set(items.filter(it => it.type === 'search').map(it => String(it.text).toLowerCase()));
    items.splice(at < 0 ? items.length : at + 1, 0, ...sugg.filter(s => !have.has(s.text.toLowerCase())));
    draw();
  }

  function draw() {
    const ul = $('results');
    ul.replaceChildren();
    let last = null;
    items.forEach((it, i) => {
      if (it.sec && it.sec !== last) {
        const h = document.createElement('li'); h.className = 'sec'; h.textContent = it.sec; ul.append(h);
      }
      last = it.sec;
      const li = document.createElement('li');
      li.className = 'item' + (i === sel ? ' sel' : '');
      const icon = it.favicon ? `<img src="${esc(it.favicon)}" alt="">` : ArchIcons.has(it.icon) ? ArchIcons.svg(it.icon) : esc(it.glyph || '•');
      li.innerHTML = `<span class="ico">${icon}</span><span class="t">${esc(it.title)}${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</span>${it.badge ? `<span class="badge">${esc(it.badge)}</span>` : ''}`;
      li.onmousemove = () => { if (sel !== i) { sel = i; mark(); } };
      li.onclick = () => run(it);
      ul.append(li);
    });
  }
  function mark() {
    const els = $('results').querySelectorAll('.item');
    els.forEach((el, i) => el.classList.toggle('sel', i === sel));
    els[sel]?.scrollIntoView({ block: 'nearest' });
  }
  function run(it) { if (it) act('cmd:run', it, mode); }

  let deb;
  q.addEventListener('input', e => { typing = /^insert(Text|FromPaste|CompositionText)$/.test(e.inputType || ''); clearTimeout(deb); deb = setTimeout(refresh, mode === 'tabs' ? 250 : 50); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!q.value.trim() && !items.length) return act('cmd:close');
      run(items[sel]);
    } else if (e.key === 'Escape') act('cmd:close');
  });
  $('scrim').onclick = () => { if (mode !== 'break' && mode !== 'lock') act(mode === 'tour' ? 'tour:done' : 'cmd:close'); };

  // ------------------------------------------------ a Space locked with Windows Hello
  function showLock({ name, emoji, private: priv }) {
    $('sheetTitle').textContent = '';
    $('sheetBody').innerHTML = `<div class="brk"><div class="brk-ico">${ArchIcons.svg('lock')}</div><h2></h2><p>Unlock with your Windows PIN, fingerprint or face. Press Ctrl+1–9 to go to another Space.</p><p class="lock-msg"></p></div>`;
    $('sheetBody').querySelector('h2').textContent = priv ? 'This private window is locked' : `${emoji ? emoji + ' ' : ''}${name} is locked`;
    $('sheetFoot').innerHTML = '<span class="grow"></span><button id="lUnlock" class="primary">Unlock…</button>';
    const go = async () => {
      $('lUnlock').disabled = true;
      const ok = await act('lock:unlock');
      $('lUnlock').disabled = false;
      if (!ok) $('sheetBody').querySelector('.lock-msg').textContent = 'Not unlocked. Try again.';
    };
    $('lUnlock').onclick = $('sheetClose').onclick = go;
    $('lUnlock').focus();
  }

  // ------------------------------------------- Ctrl+/ keyboard shortcuts
  const kbd = k => k.split(/\+(?!$)/).map(p => `<kbd>${esc(p)}</kbd>`).join('+');
  function showKeys(groups) {
    $('sheetTitle').textContent = 'Keyboard shortcuts';
    $('sheetBody').innerHTML = groups.map(g => `<div class="kgroup"><h3>${esc(g.name)}</h3><div class="kcols">${g.items.map(i =>
      `<div class="krow${i.keys.length ? '' : ' off'}"><span>${esc(i.label)}</span>${i.keys.length ? i.keys.map(kbd).join(' ') : '<small>not set</small>'}</div>`).join('')}</div></div>`).join('');
    $('sheetFoot').innerHTML = '<span class="grow">Press Esc to close</span><button id="kEdit" class="primary">Change shortcuts…</button>';
    $('kEdit').onclick = () => { act('cmd:close'); act('library', 'shortcuts'); };
    $('sheetClose').onclick = () => act('cmd:close');
    $('sheetBody').scrollTop = 0;
    $('sheetClose').focus();
  }

  // ------------------------------------------------ Define (a word's meanings)
  function showDefine({ word, phonetic, meanings = [], more }) {
    $('sheetTitle').textContent = '';
    const body = document.createElement('div');
    body.className = 'def';
    const h = document.createElement('h2'); h.textContent = word || '';
    if (phonetic) { const p = document.createElement('span'); p.className = 'def-ph'; p.textContent = ' ' + phonetic; h.append(p); }
    body.append(h);
    for (const m of meanings) {
      const part = document.createElement('div'); part.className = 'def-part'; part.textContent = m.part;
      const ol = document.createElement('ol');
      for (const d of m.defs) {
        const li = document.createElement('li'); li.textContent = d.text;
        if (d.example) { const ex = document.createElement('div'); ex.className = 'def-ex'; ex.textContent = '“' + d.example + '”'; li.append(ex); }
        ol.append(li);
      }
      body.append(part, ol);
    }
    $('sheetBody').replaceChildren(body);
    $('sheetFoot').innerHTML = '<span class="grow">From the free Dictionary API · Esc to close</span><button id="dMore">More on Wiktionary</button><button id="dDone" class="primary">Done</button>';
    $('dMore').onclick = () => { act('cmd:close'); act('cmd:run', { type: 'url', url: more }, 'new'); };
    $('dDone').onclick = $('sheetClose').onclick = () => act('cmd:close');
    $('sheetBody').scrollTop = 0;
    $('dDone').focus();
  }

  // ------------------------------------------------ QR code for the page
  function showQr({ svg, url, title }) {
    $('sheetTitle').textContent = 'Open this page on your phone';
    $('sheetBody').innerHTML = `<div class="qr"><div class="qr-img">${svg || ''}</div><p class="qr-t"></p><p class="qr-u"></p></div>`;
    $('sheetBody').querySelector('.qr-t').textContent = title || '';
    $('sheetBody').querySelector('.qr-u').textContent = url || '';
    $('sheetFoot').innerHTML = '<span class="grow">Point your phone’s camera at the code.</span><button id="qCopy">Copy link</button><button id="qDone" class="primary">Done</button>';
    $('qCopy').onclick = () => { navigator.clipboard.writeText(url).catch(() => {}); $('qCopy').textContent = 'Copied'; };
    $('qDone').onclick = $('sheetClose').onclick = () => act('cmd:close');
    $('qDone').focus();
  }

  // ------------------------------------------------ "What's new" after an update
  function showWhatsNew({ version, title, items, from }) {
    $('sheetTitle').textContent = '';
    $('sheetBody').innerHTML = `<div class="tour whatsnew"><div class="big">${ArchIcons.svg('sparkle')}</div><h2></h2><p class="wn-sub"></p></div>`;
    const body = $('sheetBody');
    const box = body.querySelector('.whatsnew');
    body.querySelector('h2').textContent = title || 'What’s new';
    body.querySelector('.wn-sub').textContent = from ? `Updated from version ${from} to ${version}.` : `You’re now on version ${version}.`;
    // Items are lines, or { section, items } groups shown under their own heading.
    const list = lines => { const ul = document.createElement('ul'); for (const t of lines || []) { const li = document.createElement('li'); li.textContent = t; ul.append(li); } return ul; };
    let loose = [];
    const flush = () => { if (loose.length) box.append(list(loose)); loose = []; };
    for (const it of items || []) {
      if (it && typeof it === 'object') { flush(); const h = document.createElement('h3'); h.textContent = it.section || ''; box.append(h, list(it.items)); }
      else loose.push(String(it));
    }
    flush();
    $('sheetFoot').innerHTML = '<span class="grow"></span><button id="wnOk" class="primary">Got it</button>';
    $('wnOk').onclick = $('sheetClose').onclick = () => act('cmd:close');
    body.scrollTop = 0;
    $('wnOk').focus();
  }

  // ------------------------------------------------ break mode (focus timer)
  let breakT = null;
  function showBreak({ until, minutes }) {
    $('sheetTitle').textContent = '';
    $('sheetBody').innerHTML = `<div class="brk"><div class="brk-ico">${ArchIcons.svg('coffee')}</div><h2>Taking a break</h2><p>Tabs are hidden and sound is off until the timer ends.</p><div class="brk-time" id="brkTime"></div></div>`;
    $('sheetFoot').innerHTML = '<span class="grow"></span><button id="bEnd" class="primary">End break now</button>';
    $('bEnd').onclick = $('sheetClose').onclick = () => act('break:end');
    const tick = () => {
      const left = Math.max(0, until - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      $('brkTime').textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (!left) { clearInterval(breakT); act('break:end'); }
    };
    tick();
    breakT = setInterval(tick, 500);
    void minutes;
  }

  // ------------------------------------------------ first-start welcome tour
  const SLIDES = [
    { big: 'sidebar', title: 'Welcome to Quasar', text: ['Your tabs live in the sidebar. Pinned tabs stay put; the tabs under “New Tab” are for today.',
      'Tabs you haven’t looked at in a while move to the Archive (the box icon at the bottom), so the list stays short.'] },
    { big: 'keyboard', title: 'The command bar', text: ['Press <kbd>Ctrl</kbd>+<kbd>T</kbd> to search, open a site, jump to any open tab, run a command, or do a quick sum.',
      '<kbd>Ctrl</kbd>+<kbd>L</kbd> edits the address of the tab you’re on.'] },
    { big: 'layers', title: 'Spaces', text: ['Spaces keep work, home and projects apart, each with its own theme and tabs. Switch with <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>9</kbd>, a two-finger swipe on the sidebar, or the icons at the bottom.',
      'Spaces can share a profile (same logins and history) or keep completely separate ones.'] },
    { big: 'split', title: 'Split view and Peek', text: ['<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>=</kbd> puts another tab beside this one. Drag the gap to resize.',
      '<kbd>Shift</kbd>+click a link to look at it in Peek, without leaving the page you’re on.'] },
    { big: 'shield', title: 'Private by default', text: ['Ads and trackers are blocked, dangerous sites are flagged, and passwords, addresses and cards are kept encrypted on this PC.',
      'Press <kbd>Ctrl</kbd>+<kbd>/</kbd> any time to see every shortcut.'] },
  ];
  let slide = 0, tourInfo = {};
  function showTour(info) { tourInfo = info; slide = 0; drawTour(); }
  function drawTour() {
    const s = SLIDES[slide];
    const last = slide === SLIDES.length - 1;
    $('sheetTitle').textContent = '';
    $('sheetBody').innerHTML = `<div class="tour"><div class="big">${ArchIcons.svg(s.big)}</div><h2>${esc(s.title)}</h2>${s.text.map(t => `<p>${t}</p>`).join('')}</div>`;
    $('sheetFoot').innerHTML = `<span class="grow"><span class="dots">${SLIDES.map((x, i) => `<i class="${i === slide ? 'on' : ''}"></i>`).join('')}</span></span>` +
      (last && tourInfo.arc ? '<button id="tArc">Import from Arc…</button>' : '') +
      (slide ? '<button id="tBack">Back</button>' : '<button id="tSkip">Skip</button>') +
      `<button id="tNext" class="primary">${last ? 'Start browsing' : 'Next'}</button>`;
    const done = () => act('tour:done');
    if ($('tSkip')) $('tSkip').onclick = done;
    if ($('tBack')) $('tBack').onclick = () => { slide--; drawTour(); };
    if ($('tArc')) $('tArc').onclick = () => { done(); act('importArc'); };
    $('tNext').onclick = () => { if (last) done(); else { slide++; drawTour(); } };
    $('sheetClose').onclick = done;
    $('tNext').focus();
  }
  document.addEventListener('keydown', e => {
    if ($('sheet').hidden) return;
    if (e.key === 'Escape' && mode !== 'break' && mode !== 'lock') act(mode === 'tour' ? 'tour:done' : 'cmd:close');
    else if (mode === 'tour' && e.key === 'ArrowRight' && slide < SLIDES.length - 1) { slide++; drawTour(); }
    else if (mode === 'tour' && e.key === 'ArrowLeft' && slide > 0) { slide--; drawTour(); }
  });

  // find in page
  const fq = $('fq');
  let fdeb;
  fq.addEventListener('input', () => { clearTimeout(fdeb); fdeb = setTimeout(() => act('cmd:find', fq.value), 80); });
  fq.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); act('cmd:find', fq.value, { next: true, back: e.shiftKey }); }
    else if (e.key === 'Escape') act('cmd:close');
  });
  $('fnext').onclick = () => act('cmd:find', fq.value, { next: true });
  $('fprev').onclick = () => act('cmd:find', fq.value, { next: true, back: true });
  $('fclose').onclick = () => act('cmd:close');
  window.arch.on('find:result', ({ active, matches }) => {
    $('fcount').textContent = fq.value ? `${active}/${matches}` : '';
  });
})();
