// Quasar's request filter: ad and tracker blocking, dangerous-site warnings and
// Always-HTTPS. One webRequest listener per Space (session).
//
// Lists are downloaded to %APPDATA%\Quasar\filters and checked on this PC only:
// the addresses you visit are never sent anywhere.
//   ads/trackers: EasyList + EasyPrivacy (network rules: "||domain^", "||domain/path",
//                 with $third-party and resource-type options; no cosmetic hiding)
//   malware:      URLhaus (abuse.ch) malware hosts, via urlhaus-filter
//   phishing:     OpenPhish feed (URLs) + Phishing Army (host names)

const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');

const LISTS = {
  easylist: { url: 'https://easylist.to/easylist/easylist.txt', kind: 'ads', every: 4 * 864e5 },
  easyprivacy: { url: 'https://easylist.to/easylist/easyprivacy.txt', kind: 'ads', every: 4 * 864e5 },
  // URLhaus (abuse.ch) data via the maintained urlhaus-filter (popular domains excluded).
  urlhaus: { url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt', kind: 'malware-hosts', every: 6 * 3600e3 },
  openphish: { url: 'https://openphish.com/feed.txt', kind: 'phishing', every: 6 * 3600e3 },
  phisharmy: { url: 'https://phishing.army/download/phishing_army_blocklist.txt', kind: 'phishing-hosts', every: 12 * 3600e3 },
  // EasyList Cookie List: hides cookie banners and blocks the scripts that show them.
  cookies: { url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt', kind: 'cookies', every: 4 * 864e5 },
};
const AUTOCONSENT = require('path').join(__dirname, '..', 'node_modules', '@duckduckgo', 'autoconsent', 'dist', 'autoconsent.standalone.js');
const AUTOCONSENT_RULES = require('path').join(__dirname, '..', 'node_modules', '@duckduckgo', 'autoconsent', 'rules', 'compact-rules.json');

// Used until the full lists have downloaded (and if they never can).
const BUILTIN_ADS = `doubleclick.net googlesyndication.com googleadservices.com google-analytics.com googletagservices.com
adservice.google.com pagead2.googlesyndication.com analytics.google.com ssl.google-analytics.com
connect.facebook.net pixel.facebook.com an.facebook.com ads.linkedin.com px.ads.linkedin.com analytics.twitter.com ads-twitter.com
static.ads-twitter.com amazon-adsystem.com adsystem.amazon.com scorecardresearch.com sb.scorecardresearch.com quantserve.com
adnxs.com criteo.com criteo.net taboola.com outbrain.com hotjar.com static.hotjar.com mixpanel.com segment.io cdn.segment.com
adsrvr.org rubiconproject.com pubmatic.com openx.net casalemedia.com indexww.com moatads.com doubleverify.com adsafeprotected.com
bat.bing.com clarity.ms advertising.com yieldmo.com sharethrough.com teads.tv smartadserver.com media.net contextweb.com
3lift.com bidswitch.net adform.net zemanta.com revcontent.com mgid.com chartbeat.com chartbeat.net newrelic.com nr-data.net
fullstory.com mouseflow.com crazyegg.com quantcount.com addthis.com sumo.com branch.io app-measurement.com`.split(/\s+/);

// Never treat these as dangerous, even if a list wrongly includes them.
const NEVER_DANGEROUS = new Set(['google.com', 'youtube.com', 'microsoft.com', 'live.com', 'office.com', 'apple.com', 'icloud.com',
  'amazon.com', 'facebook.com', 'instagram.com', 'github.com', 'githubusercontent.com', 'wikipedia.org', 'cloudflare.com',
  'dropbox.com', 'linkedin.com', 'x.com', 'twitter.com', 'reddit.com', 'yahoo.com', 'bing.com', 'duckduckgo.com', 'mozilla.org']);

const TYPE_OPTS = { script: 'script', image: 'image', stylesheet: 'stylesheet', xmlhttprequest: 'xhr', subdocument: 'subFrame',
  ping: 'ping', media: 'media', font: 'font', object: 'object', websocket: 'webSocket', other: 'other' };

// Small memo for pure string -> string functions called on every network request
// (a page's requests repeat the same few hosts and the same page URL).
const memo = (fn, max) => {
  const cache = new Map();
  return x => {
    let v = cache.get(x);
    if (v === undefined) {
      v = fn(x);
      if (cache.size >= max) cache.clear();
      cache.set(x, v);
    }
    return v;
  };
};
// The bit of a host name that decides "same site" (good enough without a public-suffix list).
function siteOfRaw(host) {
  const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2 || /^\d+$/.test(parts[parts.length - 1])) return parts.join('.');
  const two = parts.slice(-2).join('.');
  if (/^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join('.');
  return two;
}
const siteOfMemo = memo(siteOfRaw, 4000);
function siteOf(host) { return typeof host === 'string' ? siteOfMemo(host) : siteOfRaw(host); }
function hostOfRaw(url) { try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; } }
const hostOfMemo = memo(hostOfRaw, 2000);
function hostOf(url) { return typeof url === 'string' && url.length < 2048 ? hostOfMemo(url) : hostOfRaw(url); }
// Normalised form for exact URL lists.
function normUrl(u) {
  try { const x = new URL(u.trim()); x.hash = ''; return (x.protocol + '//' + x.host.toLowerCase() + x.pathname + x.search).replace(/\/$/, ''); } catch { return null; }
}

// Adblock Plus syntax, network rules only. One trimmed line at a time.
const newNet = () => ({ block: new Map(), allow: new Map() });
function abpLine(line, out) {
  if (!line || line[0] === '!' || line[0] === '[' || line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) return;
  let allow = false;
  if (line.startsWith('@@')) { allow = true; line = line.slice(2); }
  if (!line.startsWith('||')) return;
  let opts = '';
  const d = line.indexOf('$');
  if (d >= 0) { opts = line.slice(d + 1); line = line.slice(0, d); }
  const m = /^\|\|([a-z0-9.-]+)(\^|\/[^*^|]*)?(\^|\|)?$/i.exec(line);
  if (!m) return;
  const domain = m[1].toLowerCase();
  const p = m[2] && m[2] !== '^' ? m[2].toLowerCase() : '';
  const rule = { path: p, third: null, types: null, doc: false };
  for (const o of opts ? opts.split(',') : []) {
    const k = o.trim().toLowerCase();
    if (k === 'third-party' || k === '3p') rule.third = true;
    else if (k === '~third-party' || k === '1p' || k === 'first-party') rule.third = false;
    else if (TYPE_OPTS[k]) (rule.types ||= new Set()).add(TYPE_OPTS[k]);
    else if (k === 'document' && allow) rule.doc = true;
    else if (k === 'important' || k === 'all' || k === 'match-case') { /* fine */ }
    else return;   // $domain=, $redirect, $csp, … are beyond this engine
  }
  const map = allow ? out.allow : out.block;
  if (!map.has(domain)) map.set(domain, []);
  map.get(domain).push(rule);
}

// ---- element hiding ("cosmetic" rules): example.com##.ad-box, ##.adsbygoogle, example.com#@#.ad
// Extended syntaxes (:has-text, :-abp-…, scriptlets, HTML filters) are beyond this engine.
const UNSUPPORTED = /:-abp-|:has-text\(|:contains\(|:xpath\(|:upward\(|:matches-|:remove\(|:style\(|:min-text-length|:watch-attr|:others\(|:if\(|:if-not\(|\{/;
const newCosmetic = () => ({ generic: new Set(), genericExcl: new Map(), specific: new Map(), except: new Map(), exceptAll: new Set() });
function cosmeticLine(line, out) {
  if (!line || line[0] === '!' || line[0] === '[' || line.startsWith('@@') || line.startsWith('||')) return;
  const ex = line.indexOf('#@#');
  const hide = line.indexOf('##');
  let at, exception;
  if (ex >= 0 && (hide < 0 || ex < hide)) { at = ex; exception = true; } else if (hide >= 0) { at = hide; exception = false; } else return;
  const domains = line.slice(0, at);
  const sel = line.slice(at + (exception ? 3 : 2)).trim();
  if (!sel || sel[0] === '+' || sel[0] === '^' || UNSUPPORTED.test(sel) || /#[?$%]#/.test(line)) return;
  const list = domains ? domains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean) : [];
  const pos = list.filter(d => d[0] !== '~'), neg = list.filter(d => d[0] === '~').map(d => d.slice(1));
  if (exception) {
    if (!pos.length) out.exceptAll.add(sel);
    for (const d of pos) { if (!out.except.has(d)) out.except.set(d, new Set()); out.except.get(d).add(sel); }
  } else if (!pos.length) {
    if (sel.includes(':has(')) return;              // :has() on every page is too slow
    if (neg.length) out.genericExcl.set(sel, new Set(neg));
    else out.generic.add(sel);
  } else {
    for (const d of pos) { if (!out.specific.has(d)) out.specific.set(d, new Set()); out.specific.get(d).add(sel); }
  }
}
const eachLine = (text, fn) => { for (const l of text.split(/\r?\n/)) fn(l.trim()); };
const parseAbp = (text, out = newNet()) => (eachLine(text, l => abpLine(l, out)), out);
const parseCosmetic = (text, out = newCosmetic()) => (eachLine(text, l => cosmeticLine(l, out)), out);
// Generic hiding rules that start with a class or id (.adsbygoogle, #cookie-banner …),
// about 97% of them, can only match a page that has that class or id. They're indexed
// by it and sent to a page only once its preload sees the class or id (like uBlock
// Origin and Brave do). Injecting all ~29,000 rules (1.2 MB of CSS) into every page cost
// ~30 ms per page load, more work on every style change, and memory in every tab.
// The rest (a few hundred) go in at document start with the site's own rules.
// Keys are lowercase so a match never gets missed (an extra rule is harmless).
const KEY_RE = /^([.#][A-Za-z0-9_-]+)(?=$|[.#[:\s>+~])/;
const keyOf = sel => (sel.includes(',') ? null : KEY_RE.exec(sel)?.[1].toLowerCase() || null);
function indexGeneric(c) {
  const keyed = new Map(), rest = [];
  const add = (sel, excl) => {
    const entry = excl ? [sel, excl] : sel;
    const k = keyOf(sel);
    if (!k) return rest.push(entry);
    const list = keyed.get(k);
    if (list) list.push(entry); else keyed.set(k, [entry]);
  };
  for (const s of c.generic) if (!c.exceptAll.has(s)) add(s);
  for (const [s, excl] of c.genericExcl) if (!c.exceptAll.has(s)) add(s, excl);
  return { keyed, rest };
}
const hostChain = host => {
  const chain = [];
  for (let h = host; h; h = h.includes('.') ? h.slice(h.indexOf('.') + 1) : '') { chain.push(h); if (!h.includes('.')) break; }
  return chain;
};
const builtinAds = () => { const n = newNet(); for (const d of BUILTIN_ADS) n.block.set(d, [{ path: '', third: true, types: null, doc: false }]); return n; };

// Quasar's own element hiding for YouTube (works even before the lists download).
const BUILTIN_COSMETIC = {
  'youtube.com': ['ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-sparkles-text-search-renderer',
    'ytd-display-ad-renderer', 'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer', 'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer', 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]', '#masthead-ad', '#player-ads',
    '.ytp-ad-overlay-container', '.ytp-ad-image-overlay', '.ytp-featured-product', 'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)', 'ytd-search-pyv-renderer',
    'ytd-merch-shelf-renderer', 'ytd-reel-video-renderer:has(.ytd-ad-slot-renderer)', 'ytm-promoted-sparkles-web-renderer', 'ytm-companion-ad-renderer', 'ad-slot-renderer'],
};
const isYouTube = host => /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host);

// ---- link cleaning (like Brave's and Firefox's): tracking parameters are taken off
// addresses you open, and "redirect" pages that only forward you somewhere are skipped.
const TRACK_PARAMS = new Set(['fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh',
  'mc_eid', '_hsenc', '_hsmi', '__hsfp', '__hssc', '__hstc', 'hsctatracking', 'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv', 'rb_clickid',
  's_cid', 'epik', 'srsltid', 'wickedid', 'irclickid', 'ref_src', 'ref_url', '_openstat', 'zanpid', 'spm', 'scm', 'obOrigUrl', 'sc_cid', 'cvid', 'ns_mchannel', 'ns_source', 'ns_campaign', 'ns_linkname', 'ns_fee']
  .map(s => s.toLowerCase()));
const TRACK_SITE_PARAMS = { 'youtube.com': ['si', 'feature', 'pp'], 'youtu.be': ['si', 'feature'], 'open.spotify.com': ['si'], 'twitter.com': ['s', 't'], 'x.com': ['s', 't'],
  'instagram.com': ['igsh', 'img_index'], 'amazon.com': ['ref_', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'pd_rd_i', 'content-id', 'psc'], 'linkedin.com': ['trk', 'trackingid', 'lipi'] };
// Forwarding pages: host pattern, path pattern, the parameter holding the real address.
const REDIRECTORS = [
  [/^(www\.)?google\.[a-z.]+$/, /^\/url$/, ['q', 'url']],
  [/^l[m]?\.facebook\.com$/, /^\/l\.php$/, ['u']],
  [/^l\.instagram\.com$/, /^\/$/, ['u']],
  [/^l\.messenger\.com$/, /^\/l\.php$/, ['u']],
  [/^out\.reddit\.com$/, /.*/, ['url']],
  [/^(www\.)?youtube\.com$/, /^\/redirect$/, ['q']],
  [/^steamcommunity\.com$/, /^\/linkfilter\/?$/, ['url', 'u']],
  [/^(www\.)?slack-redir\.net$/, /^\/link$/, ['url']],
  [/^away\.vk\.com$/, /^\/away\.php$/, ['to']],
  [/^href\.li$/, /^\/$/, null],
  [/(^|\.)safelinks\.protection\.outlook\.com$/, /.*/, ['url']],
  [/^(www\.)?deviantart\.com$/, /^\/users\/outgoing$/, null],
  [/^t\.umblr\.com$/, /^\/redirect$/, ['z']],
  [/^exit\.sc$/, /^\/$/, ['url']],
  [/^click\.linksynergy\.com$/, /.*/, ['murl', 'RD_PARM1']],
  [/^(www\.)?bing\.com$/, /^\/ck\/a$/, null],
];
function cleanUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (!/^https?:$/.test(u.protocol)) return url;
  const host = u.hostname.toLowerCase();
  // A forwarding page: go straight to where it points.
  for (const [h, p, keys] of REDIRECTORS) {
    if (!h.test(host) || !p.test(u.pathname)) continue;
    let target = null;
    if (keys) for (const k of keys) { const v = u.searchParams.get(k); if (v && /^https?:\/\//i.test(v)) { target = v; break; } }
    else if (host === 'href.li' && /^https?:\/\//i.test(decodeURIComponent(u.search.slice(1)))) target = decodeURIComponent(u.search.slice(1));
    else if (/deviantart/.test(host)) target = decodeURIComponent(u.search.slice(1));
    if (target && /^https?:\/\//i.test(target)) return cleanUrl(target);
  }
  if (!u.search) return url;
  const site = siteOf(host);
  const extra = new Set((TRACK_SITE_PARAMS[site] || TRACK_SITE_PARAMS[host] || []).map(s => s.toLowerCase()));
  let changed = false;
  for (const k of [...u.searchParams.keys()]) {
    const l = k.toLowerCase();
    if (l.startsWith('utm_') || l.startsWith('pk_') && /^pk_(campaign|kwd|source|medium|content)$/.test(l) || TRACK_PARAMS.has(l) || extra.has(l)) { u.searchParams.delete(k); changed = true; }
  }
  if (!changed) return url;
  let out = u.toString();
  if (!u.searchParams.toString()) out = out.replace(/\?(?=#|$)/, '');
  return out;
}

class Protection {
  constructor(shell) {
    this.shell = shell;
    this.dir = path.join(app.getPath('userData'), 'filters');
    this.ads = builtinAds();
    this.badUrls = new Map();        // normalised URL -> 'malware' | 'phishing'
    this.badHosts = new Map();       // host name -> 'malware' | 'phishing'
    this.counts = new Map();         // webContents id -> blocked requests on the current page
    this.total = 0;
    this.upgrades = new Map();       // webContents id -> { httpUrl, httpsUrl, host } (Always-HTTPS)
    this.httpOk = new Set();         // "partition|host": user chose to continue on http (this session)
    this.dangerOk = new Set();       // "partition|host": user chose to visit a flagged site (this session)
    this.blocked = new Map();        // webContents id -> { kind, url, host, list } for the warning page
    this.listInfo = {};              // name -> { at, rules }
    this.cosmetic = newCosmetic();
    this.adIndex = indexGeneric(this.cosmetic);   // generic hiding rules by class/id (see indexGeneric)
    this.cssCache = new Map();       // host -> css (when it needs its own version)
    this.cookieNet = newNet();       // EasyList Cookie List, network part
    this.cookieCosmetic = newCosmetic();
    this.countRules();
    this.cookieIndex = indexGeneric(this.cookieCosmetic);
    this.consentDone = 0;            // cookie banners refused for you since Quasar started
    this.fpKey = require('crypto').randomBytes(32);   // fingerprint noise differs per site and per Quasar session
  }

  // ---- element hiding for one site
  // At document start: the site's own rules plus the generic ones that have no class/id
  // to wait for. The rest come from cosmeticFor() as the page shows its classes and ids.
  cssFor(host, kind = 'ads') {
    host = String(host || '').toLowerCase();
    const key = kind + '|' + host;
    if (this.cssCache.has(key)) return this.cssCache.get(key);
    const chain = hostChain(host);
    const c = kind === 'cookies' ? this.cookieCosmetic : this.cosmetic;
    const index = kind === 'cookies' ? this.cookieIndex : this.adIndex;
    const except = this.siteExceptions(c, chain);
    const rule = s => `${s}{display:none!important}\n`;
    let css = '';
    for (const e of index.rest) {
      const s = typeof e === 'string' ? e : e[0];
      if (!except.has(s) && (typeof e === 'string' || !chain.some(h => e[1].has(h)))) css += rule(s);
    }
    for (const h of chain) for (const s of c.specific.get(h) || []) if (!except.has(s)) css += rule(s);
    if (kind === 'ads') for (const [d, sels] of Object.entries(BUILTIN_COSMETIC)) if (chain.includes(d)) for (const s of sels) css += rule(s);
    if (this.cssCache.size > 400) this.cssCache.clear();
    this.cssCache.set(key, css);
    return css;
  }

  // Selectors a site turns off (#@# rules), on top of the ones turned off everywhere.
  siteExceptions(c, chain) {
    const key = (c === this.cookieCosmetic ? 'c|' : 'a|') + chain[0];
    const cache = this.exceptCache ||= new Map();
    if (cache.has(key) && cache.get(key).c === c) return cache.get(key).set;
    let set = c.exceptAll;
    for (const h of chain) {
      const own = c.except.get(h);
      if (own?.size) { if (set === c.exceptAll) set = new Set(set); for (const s of own) set.add(s); }
    }
    if (cache.size > 400) cache.clear();
    cache.set(key, { c, set });
    return set;
  }

  // Generic hiding rules for classes/ids a page has just shown (".foo", "#bar", lowercase).
  // Asked by the page's preload as they appear (see page-preload.js).
  cosmeticFor(host, tokens) {
    host = String(host || '').toLowerCase();
    if (!host || this.adsAllowed(host) || !Array.isArray(tokens)) return '';
    const chain = hostChain(host);
    let css = '';
    for (const [on, c, index] of [[this.adsOn, this.cosmetic, this.adIndex], [this.cookiesOn, this.cookieCosmetic, this.cookieIndex]]) {
      if (!on) continue;
      const except = this.siteExceptions(c, chain);
      for (const t of tokens) {
        if (typeof t !== 'string') continue;
        for (const e of index.keyed.get(t) || []) {
          const s = typeof e === 'string' ? e : e[0];
          if (!except.has(s) && (typeof e === 'string' || !chain.some(h => e[1].has(h)))) css += `${s}{display:none!important}\n`;
        }
      }
    }
    return css;
  }

  // What a page's preload needs at document start (see page-preload.js).
  //   block/css: hide ads and cookie banners · youtube/skipper: video ads
  //   fp: a per-site number for fingerprinting noise (null = off)
  pageConfig(host) {
    const allowed = !!host && this.adsAllowed(host);
    const ads = this.adsOn && !!host && !allowed;
    const cookies = this.cookiesOn && !!host && !allowed;
    const css = (ads ? this.cssFor(host) : '') + (cookies ? this.cssFor(host, 'cookies') : '');
    return { block: ads || cookies, css, youtube: ads && isYouTube(host), skipper: ads, fp: this.fpOn && host && !allowed ? this.fpSeed(host) : null,
      gestures: this.settings.gestures !== false, gpc: this.gpcOn, identity: host ? this.shell.identityFor(host) : null,
      caret: !!this.settings.caretBrowsing, autoScroll: this.settings.autoScroll !== false, otp: true,
      swipe: this.settings.swipeNav !== false, quickMenu: this.settings.quickMenu !== false };
  }

  // Same number for every page of a site (so the site works consistently), different
  // between sites and between Quasar sessions (so trackers can't match visits up).
  fpSeed(host) {
    const site = siteOf(host) || host;
    const cache = this.fpCache ||= new Map();
    let seed = cache.get(site);
    if (seed === undefined) {
      seed = require('crypto').createHmac('sha256', this.fpKey).update(site).digest().readUInt32LE(0);
      if (cache.size >= 1000) cache.clear();
      cache.set(site, seed);
    }
    return seed;
  }

  // Cookie banners the lists don't hide: DuckDuckGo's autoconsent finds the
  // consent tool on the page and clicks its "reject" / "only necessary" options.
  autoconsentSrc() {
    if (this._ac === undefined) {
      try {
        this._ac = fs.readFileSync(AUTOCONSENT, 'utf8')
          .replace(/lifecycle: true/g, 'lifecycle: false').replace(/rulesteps: true/g, 'rulesteps: false').replace(/waits: true/g, 'waits: false')
          .replace(/console\.log\("autoconsent standalone initialized"/, '(() => {})("autoconsent standalone initialized"');
      } catch { this._ac = null; }
    }
    return this._ac;
  }

  // The bundle carries all 1,600 consent-tool rules as one big JavaScript literal (560 KB),
  // though ~1,000 of them are for one site each. A page gets the ~600 generic rules plus
  // the ones for its own address, as JSON (far cheaper for V8 to parse and keep than a
  // literal): about half the script, with the same result (the bundle itself filters the
  // rules this way, but only after the page has parsed all of them).
  autoconsentFor(url) {
    if (this._acSplit === undefined) {
      this._acSplit = null;
      try {
        const src = this.autoconsentSrc();
        const at = src.indexOf('\n  var compact_rules_default = ');
        const end = src.indexOf('\n', at + 1);
        const rules = JSON.parse(fs.readFileSync(AUTOCONSENT_RULES, 'utf8'));
        const i = rules.index;
        // Only if the bundle's rules are these (same package version): its index matches.
        const same = at > 0 && src.slice(at, end).includes(`index: { genericRuleRange: [${i.genericRuleRange.join(', ')}], frameRuleRange: [${i.frameRuleRange.join(', ')}], specificRuleRange: [${i.specificRuleRange.join(', ')}], genericStringEnd: ${i.genericStringEnd}, frameStringEnd: ${i.frameStringEnd} }`)
          && rules.r.length === i.specificRuleRange[1];
        if (same) {
          const generic = rules.r.slice(...i.genericRuleRange);
          const specific = rules.r.slice(...i.specificRuleRange).map(r => ({ r, re: r[3] ? new RegExp(r[3]) : null }));
          const pack = (r, s) => JSON.stringify(JSON.stringify({ v: rules.v, s, r, index: { genericRuleRange: [0, generic.length], frameRuleRange: [0, 0], specificRuleRange: [generic.length, r.length], genericStringEnd: i.genericStringEnd, frameStringEnd: 0 } }));
          this._acSplit = {
            head: src.slice(0, at) + '\n  var compact_rules_default = JSON.parse(', tail: ');' + src.slice(end),
            rules, generic, specific, pack, genericOnly: pack(generic, rules.s.slice(0, i.genericStringEnd)),
          };
        }
      } catch { this._acSplit = null; }
    }
    const a = this._acSplit;
    if (!a) return this.autoconsentSrc();
    const mine = a.specific.filter(x => x.r[4] !== 1 && (!x.re || x.re.test(url))).map(x => x.r);
    if (!mine.length) return a.head + a.genericOnly + a.tail;
    // Strings the generic rules use, plus every string id this site's rules mention.
    const keep = new Set();
    const walk = v => { if (typeof v === 'number') keep.add(v); else if (v && typeof v === 'object') for (const k in v) walk(v[k]); };
    walk(mine);
    const s = a.rules.s.map((str, n) => (n < a.rules.index.genericStringEnd || keep.has(n) ? str : ''));
    return a.head + a.pack([...a.generic, ...mine], s) + a.tail;
  }

  onDomReady(wc) {
    if (!this.cookiesOn || wc.isDestroyed()) return;
    const url = wc.getURL();
    const host = hostOf(url);
    if (!/^https?:/i.test(url) || !host || this.adsAllowed(host)) return;
    const src = this.autoconsentFor(url);
    if (!src) return;
    wc.executeJavaScript(src).catch(() => {});
    // Count the banners it dealt with (for Settings).
    setTimeout(() => {
      if (wc.isDestroyed()) return;
      // Then let go of it: autoconsent and its ~800 KB of rules otherwise stay in every
      // page's memory for as long as the page is open (~20 MB a tab). Anything it is
      // still doing keeps running; it is just no longer reachable from the page.
      wc.executeJavaScript(`(() => { const m = window.autoconsentStandalone?.messages || []; const r = m.some(x => x.type === 'optOutResult' && x.result) ? (m.find(x => x.type === 'cmpDetected')?.cmp || 'yes') : ''; try { delete window.autoconsentStandalone; delete window.autoconsentReceiveMessage; } catch {} return r; })()`)
        .then(r => { if (r) { this.consentDone++; this.consentLast = { host, cmp: r }; if (wc.id) this.consented = (this.consented || new Map()).set(wc.id, r); this.shell.push(); } }).catch(() => {});
    }, 6000);
  }

  get settings() { return this.shell.st.settings; }
  get cookiesOn() { return this.settings.cookieBanners !== false; }
  get fpOn() { return this.settings.fingerprinting !== false; }
  get adsOn() { return this.settings.blockAds !== false; }
  get safeOn() { return this.settings.safeBrowsing !== false; }
  get gpcOn() { return this.settings.gpc !== false; }
  get cleanOn() { return this.settings.cleanLinks !== false; }
  get httpsOn() { return this.settings.httpsOnly !== false; }
  adsAllowed(host) { const s = siteOf(host); return (this.shell.st.adAllow || []).includes(s); }

  start() {
    // Load what we have, then refresh lists that are out of date (after start-up settles).
    setTimeout(() => { this.loadAll().catch(() => {}); setTimeout(() => this.update(), 20e3); }, 1500);
    setInterval(() => this.update(), 3600e3);
  }

  file(name) { return path.join(this.dir, name + '.txt'); }

  // Reads and parses the lists (several MB) in small slices, giving the main process
  // back every few milliseconds so windows and pages never freeze while it runs.
  // The old lists stay in use until the new ones are complete, then swap in at once.
  async loadAll() {
    const gen = this.loadGen = (this.loadGen || 0) + 1;
    let until = performance.now() + 8;
    const breathe = async () => {
      if (performance.now() < until) return;
      await new Promise(r => setImmediate(r));
      until = performance.now() + 8;
    };
    const ads = builtinAds(), cosmetic = newCosmetic();
    const cookieNet = newNet(), cookieCosmetic = newCosmetic();
    const badUrls = new Map(), badHosts = new Map();
    const listInfo = {};
    for (const [name, l] of Object.entries(LISTS)) {
      let text = '', at = 0;
      try { text = await fs.promises.readFile(this.file(name), 'utf8'); at = (await fs.promises.stat(this.file(name))).mtimeMs; } catch { continue; }
      if (gen !== this.loadGen) return;   // a newer load has started
      const lines = text.split(/\r?\n/);
      text = null;
      let n = 0;
      const before = ads.block.size + ads.allow.size;
      const kind = l.kind.replace('-hosts', '');
      for (let i = 0; i < lines.length; i++) {
        if ((i & 255) === 0) await breathe();
        const line = lines[i];
        if (l.kind === 'cookies') { const t = line.trim(); abpLine(t, cookieNet); cosmeticLine(t, cookieCosmetic); }
        else if (l.kind === 'ads') { const t = line.trim(); abpLine(t, ads); cosmeticLine(t, cosmetic); }
        else if (l.kind.endsWith('-hosts')) {
          // "host" or hosts-file style "0.0.0.0 host"
          const parts = line.trim().toLowerCase().split(/\s+/);
          const h = parts.length > 1 && /^(0\.0\.0\.0|127\.0\.0\.1)$/.test(parts[0]) ? parts[1] : parts[0];
          if (h && h[0] !== '#' && h[0] !== '!' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) {
            n++;
            const site = siteOf(h);
            if (site === h && NEVER_DANGEROUS.has(site)) continue;   // never flag these
            if (!badHosts.has(h) || kind === 'malware') badHosts.set(h, kind);
          }
        } else if (line && line[0] !== '#') { const u = normUrl(line); if (u) { badUrls.set(u, l.kind); n++; } }
      }
      if (l.kind === 'cookies') n = cookieNet.block.size + cookieCosmetic.generic.size + cookieCosmetic.specific.size;
      else if (l.kind === 'ads') n = ads.block.size + ads.allow.size - before;
      listInfo[name] = { at, rules: n };
    }
    await breathe();
    const adIndex = indexGeneric(cosmetic);
    await breathe();
    const cookieIndex = indexGeneric(cookieCosmetic);
    if (gen !== this.loadGen) return;
    for (const [name, info] of Object.entries(listInfo)) this.listInfo[name] = info;
    this.ads = ads; this.badUrls = badUrls; this.badHosts = badHosts;
    this.cosmetic = cosmetic; this.adIndex = adIndex;
    this.cookieNet = cookieNet; this.cookieCosmetic = cookieCosmetic; this.cookieIndex = cookieIndex;
    this.cssCache.clear();
    this.exceptCache?.clear();
    this.countRules();
    this.shell.push();
  }

  // Rule counts for Settings (the sidebar asks for them on every update).
  countRules() {
    this.rules = {
      adRules: [...this.ads.block.values()].reduce((n, r) => n + r.length, 0),
      hideRules: this.cosmetic.generic.size + this.cosmetic.genericExcl.size + [...this.cosmetic.specific.values()].reduce((n, s) => n + s.size, 0),
    };
  }

  // Download lists that are older than their refresh time.
  async update({ force = false } = {}) {
    if (this.updating) return;
    this.updating = true;
    let changed = false;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (const [name, l] of Object.entries(LISTS)) {
        let age = Infinity;
        try { age = Date.now() - fs.statSync(this.file(name)).mtimeMs; } catch { /* missing */ }
        if (!force && age < l.every) continue;
        try {
          const res = await net.fetch(l.url, { headers: { 'User-Agent': 'Quasar-browser-filter-lists' } });
          if (!res.ok) throw new Error(String(res.status));
          const text = await res.text();
          if (text.length < 50) throw new Error('empty');
          fs.writeFileSync(this.file(name) + '.tmp', text);
          fs.renameSync(this.file(name) + '.tmp', this.file(name));
          changed = true;
        } catch (err) { this.listInfo[name] = { ...(this.listInfo[name] || {}), error: err.message }; }
      }
      if (changed) await this.loadAll();
    } finally { this.updating = false; this.shell.push(); }
    return changed;
  }

  status() {
    const at = Object.values(this.listInfo).map(x => x.at || 0).filter(Boolean);
    return {
      ads: this.adsOn, safe: this.safeOn, https: this.httpsOn, total: this.total, updating: !!this.updating,
      cookies: this.cookiesOn, fp: this.fpOn, consentDone: this.consentDone, gpc: this.gpcOn, clean: this.cleanOn, cleaned: this.cleaned || 0,
      ...this.rules,
      dangerEntries: this.badUrls.size + this.badHosts.size,
      updated: at.length ? Math.min(...at) : 0,
    };
  }

  // ---- matching
  // What isAd needs about one request, worked out once and shared by the ad and cookie lists.
  adRequest(url, type, pageHost) {
    const host = hostOf(url);
    if (!host) return null;
    let after = null;
    return { host, type, pageHost, third: siteOf(host) !== siteOf(pageHost),
      // Only rules with a path need the rest of the address.
      after() {
        if (after === null) { const lower = url.toLowerCase(); after = lower.slice(lower.indexOf(host) + host.length).replace(/^:\d+/, ''); }
        return after;
      } };
  }

  isAd(url, type, pageHost, lists = this.ads, req = this.adRequest(url, type, pageHost)) {
    if (!req) return false;
    const { host, third } = req;
    const fits = r => (r.third === null || r.third === third) && (!r.types || r.types.has(type)) && (!r.path || req.after().startsWith(r.path));
    let blocked = false;
    // Walk the host's parents: a.b.example.com, b.example.com, example.com
    for (let h = host; h; h = h.includes('.') ? h.slice(h.indexOf('.') + 1) : '') {
      const allow = lists.allow.get(h);
      if (allow && allow.some(fits)) return false;
      const rules = lists.block.get(h);
      if (!blocked && rules && rules.some(fits)) blocked = true;
      if (!h.includes('.')) break;
    }
    // A page the lists say must never be blocked ($document exception).
    for (let h = pageHost; h; h = h.includes('.') ? h.slice(h.indexOf('.') + 1) : '') {
      const allow = lists.allow.get(h);
      if (allow && allow.some(r => r.doc)) return false;
      if (!h.includes('.')) break;
    }
    return blocked;
  }

  dangerous(url) {
    const host = hostOf(url);
    if (!host || NEVER_DANGEROUS.has(siteOf(host)) && !this.badUrls.has(normUrl(url))) return null;
    const n = normUrl(url);
    const exact = n && (this.badUrls.get(n) || this.badUrls.get(n.split('?')[0]));
    if (exact) return { kind: exact, host };
    for (let h = host; h && h.includes('.'); h = h.slice(h.indexOf('.') + 1)) {
      if (this.badHosts.has(h)) return { kind: this.badHosts.get(h), host };
    }
    return null;
  }

  // Hosts we never upgrade: local names, IP addresses, explicit ports.
  upgradable(u) {
    if (u.protocol !== 'http:' || u.port) return false;
    const h = u.hostname;
    if (!h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return false;
    return !/\.(local|localhost|test|internal|lan|home|arpa|example|invalid)$/i.test(h);
  }

  // ---- the request filter, installed once per Space session
  install(ses, partition) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
      try { cb(this.decide(d, partition) || {}); } catch { cb({}); }
    });
    // Global Privacy Control ("don't sell or share my data") and a site's chosen browser identity.
    ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
      try {
        const headers = d.requestHeaders;
        if (this.gpcOn) headers['Sec-GPC'] = '1';
        // Only work out the page's site when some site has its own browser identity.
        const ids = this.shell.st.siteIdentity;
        if ((!ids || !Object.keys(ids).length) && this.settings.googleSignInFix === false) return cb({ requestHeaders: headers });   // (Google's sign-in page has a built-in identity: see identityFor)
        const wc = d.webContents;
        const pageHost = d.resourceType === 'mainFrame' || d.resourceType === 'subFrame' || !wc || wc.isDestroyed() ? hostOf(d.url) : hostOf(wc.getURL());
        const kind = pageHost && this.shell.identityFor(pageHost);
        if (kind) this.shell.identityHeaders(kind, headers, ses.getUserAgent());
        cb({ requestHeaders: headers });
      } catch { cb({}); }
    });
  }

  decide(d, partition) {
    const url = d.url;
    if (!/^(https?|wss?):/i.test(url)) return null;
    const type = d.resourceType;
    const wc = d.webContents;
    if (type === 'mainFrame') {
      let u;
      try { u = new URL(url); } catch { return null; }
      // Tracking parameters off, forwarding pages skipped.
      if (this.cleanOn && d.method === 'GET') {
        const clean = cleanUrl(url);
        if (clean !== url) { this.cleaned = (this.cleaned || 0) + 1; return { redirectURL: clean }; }
      }
      // Always-HTTPS: try the secure address first.
      if (this.httpsOn && this.upgradable(u) && !this.httpOk.has(`${partition}|${u.hostname}`)) {
        const httpsUrl = 'https:' + url.slice(5);
        if (wc) this.upgrades.set(wc.id, { httpUrl: url, httpsUrl, host: u.hostname, at: Date.now() });
        return { redirectURL: httpsUrl };
      }
      if (this.safeOn) {
        const bad = this.dangerous(url);
        if (bad && !this.dangerOk.has(`${partition}|${bad.host}`)) {
          if (wc) this.blocked.set(wc.id, { kind: bad.kind, url, host: bad.host, partition });
          return { cancel: true };
        }
      }
      return null;
    }
    if (type === 'subFrame' && this.safeOn) {
      const bad = this.dangerous(url);
      if (bad && !this.dangerOk.has(`${partition}|${bad.host}`)) return { cancel: true };
    }
    if (!this.adsOn && !this.cookiesOn) return null;
    const page = wc && !wc.isDestroyed() ? wc.getURL() : (d.referrer || '');
    const pageHost = hostOf(page);
    if (!pageHost || page.startsWith('file:') || this.adsAllowed(pageHost)) return null;
    const req = this.adRequest(url, type, pageHost);
    if (!(this.adsOn && this.isAd(url, type, pageHost, this.ads, req)) && !(this.cookiesOn && this.isAd(url, type, pageHost, this.cookieNet, req))) return null;
    if (wc) this.counts.set(wc.id, (this.counts.get(wc.id) || 0) + 1);
    this.total++;
    this.bumpUi();
    return { cancel: true };
  }

  bumpUi() {
    if (this.bumpT) return;
    this.bumpT = setTimeout(() => { this.bumpT = null; this.shell.push(); }, 400);
  }
}

module.exports = { Protection, parseAbp, parseCosmetic, siteOf, normUrl, isYouTube, cleanUrl };
