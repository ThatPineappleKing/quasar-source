// Screenshot mark-up: pen, highlighter, box, arrow and blur, with undo; copy or save.
(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  const cv = $('c'), ctx = cv.getContext('2d');
  let base = null, tool = 'pen', color = '#e5322d';
  const marks = [];   // each: { tool, color, pts } (pen/hi) or { tool, color, a, b } (box/arrow/blur)
  let cur = null;

  window.arch.on('markup:init', ({ src }) => {
    const img = new Image();
    img.onload = () => { base = img; cv.width = img.naturalWidth; cv.height = img.naturalHeight; fit(); redraw(); };
    img.src = src;
  });
  // Big screenshots are shown smaller (the saved image keeps its full size).
  function fit() {
    const box = document.querySelector('.stage').getBoundingClientRect();
    const s = Math.min(1, (box.width - 32) / cv.width, (box.height - 32) / cv.height);
    cv.style.width = cv.width * s + 'px'; cv.style.height = cv.height * s + 'px';
  }
  addEventListener('resize', () => base && fit());
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };

  function pixelate(a, b) {
    const x = Math.round(Math.min(a[0], b[0])), y = Math.round(Math.min(a[1], b[1]));
    const w = Math.round(Math.abs(a[0] - b[0])), h = Math.round(Math.abs(a[1] - b[1]));
    if (w < 2 || h < 2) return;
    const n = Math.max(6, Math.round(Math.min(w, h) / 8));
    const img = ctx.getImageData(x, y, w, h), d = img.data;
    for (let by = 0; by < h; by += n) for (let bx = 0; bx < w; bx += n) {
      let r = 0, g = 0, bl = 0, c = 0;
      for (let yy = by; yy < Math.min(by + n, h); yy++) for (let xx = bx; xx < Math.min(bx + n, w); xx++) { const i = (yy * w + xx) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; c++; }
      for (let yy = by; yy < Math.min(by + n, h); yy++) for (let xx = bx; xx < Math.min(bx + n, w); xx++) { const i = (yy * w + xx) * 4; d[i] = r / c; d[i + 1] = g / c; d[i + 2] = bl / c; }
    }
    ctx.putImageData(img, x, y);
  }
  function drawMark(m) {
    const lw = Math.max(3, Math.round(cv.width / 400));
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (m.tool === 'pen' || m.tool === 'hi') {
      ctx.strokeStyle = m.color; ctx.lineWidth = m.tool === 'hi' ? lw * 6 : lw;
      if (m.tool === 'hi') ctx.globalAlpha = 0.35;
      ctx.beginPath(); m.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    } else if (m.tool === 'box') {
      ctx.strokeStyle = m.color; ctx.lineWidth = lw;
      ctx.strokeRect(m.a[0], m.a[1], m.b[0] - m.a[0], m.b[1] - m.a[1]);
    } else if (m.tool === 'arrow') {
      ctx.strokeStyle = ctx.fillStyle = m.color; ctx.lineWidth = lw;
      const [x1, y1] = m.a, [x2, y2] = m.b, ang = Math.atan2(y2 - y1, x2 - x1), hl = lw * 5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45)); ctx.lineTo(x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
    } else if (m.tool === 'blur') pixelate(m.a, m.b);
    ctx.restore();
  }
  function redraw() {
    if (!base) return;
    ctx.drawImage(base, 0, 0);
    for (const m of marks) drawMark(m);
    if (cur) {
      if (cur.tool === 'blur' && cur.b) { drawMark(cur); ctx.save(); ctx.setLineDash([8, 6]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(cur.a[0], cur.a[1], cur.b[0] - cur.a[0], cur.b[1] - cur.a[1]); ctx.restore(); }
      else if (cur.b || cur.pts) drawMark(cur);
    }
  }
  cv.addEventListener('pointerdown', e => {
    if (!base) return;
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    cur = tool === 'pen' || tool === 'hi' ? { tool, color, pts: [p] } : { tool, color, a: p, b: null };
  });
  cv.addEventListener('pointermove', e => { if (!cur) return; const p = pos(e); if (cur.pts) cur.pts.push(p); else cur.b = p; redraw(); });
  cv.addEventListener('pointerup', () => { if (cur && (cur.pts?.length > 1 || cur.b)) marks.push(cur); cur = null; redraw(); });

  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { tool = b.dataset.tool; document.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('on', x === b)); });
  document.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { color = b.dataset.color; document.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('on', x === b)); });
  const say = t => { $('msg').textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { $('msg').textContent = ''; }, 2500); };
  $('undo').onclick = () => { marks.pop(); redraw(); };
  $('copy').onclick = async () => { if (await act('mu:copy', cv.toDataURL('image/png'))) say('Copied to the clipboard.'); };
  $('save').onclick = async () => { if (await act('mu:save', cv.toDataURL('image/png'))) say('Saved.'); };
  $('saveAs').onclick = async () => { const f = await act('mu:saveAs', cv.toDataURL('image/png')); if (f) say('Saved.'); };
  addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); $('undo').click(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); $('copy').click(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); $('save').click(); }
    else if (e.key === 'Escape') act('mu:close');
    else if (!e.ctrlKey) { const t = { p: 'pen', h: 'hi', r: 'box', a: 'arrow', b: 'blur' }[e.key.toLowerCase()]; if (t) document.querySelector(`[data-tool="${t}"]`).click(); }
  });
})();
