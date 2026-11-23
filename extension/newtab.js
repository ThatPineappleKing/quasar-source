// Arc-style Command Bar on the new tab page (Ctrl+T). Searches open tabs,
// bookmarks, history and actions; Enter goes to a URL or searches with your
// default search engine. The page background is the current Space's theme.

import { getState, getActiveSpaceId } from './shared/store.js';
import { switchSpace, hostOf } from './shared/spaces.js';
import { applySpaceTheme, faviconUrl } from './shared/theme.js';

const q = document.getElementById('q');
const list = document.getElementById('results');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const little = location.hash === '#little';

// Chrome keeps keyboard focus in the address bar on a new tab page.
// Re-opening ourselves by URL hands focus to the page, so typing goes
// straight into the Command Bar like Arc.
if (!little && location.hash !== '#cmd') {
  chrome.tabs.getCurrent(t => { if (t) chrome.tabs.update(t.id, { url: chrome.runtime.getURL('newtab.html#cmd') }); });
}

let self, win, st, items = [], sel = 0, token = 0;

async function init() {
  if (little) document.body.classList.add('little');
  self = await chrome.tabs.getCurrent();
  win = await chrome.windows.getCurrent();
  st = await getState();
  const spaceId = win.type === 'normal' ? await getActiveSpaceId(win.id) : st.lastSpaceId;
  const space = st.spaces.find(s => s.id === spaceId) || st.spaces[0];
  applySpaceTheme(document.documentElement, space);
  document.getElementById('spaceTag').textContent = `${space.emoji || ''} ${space.name}`.trim();
  q.focus();
  refresh();
}

function toUrl(text) {
  if (/^[a-z][\w+.-]*:\/\//i.test(text) || /^(about|chrome):/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return 'http://' + text;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return 'https://' + text;
  return null;
}

async function go(url) { await chrome.tabs.update(self.id, { url }); }

async function switchTo(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (tab.id !== self.id) chrome.tabs.remove(self.id);
}

function actions() {
  const list = [
    { title: 'New Little Arc window', glyph: '▢', run: () => chrome.runtime.sendMessage({ type: 'little-arc' }).then(() => chrome.tabs.remove(self.id)) },
    { title: 'Open Settings', glyph: '⚙', run: () => chrome.runtime.openOptionsPage() },
    { title: 'Open sidebar', glyph: '⇤', run: () => chrome.sidePanel.open({ windowId: win.id }) },
  ];
  if (st.archive.length) list.push({
    title: 'Reopen last archived tab', sub: st.archive[0].title, glyph: '↺', run: () => go(st.archive[0].url),
  });
  if (win.type === 'normal') for (const s of st.spaces) list.push({
    title: `Switch to ${s.name}`, glyph: s.emoji || '●', badge: 'Space',
    run: async () => { await chrome.tabs.remove(self.id); await switchSpace(win.id, s.id); },
  });
  return list;
}

async function refresh() {
  const my = ++token;
  const text = q.value.trim();
  const low = text.toLowerCase();
  const out = [];
  const seen = new Set();
  const add = (sec, it) => { if (it.url && seen.has(it.url)) return; if (it.url) seen.add(it.url); out.push({ sec, ...it }); };

  const tabs = (await chrome.tabs.query({ windowType: 'normal' })).filter(t => t.id !== self?.id && t.url && !t.url.startsWith(chrome.runtime.getURL('')));

  if (!text) {
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)).slice(0, 6)
      .forEach(t => add('Recent tabs', { title: t.title, sub: hostOf(t.url), url: t.url, badge: 'Switch to Tab', run: () => switchTo(t) }));
    st.favorites.forEach(f => add('Favorites', { title: f.title || hostOf(f.url), sub: hostOf(f.url), url: f.url, run: () => go(f.url) }));
  } else {
    const url = toUrl(text);
    if (url) out.push({ sec: '', title: url, glyph: '↗', badge: 'Open', run: () => go(url) });
    out.push({ sec: '', title: text, glyph: '⌕', badge: 'Search', run: () => chrome.search.query({ text, tabId: self.id }) });

    actions().filter(a => a.title.toLowerCase().includes(low)).slice(0, 4).forEach(a => add('Actions', a));

    tabs.filter(t => (t.title || '').toLowerCase().includes(low) || t.url.toLowerCase().includes(low)).slice(0, 5)
      .forEach(t => add('Open tabs', { title: t.title, sub: hostOf(t.url), url: t.url, badge: 'Switch to Tab', run: () => switchTo(t) }));

    const [bm, hist] = await Promise.all([
      chrome.bookmarks.search(text).catch(() => []),
      chrome.history.search({ text, maxResults: 12, startTime: 0 }).catch(() => []),
    ]);
    if (my !== token) return;
    bm.filter(b => b.url).slice(0, 4).forEach(b => add('Bookmarks', { title: b.title || b.url, sub: hostOf(b.url), url: b.url, run: () => go(b.url) }));
    hist.slice(0, 6).forEach(h => add('History', { title: h.title || h.url, sub: hostOf(h.url), url: h.url, run: () => go(h.url) }));
  }
  if (my !== token) return;
  items = out;
  sel = 0;
  draw();
}

function draw() {
  list.replaceChildren();
  let last = null;
  items.forEach((it, i) => {
    if (it.sec && it.sec !== last) {
      const h = document.createElement('li');
      h.className = 'sec'; h.textContent = it.sec;
      list.append(h);
    }
    last = it.sec;
    const li = document.createElement('li');
    li.className = 'item' + (i === sel ? ' sel' : '');
    li.setAttribute('role', 'option');
    const icon = it.url ? `<img src="${esc(faviconUrl(it.url))}" alt="">` : `<span class="glyph">${esc(it.glyph || '•')}</span>`;
    li.innerHTML = `${icon}<span class="t">${esc(it.title)}${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</span>${it.badge ? `<span class="badge">${esc(it.badge)}</span>` : ''}`;
    li.onmousemove = () => { if (sel !== i) { sel = i; mark(); } };
    li.onclick = () => it.run();
    list.append(li);
  });
}
function mark() {
  list.querySelectorAll('li.item').forEach((li, i) => li.classList.toggle('sel', i === sel));
  list.querySelectorAll('li.item')[sel]?.scrollIntoView({ block: 'nearest' });
}

let deb;
q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(refresh, 60); });
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
  else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
  else if (e.key === 'Escape') { if (q.value) { q.value = ''; refresh(); } else if (little) window.close(); }
});
// Typing anywhere goes to the bar.
document.addEventListener('keydown', e => {
  if (document.activeElement !== q && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) q.focus();
});

init();
