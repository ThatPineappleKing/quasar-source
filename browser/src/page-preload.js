// Runs in every web page, in an isolated world the page's own scripts can't see.
// - Login fields: shows the saved accounts for this site; fills only after you pick one.
// - New-password fields (sign-up / change password): offers a strong generated password
//   and shows how strong the one you type is.
// - Address forms: offers your saved addresses; fills only after you pick one.
// - Submitting a login or address form: offers to save it.
// The main process checks the real page address itself; nothing here is trusted for that.
const { ipcRenderer, webFrame } = require('electron');

// ---- ad blocking inside the page (network-level blocking is in protection.js) ----
// Asked once, at document start: is blocking on for this site, and its hiding CSS.
let adConfig = { block: false };
if (window === window.top && /^https?:$/.test(location.protocol)) {
  try { adConfig = ipcRenderer.sendSync('arch:page-config', location.hostname) || adConfig; } catch { /* ignore */ }
}

// Layer 3: hide ad boxes (EasyList element-hiding rules + Quasar's own for YouTube),
// as a user style sheet, before the page draws.
if (adConfig.block && adConfig.css) { try { webFrame.insertCSS(adConfig.css, { cssOrigin: 'user' }); } catch { /* ignore */ } }

// The generic rules keyed by a class or id (most of them) are asked for only when an
// element with that class or id shows up (see protection.js indexGeneric). One request
// at a time; classes/ids seen meanwhile go in the next one.
function startClassIdHiding() {
  const seen = new Set();
  let queue = [], busy = false;
  const flush = () => {
    if (busy || !queue.length) return;
    const batch = queue;
    queue = []; busy = true;
    ipcRenderer.invoke('arch:cosmetic', batch)
      .then(css => { if (css) { try { webFrame.insertCSS(css, { cssOrigin: 'user' }); } catch { /* ignore */ } } })
      .catch(() => {})
      .finally(() => { busy = false; flush(); });
  };
  const add = t => { if (t.length < 256 && !seen.has(t)) { seen.add(t); queue.push(t); } };
  const visit = el => {
    const id = el.id;
    if (id && typeof id === 'string') add('#' + id.toLowerCase());
    const cl = el.classList;
    if (cl) for (let i = 0; i < cl.length; i++) add('.' + cl[i].toLowerCase());
  };
  const scan = node => {
    if (node.nodeType !== 1) return;
    visit(node);
    if (!node.firstElementChild) return;
    const all = node.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) visit(all[i]);
  };
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') visit(r.target);
      else for (const n of r.addedNodes) scan(n);
    }
    flush();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'id'] });
  if (document.documentElement) { scan(document.documentElement); flush(); }
}
if (adConfig.block) startClassIdHiding();

// Layer 1 (YouTube): runs in the page's own JavaScript world before YouTube's scripts
// and removes the ad entries from the player and page data, whether it arrives in
// the page (ytInitialPlayerResponse / ytInitialData) or later (JSON / fetch).
function youtubeAdPrune() {
  if (window.__archAdPrune) return;
  Object.defineProperty(window, '__archAdPrune', { value: true });
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const AD_ITEMS = ['adSlotRenderer', 'displayAdRenderer', 'promotedSparklesWebRenderer', 'promotedSparklesTextSearchRenderer', 'inFeedAdLayoutRenderer',
    'bannerPromoRenderer', 'statementBannerRenderer', 'compactPromotedVideoRenderer', 'promotedVideoRenderer', 'searchPyvRenderer',
    'playerLegacyDesktopWatchAdsRenderer', 'actionCompanionAdRenderer', 'adActionInterstitialRenderer', 'merchandiseShelfRenderer'];
  const MAYBE = /adPlacements|adSlots|playerAds|adSlotRenderer|AdRenderer|PromotedSparkles|PromoRenderer|searchPyvRenderer/;
  const isAd = x => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
    if (AD_ITEMS.some(k => k in x)) return true;
    const inner = x.richItemRenderer?.content || x.richSectionRenderer?.content || x.itemSectionRenderer?.contents?.[0];
    return !!inner && typeof inner === 'object' && AD_ITEMS.some(k => k in inner);
  };
  const prune = (o, d = 0) => {
    if (!o || typeof o !== 'object' || d > 60) return o;
    if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) { if (isAd(o[i])) o.splice(i, 1); else prune(o[i], d + 1); } return o; }
    for (const k of AD_KEYS) if (k in o) { try { delete o[k]; } catch { /* frozen */ } }
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') prune(v, d + 1); }
    return o;
  };
  const native = (fn, orig) => { try { Object.defineProperty(fn, 'toString', { value: () => orig.toString() }); } catch { /* ignore */ } return fn; };
  // Data that arrives as text.
  const parse = JSON.parse;
  JSON.parse = native(function (text, reviver) {
    const r = parse.call(this, text, reviver);
    if (typeof text === 'string' && text.length > 64 && MAYBE.test(text)) prune(r);
    return r;
  }, parse);
  // Data fetched with fetch().json().
  const json = Response.prototype.json;
  Response.prototype.json = native(function () {
    return json.call(this).then(r => (/youtubei|\/player|get_watch|\/next|\/browse|\/search/.test(this.url || '') ? prune(r) : r));
  }, json);
  // Data written straight into the page.
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData', 'playerResponse']) {
    let value;
    try {
      Object.defineProperty(window, name, { configurable: true, get: () => value, set: v => { value = prune(v); } });
    } catch { /* ignore */ }
  }
}
if (adConfig.youtube) { try { webFrame.executeJavaScript(`(${youtubeAdPrune.toString()})()`); } catch { /* ignore */ } }

