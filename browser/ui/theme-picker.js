// Arc-style Space theme picker:
// - a dotted pad: drag the dot to choose the colour (left→right = hue,
//   top→bottom = vivid→muted); click empty space to add a 2nd/3rd colour for a
//   gradient; right-click or double-click a dot to remove it;
// - a light/dark switch (sun / moon);
// - an intensity slider (how strongly the colour tints the window);
// - a row of quick colour swatches.
// Picker state is saved with the Space as `theme`, and turned into the Space's
// gradient `colors` here.
window.ThemePicker = (() => {
  const $ = id => document.getElementById(id);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  // ---- colour maths ----
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s); l = clamp(l);
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function hexToHsl(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
  }

  function dotColor(dot, mode, intensity) {
    const h = dot.x * 360;
    // Dark mode stays deep and a little muted, like Arc's dark Spaces.
    const s = (1 - dot.y * 0.9) * (0.35 + 0.65 * intensity) * (mode === 'dark' ? 0.75 : 1);
    const l = mode === 'dark' ? 0.08 + 0.13 * intensity : 0.94 - 0.16 * intensity;
    return { h, s, l };
  }

  // Theme state -> the Space's gradient colours.
  function colorsFor(t) {
    const dark = t.mode === 'dark';
    const cs = t.dots.map(d => dotColor(d, t.mode, t.intensity));
    if (cs.length === 1) {
      const { h, s, l } = cs[0];
      return [hslToHex(h, s, l - (dark ? 0.03 : 0.04)), hslToHex(h, s, l), hslToHex(h + 20, s * 0.95, l + (dark ? 0.06 : 0.03))];
    }
    return cs.map(({ h, s, l }) => hslToHex(h, s, l));
  }

  // Older Spaces only have colours: work out a matching picker state.
  function themeFor(space) {
    if (space.theme?.dots?.length) return structuredClone(space.theme);
    const c = space.colors?.[1] || space.colors?.[0] || '#7A5AC8';
    const [h, s, l] = hexToHsl(c);
    return { dots: [{ x: h / 360, y: clamp((1 - s) / 0.9) }], mode: l < 0.45 ? 'dark' : 'light', intensity: 0.8 };
  }

  const SWATCH_HUES = [275, 320, 0, 22, 42, 60, 130, 168, 215];

  // ---- UI ----
  let state = null, onChange = null, spaceId = null, drag = null;

  function render() {
    const pad = $('tpPad');
    pad.replaceChildren(...state.dots.map((d, i) => {
      const el = document.createElement('div');
      el.className = 'tp-dot';
      const { h, s, l } = dotColor(d, state.mode, state.intensity);
      el.style.left = d.x * 100 + '%';
      el.style.top = d.y * 100 + '%';
      el.style.background = hslToHex(h, s, state.mode === 'dark' ? Math.max(l, 0.32) : Math.min(l, 0.7));
      el.title = state.dots.length > 1 ? 'Drag to change · right-click to remove' : 'Drag to change colour';
      el.addEventListener('pointerdown', e => { if (e.button === 0) { e.stopPropagation(); startDrag(e, i); } });
      const remove = e => { e.preventDefault(); e.stopPropagation(); if (state.dots.length > 1) { state.dots.splice(i, 1); changed(); } };
      el.addEventListener('contextmenu', remove);
      el.addEventListener('dblclick', remove);
      return el;
    }));
    $('tpMode').setAttribute('aria-checked', String(state.mode === 'dark'));
    $('tpMode').classList.toggle('on', state.mode === 'dark');
    $('tpIntensity').value = state.intensity;
    $('tpSwatches').replaceChildren(...SWATCH_HUES.map(h => {
      const b = document.createElement('button');
      const c = dotColor({ x: h / 360, y: 0.2 }, state.mode, state.intensity);
      b.style.background = hslToHex(c.h, c.s, state.mode === 'dark' ? Math.max(c.l, 0.3) : Math.min(c.l, 0.72));
      b.title = 'Use this colour';
      b.onclick = () => { state.dots = [{ x: h / 360, y: 0.2 }]; changed(); };
      return b;
    }));
  }

  function posFrom(e) {
    const r = $('tpPad').getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }
  function startDrag(e, i) {
    drag = i;
    $('tpPad').setPointerCapture(e.pointerId);
  }

  function changed() {
    render();
    onChange?.(colorsFor(state), structuredClone(state));
  }

  function open(space, anchor, cb) {
    spaceId = space.id;
    state = themeFor(space);
    onChange = cb;
    const pk = $('themePicker');
    pk.hidden = false;
    render();
    const sb = $('sidebar').getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const h = pk.offsetHeight;
    const below = r.bottom + 6;
    pk.style.top = (below + h < sb.bottom - 8 ? below : Math.max(8, r.top - h - 6)) - sb.top + 'px';
  }
  function close() { $('themePicker').hidden = true; spaceId = null; drag = null; }
  const isOpen = () => !$('themePicker').hidden;

  // pad: click empty space to add a colour (max 3), drag dots
  $('tpPad').addEventListener('pointerdown', e => {
    if (e.button !== 0 || !state) return;
    const p = posFrom(e);
    if (state.dots.length < 3) { state.dots.push(p); changed(); startDrag(e, state.dots.length - 1); }
    else { // move the nearest dot here
      let best = 0, bd = 9;
      state.dots.forEach((d, i) => { const dd = (d.x - p.x) ** 2 + (d.y - p.y) ** 2; if (dd < bd) { bd = dd; best = i; } });
      state.dots[best] = p; changed(); startDrag(e, best);
    }
  });
  $('tpPad').addEventListener('pointermove', e => {
    if (drag == null) return;
    state.dots[drag] = posFrom(e);
    changed();
  });
  const end = () => { drag = null; };
  $('tpPad').addEventListener('pointerup', end);
  $('tpPad').addEventListener('pointercancel', end);
  $('tpPad').addEventListener('contextmenu', e => e.preventDefault());

  $('tpMode').onclick = () => { state.mode = state.mode === 'dark' ? 'light' : 'dark'; changed(); };
  $('tpIntensity').oninput = () => { state.intensity = Number($('tpIntensity').value); changed(); };
  $('themePicker').addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('mousedown', e => {
    if (isOpen() && !e.target.closest('#themePicker, #fTheme, #nsTheme')) close();
  });

  return { open, close, isOpen, colorsFor, themeFor, get spaceId() { return spaceId; } };
})();
