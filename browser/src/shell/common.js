// Constants and small helpers shared by the Shell and its parts (src/shell/*.js).
const path = require('path');
const crypto = require('crypto');
const { clipboard } = require('electron');
const { pathToFileURL } = require('url');

const UI = path.join(__dirname, '..', '..', 'ui');
const CERT_PAGE = path.join(UI, 'cert-error.html');   // "Your connection isn't private" page
const CRASH_PAGE = path.join(UI, 'crashed.html');      // "This page crashed" page with a Reload button
const BLOCK_PAGE = path.join(UI, 'blocked.html');      // "Dangerous site" / "No secure connection" warnings
const READER_PAGE = path.join(UI, 'reader.html');      // Reader mode
const FAIL_PAGE = path.join(UI, 'offline.html');       // "Can't reach this page" / offline page with "Play offline"
const READABILITY = path.join(__dirname, '..', '..', 'node_modules', '@mozilla', 'readability');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const PAGE_PRELOAD = path.join(__dirname, '..', 'page-preload.js');
const ICON = path.join(__dirname, '..', '..', '..', 'icon', 'quasar.ico');
const TOP = 44;       // top bar height
const MARGIN = 8;     // gap around the web page card
const RADIUS = 10;    // rounded page corners
const SPLIT_GAP = 8;  // space between split-view panes (the focus ring and resize handle live here)

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const summarizeCert = c => c ? {
  subject: c.subject?.commonName || c.subjectName || '', org: c.subject?.organizations?.[0] || '',
  issuer: c.issuer?.commonName || c.issuerName || '',
  validStart: c.validStart ? c.validStart * 1000 : 0, validExpiry: c.validExpiry ? c.validExpiry * 1000 : 0,
  fingerprint: c.fingerprint || '',
} : null;

// ---- pinned tree helpers (folders and pinned split views hold `children`)
function walkPinned(list, fn, parent = null, depth = 0) {
  for (const n of list || []) { fn(n, list, parent, depth); if (n.children) walkPinned(n.children, fn, n, depth + 1); }
}
function findPinned(list, id) {
  let hit = null;
  walkPinned(list, (n, l, parent) => { if (!hit && n.id === id) hit = { node: n, list: l, index: l.indexOf(n), parent }; });
  return hit;
}
// Every pinned *tab* (inside folders and pinned splits too).
function pinnedTabNodes(list) {
  const out = [];
  walkPinned(list, n => { if (!n.type) out.push(n); });
  return out;
}

// ---- command bar calculator: a small expression parser (no eval).
// + - * / ^ %, parentheses, "15% of 80", sqrt/sin/cos/tan/log/ln/abs/round/floor/ceil, pi, e.
function calculate(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s || s.length > 200) return null;
  s = s.replace(/[×x](?=\s*[\d(.])/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')               // 1,000 -> 1000
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*/g, '($1/100)*');
  if (!/[-+*/^%(]|\b(sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil)\b/.test(s)) return null;   // plain numbers aren't sums
  if (/[^\d\s.+\-*/^%()a-z]/.test(s)) return null;
  const toks = s.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-z]+|[-+*/^%()]/g);
  if (!toks || toks.join('') !== s.replace(/\s+/g, '')) return null;
  const FN = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
  const K = { pi: Math.PI, e: Math.E };
  let i = 0;
  const peek = () => toks[i];
  const take = t => { if (toks[i] === t) { i++; return true; } return false; };
  function expr() { let v = term(); for (;;) { if (take('+')) v += term(); else if (take('-')) v -= term(); else return v; } }
  function term() {
    let v = unary();
    for (;;) {
      if (take('*')) v *= unary(); else if (take('/')) v /= unary();
      else if (peek() === '%') { i++; if (peek() && /^[\d(a-z]/.test(peek())) v %= unary(); else v /= 100; }
      else if (peek() === '(' || (peek() && /^[a-z]/.test(peek()))) v *= unary();   // 2(3+4), 2pi
      else return v;
    }
  }
  function unary() { if (take('-')) return -unary(); if (take('+')) return unary(); return power(); }
  function power() { const b = atom(); return take('^') ? Math.pow(b, unary()) : b; }
  function atom() {
    const t = toks[i++];
    if (t === undefined) throw new Error('end');
    if (t === '(') { const v = expr(); if (!take(')')) throw new Error(')'); return v; }
    if (/^\d/.test(t)) return parseFloat(t);
    if (t in K) return K[t];
    if (t in FN) { if (!take('(')) throw new Error('('); const v = expr(); if (!take(')')) throw new Error(')'); return FN[t](v); }
    throw new Error('bad ' + t);
  }
  try {
    const v = expr();
    if (i !== toks.length || !Number.isFinite(v)) return null;
    return Number(v.toPrecision(12)).toString();
  } catch { return null; }
}

// Electron 45's clipboard is promise-based and takes ClipboardItems (older versions
// had clipboard.writeImage); support both.
async function copyImage(img) {
  const { ClipboardItem } = require('electron');
  if (typeof clipboard.writeImage === 'function') return clipboard.writeImage(img);
  const png = img.toPNG();
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
}

// Arc import tree -> Quasar pinned nodes (with ids).
function importPinned(list) {
  return (list || []).map(n => n.type === 'folder' ? { id: uid(), type: 'folder', title: n.title || 'Folder', open: false, children: importPinned(n.children) }
    : n.type === 'split' ? { id: uid(), type: 'split', sizes: n.children.map(() => 1), children: n.children.map(c => ({ id: uid(), url: c.url, title: c.title, favicon: '' })) }
    : { id: uid(), url: n.url, title: n.title, favicon: '' });
}

// arch://drift (or arch://game) opens Space Drift any time, like chrome://dino.
// Tabs keep "arch://drift" as their address; only the actual load goes to the game page.
const DRIFT_URL = 'arch://drift';
const isDriftAddress = u => /^arch:\/\/(drift|game)\/?$/i.test(String(u || '').trim());
function pageUrl(url) {
  if (!isDriftAddress(url)) return url;
  const u = pathToFileURL(FAIL_PAGE);
  u.searchParams.set('game', '1');
  return u.href;
}

function toUrl(text) {
  const t = text.trim();
  if (/^arch:(\/\/)?(drift|game)\/?$/i.test(t)) return DRIFT_URL;
  if (/^[a-z][\w+.-]*:\/\//i.test(t) || /^(about|data|file|chrome):/i.test(t)) return t;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(t)) return 'http://' + t;
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(t)) return 'https://' + t;
  return null;
}

// Profile fields a Space reads from its Profile (see shell/profiles.js).
const PROFILE_KEYS = ['partition', 'pinned', 'favorites', 'history'];
// Zoom steps, like Chrome's.
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

module.exports = { UI, CERT_PAGE, CRASH_PAGE, BLOCK_PAGE, READER_PAGE, FAIL_PAGE, READABILITY, PRELOAD, PAGE_PRELOAD, ICON, TOP, MARGIN, RADIUS, SPLIT_GAP, uid, hostOf, summarizeCert, walkPinned, findPinned, pinnedTabNodes, calculate, copyImage, importPinned, DRIFT_URL, isDriftAddress, pageUrl, toUrl, PROFILE_KEYS, ZOOMS };
