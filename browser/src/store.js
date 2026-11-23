// Saves everything to a JSON file in the app's data folder
// (%APPDATA%\Quasar\state.json). Writes are debounced and atomic.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const PRESETS = [
  { name: 'Dawn',   colors: ['#B9A6F2', '#D9B8EC', '#F6C4B4'] },
  { name: 'Night',  colors: ['#1A1B32', '#2D2D54', '#30253A'] },
  { name: 'Dusk',   colors: ['#1E1B4B', '#3B1F5C', '#5A2346'] },
  { name: 'Mint',   colors: ['#A8E6CF', '#C9F2E3', '#E8F7C8'] },
  { name: 'Ocean',  colors: ['#6FA8F5', '#8FC5F2', '#B8E3F0'] },
  { name: 'Ember',  colors: ['#F59E7A', '#F7B98B', '#FAD6A5'] },
  { name: 'Rose',   colors: ['#F2A7C3', '#F5C1D6', '#FAE0E8'] },
  { name: 'Forest', colors: ['#14352A', '#1F4D3A', '#2E6B4F'] },
  { name: 'Mono',   colors: ['#E9E9EC', '#F2F2F4', '#FAFAFB'] },
];

const SEARCH_ENGINES = {
  Google: 'https://www.google.com/search?q=%s',
  Bing: 'https://www.bing.com/search?q=%s',
  DuckDuckGo: 'https://duckduckgo.com/?q=%s',
  Brave: 'https://search.brave.com/search?q=%s',
};

const DEFAULT = {
  version: 1,
  // Every Space is fully separate (own cookies, logins, history, Favorites, passwords).
  spaces: [
    { id: 'personal', name: 'Personal', emoji: '🌸', colors: PRESETS[0].colors, grain: 0.35, partition: 'space-personal', pinned: [], favorites: [], history: [], tabs: [], activeIndex: -1 },
    { id: 'work', name: 'Work', emoji: '🌙', colors: PRESETS[1].colors, grain: 0.3, partition: 'space-work', pinned: [], favorites: [], history: [], tabs: [], activeIndex: -1 },
  ],
  activeSpaceId: 'personal',
  archive: [],
  settings: {
    archiveAfterHours: 12,
    searchEngine: 'Google',
    sidebarWidth: 240,
    sidebarHidden: false,
  },
  bounds: null,
};

const file = () => path.join(app.getPath('userData'), 'state.json');

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const st = { ...structuredClone(DEFAULT), ...data };
    st.settings = { ...DEFAULT.settings, ...(data.settings || {}) };
    if (!('toured' in st.settings)) st.settings.toured = true;   // the welcome tour is for brand-new installs only
    if (!Array.isArray(st.spaces) || !st.spaces.length) st.spaces = structuredClone(DEFAULT.spaces);
    return st;
  } catch {
    return structuredClone(DEFAULT);
  }
}

// Saves happen on almost every page event (title, favicon, navigation), so they
// are batched, written as compact JSON, and done asynchronously so the main
// process (which drives every tab) never stalls on disk. flush() on quit is sync.
let timer = null;
let pending = null;
let writing = false;
let dirAt = null;
function save(state) {
  pending = state;
  if (!timer) timer = setTimeout(writeAsync, 1000);
}
function ensureDir(f) {
  if (dirAt === f) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  dirAt = f;
}
async function writeAsync() {
  timer = null;
  if (!pending) return;
  if (writing) { timer = setTimeout(writeAsync, 250); return; }
  const f = file();
  const json = JSON.stringify(pending);
  pending = null;
  writing = json;
  const myGen = gen;
  try {
    ensureDir(f);
    await fs.promises.writeFile(f + '.tmp', json);
    // A sync flush() ran meanwhile and already wrote this or newer data.
    if (myGen === gen) await fs.promises.rename(f + '.tmp', f);
  } catch { /* try again on the next change */ } finally { writing = false; }
}
let gen = 0;
function flush() {
  clearTimeout(timer); timer = null;
  // Newest data: what's queued, else what an unfinished async write was saving.
  const json = pending ? JSON.stringify(pending) : writing;
  pending = null;
  if (!json) return;
  gen++;
  const f = file();
  ensureDir(f);
  fs.writeFileSync(f + '.tmp2', json);
  fs.renameSync(f + '.tmp2', f);
}

module.exports = { load, save, flush, PRESETS, SEARCH_ENGINES };
