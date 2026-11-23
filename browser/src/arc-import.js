// Reads Arc for Windows' own data files and converts them for Quasar:
// Spaces (name, emoji, colour, grain, profile), pinned tabs (with their folders
// and split views), open tabs (with split views), Favorites, and optionally history.
//
// Arc keeps this in:
//   %LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_*\LocalCache\Local\Arc\StorableSidebar.json
//   ...\Arc\User Data\<profile>\History   (Chromium SQLite history)
// Logins, cookies and passwords are NOT imported: Chromium encrypts them for Arc only.

const fs = require('fs');
const os = require('os');
const path = require('path');

function find() {
  const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages');
  let dirs = [];
  try { dirs = fs.readdirSync(pk).filter(d => d.startsWith('TheBrowserCompany.Arc')); } catch { /* none */ }
  for (const d of dirs) {
    const base = path.join(pk, d, 'LocalCache', 'Local', 'Arc');
    const sidebar = path.join(base, 'StorableSidebar.json');
    if (fs.existsSync(sidebar)) return { sidebar, userData: path.join(base, 'User Data') };
  }
  return null;
}

// Arc stores lists as [key, value, key, value, ...]; objects are the values.
const objects = arr => (arr || []).filter(x => x && typeof x === 'object' && !Array.isArray(x));

const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
const hex = ({ red, green, blue }) => '#' + [red, green, blue].map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
function shade(h, amt) {
  const n = parseInt(h.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return '#' + ch.map(c => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Collect every colour object inside the Space's background theme.
function themeColors(space) {
  const bg = space.customInfo?.windowTheme?.background;
  const found = [];
  let noise = null, grain = false;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if ('red' in o && 'green' in o && 'blue' in o) { found.push(hex(o)); return; }
    if (o.modifiers) { if (typeof o.modifiers.noiseFactor === 'number') noise = o.modifiers.noiseFactor; if (o.modifiers.overlay === 'grain') grain = true; }
    for (const v of Object.values(o)) walk(v);
  })(bg);
  const uniq = [...new Set(found)];
  let colors;
  if (uniq.length >= 2) colors = uniq.slice(0, 3);
  else if (uniq.length === 1) colors = [shade(uniq[0], -0.15), uniq[0], shade(uniq[0], 0.2)];
  else colors = ['#B9A6F2', '#D9B8EC', '#F6C4B4'];
  const g = noise && noise > 0 ? noise : grain ? 0.3 : 0.15;
  return { colors, grain: clamp01(g) };
}

function profileNames(userData) {
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(userData, 'Local State'), 'utf8'));
    const cache = ls.profile?.info_cache || {};
    return Object.fromEntries(Object.entries(cache).map(([dir, info]) => [dir, info.name || dir]));
  } catch { return {}; }
}

function profileDir(p) {
  if (!p || p.default) return 'Default';
  return p.custom?._0?.directoryBasename || 'Default';
}

