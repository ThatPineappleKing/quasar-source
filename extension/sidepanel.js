import { getState, update, uid, getActiveSpaceId, getLinks, setLink } from './shared/store.js';
import { switchSpace, cycleSpace, findGroup, openLinked, addTabsToSpace, hostOf, isInternal } from './shared/spaces.js';
import { applySpaceTheme, faviconUrl } from './shared/theme.js';
import { spaceEditor } from './shared/editor.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pin:   '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 3H6l4-3-1-6zM12 13v7"/></svg>',
  star:  '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>',
  restore: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5"/></svg>',
};

let windowId;
let st;
let view = 'main';
let dragging = null;     // { kind: 'tab'|'pinned', id }
let lastSpaceIndex = 0;

async function load() {
  windowId = (await chrome.windows.getCurrent()).id;
  await render();
}

let timer;
function scheduleRender() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!dragging) render(); }, 40);
}

async function render() {
  st = await getState();
  const activeId = await getActiveSpaceId(windowId);
  const space = st.spaces.find(s => s.id === activeId) || st.spaces[0];
  const links = await getLinks();
  const [activeTab] = await chrome.tabs.query({ windowId, active: true });
  const g = await findGroup(windowId, space);
  const spaceTabs = g ? await chrome.tabs.query({ windowId, groupId: g.id }) : [];
  const linkedIds = new Set(Object.values(links));

  applySpaceTheme(document.documentElement, space);

  // swipe direction animation
  const idx = st.spaces.findIndex(s => s.id === space.id);
  if (idx !== lastSpaceIndex) {
    const v = $('view-main');
    v.classList.remove('swipe-left', 'swipe-right');
    void v.offsetWidth;
    v.classList.add(idx > lastSpaceIndex ? 'swipe-left' : 'swipe-right');
    lastSpaceIndex = idx;
  }

  // URL pill
  const urlInput = $('url');
  if (document.activeElement !== urlInput) {
    const u = activeTab?.url || '';
    urlInput.value = u.startsWith(chrome.runtime.getURL('')) || u === 'chrome://newtab/' ? '' : (hostOf(u) || u);
    urlInput.placeholder = 'Search or enter URL…';
  }

  renderFavorites(links, activeTab);
  $('spaceTitle').textContent = `${space.emoji || ''} ${space.name}`.trim();
  renderPinned(space, links, activeTab);
  renderToday(spaceTabs.filter(t => !linkedIds.has(t.id)), activeTab);
  renderSpaces(space);
  if (view === 'archive') renderArchive();
  showView(view, space);
}

function showView(v, space) {
  view = v;
  $('view-main').hidden = v !== 'main';
  $('view-archive').hidden = v !== 'archive';
  $('view-edit').hidden = v !== 'edit';
  if (v === 'edit' && space && $('editorHost').dataset.for !== space.id) {
    $('editorHost').dataset.for = space.id;
    $('editorHost').replaceChildren(spaceEditor(space, patch => saveSpace(space.id, patch), {
      onDelete: st.spaces.length > 1 ? () => deleteSpace(space.id) : null,
    }));
  }
  if (v !== 'edit') { delete $('editorHost').dataset.for; $('editorHost').replaceChildren(); }
}

// ---------------------------------------------------------- favorites
function renderFavorites(links, activeTab) {
  const box = $('favorites');
  box.replaceChildren(...st.favorites.map(f => {
    const tabId = links['fav:' + f.id];
    const b = document.createElement('button');
    b.className = 'fav' + (tabId != null ? ' open' : '') + (tabId === activeTab?.id ? ' open' : '');
    b.title = f.title || f.url;
    b.innerHTML = `<img src="${esc(faviconUrl(f.url))}" alt=""><span class="x" title="Remove from Favorites">×</span>`;
    b.onclick = e => {
      if (e.target.classList.contains('x')) {
        update(s => { s.favorites = s.favorites.filter(x => x.id !== f.id); return s; });
      } else openLinked('fav:' + f.id, f.url, windowId);
    };
    return b;
  }));
}