// Layer 2: if a video ad still plays (YouTube changed something, or another site's
// player), mute it, play it at 16x, jump to its end and press Skip. Works on YouTube,
// players using Google IMA, video.js and JW Player; on Twitch (ads are part of the
// stream there) it can only mute them.
function startAdSkipper() {
  const SKIP = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button, .videoAdUiSkipButton, .jw-skip, .vast-skip-button, .ima-skip-button, [class*="skip-ad"]:not(a), [class*="ad-skip"]:not(a), [class*="skipAd"]:not(a)';
  const CLOSE = '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container';
  let saved = null;     // { v, muted, rate } while an ad plays
  let note = null;
  const visibleEl = el => el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  function findAd() {
    const yt = document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
    if (yt) return { v: yt.querySelector('video.html5-main-video') || yt.querySelector('video'), skip: true };
    // video.js and JW Player mark the player while an ad plays.
    const box = document.querySelector('.vjs-ad-playing, .jw-flag-ads');
    if (box) return { v: box.querySelector('video'), skip: true };
    // Google IMA plays ads in its own <video> inside .ima-ad-container: only when that one is showing and playing.
    const ima = [...document.querySelectorAll('.ima-ad-container video')].find(x => !x.paused && visibleEl(x));
    if (ima) return { v: ima, skip: true };
    if (document.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]')) {
      return { v: document.querySelector('video'), skip: false, twitch: true };
    }
    return null;
  }
  function showNote(on) {
    if (on && !note) {
      note = document.createElement('div');
      note.textContent = 'Ad muted by Quasar';
      note.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:rgba(20,16,32,.85);color:#fff;font:600 12px "Segoe UI",sans-serif;padding:6px 12px;border-radius:8px;pointer-events:none';
      (document.body || document.documentElement).appendChild(note);
    } else if (!on && note) { note.remove(); note = null; }
  }
  function tick() {
    const ad = findAd();
    if (ad?.v) {
      const v = ad.v;
      if (!saved || saved.v !== v) saved = { v, muted: v.muted, rate: v.playbackRate || 1 };
      if (!v.muted) v.muted = true;
      if (ad.skip) {
        try { if (v.playbackRate < 16) v.playbackRate = 16; } catch { /* some players limit the rate */ }
        if (Number.isFinite(v.duration) && v.duration > 0 && v.duration < 600 && v.currentTime < v.duration - 0.3) { try { v.currentTime = v.duration - 0.1; } catch { /* ignore */ } }
        for (const b of document.querySelectorAll(SKIP)) if (visibleEl(b)) { b.click(); break; }
      }
      showNote(!!ad.twitch);
    } else if (saved) {
      try { saved.v.muted = saved.muted; saved.v.playbackRate = saved.rate; } catch { /* ignore */ }
      saved = null;
      showNote(false);
    }
    for (const b of document.querySelectorAll(CLOSE)) if (visibleEl(b)) b.click();
  }
  // Only pages with video pay for the check, and only while a video exists.
  let timer = null;
  const ensure = () => {
    if (timer) return;
    timer = setInterval(() => { tick(); if (!document.querySelector('video')) { clearInterval(timer); timer = null; } }, 250);
  };
  document.addEventListener('play', ensure, true);
  document.addEventListener('playing', ensure, true);
  document.addEventListener('loadedmetadata', ensure, true);
  if (/(^|\.)(youtube\.com|twitch\.tv)$/.test(location.hostname)) ensure();
}
if (adConfig.skipper) startAdSkipper();

// ---- Fingerprinting protection (like Brave's "standard" mode) ----
// Readings that differ between computers (canvas drawings, audio processing, text
// measurements) get tiny changes, the same on every page of one site but different
// on every other site and in every Quasar session, so trackers can't use them to
// recognise you across sites. Runs in the page's own world before its scripts.
function fingerprintGuard(seed) {
  if (window.__archFp) return;
  Object.defineProperty(window, '__archFp', { value: true });
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const native = (fn, orig) => { try { Object.defineProperty(fn, 'toString', { value: () => orig.toString() }); Object.defineProperty(fn, 'name', { value: orig.name }); } catch { /* ignore */ } return fn; };
  const wrap = (proto, name, make) => { const orig = proto && proto[name]; if (typeof orig === 'function') proto[name] = native(make(orig), orig); };
  // Noise depends only on the seed and the pixel position, so the same drawing gives the same answer on this site.
  const noisePixels = data => {
    for (let i = 0; i < data.length; i += 4) {
      const h = ((i * 2654435761) ^ seed) >>> 0;
      if (h % 23 === 0) data[i + (h % 3)] ^= 1;
    }
  };
  const kinds = new WeakMap();
  wrap(HTMLCanvasElement.prototype, 'getContext', o => function (type, ...a) { const c = o.call(this, type, ...a); if (c) kinds.set(this, String(type)); return c; });
  const noisyCopy = canvas => {
    if (kinds.get(canvas) !== '2d' || !canvas.width || !canvas.height) return null;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const img = getImageData.call(ctx, 0, 0, copy.width, copy.height);   // the original (unwrapped) one
    noisePixels(img.data);
    ctx.putImageData(img, 0, 0);
    return copy;
  };
  wrap(HTMLCanvasElement.prototype, 'toDataURL', o => function (...a) { const c = noisyCopy(this); return o.apply(c || this, a); });
  wrap(HTMLCanvasElement.prototype, 'toBlob', o => function (...a) { const c = noisyCopy(this); return o.apply(c || this, a); });
  const getImageData = CanvasRenderingContext2D.prototype.getImageData;
  wrap(CanvasRenderingContext2D.prototype, 'getImageData', o => function (...a) { const r = o.apply(this, a); noisePixels(r.data); return r; });
  // Audio: a tiny, inaudible change to processed samples.
  const touched = new WeakSet();
  wrap(AudioBuffer.prototype, 'getChannelData', o => function (...a) {
    const d = o.apply(this, a);
    if (!touched.has(d)) { touched.add(d); for (let i = 0; i < d.length; i += 97) d[i] += (rand() - 0.5) * 1e-7; }
    return d;
  });
  wrap(AnalyserNode.prototype, 'getFloatFrequencyData', o => function (arr) { o.call(this, arr); for (let i = 0; i < arr.length; i += 7) arr[i] += (rand() - 0.5) * 1e-4; });
  // Text measurements (used to work out which fonts are installed).
  const factor = 1 + ((seed % 1000) - 500) / 5e6;
  wrap(CanvasRenderingContext2D.prototype, 'measureText', o => function (...a) {
    const m = o.apply(this, a);
    const out = Object.create(TextMetrics.prototype);
    for (const k of ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent', 'emHeightAscent', 'emHeightDescent', 'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline']) {
      if (k in m) Object.defineProperty(out, k, { value: k === 'width' || k.startsWith('actualBoundingBox') ? m[k] * factor : m[k], enumerable: true });
    }
    return out;
  });
  // Common, less identifying hardware numbers.
  try { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: native(function () { return 8; }, Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get), configurable: true }); } catch { /* ignore */ }
  try { if ('deviceMemory' in Navigator.prototype) Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: native(function () { return 8; }, Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory').get), configurable: true }); } catch { /* ignore */ }
}
if (adConfig.fp != null && Number.isFinite(adConfig.fp)) { try { webFrame.executeJavaScript(`(${fingerprintGuard.toString()})(${adConfig.fp >>> 0})`); } catch { /* ignore */ } }

// ---- Global Privacy Control, and the browser this site is told it's talking to ----
// In the page's own world, before its scripts run.
function privacySignals(gpc, identity) {
  try { if (gpc) Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: function () { return true; }, configurable: true, enumerable: true }); } catch { /* ignore */ }
  if (!identity) return;
  try {
    if (identity === 'firefox') Object.defineProperty(Navigator.prototype, 'userAgentData', { get: function () { return undefined; }, configurable: true });
    else {
      const uad = navigator.userAgentData;
      const brand = identity === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
      const v = (uad?.brands || []).find(b => /Chromium/.test(b.brand))?.version || '140';
      const brands = [{ brand, version: v }, { brand: 'Chromium', version: v }, { brand: 'Not_A Brand', version: '24' }];
      if (uad) {
        const orig = uad.getHighEntropyValues?.bind(uad);
        const fake = Object.create(Object.getPrototypeOf(uad), {
          brands: { get: () => brands }, mobile: { get: () => false }, platform: { get: () => 'Windows' },
          toJSON: { value: () => ({ brands, mobile: false, platform: 'Windows' }) },
          getHighEntropyValues: { value: hints => (orig ? orig(hints) : Promise.resolve({})).then(r => ({ ...r, brands, fullVersionList: brands })) },
        });
        Object.defineProperty(Navigator.prototype, 'userAgentData', { get: function () { return fake; }, configurable: true });
      }
    }
  } catch { /* ignore */ }
}
if (adConfig.gpc || adConfig.identity) { try { webFrame.executeJavaScript(`(${privacySignals.toString()})(${!!adConfig.gpc}, ${JSON.stringify(adConfig.identity || null)})`); } catch { /* ignore */ } }

