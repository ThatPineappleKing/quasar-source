// Quasar's task manager: memory and CPU for each tab (and Quasar's own processes), refreshed every 2 seconds.
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  let data = null, sel = null, sortKey = 'mem', sortDir = -1;
  const fmt = mb => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB');

  async function load() {
    data = await act('tm:list');
    if (!data) return;
    draw();
  }
  function draw() {
    const rows = [...data.rows].sort((a, b) => (typeof a[sortKey] === 'number' ? (a[sortKey] - b[sortKey]) : String(a[sortKey]).localeCompare(String(b[sortKey]))) * sortDir);
    const key = r => r.id || 'p' + r.pid;
    $('rows').replaceChildren(...rows.map(r => {
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      if (sel === key(r)) tr.className = 'sel';
      const t = document.createElement('td'); t.textContent = r.title; if (r.sub) { const s = document.createElement('small'); s.textContent = r.sub; t.append(s); }
      const k = document.createElement('td'); k.className = 'kind'; k.textContent = r.kind;
      const m = document.createElement('td'); m.className = 'num'; m.textContent = fmt(r.mem);
      const c = document.createElement('td'); c.className = 'num'; c.textContent = r.cpu.toFixed(1) + '%';
      const p = document.createElement('td'); p.className = 'num'; p.textContent = r.pid;
      tr.append(t, k, m, c, p);
      tr.onclick = () => { sel = key(r); draw(); };
      tr.ondblclick = () => r.id && act('tm:show', r.id);
      tr.onkeydown = e => { if (e.key === 'Enter' && r.id) act('tm:show', r.id); if (e.key === 'Delete' && r.canEnd) $('end').click(); };
      return tr;
    }));
    const cur = data.rows.find(r => key(r) === sel);
    $('end').disabled = $('sleep').disabled = $('show').disabled = !cur?.canEnd;
    $('sum').textContent = `Quasar is using ${fmt(data.total)} · ${data.rows.filter(r => r.kind === 'Tab').length} tabs loaded, ${data.sleeping} asleep`;
    if (document.activeElement !== $('limit')) $('limit').value = String(data.limit || 0);
    $('limitHint').textContent = data.limit ? `Over ${fmt(data.limit)}, the tabs you used least recently go to sleep.` : '';
  }
  document.querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (k === 'title' || k === 'kind' ? 1 : -1); sortKey = k; draw(); });
  const selected = () => data?.rows.find(r => (r.id || 'p' + r.pid) === sel);
  $('end').onclick = async () => { const r = selected(); if (r?.id && confirm(`End “${r.title}”? The tab shows a “crashed” page you can reload.`)) { await act('tm:end', r.id); load(); } };
  $('sleep').onclick = async () => { const r = selected(); if (r?.id) { await act('tm:sleep', r.id); setTimeout(load, 600); } };
  $('show').onclick = () => { const r = selected(); if (r?.id) act('tm:show', r.id); };
  $('limit').onchange = async e => { data = await act('tm:limit', Number(e.target.value)); draw(); };
  load();
  setInterval(load, 2000);
})();