// ------------------------------------------------------------- pinned
function renderPinned(space, links, activeTab) {
  const ul = $('pinned');
  ul.replaceChildren(...space.pinned.map(p => {
    const tabId = links['pin:' + p.id];
    const li = document.createElement('li');
    li.innerHTML = `<div class="row${tabId === activeTab?.id ? ' active' : ''}" draggable="true" title="${esc(p.url)}">
      <img src="${esc(faviconUrl(p.url))}" alt="">
      <span class="title">${esc(p.title || hostOf(p.url))}</span>
      ${tabId != null && tabId !== activeTab?.id ? '<span class="dot" title="Open"></span>' : ''}
      <span class="tools"><button data-a="unpin" title="Unpin">${ICON.close}</button></span></div>`;
    const row = li.firstElementChild;
    row.onclick = e => {
      if (e.target.closest('[data-a=unpin]')) return unpin(space.id, p.id, tabId);
      openLinked('pin:' + p.id, p.url, windowId);
    };
    row.addEventListener('dragstart', () => { dragging = { kind: 'pinned', id: p.id }; row.classList.add('dragging'); });
    row.addEventListener('dragend', endDrag);
    row.addEventListener('dragover', e => { if (dragging?.kind === 'pinned') { e.preventDefault(); row.classList.add('drop-before'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
    row.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); row.classList.remove('drop-before');
      if (dragging?.kind === 'pinned') reorderPinned(space.id, dragging.id, p.id);
    });
    return li;
  }));
}

async function unpin(spaceId, pinId, tabId) {
  await update(s => {
    const sp = s.spaces.find(x => x.id === spaceId);
    sp.pinned = sp.pinned.filter(p => p.id !== pinId);
    return s;
  });
  // The open tab stays, becoming a normal tab again.
  if (tabId != null) await chrome.storage.session.get('links').then(({ links = {} }) => {
    delete links['pin:' + pinId];
    return chrome.storage.session.set({ links });
  });
}

async function reorderPinned(spaceId, fromId, beforeId) {
  if (fromId === beforeId) return;
  await update(s => {
    const sp = s.spaces.find(x => x.id === spaceId);
    const item = sp.pinned.find(p => p.id === fromId);
    sp.pinned = sp.pinned.filter(p => p.id !== fromId);
    sp.pinned.splice(sp.pinned.findIndex(p => p.id === beforeId), 0, item);
    return s;
  });
}

async function pinTab(tab, spaceId) {
  const id = uid();
  await update(s => {
    const sp = s.spaces.find(x => x.id === spaceId);
    sp.pinned.push({ id, url: tab.url, title: tab.title });
    return s;
  });
  await setLink('pin:' + id, tab.id);
}

async function favoriteTab(tab) {
  const id = uid();
  await update(s => {
    if (s.favorites.length >= 12) return s; // Arc's limit
    s.favorites.push({ id, url: tab.url, title: tab.title });
    return s;
  });
  await setLink('fav:' + id, tab.id);
}

// -------------------------------------------------------------- today
function renderToday(tabs, activeTab) {
  const ul = $('today');
  tabs.sort((a, b) => a.index - b.index);
  ul.replaceChildren(...tabs.map(t => {
    const li = document.createElement('li');
    const url = t.pendingUrl || t.url || '';
    const title = isInternal(url) && !t.title ? 'New Tab' : (t.title || hostOf(url) || 'New Tab');
    li.innerHTML = `<div class="row${t.id === activeTab?.id ? ' active' : ''}" draggable="true" title="${esc(url)}">
      <img src="${esc(faviconUrl(url))}" alt="">
      <span class="title">${esc(title)}</span>
      <span class="tools">
        <button data-a="pin" title="Pin to this Space">${ICON.pin}</button>
        <button data-a="fav" title="Add to Favorites">${ICON.star}</button>
        <button data-a="close" title="Close tab">${ICON.close}</button>
      </span></div>`;
    const row = li.firstElementChild;
    row.onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'close') return chrome.tabs.remove(t.id);
      if (a === 'pin') return pinTab(t, (await getActiveSpaceId(windowId)));
      if (a === 'fav') return favoriteTab(t);
      chrome.tabs.update(t.id, { active: true });
    };
    row.onauxclick = e => { if (e.button === 1) chrome.tabs.remove(t.id); };
    row.addEventListener('dragstart', () => { dragging = { kind: 'tab', id: t.id }; row.classList.add('dragging'); });
    row.addEventListener('dragend', endDrag);
    row.addEventListener('dragover', e => { if (dragging?.kind === 'tab') { e.preventDefault(); row.classList.add('drop-before'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
    row.addEventListener('drop', async e => {
      e.preventDefault(); row.classList.remove('drop-before');
      if (dragging?.kind === 'tab' && dragging.id !== t.id) {
        const cur = await chrome.tabs.get(t.id);
        await chrome.tabs.move(dragging.id, { index: cur.index });
        await chrome.tabs.group({ groupId: cur.groupId, tabIds: dragging.id }).catch(() => {});
      }
    });
    return li;
  }));
}

function endDrag() {
  dragging = null;
  document.querySelectorAll('.dragging,.drop-before,.drop').forEach(n => n.classList.remove('dragging', 'drop-before', 'drop'));
  scheduleRender();
}

// pinned section accepts dropped tabs
$('pinned').addEventListener('dragover', e => { if (dragging?.kind === 'tab') { e.preventDefault(); $('pinned').classList.add('drop'); } });
$('pinned').addEventListener('dragleave', e => { if (!$('pinned').contains(e.relatedTarget)) $('pinned').classList.remove('drop'); });
$('pinned').addEventListener('drop', async e => {
  e.preventDefault();
  if (dragging?.kind !== 'tab') return;
  const t = await chrome.tabs.get(dragging.id).catch(() => null);
  if (t) await pinTab(t, await getActiveSpaceId(windowId));
});
// favorites accept dropped tabs too
$('favorites').addEventListener('dragover', e => { if (dragging?.kind === 'tab') e.preventDefault(); });
$('favorites').addEventListener('drop', async e => {
  e.preventDefault();
  if (dragging?.kind !== 'tab') return;
  const t = await chrome.tabs.get(dragging.id).catch(() => null);
  if (t) await favoriteTab(t);
});

// ------------------------------------------------------------- spaces
function renderSpaces(active) {
  const nav = $('spaces');
  nav.replaceChildren(...st.spaces.map((s, i) => {
    const b = document.createElement('button');
    b.className = 'space-dot' + (s.id === active.id ? ' on' : '');
    b.title = `${s.name}${i < 9 ? '' : ''}`;
    b.innerHTML = s.emoji ? esc(s.emoji) : '<span class="ring"></span>';
    b.onclick = () => switchSpace(windowId, s.id);
    b.ondblclick = () => { switchSpace(windowId, s.id).then(() => showView('edit', s)); };
    // drop a tab on a Space icon to move it there
    b.addEventListener('dragover', e => { if (dragging?.kind === 'tab') { e.preventDefault(); b.classList.add('drop'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', async e => {
      e.preventDefault();
      if (dragging?.kind === 'tab') await addTabsToSpace([dragging.id], windowId, s).catch(() => {});
    });
    return b;
  }));
}

async function saveSpace(id, patch) {
  await update(s => {
    const sp = s.spaces.find(x => x.id === id);
    Object.assign(sp, patch);
    return s;
  });
}

async function deleteSpace(id) {
  if (!confirm('Delete this Space? Its tabs move to your first Space.')) return;
  await update(s => { s.spaces = s.spaces.filter(x => x.id !== id); return s; });
  view = 'main';
  const st2 = await getState();
  await switchSpace(windowId, st2.spaces[0].id);
}

$('addSpace').onclick = async () => {
  const id = uid();
  const palettes = [['#A8E6CF', '#C9F2E3', '#E8F7C8'], ['#6FA8F5', '#8FC5F2', '#B8E3F0'], ['#F59E7A', '#F7B98B', '#FAD6A5'], ['#F2A7C3', '#F5C1D6', '#FAE0E8']];
  await update(s => {
    s.spaces.push({ id, name: `Space ${s.spaces.length + 1}`, emoji: '✨', colors: palettes[s.spaces.length % palettes.length], grain: 0.35, pinned: [] });
    return s;
  });
  await switchSpace(windowId, id);
  view = 'edit';
  render();
};

// ----------------------------------------------------------- archive
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
function renderArchive() {
  const ul = $('archiveList');
  if (!st.archive.length) { ul.innerHTML = '<li class="hint">Nothing archived yet.</li>'; return; }
  ul.replaceChildren(...st.archive.map(a => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="row" title="${esc(a.url)}"><img src="${esc(faviconUrl(a.url))}" alt="">
      <span class="title">${esc(a.title)}</span><span class="when">${ago(a.closedAt)}</span>
      <span class="tools"><button data-a="del" title="Remove">${ICON.close}</button></span></div>`;
    li.firstElementChild.onclick = async e => {
      if (!e.target.closest('[data-a=del]')) await chrome.tabs.create({ windowId, url: a.url });
      await update(s => { s.archive = s.archive.filter(x => x.id !== a.id); return s; });
    };
    return li;
  }));
}

// ------------------------------------------------------------ controls
$('back').onclick = () => chrome.tabs.goBack().catch(() => {});
$('fwd').onclick = () => chrome.tabs.goForward().catch(() => {});
$('reload').onclick = () => chrome.tabs.reload();
$('little').onclick = () => chrome.runtime.sendMessage({ type: 'little-arc' });
$('newTab').onclick = () => chrome.tabs.create({ windowId });
$('settings').onclick = () => chrome.runtime.openOptionsPage();
$('archiveBtn').onclick = () => { view = view === 'archive' ? 'main' : 'archive'; render(); };
$('archiveBack').onclick = () => { view = 'main'; render(); };
$('clearArchive').onclick = () => update(s => { s.archive = []; return s; });
$('editSpace').onclick = $('spaceTitle').onclick = () => { view = 'edit'; render(); };
$('editDone').onclick = () => { view = 'main'; render(); };
$('tidy').onclick = async () => {
  const id = await getActiveSpaceId(windowId);
  const space = st.spaces.find(s => s.id === id) || st.spaces[0];
  const g = await findGroup(windowId, space);
  if (!g) return;
  const links = new Set(Object.values(await getLinks()));
  const tabs = (await chrome.tabs.query({ windowId, groupId: g.id })).filter(t => !links.has(t.id));
  if (tabs.length) await chrome.tabs.remove(tabs.map(t => t.id));
};

$('urlForm').onsubmit = async e => {
  e.preventDefault();
  const text = $('url').value.trim();
  if (!text) return;
  const [tab] = await chrome.tabs.query({ windowId, active: true });
  const url = toUrl(text);
  if (url) await chrome.tabs.update(tab.id, { url });
  else await chrome.search.query({ text, tabId: tab.id });
  $('url').blur();
};
$('url').addEventListener('focus', async () => {
  const [tab] = await chrome.tabs.query({ windowId, active: true });
  const u = tab?.url || '';
  $('url').value = isInternal(u) ? '' : u;
  $('url').select();
});
$('url').addEventListener('blur', scheduleRender);

export function toUrl(text) {
  if (/^[a-z][\w+.-]*:\/\//i.test(text) || /^(about|chrome):/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return 'http://' + text;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return 'https://' + text;
  return null;
}

// Two-finger horizontal swipe switches Space, like Arc.
let swipeAcc = 0, swipeLock = 0;
document.addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  if (Date.now() < swipeLock) return;
  swipeAcc += e.deltaX;
  if (Math.abs(swipeAcc) > 140) {
    cycleSpace(windowId, swipeAcc > 0 ? 1 : -1);
    swipeAcc = 0;
    swipeLock = Date.now() + 600;
  }
}, { passive: true });

// --------------------------------------------------------- live update
for (const ev of ['onCreated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached']) chrome.tabs[ev].addListener(scheduleRender);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.title || info.url || info.favIconUrl || info.groupId !== undefined || info.status) scheduleRender(); });
chrome.tabGroups.onUpdated.addListener(scheduleRender);
chrome.storage.onChanged.addListener((changes, area) => {
  // Don't rebuild the editor while the user is dragging a colour picker.
  if (view === 'edit' && area === 'local' && changes.spaces) { st = null; return scheduleRender(); }
  scheduleRender();
});

load();
