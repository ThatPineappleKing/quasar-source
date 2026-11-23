// Reads bookmarks and history from other browsers on this PC, and reads/writes
// the standard bookmarks HTML file every browser can import and export.
//
//   Chromium-based (Chrome, Edge, Brave, Opera, Opera GX, Vivaldi):
//     <User Data>\<profile>\Bookmarks (JSON) and \History (SQLite)
//   Firefox: %APPDATA%\Mozilla\Firefox\Profiles\<profile>\places.sqlite
//
// Passwords are not read from other browsers' files (they are encrypted for that
// browser); export them as a CSV from the browser and import that file instead.
// Trees use the same shape as the Arc import: { url, title } or { type: 'folder', title, children }.

const fs = require('fs');
const os = require('os');
const path = require('path');

const L = process.env.LOCALAPPDATA || '', R = process.env.APPDATA || '';
const CHROMIUM = [
  { id: 'chrome', name: 'Google Chrome', dir: path.join(L, 'Google', 'Chrome', 'User Data') },
  { id: 'edge', name: 'Microsoft Edge', dir: path.join(L, 'Microsoft', 'Edge', 'User Data') },
  { id: 'brave', name: 'Brave', dir: path.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { id: 'vivaldi', name: 'Vivaldi', dir: path.join(L, 'Vivaldi', 'User Data') },
  // Opera keeps the profile itself in the folder (newer versions also use a "Default" folder).
  { id: 'opera', name: 'Opera', dir: path.join(R, 'Opera Software', 'Opera Stable'), single: true },
  { id: 'operagx', name: 'Opera GX', dir: path.join(R, 'Opera Software', 'Opera GX Stable'), single: true },
];
const PASSWORD_HELP = {
  chrome: 'In Chrome: Settings › Passwords and autofill › Google Password Manager › Settings › Export passwords.',
  edge: 'In Edge: Settings › Profiles › Passwords › ⋯ (More actions) › Export passwords.',
  brave: 'In Brave: Settings › Autofill and passwords › Password Manager › Settings › Export passwords.',
  vivaldi: 'In Vivaldi: Settings › Privacy and security › Passwords › Export passwords.',
  opera: 'In Opera: Settings › Advanced › Autofill › Password Manager › ⋮ › Export passwords.',
  operagx: 'In Opera GX: Settings › Advanced › Autofill › Password Manager › ⋮ › Export passwords.',
  firefox: 'In Firefox: Settings › Privacy & Security › Saved passwords › ⋯ (top right) › Export passwords.',
};

function chromiumProfiles(b) {
  const out = [];
  if (!fs.existsSync(b.dir)) return out;
  if (b.single) {
    for (const d of [b.dir, path.join(b.dir, 'Default')]) {
      if (fs.existsSync(path.join(d, 'Bookmarks')) || fs.existsSync(path.join(d, 'History'))) { out.push({ browser: b.id, kind: 'chromium', label: b.name, dir: d }); break; }
    }
    return out;
  }
  let names = {};
  try { names = JSON.parse(fs.readFileSync(path.join(b.dir, 'Local State'), 'utf8')).profile?.info_cache || {}; } catch { /* no Local State */ }
  let dirs = [];
  try { dirs = fs.readdirSync(b.dir).filter(d => d === 'Default' || /^Profile \d+$/.test(d)); } catch { /* unreadable */ }
  for (const d of dirs) {
    const full = path.join(b.dir, d);
    if (!fs.existsSync(path.join(full, 'Bookmarks')) && !fs.existsSync(path.join(full, 'History'))) continue;
    const n = names[d]?.name;
    out.push({ browser: b.id, kind: 'chromium', label: dirs.length > 1 || (n && !/^(Person 1|Default|Profile 1)$/.test(n)) ? `${b.name} — ${n || d}` : b.name, dir: full });
  }
  return out;
}

function firefoxProfiles() {
  const base = path.join(R, 'Mozilla', 'Firefox');
  const out = [];
  let ini = '';
  try { ini = fs.readFileSync(path.join(base, 'profiles.ini'), 'utf8'); } catch { return out; }
  for (const block of ini.split(/\r?\n(?=\[)/)) {
    if (!/^\[Profile/.test(block)) continue;
    const get = k => (block.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
    const p = get('Path');
    if (!p) continue;
    const dir = get('IsRelative') === '1' ? path.join(base, ...p.split('/')) : p;
    if (!fs.existsSync(path.join(dir, 'places.sqlite'))) continue;
    out.push({ browser: 'firefox', kind: 'firefox', label: `Firefox${get('Name') && !/^default(-release)?$/.test(get('Name')) ? ' — ' + get('Name') : ''}`, dir });
  }
  return out;
}

// Every browser profile found on this PC.
function findAll() {
  return [...CHROMIUM.flatMap(chromiumProfiles), ...firefoxProfiles()];
}

// Copy a database (and its write-ahead log) so a running browser's lock doesn't matter.
function openCopy(file) {
  const { DatabaseSync } = require('node:sqlite');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-import-'));
  const dst = path.join(tmpDir, path.basename(file));
  fs.copyFileSync(file, dst);
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) { try { fs.copyFileSync(file + ext, dst + ext); } catch { /* ignore */ } }
  const db = new DatabaseSync(dst);
  return { db, done: () => { try { db.close(); } catch { /* ignore */ } fs.rmSync(tmpDir, { recursive: true, force: true }); } };
}

const okUrl = u => /^(https?|file|ftp):/i.test(String(u || ''));

function chromiumBookmarks(dir) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'Bookmarks'), 'utf8'));
  const conv = n => n.type === 'folder' ? { type: 'folder', title: n.name || 'Folder', children: (n.children || []).map(conv).filter(Boolean) }
    : okUrl(n.url) ? { url: n.url, title: n.name || '' } : null;
  const roots = j.roots || {};
  const named = { bookmark_bar: 'Bookmarks bar', other: 'Other bookmarks', synced: 'Mobile bookmarks' };
  const out = [];
  for (const [k, title] of Object.entries(named)) {
    const kids = (roots[k]?.children || []).map(conv).filter(Boolean);
    if (kids.length) out.push({ type: 'folder', title, children: kids });
  }
  return out;
}