// ---- Search shortcuts: a site that offers its own search (OpenSearch) tells Quasar ----
if (window === window.top && location.protocol === 'https:') {
  addEventListener('load', () => {
    const l = document.querySelector('link[rel="search"][type="application/opensearchdescription+xml"][href]');
    if (l) { try { ipcRenderer.send('arch:opensearch', new URL(l.getAttribute('href'), location.href).href); } catch { /* ignore */ } }
  }, { once: true });
}

// ---- Caret browsing (F7): move through the page's text with the arrow keys ----
if (window === window.top) {
  let on = false, caret = null, blink = null;
  const editable = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const draw = () => {
    if (!on) return;
    const s = getSelection();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0).cloneRange();
    r.collapse(s.focusNode === r.startContainer && s.focusOffset === r.startOffset);
    let rect = r.getClientRects()[0] || r.getBoundingClientRect();
    if ((!rect || !rect.height) && s.focusNode) {
      const el = s.focusNode.nodeType === 1 ? s.focusNode : s.focusNode.parentElement;
      rect = el?.getBoundingClientRect();
    }
    if (!rect) return;
    if (!caret) {
      caret = document.createElement('div');
      caret.setAttribute('aria-hidden', 'true');
      caret.style.cssText = 'position:fixed;z-index:2147483647;width:2px;background:#000;pointer-events:none;mix-blend-mode:difference;filter:invert(1)';
      (document.body || document.documentElement).appendChild(caret);
    }
    caret.style.left = rect.left + 'px'; caret.style.top = rect.top + 'px'; caret.style.height = Math.max(12, rect.height) + 'px';
    caret.style.visibility = 'visible';
    // Keep it on screen.
    if (rect.top < 0 || rect.bottom > innerHeight) { scrollBy(0, rect.top < 0 ? rect.top - 40 : rect.bottom - innerHeight + 40); requestAnimationFrame(draw); }
  };
  const place = () => {
    const s = getSelection();
    if (s.rangeCount && document.body?.contains(s.anchorNode)) return draw();
    const r = document.caretRangeFromPoint?.(Math.min(60, innerWidth / 4), Math.min(80, innerHeight / 4));
    if (r) { s.removeAllRanges(); s.addRange(r); }
    else if (document.body) { s.collapse(document.body, 0); }
    draw();
  };
  const set = v => {
    on = !!v;
    clearInterval(blink);
    if (on) { place(); blink = setInterval(() => { if (caret) caret.style.visibility = caret.style.visibility === 'hidden' ? 'visible' : 'hidden'; }, 530); }
    else if (caret) { caret.remove(); caret = null; }
  };
  ipcRenderer.on('arch:caret', (e, v) => set(v));
  if (adConfig.caret) addEventListener('DOMContentLoaded', () => set(true), { once: true });
  addEventListener('keydown', e => {
    if (!on || editable(e.target) || e.altKey || e.metaKey) return;
    const s = getSelection();
    const how = e.shiftKey ? 'extend' : 'move';
    const step = { ArrowLeft: ['backward', e.ctrlKey ? 'word' : 'character'], ArrowRight: ['forward', e.ctrlKey ? 'word' : 'character'],
      ArrowUp: ['backward', e.ctrlKey ? 'paragraph' : 'line'], ArrowDown: ['forward', e.ctrlKey ? 'paragraph' : 'line'],
      Home: ['backward', e.ctrlKey ? 'documentboundary' : 'lineboundary'], End: ['forward', e.ctrlKey ? 'documentboundary' : 'lineboundary'] }[e.key];
    if (step) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!s.rangeCount) place();
      try { s.modify(how, step[0], step[1]); } catch { /* ignore */ }
      if (caret) caret.style.visibility = 'visible';
      draw();
    } else if (e.key === 'Enter' && !e.ctrlKey) {
      const n = s.focusNode;
      const a = (n?.nodeType === 1 ? n : n?.parentElement)?.closest('a[href], button, [role=button], summary, label');
      if (a) { e.preventDefault(); a.click(); }
    }
  }, true);
  addEventListener('mouseup', () => { if (on) setTimeout(draw, 0); }, true);
  addEventListener('scroll', () => { if (on && caret) { const s = getSelection(); if (s.rangeCount) { const r = s.getRangeAt(0).getClientRects()[0]; if (r) { caret.style.left = r.left + 'px'; caret.style.top = r.top + 'px'; } } } }, true);
}

