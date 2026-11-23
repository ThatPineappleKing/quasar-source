// Space colours -> CSS variables (gradient, grain, text colours).
window.ArchTheme = (() => {
  const hexToRgb = hex => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const lum = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const isDark = colors => colors.map(hexToRgb).reduce((a, c) => a + lum(c), 0) / colors.length < 0.28;

  // A ready-made noise tile (fractal-noise SVG filter, rendered once to a PNG):
  // drawing a bitmap is far cheaper than running the filter on every page start.
  const GRAIN_SRC = new URL('grain.png', document.currentScript?.src || location.href).href;
  const GRAIN = `url("${GRAIN_SRC}")`;

  // The grain is drawn as part of the page background (background-blend-mode), not as
  // a see-through layer over the whole window: that layer made the GPU keep extra
  // full-window copies of the UI (~30–50 MB). Its strength is baked into the tile's alpha,
  // which blends exactly like the old layer's opacity did.
  const grainTiles = new Map();   // opacity -> data: URL
  let grainImg = null;
  function grainTile(opacity, done) {
    const key = Math.round(Math.max(0, Math.min(1, opacity)) * 100) / 100;
    if (!key) return done('none');
    if (grainTiles.has(key)) return done(grainTiles.get(key));
    const draw = () => {
      if (!grainImg.naturalWidth) return done('none');
      const c = document.createElement('canvas');
      c.width = grainImg.naturalWidth; c.height = grainImg.naturalHeight;
      const g = c.getContext('2d');
      g.globalAlpha = key;
      g.drawImage(grainImg, 0, 0);
      const url = `url("${c.toDataURL('image/png')}")`;
      grainTiles.set(key, url);
      done(url);
    };
    if (!grainImg) { grainImg = new Image(); grainImg.src = GRAIN_SRC; }
    if (grainImg.complete) draw();
    else grainImg.addEventListener('load', draw, { once: true });
  }

  function apply(el, space) {
    const colors = space.colors?.length ? space.colors : ['#B9A6F2', '#D9B8EC', '#F6C4B4'];
    const [a, b = a, c = b] = colors;
    const dark = isDark(colors);
    const v = {
      '--bg': `radial-gradient(110% 80% at 80% 0%, ${c}aa 0%, transparent 60%), linear-gradient(120deg, ${a} 0%, ${b} 55%, ${c} 100%)`,
      '--base': a,
      '--grain': GRAIN,
      '--grain-opacity': String((space.grain ?? 0.35) * (dark ? 0.35 : 0.5)),
      '--fg': dark ? '#ECEAF8' : '#231C36',
      '--fg-muted': dark ? 'rgba(236,234,248,.55)' : 'rgba(35,28,54,.55)',
      '--hover': dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.38)',
      '--card': dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.85)',
      '--card-shadow': dark ? '0 1px 2px rgba(0,0,0,.35)' : '0 1px 3px rgba(60,40,90,.14)',
      '--line': dark ? 'rgba(255,255,255,.10)' : 'rgba(35,28,54,.10)',
      '--pill': dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.45)',
      '--accent': b,
    };
    for (const k in v) if (el.style.getPropertyValue(k) !== v[k]) el.style.setProperty(k, v[k]);
    const op = Number(v['--grain-opacity']);
    el.__grainOp = op;
    grainTile(op, url => { if (el.__grainOp === op && el.style.getPropertyValue('--grain-tile') !== url) el.style.setProperty('--grain-tile', url); });
    el.style.colorScheme = dark ? 'dark' : 'light';
    el.dataset.dark = dark ? '1' : '0';
  }
  // Settings › Appearance (font, size, corners, blur, accent, see-through window),
  // shared by every Quasar page so the sidebar, Settings and the command bar match.
  function ui(el, s = {}) {
    const set = (k, v) => { if (v == null || v === '') el.style.removeProperty(k); else if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); };
    const font = String(s.uiFont || '').replace(/["\\;{}]/g, '');
    set('--ui-font', font ? `"${font}", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` : null);
    set('--ui-size', s.uiFontSize ? s.uiFontSize + 'px' : null);
    set('--r', Number.isFinite(s.radius) ? s.radius + 'px' : null);
    set('--blur', Number.isFinite(s.blur) ? s.blur + 'px' : null);
    const t = Number(s.transparency) || 0;
    set('--solid', t > 0 ? String(1 - t) : null);
    el.classList.toggle('see-through', t > 0);
    if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) {
      set('--accent-ui', s.accent);
      set('--accent-ink', isDark([s.accent]) ? '#fff' : '#111');
      el.dataset.accent = '1';
    } else { set('--accent-ui', null); set('--accent-ink', null); delete el.dataset.accent; }
  }
  return { apply, isDark, ui };
})();
