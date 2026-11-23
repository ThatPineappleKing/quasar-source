(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  const host = o => { try { return new URL(o).hostname.replace(/^www\./, ''); } catch { return o; } };
  const ICON = {
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };
  let data = null;
  const revealed = new Map(); // id -> password (only while this window is open)

  async function load() {
    data = await act('pwm:list');
    ArchTheme.apply(document.documentElement, data.space);
    const fill = (sel, withAll, def) => {
      const cur = sel.value || def;
      sel.replaceChildren(...(withAll ? [new Option('All Spaces', '')] : []), ...data.spaces.map(s => new Option(s.name, s.key)));
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    };
    fill($('profile'), true, '');
    fill($('importProfile'), false, data.current);
    render();
  }
  const spaceName = key => data.spaces.find(s => s.key === key)?.name || 'Deleted Space';

  function render() {
    const q = $('search').value.trim().toLowerCase();
    const prof = $('profile').value;
    const only = $('onlyIssues').checked;
    const rows = data.entries.filter(e => (!prof || e.profile === prof) && (!only || e.weak || e.reused || e.breached) &&
      (!q || e.origin.toLowerCase().includes(q) || e.username.toLowerCase().includes(q)));
    // Password checkup summary.
    const weak = data.entries.filter(e => e.weak).length, reused = data.entries.filter(e => e.reused).length;
    $('checkup').hidden = !data.entries.length;
    $('checkupText').textContent = weak || reused
      ? [weak && `${weak} weak password${weak === 1 ? '' : 's'}`, reused && `${reused} password${reused === 1 ? ' is' : 's are'} used on more than one site`].filter(Boolean).join(' · ') +
        '. Change them on those sites: Quasar suggests a strong password when you set a new one.'
      : 'No weak or reused passwords.';
    $('summary').textContent = `${data.entries.length} saved password${data.entries.length === 1 ? '' : 's'}` +
      (data.available ? '' : ' · Windows encryption unavailable: saving is disabled');
    $('empty').hidden = data.entries.length > 0;
    $('list').replaceChildren(...rows.map(e => {
      const li = document.createElement('li');
      li.className = 'pw-item';
      const pw = revealed.get(e.id);
      li.innerHTML = `<span class="ico"></span>
        <span class="site"></span><span class="user"></span>
        <span class="pass ${pw == null ? 'hidden-pw' : ''}"></span>
        <span class="acts">
          <button data-a="reveal" title="${pw == null ? 'Show' : 'Hide'} password">${pw == null ? ICON.eye : ICON.eyeOff}</button>
          <button data-a="copy" title="Copy password">${ICON.copy}</button>
          <button data-a="copyUser" title="Copy username">${ICON.user}</button>
          <button data-a="otp" title="${e.hasOtp ? 'Authenticator code (click to copy; right-click to change or remove)' : 'Add an authenticator (2FA) key'}" class="${e.hasOtp ? 'otp-on' : ''}">${ArchIcons.svg('hash')}</button>
          <button data-a="del" class="del" title="Delete">${ICON.del}</button>
        </span>`;
      li.querySelector('.ico').textContent = host(e.origin).charAt(0).toUpperCase();
      const site = li.querySelector('.site');
      site.textContent = host(e.origin);
      const small = document.createElement('small'); small.textContent = spaceName(e.profile); site.append(small);
      li.querySelector('.user').textContent = e.username || '(no username)';
      if (e.weak) { const f = document.createElement('span'); f.className = 'flag weak'; f.textContent = 'Weak'; site.append(f); }
      if (e.reused) { const f = document.createElement('span'); f.className = 'flag reused'; f.textContent = `Reused on ${e.reused} other site${e.reused === 1 ? '' : 's'}`; site.append(f); }
      if (e.breached) { const f = document.createElement('span'); f.className = 'flag weak'; f.textContent = `Found in data breaches (${e.breached.toLocaleString()}×)`; site.append(f); }
      li.querySelector('[data-a=otp]').oncontextmenu = ev => { ev.preventDefault(); if (e.hasOtp) editOtp(e, li); };
      li.querySelector('.pass').textContent = pw ?? '••••••••';
      li.querySelector('.acts').onclick = async ev => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'reveal') {
          if (revealed.has(e.id)) revealed.delete(e.id);
          else { const p = await act('pwm:reveal', e.id); if (p != null) revealed.set(e.id, p); }
          render();
        } else if (a === 'copy') { if (await act('pwm:copy', e.id)) flash(li, 'Password copied'); }
        else if (a === 'copyUser') { await act('pwm:copyUser', e.id); flash(li, 'Username copied'); }
        else if (a === 'del') { if (await act('pwm:delete', e.id)) { revealed.delete(e.id); load(); } }
        else if (a === 'otp') {
          if (!e.hasOtp) return editOtp(e, li);
          const c = await act('pwm:otpCode', e.id);
          if (c && await act('pwm:otpCopy', e.id)) flash(li, `Code ${c.code} copied (changes in ${c.left}s)`);
        }
      };
      return li;
    }));
    renderAddresses();
    renderCards();
    $('neverCard').hidden = !data.never.length;
    $('never').replaceChildren(...data.never.map(n => {
      const li = document.createElement('li');
      li.textContent = `${host(n.site)} · ${spaceName(n.profile)}`;
      const b = document.createElement('button'); b.textContent = '✕'; b.title = 'Allow saving again';
      b.onclick = async () => { await act('pwm:removeNever', n.profile, n.site); load(); };
      li.append(b);
      return li;
    }));
  }

  // ---- saved addresses
  const FIELDS = ['label', 'name', 'org', 'street', 'line2', 'city', 'region', 'postal', 'country', 'phone', 'email'];
  let editing = null;
  function renderAddresses() {
    const prof = $('profile').value;
    const list = (data.addresses || []).filter(a => !prof || a.profile === prof);
    $('addrList').replaceChildren(...(list.length ? list.map(a => {
      const li = document.createElement('li');
      const main = document.createElement('span'); main.className = 'a-main';
      const b = document.createElement('b'); b.textContent = `${a.label || a.name || 'Address'}`;
      const s = document.createElement('small');
      s.textContent = [a.label ? a.name : '', a.street, a.line2, a.city, a.region, a.postal, a.country].filter(Boolean).join(', ') + ` · ${spaceName(a.profile)}`;
      main.append(b, s);
      const acts = document.createElement('span'); acts.className = 'acts';
      acts.innerHTML = `<button data-a="edit" title="Edit">✎</button><button data-a="del" class="del" title="Delete">${ICON.del}</button>`;
      acts.onclick = async ev => {
        const x = ev.target.closest('[data-a]')?.dataset.a;
        if (x === 'edit') openForm(a);
        if (x === 'del') { await act('pwm:deleteAddress', a.id); load(); }
      };
      li.append(main, acts);
      return li;
    }) : [Object.assign(document.createElement('li'), { textContent: 'No saved addresses yet. Add one here, or submit an address form on a site and choose Save.', className: 'empty-addr' })]));
  }
  function openForm(a = null) {
    editing = a?.id || null;
    const f = $('addrForm');
    const sel = f.elements.profile;
    sel.replaceChildren(...data.spaces.map(s => new Option(s.name, s.key)));
    sel.value = a?.profile || $('profile').value || data.current;
    for (const k of FIELDS) f.elements[k].value = a?.[k] || '';
    f.hidden = false;
    f.elements.label.focus();
  }
  $('addrNew').onclick = () => openForm();
  $('addrCancel').onclick = () => { $('addrForm').hidden = true; };
  $('addrForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const a = { id: editing, profile: f.elements.profile.value };
    for (const k of FIELDS) a[k] = f.elements[k].value;
    if (!a.street && !a.name) return f.elements.street.focus();
    await act('pwm:saveAddress', a);
    f.hidden = true;
    load();
  };
  $('onlyIssues').onchange = () => render();

  // ---- payment cards (only the last four digits are sent to this window, unless you unlock one)
  let editingCard = null;
  const shownCards = new Map();
  function renderCards() {
    const prof = $('profile').value;
    const list = (data.cards || []).filter(c => !prof || c.profile === prof);
    $('cardList').replaceChildren(...(list.length ? list.map(c => {
      const li = document.createElement('li');
      const main = document.createElement('span'); main.className = 'a-main';
      const b = document.createElement('b'); b.textContent = `${c.nickname || c.brand} ${shownCards.get(c.id) || '•••• ' + c.last4}`;
      const s = document.createElement('small');
      s.textContent = [c.brand, c.month && c.year ? `expires ${String(c.month).padStart(2, '0')}/${c.year}` : '', c.name].filter(Boolean).join(' · ') + ` · ${spaceName(c.profile)}`;
      main.append(b, s);
      const acts = document.createElement('span'); acts.className = 'acts';
      acts.innerHTML = `<button data-a="show" title="${shownCards.has(c.id) ? 'Hide' : 'Show'} number">${shownCards.has(c.id) ? ICON.eyeOff : ICON.eye}</button><button data-a="edit" title="Edit">✎</button><button data-a="del" class="del" title="Delete">${ICON.del}</button>`;
      acts.onclick = async ev => {
        const x = ev.target.closest('[data-a]')?.dataset.a;
        if (x === 'show') { if (shownCards.has(c.id)) shownCards.delete(c.id); else { const n = await act('pwm:revealCard', c.id); if (n) shownCards.set(c.id, n); } renderCards(); }
        if (x === 'edit') openCardForm(c);
        if (x === 'del') { if (await act('pwm:deleteCard', c.id)) load(); }
      };
      li.append(main, acts);
      return li;
    }) : [Object.assign(document.createElement('li'), { textContent: 'No saved cards. Add one here, or pay on a site and choose Save card.', className: 'empty-addr' })]));
  }
  function openCardForm(c = null) {
    editingCard = c?.id || null;
    const f = $('cardForm');
    f.elements.profile.replaceChildren(...data.spaces.map(s => new Option(s.name, s.key)));
    f.elements.profile.value = c?.profile || $('profile').value || data.current;
    f.elements.number.value = '';
    f.elements.number.placeholder = c ? `Card number (leave empty to keep •••• ${c.last4})` : 'Card number';
    f.elements.name.value = c?.name || '';
    f.elements.nickname.value = c?.nickname || '';
    f.elements.month.value = c?.month ? String(c.month).padStart(2, '0') : '';
    f.elements.year.value = c?.year || '';
    $('cardErr').hidden = true;
    f.hidden = false;
    f.elements.number.focus();
  }
  $('cardNew').onclick = () => openCardForm();
  $('cardCancel').onclick = () => { $('cardForm').hidden = true; };
  $('cardForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const r = await act('pwm:saveCard', { id: editingCard, profile: f.elements.profile.value, number: f.elements.number.value, name: f.elements.name.value,
      nickname: f.elements.nickname.value, month: f.elements.month.value, year: f.elements.year.value });
    if (r?.error) { $('cardErr').textContent = r.error; $('cardErr').hidden = false; return; }
    f.hidden = true;
    load();
  };

  // Add, change or remove a login's authenticator key, in a small box under the row.
  function editOtp(e, li) {
    li.parentElement.querySelectorAll('.otp-form').forEach(f => f.remove());
    const f = document.createElement('form');
    f.className = 'otp-form';
    f.innerHTML = `<input class="field" placeholder="Setup key (e.g. JBSW Y3DP EHPK 3PXP) or otpauth:// link" autocomplete="off" spellcheck="false">
      <button type="submit" class="btn small">Save</button>${e.hasOtp ? '<button type="button" class="btn small ghost" data-x="rm">Remove</button>' : ''}<button type="button" class="btn small ghost" data-x="cancel">Cancel</button><p class="form-err" hidden></p>`;
    f.onsubmit = async ev => {
      ev.preventDefault();
      const r = await act('pwm:otpSet', e.id, f.querySelector('input').value);
      if (r?.error) { const p = f.querySelector('.form-err'); p.textContent = r.error; p.hidden = false; return; }
      f.remove(); load();
    };
    f.onclick = async ev => {
      const x = ev.target.closest('[data-x]')?.dataset.x;
      if (x === 'cancel') f.remove();
      if (x === 'rm') { await act('pwm:otpSet', e.id, ''); f.remove(); load(); }
    };
    li.after(f);
    f.querySelector('input').focus();
  }

  function flash(li, text) {
    const s = li.querySelector('.user');
    const old = s.textContent;
    s.textContent = text;
    setTimeout(() => { s.textContent = old; }, 1200);
  }

  $('search').oninput = render;
  $('profile').onchange = render;
  $('importBtn').onclick = async () => { await act('pwm:import', $('importProfile').value); load(); };
  $('exportBtn').onclick = () => act('pwm:export');
  $('breachBtn').onclick = async () => {
    $('breachBtn').disabled = true;
    $('breachText').textContent = 'Checking…';
    const r = await act('pwm:breach');
    $('breachBtn').disabled = false;
    if (!r) { $('breachText').textContent = ''; return; }
    $('breachText').textContent = r.failed && !r.breached ? 'Couldn’t reach the breach database. Check your connection and try again.'
      : r.breached ? `${r.breached} of your ${r.checked} passwords appeared in data breaches. Change them on those sites first.` : `None of your ${r.checked} passwords appeared in a known data breach.`;
    load();
  };
  // Hide revealed passwords when the window loses focus.
  window.addEventListener('blur', () => { if (revealed.size || shownCards.size) { revealed.clear(); shownCards.clear(); render(); } });
  load();
})();
