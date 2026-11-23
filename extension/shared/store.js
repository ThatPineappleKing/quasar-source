// Persistent state lives in chrome.storage.local (per Chrome profile, like
// Arc's per-Profile data). Per-window, per-session state (which Space each
// window is showing, which tab belongs to which pinned/favourite) lives in
// chrome.storage.session.

export const PRESETS = [
  { name: 'Dawn',  colors: ['#B9A6F2', '#D9B8EC', '#F6C4B4'] },
  { name: 'Dusk',  colors: ['#1E1B4B', '#3B1F5C', '#5A2346'] },
  { name: 'Mint',  colors: ['#A8E6CF', '#C9F2E3', '#E8F7C8'] },
  { name: 'Ocean', colors: ['#6FA8F5', '#8FC5F2', '#B8E3F0'] },
  { name: 'Ember', colors: ['#F59E7A', '#F7B98B', '#FAD6A5'] },
  { name: 'Rose',  colors: ['#F2A7C3', '#F5C1D6', '#FAE0E8'] },
  { name: 'Forest',colors: ['#14352A', '#1F4D3A', '#2E6B4F'] },
  { name: 'Mono',  colors: ['#E9E9EC', '#F2F2F4', '#FAFAFB'] },
  { name: 'Night', colors: ['#1A1B32', '#2D2D54', '#30253A'] },
];

export const DEFAULT_STATE = {
  spaces: [
    { id: 'personal', name: 'Personal', emoji: '🌸', colors: [...PRESETS[0].colors], grain: 0.35, pinned: [] },
    { id: 'work',     name: 'Work',     emoji: '🌙', colors: [...PRESETS[1].colors], grain: 0.35, pinned: [] },
  ],
  lastSpaceId: 'personal',
  favorites: [],          // [{id, url, title}]  shared across Spaces (Arc: per Profile)
  archive: [],            // [{id, url, title, spaceId, closedAt}]
  settings: {
    archiveAfterHours: 12, // Arc's default; 0 = never
    atc: [],               // Air Traffic Control: [{id, pattern, spaceId}]
    boosts: [],            // [{id, domain, css, enabled}]
  },
};

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

export async function getState() {
  const s = await chrome.storage.local.get(null);
  const st = { ...structuredClone(DEFAULT_STATE), ...s };
  st.settings = { ...DEFAULT_STATE.settings, ...(s.settings || {}) };
  if (!Array.isArray(st.spaces) || st.spaces.length === 0) st.spaces = structuredClone(DEFAULT_STATE.spaces);
  return st;
}

// Serialise read-modify-write updates within one page/worker.
let chain = Promise.resolve();
export function update(fn) {
  const run = chain.then(async () => {
    const st = await getState();
    const out = (await fn(st)) || st;
    await chrome.storage.local.set(out);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

// ---- session state ----
let sChain = Promise.resolve();
function sessionUpdate(key, fn) {
  const run = sChain.then(async () => {
    const cur = (await chrome.storage.session.get(key))[key] || {};
    const next = fn(cur) || cur;
    await chrome.storage.session.set({ [key]: next });
    return next;
  });
  sChain = run.catch(() => {});
  return run;
}

export async function getActiveSpaceId(windowId) {
  const { activeByWindow = {} } = await chrome.storage.session.get('activeByWindow');
  if (activeByWindow[windowId]) return activeByWindow[windowId];
  const st = await getState();
  return st.spaces.some(s => s.id === st.lastSpaceId) ? st.lastSpaceId : st.spaces[0].id;
}

export async function setActiveSpaceId(windowId, spaceId) {
  await sessionUpdate('activeByWindow', m => { m[windowId] = spaceId; return m; });
  await update(st => { st.lastSpaceId = spaceId; return st; });
}

// links: { "fav:<id>" | "pin:<id>": tabId }
export async function getLinks() {
  const { links = {} } = await chrome.storage.session.get('links');
  return links;
}
export function setLink(key, tabId) {
  return sessionUpdate('links', m => { m[key] = tabId; return m; });
}
export function dropLinksForTab(tabId) {
  return sessionUpdate('links', m => {
    for (const k of Object.keys(m)) if (m[k] === tabId) delete m[k];
    return m;
  });
}
export async function linkKeyForTab(tabId) {
  const links = await getLinks();
  return Object.keys(links).find(k => links[k] === tabId) || null;
}
