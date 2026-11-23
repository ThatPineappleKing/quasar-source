// Device chooser for WebUSB / Web Serial / WebHID / Web Bluetooth requests.
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  let sel = null, view = null;

  function draw(v) {
    view = v;
    $('head').innerHTML = '';
    const b = document.createElement('b'); b.textContent = v.host;
    $('head').append(b, ` wants to ${v.verb}`);
    $('note').innerHTML = '';
    if (v.scanning) { const s = document.createElement('span'); s.className = 'scan'; $('note').append(s, 'Looking for devices nearby… '); }
    $('note').append(`Only the ${v.title} you choose is shared with this site.`);
    if (!v.list.some(d => d.id === sel)) sel = null;
    $('list').replaceChildren(...(v.list.length ? v.list.map(d => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      if (d.id === sel) li.className = 'sel';
      const n = document.createElement('b'); n.textContent = d.name;
      const s = document.createElement('small'); s.textContent = d.sub || '';
      li.append(n, s);
      li.onclick = () => { sel = d.id; draw(view); };
      li.ondblclick = () => act('chooser:pick', d.id);
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'empty', textContent: v.scanning ? 'No devices found yet.' : `No compatible ${v.title}s are connected. Plug one in and it will show up here.` })]));
    $('ok').disabled = !sel;
  }

  $('ok').onclick = () => sel && act('chooser:pick', sel);
  $('cancel').onclick = () => act('chooser:cancel');
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') act('chooser:cancel');
    else if (e.key === 'Enter' && sel) act('chooser:pick', sel);
  });
  window.arch.on('chooser:list', draw);
  act('chooser:init').then(v => v && draw(v));
})();
