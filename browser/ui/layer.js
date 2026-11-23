// Floats over the page: the dimmed background and toolbar of Peek, or the
// screenshot area picker. Everything it does is sent to the main process.
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  let mode = null;

  // Same size rule as the main process uses for the Peek page.
  function placePeekBar() {
    const W = innerWidth;
    const w = Math.min(W - 48, Math.max(480, Math.round(W * 0.86)));
    for (const id of ['peekBar']) Object.assign($(id).style, { left: Math.round((W - w) / 2) + 'px', width: w + 'px' });
  }
  addEventListener('resize', placePeekBar);

  let lastUrl = null;
  function setPeek({ url, title, loading }) {
    $('peekName').textContent = title || host(url) || url || '';
    $('peekHost').textContent = title && host(url) ? host(url) : '';
    $('peekSpin').hidden = !loading;
    lastUrl = url;
  }

  window.arch.on('layer:show', data => {
    mode = data.mode;
    $('peek').hidden = mode !== 'peek';
    $('shot').hidden = mode !== 'shot';
    if (mode === 'peek') { placePeekBar(); setPeek(data); }
    if (mode === 'shot') { $('sel').hidden = true; document.body.focus(); }
  });
  window.arch.on('layer:hide', () => { mode = null; $('peek').hidden = true; $('shot').hidden = true; });
  window.arch.on('layer:peek', setPeek);

  // ---- Peek
  $('peek').addEventListener('mousedown', e => { if (e.target === $('peek')) act('peek:close'); });
  $('pClose').onclick = () => act('peek:close');
  $('pExpand').onclick = () => act('peek:expand');
  $('pLittle').onclick = () => act('peek:little');
  $('pCopy').onclick = () => act('peek:copy');

  // ---- Screenshot area picker
  let start = null;
  const box = () => {
    const s = $('sel').style;
    return { x: parseFloat(s.left), y: parseFloat(s.top), width: parseFloat(s.width), height: parseFloat(s.height) };
  };
  $('shot').addEventListener('pointerdown', e => {
    if (e.target.closest('#shotBar')) return;
    start = { x: e.clientX, y: e.clientY };
    $('shot').setPointerCapture(e.pointerId);
    Object.assign($('sel').style, { left: start.x + 'px', top: start.y + 'px', width: '0px', height: '0px' });
    $('sel').hidden = false;
    $('shotHint').hidden = true;
  });
  $('shot').addEventListener('pointermove', e => {
    if (!start) return;
    const x = Math.max(0, Math.min(start.x, e.clientX)), y = Math.max(0, Math.min(start.y, e.clientY));
    const w = Math.min(innerWidth, Math.max(start.x, e.clientX)) - x, h = Math.min(innerHeight, Math.max(start.y, e.clientY)) - y;
    Object.assign($('sel').style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    $('selSize').textContent = `${Math.round(w)} × ${Math.round(h)}`;
  });
  $('shot').addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    const r = box();
    $('shotHint').hidden = false;
    if (r.width < 6 || r.height < 6) { $('sel').hidden = true; return; }   // a click, not a drag
    act('shot:region', r);
  });
  $('sVisible').onclick = () => act('shot:visible');
  $('sFull').onclick = () => act('shot:full');
  $('sCancel').onclick = () => act('shot:cancel');
  document.addEventListener('keydown', e => {
    if (mode === 'shot') {
      if (e.key === 'Escape') act('shot:cancel');
      else if (e.key === 'Enter') act('shot:visible');
      else if (e.key.toLowerCase() === 'f') act('shot:full');
    } else if (mode === 'peek' && e.key === 'Escape') act('peek:close');
  });
})();
