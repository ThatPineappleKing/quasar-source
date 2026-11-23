import { getState, update, uid, getActiveSpaceId, setActiveSpaceId, dropLinksForTab, getLinks } from './shared/store.js';
import {
  groupTitle, findGroup, spaceOfGroup, addTabsToSpace, activeSpace, showOnly,
  cycleSpace, hostOf, isInternal,
} from './shared/spaces.js';
import { groupColorFor } from './shared/theme.js';

const ARCHIVE_ALARM = 'auto-archive';

// ---------------------------------------------------------------- setup
async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  const a = await chrome.alarms.get(ARCHIVE_ALARM);
  if (!a) chrome.alarms.create(ARCHIVE_ALARM, { periodInMinutes: 10 });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setup();
  if (reason === 'install') {
    await chrome.storage.local.set(await getState()); // write defaults
    // File every loose tab into the first Space so everything lives in a Space.
    const wins = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
    for (const w of wins) {
      const loose = w.tabs.filter(t => !t.pinned && t.groupId === -1).map(t => t.id);
      const sp = await activeSpace(w.id);
      if (loose.length) await addTabsToSpace(loose, w.id, sp).catch(() => {});
      await showOnly(w.id, sp).catch(() => {});
    }
    chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onStartup.addListener(setup);

// ------------------------------------------------- keep tabs in Spaces
// Every new tab joins the window's active Space, like Arc's Today tabs.
chrome.tabs.onCreated.addListener(tab => {
  setTimeout(async () => {
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    if (!t || t.pinned || t.groupId !== -1) return;
    const w = await chrome.windows.get(t.windowId).catch(() => null);
    if (!w || w.type !== 'normal') return;
    const sp = await activeSpace(t.windowId);
    await addTabsToSpace([t.id], t.windowId, sp).catch(() => {});
  }, 150);
});

// Clicking a tab that belongs to another Space switches to that Space.
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (!t || t.groupId === -1) return;
  const st = await getState();
  const links = await getLinks();
  const isFav = Object.entries(links).some(([k, v]) => v === tabId && k.startsWith('fav:'));
  const cur = await activeSpace(windowId, st);
  if (isFav) {
    // Favourites are shared by every Space: bring the tab into the current one.
    const g = await findGroup(windowId, cur);
    if (!g || g.id !== t.groupId) await addTabsToSpace([tabId], windowId, cur).catch(() => {});
    return;
  }
  const sp = await spaceOfGroup(t.groupId, st);
  if (sp && sp.id !== cur.id) {
    await setActiveSpaceId(windowId, sp.id);
    await showOnly(windowId, sp, st);
  }
});

chrome.tabs.onRemoved.addListener(tabId => { dropLinksForTab(tabId); });

chrome.windows.onCreated.addListener(async w => {
  if (w.type !== 'normal') return;
  const st = await getState();
  await setActiveSpaceId(w.id, st.lastSpaceId);
});

// ------------------------------------- Air Traffic Control and Boosts
function matches(rulePattern, url) {
  const p = rulePattern.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!p) return false;
  if (p.includes('/')) return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').startsWith(p);
  const h = hostOf(url);
  return h === p || h.endsWith('.' + p);
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.url && !isInternal(info.url)) {
    const st = await getState();
    const rule = st.settings.atc.find(r => matches(r.pattern, info.url));
    const target = rule && st.spaces.find(s => s.id === rule.spaceId);
    if (target) {
      const w = await chrome.windows.get(tab.windowId).catch(() => null);
      const linked = Object.values(await getLinks()).includes(tabId);
      const here = await spaceOfGroup(tab.groupId, st);
      if (w?.type === 'normal' && !linked && (!here || here.id !== target.id)) {
        await addTabsToSpace([tabId], tab.windowId, target).catch(() => {});
        if (tab.active) {
          await setActiveSpaceId(tab.windowId, target.id);
          await showOnly(tab.windowId, target, st);
        }
      }
    }
  }

  if (info.status === 'complete' && tab.url && !isInternal(tab.url)) {
    const st = await getState();
    const css = st.settings.boosts
      .filter(b => b.enabled && b.css && matches(b.domain, tab.url))
      .map(b => b.css).join('\n');
    if (css) chrome.scripting.insertCSS({ target: { tabId }, css }).catch(() => {});
  }
});

// ------------------------------------------------------- auto-archive
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== ARCHIVE_ALARM) return;
  const st = await getState();
  const hours = Number(st.settings.archiveAfterHours) || 0;
  if (!hours) return;
  const cutoff = Date.now() - hours * 3600e3;
  const linked = new Set(Object.values(await getLinks()));
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const victims = [];
  for (const t of tabs) {
    if (t.active || t.pinned || t.audible || linked.has(t.id)) continue;
    if (!t.lastAccessed || t.lastAccessed > cutoff) continue;
    if (!t.url || isInternal(t.url)) continue;
    const sp = await spaceOfGroup(t.groupId, st);
    victims.push({ id: uid(), url: t.url, title: t.title || t.url, spaceId: sp?.id || null, closedAt: Date.now(), tabId: t.id });
  }
  if (!victims.length) return;
  await update(s => {
    s.archive = [...victims.map(({ tabId, ...v }) => v), ...s.archive].slice(0, 300);
    return s;
  });
  await chrome.tabs.remove(victims.map(v => v.tabId)).catch(() => {});
});

// ----------------------------------------------------------- commands
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  const win = tab?.windowId ?? (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
  if (cmd === 'next-space') return cycleSpace(win, 1);
  if (cmd === 'prev-space') return cycleSpace(win, -1);
  if (cmd === 'little-arc') return openLittleArc(win);
});

export async function openLittleArc(fromWindowId) {
  const w = await chrome.windows.get(fromWindowId).catch(() => null);
  const width = 560, height = 720;
  const opts = { url: chrome.runtime.getURL('newtab.html#little'), type: 'popup', width, height, focused: true };
  if (w && w.left != null) {
    opts.left = Math.max(0, w.left + w.width - width - 24);
    opts.top = Math.max(0, w.top + 72);
  }
  await chrome.windows.create(opts);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'little-arc') {
    chrome.windows.getLastFocused({ windowTypes: ['normal'] })
      .then(w => openLittleArc(w.id)).then(() => reply(true), () => reply(false));
    return true;
  }
});

// --------------------------- keep tab groups in sync with Space edits
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.spaces) return;
  const before = changes.spaces.oldValue || [];
  const after = changes.spaces.newValue || [];
  if (!after.length) return;
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });

  for (const old of before) {
    const now = after.find(s => s.id === old.id);
    for (const w of wins) {
      const g = await findGroup(w.id, old);
      if (!g) continue;
      if (!now) {
        // Space deleted: its tabs move into the first remaining Space.
        const tabs = await chrome.tabs.query({ windowId: w.id, groupId: g.id });
        if (tabs.length) await addTabsToSpace(tabs.map(t => t.id), w.id, after[0]).catch(() => {});
        const cur = await getActiveSpaceId(w.id);
        if (cur === old.id) await setActiveSpaceId(w.id, after[0].id);
      } else if (groupTitle(now) !== g.title || groupColorFor(now) !== g.color) {
        await chrome.tabGroups.update(g.id, { title: groupTitle(now), color: groupColorFor(now) }).catch(() => {});
      }
    }
  }
});
