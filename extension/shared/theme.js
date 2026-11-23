// Turns a Space's colours into CSS, the way Arc tints its sidebar with the
// Space theme: multi-stop gradient + soft glow + film grain, with text colour
// picked automatically from the brightness of the gradient.

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lum([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function isDark(space) {
  const avg = space.colors.map(hexToRgb).reduce((a, c) => a + lum(c), 0) / space.colors.length;
  return avg < 0.28;
}

const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/>` +
  `<feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0'/></filter>` +
  `<rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;

export function spaceVars(space) {
  const [a, b, c = b] = space.colors;
  const dark = isDark(space);
  return {
    '--bg': `radial-gradient(120% 70% at 85% 10%, ${c}cc 0%, transparent 60%), linear-gradient(160deg, ${a} 0%, ${b} 55%, ${c} 100%)`,
    '--grain': GRAIN,
    '--grain-opacity': String((space.grain ?? 0.35) * (dark ? 0.35 : 0.5)),
    '--fg': dark ? '#F4F0FB' : '#231C36',
    '--fg-muted': dark ? 'rgba(244,240,251,.62)' : 'rgba(35,28,54,.58)',
    '--hover': dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.35)',
    '--card': dark ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.82)',
    '--card-shadow': dark ? '0 1px 2px rgba(0,0,0,.35)' : '0 1px 3px rgba(60,40,90,.14)',
    '--line': dark ? 'rgba(255,255,255,.12)' : 'rgba(35,28,54,.10)',
    '--accent': a,
    '--scheme': dark ? 'dark' : 'light',
  };
}

export function applySpaceTheme(el, space) {
  const v = spaceVars(space);
  for (const k in v) el.style.setProperty(k, v[k]);
  el.style.colorScheme = v['--scheme'];
  el.dataset.dark = isDark(space) ? '1' : '0';
}

// Chrome tab groups only allow 9 named colours; pick the closest by hue.
const GROUP_COLORS = {
  grey: [128, 134, 139], blue: [26, 115, 232], red: [217, 48, 37], yellow: [249, 171, 0],
  green: [30, 142, 62], pink: [208, 24, 132], purple: [147, 52, 230], cyan: [0, 123, 131], orange: [250, 144, 62],
};
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l = (mx + mn) / 2;
  return [(h * 60 + 360) % 360, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
}
export function groupColorFor(space) {
  const [h, s] = hsl(hexToRgb(space.colors[0]));
  if (s < 0.15) return 'grey';
  let best = 'grey', bd = 1e9;
  for (const [name, rgb] of Object.entries(GROUP_COLORS)) {
    if (name === 'grey') continue;
    const [gh] = hsl(rgb);
    const d = Math.min(Math.abs(h - gh), 360 - Math.abs(h - gh));
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

export function faviconUrl(pageUrl, size = 32) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl || 'about:blank');
  u.searchParams.set('size', String(size));
  return u.toString();
}