function parse(sidebarPath, userData) {
  const j = JSON.parse(fs.readFileSync(sidebarPath, 'utf8'));
  const containers = j.sidebar?.containers || [];
  const items = new Map();
  for (const c of containers) for (const it of objects(c.items)) items.set(it.id, it);
  const names = profileNames(userData);
  const profileName = dir => dir === 'Default' ? 'Default' : (names[dir] && names[dir] !== 'Person 1' ? names[dir] : dir);

  const tabOf = it => {
    const tab = it.data?.tab;
    if (!tab?.savedURL || !/^https?:|^file:/i.test(tab.savedURL)) return null;
    return { url: tab.savedURL, title: (typeof it.title === 'string' && it.title) || tab.savedTitle || '', lastActive: tab.timeLastActiveAt ? (tab.timeLastActiveAt + 978307200) * 1000 : Date.now() };
  };
  // Arc marks a split view with a data key like "splitView"; folders are "list" items.
  const isSplit = it => Object.keys(it.data || {}).some(k => /split/i.test(k));
  const isFolder = it => !isSplit(it) && !it.data?.tab && !it.data?.itemContainer && (it.childrenIds || []).length > 0;

  // Walk a container keeping folders and split views:
  //   tab {url,title,lastActive} | {type:'folder', title, children} | {type:'split', children:[tabs]}
  function treeIn(containerId, seen = new Set()) {
    const out = [];
    const node = items.get(containerId);
    if (!node || seen.has(containerId)) return out;
    seen.add(containerId);
    for (const id of node.childrenIds || []) {
      const it = items.get(id);
      if (!it) continue;
      const tab = tabOf(it);
      if (tab) out.push(tab);
      else if (isSplit(it)) {
        const kids = flatten(treeIn(id, seen)).slice(0, 4);
        if (kids.length > 1) out.push({ type: 'split', children: kids }); else out.push(...kids);
      } else if (isFolder(it)) {
        out.push({ type: 'folder', title: (typeof it.title === 'string' && it.title) || 'Folder', children: treeIn(id, seen) });
      } else if (it.childrenIds?.length) out.push(...treeIn(id, seen));   // other containers: just their contents
    }
    return out;
  }
  const flatten = list => list.flatMap(n => (n.type ? flatten(n.children) : [n]));
  // Flat list of tabs (Favorites), and today's tabs where folders are flattened but splits kept.
  const tabsIn = id => flatten(treeIn(id));
  const todayIn = id => treeIn(id).flatMap(n => (n.type === 'folder' ? flatten(n.children) : [n]));

  const spaces = [];
  const usedProfiles = new Set();
  for (const c of containers) {
    for (const s of objects(c.spaces)) {
      if (!s.title) continue; // untitled ones are Little Arc / standalone windows
      const ids = s.containerIDs || [];
      const idOf = key => { const i = ids.indexOf(key); return i >= 0 ? ids[i + 1] : null; };
      const { colors, grain } = themeColors(s);
      const dir = profileDir(s.profile);
      usedProfiles.add(dir);
      spaces.push({
        arcId: s.id,
        name: s.title,
        emoji: s.customInfo?.iconType?.emoji_v2 || '',
        colors, grain,
        profile: profileName(dir),
        profileDir: dir,
        pinned: treeIn(idOf('pinned')),       // folders and split views kept
        tabs: todayIn(idOf('unpinned')),      // tabs, and split views as { type: 'split', children }
      });
    }
  }

  // Favorites ("top apps") are stored per profile in Arc.
  const favorites = [];
  const seenFav = new Set();
  for (const c of containers) {
    const t = c.topAppsContainerIDs || [];
    for (let i = 0; i < t.length; i += 2) {
      const dir = profileDir(t[i]);
      for (const tab of tabsIn(t[i + 1])) {
        if (seenFav.has(tab.url)) continue;
        seenFav.add(tab.url);
        favorites.push({ ...tab, profile: profileName(dir) });
      }
    }
  }
  return { spaces, favorites, profileDirs: [...usedProfiles] };
}

// Chromium History (SQLite). Copied first because Arc may have it locked.
function readHistory(userData, dirs, limit = 3000) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return { entries: [], error: 'History import needs a newer Electron (node:sqlite unavailable).' }; }
  const entries = [];
  const errors = [];
  for (const dir of dirs) {
    const src = path.join(userData, dir, 'History');
    if (!fs.existsSync(src)) continue;
    const tmp = path.join(os.tmpdir(), `arch-arc-history-${process.pid}-${dir.replace(/\W/g, '')}.db`);
    try {
      fs.copyFileSync(src, tmp);
      const db = new DatabaseSync(tmp, { readOnly: true });
      const stmt = db.prepare('SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?');
      stmt.setReadBigInts(true); // Chromium timestamps are microseconds since 1601
      const rows = stmt.all(limit);
      db.close();
      for (const r of rows) {
        if (!/^https?:/i.test(r.url)) continue;
        entries.push({ url: r.url, title: r.title || '', visits: Number(r.visit_count) || 1, last: Math.round(Number(r.last_visit_time) / 1000 - 11644473600000) });
      }
    } catch (e) { errors.push(`${dir}: ${e.message}`); } finally {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
  return { entries, error: errors.join('; ') };
}

// Count tabs in an imported tree (for the confirmation message).
const countTabs = list => (list || []).reduce((n, x) => n + (x.type ? countTabs(x.children) : 1), 0);

module.exports = { find, parse, readHistory, countTabs };
