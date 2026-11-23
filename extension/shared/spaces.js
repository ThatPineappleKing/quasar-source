// Spaces are backed by Chrome tab groups: one group per Space per window.
// Switching Space expands that Space's group and collapses the others, which
// is the closest Chrome gets to Arc swapping the whole tab list.

import { getState, getActiveSpaceId, setActiveSpaceId, getLinks, setLink, linkKeyForTab } from './store.js';
import { groupColorFor } from './theme.js';

export const groupTitle = s => `${s.emoji || ''} ${s.name}`.trim();

export async function findGroup(windowId, space) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find(g => g.title === groupTitle(space)) || null;
}

export async function spaceOfGroup(groupId, st) {
  if (groupId == null || groupId === -1) return null;
  const g = await chrome.tabGroups.get(groupId).catch(() => null);
  if (!g) return null;
  st = st || await getState();
  return st.spaces.find(s => groupTitle(s) === g.title) || null;
}

export async function addTabsToSpace(tabIds, windowId, space) {
  const g = await findGroup(windowId, space);
  if (g) {
    await chrome.tabs.group({ groupId: g.id, tabIds });
    return g.id;
  }
  const gid = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(gid, { title: groupTitle(space), color: groupColorFor(space), collapsed: false });
  return gid;
}

export async function activeSpace(windowId, st) {
  st = st || await getState();
  const id = await getActiveSpaceId(windowId);
  return st.spaces.find(s => s.id === id) || st.spaces[0];
}

// Expand `space`'s group, collapse every other Space's group in the window.
export async function showOnly(windowId, space, st) {
  st = st || await getState();
  const others = new Set(st.spaces.filter(s => s.id !== space.id).map(groupTitle));
  const mine = groupTitle(space);
  const groups = await chrome.tabGroups.query({ windowId });
  for (const g of groups) {
    if (g.title === mine && g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: false }).catch(() => {});
    else if (others.has(g.title) && !g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: true }).catch(() => {});
  }
}

export async function switchSpace(windowId, spaceId) {
  const st = await getState();
  const space = st.spaces.find(s => s.id === spaceId);
  if (!space) return;
  await setActiveSpaceId(windowId, spaceId);

  const g = await findGroup(windowId, space);
  let target = null;
  if (g) {
    if (g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: false });
    const tabs = await chrome.tabs.query({ windowId, groupId: g.id });
    target = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
  }
  if (target) await chrome.tabs.update(target.id, { active: true });
  // No tabs yet: open a new tab; the background worker files it into this Space.
  else await chrome.tabs.create({ windowId, active: true });

  await showOnly(windowId, space, st);
}

export async function cycleSpace(windowId, dir) {
  const st = await getState();
  const cur = await getActiveSpaceId(windowId);
  const i = Math.max(0, st.spaces.findIndex(s => s.id === cur));
  const next = st.spaces[(i + dir + st.spaces.length) % st.spaces.length];
  await switchSpace(windowId, next.id);
}

// Open (or jump to) a pinned tab / favourite. Each keeps one live tab,
// like Arc where clicking a pinned tab returns to the same tab.
export async function openLinked(key, url, windowId) {
  const links = await getLinks();
  const tabId = links[key];
  if (tabId != null) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t) {
      await chrome.tabs.update(t.id, { active: true });
      if (t.windowId !== windowId) await chrome.windows.update(t.windowId, { focused: true });
      return t;
    }
  }
  const t = await chrome.tabs.create({ windowId, url, active: true });
  await setLink(key, t.id);
  return t;
}

export { linkKeyForTab };

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function isInternal(url = '') {
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url);
}