// ---- Middle-click auto-scroll (as in Chrome on Windows; Electron has none) ----
// Click the mouse wheel and move the mouse: the page scrolls that way, faster the
// further you go. Click again (or press Esc) to stop; if you hold the wheel down and
// drag, letting go stops it. Not on links (middle-click opens those in a new tab).
if (window === window.top && adConfig.autoScroll !== false && /^(https?|file):$/.test(location.protocol)) {
  let as = null;
  const canScroll = n => { const s = getComputedStyle(n); return (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) || (/(auto|scroll|overlay)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1); };
  const target = el => {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) if (n instanceof Element && canScroll(n)) return n;
    const se = document.scrollingElement || document.documentElement;
    return se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1 ? window : null;
  };
  const stop = () => {
    if (!as) return;
    cancelAnimationFrame(as.raf); as.mark.remove();
    document.documentElement.style.cursor = as.cursor;
    as = null;
  };
  const speed = d => { const a = Math.abs(d) - 12; return a <= 0 ? 0 : Math.sign(d) * Math.min(80, Math.pow(a / 6, 1.35)); };
  const tick = () => {
    if (!as) return;
    const vx = speed(as.cx - as.x), vy = speed(as.cy - as.y);
    as.fx += vx; as.fy += vy;
    const dx = Math.trunc(as.fx), dy = Math.trunc(as.fy);
    as.fx -= dx; as.fy -= dy;
    if (dx || dy) { if (as.el === window) scrollBy(dx, dy); else as.el.scrollBy(dx, dy); }
    as.raf = requestAnimationFrame(tick);
  };
  addEventListener('mousedown', e => {
    if (as) { e.preventDefault(); e.stopImmediatePropagation(); as.ignoreUp = true; return stop(); }
    if (e.button !== 1 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const t = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!t || t.closest('a[href], area[href], input, textarea, select, button, [contenteditable=""], [contenteditable=true], video, audio, iframe, embed, object, canvas')) return;
    const el = target(t);
    if (!el) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const mark = document.createElement('div');
    mark.setAttribute('aria-hidden', 'true');
    mark.style.cssText = 'position:fixed;z-index:2147483647;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 0 0 1px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.25);pointer-events:none;' +
      'background-image:url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><g fill="#333"><path d="M15 4l4 5h-8z"/><path d="M15 26l4-5h-8z"/><path d="M4 15l5-4v8z"/><path d="M26 15l-5-4v8z"/><circle cx="15" cy="15" r="2"/></g></svg>') + '")';
    mark.style.left = e.clientX + 'px'; mark.style.top = e.clientY + 'px';
    (document.body || document.documentElement).appendChild(mark);
    as = { el, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, fx: 0, fy: 0, down: Date.now(), moved: false, mark, cursor: document.documentElement.style.cursor };
    document.documentElement.style.cursor = 'all-scroll';
    as.raf = requestAnimationFrame(tick);
  }, true);
  addEventListener('mousemove', e => { if (!as) return; as.cx = e.clientX; as.cy = e.clientY; if (Math.hypot(as.cx - as.x, as.cy - as.y) > 12) as.moved = true; }, true);
  addEventListener('mouseup', e => {
    if (!as || e.button !== 1) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (as.moved && Date.now() - as.down > 250) stop();   // held and dragged: letting go stops
  }, true);
  // No paste or "open in new tab" from the click that started or stopped scrolling.
  addEventListener('auxclick', e => { if (e.button === 1 && (as || e.defaultPrevented)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  addEventListener('keydown', e => { if (as) { e.preventDefault(); stop(); } }, true);
  addEventListener('wheel', () => stop(), { capture: true, passive: true });
  addEventListener('blur', stop);
}

// ---- Mouse gestures: hold the right button and draw a direction ----
if (window === window.top && adConfig.gestures !== false && /^(https?|file):$/.test(location.protocol)) {
  let pts = null, used = false;
  addEventListener('mousedown', e => { if (e.button === 2) { pts = [[e.clientX, e.clientY]]; used = false; } }, true);
  addEventListener('mousemove', e => { if (pts && (e.buttons & 2)) pts.push([e.clientX, e.clientY]); }, true);
  addEventListener('mouseup', e => {
    if (e.button !== 2 || !pts) return;
    pts.push([e.clientX, e.clientY]);
    // Turn the path into strokes: L R U D, each at least 40px.
    const dirs = [];
    let [ax, ay] = pts[0];
    for (const [x, y] of pts) {
      const dx = x - ax, dy = y - ay;
      if (Math.abs(dx) < 40 && Math.abs(dy) < 40) continue;
      const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
      if (dirs[dirs.length - 1] !== d) dirs.push(d);
      ax = x; ay = y;
    }
    pts = null;
    if (!dirs.length) return;
    used = true;
    try { ipcRenderer.send('arch:gesture', dirs.join('').slice(0, 4)); } catch { /* ignore */ }
  }, true);
  // No right-click menu after a gesture.
  addEventListener('contextmenu', e => { if (used) { e.preventDefault(); e.stopImmediatePropagation(); used = false; } }, true);
}

// ---- Now playing (the sidebar's media controls) ----
// In the page's own world: note which media-session actions the page handles
// (next/previous track…), so Quasar can press them for you.
function mediaSessionHook() {
  if (window.__archMedia || !navigator.mediaSession) return;
  const handlers = {};
  Object.defineProperty(window, '__archMedia', { value: { handlers } });
  const proto = Object.getPrototypeOf(navigator.mediaSession);
  const orig = proto.setActionHandler;
  const fn = function (action, cb) {
    handlers[action] = typeof cb === 'function' ? cb : null;
    try { document.dispatchEvent(new CustomEvent('__arch-media-actions', { detail: Object.keys(handlers).filter(k => handlers[k]).join(',') })); } catch { /* ignore */ }
    return orig.call(this, action, cb);
  };
  try { Object.defineProperty(fn, 'toString', { value: () => orig.toString() }); } catch { /* ignore */ }
  proto.setActionHandler = fn;
}
if (window === window.top && /^(https?|file):$/.test(location.protocol)) {
  try { webFrame.executeJavaScript(`(${mediaSessionHook.toString()})()`); } catch { /* ignore */ }
  let actions = '', last = '', t = null;
  const report = () => {
    t = null;
    const els = [...document.querySelectorAll('video, audio')];
    const playing = els.find(m => !m.paused && !m.ended && m.readyState > 2);
    const started = playing || els.find(m => m.currentTime > 0 && !m.ended);
    let md = null;
    try { md = navigator.mediaSession?.metadata; } catch { /* ignore */ }
    let art = '';
    try { const list = md?.artwork || []; art = list.length ? String(list[list.length - 1].src || '') : ''; } catch { /* ignore */ }
    const state = navigator.mediaSession?.playbackState;
    const s = { has: !!started || !!md, playing: !!playing || state === 'playing', video: !!(started && started.tagName === 'VIDEO'),
      title: String(md?.title || '').slice(0, 200), artist: String(md?.artist || '').slice(0, 200), art: /^(https?|data):/.test(art) ? art.slice(0, 4096) : '', actions };
    const k = JSON.stringify(s);
    if (k === last) return;
    last = k;
    try { ipcRenderer.send('arch:media', s); } catch { /* ignore */ }
  };
  const soon = () => { if (!t) t = setTimeout(report, 120); };
  for (const ev of ['play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata']) document.addEventListener(ev, soon, true);
  document.addEventListener('__arch-media-actions', e => { actions = String(e.detail || ''); soon(); });
  setInterval(() => { if (last.includes('"playing":true')) soon(); }, 3000);   // a new track's title
}

// Tell Quasar which link the user actually clicked, so a pinned tab can open it in
// Peek (redirects and scripted navigations are never sent here).
if (window === window.top) {
  document.addEventListener('click', e => {
    if (e.button !== 0 || e.defaultPrevented) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.target === '_blank') return;
    try { ipcRenderer.send('arch:link-click', a.href); } catch { /* ignore */ }
  }, true);
}

if (window === window.top) {
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const passwordFields = (scope = document) => [...scope.querySelectorAll('input[type=password]')].filter(visible);
  const attrs = el => `${el.autocomplete || ''} ${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();

  function usernameFieldFor(pw) {
    const scope = pw.form || document;
    const inputs = [...scope.querySelectorAll('input')].filter(i =>
      visible(i) && /^(text|email|tel|)$/i.test(i.type || 'text'));
    const before = inputs.filter(i => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    const pref = before.find(i => /user|email|login|account|name/i.test(`${i.autocomplete} ${i.name} ${i.id} ${i.type}`));
    return pref || before[before.length - 1] || null;
  }

  // Set a value the way typing would (frameworks listen for input/change).
  const setValue = (el, v) => {
    if (el instanceof HTMLSelectElement) {
      const want = String(v).trim().toLowerCase();
      const opt = [...el.options].find(o => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want)
        || [...el.options].find(o => want.length > 2 && (o.text.trim().toLowerCase().startsWith(want) || want.startsWith(o.text.trim().toLowerCase()) && o.text.trim().length > 2));
      if (!opt) return;
      el.value = opt.value;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // ---- new passwords ----------------------------------------------------
  const SIGNUP_PAGE = /(sign.?up|register|registration|join|create.?account|new.?account|reset|change.?password|new.?password|enroll|onboard)/i;
  function isNewPassword(el) {
    if (el.type !== 'password') return false;
    const a = attrs(el);
    if (/current-password/.test(el.autocomplete || '')) return false;
    if (/new-password/.test(el.autocomplete || '')) return true;
    if (/(new|confirm|create|repeat|again|retype|verify|register|signup|sign-up|choose)/.test(a)) return true;
    if (passwordFields(el.form || document).length >= 2) return true;
    return SIGNUP_PAGE.test(location.pathname + location.search);
  }
  // The new-password field and its "confirm" field(s) in the same form.
  function newPasswordFields(el) {
    const all = passwordFields(el.form || document);
    return all.filter(p => p === el || (!/current-password/.test(p.autocomplete || '') && (isNewPassword(p) || all.indexOf(p) > all.indexOf(el))));
  }

  // Rough strength: length, variety, and the patterns attackers try first.
  const COMMON = new Set(('123456 123456789 12345678 password qwerty 123123 111111 1234567890 1234567 qwerty123 000000 abc123 password1 iloveyou ' +
    'admin welcome monkey dragon letmein football baseball sunshine princess login master hello freedom whatever trustno1 passw0rd ' +
    'starwars shadow superman michael qwertyuiop 654321 1q2w3e4r 1qaz2wsx zaq12wsx asdfghjkl 987654321 password123 qwerty1').split(' '));
  function strength(pw, hints = []) {
    if (!pw) return { score: 0, label: '' };
    const lower = pw.toLowerCase();
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    let bits = pw.length * Math.log2(Math.max(pool, 2));
    const tips = [];
    if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9]/g, ''))) { bits = 0; tips.push('This is one of the most common passwords.'); }
    if (/(.)\1{2,}/.test(pw)) { bits -= 15; tips.push('Avoid repeated characters.'); }
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|wert|asdf|zxcv)/i.test(pw)) { bits -= 15; tips.push('Avoid sequences like 1234 or qwerty.'); }
    for (const h of hints) if (h && h.length > 2 && lower.includes(h.toLowerCase())) { bits -= 20; tips.push('Don’t include your name, email or the site’s name.'); break; }
    if (pw.length < 8) tips.push('Use at least 12 characters.');
    else if (pw.length < 12 && bits < 60) tips.push('Longer is stronger: 12+ characters.');
    if (pool <= 36 && pw.length < 16) tips.push('Mix upper and lower case, numbers and symbols.');
    const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    return { score, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score], tip: tips[0] || '' };
  }

  // ---- addresses ----------------------------------------------------------
  const AC = { name: 'name', 'given-name': 'given', 'family-name': 'family', organization: 'org', 'street-address': 'street', 'address-line1': 'street',
    'address-line2': 'line2', 'address-level2': 'city', 'address-level1': 'region', 'postal-code': 'postal', country: 'country',
    'country-name': 'country', tel: 'phone', 'tel-national': 'phone', email: 'email' };
  const labelText = el => {
    let t = '';
    if (el.id) { try { t = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || ''; } catch { /* ignore */ } }
    return (t || el.closest('label')?.textContent || '').toLowerCase();
  };
  // ---- payment cards ------------------------------------------------------
  const CC = { 'cc-number': 'number', 'cc-name': 'name', 'cc-exp': 'exp', 'cc-exp-month': 'month', 'cc-exp-year': 'year', 'cc-csc': 'csc', 'cc-given-name': 'name' };
  function cardKey(el) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return null;
    if (el instanceof HTMLInputElement && !/^(text|tel|number|)$/i.test(el.type || 'text')) return null;
    const tok = (el.autocomplete || '').toLowerCase().split(/\s+/).filter(Boolean).pop();
    if (tok && CC[tok]) return CC[tok];
    const a = `${attrs(el)} ${labelText(el)} ${el.getAttribute('data-stripe') || ''}`;
    if (/(cvc|cvv|csc|cvn|security.?code|card.?verification|card.?code)/.test(a)) return 'csc';
    if (/(card.?number|cardnum|ccnum|cc.?number|credit.?card|debit.?card|kartennummer|num[eé]ro.?de.?carte|n[uú]mero.?de.?tarjeta)/.test(a)) return 'number';
    if (/(name.?on.?card|card.?holder|cardholder|ccname|cc.?name|card.?name)/.test(a)) return 'name';
    if (/(exp.*month|month.*exp|cc.?month|card.?month|\bmm\b$)/.test(a)) return 'month';
    if (/(exp.*year|year.*exp|cc.?year|card.?year|\byy(yy)?\b$)/.test(a)) return 'year';
    if (/(expir|exp.?date|valid.?thru|mm.?\/?.?yy)/.test(a)) return 'exp';
    return null;
  }
  function cardFields(scope) {
    return [...scope.querySelectorAll('input, select')].filter(visible).map(el => ({ el, key: cardKey(el) })).filter(x => x.key);
  }
  function cardScope(el) {
    const scope = el.form || el.closest('form') || document;
    const fields = cardFields(scope);
    return fields.some(f => f.key === 'number') ? { scope, fields } : null;
  }
  async function fillCard(id, field) {
    const c = await ipcRenderer.invoke('pw', 'card:fill', id);
    const sc = c && cardScope(field);
    if (!sc) return;
    const mm = String(c.month || '').padStart(2, '0'), yyyy = String(c.year || ''), yy = yyyy.slice(-2);
    for (const { el, key } of sc.fields) {
      if (key === 'number') setValue(el, c.number);
      else if (key === 'name' && c.name) setValue(el, c.name);
      else if (key === 'month' && c.month) {
        if (el instanceof HTMLSelectElement) { const o = [...el.options].find(o => parseInt(o.value, 10) === c.month || parseInt(o.text, 10) === c.month); if (o) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); } }
        else setValue(el, mm);
      } else if (key === 'year' && c.year) {
        if (el instanceof HTMLSelectElement) { const o = [...el.options].find(o => [yyyy, yy].includes(o.value.trim()) || [yyyy, yy].includes(o.text.trim())); if (o) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); } }
        else setValue(el, (el.maxLength === 2 || /\byy\b/i.test(el.placeholder) && !/yyyy/i.test(el.placeholder)) ? yy : yyyy);
      } else if (key === 'exp' && c.month && c.year) {
        const long = el.maxLength >= 7 || /yyyy/i.test(el.placeholder || '');
        setValue(el, `${mm}/${long ? yyyy : yy}`);
      }
    }
    // The security code is never saved: put the cursor there so it can be typed.
    sc.fields.find(f => f.key === 'csc')?.el.focus();
  }

  function addrKey(el) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return null;
    if (el instanceof HTMLInputElement && !/^(text|email|tel|)$/i.test(el.type || 'text')) return null;
    if (cardKey(el)) return null;   // "name on card" is a card field, not an address
    const tok = (el.autocomplete || '').toLowerCase().split(/\s+/).filter(t => t && !/^section-|^(shipping|billing|home|work|mobile)$/.test(t)).pop();
    if (tok === 'off' || tok === 'username' || /password|cc-|one-time-code/.test(tok || '')) return null;
    if (tok && AC[tok]) return AC[tok];
    const a = `${attrs(el)} ${labelText(el)}`;
    if (el.type === 'email' || /e-?mail/.test(a)) return 'email';
    if (el.type === 'tel' || /(phone|tel\b|mobile|cell)/.test(a)) return 'phone';
    if (/(zip|postal|post.?code)/.test(a)) return 'postal';
    if (/(city|town|suburb|locality)/.test(a)) return 'city';
    if (/(state|province|county|region)/.test(a)) return 'region';
    if (/country/.test(a)) return 'country';
    if (/(address.?(line)?.?2|apartment|\bapt\b|suite|unit|flat|building)/.test(a)) return 'line2';
    if (/(address|street|addr)/.test(a)) return 'street';
    if (/(company|organi[sz]ation|business)/.test(a)) return 'org';
    if (/(full.?name|your.?name)/.test(a)) return 'name';   // before first/last: "fullname" contains "lname"
    if (/(first.?name|given.?name|\bfname\b|forename)/.test(a)) return 'given';
    if (/(last.?name|surname|family.?name|\blname\b)/.test(a)) return 'family';
    if (/\bname\b/.test(a) && !/(user|login|company|file)/.test(a)) return 'name';
    return null;
  }
  function addressFields(scope) {
    return [...scope.querySelectorAll('input, select, textarea')].filter(visible).map(el => ({ el, key: addrKey(el) })).filter(x => x.key);
  }
  // An address form: at least 3 different address fields, one of them a street or postcode.
  function addressScope(el) {
    const scope = el.form || el.closest('form') || document;
    const fields = addressFields(scope);
    const keys = new Set(fields.map(f => f.key));
    return keys.size >= 3 && (keys.has('street') || keys.has('postal')) ? { scope, fields } : null;
  }

  // ---- the picker (closed shadow root so the page can't read it) ----------
  let host = null, shadow = null, list = null, head = null, anchor = null, accounts = null, meterHost = null, meter = null;
  function ensurePicker() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      .box{font:13px/1.3 "Segoe UI",system-ui,sans-serif;background:#fff;color:#1d1730;border-radius:10px;min-width:260px;max-width:360px;
        box-shadow:0 10px 30px rgba(20,10,50,.25),0 0 0 1px rgba(0,0,0,.06);padding:6px;}
      .hd{font-size:11px;font-weight:600;opacity:.55;padding:4px 8px 6px;display:flex;align-items:center;gap:6px}
      .it{display:flex;align-items:center;gap:10px;padding:8px;border-radius:7px;cursor:default}
      .it:hover,.it.sel{background:#efe9fb}
      .k{width:22px;height:22px;border-radius:50%;background:#e4dcf7;display:grid;place-items:center;font-size:11px;font-weight:700;color:#5b3fb8;flex:none}
      .u{flex:1;min-width:0;overflow:hidden}
      .u b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .u small{display:block;opacity:.6;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mono{font-family:Consolas,"Cascadia Mono",monospace;letter-spacing:.3px}
      .d{opacity:.45;letter-spacing:2px}
    </style><div class="box"><div class="hd"></div><div class="list"></div></div>`;
    list = shadow.querySelector('.list');
    head = shadow.querySelector('.hd');
    shadow.querySelector('.box').addEventListener('mousedown', e => e.preventDefault()); // keep field focused
    (document.body || document.documentElement).appendChild(host);
  }
  function hidePicker() { if (host) host.style.display = 'none'; anchor = null; }
  function place(el, field) {
    const r = field.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(r.left, innerWidth - 300)) + 'px';
    el.style.top = Math.min(r.bottom + 4, innerHeight - 70) + 'px';
  }
  // items: [{ icon, title, sub, mono, onPick }]
  function showPicker(field, header, items) {
    if (!items.length) return;
    ensurePicker();
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    anchor = field;
    head.textContent = header;
    list.replaceChildren(...items.map(item => {
      const it = document.createElement('div');
      it.className = 'it';
      const k = document.createElement('span'); k.className = 'k'; k.textContent = item.icon;
      const u = document.createElement('span'); u.className = 'u';
      const b = document.createElement('b'); b.textContent = item.title; if (item.mono) b.className = 'mono';
      u.append(b);
      if (item.sub) { const s = document.createElement('small'); s.textContent = item.sub; u.append(s); }
      it.append(k, u);
      if (item.dots) { const d = document.createElement('span'); d.className = 'd'; d.textContent = '••••••'; it.append(d); }
      it.addEventListener('click', () => { hidePicker(); item.onPick(); });
      return it;
    }));
    place(host, field);
    host.style.display = 'block';
  }

  // Strength meter under a new-password field.
  function showMeter(field) {
    if (!meterHost) {
      meterHost = document.createElement('div');
      meterHost.style.cssText = 'position:fixed;z-index:2147483646;top:0;left:0;display:none;pointer-events:none;';
      const sh = meterHost.attachShadow({ mode: 'closed' });
      sh.innerHTML = `<style>
        .m{font:11.5px/1.3 "Segoe UI",system-ui,sans-serif;background:#fff;color:#1d1730;border-radius:8px;padding:6px 8px;width:240px;
          box-shadow:0 6px 18px rgba(20,10,50,.2),0 0 0 1px rgba(0,0,0,.06)}
        .bar{display:flex;gap:3px;margin-bottom:4px}.bar i{flex:1;height:4px;border-radius:2px;background:#e6e1f2}
        .l{font-weight:600}.t{opacity:.7}</style><div class="m"><div class="bar"><i></i><i></i><i></i><i></i></div><span class="l"></span> <span class="t"></span></div>`;
      meter = sh;
      (document.body || document.documentElement).appendChild(meterHost);
    }
    const hints = [location.hostname.split('.').slice(-2, -1)[0], usernameFieldFor(field)?.value?.split('@')[0]];
    const s = strength(field.value, hints);
    if (!field.value) { meterHost.style.display = 'none'; return; }
    const colors = ['#d93025', '#d93025', '#e8a400', '#1e8e3e', '#1e8e3e'];
    meter.querySelectorAll('.bar i').forEach((b, i) => { b.style.background = i < Math.max(1, s.score) ? colors[s.score] : '#e6e1f2'; });
    meter.querySelector('.l').textContent = s.label;
    meter.querySelector('.l').style.color = colors[s.score];
    meter.querySelector('.t').textContent = s.tip;
    const r = field.getBoundingClientRect();
    meterHost.style.left = Math.max(4, Math.min(r.left, innerWidth - 250)) + 'px';
    meterHost.style.top = (r.top > 70 ? r.top - 56 : r.bottom + 4) + 'px';
    meterHost.style.display = 'block';
  }
  const hideMeter = () => { if (meterHost) meterHost.style.display = 'none'; };

  async function fillAccount(id, field) {
    const cred = await ipcRenderer.invoke('pw', 'fill', id);
    if (!cred) return;
    const pw = field.type === 'password' ? field : (passwordFields().find(p => !field.form || p.form === field.form) || passwordFields()[0]);
    const user = pw ? usernameFieldFor(pw) : (field.type !== 'password' ? field : null);
    if (user && cred.username) setValue(user, cred.username);
    if (pw) setValue(pw, cred.password);
  }
  function fillNewPassword(field, password) {
    for (const p of newPasswordFields(field)) setValue(p, password);
    showMeter(field);
  }
  async function fillAddress(id, field) {
    const a = await ipcRenderer.invoke('pw', 'addr:fill', id);
    const sc = a && addressScope(field);
    if (!sc) return;
    const full = a.name || [a.given, a.family].filter(Boolean).join(' ');
    const parts = full.trim().split(/\s+/);
    const val = { ...a, name: full, given: a.given || parts.slice(0, -1).join(' ') || parts[0] || '', family: a.family || (parts.length > 1 ? parts[parts.length - 1] : '') };
    const seen = new Set();
    for (const { el, key } of sc.fields) {
      // Two street fields and no "line 2" field: the second one gets line 2.
      let k = key;
      if (k === 'street' && seen.has('street') && !sc.fields.some(f => f.key === 'line2')) k = 'line2';
      seen.add(k);
      if (val[k]) setValue(el, val[k]);
    }
  }

  // A one-time-code box (or one of a row of single-digit boxes).
  function isOtpField(el) {
    if (!/^(text|tel|number|password|)$/i.test(el.type || 'text') || cardKey(el)) return false;
    if (/one-time-code/.test(el.autocomplete || '')) return true;
    const a = `${attrs(el)} ${labelText(el)}`;
    return /(\botp\b|totp|2fa|two.?factor|mfa|one.?time|verification.?code|auth(entication|enticator)?.?code|security.?code|6.?digit|approvals_code|app_otp|tfa)/.test(a)
      && !/(cvc|cvv|card|zip|postal|phone|promo|coupon|gift)/.test(a);
  }
  function fillOtp(el, code) {
    // Split boxes (one digit each): fill the row from this box on.
    const row = el.maxLength === 1 ? [...(el.form || el.parentElement?.parentElement || document).querySelectorAll('input')].filter(i => i.maxLength === 1 && visible(i)) : [];
    if (row.length >= code.length) { const i0 = Math.max(0, row.indexOf(el)); [...code].forEach((d, i) => row[i0 + i] && setValue(row[i0 + i], d)); }
    else setValue(el, code);
  }

  async function onFocus(e) {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    hideMeter();
    if (el instanceof HTMLInputElement && el.type === 'password' && isNewPassword(el)) {
      if (el.value) showMeter(el);
      if (el.value) return;
      const pw = await ipcRenderer.invoke('pw', 'generate');
      if (!pw || document.activeElement !== el) return;
      return showPicker(el, 'Quasar passwords', [{ icon: '✦', title: 'Use a strong password', sub: pw, onPick: () => fillNewPassword(el, pw) }]);
    }
    const pws = passwordFields();
    const isPw = el instanceof HTMLInputElement && el.type === 'password';
    const isUser = !isPw && el instanceof HTMLInputElement && pws.some(p => usernameFieldFor(p) === el);
    if (isPw || isUser) {
      if (accounts === null) accounts = await ipcRenderer.invoke('pw', 'list') || [];
      if (document.activeElement !== el) return;
      return showPicker(el, 'Quasar passwords', accounts.map(a => ({ icon: (a.username || '?').charAt(0).toUpperCase(), title: a.username || '(no username)', dots: true, onPick: () => fillAccount(a.id, el) })));
    }
    if ((cardKey(el) === 'number' || cardKey(el) === 'name') && cardScope(el) && !el.value) {
      const cards = await ipcRenderer.invoke('pw', 'card:list') || [];
      if (document.activeElement !== el) return;
      return showPicker(el, 'Quasar cards — you’ll confirm with Windows Hello', cards.map(c => ({ icon: '▭', title: `${c.nickname || c.brand} •••• ${c.last4}`, mono: false,
        sub: [c.month && c.year ? `Expires ${String(c.month).padStart(2, '0')}/${String(c.year).slice(-2)}` : '', c.name].filter(Boolean).join(' · '), onPick: () => fillCard(c.id, el) })));
    }
    // Authenticator (two-step sign-in) code boxes: the code from the saved login of this site.
    if (el instanceof HTMLInputElement && isOtpField(el) && !el.value) {
      const logins = await ipcRenderer.invoke('pw', 'otp:list') || [];
      if (document.activeElement !== el || !logins.length) return;
      return showPicker(el, 'Quasar authenticator codes', logins.map(a => ({ icon: '#', title: `Code for ${a.username || '(no username)'}`, sub: 'Fills the current 6-digit code',
        onPick: async () => { const c = await ipcRenderer.invoke('pw', 'otp:fill', a.id); if (c) fillOtp(el, c); } })));
    }
    if (addrKey(el) && addressScope(el) && !el.value) {
      const addrs = await ipcRenderer.invoke('pw', 'addr:list') || [];
      if (document.activeElement !== el) return;
      showPicker(el, 'Quasar addresses', addrs.map(a => ({ icon: (a.label || a.name || '?').charAt(0).toUpperCase(), title: a.label || a.name, sub: a.line, onPick: () => fillAddress(a.id, el) })));
    }
  }
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('click', e => { if (e.target === document.activeElement) onFocus(e); }, true);
  document.addEventListener('focusout', () => setTimeout(() => { if (anchor && document.activeElement !== anchor) hidePicker(); if (document.activeElement?.type !== 'password') hideMeter(); }, 150), true);
  document.addEventListener('input', e => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.type === 'password' && isNewPassword(el)) { hidePicker(); showMeter(el); }
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { hidePicker(); hideMeter(); } }, true);
  addEventListener('scroll', () => { hidePicker(); hideMeter(); }, true);
  addEventListener('resize', hidePicker);

  // Right-click › Suggest Strong Password.
  ipcRenderer.on('arch:suggest-password', (e, pw) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'password' && typeof pw === 'string') fillNewPassword(el, pw);
  });

  // ---- offer to save on submit -------------------------------------------
  let lastSent = '', lastAddr = '';
  let lastCard = '';
  function captureCard(scope) {
    const fields = cardFields(scope || document);
    const get = k => { const f = fields.find(x => x.key === k && x.el.value); return f ? String(f.el instanceof HTMLSelectElement ? f.el.value : f.el.value).trim() : ''; };
    const number = get('number').replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(number)) return;
    let month = get('month'), year = get('year');
    const exp = get('exp').match(/^(\d{1,2})\s*[/\-. ]\s*(\d{2,4})$/);
    if (exp) { month = exp[1]; year = exp[2]; }
    const k = `${number}|${month}|${year}`;
    if (k === lastCard) return;
    lastCard = k;
    ipcRenderer.send('card:candidate', { number, name: get('name'), month, year });   // never the security code
  }
  function capture(scope) {
    captureAddress(scope);
    captureCard(scope);
    const pw = [...(scope || document).querySelectorAll('input[type=password]')].find(p => p.value && visible(p))
      || passwordFields().find(p => p.value);
    if (!pw) return;
    const user = usernameFieldFor(pw);
    const key = `${user?.value || ''}\n${pw.value}`;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send('pw:candidate', { username: user?.value?.trim() || '', password: pw.value });
  }
  function captureAddress(scope) {
    const fields = addressFields(scope || document).filter(f => f.el.value && String(f.el.value).trim());
    const data = {};
    for (const { el, key } of fields) {
      if (data[key]) { if (key === 'street' && !data.line2) data.line2 = String(el.value).trim(); continue; }
      data[key] = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text || el.value).trim() : String(el.value).trim();
    }
    if (Object.keys(data).length < 3 || !(data.street || data.postal)) return;
    const k = JSON.stringify(data);
    if (k === lastAddr) return;
    lastAddr = k;
    ipcRenderer.send('addr:candidate', data);
  }
  document.addEventListener('submit', e => capture(e.target), true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && (e.target.type === 'password' || passwordFields().length || addrKey(e.target) || cardKey(e.target))) capture(e.target.form);
  }, true);
  // Nothing typed anywhere means nothing to offer to save: skip the form scan (it measures
  // every field, which made clicks slow on big pages).
  const anyTyped = () => {
    for (const el of document.querySelectorAll('input, textarea')) if (el.value && !/^(hidden|submit|button|reset|image|checkbox|radio|file|range|color)$/i.test(el.type)) return true;
    return false;
  };
  document.addEventListener('click', e => {
    const b = e.target.closest?.('button, input[type=submit], [role=button]');
    if (b && anyTyped() && (passwordFields().some(p => p.value) || addressFields(b.form || b.closest('form') || document).length >= 3 || cardFields(b.form || b.closest('form') || document).some(f => f.key === 'number' && f.el.value))) capture(b.form || b.closest('form'));
  }, true);
}