function firefoxBookmarks(dir) {
  const { db, done } = openCopy(path.join(dir, 'places.sqlite'));
  try {
    const rows = db.prepare('SELECT b.id, b.type, b.parent, b.position, b.title, b.guid, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position').all();
    const kids = new Map();
    for (const r of rows) (kids.get(r.parent) || kids.set(r.parent, []).get(r.parent)).push(r);
    const conv = r => r.type === 2 ? { type: 'folder', title: r.title || 'Folder', children: (kids.get(r.id) || []).map(conv).filter(Boolean) }
      : r.type === 1 && okUrl(r.url) && !/^place:/.test(r.url) ? { url: r.url, title: r.title || '' } : null;
    const named = { 'toolbar_____': 'Bookmarks toolbar', 'menu________': 'Bookmarks menu', 'unfiled_____': 'Other bookmarks', 'mobile______': 'Mobile bookmarks' };
    const out = [];
    for (const [guid, title] of Object.entries(named)) {
      const root = rows.find(r => r.guid === guid);
      const list = root ? (kids.get(root.id) || []).map(conv).filter(Boolean) : [];
      if (list.length) out.push({ type: 'folder', title, children: list });
    }
    return out;
  } finally { done(); }
}

function chromiumHistory(dir, limit) {
  const f = path.join(dir, 'History');
  if (!fs.existsSync(f)) return [];
  const { db, done } = openCopy(f);
  try {
    const st = db.prepare('SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?');
    st.setReadBigInts(true);
    return st.all(limit).filter(r => /^https?:/i.test(r.url))
      .map(r => ({ url: r.url, title: r.title || '', visits: Number(r.visit_count) || 1, last: Math.round(Number(r.last_visit_time) / 1000 - 11644473600000) }));
  } finally { done(); }
}

function firefoxHistory(dir, limit) {
  const { db, done } = openCopy(path.join(dir, 'places.sqlite'));
  try {
    const st = db.prepare('SELECT url, title, visit_count, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ?');
    st.setReadBigInts(true);
    return st.all(limit).filter(r => /^https?:/i.test(r.url))
      .map(r => ({ url: r.url, title: r.title || '', visits: Number(r.visit_count) || 1, last: Math.round(Number(r.last_visit_date) / 1000) }));
  } finally { done(); }
}

// { bookmarks: tree, history: [...], errors: [...] }
function read(src, { history = true, limit = 3000 } = {}) {
  const errors = [];
  let bookmarks = [], hist = [];
  try { bookmarks = src.kind === 'firefox' ? firefoxBookmarks(src.dir) : (fs.existsSync(path.join(src.dir, 'Bookmarks')) ? chromiumBookmarks(src.dir) : []); }
  catch (e) { errors.push('bookmarks: ' + e.message); }
  if (history) {
    try { hist = src.kind === 'firefox' ? firefoxHistory(src.dir, limit) : chromiumHistory(src.dir, limit); }
    catch (e) { errors.push('history: ' + e.message); }
  }
  return { bookmarks, history: hist, errors };
}

// ---- bookmarks HTML (the "Netscape bookmark file" format) ----
const unesc = s => String(s || '').replace(/&(amp|lt|gt|quot|#39|#x27|apos);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", apos: "'" }[k]));
const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function parseHtml(html) {
  const root = { type: 'folder', title: '', children: [] };
  const stack = [root];
  let pending = null;   // folder named by <H3>, waiting for its <DL>
  const re = /<(\/?)(dl|h3|a)\b([^>]*)>([\s\S]*?)(?=<)|<(\/?)(dl)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const close = (m[1] || m[5]) === '/';
    const tag = (m[2] || m[6]).toLowerCase();
    const top = stack[stack.length - 1];
    if (tag === 'dl') {
      if (close) { if (stack.length > 1) stack.pop(); }
      else if (pending) { stack.push(pending); pending = null; }
    } else if (tag === 'h3' && !close) {
      pending = { type: 'folder', title: unesc(m[4]).trim() || 'Folder', children: [] };
      top.children.push(pending);
    } else if (tag === 'a' && !close) {
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(m[3])?.[1] || /\bhref\s*=\s*'([^']*)'/i.exec(m[3])?.[1];
      const url = unesc(href);
      if (okUrl(url)) top.children.push({ url, title: unesc(m[4]).replace(/<[^>]+>/g, '').trim() });
    }
  }
  // A single top-level folder wrapper ("Bookmarks") is unwrapped.
  return root.children.length === 1 && root.children[0].type === 'folder' && !root.children[0].url ? root.children[0].children : root.children;
}

function toHtml(tree, title = 'Bookmarks') {
  const now = Math.floor(Date.now() / 1000);
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- This is an automatically generated file.', '     It will be read and overwritten.', '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', `<TITLE>${escH(title)}</TITLE>`, `<H1>${escH(title)}</H1>`, '<DL><p>'];
  const walk = (list, ind) => {
    for (const n of list) {
      if (n.type === 'folder' || n.children) {
        lines.push(`${ind}<DT><H3 ADD_DATE="${now}" LAST_MODIFIED="${now}">${escH(n.title || 'Folder')}</H3>`, `${ind}<DL><p>`);
        walk(n.children || [], ind + '    ');
        lines.push(`${ind}</DL><p>`);
      } else if (n.url) lines.push(`${ind}<DT><A HREF="${escH(n.url)}" ADD_DATE="${now}">${escH(n.title || n.url)}</A>`);
    }
  };
  walk(tree, '    ');
  lines.push('</DL><p>', '');
  return lines.join('\n');
}

const count = list => (list || []).reduce((n, x) => n + (x.children ? count(x.children) : 1), 0);

module.exports = { findAll, read, parseHtml, toHtml, count, PASSWORD_HELP };
